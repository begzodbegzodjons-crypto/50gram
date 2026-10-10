/* 50 Gram — yadro: API, xotira, auth, real-time, chatlar ro'yxati */
'use strict'
const API = ((window.API_URL || location.origin).replace(/\/+$/, '')) + '/api'
const $ = (id) => document.getElementById(id)
const qs = (s, r = document) => r.querySelector(s)
const qsa = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const S = {
  token: localStorage.getItem('g50_token') || '',
  me: JSON.parse(localStorage.getItem('g50_me') || 'null'),
  chats: new Map(), contacts: [], stories: [], lives: [], users: new Map(),
  cur: null, msgs: new Map(), since: new Map(), typing: new Map(),
  ws: null, wsOk: false, serverNow: 0, handlers: {}, tab: 't-chats', sha: new Map(), mk: new Map(),
  prefs: { sounds: 1, vibrate: 1, preview: 1, autoload: 1, push: 1, shauto: 1, shadv: 1, shdbl: 1, shq: 0, nightmute: 0, noanim: 0, ...JSON.parse(localStorage.getItem('g50_prefs') || '{}') },
}
// Tungi ovozsizlik (23:00–07:00): bildirishnoma ovozi/tebranishi o'chadi — o'qilmagan belgisi qoladi
const quietNow = () => { if (!S.prefs.nightmute) return false; const h = new Date().getHours(); return h >= 23 || h < 7 }
// ---------------- Barqaror viewport balandligi (--vph) ----------------
// TUNGI REJIM: DASTUR O'ZI OCHIQ (asosiy) dizaynda ishlaydi — tizim qora rejimi
// dizaynni o'zgartirmaydi. Faqat Sozlamalar > "Tungi rejim" yoniq bo'lsa qorayadi.
// BIR MARTALIK MIGRATSIYA: eski versiyada tugma noto'g'ri elementni almashtirar edi
// (html.dark, CSS esa body.dark) — natijada ilova o'zi qorayib qolardi va o'chmasdi.
// Shu sababli barcha foydalanuvchilar BIR MAROTA asosiy ochiq dizaynga qaytariladi.
try {
  if (!localStorage.getItem('g50_dark_mig')) {
    localStorage.setItem('g50_dark', '0')
    localStorage.setItem('g50_dark_mig', '1')
  }
} catch {}
if (localStorage.getItem('g50_dark') === '1') document.body.classList.add('dark')
// 100dvh scroll davomida o'zgaradi (manzil paneli yashirinadi/ko'rinadi) — to'liq ekran
// Reels slaydlarining snap nuqtalari siljiydi = "tepa-pastga sakrash". Shuning uchun
// balandlikni bir marta o'lchab CSS o'zgaruvchiga qo'yamiz; faqat ekran burilishi yoki
// katta o'zgarishda (klaviatura) yangilaymiz — kichik o'zgarishlar e'tiborga olinmaydi.
let vphT = null
function measureVPH() {
  const h = Math.round(window.visualViewport ? visualViewport.height : innerHeight)
  document.documentElement.style.setProperty('--vph', h + 'px')
  measureVPH.w = innerWidth
}
measureVPH()
addEventListener('resize', () => {
  clearTimeout(vphT)
  vphT = setTimeout(() => {
    const prev = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vph')) || 0
    const h = Math.round(window.visualViewport ? visualViewport.height : innerHeight)
    if (Math.abs(h - prev) > 150 || innerWidth !== measureVPH.w) measureVPH()
  }, 180)
})
// Sozlamalar: lokal + serverga sinxron (barcha qurilmalarda bir xil)
// v71 TUZATISH: parametr nomi «patch» edi — global patch() HTTP yordamchisini soya qilar,
// «TypeError: patch is not a function» otardi → sozlamalar serverga HECH QACHON yetmasdi
// va sendPrefsToSW() ham bajarilmasdi. Parametr «p» deb o'zgartirildi.
function savePrefs(p, sync = true) {
  S.prefs = { ...S.prefs, ...p }
  localStorage.setItem('g50_prefs', JSON.stringify(S.prefs))
  if (sync && S.token) patch('/me', { prefs: S.prefs }).catch(() => {})
  sendPrefsToSW()
}
// Service worker'ga push sozlamalarini yetkazish (bildirishnomada matn/tovush boshqaruvi uchun)
// token ham beriladi — SW qo'ng'iroq bildirishnomasidan "Rad etish" bosilganda serverga xabar beradi
function sendPrefsToSW() {
  try {
    if (!('serviceWorker' in navigator)) return
    const p = { push: S.prefs.push !== 0, preview: S.prefs.preview !== 0, sounds: S.prefs.sounds !== 0, token: S.token || '' }
    navigator.serviceWorker.ready.then((r) => { try { r.active && r.active.postMessage({ type: 'prefs', prefs: p }) } catch {} })
    navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: 'prefs', prefs: p })
  } catch {}
}
const on = (type, fn) => ((S.handlers[type] ||= []).push(fn))

// ---------------- Yordamchilar ----------------
function toast(t, ms = 2600) {
  const el = $('toast'); el.textContent = t; el.classList.add('on')
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), ms)
}
const pad = (n) => String(n).padStart(2, '0')
function fmtTime(t) { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
const OYLAR = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
function fmtDay(t) {
  const d = new Date(t), n = new Date()
  const y = new Date(n); y.setDate(n.getDate() - 1)
  if (d.toDateString() === n.toDateString()) return 'Bugun'
  if (d.toDateString() === y.toDateString()) return 'Kecha'
  return d.getDate() + '-' + OYLAR[d.getMonth()] + (d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : '')
}
function fmtShort(t) {
  if (!t) return ''
  const d = new Date(t), n = new Date()
  if (d.toDateString() === n.toDateString()) return fmtTime(t)
  if (n - d < 6 * 864e5) return ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'][d.getDay()]
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + (d.getFullYear() !== n.getFullYear() ? '.' + String(d.getFullYear()).slice(2) : '')
}
function fmtAgo(t) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'hozirgina'
  if (s < 3600) return Math.floor(s / 60) + ' daqiqa oldin'
  if (s < 86400) return Math.floor(s / 3600) + ' soat oldin'
  return fmtDay(t) + ' ' + fmtTime(t)
}
const fmtDur = (s) => Math.floor(s / 60) + ':' + pad(Math.floor(s % 60))
// ---------------- Web Push (Telegram-uslubidagi bildirishnomalar) ----------------
function urlB64ToU8(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const b = atob(s), u = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
  return u
}
async function pushCapable() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
async function pushSubscribeNow() {
  if (!(await pushCapable())) return false
  const reg = await navigator.serviceWorker.register('sw.js').catch(() => null)
  if (!reg) return false
  await navigator.serviceWorker.ready
  let key = ''
  try { key = (await api('/push/vapid', { method: 'GET' })).key || '' } catch { return false }
  if (!key) return false // serverda VAPID sozlanmagan
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) })
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys) return false
  await post('/push/subscribe', { endpoint: j.endpoint, keys: j.keys })
  localStorage.setItem('g50_push', '1')
  sendPrefsToSW()
  return true
}
async function pushOff() {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      const sub = await reg.pushManager.getSubscription()
      if (sub) { try { await post('/push/unsubscribe', { endpoint: sub.endpoint }) } catch {}; await sub.unsubscribe().catch(() => {}) }
    }
  } catch {}
  localStorage.setItem('g50_push', '0')
}
async function initPush() {
  try {
    if (S.prefs.push === 0 || localStorage.getItem('g50_push') !== '1') return // faqat ruxsat berilganlar
    await pushSubscribeNow()
  } catch {}
}
// v78: birinchi kirishda push'ni O'ZI yoqadi (bir marta so'raydi — rad etilsa boshqa so'ralmaydi)
async function g50AutoPush() {
  try {
    if (window.Android50) return // APK: WebView'da PushManager yo'q — fon xizmati ishlaydi
    if (S.prefs.push === 0) return // foydalanuvchi ataylab o'chirgan
    if (!(await pushCapable())) return
    if (Notification.permission === 'denied') return
    const asked = localStorage.getItem('g50_pushasked') === '1'
    if (Notification.permission === 'default') {
      if (asked) return
      localStorage.setItem('g50_pushasked', '1')
      const p = await Notification.requestPermission().catch(() => 'default')
      if (p !== 'granted') return
    }
    if (localStorage.getItem('g50_push') !== '1') localStorage.setItem('g50_push', '1')
    await pushSubscribeNow().catch(() => {})
  } catch {}
}
function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB' }
function lastSeen(u) {
  if (!u) return ''
  if (u.online) return 'onlayn'
  if (u.last_seen === null) return 'yaqinda bo‘lgan'
  if (!u.last_seen) return 'uzoq vaqt oldin'
  return 'oxirgi marta ' + fmtAgo(u.last_seen).replace(' oldin', ' oldin')
}
const COLORS = ['#FF6B6B', '#F59F00', '#37B24D', '#1C7ED6', '#7048E8', '#E64980', '#0CA678', '#F76707']
const colorFor = (id) => COLORS[Math.abs(Number(String(id).slice(-6))) % COLORS.length]
function initials(n) { return (String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => [...x][0] || '').join('') || '?').toUpperCase() }
const uname = (u) => (u ? ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || 'Foydalanuvchi' : 'Foydalanuvchi')
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)@([a-zA-Z][\w]{4,31})/g, '$1<a href="#@$2">@$2</a>')
const isEmojiOnly = (s) => s && s.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(s) && !/^[\d#*\s]+$/.test(s)
function vibrate(p = 15) { if (!S.prefs.vibrate) return; try { navigator.vibrate && navigator.vibrate(p) } catch {} }

// ---------------- QURILMA GUVOHNOMASI (v73) ----------------
// Har qurilma (brauzer/ilova) bir marta g50_dev kalitini yaratadi va DOIMIY saqlaydi
// (logout bilan O'CHMAYDI — shu tufayli egadan keyin ham shu qurilma tanib olinadi).
// Raqam kirishda shu kalitga bog'lanadi (server: users.dev) — shu tufayli EGASI o'z
// qurilmasidan qayta kirganda server uni tanib oladi va HECH QACHON «mavjud» bloki
// bermaydi (938607999 kabi qotib qolgan holatlar abadiy yo'q). Begona qurilma esa
// «Bu raqam tarmoqda mavjud» xabarini ko'radi.
let G50DEV = 'danon'
try {
  G50DEV = localStorage.getItem('g50_dev') || ''
  if (!G50DEV) {
    G50DEV = 'd' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 14))
    localStorage.setItem('g50_dev', G50DEV)
  }
} catch {}

// ---------------- API ----------------
async function api(path, opt = {}) {
  const h = { 'x-dev': G50DEV }
  if (S.token) h.Authorization = 'Bearer ' + S.token
  let body
  if (opt.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(opt.body) }
  const method = opt.method || (body ? 'POST' : 'GET')
  // ISHONCHLILIK (server kuchaytirish): 1) 20s timeout — so'rov abadiy osilib qolmaydi;
  // 2) GET so'rov tarmoq uzilishida 1 marta AVTOMATIK qayta uriniladi — ma'lumot yo'qolmaydi,
  // foydalanuvchi xato ko'rmaydi (POST/DELETE qayta urinilmaydi — takror yuborilishining oldi olinadi)
  let r = null, lastErr = null
  for (let att = 0; att < 2; att++) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    const to = ac ? setTimeout(() => { try { ac.abort() } catch {} }, 20000) : 0
    try { r = await fetch(API + path, { method, headers: h, body, signal: ac ? ac.signal : undefined }); break }
    catch (e) { lastErr = e; if (method !== 'GET' || att) break }
    finally { if (to) clearTimeout(to) }
  }
  if (!r) { try { console.info('[api] tarmoq xato', path, lastErr && lastErr.name) } catch {} ; throw new Error(lastErr && lastErr.name === 'AbortError' ? 'Server javob bermadi — birozdan so‘ng qayta urinib ko‘ring' : 'Internet aloqasi yo‘q') }
  let j = {}
  try { j = await r.json() } catch {}
  if (r.status === 401 && S.token && !path.startsWith('/auth')) { logout(true); throw new Error('Qaytadan kiring') }
  if (!r.ok) { const err = new Error(j.error || 'Xatolik (' + r.status + ')'); err.status = r.status; throw err }
  return j
}
const post = (p, b = {}) => api(p, { method: 'POST', body: b })
const patch = (p, b = {}) => api(p, { method: 'PATCH', body: b })
const del = (p) => api(p, { method: 'DELETE', body: {} })
async function tryDo(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r } catch (e) { toast('⚠️ ' + e.message); return null }
}

