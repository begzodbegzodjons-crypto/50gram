/* 50 GRAM — QO'NG'IROQ MUHR E2E (v96 — «1-qo'ng'iroq zo'r, keyingisi jim» regressiya qulfi)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Foydalanuvchi sindromi (v95'da hal qilingan): BIRINCHI qo'ng'iroq mukammal, KEYINGI
 * qo'ng'iroqlarda ovoz yo'qolardi — qo'ng'iroqlar orasidagi iflos holat merosi tufayli
 * (o'lik AudioContext + tirik sessiyada HAL reset + proaktiv marshrut yo'qligi).
 *
 * SHU MUAMMO QAYTMASLIGI UCHUN bu test har pushda ANA SHU STSENARIYNI sinaydi:
 * Bitta brauzer sessiyasida (reload YO'Q!) 3 ta KETMA-KET video qo'ng'iroq:
 *   1) A→B video   2) A→B video (AYNAN REGRESSIYA HOLATI)   3) B→A video (teskari yo'nalish)
 * Har qo'ng'iroqda TO'LIQ media assertions (ikkala tomon: PC connected, kiruvchi
 * audio+video baytlar, kadrlar, audio currentTime).
 * Har qo'ng'iroqdan KEYIN MUHR INVARIANTLARI (M1/M2/M3):
 *   M1: SHU qo'ng'iroqning o'z AudioContext'i yopiq bo'lishi kerak ('running' emas)
 *       — aynan v94 kasalligi (qo'ng'iroq konteksti tirik qolib ketardi).
 *       IZOH: core.js'dagi beep()-toni konteksti (xabar ovozlari) alohida va BENIGN —
 *       u qo'ng'iroq dvigateliga kirmaydi va test uni hisobga olmaydi.
 *   M2: window.__50actx === null (virgin-kainot kafolati — keyingi qo'ng'iroq 0 dan ochadi)
 *   M3: har qo'ng'iroq KAMIDA bitta YANGI AudioContext yaratgan (freshAudioUniverse ishlagan)
 * Agar kelajakda kimdir endCall tartibini buza bilsa yoki «global kontekstni saqlash»
 * siyosatini qaytarsa — 2-qo'ng'iroqning o'zi QIZIL bo'ladi, deploy'dan keyin darhol ko'rinadi.
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_call_loop.mjs
 */
import { chromium } from 'playwright'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// E2E sinov raqamlari: call_media (005/006) va smoke (003/004) bilan to'qnashmasin
const A = { phone: '998900000007', full: '+998900000007' }
const B = { phone: '998900000008', full: '+998900000008' }

let fails = 0
let tokA = null, tokB = null
const logoutTok = async (token) => { if (!token) return; try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: '{}' }) } catch {} }
const ok = (cond, label, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : ''))
  if (!cond) fails++
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// RTCPeerConnection + AudioContext KUKSI — app kodini O'ZGARTIRMASDAN invariantlarni kuzatamiz
const HOOK = `(() => {
  if (window.__muhHooked) return
  window.__muhHooked = true
  window.__pcs = []; window.__actxs = []
  const O = window.RTCPeerConnection
  if (O) {
    const F = function (...args) { const pc = new O(...args); window.__pcs.push(pc); return pc }
    F.prototype = O.prototype
    window.RTCPeerConnection = F
  }
  const OA = window.AudioContext || window.webkitAudioContext
  if (OA) {
    const FA = function (...args) { const c = new OA(...args); window.__actxs.push(c); return c }
    FA.prototype = OA.prototype
    try { window.AudioContext = FA } catch {}
    try { if (window.webkitAudioContext) window.webkitAudioContext = FA } catch {}
  }
})()`

async function newPage(browser, label) {
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 420, height: 800 },
    permissions: ['camera', 'microphone'],
  })
  await ctx.addInitScript(HOOK) // HAR navigatsiyada (reload'dan keyin ham) kuksi jonli
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)))
  page.on('console', (m) => { if (errs.length < 60) errs.push(m.type() + ': ' + m.text().slice(0, 200)) })
  page.__errs = errs
  page.__label = label
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
    await page.waitForTimeout(25000)
  }
  if (r.err) throw new Error(page.__label + ' login: ' + r.err)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(HOOK)
  await page.waitForTimeout(2000)
  return r
}

