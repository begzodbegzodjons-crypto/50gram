/* 50 GRAM — MAXFIY ADMIN PANEL E2E (v104 → v105 kengaytirilgan): 50gram.uz/?adminpanel paneldagi API qatlami
 * Jonli sinov (CI runner IP'sidan — sandbox IP firewall-bloklangani uchun lokal sinov mumkin emas):
 *   1) STATIK: /?adminpanel → panel HTML (id="pw" + noindex); / → ODDIY ilova (panel IZI YO'Q)
 *   2) PAROL: xato parol → 401; to'g'ri parol (ADMIN_PASS) → adm-token
 *   3) TOKEN: adm-token'siz /panel/stats → 401 (begona kirib ololmaydi)
 *   4) STATISTIKA: total/blocked/today/online/countries maydonlari
 *   5) FOYDALANUVCHILAR: ro'yxat + qidiruv (yangi test foydalanuvchi topiladi)
 *   6) BLOK: paneldan bloklash → foydalanuvchining /api/me 401 (SESSIYA-DARVOZA ISBOTI),
 *      qayta kod so'rash → 403 "bloklangan" (KIRISH-BLOK ISBOTI)
 *   7) BLOKDAN CHIQARISH: /api/me yana 200 — foydalanuvchi tiklandi
 *   8) BROADCAST: validatsiya (bo'sh → 400)
 *   9) v105 FOYDALANUVCHI OYNASI: /panel/user — profil+davlat+statistika; yomon id → 404; tokensiz → 401
 *  10) v105 ALOHIDA XABAR: /panel/dm — bo'sh → 400, yo'q → 404, bloklanganga → 400,
 *      JONLI YUBORISH FAQAT O'Z TEST HISOBIGA (real foydalanuvchilarga TEGMAYDI)
 *  11) v105 XAVFSIZLIK: /panel/security — statistika + taqsimotlar + 2-qadamdagi xato-parol
 *      urinishi jurnalga tushgani (IP+davlat+tur) — SIGNALIZATSIYA JURNALI jonli dalil
 *  BROADCAST jonli yuborish SINALMAYDI (haqiqiy foydalanuvchilarga xabar ketmasin).
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_panel.mjs
 */
import { readFileSync } from 'node:fs'
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const T = { phone: '998900000090', full: '+998900000090' } // panel-test foydalanuvchisi (013-016 band — boshqalar tegilmaydi)

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  return { st: r.status, d, h: r.headers }
}

