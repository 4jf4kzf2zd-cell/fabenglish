// views/interview.js — 面試常見問題（依 category 分組）＋ 模擬面試模式
// SPEC §4.9。App 不評分自由回答（附錄 B 邊界），模擬面試只播題目、計時、讓使用者自評。

import { el, div, card, h2, p, append, speakerButton } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as content from '../content.js';
import * as srs from '../srs.js';
import { createShadow } from '../shadow.js';

const CATEGORY_ORDER = ['self_intro', 'experience', 'technical', 'behavioral', 'motivation', 'salary_logistics', 'ask_them'];
const CATEGORY_ZH = {
  self_intro: '自我介紹',
  experience: '經歷與專案',
  technical: '技術深挖',
  behavioral: '行為問題',
  motivation: '動機與職涯',
  salary_logistics: '薪資與條件',
  ask_them: '反問面試官',
};

// 模擬面試的抽題配方（SPEC §4.9）
const MOCK_RECIPE = [
  ['self_intro', 1], ['experience', 2], ['technical', 1], ['behavioral', 1], ['motivation', 1],
];

// 對話練習（M6，SPEC §4.9.1）：只抽自我介紹與經歷，每題一路追問下去。
const TALK_RECIPE = [['self_intro', 1], ['experience', 2]];
/** 第一輪 60 秒，之後每一層追問 45 秒。 */
const TALK_SECONDS = [60, 45, 45, 45, 45];

let openShadow = null;
let timer = null;

export function destroy() {
  openShadow?.destroy();
  openShadow = null;
  clearInterval(timer);
  timer = null;
  speech.cancel();
}

export async function render(root, ctx) {
  const items = await content.interview();
  if (!items.length) {
    append(root, card(el('h3', { text: '尚未載入面試題' }), p('content/interview.json 是空的。', 'small dim')));
    return;
  }
  if (ctx.params[0] === 'mock') {
    ctx.setTitle('模擬面試');
    renderMock(root, items, ctx);
    return;
  }
  if (ctx.params[0] === 'talk') {
    ctx.setTitle('對話練習');
    renderTalk(root, items, ctx);
    return;
  }
  renderList(root, items, ctx);
}

/* ----------------------------- 題目列表 ----------------------------- */

function renderList(root, items, ctx) {
  const st = store.get();
  const answered = items.filter(i => st.interview[i.id]).length;
  const stuck = items.filter(i => st.interview[i.id]?.ok === false).length;

  append(root,
    card(
      el('h3', { text: '對話練習' }),
      p('抽 3 題自我介紹與經歷，每題答完會被追問三層——像真的被問下去，而不是一題一題跳過。', 'small dim'),
      el('a', { class: 'btn primary block', href: '#/interview/talk' }, '開始對話練習'),
    ),
    card(
      el('h3', { text: '模擬面試' }),
      p('抽 6 題：先聽題目、自己出聲答一次，再攤開範答。App 不評分自由回答，只讓你自評卡在哪。', 'small dim'),
      el('a', { class: 'btn primary block', href: '#/interview/mock' }, '開始 6 題模擬面試'),
    ),
    p(`已練 ${answered} / ${items.length} 題${stuck ? `　·　自評卡住 ${stuck} 題` : ''}`, 'small dim'),
  );

  for (const cat of CATEGORY_ORDER) {
    const group = items.filter(i => i.category === cat);
    if (!group.length) continue;
    append(root, h2(`${CATEGORY_ZH[cat]}　${group.length} 題`));
    for (const it of group) append(root, questionCard(it));
  }

  append(root, footerHint());
}

function questionCard(item) {
  const st = store.get();
  const rec = st.interview[item.id];

  const play = speakerButton({ 'aria-label': '播放題目' });
  speech.bindPlayButton(play, () => item.q);

  const body = div({ class: 'hidden' });
  let built = false;

  const toggle = el('button', { class: 'block ghost', onClick: open }, '看解析與範答');

  return card(
    div({ class: 'kv', style: 'border:none;padding:0 0 6px' },
      el('span', { class: 'small dim', text: item.category_zh }),
      rec ? el('span', { class: `pill ${rec.ok === false ? '' : 'a'}`, text: rec.ok === false ? '卡住過' : '答得出來' }) : null,
    ),
    div({ style: 'display:flex;gap:8px;align-items:flex-start' },
      div({ style: 'flex:1' },
        el('div', { class: 'iv-q', text: item.q }),
        el('div', { class: 'small dim', text: item.q_zh }),
      ),
      play,
    ),
    toggle,
    body,
  );

  function open() {
    if (!built) { append(body, detailNodes(item)); built = true; }
    const showing = !body.classList.toggle('hidden');
    toggle.textContent = showing ? '收合' : '看解析與範答';
  }
}

