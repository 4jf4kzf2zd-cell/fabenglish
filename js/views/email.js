// views/email.js — Email 句型（依 scenario 分組瀏覽 ＋ cloze 填空練習）

import { el, div, card, h2, p, append, speakerButton } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as content from '../content.js';

const SCENARIO_ORDER = ['bad_news', 'status_update', 'request_extension', 'rca_summary', 'reply_complaint', 'request_waiver'];
const SCENARIO_ZH = {
  bad_news: '通報壞消息',
  status_update: '進度更新',
  request_extension: '要求展延',
  rca_summary: '根因摘要',
  reply_complaint: '回覆客訴',
  request_waiver: '申請特採',
};

let filterScenario = 'all';

export function destroy() { speech.cancel(); }

export async function render(root, ctx) {
  const items = await content.emails();
  if (!items.length) {
    append(root, card(el('h3', { text: '尚未載入 Email 句型' }), p('content/email_patterns.json 是空的。', 'small dim')));
    return;
  }

  if (ctx.params[0] === 'drill') {
    ctx.setTitle('填空練習');
    renderDrill(root, items, ctx);
    return;
  }

  const st = store.get();
  const passed = items.filter(i => st.cloze[i.id]?.passed).length;

  append(root,
    card(
      el('h3', { text: '填空練習' }),
      p('把句型的關鍵字挖空，逐題填回去。比對忽略大小寫與前後空白。', 'small dim'),
      el('a', { class: 'btn primary block', href: '#/email/drill' }, `開始練習（已通過 ${passed} / ${items.length}）`),
    ),
  );

  for (const scenario of SCENARIO_ORDER) {
    const group = items.filter(i => i.scenario === scenario);
    if (!group.length) continue;
    append(root, h2(`${SCENARIO_ZH[scenario] || scenario}　${group.length} 組`));
    for (const it of group) append(root, patternCard(it));
  }

  append(root, footerHint());
}

function patternCard(item) {
  const st = store.get();
  const play = speakerButton();
  speech.bindPlayButton(play, () => item.filled_example);

  return card(
    div({ class: 'kv', style: 'border:none;padding:0 0 6px' },
      el('span', { class: 'small dim', text: item.scenario_zh }),
      st.cloze[item.id]?.passed ? el('span', { class: 'pill a', text: '已通過' }) : null,
    ),
    div({ class: 'pattern' }, ...slots(item.pattern)),
    p(item.pattern_zh, 'small dim'),
    div({ style: 'border-top:1px solid var(--line);padding-top:10px;margin-top:10px' },
      el('div', { class: 'small dim', text: '填好的範例' }),
      div({ style: 'display:flex;gap:8px;align-items:flex-start' },
        el('div', { style: 'flex:1', text: item.filled_example }),
        play,
      ),
    ),
    div({ class: 'dont' },
      el('div', { class: 'small dim', text: '別這樣寫' }),
      el('div', { class: 'en', text: item.dont.en }),
      el('div', { class: 'small dim', text: item.dont.why_zh }),
    ),
  );
}

/** 把 {lot} 這種變數槽上色。 */
function slots(pattern) {
  const out = [];
  const re = /\{([^}]+)\}/g;
  let last = 0, m;
  while ((m = re.exec(pattern)) !== null) {
    if (m.index > last) out.push(pattern.slice(last, m.index));
    out.push(el('span', { class: 'slot', text: m[0] }));
    last = m.index + m[0].length;
  }
  out.push(pattern.slice(last));
  return out;
}

function footerHint() {
  return p('寫完整封信？把草稿貼到 Claude Project 讓 Claude 批改。', 'small dim center');
}

/* ----------------------------- 填空練習 ----------------------------- */

