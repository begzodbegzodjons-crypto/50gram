/* 50 GRAM — XAVFSIZLIK MUHRI E2E (v98): himoya qatlamlari har pushda QAYTA tekshiriladi
 * «hakker buzib kirolmasin» kafolati — 7 qatlam jonli sinov:
 *   1) TRAP: yadro/admin yo'llariga urinish → DARHOL 404 (30 kun blok)
 *   2) TRAPX: /api ostida fayl-kengaytma so'rovi → 404 (v98)
 *   3) INJ: in'ektsiya/traversal belgilari → 404
 *   4) EXT: begona mijoz (curl) → 404
 *   5) AUTH: yaroqsiz token → 401 (token o'g'irlash ishlamaydi)
 *   6) JSON CAP: 2MB+ JSON → 413 (v98 — CPU toshqini yo'q)
 *   7) OTP PUMP: 100+/soat → 404 (SMS pumping taqiqlangan — Eskiz pullik, himoya qat'iy)
 *   + BLOCK PROOF: bloklangan IP ODDIY "Not found" oladi (ma'lumot sizmaydi)
 *   + QUTQARUV: /api/fw/fix (DEV_PHONES egasi) blokni yechadi → tizim to'liq tiklanadi
 *   + MUHR: HSTS sarlavhasi + storage/stats maydonlari (v97 muhr saqlangan)
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_sec.mjs
 * DIQQAT: bu test o'z runner-IP'sini ATAYLAB bloklaydi (haqiqiy hujum simulyatsiyasi) va
 * oxirida fw/fix bilan OZOD qiladi — shu sababli boshqa E2E'lardan KEYIN ketma-ket yuguradi.
 */
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// smoke (003/004), call (005/006), media (007/008), MUHR (009/010), data (011/012) — bu testniki:
// ADMIN = 004 (DEV_PHONES a'zosi — fw/fix huquqi), USER = 013/014, PUMP = 015 (faqat OTP)
const ADMIN = { phone: '998900000004', full: '+998900000004' }
const U1 = { phone: '998900000013', full: '+998900000013' }
const U2 = { phone: '998900000014', full: '+998900000014' }
const PUMP = { full: '+998900000015' }

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t.slice(0, 60) } }
  return { st: r.status, d, h: r.headers }
}
const login = async (p) => {
  const o = await j('/api/auth/otp', { method: 'POST', body: { phone: p.phone, force: 1 } })
  if (o.st !== 200 || !o.d.dev_code) throw new Error('otp ' + o.st + ' ' + JSON.stringify(o.d).slice(0, 80))
  const v = await j('/api/auth/verify', { method: 'POST', body: { phone: p.full, code: o.d.dev_code } })
  if (v.st !== 200 || !v.d.token) throw new Error('verify ' + v.st)
  return { token: v.d.token, uid: v.d.user.id }
}
const logout = async (token) => { if (token) try { await j('/api/auth/logout', { method: 'POST', h: { authorization: 'Bearer ' + token }, body: {} }) } catch {} }

