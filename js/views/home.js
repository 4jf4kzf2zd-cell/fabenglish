// views/home.js — 今日任務（M5 起，首頁的主角是「今天要做的三件事」）

import { el, div, card, h2, p, append } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as content from '../content.js';
import * as daily from '../daily.js';

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
  const t = srs.today();
  const streak = st.streak.current || 0;
  const plan = daily.today(vocabItems);

  // 連續天數：昨天沒練就顯示為「即將中斷」
  const alive = st.streak.lastDay === t || st.streak.lastDay === srs.addDays(t, -1);
  const shownStreak = alive ? streak : 0;

  append(root,
    sprintBar(plan.sprint),
    plan.sprint?.voice ? voiceReminder(plan.sprint.voice) : null,
    streakReminder(st, t, plan),
    todayCard(plan, shownStreak, t, st),
    weekStrip(),

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
      menuItem('#/interview', '面試常見問題',
        `${countBy(interviewItems, i => st.interview[i.id])} / ${interviewItems.length} 題練過`),
      menuItem('#/loop', '循環聽', '常用句重複播放，通勤時開著'),
      menuItem('#/sprint', '面試衝刺',
        plan.sprint
          ? `第 ${plan.sprint.dayIndex} / 42 天　·　${plan.sprint.week.title}`
          : '把每日任務換成倒數 42 天的課表'),
      menuItem('#/progress', '進度與備份', ''),
    ),

    ctx.isDev() ? devPanel(ctx) : null,
  );

  // PWA 圖示上的數字＝今天還沒完成幾項（SPEC §4.10）
  import('../badge.js').then(b => b.update(plan.total - plan.doneCount)).catch(() => {});

  function doneCount(items) {
    return items.filter(r => st.readings[r.id]?.done).length;
  }
}

/* ---------- 面試衝刺（M6） ---------- */

/** 衝刺進行中才出現的一條倒數列，點進去是六週地圖。 */
function sprintBar(sprint) {
  if (!sprint) return null;
  const left = sprint.isTargetDay ? '面試就是今天' : `距離面試 ${sprint.daysLeft} 天`;
  return el('a', { class: 'card sprint-bar', href: '#/sprint' },
    div({ class: 'kv' },
      el('span', { class: 'sb-left', text: left }),
      el('span', { class: 'small dim', text: `第 ${sprint.dayIndex} / 42 天` }),
    ),
    el('div', { class: 'small dim', text: `W${sprint.week.week}　${sprint.week.title}` }),
  );
}

/**
 * 語音模擬日提示。刻意**不做成第四項任務**：
 * 它發生在 Claude 語音裡，App 無從自動判定，而每日任務不做手動打勾（SPEC §4.10）。
 */
function voiceReminder(voice) {
  return div({ class: 'card streak-alert' },
    el('div', { class: 'title', text: `🎙 今天排了語音模擬　${voice.code} ${voice.title}` }),
    el('div', { class: 'small', text: voice.focus }),
    el('div', { class: 'small', text: '用 Claude 語音模式跑 SPEAKING.md 的場景；這一項不算在今日任務裡。' }),
  );
}

/**
 * streak 提示（SPEC §7 M3）：
 * 今天還沒練且昨天有練 → 提醒別斷；已中斷 → 不責備，直接給一個小目標。
 */
function streakReminder(st, today, plan) {
  const practisedToday = st.streak.lastDay === today;
  if (practisedToday || plan.allDone) return null;

  const yesterday = srs.addDays(today, -1);
  const atRisk = st.streak.lastDay === yesterday && (st.streak.current || 0) > 0;

  if (atRisk) {
    return div({ class: 'card streak-alert' },
      el('div', { class: 'title', text: `🔥 ${st.streak.current} 天連續紀錄今天到期` }),
      el('div', { class: 'small', text: `做完今天的 ${plan.total} 項任務就能延續，大約 20 分鐘。` }),
    );
  }
  if (!st.streak.lastDay) return null;

  const gap = srs.daysBetween(st.streak.lastDay, today);
  return div({ class: 'card streak-alert soft' },
    el('div', { class: 'title', text: `已經 ${gap} 天沒練了` }),
    el('div', { class: 'small', text: '先做第一項就好，連續紀錄從 1 重新開始。' }),
  );
}

/* ---------- 今日任務 ---------- */

function todayCard(plan, streak, today, st) {
  const box = div({ class: 'card today' });

  box.append(
    div({ class: 'today-head' },
      el('div', {},
        el('div', { class: 'today-title', text: plan.allDone ? '今天做完了 ✓' : '今日任務' }),
        el('div', { class: 'small dim', text: `${today}　·　連續 ${streak} 天` }),
      ),
      el('div', { class: 'today-count' },
        el('b', { text: String(plan.doneCount) }),
        el('span', { text: ` / ${plan.total}` }),
      ),
    ),
    progressBar(plan.doneCount / Math.max(1, plan.total)),
  );

  const listEl = div({ class: 'task-list' });
  for (const task of plan.tasks) listEl.append(taskRow(task));
  box.append(listEl);

  box.append(plan.allDone
    ? p(streakLine(streak, st), 'small dim center')
    : el('a', { class: 'btn primary block', href: plan.nextHref || '#/vocab' }, '繼續'));

  return box;
}

function taskRow(task) {
  const a = el('a', { class: 'task', href: task.href, 'data-done': task.complete ? '1' : '0' });
  a.append(
    el('span', { class: 'task-mark', text: task.complete ? '✓' : '' }),
    div({ class: 'task-body' },
      el('div', { class: 'task-label', text: task.label }),
      el('div', { class: 'task-hint small dim', text: task.hint }),
    ),
    el('span', { class: 'task-n', text: task.complete ? '' : progressText(task) }),
  );
  return a;
}

function progressText(task) {
  if (task.kind === 'loopSec') {
    return `${Math.floor(task.done / 60)} / ${Math.round(task.target / 60)} 分`;
  }
  return `${task.done} / ${task.target}`;
}

function progressBar(ratio) {
  const bar = div({ class: 'today-bar' });
  bar.append(el('i', { style: `width:${Math.round(Math.min(1, ratio) * 100)}%` }));
  return bar;
}

function streakLine(streak, st) {
  if (streak >= 2) return `連續 ${streak} 天　·　最佳紀錄 ${st.streak.best || streak} 天`;
  return '明天同一時間再來一次，連續紀錄就開始累積了。';
}

/* ---------- 最近 14 天 ---------- */

function weekStrip() {
  const days = daily.history([], 14);
  const strip = div({ class: 'card streak-strip' });
  const cells = div({ class: 'strip' });
  for (const d of days) {
    cells.append(el('i', {
      class: 'cell',
      'data-on': d.touched ? '1' : '0',
      'data-today': d.isToday ? '1' : '0',
      title: d.day,
    }));
  }
  strip.append(
    div({ class: 'kv' },
      el('span', { class: 'small dim', text: '最近 14 天' }),
      el('span', { class: 'small dim', text: `${days.filter(d => d.touched).length} 天有練` }),
    ),
    cells,
  );
  return strip;
}

/* ---------- 小工具 ---------- */

function countBy(items, fn) {
  return items.filter(fn).length;
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
