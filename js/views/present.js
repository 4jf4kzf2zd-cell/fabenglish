// views/present.js — 簡報句型（依 section 分組）＋ 簡報模式（10 句模擬簡報稿）

import { el, div, card, h2, p, append, speakerButton } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as content from '../content.js';
import * as srs from '../srs.js';
import { createShadow } from '../shadow.js';

const SECTION_ORDER = ['opening', 'agenda', 'data_description', 'root_cause', 'action', 'qa_defense', 'closing'];
const SECTION_ZH = {
  opening: '開場',
  agenda: '議程',
  data_description: '圖表描述',
  root_cause: '根本原因',
  action: '行動方案',
  qa_defense: 'Q&A 應對',
  closing: '結尾',
};

// 簡報模式的抽句配方（SPEC §4.4：依順序組成一份 10 句的模擬簡報稿）
const DECK_RECIPE = [
  ['opening', 1], ['agenda', 1], ['data_description', 3],
  ['root_cause', 2], ['action', 2], ['closing', 1],
];

let openShadow = null;

export function destroy() {
  openShadow?.destroy();
  openShadow = null;
  speech.cancel();
}

export async function render(root, ctx) {
  const items = await content.presentation();
  if (!items.length) {
    append(root, card(el('h3', { text: '尚未載入簡報句型' }), p('content/presentation.json 是空的。', 'small dim')));
    return;
  }
  if (ctx.params[0] === 'deck') {
    ctx.setTitle('簡報模式');
    renderDeck(root, items, ctx);
  } else {
    renderList(root, items, ctx);
  }
}

/* ----------------------------- 句型列表 ----------------------------- */

function renderList(root, items, ctx) {
  const st = store.get();
  const shadowable = items.filter(i => i.shadow);
  const practised = shadowable.filter(i => st.shadow[i.id]?.best != null).length;

  append(root,
    card(
      el('h3', { text: '簡報模式' }),
      p('依 開場 → 議程 → 圖表 → 根本原因 → 行動 → 結尾 抽 10 句，逐句跟讀後給總分。', 'small dim'),
      el('a', { class: 'btn primary block', href: '#/present/deck' }, '開始 10 句模擬簡報'),
    ),
    p(`跟讀進度 ${practised} / ${shadowable.length} 句`, 'small dim'),
  );

  for (const section of SECTION_ORDER) {
    const group = items.filter(i => i.section === section);
    if (!group.length) continue;
    append(root, h2(`${SECTION_ZH[section]}　${group.length} 句`));
    const box = card();
    for (const it of group) box.append(sentenceRow(it));
    append(root, box);
  }
}

function sentenceRow(item) {
  const st = store.get();
  const best = st.shadow[item.id]?.best;

  const play = speakerButton();
  speech.bindPlayButton(play, () => item.en);

  const host = div({});
  const row = div({ class: 'kv', style: 'align-items:flex-start' },
    div({ style: 'flex:1' },
      el('div', { text: item.en }),
      el('div', { class: 'small dim', text: item.zh }),
    ),
    div({ style: 'flex:0 0 auto;display:flex;gap:4px;align-items:center' },
      best != null ? el('span', { class: 'pill a', text: `${best}` }) : null,
      play,
      item.shadow ? el('button', {
        class: 'icon-btn ghost',
        'aria-label': '跟讀這句',
        onClick: () => toggleShadow(item, host),
      }, '🎤') : null,
    ),
  );
  return div({}, row, host);
}

function toggleShadow(item, host) {
  openShadow?.destroy();
  if (host.firstChild) { host.replaceChildren(); openShadow = null; return; }
  document.querySelectorAll('.shadow').forEach(n => n.remove());
  openShadow = createShadow(item.en, { id: item.id });
  host.replaceChildren(openShadow.el);
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ----------------------------- 簡報模式 ----------------------------- */

function renderDeck(root, items, ctx) {
  const deck = buildDeck(items);
  if (deck.length < 3) {
    append(root, card(p('簡報句型數量不足，無法組成模擬簡報。', 'small dim')));
    return;
  }

  const scores = [];
  let idx = 0;
  const host = div({});
  append(root, host, el('a', { class: 'btn block ghost', href: '#/present', style: 'margin-top:16px' }, '← 回句型列表'));
  step();

  function step() {
    openShadow?.destroy();
    openShadow = null;
    host.replaceChildren();

    if (idx >= deck.length) { summary(); return; }

    const item = deck[idx];
    openShadow = createShadow(item.en, {
      id: item.id,
      onScore: s => {
        scores[idx] = Math.max(scores[idx] ?? 0, s);
        nextBtn.disabled = false;
        nextBtn.classList.add('primary');
      },
    });

    const nextBtn = el('button', {
      class: 'block',
      onClick: () => { idx++; step(); },
    }, idx === deck.length - 1 ? '看總分' : '下一句 →');
    nextBtn.disabled = true;

    const skip = el('button', { class: 'block ghost', onClick: () => { idx++; step(); } }, '跳過這句');

    host.append(
      div({ class: 'qbar' }, el('i', { style: `width:${Math.round(idx / deck.length * 100)}%` })),
      p(`第 ${idx + 1} / ${deck.length} 句　·　${SECTION_ZH[item.section]}`, 'small dim center'),
      card(
        el('div', { class: 'small dim', text: item.zh }),
        openShadow.el,
      ),
      nextBtn,
      skip,
    );
  }

  function summary() {
    const done = scores.filter(s => typeof s === 'number');
    const avg = done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : 0;
    host.append(
      card(
        el('h3', { text: '模擬簡報完成' }),
        div({ class: 'today-grid' },
          statBox(`${avg}`, '平均分'),
          statBox(`${done.length}`, '已跟讀'),
          statBox(`${done.filter(s => s >= 80).length}`, '80 分以上'),
        ),
        p(avg >= 80 ? '這份簡報稿唸得夠穩，可以直接上場。'
          : avg >= 60 ? '大致順，把分數低的句子單獨再練幾次。'
          : '先放慢速度，逐句聽一次再跟讀。', 'small dim center'),
      ),
      el('button', { class: 'block primary', onClick: () => { idx = 0; scores.length = 0; step(); } }, '再來一份'),
    );
  }
}

function statBox(n, label) {
  return div({}, el('span', { class: 'n', text: String(n) }), el('span', { class: 'l', text: label }));
}

/** 依配方組 10 句；用日期當種子，每天抽到的組合不同但同一天穩定。 */
function buildDeck(items) {
  const seed = hash(srs.today());
  const deck = [];
  DECK_RECIPE.forEach(([section, n], gi) => {
    const pool = items.filter(i => i.section === section && i.shadow);
    if (!pool.length) return;
    for (let k = 0; k < n; k++) {
      const pick = pool[(seed + gi * 7 + k * 3) % pool.length];
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
