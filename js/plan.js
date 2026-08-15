// plan.js — 面試衝刺：42 天課表（M6，SPEC §4.11）
// 有面試日期時取代 daily.js 的星期輪替。純計算，不碰畫面；
// 「今天」一律走 srs.today()，才吃得到 dev 的時間旅行。

import * as store from './store.js';
import * as srs from './srs.js';

/** 衝刺總長度。改這個數字就要同步改 SPEC §4.11 的表格與 WEEKS。 */
export const LENGTH = 42;

/* ------------------------------ 任務簡寫 ------------------------------ */
// spec 可以覆寫 daily.js 的 label / hint / href，其餘沿用 META。

const iv = (n, hint) => ({ kind: 'interview', target: n, hint });
const rd = (n, hint) => ({ kind: 'reading', target: n, hint });
const cz = (n, hint) => ({ kind: 'cloze', target: n, hint });
const sh = (n, hint) => ({ kind: 'shadow', target: n, hint });
const li = (n, hint) => ({ kind: 'listen', target: n, hint });
const lp = (min, hint) => ({ kind: 'loopSec', target: min * 60, hint });

/**
 * 模擬面試。刻意沿用 interview 這個 kind——只換連結與文案，
 * 不新增 kind 也不動 daily 欄位，舊備份才不會壞（SPEC §4.11）。
 */
const mock = () => ({
  kind: 'interview',
  target: 6,
  href: '#/interview/mock',
  label: '模擬面試 6 題',
  hint: '一口氣跑完不要中斷；答不出來也先撐過去，最後再一起看範答。',
});

/** 對話練習（M6）：抽 3 題自我介紹／經歷，每題被追問三層。同樣沿用 interview kind。 */
const talk = hint => ({
  kind: 'interview',
  target: 3,
  href: '#/interview/talk',
  label: '對話練習 3 題',
  hint,
});

/* ------------------------------ 六個階段 ------------------------------ */

/**
 * 每一週的七天骨架。**六週都用同一張**，所以每個主題每週都會輪到——
 * 閱讀、聽力、Email、跟讀、循環聽、面試題、模擬面試，一週各兩格（面試題三格）。
 * 週與週之間變的只有「面試題練哪一類」與強度，不是「這週只做某一件事」。
 *
 * 一週 14 格 ＝ 面試題 3 ＋ 模擬面試 1 ＋ 閱讀 2 ＋ 聽力 2 ＋ Email 2 ＋ 跟讀 2 ＋ 循環聽 2。
 */
const PATTERN = [
  ['interview', 'shadow'],
  ['reading', 'listen'],
  ['interview', 'cloze'],
  ['loopSec', 'reading'],
  ['interview', 'listen'],
  ['mock', 'loopSec'],
  ['cloze', 'shadow'],
];

/**
 * 每週的參數。
 *
 * **前三週的面試格全部是「對話練習」**（`talkWeek: true`）——只練自我介紹、自我經歷、
 * 工作經歷，而且每題都被追問三層。第 4 週起才展開動機、技術、行為、薪資與反問。
 *
 * `ivOpen` 是該週第一個面試日的提示（每週都從自我介紹開始）；
 * `extraMock` 是要把該週第幾格（PATTERN 的索引）的面試題換成模擬面試。
 */