/** 展開後的內容：面試官在問什麼 → 回答骨架 → 範答 → 核心句跟讀 → 關鍵句型 → 別這樣答 → 追問 */
function detailNodes(item) {
  const playAnswer = speakerButton({ 'aria-label': '播放範答' });
  speech.bindPlayButton(playAnswer, () => item.answer);

  const shadowHost = div({});

  return [
    section('面試官在問什麼', p(item.intent_zh, 'small')),
    section('回答骨架', el('ol', { class: 'iv-outline' },
      ...(item.outline_zh || []).map(s => el('li', { text: s })))),
    section('範答',
      div({ style: 'display:flex;gap:8px;align-items:flex-start' },
        el('div', { class: 'iv-answer', style: 'flex:1', text: item.answer }),
        playAnswer,
      ),
      p(item.answer_zh, 'small dim'),
    ),
    item.shadow
      ? section('核心句跟讀',
          el('div', { class: 'small dim', text: '整段太長不好辨識，只跟這一句：' }),
          el('div', { class: 'iv-core', text: item.core }),
          el('button', { class: 'block ghost', onClick: e => toggleShadow(item, shadowHost, e.currentTarget) }, '🎤 跟讀核心句'),
          shadowHost,
        )
      : null,
    section('關鍵句型', ...(item.key_phrases || []).map(k => div({ class: 'kp' },
      el('div', { class: 'en', text: k.en }),
      el('div', { class: 'note', text: k.zh }),
    ))),
    div({ class: 'dont' },
      el('div', { class: 'small dim', text: '別這樣答' }),
      el('div', { class: 'en', text: item.dont.en }),
      el('div', { class: 'small dim', text: item.dont.why_zh }),
    ),
    section('可能的追問', ...(item.follow_ups || []).map(f => div({ class: 'kv' },
      el('span', { style: 'flex:1' },
        el('div', { text: f.en }),
        el('div', { class: 'small dim', text: f.zh }),
        f.tip_zh ? el('div', { class: 'fu-tip small', text: `↳ ${f.tip_zh}` }) : null,
      ),
    ))),
  ];
}

function section(title, ...kids) {
  return div({ class: 'iv-sec' }, el('div', { class: 'iv-h', text: title }), ...kids);
}

