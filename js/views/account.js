// views/account.js — 帳號與多裝置同步（M7，SPEC §4.12）
//
// 這一頁只做三件事：連上帳號、看同步狀態、把另一台裝置也接進來。
// 沒連線時 App 的行為和以前完全一樣，所以這頁的文案要一直讓人知道「不連也沒差」。

import { el, div, card, h2, p, append, confirmDialog } from '../dom.js';
import * as store from '../store.js';
import * as sync from '../sync.js';

let onStatus = null;
let onSynced = null;

export function destroy() {
  if (onStatus) window.removeEventListener('fab:sync', onStatus);
  if (onSynced) window.removeEventListener('fab:synced', onSynced);
  onStatus = onSynced = null;
}

export async function render(root, ctx) {
  if (!sync.enabled()) {
    append(root, card(
      el('h3', { text: '同步未啟用' }),
      p('這個版本沒有設定同步伺服器，進度只存在這台裝置。', 'small dim'),
    ));
    return;
  }

  const statusLine = el('p', { class: 'small dim' });
  const body = div({});

  destroy();   // 重畫這一頁時先把上一輪的監聽拆掉
  onStatus = () => paintStatus(statusLine);
  onSynced = () => paint();
  window.addEventListener('fab:sync', onStatus);
  window.addEventListener('fab:synced', onSynced);

  append(root, h2('多裝置同步'), div({ class: 'card' }, statusLine), body);
  paint();

  function paint() {
    paintStatus(statusLine);
    body.replaceChildren(...(sync.linked() ? linkedCards() : idleCards()));
  }

  /* ---- 未連線 ---- */

  function idleCards() {
    const out = [];

    const googleBox = card();
    googleBox.append(
      el('h3', { text: '用 Google 帳號登入' }),
      p('登入後這台裝置的進度會和雲端合併，換手機、換電腦打開都是同一份。', 'small dim'),
    );
    if (sync.googleEnabled()) {
      const slot = div({ style: 'display:flex;justify-content:center;margin:12px 0' });
      googleBox.append(slot);
      sync.mountGoogleButton(slot, err => {
        if (err) { alert('登入失敗：' + err.message); return; }
        paint();
      }).catch(err => {
        slot.replaceChildren(el('p', { class: 'small warn-text', text: '⚠️ ' + err.message }));
      });
    } else {
      googleBox.append(p('⚠️ Google 登入尚未開通（伺服器還沒設定 OAuth 用戶端 ID）。'
        + '先用下面的方式一樣可以同步。', 'small warn-text'));
    }
    out.push(googleBox);

    /* 不用 Google 的路：這台先建同步、另一台輸入配對碼 */
    const startBtn = el('button', {
      class: 'block',
      onClick: async () => {
        startBtn.disabled = true;
        try {
          await sync.createAccount();
          paint();
        } catch (err) {
          alert('建立失敗：' + err.message);
          startBtn.disabled = false;
        }
      },
    }, '把這台裝置的進度開始同步');

    const codeInput = el('input', {
      type: 'text', placeholder: 'XXXX-XXXX', maxlength: '9',
      style: 'text-transform:uppercase;letter-spacing:2px',
    });
    const joinBtn = el('button', {
      class: 'block ghost',
      onClick: async () => {
        const code = codeInput.value.trim();
        if (!code) { codeInput.focus(); return; }
        if (!confirmDialog('這台裝置目前的進度會和另一台合併（不會覆蓋，兩邊都保留較好的紀錄）。要繼續嗎？')) return;
        joinBtn.disabled = true;
        try {
          await sync.claimLinkCode(code);
          paint();
        } catch (err) {
          alert('加入失敗：' + err.message);
        } finally {
          joinBtn.disabled = false;
        }
      },
    }, '用配對碼加入');

    out.push(card(
      el('h3', { text: '不用 Google 也可以' }),
      p('第一台按下面這顆開始同步，再到「產生配對碼」拿一組碼，在第二台輸入就綁在一起了。', 'small dim'),
      startBtn,
      el('div', { class: 'field', style: 'margin-top:16px' },
        el('span', { text: '已經有配對碼？' }),
        codeInput,
      ),
      joinBtn,
    ));

    out.push(noteCard());
    return out;
  }

  /* ---- 已連線 ---- */

  function linkedCards() {
    const a = store.auth();
    const out = [];

    const who = a.email || `裝置帳號 ${String(a.accountId || '').slice(-6)}`;
    out.push(card(
      el('h3', { text: '已連線' }),
      el('p', { class: 'big-line', text: who }),
      p(a.email ? 'Google 帳號' : '尚未綁定 Google（用配對碼建立的）', 'small dim'),
      el('button', {
        class: 'block',
        onClick: async e => {
          e.target.disabled = true;
          e.target.textContent = '同步中⋯';
          try { await sync.syncNow(); } catch (_) { /* 狀態列會顯示 */ }
          paint();
        },
      }, '立即同步'),
    ));

    // 已經用配對碼連線、但還沒綁 Google → 這裡可以升級成 Google 帳號，進度不會消失
    if (!a.email && sync.googleEnabled()) {
      const box = card(
        el('h3', { text: '綁定 Google 帳號' }),
        p('綁定後就算所有裝置都清空，用 Google 登入還是找得回來。目前的進度會保留。', 'small dim'),
      );
      const slot = div({ style: 'display:flex;justify-content:center;margin-top:12px' });
      box.append(slot);
      sync.mountGoogleButton(slot, err => {
        if (err) { alert('綁定失敗：' + err.message); return; }
        paint();
      }).catch(err => {
        slot.replaceChildren(el('p', { class: 'small warn-text', text: '⚠️ ' + err.message }));
      });
      out.push(box);
    }

    /* 產生配對碼 */
    const codeOut = el('p', { class: 'code-out', hidden: true });
    const genBtn = el('button', {
      class: 'block ghost',
      onClick: async () => {
        genBtn.disabled = true;
        try {
          const r = await sync.createLinkCode();
          codeOut.textContent = r.code;
          codeOut.hidden = false;
        } catch (err) {
          alert('產生失敗：' + err.message);
        } finally {
          genBtn.disabled = false;
        }
      },
    }, '產生配對碼');

    out.push(card(
      el('h3', { text: '加入另一台裝置' }),
      p('在另一台裝置開這一頁 →「用配對碼加入」，輸入下面這組碼。15 分鐘內有效，用過就失效。', 'small dim'),
      genBtn,
      codeOut,
    ));

    out.push(card(
      el('h3', { text: '中斷這台裝置' }),
      p('只斷開這台，本機進度原封不動留著；雲端那份也不會刪。', 'small dim'),
      el('button', {
        class: 'block danger',
        onClick: async () => {
          if (!confirmDialog('要中斷這台裝置的同步嗎？本機進度會留著。')) return;
          try { await sync.signOut(); } catch (_) {}
          paint();
        },
      }, '中斷同步'),
      p('要連雲端那份一起刪掉的話按下面這顆。各台裝置本機的進度都不會被刪。', 'small dim'),
      el('button', {
        class: 'block danger',
        onClick: async () => {
          if (!confirmDialog('要刪掉雲端那份進度嗎？所有裝置都會斷開同步。')) return;
          if (!confirmDialog('再確認一次：雲端備份會消失，各台本機的進度會留著。')) return;
          try { await sync.deleteCloud(); } catch (err) { alert('刪除失敗：' + err.message); }
          paint();
        },
      }, '刪除雲端資料'),
    ));

    out.push(noteCard());
    return out;
  }
}

