// views/reading.js — 閱讀列表 + 文章頁

import { el, div, card, h2, p, append } from '../dom.js';
import * as store from '../store.js';
import * as content from '../content.js';

const GENRE_ZH = {
  customer_email: '客戶來信',
  '8d_report': '8D 報告',
  fa_report: 'FA 報告',
  trial_run_summary: 'Trial run 總結',
  spec_change_notice: '規格變更通知',
  audit_reply: '稽核回覆',
};

const LEVEL_ZH = { 1: 'Lv1 入門', 2: 'Lv2 進階', 3: 'Lv3 挑戰' };

const filter = { level: 'all', genre: 'all' };   // 停留在模組內時記住篩選

export function destroy() {
  document.querySelector('.gloss-pop')?.remove();
}

export async function render(root, ctx) {
  const items = await content.readings();
  const id = ctx.params[0];
  if (id) {
    const item = items.find(x => x.id === id);
    if (!item) { root.append(card(p(`找不到文章 ${id}`), el('a', { class: 'btn block', href: '#/reading' }, '回列表'))); return; }
    ctx.setTitle(item.title);
    renderArticle(root, item, ctx);
  } else {
    renderList(root, items);
  }
}

/* ------------------------------ 列表 ------------------------------ */

function renderList(root, items) {
  const st = store.get();
  const levels = [...new Set(items.map(i => i.level))].sort();
  const genres = [...new Set(items.map(i => i.genre))];

  const listHost = div({ class: 'card menu' });

  const selLevel = el('select', { onChange: e => { filter.level = e.target.value; paint(); } },
    el('option', { value: 'all', text: '全部難度' }),
    ...levels.map(l => el('option', { value: String(l), text: LEVEL_ZH[l] || `Lv${l}` })),
  );
  const selGenre = el('select', { onChange: e => { filter.genre = e.target.value; paint(); } },
    el('option', { value: 'all', text: '全部類型' }),
    ...genres.map(g => el('option', { value: g, text: GENRE_ZH[g] || g })),
  );
  selLevel.value = filter.level;
  selGenre.value = filter.genre;

  const doneN = items.filter(i => st.readings[i.id]?.done).length;

  append(root,
    p(`${doneN} / ${items.length} 篇完成`, 'small dim'),
    div({ class: 'filters' }, selLevel, selGenre),
    listHost,
  );

  paint();

  function paint() {
    const rows = items.filter(i =>
      (filter.level === 'all' || String(i.level) === filter.level) &&
      (filter.genre === 'all' || i.genre === filter.genre));

    listHost.replaceChildren();
    if (!rows.length) { listHost.append(p('沒有符合條件的文章', 'small dim')); return; }

    for (const it of rows) {
      const rec = st.readings[it.id];
      const sub = rec?.done ? `✅ ${Math.round((rec.score ?? 0) * 100)}%` : `Lv${it.level}`;
      listHost.append(
        el('a', { href: `#/reading/${it.id}` },
          div({ style: 'flex:1' },
            el('div', { text: it.title }),
            el('div', { class: 'sub', text: GENRE_ZH[it.genre] || it.genre }),
          ),
          el('span', { class: 'sub', text: sub }),
        ),
      );
    }
  }
}

/* ------------------------------ 文章 ------------------------------ */

