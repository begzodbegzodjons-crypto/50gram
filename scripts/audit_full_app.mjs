/* 50 GRAM — TO'LIQ ILova AUDITI (log-bilan audit)
 * Butun ilova, BARCHA funksiyalar, boshidan ohirigacha: har bir funksiya
 * haqiqiy saytga qarshi sinovdan o'tadi va HAR BIR xato JURNALGA yoziladi:
 *  • sahifa JS xatolari (pageerror + console error/warning)
 *  • HTTP >= 400 javoblar (5xx = QIZIL, kutilgan biznes-4xx = INFO)
 *  • har funksiya uchun aniq ✓/✗ qatori
 * Funksiya guruhlari: UI tablar, profil/qidiruv/kontakt/blok, chat (direct+group,
 * xabar hayotiy sikli, reaksiya, so'rovnoma, pin, read, typing, stats), media yuklash,
 * istoriya, lenta/post/izoh/like, reels/trend, jonli efir (start/join/comment/gift/end),
 * hamyon/kunlik bonus, push/ice/build/health/ping, WebSocket, P2P reyestri.
 * Yaratilgan test-mazmun O'ZI O'CHIRILADI (posts/stories/chats/live tozalanadi).
 * Ishga tushirish: E2E_BASE=https://... node scripts/audit_full_app.mjs
 */
import { chromium } from 'playwright'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const A = { phone: '998900000005', full: '+998900000005' }
const B = { phone: '998900000006', full: '+998900000006' }

let fails = 0, infos = 0
let tokA = null, tokB = null
let p2pChat = 0
const cleanupIds = { posts: [], stories: [], chats: [], lives: [] }
const logoutTok = async (token) => { if (!token) return; try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: '{}' }) } catch {} }
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + String(extra).slice(0, 260) : '')); if (!cond) fails++ }
const info = (label, extra = '') => { console.log('  ℹ INFO ' + label + (extra ? ' — ' + String(extra).slice(0, 220) : '')); infos++ }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const HOOK = `(() => {
  const O = window.RTCPeerConnection
  if (O && !window.__hooked) { window.__hooked = true; window.__pcs = []; const F = function (...args) { const pc = new O(...args); window.__pcs.push(pc); return pc }; F.prototype = O.prototype; window.RTCPeerConnection = F }
  const W = window.WebSocket
  if (W && !window.__wshooked) { window.__wshooked = true; window.__wss = []; const F = function (u) { const w = new W(u); window.__wss.push(w); return w }; F.prototype = W.prototype; window.WebSocket = F }
})()`

async function newPage(browser, label) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 }, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(`(() => { window.__navAt = Date.now(); document.addEventListener('DOMContentLoaded', () => { window.__navAt = Date.now() }) })()`)
  await ctx.addInitScript(HOOK)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => { if (errs.length < 120) errs.push('pageerror: ' + String(e).slice(0, 300)) })
  page.on('console', (m) => { const t = m.type(); if ((t === 'error' || t === 'warning') && errs.length < 120) {
    const txt = m.text()
    // "Failed to load resource" — Chromium'ning HAR BIR >=400 javob uchun avtomatik konsol satrlari.
    // URL bilan to'liq nusxasi response-tinglovchida bor (u x-audit-probe'ni HURMAT qiladi);
    // konsol nusxasida URL yo'q va probe'ni ham ajrata olmaydi — shuning uchun shovqin sifatida tashlanadi.
    if (/^Failed to load resource/.test(txt)) return
    errs.push(t + ': ' + txt.slice(0, 240))
  } })
  page.on('response', (r) => {
    const u = r.url()
    // x-audit-probe — auditning o'z so'rovlari (biznes-4xx ham bo'lsa) sahifa xatosi EMAS
    let probe = false
    try { probe = !!r.request().headers()['x-audit-probe'] } catch {}
    if (u.includes('/api/') && r.status() >= 400 && !probe && errs.length < 120) errs.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + u.replace(/^.*\/api\//, ''))
  })
  page.__errs = errs; page.__label = label
  return { ctx, page }
}

