// store.js — localStorage 讀寫、進度 schema、匯出/匯入
// 全 App 只有這裡碰 localStorage。

const KEY = 'fabenglish.v1';
const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  voice: 'auto',
  rate: 1.0,
  badge: true,              // PWA 圖示上顯示待複習數
  playBeforeShadow: false,  // 跟讀前先播一次範讀（預設關：直接錄音比較快）
  loopRepeat: 2,            // 循環聽：每句重複次數
  loopGap: 1,               // 循環聽：句間停頓秒數
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
    streak: { current: 0, best: 0, lastDay: null },
    settings: { ...DEFAULT_SETTINGS },
    dev: { dayOffset: 0 },   // 時間旅行（僅 dev 模式，見 SPEC §7 M1 驗收）
  };
}

let state = null;
let writable = true;   // localStorage 是否可寫（無痕模式 / 配額用罄會是 false）

/** 缺欄位就補齊，避免舊備份匯入後 undefined。 */
function migrate(raw) {
  const s = blank();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of ['srs', 'readings', 'cloze', 'shadow', 'listening', 'interview']) {
    if (raw[k] && typeof raw[k] === 'object') s[k] = raw[k];
  }
  if (raw.streak) Object.assign(s.streak, raw.streak);
  if (raw.settings) Object.assign(s.settings, raw.settings);
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
    if (!writable) { writable = true; emitStorageProblem(null); }
  } catch (err) {
    console.warn('[store] 寫入失敗', err);
    writable = false;
    emitStorageProblem('儲存進度失敗，請到「進度」頁匯出 JSON 備份。');
  }
}

export function isWritable() { return writable; }

function emitStorageProblem(message) {
  window.dispatchEvent(new CustomEvent('fab:storage', { detail: { message } }));
}

/* ---------- settings ---------- */

export function settings() { return get().settings; }

export function setSetting(key, value) {
  update(s => { s.settings[key] = value; });
}

/* ---------- streak ---------- */

/** 有任何學習動作時呼叫；同一天重複呼叫不會重複累加。 */
export function touchDay(today, yesterday) {
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
