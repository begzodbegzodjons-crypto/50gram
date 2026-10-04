/* 50 GRAM — QO'NG'IROQ MEDIA E2E (qulf-test)
 * Haqiqiy 2 ta brauzer konteksti + fake kamera/mikrofon bilan JONLI saytga qarshi:
 *  1-ssenariy (foydalanuvchi simptomi B): A→B video qo'ng'iroq, B javob beradi →
 *     IKKALA tomonda ham (a) PC 'connected', (b) kiruvchi AUDIO va VIDEO baytlar oqadi,
 *     (c) masofaviy video kadrlar keladi (requestVideoFrameCallback), (d) audio currentTime oladi.
 *     Birtomonlama media (video qotadi + ovoz yo'q) bo'lsa — QIZIL.
 *  2-ssenariy (simptom A): A→B qo'ng'iroq, B javob bermaydi → jiringlash ekrani kamida 15s
 *     TURADI («bitta sigan berib o'chib qoldi» bo'lsa — QIZIL), keyin B rad etadi → A
 *     «Rad etildi» holatini ko'radi va ekranlar TOZA yopiladi.
 * Har ssenariydan keyin akkauntlar logout qilinadi (raqam «band» qolmasin).
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_call_media.mjs
 */
import { chromium } from 'playwright'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// E2E sinov raqamlari: smoke (003/004) bilan to'qnashmasin
const A = { phone: '998900000005', full: '+998900000005' }
const B = { phone: '998900000006', full: '+998900000006' }

let fails = 0
const ok = (cond, label, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) fails++
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// RTCPeerConnection'ni ushlab olish — E2E getStats uchun (app kodini O'ZGARTIRMAYDI)
const HOOK = `(() => {
  const O = window.RTCPeerConnection
  if (O && !window.__hooked) {
    window.__hooked = true
    window.__pcs = []
    const F = function (...args) { const pc = new O(...args); window.__pcs.push(pc); return pc }
    F.prototype = O.prototype
    window.RTCPeerConnection = F
  }
})()`

async function newPage(browser, label) {
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 420, height: 800 },
    permissions: ['camera', 'microphone'],
  })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)) })
  page.__errs = errs
  page.__label = label
  return { ctx, page }
}

async function login(page, u) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(HOOK)
  const r = await page.evaluate(async ({ phone, full }) => {
    const j = async (path, body) => {
      const h = { 'content-type': 'application/json' }
      if (localStorage.g50_token) h.authorization = 'Bearer ' + localStorage.g50_token
      return fetch('/api' + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json())
    }
    const o = await j('/auth/otp', { phone })
    if (!o.ok) return { err: 'otp: ' + JSON.stringify(o) }
    const v = await j('/auth/verify', { phone: full, code: o.dev_code })
    if (!v.token) return { err: 'verify: ' + JSON.stringify(v) }
    localStorage.setItem('g50_token', v.token)
    localStorage.setItem('g50_me', JSON.stringify(v.user))
    return { uid: v.user.id, name: v.user.first_name }
  }, u)
  if (r.err) throw new Error(page.__label + ' login: ' + r.err)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(HOOK)
  await page.waitForTimeout(2000) // app init + WS ochilishi
  return r
}

async function logout(page) {
  try { await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.g50_token || '') }, body: '{}' }).catch(() => {})) } catch {}
}

// Qo'ng'iroq oynasi holati: element, matn, video/audio oqimi, PC holatlari (getStats bilan)
async function mediaState(page, win = 3200) {
  return page.evaluate((win) => new Promise((res) => {
    const el = document.querySelector('.over.call')
    if (!el) return res({ ui: false })
    const v = el.querySelector('video.remote')
    const a = el.querySelector('audio.ra')
    const st = { ui: true, cst: (el.querySelector('.cst') || {}).textContent || '', v: null, a: null, pc: [] }
    let rvfc = 0
    if (v && v.requestVideoFrameCallback) {
      const cb = () => { rvfc++; try { v.requestVideoFrameCallback(cb) } catch {} }
      try { v.requestVideoFrameCallback(cb) } catch {}
    }
    const a0 = a ? a.currentTime : -1
    setTimeout(async () => {
      st.v = v ? { ready: v.readyState, w: v.videoWidth, h: v.videoHeight, paused: v.paused, src: !!v.srcObject, rvfc } : null
      st.a = a ? { paused: a.paused, src: !!a.srcObject, muted: a.muted, adv: +(a.currentTime - a0).toFixed(2) } : null
      try {
        for (const pc of window.__pcs || []) {
          if (pc.connectionState === 'closed') continue
          const s = await pc.getStats()
          const r = { cs: pc.connectionState, sig: pc.signalingState, inA: 0, inV: 0, outA: 0, outV: 0, fr: 0 }
          s.forEach((x) => {
            if (x.type === 'inbound-rtp') { if (x.kind === 'audio') r.inA = x.bytesReceived || 0; if (x.kind === 'video') { r.inV = x.bytesReceived || 0; r.fr = x.framesDecoded || 0 } }
            if (x.type === 'outbound-rtp') { if (x.kind === 'audio') r.outA = x.bytesSent || 0; if (x.kind === 'video') r.outV = x.bytesSent || 0 }
          })
          st.pc.push(r)
        }
      } catch (e) { st.pcErr = String(e) }
      res(st)
    }, win)
  }), win)
}

