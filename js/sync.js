// sync.js — 多裝置進度同步（M7，SPEC §4.12）
//
// 設計原則（順序就是優先順序）：
//   1. **localStorage 永遠是唯一真相**。雲端只是備份與傳遞管道。
//      沒網路、沒登入、Google 掛掉 —— App 的行為和 M6 之前一模一樣。
//   2. 合併不覆蓋。上傳前一定先把雲端拉下來合併（js/merge.js），
//      不做「最後寫入的贏」，否則手機練的會被電腦一開就蓋掉。
//   3. 失敗要安靜。同步出錯只更新狀態列，不擋任何練習流程。
//
// 流程：開 App → pull → merge → 有變化才 push；之後每次 store.save()
// 會發 fab:changed，這裡 debounce 幾秒後上傳一次。

import * as store from './store.js';
import { mergeStates } from './merge.js';
import { SYNC_API, APP_KEY, GOOGLE_CLIENT_ID } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const PUSH_DELAY = 3000;        // 練習中連續寫入很多次，等安靜幾秒再上傳
const PULL_MIN_GAP = 60_000;    // 回到前景時最多每分鐘拉一次

/** phase: off（沒連線）/ syncing / ok / error */
let status = { phase: 'off', message: '', at: 0 };
let dirty = false;
let applying = false;           // 正在套用合併結果 → 這次 save 不算「使用者改的」
let pushTimer = null;
let lastPullAt = 0;
let queue = Promise.resolve();  // 同一時間只跑一個同步動作

/* ---------- 對外 ---------- */

export function enabled() { return !!SYNC_API; }
export function googleEnabled() { return !!GOOGLE_CLIENT_ID; }
export function linked() { return !!store.auth(); }
export function account() { return store.auth(); }
export function getStatus() { return { ...status }; }

export function init() {
  if (!enabled()) return;
  window.addEventListener('fab:changed', onChanged);
  window.addEventListener('online', () => { if (linked()) { lastPullAt = 0; syncNow().catch(() => {}); } });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && linked()) maybePull();
  });
  // 關掉分頁 / 切到背景時把還沒送出去的變更補送（keepalive 讓請求活過頁面卸載）
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  if (linked()) syncNow().catch(() => {});
  else setStatus('off', '');
}

/** 立刻拉一次再推一次（帳號頁的「立即同步」按鈕）。 */
export function syncNow() {
  return run(async () => {
    await pull();
    if (dirty) await push();
  });
}

/* ---------- 登入 / 連線 ---------- */

/**
 * 把 Google 登入按鈕掛到 container 上。
 * 一定要用 Google 官方渲染的按鈕——GIS 不接受自己畫一顆按鈕再程式呼叫。
 * @param {(err:Error|null)=>void} done 登入完成或失敗後回呼
 */
export async function mountGoogleButton(container, done) {
  if (!googleEnabled()) throw new Error('Google 登入尚未設定');
  await loadGis();
  const g = window.google?.accounts?.id;
  if (!g) throw new Error('Google 登入元件載入失敗');

  g.initialize({
    client_id: GOOGLE_CLIENT_ID,
    ux_mode: 'popup',
    auto_select: false,
    callback: resp => {
      run(() => signInWithCredential(resp.credential))
        .then(() => done(null))
        .catch(err => done(err));
    },
  });
  g.renderButton(container, {
    theme: 'outline', size: 'large', shape: 'pill',
    text: 'signin_with', locale: 'zh_TW', width: 260,
  });
}

async function signInWithCredential(credential) {
  const existing = store.auth();
  // 帶著現有 session → 後端會把這個帳號綁上 Google，配對碼建立的進度不會消失
  const data = await api('POST', '/auth/google', { body: { credential }, token: existing?.token });
  store.setAuth({ token: data.token, email: data.email, accountId: data.accountId, rev: data.rev || 0 });
  await pull();
  if (dirty) await push();
}

/** 不用 Google 建立同步帳號（配對碼流程的第一台裝置）。 */
export function createAccount() {
  return run(async () => {
    const data = await api('POST', '/account', { body: {}, token: null });
    store.setAuth({ token: data.token, email: null, accountId: data.accountId, rev: data.rev || 0 });
    await pull();
    if (dirty) await push();
    return data;
  });
}

/** 產生配對碼給另一台裝置輸入。 */
export function createLinkCode() {
  return run(() => api('POST', '/link/code', { body: {} }));
}

/** 在第二台裝置輸入配對碼，綁到同一個帳號。 */
export function claimLinkCode(code) {
  return run(async () => {
    const data = await api('POST', '/link/claim', { body: { code }, token: null });
    store.setAuth({ token: data.token, email: data.email, accountId: data.accountId, rev: data.rev || 0 });
    await pull();
    if (dirty) await push();
    return data;
  });
}

/** 登出：只斷開這台裝置，本機進度原封不動留著。 */
export function signOut() {
  return run(async () => {
    try { await api('POST', '/logout', { body: {} }); } catch (_) { /* 撤不掉也要讓使用者登出 */ }
    store.clearAuth();
    dirty = false;
    setStatus('off', '');
  });
}