async function logout(page) {
  try { await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.g50_token || '') }, body: '{}' }).catch(() => {})) } catch {}
}

// Qo'ng'iroq media holati — FAQAT shu qo'ng'iroqda yaratilgan PC'lar (pcFrom dan boshlab)
async function mediaState(page, pcFrom, win = 3200) {
  return page.evaluate(({ pcFrom, win }) => new Promise((res) => {
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
        const list = (window.__pcs || []).slice(pcFrom)
        for (const pc of list) {
          if (pc.connectionState === 'closed') continue
          const s = await pc.getStats()
          const r = { cs: pc.connectionState, inA: 0, inV: 0, outA: 0, outV: 0, fr: 0 }
          s.forEach((x) => {
            if (x.type === 'inbound-rtp') { if (x.kind === 'audio') r.inA = x.bytesReceived || 0; if (x.kind === 'video') { r.inV = x.bytesReceived || 0; r.fr = x.framesDecoded || 0 } }
            if (x.type === 'outbound-rtp') { if (x.kind === 'audio') r.outA = x.bytesSent || 0; if (x.kind === 'video') r.outV = x.bytesSent || 0 }
          })
          st.pc.push(r)
        }
      } catch (e) { st.pcErr = String(e) }
      res(st)
    }, win)
  }), { pcFrom, win })
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

// Ikkala tomon oynasi toza bo'lguncha kutish (keyingi qo'ng'iroq poygaga kirmasin)
async function waitClean(P1, P2) {
  for (let i = 0; i < 30; i++) {
    const busy = await Promise.all([
      P1.evaluate(() => !!document.querySelector('.over.call')),
      P2.evaluate(() => !!document.querySelector('.over.call')),
    ])
    if (!busy[0] && !busy[1]) return true
    await P1.waitForTimeout(2000)
  }
  return false
}

