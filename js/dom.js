// dom.js — 極簡 DOM 建構工具（避免整份 innerHTML 拼字串，順便防 XSS）

/**
 * el('div', {class:'card'}, '文字', el('b', {}, '粗體'))
 * 屬性：class / text / html / on{Event} / dataset / 其餘 setAttribute
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && typeof node[k] !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

/**
 * 安全版 append：會濾掉 null / undefined / false。
 * ⚠ 一定要用這個，不要用原生 node.append(a, null, b)——原生會把 null 印成文字「null」。
 */
export function append(node, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const div = (props, ...kids) => el('div', props, ...kids);
export const card = (...kids) => el('div', { class: 'card' }, ...kids);
export const h2 = (t) => el('h2', { text: t });
export const p = (t, cls) => el('p', { class: cls, text: t });

export function button(label, props = {}) {
  return el('button', props, label);
}

export function link(href, label, props = {}) {
  return el('a', { href, ...props }, label);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 🔊 按鈕（樣式統一） */
export function speakerButton(props = {}) {
  return el('button', { class: 'icon-btn ghost', 'aria-label': '播放發音', ...props }, '🔊');
}

/** 簡單確認框，回傳 boolean。 */
export function confirmDialog(message) {
  return window.confirm(message);
}
