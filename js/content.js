// content.js — 載入 content/*.json 並快取（同一次 session 只抓一次）。

const cache = new Map();
const BASE = new URL('../content/', import.meta.url);

/**
 * @param {string} name 檔名（不含 .json）
 * @returns {Promise<{version:number, items:Array}>}
 */
export async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const p = fetch(new URL(`${name}.json`, BASE), { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`載入 content/${name}.json 失敗（HTTP ${res.status}）`);
      return res.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data.items)) throw new Error(`content/${name}.json 格式錯誤：缺少 items`);
      return data;
    })
    .catch(err => { cache.delete(name); throw err; });
  cache.set(name, p);
  return p;
}

export async function items(name) {
  return (await load(name)).items;
}

export const vocab = () => items('vocab');
export const readings = () => items('readings');
export const emails = () => items('email_patterns');
export const presentation = () => items('presentation');
export const listening = () => items('listening');

export function byId(list, id) {
  return list.find(x => x.id === id) || null;
}
