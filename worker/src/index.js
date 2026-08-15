// FabEnglish 同步後端（Cloudflare Worker + D1，SPEC §4.12）
//
// 這支 Worker 只做一件事：幫一個帳號存一包進度 JSON，並在多台裝置之間傳遞。
// **合併不在這裡做**——合併規則在前端 js/merge.js，因為只有前端知道 schema 的語意，
// 而且合併寫在前端才能離線先合併、連上線再上傳。
//
// 端點：
//   GET  /health          健康檢查（唯一不需要 app key 的端點）
//   POST /account         建立帳號（不需要 Google；配對碼流程與尚未設定 OAuth 時用）
//   POST /auth/google     用 Google ID token 登入／註冊；帶著現有 session 就是「把這個帳號綁上 Google」
//   GET  /progress        取回雲端進度 {rev, blob, updatedAt}
//   PUT  /progress        上傳 {baseRev, blob}；rev 對不上回 409＋雲端現況（前端合併後重試）
//   POST /link/code       產生配對碼（要登入）
//   POST /link/claim      用配對碼把這台裝置綁到同一個帳號
//   POST /logout          撤銷這個 session

const VERSION = 'm7.1';
const MAX_BLOB = 512 * 1024;          // 進度 JSON 上限；正常大約幾十 KB
const SESSION_DAYS = 400;             // session 有效期
const CODE_TTL_MS = 15 * 60 * 1000;   // 配對碼 15 分鐘

/** 配對碼字母表：拿掉 0/O/1/I/L，唸出來、手抄都不會認錯。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const res = await handle(req, env, url);
      return withHeaders(res, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[sync]', err);
      return withHeaders(
        json({ error: err.message || '伺服器錯誤' }, status),
        cors,
      );
    }
  },
};

async function handle(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/health' || path === '/') {
    return json({ ok: true, version: VERSION, google: !!env.GOOGLE_CLIENT_ID });
  }

  requireAppKey(req, env);

  const key = `${req.method} ${path}`;
  switch (key) {
    case 'POST /account':     return createAccount(req, env);
    case 'POST /auth/google': return authGoogle(req, env);
    case 'GET /progress':     return getProgress(req, env);
    case 'PUT /progress':     return putProgress(req, env);
    case 'POST /link/code':   return linkCode(req, env);
    case 'POST /link/claim':  return linkClaim(req, env);
    case 'POST /logout':      return logout(req, env);
    case 'DELETE /account':   return deleteAccount(req, env);
    default: throw new HttpError(404, `沒有這個端點：${key}`);
  }
}

/* ---------- 端點 ---------- */

/** 建立一個還沒綁 Google 的帳號。回傳的 token 就是這台裝置的身分。 */
async function createAccount(req, env) {
  const id = 'acc_' + randomId(12);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO accounts (id, google_sub, email, blob, rev, created_at, updated_at) VALUES (?, NULL, NULL, NULL, 0, ?, 0)',
  ).bind(id, now).run();
  const token = await newSession(env, id);
  return json({ token, accountId: id, email: null, rev: 0 });
}

/**
 * Google 登入。三種情形：
 *   1. 這個 Google 帳號已經有資料 → 直接登入
 *   2. 沒有，但呼叫端已經有 session（先前用配對碼建的匿名帳號）→ 把那個帳號綁上 Google，進度不會消失
 *   3. 都沒有 → 開新帳號
 */
async function authGoogle(req, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new HttpError(503, 'Google 登入尚未設定（伺服器缺 GOOGLE_CLIENT_ID）');
  }
  const body = await readJson(req);
  const credential = String(body.credential || '');
  if (!credential) throw new HttpError(400, '缺少 credential');

  const { sub, email } = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
  const now = Date.now();

  let row = await env.DB.prepare('SELECT id, rev FROM accounts WHERE google_sub = ?').bind(sub).first();

  if (!row) {
    const existing = await sessionAccount(req, env, { optional: true });
    if (existing) {
      // 把目前這台裝置的匿名帳號升級成 Google 帳號
      await env.DB.prepare('UPDATE accounts SET google_sub = ?, email = ? WHERE id = ?')
        .bind(sub, email, existing.id).run();
      row = { id: existing.id, rev: existing.rev };
    } else {
      const id = 'acc_' + randomId(12);
      await env.DB.prepare(
        'INSERT INTO accounts (id, google_sub, email, blob, rev, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, ?, 0)',
      ).bind(id, sub, email, now).run();
      row = { id, rev: 0 };
    }
  } else {
    await env.DB.prepare('UPDATE accounts SET email = ? WHERE id = ?').bind(email, row.id).run();
  }

  const token = await newSession(env, row.id);
  return json({ token, accountId: row.id, email, rev: row.rev });
}

async function getProgress(req, env) {
  const acc = await sessionAccount(req, env);
  const row = await env.DB.prepare('SELECT blob, rev, updated_at FROM accounts WHERE id = ?')
    .bind(acc.id).first();
  if (!row) throw new HttpError(404, '帳號不存在');
  return json({
    rev: row.rev,
    updatedAt: row.updated_at,
    blob: row.blob ? JSON.parse(row.blob) : null,
  });
}

