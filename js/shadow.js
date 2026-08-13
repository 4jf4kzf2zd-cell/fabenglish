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
    actionsEl.append(el('button', {
      class: 'primary',
      onClick: () => start(true),
    }, lastScore === null ? '🎤 跟讀' : '🎤 再試一次'));
  }

  function bestLine() {
    if (!id) return '播放後跟著唸一次，系統會逐字比對。';
    const best = store.get().shadow[id]?.best;
    return best != null ? `最佳分數 ${best} 分` : '播放後跟著唸一次，系統會逐字比對。';
  }

  function setStatus(txt, cls = 'small dim') {
    statusEl.className = `shadow-status ${cls}`;
    statusEl.textContent = txt;
  }

  /* ---------------- 流程 ---------------- */

  /**
   * SPEC §4.6：播放目標句 → 倒數 → 啟動辨識。
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

    setStatus('▶ 播放中⋯');
    speech.speak(text, { lang }).then(() => {
      if (destroyed) return;
      countdown(2);
    });
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

    const g = scoring.grade(result.score);
    resultEl.replaceChildren(
      div({ class: `shadow-score g-${g}` },
        el('span', { class: 'n', text: String(result.score) }),
        el('span', { class: 'u', text: `分　${result.matched}/${result.total} 字命中` }),
      ),
      result.extra.length
        ? div({ class: 'small dim' }, '多說的字：', el('i', { text: result.extra.join(' ') }))
        : null,
      div({ class: 'small dim', style: 'margin-top:4px' }, '你說的：', el('i', { text: transcript })),
    );
    setStatus(g === 'good' ? '很好，這句過關了。' : g === 'ok' ? '接近了，紅字的部分再唸一次。' : '差距較大，先聽一次再跟。');
    paintActionsAfterResult();
  }

  function paintActionsAfterResult() {
    actionsEl.replaceChildren();
    const playBtn = el('button', { class: 'ghost' }, '🔊 聽一次');
    speech.bindPlayButton(playBtn, () => text, { lang });
    actionsEl.append(
      playBtn,
      el('button', { class: 'primary', onClick: () => start(true) }, '🎤 再試一次'),
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
