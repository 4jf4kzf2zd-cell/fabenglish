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
is(migrated.schemaVersion, 2, '[17] 舊備份會升級到 schema v2');
is(migrated.daily, {}, '[17] 補上空的 daily 欄位');
is(migrated.streak.current, 3, '[17] 舊 streak 保留');
is(migrated.settings.loopBackground, true, '[17] 補上 M5 新增的設定預設值');

/* ---------- 結果 ---------- */

if (fails.length) {
  console.error(`\n❌ ${fails.length} 項失敗：\n`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log(`\n✅ daily.js / store.js 全部 ${pass} 項通過。`);
