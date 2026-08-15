// views/sprint.js — 面試衝刺總覽（M6，SPEC §4.11）
// 沒啟動時是說明＋啟動按鈕；啟動後是倒數、本週里程碑、六週地圖、語音模擬日。

import { el, div, card, h2, p, append, confirmDialog } from '../dom.js';
import * as store from '../store.js';
import * as srs from '../srs.js';
import * as plan from '../plan.js';

export function destroy() {}

export async function render(root, ctx) {
  const st = plan.status();
  if (!st) { renderIdle(root, ctx); return; }
  if (st.finished) { renderFinished(root, ctx, st); return; }
  renderActive(root, ctx, st);
}

/* ------------------------------ 未啟動 ------------------------------ */

function renderIdle(root, ctx) {
  const today = srs.today();
  const suggested = srs.addDays(today, plan.LENGTH - 1);
  const input = el('input', { type: 'date', value: suggested, min: today });

  append(root,
    card(
      el('h3', { text: '六週面試衝刺' }),
      p('把每日任務換成倒數 42 天的課表。各主題同時進行——單字、閱讀、聽力、Email、跟讀、面試題每週都會輪到，週與週之間變的是面試題練哪一類。', 'small'),
      p('一天仍然只有三項、仍然自動判定，不用打勾。', 'small dim'),
      div({ class: 'kv' },
        el('span', { class: 'small', text: '面試日期' }),
        input,
      ),
      p('還沒排到面試就先用預設的六週；之後知道確切日期再回來改，課表會自動對齊終點。', 'small dim'),
      el('button', { class: 'btn primary block', onClick: start }, '開始衝刺'),
    ),
    weekTable(),
    p('真正的對答練習排在 SPEAKING.md 的 S6–S9，用 Claude 語音模式跑；App 只負責每天的基本功。', 'small dim center'),
  );

  function start() {
    const target = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || target < today) {
      window.alert('請選一個今天或以後的日期。');
      return;
    }
    // start 記實際啟動日；課表第幾天一律由 target 反推（SPEC §4.11）
    store.startSprint(today, target);
    ctx.navigate('#/sprint');
    location.reload();
  }
}

/* ------------------------------ 進行中 ------------------------------ */

function renderActive(root, ctx, st) {
  append(root,
    countdownCard(st),
    st.voice ? voiceCard(st.voice, st) : null,
    milestoneCard(st),
    h2('每週固定節奏'),
    rhythmCard(st),
    h2('六週地圖'),
    weekTable(st),
    h2('語音模擬日'),
    voiceList(st),
    h2('調整'),
    adjustCard(ctx, st),
  );
}

function countdownCard(st) {
  const ratio = st.dayIndex / plan.LENGTH;
  const bar = div({ class: 'today-bar' });
  bar.append(el('i', { style: `width:${Math.round(ratio * 100)}%` }));

  return div({ class: 'card today' },
    div({ class: 'today-head' },
      div({},
        el('div', { class: 'today-title', text: st.isTargetDay ? '面試就是今天' : `距離面試 ${st.daysLeft} 天` }),
        el('div', { class: 'small dim', text: `${st.target}　·　第 ${st.week.week} 週：${st.week.title}` }),
      ),
      el('div', { class: 'today-count' },
        el('b', { text: String(st.dayIndex) }),
        el('span', { text: ` / ${plan.LENGTH}` }),
      ),
    ),
    bar,
    p(st.week.focus, 'small'),
  );
}

function milestoneCard(st) {
  const weekEnd = dayDate(st, st.week.to);
  return card(
    el('div', { class: 'small dim', text: `第 ${st.week.week} 週里程碑　·　${weekEnd} 前` }),
    el('div', { class: 'iv-core', text: st.week.milestone }),
    p('App 不會自動判定這一項——這是要你自己生出來的東西，寫在哪裡都行。', 'small dim'),
  );
}

function voiceCard(voice, st) {
  return div({ class: 'card streak-alert' },
    el('div', { class: 'title', text: `🎙 今天是語音模擬日　${voice.code} ${voice.title}` }),
    el('div', { class: 'small', text: voice.focus }),
    el('div', { class: 'small', text: '開 Claude 語音模式，唸出啟動語即可開始。這一項不列入今日任務。' }),
  );
}

/**
 * 本週七天各練什麼。直接從課表數出來，不要手寫死——
 * 改了 plan.js 的骨架這裡就會跟著變，不會對不上。
 */
