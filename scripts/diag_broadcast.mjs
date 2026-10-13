/* BROADCAST TASHXISI v2 (qisqa chiqish — GitHub log-arxiv kesuvi posboni):
 *   1) adm_log — FAQAT broadcast amallari (hammaga_xabar/alohida_xabar), oxirgi 8
 *   2) err_jurnal — FAQAT panel/broadcast + srv-manbali yozuvlar, oxirgi 12
 *   3) inbox — faqat SANI
 * Ishga tushirish: node scripts/diag_broadcast.mjs */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
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
const ts = (ms) => new Date(+(ms || 0)).toISOString().slice(5, 16).replace('T', ' ')
const OUT = []
const say = (l) => { OUT.push(l); console.log(l) }
process.on('exit', () => { try { require('fs') } catch {} })

// ---- 1) PANEL LOGIN ----
const lg = await jreq('/api/panel/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: PANEL_PASS }) })
if (!lg.j || !lg.j.token) { console.error('PANEL LOGIN xato:', JSON.stringify(lg).slice(0, 150)); process.exit(1) }
const AT = { authorization: 'Bearer ' + lg.j.token }
console.log('login OK')

// ---- 2) ADM_LOG — broadcast amallari ----
try {
  const pl = await jreq('/api/panel/log', { headers: AT })
  const rows = (pl.j.items || []).filter((w) => /xabar|broadcast|elon/i.test(String(w.act) + ' ' + String(w.tgt) + ' ' + String(w.note)))
  say('=== ADM_LOG broadcast (' + rows.length + ') ===')
  for (const w of rows.slice(0, 8)) say(`[${ts(w.ts)}] ${w.act} | ${String(w.note || '').slice(0, 140)}`)
} catch (e) { console.log('panel/log xato: ' + e.message) }

// ---- 3) INBOX soni ----
try {
  const ib = await jreq('/api/panel/inbox', { headers: AT })
  say('=== MUROJAATLAR: ' + (ib.j.items || []).length + ' ta javob kutilyapti ===')
} catch (e) { console.log('inbox xato: ' + e.message) }

// ---- 4) err_jurnal — faqat srv + broadcast ----
try {
  const otp = await jreq('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
  const v = await jreq('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+' + PHONE, code: otp.j.dev_code }) })
  if (v.j && v.j.token) {
    const j = await jreq('/api/jurnal?n=300', { headers: { authorization: 'Bearer ' + v.j.token } })
    const rows = (j.j.items || []).filter((w) => String(w.src || '') !== 'klient')
    say('=== ERR_JURNAL srv (' + rows.length + ') ===')
    for (const w of rows.slice(0, 12)) say(`[${ts(w.ts)}] ${w.src || '?'} ${w.path || ''} uid=${w.uid || 0} :: ${String(w.msg || '').slice(0, 220)}`)
    try { await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, authorization: 'Bearer ' + v.j.token }, body: '{}' }) } catch {}
  } else console.log('dev-login yopiq — jurnal o\'tkazildi')
} catch (e) { console.log('jurnal xato: ' + e.message) }
say('=== TUGADI ===')
try { const fs = await import('fs'); fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY || '/tmp/sum.md', '<pre>\n' + OUT.join('\n') + '\n</pre>\n') } catch {}
