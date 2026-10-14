/* TASK 71 TASHXISI — «Avtorizatsiya kerak» login oqimi jonli tekshiruvi.
 * Foydalanuvchi: telefon+kod kiritgandan keyin «Avtorizatsiya kerak» chiqib, ilova chiqib ketadi
 * va workers.dev manzili ko'rinadi. Bu skript HAQIQIY foydalanuvchi oqimini IKKALA domenda
 * takrorlaydi va har qadam statusini chop etadi:
 *   1) KESH/BUILD: ikkala domendagi core.js/sw.js versiyasi + cache sarlavhalari
 *   2) LOGIN OQIMI: otp → verify → /me → /chats → /calls/pending → /ws (426 kutamiz)
 *   3) QAYTA KIRISH: logout → login → /me (normal yo'l)
 *   4) IKKI DOMEN: A(50gram.uz) kirdi → B(workers.dev) kirdi → A tirikmi? (v124 va'dasi)
 *   5) PANEL: yangi ro'yxatdan o'tishlar (bugun) — ro'yxatdan o'tish umuman ishlayaptimi?
 *   6) JURNAL: so'nggi yozuvlar
 * Ishga tushirish: faqat GitHub Actions'dan (sandbox IP firewall'da). */
const BASE_A = 'https://50gram.uz'
const BASE_B = 'https://50gram.begzodbegzodjons.workers.dev'
const PHONE = process.env.DIAG_PHONE || '998900000005'
const ADMIN_PASS = process.env.ADMIN_PASS || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.106 Mobile Safari/537.36 50GramApp/3.1'
const DEV = 'diagtask71' + Date.now().toString(36).slice(-6)

let step = 0
const tag = () => '[' + ++step + ']'
function st(r) { return r.status + (r.status === 200 ? ' OK' : r.status === 426 ? ' (WS-darvoza OK)' : ' <<<< MUAMMO?') }

async function req(base, path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { 'user-agent': UA, 'x-dev': DEV, ...(opt.headers || {}) }
      const res = await fetch(base + path, { ...opt, headers })
      let j = null
      try { j = await res.json() } catch {}
      return { status: res.status, j, res }
    } catch (e) { last = e }
    if (i < tries - 1) { console.log('  tarmoq xato (' + last.message + ') — 25s, qayta'); await sleep(25000) }
  }
  throw last
}

async function getOtp(base, force) {
  const r = await req(base, '/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE, ...(force ? { force: 1 } : {}) }) })
  console.log(tag(), 'OTP', base === BASE_A ? 'A(50gram.uz)' : 'B(workers.dev)', force ? '(force)' : '', '→', st(r), r.j && r.j.dev_code ? ('kod=' + r.j.dev_code) : JSON.stringify(r.j || {}).slice(0, 120))
  if (!r.j || !r.j.dev_code) throw new Error('OTP dev_code yo\'q: ' + JSON.stringify(r.j).slice(0, 200))
  return r.j.dev_code
}
async function verify(base, code) {
  const r = await req(base, '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + PHONE, code }) })
  if (r.status !== 200 || !r.j.token) { console.log(tag(), 'VERIFY XATO →', r.status, JSON.stringify(r.j).slice(0, 200)); throw new Error('verify xato') }
  console.log(tag(), 'VERIFY OK uid=' + r.j.user.id, 'is_new=' + !!r.j.is_new)
  return r.j.token
}
async function get(base, path, token) {
  const r = await req(base, path, { headers: token ? { authorization: 'Bearer ' + token } : {} })
  console.log(tag(), 'GET', path.split('?')[0], '→', st(r), r.status !== 200 && r.j ? JSON.stringify(r.j).slice(0, 100) : '')
  return r
}

// 1) KESH/BUILD IKKALA DOMEN
for (const [nm, base] of [['A 50gram.uz', BASE_A], ['B workers.dev', BASE_B]]) {
  for (const f of ['/', '/core.js', '/sw.js']) {
    try {
      const r = await fetch(base + f, { headers: { 'user-agent': UA } })
      const t = f === '/' ? '' : await r.text()
      const v = f === '/' ? '' : (t.match(/50gram-v\d+|__50BUILD[^;]*|BUILD_V[^;]*/) || ['?'])[0]
      console.log(tag(), `KESH ${nm} ${f} → ${r.status} cc="${r.headers.get('cache-control')}" ${f === '/' ? '' : v.slice(0, 40)}`)
    } catch (e) { console.log(tag(), `KESH ${nm} ${f} XATO ${e.message}`) }
  }
}

// 2) A DOMEN: TO'LIQ LOGIN OQIMI (foydalanuvchi nima qilsa — o'sha)
let TA1 = await verify(BASE_A, await getOtp(BASE_A, true))
await get(BASE_A, '/api/me', TA1)
await get(BASE_A, '/api/chats', TA1)
await get(BASE_A, '/api/calls/pending', TA1)
await get(BASE_A, '/api/ws?token=' + encodeURIComponent(TA1), null)

// 3) QAYTA KIRISH (logout → login)
const lo = await req(BASE_A, '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TA1 }, body: '{}' })
console.log(tag(), 'LOGOUT →', st(lo))
await sleep(21000)
let TA2 = await verify(BASE_A, await getOtp(BASE_A, false))
await get(BASE_A, '/api/me', TA2)

// 4) B DOMENDA KIRISH (APK workers.dev) → keyin A tirikmi?
await sleep(21000)
let TB1 = await verify(BASE_B, await getOtp(BASE_B, false))
await get(BASE_B, '/api/me', TB1)
await get(BASE_B, '/api/calls/pending', TB1)
console.log(tag(), 'B kirdi — endi A (eski) tokeni tirikmi tekshiramiz (v124: tirik bo\'lishi KERAK)')
await get(BASE_A, '/api/me', TA2)

// 5) BO'SH TOKEN (vc12 zombi) — ochkosiz 401 kutamiz
const z = await req(BASE_A, '/api/calls/pending', { headers: { authorization: 'Bearer ' } })
console.log(tag(), 'ZOMBI bo\'sh token →', st(z), '(401 kutilgan)')

// 6) TOZALASH: logout hammasi (raqam band qolmasin)
for (const [nm, b, t] of [['A2', BASE_A, TA2], ['B1', BASE_B, TB1]]) {
  try { const r = await req(b, '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: '{}' }); console.log(tag(), `CLEAN logout ${nm} →`, st(r)) } catch (e) { console.log(tag(), `CLEAN logout ${nm} xato`, e.message) }
}

// 7) PANEL: yangi ro'yxatdan o'tishlar + firewall holati
if (ADMIN_PASS) {
  try {
    const pl = await req(BASE_A, '/api/panel/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: ADMIN_PASS }) })
    const pt = pl.j && (pl.j.token || pl.j.t)
    console.log(tag(), 'PANEL login →', st(pl))
    if (pt) {
      const us = await req(BASE_A, '/api/panel/users?page=1', { headers: { authorization: 'Bearer ' + pt } })
      const items = (us.j && us.j.items) || []
      const today = items.filter((u) => +(u.created_at || 0) > Date.now() - 86400000).length
      console.log(tag(), 'PANEL users:', (us.j && us.j.total) || items.length, 'umumiy | oxiri 24s-da yangi:', today)
      const sec = await req(BASE_A, '/api/panel/security', { headers: { authorization: 'Bearer ' + pt } })
      console.log(tag(), 'PANEL security →', st(sec), JSON.stringify(sec.j || {}).slice(0, 300))
    }
  } catch (e) { console.log(tag(), 'PANEL xato:', e.message) }
}
console.log('=== TASHXIS TUGADI ===')
