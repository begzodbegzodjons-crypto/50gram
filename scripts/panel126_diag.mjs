/* v126 «BOSHQARUV MARKAZI» JONLI TASHXIS — yangi admin-panel endpointlari isboti
 * Ishga tushirish: E2E_BASE=https://50gram.uz node scripts/panel126_diag.mjs
 * Tekshiruvlar:
 *   1) eski login {pass} → token (backward-compat, CI E2E mosligi)
 *   2) /panel/me — rol+perms (egasi)
 *   3) /panel/dash — DAU/WAU/MAU + yangi maydonlar
 *   4) /panel/mfa — holat; setup → TOTP kodni O'ZI hisoblaydi → mfa/on → MFA bilan login → mfa/off (TO'LIQ DAVRA)
 *   5) /panel/admins — CRUD: test-admin qo'shish (PBKDF2) → ro'yxatda ko'rinadi → o'chirish
 *   6) /panel/settings — GET + idempotent yozuv (max_msg_len 4096→4096, xulqi o'zgarmaydi)
 *   7) /panel/reports, /panel/tickets, /panel/media, /panel/payments, /panel/analitika, /panel/gklog — 200 + struktura
 *   8) /report — foydalanuvchi shikoyati (auth bilan) + panelda ko'rinadi + yechildi
 *   9) audit: /panel/log — v126 amallari aktor bilan yozilgani
 * Barcha yozuvlar TEST obyektlariga (test-admin o'zi o'chiriladi, shikoyat yechildi holatga o'tadi).
 */
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const U = { phone: '998900000090', full: '+998900000090' } // test foydalanuvchi (e2e_panel bilan bir xil)

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  return { st: r.status, d }
}
// TOTP (RFC 6238) — script o'zi hisoblaydi (Google Authenticator o'rniga)
function totpNow(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, val = 0, bytes = []
  for (const ch of secret) { const i = A.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8 } }
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(Date.now() / 30000), 4)
  const h = createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const off = h[19] & 15
  return String((((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 1000000).padStart(6, '0')
}

console.log('— 1) ESKI LOGIN MOSLIGI ({pass} → egasi token)')
const login = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
ok(login.st === 200 && login.d.token, 'login 200 + token')
ok(login.d.rl === 'egasi' && login.d.un === 'egasi', 'egasi rol+nom qaytadi', JSON.stringify({ rl: login.d.rl }))
const H = { authorization: 'Bearer ' + login.d.token }

console.log('— 2) /panel/me (rol-gating manbasi)')
const me = await j('/api/panel/me', { h: H })
ok(me.st === 200 && me.d.egasi === true && me.d.un === 'egasi', 'me: egasi=true')
ok(Array.isArray(me.d.perms) && me.d.perms.includes('*'), 'perms: [*]')

console.log('— 3) /panel/dash (kengaytirilgan shturval)')
const dash = await j('/api/panel/dash', { h: H })
ok(dash.st === 200 && dash.d.total !== undefined, 'dash 200 + total', 'total=' + dash.d.total)
ok(dash.d.active30 !== undefined && dash.d.msgsToday !== undefined && dash.d.reportsOpen !== undefined, 'DAU/MAU + shikoyat hisobi bor')
ok(dash.d.sys && dash.d.sys.reg === true && dash.d.sys.tex === false, 'tizim holati: ochiq rejim, tex-xizmat o\'chiq')

console.log('— 4) MFA TO\'LIQ DAVRA (setup → kod hisoblash → on → login → off)')
const mfa0 = await j('/api/panel/mfa', { h: H })
ok(mfa0.st === 200 && mfa0.d.on === false, 'mfa: boshlang\'ich holat o\'chiq')
const setup = await j('/api/panel/mfa/setup', { method: 'POST', body: {}, h: H })
ok(setup.st === 200 && /^[A-Z2-7]{32}$/.test(setup.d.secret || ''), 'setup: 32-belgili base32 kalit')
const code1 = totpNow(setup.d.secret)
const mfaon = await j('/api/panel/mfa/on', { method: 'POST', body: { t: code1 }, h: H })
ok(mfaon.st === 200 && mfaon.d.ok === true, 'mfa/on: script-hisoblangan kod qabul qilindi')
const badcode = String((+code1 + 1) % 1000000).padStart(6, '0')
const loginNoT = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
ok(loginNoT.st === 401 && (loginNoT.d.error || '').includes('Bir martalik'), 'MFA yoniganda kod\'siz login 401')
const loginT = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS, t: totpNow(setup.d.secret) } })
ok(loginT.st === 200 && loginT.d.token, 'MFA bilan login 200 (kod to\'g\'ri)')
const H2 = { authorization: 'Bearer ' + loginT.d.token }
const mfaoff = await j('/api/panel/mfa/off', { method: 'POST', body: { p: PANEL_PASS }, h: H2 })
ok(mfaoff.st === 200 && mfaoff.d.ok === true, 'mfa/off: parol bilan o\'chirildi (tizim eski holatga qaytdi)')

