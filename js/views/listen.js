// views/listen.js — 聽力：對話播放器 → 盲聽 → 理解題 → 開字幕重聽 → 數字聽寫

import { el, div, card, h2, p, append, speakerButton } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as content from '../content.js';
import * as scoring from '../scoring.js';

const FOCUS_ZH = {
  numbers: '數字',
  workweek: '週次',
  spec: '規格值',
  percentage: '百分比',
};

const STEPS = ['盲聽', '理解題', '重聽', '聽寫'];

let playToken = 0;

export function destroy() {
  playToken++;
  speech.cancel();
}

export async function render(root, ctx) {
  const items = await content.listening();
  if (!items.length) {
    append(root, card(el('h3', { text: '尚未載入聽力內容' }), p('content/listening.json 是空的。', 'small dim')));
    return;
  }

  const id = ctx.params[0];
  if (id) {
    const item = items.find(x => x.id === id);
    if (!item) { append(root, card(p(`找不到對話 ${id}`)), el('a', { class: 'btn block', href: '#/listen' }, '回列表')); return; }
    ctx.setTitle(item.title);
    renderDialogue(root, item, ctx);
  } else {
    renderList(root, items);
  }
}

/* ------------------------------ 列表 ------------------------------ */

function renderList(root, items) {
  const st = store.get();
  const done = items.filter(i => st.listening[i.id]?.quiz != null).length;

  const list = div({ class: 'card menu' });
  for (const it of items) {
    const rec = st.listening[it.id];
    const sub = rec?.quiz != null
      ? `理解 ${Math.round(rec.quiz * 100)}%　聽寫 ${Math.round((rec.dictation ?? 0) * 100)}%`
      : `${it.turns.length} 句對話`;
    list.append(el('a', { href: `#/listen/${it.id}` },
      div({ style: 'flex:1' },
        el('div', { text: it.title }),
        el('div', { class: 'sub', text: sub }),
      ),
      el('span', { class: 'sub', text: rec?.quiz != null ? '✅' : '' }),
    ));
  }

  append(root, p(`${done} / ${items.length} 段完成`, 'small dim'), list);
}

/* ------------------------------ 對話頁 ------------------------------ */