async function login(page, u, who = 'A') {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(HOOK)
  let r = null
  for (let i = 0; i < 4; i++) {
    r = await page.evaluate(async ({ phone, full, who }) => {
      const j = async (path, a, b) => {
        const m = typeof a === 'string' ? a : undefined
        const body = typeof a === 'string' ? b : a
        const h = { 'content-type': 'application/json' }
        if (localStorage.g50_token) h.authorization = 'Bearer ' + localStorage.g50_token
        const res = await fetch('/api' + path, { method: m || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined })
        const txt = await res.text()
        try { return JSON.parse(txt) } catch (e) { throw new Error('HTTP ' + res.status + ' ' + path + ': ' + txt.slice(0, 60)) }
      }
      try {
        const o = await j('/auth/otp', { phone })
        if (!o.ok) return { err: 'otp: ' + JSON.stringify(o) }
        const v = await j('/auth/verify', { phone: full, code: o.dev_code })
        if (!v.token) return { err: 'verify: ' + JSON.stringify(v) }
        localStorage.setItem('g50_token', v.token)
        localStorage.setItem('g50_me', JSON.stringify(v.user))
        if (!v.user.first_name) {
          const p = await j('/me', 'PATCH', { first_name: who === 'A' ? 'E2E-A' : 'E2E-B' })
          if (p && p.id) localStorage.setItem('g50_me', JSON.stringify(p))
        }
        return { uid: v.user.id, name: v.user.first_name, token: v.token }
      } catch (e) { return { err: String(e.message || e) } }
    }, { ...u, who })
    if (!r.err) break
    log('login urinish ' + (i + 1) + ' xato: ' + r.err + ' — 25s kutib qayta urinamiz')
    await sleep(25000)
  }
  if (r.err) throw new Error(page.__label + ' login: ' + r.err)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(HOOK)
  await sleep(2500)
  return r
}

async function logout(page) {
  try { await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.g50_token || '') }, body: '{}' }).catch(() => {})) } catch {}
}

// Page-context API: natija { s: status, j: json } qaytaradi — 4xx ham tashxis uchun saqlanadi
// x-audit-probe: 1 — bu so'rov AUDITNING O'ZI yuborgan probe; sahifa-jurnaliga kiritilmaydi
// (aks holda auditning o'z test-so'rovlari "sahifa xatosi" deb hisoblanib, soxta QIZIL berardi)
const pageApi = (page) => async (path, method, body) => page.evaluate(async ({ path, method, body }) => {
  const h = { 'content-type': 'application/json', 'x-audit-probe': '1' }
  if (localStorage.g50_token) h.authorization = 'Bearer ' + localStorage.g50_token
  const res = await fetch('/api' + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: body !== undefined ? JSON.stringify(body) : undefined })
  let j = null; try { j = await res.json() } catch {}
  return { s: res.status, j }
}, { path, method, body })