console.log('== ADMIN PANEL E2E boshlandi:', BASE, '==')
try {
  // 0) DEPLOY-SINXRON: /api/build kutilgan versiyani qaytarguncha kutish (max 3 min)
  const WANTV = 'v' + (readFileSync(new URL('../worker/src/index.ts', import.meta.url), 'utf8').match(/BUILD_V = "v([^"]+)"/) || [])[1]
  let bv = null
  for (let i = 0; i < 36; i++) {
    const b = await j('/api/build').catch(() => null)
    if (b && b.st === 200 && b.d.v) { bv = b.d.v; if (bv === WANTV) break }
    await sleep(5000)
  }
  ok(bv === WANTV, 'deploy sinxron: server versiyasi ' + WANTV, 'aslida=' + bv)

  // 1) STATIK SAHIFALAR
  const pr = await fetch(BASE + '/?adminpanel', { headers: { 'user-agent': UA } })
  const ptxt = await pr.text()
  ok(pr.status === 200 && ptxt.includes('id="pw"'), '/?adminpanel → panel HTML beriladi')
  ok((pr.headers.get('x-robots-tag') || '').includes('noindex'), 'panel noindex (qidiruvchilarga yopiq)')
  ok(!ptxt.includes('window.__50BUILD'), 'panel sahifasi ilova kodi EMAS (alohida sahifa)')
  const home = await fetch(BASE + '/', { headers: { 'user-agent': UA } })
  const htxt = await home.text()
  ok(home.status === 200 && !htxt.includes('id="pw"') && !htxt.toLowerCase().includes('adminpanel'), '/ → oddiy ilova, panel izi YO\'Q')

  // 2) PAROL NAZORATI
  const bad = await j('/api/panel/login', { method: 'POST', body: { pass: 'notogri-parol-' + Date.now() } })
  ok(bad.st === 401, 'xato parol → 401', 'st=' + bad.st)
  const anon = await j('/api/panel/stats')
  ok(anon.st === 401, 'tokensiz /panel/stats → 401', 'st=' + anon.st)
  const good = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
  ok(good.st === 200 && !!good.d.token, 'to\'g\'ri parol → adm-token')
  const AT = { authorization: 'Bearer ' + (good.d.token || '') }

  // 3) STATISTIKA
  const st1 = await j('/api/panel/stats', { h: AT })
  ok(st1.st === 200 && typeof st1.d.total === 'number' && Array.isArray(st1.d.countries), 'statistika maydonlari (total/countries)', JSON.stringify(st1.d).slice(0, 120))
  ok(st1.d.total >= 1, 'jami foydalanuvchi >= 1', 'total=' + st1.d.total)

  // 4) TEST FOYDALANUVCHI — ro'yxatdan o'tkazish (blok-sinovi uchun)
  const o = await j('/api/auth/otp', { method: 'POST', body: { phone: T.phone, force: 1 } })
  if (o.st !== 200 || !o.d.dev_code) throw new Error('test-user otp ' + o.st)
  const v = await j('/api/auth/verify', { method: 'POST', body: { phone: T.full, code: o.d.dev_code } })
  if (v.st !== 200 || !v.d.token) throw new Error('test-user verify ' + v.st)
  const tokT = v.d.token, uidT = v.d.user.id
  ok(!!uidT, 'test foydalanuvchi tayyor', 'uid=' + uidT)

  // 5) RO'YXAT + QIDIRUV
  const ul = await j('/api/panel/users?page=1', { h: AT })
  ok(ul.st === 200 && Array.isArray(ul.d.users) && ul.d.total >= 1, 'foydalanuvchilar ro\'yxati', 'total=' + ul.d.total)
  const uq = await j('/api/panel/users?page=1&q=' + T.phone, { h: AT })
  const found = (uq.d.users || []).find((x) => x.id === uidT)
  ok(!!found && found.phone === T.full, 'qidiruv test foydalanuvchini topadi', found ? 'cc=' + found.cc : 'topilmadi')
  ok(found && found.cc === 'UZ', 'davlat aniqlandi: UZ (+998)')

  // 6) BLOKLASH → darhol kuchga kiradi
  const bl = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 1 } })
  ok(bl.st === 200 && bl.d.ok, 'paneldan bloklash buyrug\'i')
  const meB = await j('/api/me', { h: { authorization: 'Bearer ' + tokT } })
  ok(meB.st === 401, 'bloklangan foydalanuvchi /api/me → 401 (SESSIYA-DARVOZA)', 'st=' + meB.st)
  const reOtp = await j('/api/auth/otp', { method: 'POST', body: { phone: T.phone, force: 1 } })
  ok(reOtp.st === 403, 'bloklangan raqam kod ola olmaydi → 403 (KIRISH-BLOK)', 'st=' + reOtp.st + ' msg=' + (reOtp.d.error || '').slice(0, 40))

  // 7) BLOKDAN CHIQARISH → to'liq tiklanish
  const ub = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 0 } })
  ok(ub.st === 200 && ub.d.ok, 'paneldan blokdan chiqarish')
  const meU = await j('/api/me', { h: { authorization: 'Bearer ' + tokT } })
  ok(meU.st === 200, 'tiklangan foydalanuvchi /api/me → 200', 'st=' + meU.st)

  // 8) BROADCAST: jonli yuborish SINALMAYDI (haqiqiy foydalanuvchilarga yuborilmasin).
  //    Faqat validatsiya tekshiriladi: bo'sh matn → 400.
  const b0 = await j('/api/panel/broadcast', { method: 'POST', h: AT, body: { body: '' } })
  ok(b0.st === 400, 'broadcast bo\'sh matn → 400 (validatsiya jonli)', 'st=' + b0.st)
  console.log('  ℹ BROADCAST jonli yuborish ataylab sinalmagan (haqiqiy foydalanuvchilarga xabar ketmasin) — SQL konstruktsiyasi lokal simulyatsiyada tekshirilgan')

  // 9) v105 FOYDALANUVCHI MA'LUMOT OYNASI: /panel/user?id=
  const ud = await j('/api/panel/user?id=' + uidT, { h: AT })
  ok(ud.st === 200 && ud.d.phone === T.full && ud.d.cc === 'UZ', 'v105 foydalanuvchi ma\'lumot oynasi (profil+davlat)', 'st=' + ud.st)
  ok(ud.st === 200 && typeof ud.d.messages === 'number' && typeof ud.d.files === 'number', 'v105 foydalanuvchi statistikasi (xabar/fayl hisobi)')
  const udBad = await j('/api/panel/user?id=1', { h: AT })
  ok(udBad.st === 404, 'v105 mavjud bo\'lmagan foydalanuvchi → 404', 'st=' + udBad.st)
  const udAnon = await j('/api/panel/user?id=' + uidT)
  ok(udAnon.st === 401, 'v105 tokensiz /panel/user → 401', 'st=' + udAnon.st)

  // 10) v105 ALOHIDA XABAR: validatsiyalar + TEST HISOBIGA JONLI YUBORISH (faqat o'z test foydalanuvchimizga — real foydalanuvchilarga TEGMAYDI)
  const dm0 = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: '' } })
  ok(dm0.st === 400, 'v105 dm bo\'sh matn → 400', 'st=' + dm0.st)
  const dmBad = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: 1, body: 'test' } })
  ok(dmBad.st === 404, 'v105 dm mavjud bo\'lmagan foydalanuvchi → 404', 'st=' + dmBad.st)
  const blD = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 1 } })
  ok(blD.st === 200, 'v105 dm-sinov uchun qayta bloklash')
  const dmBl = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: 'blok-sinov' } })
  ok(dmBl.st === 400, 'v105 bloklangan foydalanuvchiga dm → 400', 'st=' + dmBl.st + ' msg=' + (dmBl.d.error || '').slice(0, 40))
  await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 0 } })
  const dmOk = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: 'v105 panel dm jonli sinov xabari' } })
  ok(dmOk.st === 200 && dmOk.d.ok && dmOk.d.chat_id, 'v105 ALOHIDA XABAR JONLI YUBORILDI («50gram admin» nomidan, test hisobiga)', 'st=' + dmOk.st)

  // 11) v105 XAVFSIZLIK BO'LIMI: /panel/security (2-qadamdagi xato-parol urinishi sec_events'ga yozilgan bo'lishi kerak)
  const secAnon = await j('/api/panel/security')
  ok(secAnon.st === 401, 'v105 tokensiz /panel/security → 401', 'st=' + secAnon.st)
  await sleep(2500) // waitUntil'dagi secYoz yozuvi yerga tushsin
  const sec = await j('/api/panel/security', { h: AT })
  ok(sec.st === 200 && typeof sec.d.e24 === 'number' && typeof sec.d.eall === 'number' && typeof sec.d.uip === 'number', 'v105 xavfsizlik statistikasi (e24/eall/uip)', 'st=' + sec.st + ' j=' + JSON.stringify(sec.d).slice(0, 100))
  ok(Array.isArray(sec.d.kinds) && Array.isArray(sec.d.ccs) && Array.isArray(sec.d.paths) && Array.isArray(sec.d.recent) && Array.isArray(sec.d.alarms) && Array.isArray(sec.d.blocksTop), 'v105 xavfsizlik taqsimotlari (kinds/ccs/paths/recent/alarms/blocksTop)')
  ok(typeof sec.d.blocks === 'number', 'v105 blokda turgan IP soni (SEC DO\'dan)', 'blocks=' + sec.d.blocks)
  const authEv = (sec.d.recent || []).find((x) => x.kind === 'auth' && x.ip)
  ok(!!authEv, 'v105 PANELGA HUJUM QAYD ETILGAN (2-qadamdagi xato-parol urinishi jurnalda)', authEv ? 'ip=' + authEv.ip + ' cc=' + authEv.cc + ' act=' + authEv.act : 'topilmadi')
  console.log('  ℹ v105 xavfsizlik: ' + (sec.d.eall || 0) + ' jami urinish, ' + (sec.d.e24 || 0) + ' (24soat), ' + (sec.d.uip || 0) + ' noyob IP, ' + (sec.d.blocks || 0) + ' blokda')

  // 12) YOPILISH: test foydalanuvchisini logout (iz qolmasin)
  try { await j('/api/auth/logout', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: {} }) } catch {}
} catch (e) {
  fails++
  console.log('  ✗ FAIL istisno:', String(e && e.message || e))
}
console.log(fails === 0 ? '== ADMIN PANEL E2E: HAMMASI YASHIL ==' : '== ADMIN PANEL E2E: ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
