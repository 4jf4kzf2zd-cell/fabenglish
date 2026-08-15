// test-sync-e2e.mjs — 兩台裝置的真實同步測試（需要網路，會打到線上的 Worker）
//
// 用法：PUPPETEER_DIR=E:/ClaudeCode/print2ai node scripts/test-sync-e2e.mjs
//
// 每個瀏覽器 context 是獨立的 localStorage = 一台裝置。
// 測完呼叫 DELETE /account 把測試帳號清乾淨，不留垃圾在 D1。
//
// 為什麼要有這支：merge.js 的單元測試只證明「合併函式對」，
// 這支證明「兩台裝置照真的流程走，進度真的會到另一台」——中間還隔著
// CORS、樂觀鎖、debounce 上傳與頁面重載，那些單元測試碰不到。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SYNC_PORT || 8098;
const BASE = `http://localhost:${PORT}`;
const PUSH_WAIT = 4500;   // sync.js 的 PUSH_DELAY 是 3 秒，多等一點給網路

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadPuppeteer() {
  try { return (await import('puppeteer')).default; } catch (_) { /* 往下試外部路徑 */ }
  const dir = process.env.PUPPETEER_DIR;
  if (!dir) { console.error('找不到 puppeteer，請設定 PUPPETEER_DIR。'); process.exit(2); }
  return createRequire(join(dir, 'package.json'))('puppeteer');
}

const puppeteer = await loadPuppeteer();
const server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
await sleep(700);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

/** 開一台「新裝置」。 */
async function device(label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${label} pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  return { page, errors, label };
}

const state = d => d.page.evaluate(() => JSON.parse(localStorage.getItem('fabenglish.v1')));
const auth = d => d.page.evaluate(() => JSON.parse(localStorage.getItem('fabenglish.auth.v1') || 'null'));

/** 練幾個單字 + 一項別的（走 store.js / srs.js 的正規 API，不直接動 localStorage）。 */
const practice = (d, words, extra = null) => d.page.evaluate(async (ws, ex) => {
  const store = await import('./js/store.js');
  const srs = await import('./js/srs.js');
  for (const w of ws) srs.answer(w, true);
  if (ex) store.update(s => { Object.assign(s, JSON.parse(ex)); });
}, words, extra ? JSON.stringify(extra) : null);

const logDaily = (d, day, kind, n) => d.page.evaluate(async (a, b, c) => {
  (await import('./js/store.js')).logDaily(a, b, c);
}, day, kind, n);

const startSync = d => d.page.evaluate(async () => (await import('./js/sync.js')).createAccount());
const linkCode = d => d.page.evaluate(async () => (await (await import('./js/sync.js')).createLinkCode()).code);
const claim = (d, code) => d.page.evaluate(async c => (await import('./js/sync.js')).claimLinkCode(c), code);
const signOut = d => d.page.evaluate(async () => (await import('./js/sync.js')).signOut());
const deleteCloud = d => d.page.evaluate(async () => {
  try { await (await import('./js/sync.js')).deleteCloud(); return 'ok'; } catch (e) { return e.message; }
});

let A, B, C;
let cleaned = false;

