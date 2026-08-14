// views/loop.js — 循環聽：把常用句一直重複播放（洗耳朵用，可以不看螢幕）
// SPEC §4.5.1。這裡只用 TTS，不需要網路（STT 才需要）。
// M5：加上背景播放嘗試（js/wake.js）與播放時數累計（每日任務用）。

import { el, div, card, p, append } from '../dom.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import * as content from '../content.js';
import * as wake from '../wake.js';

const SOURCES = [
  { key: 'present',   label: '簡報句型' },
  { key: 'email',     label: 'Email 常用句' },
  { key: 'interview', label: '面試關鍵句' },
  { key: 'vocab',     label: '單字例句（學過的）' },
  { key: 'mix',       label: '全部混合' },
];

let playing = false;
let token = 0;          // 每次重新開始就換 token，舊迴圈自己結束
let detach = null;      // 移除 visibilitychange 監聽

export function destroy() {
  playing = false;
  token++;
  detach?.();
  detach = null;
  wake.stop();
  speech.cancel();
}

export async function render(root, ctx) {
  const [present, emails, interview, vocab] = await Promise.all([
    content.presentation().catch(() => []),
    content.emails().catch(() => []),
    content.interview().catch(() => []),
    content.vocab().catch(() => []),
  ]);

  const pools = buildPools({ present, emails, interview, vocab });

  let source = 'present';
  let list = pools[source];
  let idx = 0;
  let shuffled = false;

  const st = store.settings();
  let repeat = Number(st.loopRepeat) || 2;
  let gap = Number(st.loopGap ?? 1);
  let background = st.loopBackground !== false;
  let showZh = true;

  /* ---------------- 畫面 ---------------- */

  const sourceSel = el('select', {
    'aria-label': '句子來源',
    onChange: e => {
      source = e.target.value;
      list = shuffled ? shuffle(pools[source]) : pools[source];
      idx = 0;
      stop();
      paint();
    },
  }, ...SOURCES.map(s => el('option', { value: s.key, text: `${s.label}（${pools[s.key].length}）` })));

  const enEl = el('div', { class: 'loop-en' });
  const zhEl = el('div', { class: 'loop-zh small dim' });
  const metaEl = el('div', { class: 'loop-meta small dim' });
  const noteEl = el('div', { class: 'loop-note small' });

  const playBtn = el('button', { class: 'primary', onClick: toggle }, '▶ 開始');
  const prevBtn = el('button', { class: 'ghost', onClick: () => jump(-1) }, '⏮');
  const nextBtn = el('button', { class: 'ghost', onClick: () => jump(1) }, '⏭');

  const bgBtn = el('button', {
    class: 'ghost',
    onClick: e => {
      background = !background;
      store.setSetting('loopBackground', background);
      e.currentTarget.textContent = background ? '嘗試' : '不嘗試';
      if (!background) wake.stop();
      paintNote();
    },
  }, background ? '嘗試' : '不嘗試');

  append(root,
    card(
      div({ class: 'filters' }, sourceSel),
      div({ class: 'loop-stage' }, enEl, zhEl, metaEl),
      div({ class: 'row' }, prevBtn, playBtn, nextBtn),
      noteEl,
    ),

    card(
      settingRow('每句重複', [1, 2, 3], () => repeat, v => { repeat = v; store.setSetting('loopRepeat', v); }),
      settingRow('句間停頓（秒）', [0, 1, 2, 3], () => gap, v => { gap = v; store.setSetting('loopGap', v); }),
      div({ class: 'kv' },
        el('span', { text: '顯示中文' }),
        el('button', {
          class: 'ghost',
          onClick: e => { showZh = !showZh; e.currentTarget.textContent = showZh ? '顯示中' : '已隱藏'; paint(); },
        }, '顯示中'),
      ),
      div({ class: 'kv' },
        el('span', { text: '隨機順序' }),
        el('button', {
          class: 'ghost',
          onClick: e => {
            shuffled = !shuffled;
            list = shuffled ? shuffle(pools[source]) : pools[source];
            idx = 0;
            e.currentTarget.textContent = shuffled ? '隨機' : '照順序';
            paint();
          },
        }, '照順序'),
      ),
      div({ class: 'kv' },
        el('span', { text: '關螢幕繼續播' }),
        bgBtn,
      ),
      p('「關螢幕繼續播」會播一段幾乎無聲的音軌把 iOS 的音訊通道抓住，並在鎖定畫面放上播放控制。'
        + 'iOS 沒有正式支援網頁背景朗讀，所以這是盡力而為——若你的 iOS 版本不吃，鎖屏還是會停。', 'small dim'),
    ),

    p('通勤或做別的事時開著，重複到句子自己會從嘴巴跑出來為止。', 'small dim'),
  );

  paint();
  paintNote();

  /* 回到前景時：拿回 wakeLock；若被系統中斷就接著播下去 */
  const onVis = () => {
    if (document.visibilityState !== 'visible') { flushSeconds(); return; }
    wake.reacquireWakeLock();
    if (playing && !speech.speaking()) {
      noteEl.textContent = '⚠️ 剛剛被系統中斷了，已從這一句接著播。';
      noteEl.className = 'loop-note small warn-text';
      run(++token);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  detach = () => document.removeEventListener('visibilitychange', onVis);

  /* ---------------- 播放時數（每日任務用） ---------------- */

  let acc = 0;          // 尚未寫進 store 的秒數
  let lastTick = 0;

  function markTick() { lastTick = Date.now(); }

  function flushSeconds(force = false) {
    if (lastTick) {
      acc += (Date.now() - lastTick) / 1000;
      lastTick = playing ? Date.now() : 0;
    }
    if (acc < (force ? 1 : 20)) return;
    const n = Math.round(acc);
    acc = 0;
    import('../srs.js').then(srs => store.logDaily(srs.today(), 'loopSec', n));
  }

  /* ---------------- 播放 ---------------- */

  function paint() {
    const item = list[idx];
    enEl.textContent = item ? item.en : '這個來源還沒有句子';
    zhEl.textContent = showZh && item ? item.zh || '' : '';
    metaEl.textContent = item ? `${idx + 1} / ${list.length}` : '';
  }

  function paintNote() {
    if (!background) {
      noteEl.className = 'loop-note small dim';
      noteEl.textContent = '關螢幕會停止朗讀（已關閉背景播放嘗試）。';
      return;
    }
    noteEl.className = 'loop-note small dim';
    noteEl.textContent = wake.mediaSessionSupported()
      ? '鎖定畫面可以按上一句／下一句。'
      : '這個瀏覽器沒有鎖定畫面控制，關螢幕多半會停。';
  }

  function toggle() {
    if (playing) stop(); else start();
  }

  function start() {
    if (!list.length) return;
    speech.unlock();                 // iOS：一定要在點擊的同步呼叫鏈裡解鎖
    if (background) {
      wake.start(mediaMeta(), {      // 同上，也必須是同步呼叫
        onPlay: () => { if (!playing) start(); },
        onPause: () => stop(),
        onNext: () => jump(1),
        onPrev: () => jump(-1),
      });
    }
    playing = true;
    playBtn.textContent = '⏸ 暫停';
    paintNote();
    markTick();
    run(++token);
  }

  function stop() {
    playing = false;
    token++;
    playBtn.textContent = '▶ 開始';
    flushSeconds(true);
    lastTick = 0;
    wake.stop();
    speech.cancel();
  }

  function jump(step) {
    const wasPlaying = playing;
    stop();
    idx = (idx + step + list.length) % list.length;
    paint();
    if (wasPlaying) start();
  }

  function mediaMeta() {
    const item = list[idx];
    return {
      title: item ? item.en : 'FabEnglish 循環聽',
      artist: SOURCES.find(s => s.key === source)?.label || 'FabEnglish',
    };
  }

  async function run(myToken) {
    while (playing && myToken === token) {
      const item = list[idx];
      if (!item) break;
      paint();
      if (background) wake.setMeta(mediaMeta());

      for (let r = 0; r < repeat; r++) {
        if (!playing || myToken !== token) return;
        metaEl.textContent = `${idx + 1} / ${list.length}　·　第 ${r + 1} 次 / 共 ${repeat} 次`;
        const res = await speech.speak(item.en, { lang: 'en-US' });
        if (res?.cancelled || !playing || myToken !== token) return;
        flushSeconds();
        if (gap > 0) await sleep(gap * 1000);
      }

      if (!playing || myToken !== token) return;
      idx = (idx + 1) % list.length;
    }
  }
}

/* ---------------- 句庫 ---------------- */

function buildPools({ present, emails, interview, vocab }) {
  const st = store.get();

  const p = present.filter(i => i.shadow).map(i => ({ en: i.en, zh: i.zh }));

  const e = emails.map(i => ({ en: i.filled_example, zh: i.pattern_zh }));

  // 面試用 key_phrases：本來就是「英文句＋中譯」的成對短句，最適合洗耳朵
  const iv = [];
  for (const item of interview) {
    for (const k of item.key_phrases || []) iv.push({ en: k.en, zh: k.zh });
    if (item.core) iv.push({ en: item.core, zh: item.q_zh });
  }

  // 單字例句：優先只放學過的字，還沒開始學就先給前 60 個
  const learned = vocab.filter(v => st.srs[v.id]);
  const v = (learned.length ? learned : vocab.slice(0, 60))
    .map(i => ({ en: i.example, zh: i.example_zh }));

  const clean = arr => arr.filter(x => x && typeof x.en === 'string' && x.en.trim().length);

  const pools = { present: clean(p), email: clean(e), interview: clean(iv), vocab: clean(v) };
  pools.mix = [...pools.present, ...pools.email, ...pools.interview, ...pools.vocab];
  return pools;
}

function settingRow(label, values, get, set) {
  const row = div({ class: 'rate-group' });
  const buttons = values.map(v => el('button', {
    'aria-pressed': String(get() === v),
    onClick: () => {
      set(v);
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(values[i] === v)));
    },
  }, String(v)));
  row.append(...buttons);
  return div({ style: 'margin-bottom:10px' },
    el('div', { class: 'small dim', style: 'margin-bottom:4px', text: label }),
    row,
  );
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
