// views/home.js — 今日待辦

import { el, div, card, h2, p, append } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as content from '../content.js';

// 建議行程（硬編碼，SPEC §4.0）
const PLAN = {
  1: { label: '單字 ＋ 聽力', hint: '週一開機日：先把到期單字清掉，再聽一段 con-call。' },
  2: { label: '閱讀', hint: '挑一篇客戶信或 8D 報告，重點在 key patterns。' },
  3: { label: 'Email 句型', hint: '練 cloze，寫一封真的信丟給 Claude 批改。' },
  4: { label: '單字 ＋ 閱讀', hint: '複習量通常這天最高，先清 SRS。' },
  5: { label: '跟讀 ＋ 簡報句型', hint: '週五練口說輸出，跟讀 10 句簡報用語。' },
  6: { label: '聽力', hint: '週末聽一段長對話，做聽寫題練數字。' },
  0: { label: '弱點複習', hint: '看進度頁的弱字清單，把 lapses 最多的字補起來。' },
};

export async function render(root, ctx) {
  const [vocabItems, readingItems, emailItems, presentItems, listenItems] = await Promise.all([
    content.vocab().catch(() => []),
    content.readings().catch(() => []),
    content.emails().catch(() => []),
    content.presentation().catch(() => []),
    content.listening().catch(() => []),
  ]);

  const st = store.get();
  const t = srs.today();
  const counts = srs.todayCounts(vocabItems);
  const streak = st.streak.current || 0;

  // 連續天數：昨天沒練就顯示為「即將中斷」
  const alive = st.streak.lastDay === t || st.streak.lastDay === srs.addDays(t, -1);
  const shownStreak = alive ? streak : 0;

  const plan = PLAN[srs.parseYmd(t).getDay()];

  append(root,
    card(
      div({ class: 'hero' },
        el('span', { class: 'n', text: String(shownStreak) }),
        el('span', { class: 'u', text: '天連續練習' }),
      ),
      p(`今天是 ${t}${st.streak.best ? `　最佳紀錄 ${st.streak.best} 天` : ''}`, 'small dim'),
      div({ class: 'today-grid' },
        stat(counts.due, '待複習'),
        stat(counts.fresh, '新字'),
        stat(doneCount(readingItems), '已讀文章'),
      ),
      counts.total > 0
        ? el('a', { class: 'btn primary block', href: '#/vocab', style: 'margin-top:12px' },
            `開始今天的 ${counts.total} 張卡`)
        : el('p', { class: 'small dim center', style: 'margin:12px 0 0' },
            vocabItems.length ? '今天的單字都清完了 👍' : '尚未載入單字內容'),
    ),

    card(
      el('h3', { text: `今日建議：${plan.label}` }),
      p(plan.hint, 'small dim'),
    ),

    h2('模組'),
    div({ class: 'card menu' },
      menuItem('#/vocab', '單字 SRS', `${Object.keys(st.srs).length} / ${vocabItems.length} 字已學`),
      menuItem('#/reading', '閱讀', `${doneCount(readingItems)} / ${readingItems.length} 篇完成`),
      menuItem('#/email', 'Email 句型',
        `${countBy(emailItems, i => st.cloze[i.id]?.passed)} / ${emailItems.length} 組通過`),
      menuItem('#/present', '簡報句型',
        `${countBy(presentItems, i => st.shadow[i.id]?.best != null)} / ${presentItems.filter(i => i.shadow).length} 句跟讀`),
      menuItem('#/listen', '聽力',
        `${countBy(listenItems, i => st.listening[i.id]?.quiz != null)} / ${listenItems.length} 段完成`),
      menuItem('#/progress', '進度與備份', ''),
    ),

    ctx.isDev() ? devPanel(ctx) : null,
  );

  function doneCount(items) {
    return items.filter(r => st.readings[r.id]?.done).length;
  }
}

function countBy(items, fn) {
  return items.filter(fn).length;
}

function stat(n, label) {
  return div({},
    el('span', { class: 'n', text: String(n) }),
    el('span', { class: 'l', text: label }),
  );
}

function menuItem(href, label, sub, disabled = false) {
  return el('a', { href, 'aria-disabled': disabled ? 'true' : null },
    el('span', { text: label }),
    el('span', { class: 'sub', text: sub }),
  );
}

/* ---------- dev 工具：時間旅行（SPEC §7 M1 驗收） ---------- */

function devPanel(ctx) {
  const offset = store.get().dev?.dayOffset || 0;
  const wrap = card(
    el('h3', { text: '🛠 開發者工具' }),
    p(`時間旅行：目前位移 ${offset >= 0 ? '+' : ''}${offset} 天（今天視為 ${srs.today()}）`, 'small dim'),
    div({ class: 'row' },
      el('button', { onClick: () => shift(-1) }, '−1 天'),
      el('button', { onClick: () => shift(1) }, '+1 天'),
      el('button', { onClick: () => shift(null) }, '歸零'),
    ),
  );
  return wrap;

  function shift(delta) {
    store.update(s => {
      s.dev.dayOffset = delta === null ? 0 : (s.dev.dayOffset || 0) + delta;
    });
    ctx.navigate('#/home');
    location.reload();
  }
}