console.log('— 5) ADMINLAR CRUD (PBKDF2 + audit)')
const add = await j('/api/panel/admins/add', { method: 'POST', body: { u: 'testmod126', p: 'SinovParol126', role: 'moderator', name: 'Tashxis Bot' }, h: H })
ok(add.st === 200 && add.d.ok === true, 'admin qo\'shildi (PBKDF2 hash)')
const aLogin = await j('/api/panel/login', { method: 'POST', body: { u: 'testmod126', p: 'SinovParol126' } })
ok(aLogin.st === 200 && aLogin.d.token && aLogin.d.rl === 'moderator', 'yangi admin login + moderator roli')
const aMe = await j('/api/panel/me', { h: { authorization: 'Bearer ' + aLogin.d.token } })
ok(aMe.st === 200 && !aMe.d.egasi && !aMe.d.perms.includes('*'), 'moderator: egasi emas, perm cheklangan')
const aDash = await j('/api/panel/dash', { h: { authorization: 'Bearer ' + aLogin.d.token } })
ok(aDash.st === 200, 'moderator dash ko\'radi (stat perm)')
const aAdmins = await j('/api/panel/admins', { h: { authorization: 'Bearer ' + aLogin.d.token } })
ok(aAdmins.st === 403, 'moderator ADMINLAR bo\'limini KO\'RAMAYDI (403 rol-devori)')
const list = await j('/api/panel/admins', { h: H })
ok(list.st === 200 && list.d.items.some((x) => x.un === 'testmod126'), 'egasi ro\'yxatda ko\'radi')
const del = await j('/api/panel/admins/del', { method: 'POST', body: { id: list.d.items.find((x) => x.un === 'testmod126').id }, h: H })
ok(del.st === 200 && del.d.ok === true, 'test-admin o\'chirildi')
const aLogin2 = await j('/api/panel/login', { method: 'POST', body: { u: 'testmod126', p: 'SinovParol126' } })
ok(aLogin2.st !== 200, 'o\'chirilgan admin kira olmaydi')

console.log('— 6) SOZLAMALAR (o\'qish + idempotent yozuv)')
const sz = await j('/api/panel/settings', { h: H })
ok(sz.st === 200 && sz.d.items.some((x) => x.k === 'registratsiya' && x.v === 'ochiq'), 'sozlamalar: registratsiya ochiq (default)')
const szSet = await j('/api/panel/settings', { method: 'POST', body: { k: 'max_msg_len', v: '4096' }, h: H })
ok(szSet.st === 200 && szSet.d.ok === true, 'sozlama yozuvi 200 (xulqi o\'zgarmagan: 4096→4096)')
const szBad = await j('/api/panel/settings', { method: 'POST', body: { k: 'tex_xizmat', v: '1' }, h: H })
ok(szBad.st === 400, 'tex-xizmat tasdiqsiz YOQILMAYDI (400 xavfli-amal posboni)')
const szNom = await j('/api/panel/settings', { method: 'POST', body: { k: 'yoq_kalit', v: '1' }, h: H })
ok(szNom.st === 400, 'noma\'lum kalit rad etiladi')