export const WEEKS = [
  {
    week: 1, from: 1, to: 7,
    title: '自我介紹',
    focus: '先把「我是誰」講到不用想。三十秒版與六十秒版都要能單獨活著。',
    milestone: '60 秒與 30 秒兩個版本的自我介紹逐字稿都定稿。',
    talkWeek: true,
    ivOpen: '從自我介紹開始。每題答完會被追問三層，不要停下來查字。',
    ivMain: '自我介紹的各種問法：完整版、三十秒版、同事怎麼形容你。',
    shadowN: 5, loopMin: 5, extraMock: [],
  },
  {
    week: 2, from: 8, to: 14,
    title: '自我經歷',
    focus: '把過去的專案講成故事——有起點、有你做的動作、有可量化的結果。',
    milestone: '3 個經歷故事寫成完整段落，每個都有一個數字。',
    talkWeek: true,
    ivOpen: '先重講一次自我介紹，再進經歷題。',
    ivMain: '經歷題：最自豪的專案、最難的問題、你到底做了哪一部分。',
    shadowN: 6, loopMin: 5, extraMock: [],
  },
  {
    week: 3, from: 15, to: 21,
    title: '工作經歷與時間線',
    focus: '整條職涯講得順：每一段做什麼、為什麼移動、現在為什麼想換。',
    milestone: '三年時間線一口氣講完不打結，換工作理由前後一致。',
    talkWeek: true,
    ivOpen: '自我介紹再滾一次，再進工作經歷與時間線。',
    ivMain: '工作經歷：時間線、換工作理由、典型的一週、學到什麼。',
    shadowN: 6, loopMin: 7, extraMock: [],
  },
  {
    week: 4, from: 22, to: 28,
    title: '動機與職涯',
    focus: '前三週的故事已經在了，這週把它接到「為什麼是這個職位」。',
    milestone: '動機答案定稿，而且和第 3 週講的換工作理由對得起來。',
    ivOpen: '自我介紹重講一次，再做 2 題動機題。',
    ivMain: '動機題：為什麼離開、為什麼是這個職位。',
    shadowN: 8, loopMin: 7, extraMock: [],
  },
  {
    week: 5, from: 29, to: 35,
    title: '技術與行為題',
    focus: '補上前三週沒碰的兩塊。時間被壓縮了，所以只求講得出流程與 STAR 骨架。',
    milestone: '三條技術主線各講 90 秒 ＋ 4 個 STAR 故事成句。',
    ivOpen: '自我介紹重講一次，再做 2 題技術或行為題。',
    ivMain: '技術題講流程不講名詞；行為題一律 STAR。',
    shadowN: 8, loopMin: 7, extraMock: [2],
  },
  {
    week: 6, from: 36, to: 42,
    title: '薪資反問與收斂',
    focus: '補完薪資與反問，其餘只修卡住的題。最後兩天刻意減量。',
    milestone: '薪資一句話版 ＋ 反問清單 5 題；模擬面試 6 題全部「答得出來」。',
    ivOpen: '自我介紹最後一次定稿，之後不要再改。',
    ivMain: '薪資與反問，其餘挑自評卡住過的題重答。',
    shadowN: 6, loopMin: 5, extraMock: [2],
  },
];

/**
 * 最後兩天的減量覆寫（SPEC §4.11）。
 * 面試前一天塞新東西只會提高焦慮，所以骨架在這兩天讓位。
 */
const TAPER = {
  41: () => [iv(2, '自我介紹再講一次就好，不要改稿。'), sh(5)],
  42: () => [iv(2, '面試日。只熱身：自我介紹＋一題反問，講順了就關掉。'), lp(5)],
};

/** 把骨架的一格展開成任務 spec。 */
function slotSpec(slot, w, posInWeek) {
  switch (slot) {
    // 前三週的面試格一律走對話練習（自我介紹／自我經歷／工作經歷，每題追問三層）
    case 'interview': {
      const hint = posInWeek === 0 ? w.ivOpen : w.ivMain;
      return w.talkWeek ? talk(hint) : iv(3, hint);
    }
    case 'mock':      return mock();
    case 'reading':   return rd(1);
    case 'listen':    return li(1);
    case 'cloze':     return cz(2, posInWeek === 6 ? '面試後的感謝信也是這裡練的句型。' : undefined);
    case 'shadow':    return sh(w.shadowN);
    case 'loopSec':   return lp(w.loopMin);
    default:          throw new Error(`未知的課表格：${slot}`);
  }
}

/**
 * 42 天的第二、三項任務（第一項永遠是單字，由 daily.js 補上）。
 * 由骨架 × 每週參數展開，所以「每週都涵蓋全部主題」是結構保證的，不是靠人工排表排出來的。
 */
const DAYS = Array.from({ length: LENGTH }, (_, i) => {
  const dayIndex = i + 1;
  if (TAPER[dayIndex]) return TAPER[dayIndex]();

  const w = WEEKS.find(x => dayIndex >= x.from && dayIndex <= x.to);
  const posInWeek = dayIndex - w.from;
  const slots = PATTERN[posInWeek].map((slot, j) =>
    (j === 0 && w.extraMock.includes(posInWeek)) ? 'mock' : slot);

  return slots.map(slot => slotSpec(slot, w, posInWeek));
});