// ═══ MUHR INVARIANTLARI — har qo'ng'iroq tugagach ═══
// ctxHandle = qo'ng'iroq davomida olingan window.__50actx JSHandle — SHU qo'ng'iroqning
// o'z konteksti. endCall uni yopishi SHART (v94 kasalligi aynan shu edi).
async function sealCheck(page, label, callN, ctxHandle) {
  // M1: SHU qo'ng'iroqning konteksti yopiq (running EMAS)
  const st = await page.evaluate((h) => (h ? String(h.state) : 'yaratilmagan'), ctxHandle).catch(() => 'xato')
  ok(st !== 'running', `[${label}] MUHR M1: qo'ng'iroq #${callN}ning o'z konteksti YOPIQ (running emas)`, 'holat=' + st)
  // M2: global havola tozalangan (keyingi qo'ng'iroq 0 dan ochiladi)
  const s = await page.evaluate(() => ({
    global: window.__50actx === null || window.__50actx === undefined ? 'null' : String(window.__50actx.state),
    actxCount: (window.__actxs || []).length,
    runningN: (window.__actxs || []).filter((c) => c.state === 'running').length,
  }))
  ok(s.global === 'null', `[${label}] MUHR M2: global __50actx tozalangan`, 'global=' + s.global)
  return s
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  log('BASE =', BASE)
  const A_ = await newPage(browser, 'A(007)')
  const B_ = await newPage(browser, 'B(008)')
  log('login A …')
  const ua = await login(A_.page, A, 'A')
  ok(!!ua.uid, 'A login', 'uid=' + ua.uid)
  log('login B …')
  const ub = await login(B_.page, B, 'B')
  ok(!!ub.uid, 'B login', 'uid=' + ub.uid)
  tokA = ua.token; tokB = ub.token
  if (!ua.uid || !ub.uid) throw new Error('login ishlamadi')

  // ── 3 ta KETMA-KET qo'ng'iroq — BIRTA SESSIYADA, RELOAD YO'Q (aynan foydalanuvchi sindromi) ──
  const CALLS = [
    { n: 1, caller: A_, callee: B_, callerUid: ua, calleeUid: ub, label: 'A→B' },
    { n: 2, caller: A_, callee: B_, callerUid: ua, calleeUid: ub, label: 'A→B (REGRESSIYA HOLATI)' },
    { n: 3, caller: B_, callee: A_, callerUid: ub, calleeUid: ua, label: 'B→A (teskari)' },
  ]

  for (const cfg of CALLS) {
    log(`─── QO'NG'IROQ #${cfg.n} (${cfg.label}) ───`)
    if (cfg.n > 1) {
      const clean = await waitClean(A_.page, B_.page)
      ok(clean, `[${cfg.label}] oldingi qo'ng'iroq qoldiqlari toza`)
      await A_.page.waitForTimeout(5000) // foydalanuvchi o'rtadagi tanaffusi
    }
    const pcFromA = await A_.page.evaluate(() => (window.__pcs || []).length)
    const pcFromB = await B_.page.evaluate(() => (window.__pcs || []).length)
    const actxBeforeA = await A_.page.evaluate(() => (window.__actxs || []).length)
    const actxBeforeB = await B_.page.evaluate(() => (window.__actxs || []).length)

    // Chaqiruvchi qo'ng'iroqni boshlaydi
    await cfg.caller.page.evaluate((uid) => callUser(uid, true), cfg.calleeUid.uid)
    await cfg.caller.page.waitForTimeout(1200)
    let ring = null
    try { await cfg.callee.page.waitForSelector('.over.call.incoming', { timeout: 15000 }); ring = true } catch {}
    ok(!!ring, `[${cfg.label}] #${cfg.n}: qabul qiluvchida qo'ng'iroq oynasi chiqdi`)
    if (!ring) { fails++; continue }

    const accepted = await cfg.callee.page.evaluate(() => {
      const el = document.querySelector('.over.call.incoming')
      const b = el && el.querySelector('.cb.ok')
      if (b) { b.click(); return true }
      return false
    })
    ok(accepted, `[${cfg.label}] #${cfg.n}: «Javob berish» bosildi`)
    if (!accepted) { fails++; continue }

    await cfg.caller.page.waitForTimeout(16000) // accept → offer → answer → ICE + media
    const SC = await mediaState(cfg.caller.page, cfg.n === 3 ? pcFromB : pcFromA)
    const SE = await mediaState(cfg.callee.page, cfg.n === 3 ? pcFromA : pcFromB)
    log('chaqiruvchi holati:', JSON.stringify(SC))
    log('qabulchi holati:', JSON.stringify(SE))

    const pcC = (SC.pc || []).find((p) => p.cs === 'connected')
    const pcE = (SE.pc || []).find((p) => p.cs === 'connected')
    ok(!!pcC, `[${cfg.label}] #${cfg.n}: chaqiruvchi PC connected`, JSON.stringify(SC.pc))
    ok(!!pcE, `[${cfg.label}] #${cfg.n}: qabulchi PC connected`, JSON.stringify(SE.pc))
    ok(!!pcC && pcC.inA > 500, `[${cfg.label}] #${cfg.n}: chaqiruvchi KIRUVCHI AUDIO oqadi`, pcC ? 'inA=' + pcC.inA : JSON.stringify(SC.pc))
    ok(!!pcC && pcC.inV > 500 && pcC.fr > 3, `[${cfg.label}] #${cfg.n}: chaqiruvchi KIRUVCHI VIDEO oqadi (kadrlar)`, pcC ? 'inV=' + pcC.inV + ' fr=' + pcC.fr : JSON.stringify(SC.pc))
    ok(!!pcE && pcE.inA > 500, `[${cfg.label}] #${cfg.n}: qabulchi KIRUVCHI AUDIO oqadi`, pcE ? 'inA=' + pcE.inA : JSON.stringify(SE.pc))
    ok(!!pcE && pcE.inV > 500 && pcE.fr > 3, `[${cfg.label}] #${cfg.n}: qabulchi KIRUVCHI VIDEO oqadi (kadrlar)`, pcE ? 'inV=' + pcE.inV + ' fr=' + pcE.fr : JSON.stringify(SE.pc))
    ok(!!SC.v && SC.v.rvfc > 0 && SC.v.w > 0, `[${cfg.label}] #${cfg.n}: chaqiruvchi ekranda masofa-kadrlar KELADI`, JSON.stringify(SC.v))
    ok(!!SE.v && SE.v.rvfc > 0 && SE.v.w > 0, `[${cfg.label}] #${cfg.n}: qabulchi ekranda masofa-kadrlar KELADI`, JSON.stringify(SE.v))
    ok(!!SC.a && SC.a.adv > 0.5, `[${cfg.label}] #${cfg.n}: chaqiruvchi audio currentTime oladi (ovoz ishlaydi)`, JSON.stringify(SC.a))
    ok(!!SE.a && SE.a.adv > 0.5, `[${cfg.label}] #${cfg.n}: qabulchi audio currentTime oladi (ovoz ishlaydi)`, JSON.stringify(SE.a))

    // MUHR M3: bu qo'ng'iroq KAMIDA bitta YANGI AudioContext yaratgan bo'lishi kerak
    // (freshAudioUniverse — har qo'ng'iroq virgin kontekst)
    const actxAfterA = await A_.page.evaluate(() => (window.__actxs || []).length)
    const actxAfterB = await B_.page.evaluate(() => (window.__actxs || []).length)
    ok(actxAfterA > actxBeforeA, `[${cfg.label}] #${cfg.n}: MUHR M3 chaqiruvchida yangi kontekst tug'ilgan`, `oldin=${actxBeforeA} keyin=${actxAfterA}`)
    ok(actxAfterB > actxBeforeB, `[${cfg.label}] #${cfg.n}: MUHR M3 qabulchida yangi kontekst tug'ilgan`, `oldin=${actxBeforeB} keyin=${actxAfterB}`)

    // MUHR M1 uchun: SHU qo'ng'iroqning kontekst-havolasini yopilishdan OLDIN ushlab olamiz
    const ctxHandleC = await cfg.caller.page.evaluateHandle(() => window.__50actx)
    const ctxHandleE = await cfg.callee.page.evaluateHandle(() => window.__50actx)

    // Tugatish — chaqiruvchi
    await hangupByButton(cfg.caller.page)
    await cfg.caller.page.waitForTimeout(4500)
    const goneC = await cfg.caller.page.evaluate(() => !document.querySelector('.over.call'))
    const goneE = await cfg.callee.page.evaluate(() => !document.querySelector('.over.call'))
    ok(goneC, `[${cfg.label}] #${cfg.n}: chaqiruvchi oynasi yopildi`)
    ok(goneE, `[${cfg.label}] #${cfg.n}: qabulchi oynasi proaktiv yopildi`)
    await cfg.caller.page.waitForTimeout(2500) // close() lar yakunlanishi

    // MUHR M1/M2 — ikkala tomorda (shu qo'ng'iroqning o'z konteksti tekshiriladi)
    await sealCheck(cfg.caller.page, cfg.label + ' chaqiruvchi', cfg.n, ctxHandleC)
    await sealCheck(cfg.callee.page, cfg.label + ' qabulchi', cfg.n, ctxHandleE)
    try { await ctxHandleC.dispose() } catch {}
    try { await ctxHandleE.dispose() } catch {}
  }

  log('─── YAKUNIY: konsol xatolari ───')
  log('A konsol oxiri:', JSON.stringify(A_.page.__errs.slice(-12)))
  log('B konsol oxiri:', JSON.stringify(B_.page.__errs.slice(-12)))
  const errA = A_.page.__errs.filter((e) => /^(error|pageerror|HTTP)/.test(e) && !/favicon|sourcemap/i.test(e))
  const errB = B_.page.__errs.filter((e) => /^(error|pageerror|HTTP)/.test(e) && !/favicon|sourcemap/i.test(e))
  ok(errA.length === 0, 'A sahifasida JS xatosi yo\'q', errA.slice(0, 3).join(' | '))
  ok(errB.length === 0, 'B sahifasida JS xatosi yo\'q', errB.slice(0, 3).join(' | '))
  ok(fails === 0, 'MUHR YAXSHI — 3 ketma-ket qo\'ng\'iroq + invariantlar', fails + ' yiqilish')
} catch (e) {
  console.error('E2E XATO:', e)
  fails++
} finally {
  try { await Promise.all([logoutTok(tokA), logoutTok(tokB)]) } catch {}
  try { await browser.close() } catch {}
}
console.log(fails === 0 ? '\n=== MUHR E2E PASS — «keyingi qo\'ng\'iroq jim» kasalligi QAYTMAYDI ===' : `\n=== MUHR E2E FAIL — ${fails} tekshiruv yiqildi ===`)
process.exit(fails === 0 ? 0 : 1)
