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
function vibrate(p = 15) { try { navigator.vibrate && navigator.vibrate(p) } catch {} }

// ---------------- API ----------------
async function api(path, opt = {}) {
  const h = {}
  if (S.token) h.Authorization = 'Bearer ' + S.token
  let body
  if (opt.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(opt.body) }
  let r
  try { r = await fetch(API + path, { method: opt.method || (body ? 'POST' : 'GET'), headers: h, body }) }
  catch { throw new Error('Internet aloqasi yo‘q') }
  let j = {}
  try { j = await r.json() } catch {}
  if (r.status === 401 && S.token && !path.startsWith('/auth')) { logout(true); throw new Error('Qaytadan kiring') }
  if (!r.ok) throw new Error(j.error || 'Xatolik (' + r.status + ')')
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
        const r = indexedDB.open('50gram', 3)
        r.onupgradeneeded = () => {
          const d = r.result
          if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats')
          if (!d.objectStoreNames.contains('media')) d.createObjectStore('media')
          if (!d.objectStoreNames.contains('idx')) d.createObjectStore('idx') // fayl hajmi/chat/oxirgi foydalanish
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

// ---------------- Media ----------------
const CHUNK = 512 * 1024
function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(b) })
}
// ---- Shifrlash: fayl serverga va tarmoq qurilmalariga faqat shifrlangan holda boradi ----
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
  if (plain.size > 30 * 1024 * 1024) throw new Error('Fayl 30 MB dan katta')
  const enc = await encryptBlob(plain)
  const blob = enc.blob
  const n = Math.max(1, Math.ceil(blob.size / CHUNK))
  const { id } = await post('/media', { mime: plain.type || 'application/octet-stream', name: name || 'fayl', size: blob.size || 1, chunks: n })
  for (let i = 0; i < n; i++) {
    const b64 = await blobToB64(blob.slice(i * CHUNK, (i + 1) * CHUNK))
    let ok = false
    for (let a = 0; a < 3 && !ok; a++) {
      try {
        const r = await fetch(API + '/media/' + id + '/' + i, { method: 'PUT', headers: { Authorization: 'Bearer ' + S.token, 'content-type': 'text/plain' }, body: b64 })
        ok = r.ok
      } catch { await sleep(800) }
    }
    if (!ok) throw new Error('Yuklashda xato')
    onProg && onProg((i + 1) / n)
  }
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
// Shifrlangan faylni olish: 1) qurilmadan 2) serverdan 3) tarmoqdagi boshqa qurilmalardan
async function getCipher(id) {
  const local = await IDB.get('media', id)
  if (local) { Store.access(id); P2P.touch(id); return local }
  let meta = null
  try { meta = await api('/media/' + id) } catch {}
  if (meta) {
    const parts = []
    for (let i = 0; i < meta.chunks; i++) {
      let r = null
      for (let a = 0; a < 3 && !(r && r.ok); a++) { try { r = await fetch(API + '/media/' + id + '/' + i, { headers: { Authorization: 'Bearer ' + S.token } }) } catch { await sleep(600) } }
      if (!r || !r.ok) { meta = null; break }
      const bin = atob(await r.text()), u = new Uint8Array(bin.length)
      for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k)
      parts.push(u)
    }
    if (meta) {
      const blob = new Blob(parts, { type: 'application/octet-stream' })
      P2P.note(id, { sha: meta.sha, size: meta.size, mime: meta.mime })
      await IDB.put('media', id, blob)
      Store.record(id, blob.size, P2P.ctx.get(id)?.chat, 0)
      P2P.touch(id)
      return blob
    }
  }
  // Serverda o'chgan — nusxasi bor onlayn qurilmadan olamiz
  return P2P.fetchMedia(id)
}
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
    i.onchange = () => res(multiple ? [...i.files] : i.files[0] || null)
    i.click()
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
function showAuth() {
  $('auth').classList.remove('hide'); $('main').classList.add('hide'); $('dialog').classList.add('hide')
  step('a-phone'); setTimeout(() => $('phone').focus(), 50)
}
function step(id) { qsa('.step').forEach((s) => s.classList.toggle('hide', s.id !== id)) }
$('phone').addEventListener('input', (e) => {
  let d = e.target.value.replace(/\D/g, '')
  if (d.startsWith('998') && d.length > 9) d = d.slice(3)
  d = d.slice(0, 9)
  e.target.value = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ')
})
$('phone').addEventListener('keydown', (e) => e.key === 'Enter' && $('b-otp').click())
$('code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6) $('b-verify').click() })
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('b-verify').click())
$('b-otp').onclick = async () => {
  const d = $('phone').value.replace(/\D/g, '')
  if (d.length !== 9) return toast('Raqamni to‘liq kiriting: 90 123 45 67')
  const b = $('b-otp'); b.disabled = true; b.textContent = 'Yuborilmoqda...'
  try {
    const r = await post('/auth/otp', { phone: '998' + d })
    authPhone = r.phone
    $('code-info').innerHTML = `<b>${esc(authPhone)}</b> raqamiga SMS kod yuborildi`
    if (r.dev_code) { $('code-info').innerHTML += `<br><span style="color:var(--qizil)">Sinov rejimi: kod ${r.dev_code}</span>` }
    step('a-code'); $('code').value = ''; setTimeout(() => $('code').focus(), 50); startResend()
  } catch (e) { toast('⚠️ ' + e.message) }
  b.disabled = false; b.textContent = 'Kod olish'
}
function startResend() {
  let s = 60; const b = $('b-resend'); b.disabled = true
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
function logout(silent) {
  localStorage.removeItem('g50_token'); localStorage.removeItem('g50_me')
  S.token = ''; S.me = null
  try { S.ws && S.ws.close() } catch {}
  if (!silent) location.reload(); else { location.hash = ''; setTimeout(() => location.reload(), 300) }
}

// ---------------- REAL-TIME ----------------
let wsRetry = 1000, pingT = 0
function wsConnect() {
  if (!S.token) return
  try {
    const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(S.token))
    S.ws = ws
    ws.onopen = () => { S.wsOk = true; wsRetry = 1000; setConn(); syncAll() }
    ws.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data) } catch { return } if (ev.type !== 'pong') dispatch(ev) }
    ws.onclose = () => { S.wsOk = false; setConn(); if (S.token) setTimeout(wsConnect, wsRetry); wsRetry = Math.min(wsRetry * 2, 20000) }
    ws.onerror = () => {}
    clearInterval(pingT); pingT = setInterval(() => { try { ws.readyState === 1 && ws.send('ping') } catch {} }, 25000)
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
function renderChats() {
  const list = [...S.chats.values()].filter((c) => c.joined).sort((a, b) => (b.last_message?.created_at || b.last_msg_at) - (a.last_message?.created_at || a.last_msg_at))
  const q = $('q').value.trim()
  if (q) return
  let total = 0
  const live = new Map(S.lives.map((l) => [l.user.id, l]))
  $('chatlist').innerHTML = list.length ? list.map((c) => {
    if (!c.muted) total += c.unread
    const lm = c.last_message
    const ty = typingText(c.id)
    const mine = lm && lm.sender_id === S.me.id && c.type !== 'channel' && !['system', 'call'].includes(lm.kind)
    const tick = mine ? `<span class="tick">${c.type === 'direct' && c.peer_last_read >= lm.id ? '✓✓' : '✓'}</span>` : ''
    const icon = c.type === 'channel' ? '📢 ' : c.type === 'group' ? '👥 ' : ''
    const lv = c.peer ? live.get(c.peer.id) : null
    const av = c.type === 'direct' ? avHTML(c.peer, 54, { dot: true, saved: c.saved, live: !!lv, liveId: lv?.id }) : avHTML(c, 54, { chat: true })
    return `<div class="item ${S.cur === c.id ? 'act' : ''}" data-chat="${c.id}">${av}<div class="mid"><div class="t1"><b>${icon}${esc(chatName(c))}</b>${lv ? '<span class="lvt">🔴 Efir</span>' : ''}${c.muted ? '<span class="mut">🔕</span>' : ''}<span class="tm">${tick} ${fmtShort(lm?.created_at || c.last_msg_at)}</span></div>
      <div class="t2"><span class="${ty ? 'typ' : ''}">${esc(ty || msgPreview(lm, c) || (c.type === 'direct' ? 'Salom deb yozing 👋' : ''))}</span>${c.unread ? `<b class="cnt ${c.muted ? 'm' : ''}">${c.unread > 99 ? '99+' : c.unread}</b>` : ''}</div></div></div>`
  }).join('') : `<div class="empty"><span class="big">💬</span>Hali chatlar yo‘q.<br>Yuqoridagi qidiruvda ism, @username yoki telefon raqam yozing<br>yoki <a href="#" onclick="tabGo('t-contacts');return false">kontakt qo‘shing</a>.</div>`
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
  if (id === 't-feed') loadFeed(true)
  if (id === 't-channels') renderChannels()
  if (id === 't-me') renderMe()
}
qsa('.dock button').forEach((b) => (b.onclick = () => tabGo(b.dataset.t)))

