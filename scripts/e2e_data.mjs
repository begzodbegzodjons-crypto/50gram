/* 50 GRAM — DATA QUVURI E2E (v97 muhr): o'rgimchak to'ri + R2 + o'z-o'zini tiklash
 * Har pushda CI'da ishlaydi — «ma'lumot yo'qolmasin» kafolati QAYTA buzilmasin:
 *   1) FAYL DAVRASI: create → put(2 bo'lak, binary) → done(sha) → meta → bo'laklarni
 *      o'qib BAYT-BAYT solishtirish (R2 asosiy yo'l isbotlanadi)
 *   2) TO'R REGISTRY: /p2p/have (saved) → /p2p/peers (qurilma ro'yxati) → /storage/beat
 *      (qurilma tuguni yashaydi) — o'rgimchak to'ri yozuvlari tirik
 *   3) STATISTIKA: /storage/stats — nodes/quota/used/files/healthy/r2_bytes/healing
 *   4) TIKLASH MUHRI: gone=0 fayl uchun /media/:id/restore-info 404 bo'lishi SHART
 *      (tiklash yo'li faqat haqiqatan yo'qolgan faylga ochiq — xavfsizlik qulfi)
 *   5) XAVFSIZLIK: B foydalanuvchi A ning norasmiy fayliga bo'lak YOZA OLMASLIGI
 *      (egasi bo'lmagan PUT 404) — egasiz o'zgartirish yo'q
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_data.mjs
 */
import { randomBytes, createHash } from 'crypto'

const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// smoke (003/004), call (005/006), media (007/008), MUHR (009/010) — bu testniki 011/012
const A = { phone: '998900000011', full: '+998900000011' }
const B = { phone: '998900000012', full: '+998900000012' }

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  return { st: r.status, d }
}
const login = async (p) => {
  const o = await j('/api/auth/otp', { method: 'POST', body: { phone: p.phone, force: 1 } })
  if (o.st !== 200 || !o.d.dev_code) throw new Error('otp ' + o.st + ' ' + JSON.stringify(o.d).slice(0, 80))
  const v = await j('/api/auth/verify', { method: 'POST', body: { phone: p.full, code: o.d.dev_code } })
  if (v.st !== 200 || !v.d.token) throw new Error('verify ' + v.st)
  return { token: v.d.token, uid: v.d.user.id }
}
const logout = async (token) => { if (token) try { await j('/api/auth/logout', { method: 'POST', h: { authorization: 'Bearer ' + token }, body: {} }) } catch {} }

