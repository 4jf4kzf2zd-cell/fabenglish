// speech.js — TTS / STT 封裝。
// ⚠ 所有 iOS Safari 的 workaround 都集中在這個檔案（SPEC §5），別散到 view 去。

import * as store from './store.js';

const synth = window.speechSynthesis || null;

export const ttsSupported = !!synth;
export const sttSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

let voices = [];
let unlocked = false;
let currentJob = null;      // {utterances:[], reject, resolve}
let resumeTimer = null;

/* ------------------------------------------------------------------ */
/* voices — SPEC §5-2：getVoices() 可能回空陣列，要等 voiceschanged     */
/* ------------------------------------------------------------------ */

function refreshVoices() {
  if (!synth) return [];
  const list = synth.getVoices() || [];
  if (list.length) voices = list;
  return voices;
}

if (synth) {
  refreshVoices();
  synth.addEventListener?.('voiceschanged', () => {
    refreshVoices();
    window.dispatchEvent(new CustomEvent('fab:voices', { detail: { count: voices.length } }));
  });
}

/** 等 voices 就緒（最多 timeout ms），拿不到就回空陣列繼續跑。 */
export function ready(timeout = 2000) {
  if (!synth) return Promise.resolve([]);
  if (refreshVoices().length) return Promise.resolve(voices);
  return new Promise(resolve => {
    const t = setTimeout(() => { cleanup(); resolve(refreshVoices()); }, timeout);
    const on = () => { clearTimeout(t); cleanup(); resolve(refreshVoices()); };
    function cleanup() { synth.removeEventListener?.('voiceschanged', on); }
    synth.addEventListener?.('voiceschanged', on);
  });
}

/** 裝置上所有英文 voice。 */
export function enVoices() {
  return refreshVoices().filter(v => /^en([-_]|$)/i.test(v.lang));
}

/**
 * 選 voice。優先序：使用者設定 > en-US 本地 voice > 第一個 en-*。
 * @param {string} lang 指定語系（聽力模組兩個 speaker 用得到）
 */
export function pickVoice(lang) {
  const list = enVoices();
  if (!list.length) return null;
  const pref = store.settings().voice;

  if (!lang && pref && pref !== 'auto') {
    const hit = list.find(v => v.voiceURI === pref || v.name === pref);
    if (hit) return hit;
  }
  if (lang) {
    const exact = list.filter(v => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
    if (exact.length) return exact.find(v => v.localService) || exact[0];
  }
  const us = list.filter(v => /^en[-_]US/i.test(v.lang));
  return us.find(v => v.localService) || us[0] || list[0];
}

/* ------------------------------------------------------------------ */
/* 解鎖 — SPEC §5-1：首次 speak() 必須在點擊事件的同步呼叫鏈內          */
/* ------------------------------------------------------------------ */

/** 必須在 click/pointerdown handler 裡「同步」呼叫，不能 await 之後再叫。 */
export function unlock() {
  if (!synth || unlocked) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    unlocked = true;
  } catch (err) {
    console.warn('[speech] unlock 失敗', err);
  }
}

export function isUnlocked() { return unlocked; }

// 保險：使用者在頁面上第一次點任何東西就順手解鎖。
document.addEventListener('pointerdown', unlock, { once: true, capture: true });
document.addEventListener('click', unlock, { once: true, capture: true });

/* ------------------------------------------------------------------ */
/* 說話                                                                */
/* ------------------------------------------------------------------ */

/** SPEC §5-3：長文字會被 iOS 截斷，依句切段。 */
export function chunk(text, max = 150) {
  // 不用 lookbehind：舊版 iOS Safari 不支援，正則一建立就會丟 SyntaxError
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const sentences = (flat.match(/[^.!?]+[.!?]*/g) || [flat])
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (buf) { out.push(buf); buf = ''; }
      // 單句就超長 → 用逗號再切
      let piece = '';
      for (const part of (s.match(/[^,]+,?/g) || [s]).map(x => x.trim())) {
        if ((piece + ' ' + part).trim().length > max && piece) { out.push(piece.trim()); piece = part; }
        else piece = (piece + ' ' + part).trim();
      }
      if (piece) out.push(piece);
    } else if ((buf + ' ' + s).trim().length > max) {
      out.push(buf); buf = s;
    } else {
      buf = (buf + ' ' + s).trim();
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [String(text)];
}