// ---------------- IndexedDB (qurilmadagi tarix va fayllar) ----------------
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db)
    return new Promise((res) => {
      try {
        const r = indexedDB.open('50gram', 4)
        r.onupgradeneeded = () => {
          const d = r.result
          if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats')
          if (!d.objectStoreNames.contains('media')) d.createObjectStore('media')
          if (!d.objectStoreNames.contains('idx')) d.createObjectStore('idx') // fayl hajmi/chat/oxirgi foydalanish
          // v97 OUTBOX: internet uzilgan paytda yuborilgan xabar/fayllar shu yerda ushlanadi —
          // onlayn bo'lganda avtomatik yuboriladi (foydalanuvchi talabi: hech narsa yo'qolmasin)
          if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox')
        }
        r.onsuccess = () => { this.db = r.result; res(this.db) }
        r.onerror = () => res(null)
      } catch { res(null) }
    })
  },
  async get(store, key) {
    const d = await this.open(); if (!d) return null
    return new Promise((res) => { try { const q = d.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) } catch { res(null) } })
  },
  async put(store, key, val) {
    const d = await this.open(); if (!d) return
    return new Promise((res) => { try { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); t.oncomplete = res; t.onerror = res } catch { res() } })
  },
  async del(store, key) {
    const d = await this.open(); if (!d) return
    return new Promise((res) => { try { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); t.oncomplete = res; t.onerror = res } catch { res() } })
  },
  async entries(store) {
    const d = await this.open(); if (!d) return []
    return new Promise((res) => {
      try {
        const out = [], q = d.transaction(store).objectStore(store).openCursor()
        q.onsuccess = () => { const c = q.result; if (!c) return res(out); out.push([c.key, c.value]); c.continue() }
        q.onerror = () => res(out)
      } catch { res([]) }
    })
  },
  async clear() {
    const d = await this.open(); if (!d) return
    for (const s of ['chats', 'media']) await new Promise((res) => { const t = d.transaction(s, 'readwrite'); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = res })
  },
}
const saveTimers = new Map()
function saveChatLocal(chatId) {
  clearTimeout(saveTimers.get(chatId))
  saveTimers.set(chatId, setTimeout(() => {
    const list = (S.msgs.get(chatId) || []).filter((m) => !m.pending).slice(-800)
    IDB.put('chats', S.me.id + ':' + chatId, { messages: list, since: S.since.get(chatId) || 0 })
  }, 400))
}
async function loadChatLocal(chatId) {
  if (S.msgs.has(chatId)) return
  const d = await IDB.get('chats', S.me.id + ':' + chatId)
  S.msgs.set(chatId, d?.messages || [])
  if (d?.since) S.since.set(chatId, d.since)
}

// ---------------- OUTBOX (v97): internet yo'q — xabar NAVBATDA ushlanadi ----------------
// Foydalanuvchi talabi (Task 46): «onlayn/oflayn holatlari yuzaga kelganda vaqtincha
// ushlanib, onlayn bo'lganda uzatilsin — hech narsa yo'qolmasin». Tarmoq-xatosi bilan
// yuborilmagan xabar/fayl shu yerda saqlanadi; internet qaytganda (online hodisa /
// WS ulanganda / 45s) avtomatik yuboriladi. Server QAT'IY rad etsa (4xx/5xx) —
// qayta urinish ma'nosiz, navbatdan o'chadi (xulq eskisi bilan bir xil).
const Outbox = (() => {
  const MAXN = 40, MAXB = 60 * 1024 * 1024
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  let flushing = false
  const netErr = (e) => !!e && !e.status && /internet|tarmoq|javob bermadi|yuklashda xato/i.test(String((e && e.message) || e))
  const all = async () => (await IDB.entries('outbox')).map(([, v]) => v).sort((a, b) => (a.at || 0) - (b.at || 0))
  async function add(item) {
    try {
      item.client_id = item.client_id || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))
      item.at = Date.now(); item.tries = 0
      const list = await all()
      let bytes = list.reduce((a, x) => a + ((x.blob && x.blob.size) || 0), 0)
      // chegara: 40 element / 60 MB — eski avval chiqariladi (navbat abadiy o'smaydi)
      while ((list.length >= MAXN || bytes + ((item.blob && item.blob.size) || 0) > MAXB) && list.length) {
        const old = list.shift(); bytes -= (old.blob && old.blob.size) || 0
        await IDB.del('outbox', old.client_id)
      }
      await IDB.put('outbox', item.client_id, item)
      try { console.info('[outbox] navbat: ' + item.client_id + ' ' + (item.kind || '')) } catch {}
    } catch {}
  }
  const del = (id) => IDB.del('outbox', id)
  async function flush() {
    if (flushing || !navigator.onLine || !S.token) return
    const list = await all()
    if (!list.length) return
    flushing = true
    try {
      for (const it of list) {
        if ((it.tries || 0) > 7) { await del(it.client_id); try { console.info('[outbox] 7 urinishdan oshdi — tashlandi', it.client_id) } catch {}; continue }
        if (!navigator.onLine) break
        try {
          if (it.type === 'file' && it.blob && typeof sendFile === 'function') {
            await sendFile(it.blob, it.kind, it.extra || {}, it.chat)
          } else if (typeof sendRaw === 'function') {
            // eski vaqtinchalik bubble hali ekranda bo'lsa — SHU bubble'dan davom etamiz
            const temp = (S.msgs.get(it.chat) || []).find((m) => m.pending && m.client_id === it.client_id)
            await sendRaw(it.chat, { kind: it.kind, body: it.body, meta: it.meta || {} }, temp)
          } else break
          await del(it.client_id)
        } catch (e) {
          if (e && e.status) { await del(it.client_id) } // server rad etdi — eskisi kabi xato, qayta urinilmaydi
          else {
            it.tries = (it.tries || 0) + 1
            await IDB.put('outbox', it.client_id, it)
            break // tarmoq hali yo'q — keyingi flush'dan davom
          }
        }
        await wait(400)
      }
    } finally { flushing = false }
  }
  return { add, del, flush, netErr, all }
})()

// ---------------- Media ----------------
const CHUNK = 512 * 1024
function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(b) })
}
// ---- Fayllarni tayyorlash ----
const b64e = (u) => { let s = ''; u = new Uint8Array(u); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s) }
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
async function encryptBlob(plain) {
  const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, await plain.arrayBuffer())
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), key: b64e(raw), iv: b64e(iv) }
}
async function decryptBlob(cipher, key, iv, mime) {
  const k = await crypto.subtle.importKey('raw', b64d(key), 'AES-GCM', false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, k, await cipher.arrayBuffer())
  return new Blob([pt], { type: mime || 'application/octet-stream' })
}
// Xabar meta'siga qo'shiladigan ma'lumot (kalit faqat chat a'zolariga xabar bilan boradi)
const mediaInfo = (id) => ({ media_id: id, ...(S.mk.get(id) || {}) })
async function upload(plain, name, onProg) {
  // v71: chegaradan 1 KB zaxira — server shifrlangan blob hajmini tekshiradi (AES-GCM +16 bayt
  // teg qo'shadi), aks holda 30 MB − 15 bayt li haqiqiy fayl «Fayl hajmi 30 MB dan oshmasin»
  // degan yolg'on xato bilan rad etilardi
  if (plain.size > 30 * 1024 * 1024 - 1024) throw new Error('Fayl 30 MB dan katta')
  const enc = await encryptBlob(plain)
  const blob = enc.blob
  const n = Math.max(1, Math.ceil(blob.size / CHUNK))
  const { id } = await post('/media', { mime: plain.type || 'application/octet-stream', name: name || 'fayl', size: blob.size || 1, chunks: n })
  // OPTIMIZATSIYA: bo'laklar endi binary (base64 emas — 33% kam trafik, CPU yuklamasi yo'q) + 2 tasi parallel
  let done = 0
  const putChunk = async (i) => {
    const part = blob.slice(i * CHUNK, (i + 1) * CHUNK)
    let ok = false
    for (let a = 0; a < 4 && !ok; a++) {
      try {
        const r = await fetch(API + '/media/' + id + '/' + i, { method: 'PUT', headers: { Authorization: 'Bearer ' + S.token, 'content-type': 'application/octet-stream' }, body: part })
        ok = r.ok
        if (!ok && r.status >= 500) await sleep(700 * (a + 1)); else if (!ok) break
      } catch { await sleep(700 * (a + 1)) }
    }
    if (!ok) throw new Error('Yuklashda xato — internetni tekshiring')
    done++; onProg && onProg(done / n)
  }
  let next = 0
  const wr = async () => { while (next < n) { const i = next++; await putChunk(i) } }
  await Promise.all([wr(), wr()])
  const sha = await P2P.sha256Hex(blob)
  await post('/media/' + id + '/done', { sha })
  const info = { sha, size: blob.size, key: enc.key, iv: enc.iv, mime: plain.type || 'application/octet-stream' }
  S.sha.set(id, sha); S.mk.set(id, info)
  P2P.note(id, info)
  await IDB.put('media', id, blob)
  Store.record(id, blob.size, null, 0)
  mediaCache.set(id, Promise.resolve(URL.createObjectURL(plain)))
  return id
}
const mediaCache = new Map()
// Chunkni olish: yangi server binary qaytaradi, eski javob base64 text — ikkalasi ham qo'llanadi
async function fetchChunk(id, i) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(API + '/media/' + id + '/' + i, { headers: { Authorization: 'Bearer ' + S.token, Accept: 'application/octet-stream, text/plain' } })
      if (r.ok) {
        if ((r.headers.get('content-type') || '').includes('octet-stream')) return new Uint8Array(await r.arrayBuffer())
        const txt = await r.text()
        return Uint8Array.from(atob(txt), (ch) => ch.charCodeAt(0))
      }
      if (r.status < 500) return null
    } catch {}
    await sleep(500 * (a + 1))
  }
  return null
}
// Faylni olish va ko'rsatish
async function getCipher(id) {
  const local = await IDB.get('media', id)
  if (local) { Store.access(id); P2P.touch(id); return local }
  let meta = null
  try { meta = await api('/media/' + id) } catch {}
  if (meta) {
    // OPTIMIZATSIYA: bo'laklar binary + 2 tasi parallel (teskari tartibda yig'iladi)
    const parts = new Array(meta.chunks), failed = []
    let got = 0, next = 0
    const wr = async () => {
      while (next < meta.chunks) {
        const i = next++
        const u = await fetchChunk(id, i)
        if (u) { parts[i] = u; got++; if (onMediaProg) onMediaProg(id, got, meta.chunks) } else failed.push(i)
      }
    }
    await Promise.all([wr(), wr()])
    if (!failed.length && got === meta.chunks) {
      const blob = new Blob(parts, { type: 'application/octet-stream' })
      P2P.note(id, { sha: meta.sha, size: meta.size, mime: meta.mime })
      await IDB.put('media', id, blob)
      Store.record(id, blob.size, P2P.ctx.get(id)?.chat, 0)
      P2P.touch(id)
      return blob
    }
    meta = null
  }
  // Serverda o'chgan — nusxasi bor onlayn qurilmadan olamiz
  const cipher = await P2P.fetchMedia(id)
  restoreToServer(id, cipher) // v97 fonda: to'r server keshini o'zi tiklaydi (kimdir kutmaydi)
  return cipher
}
// v97 TO'R → SERVER TIKLASH: server nusxasi yo'qolgan (gone=1) faylni boshqa qurilmadan
// olgach, ilova FONDA o'sha SHIFRLANGAN nusxani serverga qayta yuklaydi — R2 keshi o'zi
// to'planadi (foydalanuvchi talabi: «R2 xotira bo'shatilsin va kerakli foydalanuvchilarga
// yetkazilishi»). Butunlik kafolati: sha256 mos emasa server YO'Q deyadi.
const restored = new Set()
async function restoreToServer(id, cipher) {
  if (restored.has(id) || !S.token || !cipher || !navigator.onLine) return
  restored.add(id)
  try {
    const info = await api('/media/' + id + '/restore-info')
    if (!info || !info.gone || !info.chunks) return
    const mysha = await P2P.sha256Hex(cipher)
    if (info.sha && mysha !== info.sha) { try { console.info('[tiklash] sha mos emadi', String(id).slice(0, 8)) } catch {}; return }
    for (let i = 0; i < info.chunks; i++) {
      const part = cipher.slice(i * CHUNK, (i + 1) * CHUNK)
      const r = await fetch(API + '/media/' + id + '/' + i, { method: 'PUT', headers: { Authorization: 'Bearer ' + S.token, 'content-type': 'application/octet-stream' }, body: part })
      if (!r.ok) return
    }
    await post('/media/' + id + '/done', { sha: mysha })
    try { console.info('[tiklash] server nusxa tiklandi', String(id).slice(0, 8)) } catch {}
  } catch (e) { try { console.info('[tiklash]', String((e && e.message) || e).slice(0, 80), String(id).slice(0, 8)) } catch {} }
}
const mediaProgs = new Map()
function onMediaProg(id, done, total) { const f = mediaProgs.get(id); if (f) f(done / total) }
function mediaUrl(id) {
  if (!id) return Promise.reject(new Error('yo‘q'))
  if (!mediaCache.has(id)) {
    mediaCache.set(id, (async () => {
      const cipher = await getCipher(id)
      const info = P2P.ctx.get(id) || S.mk.get(id) || {}
      if (!info.key) throw new Error('Faylni ochish kaliti yo‘q')
      return URL.createObjectURL(await decryptBlob(cipher, info.key, info.iv, info.mime))
    })().catch((e) => { mediaCache.delete(id); throw e }))
  }
  return mediaCache.get(id)
}

