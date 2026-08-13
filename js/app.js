// app.js — hash routing + 初始化

import * as store from './store.js';
import * as speech from './speech.js';

import * as home from './views/home.js';
import * as vocab from './views/vocab.js';
import * as reading from './views/reading.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';
import * as email from './views/email.js';
import * as present from './views/present.js';
import * as listen from './views/listen.js';

const routes = {
  '/home':     { view: home,     title: 'FabEnglish' },
  '/vocab':    { view: vocab,    title: '單字 SRS' },
  '/reading':  { view: reading,  title: '閱讀' },
  '/email':    { view: email,    title: 'Email 句型' },
  '/present':  { view: present,  title: '簡報句型' },
  '/listen':   { view: listen,   title: '聽力' },
  '/progress': { view: progress, title: '進度' },
  '/settings': { view: settings, title: '設定' },
};

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
const actionsEl = document.getElementById('topbar-actions');
const bannerEl = document.getElementById('banner');

let current = null;

/** 是否為開發模式：localhost、?dev=1 或設定裡打開。 */
export function isDev() {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
  if (new URLSearchParams(location.search).get('dev') === '1') return true;
  return !!store.settings().dev;
}

export function navigate(hash) {
  location.hash = hash.startsWith('#') ? hash : '#' + hash;
}

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const base = '/' + (segs[0] || 'home');
  return {
    base,
    params: segs.slice(1),
    query: new URLSearchParams(queryPart || ''),
  };
}

async function render() {
  const { base, params, query } = parseHash();
  const route = routes[base] || routes['/home'];

  // 換頁前把上一頁收乾淨（SPEC §5-4：一定要 cancel TTS）
  speech.cancel();
  if (current && typeof current.destroy === 'function') {
    try { current.destroy(); } catch (err) { console.warn('[app] destroy 失敗', err); }
  }
  current = route.view;

  titleEl.textContent = route.title;
  actionsEl.replaceChildren();
  viewEl.replaceChildren();
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);

  for (const a of document.querySelectorAll('#tabbar a')) {
    if (a.dataset.tab === base) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  const ctx = {
    params, query,
    navigate,
    isDev,
    setTitle: t => { titleEl.textContent = t; },
    actions: actionsEl,
    meta: route.meta || {},
  };

  const loading = document.createElement('p');
  loading.className = 'loading';
  loading.textContent = '載入中⋯';
  viewEl.append(loading);

  try {
    const frag = document.createDocumentFragment();
    await route.view.render(frag, ctx);
    viewEl.replaceChildren(frag);
  } catch (err) {
    console.error('[app] 畫面渲染失敗', err);
    viewEl.replaceChildren(errorCard(err));
  }
}

function errorCard(err) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = '<h3>載入失敗</h3><p class="small dim"></p>' +
    '<button class="block" onclick="location.reload()">重新載入</button>';
  div.querySelector('p').textContent = err?.message || String(err);
  return div;
}

/* ---------- 儲存空間警示 banner ---------- */

function showBanner(message) {
  if (!message) { bannerEl.hidden = true; bannerEl.replaceChildren(); return; }
  bannerEl.replaceChildren();
  const span = document.createElement('span');
  span.textContent = message;
  const btn = document.createElement('button');
  btn.textContent = '知道了';
  btn.addEventListener('click', () => { bannerEl.hidden = true; });
  bannerEl.append(span, btn);
  bannerEl.hidden = false;
}

window.addEventListener('fab:storage', e => showBanner(e.detail?.message));

/* ---------- 啟動 ---------- */

store.load();
if (!store.isWritable()) {
  showBanner('無法使用本機儲存空間（無痕模式？），本次進度不會被保存。');
}

window.addEventListener('hashchange', render);
window.addEventListener('pagehide', () => speech.cancel());

// voices 先暖機，之後點播放才不會抓不到 voice（SPEC §5-2）
speech.ready().catch(() => {});

// PWA 圖示上的待複習數字（不支援就安靜略過）
import('./badge.js').then(b => b.refresh()).catch(() => {});

if (!location.hash) location.hash = '#/home';
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url))
      .catch(err => console.warn('[app] service worker 註冊失敗', err));
  });
}
