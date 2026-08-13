// views/settings.js — TTS voice / 語速 / 每日新字量 / 開發者模式

import { el, div, card, h2, p, confirmDialog, speakerButton, append } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as badge from '../badge.js';

const SAMPLE = 'Sort yield trended up by 2.3 points after the fix was implemented in WW32.';

export function destroy() { speech.cancel(); }

export async function render(root, ctx) {
  await speech.ready();          // SPEC §5-2：等 voices 載入再畫下拉
  const s = store.settings();
  const voices = speech.enVoices();

  /* --- voice --- */
  const voiceSel = el('select', {
    onChange: e => { store.setSetting('voice', e.target.value); },
  },
    el('option', { value: 'auto', text: `自動（${speech.pickVoice()?.name || '無可用語音'}）` }),
    ...voices.map(v => el('option', { value: v.voiceURI, text: `${v.name}（${v.lang}）${v.localService ? ' · 本機' : ''}` })),
  );
  voiceSel.value = voices.some(v => v.voiceURI === s.voice) ? s.voice : 'auto';

  const testBtn = speakerButton({ class: 'icon-btn' });
  speech.bindPlayButton(testBtn, () => SAMPLE);

  /* --- rate --- */
  const rateOut = el('span', { class: 'dim small', text: fmtRate(s.rate) });
  const rateInput = el('input', {
    type: 'range', min: '0.8', max: '1.2', step: '0.1', value: String(speech.clampRate(s.rate)),
    onInput: e => { rateOut.textContent = fmtRate(e.target.value); },
    onChange: e => { store.setSetting('rate', Number(e.target.value)); },
  });

  /* --- newPerDay --- */
  const newInput = el('input', {
    type: 'number', min: '1', max: '50', step: '1', value: String(s.newPerDay),
    onChange: e => {
      const v = Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 10)));
      e.target.value = String(v);
      store.setSetting('newPerDay', v);
    },
  });

  /* --- dev --- */
  const devChk = el('input', {
    type: 'checkbox', checked: !!s.dev,
    onChange: e => { store.setSetting('dev', e.target.checked); },
  });

  append(root,
    h2('語音'),
    card(
      speech.ttsSupported ? null : p('⚠️ 這個瀏覽器不支援語音合成，播放按鈕會停用。', 'small'),
      el('label', { class: 'field' }, el('span', { text: '英文語音（voice）' }), voiceSel),
      div({ class: 'row', style: 'align-items:center;margin-bottom:14px' },
        el('div', { class: 'small dim', style: 'flex:1' }, '試聽一句簡報用語'),
        testBtn,
      ),
      el('label', { class: 'field' },
        el('span', {}, '語速　', rateOut),
        rateInput,
        el('span', { class: 'small dim', text: 'iOS 實測超出 0.8×–1.2× 會失真，因此只開放這個範圍。' }),
      ),
    ),

    h2('學習'),
    card(
      el('label', { class: 'field' },
        el('span', { text: '每日新字上限' }),
        newInput,
        el('span', { class: 'small dim', text: '複習永遠優先，額度只限制「新字」。' }),
      ),
    ),

    h2('提醒'),
    badgeCard(),

    h2('其他'),
    card(
      el('label', { class: 'field', style: 'display:flex;align-items:center;gap:10px' },
        devChk,
        el('span', { style: 'margin:0', text: '開發者模式（首頁顯示時間旅行工具）' }),
      ),
      p(`儲存空間：${store.isWritable() ? '正常' : '⚠️ 無法寫入，進度不會被保存'}`, 'small dim'),
      el('button', { class: 'block danger', onClick: reset }, '清除所有進度'),
    ),

    p(`FabEnglish · M1 · schema v${store.get().schemaVersion}`, 'small dim center'),
  );

  function reset() {
    if (!confirmDialog('確定要清除所有進度嗎？此動作無法復原。')) return;
    if (!confirmDialog('再確認一次：所有單字排程與閱讀紀錄都會消失。')) return;
    store.resetAll();
    location.reload();
  }
}

function fmtRate(r) {
  return `${Number(r).toFixed(1)}×`;
}

/** PWA 圖示待複習數（App Badging API），不支援就說清楚為什麼。 */
function badgeCard() {
  const s = store.settings();
  const box = card();

  if (!badge.supported()) {
    box.append(
      el('h3', { text: '待複習數字提醒' }),
      p('這個瀏覽器不支援在 App 圖示上顯示數字。iOS 需要 16.4 以上，而且要先把網站「加到主畫面」再從圖示開啟。', 'small dim'),
    );
    return box;
  }

  const chk = el('input', {
    type: 'checkbox', checked: !!s.badge,
    onChange: async e => {
      store.setSetting('badge', e.target.checked);
      if (e.target.checked) {
        if (badge.permission() === 'default') await badge.requestPermission();
        await badge.refresh();
      } else {
        await badge.clear();
      }
      status.textContent = statusText();
    },
  });

  const status = el('p', { class: 'small dim', text: statusText() });

  box.append(
    el('label', { class: 'field', style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px' },
      chk,
      el('span', { style: 'margin:0', text: '在 App 圖示顯示今日待複習數' }),
    ),
    status,
    el('button', {
      class: 'block ghost',
      onClick: async () => {
        if (badge.permission() === 'default') await badge.requestPermission();
        await badge.refresh();
        status.textContent = statusText();
      },
    }, '重新整理圖示數字'),
  );
  return box;

  function statusText() {
    const perm = badge.permission();
    if (!store.settings().badge) return '已關閉。';
    if (perm === 'denied') return '⚠️ 通知權限被拒絕，iOS 上圖示數字不會出現。請到「設定 > 通知」允許。';
    if (perm === 'default') return '尚未取得通知權限，第一次開啟時系統會詢問。';
    return '已開啟。數字＝今日待複習＋新字的總數。';
  }
}