function hydrate(root) {
  qsa('[data-media]:not([data-h])', root).forEach((el) => {
    el.setAttribute('data-h', '1')
    mediaUrl(el.dataset.media).then((u) => {
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') el.src = u
      else el.style.backgroundImage = `url("${u}")`
    }).catch(() => { el.classList.add('gone'); if (el.tagName === 'IMG') el.alt = 'Fayl muddati tugagan' })
  })
}
async function resizeImage(file, max = 1600, q = 0.85, square = false) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Rasm ochilmadi')); i.src = url })
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0
    if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m }
    const k = Math.min(1, max / Math.max(sw, sh))
    const cv = document.createElement('canvas')
    cv.width = Math.round(sw * k); cv.height = Math.round(sh * k)
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height)
    return await new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', q))
  } finally { URL.revokeObjectURL(url) }
}
async function avatarDataUrl(file) {
  const b = await resizeImage(file, 400, 0.86, true)
  return 'data:image/jpeg;base64,' + (await blobToB64(b))
}
function pickFile(accept, multiple = false, capture) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept; i.multiple = multiple
    if (capture) i.setAttribute('capture', capture)
    // v81: galereya BEKOR qilib yopilsa («cancel» — Android Chrome/WebView 113+) — va'da
    // abadiy osilib qolmasdi (avval: tanlash bekor qilinsa hech narsa sodir bo'lmasdi).
    // v93: BEKOR vs BO'SH-NATIJA ajratiladi (multiple'da massivga __bekor belgi qo'yiladi) —
    // WebView faylni yetkazmagan holat (APK chooser muammosi) jurnaldan aniq ko'rinadi.
    let ok = false
    const fin = (v) => { if (!ok) { ok = true; res(v) } }
    i.onchange = () => { const a = multiple ? [...i.files] : i.files[0] || null; fin(a) }
    i.addEventListener('cancel', () => { if (multiple) { const a = []; a.__bekor = true; fin(a) } else fin(null) })
    try { i.click() } catch (e) { fin(multiple ? [] : null) }
  })
}

// ---------------- Avatar ----------------
function avHTML(o, size = 52, opt = {}) {
  if (!o) o = {}
  const isChat = opt.chat || (o.type && o.type !== 'direct')
  const name = isChat ? o.title : uname(o)
  const src = o.avatar_ver ? `${API}/avatar/${isChat ? 'c' : 'u'}/${o.id}?v=${o.avatar_ver}` : ''
  const fs = Math.round(size * 0.38)
  const inner = opt.saved
    ? `<div class="av saved" style="width:${size}px;height:${size}px">🔖</div>`
    : `<div class="av" style="width:${size}px;height:${size}px;font-size:${fs}px;background:${src ? 'var(--sirt2)' : colorFor(o.id || 0)}">${src ? `<img src="${src}" loading="lazy" alt="">` : esc(initials(name))}</div>`
  const st = !isChat && o.story && o.story.count ? (o.story.unseen ? 'ring' : 'ring seen') : ''
  const live = opt.live ? '<span class="live-b">LIVE</span>' : ''
  const dot = opt.dot && o.online && !st && !opt.live ? '<span class="on-dot"></span>' : ''
  const attrs = (st && !opt.noStory ? ` data-story="${o.id}"` : '') + (opt.live && (opt.liveId || o.live_id) ? ` data-liveav="${opt.liveId || o.live_id}"` : '')
  return `<div class="avw ${st} ${opt.live ? 'livew' : ''}"${attrs} style="width:${size + (st || opt.live ? 5 : 0)}px">${inner}${dot}${live}</div>`
}
// Katta avatar: istoriya bo'lsa — rasm o'rnida istoriya ko'rinadi
function bigAvatar(u, size = 120, opt = {}) {
  const g = u && S.stories.find((x) => x.user.id === u.id)
  const last = g && g.stories[g.stories.length - 1]
  let inner
  if (last && !opt.chat) {
    const ring = g.unseen ? 'ring' : 'ring seen'
    const body = last.kind === 'text'
      ? `<div class="st-txt" style="background:${esc(last.bg || '#0A7CFF')};font-size:${Math.round(size / 9)}px">${esc((last.text_body || '').slice(0, 60))}</div>`
      : last.kind === 'video'
        ? `<video class="st-prev" data-media="${last.media_id}" muted autoplay loop playsinline></video>`
        : `<img class="st-prev" data-media="${last.media_id}" alt="">`
    inner = `<div class="avw ${ring}" data-story="${u.id}" style="width:${size}px;height:${size}px;padding:4px"><div class="av" style="width:100%;height:100%;border:3px solid var(--sirt);background:#000">${body}</div></div>`
  } else inner = avHTML(u, size, { ...opt, noStory: true })
  return `<div class="bigav" style="width:${size}px;height:${size}px">${inner}${opt.cam ? '<span class="cam" data-cam="1">📷</span>' : ''}</div>`
}
// Avatar to'liq manzili (katta ko'rish uchun) — chat: true bo'lsa kanal/guruh rasmi
function avSrc(o, chat) {
  return o && o.avatar_ver ? `${API}/avatar/${chat ? 'c' : 'u'}/${o.id}?v=${o.avatar_ver}` : ''
}
// Telegram-uslubidagi to'liq ekran rasm ko'rish: profil/kanal rasmini ustiga bosganda
// qora fon, markazda KATTA rasm, tepada ism va yopish tugmasi. Bosilsa yoki ✕ bosilsa yopiladi.
function viewPhoto(src, title = '', sub = '') {
  if (!src) return
  const o = document.createElement('div')
  o.className = 'over imgview pav'
  o.innerHTML = `<div class="pav-top"><div class="pav-n"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><button class="xb">✕</button></div><img src="${src}" alt="">`
  o.onclick = (e) => { if (!e.target.closest('.pav-top') && e.target.tagName !== 'IMG') o.remove() }
  qs('.xb', o).onclick = () => o.remove()
  document.body.appendChild(o)
}
document.addEventListener('click', (e) => {
  // Efirdagi foydalanuvchi avatariga bosilsa — efirga ulanish (chat/istoriya/kontakt qayerida bo'lsa ham)
  const la = e.target.closest('[data-liveav]')
  if (la && la.dataset.liveav) { e.stopPropagation(); e.preventDefault(); watchLive(+la.dataset.liveav); return }
  const s = e.target.closest('[data-story]')
  if (s && !e.target.closest('[data-cam]')) { e.stopPropagation(); e.preventDefault(); openStoryOf(+s.dataset.story) }
}, true)

// ---------------- Sheet (pastki oyna) ----------------
function sheet(html, opt = {}) {
  const bg = document.createElement('div')
  bg.className = 'shbg'
  bg.innerHTML = `<div class="sheet">${opt.noGrab ? '' : '<div class="grab"></div>'}${html}</div>`
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(bg) })
  bg._onClose = opt.onClose
  document.body.appendChild(bg)
  qsa('.x', bg).forEach((x) => (x.onclick = () => closeSheet(bg)))
  hydrate(bg)
  return bg.firstElementChild
}
function closeSheet(el) {
  const bg = el ? (el.classList.contains('shbg') ? el : el.closest('.shbg')) : [...document.querySelectorAll('.shbg')].pop()
  if (!bg) return
  bg.remove(); bg._onClose && bg._onClose()
}
const closeAllSheets = () => qsa('.shbg').forEach((b) => b.remove())
const h3 = (t) => `<h3>${t}<button class="x">✕</button></h3>`

// ---------------- To'liq ekran sahifalar (keng sozlamalar) ----------------
// Telegram-uslubidagi ichma-ichim sahifalar: ochish → chapdan surib chiqadi, orqaga tugmasi bilan yopiladi
function openPage(title, html, onmount) {
  const p = document.createElement('div')
  p.className = 'page'
  p.innerHTML = `<header class="phead"><button class="ic tr pback" data-pback aria-label="Orqaga">‹</button><b>${esc(title)}</b><div class="sp"></div></header><div class="pbody">${html}</div>`
  p.addEventListener('click', (e) => { if (e.target.closest('[data-pback]')) closePage(p) })
  document.body.appendChild(p)
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('in')))
  if (onmount) onmount(p)
  hydrate(p)
  return p
}
function closePage(p) {
  p = p || qsa('.page').pop()
  if (!p) return
  p.classList.remove('in')
  setTimeout(() => p.remove(), 280)
}
const closeAllPages = () => qsa('.page').forEach((p) => p.remove())