try {
  console.log('\n[1] 第一台裝置：先練一點東西，再開同步');
  A = await device('A');
  await practice(A, ['v001', 'v002'], { readings: { r001: { done: true, score: 0.9 } } });
  const created = await startSync(A);
  check('A 建立同步帳號', !!created?.token);
  await sleep(1500);

  const aAuth = await auth(A);
  check('A 的 rev 前進了（本機進度已上傳）', aAuth?.rev >= 1, `rev=${aAuth?.rev}`);
  check('進度 blob 裡沒有 session token', !JSON.stringify(await state(A)).includes(aAuth.token));

  console.log('\n[2] 第二台裝置用配對碼加入（兩邊各有對方沒有的東西）');
  const code = await linkCode(A);
  check('配對碼格式 XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code), code);

  B = await device('B');
  await practice(B, ['v003'], { shadow: { p001: { best: 88 } } });
  await claim(B, code);
  await sleep(1500);

  const b1 = await state(B);
  check('B 拿到 A 練過的單字', !!b1.srs.v001 && !!b1.srs.v002, Object.keys(b1.srs).join(','));
  check('B 拿到 A 的閱讀紀錄', b1.readings?.r001?.done === true);
  check('B 自己的進度沒有被覆蓋', !!b1.srs.v003 && b1.shadow?.p001?.best === 88);

  console.log('\n[3] B 繼續練 → A 重開就看得到（這就是「登入就看到最新進度」）');
  await practice(B, ['v010'], { cloze: { e001: { passed: true } } });
  await sleep(PUSH_WAIT);

  await A.page.reload({ waitUntil: 'networkidle0' });
  await sleep(2000);
  const a2 = await state(A);
  check('A 看得到 B 後來練的單字', !!a2.srs.v010, Object.keys(a2.srs).join(','));
  check('A 看得到 B 的 Email 句型紀錄', a2.cloze?.e001?.passed === true);
  check('A 也吃到 B 的跟讀分數', a2.shadow?.p001?.best === 88);
  check('A 自己的進度還在', !!a2.srs.v001 && a2.readings?.r001?.done === true);

  // 用一個沒人碰過的日期：前面 srs.answer 會自動累加「今天」的 vocab 數，
  // 拿今天來斷言的話量到的是別的東西（第一版就是這樣量出 15，程式其實是對的）。
  console.log('\n[4] 同一天在兩台各做一半 → 取 max 不相加');
  const DAY = '2026-07-01';
  await logDaily(A, DAY, 'vocab', 12);
  await logDaily(B, DAY, 'vocab', 5);
  await sleep(PUSH_WAIT);
  await A.page.reload({ waitUntil: 'networkidle0' });
  await sleep(2500);
  const a3 = await state(A);
  check('同一天同一項取較大值（12 vs 5 → 12，不是 17）',
    a3.daily[DAY]?.vocab === 12, String(a3.daily[DAY]?.vocab));

  // 兩台同時寫 → 一定會撞到樂觀鎖。撞到之後兩邊必須收斂到同一份。
  await B.page.reload({ waitUntil: 'networkidle0' });
  await sleep(2500);
  const b3 = await state(B);
  check('版本衝突後兩台收斂到同一份', b3.daily[DAY]?.vocab === 12, String(b3.daily[DAY]?.vocab));

  console.log('\n[5] 全新裝置加入就拿到全部進度');
  const code2 = await linkCode(A);
  C = await device('C');
  await claim(C, code2);
  await sleep(1500);
  const c1 = await state(C);
  check('全新裝置拿到完整進度', ['v001', 'v002', 'v003', 'v010'].every(k => c1.srs[k]),
    Object.keys(c1.srs).join(','));
  check('schema 是 v4', c1.schemaVersion === 4, `v${c1.schemaVersion}`);

  console.log('\n[6] 中斷同步不會弄丟本機進度');
  await signOut(C);
  await sleep(600);
  check('C 已中斷', (await auth(C)) === null);
  check('C 本機進度原封不動', !!(await state(C)).srs.v001);

  console.log('\n[7] console 零錯誤');
  const errs = [...A.errors, ...B.errors, ...C.errors];
  check('沒有 console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n[8] 清掉測試帳號');
  const del = await deleteCloud(A);
  check('雲端測試資料已刪除', del === 'ok', String(del));
  cleaned = del === 'ok';
} finally {
  if (!cleaned && A) {
    try { await deleteCloud(A); } catch (_) { console.warn('⚠️ 測試帳號可能沒清乾淨，請查 D1 的 accounts 表'); }
  }
  await browser.close();
  server.kill();
}

console.log('\n' + '='.repeat(50));
if (failures.length) {
  console.error(`❌ ${pass} 通過，${failures.length} 失敗：`);
  for (const f of failures) console.error('   - ' + f);
  process.exit(1);
}
console.log(`✅ 兩裝置同步 e2e：${pass} 項全部通過`);