/** 把雲端那份整個刪掉並登出。各裝置本機的進度都不會動。 */
export function deleteCloud() {
  return run(async () => {
    await api('DELETE', '/account', {});
    store.clearAuth();
    dirty = false;
    setStatus('off', '');
  });
}

/* ---------- 核心：pull / push ---------- */

async function pull() {
  const a = store.auth();
  if (!a) return null;
  setStatus('syncing', '同步中⋯');

  const remote = await api('GET', '/progress');
  // 合併要用完整的本機 state（syncPayload 少了 dev，拿它去合併會把時間旅行位移清掉）
  const merged = mergeStates(store.get(), remote.blob);

  applying = true;
  try { store.replaceAll(merged); } finally { applying = false; }

  lastPullAt = Date.now();
  store.setAuth({ rev: remote.rev, lastSyncAt: Date.now() });

  // 合併後和雲端不一樣（本機有雲端沒有的東西）才需要上傳，否則每次開 App 都空推一次
  if (stable(store.syncPayload()) !== stable(remote.blob)) dirty = true;

  setStatus('ok', '');
  window.dispatchEvent(new CustomEvent('fab:synced'));
  return remote;
}

async function push() {
  const a = store.auth();
  if (!a) return;
  setStatus('syncing', '同步中⋯');

  let res;
  try {
    res = await api('PUT', '/progress', { body: { baseRev: a.rev || 0, blob: store.syncPayload() } });
  } catch (err) {
    // 舊版後端用 409 表示版本衝突，新版改回 200＋conflict:true。兩種都收，
    // 免得瀏覽器快取著舊的 sync.js 時同步整個停擺。
    if (err.status !== 409) throw err;
    res = { conflict: true, ...(err.data || {}) };
  }

  if (res.conflict) {
    // 別台在我們之間上傳過：把雲端現況合併進來再送一次
    //（只重試一次；再撞到就留著 dirty，下一輪排程會再試）
    const merged = mergeStates(store.get(), res.blob);
    applying = true;
    try { store.replaceAll(merged); } finally { applying = false; }
    res = await api('PUT', '/progress', { body: { baseRev: res.rev || 0, blob: store.syncPayload() } });
    window.dispatchEvent(new CustomEvent('fab:synced'));
    if (res.conflict) { setStatus('ok', ''); return; }   // 還是撞到 → 保持 dirty，下次再送
  }

  store.setAuth({ rev: res.rev, lastSyncAt: Date.now() });
  dirty = false;
  setStatus('ok', '');
}

function onChanged() {
  if (applying || !linked()) return;
  dirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { run(() => (dirty ? push() : Promise.resolve())).catch(() => {}); }, PUSH_DELAY);
}

function maybePull() {
  if (Date.now() - lastPullAt < PULL_MIN_GAP) return;
  syncNow().catch(() => {});
}

/** 頁面要走了：用 keepalive 把最後的變更丟出去，不等回應（等不到）。 */
function flush() {
  if (!dirty || !linked() || !navigator.onLine) return;
  const a = store.auth();
  try {
    fetch(SYNC_API + '/progress', {
      method: 'PUT',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Fab-App': APP_KEY,
        'Authorization': 'Bearer ' + a.token,
      },
      body: JSON.stringify({ baseRev: a.rev || 0, blob: store.syncPayload() }),
    }).catch(() => {});
  } catch (_) { /* 連丟都丟不出去就算了，下次開 App 會合併 */ }
}

/* ---------- 內部工具 ---------- */

function run(fn) {
  queue = queue.then(fn, fn).catch(err => {
    handleError(err);
    throw err;
  });
  return queue;
}

function handleError(err) {
  if (err?.status === 401) {
    store.clearAuth();
    setStatus('error', '登入已失效，請重新登入（本機進度沒有動）');
    return;
  }
  if (!navigator.onLine) { setStatus('error', '離線中，等連上網路會自動同步'); return; }
  setStatus('error', err?.message || '同步失敗');
  console.warn('[sync]', err);
}

function setStatus(phase, message) {
  status = { phase, message, at: Date.now() };
  window.dispatchEvent(new CustomEvent('fab:sync', { detail: getStatus() }));
}

async function api(method, path, { body, token = undefined } = {}) {
  const a = store.auth();
  const headers = { 'X-Fab-App': APP_KEY };
  const tk = token === undefined ? a?.token : token;
  if (tk) headers.Authorization = 'Bearer ' + tk;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(SYNC_API + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_) {
    const err = new Error('連不上同步伺服器');
    err.status = 0;
    throw err;
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* 空回應 */ }
  if (!res.ok) {
    const err = new Error(data?.error || `伺服器回應 ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** key 排序後序列化：兩份內容相同但 key 順序不同的物件要判定為相等。 */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('載入 Google 登入元件失敗（離線？）')); };
    document.head.append(s);
  });
  return gisPromise;
}
