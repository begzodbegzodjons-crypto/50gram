/* 50 GRAM — MEDIA YUBORISH E2E (rasm + fayl, to'liq davra)
 * Haqiqiy 2 ta brauzer konteksti bilan JONLI saytga qarshi:
 *  1) RASM: A "📎 → Rasm yoki video" → Playwright filechooser bilan rasm beradi →
 *     izoh oynasi → yuborish → A'da bubble → B'da rasm DEKODLANADI (naturalWidth>0).
 *     Bu: yuklash (AES-GCM) → server (R2) → xabar → yuklab olish → dekript → render —
 *     TO'LIQ zanjirni isbotlaydi.
 *  2) FAYL: A "📎 → Fayl" → matn fayl → B kliklaydi → download hodisasi → MATNI MOS (bayt-bayt).
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_media_send.mjs
 */
import { chromium } from 'playwright'
import { writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import zlib from 'zlib'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// smoke (003/004) va call-e2e (005/006) bilan to'qnashmasin
const A = { phone: '998900000007', full: '+998900000007' }
const B = { phone: '998900000008', full: '+998900000008' }

let fails = 0
let tokA = null, tokB = null
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + t.slice(0, 120))
  return d
}
const login = async (p) => {
  const o = await j('/api/auth/otp', { method: 'POST', body: { phone: p.phone } })
  const v = await j('/api/auth/verify', { method: 'POST', body: { phone: p.full, code: o.dev_code } })
  const token = v.token || v.access_token || v
  const me = await j('/api/me', { h: { authorization: 'Bearer ' + token } })
  return { token, me: me.user || me }
}
const logout = async (token) => { if (!token) return; try { await j('/api/auth/logout', { method: 'POST', h: { authorization: 'Bearer ' + token }, body: {} }) } catch {} }

// 300x200 qizil PNG (haqiqiy, valid fayl)
function makePng() {
  const w = 300, h = 200
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1); raw[o] = 0
    for (let x = 0; x < w; x++) { raw[o + 1 + x * 3] = 220; raw[o + 2 + x * 3] = 30; raw[o + 3 + x * 3] = 30 }
  }
  const crcT = (() => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return (b) => { let cr = 0xffffffff; for (let i = 0; i < b.length; i++) cr = t[(cr ^ b[i]) & 0xff] ^ (cr >>> 8); return (cr ^ 0xffffffff) >>> 0 } })()
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crcT(td)); return Buffer.concat([len, td, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

async function newApp(browser, acc, label) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 420, height: 800 }, acceptDownloads: true })
  await ctx.addInitScript((st) => {
    localStorage.setItem('g50_token', st.token)
    localStorage.setItem('g50_me', JSON.stringify(st.me))
  }, { token: acc.token, me: acc.me })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log('  [' + label + '] pageerror:', String(e).slice(0, 150)))
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  // Yangi akkaunt — profil qadami (ism) chiqishi mumkin: to'ldiramiz
  try {
    await page.waitForSelector('#a-prof:not(.hide)', { timeout: 5000 })
    await page.fill('#ap-first', 'E2E ' + label)
    await page.click('#b-prof')
    log('[' + label + '] profil to`ldirildi')
  } catch {}
  await page.waitForSelector('#chatlist .item', { timeout: 25000 })
  return { ctx, page }
}