function renderDrill(root, items, ctx) {
  const st = store.get();
  // 沒通過的排前面，通過的排後面（複習還是看得到）
  const queue = [...items].sort((a, b) =>
    (st.cloze[a.id]?.passed ? 1 : 0) - (st.cloze[b.id]?.passed ? 1 : 0));

  let idx = 0;
  let correct = 0;
  const host = div({});
  append(root, host, el('a', { class: 'btn block ghost', href: '#/email', style: 'margin-top:16px' }, '← 回句型列表'));
  step();

  function step() {
    host.replaceChildren();
    if (idx >= queue.length) { summary(); return; }

    const item = queue[idx];
    const inputs = [];
    const textNodes = clozeNodes(item.cloze.text, inputs);

    const checkBtn = el('button', { class: 'block primary', onClick: check }, '對答案');
    const feedback = div({});

    append(host,
      div({ class: 'qbar' }, el('i', { style: `width:${Math.round(idx / queue.length * 100)}%` })),
      p(`${idx + 1} / ${queue.length}　·　${item.scenario_zh}`, 'small dim center'),
      card(
        p(item.pattern_zh, 'small dim'),
        div({ class: 'cloze-text' }, ...textNodes),
      ),
      checkBtn,
      feedback,
      idx > 0
        ? el('button', { class: 'block ghost', style: 'margin-top:8px', onClick: () => { idx--; step(); } }, '← 上一題')
        : null,
    );
    inputs[0]?.focus();

    function check() {
      const answers = item.cloze.answers;
      let allRight = true;
      inputs.forEach((input, i) => {
        const got = input.value.trim().toLowerCase();
        const want = String(answers[i] ?? '').trim().toLowerCase();
        const right = got === want;
        input.classList.toggle('correct', right);
        input.classList.toggle('wrong', !right);
        input.disabled = true;
        if (!right) { allRight = false; input.value = answers[i]; }
      });

      if (allRight) correct++;
      // 每日任務只算「這組第一次通過」，重做已通過的不重複計
      const firstPass = allRight && !store.get().cloze[item.id]?.passed;
      store.update(s => {
        const prev = s.cloze[item.id] || {};
        s.cloze[item.id] = { passed: prev.passed || allRight, attempts: (prev.attempts || 0) + 1 };
      });
      import('../srs.js').then(srs =>
        store.touchDay(srs.today(), srs.addDays(srs.today(), -1), firstPass ? 'cloze' : null));

      const play = speakerButton();
      speech.bindPlayButton(play, () => item.filled_example);

      feedback.replaceChildren(card(
        el('h3', { text: allRight ? '✅ 正確' : '❌ 紅色的是正解' }),
        div({ style: 'display:flex;gap:8px;align-items:flex-start' },
          el('div', { style: 'flex:1', text: item.filled_example }),
          play,
        ),
        div({ class: 'dont' },
          el('div', { class: 'en', text: item.dont.en }),
          el('div', { class: 'small dim', text: item.dont.why_zh }),
        ),
      ));
      checkBtn.replaceWith(el('button', { class: 'block primary', onClick: () => { idx++; step(); } },
        idx === queue.length - 1 ? '看結果' : '下一題 →'));
    }
  }

  function summary() {
    const passedNow = Object.values(store.get().cloze).filter(c => c.passed).length;
    host.append(
      card(
        el('h3', { text: '填空練習完成' }),
        div({ class: 'today-grid' },
          statBox(queue.length, '題'),
          statBox(correct, '一次答對'),
          statBox(passedNow, '累積通過'),
        ),
      ),
      el('button', { class: 'block primary', onClick: () => { idx = 0; correct = 0; step(); } }, '再練一輪'),
      footerHint(),
    );
  }
}

/** 把 "We ___ to inform you" 切成文字與輸入框。 */
function clozeNodes(text, inputs) {
  const parts = String(text).split(/_{2,}/);
  const nodes = [];
  parts.forEach((part, i) => {
    nodes.push(part);
    if (i < parts.length - 1) {
      const input = el('input', {
        type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: false,
        'aria-label': `第 ${i + 1} 個空格`,
      });
      inputs.push(input);
      nodes.push(input);
    }
  });
  return nodes;
}

function statBox(n, label) {
  return div({}, el('span', { class: 'n', text: String(n) }), el('span', { class: 'l', text: label }));
}
