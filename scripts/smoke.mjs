// smoke.mjs — 無頭瀏覽器煙霧測試（選用；需要 puppeteer）
//
// 用法：node scripts/smoke.mjs
// puppeteer 不是本專案的依賴（SPEC 要求零依賴）。若沒有安裝，指定外部路徑：
//   PUPPETEER_DIR=E:/ClaudeCode/print2ai node scripts/smoke.mjs
//
// 涵蓋 SPEC §7 M1 驗收中不需要實機的部分：SRS 排程、隔日複習、匯出/匯入還原、
// 閱讀作答紀錄、路由與 console 零錯誤。TTS 發聲與 PWA 安裝仍必須在 iPhone 實機驗。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SMOKE_PORT || 8099;
const BASE = `http://localhost:${PORT}`;
const SHOTS = join(ROOT, '.smoke');

/* ---------- 載入 puppeteer（本地或外部） ---------- */

async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch (_) { /* 往下試外部路徑 */ }
  const dir = process.env.PUPPETEER_DIR;
  if (!dir) {
    console.error('找不到 puppeteer。請 npm i -D puppeteer，或設定 PUPPETEER_DIR 指向已安裝的專案。');
    process.exit(2);
  }
  const req = createRequire(join(dir, 'package.json'));
  return req('puppeteer');
}

/* ---------- 測試框架（極簡） ---------- */

let pass = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 執行 ---------- */

const puppeteer = await loadPuppeteer();
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await sleep(600);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

