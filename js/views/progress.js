// views/progress.js — 進度、各盒分布、匯出 / 匯入備份

import { el, div, card, h2, p, confirmDialog, append } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as content from '../content.js';

export async function render(root, ctx) {
  const [vocabItems, readingItems, emailItems, presentItems, listenItems] = await Promise.all([
    content.vocab().catch(() => []),
    content.readings().catch(() => []),
    content.emails().catch(() => []),
    content.presentation().catch(() => []),
    content.listening().catch(() => []),
  ]);

  const st = store.get();
  const bins = srs.boxHistogram();
  const learned = Object.keys(st.srs).length;
  const readDone = readingItems.filter(r => st.readings[r.id]?.done).length;
  const clozePassed = emailItems.filter(i => st.cloze[i.id]?.passed).length;
  const shadowable = presentItems.filter(i => i.shadow);
  const shadowDone = shadowable.filter(i => st.shadow[i.id]?.best != null).length;
  const listenDone = listenItems.filter(i => st.listening[i.id]?.quiz != null).length;
  const due = srs.todayCounts(vocabItems);

  append(root,
    card(
      div({ class: 'hero' },
        el('span', { class: 'n', text: String(st.streak.current || 0) }),
        el('span', { class: 'u', text: '天連續　·　最佳 ' + (st.streak.best || 0) + ' 天' }),
      ),
      p(`最後練習：${st.streak.lastDay || '尚未開始'}　今日待複習 ${due.due} 字`, 'small dim'),
    ),

    h2('單字 Leitner 分布'),
    card(
      boxChart(bins),
      p(`已學 ${learned} / ${vocabItems.length} 字　·　盒號越高代表記得越牢（Box 5＝16 天複習一次）`, 'small dim center'),
    ),

    h2('模組完成度'),
    card(
      meter('單字 SRS', learned, vocabItems.length),
      meter('閱讀', readDone, readingItems.length),
      meter('Email 填空', clozePassed, emailItems.length),
      meter('簡報跟讀', shadowDone, shadowable.length),
      meter('聽力', listenDone, listenItems.length),
    ),

    weakSection(vocabItems),
    weakShadowSection(presentItems),

    h2('備份'),
    card(
      p('iOS 可能在儲存空間不足時回收 PWA 的資料，請定期匯出備份。', 'small dim'),
      exportButton(),
      importButton(ctx),
    ),

    h2('危險區'),
    card(
      p('清除全部進度（單字排程、閱讀紀錄、連續天數）。建議先匯出備份。', 'small dim'),
      el('button', { class: 'block danger', onClick: () => doReset(ctx) }, '清除所有進度'),
    ),
  );
}

function boxChart(bins) {
  const max = Math.max(1, ...bins);
  return div({ class: 'boxes' },
    ...bins.map((n, i) => div({},
      el('span', { class: 'n', text: String(n) }),
      el('span', { class: 'bar', style: `height:${Math.round(n / max * 78)}%` }),
      el('span', { class: 'l', text: `B${i + 1}` }),
    )),
  );
}

function meter(label, n, total) {
  const pct = total ? Math.round(n / total * 100) : 0;
  return div({ style: 'margin-bottom:10px' },
    div({ class: 'kv', style: 'border:none;padding:0' },
      el('span', { text: label }),
      el('span', { class: 'dim small', text: `${n} / ${total}　${pct}%` }),
    ),
    div({ class: 'meter' }, el('i', { style: `width:${pct}%` })),
  );
}

/** 跟讀分數最低的句子（M3 弱點清單的雛形）。 */
function weakShadowSection(presentItems) {
  const st = store.get();
  const scored = presentItems
    .filter(i => st.shadow[i.id]?.best != null)
    .sort((a, b) => st.shadow[a.id].best - st.shadow[b.id].best)
    .slice(0, 5)
    .filter(i => st.shadow[i.id].best < 90);
  if (!scored.length) return null;

  return div({},
    h2('跟讀最低分的句子'),
    card(...scored.map(i => div({ class: 'kv', style: 'align-items:flex-start' },
      el('span', { style: 'flex:1', text: i.en }),
      el('span', { class: 'dim small', text: `${st.shadow[i.id].best} 分` }),
    ))),
  );
}

function weakSection(vocabItems) {
  const weak = srs.weakest(vocabItems, 8);
  if (!weak.length) return null;
  const st = store.get();
  return div({},
    h2('弱點字（答錯最多）'),
    card(...weak.map(it => div({ class: 'kv' },
      el('span', {}, el('b', { text: it.term }), el('span', { class: 'dim small', text: '　' + it.zh })),
      el('span', { class: 'dim small', text: `${st.srs[it.id].lapses} 次` }),
    ))),
  );
}

/* ---------------------------- 匯出 ---------------------------- */

function exportButton() {
  const btn = el('button', { class: 'block primary' }, '⬇︎ 匯出 JSON 備份');
  btn.addEventListener('click', () => {
    try {
      const blob = store.exportBlob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: store.exportFilename() });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      btn.textContent = '已匯出 ✓';
      setTimeout(() => { btn.textContent = '⬇︎ 匯出 JSON 備份'; }, 2000);
    } catch (err) {
      alert('匯出失敗：' + err.message);
    }
  });
  return btn;
}

/* ---------------------------- 匯入 ---------------------------- */

function importButton(ctx) {
  const input = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
  const btn = el('button', { class: 'block', style: 'margin-top:8px' }, '⬆︎ 匯入備份（覆蓋現有進度）');

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const next = store.parseBackup(text);
      const n = Object.keys(next.srs).length;
      const when = JSON.parse(text).exportedAt?.slice(0, 10) || '未知日期';
      if (!confirmDialog(`即將以備份覆蓋現有進度。\n\n備份日期：${when}\n單字紀錄：${n} 筆\n連續天數：${next.streak.current || 0} 天\n\n確定要覆蓋嗎？`)) return;
      store.replaceAll(next);
      alert('匯入完成，進度已還原。');
      location.reload();
    } catch (err) {
      alert('匯入失敗：' + err.message);
    }
  });

  return div({}, btn, input);
}

function doReset(ctx) {
  if (!confirmDialog('確定要清除所有進度嗎？此動作無法復原。')) return;
  if (!confirmDialog('再確認一次：所有單字排程與閱讀紀錄都會消失。')) return;
  store.resetAll();
  location.reload();
}
