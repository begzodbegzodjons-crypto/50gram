// FOTO-YUBORISH E2E TASHXISI (egaga): «xabarlar bo'limida rasm yuborib bo'lmayapti»
// shikoyatini isbot bilan tekshirish. Jonli saytga qarshi REAL brauzer oqimi:
// login → chat ochish → #b-attach → [data-a="gal"] → HAQIQIY filechooser → JPEG tanlash
// → captionAsk (#cap-s) → resizeImage → encryptBlob → upload (POST /media + PUT chunklar
// + done) → POST /messages → A da render → B QABUL qilib DECRYPT qilib ko'rsatishi.
// Har qadamda: HTTP status/javoblar, console.error, pageerror, DOM holati.
// Ishga tushirish: GitHub Actions workflow_dispatch (lokal IP firewall'da).
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 } })
const page = await ctx.newPage()
const ctxB = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 } })
const pageB = await ctxB.newPage()

let mediaPuts = 0, r2Puts = 0, httpFails = [], lastMsgResp = null
const wire = (p, tag) => {
  p.on('pageerror', (e) => log('PAGEERROR[' + tag + ']:', String(e).slice(0, 220)))
  p.on('console', (m) => { if (m.type() === 'error') log('console.error[' + tag + ']:', m.text().slice(0, 200)) })
  p.on('response', async (r) => {
    const u = r.url(); if (!u.includes('/api/')) return
    const m = r.request().method()
    if (r.status() >= 400) { httpFails.push(m + ' ' + r.status() + ' ' + u.slice(BASE.length)); log('HTTP XATO[' + tag + ']:', r.status(), m, u.slice(BASE.length).slice(0, 90)) }
    if (u.includes('/api/media') && m === 'PUT') {
      mediaPuts++
      try { const j = await r.json(); if (j.r2) r2Puts++ } catch {}
    }
    if ((u.includes('/api/media') && m !== 'GET') || (u.includes('/messages') && m === 'POST')) {
      let b = ''; try { b = (await r.text()).slice(0, 110) } catch {}
      log('HTTP[' + tag + ']:', r.status(), m, u.slice(BASE.length).slice(0, 80), b)
    }
    if (u.includes('/messages') && m === 'POST' && r.status() < 400) {
      try { const j = await r.json(); if (j.id && !lastMsgResp) lastMsgResp = j } catch {}
    }
  })
}
wire(page, 'A'); wire(pageB, 'B')

async function devLogin(p, phone, who) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500)
  const r = await p.evaluate(async ({ phone, who }) => {
    const otp = await fetch('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }).then((x) => x.json())
    const v = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + phone, code: otp.dev_code }) }).then((x) => x.json())
    localStorage.setItem('g50_token', v.token); localStorage.setItem('g50_me', JSON.stringify(v.user))
    if (!v.user.first_name) {
      const pa = await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ first_name: who === 'A' ? 'Foto-A' : 'Foto-B' }) }).then((x) => x.json())
      if (pa && pa.id) localStorage.setItem('g50_me', JSON.stringify(pa))
    }
    return v
  }, { phone, who })
  log('login', phone, '→ uid', r.user?.id); return r
}

