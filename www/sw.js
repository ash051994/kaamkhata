// Offline cache for the web (PWA) version. The Android app ships these files inside the APK.
const CACHE = 'kaamkhata-v1';
const FILES = [
    './',
    './css/app.css',
    './icons/icon-1024.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './icons/maskable-512.png',
    './icons/maskable.svg',
    './index.html',
    './js/app.js',
    './js/db.js',
    './js/demo.js',
    './js/payroll.js',
    './js/pdf.js',
    './js/util.js',
    './js/views/attendance.js',
    './js/views/common.js',
    './js/views/home.js',
    './js/views/more.js',
    './js/views/reports.js',
    './js/views/staff.js',
    './js/views/wages.js',
    './js/voice.js',
    './manifest.webmanifest',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