function paintStatus(node) {
  const st = sync.getStatus();
  const a = store.auth();

  if (!a) {
    node.className = 'small dim';
    node.textContent = '目前沒有同步。進度只存在這台裝置——這樣完全可以用，換裝置就得靠「進度」頁的匯出／匯入。';
    return;
  }
  if (st.phase === 'error') {
    node.className = 'small warn-text';
    node.textContent = '⚠️ ' + (st.message || '同步失敗，等一下會自動再試。');
    return;
  }
  if (st.phase === 'syncing') {
    node.className = 'small dim';
    node.textContent = '同步中⋯';
    return;
  }
  node.className = 'small dim';
  node.textContent = a.lastSyncAt
    ? `最後同步：${fmtTime(a.lastSyncAt)}`
    : '已連線，尚未同步過。';
}

function fmtTime(ms) {
  const d = new Date(ms);
  const z = n => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${z(d.getHours())}:${z(d.getMinutes())}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function noteCard() {
  return card(
    el('h3', { text: '合併規則' }),
    p('兩台裝置的進度是「逐項取比較好的那個」合併，不是後上傳的蓋掉先上傳的：'
      + '單字排程取最近複習的那筆、分數取高的、閱讀與句型做過就是做過。', 'small dim'),
    p('唯一的取捨：同一天在兩台各做一半，每日任務的計數取較大值、不會相加。'
      + '一天三項本來就傾向在同一台做完，影響很小。', 'small dim'),
    p('雲端只存這包進度 JSON，沒有錄音、沒有練習內容。', 'small dim'),
  );
}
