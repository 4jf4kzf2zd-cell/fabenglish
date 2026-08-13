// sw.js — 靜態資源 cache-first；content/*.json 用 stale-while-revalidate
// 改版時把 VERSION 加一，舊 cache 會在 activate 時清掉。

const VERSION = 'v3';
const STATIC_CACHE = `fabenglish-static-${VERSION}`;
const CONTENT_CACHE = `fabenglish-content-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/srs.js',
  './js/speech.js',
  './js/content.js',
  './js/dom.js',
  './js/scoring.js',
  './js/shadow.js',
  './js/weakness.js',
  './js/badge.js',
  './js/views/home.js',
  './js/views/vocab.js',
  './js/views/reading.js',
  './js/views/email.js',
  './js/views/present.js',
  './js/views/listen.js',
  './js/views/progress.js',
  './js/views/settings.js',
  './content/vocab.json',
  './content/readings.json',
  './content/email_patterns.json',
  './content/presentation.json',
  './content/listening.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // 個別 add，單一檔案 404 不會讓整個安裝失敗
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(err => console.warn('[sw] 預快取失敗', url, err))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('fabenglish-') && k !== STATIC_CACHE && k !== CONTENT_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/content/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // SPA 導覽：離線時回 index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (_) {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('離線且沒有快取', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CONTENT_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await network) || new Response('{"version":1,"items":[]}', {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
}
