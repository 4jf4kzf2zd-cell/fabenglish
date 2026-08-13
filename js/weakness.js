// weakness.js — 弱點清單：把進度裡「練不起來的東西」整理成 markdown
// 用途：貼回 Claude Project，請 Claude 針對這些弱點生成加強教材或口說題目。
// 純資料處理，不碰 DOM。

import * as store from './store.js';
import * as srs from './srs.js';

const SHADOW_WEAK = 80;      // 跟讀低於這個分數算弱點
const READING_WEAK = 0.7;    // 閱讀答對率低於這個算弱點
const LISTEN_WEAK = 0.7;

/**
 * @param {{vocab:Array, readings:Array, emails:Array, presentation:Array, listening:Array}} content
 * @returns {{markdown:string, counts:object, empty:boolean}}
 */
export function buildReport(content) {
  const st = store.get();
  const today = srs.today();

  const weakVocab = pickWeakVocab(content.vocab, st);
  const weakShadow = pickWeakShadow([...content.presentation, ...content.vocab], st);
  const weakReading = (content.readings || [])
    .map(r => ({ item: r, rec: st.readings[r.id] }))
    .filter(x => x.rec?.done && (x.rec.score ?? 1) < READING_WEAK)
    .sort((a, b) => (a.rec.score ?? 0) - (b.rec.score ?? 0));
  const weakListening = (content.listening || [])
    .map(l => ({ item: l, rec: st.listening[l.id] }))
    .filter(x => x.rec && (Math.min(x.rec.quiz ?? 1, x.rec.dictation ?? 1) < LISTEN_WEAK))
    .sort((a, b) => lowest(a.rec) - lowest(b.rec));
  const failedCloze = (content.emails || [])
    .filter(e => st.cloze[e.id] && !st.cloze[e.id].passed);

  const counts = {
    vocab: weakVocab.length,
    shadow: weakShadow.length,
    reading: weakReading.length,
    listening: weakListening.length,
    cloze: failedCloze.length,
  };
  const empty = Object.values(counts).every(n => n === 0);

  const lines = [];
  lines.push('# FabEnglish 弱點清單');
  lines.push('');
  lines.push(`- 產生日期：${today}`);
  lines.push(`- 連續練習：${st.streak.current || 0} 天（最佳 ${st.streak.best || 0} 天）`);
  lines.push(`- 已學單字：${Object.keys(st.srs).length} / ${content.vocab.length}`);
  lines.push('');

  if (empty) {
    lines.push('目前沒有偵測到明顯弱點。可能是練習量還不夠，先多練幾天再匯出一次。');
    lines.push('');
    return { markdown: lines.join('\n'), counts, empty };
  }

  if (weakVocab.length) {
    lines.push('## 一、記不住的單字');
    lines.push('');
    lines.push('| 單字 | 中譯 | 答錯次數 | 目前盒號 | 例句 |');
    lines.push('|---|---|---|---|---|');
    for (const { item, rec } of weakVocab) {
      lines.push(`| ${item.term} | ${item.zh} | ${rec.lapses || 0} | Box ${rec.box} | ${escapeCell(item.example)} |`);
    }
    lines.push('');
  }

  if (weakShadow.length) {
    lines.push('## 二、唸不好的句子（跟讀最佳分數偏低）');
    lines.push('');
    for (const { item, best } of weakShadow) {
      lines.push(`- **${best} 分** — ${sentenceOf(item)}`);
      const zh = item.zh || item.example_zh;
      if (zh) lines.push(`  - 中譯：${zh}`);
    }
    lines.push('');
  }

  if (weakReading.length) {
    lines.push('## 三、讀不懂的文章（理解題答對率偏低）');
    lines.push('');
    for (const { item, rec } of weakReading) {
      lines.push(`- **${Math.round((rec.score ?? 0) * 100)}%** — ${item.title}（${item.genre}, Lv${item.level}）`);
    }
    lines.push('');
  }

  if (weakListening.length) {
    lines.push('## 四、聽不清楚的對話');
    lines.push('');
    for (const { item, rec } of weakListening) {
      const q = rec.quiz != null ? `${Math.round(rec.quiz * 100)}%` : '—';
      const d = rec.dictation != null ? `${Math.round(rec.dictation * 100)}%` : '—';
      lines.push(`- ${item.title} — 理解 ${q}／聽寫 ${d}`);
    }
    lines.push('');
  }

  if (failedCloze.length) {
    lines.push('## 五、寫不出來的 Email 句型');
    lines.push('');
    for (const e of failedCloze) {
      lines.push(`- ${e.scenario_zh}：${e.pattern}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 給 Claude 的指令（直接複製這段）');
  lines.push('');
  lines.push('> 以上是我的英文弱點清單。請針對「一、記不住的單字」，用 NAND 原廠的真實工作情境重寫例句，');
  lines.push('> 每個字給兩句不同場景（一句 email、一句會議口說），句長 20 字以內、TOEIC 600–750 難度；');
  lines.push('> 針對「二、唸不好的句子」，指出我可能唸錯的音節與連音位置；');
  lines.push('> 最後出五題口說問答，逼我把這些字用出來。');
  lines.push('');

  return { markdown: lines.join('\n'), counts, empty };
}

function pickWeakVocab(items, st, limit = 20) {
  return items
    .map(item => ({ item, rec: st.srs[item.id] }))
    .filter(x => x.rec && (x.rec.lapses || 0) > 0)
    .sort((a, b) => (b.rec.lapses - a.rec.lapses) || (a.rec.box - b.rec.box))
    .slice(0, limit);
}

function pickWeakShadow(items, st, limit = 15) {
  return items
    .map(item => ({ item, best: st.shadow[item.id]?.best }))
    .filter(x => x.best != null && x.best < SHADOW_WEAK)
    .sort((a, b) => a.best - b.best)
    .slice(0, limit);
}

function sentenceOf(item) {
  return item.en || item.example || item.term || '';
}

function lowest(rec) {
  return Math.min(rec.quiz ?? 1, rec.dictation ?? 1);
}

function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

export function filename() {
  return `fabenglish-weakness-${srs.today().replace(/-/g, '')}.md`;
}
