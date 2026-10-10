/* 50 GRAM — XAVFSIZLIK MUHRI E2E (v98): himoya qatlamlari har pushda QAYTA tekshiriladi
 * «hakker buzib kirolmasin» kafolati — qatlamlar jonli sinov:
 *   1) AUTH: yaroqsiz token → 401 (token o'g'irlash ishlamaydi)
 *   2) JSON CAP: 2MB+ JSON → 413 (v98 — CPU toshqini yo'q)
 *   3) OTP COOLDOWN: tez takroriy so'rovlar → 429 (SMS pumping taqiqlanadi — Eskiz pullik)
 *   4) AUTH BRUTE-FORCE: 12+ xato kod → IP 24 soat blok (DO global hisoblagich — DETERMINISTIK;
 *      eski izolyat-ichki otp-100-hisoblagichi CI'dan ishonchli sinolmaydi — izolyatlar tarqoq)
 *   5) TRAP: yadro/admin yo'llariga urinish → DARHOL 404 (30 kun blok)
 *   6) TRAPX: /api ostida fayl-kengaytma so'rovi → 404 (v98)
 *   7) INJ: in'ektsiya/traversal belgilari → 404
 *   8) EXT: begona mijoz (curl) → 404
 *   + BLOCK PROOF: bloklangan IP ODDIY "Not found" oladi (ma'lumot sizmaydi)
 *   + QUTQARUV: /api/fw/fix (DEV_PHONES egasi) blokni yechadi → tizim to'liq tiklanadi (2 MARTA)
 *   + MUHR: HSTS sarlavhasi + storage/stats maydonlari (v97 muhr saqlangan)
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_sec.mjs
 * DIQQAT: bu test o'z runner-IP'sini ATAYLAB bloklaydi (haqiqiy hujum simulyatsiyasi) va
 * oxirida fw/fix bilan OZOD qiladi — shu sababli boshqa E2E'lardan KEYIN ketma-ket yuguradi.
 */