// ---------------- ORQAGA TUGMASI (Android APK tizim tugmasi) ----------------
// Task 33: tizim "orqaga" tugmasi ilovadan chiqib ketmasin — ichkarida BIR QADAM orqaga
// qaytsin (ochiq chat/oyna/efir yopiladi). Ustma-ust qatlamlar aynan shu tartibda yopiladi:
// kontekst menyu → pastki oyna → to'liq ekran sahifa → efir → istoriya → chat.
// Hech narsa ochiq bo'lmasa — false qaytadi, APK ilovani fonga yuboradi (o'chirmaydi).
window.__50back = () => {
  // 1) Kontekst menyu (uzun bosish menyusi)
  const cx = qs('.ctxbg')
  if (cx) { cx.click(); return true }
  // 2) Pastdan chiqadigan oynalar (profil, sozlamalar, tasdiqlash, guruh ma'lumoti…)
  const sheets = qsa('.shbg')
  if (sheets.length) { closeSheet(sheets[sheets.length - 1]); return true }
  // 3) To'liq ekran sozlamalar sahifalari (ichma-ich qatlamlar — eng ustidagini yopamiz)
  const pages = qsa('.page')
  if (pages.length) { closePage(pages[pages.length - 1]); return true }
  // 4) Shorts/Reels to'liq ekran ko'rish oynasi
  if (typeof shWrap !== 'undefined' && shWrap) { try { shClose() } catch {} return true }
  // 5) Jonli efir: sovg'a paneli → tomoshabin chiqadi, efirchida tasdiqlash oynasi
  if (typeof LIVE !== 'undefined' && LIVE) {
    const gp = qs('#l-gift', LIVE.el)
    if (gp && !gp.classList.contains('hide')) { gp.classList.add('hide'); return true }
    if (LIVE.host) { endLive(); return true }
    leaveLive(); return true
  }
  // 5) Istorya ko'rish oynasi
  if (typeof svState !== 'undefined' && svState) { closeStory(); return true }
  // 6) Qo'ng'iroq: tasodifan tugatmasin — orqaga hech narsa qilmaydi (APK fonga yuboradi)
  if (typeof CALL !== 'undefined' && CALL) return false
  // 7) Stiker/emoji paneli
  const pk = $('picker')
  if (pk && pk.classList.contains('on')) { pk.classList.remove('on'); return true }
  // 8) Ochiq chat — ro'yxatga qaytish
  if ($('dialog') && $('dialog').classList.contains('open')) { closeChat(); return true }
  // 9) Kirish: kod bosqichidan raqam bosqichiga
  if (!$('auth').classList.contains('hide') && !$('a-code').classList.contains('hide')) { $('b-back').click(); return true }
  return false
}

// Rangli ikonkali qator (Telegram/iOS Settings uslubi) — keng sozlamalar uchun
const tile = (emoji, c1, c2) => `<span class="stile" style="background:linear-gradient(145deg,${c1},${c2})">${emoji}</span>`
// Sahifa ichidagi qatorlar (pageRows) — .rows'dan foydalanadi
const prow = (key, ticon, c1, c2, title, sub = '', extra = '') =>
  `<div data-pg="${key}">${tile(ticon, c1, c2)}<div class="rt">${title}${sub ? `<small>${sub}</small>` : ''}</div>${extra || '<span class="rv">›</span>'}</div>`
const psw = (key, ticon, c1, c2, title, sub = '', on = 0) =>
  `<div data-psw="${key}">${tile(ticon, c1, c2)}<div class="rt">${title}${sub ? `<small>${sub}</small>` : ''}</div><span class="sw ${on ? 'on' : ''}"></span></div>`

// ---------------- Kanal/guruh logotiplari (tayyor presetlar) ----------------
const LOGOS = [
  ['📢', '#0A7CFF', '#00C2FF'], ['🔥', '#FF6A3D', '#C8102E'], ['⭐', '#F5A623', '#FF6A3D'],
  ['🎵', '#7048E8', '#E64980'], ['⚽', '#11998e', '#38ef7d'], ['📰', '#232526', '#414345'],
  ['🎬', '#7B2FF7', '#0A7CFF'], ['💎', '#1FAA59', '#0CA678'], ['🚀', '#0A7CFF', '#7048E8'],
  ['🎁', '#ee9ca7', '#C8102E'], ['🌍', '#0062D6', '#11998e'], ['💪', '#f7971e', '#C8102E'],
]
function logoDataURL(emoji, c1, c2, size = 320) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size
  const x = cv.getContext('2d')
  const g = x.createLinearGradient(0, 0, size, size)
  g.addColorStop(0, c1); g.addColorStop(1, c2)
  x.fillStyle = g
  const r = size * 0.225
  x.beginPath(); x.moveTo(r, 0); x.arcTo(size, 0, size, size, r); x.arcTo(size, size, 0, size, r); x.arcTo(0, size, 0, 0, r); x.arcTo(0, 0, size, 0, r); x.closePath(); x.fill()
  x.font = Math.round(size * 0.52) + 'px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(emoji, size / 2, size * 0.54)
  return cv.toDataURL('image/png')
}
const logoPresets = (cur) => `<div class="logos">${LOGOS.map(([e, c1, c2], i) => `<span data-logo="${i}" style="background:${logoDataURL(e, c1, c2)}" class="${cur === i ? 'on' : ''}"></span>`).join('')}</div>`

// ---------------- Tarixni zaxiralash (hech narsa yo'qolmasin) ----------------
function download(name, text, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 400)
}
async function exportChat(id) {
  const c = S.chats.get(id); if (!c) return
  toast('⏳ Tarix tayyorlanmoqda…')
  await loadChatLocal(id)
  try { await fetchMessages(id) } catch {}
  const list = (S.msgs.get(id) || []).filter((m) => !m.pending)
  const lines = [`50 Gram — ${chatName(c)} — ${list.length} xabar`, '']
  for (const m of list) {
    const who = m.kind === 'system' ? '' : (m.sender_id === S.me.id ? 'Siz' : uname(S.users.get(m.sender_id)))
    lines.push(`[${fmtDay(m.created_at)} ${fmtTime(m.created_at)}] ${who}: ${msgPreview(m, c)}`)
  }
  download(`50gram-${chatName(c).replace(/[^\w\- ]/g, '').slice(0, 30) || 'chat'}.txt`, lines.join('\n'))
  toast('✅ Zaxira yuklab olindi (' + list.length + ' xabar)')
}
function confirmBox(text, okText = 'Ha', danger = true) {
  return new Promise((res) => {
    const sh = sheet(`<h3>${esc(text)}</h3><div style="display:flex;gap:8px"><button class="btn gh big" data-n>Bekor</button><button class="btn big ${danger ? 'red' : ''}" data-y>${esc(okText)}</button></div>`, { onClose: () => res(false) })
    qs('[data-n]', sh).onclick = () => closeSheet(sh)
    qs('[data-y]', sh).onclick = () => { const b = sh.closest('.shbg'); b._onClose = null; b.remove(); res(true) }
  })
}
function swHTML(on, attrs = '') { return `<span class="sw ${on ? 'on' : ''}" ${attrs}></span>` }
function share(text, url) {
  if (navigator.share) return navigator.share({ title: '50 Gram', text, url }).catch(() => {})
  copy((text ? text + ' ' : '') + (url || ''))
}
function copy(t) {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('📋 Nusxa olindi')).catch(() => {
    const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); toast('📋 Nusxa olindi') } catch {} a.remove()
  })
}