;(async () => {
  console.log('== MEDIA E2E boshlandi:', BASE)
  const pngPath = join(tmpdir(), 'e2e-rasm.png'); writeFileSync(pngPath, makePng())
  const fileBody = '50gram-media-e2e ' + Date.now() + ' — bu fayl matni.'
  const filePath = join(tmpdir(), 'e2e-fayl.txt'); writeFileSync(filePath, fileBody, 'utf8')

  let browser
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    log('auth...')
    const a = await login(A), b = await login(B)
    tokA = a.token; tokB = b.token
    ok(!!a.me?.id && !!b.me?.id, 'A va B login', 'A=' + a.me?.id + ' B=' + b.me?.id)

    const d = await j('/api/chats/direct', { method: 'POST', h: { authorization: 'Bearer ' + a.token }, body: { user_id: b.me.id } })
    const chatId = (d.chat || d).id
    ok(!!chatId, 'direct chat', 'id=' + chatId)

    const Pa = await newApp(browser, a, 'A')
    const Pb = await newApp(browser, b, 'B')

    const openChat = async (page) => {
      await page.waitForSelector(`.item[data-chat="${chatId}"]`, { timeout: 15000 })
      await page.click(`.item[data-chat="${chatId}"]`)
      await page.waitForSelector('#msgs .mrow, #msgs .empty', { timeout: 15000 })
    }
    await openChat(Pa.page); await openChat(Pb.page)
    log('chatlar ochildi')

    // ---------- 1-SENARIY: RASM (faqat YANGI xabarga qaraladi) ----------
    const imgA0 = await Pa.page.locator('#msgs .mrow img').count()
    const imgB0 = await Pb.page.locator('#msgs .mrow img').count()
    log('RASM yuborilmoqda (A)...')
    const [fc] = await Promise.all([
      Pa.page.waitForEvent('filechooser', { timeout: 15000 }),
      Pa.page.click('#b-attach').then(() => Pa.page.click('[data-a="gal"]')),
    ])
    await fc.setFiles(pngPath)
    await Pa.page.waitForSelector('#cap-s', { timeout: 10000 })
    await Pa.page.fill('#cap-i', 'e2e rasm izohi')
    await Pa.page.click('#cap-s')
    const decoded = await Pb.page.waitForFunction((n) => {
      const imgs = [...document.querySelectorAll('#msgs .mrow img')]
      return imgs.length > n && imgs[imgs.length - 1].complete && imgs[imgs.length - 1].naturalWidth > 0
    }, imgB0, { timeout: 45000 }).then(() => true).catch(() => false)
    ok(decoded, 'B: YANGI rasm yuklab olindi + DEKRIPT + DEKODLANDI (naturalWidth>0)')
    const decodedA = await Pa.page.waitForFunction((n) => {
      const imgs = [...document.querySelectorAll('#msgs .mrow img')]
      return imgs.length > n && imgs[imgs.length - 1].complete && imgs[imgs.length - 1].naturalWidth > 0
    }, imgA0, { timeout: 30000 }).then(() => true).catch(() => false)
    ok(decodedA, "A: o'z rasmini koradi (kesh)")

    // ---------- 2-SENARIY: FAYL (oxirgi fayl bilan ishlaydi) ----------
    const fileB0 = await Pb.page.locator('#msgs .file[data-file]').count()
    log('FAYL yuborilmoqda (A)...')
    const [fc2] = await Promise.all([
      Pa.page.waitForEvent('filechooser', { timeout: 15000 }),
      Pa.page.click('#b-attach').then(() => Pa.page.click('[data-a="file"]')),
    ])
    await fc2.setFiles(filePath)
    const arrived = await Pb.page.waitForFunction((n) => document.querySelectorAll('#msgs .file[data-file]').length > n, fileB0, { timeout: 30000 }).then(() => true).catch(() => false)
    ok(arrived, 'B: YANGI fayl bubble korindi')
    if (arrived) {
      try {
        const [dl] = await Promise.all([
          Pb.page.waitForEvent('download', { timeout: 30000 }),
          Pb.page.locator('#msgs .file[data-file]').last().click(),
        ])
        const got = readFileSync(await dl.path(), 'utf8')
        ok(got === fileBody, 'B: fayl mazmuni BAYT-BAYT MOS', got.slice(0, 40))
      } catch (e) {
        ok(false, 'B: fayl yuklab olish (download hodisasi)', String(e).slice(0, 120))
      }
    }

    console.log(fails === 0 ? '\n=== MEDIA E2E PASS ===' : '\n=== MEDIA E2E FAIL (' + fails + ') ===')
    process.exitCode = fails === 0 ? 0 : 1
  } catch (e) {
    console.error('E2E XATO:', e?.message || e)
    process.exitCode = 1
  } finally {
    await logout(tokA); await logout(tokB)
    try { await browser?.close() } catch {}
  }
})()