// ---------------- ISHGA TUSHIRISH ----------------
async function startApp() {
  $('auth').classList.add('hide'); $('main').classList.remove('hide'); $('dialog').classList.remove('hide')
  if (localStorage.getItem('g50_dark') === '1') document.body.classList.add('dark')
  renderChats()
  try { setMe(await api('/me')) } catch (e) { if (!S.token) return }
  if (!S.me.first_name) { $('auth').classList.remove('hide'); $('main').classList.add('hide'); step('a-prof'); return }
  post('/ping').catch(() => {})
  await Promise.all([loadChats().catch((e) => toast(e.message)), loadStories().catch(() => {}), loadContactsQuiet(), loadLives()])
  wsConnect()
  setInterval(poll, 4000)
  setInterval(() => { if (!document.hidden) post('/ping').catch(() => {}) }, 45000)
  setInterval(() => { if (!document.hidden) { loadStories().catch(() => {}); loadLives() } }, 60000)
  setInterval(() => { for (const [k, t] of S.typing) if (t.until < Date.now()) { S.typing.delete(k); renderChats(); if (S.cur === k) renderHeader() } }, 1500)
  handleHash()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
}
window.addEventListener('online', () => { setConn(); if (!S.wsOk) wsConnect() })
window.addEventListener('offline', setConn)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) { poll(); if (S.cur) markRead(S.cur) } })
// APK ilovadan qaytganda: darhol sinxronlash va uzilgan WS'ni tiklash (MainActivity.onResume chaqiradi)
window.__appResume = () => { try { if (!S.token) return; poll(); if (S.cur) markRead(S.cur); if (!S.ws || S.ws.readyState === 3) wsConnect() } catch {} }
window.addEventListener('hashchange', handleHash)
async function handleHash() {
  const h = decodeURIComponent(location.hash.slice(1))
  if (!h || !S.token || !S.me?.first_name) return
  history.replaceState(null, '', location.pathname)
  try {
    if (h.startsWith('join/')) {
      const c = await api('/invite/' + h.slice(5))
      if (c.joined) return openChat(c.id)
      chatPreview(c, c.invite_hash)
    } else if (h.startsWith('@')) {
      const r = await api('/resolve/' + encodeURIComponent(h.slice(1)))
      if (r.user) openUser(r.user.id)
      else if (r.chat) r.chat.joined ? openChat(r.chat.id) : chatPreview(r.chat)
    }
  } catch (e) { toast('⚠️ ' + e.message) }
}
function notifyLocal(title, body, chatId) {
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, icon: 'icon-192.png', tag: 'c' + chatId }); n.onclick = () => { window.focus(); openChat(chatId); n.close() } } catch {}
  }
}
let audioCtx = null
function beep(freq = 880, dur = 0.12, vol = 0.05) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination)
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur); o.stop(audioCtx.currentTime + dur)
  } catch {}
}