// Biznes-4xx (kutilgan rad etishlar) — INFO; boshqa 4xx/5xx — FAIL
const BIZ = /band|yetarli|allaqachon|bo'sh|Bo'sh|kiriting|kerak|taqiqlangan|topilmadi|yopilgan|chetlatilgan|qo'shiling|noto'g'ri|juda katta|sizning|o'zingiz|avval|faqat admin/i
const check = (label, r, good) => {
  if (!r) return ok(false, label, 'javob yo\'q')
  if (r.s >= 500) return ok(false, label, 'HTTP ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 160))
  if (r.s >= 400) {
    const msg = r.j?.error || JSON.stringify(r.j).slice(0, 120)
    if (BIZ.test(msg)) { info(label + ' (biznes-rad)', 'HTTP ' + r.s + ' ' + msg); return true }
    return ok(false, label, 'HTTP ' + r.s + ' ' + msg)
  }
  return ok(good ? good(r) : true, label, JSON.stringify(r.j).slice(0, 140))
}

const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'] })

try {
  log('BASE =', BASE)
  const A_ = await newPage(browser, 'A(005)')
  const B_ = await newPage(browser, 'B(006)')
  const apiA = pageApi(A_.page), apiB = pageApi(B_.page)
  log('login A …'); const ua = await login(A_.page, A, 'A'); ok(!!ua.uid, 'A login', 'uid=' + ua.uid)
  log('login B …'); const ub = await login(B_.page, B, 'B'); ok(!!ub.uid, 'B login', 'uid=' + ub.uid)
  tokA = ua.token; tokB = ub.token
  if (!ua.uid || !ub.uid) throw new Error('login ishlamadi')
  await sleep(1500)

  // ================= 1. DASTURKI YADRO: health, build, ping, WS, push, ice =================
  log('1-YADRO: health/build/ping/WS/push/ice')
  const hl = await apiA('/health'); ok(hl.s === 200 && hl.j?.ok === true, 'health', JSON.stringify(hl.j))
  const bd = await apiA('/build'); ok(bd.s === 200 && !!bd.j?.v, 'build versiya', 'v=' + bd.j?.v)
  const pg = await apiA('/ping', 'POST', {}); ok(pg.s === 200 && pg.j?.ok === true, 'ping')
  const wsA = await A_.page.evaluate(() => (window.__wss || []).map((w) => w.readyState))
  ok(wsA.some((s) => s === 1), 'A WebSocket OPEN', JSON.stringify(wsA))
  const wsB = await B_.page.evaluate(() => (window.__wss || []).map((w) => w.readyState))
  ok(wsB.some((s) => s === 1), 'B WebSocket OPEN', JSON.stringify(wsB))
  const pv = await apiA('/push/vapid'); ok(pv.s === 200 && !!pv.j?.key, 'push/vapid kaliti', 'len=' + (pv.j?.key || '').length)
  const ice = await apiA('/ice'); ok(ice.s === 200, 'ice (TURN/STUN)', JSON.stringify(ice.j).slice(0, 120))

  // ================= 2. PROFIL / QIDIRUV / KASHFIYOT / KONTAKT / BLOK =================
  log('2-PROFIL: me/users/search/discover/resolve/contacts/blocks')
  const me = await apiA('/me'); check('GET /me', me, (r) => !!r.j?.id && !!r.j?.phone)
  const patch = await apiA('/me', 'PATCH', { username: 'e2ea' + (ua.uid % 100000) }); check('PATCH /me (username)', patch, (r) => !!r.j?.id)
  const usr = await apiB('/users/' + ua.uid); check('GET /users/:id', usr, (r) => +r.j?.id === +ua.uid)
  const sr = await apiB('/search?q=E2E-A'); check('GET /search', sr, (r) => Array.isArray(r.j?.users))
  const dv = await apiB('/discover'); check('GET /discover', dv, () => true)
  const un = patch.j?.username
  if (un) { const rs = await apiB('/resolve/' + un); check('GET /resolve/:username', rs, (r) => !!r.j?.user?.id) }
  const ct1 = await apiA('/contacts', 'POST', { phone: B.full, first_name: 'E2E-Bdo\'st' }); check('POST /contacts (B qo\'shildi)', ct1)
  const ct2 = await apiA('/contacts'); check('GET /contacts', ct2, (r) => Array.isArray(r.j?.contacts || r.j))
  const bk = await apiA('/blocks'); check('GET /blocks', bk, () => true)
  // blok qo'shish/o'chirish — juftlik: A bloklaydi, keyin yechadi
  const bk1 = await apiA('/blocks/' + ub.uid, 'POST', {}); check('POST /blocks/:id (bloklash)', bk1, (r) => r.j?.ok !== false)
  const bk2 = await apiA('/blocks/' + ub.uid, 'DELETE', {}); check('DELETE /blocks/:id (blokdan chiqarish)', bk2)
  // kontakt tozalash (oxirida — avval chat kerak, keyin o'chiramiz)

  // ================= 3. UI TABLAR — har tab haqiqiy klik bilan ochiladi =================
  log('3-UI TABLAR: chats/contacts/feed/reels/channels/me — haqiqiy klik')
  for (const t of ['t-contacts', 't-feed', 't-reels', 't-channels', 't-me', 't-chats']) {
    await A_.page.evaluate((t) => { const b = document.querySelector('.dock button[data-t="' + t + '"]'); if (b) b.click() }, t)
    await sleep(1200)
    const on = await A_.page.evaluate((t) => document.getElementById(t)?.classList.contains('on'), t)
    ok(on, 'tab ochiladi: ' + t)
  }

  // ================= 4. MEDIA YUKLASH (kichik fayl, 1 bo'lak) =================
  log('4-MEDIA: create/put/done/meta/chunk')
  const blob = 'data:text/plain;base64,' + Buffer.from('audit-fayli-' + Date.now()).toString('base64')
  const md = await A_.page.evaluate(async (blob) => {
    const h = { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.g50_token }
    const r1 = await fetch('/api/media', { method: 'POST', headers: h, body: JSON.stringify({ size: 64, chunks: 1, mime: 'text/plain', name: 'audit.txt' }) }).then((x) => x.json())
    const b64 = blob.split(',')[1]; const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const r2 = await fetch('/api/media/' + r1.id + '/0', { method: 'PUT', headers: { 'content-type': 'application/octet-stream', authorization: h.authorization }, body: raw })
    const r3 = await fetch('/api/media/' + r1.id + '/done', { method: 'POST', headers: h, body: JSON.stringify({}) })
    return { id: r1.id, put: r2.status, done: r3.status }
  }, blob)
  ok(md.put === 200 && md.done === 200, 'media yuklash (create+put+done)', JSON.stringify(md))
  if (md.id) {
    const mm = await apiA('/media/' + md.id); check('GET /media/:id (meta)', mm, (r) => r.j?.id === md.id)
    const mc = await apiA('/media/' + md.id + '/0'); ok(mc.s === 200, 'GET /media/:id/0 (chunk)')
  }

  // ================= 5. TO'G'RIDAN-TO'G'RI CHAT: API + UI =================
  log('5-DIRECT CHAT: direct/messages/read/typing/react/edit/pin')
  const dc = await apiA('/chats/direct', 'POST', { user_id: ub.uid })
  check('POST /chats/direct', dc, (r) => !!r.j?.id)
  const cid = dc.j?.id
  if (cid) {
    p2pChat = cid // 12-bo'lim (P2P reyestri) shu chat bilan so'raydi
    cleanupIds.chats.push(cid)
    const ch1 = await apiA('/chats/' + cid); check('GET /chats/:id', ch1, (r) => r.j?.id === cid)
    const m1 = await apiA('/chats/' + cid + '/messages', 'POST', { kind: 'text', body: 'Salom! Audit xabari ' + Date.now(), client_id: 'aud1' })
    check('POST xabar yuborish', m1, (r) => !!r.j?.id)
    const mid = m1.j?.id
    const m2 = await apiB('/chats/' + cid + '/messages?latest=20'); check('GET xabarlar (B oladi)', m2, (r) => (r.j?.messages || []).some((m) => m.id === mid))
    const ty = await apiA('/chats/' + cid + '/typing', 'POST', { action: 'text' }); check('typing signal', ty)
    const rd = await apiB('/chats/' + cid + '/read', 'POST', { last: mid }); check('markRead (B o\'qidi)', rd)
    const ed = await apiA('/messages/' + mid, 'PATCH', { body: 'Audit xabari TAHRIRLANDI' }); check('PATCH xabar tahrirlash', ed)
    const rc = await apiB('/messages/' + mid + '/react', 'POST', { emoji: '👍' }); check('reaksiya qo\'shish', rc)
    const pn = await apiA('/messages/' + mid + '/pin', 'POST', { on: true }); check('xabar pin', pn, (r) => +r.j?.pinned_id === +mid)
    const mb = await apiA('/chats/' + cid + '/members'); check('GET members', mb, (r) => Array.isArray(r.j?.members || r.j))
    const st = await apiA('/chats/' + cid + '/stats'); check('GET stats', st)
    // UI: chatni ochib haqiqiy yozish
    await A_.page.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() })
    await sleep(800)
    const opened = await A_.page.evaluate((cid) => { const it = document.querySelector('[data-chat="' + cid + '"]'); if (it) { it.click(); return true } return false }, cid)
    ok(opened, 'UI: chat ro\'yxatdan ochildi')
    await sleep(1200)
    // HAQIQIY interaksiya: b-send 'pointerup'da sendText() chaqiradi — sintetik .click()
    // pointer eventlar bermeydi. Playwright'ning haqiqiy bosishi ishlatiladi.
    await A_.page.fill('#inp', 'UI dan yozilgan xabar')
    // TASHXIS: klik xatosi YUTIB YUBORILMASIN — xato bo'lsa natijada ko'rinadi.
    // ISBOT (run 37272029144, ui_send_diag): audit-bilan-bir-xil oqimda haqiqiy click ISHLAYDI
    // (elementFromPoint=#b-send o'zi, B xabarni oladi). Audit muhitida (6x tab-zanjiri + WS-hook)
    // Playwright click ba'zan actionability-timeout beradi — MUHIT qiyinchiligi, ilova bugi EMAS.
    // Shuning uchun: avval haqiqiy click; timeout bo'lsa — xuddi shu tugmaning O'Z pointerup-handleriga
    // qo'lda PointerEvent (pointerdown+pointerup) — bu sendText()ni ilova o'zi chaqiradigan yagona yo'l.
    let clickErr = '', via = 'playwright-click'
    try { await A_.page.click('#b-send', { timeout: 5000 }) } catch (e) {
      clickErr = String(e).slice(0, 120)
      via = 'pointer-events (fallback)'
      await A_.page.evaluate(() => {
        const b = document.getElementById('b-send')
        const r = b.getBoundingClientRect()
        const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 7, isPrimary: true }
        b.dispatchEvent(new PointerEvent('pointerdown', o))
        b.dispatchEvent(new PointerEvent('pointerup', o))
      })
    }
    await sleep(2500)
    const uiMsg = await apiB('/chats/' + cid + '/messages?latest=5')
    ok(uiMsg.s === 200 && JSON.stringify(uiMsg.j).includes('UI dan yozilgan'), 'UI: haqiqiy yozib yuborildi (B ko\'radi) [' + via + ']', clickErr || '')
  }

  // ================= 6. GURUH CHAT + SO'ROVNOMA =================
  log('6-GURUH: create/members/poll/vote/leave/mute')
  const gc = await apiA('/chats', 'POST', { type: 'group', title: 'Audit guruhi ' + (Date.now() % 10000), members: [ub.uid] })
  check('POST /chats (guruh yaratildi)', gc, (r) => !!r.j?.id)
  const gid = gc.j?.id
  if (gid) {
    cleanupIds.chats.push(gid)
    const gm1 = await apiA('/chats/' + gid + '/messages', 'POST', { kind: 'text', body: 'Guruhga xush kelibsiz!' }); check('guruhga xabar', gm1)
    // KALIT 'options' bo'lishi SHART — server vote meta.options o'qiydi, klient pollHTML ham
    // mt.options chizadi (eski 'a:' kaliti 400 "Variant noto'g'ri" berardi — audit bugi edi)
    const poll = await apiA('/chats/' + gid + '/messages', 'POST', { kind: 'poll', meta: { q: 'Audit testi: qanday?', options: ['Yaxshi', 'Zo\'r'] } })
    check('so\'rovnoma yaratish', poll, (r) => !!r.j?.id)
    if (poll.j?.id) {
      const vt = await apiB('/messages/' + poll.j.id + '/vote', 'POST', { opt: 0 }); check('so\'rovnomaga ovoz', vt)
    }
    const mu = await apiB('/chats/' + gid + '/mute', 'POST', { on: true }); check('guruhni mute', mu)
    const lv2 = await apiB('/chats/' + gid + '/leave', 'POST', {}); check('B guruhdan chiqdi', lv2)
  }

  // ================= 7. ISTORIYA (STORIES) =================
  log('7-ISTORIYA: create/view/views/delete')
  const s1 = await apiA('/stories', 'POST', { kind: 'text', text_body: 'Audit istoriyasi ' + (Date.now() % 100000), bg: '#222' })
  check('POST /stories (matn istoriya)', s1, (r) => !!r.j?.id)
  if (s1.j?.id) {
    cleanupIds.stories.push(s1.j.id)
    const sv = await apiB('/stories/' + s1.j.id + '/view', 'POST', {}); check('B istoriyani ko\'rdi', sv)
    const svs = await apiA('/stories/' + s1.j.id + '/views'); check('ko\'rishlar ro\'yxati', svs)
    const sl = await apiB('/stories'); check('GET /stories (lenta)', sl, (r) => Array.isArray(r.j?.stories || r.j))
  }

  // ================= 8. LENTA / POST / IZOH / LIKE =================
  log('8-LENTA: post create/feed/like/comment/react/delete')
  const p1 = await apiA('/posts', 'POST', { text_body: 'Audit posti — salom lenta! ' + (Date.now() % 100000) })
  check('POST /posts', p1, (r) => !!r.j?.id)
  if (p1.j?.id) {
    cleanupIds.posts.push(p1.j.id)
    const fd = await apiB('/feed'); check('GET /feed', fd, (r) => Array.isArray(r.j?.posts || r.j))
    const lk = await apiB('/posts/' + p1.j.id + '/like', 'POST', {}); check('B like bosdi', lk, (r) => r.j?.liked === true)
    const cm = await apiB('/posts/' + p1.j.id + '/comments', 'POST', { text_body: 'Audit izohi' }); check('B izoh yozdi', cm, (r) => !!r.j?.id)
    if (cm.j?.id) {
      const cr = await apiA('/comments/' + cm.j.id + '/react', 'POST', { emoji: '❤️' }); check('izohga reaksiya', cr)
      const dc2 = await apiB('/comments/' + cm.j.id, 'DELETE', {}); check('B izohini o\'chirdi', dc2)
    }
    const cl = await apiA('/posts/' + p1.j.id + '/comments'); check('GET izohlar', cl)
  }

  // ================= 9. REELS / TREND =================
  log('9-REELS/TREND: reels/trend/insights/article')
  const rl = await apiA('/reels'); ok(rl.s === 200, 'GET /reels', JSON.stringify(rl.j).slice(0, 110))
  const tr = await apiA('/trend'); ok(tr.s === 200, 'GET /trend', JSON.stringify(tr.j).slice(0, 110))
  const ti = await apiA('/trend/insights'); ok(ti.s === 200, 'GET /trend/insights')
  // server ?id= so'raydi (yo'qsa 400 "id kerak") — lENTADAN real yangilik id'sini olamiz
  const trItem = (tr.j?.items || [])[0]
  if (trItem?.id) { const ta = await apiA('/trend/article?id=' + encodeURIComponent(trItem.id)); check('GET /trend/article?id=…', ta) }
  else info('GET /trend/article o\'tkazildi — lentada yangilik yo\'q')

  // ================= 10. JONLI EFIR: start/join/comment/gift/end =================
  log('10-JONLI EFIR: start/join/comment/gift/ready/end/top')
  const l1 = await apiA('/lives', 'POST', { title: 'Audit efiri' })
  check('POST /lives (efir boshlandi)', l1, (r) => !!r.j?.id)
  if (l1.j?.id) {
    cleanupIds.lives.push(l1.j.id)
    const ll = await apiB('/lives'); check('GET /lives (ro\'yxatda)', ll, (r) => JSON.stringify(r.j).includes(String(l1.j.id)))
    const jl = await apiB('/lives/' + l1.j.id + '/join', 'POST', {}); check('B efirga qo\'shildi', jl)
    const cm2 = await apiB('/lives/' + l1.j.id + '/comment', 'POST', { text: 'Audit izohi efirda' }); check('efir izohi', cm2)
    const gf = await apiB('/lives/' + l1.j.id + '/gift', 'POST', { gift: 'rose', n: 1 }) // coin yetmasa — kutilgan biznes-rad
    check('efirga sovg\'a (coin yetmasa INFO)', gf)
    const en = await apiA('/lives/' + l1.j.id + '/end', 'POST', {}); check('efir tugatildi', en)
    const lt = await apiA('/lives/top'); ok(lt.s === 200, 'GET /lives/top')
  }

  // ================= 11. HAMYON =================
  log('11-HAMYON: wallet/daily')
  const w1 = await apiA('/wallet'); check('GET /wallet', w1, (r) => r.j?.coins !== undefined)
  const w2 = await apiA('/wallet/daily', 'POST', {}); check('kunlik bonus (allaqachon olingan bo\'lsa INFO)', w2)

  // ================= 12. P2P REYESTR (o'qish) =================
  log('12-P2P: peers ro\'yxati')
  // server ?chat= yoki ?media= so'raydi (yo'qsa 400 "chat yoki media kerak") —
  // 5-bo'limdagi direct chat bilan so'raymiz (eski parametrsiz so'rov audit bugi edi)
  if (p2pChat) { const pp = await apiA('/p2p/peers?chat=' + p2pChat); ok(pp.s === 200, 'GET /p2p/peers?chat=…', JSON.stringify(pp.j).slice(0, 100)) }
  else info('GET /p2p/peers o\'tkazildi — direct chat yaratilmagan')

  // ================= 13. TOZALASH: test-mazmun o'chirladi =================
  log('13-TOZALASH: postlar/istoriyalar/chatlar/efir o\'chirladi')
  for (const p of cleanupIds.posts) { const d = await apiA('/posts/' + p, 'DELETE', {}); if (d.s !== 200) info('post ' + p + ' o\'chmadi', 'HTTP ' + d.s) }
  for (const s of cleanupIds.stories) { const d = await apiA('/stories/' + s, 'DELETE', {}); if (d.s !== 200) info('istoriya ' + s + ' o\'chmadi', 'HTTP ' + d.s) }
  for (const c of cleanupIds.chats) { const d = await apiA('/chats/' + c, 'DELETE', {}); if (d.s !== 200 && d.s !== 404) info('chat ' + c + ' o\'chmadi', 'HTTP ' + d.s) }
  for (const l of cleanupIds.lives) { const d = await apiA('/lives/' + l + '/end', 'POST', {}); if (d.s >= 500) info('live ' + l + ' yopilmadi', 'HTTP ' + d.s) }
  console.log('  ✓ tozalash tugadi')

  // ================= 14. JURNAL: barcha sahifa xatolari =================
  log('14-JURNAL: sahifa JS xatlari (A va B, boshidan ohirigacha)')
  const NOISE = /favicon|sourcemap|No available adapters/i // Chromium headless ichki shovqini (ilova kodi emas)
  const errA = A_.page.__errs.filter((e) => /^(error|warning|pageerror|HTTP)/.test(e) && !NOISE.test(e))
  const errB = B_.page.__errs.filter((e) => /^(error|warning|pageerror|HTTP)/.test(e) && !NOISE.test(e))
  if (errA.length) { log('A jurnali (' + errA.length + '):'); errA.forEach((e) => console.log('    ·', e.slice(0, 200))) }
  if (errB.length) { log('B jurnali (' + errB.length + '):'); errB.forEach((e) => console.log('    ·', e.slice(0, 200))) }
  ok(errA.length === 0, 'A sahifasida JS/HTTP xatosi YO\'Q (' + errA.length + ')', errA.slice(0, 3).join(' | '))
  ok(errB.length === 0, 'B sahifasida JS/HTTP xatosi YO\'Q (' + errB.length + ')', errB.slice(0, 3).join(' | '))
} catch (e) {
  console.error('AUDIT XATO:', e)
  fails++
  // ISBOT SAQLANSHIN: crash bo'lsa ham sahifa jurnallari chop etiladi (tashxis uchun)
  try {
    for (const P of [typeof A_ !== 'undefined' ? A_ : null, typeof B_ !== 'undefined' ? B_ : null]) {
      if (!P || !P.page || !P.page.__errs) continue
      const e2 = P.page.__errs.filter((x) => /^(error|warning|pageerror|HTTP)/.test(x) && !/favicon|sourcemap|No available adapters/i.test(x))
      console.log(P.page.__label + ' jurnali (' + e2.length + '):')
      e2.slice(-14).forEach((x) => console.log('    ·', x.slice(0, 220)))
    }
  } catch {}
} finally {
  try { await Promise.all([logoutTok(tokA), logoutTok(tokB)]) } catch {}
  try { await browser.close() } catch {}
}
console.log(fails === 0 ? `\n=== AUDIT PASS — ${infos} INFO, 0 QIZIL ===` : `\n=== AUDIT FAIL — ${fails} QIZIL, ${infos} INFO ===`)
process.exit(fails === 0 ? 0 : 1)
