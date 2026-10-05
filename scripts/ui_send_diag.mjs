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

async function devLogin(page, phone) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const r = await page.evaluate(async (phone) => {
    const otp = await fetch('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }).then((x) => x.json())
    const v = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + phone, code: otp.dev_code }) }).then((x) => x.json())
    localStorage.setItem('g50_token', v.token)
    return v
  }, phone)
  log('login', phone, '→ uid', r.user?.id)
  return r
}

try {
  const ua = await devLogin(page, '998900000005')
  const ub = await devLogin(pageB, '998900000006')

  // direct chat yaratish (page fetch orqali — audit bilan bir xil)
  const cid = await page.evaluate(async (uid) => {
    const res = await fetch('/api/chats/direct', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + localStorage.g50_token }, body: JSON.stringify({ user_id: uid }) })
    return (await res.json()).id
  }, ub.user.id)
  log('direct chat:', cid)

  // ILOVA UI'sida chatni ochish: chats tab → chat item .click() (audit bilan bir xil)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(3000)
  await page.evaluate(() => { const b = document.querySelector('.dock button[data-t="t-chats"]'); if (b) b.click() })
  await sleep(800)
  const opened = await page.evaluate((cid) => { const it = document.querySelector('[data-chat="' + cid + '"]'); if (it) { it.click(); return true } return false }, cid)
  log('chat item topildi va click:', opened)
  await sleep(1500)

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
  let clickErr = ''
  try { await page.click('#b-send', { timeout: 6000 }) } catch (e) { clickErr = String(e).slice(0, 300) }
  log('klik natijasi:', clickErr || 'OK (bosildi)')

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