export function cancel() {
  if (!synth) return;
  stopWatchdog();
  if (currentJob) {
    const job = currentJob;
    currentJob = null;
    job.resolve({ cancelled: true });
  }
  try { synth.cancel(); } catch (_) { /* noop */ }
}

export function speaking() {
  return !!synth && (synth.speaking || synth.pending);
}

// Chrome 桌面版會在 ~15 秒後自己暫停，需要定期 resume。
function startWatchdog() {
  stopWatchdog();
  resumeTimer = setInterval(() => {
    if (!synth) return;
    if (synth.speaking && synth.paused) { try { synth.resume(); } catch (_) {} }
    if (!synth.speaking && !synth.pending) stopWatchdog();
  }, 5000);
}
function stopWatchdog() {
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
}

/**
 * 播放一段英文。
 * ⚠ 必須從 click handler 的同步路徑呼叫（iOS 解鎖限制），不要先 await 再叫。
 * @returns {Promise<{cancelled?:boolean, error?:string}>}
 */
export function speak(text, opts = {}) {
  if (!synth) return Promise.resolve({ error: 'unsupported' });

  cancel();  // SPEC §5-4：重播前一定要先 cancel，否則 iOS 會卡住

  const rate = clampRate(opts.rate ?? store.settings().rate ?? 1);
  const voice = opts.voice || pickVoice(opts.lang);
  const parts = chunk(text);

  return new Promise(resolve => {
    const job = { resolve };
    currentJob = job;
    let i = 0;

    const next = () => {
      if (currentJob !== job) return;            // 已被 cancel
      if (i >= parts.length) { currentJob = null; stopWatchdog(); resolve({}); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      else u.lang = opts.lang || 'en-US';
      u.rate = rate;
      u.pitch = 1;
      u.onend = next;
      u.onerror = ev => {
        if (currentJob !== job) return;
        currentJob = null;
        stopWatchdog();
        // iOS 在 cancel 之後會補送一個 'canceled'/'interrupted' error，不算錯
        const err = ev?.error || 'error';
        resolve(/cancel|interrupt/i.test(err) ? { cancelled: true } : { error: err });
      };
      try { synth.speak(u); } catch (err) {
        currentJob = null; stopWatchdog(); resolve({ error: String(err) });
      }
    };

    unlocked = true;   // 走到這裡代表已經 speak 過
    next();
    startWatchdog();
  });
}

/** iOS 上 rate 超出 0.8–1.2 會失真（SPEC §4.5）。 */
export function clampRate(r) {
  const n = Number(r);
  if (!isFinite(n)) return 1;
  return Math.min(1.2, Math.max(0.8, n));
}

/**
 * 綁一顆 🔊 按鈕：處理 disabled/loading 狀態與重複點擊。
 * @param {HTMLElement} btn
 * @param {() => string} getText
 */
export function bindPlayButton(btn, getText, opts = {}) {
  if (!ttsSupported) {
    btn.disabled = true;
    btn.title = '此瀏覽器不支援語音合成';
    return;
  }
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    unlock();                       // 同步解鎖
    if (btn.dataset.busy === '1') { cancel(); setIdle(); return; }
    const text = getText();
    if (!text) return;
    btn.dataset.busy = '1';
    btn.classList.add('busy');
    speak(text, opts).then(setIdle);
  });
  function setIdle() {
    btn.dataset.busy = '0';
    btn.classList.remove('busy');
  }
}

/* ------------------------------------------------------------------ */
/* STT — M2 的跟讀引擎會用；M1 先放偵測用的 helper                      */
/* ------------------------------------------------------------------ */

export function sttUnavailableReason() {
  if (!sttSupported) return '這個瀏覽器不支援語音辨識（iOS 請用 Safari 14.5 以上）。';
  if (!navigator.onLine) return '跟讀功能需要網路連線。';       // SPEC §5-5
  if (location.protocol !== 'https:' && location.hostname !== 'localhost')
    return '語音辨識需要 https 連線。';
  return null;
}
