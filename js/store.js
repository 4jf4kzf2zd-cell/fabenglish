// store.js — localStorage 讀寫、進度 schema、匯出/匯入
// 全 App 只有這裡碰 localStorage。

const KEY = 'fabenglish.v1';
/** 雲端同步的登入狀態另外存一支 key：匯出備份不該把 session token 一起帶出去。 */
const AUTH_KEY = 'fabenglish.auth.v1';
const SCHEMA_VERSION = 4;

/** 每日紀錄只留這麼多天，避免 localStorage 無限長大。 */
const DAILY_KEEP = 60;

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  voice: 'auto',
  rate: 1.0,
  badge: true,              // PWA 圖示上顯示今日未完成任務數
  playBeforeShadow: false,  // 跟讀前先播一次範讀（預設關：直接錄音比較快）
  loopRepeat: 2,            // 循環聽：每句重複次數
  loopGap: 1,               // 循環聽：句間停頓秒數
  loopBackground: true,     // 循環聽：嘗試在螢幕關閉後繼續播（M5，iOS 不保證成功）
  dev: false,
};

function blank() {
  return {
    schemaVersion: SCHEMA_VERSION,
    srs: {},        // v001: {box:1-5, due:'YYYY-MM-DD', lapses:0, first:'YYYY-MM-DD', reps:0}
    readings: {},   // r001: {done:true, score:0.75}
    cloze: {},      // e001: {passed:true}                （M2）
    shadow: {},     // p001: {best:86}                    （M2）
    listening: {},  // l001: {quiz:0.8, dictation:0.5}    （M2）
    interview: {},  // i001: {ok:true, tries:2}            （M4）
    daily: {},      // 'YYYY-MM-DD': {vocab:12, reading:1, cloze:2, shadow:5, listen:1, interview:2, loopSec:300}（M5）
    sprint: null,   // {start:'YYYY-MM-DD', target:'YYYY-MM-DD'} 面試衝刺（M6）；null = 沒啟動
    streak: { current: 0, best: 0, lastDay: null },
    settings: { ...DEFAULT_SETTINGS },
    // 這兩個欄位沒辦法逐項合併（是單一物件），同步時只能比誰比較晚改 → 記下寫入時間（M7）
    stamps: { settings: 0, sprint: 0 },
    dev: { dayOffset: 0 },   // 時間旅行（僅 dev 模式，見 SPEC §7 M1 驗收）
  };
}

let state = null;
let writable = true;   // localStorage 是否可寫（無痕模式 / 配額用罄會是 false）

/** 缺欄位就補齊，避免舊備份匯入後 undefined。 */
function migrate(raw) {
  const s = blank();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of ['srs', 'readings', 'cloze', 'shadow', 'listening', 'interview', 'daily']) {
    if (raw[k] && typeof raw[k] === 'object') s[k] = raw[k];
  }
  pruneDaily(s);
  s.sprint = normalizeSprint(raw.sprint);   // 舊 schema v2 沒這欄位 → null
  if (raw.streak) Object.assign(s.streak, raw.streak);
  if (raw.settings) Object.assign(s.settings, raw.settings);
  if (raw.stamps) Object.assign(s.stamps, raw.stamps);   // v3 以前沒這欄位 → 留 0（同步時讓給對方）
  if (raw.dev) Object.assign(s.dev, raw.dev);
  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

export function load() {
  if (state) return state;
  let raw = null;
  try {
    const txt = localStorage.getItem(KEY);
    if (txt) raw = JSON.parse(txt);
  } catch (err) {
    console.warn('[store] 讀取失敗', err);
    writable = false;
    emitStorageProblem('無法讀取本機儲存空間（無痕模式？），本次進度不會被保存。');
  }
  state = migrate(raw);
  return state;
}

export function get() {
  return state || load();
}

/** update(s => { s.xxx = 1 }) — 修改後自動寫回。 */
export function update(fn) {
  const s = get();
  fn(s);
  save();
  return s;
}

export function save() {
  const s = get();
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // 同步層靠這個事件知道「有東西變了、該排一次上傳」（sync.js 會 debounce）
    window.dispatchEvent(new CustomEvent('fab:changed'));
    if (!writable) { writable = true; emitStorageProblem(null); }
  } catch (err) {
    console.warn('[store] 寫入失敗', err);
    writable = false;
    emitStorageProblem('儲存進度失敗，請到「進度」頁匯出 JSON 備份。');
  }
}

export function isWritable() { return writable; }

/* ---------- 儲存空間持久化（M5） ---------- */
// iOS 會回收「7 天沒開過」的網站儲存空間。加到主畫面 + 這支 API 可以降低被清掉的機率，
// 但沒有任何瀏覽器保證不清 —— 匯出備份仍然是唯一可靠的手段。

export function persistSupported() {
  return !!navigator.storage?.persist;
}

/** 目前是否已經是持久化狀態（不支援時回 null）。 */
export async function isPersisted() {
  if (!navigator.storage?.persisted) return null;
  try { return await navigator.storage.persisted(); } catch (_) { return null; }
}

/** 要求持久化。Safari 會依「有沒有加到主畫面」等訊號自行決定，不會跳詢問視窗。 */
export async function requestPersist() {
  if (!navigator.storage?.persist) return null;
  try { return await navigator.storage.persist(); } catch (_) { return false; }
}

/** 目前用掉多少空間（不支援回 null）。 */
export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch (_) { return null; }
}

