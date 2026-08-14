// srs.js — Leitner 5 盒
// box1=每天 box2=2天 box3=4天 box4=8天 box5=16天；答對升一盒，答錯回 box1。

import * as store from './store.js';

/** 盒號 → 間隔天數（索引即盒號，[0] 不用）。 */
export const BOX_DAYS = [0, 1, 2, 4, 8, 16];
export const MAX_BOX = 5;

/* ---------- 日期 ---------- */

export function ymd(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(ymdStr, n) {
  const d = parseYmd(ymdStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 今天（含 dev 時間旅行位移）。全 App 一律用這個，不要直接 new Date()。 */
export function today() {
  const off = store.get().dev?.dayOffset || 0;
  const d = new Date();
  d.setDate(d.getDate() + off);
  return ymd(d);
}

export function yesterday() {
  return addDays(today(), -1);
}

export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

/* ---------- 佇列 ---------- */

/**
 * 每日佇列 = 到期複習字 + 新字（複習優先）。
 * @param {Array} items vocab.json 的 items
 * @returns {{due:Array, fresh:Array, queue:Array, newLeft:number}}
 */
export function buildQueue(items) {
  const s = store.get();
  const t = today();
  const perDay = Number(s.settings.newPerDay) || 10;

  const due = [];
  const unseen = [];
  let introducedToday = 0;

  for (const it of items) {
    const rec = s.srs[it.id];
    if (!rec) { unseen.push(it); continue; }
    if (rec.first === t) introducedToday++;
    if (rec.due <= t) due.push(it);
  }

  due.sort((a, b) => (s.srs[a.id].due < s.srs[b.id].due ? -1 : 1));

  const newLeft = Math.max(0, perDay - introducedToday);
  const fresh = unseen.slice(0, newLeft);

  return { due, fresh, queue: [...due, ...fresh], newLeft };
}

/** 今日還剩多少（給首頁顯示，不會改狀態）。 */
export function todayCounts(items) {
  const { due, fresh } = buildQueue(items);
  return { due: due.length, fresh: fresh.length, total: due.length + fresh.length };
}

/* ---------- 作答 ---------- */

/**
 * @param {string} id 單字 id
 * @param {boolean} correct 使用者自評「認得」= true
 * @returns {object} 更新後的 srs 記錄
 */
export function answer(id, correct) {
  const t = today();
  store.update(s => {
    const prev = s.srs[id];
    const rec = prev
      ? { ...prev }
      : { box: 1, due: t, lapses: 0, first: t, reps: 0 };

    rec.reps = (rec.reps || 0) + 1;

    if (correct) {
      rec.box = Math.min(MAX_BOX, (rec.box || 1) + 1);
    } else {
      if ((rec.box || 1) > 1) rec.lapses = (rec.lapses || 0) + 1;
      rec.box = 1;
    }
    rec.due = addDays(t, BOX_DAYS[rec.box]);
    rec.last = t;
    s.srs[id] = rec;
  });
  store.touchDay(t, addDays(t, -1), 'vocab');
  return store.get().srs[id];
}

/** 各盒字數（給進度頁長條圖）。 */
export function boxHistogram() {
  const s = store.get();
  const bins = [0, 0, 0, 0, 0];
  for (const rec of Object.values(s.srs)) {
    const b = Math.min(MAX_BOX, Math.max(1, rec.box || 1));
    bins[b - 1]++;
  }
  return bins;
}

/** lapses 最多的字（M3 弱點清單先備著，進度頁也用得到）。 */
export function weakest(items, n = 10) {
  const s = store.get();
  return items
    .filter(it => (s.srs[it.id]?.lapses || 0) > 0)
    .sort((a, b) => (s.srs[b.id].lapses - s.srs[a.id].lapses))
    .slice(0, n);
}
