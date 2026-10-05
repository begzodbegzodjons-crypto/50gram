// UI-send tashxisi: nega auditning "haqiqiy yozib yuborildi" testi doim yiqiladi?
// Jonli saytga qarshi: login → direct chat → chat ochish → fill → click #b-send →
// HAR BIR qadamda holat: S.cur, inp qiymati, POST javobi, klik xatosi, sahifa jurnali.
import { chromium } from 'playwright'

const BASE = 'https://50gram.begzodbegzodjons.workers.dev'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => log('PAGEERROR:', String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('console.' + m.type() + ':', m.text().slice(0, 180)) })
page.on('response', (r) => { if (r.url().includes('/api/') && (r.status() >= 400 || r.url().includes('/messages'))) log('HTTP', r.status(), r.request().method(), r.url().replace(/^.*\/api\//, '').slice(0, 90)) })

// ---- login A (005) va B (006) — B uchun alohida kontekst
const ctxB = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 } })
const pageB = await ctxB.newPage()

async function devLogin(page, phone, who) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const r = await page.evaluate(async ({ phone, who }) => {
    const otp = await fetch('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }).then((x) => x.json())
    const v = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + phone, code: otp.dev_code }) }).then((x) => x.json())
    // AUDIT BILAN BIR XIL: token + g50_me (ilova boot uchun ikkalasi ham kerak bo'lishi mumkin)
    localStorage.setItem('g50_token', v.token)
    localStorage.setItem('g50_me', JSON.stringify(v.user))
    if (!v.user.first_name) {
      const p = await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: JSON.stringify({ first_name: who === 'A' ? 'E2E-A' : 'E2E-B' }) }).then((x) => x.json())
      if (p && p.id) localStorage.setItem('g50_me', JSON.stringify(p))
    }
    return v
  }, { phone, who })
  log('login', phone, '→ uid', r.user?.id)
  return r
}

try {
  const ua = await devLogin(page, '998900000005', 'A')
  const ub = await devLogin(pageB, '998900000006', 'B')

  // BOOT KUTISH (audit singari): reload → ilova to'liq ochilishi
  await page.reload({ waitUntil: 'domcontentloaded' })
  await pageB.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  const bootState = await page.evaluate(() => ({ hasS: !!window.S, me: localStorage.g50_me ? 'bor' : 'yo\'q', items: document.querySelectorAll('[data-chat]').length }))
  log('boot holati:', JSON.stringify(bootState))

  // direct chat yaratish (page fetch orqali — audit bilan bir xil, reload YO'Q)
  const cid = await page.evaluate(async (uid) => {
    const res = await fetch('/api/chats/direct', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.g50_token }, body: JSON.stringify({ user_id: uid }) })
    return (await res.json()).id
  }, ub.user.id)
  log('direct chat:', cid)

  // ILOVA UI'sida chatni ochish: chats tab → chat item .click() (audit bilan bir xil)
  await page.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() })
  await sleep(800)
  // RO'YXAT YUKLANISHINI KUTISH: item 15s ichida paydo bo'lishi kerak (CI'da SW/WS sekin bo'lishi mumkin)
  let opened = false
  for (let i = 0; i < 15 && !opened; i++) {
    opened = await page.evaluate((cid) => { const it = document.querySelector('[data-chat="' + cid + '"]'); if (it) { it.click(); return true } return false }, cid)
    if (!opened) await sleep(1000)
  }
  log('chat item topildi va click:', opened)
  await sleep(1500)
  if (!opened) {
    const listState = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-chat]').length,
      chatsSize: window.S?.chats?.size,
      listHtml: (document.getElementById('chatlist')?.innerHTML || '').slice(0, 200),
    }))
    log('RO\'YXAT HOLATI (item topilmadi):', JSON.stringify(listState))
  }

  // DIALOG holati
  const st1 = await page.evaluate(() => ({
    cur: window.S?.cur,
    dialogOpen: document.getElementById('dialog')?.classList.contains('open'),
    inpVisible: !!document.getElementById('inp')?.offsetParent,
    sendVisible: !!document.getElementById('b-send')?.offsetParent,
    sendText: document.getElementById('b-send')?.textContent,
    compHidden: document.getElementById('d-comp')?.classList.contains('hide'),
  }))
  log('holat 1 (chat ochilgach):', JSON.stringify(st1))

  // fill + qiymat tekshiruvi
  await page.fill('#inp', 'UI dan yozilgan xabar')
  const st2 = await page.evaluate(() => ({ inp: document.getElementById('inp')?.value, sendIcon: document.getElementById('b-send')?.textContent }))
  log('holat 2 (fill dan keyin):', JSON.stringify(st2))

  // klik — xatoni YUTMASDAN
  // NIMA TO'SIQ? boundingBox, elementFromPoint, pointer-events — hammasini ko'ramiz
  const clickDiag = await page.evaluate(() => {
    const b = document.getElementById('b-send')
    if (!b) return { found: false }
    const r = b.getBoundingClientRect()
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const at = document.elementFromPoint(cx, cy)
    const chain = []
    let e = at
    while (e && chain.length < 5) { chain.push(e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0]); e = e.parentElement }
    const cs = getComputedStyle(b)
    return {
      found: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      vp: { w: innerWidth, h: innerHeight },
      centerInVp: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight,
      elementAtPoint: chain,
      pe: cs.pointerEvents, disp: cs.display, vis: cs.visibility, op: cs.opacity,
      disabled: b.disabled,
      inpValue: document.getElementById('inp')?.value,
      sendIcon: b.textContent,
    }
  })
  log('klik-tashxis:', JSON.stringify(clickDiag))
  let clickErr = ''
  try { await page.click('#b-send', { timeout: 6000 }) } catch (e) { clickErr = String(e).slice(0, 400) }
  log('klik natijasi:', clickErr || 'OK (bosildi)')
  // Agar Playwright klikolmasa — xuddi shu nuqtada REAL pointer-up hodisasini qo'lda yuborib ko'ramiz
  if (clickErr) {
    const sent = await page.evaluate(() => {
      const b = document.getElementById('b-send')
      const r = b.getBoundingClientRect()
      const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 7, isPrimary: true }
      b.dispatchEvent(new PointerEvent('pointerdown', o))
      b.dispatchEvent(new PointerEvent('pointerup', o))
      return true
    })
    log('qo\'lda pointer hodisalari yuborildi:', sent)
    await sleep(2000)
  }

  await sleep(2500)
  const st3 = await page.evaluate(() => ({ inp: document.getElementById('inp')?.value, cur: window.S?.cur }))
  log('holat 3 (klikdan 2.5s keyin):', JSON.stringify(st3))

  // B xabarni ko'rdimi?
  const seen = await pageB.evaluate(async (cid) => {
    const res = await fetch('/api/chats/' + cid + '/messages?latest=5', { headers: { authorization: 'Bearer ' + localStorage.g50_token } })
    return await res.json()
  }, cid)
  log('B korgan oxirgi xabarlar:', JSON.stringify((seen.messages || []).map((m) => (m.body || '').slice(0, 40))))
} catch (e) {
  console.error('TASHXIS XATO:', e)
} finally {
  try { await browser.close() } catch {}
}