function emitStorageProblem(message) {
  window.dispatchEvent(new CustomEvent('fab:storage', { detail: { message } }));
}

/* ---------- settings ---------- */

export function settings() { return get().settings; }

export function setSetting(key, value) {
  update(s => {
    s.settings[key] = value;
    s.stamps.settings = Date.now();   // 同步時比這個決定誰的設定算數
  });
}

/* ---------- 每日紀錄（M5 每日任務用） ---------- */

/** 舊日期只留最近 DAILY_KEEP 天。 */
function pruneDaily(s) {
  const days = Object.keys(s.daily || {}).sort();
  if (days.length <= DAILY_KEEP) return;
  for (const d of days.slice(0, days.length - DAILY_KEEP)) delete s.daily[d];
}

/**
 * 累加某天的練習量。kind 是 daily.js 的任務種類（vocab/reading/cloze/shadow/listen/interview/loopSec）。
 * 呼叫端要自己傳「今天」是哪天（走 srs.today()，才吃得到時間旅行）。
 */
export function logDaily(day, kind, n = 1) {
  if (!day || !kind || !(n > 0)) return;
  update(s => {
    const d = s.daily[day] || (s.daily[day] = {});
    d[kind] = (d[kind] || 0) + n;
    pruneDaily(s);
  });
}

/** 某天做了多少（沒紀錄回空物件）。 */
export function dayLog(day) {
  return get().daily[day] || {};
}

/* ---------- 面試衝刺（M6） ---------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 壞掉或缺欄位的 sprint 一律當成沒啟動，不要讓首頁炸掉。 */
function normalizeSprint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { start, target } = raw;
  if (!YMD.test(start || '') || !YMD.test(target || '')) return null;
  if (target < start) return null;
  return { start, target };
}

/** 目前的衝刺設定；沒啟動回 null。日期換算在 plan.js，這裡只負責存取。 */
export function sprint() {
  return get().sprint;
}

/**
 * 啟動衝刺。start / target 都由呼叫端算好（store.js 不 import srs.js，避免循環相依）。
 * @returns {object|null} 寫進去的設定；日期不合法回 null 且不改狀態
 */
export function startSprint(start, target) {
  const sp = normalizeSprint({ start, target });
  if (!sp) return null;
  update(s => { s.sprint = sp; s.stamps.sprint = Date.now(); });
  return sp;
}

/** 只改面試日期（衝刺沒啟動時不做事）。 */
export function setSprintTarget(target) {
  const cur = sprint();
  if (!cur) return null;
  return startSprint(cur.start, target);
}

export function endSprint() {
  // 「關掉衝刺」也是一次寫入，要蓋 stamp，否則同步時會被另一台的舊設定復活
  update(s => { s.sprint = null; s.stamps.sprint = Date.now(); });
}

/* ---------- streak ---------- */

/**
 * 有任何學習動作時呼叫；同一天重複呼叫不會重複累加 streak。
 * @param {string} kind 有給就同時累加當天的每日紀錄（每次呼叫都會加，不受 streak 的早退影響）
 */
export function touchDay(today, yesterday, kind, n = 1) {
  if (kind) logDaily(today, kind, n);
  const st = get().streak;
  if (st.lastDay === today) return st;
  update(s => {
    const k = s.streak;
    k.current = (k.lastDay === yesterday) ? k.current + 1 : 1;
    k.best = Math.max(k.best || 0, k.current);
    k.lastDay = today;
  });
  return get().streak;
}

/* ---------- 雲端同步的登入狀態（M7） ---------- */
// 存在 AUTH_KEY，不在進度 blob 裡：
//   1. 匯出的備份不會夾帶 session token（給別人看也不怕）
//   2. 同步下來的進度不會把「這台裝置登入的是誰」蓋掉

/** @returns {{token:string, email:string|null, accountId:string, rev:number, lastSyncAt:number}|null} */
export function auth() {
  try {
    const txt = localStorage.getItem(AUTH_KEY);
    if (!txt) return null;
    const a = JSON.parse(txt);
    return a && a.token ? a : null;
  } catch (_) { return null; }
}

export function setAuth(patch) {
  const next = { ...(auth() || {}), ...patch };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

export function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
}

/** 要上傳的內容：本機專屬欄位不送上雲（dev 時間旅行是這台裝置的除錯狀態）。 */
export function syncPayload() {
  const { dev, ...rest } = get();
  return rest;
}

/* ---------- 匯出 / 匯入 ---------- */

export function exportBlob() {
  const payload = { ...get(), exportedAt: new Date().toISOString(), app: 'fabenglish' };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function exportFilename() {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  return `fabenglish-backup-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}.json`;
}

/** 解析備份檔文字，成功回傳待匯入的 state（尚未寫入）。 */
export function parseBackup(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('檔案內容不是有效的備份。');
  if (raw.schemaVersion && raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`備份的 schemaVersion (${raw.schemaVersion}) 比這個版本新，請先更新 App。`);
  }
  if (!raw.srs && !raw.readings && !raw.streak) throw new Error('檔案缺少進度欄位，可能不是 FabEnglish 備份。');
  return migrate(raw);
}

/** 覆蓋全部進度。 */
export function replaceAll(newState) {
  state = migrate(newState);
  save();
  return state;
}

export function resetAll() {
  state = blank();
  save();
  return state;
}

/* ---------- 統計小工具 ---------- */

export function counts() {
  const s = get();
  return {
    srs: Object.keys(s.srs).length,
    readings: Object.values(s.readings).filter(r => r && r.done).length,
  };
}
