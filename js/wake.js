// wake.js — 循環聽的「螢幕關掉還能繼續播」嘗試（M5）
//
// ⚠ 這是繞路，不是保證。iOS Safari 在頁面被隱藏時會暫停 speechSynthesis，
// 官方沒有給網頁背景朗讀的能力。這裡做兩件事拉高成功率：
//   1. 播一段幾乎無聲的循環音軌 → 讓 iOS 認為這個頁面是「正在播放的音訊 App」，
//      audio session 不會被收掉。
//   2. 掛 MediaSession → 鎖定畫面與控制中心會出現播放控制，使用者不用解鎖就能上/下一句。
// 真的鎖屏還是停的話，唯一的解法是改放預先產生的音檔（見 SPEC §4.5.1 備註）。
//
// 音軌是程式產生的，不是外部檔案 —— 維持「零依賴、零 build step」。

let audio = null;
let wakeLock = null;
let dataUri = null;
let holding = false;

export function supported() {
  return typeof Audio !== 'undefined';
}

export function mediaSessionSupported() {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/** 目前是否正在抓著 audio session。 */
export function isHolding() { return holding; }

/* ------------------------------------------------------------------ */
/* 幾乎無聲的循環音軌                                                   */
/* ------------------------------------------------------------------ */

// 8-bit / 8kHz / 單聲道。振幅只有 1 LSB（約 −48dBFS）——喇叭聽不到，
// 但不是數學上的全零，iOS 比較不會把它當成「沒有在播東西」而收掉 session。
function silentWav(seconds = 2, rate = 8000) {
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);        // PCM chunk 長度
  dv.setUint16(20, 1, true);         // format = PCM
  dv.setUint16(22, 1, true);         // 單聲道
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);      // byte rate
  dv.setUint16(32, 1, true);         // block align
  dv.setUint16(34, 8, true);         // 8 bits
  str(36, 'data');
  dv.setUint32(40, n, true);

  const bytes = new Uint8Array(buf, 44);
  for (let i = 0; i < n; i++) {
    // 200Hz、振幅 1 的正弦；8-bit unsigned 的靜音基準是 128
    bytes[i] = 128 + Math.round(Math.sin((i / rate) * 200 * 2 * Math.PI));
  }

  let bin = '';
  const all = new Uint8Array(buf);
  for (let i = 0; i < all.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function ensureAudio() {
  if (audio) return audio;
  if (!supported()) return null;
  try {
    dataUri = dataUri || silentWav();
    audio = new Audio(dataUri);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 1;              // 音軌本身已經幾乎無聲，不要再降，否則 iOS 可能忽略
    audio.setAttribute('playsinline', '');
  } catch (err) {
    console.warn('[wake] 音軌建立失敗', err);
    audio = null;
  }
  return audio;
}

/* ------------------------------------------------------------------ */
/* 對外                                                                */
/* ------------------------------------------------------------------ */

/**
 * 抓住 audio session＋螢幕。**必須從 click handler 的同步呼叫鏈裡叫**（iOS 限制）。
 * @param {{title?:string, artist?:string}} meta 鎖定畫面顯示的資訊
 * @param {{onPlay?:Function, onPause?:Function, onNext?:Function, onPrev?:Function}} handlers
 */
export function start(meta = {}, handlers = {}) {
  const a = ensureAudio();
  if (a) {
    const p = a.play();
    if (p?.catch) p.catch(err => console.warn('[wake] 無聲音軌播不動', err));
    holding = true;
  }
  setMeta(meta);
  setHandlers(handlers);
  setPlaybackState('playing');
  requestWakeLock();
}

export function stop() {
  holding = false;
  try { audio?.pause(); } catch (_) { /* noop */ }
  setPlaybackState('paused');
  releaseWakeLock();
}

export function setMeta({ title, artist } = {}) {
  if (!mediaSessionSupported() || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'FabEnglish 循環聽',
      artist: artist || 'FabEnglish',
      album: '商用英文練習',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch (_) { /* 不支援就算了 */ }
}

export function setHandlers({ onPlay, onPause, onNext, onPrev } = {}) {
  if (!mediaSessionSupported()) return;
  const set = (name, fn) => {
    try { navigator.mediaSession.setActionHandler(name, fn || null); } catch (_) { /* 舊版沒這個 action */ }
  };
  set('play', onPlay);
  set('pause', onPause);
  set('nexttrack', onNext);
  set('previoustrack', onPrev);
}

export function setPlaybackState(state) {
  if (!mediaSessionSupported()) return;
  try { navigator.mediaSession.playbackState = state; } catch (_) { /* noop */ }
}

/* ---------------- 螢幕保持喚醒（有就用，沒有就算了） ---------------- */

function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch (_) { /* noop */ }
  wakeLock = null;
}

/** 回到前景時 wakeLock 會失效，要重拿。 */
export function reacquireWakeLock() {
  if (holding) requestWakeLock();
}