function renderDialogue(root, item, ctx) {
  let step = 0;                        // 0 盲聽 1 理解題 2 重聽 3 聽寫
  let rate = speech.clampRate(store.settings().rate);
  let subtitles = false;
  const quizAnswers = new Map();
  const dictResults = new Array(item.dictation.length).fill(null);

  const stepsEl = div({ class: 'steps' });
  const playerHost = div({});
  const bodyHost = div({});
  append(root, stepsEl, playerHost, bodyHost,
    el('a', { class: 'btn block ghost', href: '#/listen', style: 'margin-top:16px' }, '← 回列表'));

  paint();

  function paint() {
    playToken++;
    speech.cancel();

    stepsEl.replaceChildren(...STEPS.map((s, i) =>
      div({ dataset: { on: i === step ? '1' : '0' } }, `${i + 1}. ${s}`)));

    subtitles = step >= 2;
    playerHost.replaceChildren(player());
    bodyHost.replaceChildren(body());
    window.scrollTo(0, 0);
  }

  /* ---------- 播放器 ---------- */

  function player() {
    const turnsEl = div({});
    item.turns.forEach((t, i) => {
      const play = speakerButton();
      speech.bindPlayButton(play, () => t.text, { lang: t.voice, rate });
      turnsEl.append(div({ class: 'turn', dataset: { i: String(i) } },
        el('div', { class: 'who', text: t.speaker }),
        el('div', { class: 'said' + (subtitles ? '' : ' masked'), text: t.text }),
        play,
      ));
    });

    const playAllBtn = el('button', { class: 'primary', onClick: () => playAll(turnsEl, playAllBtn) }, '▶ 播放整段');
    const subBtn = el('button', {
      class: 'ghost',
      onClick: () => {
        subtitles = !subtitles;
        subBtn.textContent = subtitles ? '隱藏字幕' : '顯示字幕';
        turnsEl.querySelectorAll('.said').forEach(n => n.classList.toggle('masked', !subtitles));
      },
    }, subtitles ? '隱藏字幕' : '顯示字幕');

    return card(
      div({ class: 'row', style: 'margin-bottom:10px' }, playAllBtn, subBtn),
      div({ class: 'rate-group', style: 'margin-bottom:12px' },
        ...[0.8, 1.0, 1.2].map(r => el('button', {
          'aria-pressed': String(Math.abs(r - rate) < 0.01),
          onClick: ev => {
            rate = r;
            ev.currentTarget.parentElement.querySelectorAll('button')
              .forEach(b => b.setAttribute('aria-pressed', String(b === ev.currentTarget)));
          },
        }, `${r.toFixed(1)}×`)),
      ),
      turnsEl,
    );
  }

  async function playAll(turnsEl, btn) {
    const mine = ++playToken;
    speech.unlock();
    btn.textContent = '■ 停止';
    btn.onclick = () => { playToken++; speech.cancel(); resetBtn(); };

    for (let i = 0; i < item.turns.length; i++) {
      if (playToken !== mine) return;
      turnsEl.querySelectorAll('.turn').forEach(n => n.classList.toggle('active', n.dataset.i === String(i)));
      const t = item.turns[i];
      const res = await speech.speak(t.text, { lang: t.voice, rate });
      if (res.cancelled || playToken !== mine) return;
      await pause(220);
    }
    if (playToken !== mine) return;
    turnsEl.querySelectorAll('.turn').forEach(n => n.classList.remove('active'));
    resetBtn();

    function resetBtn() {
      turnsEl.querySelectorAll('.turn').forEach(n => n.classList.remove('active'));
      btn.textContent = '▶ 播放整段';
      btn.onclick = () => playAll(turnsEl, btn);
    }
  }

  /* ---------- 各步驟內容 ---------- */

  function body() {
    if (step === 0) {
      return card(
        el('h3', { text: '第一輪：盲聽' }),
        p('字幕先蓋住。整段聽一次，抓住誰在問什麼、對方承諾了什麼。聽不懂沒關係，等一下會重聽。', 'small dim'),
        el('button', { class: 'block primary', onClick: () => { step = 1; paint(); } }, '聽完了，去答題'),
      );
    }
    if (step === 1) return quiz();
    if (step === 2) {
      return card(
        el('h3', { text: '第三輪：開字幕重聽' }),
        p('字幕已打開。對照文字再聽一次，特別注意剛才聽錯的地方。', 'small dim'),
        el('button', { class: 'block primary', onClick: () => { step = 3; paint(); } }, '去做聽寫題'),
      );
    }
    return dictation();
  }

  function quiz() {
    const host = div({});
    item.questions.forEach((q, qi) => {
      const block = div({ class: 'qz' }, el('div', { class: 'q', text: `${qi + 1}. ${q.q}` }));
      const opts = q.options.map((opt, oi) => el('button', {
        class: 'opt',
        onClick: () => {
          if (quizAnswers.has(qi)) return;
          quizAnswers.set(qi, oi);
          opts.forEach((b, i) => {
            b.disabled = true;
            if (i === q.answer) b.classList.add('correct');
            else if (i === oi) b.classList.add('wrong');
          });
          if (q.explain_zh) block.append(el('div', { class: 'explain', text: q.explain_zh }));
          if (quizAnswers.size === item.questions.length) finishQuiz(host);
        },
      }, `${String.fromCharCode(65 + oi)}. ${opt}`));
      block.append(...opts);
      host.append(block);
    });
    return card(el('h3', { text: '第二輪：理解題' }), host);
  }

  function finishQuiz(host) {
    const correct = item.questions.reduce((n, q, i) => n + (quizAnswers.get(i) === q.answer ? 1 : 0), 0);
    const ratio = correct / item.questions.length;
    store.update(s => {
      const prev = s.listening[item.id] || {};
      s.listening[item.id] = { ...prev, quiz: Math.max(prev.quiz ?? 0, ratio) };
    });
    touchToday();
    host.append(
      p(`答對 ${correct} / ${item.questions.length}`, 'small dim center'),
      el('button', { class: 'block primary', onClick: () => { step = 2; paint(); } }, '開字幕重聽'),
    );
  }

  function dictation() {
    const host = div({});
    item.dictation.forEach((d, di) => {
      const play = speakerButton({ class: 'icon-btn' });
      speech.bindPlayButton(play, () => d.text, { rate });

      const input = el('input', {
        type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: false,
        placeholder: '只要打出聽到的數字即可，例如 92.5% 87.1% WW32',
      });
      const out = div({ class: 'small' });

      const checkBtn = el('button', { onClick: check }, '對答案');

      host.append(div({ class: 'qz' },
        div({ class: 'kv', style: 'border:none;padding:0' },
          el('span', { class: 'q', text: `${di + 1}. 聽寫` }),
          el('span', { class: 'pill focus', text: FOCUS_ZH[d.focus] || d.focus }),
        ),
        div({ class: 'row', style: 'margin-bottom:8px' }, play, checkBtn),
        input,
        out,
      ));

      function check() {
        const res = scoring.checkDictation(d.text, input.value);
        dictResults[di] = res.pass;
        input.disabled = true;
        checkBtn.disabled = true;
        out.replaceChildren(
          el('div', { class: res.pass ? 'w-hit' : 'w-miss', text: res.pass ? '✅ 正確' : '❌ 沒抓到全部數字' }),
          el('div', { class: 'answer', text: `答案：${d.answer_display}` }),
          el('div', { class: 'dim', text: d.text }),
        );
        saveDictation();
      }
    });

    return card(el('h3', { text: '第四輪：數字聽寫' }),
      p('會議裡最不能聽錯的就是數字、週次、規格值。只比對數字，不要求整句。', 'small dim'),
      host);
  }

  function saveDictation() {
    const done = dictResults.filter(r => r !== null);
    if (done.length !== dictResults.length) return;
    const ratio = done.filter(Boolean).length / done.length;
    store.update(s => {
      const prev = s.listening[item.id] || {};
      s.listening[item.id] = { ...prev, dictation: Math.max(prev.dictation ?? 0, ratio) };
    });
    touchToday();
    bodyHost.append(card(
      el('h3', { text: `聽寫 ${done.filter(Boolean).length} / ${done.length} 題正確` }),
      p('這段練完了。回列表挑下一段，或把分數低的段落隔幾天再聽一次。', 'small dim'),
      el('a', { class: 'btn block primary', href: '#/listen' }, '回列表'),
    ));
  }

  function touchToday() {
    import('../srs.js').then(srs => store.touchDay(srs.today(), srs.addDays(srs.today(), -1)));
  }
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms));
}
