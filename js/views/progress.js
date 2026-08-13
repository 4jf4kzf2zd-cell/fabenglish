// views/progress.js — 進度、各盒分布、匯出 / 匯入備份

import { el, div, card, h2, p, confirmDialog, append } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as content from '../content.js';

export async function render(root, ctx) {
  const [vocabItems, readingItems, emailItems, presentItems, listenItems, interviewItems] = await Promise.all([
    content.vocab().catch(() => []),
    content.readings().catch(() => []),
    content.emails().catch(() => []),
    content.presentation().catch(() => []),
    content.listening().catch(() => []),
    content.interview().catch(() => []),
  ]);

  const st = store.get();
  const bins = srs.boxHistogram();
  const learned = Object.keys(st.srs).length;
  const readDone = readingItems.filter(r => st.readings[r.id]?.done).length;
  const clozePassed = emailItems.filter(i => st.cloze[i.id]?.passed).length;
  const shadowable = presentItems.filter(i => i.shadow);
  const shadowDone = shadowable.filter(i => st.shadow[i.id]?.best != null).length;
  const listenDone = listenItems.filter(i => st.listening[i.id]?.quiz != null).length;
  const interviewDone = interviewItems.filter(i => st.interview[i.id]).length;
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
      meter('面試題', interviewDone, interviewItems.length),
    ),

    weakSection(vocabItems),

    h2('弱點清單'),
    weaknessCard({ vocab: vocabItems, readings: readingItems, emails: emailItems, presentation: presentItems, listening: listenItems, interview: interviewItems }),

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

/* ------------------------ 弱點清單匯出 ------------------------ */

/** SPEC §7 M3：把弱點整理成 markdown，可貼回 Claude Project 生成加強教材。 */
function weaknessCard(content) {
  const box = card(
    p('把「記不住的單字、唸不好的句子、讀不懂的文章」整理成一份 Markdown，貼回 Claude Project 就能生成加強教材。', 'small dim'),
  );

  const preview = el('pre', {
    class: 'md-preview hidden',
    style: 'white-space:pre-wrap;font-family:var(--mono);font-size:12px;max-height:260px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:8px',
  });
  const summary = p('', 'small dim');

  const genBtn = el('button', { class: 'block primary', onClick: generate }, '產生弱點清單');
  box.append(genBtn, summary, preview);
  return box;

  async function generate() {
    const { buildReport, filename } = await import('../weakness.js');
    const report = buildReport(content);

    preview.textContent = report.markdown;
    preview.classList.remove('hidden');
    summary.textContent = report.empty
      ? '目前沒有偵測到明顯弱點，多練幾天再產生一次。'
      : `單字 ${report.counts.vocab}、跟讀 ${report.counts.shadow}、閱讀 ${report.counts.reading}、聽力 ${report.counts.listening}、Email ${report.counts.cloze} 項。`;

    genBtn.replaceWith(div({ class: 'row' },
      el('button', { class: 'primary', onClick: () => download(report.markdown, filename()) }, '⬇︎ 下載 .md'),
      el('button', { onClick: e => copy(report.markdown, e.currentTarget) }, '複製'),
    ));
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已複製 ✓';
    } catch (_) {
      // iOS 在非使用者手勢或非 https 下會失敗，退回讓使用者自己選取
      preview.focus?.();
      btn.textContent = '請長按上方文字複製';
    }
    setTimeout(() => { btn.textContent = '複製'; }, 2500);
  }
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
