/* Task 70 DIAGNOSTIKA: «Qaytadan kiring» — JONLI ISHLAB CHIQARISH MA'LUMOTLARI
 * 1) VERSIYA/KESH: /core.js, /sw.js, / sarlavhalari (cache-control!) + build belgilari
 * 2) PANEL: stats + security (fwoff, bloklar, turlar)
 * 3) JURNAL: /api/jurnal — src=klient (real qurilmalar BUILD'i!) + src=http (500'lar)
 * 4) URUSH-SIM (998900000004): A kiradi → B kiradi → A hali tirik (grace) → 6 daqiqadan
 *    keyin A o'lgan (grace tugadi = urush davom etadi) → hisobot
 * Ishga tushirish: GitHub Actions (sandbox IP bloklangan). */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function raw(path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + path, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) } })
      return res
    } catch (e) { last = e }
    if (i < tries - 1) { console.log('urinish ' + (i + 1) + ': ' + (last?.message || '?') + ' — 25s'); await sleep(25000) }
  }
  throw last
}
async function jget(path, opt = {}) {
  const r = await raw(path, opt)
  const t = await r.text()
  try { return { st: r.status, j: JSON.parse(t), h: r.headers } } catch { return { st: r.status, t: t.slice(0, 120), h: r.headers } }
}

console.log('════ 1) VERSIYA + KESH SARLAVHALARI (real mijoz nima oladi) ════')
for (const p of ['/', '/index.html', '/core.js', '/sw.js']) {
  const r = await raw(p, { method: 'GET' })
  const cc = r.headers.get('cache-control') || '(yo\'q)'
  const et = r.headers.get('etag') || ''
  const cf = r.headers.get('cf-cache-status') || ''
  const age = r.headers.get('age') || ''
  console.log(`${p} → ${r.status} | cache-control: ${cc} | etag: ${et.slice(0, 20)} | cf: ${cf} ${age ? 'age=' + age : ''}`)
}
const core = await (await raw('/core.js')).text()
const sw = await (await raw('/sw.js')).text()
const build = await jget('/api/build')
console.log('core.js __50BUILD: ' + ((core.match(/__50BUILD = '([^']*)'/) || [])[1] || '?'))
console.log('sw.js V: ' + ((sw.match(/50gram-v([0-9]+)/) || [])[1] || '?'))
console.log('/api/build: ' + JSON.stringify(build.j).slice(0, 100))

console.log('════ 2) PANEL: stats + security ════')
const pl = await jget('/api/panel/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: process.env.ADMIN_PASS }) })
if (pl.j?.t) {
  const H = { authorization: 'Bearer ' + pl.j.t }
  const st = await jget('/api/panel/stats', { headers: H })
  const s = st.j || {}
  console.log(`total=${s.total} online(5m)=${s.online} active24=${s.active24} blocked=${s.blocked}`)
  const sec = await jget('/api/panel/security', { headers: H })
  const c = sec.j || {}
  console.log(`fwoff=${c.fwoff} | sec24h=${c.e24} | sec7d=${c.e7} | uniqueIP=${c.uip} | faolBloklar=${c.blocks}`)
  console.log('turlar(7d): ' + JSON.stringify(c.kinds))
  console.log('yo\'llar(7d): ' + JSON.stringify((c.paths || []).slice(0, 6)))
  console.log('oxirgi 12 hodisa: ' + JSON.stringify((c.recent || []).slice(0, 12).map(r => new Date(r.ts).toISOString().slice(5, 16).replace('T', ' ') + ' ' + r.kind + ' ' + r.path + ' ' + r.cc)))
} else console.log('PANEL LOGIN FAIL: ' + JSON.stringify(pl).slice(0, 150))

console.log('════ 3) JURNAL: klient qurilmalari + server xatolari ════')
const JP = '998900000005'
const o = await jget('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: JP }) })
if (o.j?.dev_code) {
  const v = await jget('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + JP, code: o.j.dev_code }) })
  if (v.j?.token) {
    const jr = await jget('/api/jurnal?n=300', { headers: { authorization: 'Bearer ' + v.j.token } })
    const rows = jr.j?.items || []
    const kl = rows.filter(w => w.src === 'klient')
    const http = rows.filter(w => w.src !== 'klient')
    console.log(`jurnal: ${rows.length} yozuv (klient=${kl.length}, server=${http.length})`)
    const builds = {}
    for (const w of kl) { const m = String(w.msg || '').match(/build=([\w.]+)/); if (m) builds[m[1]] = (builds[m[1]] || 0) + 1 }
    console.log('KLIENT BUILD TAQSIMOTI (real qurilmalar): ' + JSON.stringify(builds))
    console.log('— oxirgi 15 klient yozuvi:')
    for (const w of kl.slice(0, 15)) console.log('  ' + new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ') + ' | ' + String(w.msg || '').slice(0, 150))
    console.log('— oxirgi 10 server xatosi:')
    for (const w of http.slice(0, 10)) console.log('  ' + new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ') + ' | ' + w.path + ' | ' + String(w.msg || '').slice(0, 120))
  } else console.log('VERIFY FAIL: ' + JSON.stringify(v.j).slice(0, 150))
} else console.log('OTP FAIL: ' + JSON.stringify(o.j).slice(0, 150))

console.log('════ 4) URUSH-SIM (998900000004): 2 klient — grace sinovi ════')
const WP = '998900000004'
const login = async (dev) => {
  const a = await jget('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev': dev }, body: JSON.stringify({ phone: WP }) })
  if (!a.j?.dev_code) throw new Error('otp fail: ' + JSON.stringify(a.j).slice(0, 100))
  await sleep(21000)
  const w = await jget('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev': dev }, body: JSON.stringify({ phone: '+' + WP, code: a.j.dev_code }) })
  if (!w.j?.token) throw new Error('verify fail: ' + JSON.stringify(w.j).slice(0, 100))
  return w.j.token
}
try {
  const TA = await login('diag-devA-' + Date.now())
  console.log('A kirdi. /api/me A: ' + (await raw('/api/me', { headers: { authorization: 'Bearer ' + TA } })).status)
  const TB = await login('diag-devB-' + Date.now())
  console.log('B kirdi (sess aylanadi). /api/me B: ' + (await raw('/api/me', { headers: { authorization: 'Bearer ' + TB } })).status)
  console.log('grace ichida /api/me A: ' + (await raw('/api/me', { headers: { authorization: 'Bearer ' + TA } })).status + ' (200=grace ishlaydi)')
  console.log('... 320s kutamiz (grace 5 daqiqa → tugashi kerak) ...')
  await sleep(320000)
  const sA = (await raw('/api/me', { headers: { authorization: 'Bearer ' + TA } })).status
  const sB = (await raw('/api/me', { headers: { authorization: 'Bearer ' + TB } })).status
  console.log(`grace'dan keyin: A=${sA} (401=grace tugagan — URUSH DAVOM ETADI), B=${sB} (200)`)
} catch (e) { console.log('URUSH-SIM xato: ' + e.message) }
console.log('════ DIAG TUGADI ════')
