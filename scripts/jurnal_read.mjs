/* JURNAL O'QISH (egaga): jonli serverdagi err_jurnal — server 500'lari + KLIENT
 * qo'ng'iroq jurnallari (src=klient). Lokal IP SEC firewall'da bloklangani uchun
 * GitHub Actions runneridan o'qiladi (workflow_dispatch).
 * Ishga tushirish: node scripts/jurnal_read.mjs  [E2E_BASE=https://...]
 * E2E bilan bir xil himoya: GitHub runner IP'lari UMUMIY havzada — firewall 404
 * («Not found») berishi mumkin → 4 martagacha 25s pauza bilan qayta urinamiz. */
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const PHONE = process.env.JURNAL_PHONE || '998900000005' // DEV_PHONES egasi (audit raqami)
const N = Math.min(300, +(process.env.JURNAL_N || 80))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// MUHIM: SEC firewall faqat brauzer/app UA'larini qabul qiladi (FW_UA_OK) — node'ning
// standart 'node' UA'si «tashqi josus» deb 1-urinishda 30 KUNGA blok beradi (isbot: jurnal
// run 37292097912). Smoke bilan bir xil brauzer-UA ishlatamiz.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function jreq(path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + path, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) } })
      const txt = await res.text()
      try { return JSON.parse(txt) } catch (e) { last = new Error('HTTP ' + res.status + ' ' + txt.slice(0, 40)) }
    } catch (e) { last = e }
    if (i < tries - 1) { console.log('urinish ' + (i + 1) + ' xato: ' + last.message + ' — 25s kutib qayta urinamiz'); await sleep(25000) }
  }
  throw last
}

const otp = await jreq('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
if (!otp.ok) { console.error('OTP xato:', JSON.stringify(otp).slice(0, 200)); process.exit(1) }
const v = await jreq('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + PHONE, code: otp.dev_code }) })
if (!v.token) { console.error('VERIFY xato:', JSON.stringify(v).slice(0, 200)); process.exit(1) }
console.log('login OK uid=' + v.user?.id)

const j = await jreq('/api/jurnal?n=' + N, { headers: { authorization: 'Bearer ' + v.token } })
const rows = j.items || []
console.log('=== JURNAL (' + rows.length + ' yozuv) ===')
if (!rows.length) { console.log('jurnal BO\'SH — serverda hech qanday xato yozuvi yo\'q (toza holat)') }
for (const w of rows) {
  const t = new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ')
  console.log(`[${t}] ${w.src || '?'} ${w.path || ''} uid=${w.uid || 0} :: ${String(w.msg || '').slice(0, 260)}`)
}
// logout — raqam «band» qolmasin
try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, authorization: 'Bearer ' + v.token }, body: '{}' }) } catch {}