/* ------------------------------ 語音模擬日 ------------------------------ */
// App 不做自由對話（附錄 B），這些排在 SPEAKING.md，用 Claude 語音跑。
// 只顯示提示，不進今日任務、不打勾、不影響完成度。

const VOICE = {
  7:  { code: 'S6', title: '一般面試官', focus: '自我介紹講完後讓 Claude 一路追問，練被問下去不斷線。' },
  14: { code: 'S6', title: '一般面試官', focus: '這次把重點放在經歷：讓對方挑一個專案往下挖三層。' },
  21: { code: 'S6', title: '一般面試官', focus: '工作經歷時間線：每一段為什麼進、做了什麼、為什麼離開。' },
  28: { code: 'S8', title: '壓力面試', focus: '離職原因與動機的刁鑽問法，被質疑時怎麼接住。' },
  32: { code: 'S7', title: '技術追問', focus: '被連續追問技術細節不崩，聽不懂就請對方換句話說。' },
  35: { code: 'S8', title: '壓力面試', focus: '行為題被打斷、被追問「那是你做的還是團隊做的」。' },
  38: { code: 'S9', title: '全真整場', focus: '45 分鐘完整流程，含反問與薪資，中途不喊停。' },
  40: { code: 'S9', title: '全真整場', focus: '最後一場全真，刻意排在面試前兩天。結束後只修最致命的兩個問題。' },
};

/** 全部語音模擬日（給 #/sprint 列清單）。 */
export function voiceSessions() {
  return Object.keys(VOICE)
    .map(Number)
    .sort((a, b) => a - b)
    .map(day => ({ day, ...VOICE[day] }));
}

/** 某一天的語音場景，沒有就回 null。 */
export function voiceFor(dayIndex) {
  const v = VOICE[dayIndex];
  return v ? { day: dayIndex, ...v } : null;
}

/* ------------------------------ 課表查詢 ------------------------------ */

export function clampDay(dayIndex) {
  return Math.min(LENGTH, Math.max(1, Math.round(dayIndex)));
}

/** 第 N 天的兩項任務（回新物件，呼叫端改了也不會污染課表）。 */
export function specs(dayIndex) {
  return (DAYS[clampDay(dayIndex) - 1] || []).map(s => ({ ...s }));
}

/** 第 N 天屬於哪一週。 */
export function weekOf(dayIndex) {
  const d = clampDay(dayIndex);
  return WEEKS.find(w => d >= w.from && d <= w.to) || WEEKS[WEEKS.length - 1];
}

/* ------------------------------ 目前狀態 ------------------------------ */

/**
 * 目前的衝刺狀態；沒啟動回 null。
 *
 * 第幾天**由終點反推**（SPEC §4.11）：面試日比 42 天近時就從課表中段開始，
 * 因為課表對齊的是「面試前一天要在什麼狀態」，不是「你哪天開始的」。
 *
 * @param {string} [day] 預設 srs.today()
 */
export function status(day = srs.today()) {
  const sp = store.sprint();
  if (!sp) return null;

  const daysLeft = srs.daysBetween(day, sp.target);
  const finished = daysLeft < 0;
  const dayIndex = clampDay(LENGTH - daysLeft);
  const week = weekOf(dayIndex);

  return {
    start: sp.start,
    target: sp.target,
    day,
    daysLeft,          // 0 = 面試就在今天；負數 = 已經過了
    dayIndex,          // 1–42
    finished,
    isTargetDay: daysLeft === 0,
    week,
    voice: finished ? null : voiceFor(dayIndex),
    elapsed: srs.daysBetween(sp.start, day) + 1,   // 實際開始的第幾天（可能與 dayIndex 不同）
  };
}

/** 衝刺是否正在進行（沒啟動或已過面試日都回 false）。 */
export function active(day = srs.today()) {
  const s = status(day);
  return !!s && !s.finished;
}
