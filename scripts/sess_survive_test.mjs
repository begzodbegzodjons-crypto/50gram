/* v131 TASHXIS: «deploy sessiyani o'ldiradimi?» — bevosita eksperiment
 * 1) 998907776655 (eganing raqami, DEV_PHONES 1-qator) normal kirish (force YO'Q, logout YO'Q)
 * 2) /api/me token bilan → 200 kutiladi
 * 3) deploy.yml workflow_dispatch (xuddi push'dagi kabi real wrangler deploy)
 * 4) deploy tugashini kutish (~2-6 daqiqa)
 * 5) /api/me XUDI eski token bilan → 200 = sessiya tirik (deploy aybdor EMAS)
 *                                      401 = MUAMMO TAKRORLANDI (deploy sessiyani o'ldiradi!)
 * 6) QO'SHIMCHA: panel orqali foydalanuvchi qo'ng'iroq-uid'larining raqami (uid→phone)
 * Panel egasi paroli wrangler.toml [vars] ADMIN_PASS (panel faqat egasi — v127).
 */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const OWNER_PHONE = '998907776655'
const OWNER_FULL = '+998907776655'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const GH = process.env.GH_TOKEN || ''
const REPO = process.env.GH_REPO || ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function j(path, opt = {}, tries = 5) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
      const t = await r.text()
      let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
      return { st: r.status, d }
    } catch (e) { last = e; console.log('  urinish ' + (i + 1) + ' tarmoq-xato: ' + e.message + ' — 25s'); await sleep(25000) }
  }
  throw last
}

// ---------- 1) KIRISH (eganing raqami — force YO'Q, x-dev bilan) ----------
const DEV = 'sessprobe' + Date.now().toString(16)
const H0 = { 'user-agent': UA, 'x-dev': DEV }
console.log('— 1) EGANING RAQAMIGA KIRISH (' + OWNER_FULL + ', oddiy kirish)')
const o = await j('/api/auth/otp', { method: 'POST', headers: { ...H0, 'content-type': 'application/json' }, body: { phone: OWNER_PHONE } })
if (!o.d || !o.d.dev_code) { console.error('FAIL otp: ' + JSON.stringify(o).slice(0, 200)); process.exit(1) }
const v = await j('/api/auth/verify', { method: 'POST', headers: { ...H0, 'content-type': 'application/json' }, body: { phone: OWNER_FULL, code: o.d.dev_code } })
if (!v.d || !v.d.token) { console.error('FAIL verify: ' + JSON.stringify(v).slice(0, 200)); process.exit(1) }
const TOK = v.d.token
console.log('  ✓ kirish OK uid=' + v.d.user?.id + ' (sess aylanmadi — oddiy kirish)')

// ---------- 2) TOKEN TIRIKLIGI (deploy oldidan bazaviy) ----------
const me1 = await j('/api/me', { h: { authorization: 'Bearer ' + TOK } })
console.log('— 2) deploy OLDI /api/me: ' + me1.st + (me1.st === 200 ? ' ✓' : ' ✗ MUAMMO'))
if (me1.st !== 200) { console.error('Bazaviy token ham 200 olmadi — tashxis deploy bilan bogliq EMAS'); process.exit(1) }

// ---------- 3) PANEL: qo'ng'iroq-uid'larining raqami (uid→phone xaritasi) ----------
console.log('— 3) PANEL: foydalanuvchi-uid → raqam')
const pl = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
if (pl.st === 200 && pl.d.token) {
  const PH = { authorization: 'Bearer ' + pl.d.token }
  for (const uid of [1791656520888751, 1791655264548970]) {
    const pu = await j('/api/panel/user?id=' + uid, { h: PH })
    if (pu.st === 200) console.log('  uid=' + uid + ' → ' + pu.d.phone + ' | ls=' + new Date(pu.d.ls).toISOString() + ' | sessEnd=' + (pu.d.sessEnd ? new Date(pu.d.sessEnd).toISOString() : 'null') + ' | bl=' + pu.d.bl + ' | st=' + pu.d.st)
    else console.log('  uid=' + uid + ' → HTTP ' + pu.st)
  }
} else console.log('  panel login olmadi (' + pl.st + ') — o\'tkazib yuborildi')

// ---------- 4) REAL DEPLOY (workflow_dispatch — push'dagi bilan bir xil) ----------
console.log('— 4) deploy.yml dispatch (real wrangler deploy)')
const dr = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/deploy.yml/dispatches', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + GH, accept: 'application/vnd.github+json' },
  body: JSON.stringify({ ref: 'main' }),
})
console.log('  dispatch: HTTP ' + dr.status + (dr.status === 204 ? ' ✓' : ' ✗'))
if (dr.status !== 204) { console.log("  dispatch olmadi — sessiya-tiriklik testi deploy'siz yakunlanadi"); process.exit(0) }
await sleep(20000)
let run = null
for (let i = 0; i < 60; i++) {
  const rr = await fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/deploy.yml/runs?per_page=1', { headers: { authorization: 'Bearer ' + GH } }).then((r) => r.json())
  run = (rr.workflow_runs || [])[0]
  if (run && run.status === 'completed') break
  console.log('  deploy holati: ' + (run ? run.status : '?') + ' — 15s kutamiz')
  await sleep(15000)
}
console.log('  deploy yakuni: ' + (run ? run.status + '/' + run.conclusion : 'topilmadi'))

// ---------- 5) DEPLOYDAN KEYIN XUDI ESKI TOKEN ----------
const me2 = await j('/api/me', { h: { authorization: 'Bearer ' + TOK } })
console.log('— 5) deploy KEYIN /api/me (eski token): ' + me2.st)
if (me2.st === 200) console.log("  ✓✓ SESSIYA TIRIK — deploy tokenni o'ldirmaydi (aybdor server EMAS — klient tomonga qaramiz)")
else if (me2.st === 401) console.log('  ✗✗ MUAMMO TAKRORLANDI: deploy eski tokenni 401 qildi — REPRODUKSIYA TASDIQLANDI')
else console.log('  ? kutilmagan javob: ' + me2.st + ' ' + JSON.stringify(me2.d).slice(0, 120))

const bld = await j('/api/build')
console.log('— 6) jonli versiya: ' + JSON.stringify(bld.d))