function rhythmCard(st) {
  const NAMES = {
    interview: '面試題', reading: '閱讀', listen: '聽力',
    cloze: 'Email', shadow: '跟讀', loopSec: '循環聽',
  };
  const tally = new Map();
  for (let d = st.week.from; d <= st.week.to; d++) {
    for (const s of plan.specs(d)) {
      const key = s.href === '#/interview/mock' ? '模擬面試' : NAMES[s.kind];
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }

  const box = card(
    p('這七天的分配。每一週都是同一張骨架，所有主題同時進行——不會有「這週只練面試、下週才碰聽力」。', 'small dim'),
  );
  const row = div({ class: 'rhythm' });
  row.append(chip('單字', '每天'));
  for (const [name, n] of tally) row.append(chip(name, `${n} 天`));
  box.append(row);
  append(box, p('第一項固定是單字（含例句跟讀），另外兩項照上面的分配輪。', 'small dim'));
  return box;

  function chip(name, n) {
    return div({ class: 'rhythm-chip' },
      el('span', { class: 'rc-n', text: name }),
      el('span', { class: 'rc-x', text: n }),
    );
  }
}

/** 六週地圖。有 st 就標出今天在哪一週並補上日期區間。 */
function weekTable(st) {
  const box = div({ class: 'card sprint-map' });
  for (const w of plan.WEEKS) {
    const now = !!st && st.week.week === w.week;
    const range = st ? `${dayDate(st, w.from)} – ${dayDate(st, w.to)}` : `第 ${w.from}–${w.to} 天`;
    box.append(div({ class: 'sprint-week', 'data-now': now ? '1' : '0' },
      div({ class: 'kv' },
        el('span', { class: 'sw-n', text: `W${w.week}` }),
        el('span', { class: 'small dim', text: range }),
      ),
      el('div', { class: 'sw-t', text: w.title }),
      el('div', { class: 'small dim', text: w.milestone }),
    ));
  }
  return box;
}

function voiceList(st) {
  const box = div({ class: 'card menu' });
  for (const v of plan.voiceSessions()) {
    const date = dayDate(st, v.day);
    const past = date < st.day;
    const today = date === st.day;
    box.append(el('a', { href: '#/sprint', 'aria-disabled': past ? 'true' : null, style: 'cursor:default' },
      el('span', { text: `${v.code}　${v.title}` }),
      el('span', { class: 'sub', text: `${date}${today ? '　←　今天' : ''}　·　${v.focus}` }),
    ));
  }
  append(box, p('場景腳本在 repo 的 SPEAKING.md，不在 App 裡（附錄 B）。', 'small dim'));
  return box;
}

function adjustCard(ctx, st) {
  const input = el('input', { type: 'date', value: st.target, min: st.day });
  const newPerDay = store.settings().newPerDay;

  return card(
    div({ class: 'kv' },
      el('span', { class: 'small', text: '面試日期' }),
      input,
    ),
    el('button', { class: 'block', onClick: save }, '更新日期'),
    p('改日期會讓課表重新對齊終點：日期提前就直接跳到對應的天數，不會從第 1 天重來。', 'small dim'),

    newPerDay > 5
      ? div({ style: 'margin-top:12px' },
          el('div', { class: 'small', text: `建議：衝刺期間把「每日新字」從 ${newPerDay} 降到 5，把時間留給面試題。` }),
          el('a', { class: 'btn ghost block', href: '#/settings' }, '去設定調整'),
        )
      : null,

    el('button', { class: 'block ghost', style: 'margin-top:12px', onClick: stop }, '結束衝刺'),
    p('結束後每日任務會回到星期輪替，練習紀錄不會消失。', 'small dim'),
  );

  function save() {
    const v = input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < st.day) {
      window.alert('請選一個今天或以後的日期。');
      return;
    }
    store.setSprintTarget(v);
    location.reload();
  }

  function stop() {
    if (!confirmDialog('結束衝刺？每日任務會回到星期輪替。')) return;
    store.endSprint();
    ctx.navigate('#/home');
    location.reload();
  }
}

/* ------------------------------ 已結束 ------------------------------ */

function renderFinished(root, ctx, st) {
  append(root,
    card(
      el('h3', { text: '衝刺結束' }),
      p(`面試日 ${st.target} 已經過了。每日任務已經自動回到星期輪替。`, 'small'),
      el('button', {
        class: 'btn primary block',
        onClick: () => { store.endSprint(); ctx.navigate('#/sprint'); location.reload(); },
      }, '清掉這次衝刺'),
      p('要再排一次就先清掉，再重新設定日期。', 'small dim'),
    ),
    weekTable(),
  );
}

/* ------------------------------ 小工具 ------------------------------ */

/** 課表第 n 天是哪一天（由終點反推，與 plan.status 的規則一致）。 */
function dayDate(st, n) {
  return srs.addDays(st.target, n - plan.LENGTH);
}
