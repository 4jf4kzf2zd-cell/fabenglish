// daily.js — 每日任務（M5）
// 「今天要做什麼」的唯一真相來源：首頁、badge、進度頁都從這裡拿。
// 純計算，不碰畫面；今天一律走 srs.today()，才吃得到 dev 的時間旅行。

import * as store from './store.js';
import * as srs from './srs.js';

/**
 * 每天固定一項「清單字」，再依星期加兩項。
 * 目標時間 20–30 分鐘（SPEC §0），所以一天最多三項，不要再加。
 */
const ROUTINE = {
  0: [{ kind: 'interview', target: 3 }, { kind: 'loopSec', target: 300 }],
  1: [{ kind: 'listen', target: 1 }, { kind: 'loopSec', target: 300 }],
  2: [{ kind: 'reading', target: 1 }, { kind: 'shadow', target: 5 }],
  3: [{ kind: 'cloze', target: 2 }, { kind: 'loopSec', target: 300 }],
  4: [{ kind: 'reading', target: 1 }, { kind: 'interview', target: 2 }],
  5: [{ kind: 'shadow', target: 8 }, { kind: 'listen', target: 1 }],
  6: [{ kind: 'listen', target: 1 }, { kind: 'reading', target: 1 }],
};

const META = {
  vocab:     { href: '#/vocab',     label: n => `清完今日單字 ${n} 張`, unit: '張', hint: '複習優先，新字排在後面。' },
  reading:   { href: '#/reading',   label: n => `讀 ${n} 篇文章`,       unit: '篇', hint: '重點在 key patterns，不是讀懂而已。' },
  cloze:     { href: '#/email',     label: n => `Email 填空 ${n} 組`,   unit: '組', hint: '寫完真的信可以貼給 Claude 批改。' },
  shadow:    { href: '#/present',   label: n => `跟讀 ${n} 句`,         unit: '句', hint: '不給分數，看逐字上色就好。' },
  listen:    { href: '#/listen',    label: n => `聽 ${n} 段對話`,       unit: '段', hint: '先盲聽再開字幕，最後練數字聽寫。' },
  interview: { href: '#/interview', label: n => `面試 ${n} 題`,         unit: '題', hint: '先自己答一次再看範答。' },
  loopSec:   { href: '#/loop',      label: n => `循環聽 ${Math.round(n / 60)} 分鐘`, unit: '秒', hint: '通勤時開著就好，不用看螢幕。' },
};

/**
 * 今天的任務清單。
 * @param {Array} vocabItems content/vocab.json 的 items（用來算還有幾張卡）
 * @param {string} [day] 預設 srs.today()
 * @returns {{day:string, tasks:Array, doneCount:number, total:number, allDone:boolean, nextHref:string|null}}
 */
export function today(vocabItems = [], day = srs.today()) {
  const log = store.dayLog(day);
  const dow = srs.parseYmd(day).getDay();

  // 單字的目標＝今天已經做掉的 ＋ 現在還到期的。
  // 這樣使用者邊做邊看，目標不會因為卡片被清掉而縮水，也不必另外存「今天原本有幾張」。
  // （todayCounts 永遠算「現在」，所以 day 傳別天時單字目標不準——只有首頁會傳別天，不影響）
  const doneVocab = log.vocab || 0;
  const remain = srs.todayCounts(vocabItems).total;
  const vocabTarget = doneVocab + remain;

  const specs = [{ kind: 'vocab', target: vocabTarget }, ...(ROUTINE[dow] || [])];

  const tasks = specs.map(spec => {
    const done = Math.min(log[spec.kind] || 0, spec.target);
    const meta = META[spec.kind];
    return {
      kind: spec.kind,
      href: meta.href,
      label: meta.label(spec.target),
      hint: meta.hint,
      unit: meta.unit,
      done,
      target: spec.target,
      // 目標是 0（例如今天沒有到期單字）就直接算完成
      complete: spec.target === 0 || done >= spec.target,
    };
  });

  const doneCount = tasks.filter(t => t.complete).length;
  const next = tasks.find(t => !t.complete) || null;

  return {
    day,
    tasks,
    doneCount,
    total: tasks.length,
    allDone: doneCount === tasks.length,
    nextHref: next ? next.href : null,
  };
}

/** badge 用：今天還沒完成幾項。 */
export function remaining(vocabItems = [], day = srs.today()) {
  const t = today(vocabItems, day);
  return t.total - t.doneCount;
}

/** 進度頁用：最近 n 天有沒有完成當天任務（只看有紀錄的天，不回推）。 */
export function history(vocabItems = [], days = 14) {
  const out = [];
  const t = srs.today();
  for (let i = days - 1; i >= 0; i--) {
    const day = srs.addDays(t, -i);
    const log = store.dayLog(day);
    const touched = Object.keys(log).length > 0;
    // 過去的日子沒辦法重算「當天有幾張卡到期」，所以只用「有沒有練」當作訊號
    out.push({ day, touched, isToday: day === t });
  }
  return out;
}
