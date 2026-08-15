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
  check('首頁顯示今日任務', homeText.includes('今日任務'), homeText.slice(0, 80));
  check('首頁顯示連續天數', /連續 \d+ 天/.test(homeText), homeText.slice(0, 80));
  check('今日任務是三項', (await page.$$eval('#view .task', ns => ns.length)) === 3);
  check('第一項是清單字', /清完今日單字 \d+ 張/.test(homeText), homeText.slice(0, 120));
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
  check('列表顯示 30 篇文章', listCount === 30, `實際 ${listCount}`);

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

  /* --- 6. Email 句型 --- */
  console.log('\n[6] Email 句型');
  await page.goto(`${BASE}/index.html#/email`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pattern');
  const patternCount = await page.$$eval('.pattern', ns => ns.length);
  check('列出 30 組句型', patternCount === 30, `實際 ${patternCount}`);
  check('句型的變數槽有上色', (await page.$$eval('.pattern .slot', ns => ns.length)) > 0);
  check('每組都有「別這樣寫」對照', (await page.$$eval('.dont', ns => ns.length)) === 30);

  await page.goto(`${BASE}/index.html#/email/drill`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.cloze-text input');
  const blanks = await page.$$eval('.cloze-text input', ns => ns.length);
  check('cloze 空格數與答案數一致', blanks === 3, `實際 ${blanks}`);

  await page.evaluate(async () => {
    const c = await import('/js/content.js');
    const item = (await c.emails())[0];
    document.querySelectorAll('.cloze-text input').forEach((input, i) => {
      // 故意用大寫＋前後空白，驗證比對有忽略大小寫與空白
      input.value = `  ${item.cloze.answers[i].toUpperCase()} `;
    });
  });
  await clickByText(page, 'button', '對答案');
  await sleep(200);
  const drillText = await page.$eval('#view', n => n.innerText);
  check('填空正確（忽略大小寫與前後空白）', drillText.includes('✅ 正確'), drillText.slice(0, 80).replace(/\n/g, ' '));
  const stateE = await readState(page);
  check('cloze 通過紀錄已寫入', stateE.cloze.e001?.passed === true);

  /* --- 7. 簡報句型與跟讀 --- */
  console.log('\n[7] 簡報句型 / 跟讀');
  await page.goto(`${BASE}/index.html#/present`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.menu, .card');
  const presentText = await page.$eval('#view', n => n.innerText);
  check('簡報模式入口存在', presentText.includes('模擬簡報'));
  check('依 section 分組顯示', presentText.includes('圖表描述') && presentText.includes('根本原因'));

  await page.evaluate(() => document.querySelectorAll('button[aria-label="跟讀這句"]')[0].click());
  await page.waitForSelector('.shadow');
  const shadowText = await page.$eval('.shadow', n => n.innerText);
  check('跟讀面板可展開並顯示目標句與按鈕',
    shadowText.includes('聽一次') && shadowText.includes('跟讀'),
    shadowText.slice(0, 80).replace(/\n/g, ' '));

  // M2 驗收：離線時跟讀要顯示「需要網路」提示，而不是壞掉
  await page.setOfflineMode(true);
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-label="跟讀這句"]')[0].click();   // 收起
    document.querySelectorAll('button[aria-label="跟讀這句"]')[1].click();   // 換一句展開
  });
  await page.waitForSelector('.shadow');
  await sleep(150);
  const offlineText = await page.$eval('.shadow', n => n.innerText);
  const offlineBtns = await page.$$eval('.shadow button', ns => ns.map(n => n.textContent.trim()));
  check('離線時顯示「需要網路」提示',
    offlineText.includes('需要網路') && (await page.$('.shadow .warn-text')) !== null,
    offlineText.slice(0, 90).replace(/\n/g, ' '));
  check('離線時不提供錄音按鈕（不會壞掉）',
    !offlineBtns.some(t => t.includes('跟讀')), JSON.stringify(offlineBtns));
  check('離線時仍可播放目標句（TTS 不需網路）', offlineBtns.some(t => t.includes('聽一次')));
  await page.setOfflineMode(false);

  await page.goto(`${BASE}/index.html#/present/deck`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.shadow');
  const deckText = await page.$eval('#view', n => n.innerText);
  check('簡報模式組出 10 句', /第 1 \/ 10 句/.test(deckText), deckText.slice(0, 60).replace(/\n/g, ' '));

  /* --- 8. 聽力 --- */
  console.log('\n[8] 聽力');
  await page.goto(`${BASE}/index.html#/listen`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.menu a');
  check('列出 15 段對話', (await page.$$eval('.menu a', ns => ns.length)) === 15);

  await page.goto(`${BASE}/index.html#/listen/l001`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.turn');
  check('對話有 10 個 turn', (await page.$$eval('.turn', ns => ns.length)) === 10);
  check('第一輪盲聽時字幕被蓋住', (await page.$$eval('.said.masked', ns => ns.length)) === 10);
  check('有三段語速可選', (await page.$$eval('.rate-group button', ns => ns.length)) === 3);

  await clickByText(page, 'button', '聽完了，去答題');
  await page.waitForSelector('.qz');
  await page.evaluate(async () => {
    const c = await import('/js/content.js');
    const item = (await c.listening()).find(i => i.id === 'l001');
    document.querySelectorAll('.qz').forEach((qz, i) => {
      qz.querySelectorAll('.opt')[item.questions[i].answer].click();
    });
  });
  await sleep(250);
  const stateL = await readState(page);
  check('理解題全對記為 1.0', stateL.listening.l001?.quiz === 1, JSON.stringify(stateL.listening.l001));

  await clickByText(page, 'button', '開字幕重聽');
  await sleep(150);
  check('重聽階段字幕打開', (await page.$$eval('.said.masked', ns => ns.length)) === 0);

  await clickByText(page, 'button', '去做聽寫題');
  await page.waitForSelector('.dictation, .qz input');
  const dictInputs = await page.$$eval('#view input[type="text"]', ns => ns.length);
  check('聽寫題有 2 題', dictInputs === 2, `實際 ${dictInputs}`);

  // M2 驗收：自由格式的數字輸入要能判對
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('#view input[type="text"]');
    inputs[0].value = '46 lots -> 12 shipped';
    inputs[1].value = 'WW36';
  });
  await page.evaluate(() => {
    document.querySelectorAll('#view button').forEach(b => { if (b.textContent.trim() === '對答案') b.click(); });
  });
  await sleep(300);
  const dictText = await page.$eval('#view', n => n.innerText);
  check('聽寫自由格式輸入可判對', (dictText.match(/✅ 正確/g) || []).length === 2,
    dictText.slice(0, 120).replace(/\n/g, ' '));
  const stateD = await readState(page);
  check('聽寫分數已寫入', stateD.listening.l001?.dictation === 1, JSON.stringify(stateD.listening.l001));

  /* --- 9. streak 提示與弱點清單（M3） --- */
  console.log('\n[9] streak 提示 / 弱點清單');

  // 造一個真正的 lapse（新字答錯不算 lapse，要先升到 Box 2 再答錯）與一個低分跟讀
  await page.evaluate(async () => {
    const [srs, content, store] = await Promise.all([
      import('/js/srs.js'), import('/js/content.js'), import('/js/store.js'),
    ]);
    const items = await content.vocab();
    srs.answer(items[5].id, true);
    srs.answer(items[5].id, false);
    store.update(s => {
      s.shadow.p008 = { best: 42 };
      s.interview.i001 = { ok: false, tries: 1 };   // 面試自評卡住（M4）
    });
  });

  const report = await page.evaluate(async () => {
    const [w, c] = await Promise.all([import('/js/weakness.js'), import('/js/content.js')]);
    const [vocab, readings, emails, presentation, listening, interview] = await Promise.all([
      c.vocab(), c.readings(), c.emails(), c.presentation(), c.listening(), c.interview(),
    ]);
    const r = w.buildReport({ vocab, readings, emails, presentation, listening, interview });
    return { md: r.markdown, counts: r.counts, empty: r.empty, name: w.filename() };
  });
  check('弱點清單有抓到答錯的單字', report.counts.vocab === 1, JSON.stringify(report.counts));
  check('弱點清單有抓到要再練的句子', report.counts.shadow === 1);
  check('弱點清單有抓到面試卡住的題目', report.counts.interview === 1);
  check('弱點清單含面試段落', report.md.includes('面試答不出來的題目'));
  check('弱點清單不出現跟讀分數', !/\d+ 分/.test(report.md), (report.md.match(/.{0,20}\d+ 分.{0,10}/) || [''])[0]);
  check('弱點清單是 markdown 格式', report.md.startsWith('# FabEnglish 弱點清單'));
  check('弱點清單含單字表格', report.md.includes('| 單字 | 中譯 | 答錯次數 |'));
  check('弱點清單附上給 Claude 的指令', report.md.includes('給 Claude 的指令'));
  check('弱點清單檔名帶日期', /^fabenglish-weakness-\d{8}\.md$/.test(report.name), report.name);

  await page.goto(`${BASE}/index.html#/progress`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.boxes');
  await clickByText(page, 'button', '產生弱點清單');
  await sleep(300);
  const mdShown = await page.$eval('.md-preview', n => n.textContent);
  check('進度頁可產生弱點清單預覽', mdShown.includes('FabEnglish 弱點清單'));
  check('產生後出現下載與複製按鈕',
    (await page.$$eval('#view button', ns => ns.map(n => n.textContent))).some(t => t.includes('下載 .md')));

  // streak 提示：把日期推到明天 → 昨天有練、今天還沒 → 應該出現到期提醒
  await setDayOffset(page, 1);
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  const homeAlert = await page.$eval('#view', n => n.innerText);
  check('連續紀錄快中斷時首頁出現提醒', /連續紀錄今天到期/.test(homeAlert),
    homeAlert.slice(0, 60).replace(/\n/g, ' '));
  await setDayOffset(page, 0);
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  check('今天已經練過就不顯示提醒',
    !/連續紀錄今天到期/.test(await page.$eval('#view', n => n.innerText)));

  /* --- 10. 面試題 / 循環聽 / 跟讀不顯示分數（M4） --- */
  console.log('\n[10] 面試題 / 循環聽 / 跟讀不顯示分數');

  await page.goto(`${BASE}/index.html#/interview`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  const ivText = await page.$eval('#view', n => n.innerText);
  check('面試頁列出七個分類',
    ['自我介紹', '經歷與專案', '技術深挖', '行為問題', '動機與職涯', '薪資與條件', '反問面試官']
      .every(k => ivText.includes(k)));
  check('面試頁列出 40 題', await page.$$eval('#view .card', ns => ns.length) >= 40);

  await clickByText(page, 'button', '看解析與範答');
  await sleep(200);
  const ivDetail = await page.$eval('#view', n => n.innerText);
  check('展開後有「面試官在問什麼」', ivDetail.includes('面試官在問什麼'));
  check('展開後有回答骨架與核心句', ivDetail.includes('回答骨架') && ivDetail.includes('核心句跟讀'));
  await page.screenshot({ path: join(SHOTS, '6-interview.png') });

  await page.goto(`${BASE}/index.html#/interview/mock`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  check('模擬面試從第 1 / 6 題開始', /第 1 \/ 6 題/.test(await page.$eval('#view', n => n.innerText)));
  await clickByText(page, 'button', '🤔 卡住了');
  await sleep(200);
  await clickByText(page, 'button', '下一題 →');
  await sleep(200);
  check('可前進到第 2 題', /第 2 \/ 6 題/.test(await page.$eval('#view', n => n.innerText)));
  await clickByText(page, 'button', '← 上一題');
  await sleep(200);
  check('可回到上一題', /第 1 \/ 6 題/.test(await page.$eval('#view', n => n.innerText)));
  const ivState = await page.evaluate(async () => (await import('/js/store.js')).get().interview);
  check('模擬面試自評寫入進度', Object.values(ivState).some(v => v.ok === false), JSON.stringify(ivState));

  await page.goto(`${BASE}/index.html#/loop`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.loop-stage');
  const loopText = await page.$eval('#view', n => n.innerText);
  check('循環聽有重複次數與停頓設定', loopText.includes('每句重複') && loopText.includes('句間停頓'));
  check('循環聽有五種句源',
    (await page.$$eval('#view select option', ns => ns.length)) === 5);
  const loopFirst = await page.$eval('.loop-en', n => n.textContent);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('⏭'))?.click());
  await sleep(200);
  check('⏭ 會換到下一句', (await page.$eval('.loop-en', n => n.textContent)) !== loopFirst);
  await page.screenshot({ path: join(SHOTS, '7-loop.png') });

  await page.goto(`${BASE}/index.html#/present`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  // 跟讀分數不得出現在任何 UI（.shadow-score 已移除，pill 只寫「練過」）
  const scoreish = await page.$$eval('#view .shadow-score, #view .pill', ns => ns.map(n => n.textContent));
  check('簡報句型列表不出現跟讀分數', !scoreish.some(t => /\d/.test(t)), scoreish.join(','));

  /* --- 11. 其他路由 --- */
  console.log('\n[11] 路由與設定');
  const ROUTES = [
    ['#/home', '今日任務'], ['#/vocab', ''], ['#/reading', '篇完成'],
    ['#/progress', 'Leitner'], ['#/settings', '每日新字上限'],
    ['#/email', '填空練習'], ['#/present', '模擬簡報'], ['#/listen', '段完成'],
    ['#/interview', '模擬面試'], ['#/loop', '每句重複'],
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
  const progText = await page.$eval('#view', n => n.innerText);
  check('進度頁顯示六個模組完成度',
    ['單字 SRS', '閱讀', 'Email 填空', '簡報跟讀', '聽力', '面試題'].every(k => progText.includes(k)));
  await page.screenshot({ path: join(SHOTS, '5-progress.png') });

  /* --- 12. 每日任務 / 儲存 / 背景播放（M5） --- */
  console.log('\n[12] 每日任務（M5）');

  // 先清掉今天的練習紀錄。前面的章節已經練過閱讀與聽力，
  // 星期一換今天的第二項就可能「本來就完成了」，+1 的斷言會變成看日曆過關。
  await page.evaluate(async () => {
    const store = await import('/js/store.js');
    store.update(s => { s.daily = {}; });
  });

  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.task');

  const plan0 = await readPlan(page);
  check('每日任務固定三項', plan0.total === 3, JSON.stringify(plan0.tasks.map(t => t.kind)));
  check('任務種類不重複', new Set(plan0.tasks.map(t => t.kind)).size === 3);
  check('第一項永遠是單字', plan0.tasks[0].kind === 'vocab');
  check('每項都有 href 可以點過去', plan0.tasks.every(t => t.href?.startsWith('#/')));
  check('最近 14 天有 14 格', (await page.$$eval('.streak-strip .cell', ns => ns.length)) === 14);

  // 把第二項灌到達標 → 首頁的完成數要跟著加一
  const target2 = plan0.tasks[1];
  await page.evaluate(async (kind, n) => {
    const [store, srs] = await Promise.all([import('/js/store.js'), import('/js/srs.js')]);
    store.logDaily(srs.today(), kind, n);
  }, target2.kind, target2.target);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.task');

  const plan1 = await readPlan(page);
  check('完成一項後完成數 +1', plan1.doneCount === plan0.doneCount + 1,
    `${plan0.doneCount} → ${plan1.doneCount}`);
  check('完成的那項標成 done',
    (await page.$$eval('.task', ns => ns.map(n => n.dataset.done)))[1] === '1');
  check('未完成的項目顯示 x / y 進度',
    /\d+ \/ \d+|\d+ \/ \d+ 分/.test(await page.$eval('#view', n => n.innerText)));

  // badge 的數字＝還沒完成幾項（不是待複習卡數）
  const remain = await page.evaluate(async () => {
    const [daily, content] = await Promise.all([import('/js/daily.js'), import('/js/content.js')]);
    return daily.remaining(await content.vocab());
  });
  check('badge 用的未完成數與首頁一致', remain === plan1.total - plan1.doneCount,
    `remaining=${remain}`);

  // 每日紀錄有寫進 localStorage，而且匯出備份帶得走
  const raw = await readState(page);
  check('每日紀錄寫進 localStorage', !!raw.daily && Object.keys(raw.daily).length > 0);
  check('schema 已升到 v3', raw.schemaVersion === 3, `v${raw.schemaVersion}`);

  // 循環聽的背景播放開關
  await page.goto(`${BASE}/index.html#/loop`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.loop-stage');
  const loopM5 = await page.$eval('#view', n => n.innerText);
  check('循環聽有「關螢幕繼續播」開關', loopM5.includes('關螢幕繼續播'), loopM5.slice(0, 80));
  await clickByText(page, 'button', '嘗試');
  const bgOff = await page.evaluate(async () => (await import('/js/store.js')).settings().loopBackground);
  check('關掉背景播放會寫進設定', bgOff === false, String(bgOff));
  await clickByText(page, 'button', '不嘗試');
  const bgOn = await page.evaluate(async () => (await import('/js/store.js')).settings().loopBackground);
  check('再打開會寫回設定', bgOn === true, String(bgOn));

  // 設定頁的儲存空間卡片
  await page.goto(`${BASE}/index.html#/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  await sleep(300);
  const setText = await page.$eval('#view', n => n.innerText);
  check('設定頁說明進度存在哪裡', setText.includes('進度存在哪裡') && setText.includes('localStorage'));
  check('設定頁有長期保存按鈕', setText.includes('要求長期保存'));
  check('badge 說明已改成未完成任務數', setText.includes('未完成任務數'), '');
  await page.screenshot({ path: join(SHOTS, '8-settings.png') });

  /* --- 13. 面試衝刺（M6） --- */
  console.log('\n[13] 面試衝刺（M6）');

  await page.goto(`${BASE}/index.html#/sprint`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view .card');
  const idleText = await page.$eval('#view', n => n.innerText);
  check('未啟動時顯示啟動說明', idleText.includes('六週面試衝刺'), idleText.slice(0, 60));
  check('未啟動時有面試日期輸入', (await page.$$('#view input[type="date"]')).length === 1);
  check('未啟動時就看得到六週地圖', (await page.$$eval('.sprint-week', ns => ns.length)) === 6);

  // 用模組 API 啟動，日期才會跟著 dev 時間旅行走（直接點按鈕會吃到系統日期）
  await page.evaluate(async () => {
    const [store, srs] = await Promise.all([import('/js/store.js'), import('/js/srs.js')]);
    store.startSprint(srs.today(), srs.addDays(srs.today(), 41));
  });

  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.task');
  const sprintHome = await readPlan(page);
  check('啟動後首頁帶出衝刺資訊', sprintHome.sprint?.dayIndex === 1, JSON.stringify(sprintHome.sprint || null));
  check('衝刺期間仍然只有三項', sprintHome.total === 3);
  check('第一項仍然是單字', sprintHome.tasks[0].kind === 'vocab');
  check('任務改吃課表（第 1 天＝面試題＋跟讀）',
    sprintHome.tasks.map(t => t.kind).join(',') === 'vocab,interview,shadow',
    JSON.stringify(sprintHome.tasks.map(t => t.kind)));
  check('首頁出現倒數列', (await page.$$('.sprint-bar')).length === 1);
  const homeSprintText = await page.$eval('#view', n => n.innerText);
  check('倒數列顯示剩餘天數', /距離面試 41 天/.test(homeSprintText), homeSprintText.slice(0, 60));
  check('首頁沒有 null/undefined 漏字', !/\b(null|undefined)\b/.test(homeSprintText));

  await page.goto(`${BASE}/index.html#/sprint`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.sprint-week');
  const sprintText = await page.$eval('#view', n => n.innerText);
  check('總覽頁標出今天在哪一週', (await page.$$eval('.sprint-week[data-now="1"]', ns => ns.length)) === 1);
  check('總覽頁列出本週里程碑', sprintText.includes('里程碑'), sprintText.slice(0, 80));
  check('總覽頁列出語音模擬日', sprintText.includes('S6') && sprintText.includes('S9'));
  check('總覽頁顯示每週節奏（各主題同時進行）', sprintText.includes('每週固定節奏'));
  check('節奏卡列出全部主題', (await page.$$eval('.rhythm-chip', ns => ns.length)) === 8,
    await page.$$eval('.rhythm-chip', ns => ns.map(n => n.innerText.replace(/\s+/g, ''))).catch(() => ''));
  check('總覽頁沒有 null/undefined 漏字', !/\b(null|undefined)\b/.test(sprintText));
  await page.screenshot({ path: join(SHOTS, '9-sprint.png') });

  // 第 6 天是模擬面試日：連結要指到 mock，而且用的還是 interview kind
  await page.evaluate(async () => {
    const [store, srs] = await Promise.all([import('/js/store.js'), import('/js/srs.js')]);
    store.startSprint(srs.today(), srs.addDays(srs.today(), 36));   // 倒數 36 天 → 第 6 天
  });
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.task');
  const mockDay = await readPlan(page);
  check('模擬面試日連到 #/interview/mock', mockDay.tasks[1].href === '#/interview/mock',
    `${mockDay.sprint?.dayIndex} / ${mockDay.tasks[1].href}`);
  check('模擬面試沿用 interview kind', mockDay.tasks[1].kind === 'interview');

  // 結束衝刺 → 回到星期輪替
  await page.evaluate(async () => (await import('/js/store.js')).endSprint());
  // 已經在 #/home，goto 同一個網址只會被當成 hash 導覽、不會重繪 → 一定要 reload
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.task');
  const afterSprint = await readPlan(page);
  check('結束後回到星期輪替', afterSprint.sprint === null);
  check('結束後首頁不再有倒數列', (await page.$$('.sprint-bar')).length === 0);

  /* --- 14. console 錯誤 --- */
  console.log('\n[14] Console');
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

/** 取得頁面算出來的今日任務（M5）。 */
function readPlan(page) {
  return page.evaluate(async () => {
    const [daily, content] = await Promise.all([import('/js/daily.js'), import('/js/content.js')]);
    return daily.today(await content.vocab());
  });
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