import { readFileSync } from 'node:fs'
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// smoke (003/004), call (005/006), media (007/008), MUHR (009/010), data (011/012) — bu testniki:
// ADMIN = 004 (DEV_PHONES a'zosi — fw/fix huquqi), USER = 013/014, BRUTE = 016 (xato-kodlar)
const ADMIN = { phone: '998900000004', full: '+998900000004' }
const U1 = { phone: '998900000013', full: '+998900000013' }
const U2 = { phone: '998900000014', full: '+998900000014' }
const PUMP = { full: '+998900000015' }
const BRUTE = { full: '+998900000016' }

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
  const WANTV = process.env.E2E_BUILD_V || 'v' + (readFileSync(new URL('../worker/src/index.ts', import.meta.url), 'utf8').match(/BUILD_V = "v([^"]+)"/) || [])[1]
  let bv = null
  for (let i = 0; i < 36; i++) {
    const b = await j('/api/build').catch(() => null)
    if (b && b.st === 200 && b.d.v) { bv = b.d.v; if (bv === WANTV) break }
    await sleep(5000)
  }
  ok(bv === WANTV, 'deploy sinxron: server versiyasi ' + WANTV, 'aslida=' + bv)

  // 0.1) TIZIM TIRIK: health + HSTS (v98 muhr) + build ochiq yo'li
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

  // 4) OTP COOLDOWN MUHRI: tez takroriy so'rovlar → 429 (Eskiz pullik — pumping taqiqlanadi)
  console.log('  … OTP cooldown sinovi (30 tez so\'rov) …')
  let p429 = 0, p200 = 0
  for (let i = 0; i < 30; i++) {
    const r = await fetch(BASE + '/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ phone: PUMP.full }) })
    if (r.status === 429) p429++
    else if (r.status === 200) p200++
    await sleep(120)
  }
  ok(p200 >= 1, 'birinchi OTP so\'rovi OK', p200 + ' ta 200')
  ok(p429 >= 20, 'OTP cooldown qat\'iy (429 to\'siq)', p429 + ' ta 429')

  // 5) AUTH BRUTE-FORCE MUHRI (DO global — DETERMINISTIK): xato kodlar → IP 24 soat blok.
  //    Har kod-satrda 5 urinish chegarasi bor (tries>=5 → 429) — shu sababli kodni yangilab
  //    boramiz (20s cooldown). Jami 12 xato-kod = blok (fwLokal 12 YOKI DO att 12).
  console.log('  … AUTH brute-force sinovi (xato kodlar, ~60s) …')
  let bruteBlocked = false, wrongCnt = 0
  for (let cycle = 0; cycle < 6 && !bruteBlocked; cycle++) {
    if (cycle > 0) await sleep(21000) // kod cooldown (20s)
    const oc = await j('/api/auth/otp', { method: 'POST', body: { phone: BRUTE.full.replace('+', ''), force: 1 } }).catch(() => null)
    if (!oc || oc.st !== 200 || !oc.d.dev_code) continue
    for (let k = 0; k < 6; k++) {
      const w = await j('/api/auth/verify', { method: 'POST', body: { phone: BRUTE.full, code: '000000' } })
      wrongCnt++
      if (w.st === 404) { bruteBlocked = true; break }
      await sleep(300)
    }
  }
  ok(bruteBlocked, 'BRUTE-FORCE bloklandi (' + wrongCnt + ' xato kod → 404)', 'urinish=' + wrongCnt)

  // 6) QUTQARUV #1: fw/fix (firewall'dan OLDIN ishlaydi — bloklanganda ham!) IP'ni yechadi
  const fix1 = await j('/api/fw/fix', { method: 'POST', h: { authorization: 'Bearer ' + tokAdmin }, body: {} })
  ok(fix1.st === 200 && fix1.d.ok === true, 'fw/fix qutqaruv #1 ishladi', JSON.stringify(fix1.d).slice(0, 80))
  let rec1 = null
  for (let i = 0; i < 10; i++) { rec1 = await j('/api/health'); if (rec1.st === 200) break; await sleep(1000) }
  ok(rec1.st === 200, 'tiklanish #1: health yana 200', 'st=' + rec1.st)

  // 7) TRAP PROBLARI (bloklaydigan sinovlar — HAMMASI 404 bo'lishi SHART)
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

  // 8) BLOCK PROOF: IP endi bloklangan — hamma so'rov ODDIY "Not found" (ma'lumot sizmaydi)
  const blocked = await j('/api/health')
  ok(blocked.st === 404 && blocked.d.raw === 'Not found', 'BLOK ISBOTI: bloklangan IP oddiy 404 oladi', 'st=' + blocked.st)

  // 9) QUTQARUV #2 + TIKLANISH: blok yechilgach hammasi avvalgi holatiga qaytadi
  const fix2 = await j('/api/fw/fix', { method: 'POST', h: { authorization: 'Bearer ' + tokAdmin }, body: {} })
  ok(fix2.st === 200 && fix2.d.ok === true, 'fw/fix qutqaruv #2 ishladi', JSON.stringify(fix2.d).slice(0, 80))
  let rec2 = null
  for (let i = 0; i < 10; i++) { rec2 = await j('/api/health'); if (rec2.st === 200) break; await sleep(1000) }
  ok(rec2.st === 200, 'tiklanish #2: health yana 200', 'st=' + rec2.st)
  const u2 = await login(U2); tokU2 = u2.token
  const me2 = await j('/api/me', { h: { authorization: 'Bearer ' + tokU2 } })
  ok(me2.st === 200, 'tiklanish: yangi kirish ishlaydi', 'st=' + me2.st)

  // 10) v97 MUHR SAQLANGAN: storage/stats maydonlari joyinda
  const st = await j('/api/storage/stats', { h: { authorization: 'Bearer ' + tokAdmin } })
  const need = ['nodes', 'quota', 'used', 'files', 'healthy', 'r2_bytes', 'healing']
  ok(st.st === 200 && need.every((k) => k in st.d), 'storage/stats v97 muhri saqlangan', JSON.stringify(st.d).slice(0, 120))
} catch (e) {
  fails++
  console.log('  ✗ FAIL istisno:', String(e && e.message || e).slice(0, 200))
} finally {
  // MUHIM: har holda IP'ni ozod qil (keyingi testlar yo'lda qolmasin)
  if (tokAdmin) try { await j('/api/fw/fix', { method: 'POST', h: { authorization: 'Bearer ' + tokAdmin }, body: {} }) } catch {}
  await logout(tokAdmin); await logout(tokU1); await logout(tokU2)
}
console.log(fails === 0 ? '== XAVFSIZLIK E2E: PASS ==' : '== XAVFSIZLIK E2E: ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
