// views/soon.js — M2 模組佔位（路由先接好，做完再換掉）

import { el, card, p } from '../dom.js';

const NOTE = {
  'Email 句型': '30 組情境句型 ＋ cloze 填空練習。',
  '簡報句型': '40 句簡報用語 ＋ 跟讀評分 ＋ 10 句模擬簡報。',
  '聽力': '對話播放器（雙 voice、0.8×–1.2×）＋ 理解題 ＋ 數字聽寫。',
};

export async function render(root, ctx) {
  const name = ctx.meta?.name || '這個模組';
  root.append(
    card(
      el('h3', { text: `${name}（${ctx.meta?.milestone || 'M2'} 施工中）` }),
      p(NOTE[name] || '規格見 SPEC.md 第 4 節。', 'small dim'),
      p('M1 先把單字 SRS、閱讀、進度備份與 TTS 做穩，這三個模組在 M2 一起上。', 'small dim'),
    ),
    el('a', { class: 'btn block ghost', href: '#/home' }, '回首頁'),
  );
}