console.log('— 7) YANGI BO\'LIMLAR STRUKTURASI')
for (const [p, key] of [['reports', 'items'], ['tickets', 'items'], ['media', 'total'], ['payments', 'items'], ['analitika', 'growth'], ['gklog', 'items']]) {
  const r = await j('/api/panel/' + p, { h: H })
  ok(r.st === 200 && r.d[key] !== undefined, '/panel/' + p + ' 200 + ' + key)
}

console.log('— 8) FOYDALANUVCHI SHIKOYATI (/report) + PANelda ko\'rinadi')
// test foydalanuvchi tokeni (kod ilova ichida qaytadi — DEV_MODE)
const otp = await j('/api/auth/otp', { method: 'POST', body: { phone: U.full } })
let utok = ''
if (otp.st === 200 && otp.d.dev_code) {
  const ver = await j('/api/auth/verify', { method: 'POST', body: { phone: U.full, code: otp.d.dev_code } })
  utok = ver.d.token || ''
} else if (otp.st === 200) {
  // kod SMS_MODE=app rejimida dev_code'da qaytadi (DEV_PHONES raqam)
  const ver = await j('/api/auth/verify', { method: 'POST', body: { phone: U.full, code: otp.d.code || '000000' } })
  utok = ver.d.token || ''
}
ok(!!utok, 'test foydalanuvchi tokeni olindi')
if (utok) {
  const rep = await j('/api/report', { method: 'POST', h: { authorization: 'Bearer ' + utok }, body: { tt: 'user', tid: 990000000001, reason: 'spam', note: 'v126 tashxis shikoyati (o\'zi yechildi holatiga o\'tadi)' } })
  ok(rep.st === 200 && rep.d.ok === true, '/report qabul qilindi')
  const selfRep = await j('/api/report', { method: 'POST', h: { authorization: 'Bearer ' + utok }, body: { tt: 'user', tid: U.phone.slice(-9) === '900000090' ? 999999 : 0, reason: 'spam' } })
  ok(selfRep.st === 400, 'o\'ziga/noto\'g\'ri shikoyat rad (400)')
  const reps = await j('/api/panel/reports', { h: H })
  const mine = reps.d.items && reps.d.items.find((x) => x.note && x.note.includes('v126 tashxis'))
  ok(!!mine, 'shikoyat panelda ko\'rinadi', mine ? 'id=' + mine.id : '')
  if (mine) {
    const setr = await j('/api/panel/reports/set', { method: 'POST', body: { id: mine.id, status: 'yechildi', answer: 'tashxis yakuni' }, h: H })
    ok(setr.st === 200 && setr.d.ok, 'shikoyat holati yechildi')
  }
}

console.log('— 9) AUDIT: v126 amallari aktor bilan yozilgani')
const log = await j('/api/panel/log', { h: H })
const acts = (log.d.rows || []).map((r) => r.act)
ok(acts.includes('mfa_yoniq') && acts.includes('admin_qoshish') && acts.includes('sozlama'), 'audit: mfa_yoniq + admin_qoshish + sozlama yozuvlari')
const lastRow = (log.d.rows || [])[0] || {}
ok(!!lastRow.actor, 'aktor maydoni to\'ldirilgan', 'actor=' + lastRow.actor)

console.log(fails === 0 ? '\nJAMI: HAMMASI YASHIL ✓ — v126 boshqaruv markazi JONLI ishlaydi' : '\nJAMI: ' + fails + ' MUVAFFAQIYATSIZ ✗')
process.exit(fails === 0 ? 0 : 1)