function toggleShadow(item, host, btn) {
  openShadow?.destroy();
  if (host.firstChild) {
    host.replaceChildren();
    openShadow = null;
    btn.textContent = '🎤 跟讀核心句';
    return;
  }
  document.querySelectorAll('.shadow').forEach(n => n.remove());
  openShadow = createShadow(item.core, { id: item.id });
  host.replaceChildren(openShadow.el);
  btn.textContent = '收起跟讀';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function footerHint() {
  return p('想練完整對答？用 SPEAKING.md 的場景在 Claude Project 開語音模式，讓 Claude 當面試官。', 'small dim center');
}

/* ----------------------------- 對話練習（M6） ----------------------------- */

/**
 * 抽 3 題自我介紹／經歷，每題一路追問三層（SPEC §4.9.1）。
 *
 * ⚠ App 不能真的接你的話（附錄 B 沒有 LLM）。追問是題庫裡預錄的，
 *   練的是「被問下去不斷線」，不是即興應答。真的雙向對話走 SPEAKING.md 的語音場景。
 */
function renderTalk(root, items, ctx) {
  const deck = buildTalkDeck(items);
  if (!deck.length) {
    append(root, card(p('題庫裡沒有可用於對話練習的題目（需要自我介紹／經歷類，且有三層追問）。', 'small dim')));
    return;
  }

  let idx = 0;
  const host = div({});
  append(root, host,
    el('a', { class: 'btn block ghost', href: '#/interview', style: 'margin-top:16px' }, '← 回題目列表'));
  intro();

  function clear() {
    openShadow?.destroy();
    openShadow = null;
    clearInterval(timer);
    timer = null;
    speech.cancel();
    host.replaceChildren();
  }

  function intro() {
    clear();
    host.append(card(
      el('h3', { text: '對話練習' }),
      p(`${deck.length} 題自我介紹與經歷，每題答完會被追問三層。`, 'small'),
      p('規則只有一條：出聲講，不要用想的。答不出來也先講一句撐住，事後再看回答方向。', 'small dim'),
      el('button', { class: 'btn primary block', onClick: () => { idx = 0; turn(); } }, '開始'),
    ));
  }

  /** 一題＝一串輪次：主問題 → 追問 1 → 追問 2 → 追問 3 → 收尾。 */
  function turn() {
    clear();
    if (idx >= deck.length) { summary(); return; }

    const item = deck[idx];
    const chain = [
      { q: item.q, zh: item.q_zh, tip: null },
      ...(item.follow_ups || []).map(f => ({ q: f.en, zh: f.zh, tip: f.tip_zh })),
    ];
    let round = 0;

    const bar = div({ class: 'qbar' }, el('i', {}));
    const head = p('', 'small dim center');
    const qEl = el('div', { class: 'iv-q big' });
    const zhEl = el('div', { class: 'small dim' });
    const timerEl = div({ class: 'iv-timer small dim' });
    const nextBtn = el('button', { class: 'block primary', onClick: advance }, '');
    const replay = el('button', { class: 'block ghost' }, '🔊 再聽一次');
    const tipBox = div({ class: 'talk-tip hidden' });
    const tipBtn = el('button', { class: 'block ghost', onClick: toggleTip }, '偷看回答方向');

    speech.bindPlayButton(replay, () => chain[round].q);

    host.append(bar, head, card(qEl, zhEl, timerEl, nextBtn, replay, tipBtn, tipBox));
    enter(0);

    /** 進入第 n 輪。一定在點擊事件裡呼叫，speak 才吃得到 iOS 的解鎖（SPEC §5-1）。 */
    function enter(n) {
      round = n;
      const turnItem = chain[n];
      const secs = TALK_SECONDS[Math.min(n, TALK_SECONDS.length - 1)];

      bar.firstChild.style.width = `${Math.round((idx + n / chain.length) / deck.length * 100)}%`;
      head.textContent = n === 0
        ? `第 ${idx + 1} / ${deck.length} 題　·　${CATEGORY_ZH[item.category]}`
        : `第 ${idx + 1} / ${deck.length} 題　·　追問 ${n} / ${chain.length - 1}`;
      qEl.textContent = turnItem.q;
      zhEl.textContent = turnItem.zh;
      nextBtn.textContent = n === chain.length - 1 ? '答完了，看範答 →' : '答完了，繼續追問 →';

      tipBox.replaceChildren();
      tipBox.classList.add('hidden');
      tipBtn.textContent = '偷看回答方向';
      tipBtn.hidden = !turnItem.tip;
      if (turnItem.tip) tipBox.append(el('div', { class: 'small', text: turnItem.tip }));

      speech.speak(turnItem.q);
      runTimer(secs);
    }

    function advance() {
      clearInterval(timer);
      timer = null;
      speech.cancel();
      if (round < chain.length - 1) { enter(round + 1); return; }
      finish();
    }

    function toggleTip() {
      const showing = !tipBox.classList.toggle('hidden');
      tipBtn.textContent = showing ? '收起' : '偷看回答方向';
    }

    function runTimer(secs) {
      clearInterval(timer);
      let left = secs;
      const tick = () => {
        timerEl.textContent = left > 0
          ? `⏱ ${left} 秒　·　現在出聲回答`
          : '⏱ 時間到。答得順就繼續，卡住也繼續——面試不會等你。';
        if (left <= 0) { clearInterval(timer); timer = null; return; }
        left--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    /** 一題結束：自評 → 範答＋每一層追問的回答方向。 */
    function finish() {
      clear();
      const rec = store.get().interview[item.id];
      const ok = el('button', { onClick: () => rate(true) }, '👍 接得住');
      const no = el('button', { onClick: () => rate(false) }, '🤔 中間斷掉了');
      if (rec?.ok === true) ok.classList.add('primary');
      if (rec?.ok === false) no.classList.add('primary');

      host.append(
        card(
          el('div', { class: 'small dim', text: `第 ${idx + 1} / ${deck.length} 題` }),
          el('div', { class: 'iv-q', text: item.q }),
          p('這一串你接得住嗎？（會進弱點清單）', 'small dim center'),
          div({ class: 'row' }, ok, no),
        ),
        card(...detailNodes(item)),
        el('button', {
          class: 'btn primary block',
          onClick: () => { idx++; turn(); },
        }, idx === deck.length - 1 ? '看結果' : '下一題 →'),
      );

      function rate(good) {
        // 和模擬面試同一條規則：同一題今天第一次自評才算一次每日任務
        const firstToday = store.get().interview[item.id]?.day !== srs.today();
        store.update(s => {
          const prev = s.interview[item.id] || {};
          s.interview[item.id] = { ok: good, tries: (prev.tries || 0) + 1, day: srs.today() };
        });
        store.touchDay(srs.today(), srs.addDays(srs.today(), -1), firstToday ? 'interview' : null);
        ok.classList.toggle('primary', good);
        no.classList.toggle('primary', !good);
      }
    }
  }

  function summary() {
    clear();
    const st = store.get();
    const stuck = deck.filter(i => st.interview[i.id]?.ok === false);

    host.append(
      card(
        el('h3', { text: '對話練習完成' }),
        div({ class: 'today-grid' },
          statBox(deck.length - stuck.length, '接得住'),
          statBox(stuck.length, '斷掉'),
          statBox(deck.reduce((a, i) => a + 1 + (i.follow_ups || []).length, 0), '總輪數'),
        ),
        stuck.length
          ? div({ style: 'margin-top:12px' },
              el('div', { class: 'small dim', text: '斷掉的題目：' }),
              ...stuck.map(i => div({ class: 'kv' }, el('span', { style: 'flex:1', text: i.q }))),
              p('這些已經進弱點清單。到「進度」頁匯出後貼給 Claude，讓它針對這幾串追問陪你練。', 'small dim'),
            )
          : p('三串都接得住。明天換一組題目，同樣的故事換個講法再來一次。', 'small dim center'),
      ),
      el('button', { class: 'block primary', onClick: () => { idx = 0; turn(); } }, '再來一輪'),
      footerHint(),
    );
  }
}

/** 只抽自我介紹與經歷，而且要有三層追問才進得來（validate.js 會保證有）。 */
function buildTalkDeck(items) {
  const seed = hash(srs.today());
  const deck = [];
  TALK_RECIPE.forEach(([cat, n], gi) => {
    const pool = items.filter(i => i.category === cat && (i.follow_ups || []).length >= 3);
    if (!pool.length) return;
    for (let k = 0; k < n; k++) {
      for (let tryIdx = 0; tryIdx < pool.length; tryIdx++) {
        const pick = pool[(seed + gi * 5 + k * 3 + tryIdx) % pool.length];
        if (!deck.includes(pick)) { deck.push(pick); break; }
      }
    }
  });
  return deck;
}

/* ----------------------------- 模擬面試 ----------------------------- */

function renderMock(root, items, ctx) {
  const deck = buildDeck(items);
  if (deck.length < 3) {
    append(root, card(p('面試題數量不足，無法組成模擬面試。', 'small dim')));
    return;
  }

  let idx = 0;
  const host = div({});
  append(root, host,
    el('a', { class: 'btn block ghost', href: '#/interview', style: 'margin-top:16px' }, '← 回題目列表'));
  step();

  function step() {
    openShadow?.destroy();
    openShadow = null;
    clearInterval(timer);
    timer = null;
    host.replaceChildren();
    speech.cancel();

    if (idx >= deck.length) { summary(); return; }

    const item = deck[idx];
    const st = store.get();
    const rec = st.interview[item.id];

    const play = el('button', { class: 'block primary' }, '🔊 聽題目');
    speech.bindPlayButton(play, () => item.q);

    const answerHost = div({});
    const timerEl = div({ class: 'iv-timer small dim' });

    const revealBtn = el('button', { class: 'block', onClick: reveal }, '看範答');
    const startTimer = el('button', { class: 'block ghost', onClick: runTimer }, '⏱ 我先自己答（60 秒）');

    host.append(
      div({ class: 'qbar' }, el('i', { style: `width:${Math.round(idx / deck.length * 100)}%` })),
      p(`第 ${idx + 1} / ${deck.length} 題　·　${CATEGORY_ZH[item.category]}`, 'small dim center'),
      card(
        el('div', { class: 'iv-q big', text: item.q }),
        el('div', { class: 'small dim', text: item.q_zh }),
        timerEl,
        play,
        startTimer,
      ),
      selfRateRow(item, rec),
      answerHost,
      navRow(),
    );

    function runTimer() {
      clearInterval(timer);
      let left = 60;
      timerEl.textContent = `⏱ 還有 ${left} 秒——現在出聲回答，不要用想的。`;
      timer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(timer);
          timer = null;
          timerEl.textContent = '⏱ 時間到。答得順嗎？下面選一個，再看範答。';
          return;
        }
        timerEl.textContent = `⏱ 還有 ${left} 秒——現在出聲回答，不要用想的。`;
      }, 1000);
    }

    function reveal() {
      if (answerHost.firstChild) { answerHost.replaceChildren(); revealBtn.textContent = '看範答'; return; }
      answerHost.replaceChildren(card(...detailNodes(item)));
      revealBtn.textContent = '收起範答';
      answerHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function selfRateRow(item, rec) {
      const ok = el('button', { onClick: () => rate(true) }, '👍 答得出來');
      const no = el('button', { onClick: () => rate(false) }, '🤔 卡住了');
      if (rec?.ok === true) ok.classList.add('primary');
      if (rec?.ok === false) no.classList.add('primary');
      return div({},
        p('自評（會進弱點清單）', 'small dim center'),
        div({ class: 'row' }, ok, no),
        revealBtn,
      );

      function rate(good) {
        // 每日任務算「這題今天第一次自評」，同一題改來改去不重複計
        const firstToday = store.get().interview[item.id]?.day !== srs.today();
        store.update(s => {
          const prev = s.interview[item.id] || {};
          s.interview[item.id] = { ok: good, tries: (prev.tries || 0) + 1, day: srs.today() };
        });
        store.touchDay(srs.today(), srs.addDays(srs.today(), -1), firstToday ? 'interview' : null);
        ok.classList.toggle('primary', good);
        no.classList.toggle('primary', !good);
        if (!answerHost.firstChild) reveal();
      }
    }

    function navRow() {
      return div({ class: 'row', style: 'margin-top:12px' },
        idx > 0 ? el('button', { class: 'ghost', onClick: () => { idx--; step(); } }, '← 上一題') : null,
        el('button', {
          class: 'primary',
          onClick: () => { idx++; step(); },
        }, idx === deck.length - 1 ? '看結果' : '下一題 →'),
      );
    }
  }

  function summary() {
    const st = store.get();
    const stuck = deck.filter(i => st.interview[i.id]?.ok === false);
    const good = deck.filter(i => st.interview[i.id]?.ok === true);

    host.append(
      card(
        el('h3', { text: '模擬面試完成' }),
        div({ class: 'today-grid' },
          statBox(good.length, '答得出來'),
          statBox(stuck.length, '卡住'),
          statBox(deck.length, '總題數'),
        ),
        stuck.length
          ? div({ style: 'margin-top:12px' },
              el('div', { class: 'small dim', text: '卡住的題目：' }),
              ...stuck.map(i => div({ class: 'kv' },
                el('span', { style: 'flex:1', text: i.q }),
              )),
              p('這些題已經進弱點清單，可到「進度」頁匯出後貼給 Claude 生成你的專屬答案。', 'small dim'),
            )
          : p('六題都答得出來。下次把同樣的題目用不同例子再答一次。', 'small dim center'),
      ),
      el('button', { class: 'block primary', onClick: () => { idx = 0; step(); } }, '再來一輪'),
      footerHint(),
    );
  }
}

function statBox(n, label) {
  return div({}, el('span', { class: 'n', text: String(n) }), el('span', { class: 'l', text: label }));
}

/** 依配方抽 6 題；用日期當種子，同一天穩定、不同天不一樣。 */
function buildDeck(items) {
  const seed = hash(srs.today());
  const deck = [];
  MOCK_RECIPE.forEach(([cat, n], gi) => {
    const pool = items.filter(i => i.category === cat);
    if (!pool.length) return;
    for (let k = 0; k < n; k++) {
      const pick = pool[(seed + gi * 5 + k * 3) % pool.length];
      if (pick && !deck.includes(pick)) deck.push(pick);
    }
  });
  return deck;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