console.log('== XAVFSIZLIK E2E boshlandi:', BASE, '==')
let tokAdmin = null, tokU1 = null, tokU2 = null
try {
  // 0) DEPLOY-SINXRON: push-trigger'da deploy tugamasdan test boshlanmasin — /api/build
  //    kutilgan versiyani qaytarguncha kutish (max 3 min). Bu test v98 xususiyatlarini sinaydi.
  const WANTV = process.env.E2E_BUILD_V || 'v98'
  let bv = null
  for (let i = 0; i < 36; i++) {
    const b = await j('/api/build').catch(() => null)
    if (b && b.st === 200 && b.d.v) { bv = b.d.v; if (bv === WANTV) break }
    await sleep(5000)
  }
  ok(bv === WANTV, 'deploy sinxron: server versiyasi ' + WANTV, 'aslida=' + bv)

  // 0.1) TIZIM TIRIK: health + build + HSTS (v98 muhr)
  const hp = await j('/api/health')
  ok(hp.st === 200 && hp.d.ok, 'health tirik (boshlanish)', 'st=' + hp.st)
  ok(!!hp.h.get('strict-transport-security'), 'HSTS sarlavhasi bor (v98 muhr)', String(hp.h.get('strict-transport-security')))
  const bp = await j('/api/build')
  ok(bp.st === 200 && bp.d.v, 'build ochiq yo\'l (trap bilan to\'qnashmaydi)', JSON.stringify(bp.d))

  // 1) KIRISH: admin (DEV_PHONES — fw/fix huquqli) + oddiy foydalanuvchi
  const a = await login(ADMIN); tokAdmin = a.token
  const u1 = await login(U1); tokU1 = u1.token
  const me = await j('/api/me', { h: { authorization: 'Bearer ' + tokU1 } })
  ok(me.st === 200 && me.d.id === u1.uid, 'oddiy foydalanuvchi /api/me ishlaydi', 'st=' + me.st)

  // 2) AUTH MUHRI: yaroqsiz token — 401, hech qanday ma'lumot yo'q
  const bt = await j('/api/me', { h: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fake_sig' } })
  ok(bt.st === 401, 'yaloqachi token rad etildi (401)', 'st=' + bt.st)

  // 3) JSON CAP: 2MB+ JSON tana → 413 (CPU toshqini bloklangan — v98)
  const big = 'x'.repeat(3 * 1024 * 1024)
  const bigR = await fetch(BASE + '/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ phone: ADMIN.phone, junk: big }) })
  ok(bigR.status === 413, '3MB JSON — 413 (JSON chegarasi)', 'st=' + bigR.status)

  // 4) OTP PUMP: 100+/soat → 404 (SMS pumping taqiqlanadi — Eskiz pullik, himoya QAT'IY)
  //    Toshqin-qo'riqchiga (80/10s) tushmaslik uchun: 20talik paketlar + 10.5s tanaffus
  console.log('  … OTP pump sinovi (101 so\'rov, ~75s) …')
  let pump404 = 0, pump429 = 0, pumpLast = 0
  for (let i = 0; i < 101; i++) {
    if (i > 0 && i % 20 === 0) await sleep(10500)
    const r = await fetch(BASE + '/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ phone: PUMP.full }) })
    pumpLast = r.status
    if (r.status === 404) pump404++
    else if (r.status === 429) pump429++
  }
  ok(pump429 > 0, 'OTP cooldown ishlaydi (429 ketma-ket)', pump429 + ' ta 429')
  ok(pump404 > 0 && pumpLast === 404, 'OTP pump chegarasi — 404 (pumping to\'sildi)', pump404 + ' ta 404, oxirgi=' + pumpLast)

  // 5) TRAP PROBLARI (bloklaydigan sinovlar — HAMMASI 404 bo'lishi SHART)
  const t1 = await j('/api/adm/panel')
  ok(t1.st === 404, 'TRAP: /api/adm/panel → 404', 'st=' + t1.st)
  const t2 = await j('/api/.env')
  ok(t2.st === 404, 'TRAP: /api/.env → 404', 'st=' + t2.st)
  const t3 = await j('/api/phpmyadmin/index.php')
  ok(t3.st === 404, 'TRAP: /api/phpmyadmin → 404', 'st=' + t3.st)
  const t4 = await j('/api/nonexistent_probe_file.log')
  ok(t4.st === 404, 'TRAPX: /api/xxx.log (kengaytma) → 404 (v98)', 'st=' + t4.st)
  const t5 = await j('/api/media/abc?file=../../etc/passwd')
  ok(t5.st === 404, 'INJ: traversal query → 404', 'st=' + t5.st)
  const t6 = await j('/api/media/%2e%2e%2f%2e%2e%2fsecret')
  ok(t6.st === 404, 'INJ: encoded traversal → 404', 'st=' + t6.st)
  const t7 = await fetch(BASE + '/api/health', { headers: { 'user-agent': 'curl/8.5.0' } })
  ok(t7.status === 404, 'EXT: curl mijoz → 404 (begona dastur)', 'st=' + t7.status)

  // 6) BLOCK PROOF: IP endi bloklangan — hamma so'rov ODDIY "Not found" (ma'lumot sizmaydi)
  const blocked = await j('/api/health')
  ok(blocked.st === 404 && blocked.d.raw === 'Not found', 'BLOK ISBOTI: bloklangan IP oddiy 404 oladi', 'st=' + blocked.st)

  // 7) QUTQARUV: fw/fix (firewall'dan OLDIN ishlaydi — bloklanganda ham!) o'z IP'ni yechadi
  const fix = await j('/api/fw/fix', { method: 'POST', h: { authorization: 'Bearer ' + tokAdmin }, body: {} })
  ok(fix.st === 200 && fix.d.ok === true, 'fw/fix qutqaruv ishladi (ega o\'zini ozod qildi)', JSON.stringify(fix.d).slice(0, 80))

  // 8) TIKLANISH: blok yechilgach hammasi avvalgi holatiga qaytadi
  let rec = null
  for (let i = 0; i < 10; i++) { rec = await j('/api/health'); if (rec.st === 200) break; await sleep(1000) }
  ok(rec.st === 200, 'tiklanish: health yana 200', 'st=' + rec.st)
  const u2 = await login(U2); tokU2 = u2.token
  const me2 = await j('/api/me', { h: { authorization: 'Bearer ' + tokU2 } })
  ok(me2.st === 200, 'tiklanish: yangi kirish ishlaydi', 'st=' + me2.st)

  // 9) v97 MUHR SAQLANGAN: storage/stats maydonlari joyinda
  const st = await j('/api/storage/stats', { h: { authorization: 'Bearer ' + tokAdmin } })
  const need = ['nodes', 'quota', 'used', 'files', 'healthy', 'r2_bytes', 'healing']
  ok(st.st === 200 && need.every((k) => k in st.d), 'storage/stats v97 muhri saqlangan', JSON.stringify(st.d).slice(0, 120))
} catch (e) {
  fails++
  console.log('  ✗ FAIL istisno:', String(e && e.message || e).slice(0, 200))
} finally {
  await logout(tokAdmin); await logout(tokU1); await logout(tokU2)
}
console.log(fails === 0 ? '== XAVFSIZLIK E2E: PASS ==' : '== XAVFSIZLIK E2E: ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