console.log('== DATA E2E boshlandi:', BASE, '==')
let tokA = null, tokB = null
try {
  const a = await login(A); tokA = a.token
  const b = await login(B); tokB = b.token
  ok(!!a.uid && !!b.uid, '2 akkaunt kirdi', a.uid + ' / ' + b.uid)
  const HA = { authorization: 'Bearer ' + tokA }
  const HB = { authorization: 'Bearer ' + tokB }

  // 1) TO'R TUGUNLARI: ikkala qurilma beat qiladi (nodes jadvaliga yoziladi)
  const beatA = await j('/api/storage/beat', { method: 'POST', h: HA, body: { quota: 1024 * 1024 * 1024, used: 0, accept: true } })
  ok(beatA.st === 200 && Array.isArray(beatA.d.jobs), 'storage/beat A (tugun tirik)', JSON.stringify(beatA.d).slice(0, 90))
  const beatB = await j('/api/storage/beat', { method: 'POST', h: HB, body: { quota: 1024 * 1024 * 1024, used: 0, accept: true } })
  ok(beatB.st === 200 && Array.isArray(beatB.d.drops), 'storage/beat B (tugun tirik)', JSON.stringify(beatB.d).slice(0, 90))

  // 2) FAYL DAVRASI: 2 bo'lakli tasodifiy fayl (1.4 MB — 2 chunki chegarasi ostida emas, 2 bo'lak)
  const part0 = randomBytes(700000), part1 = randomBytes(537)
  const whole = Buffer.concat([part0, part1])
  const sha = createHash('sha256').update(whole).digest('hex')
  const cr = await j('/api/media', { method: 'POST', h: HA, body: { mime: 'application/octet-stream', name: 'data-e2e.bin', size: whole.length, chunks: 2 } })
  ok(cr.st === 200 && cr.d.id, 'media create', JSON.stringify(cr.d).slice(0, 60))
  const FID = cr.d.id
  const p0 = await fetch(BASE + '/api/media/' + FID + '/0', { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'user-agent': UA, ...HA }, body: part0 })
  const p1 = await fetch(BASE + '/api/media/' + FID + '/1', { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'user-agent': UA, ...HA }, body: part1 })
  const j0 = await p0.json().catch(() => ({})), j1 = await p1.json().catch(() => ({}))
  ok(p0.status === 200 && j0.ok, 'bo\u2019lak 0 yozildi', JSON.stringify(j0))
  if (j0.r2 === true) console.log('  \u2139 R2 asosiy yo\u2019l faol (baytlar R2\u2019da)')
  else console.log('  \u2139 R2 binding yo\u2019q \u2014 D1-rejim (roundtrip baribir tekshiriladi)')
  ok(p1.status === 200 && j1.ok, 'bo\u2019lak 1 yozildi', JSON.stringify(j1))
  const dn = await j('/api/media/' + FID + '/done', { method: 'POST', h: HA, body: { sha } })
  ok(dn.st === 200 && dn.d.ok, 'media done (sha bilan)', JSON.stringify(dn.d))
  const meta = await j('/api/media/' + FID, { h: HA })
  ok(meta.st === 200 && meta.d.complete === 1 && meta.d.sha === sha, 'media meta (complete+sha)', JSON.stringify(meta.d))

  // O'QISH: bo'laklarni qaytib olib bayt-bayt solishtirish (R2 roundtrip)
  const r0 = await fetch(BASE + '/api/media/' + FID + '/0', { headers: { accept: 'application/octet-stream', 'user-agent': UA, ...HA } })
  const r1 = await fetch(BASE + '/api/media/' + FID + '/1', { headers: { accept: 'application/octet-stream', 'user-agent': UA, ...HA } })
  const b0 = Buffer.from(await r0.arrayBuffer()), b1 = Buffer.from(await r1.arrayBuffer())
  ok(r0.status === 200 && b0.equals(part0), 'roundtrip bo\u2019lak 0 (bayt-bayt)')
  ok(r1.status === 200 && b1.equals(part1), 'roundtrip bo\u2019lak 1 (bayt-bayt)')

  // 3) TO'R REGISTRY: A "menimda bor" deydi → B peers ro'yxatida ko'radi
  //    (chat kerak — avval direct chat ochamiz)
  const dc = await j('/api/chats/direct', { method: 'POST', h: HA, body: { user_id: b.uid } })
  ok(dc.st === 200 && dc.d.id, 'direct chat ochildi', JSON.stringify(dc.d).slice(0, 60))
  const CID = dc.d.id
  // XABAR: fayl chatga birikadi (media.chat_id + keep=1) — aynan real ilova oqimi
  const msg = await j('/api/chats/' + CID + '/messages', { method: 'POST', h: HA, body: { kind: 'file', meta: { media_id: FID, name: 'data-e2e.bin', fsize: whole.length, sha, mime: 'application/octet-stream' }, client_id: 'data-e2e-1' } })
  ok(msg.st === 200 && msg.d.id, 'fayl-xabar yuborildi (chatga birikdi)', JSON.stringify(msg.d).slice(0, 60))
  const hv = await j('/api/p2p/have', { method: 'POST', h: HA, body: { items: [{ m: FID, c: CID, p: 1, s: whole.length }] } })
  ok(hv.st === 200 && hv.d.ok && hv.d.saved === 1, 'p2p/have saved:1 (BATCH yo\u2019l)', JSON.stringify(hv.d))
  // server nusxasini "yo'qolgan" qilamizsiz — peers faqat peer_have bo'yicha: A ko'rinadi
  const pp = await j('/api/p2p/peers?chat=' + CID + '&media=' + FID, { h: HB })
  ok(pp.st === 200 && Array.isArray(pp.d.peers) && pp.d.peers.includes(a.uid), 'p2p/peers — B A\u2019ni ko\u2019radi', JSON.stringify(pp.d))

  // 4) TIKLASH MUHRI: sog'lom fayl uchun restore-info 404 (gone emas!)
  const ri = await j('/api/media/' + FID + '/restore-info', { h: HA })
  ok(ri.st === 404, 'restore-info sog\u2019lom faylga YOPIQ (404) — muhir', 'st=' + ri.st)

  // 5) XAVFSIZLIK: B — A fayliga (gone emas) bo'lak yoza olmaydi
  const evil = await fetch(BASE + '/api/media/' + FID + '/0', { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'user-agent': UA, ...HB }, body: randomBytes(16) })
  ok(evil.status === 404, 'begona faylga PUT taqiqlangan (404)', 'st=' + evil.status)

  // 6) STATISTIKA: maydonlar to'liq (v97: r2_bytes + healing QO'SHILDI)
  const st = await j('/api/storage/stats', { h: HA })
  const need = ['nodes', 'quota', 'used', 'files', 'healthy', 'r2_bytes', 'healing']
  ok(st.st === 200 && need.every((k) => k in st.d), 'storage/stats maydonlari', JSON.stringify(st.d).slice(0, 140))

  // 7) YAKUNIY: serverdagi fayl baribir to'liq (cleanup muhri: keep=1 fayllar cronga tegmaydi)
  const fin = await j('/api/media/' + FID, { h: HA })
  ok(fin.st === 200 && fin.d.complete === 1, 'yakunda fayl serverda to\u2019liq (o\u2019chmas tarix muhri)')
} catch (e) {
  fails++
  console.log('  ✗ FAIL istisno:', String(e && e.message || e).slice(0, 200))
} finally {
  await logout(tokA); await logout(tokB)
}
console.log(fails === 0 ? '== DATA E2E: PASS ==' : '== DATA E2E: ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
