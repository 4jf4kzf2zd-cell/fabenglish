// shadow.js — 跟讀 UI 元件（單字例句、簡報句型、簡報模式共用）
// 邏輯分工：speech.js 負責 TTS/STT，scoring.js 負責對齊評分，這裡只負責流程與畫面。

import { el, div } from './dom.js';
import * as speech from './speech.js';
import * as scoring from './scoring.js';
import * as store from './store.js';

/**
 * @param {string} text 目標句
 * @param {{id?:string, lang?:string, onScore?:(score:number)=>void, compact?:boolean}} opts
 *        id 有給就會把最佳分數寫進 store.shadow[id]
 * @returns {{el:HTMLElement, destroy:()=>void, start:()=>void}}
 */
export function createShadow(text, opts = {}) {
  const { id, lang = 'en-US', onScore } = opts;

  const root = div({ class: 'shadow' });
  const targetEl = div({ class: 'shadow-target' });
  const statusEl = div({ class: 'shadow-status small dim' });
  const actionsEl = div({ class: 'row' });
  const resultEl = div({ class: 'shadow-result' });
  root.append(targetEl, statusEl, actionsEl, resultEl);

  let session = null;      // 進行中的 STT handle
  let countdownTimer = null;
  let destroyed = false;
  let lastScore = null;

  paintTarget(null);
  paintIdle();

  /* ---------------- 畫面 ---------------- */

  function paintTarget(result) {
    targetEl.replaceChildren();
    if (!result) {
      targetEl.append(el('span', { text }));
      return;
    }
    // 逐字上色：綠＝命中、紅＝漏掉
    for (const w of result.words) {
      targetEl.append(el('span', {
        class: w.empty ? '' : (w.hit ? 'w-hit' : 'w-miss'),
        text: w.display,
      }), ' ');
    }
  }

  function paintIdle() {
    const reason = speech.sttUnavailableReason();
    actionsEl.replaceChildren();

    const playBtn = el('button', { class: 'ghost' }, '🔊 聽一次');
    speech.bindPlayButton(playBtn, () => text, { lang });
    actionsEl.append(playBtn);

    if (reason) {
      // SPEC §M2 驗收：離線時要顯示提示，不是壞掉
      statusEl.className = 'shadow-status small warn-text';
      statusEl.textContent = `🎤 ${reason}`;
      return;
    }

    statusEl.className = 'shadow-status small dim';
    statusEl.textContent = bestLine();
    // 預設直接錄音，不強制先播範讀；要先聽的人自己按「🔊 聽一次」
    actionsEl.append(el('button', {
      class: 'primary',
      onClick: () => start(true),
    }, lastScore === null ? '🎤 直接跟讀' : '🎤 再唸一次'));
  }

  function bestLine() {
    if (id && store.get().shadow[id]?.best != null) return '這句練過了，想再唸就直接按。';
    return '直接按🎤開始唸；想先聽範讀再按「🔊 聽一次」。';
  }

  function setStatus(txt, cls = 'small dim') {
    statusEl.className = `shadow-status ${cls}`;
    statusEl.textContent = txt;
  }

  /* ---------------- 流程 ---------------- */

  /**
   * SPEC §4.6：倒數 → 啟動辨識。
   * 預設**不先播範讀**（設定裡可打開），要聽的人按「🔊 聽一次」。
   * @param {boolean} fromGesture 由使用者點擊觸發（iOS 需要）
   */
  function start(fromGesture) {
    if (destroyed) return;
    cleanup();
    resultEl.replaceChildren();
    paintTarget(null);

    if (fromGesture) speech.unlock();          // 同步解鎖，不能 await 之後才叫

    actionsEl.replaceChildren(
      el('button', { class: 'ghost', onClick: () => { cleanup(); paintIdle(); } }, '取消'),
    );

    if (store.settings().playBeforeShadow) {
      setStatus('▶ 播放中⋯');
      speech.speak(text, { lang }).then(() => {
        if (destroyed) return;
        countdown(2);
      });
    } else {
      countdown(1);
    }
  }

  function countdown(n) {
    if (destroyed) return;
    if (n <= 0) { record(); return; }
    setStatus(`準備跟讀⋯ ${n}`);
    countdownTimer = setTimeout(() => countdown(n - 1), 700);
  }

  function record() {
    setStatus('🎤 請開始說⋯', 'small rec-text');
    actionsEl.replaceChildren(
      el('button', { class: 'primary', onClick: () => session?.stop() }, '說完了'),
    );

    session = speech.listen({
      lang,
      onInterim: t => { if (t) setStatus(`🎤 ${t}`, 'small rec-text'); },
    });

    session.promise.then(res => {
      if (destroyed) return;
      session = null;
      if (res.error) return fail(res);
      if (!res.transcript) return fail({ message: '沒有聽到內容，再試一次。' });
      finish(res.transcript);
    });
  }

  function fail(res) {
    setStatus(`⚠️ ${res.message || '辨識失敗'}`, 'small warn-text');
    actionsEl.replaceChildren(
      el('button', { class: 'primary', onClick: () => record() }, '直接開始錄音'),
      el('button', { class: 'ghost', onClick: () => { cleanup(); paintIdle(); } }, '返回'),
    );
  }

  function finish(transcript) {
    const result = scoring.scoreShadow(text, transcript);
    lastScore = result.score;
    paintTarget(result);

    if (id) {
      store.update(s => {
        const prev = s.shadow[id]?.best ?? 0;
        s.shadow[id] = { best: Math.max(prev, result.score), last: result.score };
      });
    }
    onScore?.(result.score);

    // 不顯示分數：語音辨識（尤其非母語腔調）誤差大，數字會誤導。
    // 只呈現逐字比對與辨識到的內容，讓使用者自己判斷。
    resultEl.replaceChildren(
      div({ class: 'small dim' }, '辨識到：', el('i', { text: transcript })),
      result.extra.length
        ? div({ class: 'small dim' }, '多說的字：', el('i', { text: result.extra.join(' ') }))
        : null,
      div({ class: 'small dim', style: 'margin-top:4px' },
        '綠色＝有對上、紅色＝沒對上。語音辨識常會聽錯，紅字不一定是你唸錯。'),
    );
    setStatus('比對完成');
    paintActionsAfterResult();
  }

  function paintActionsAfterResult() {
    actionsEl.replaceChildren();
    const playBtn = el('button', { class: 'ghost' }, '🔊 聽一次');
    speech.bindPlayButton(playBtn, () => text, { lang });
    actionsEl.append(
      playBtn,
      el('button', { class: 'primary', onClick: () => start(true) }, '🎤 再唸一次'),
    );
  }

  function cleanup() {
    clearTimeout(countdownTimer);
    countdownTimer = null;
    speech.cancel();
    session?.abort();
    session = null;
  }

  return {
    el: root,
    start: () => start(true),
    destroy() { destroyed = true; cleanup(); },
  };
}
