// 50 Gram service worker: ilova qobig'ini keshlaydi (oflayn ochiladi) + Telegram-uslubidagi Web Push.
const V = '50gram-v14'
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'core.js', 'p2p.js', 'storage.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'logo.png', 'icon-192.png', 'icon-512.png', 'manifest.json']
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return
  // Avval tarmoq (yangi versiya), bo'lmasa kesh
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cl = r.clone(); caches.open(V).then((c) => c.put(e.request, cl)) } return r }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))))
})

// ---------------- Web Push (ilova yopiq bo'lsa ham xabar yetadi) ----------------
// Sozlamalar ilovadan postMessage bilan keladi, IDB'da saqlanadi (SW qayta ishga tushsa ham qoladi)
function idb(mode, fn) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('g50sw', 1)
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv') } catch {} }
      r.onsuccess = () => {
        const db = r.result
        try {
          const st = db.transaction('kv', mode).objectStore('kv')
          const q = mode === 'readwrite' ? fn(st) : st.get(fn)
          q.onsuccess = () => res(q.result === undefined ? null : q.result)
          q.onerror = () => res(null)
        } catch { res(null) }
      }
      r.onerror = () => res(null)
    } catch { res(null) }
  })
}
const idbGet = (k) => idb('readonly', k)
const idbSet = (k, v) => idb('readwrite', (st) => st.put(v, k))

self.addEventListener('message', (e) => {
  const d = e.data || {}
  if (d.type === 'prefs' && d.prefs) e.waitUntil(idbSet('prefs', d.prefs))
})
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { t: '50 Gram', b: e.data ? e.data.text() : '' } }
  if (!d || !d.t) return
  e.waitUntil((async () => {
    const prefs = (await idbGet('prefs')) || {}
    if (prefs.push === false) return // foydalanuvchi push'ni o'chirgan
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const vis = all.filter((c) => c.visibilityState === 'visible')
    if (vis.length) {
      // Ilova ekranda: tizim bildirishnomasi shart emas — ilovaga topshiramiz (jonli WS allaqachon ko'rsatadi)
      for (const c of vis) { try { c.postMessage({ type: 'pushmsg', data: d }) } catch {} }
      return
    }
    try {
      await self.registration.showNotification(d.t, {
        body: prefs.preview === false ? 'Yangi xabar' : (d.b || ''),
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: d.tag || 'g50',
        renotify: true,
        silent: prefs.sounds === false,
        vibrate: prefs.sounds === false ? undefined : [80, 40, 80],
        data: { chat_id: d.c || 0 },
        actions: [{ action: 'open', title: 'Ochish' }],
      })
    } catch {}
  })())
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const chat = (e.notification.data && e.notification.data.chat_id) || 0
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      try { await c.focus(); c.postMessage({ type: 'openchat', chat_id: chat }); return } catch {}
    }
    await self.clients.openWindow(chat ? './#chat/' + chat : './')
  })())
})