async function putProgress(req, env) {
  const acc = await sessionAccount(req, env);
  const body = await readJson(req);
  if (!body || typeof body.blob !== 'object' || body.blob === null) {
    throw new HttpError(400, 'blob 必須是物件');
  }
  const text = JSON.stringify(body.blob);
  if (text.length > MAX_BLOB) throw new HttpError(413, `進度太大（${text.length} bytes）`);

  const baseRev = Number(body.baseRev) || 0;
  const now = Date.now();

  // 單一 statement 比對版本號，避免兩台同時上傳互相蓋掉
  const res = await env.DB.prepare(
    'UPDATE accounts SET blob = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?',
  ).bind(text, now, acc.id, baseRev).run();

  if (!res.meta.changes) {
    // 版本對不上：把雲端現況原封不動送回去，前端合併完再上傳一次。
    // 這裡刻意回 200 而不是 409——兩台裝置同時開著就一定會撞到，這是協定的正常分支，
    // 不是錯誤。回 4xx 的話瀏覽器會在 console 印紅字，害「console 零錯誤」這條驗收失去意義。
    const row = await env.DB.prepare('SELECT blob, rev, updated_at FROM accounts WHERE id = ?')
      .bind(acc.id).first();
    return json({
      conflict: true,
      rev: row?.rev ?? 0,
      updatedAt: row?.updated_at ?? 0,
      blob: row?.blob ? JSON.parse(row.blob) : null,
    });
  }

  return json({ rev: baseRev + 1, updatedAt: now });
}

async function linkCode(req, env) {
  const acc = await sessionAccount(req, env);
  const code = randomCode();
  const expiresAt = Date.now() + CODE_TTL_MS;
  await env.DB.prepare('DELETE FROM link_codes WHERE account_id = ? OR expires_at < ?')
    .bind(acc.id, Date.now()).run();
  await env.DB.prepare('INSERT INTO link_codes (code, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(code, acc.id, expiresAt).run();
  return json({ code: formatCode(code), expiresAt });
}

async function linkClaim(req, env) {
  const body = await readJson(req);
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) throw new HttpError(400, '配對碼格式不對（8 碼）');

  const row = await env.DB.prepare('SELECT account_id, expires_at FROM link_codes WHERE code = ?')
    .bind(code).first();
  if (!row) throw new HttpError(404, '配對碼不存在或已經用過了');
  await env.DB.prepare('DELETE FROM link_codes WHERE code = ?').bind(code).run();
  if (row.expires_at < Date.now()) throw new HttpError(410, '配對碼過期了，請重新產生');

  const acc = await env.DB.prepare('SELECT id, email, rev FROM accounts WHERE id = ?')
    .bind(row.account_id).first();
  if (!acc) throw new HttpError(404, '帳號不存在');

  const token = await newSession(env, acc.id);
  return json({ token, accountId: acc.id, email: acc.email, rev: acc.rev });
}

async function logout(req, env) {
  const token = bearer(req);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true });
}

/** 把雲端那份整個刪掉（各裝置本機的進度不受影響）。 */
async function deleteAccount(req, env) {
  const acc = await sessionAccount(req, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM link_codes WHERE account_id = ?').bind(acc.id),
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(acc.id),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(acc.id),
  ]);
  return json({ ok: true });
}

/* ---------- Google ID token ---------- */

/**
 * 用 Google 的 tokeninfo 端點驗證（不自己驗 RS256 簽章）。
 * 登入很少發生，多一次 HTTPS 往返換掉一整套 JWKS 快取與簽章驗證的程式碼，划算。
 */
async function verifyGoogleToken(credential, clientId) {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!res.ok) throw new HttpError(401, 'Google 憑證驗證失敗');
  const info = await res.json();

  if (info.aud !== clientId) throw new HttpError(401, 'Google 憑證不是發給這個 App 的');
  if (!info.sub) throw new HttpError(401, 'Google 憑證缺 sub');
  if (Number(info.exp) * 1000 < Date.now()) throw new HttpError(401, 'Google 憑證過期');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    throw new HttpError(401, 'Google 憑證的簽發者不對');
  }
  return { sub: String(info.sub), email: info.email || null };
}

/* ---------- session ---------- */

async function newSession(env, accountId) {
  const token = randomId(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .bind(token, accountId, now, now).run();
  return token;
}

function bearer(req) {
  const h = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

async function sessionAccount(req, env, { optional = false } = {}) {
  const token = bearer(req);
  if (!token) {
    if (optional) return null;
    throw new HttpError(401, '需要登入');
  }
  const row = await env.DB.prepare(
    `SELECT a.id AS id, a.rev AS rev, a.email AS email, s.created_at AS created_at
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token = ?`,
  ).bind(token).first();

  if (!row) {
    if (optional) return null;
    throw new HttpError(401, '登入已失效，請重新登入');
  }
  if (Date.now() - row.created_at > SESSION_DAYS * 86400000) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    if (optional) return null;
    throw new HttpError(401, '登入過期，請重新登入');
  }
  return row;
}

/* ---------- 小工具 ---------- */

/**
 * app key 不是安全機制（前端一定是明碼），只是擋掉隨機掃網址的機器人，
 * 讓這支個人用的 Worker 不會被亂建帳號灌資料。真正的授權靠 session token。
 */
function requireAppKey(req, env) {
  if (!env.APP_KEY) return;
  if (req.headers.get('X-Fab-App') !== env.APP_KEY) throw new HttpError(403, '來源不明的請求');
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Fab-App',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  // 本機開發：serve.mjs 與 smoke 測試用的埠號不固定，所以 localhost 一律放行
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && (allowed.includes(origin) || isLocal)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function withHeaders(res, extra) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(req) {
  try { return await req.json(); } catch (_) { throw new HttpError(400, '請求內容不是合法的 JSON'); }
}

function randomId(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  return [...buf].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function formatCode(code) {
  return code.slice(0, 4) + '-' + code.slice(4);
}