// ---------------- AUTH ----------------
let authPhone = '', resendT = 0
// v100: XALQARO RO‘YXATDAN O‘TISH — davlat kodi tanlanadi. UZ default: eski +998
// xatti-harakati BITTA-BITTA saqlangan (9 xona, XX XXX XX XX, server normPhone’si
// O‘ZGARMAGAN — 10-15 xonali to‘liq raqamni allaqachon qabul qiladi; eski ilovalar
// 998XXXXXXXXX yuboraveradi). d: davlat kodi, n: milliy uzunlik (nx: max, o‘zgaruvchan
// davlatlar), g: format guruhlari, p: namuna, k: qidiruv kalitlari (ionsiz lotin+kirill).
const CC_LIST = [
  { c: 'O‘zbekiston', f: '🇺🇿', d: '998', n: 9, g: [2, 3, 2, 2], p: '90 123 45 67', k: 'ozbekiston uzbekistan uzbek uz' },
  { c: 'Rossiya', f: '🇷🇺', d: '7', n: 10, g: [3, 3, 2, 2], p: '901 234 56 78', k: 'rossiya russia rus ru', pp: /^9/ },
  { c: 'Qozog‘iston', f: '🇰🇿', d: '7', n: 10, g: [3, 3, 2, 2], p: '701 234 56 78', k: 'qozogiston qozoqiston kazakhstan kazak kz', pp: /^7/ },
  { c: 'Qirg‘iziston', f: '🇰🇬', d: '996', n: 9, g: [3, 3, 3], p: '501 234 567', k: 'qirgiziston kirgiziston kyrgyzstan kirgiz kg' },
  { c: 'Tojikiston', f: '🇹🇯', d: '992', n: 9, g: [3, 3, 3], p: '555 123 456', k: 'tojikiston tajikistan tojik tj' },
  { c: 'Turkmaniston', f: '🇹🇲', d: '993', n: 8, g: [2, 3, 3], p: '65 123 456', k: 'turkmaniston turkmenistan turkmen tm' },
  { c: 'Ozarbayjon', f: '🇦🇿', d: '994', n: 9, g: [2, 3, 2, 2], p: '70 123 45 67', k: 'ozarbayjon azerbaycan azerbaijan az' },
  { c: 'Ukraina', f: '🇺🇦', d: '380', n: 9, g: [2, 3, 2, 2], p: '67 123 45 67', k: 'ukraina ukraine ukr ua' },
  { c: 'Belarus', f: '🇧🇾', d: '375', n: 9, g: [2, 3, 2, 2], p: '29 123 45 67', k: 'belarus belorussia bel by' },
  { c: 'Gruziya', f: '🇬🇪', d: '995', n: 9, g: [3, 3, 3], p: '555 123 456', k: 'gruziya georgia gruz ge' },
  { c: 'Armaniston', f: '🇦🇲', d: '374', n: 8, g: [2, 3, 3], p: '77 123 456', k: 'armaniston armenia arm am' },
  { c: 'Moldova', f: '🇲🇩', d: '373', n: 8, g: [2, 3, 3], p: '60 123 456', k: 'moldova md' },
  { c: 'Turkiya', f: '🇹🇷', d: '90', n: 10, g: [3, 3, 2, 2], p: '532 123 45 67', k: 'turkiya turkiye turkey turk tr' },
  { c: 'Germaniya', f: '🇩🇪', d: '49', n: 10, nx: 11, g: [3, 4, 4], p: '151 2345 6789', k: 'germaniya germany de' },
  { c: 'Fransiya', f: '🇫🇷', d: '33', n: 9, g: [1, 2, 2, 2, 2], p: '6 12 34 56 78', k: 'fransiya france fr' },
  { c: 'Buyuk Britaniya', f: '🇬🇧', d: '44', n: 10, g: [4, 6], p: '7400 123456', k: 'angliya britaniya uk britain england gb' },
  { c: 'Italiya', f: '🇮🇹', d: '39', n: 10, g: [3, 3, 4], p: '340 123 4567', k: 'italiya italy it' },
  { c: 'Ispaniya', f: '🇪🇸', d: '34', n: 9, g: [3, 3, 3], p: '612 345 678', k: 'ispaniya spain es' },
  { c: 'Niderlandiya', f: '🇳🇱', d: '31', n: 9, g: [1, 4, 4], p: '6 1234 5678', k: 'niderlandiya gollandiya netherlands holland nl' },
  { c: 'Polsha', f: '🇵🇱', d: '48', n: 9, g: [3, 3, 3], p: '501 234 567', k: 'polsha poland pl' },
  { c: 'Rumyniya', f: '🇷🇴', d: '40', n: 9, g: [3, 3, 3], p: '712 345 678', k: 'rumyniya romania ro' },
  { c: 'Chexiya', f: '🇨🇿', d: '420', n: 9, g: [3, 3, 3], p: '601 234 567', k: 'chexiya czech cz' },
  { c: 'Bolgariya', f: '🇧🇬', d: '359', n: 9, g: [3, 3, 3], p: '881 234 567', k: 'bolgariya bulgaria bg' },
  { c: 'Vengriya', f: '🇭🇺', d: '36', n: 9, g: [2, 3, 4], p: '20 123 4567', k: 'vengriya hungary hu' },
  { c: 'Shvetsiya', f: '🇸🇪', d: '46', n: 9, g: [2, 3, 2, 2], p: '70 123 45 67', k: 'shvetsiya sweden se' },
  { c: 'Norvegiya', f: '🇳🇴', d: '47', n: 8, g: [3, 2, 3], p: '401 23 456', k: 'norvegiya norway no' },
  { c: 'Daniya', f: '🇩🇰', d: '45', n: 8, g: [4, 4], p: '2012 3456', k: 'daniya denmark dk' },
  { c: 'Finlandiya', f: '🇫🇮', d: '358', n: 9, g: [3, 3, 3], p: '401 234 567', k: 'finlandiya finland fi' },
  { c: 'Litva', f: '🇱🇹', d: '370', n: 8, g: [3, 5], p: '612 34567', k: 'litva lithuania lt' },
  { c: 'Latviya', f: '🇱🇻', d: '371', n: 8, g: [2, 3, 3], p: '21 234 567', k: 'latviya latvia lv' },
  { c: 'Estoniya', f: '🇪🇪', d: '372', n: 8, g: [4, 4], p: '5123 4567', k: 'estoniya estonia ee' },
  { c: 'Shveytsariya', f: '🇨🇭', d: '41', n: 9, g: [2, 3, 2, 2], p: '78 123 45 67', k: 'shveytsariya switzerland ch' },
  { c: 'Avstriya', f: '🇦🇹', d: '43', n: 10, nx: 11, g: [4, 3, 3], p: '664 123 4567', k: 'avstriya austria at' },
  { c: 'Serbiya', f: '🇷🇸', d: '381', n: 8, g: [2, 3, 3], p: '64 123 456', k: 'serbiya serbia rs' },
  { c: 'Xorvatiya', f: '🇭🇷', d: '385', n: 8, g: [2, 3, 3], p: '91 234 567', k: 'xorvatiya croatia hr' },
  { c: 'Gretsiya', f: '🇬🇷', d: '30', n: 10, g: [3, 3, 4], p: '691 234 5678', k: 'gretsiya greece gr' },
  { c: 'Portugaliya', f: '🇵🇹', d: '351', n: 9, g: [3, 3, 3], p: '912 345 678', k: 'portugaliya portugal pt' },
  { c: 'Isroil', f: '🇮🇱', d: '972', n: 9, g: [2, 3, 4], p: '50 123 4567', k: 'isroil israel il' },
  { c: 'BAA', f: '🇦🇪', d: '971', n: 9, g: [2, 3, 4], p: '50 123 4567', k: 'baa dubay emirates uae' },
  { c: 'Saudiya Arabistoni', f: '🇸🇦', d: '966', n: 9, g: [3, 3, 3], p: '501 234 567', k: 'saudiya arabiston saudi ksa' },
  { c: 'Eron', f: '🇮🇷', d: '98', n: 10, g: [3, 3, 4], p: '912 123 4567', k: 'eron iran ir' },
  { c: 'Iroq', f: '🇮🇶', d: '964', n: 10, g: [3, 3, 4], p: '712 345 6789', k: 'iroq iraq iq' },
  { c: 'Afg‘oniston', f: '🇦🇫', d: '93', n: 9, g: [3, 3, 3], p: '701 234 567', k: 'afgoniston afghanistan af' },
  { c: 'Xitoy', f: '🇨🇳', d: '86', n: 11, g: [3, 4, 4], p: '138 1234 5678', k: 'xitoy china cn' },
  { c: 'Koreya', f: '🇰🇷', d: '82', n: 10, g: [3, 4, 3], p: '10 1234 5678', k: 'koreya korea kr seul' },
  { c: 'Yaponiya', f: '🇯🇵', d: '81', n: 10, g: [3, 4, 3], p: '90 1234 5678', k: 'yaponiya japan jp' },
  { c: 'Hindiston', f: '🇮🇳', d: '91', n: 10, g: [5, 5], p: '98765 43210', k: 'hindiston india in' },
  { c: 'Pokiston', f: '🇵🇰', d: '92', n: 10, g: [3, 3, 4], p: '301 234 5678', k: 'pokiston pakistan pk' },
  { c: 'Vetnam', f: '🇻🇳', d: '84', n: 9, g: [3, 3, 3], p: '912 345 678', k: 'vetnam vietnam vn' },
  { c: 'Tailand', f: '🇹🇭', d: '66', n: 9, g: [2, 3, 4], p: '81 234 5678', k: 'tailand thailand th' },
  { c: 'Indoneziya', f: '🇮🇩', d: '62', n: 9, nx: 12, g: [3, 4, 4], p: '812 3456 789', k: 'indoneziya indonesia id' },
  { c: 'Malayziya', f: '🇲🇾', d: '60', n: 9, g: [2, 3, 4], p: '12 345 6789', k: 'malayziya malaysia my' },
  { c: 'Filippin', f: '🇵🇭', d: '63', n: 10, g: [3, 3, 4], p: '917 123 4567', k: 'filippin philippines ph' },
  { c: 'AQSh', f: '🇺🇸', d: '1', n: 10, g: [3, 3, 4], p: '917 123 4567', k: 'aqsh amerika qoshma shtatlar usa united states us' },
  { c: 'Kanada', f: '🇨🇦', d: '1', n: 10, g: [3, 3, 4], p: '416 123 4567', k: 'kanada canada ca' },
  { c: 'Braziliya', f: '🇧🇷', d: '55', n: 11, g: [2, 5, 4], p: '11 91234 5678', k: 'braziliya brazil br' },
]
let authCC = CC_LIST[0]
const fmtGrp = (d, g) => { const o = []; let i = 0; for (const k of g) { if (i >= d.length) break; o.push(d.slice(i, i + k)); i += k } if (i < d.length) o.push(d.slice(i)); return o.join(' ') }
// v102: "+"-li to‘liq raqam aniqlagich — paste ham, qo‘lda belgi-belgi yozish ham.
// Kod 3→2→1 xona eng uzun moslik, RU/KZ milliy prefiks (9xx→RU, 7xx→KZ) bilan ajratiladi.
// Faqat MILLIY qism to‘liq yig‘ilganda javob beradi — yozish jarayonini BuzMAYDI.
function ccDetect(raw) {
  const s = String(raw || '')
  const d = s.replace(/\D/g, '')
  if (!s.trim().startsWith('+') || d.length < 10) return null
  for (let k = 3; k >= 1; k--) {
    const cands = CC_LIST.filter((x) => x.d === d.slice(0, k))
    if (!cands.length) continue
    const nat = d.slice(k)
    const hit = cands.find((x) => x.pp && x.pp.test(nat)) || cands[0]
    if (nat.length === (hit.nx || hit.n) || nat.length === hit.n) return { hit, nat }
    break
  }
  return null
}
function ccApply(x) {
  authCC = x
  $('cc-flag').textContent = x.f; $('cc-code').textContent = '+' + x.d
  const inp = $('phone')
  inp.placeholder = x.p; inp.maxLength = (x.nx || x.n) + x.g.length
  let d = inp.value.replace(/\D/g, '')
  if (d.startsWith(x.d) && d.length > x.n) d = d.slice(x.d.length)
  d = d.slice(0, x.nx || x.n)
  inp.value = fmtGrp(d, x.g)
}
$('cc-btn').onclick = () => {
  const sh = sheet(h3('Davlat / kod') + `<input class="inp" id="cc-q" placeholder="Davlat nomi yoki kod…" autocomplete="off"><div class="list" id="cc-l" style="max-height:52vh;overflow:auto"></div>`)
  const draw = (q) => {
    const s = String(q || '').toLowerCase().replace(/['‘’ʻʼ`]/g, '').trim()
    const rows = CC_LIST.filter((x) => !s || x.c.toLowerCase().replace(/['‘’ʻʼ`]/g, '').includes(s) || (x.k || '').includes(s) || x.d.startsWith(s))
    qs('#cc-l', sh).innerHTML = rows.length
      ? rows.map((x) => `<div class="cc-row" data-cci="${CC_LIST.indexOf(x)}"><span class="cc-f">${x.f}</span><b>${esc(x.c)}</b><span class="cc-d">+${x.d}</span></div>`).join('')
      : '<div class="mut" style="padding:16px;text-align:center">Topilmadi</div>'
    qsa('.cc-row', sh).forEach((r) => (r.onclick = () => { ccApply(CC_LIST[+r.dataset.cci]); closeSheet(sh); setTimeout(() => $('phone').focus(), 60) }))
  }
  qs('#cc-q', sh).addEventListener('input', (e) => draw(e.target.value))
  draw('')
}
function showAuth() {
  $('auth').classList.remove('hide'); $('main').classList.add('hide'); $('dialog').classList.add('hide')
  step('a-phone'); setTimeout(() => $('phone').focus(), 50)
}
function step(id) { qsa('.step').forEach((s) => s.classList.toggle('hide', s.id !== id)) }
$('phone').addEventListener('input', (e) => {
  bandForce = false // raqam o'zgarsa — «mavjud» holati yangi raqamga tegishli emas
  const bn = $('band-note'); if (bn) bn.classList.add('hide')
  const raw = e.target.value
  // v102: "+..." — xalqaro yozuv: formatlashni TO‘XTAT (belgi-belgi yozish buzilmasin),
  // davlat aniqlanishi bilanoq o‘zi tozalanadi va formatlanadi (ccApply)
  if (raw.trim().startsWith('+')) {
    const det = ccDetect(raw)
    if (det) ccApply(det.hit)
    return
  }
  let d = raw.replace(/\D/g, '')
  // v100: to‘liq raqam yopishtirilgan bo‘lsa (+998…/+7…/+996…) — davlat kodini uzib tashla
  if (d.startsWith(authCC.d) && d.length > authCC.n) d = d.slice(authCC.d.length)
  // RU/KZ an’anasi: 8 bilan boshlangan to‘liq raqam (8 901 234 56 78)
  if (authCC.d === '7' && d.length === 11 && d[0] === '8') d = d.slice(1)
  d = d.slice(0, authCC.nx || authCC.n)
  e.target.value = fmtGrp(d, authCC.g)
})
$('phone').addEventListener('keydown', (e) => e.key === 'Enter' && $('b-otp').click())
$('code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6) $('b-verify').click() })
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('b-verify').click())
// v73: «Bu raqam tarmoqda mavjud» holati — raqam boshqa qurilmada faol. EGASI hech
// qachon qotib qolmasin: «Bu mening raqamim» tugmasi force=1 bilan kodni ochadi,
// kirgach eski qurilma sess aylanishi tufayli avtomatik chiqadi (bitta raqam — bitta faol dastur).
let bandForce = false
$('b-band-yes').onclick = () => { bandForce = true; $('band-note').classList.add('hide'); $('b-otp').click() }
$('b-band-no').onclick = () => { bandForce = false; $('band-note').classList.add('hide') }
$('b-otp').onclick = async () => {
  const raw = $('phone').value
  const det = ccDetect(raw)
  if (det) ccApply(det.hit) // "+996 501 234 567" kabi yozilgan bo'lsa — davlat o'zi tanib, milliy qismga o'tadi
  else if (raw.trim().startsWith('+')) return toast('Raqamni to‘liq kiriting: ' + authCC.p)
  const d = $('phone').value.replace(/\D/g, '')
  if (d.length < authCC.n || d.length > (authCC.nx || authCC.n)) return toast('Raqamni to‘liq kiriting: ' + authCC.p)
  $('band-note').classList.add('hide')
  const b = $('b-otp'); b.disabled = true; b.textContent = 'Yuborilmoqda...'
  try {
    const r = await post('/auth/otp', { phone: authCC.d + d, ...(bandForce ? { force: 1 } : {}) })
    bandForce = false
    authPhone = r.phone
    if (r.dev_code) {
      // ILOVA-ICHKI REJIM (SMS_MODE="app", haqiqiy SMS hali yo'q): kod SHU YERDA
      // qizil yozuvda beriladi — foydalanuvchi kodni BOSADI, u o'zi kiritiladi.
      $('code-info').innerHTML = `<b>${esc(authPhone)}</b> raqami uchun tasdiqlash kodi:`
      $('code-info').innerHTML += `<div id="devcode" style="margin-top:12px;color:var(--qizil);font-size:36px;font-weight:800;letter-spacing:10px;line-height:1;cursor:pointer;user-select:none;font-variant-numeric:tabular-nums" title="Bosing — kod o‘zi kiritiladi">${r.dev_code}</div><div class="mut" style="margin-top:8px">👆 Kodni bosing — avtomatik kiritiladi (haqiqiy SMS foydalanuvchilar ko‘paygach ulanadi)</div>`
    } else {
      $('code-info').innerHTML = `<b>${esc(authPhone)}</b> raqamiga SMS kod yuborildi`
    }
    step('a-code'); $('code').value = ''; setTimeout(() => $('code').focus(), 50); startResend(r.dev_code ? 20 : 60)
    if (r.dev_code) {
      const dc = $('devcode')
      if (dc) dc.onclick = () => { $('code').value = r.dev_code; $('b-verify').click() }
    }
  } catch (e) {
    if (e.status === 409 && !bandForce) {
      // BOSHQA QURILMADA FAOL («Bu raqam tarmoqda mavjud») — lekin RAQAM QOTIB QOLMAYDI:
      // egasi «Bu mening raqamim» tugmasi bilan kod olib kira oladi (force=1).
      $('band-msg').textContent = e.message
      $('band-note').classList.remove('hide')
      try { $('band-note').scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch {}
    } else toast('⚠️ ' + e.message)
  }
  b.disabled = false; b.textContent = 'Kod olish'
}
function startResend(sec = 60) {
  let s = sec; const b = $('b-resend'); b.disabled = true
  clearInterval(resendT)
  resendT = setInterval(() => { s--; b.textContent = s > 0 ? `Qayta yuborish (${s})` : 'Qayta yuborish'; if (s <= 0) { b.disabled = false; clearInterval(resendT) } }, 1000)
}
$('b-resend').onclick = () => { step('a-phone'); $('b-otp').click() }
$('b-back').onclick = () => { step('a-phone'); $('phone').focus() }
$('b-verify').onclick = async () => {
  const code = $('code').value
  if (code.length !== 6) return toast('6 xonali kodni kiriting')
  const b = $('b-verify'); b.disabled = true
  try {
    const r = await post('/auth/verify', { phone: authPhone, code })
    S.token = r.token; localStorage.setItem('g50_token', r.token)
    setMe(r.user)
    if (r.is_new) { step('a-prof'); setTimeout(() => $('ap-first').focus(), 50) }
    else startApp()
  } catch (e) { toast('⚠️ ' + e.message); $('code').select() }
  b.disabled = false
}
let apAvatar = null
$('ap-av').onclick = async (e) => {
  e.preventDefault()
  const f = await pickFile('image/*'); if (!f) return
  try { apAvatar = await avatarDataUrl(f); $('ap-av').style.backgroundImage = `url(${apAvatar})`; $('ap-av').firstElementChild.textContent = '' } catch (er) { toast(er.message) }
}
$('b-prof').onclick = async () => {
  const first = $('ap-first').value.trim()
  if (!first) return toast('Ismingizni kiriting')
  const b = $('b-prof'); b.disabled = true
  try {
    const body = { first_name: first, last_name: $('ap-last').value.trim() }
    if (apAvatar) body.avatar = apAvatar
    setMe(await patch('/me', body)); startApp()
  } catch (e) { toast('⚠️ ' + e.message) }
  b.disabled = false
}
function setMe(u) { S.me = { ...(S.me || {}), ...u }; localStorage.setItem('g50_me', JSON.stringify(S.me)) }
async function logout(silent) {
  // Serverga ham xabar: hisob "chiqdi" → shu raqam endi kod olish uchun OCHIQ (muallif tizimi).
  // v72 TUZATISH («logout qilmay dastur» — raqam BAND qolishi ildizi): oldin fetch FIRE-AND-FORGET
  // edi — darhol location.reload() WebView so'rovni o'chirib yuborardi, server logout_at YOZMASDI
  // → raqam «BAND» qolaverardi. Endi fetch AWAIT qilinadi (3s oshiq-vaqt himoyasi bilan) —
  // server javobini kutib turib, SO'NNG sahifa yangilanadi.
  try {
    if (S.token) await Promise.race([
      fetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token }, keepalive: true }),
      new Promise((res) => setTimeout(res, 3000)),
    ])
  } catch {}
  // APK fon xizmati ham to'xtasin: eski token bilan polling/beat davom etsa hisob "band" qolaveradi
  try { window.Android50 && window.Android50.setToken && window.Android50.setToken('') } catch {}
  localStorage.removeItem('g50_token'); localStorage.removeItem('g50_me')
  S.token = ''; S.me = null
  try { S.ws && S.ws.close() } catch {}
  if (!silent) location.reload(); else { location.hash = ''; setTimeout(() => location.reload(), 300) }
}

// ---------------- REAL-TIME ----------------
// QO'NG'IROQ QO'RIQHONASI — 1-QALQON: WS PONG QOROVUSI.
// ILDIZ («avval ishlar, keyin o'zi buzilardi»): klient har 25s 'ping' yuborardi LEKIN
// 'pong' qaytishini HECH QACHON tekshirmasdi. Mobil tarmoq o'zgarganda (Wi-Fi↔mobil,
// NAT timeout, WebView uxlashi) soket JIM o'ladi: readyState 1-da qolaveradi, onclose
// MINUTLAR davomida kelmaydi — ilova «ulanagan» deb xato hisoblab yuradi va barcha
// hodisalar (QO'NG'IROQ!) yo'qolardi. Endi: har kelgan xabar 'lastWsRecv'ni yangilaydi;
// 55s davomida HECH NARSA kelmasa (2 ta ping'ga javob yo'q) — soket O'LIK deb e'lon
// qilinadi, majburiy yopiladi va DARHOL qayta ulanadi. Zombi-WS endi 1 daqiqadan
// kechikmay topiladi — bu qatlam boshqa hech qachon «jonli ko'rinuvchi o'lik» holatga qaytmaydi.
let wsRetry = 1000, pingT = 0, lastWsRecv = 0
function wsConnect() {
  if (!S.token) return
  // IKKILANCHA ULANISH GUARDI: startApp har holatda wsConnect()ni chaqiradi (profil
  // bosqichidan ham o'tadi) — ochiq/ochilayotgan soket bo'lsa qayta OCHMAYMIZ (aks holda
  // ikkita WS: signallar ikki marta yetardi, dedup/pong adashardi)
  if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return
  try {
    const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(S.token))
    S.ws = ws
    ws.onopen = () => { S.wsOk = true; wsRetry = 1000; lastWsRecv = Date.now(); setConn(); syncAll(); try { console.info('[ws] ochildi') } catch {} ; try { window.__50wsOpen && window.__50wsOpen() } catch {}; try { Outbox.flush() } catch {} }
    ws.onmessage = (e) => { lastWsRecv = Date.now(); let ev; try { ev = JSON.parse(e.data) } catch { return } if (ev.type !== 'pong') dispatch(ev) }
    ws.onclose = (ev) => { S.wsOk = false; setConn(); try { console.info('[ws] yopildi code=' + (ev && ev.code) + ' clean=' + !!(ev && ev.wasClean)) } catch {}; if (S.ws === ws) S.ws = null; if (S.token) setTimeout(wsConnect, wsRetry); wsRetry = Math.min(wsRetry * 2, 20000) }
    ws.onerror = () => { try { console.info('[ws] xato (socket error)') } catch {} }
    clearInterval(pingT); pingT = setInterval(() => {
      try {
        if (ws.readyState !== 1) return
        ws.send('ping')
        // PONG QOROVUSI: 2 ta ping'ga ham javob (yoki istalgan xabar) kelmagan — O'LIK soket.
        // Majburiy close() → onclose → zudlik bilan qayta ulanish + __50wsOpen pending-call tortadi.
        if (lastWsRecv && Date.now() - lastWsRecv > 55000) { try { ws.close() } catch {} }
      } catch {}
    }, 25000)
  } catch { setTimeout(wsConnect, 5000) }
}
function setConn() { $('conn').textContent = S.wsOk ? '' : navigator.onLine ? 'ulanmoqda…' : 'internet yo‘q' }
function dispatch(ev) { (S.handlers[ev.type] || []).forEach((f) => { try { f(ev) } catch (e) { console.error(e) } }) }
let pollBusy = false, lastChatsLoad = 0
async function poll() {
  if (!S.token || pollBusy || document.hidden) return
  pollBusy = true
  try {
    const t = Date.now()
    if (!S.wsOk || t - lastChatsLoad > 30000) await loadChats()
    if (S.cur && (!S.wsOk || S.chats.get(S.cur)?.member_count > 40 || !S.chats.get(S.cur))) await fetchMessages(S.cur)
  } catch {}
  pollBusy = false
}
function syncAll() { loadChats(); if (S.cur) fetchMessages(S.cur); loadStories(); }

// ---------------- CHATLAR RO'YXATI ----------------
async function loadChats() {
  const r = await api('/chats')
  lastChatsLoad = Date.now(); S.serverNow = r.now
  try { S.tSkew = Date.now() - (+r.now || Date.now()) } catch { S.tSkew = 0 } // klient soati skewi — qo'ng'iroq yoshi server vaqti bilan tekshiriladi
  const seen = new Set()
  for (const c of r.chats) { seen.add(c.id); const old = S.chats.get(c.id); S.chats.set(c.id, { ...old, ...c, joined: true }) }
  for (const [id, c] of S.chats) if (!seen.has(id) && c.joined) S.chats.delete(id)
  for (const c of r.chats) if (c.peer) S.users.set(c.peer.id, c.peer)
  renderChats()
  if (S.cur && S.chats.has(S.cur)) renderHeader()
}
function chatName(c) { if (!c) return ''; if (c.type === 'direct') return c.saved ? 'Saqlangan xabarlar' : uname(c.peer); return c.title }
function msgPreview(m, c) {
  if (!m) return ''
  if (m.deleted) return '🚫 Xabar o‘chirildi'
  const who = c && c.type === 'group' && m.sender_id !== S.me.id && m.kind !== 'system' ? (S.users.get(m.sender_id)?.first_name || '') : ''
  const P = { photo: '🖼 Rasm', video: '🎬 Video', voice: '🎤 Ovozli xabar', round: '⭕ Video xabar', file: '📄 ' + (m.meta?.name || 'Fayl'), sticker: (m.meta?.e || '') + ' Stiker', gif: '🎞 GIF', contact: '👤 Kontakt', poll: '📊 ' + (m.meta?.q || 'So‘rovnoma'), location: '📍 Joylashuv', call: (m.meta?.video ? '📹' : '📞') + ' Qo‘ng‘iroq', system: m.body }
  const t = m.kind === 'text' ? m.body : (P[m.kind] || '') + (m.body && m.kind !== 'system' ? ' ' + m.body : '')
  return (who ? who + ': ' : m.sender_id === S.me.id && c?.type !== 'channel' && m.kind !== 'system' && m.kind !== 'call' ? 'Siz: ' : '') + t
}
function typingText(chatId) {
  const t = S.typing.get(chatId)
  if (!t || t.until < Date.now()) return ''
  const a = { voice: 'ovoz yozmoqda', round: 'video yozmoqda', file: 'fayl yubormoqda' }[t.action] || 'yozmoqda'
  const c = S.chats.get(chatId)
  return (c && c.type !== 'direct' ? (S.users.get(t.uid)?.first_name || '') + ' ' : '') + a + '…'
}
// OPTIMIZATSIYA: faqat o'zgargan qatorlarni DOM'da almashtirish — to'liq innerHTML qayta chizish yo'q.
// Bu messengerning asosiy tezlik g'alabasi: har xabar/typing/o'qish hodisasida ro'yxat qayta qurilmaydi.
function diffInto(box, keys, htmls) {
  const oK = box._dk, oH = box._dh, oE = box._de
  // Kesh faqat hozirgi DOM bilan aynan mos kelganda ishlaydi (qidiruv va boshqalar innerHTML'ni to'g'ridan-to'g'ri yozishi mumkin)
  const okCache = oK && oH && oE && oE.length === oK.length && oK.length === oH.length && box.children.length === oK.length && (oK.length === 0 || oE[0].parentNode === box)
  if (okCache && oK.length === keys.length) {
    let same = true
    for (let i = 0; i < keys.length; i++) if (oK[i] !== keys[i] || oH[i] !== htmls[i]) { same = false; break }
    if (same) return false
  }
  if (!okCache) { box.innerHTML = htmls.join(''); box._dk = keys.slice(); box._dh = htmls.slice(); box._de = Array.from(box.children); return true }
  const oLen = oK.length, nLen = keys.length
  let p = 0
  while (p < oLen && p < nLen && oK[p] === keys[p] && oH[p] === htmls[p]) p++
  let s = 0
  while (s < oLen - p && s < nLen - p && oK[oLen - 1 - s] === keys[nLen - 1 - s] && oH[oLen - 1 - s] === htmls[nLen - 1 - s]) s++
  const delA = p, delB = oLen - s, insA = p, insB = nLen - s
  const anchor = delB < oE.length ? oE[delB] : null
  for (let i = delA; i < delB; i++) { const el = oE[i]; el && el.remove() }
  if (insA < insB) {
    const t = document.createElement('template')
    t.innerHTML = htmls.slice(insA, insB).join('')
    box.insertBefore(t.content, anchor)
  }
  box._dk = keys.slice(); box._dh = htmls.slice(); box._de = Array.from(box.children)
  return true
}
// rAF birlashtirish: bir kadrda kelgan bir nechta render so'rovi — bitta chizish
let chQ = false
function scheduleChats() { if (chQ) return; chQ = true; requestAnimationFrame(() => { chQ = false; try { renderChats() } catch (e) {} }) }
let msQ = false, msF = false
function scheduleMsgs(force) { if (force) msF = true; if (msQ) return; msQ = true; requestAnimationFrame(() => { msQ = false; const f = msF; msF = false; try { renderMsgs(f) } catch (e) {} }) }
function renderChats() {
  const list = [...S.chats.values()].filter((c) => c.joined).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.last_message?.created_at || b.last_msg_at) - (a.last_message?.created_at || a.last_msg_at))
  const q = $('q').value.trim()
  if (q) return
  let total = 0
  const live = new Map(S.lives.map((l) => [l.user.id, l]))
  const keys = [], rows = []
  for (const c of list) {
    if (!c.muted) total += c.unread
    const lm = c.last_message
    const ty = typingText(c.id)
    const mine = lm && lm.sender_id === S.me.id && c.type !== 'channel' && !['system', 'call'].includes(lm.kind)
    const tick = mine ? `<span class="tick">${c.type === 'direct' && c.peer_last_read >= lm.id ? '✓✓' : '✓'}</span>` : ''
    const icon = c.type === 'channel' ? '📢 ' : c.type === 'group' ? '👥 ' : ''
    const pinI = c.pinned ? '<span class="pin-i" title="Qadalgan">📌</span>' : ''
    const lv = c.peer ? live.get(c.peer.id) : null
    const av = c.type === 'direct' ? avHTML(c.peer, 54, { dot: true, saved: c.saved, live: !!lv, liveId: lv?.id }) : avHTML(c, 54, { chat: true })
    keys.push('c' + c.id)
    rows.push(`<div class="item ${S.cur === c.id ? 'act' : ''}" data-chat="${c.id}">${av}<div class="mid"><div class="t1"><b>${icon}${esc(chatName(c))}</b>${pinI}${lv ? '<span class="lvt">🔴 Efir</span>' : ''}${c.muted ? '<span class="mut">🔕</span>' : ''}<span class="tm">${tick} ${fmtShort(lm?.created_at || c.last_msg_at)}</span></div>
      <div class="t2"><span class="${ty ? 'typ' : ''}">${esc(ty || msgPreview(lm, c) || (c.type === 'direct' ? 'Salom deb yozing 👋' : ''))}</span>${c.unread ? `<b class="cnt ${c.muted ? 'm' : ''}">${c.unread > 99 ? '99+' : c.unread}</b>` : ''}</div></div></div>`)
  }
  if (!rows.length) { keys.push('empty'); rows.push(`<div class="empty"><span class="big">💬</span>Hali chatlar yo‘q.<br>Yuqoridagi qidiruvda ism, @username yoki telefon raqam yozing<br>yoki <a href="#" onclick="tabGo('t-contacts');return false">kontakt qo‘shing</a>.</div>`) }
  diffInto($('chatlist'), keys, rows)
  const bd = $('badge'); bd.textContent = total > 99 ? '99+' : total; bd.classList.toggle('hide', !total)
  document.title = total ? `(${total}) 50 Gram` : '50 Gram'
}
$('chatlist').addEventListener('click', (e) => { const it = e.target.closest('[data-chat]'); if (it) openChat(+it.dataset.chat) })

