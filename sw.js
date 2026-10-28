// -------------------------
// Service Worker（オフラインでも開けるようにする）
// 保存済みのファイルをすぐ返し、裏で新しいファイルを取ってきて差し替える
// （更新は次にアプリを開いたときに反映される）
// -------------------------

const CACHE = 'kakeibo-v1';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './vendor/chart.umd.min.js',
  './js/app.js',
  './js/store.js',
  './js/calc.js',
  './js/ui.js',
  './js/views/add.js',
  './js/views/history.js',
  './js/views/assets.js',
  './js/views/grad.js',
  './js/views/settings.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  // ブラウザの HTTP キャッシュを通さず、サーバーから最新を取ってくる
  const requests = APP_FILES.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      // "#/add" などのハッシュは URL に含まれないので、画面遷移は index.html を返せばよい
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
