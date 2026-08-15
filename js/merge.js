// merge.js — 兩份進度的逐欄合併（雲端同步用，SPEC §4.12）
//
// 為什麼不用「整包覆蓋」：手機練完 20 個字、電腦一開就把手機的蓋掉。
// 這裡的規則全部是「取比較好的那個」，所以：
//   1. 交換律成立（merge(a,b) 與 merge(b,a) 等價），誰先上傳都不影響結果
//   2. 冪等（merge(a,a) === a），重複同步不會累加
//   3. 進度只會前進、不會倒退
//
// 代價寫在 SPEC §4.12：同一天在兩台裝置各做一半，計數取 max 不相加。
// 要能相加就得把 store 從「狀態快照」改成「事件流」，那是另一個量級的改動。
//
// scoring.js 一樣的規矩：純函式，不准 import 任何瀏覽器 API（要能用 node 直接測）。

/* ---------- 小工具 ---------- */

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const maxYmd = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
const minYmd = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));

/** 兩邊的 key 聯集，逐 key 套 fn。 */
function mergeMap(a, b, fn) {
  const A = obj(a), B = obj(b);
  const out = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const v = fn(A[k], B[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 只有一邊有值時直接回傳，兩邊都有才交給 fn。 */
function both(fn) {
  return (x, y) => {
    if (x == null) return y == null ? undefined : y;
    if (y == null) return x;
    return fn(x, y);
  };
}

/* ---------- 各欄位規則 ---------- */

/**
 * 單字 SRS：盒號與到期日必須整包來自同一筆（拆開合併會算出不存在的排程），
 * 所以先選出「比較新」的那筆，再把單調欄位補上去。
 */
export function pickSrs(x, y) {
  const lx = x.last || '', ly = y.last || '';
  if (lx !== ly) return lx > ly ? x : y;                       // 最後複習日晚的贏
  const rx = num(x.reps), ry = num(y.reps);
  if (rx !== ry) return rx > ry ? x : y;                       // 複習次數多的贏
  if ((x.due || '') !== (y.due || '')) return (x.due || '') > (y.due || '') ? x : y;
  const bx = num(x.box), by = num(y.box);
  if (bx !== by) return bx > by ? x : y;                       // 盒號大的＝走得比較遠
  return x;                                                    // 完全同分：取 a，保持結果穩定
}

const mergeSrsRec = both((x, y) => {
  const win = pickSrs(x, y);
  return {
    box: win.box,
    due: win.due,
    last: maxYmd(x.last, y.last),
    first: minYmd(x.first, y.first),          // 第一次見到這個字：取比較早的
    // reps / lapses 取 max 不相加：兩台裝置的歷史有共同祖先，相加會把同一次複習算兩遍
    reps: Math.max(num(x.reps), num(y.reps)),
    lapses: Math.max(num(x.lapses), num(y.lapses)),
  };
});

const mergeReading = both((x, y) => ({
  ...x, ...y,
  done: !!(x.done || y.done),
  score: Math.max(num(x.score), num(y.score)),
}));

const mergeCloze = both((x, y) => ({ ...x, ...y, passed: !!(x.passed || y.passed) }));

const mergeShadow = both((x, y) => ({ ...x, ...y, best: Math.max(num(x.best), num(y.best)) }));

const mergeListening = both((x, y) => ({
  ...x, ...y,
  quiz: Math.max(num(x.quiz), num(y.quiz)),
  dictation: Math.max(num(x.dictation), num(y.dictation)),
}));

/** 面試自評：ok 是「最近一次的感覺」，取日期晚的那筆；tries 同樣取 max。 */
const mergeInterview = both((x, y) => {
  const win = (x.day || '') >= (y.day || '') ? x : y;
  return {
    ok: win.ok,
    day: maxYmd(x.day, y.day),
    tries: Math.max(num(x.tries), num(y.tries)),
  };
});

/** 每日練習量：逐 kind 取 max（見檔頭說明，不相加）。 */
const mergeDay = both((x, y) => mergeMap(x, y, (p, q) => Math.max(num(p), num(q))));

/**
 * streak 不合併，直接從合併後的 daily 重算——兩邊各自累加的數字沒有意義。
 * best 另外和舊值取 max，因為 daily 只留最近 60 天，更早的紀錄已經被裁掉了。
 */
export function recomputeStreak(daily, prevBest = 0) {
  const days = Object.keys(obj(daily))
    .filter(d => Object.values(obj(daily[d])).some(v => num(v) > 0))
    .sort();
  if (!days.length) return { current: 0, best: prevBest, lastDay: null };

  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = (prev && dayDiff(prev, d) === 1) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current: run, best: Math.max(prevBest, best), lastDay: prev };
}

function dayDiff(a, b) {
  const p = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
  return Math.round((p(b) - p(a)) / 86400000);
}

/* ---------- 主函式 ---------- */

/** 有 stamp 的欄位用 last-write-wins；沒 stamp（舊資料）時 b 讓給 a，避免同步把設定改掉。 */
function stampWins(a, b, key) {
  const sa = num(obj(a.stamps)[key]);
  const sb = num(obj(b.stamps)[key]);
  return sb > sa ? 'b' : 'a';
}

/**
 * 合併兩份進度。輸入輸出都是 store.js 的 state 形狀（已 migrate 過）。
 * 裝置本機專屬的欄位（dev 時間旅行、settings.dev）一律以 a 為準——那是「這台裝置」的狀態。
 *
 * @param {object} a 本機
 * @param {object} b 雲端
 */
export function mergeStates(a, b) {
  if (!b || typeof b !== 'object') return a;
  if (!a || typeof a !== 'object') return b;

  const daily = mergeMap(a.daily, b.daily, mergeDay);
  const settingsFrom = stampWins(a, b, 'settings') === 'b' ? b : a;
  const sprintFrom = stampWins(a, b, 'sprint') === 'b' ? b : a;

  return {
    schemaVersion: Math.max(num(a.schemaVersion), num(b.schemaVersion)),
    srs: mergeMap(a.srs, b.srs, mergeSrsRec),
    readings: mergeMap(a.readings, b.readings, mergeReading),
    cloze: mergeMap(a.cloze, b.cloze, mergeCloze),
    shadow: mergeMap(a.shadow, b.shadow, mergeShadow),
    listening: mergeMap(a.listening, b.listening, mergeListening),
    interview: mergeMap(a.interview, b.interview, mergeInterview),
    daily,
    // 衝刺設定是單一物件，沒得逐欄合併，只能看誰比較晚改（endSprint 也會蓋 stamp，所以「關掉」也同步得過去）
    sprint: sprintFrom.sprint ?? null,
    streak: recomputeStreak(daily, Math.max(num(obj(a.streak).best), num(obj(b.streak).best))),
    // 設定整包 last-write-wins；只有開發者模式留在本機（不要讓筆電的 dev 傳染到手機）
    settings: { ...obj(settingsFrom.settings), dev: !!obj(a.settings).dev },
    stamps: {
      settings: Math.max(num(obj(a.stamps).settings), num(obj(b.stamps).settings)),
      sprint: Math.max(num(obj(a.stamps).sprint), num(obj(b.stamps).sprint)),
    },
    dev: { ...obj(a.dev) },   // 時間旅行是本機除錯用的，不同步
  };
}