// Qidiruv
let qT = 0
$('q').addEventListener('input', () => {
  clearTimeout(qT)
  const q = $('q').value.trim()
  $('stories').classList.toggle('hide', !!q)
  if (!q) return renderChats()
  const local = [...S.chats.values()].filter((c) => chatName(c).toLowerCase().includes(q.toLowerCase()))
  const head = local.length ? '<div class="sec">Chatlar</div>' + local.map((c) => `<div class="item" data-chat="${c.id}">${c.type === 'direct' ? avHTML(c.peer, 46, { saved: c.saved }) : avHTML(c, 46, { chat: true })}<div class="mid"><div class="t1"><b>${esc(chatName(c))}</b></div></div></div>`).join('') : ''
  $('chatlist').innerHTML = head + '<div class="spin"></div>'
  qT = setTimeout(async () => {
    try {
      const r = await api('/search?q=' + encodeURIComponent(q))
      if ($('q').value.trim() !== q) return
      const us = r.users.map((u) => `<div class="item" data-user="${u.id}">${avHTML(u, 46)}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b>${u.is_contact ? '<span class="tagc">kontakt</span>' : ''}</div><div class="t2"><span>${u.username ? '@' + esc(u.username) : esc(lastSeen(u))}</span></div></div></div>`).join('')
      const cs = r.chats.map((c) => `<div class="item" data-open="${c.id}">${avHTML(c, 46, { chat: true })}<div class="mid"><div class="t1"><b>${c.type === 'channel' ? '📢' : '👥'} ${esc(c.title)}</b></div><div class="t2"><span>${c.username ? '@' + esc(c.username) + ' · ' : ''}${c.member_count} ${c.type === 'channel' ? 'obunachi' : 'a‘zo'}</span></div></div></div>`).join('')
      $('chatlist').innerHTML = head + (us ? '<div class="sec">Odamlar</div>' + us : '') + (cs ? '<div class="sec">Kanal va guruhlar</div>' + cs : '') + (!us && !cs && !head ? '<div class="empty"><span class="big">🔎</span>Hech narsa topilmadi.<br>To‘liq raqam yozing: 90 123 45 67</div>' : '')
    } catch (e) { $('chatlist').innerHTML = head + `<div class="empty">${esc(e.message)}</div>` }
  }, 350)
})
$('chatlist').addEventListener('click', (e) => {
  const u = e.target.closest('[data-user]'); if (u) return openUser(+u.dataset.user)
  const o = e.target.closest('[data-open]'); if (o) openChat(+o.dataset.open)
})

