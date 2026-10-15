/* v131 JONLI ISBOT: versiya uchligi + /auth/refresh real oqimi
 * 1) /api/build=v131, core.js __50BUILD=v131, sw.js 50gram-v131
 * 2) test-raqam bilan kirish → /auth/refresh (sessiya-darvoza orqali) → YANGI token
 * 3) yangi token bilan /me → 200 (refresh tokeni amalda)
 * 4) ESKI token ham hali tirik (sess o'zgarmagan — boshqa qurilmalar tegilmagan)
 * 5) 401-tasdiqlash simulyatsiyasi: noto'g'ri imzo → 401 (xavfsizlik qoladi)
 */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PHONE = '998900000006', FULL = '+998900000006'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const ok = (c, l, x = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (x ? ' — ' + x : '')); if (!c) fails++ }
async function j(path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
      const t = await r.text()
      let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
      // SEC-firewall runner-IP'ga vaqtinchalik 404 «Not found» berishi mumkin (ma'lum,
      // jurnal_read'dagi kabi) — 25s kutib qayta urinamiz
      if (r.status === 404 && i < tries - 1) { console.log('  404 (firewall?) — 25s kutib qayta urinish ' + (i + 1)); last = new Error('404'); await sleep(25000); continue }
      return { st: r.status, d, txt: t }
    } catch (e) { last = e; await sleep(25000) }
  }
  throw last
}
console.log('— 1) VERSIYA UCHLIGI (jonli)')
const b = await j('/api/build')
ok(b.d.v === 'v131', '/api/build v131', JSON.stringify(b.d).slice(0, 60))
const coreTxt = await fetch(BASE + '/core.js?nocache=' + Date.now(), { headers: { 'user-agent': UA } }).then((r) => r.text())
ok(/window\.__50BUILD = 'v131'/.test(coreTxt), 'core.js __50BUILD=v131')
ok(/g50SessRestore/.test(coreTxt) && /applyToken/.test(coreTxt), 'v131 funksiyalari jonli core.js da')
ok(/sessConfirmT/.test(coreTxt), '401-tasdiqlash jonli core.js da')
const swTxt = await fetch(BASE + '/sw.js?nocache=' + Date.now(), { headers: { 'user-agent': UA } }).then((r) => r.text())
ok(/50gram-v131/.test(swTxt), 'sw.js 50gram-v131')

console.log('— 2) KIRISH (' + FULL + ')')
const DEV = 'v131live' + Date.now().toString(16)
const o = await j('/api/auth/otp', { method: 'POST', headers: { 'x-dev': DEV }, body: { phone: PHONE } })
if (!o.d.dev_code) { console.error('FAIL otp: ' + JSON.stringify(o).slice(0, 120)); process.exit(1) }
const v = await j('/api/auth/verify', { method: 'POST', headers: { 'x-dev': DEV }, body: { phone: FULL, code: o.d.dev_code } })
if (!v.d.token) { console.error('FAIL verify: ' + JSON.stringify(v).slice(0, 120)); process.exit(1) }
const TOK1 = v.d.token
ok(true, 'kirish OK uid=' + (v.d.user && v.d.user.id))

console.log('— 3) /auth/refresh (yangi token)')
const rf = await j('/api/auth/refresh', { method: 'POST', headers: { authorization: 'Bearer ' + TOK1 } })
ok(rf.st === 200 && rf.d.token, 'refresh 200 + yangi token', 'HTTP ' + rf.st)
ok(rf.d.token && rf.d.token !== TOK1, 'token haqiqatan YANGI (imzo yana shu sess bilan)')
const me2 = await j('/api/me', { h: { authorization: 'Bearer ' + rf.d.token } })
ok(me2.st === 200, 'yangi token bilan /me 200')

console.log('— 4) ESKI TOKEN HAM TIRIK (sess o\'zgarmagan)')
const me3 = await j('/api/me', { h: { authorization: 'Bearer ' + TOK1 } })
ok(me3.st === 200, 'eski token /me 200 (refresh boshqa qurilmalarga tegmadi)')

console.log('— 5) XAVFSIZLIK: buzilgan token 401')
const bad = await j('/api/me', { h: { authorization: 'Bearer ' + rf.d.token + 'x' } })
ok(bad.st === 401, 'buzilgan token 401 (imzo tekshiruvi qoladi)')
console.log(fails === 0 ? '\nJAMI: HAMMASI YASHIL ✓ (v131 jonli)' : '\nJAMI: ' + fails + ' MUVAFFAQIYATSIZ ✗')
process.exit(fails ? 1 : 0)