try {
  /* --- 1. 首頁 --- */
  console.log('\n[1] 首頁');
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card', { timeout: 5000 });
  const homeText = await page.$eval('#view', n => n.innerText);
  check('首頁顯示連續天數', homeText.includes('天連續練習'));
  check('首頁顯示今日卡片數', /開始今天的 \d+ 張卡/.test(homeText), homeText.slice(0, 80));
  check('dev 模式在 localhost 自動開啟（時間旅行工具可見）', homeText.includes('時間旅行'));
  await page.screenshot({ path: join(SHOTS, '1-home.png') });

  /* --- 2. 單字 SRS --- */
  console.log('\n[2] 單字 SRS');
  await page.goto(`${BASE}/index.html#/vocab`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.flash .term');
  const firstTerm = await page.$eval('.flash .term', n => n.textContent);
  check('卡片正面顯示單字', !!firstTerm);
  await page.screenshot({ path: join(SHOTS, '2-vocab-front.png') });

  // 第一張答「不認得」→ 明天應該再出現
  await clickByText(page, 'button', '不認得');
  await page.waitForSelector('.back');
  const backText = await page.$eval('#view', n => n.innerText);
  check('翻面顯示中譯與例句', backText.includes('中譯') && backText.includes('例句'));
  check('答錯回 Box 1 並提示明天再考', backText.includes('回到 Box 1'));
  await page.screenshot({ path: join(SHOTS, '3-vocab-back.png') });

  // 再答 3 張「認得」
  for (let i = 0; i < 3; i++) {
    await clickByText(page, 'button', '下一張');
    await page.waitForSelector('.flash .term');
    await clickByText(page, 'button', '認得');
    await page.waitForSelector('.back');
  }

  const state = await readState(page);
  const recs = Object.values(state.srs);
  check('SRS 紀錄已寫入 localStorage', recs.length === 4, `實際 ${recs.length} 筆`);
  check('答對的字升到 Box 2', recs.filter(r => r.box === 2).length === 3);
  check('答錯的字留在 Box 1', recs.filter(r => r.box === 1).length === 1);
  check('連續天數已累計', state.streak.current === 1, `current=${state.streak.current}`);

  const wrongRec = recs.find(r => r.box === 1);
  const rightRec = recs.find(r => r.box === 2);
  const today = state.streak.lastDay;
  check('Box 1 的字明天到期', wrongRec.due === addDays(today, 1), `due=${wrongRec.due}`);
  check('Box 2 的字兩天後到期', rightRec.due === addDays(today, 2), `due=${rightRec.due}`);

  /* --- 3. 時間旅行：隔日複習佇列 --- */
  console.log('\n[3] 時間旅行（隔日複習）');
  await setDayOffset(page, 1);
  await page.waitForSelector('.flash .term');
  const dueTomorrow = await countDueInQueue(page);
  check('+1 天後，昨天答錯的字回到複習佇列', dueTomorrow >= 1, `到期 ${dueTomorrow} 字`);

  await setDayOffset(page, 2);
  await page.waitForSelector('.flash .term');
  const dueDay2 = await countDueInQueue(page);
  check('+2 天後，答對的 3 個字也到期', dueDay2 >= 3, `到期 ${dueDay2} 字`);
  await setDayOffset(page, 0);

  /* --- 4. 閱讀 --- */
  console.log('\n[4] 閱讀');
  await page.goto(`${BASE}/index.html#/reading`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.menu a');
  const listCount = await page.$$eval('.menu a', ns => ns.length);
  check('列表顯示 10 篇文章', listCount === 10, `實際 ${listCount}`);

  await page.goto(`${BASE}/index.html#/reading/r001`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.article');
  const glossCount = await page.$$eval('.gloss', ns => ns.length);
  check('glossary 字詞已加上底線按鈕', glossCount >= 4, `實際 ${glossCount} 個`);
  await page.click('.gloss');
  await page.waitForSelector('.gloss-pop', { timeout: 2000 });
  check('點擊 glossary 彈出中譯', true);
  await page.screenshot({ path: join(SHOTS, '4-reading.png') });

  // 每題選第一個選項（在頁面內點，避免持有 handle 被重繪後失效）
  const qCount = await page.$$eval('.qz', ns => ns.length);
  check('r001 有 3 題理解題', qCount === 3, `實際 ${qCount}`);
  for (let i = 0; i < qCount; i++) {
    await page.evaluate(idx => document.querySelectorAll('.qz')[idx].querySelector('.opt').click(), i);
    await sleep(80);
  }
  await sleep(200);
  const answeredText = await page.$eval('#view', n => n.innerText);
  const explains = await page.$$eval('.explain', ns => ns.length);
  check('每題作答後顯示解說', explains === qCount, `${explains}/${qCount}`);
  check('答完顯示得分卡片', /答對 \d+ \/ 3/.test(answeredText), answeredText.slice(0, 60).replace(/\n/g, ' '));
  const state2 = await readState(page);
  check('閱讀完成後寫入 readings 紀錄', state2.readings.r001?.done === true);
  check('閱讀分數已記錄', typeof state2.readings.r001?.score === 'number', JSON.stringify(state2.readings.r001));

  /* --- 5. 匯出 / 清除 / 匯入 --- */
  console.log('\n[5] 匯出 → 清除 → 匯入');
  const backup = await page.evaluate(async () => {
    const store = await import('/js/store.js');
    return await store.exportBlob().text();
  });
  check('匯出的備份是合法 JSON', (() => { try { JSON.parse(backup); return true; } catch { return false; } })());

  await page.evaluate(async () => {
    const store = await import('/js/store.js');
    store.resetAll();
  });
  const cleared = await readState(page);
  check('清除後進度歸零', Object.keys(cleared.srs).length === 0);

  await page.evaluate(async (text) => {
    const store = await import('/js/store.js');
    store.replaceAll(store.parseBackup(text));
  }, backup);
  const restored = await readState(page);
  check('匯入後 SRS 完整還原', Object.keys(restored.srs).length === 4, `${Object.keys(restored.srs).length} 筆`);
  check('匯入後閱讀紀錄完整還原', restored.readings.r001?.done === true);
  check('匯入後連續天數還原', restored.streak.current === 1);

  /* --- 6. 其他路由 --- */
  console.log('\n[6] 路由與設定');
  const ROUTES = [
    ['#/home', '天連續練習'], ['#/vocab', ''], ['#/reading', '篇完成'],
    ['#/progress', 'Leitner'], ['#/settings', '每日新字上限'],
    ['#/email', 'M2'], ['#/present', 'M2'], ['#/listen', 'M2'],
  ];
  for (const [hash, expect] of ROUTES) {
    await page.goto(`${BASE}/index.html${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#view .card', { timeout: 5000 });
    const txt = await page.$eval('#view', n => n.innerText);
    if (expect) check(`${hash} 正常渲染`, txt.includes(expect), txt.slice(0, 60).replace(/\n/g, ' '));
    // 原生 append(null) 會把 null 印成文字，這行專門守這個回歸
    check(`${hash} 沒有 null/undefined 漏字`, !/(^|\s)(null|undefined)(\s|$)/.test(txt),
      (txt.match(/.{0,20}(null|undefined).{0,20}/) || [''])[0]);
  }
  await page.goto(`${BASE}/index.html#/progress`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.boxes');
  await page.screenshot({ path: join(SHOTS, '5-progress.png') });

  /* --- 7. console 錯誤 --- */
  console.log('\n[7] Console');
  const realErrors = consoleErrors.filter(e => !/favicon|speech|not-allowed/i.test(e));
  check('沒有 console 錯誤', realErrors.length === 0, realErrors.join(' | ').slice(0, 300));

} finally {
  await browser.close();
  server.kill();
}

console.log(`\n${'='.repeat(50)}`);
if (failures.length) {
  console.log(`❌ ${pass} 通過，${failures.length} 失敗：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`✅ 全部 ${pass} 項通過。截圖在 .smoke/`);

/* ---------- helpers ---------- */

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle((sel, t) => {
    return [...document.querySelectorAll(sel)].find(n => n.textContent.trim() === t) || null;
  }, selector, text);
  const el = handle.asElement();
  if (!el) throw new Error(`找不到文字為「${text}」的 ${selector}`);
  await el.click();
  await sleep(120);
}

function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fabenglish.v1') || '{}'));
}

/** 透過 store 模組改 dayOffset 再 reload——直接改 localStorage 會被模組的記憶體快取蓋掉。 */
async function setDayOffset(page, n) {
  await page.evaluate(async offset => {
    const store = await import('/js/store.js');
    store.update(s => { s.dev = s.dev || {}; s.dev.dayOffset = offset; });
  }, n);
  await page.reload({ waitUntil: 'networkidle0' });
}

/** 讀取畫面上的「x / y」計數，回推佇列裡有多少張到期卡。 */
async function countDueInQueue(page) {
  return page.evaluate(async () => {
    const [srs, content] = await Promise.all([import('/js/srs.js'), import('/js/content.js')]);
    const items = await content.vocab();
    return srs.todayCounts(items).due;
  });
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const z = v => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
}