// ---------------- TABLAR ----------------
function tabGo(id) {
  S.tab = id
  qsa('.tab').forEach((t) => t.classList.toggle('on', t.id === id))
  qsa('.dock button').forEach((b) => b.classList.toggle('on', b.dataset.t === id))
  if (id === 't-contacts') loadContacts()
  if (id === 't-feed') (feedMode === 'trend' ? loadTrend(true) : loadFeed(true))
  if (id === 't-reels') { loadReels(true); shortsStart({ reelsOnly: true }) }
  if (id === 't-channels') renderChannels()
  if (id === 't-me') renderMe()
}
qsa('.dock button').forEach((b) => (b.onclick = () => tabGo(b.dataset.t)))

// ---------------- ISHGA TUSHIRISH ----------------
async function startApp() {
  $('auth').classList.add('hide'); $('main').classList.remove('hide'); $('dialog').classList.remove('hide')
  renderChats()
  try { setMe(await api('/me')) } catch (e) { if (!S.token) return }
  // WS HAR QANDAY HOLATDA OCHILADI (profil to'liq bo'lmasa ham): avvalgi kod profil
  // to'liq emas yoki /me sekin bo'lsa ERTA qaytardi va WS UMUMAN ochilmasdi — ilova
  // «ochiq ko'rinib» turgan holda HAMMA real-vaqt hodisasi (qo'ng'iroq, signal, xabar)
  // yo'qolardi. Bu «avval ishlar, keyin o'zi buzilar edi»ning yashirin ildizi.
  wsConnect()
  // v87: ISHGA-TUSHDI MAYAGI — har qurilma ilova ochilganda jurnalda KO'RINADI
  // («brauzerda umuman ishlamadi» endi ko'rinmay qolmaydi — build/UA/tarmoq yoziladi)
  setTimeout(() => g50Beacon('ishga-tushdi'), 2500)
  try { navigator.serviceWorker?.getRegistration?.().then((r) => { if (!r) g50Beacon('sw-yoq') }).catch(() => {}) } catch {}
  if (!S.me.first_name) { $('auth').classList.remove('hide'); $('main').classList.add('hide'); step('a-prof'); return }
  post('/ping').catch(() => {})
  // APK: token'ni native tomonga beramiz — fon xizmati qo'ng'iroqlarni polling bilan oladi (v2.5)
  try { window.Android50 && window.Android50.setToken && window.Android50.setToken(S.token) } catch {}
  // v78 PUSH AVTO-YOQISH: avval push FAQAT sozlamalardan qo'lda yoqilardi — hech kim
  // yoqmasdi, ilova fonda turganda xabar/qo'ng'iroqdan HECH NARSA ko'rinmasdi. Endi birinchi
  // kirishda BIR MARTA muloyim so'raladi (Telegram-uslubi) — rad etilsa boshqa so'ralmaydi.
  // APK'da PushManager bo'lmaydi (WebView) — u yerda fon xizmati polling bilan ishlaydi.
  try { g50AutoPush() } catch {}
  // Avtomatik ruxsat: birinchi bosishda kamera/mikrofonni bir marta so'raymiz —
  // shundan keyin qo'ng'iroqlar va ovozli xabarlar oynasiz ishlaydi (rtc.js)
  try { window.__50warmup && window.__50warmup() } catch {}
  await Promise.all([loadChats().catch((e) => toast(e.message)), loadStories().catch(() => {}), loadContactsQuiet(), loadLives()])
  // wsConnect() yuqorida chaqirildi (profil tekshiruvidan oldin) — bu yerda ikki marta
  // chaqirilishi IKKITA WebSocket ochardi (signallar ikki marta yetardi, 'pong' adashardi)
  setInterval(poll, 4000)
  setInterval(() => { if (!document.hidden) post('/ping').catch(() => {}) }, 45000)
  setInterval(() => { if (!document.hidden) { loadStories().catch(() => {}); loadLives() } }, 60000)
  setInterval(() => { for (const [k, t] of S.typing) if (t.until < Date.now()) { S.typing.delete(k); scheduleChats(); if (S.cur === k) renderHeader() } }, 1500)
  // BUILD QOROVUSI: har 90s server versiyasini tekshirish (mos kelmasa — o'zi yangilanadi).
  // Qo'ng'iroq oynasida kutiladi — endCall'dan keyin zudlik bilan tekshiriladi.
  setInterval(() => { if (!document.hidden) checkBuildSafe() }, 90000)
  // Service Worker'ni ham tezlashtiramiz: yangi versiya navbatda turib qolmasin
  if ('serviceWorker' in navigator) setInterval(() => { try { navigator.serviceWorker.getRegistration().then((r) => r && r.update && r.update().catch(() => {})) } catch {} }, 300000)
  checkBuildSafe()
  handleHash()
  // v76: kamera avto-tiklanishi — sahifa yangilangach qo'ng'iroq o'zi qayta yoqiladi (rtc.js)
  try { window.__50camRedial && window.__50camRedial() } catch {}
  // Trend videolari fonda tayyorlanadi — Reels bo'limi ochilganda DARHOL qiziq videolar chiqadi
  setTimeout(() => { try { window.warmTrend && window.warmTrend() } catch {} }, 1800)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
    sendPrefsToSW()
    try {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data || {}
        if (d.type === 'openchat' && d.chat_id) { try { openChat(d.chat_id) } catch {} }
        if (d.type === 'pushmsg' && d.data) { if (S.prefs.sounds) beep(660, 0.08) } // ilova ekranda — WS allaqachon ko'rsatadi
      })
    } catch {}
  }
  initPush()
}
window.addEventListener('online', () => { setConn(); if (!S.wsOk) wsConnect(); setTimeout(() => { try { Outbox.flush() } catch {} }, 2500) })
// v97: har 45s — navbatdagi (offline paytdagi) xabar/fayllarni yuborish urinishi
setInterval(() => { try { Outbox.flush() } catch {} }, 45000)
window.addEventListener('offline', setConn)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) { g50SoftUpdate(); checkBuildSafe(); poll(); if (S.cur) markRead(S.cur); try { Outbox.flush() } catch {} } })
// Task 39: APK/brauzer ESKI sahifani xotirada saqlab qolmasin — 5 soatdan eski ochiq sahifa
// qayta yuklanadi (yangi versiya + TEST rejimi banneri darhol ko'rinadi). Faol qo'ng'iroq/efir
// yoki ochiq oyna paytida hech qachon uzilmaydi — keyingi qaytishda yangilanadi.
const G50_BOOT = Date.now()
function g50SoftUpdate() {
  try {
    if (Date.now() - G50_BOOT < 5 * 3600e3) return
    if (typeof CALL !== 'undefined' && CALL) return
    if (typeof LIVE !== 'undefined' && LIVE) return
    // APK fon qo'ng'irog'i kutilayotgan bo'lsa — sahifa qayta yuklanmasin (javob berish oynasi yo'qolmasin)
    if (typeof pendingNativeCall !== 'undefined' && pendingNativeCall) return
    if (qs('.shbg')) return // ochiq oyna bor — keyingi qaytishda
    location.replace(location.href)
  } catch {}
}
// APK ilovadan qaytganda: darhol sinxronlash va uzilgan WS'ni tiklash (MainActivity.onResume chaqiradi)
window.__appResume = () => { try { if (!S.token) return; g50SoftUpdate(); checkBuildSafe(); poll(); if (S.cur) markRead(S.cur); if (!S.ws || S.ws.readyState === 3) wsConnect() } catch {} }

