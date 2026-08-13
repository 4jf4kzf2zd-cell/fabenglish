// views/vocab.js — 單字 SRS 卡片流程

import { el, div, card, p, speakerButton } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as speech from '../speech.js';
import * as content from '../content.js';
import { createShadow } from '../shadow.js';

const TIER_LABEL = { A: 'A 專業', B: 'B 商務', C: 'C 片語' };

let session = null;   // {queue:[], idx, again:[], right:0, wrong:0, total}
let openShadow = null;

export function destroy() {
  openShadow?.destroy();
  openShadow = null;
  speech.cancel();
}

export async function render(root, ctx) {
  const items = await content.vocab();
  const { queue } = srs.buildQueue(items);

  if (!session || session.day !== srs.today() || session.finished) {
    session = null;
  }
  if (!session) {
    if (!queue.length) { root.append(emptyState(items)); return; }
    session = {
      day: srs.today(),
      queue: [...queue],
      idx: 0,
      again: [],
      right: 0,
      wrong: 0,
      answered: 0,
      total: queue.length,
      finished: false,
    };
  }

  const host = div({});
  root.append(host);
  draw();

  function draw() {
    speech.cancel();
    openShadow?.destroy();
    openShadow = null;
    host.replaceChildren();

    const item = session.queue[session.idx];
    if (!item) {
      // 這一輪跑完了；答錯的字在同一次 session 內再考一次
      if (session.again.length) {
        session.queue = session.again;
        session.again = [];
        session.idx = 0;
        host.replaceChildren(againNotice());
        return;
      }
      session.finished = true;
      host.replaceChildren(summary());
      import('../badge.js').then(b => b.refresh()).catch(() => {});
      return;
    }

    // 進度以「已作答 / (已作答＋剩餘)」計，答錯補考會讓分母變大，符合實際還要練幾張
    const done = session.answered;
    const total = done + remaining();
    host.append(
      progressBar(done, total),
      p(`${done + 1} / ${total}　${srs.today()}`, 'small dim center'),
      frontCard(item),
    );
  }

  function remaining() {
    return (session.queue.length - session.idx) + session.again.length;
  }

  function progressBar(done, total) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return div({ class: 'qbar' }, el('i', { style: `width:${Math.min(100, pct)}%` }));
  }

  function frontCard(item) {
    const rec = store.get().srs[item.id];
    const play = speakerButton();
    speech.bindPlayButton(play, () => item.term);

    return div({},
      card(
        div({ class: 'flash' },
          el('span', { class: 'pill' + (rec ? '' : ' a'), text: rec ? `Box ${rec.box}` : '新字' }),
          el('div', { class: 'term', text: item.term }),
          el('div', { class: 'pos', text: item.pos || '' }),
          play,
        ),
      ),
      div({ class: 'row' },
        el('button', { class: 'block', onClick: () => grade(item, false) }, '不認得'),
        el('button', { class: 'block primary', onClick: () => grade(item, true) }, '認得'),
      ),
      session.idx > 0
        ? el('button', {
            class: 'block ghost', style: 'margin-top:8px',
            onClick: () => { session.idx--; session.answered = Math.max(0, session.answered - 1); draw(); },
          }, '← 上一張（會重新作答）')
        : null,
    );
  }

  function grade(item, correct) {
    const rec = srs.answer(item.id, correct);
    session.answered++;
    if (correct) session.right++; else { session.wrong++; session.again.push(item); }
    host.replaceChildren(backCard(item, rec, correct));
  }

  function backCard(item, rec, correct) {
    const playTerm = speakerButton();
    speech.bindPlayButton(playTerm, () => item.term);
    const playEx = speakerButton();
    speech.bindPlayButton(playEx, () => item.example || '');

    const dl = el('dl', { class: 'back' },
      el('dt', { text: '中譯' }),
      el('dd', { class: 'zh', text: item.zh }),
      item.def_en ? el('dt', { text: '英文定義' }) : null,
      item.def_en ? el('dd', { text: item.def_en }) : null,
      item.example ? el('dt', { text: '例句' }) : null,
      item.example ? el('dd', { class: 'ex' }, highlight(item.example, item.term), ' ', playEx) : null,
      item.example_zh ? el('dd', { class: 'small dim', text: item.example_zh }) : null,
    );

    const nextDays = srs.daysBetween(srs.today(), rec.due);

    // 例句跟讀（SPEC §4.1 → 叫用 §4.6 跟讀引擎）
    const shadowHost = div({});
    const best = store.get().shadow[item.id]?.best;
    const shadowBtn = el('button', {
      class: 'ghost',
      onClick: () => {
        if (shadowHost.firstChild) { openShadow?.destroy(); openShadow = null; shadowHost.replaceChildren(); return; }
        openShadow?.destroy();
        openShadow = createShadow(item.example, { id: item.id });
        shadowHost.replaceChildren(openShadow.el);
        shadowHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    }, best != null ? '🎤 跟讀例句（練過）' : '🎤 跟讀例句');

    return div({},
      card(
        div({ class: 'flash', style: 'min-height:auto;padding:6px 0 12px' },
          el('div', { class: 'term', text: item.term }),
          el('div', { class: 'pos', text: [item.pos, TIER_LABEL[item.tier]].filter(Boolean).join('　') }),
          playTerm,
        ),
        dl,
        item.example ? div({ class: 'row', style: 'margin-top:14px' }, shadowBtn) : null,
        shadowHost,
      ),
      p(correct
        ? `✅ 進入 Box ${rec.box}，${nextDays} 天後再考。`
        : `↻ 回到 Box 1，明天再考（本次結束前會再出現一次）。`, 'small dim center'),
      el('button', { class: 'block primary', onClick: next }, '下一張'),
    );
  }

  function next() {
    session.idx++;
    draw();
  }

  function againNotice() {
    return div({},
      card(
        el('h3', { text: '再考一次' }),
        p(`剛才答錯的 ${session.queue.length} 個字，趁記憶還熱的時候再過一輪。`, 'small dim'),
      ),
      el('button', { class: 'block primary', onClick: draw }, '開始'),
    );
  }

  function summary() {
    const total = session.right + session.wrong;
    const pct = total ? Math.round(session.right / total * 100) : 0;
    return div({},
      card(
        el('h3', { text: '今天的單字練完了' }),
        div({ class: 'today-grid' },
          statBox(session.total, '張卡'),
          statBox(session.right, '認得'),
          statBox(session.wrong, '不認得'),
        ),
        p(`答對率 ${pct}%（含補考）　連續練習 ${store.get().streak.current} 天`, 'small dim center'),
      ),
      el('a', { class: 'btn block primary', href: '#/reading' }, '接著練閱讀'),
      el('a', { class: 'btn block ghost', href: '#/home', style: 'margin-top:8px' }, '回首頁'),
    );
  }
}

function statBox(n, label) {
  return div({}, el('span', { class: 'n', text: String(n) }), el('span', { class: 'l', text: label }));
}

/** 例句裡把該單字加粗（大小寫不敏感、支援片語）。 */
function highlight(sentence, term) {
  const frag = document.createDocumentFragment();
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  let last = 0, m;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index > last) frag.append(sentence.slice(last, m.index));
    frag.append(el('b', { text: m[0] }));
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  frag.append(sentence.slice(last));
  return frag;
}

function emptyState(items) {
  const st = store.get();
  const learned = Object.keys(st.srs).length;
  return div({},
    card(
      el('h3', { text: '今天沒有到期的單字' }),
      p(learned >= items.length
        ? `${items.length} 個字都在複習排程裡了，等到期日到了會自動出現。`
        : `今日新字額度已用完（設定：每日 ${st.settings.newPerDay} 字）。想多練可以到設定調高。`, 'small dim'),
    ),
    el('a', { class: 'btn block', href: '#/settings' }, '調整每日新字量'),
    el('a', { class: 'btn block ghost', href: '#/reading', style: 'margin-top:8px' }, '去練閱讀'),
  );
}
