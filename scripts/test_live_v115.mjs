// v115 JONLI TARJIMON TESTI — 50gram.uz haqiqiy API (DEV kirish orqali)
// 3 sinov: (A) xitoycha ovoz -> o'zbekcha ovoz (asosiy stsenariy)
//          (B) o'zbekcha ovoz (webm, klient simulatsiyasi) -> inglizcha
//          (C) o'zbekcha WAV (normalizatsiya yo'li) -> ruscha
// Ishga tushirish: node scripts/test_live_v115.mjs  (GitHub Actions'da yoki bloklanmagan IP'da)
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://50gram.uz/api'
const MEDIA = path.join(path.dirname(new URL(import.meta.url).pathname), 'media')
const DEV = 'test50gram' + Date.now().toString(16)
const PHONE = '+998907776655'
const H = {
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36',
  origin: 'https://50gram.uz',
  referer: 'https://50gram.uz/index.html',
  'x-dev': DEV,
}

let xato = 0
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ XATO: ') + n + (c ? '' : ' — ' + x)); if (!c) xato++ }
let jaryor = 0
const ozod = () => { jaryor++; return jaryor > 3 }

// 429 (limit) bo'lsa 22s kutib qayta urinish (sms/send cooldown 20s)
async function sorov(url, opt = {}) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, opt)
    if (r.status !== 429 || ozod()) return r
    console.log('    429 — 22s kutilmoqda (' + (i + 1) + '/3)...')
    await new Promise((x) => setTimeout(x, 22000))
  }
  return fetch(url, opt)
}

async function main() {
  // 1) KIRISH (DEV rejim: kod javobda qaytadi)
  let r = await sorov(BASE + '/auth/sms/send', { method: 'POST', headers: H, body: JSON.stringify({ phone: PHONE }) })
  const send = await r.json().catch(() => ({}))
  ok('sms/send (dev_code)', r.ok && send.dev_code, r.status + ' ' + JSON.stringify(send).slice(0, 120))
  r = await sorov(BASE + '/auth/sms/verify', { method: 'POST', headers: H, body: JSON.stringify({ phone: PHONE, code: send.dev_code }) })
  const ver = await r.json().catch(() => ({}))
  ok('sms/verify (token)', r.ok && ver.token, r.status + ' ' + JSON.stringify(ver).slice(0, 120))
  const AUTH = { ...H, authorization: 'Bearer ' + ver.token }

  // 2) SINOV A — xitoycha -> o'zbekcha (FLAGMAN: Xitoydagi o'zbek)
  const zhB64 = 'data:audio/webm;base64,' + fs.readFileSync(path.join(MEDIA, 'zh_sinov.webm')).toString('base64')
  r = await sorov(BASE + '/translate/speech', { method: 'POST', headers: AUTH, body: JSON.stringify({ audio: zhB64, to: 'uz' }) })
  const a = await r.json().catch(() => ({}))
  ok('A: Whisper xitoycha aniqladi', r.ok && /你好|火车站|怎么|天气/.test(a.text || ''), r.status + ' ' + JSON.stringify(a).slice(0, 160))
  console.log('    aniqlandi:', (a.text || '').slice(0, 60))
  console.log('    o‘zbekcha:', (a.translated || '').slice(0, 80))
  const mp3A = a.audio ? Buffer.from(a.audio.split(',')[1], 'base64') : null
  ok('A: o‘zbek NEYRAL ovoz qaytdi (Madina/Sardor)', !!mp3A && mp3A.length > 3000, 'audio=' + (mp3A ? mp3A.length + 'B' : "YO'Q"))
  if (mp3A) { fs.writeFileSync('/tmp/live_uz_out.mp3', mp3A); console.log('    -> /tmp/live_uz_out.mp3 saqlandi') }

  // 3) SINOV B — o'zbekcha webm -> inglizcha
  const uzB64 = 'data:audio/webm;base64,' + fs.readFileSync(path.join(MEDIA, 'uz_sinov.webm')).toString('base64')
  r = await sorov(BASE + '/translate/speech', { method: 'POST', headers: AUTH, body: JSON.stringify({ audio: uzB64, to: 'en' }) })
  const b = await r.json().catch(() => ({}))
  ok('B: o‘zbekcha aniqlandi', r.ok && /(assalomu|sinov|tarjimon|ovoz|xitoy|ob-havo|yaxshi)/i.test(b.text || ''), r.status + ' ' + JSON.stringify(b).slice(0, 160))
  console.log('    aniqlandi:', (b.text || '').slice(0, 60))
  console.log('    inglizcha:', (b.translated || '').slice(0, 80))
  const mp3B = b.audio ? Buffer.from(b.audio.split(',')[1], 'base64') : null
  ok('B: ingliz TTS ovozi', !!mp3B && mp3B.length > 3000, 'audio=' + (mp3B ? mp3B.length + 'B' : "YO'Q"))

  // 4) SINOV C — WAV (normalizatsiya) -> ruscha
  const wavB64 = 'data:audio/wav;base64,' + fs.readFileSync(path.join(MEDIA, 'uz_sinov.wav')).toString('base64')
  r = await sorov(BASE + '/translate/speech', { method: 'POST', headers: AUTH, body: JSON.stringify({ audio: wavB64, to: 'ru' }) })
  const c = await r.json().catch(() => ({}))
  ok('C: WAV yo‘li ishladi', r.ok && !!(c.text || ''), r.status + ' ' + JSON.stringify(c).slice(0, 160))
  console.log('    aniqlandi:', (c.text || '').slice(0, 60))
  console.log('    ruscha:', (c.translated || '').slice(0, 80))
  const mp3C = c.audio ? Buffer.from(c.audio.split(',')[1], 'base64') : null
  ok('C: rus TTS ovozi', !!mp3C && mp3C.length > 3000, 'audio=' + (mp3C ? mp3C.length + 'B' : "YO'Q"))

  // 5) Matn tarjima ham tekshiriladi (regressiya yo'q)
  r = await sorov(BASE + '/translate', { method: 'POST', headers: AUTH, body: JSON.stringify({ text: 'Bugun ob-havo yaxshi', to: 'zh' }) })
  const d = await r.json().catch(() => ({}))
  ok('Matn tarjima (regressiya)', r.ok && !!(d.translated || ''), r.status + ' ' + JSON.stringify(d).slice(0, 120))
  console.log('    xitoycha:', (d.translated || '').slice(0, 40))

  console.log(xato === 0 ? 'HAMMASI YASHIL — TARJIMON JONLI ISHLAYDI' : 'XATOLAR SONI: ' + xato)
  if (xato > 0) process.exit(1)
}
main().catch((e) => { console.error('SKRIPT XATO:', e.message); process.exit(1) })