// ---------------- BUILD QOROVUSI (qo'ng'iroq qo'riqxonasi — 2-QALQON: «o'zgarmas qotirish») ----------------
// ILDIZ («avval ishlar, keyin o'zi buzilardi» — 2-sabab): har tuzatish serverga yetardi,
// LEKIN ochiq turgan sahifa/APK WebView kunlab ESKI JS bilan ishlayverardi (service worker
// yangilansa ham ishlayotgan sahifa o'zi qayta yuklanmaydi) — foydalanuvchiga tuzatish
// YETMASDI. Endi: serverdagi BUILD_V bilan klientdagi __50BUILD solishtiriladi — mos
// kelmasa ilova o'zini yangilaydi. Natija: HAR tuzatish HAR QURILMAGA ~1 daqiqada yetadi.
// Himoyalar: qo'ng'iroq/efir/oyna paytida HECH QACHON yuklanmaydi; 2 marta ketma-ket
// mos kelmaslik talab qilinadi; 2 daqiqalik loop-himoya (takroriy reload yo'q).
window.__50BUILD = 'v102'
let buildMismatch = 0, buildBusy = false, buildConfT = 0
window.__50buildCheck = async () => {
  if (buildBusy) return
  buildBusy = true
  try {
    const r = await fetch(API + '/build', { cache: 'no-store' }).catch(() => null)
    if (!r || !r.ok) return
    const j = await r.json().catch(() => null)
    const v = String((j && j.v) || '')
    if (!v) return
    if (v === window.__50BUILD) { buildMismatch = 0; clearTimeout(buildConfT); buildConfT = 0; return }
    // Mos kelmadi: 1-marta — 25s'dan keyin tasdiqlash so'rovi; 2-marta — yangilanish
    buildMismatch++
    if (buildMismatch >= 2) g50ReloadNew()
    else if (!buildConfT) buildConfT = setTimeout(() => { buildConfT = 0; window.__50buildCheck() }, 25000)
  } finally { buildBusy = false } // EARLY RETURN'da ham bayroq ochiladi — qorovul abadiy o'lmaydi
}
function checkBuildSafe() { try { window.__50buildCheck && window.__50buildCheck() } catch {} }
function g50ReloadNew() {
  try {
    if (document.hidden) return // yashirin holatda emas — ko'rinishda tekshiriladi
    if (typeof CALL !== 'undefined' && CALL) return // QO'NG'IROQ paytida hech qachon
    if (typeof LIVE !== 'undefined' && LIVE) return // jonli efir paytida hech qachon
    // ⚠️ POYGA HIMoyasi: native/push qo'ng'iroq oynasi ko'rinayotgan bo'lsa (CALL hali
    // yaratilmagan holatda ham) reload qo'ng'iroq oynasini O'CHIRIB qo'yardi — «bitta
    // sigan berib o'chib qoldi» ildizlaridan biri. Endi kutamiz — keyingi qaytishda yangilanadi.
    if (typeof pendingNativeCall !== 'undefined' && pendingNativeCall) return
    if (qs('.shbg')) return // ochiq oyna/paneld paytida
    const t = +(localStorage.getItem('g50_breload') || 0)
    if (Date.now() - t < 120000) return // LOOP-HIMOYA: so'nggi 2 daqiqada yangilangan bo'lsa kutamiz
    localStorage.setItem('g50_breload', String(Date.now()))
    buildMismatch = 0
    toast('Ilova yangilanmoqda…')
    setTimeout(() => location.reload(), 700)
  } catch {}
}
window.addEventListener('hashchange', handleHash)
// ─────────────── v87: ISHGA-TUSHDI MAYAGI + JS-XATO HISOBOTCHISI ───────────────
// MUAMMO: «brauzerda umuman qo'ng'iroq bog'lanmadi» shikoyatida jurnalda HECH QANDAY
// iz yo'q edi — brauzer qurilma qaysi sahifa ochgani, qaysi build ekanligi, JS xatosi
// bo'lgani — HECH NARSA ma'lum emasdi, tashxis IMKONSIZ edi. Endi:
// 1) har ilova ochilganda BITTA qator jurnalga yoziladi (build, apk, tarmoq, UA)
// 2) ushlanmagan JS xatolar ham yoziladi (bir sahifada max 3 ta)
let g50BeaconN = 0
function g50Beacon(tag) {
  try {
    if (!S.token || g50BeaconN >= 8) return
    g50BeaconN++
    const m = tag + ' | build=' + window.__50BUILD + ' | apk=' + (window.Android50 ? 1 : 0)
      + ' | dev=' + (window.Android50 && typeof window.Android50.devInfo === 'function' ? (function () { try { return String(window.Android50.devInfo()) } catch (e) { return '?' } })() : 'web')
      + ' | on=' + (navigator.onLine ? 1 : 0) + ' | hid=' + document.visibilityState
      + ' | ua=' + String(navigator.userAgent || '').slice(-70)
    fetch(API + '/clog', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token }, body: JSON.stringify({ c: 'diag', m }), keepalive: true }).catch(() => {})
  } catch {}
}
let g50ErrN = 0
function g50ShipErr(kind, msg) {
  try {
    if (!S.token || g50ErrN >= 3) return
    g50ErrN++
    const m = kind + ' | ' + String(msg || '?').replace(/\s+/g, ' ').slice(0, 300) + ' | build=' + window.__50BUILD
    fetch(API + '/clog', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token }, body: JSON.stringify({ c: 'diag', m }), keepalive: true }).catch(() => {})
  } catch {}
}
try { window.addEventListener('error', (e) => g50ShipErr('js-xato', (e.message || '?') + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno)) } catch {}
try { window.addEventListener('unhandledrejection', (e) => g50ShipErr('js-rad', e.reason && (e.reason.message || e.reason))) } catch {}
async function handleHash() {
  const h = decodeURIComponent(location.hash.slice(1))
  if (!h || !S.token || !S.me?.first_name) return
  history.replaceState(null, '', location.pathname)
  try {
    if (h.startsWith('join/')) {
      const c = await api('/invite/' + h.slice(5))
      if (c.joined) return openChat(c.id)
      chatPreview(c, c.invite_hash)
    } else if (h.startsWith('chat/')) {
      openChat(+h.slice(5))
    } else if (h.startsWith('@')) {
      const r = await api('/resolve/' + encodeURIComponent(h.slice(1)))
      if (r.user) openUser(r.user.id)
      else if (r.chat) r.chat.joined ? openChat(r.chat.id) : chatPreview(r.chat)
    }
  } catch (e) { toast('⚠️ ' + e.message) }
}
function notifyLocal(title, body, chatId) {
  // v78: FONDA KO'RINADIGAN BILDIRISHNOMA — 3 qatlamli zanjir:
  // 1) APK (Android50): WebView'da web Notification ISHLAMAYDI (Illegal constructor) —
  //    avvalgi kod shu yerda jim o'lgurdi → fonda xabardan HECH NARSA ko'rinar edi.
  //    Endi native bildirishnoma (tozamonaviy kanal, tap → chat ochiladi).
  // 2) Chrome/PWA: ServiceWorker showNotification (Android'da new Notification() taqiqlangan).
  // 3) Desktop brauzer: klassik new Notification() zaxira.
  if (!document.hidden) return
  const b = S.prefs.preview === false ? 'Yangi xabar' : (body || 'Yangi xabar')
  try {
    if (window.Android50 && typeof window.Android50.pushNotify === 'function') {
      window.Android50.pushNotify(String(title || '50 Gram'), b, String(chatId || ''))
      return
    }
  } catch {}
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(String(title || '50 Gram'), {
        body: b, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'g50loc' + (chatId || 0),
        renotify: true, silent: !S.prefs.sounds, vibrate: S.prefs.sounds ? [80, 40, 80] : undefined,
        data: { chat_id: chatId || 0 },
      })).catch(() => {})
      return
    }
  } catch {}
  try { const n = new Notification(title, { body: b, icon: 'icon-192.png', tag: 'c' + chatId }); n.onclick = () => { window.focus(); openChat(chatId); n.close() } } catch {}
}
let audioCtx = null
function beep(freq = 880, dur = 0.12, vol = 0.05) {
  if (!S.prefs.sounds) return
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination)
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur); o.stop(audioCtx.currentTime + dur)
  } catch {}
}
