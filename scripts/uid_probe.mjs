/* v131 TASHXIS-2: shubhali uid'larni panel orqali aniqlash (phone/created/ls) */
const BASE = (process.env.E2E_BASE || 'https://50gram.uz').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const UIDS = [1792055037767999, 1791644225808243, 1791995954647100, 1791994720783074, 1792049454089359, 1791455950460483, 1791455953265911, 1791521800882821, 1791521806237643, 1790858672586492]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function j(path, opt = {}, tries = 4) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
      const t = await r.text()
      let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
      return { st: r.status, d }
    } catch (e) { last = e; await sleep(25000) }
  }
  throw last
}
const pl = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
if (!pl.d.token) { console.error('panel login olmadi ' + pl.st); process.exit(1) }
const PH = { authorization: 'Bearer ' + pl.d.token }
for (const uid of UIDS) {
  const pu = await j('/api/panel/user?id=' + uid, { h: PH })
  if (pu.st === 200) {
    const d = pu.d
    console.log('uid=' + uid + ' → ' + d.phone + ' | nom=' + (d.name || '—') + ' | yaratilgan=' + new Date(d.cr).toISOString() + ' | ls=' + new Date(d.ls).toISOString() + ' | sessEnd=' + (d.sessEnd ? new Date(d.sessEnd).toISOString() : 'null') + ' | bl=' + d.bl + ' | st=' + d.st)
  } else console.log('uid=' + uid + ' → HTTP ' + pu.st)
}
