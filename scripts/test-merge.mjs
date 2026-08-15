// test-merge.mjs — merge.js 合併規則的單元測試（純 node，無依賴）
// 執行：node scripts/test-merge.mjs
//
// 這支測試是雲端同步的安全網：合併寫錯會「靜默吃掉進度」，
// 使用者不會看到錯誤訊息，只會發現昨天練的不見了。每條規則都要有測試。

const merge = await import('../js/merge.js');

let pass = 0;
const fails = [];

function is(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n    預期 ${b}\n    實際 ${a}`);
}
function ok(cond, label) { is(!!cond, true, label); }

/** 最小可用的 state；只填測試要用的欄位。 */
function st(patch = {}) {
  return {
    schemaVersion: 4,
    srs: {}, readings: {}, cloze: {}, shadow: {}, listening: {}, interview: {},
    daily: {}, sprint: null,
    streak: { current: 0, best: 0, lastDay: null },
    settings: { newPerDay: 10, dev: false },
    stamps: { settings: 0, sprint: 0 },
    dev: { dayOffset: 0 },
    ...patch,
  };
}

/* ---------- 單字 SRS ---------- */
{
  const phone = st({ srs: { v001: { box: 3, due: '2026-08-20', last: '2026-08-16', first: '2026-08-01', reps: 5, lapses: 1 } } });
  const cloud = st({ srs: { v001: { box: 1, due: '2026-08-15', last: '2026-08-14', first: '2026-08-01', reps: 3, lapses: 2 } } });

  const m = merge.mergeStates(phone, cloud);
  is(m.srs.v001.box, 3, '[1] SRS 取最後複習日晚的那筆盒號');
  is(m.srs.v001.due, '2026-08-20', '[2] due 跟著勝出的那筆走（不可以拆開合併）');
  is(m.srs.v001.reps, 5, '[3] reps 取 max');
  is(m.srs.v001.lapses, 2, '[4] lapses 取 max（兩邊都算數）');
  is(m.srs.v001.first, '2026-08-01', '[5] first 取比較早的');

  const rev = merge.mergeStates(cloud, phone);
  is(rev.srs.v001, m.srs.v001, '[6] 交換律：誰先上傳結果一樣');

  is(merge.mergeStates(phone, phone).srs.v001, phone.srs.v001, '[7] 冪等：自己合併自己不變');
}
{
  // last 相同（同一天在兩台各複習一次）→ 比 reps
  const a = st({ srs: { v002: { box: 2, due: '2026-08-17', last: '2026-08-15', reps: 2, lapses: 0 } } });
  const b = st({ srs: { v002: { box: 4, due: '2026-08-23', last: '2026-08-15', reps: 4, lapses: 0 } } });
  is(merge.mergeStates(a, b).srs.v002.box, 4, '[8] last 平手時比 reps');
  is(merge.mergeStates(b, a).srs.v002.box, 4, '[9] last 平手比 reps（反向一致）');
}
{
  // 舊資料沒有 last 欄位也不能炸
  const a = st({ srs: { v003: { box: 1, due: '2026-08-15', reps: 1 } } });
  const b = st({ srs: { v003: { box: 2, due: '2026-08-17', reps: 2 } } });
  is(merge.mergeStates(a, b).srs.v003.box, 2, '[10] 沒有 last 的舊紀錄用 reps 判斷');
}
{
  const a = st({ srs: { v004: { box: 1, due: '2026-08-15', last: '2026-08-15', reps: 1 } } });
  const b = st({ srs: { v005: { box: 1, due: '2026-08-15', last: '2026-08-15', reps: 1 } } });
  const m = merge.mergeStates(a, b);
  is(Object.keys(m.srs).sort(), ['v004', 'v005'], '[11] 只有單邊有的字要留下來（聯集）');
}

/* ---------- 其他練習紀錄 ---------- */
{
  const a = st({
    readings: { r001: { done: true, score: 0.6 } },
    cloze: { e001: { passed: false } },
    shadow: { p001: { best: 82 } },
    listening: { l001: { quiz: 0.8, dictation: 0.2 } },
  });
  const b = st({
    readings: { r001: { done: false, score: 0.9 }, r002: { done: true, score: 1 } },
    cloze: { e001: { passed: true } },
    shadow: { p001: { best: 71 } },
    listening: { l001: { quiz: 0.4, dictation: 0.9 } },
  });
  const m = merge.mergeStates(a, b);
  is(m.readings.r001, { done: true, score: 0.9 }, '[12] 閱讀 done 取 OR、score 取 max');
  is(m.readings.r002.done, true, '[13] 只有雲端有的閱讀要帶下來');
  is(m.cloze.e001.passed, true, '[14] cloze passed 取 OR');
  is(m.shadow.p001.best, 82, '[15] 跟讀分數取 max');
  is(m.listening.l001, { quiz: 0.8, dictation: 0.9 }, '[16] 聽力兩個分項各取 max');
}

/* ---------- 面試自評 ---------- */
{
  const a = st({ interview: { i001: { ok: true, tries: 3, day: '2026-08-14' } } });
  const b = st({ interview: { i001: { ok: false, tries: 2, day: '2026-08-15' } } });
  const m = merge.mergeStates(a, b);
  is(m.interview.i001, { ok: false, day: '2026-08-15', tries: 3 },
    '[17] ok 取日期晚的那次感覺，tries 取 max');
  is(merge.mergeStates(b, a).interview.i001, m.interview.i001, '[18] 面試自評交換律');
}

/* ---------- 每日練習量 ---------- */
{
  const a = st({ daily: { '2026-08-15': { vocab: 12, shadow: 3 } } });
  const b = st({ daily: { '2026-08-15': { vocab: 8, listen: 1 }, '2026-08-14': { vocab: 10 } } });
  const m = merge.mergeStates(a, b);
  is(m.daily['2026-08-15'], { vocab: 12, shadow: 3, listen: 1 },
    '[19] 同一天逐項取 max（不相加，否則兩台各做一半會虛胖達標）');
  is(m.daily['2026-08-14'].vocab, 10, '[20] 只有一邊有的日期要保留');
}

/* ---------- streak 重算 ---------- */
{
  const daily = {
    '2026-08-11': { vocab: 5 },
    '2026-08-13': { vocab: 5 },
    '2026-08-14': { vocab: 5 },
    '2026-08-15': { vocab: 5 },
  };
  const k = merge.recomputeStreak(daily, 0);
  is(k, { current: 3, best: 3, lastDay: '2026-08-15' }, '[21] 連續天數從 daily 重算（8-12 缺一天）');
  is(merge.recomputeStreak(daily, 9).best, 9, '[22] best 不會因為 daily 被裁掉而倒退');
  is(merge.recomputeStreak({}, 4), { current: 0, best: 4, lastDay: null }, '[23] 沒有紀錄時 current 歸零');
  is(merge.recomputeStreak({ '2026-08-15': { vocab: 0 } }, 0).current, 0, '[24] 全 0 的日期不算有練');
}
{
  const a = st({ daily: { '2026-08-14': { vocab: 1 } }, streak: { current: 1, best: 7, lastDay: '2026-08-14' } });
  const b = st({ daily: { '2026-08-15': { vocab: 1 } }, streak: { current: 1, best: 2, lastDay: '2026-08-15' } });
  const m = merge.mergeStates(a, b);
  is(m.streak, { current: 2, best: 7, lastDay: '2026-08-15' },
    '[25] 兩台各練一天 → 合併後連續 2 天（不是各自的 1）');
}

/* ---------- 設定 / 衝刺（last-write-wins） ---------- */
{
  const a = st({ settings: { newPerDay: 10, dev: true }, stamps: { settings: 100, sprint: 0 } });
  const b = st({ settings: { newPerDay: 25, dev: false }, stamps: { settings: 200, sprint: 0 } });
  const m = merge.mergeStates(a, b);
  is(m.settings.newPerDay, 25, '[26] 設定取 stamp 較新的那份');
  is(m.settings.dev, true, '[27] 開發者模式留在本機，不跟著同步');
  is(m.stamps.settings, 200, '[28] stamp 取 max');

  const m2 = merge.mergeStates(b, a);
  is(m2.settings.newPerDay, 25, '[29] 設定 last-write-wins 與方向無關');
}
{
  const sp = { start: '2026-08-15', target: '2026-09-25' };
  const a = st({ sprint: null, stamps: { settings: 0, sprint: 0 } });
  const b = st({ sprint: sp, stamps: { settings: 0, sprint: 500 } });
  is(merge.mergeStates(a, b).sprint, sp, '[30] 另一台開的衝刺會同步過來');

  const c = st({ sprint: null, stamps: { settings: 0, sprint: 900 } });
  is(merge.mergeStates(c, b).sprint, null, '[31] 「結束衝刺」也是一次寫入，同步得過去');

  const d = st({ sprint: { start: '2026-08-15', target: '2026-10-02' }, stamps: { settings: 0, sprint: 900 } });
  is(merge.mergeStates(b, d).sprint.target, '2026-10-02', '[32] 面試日改期取比較晚寫入的');
}

/* ---------- 邊界 ---------- */
{
  const a = st({ srs: { v001: { box: 2, due: '2026-08-17', last: '2026-08-15', reps: 1 } } });
  is(merge.mergeStates(a, null), a, '[33] 雲端沒東西（第一次登入）→ 直接用本機');
  is(merge.mergeStates(null, a), a, '[34] 本機空白（換新手機）→ 直接吃雲端');
  is(merge.mergeStates(a, st()).srs.v001, a.srs.v001, '[35] 和空白 state 合併不會弄丟東西');
  is(merge.mergeStates(st(), st()).streak, { current: 0, best: 0, lastDay: null }, '[36] 兩邊都空白不會炸');
}
{
  // 髒資料不能讓整個同步掛掉
  const a = st({ srs: { v001: null }, daily: { '2026-08-15': null }, streak: null });
  const b = st({ srs: { v001: { box: 1, due: '2026-08-15', reps: 1 } } });
  const m = merge.mergeStates(a, b);
  is(m.srs.v001.box, 1, '[37] 單邊是 null 的紀錄照樣合併');
  is(m.streak.current, 0, '[38] streak 是 null 也不會炸');
}
{
  const a = st({ dev: { dayOffset: 7 } });
  const b = st({ dev: { dayOffset: 0 } });
  is(merge.mergeStates(a, b).dev.dayOffset, 7, '[39] 時間旅行位移只留在本機');
}
{
  const a = st({ schemaVersion: 3 });
  const b = st({ schemaVersion: 4 });
  is(merge.mergeStates(a, b).schemaVersion, 4, '[40] schemaVersion 取較新');
}

/* ---------- 收尾 ---------- */

if (fails.length) {
  console.error(`\n❌ merge：${fails.length} 項失敗（通過 ${pass}）\n`);
  for (const f of fails) console.error('  ' + f + '\n');
  process.exit(1);
}
console.log(`✅ merge：${pass} 項全部通過`);
