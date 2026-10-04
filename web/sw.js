// 50 Gram service worker: ilova qobig'ini keshlaydi (oflayn ochiladi) + Telegram-uslubidagi Web Push.
const V = '50gram-v53'
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'core.js', 'p2p.js', 'storage.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'logo.png', 'icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png', 'apple-touch-icon.png', 'favicon.png', 'manifest.json',
  // Task 29: Manrope shrifti + animatsiyali stiker paketlari + sovg'alar
  'fonts/manrope-latin.woff2', 'fonts/manrope-latin-ext.woff2',
].concat(['mood/1', 'mood/2', 'mood/3', 'mood/4', 'mood/5', 'mood/6', 'mood/7', 'mood/8', 'love/1', 'love/2', 'love/3', 'love/4', 'love/5', 'love/6', 'love/7', 'love/8', 'party/1', 'party/2', 'party/3', 'party/4', 'party/5', 'party/6', 'party/7', 'party/8', 'gifts/star', 'gifts/heart', 'gifts/rose', 'gifts/fire', 'gifts/cake', 'gifts/crown', 'gifts/diamond', 'gifts/rocket',
  // Task 39: yangi paketlar — his-tuyg'ular, hayvonlar, ovqatlar, tabiat
  'his/1', 'his/2', 'his/3', 'his/4', 'his/5', 'his/6', 'his/7', 'his/8', 'hayvonlar/1', 'hayvonlar/2', 'hayvonlar/3', 'hayvonlar/4', 'hayvonlar/5', 'hayvonlar/6', 'hayvonlar/7', 'hayvonlar/8', 'ovqat/1', 'ovqat/2', 'ovqat/3', 'ovqat/4', 'ovqat/5', 'ovqat/6', 'ovqat/7', 'ovqat/8', 'tabiat/1', 'tabiat/2', 'tabiat/3', 'tabiat/4', 'tabiat/5', 'tabiat/6', 'tabiat/7', 'tabiat/8'].map((p) => 'stickers/' + p + '.svg'))
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
    if (vis.length && !d.call) {
      // Ilova ekranda: tizim bildirishnomasi shart emas — ilovaga topshiramiz (jonli WS allaqachon ko'rsatadi)
      for (const c of vis) { try { c.postMessage({ type: 'pushmsg', data: d }) } catch {} }
      return
    }
    try {
      if (d.call) {
        // QO'NG'IROQ: Telegram-uslubidagi qo'ng'iroq bildirishnomasi — Javob berish / Rad etish
        await self.registration.showNotification(d.t, {
          body: d.b || '',
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: d.tag || 'g50call',
          renotify: true,
          requireInteraction: true,
          silent: false,
          vibrate: [400, 120, 400, 120, 400],
          data: { call: 1, call_id: String(d.tag || '').replace('g50call', '') },
          actions: [{ action: 'answer', title: '📞 Javob berish' }, { action: 'decline', title: 'Rad etish' }],
        })
        return
      }
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
  const nd = e.notification.data || {}
  e.waitUntil((async () => {
    // Qo'ng'iroq bildirishnomasi: "Rad etish" — serverga yuboriladi; "Javob berish"/ochish — ilova ochiladi
    if (nd.call && e.action === 'decline' && nd.call_id) {
      const prefs = (await idbGet('prefs')) || {}
      if (prefs.token) {
        try {
          const base = new URL(self.registration.scope)
          await fetch(base.origin + '/api/calls/' + nd.call_id + '/status', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + prefs.token },
            body: JSON.stringify({ status: 'declined' }),
          })
        } catch {}
      }
      return
    }
    const chat = nd.chat_id || 0
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      try { await c.focus(); if (chat) c.postMessage({ type: 'openchat', chat_id: chat }); return } catch {}
    }
    await self.clients.openWindow(chat ? './#chat/' + chat : './')
  })())
})