function renderArticle(root, item, ctx) {
  const answers = new Map();   // qIndex -> chosen
  let zhShown = false;

  const bodyHost = div({ class: 'article' });
  paintBody();

  const zhBtn = el('button', { class: 'ghost', onClick: () => { zhShown = !zhShown; zhBtn.textContent = zhShown ? '隱藏中譯' : '顯示中譯'; paintBody(); } }, '顯示中譯');

  // ⚠ root 是 DocumentFragment，render() 回傳後內容會被搬進 #view，fragment 就空了。
  // 之後才產生的內容（作答結果）必須寫進這個先建好的容器，不能再 root.append。
  const resultHost = div({});

  append(root,
    div({ class: 'filters' },
      el('span', { class: 'pill', text: LEVEL_ZH[item.level] || `Lv${item.level}` }),
      el('span', { class: 'pill', text: GENRE_ZH[item.genre] || item.genre }),
    ),
    card(el('h3', { text: item.title }), bodyHost),
    zhBtn,
    item.questions?.length ? h2('理解題') : null,
    item.questions?.length ? quiz() : null,
    resultHost,
    item.key_patterns?.length ? h2('關鍵句型') : null,
    item.key_patterns?.length ? patterns() : null,
    el('a', { class: 'btn block ghost', href: '#/reading', style: 'margin-top:16px' }, '← 回列表'),
  );

  function paintBody() {
    bodyHost.replaceChildren();
    for (const para of String(item.body).split(/\n{2,}/)) {
      bodyHost.append(el('p', {}, glossify(para, item.glossary || [])));
    }
    if (zhShown && item.body_zh) {
      bodyHost.append(el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }));
      for (const para of String(item.body_zh).split(/\n{2,}/)) {
        bodyHost.append(el('p', { class: 'dim', text: para }));
      }
    }
  }

  function quiz() {
    const host = div({});
    item.questions.forEach((q, qi) => {
      const block = div({ class: 'qz' }, el('div', { class: 'q', text: `${qi + 1}. ${q.q}` }));
      const optBtns = q.options.map((opt, oi) =>
        el('button', {
          class: 'opt',
          onClick: () => choose(qi, oi, q, block, optBtns),
        }, `${String.fromCharCode(65 + oi)}. ${opt}`));
      block.append(...optBtns);
      host.append(block);
    });
    return card(host);
  }

  function choose(qi, oi, q, block, optBtns) {
    if (answers.has(qi)) return;
    answers.set(qi, oi);
    optBtns.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) b.classList.add('correct');
      else if (i === oi) b.classList.add('wrong');
    });
    if (q.explain_zh) block.append(el('div', { class: 'explain', text: q.explain_zh }));
    if (answers.size === item.questions.length) finish();
  }

  function finish() {
    const correct = item.questions.reduce((n, q, i) => n + (answers.get(i) === q.answer ? 1 : 0), 0);
    const score = correct / item.questions.length;
    store.update(s => {
      const prev = s.readings[item.id] || {};
      s.readings[item.id] = { done: true, score: Math.max(prev.score ?? 0, score), attempts: (prev.attempts || 0) + 1 };
    });
    // streak：閱讀也算今天有練
    import('../srs.js').then(srs => store.touchDay(srs.today(), srs.addDays(srs.today(), -1)));
    resultHost.replaceChildren(card(
      el('h3', { text: `答對 ${correct} / ${item.questions.length}` }),
      p(score === 1 ? '全對，這篇的句型可以直接拿去用。' : '看一下解說，再把關鍵句型讀一次。', 'small dim'),
    ));
  }

  function patterns() {
    const host = div({});
    for (const kp of item.key_patterns) {
      host.append(div({ class: 'kp' },
        el('div', { class: 'en', text: kp.en }),
        el('div', { class: 'small', text: kp.zh }),
        kp.note ? el('div', { class: 'note', text: kp.note }) : null,
      ));
    }
    return card(host);
  }
}

/* --------------------- glossary 底線 + 點擊彈出 --------------------- */

function glossify(text, glossary) {
  const frag = document.createDocumentFragment();
  if (!glossary.length) { frag.append(text); return frag; }

  // 長詞優先，避免 "read disturb" 被 "read" 先吃掉
  const terms = [...glossary].sort((a, b) => b.term.length - a.term.length);
  // 允許複數形（word line → word lines）；用 \b 不用 lookbehind，舊版 iOS Safari 不支援
  const pattern = terms.map(g => escapeRe(g.term) + (/[A-Za-z]$/.test(g.term) ? 's?' : '')).join('|');
  const re = new RegExp(`\\b(${pattern})\\b`, 'gi');

  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const low = m[0].toLowerCase();
    const hit = terms.find(g => g.term.toLowerCase() === low)
             || terms.find(g => low === g.term.toLowerCase() + 's');
    const btn = el('button', { class: 'gloss', type: 'button', text: m[0] });
    btn.addEventListener('click', ev => showPop(ev.currentTarget, hit));
    frag.append(btn);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function showPop(anchor, gloss) {
  document.querySelector('.gloss-pop')?.remove();
  if (!gloss) return;
  const pop = div({ class: 'gloss-pop' },
    el('b', { text: gloss.term }),
    el('div', { text: gloss.zh }),
  );
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 6;
  pop.style.top = `${Math.min(top, window.innerHeight - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  setTimeout(() => {
    document.addEventListener('click', function off() {
      pop.remove();
      document.removeEventListener('click', off);
    }, { once: true });
  }, 0);
}