try {
  const ua = await devLogin(page, '998900000005', 'A')
  const ub = await devLogin(pageB, '998900000006', 'B')
  await page.reload({ waitUntil: 'domcontentloaded' }); await pageB.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)

  const cid = await page.evaluate(async (uid) => {
    const res = await fetch('/api/chats/direct', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.g50_token }, body: JSON.stringify({ user_id: uid }) })
    return (await res.json()).id
  }, ub.user.id)
  log('direct chat:', cid)

  // A: chatni UI orqali ochish
  await page.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() })
  let opened = false
  for (let i = 0; i < 15 && !opened; i++) {
    opened = await page.evaluate((cid) => { const it = document.querySelector('[data-chat="' + cid + '"]'); if (it) { it.click(); return true } return false }, cid)
    if (!opened) await sleep(1000)
  }
  if (!opened) throw new Error('chat ochilmadi (ro\'yxatda item topilmadi)')
  await sleep(1200)
  log('chat ochildi: S.cur =', await page.evaluate(() => window.S?.cur))

  // HAQIQIY JPEG yaratish (kamera-uslubda 1200x1600, gradient+shovqin — ~100-300KB)
  const dataUrl = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 1600
    const c = cv.getContext('2d')
    const g = c.createLinearGradient(0, 0, 1200, 1600); g.addColorStop(0, '#1a7'), g.addColorStop(0.5, '#e73'), g.addColorStop(1, '#12c')
    c.fillStyle = g; c.fillRect(0, 0, 1200, 1600)
    for (let i = 0; i < 4000; i++) { c.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.25 + ')'; c.fillRect(Math.random() * 1200, Math.random() * 1600, 3, 3) }
    c.font = '80px sans-serif'; c.fillStyle = '#fff'; c.fillText('50gram diag ' + Date.now() % 100000, 90, 800)
    return cv.toDataURL('image/jpeg', 0.85)
  })
  writeFileSync('/tmp/diag-photo.jpg', Buffer.from(dataUrl.split(',')[1], 'base64'))
  log('JPEG yaratildi:', Math.round(dataUrl.length * 0.75 / 1024), 'KB')

  // REAL fayl-tanlash oqimi: #b-attach → sheet [data-a="gal"] → filechooser
  await page.click('#b-attach'); await sleep(600)
  const galVisible = await page.evaluate(() => !!document.querySelector('[data-a="gal"]'))
  log('attach menyusi ochildi, galereya tugmasi:', galVisible)
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('[data-a="gal"]'),
  ])
  await fc.setFiles('/tmp/diag-photo.jpg', { mimeType: 'image/jpeg' })
  log('fayl tanlandi (filechooser)')

  // captionAsk: izoh + Yuborish
  await page.waitForSelector('#cap-s', { timeout: 15000 })
  await page.fill('#cap-i', 'foto diag test')
  await page.click('#cap-s')
  log('captionAsk tasdiqlandi — yuborish boshlandi')

  // A tomonda: xabar POST javobi + rasm render bo'lishini kutish
  let msgId = null
  for (let i = 0; i < 30 && !msgId; i++) { await sleep(1000); msgId = lastMsgResp?.id || null }
  if (!msgId) log('DIQQAT: POST /messages javobi 30s ichida ushlanmadi — xabar yuborilmagan bo\'lishi mumkin')
  const aState = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#msgs img.media')]
    const prog = document.querySelectorAll('#msgs .prog').length
    return { imgs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, prog, msgCount: document.querySelectorAll('#msgs .m').length }
  })
  log('A holati:', JSON.stringify(aState), '| PUT chunklar:', mediaPuts, '(r2:' + r2Puts + ')')
  if (!aState.imgs) throw new Error('A da rasm elementi UMUMAN paydo bo\'lmadi')
  if (aState.prog > 0) throw new Error('A da yuklash PROGRESSI hali turgan (upload qotgan)')
  if (!aState.loaded) throw new Error('A da rasm yuklanmadi (naturalWidth=0)')

  // B tomonda: qabul + DECRYPT + render
  await pageB.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() })
  let openedB = false
  for (let i = 0; i < 20 && !openedB; i++) {
    openedB = await pageB.evaluate((cid) => { const it = document.querySelector('[data-chat="' + cid + '"]'); if (it) { it.click(); return true } return false }, cid)
    if (!openedB) await sleep(1500)
  }
  if (!openedB) { await pageB.reload({ waitUntil: 'domcontentloaded' }); await sleep(4000); await pageB.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() }); await sleep(2000) }
  let bLoaded = 0
  for (let i = 0; i < 40 && !bLoaded; i++) {
    await sleep(1000)
    bLoaded = await pageB.evaluate(() => { const is = [...document.querySelectorAll('#msgs img.media')]; return is.filter((x) => x.complete && x.naturalWidth > 0).length })
  }
  const bState = await pageB.evaluate(() => {
    const is = [...document.querySelectorAll('#msgs img.media')]
    const ph = is.filter((x) => x.closest('[data-kind="photo"], .m'))
    return { imgs: is.length, loaded: is.filter((x) => x.complete && x.naturalWidth > 0).length, prog: document.querySelectorAll('#msgs .prog').length }
  })
  log('B holati:', JSON.stringify(bState))
  if (!bState.loaded) throw new Error('B rasmni qabul qilib KO\'RSATMADI (decrypt/render yoki mediaChunk yo\'lida xato)')

  // v86: B rasmga BOSADI — TO'LIQ EKRAN KO'RISH oynasi ochilishi kerak (ochib ko'rish yo'li)
  await pageB.evaluate(() => { const im = [...document.querySelectorAll('#msgs img.media')].find((x) => x.complete && x.naturalWidth > 0); if (im) im.click() })
  await sleep(1500)
  const view = await pageB.evaluate(() => {
    const o = document.querySelector('.imgview')
    const im = o && o.querySelector('img')
    return { open: !!o, loaded: !!(im && im.complete && im.naturalWidth > 0), dl: !!(o && o.querySelector('.dl')), xb: !!(o && o.querySelector('.xb')) }
  })
  log('B toliq-ekran korish:', JSON.stringify(view))
  if (!view.open) throw new Error('B rasmni OCHIB KO\'RISH ishlamadi (.imgview ochilmadi)')
  if (!view.loaded) throw new Error('korish oynasida rasm yuklanmadi (naturalWidth=0)')
  if (!view.dl) throw new Error('korish oynasida SAQLASH tugmasi yo\'q')
  await pageB.evaluate(() => { const x = document.querySelector('.imgview .xb'); if (x) x.click() })
  await sleep(500)
  const closed = await pageB.evaluate(() => !document.querySelector('.imgview'))
  if (!closed) throw new Error('korish oynasi YOPILMADI (✕ ishlamadi)')
  log('B korish oynasi ochildi-yopildi: OK')

  // TOZALASH: test xabarini o'chirish (test akkauntlar chati toza qolsin)
  if (msgId) {
    await page.evaluate(async (id) => { try { await fetch('/api/messages/' + id, { method: 'DELETE', headers: { authorization: 'Bearer ' + localStorage.g50_token } }) } catch {} }, msgId)
    log('test xabari o\'chirildi:', msgId)
  }
  console.log('\n=== FOTO E2E PASS — rasm yuborish A→B to\'liq ishlayapti (' + mediaPuts + ' chunk, r2:' + r2Puts + ', httpXato:' + httpFails.length + ') ===')
} catch (e) {
  console.log('\n=== FOTO E2E FAIL:', String(e?.message || e).slice(0, 300), '===')
  try { await page.screenshot({ path: '/tmp/foto-fail-A.png' }); await pageB.screenshot({ path: '/tmp/foto-fail-B.png' }) } catch {}
  process.exitCode = 1
} finally {
  for (const p of [page, pageB]) { try { const t = await p.evaluate(() => localStorage.g50_token); if (t) await p.evaluate(async (t) => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t } , body: '{}'}) }, t) } catch {} }
  await browser.close()
}
