// test-daily.mjs — daily.js / store.js 每日任務的單元測試（純 node，無依賴）
// 執行：node scripts/test-daily.mjs
//
// store.js 只在函式裡碰 localStorage / window，所以補兩個假的就能直接 import 瀏覽器的模組。

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };

const store = await import('../js/store.js');
const srs = await import('../js/srs.js');
const daily = await import('../js/daily.js');

let pass = 0;
const fails = [];

function is(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n    預期 ${b}\n    實際 ${a}`);
}
function ok(cond, label) { is(!!cond, true, label); }

function reset() {
  mem.clear();
  store.resetAll();
}

/* ---------- 星期對應的任務組合 ---------- */

const DOW = {
  '2026-08-09': 0,  // 日
  '2026-08-10': 1,  // 一
  '2026-08-11': 2,  // 二
  '2026-08-12': 3,  // 三
  '2026-08-13': 4,  // 四
  '2026-08-14': 5,  // 五
  '2026-08-15': 6,  // 六
};

reset();
for (const [day, dow] of Object.entries(DOW)) {
  is(srs.parseYmd(day).getDay(), dow, `[1] ${day} 的星期應為 ${dow}`);
}

// 每天都是三項，第一項固定是單字
for (const day of Object.keys(DOW)) {
  const plan = daily.today([], day);
  is(plan.total, 3, `[2] ${day} 應該有三項任務`);
  is(plan.tasks[0].kind, 'vocab', `[2] ${day} 第一項應為 vocab`);
}

// 星期二＝閱讀＋跟讀
is(daily.today([], '2026-08-11').tasks.map(t => t.kind), ['vocab', 'reading', 'shadow'], '[3] 週二的任務組合');
// 星期五＝跟讀 8 句＋聽力
is(daily.today([], '2026-08-14').tasks.map(t => t.kind), ['vocab', 'shadow', 'listen'], '[3] 週五的任務組合');
is(daily.today([], '2026-08-14').tasks[1].target, 8, '[3] 週五跟讀目標 8 句');

/* ---------- 完成度計算 ---------- */

reset();
const TUE = '2026-08-11';

// 沒有單字內容 → vocab 目標 0 → 自動視為完成（不能卡住整天的任務）
let plan = daily.today([], TUE);
is(plan.tasks[0].complete, true, '[4] 今天沒有到期單字時，單字任務自動完成');
is(plan.doneCount, 1, '[4] 其餘兩項還沒做');
is(plan.nextHref, '#/reading', '[4] 下一項是閱讀');

store.logDaily(TUE, 'reading', 1);
plan = daily.today([], TUE);
is(plan.tasks[1].complete, true, '[5] 讀完 1 篇 → 閱讀完成');
is(plan.nextHref, '#/present', '[5] 下一項變成跟讀');

store.logDaily(TUE, 'shadow', 3);
plan = daily.today([], TUE);
is(plan.tasks[2].done, 3, '[6] 跟讀進度 3');
is(plan.tasks[2].complete, false, '[6] 目標 5 句還沒到');
is(plan.allDone, false, '[6] 尚未全部完成');

store.logDaily(TUE, 'shadow', 2);
plan = daily.today([], TUE);
is(plan.allDone, true, '[7] 五句到齊 → 今天全部完成');
is(plan.nextHref, null, '[7] 沒有下一項了');
is(daily.remaining([], TUE), 0, '[7] 未完成任務數為 0');

// 超額不會讓 done 超過 target
store.logDaily(TUE, 'shadow', 10);
is(daily.today([], TUE).tasks[2].done, 5, '[8] done 不會超過 target');

/* ---------- 單字目標＝已做＋還到期 ---------- */

reset();
const vocabItems = Array.from({ length: 7 }, (_, i) => ({ id: `v00${i + 1}`, term: `t${i}`, example: 'x' }));
store.setSetting('newPerDay', 4);

const t = srs.today();
plan = daily.today(vocabItems);
is(plan.tasks[0].target, 4, '[9] 一開始的單字目標＝每日新字上限');

srs.answer('v001', true);
plan = daily.today(vocabItems);
is(plan.tasks[0].done, 1, '[10] 答一張 → 進度 1');
is(plan.tasks[0].target, 4, '[10] 目標不會因為卡片被清掉而縮水');

srs.answer('v002', true);
srs.answer('v003', false);
srs.answer('v004', true);
plan = daily.today(vocabItems);
is(plan.tasks[0].done, 4, '[11] 四張都答完');
// v003 答錯回 box1，due 是明天，所以今天不會再出現
is(plan.tasks[0].complete, true, '[11] 單字任務完成');

/* ---------- store：每日紀錄與 streak ---------- */

reset();
store.touchDay('2026-08-11', '2026-08-10', 'reading');
store.touchDay('2026-08-11', '2026-08-10', 'reading');
is(store.dayLog('2026-08-11').reading, 2, '[12] 同一天呼叫兩次會累加兩次');
is(store.get().streak.current, 1, '[12] streak 同一天只加一次');

store.touchDay('2026-08-12', '2026-08-11', 'listen');
is(store.get().streak.current, 2, '[13] 隔天接續 → streak 2');
is(store.dayLog('2026-08-12').listen, 1, '[13] 新的一天分開記');

store.touchDay('2026-08-13', '2026-08-12', null);
is(store.dayLog('2026-08-13'), {}, '[14] kind 傳 null 不會記任何東西');
is(store.get().streak.current, 3, '[14] 但 streak 照樣延續');

// 只保留最近 60 天
reset();
for (let i = 0; i < 70; i++) store.logDaily(srs.addDays('2026-01-01', i), 'vocab', 1);
is(Object.keys(store.get().daily).length, 60, '[15] 每日紀錄只留 60 天');
is(store.dayLog('2026-01-01'), {}, '[15] 最舊的已經被清掉');
is(store.dayLog('2026-03-11').vocab, 1, '[15] 最新的還在');

/* ---------- 匯出／匯入要帶著每日紀錄 ---------- */

reset();
store.logDaily('2026-08-11', 'cloze', 2);
const backup = JSON.parse(JSON.stringify(store.get()));
store.resetAll();
is(store.dayLog('2026-08-11'), {}, '[16] 清除後每日紀錄不見');
store.replaceAll(store.parseBackup(JSON.stringify(backup)));
is(store.dayLog('2026-08-11').cloze, 2, '[16] 匯入備份後每日紀錄回來');

// 舊版（schema v1、沒有 daily 欄位）的備份也要吃得下去
const old = { schemaVersion: 1, srs: { v001: { box: 2, due: '2026-08-20', lapses: 0 } }, streak: { current: 3, best: 5, lastDay: '2026-08-10' } };
const migrated = store.parseBackup(JSON.stringify(old));
is(migrated.schemaVersion, 3, '[17] 舊備份會升級到 schema v3');
is(migrated.daily, {}, '[17] 補上空的 daily 欄位');
is(migrated.streak.current, 3, '[17] 舊 streak 保留');
is(migrated.settings.loopBackground, true, '[17] 補上 M5 新增的設定預設值');
is(migrated.sprint, null, '[17] 舊備份沒有 sprint 欄位 → null，不會壞');

/* ---------- 面試衝刺（M6，SPEC §4.11） ---------- */

const sprintPlan = await import('../js/plan.js');

reset();

// 沒啟動時 plan.js 完全不介入
is(sprintPlan.status('2026-08-15'), null, '[18] 沒啟動衝刺時 status 是 null');
is(sprintPlan.active('2026-08-15'), false, '[18] 沒啟動時 active=false');
is(daily.today([], '2026-08-15').sprint, null, '[18] 每日任務不帶衝刺資訊');
is(daily.today([], '2026-08-15').tasks.map(t => t.kind), ['vocab', 'listen', 'reading'],
  '[18] 沒啟動時仍走星期輪替（2026-08-15 是週六）');

// 啟動：2026-08-15 起算六週 → 面試日 2026-09-25
store.startSprint('2026-08-15', '2026-09-25');
is(store.sprint(), { start: '2026-08-15', target: '2026-09-25' }, '[19] 衝刺設定寫得進去');

is(sprintPlan.status('2026-08-15').dayIndex, 1, '[19] 開始當天是第 1 天');
is(sprintPlan.status('2026-08-15').daysLeft, 41, '[19] 倒數 41 天');
is(sprintPlan.status('2026-09-25').dayIndex, 42, '[19] 面試當天是第 42 天');
is(sprintPlan.status('2026-09-25').isTargetDay, true, '[19] 面試當天 isTargetDay');
is(sprintPlan.status('2026-09-25').finished, false, '[19] 面試當天還沒結束');
is(sprintPlan.status('2026-09-26').finished, true, '[19] 過了面試日就結束');

// 第幾天由終點反推，不是由開始日推
is(sprintPlan.status('2026-09-04').dayIndex, 21, '[20] 中段日期換算正確');
is(sprintPlan.weekOf(21).week, 3, '[20] 第 21 天屬於第 3 週');
is(sprintPlan.weekOf(22).week, 4, '[20] 第 22 天屬於第 4 週');
is(sprintPlan.weekOf(42).week, 6, '[20] 第 42 天屬於第 6 週');

// 面試日提前 → 直接跳到對應天數，不會停在第 1 天
store.setSprintTarget('2026-08-31');
is(sprintPlan.status('2026-08-15').dayIndex, 26, '[21] 面試日提前後課表往後跳');
is(store.sprint().start, '2026-08-15', '[21] 改日期不會動到 start');
store.setSprintTarget('2026-09-25');

/* 衝刺期間的每日任務 */

const d1 = daily.today([], '2026-08-15');
is(d1.total, 3, '[22] 衝刺期間一天仍然只有三項');
is(d1.tasks[0].kind, 'vocab', '[22] 第一項仍然是單字');
is(d1.tasks.map(t => t.kind), ['vocab', 'interview', 'shadow'], '[22] 第 1 天照課表配課');
is(d1.sprint.dayIndex, 1, '[22] 每日任務帶出衝刺天數');

// 模擬面試日（第 6 天 = 2026-08-20）用的還是 interview kind，只換連結與文案
const d6 = daily.today([], '2026-08-20');
is(d6.sprint.dayIndex, 6, '[23] 2026-08-20 是第 6 天');
is(d6.tasks[1].kind, 'interview', '[23] 模擬面試沿用 interview kind');
is(d6.tasks[1].href, '#/interview/mock', '[23] 連結指到模擬面試');
is(d6.tasks[1].target, 6, '[23] 目標 6 題');
is(d6.tasks[1].label, '模擬面試 6 題', '[23] 文案被課表覆寫');

// 課表覆寫不會污染原表（specs 每次回新物件）
const specCopy = sprintPlan.specs(6);
specCopy[0].target = 99;
is(sprintPlan.specs(6)[0].target, 6, '[23] specs 回傳的是複本');

// 42 天每天都有兩項，且 kind 都在 daily.js 認得的範圍內
const KINDS = ['vocab', 'reading', 'cloze', 'shadow', 'listen', 'interview', 'loopSec'];
let shapeOk = true;
for (let i = 1; i <= sprintPlan.LENGTH; i++) {
  const s = sprintPlan.specs(i);
  if (s.length !== 2) shapeOk = false;
  if (!s.every(x => KINDS.includes(x.kind) && x.target > 0)) shapeOk = false;
}
ok(shapeOk, '[24] 42 天每天都是兩項且 kind/target 合法');
is(sprintPlan.specs(0).length, 2, '[24] 天數低於 1 會夾到第 1 天');
is(sprintPlan.specs(99).length, 2, '[24] 天數超過 42 會夾到第 42 天');

// ⭐ 各主題必須同時進行：每一週都要涵蓋全部主題，不能一週只練一種
const THEMES = ['interview', 'reading', 'cloze', 'shadow', 'listen', 'loopSec'];
for (const w of sprintPlan.WEEKS) {
  const week = [];
  for (let d = w.from; d <= w.to; d++) week.push(...sprintPlan.specs(d));
  const kinds = new Set(week.map(s => s.kind));
  const missing = THEMES.filter(t => !kinds.has(t));
  is(missing, [], `[24] 第 ${w.week} 週涵蓋全部主題`);
  is(week.length, 14, `[24] 第 ${w.week} 週共 14 格`);
  ok(week.some(s => s.href === '#/interview/mock'), `[24] 第 ${w.week} 週至少一場模擬面試`);
  // 自我介紹每週都要滾一次：該週第一個面試日的提示要提到它
  ok(/自我介紹/.test(sprintPlan.specs(w.from)[0].hint || ''),
    `[24] 第 ${w.week} 週從自我介紹開始`);

  // 前三週的面試格一律是對話練習，第 4 週起才展開其他類別
  const ivSlots = week.filter(s => s.kind === 'interview' && s.href !== '#/interview/mock');
  const allTalk = ivSlots.every(s => s.href === '#/interview/talk');
  const noneTalk = ivSlots.every(s => s.href !== '#/interview/talk');
  ok(w.talkWeek ? allTalk : noneTalk,
    `[24] 第 ${w.week} 週的面試格${w.talkWeek ? '全部是對話練習' : '不是對話練習'}`);
}
is(sprintPlan.WEEKS.filter(w => w.talkWeek).map(w => w.week), [1, 2, 3],
  '[24] 對話練習週＝前三週');

// 對話練習沿用 interview kind，只換連結與文案（跟模擬面試同一條規則）
const talkDay = daily.today([], '2026-08-15');            // D1
is(talkDay.tasks[1].kind, 'interview', '[24] 對話練習沿用 interview kind');
is(talkDay.tasks[1].href, '#/interview/talk', '[24] 對話練習連到 #/interview/talk');
is(talkDay.tasks[1].target, 3, '[24] 對話練習目標 3 題');
is(talkDay.tasks[1].label, '對話練習 3 題', '[24] 對話練習文案被課表覆寫');

const week4Day = daily.today([], '2026-09-05');           // D22
is(week4Day.sprint.dayIndex, 22, '[24] 2026-09-05 是第 22 天');
is(week4Day.tasks[1].href, '#/interview', '[24] 第 4 週起回到一般面試題');

// 語音模擬日只是提示，不進任務
const voiceDay = daily.today([], '2026-08-21');   // 第 7 天
is(voiceDay.sprint.dayIndex, 7, '[25] 2026-08-21 是第 7 天');
is(voiceDay.sprint.voice.code, 'S6', '[25] 第 7 天排了 S6');
is(voiceDay.total, 3, '[25] 語音日仍然只有三項任務');
ok(!voiceDay.tasks.some(t => t.kind === 'voice'), '[25] 語音場景不會變成任務');
is(sprintPlan.voiceFor(8), null, '[25] 沒排語音的日子回 null');
ok(sprintPlan.voiceSessions().every(v => v.day >= 1 && v.day <= sprintPlan.LENGTH),
  '[25] 語音日都落在 1–42 天內');

// 過了面試日：自動回到星期輪替
const after = daily.today([], '2026-09-26');
is(after.sprint, null, '[26] 過了面試日不再帶衝刺資訊');
is(after.tasks.map(t => t.kind), ['vocab', 'listen', 'reading'], '[26] 回到星期輪替（2026-09-26 是週六）');

// 壞掉的 sprint 資料不能讓首頁炸掉
store.replaceAll({ ...store.get(), sprint: { start: 'x', target: 'y' } });
is(store.sprint(), null, '[27] 壞掉的日期一律當成沒啟動');
is(store.startSprint('2026-09-25', '2026-08-15'), null, '[27] target 早於 start 會被擋下');
store.endSprint();
is(store.sprint(), null, '[27] 結束衝刺後回到 null');

/* ---------- 結果 ---------- */

if (fails.length) {
  console.error(`\n❌ ${fails.length} 項失敗：\n`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log(`\n✅ daily.js / store.js 全部 ${pass} 項通過。`);
