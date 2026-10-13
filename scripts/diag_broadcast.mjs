/* BROADCAST TASHXISI (egaga): admin broadcast'ning jonli holati —
 *   1) /panel/stats — foydalanuvchilar soni (yuborish doirasi)
 *   2) /panel/log  — adm_log: hammaga_xabar yozuvlari (sent/failed/new_chats)
 *   3) /panel/inbox — murojaatlar qutisi holati
 *   4) /api/jurnal — err_jurnal (server 500'lari — broadcast yo'lida yiqilishlar)
 * Lokal IP SEC firewall'da bloklangani uchun GitHub Actions runneridan o'qiladi.
 * Ishga tushirish: node scripts/diag_broadcast.mjs  [E2E_BASE=...]
 * E2E bilan bir xil himoya: GitHub runner IP'lari umumiy havzada — 404 bo'lsa
 * 4 martagacha 25s pauza bilan qayta urinamiz (jurnal_read.mjs bilan bir xil). */
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const PHONE = process.env.JURNAL_PHONE || '998900000005'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function jreq(path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + path, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) } })
      const txt = await res.text()
      try { return { s: res.status, j: JSON.parse(txt) } } catch (e) { last = new Error('HTTP ' + res.status + ' ' + txt.slice(0, 40)) }
    } catch (e) { last = e }
    if (i < tries - 1) { console.log('urinish ' + (i + 1) + ' xato: ' + last.message + ' — 25s kutib qayta urinamiz'); await sleep(25000) }
  }
  throw last
}

// ---- 1) PANEL LOGIN ----
const lg = await jreq('/api/panel/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: PANEL_PASS }) })
if (!lg.j || !lg.j.token) { console.error('PANEL LOGIN xato:', JSON.stringify(lg).slice(0, 200)); process.exit(1) }
const AT = { authorization: 'Bearer ' + lg.j.token }
console.log('panel login OK')

// ---- 2) STATS ----
try {
  const st = await jreq('/api/panel/stats', { headers: AT })
  console.log('=== FOYDALANUVCHILAR ===')
  console.log('jami=' + st.j.total + ' blok=' + st.j.blocked + ' onlayn=' + st.j.online + ' a24=' + st.j.active24 + ' a7=' + st.j.active7)
} catch (e) { console.log('stats xato: ' + e.message) }

// ---- 3) ADM_LOG — broadcast amallari ----
try {
  const pl = await jreq('/api/panel/log', { headers: AT })
  const rows = pl.j.items || []
  console.log('=== ADM_LOG (oxirgi ' + rows.length + ') ===')
  for (const w of rows.slice(0, 40)) {
    const t = new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ')
    console.log(`[${t}] ${w.act} | ${w.tgt} | ${String(w.note || '').slice(0, 160)}`)
  }
} catch (e) { console.log('panel/log xato: ' + e.message) }

// ---- 4) INBOX holati ----
try {
  const ib = await jreq('/api/panel/inbox', { headers: AT })
  console.log('=== MUROJAATLAR === javob kutilyapti: ' + (ib.j.items || []).length)
  for (const x of (ib.j.items || []).slice(0, 8)) console.log('  chat=' + x.chat_id + ' uid=' + x.uid + ' ' + (x.name || '') + ' :: ' + String(x.body || '').slice(0, 60))
} catch (e) { console.log('inbox xato: ' + e.message) }

// ---- 5) err_jurnal — dev raqam bilan ----
try {
  const otp = await jreq('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
  const v = await jreq('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + PHONE, code: otp.j.dev_code }) })
  if (v.j && v.j.token) {
    const j = await jreq('/api/jurnal?n=120', { headers: { authorization: 'Bearer ' + v.j.token } })
    const rows = j.j.items || []
    console.log('=== ERR_JURNAL (' + rows.length + ' yozuv) ===')
    if (!rows.length) console.log('jurnal BO\'SH — serverda 500-yozuv yo\'q')
    for (const w of rows) {
      const t = new Date(+(w.ts || 0)).toISOString().slice(5, 16).replace('T', ' ')
      console.log(`[${t}] ${w.src || '?'} ${w.path || ''} uid=${w.uid || 0} :: ${String(w.msg || '').slice(0, 300)}`)
    }
    try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, authorization: 'Bearer ' + v.j.token }, body: '{}' }) } catch {}
  } else console.log('dev-login xato — err_jurnal o\'tkazib yuborildi')
} catch (e) { console.log('jurnal xato: ' + e.message) }
console.log('=== TASHXIS TUGADI ===')
