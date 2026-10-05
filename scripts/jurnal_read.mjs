/* JURNAL O'QISH (egaga): jonli serverdagi err_jurnal — server 500'lari + KLIENT
 * qo'ng'iroq jurnallari (src=klient). Lokal IP SEC firewall'da bloklangani uchun
 * GitHub Actions runneridan o'qiladi (workflow_dispatch).
 * Ishga tushirish: node scripts/jurnal_read.mjs  [E2E_BASE=https://...]  */
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const PHONE = process.env.JURNAL_PHONE || '998900000005' // DEV_PHONES egasi (audit raqami)
const N = Math.min(300, +(process.env.JURNAL_N || 80))

const r = await fetch(BASE + '/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
const otp = await r.json()
if (!otp.ok) { console.error('OTP xato:', JSON.stringify(otp).slice(0, 200)); process.exit(1) }
const v = await fetch(BASE + '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + PHONE, code: otp.dev_code }) }).then((x) => x.json())
if (!v.token) { console.error('VERIFY xato:', JSON.stringify(v).slice(0, 200)); process.exit(1) }
console.log('login OK uid=' + v.user?.id)

const j = await fetch(BASE + '/api/jurnal?n=' + N, { headers: { authorization: 'Bearer ' + v.token } }).then((x) => x.json())
const rows = j.rows || []
console.log('=== JURNAL (' + rows.length + ' yozuv) ===')
if (!rows.length) { console.log('jurnal BO\'SH — serverda hech qanday xato yozuvi yo\'q (toza holat)') }
for (const w of rows) {
  const t = new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ')
  console.log(`[${t}] ${w.src || '?'} ${w.path || ''} uid=${w.uid || 0} :: ${String(w.msg || '').slice(0, 260)}`)
}
// logout — raqam «band» qolmasin
try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + v.token }, body: '{}' }) } catch {}
