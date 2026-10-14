/* v127 «PANEL FAQAT EGASI + AVTOMATIK BOSHQARUV» JONLI TASHXIS
 * Ishga tushirish: E2E_BASE=https://50gram.uz node scripts/panel127_diag.mjs
 * Tekshiruvlar:
 *   1) eski login {pass} → token (egasi, o'zgarmagan — CI E2E mosligi)
 *   2) /panel/me — egasi=true, perms=[*]
 *   3) BOSHQA ADMIN QO'SHISH → 403 (v127: butunlay o'chirilgan) — ASOSIY ISBOT
 *   4) BOSHQA ADMIN LOGINI → 401 (faqat egasi kiradi; brute-posbon 1 urinish — xavfsiz)
 *   5) /panel/dash → 200 (panel to'liq sog'lom)
 *   6) /panel/admins → 200 (egasi ko'rishi)
 *   7) /api/build → v127
 */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  return { st: r.status, d }
}

console.log('— 1) EGASI LOGIN ({pass} — o\'zgarmagan)')
const login = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
ok(login.st === 200 && login.d.token, 'login 200 + token')
ok(login.d.rl === 'egasi' && login.d.un === 'egasi', 'egasi rol+nom qaytadi', JSON.stringify({ rl: login.d.rl, un: login.d.un }))
const H = { authorization: 'Bearer ' + login.d.token }

console.log('— 2) /panel/me (egasi)')
const me = await j('/api/panel/me', { h: H })
ok(me.st === 200 && me.d.egasi === true && me.d.un === 'egasi', 'me: egasi=true')
ok(Array.isArray(me.d.perms) && me.d.perms.includes('*'), 'perms: [*]')

console.log('— 3) BOSHQA ADMIN QO\'SHISH → 403 (v127 ASOSIY ISBOT)')
const add = await j('/api/panel/admins/add', { method: 'POST', h: H, body: { u: 'haker_test_v127', p: 'parol12345', role: 'moderator' } })
ok(add.st === 403, 'admins/add 403 (butunlay o\'chirilgan)', 'HTTP ' + add.st)
ok(String(add.d.error || '').includes('v127'), 'v127 xabari qaytadi', JSON.stringify(add.d).slice(0, 100))

console.log('— 4) BOSHQA ADMIN LOGINI → 401 (faqat egasi)')
const bad = await j('/api/panel/login', { method: 'POST', body: { u: 'nomaqlum_admin', p: 'xato_parol_123' } })
ok(bad.st === 401, 'begona admin logini 401', 'HTTP ' + bad.st)

console.log('— 5) /panel/dash (panel sog\'lom)')
const dash = await j('/api/panel/dash', { h: H })
ok(dash.st === 200 && dash.d.total !== undefined, 'dash 200 + total', 'total=' + dash.d.total)

console.log('— 6) /panel/admins (egasi ko\'radi, faqat egasi satri)')
const adm = await j('/api/panel/admins', { h: H })
ok(adm.st === 200 && Array.isArray(adm.d.items), 'admins 200 + ro\'yxat')
ok(adm.st === 200 && adm.d.items.every((x) => x.role === 'egasi' || x.off === true), 'faol emas — BARCHA satrlar egasi (boshqa admin qolmagan)')

console.log('— 7) /api/build (versiya)')
const bld = await j('/api/build')
ok(bld.st === 200 && bld.d.v === 'v127', 'jonli versiya v127', JSON.stringify(bld.d))

console.log(fails === 0 ? '\nJAMI: HAMMASI YASHIL ✓ (v127 jonli: panel faqat egasi)' : '\nJAMI: ' + fails + ' MUVAFFAQIYATSIZ ✗')
process.exit(fails === 0 ? 0 : 1)
