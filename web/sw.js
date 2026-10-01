// 50 Gram service worker: ilova qobig'ini keshlaydi (oflayn ochiladi). API so'rovlari keshlanmaydi.
const V = '50gram-v7'
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'core.js', 'p2p.js', 'storage.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'logo.png', 'icon-192.png', 'icon-512.png', 'manifest.json']
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return
  // Avval tarmoq (yangi versiya), bo'lmasa kesh
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)) } return r }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))))
})
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./')))) })