async function hangupByButton(page) {
  try {
    await page.evaluate(() => {
      const el = document.querySelector('.over.call')
      const b = el && el.querySelector('.cb.end')
      if (b) b.click()
    })
  } catch {}
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  log('BASE =', BASE)
  const A_ = await newPage(browser, 'A(005)')
  const B_ = await newPage(browser, 'B(006)')
  log('login A …')
  const ua = await login(A_.page, A)
  ok(!!ua.uid, 'A login', 'uid=' + ua.uid)
  log('login B …')
  const ub = await login(B_.page, B)
  ok(!!ub.uid, 'B login', 'uid=' + ub.uid)
  if (!ua.uid || !ub.uid) throw new Error('login ishlamadi')

  // ============ 1-SSENARIY: A→B video qo'ng'iroq, B JAVOB BERADI (simptom B) ============
  log('1-SENARIY: A → B video qo\'ng\'iroq, B javob beradi')
  await A_.page.evaluate((uid) => callUser(uid, true), ub.uid)
  await A_.page.waitForTimeout(1200)

  // B: qo'ng'iroq KELDI va barqaror turadi
  let ring = null
  try { await B_.page.waitForSelector('.over.call.incoming', { timeout: 15000 }); ring = await mediaState(B_.page, 400) } catch {}
  ok(!!ring, 'B da qo\'ng\'iroq oynasi chiqdi (yetkazish)')
  if (ring) {
    const uiStill = await B_.page.evaluate(() => !!document.querySelector('.over.call.incoming'))
    ok(uiStill, 'oyna barqaror (bir necha soniyada o\'chib qolmadi)')
  }
  // B javob beradi (haqiqiy tugma bosish yo'li)
  const accepted = await B_.page.evaluate(() => {
    const el = document.querySelector('.over.call.incoming')
    const b = el && el.querySelector('.cb.ok')
    if (b) { b.click(); return true }
    return false
  })
  ok(accepted, 'B «Javob berish» bosdi')
  if (accepted) {
    await A_.page.waitForTimeout(16000) // accept → offer → answer → ICE + media oqishi
    const SA = await mediaState(A_.page)
    const SB = await mediaState(B_.page)
    log('A holati:', JSON.stringify(SA))
    log('B holati:', JSON.stringify(SB))
    ok(!!SA.ui, 'A da qo\'ng\'iroq oynasi hali ochiq')
    ok(!!SB.ui, 'B da qo\'ng\'iroq oynasi hali ochiq')
    const pcA = (SA.pc || []).find((p) => p.cs === 'connected')
    const pcB = (SB.pc || []).find((p) => p.cs === 'connected')
    ok(!!pcA, 'A PC connected', JSON.stringify(SA.pc))
    ok(!!pcB, 'B PC connected', JSON.stringify(SB.pc))
    ok(!!pcA && pcA.inA > 500, 'A: kiruvchi AUDIO oqadi (B ovozi)', pcA ? 'inA=' + pcA.inA : JSON.stringify(SA.pc))
    ok(!!pcA && pcA.inV > 500 && pcA.fr > 3, 'A: kiruvchi VIDEO oqadi (B rasmi)', pcA ? 'inV=' + pcA.inV + ' frames=' + pcA.fr : JSON.stringify(SA.pc))
    ok(!!pcA && pcA.outA > 500 && pcA.outV > 500, 'A: chiquvchi oqam jo\'natyapti')
    ok(!!pcB && pcB.inA > 500, 'B: kiruvchi AUDIO oqadi (A ovozi)', pcB ? 'inA=' + pcB.inA : JSON.stringify(SB.pc))
    ok(!!pcB && pcB.inV > 500 && pcB.fr > 3, 'B: kiruvchi VIDEO oqadi (A rasmi)', pcB ? 'inV=' + pcB.inV + ' frames=' + pcB.fr : JSON.stringify(SB.pc))
    ok(!!SB.v && SB.v.rvfc > 0 && SB.v.w > 0, 'B ekranda masofaviy video kadrlar KELYAPTi', JSON.stringify(SB.v))
    ok(!!SA.v && SA.v.rvfc > 0 && SA.v.w > 0, 'A ekranda masofaviy video kadrlar KELYAPTi (MUHIM — simptom B)', JSON.stringify(SA.v))
    ok(!!SA.a && SA.a.adv > 0.5, 'A audio currentTime oladi (ovoz eshitilyapti)', JSON.stringify(SA.a))
    ok(!!SB.a && SB.a.adv > 0.5, 'B audio currentTime oladi', JSON.stringify(SB.a))
    // Tozalash: A tugatadi
    await hangupByButton(A_.page)
    await A_.page.waitForTimeout(1500)
    const goneA = await A_.page.evaluate(() => !document.querySelector('.over.call'))
    const goneB = await B_.page.evaluate(() => !document.querySelector('.over.call'))
    ok(goneA, 'A tugatgach o\'z oynasi yopildi')
    ok(goneB, 'B oynasi ham proaktiv yopildi (hangup yetdi)')
  }

  // ============ 2-SSENARIY: A→B qo'ng'iroq, B javob bermaydi (simptom A) ============
  log('2-SENARIY: A → B qo\'ng\'iroq (javob YO\'Q) — jiringlash 15s turishi kerak')
  await A_.page.waitForTimeout(2500) // holatlar tozalanishi uchun
  await A_.page.evaluate((uid) => callUser(uid, false), ub.uid)
  let ring2 = false
  try { await B_.page.waitForSelector('.over.call', { timeout: 15000 }); ring2 = true } catch {}
  ok(ring2, 'B da qo\'ng\'iroq chiqdi (audio qo\'ng\'iroq)')
  if (ring2) {
    // 15s kutiladi: «bitta sigan berib o\'chib qoldi» simptomi aniqlanadi
    await B_.page.waitForTimeout(15000)
    const still = await B_.page.evaluate(() => !!document.querySelector('.over.call'))
    ok(still, 'B jiringlash ekrani 15s DAN KEYIN HAM TURADI (o\'chib qolmadi)')
    const stB = await B_.page.evaluate(() => { const e = document.querySelector('.over.call'); return e ? ((e.querySelector('.cst') || {}).textContent || '') : '' })
    log('B ekrani holati 15s da:', JSON.stringify(stB))
    // B rad etadi → A «Rad etildi» ko\'radi
    await B_.page.evaluate(() => { const e = document.querySelector('.over.call'); const b = e && e.querySelector('.cb.end'); if (b) b.click() })
    await B_.page.waitForTimeout(3000)
    const goneA2 = await A_.page.evaluate(() => !document.querySelector('.over.call'))
    ok(goneA2, 'B rad etgach A oynasi yopildi (holat yetdi)')
  }

  // JS xatolari — qo'ng'iroq oynasidagi crash'lar
  const errA = A_.page.__errs.filter((e) => !/favicon|sourcemap/i.test(e))
  const errB = B_.page.__errs.filter((e) => !/favicon|sourcemap/i.test(e))
  ok(errA.length === 0, 'A sahifasida JS xatosi yo\'q', errA.slice(0, 3).join(' | '))
  ok(errB.length === 0, 'B sahifasida JS xatosi yo\'q', errB.slice(0, 3).join(' | '))

  await logout(A_.page); await logout(B_.page)
  await A_.ctx.close(); await B_.ctx.close()
} catch (e) {
  console.error('E2E XATO:', e)
  fails++
} finally {
  await browser.close()
}
console.log(fails === 0 ? '\n=== E2E PASS — qo\'ng\'iroq zanjiri to\'liq ishlayapti ===' : `\n=== E2E FAIL — ${fails} tekshiruv yiqildi ===`)
process.exit(fails === 0 ? 0 : 1)
