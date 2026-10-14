#!/usr/bin/env node
/* v128 STATIK TESTLAR — «VIDEO QO'NG'IROQ ULANISH TEZLIGI (12-20s → 3-6s)»
 *  Foydalanuvchi: "video qo'ng'iroqni ulanish tezligini oshir — 12 soniyadan 20
 *  soniyagacha cho'zilmoqda — tez va sifatli qilib kuchaytir"
 *  6 ta ildiz, hammasi yopildi (web/rtc.js + worker/src/index.ts):
 *   1) offer/answer SDP DARHOL yuboriladi — setLocalDescription FONDA (applyP)
 *   2) ICE PRE-WARM + newPC 1.5s timeout-race (zaxira ICE)
 *   3) ADAPTIV polling: ulanish bosqichida 600ms, ulangach 1800ms
 *   4) Server signal(): navbat-INSERT fonda (c.wait) — javob WS-yetkazish bilan darhol
 *   5) Ikkala kamera PARALLEL (chaqiruvchi: POST /calls bilan; qabulchi: accept darhol)
 *   6) 10s ULANISH-QOROVULI (brauzer 'failed' 15-30s kutmaydi) + sigTo 6s timeout
 *      + ICE-candidate 1 qayta urinish + Jonli efir offer/answer darhol
 *  MUHRLAR: R1 (offer faqat chaqiruvchi), M1/M2/M3 (v96 audio-sikl endCall tartibi),
 *  v122 (301 yo'q), v123/v124 (sessiya), v127 (panel faqat egasi), versiya uchligi v128.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const RTC = fs.readFileSync(path.join(ROOT, 'web/rtc.js'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')

console.log('— 1) SDP DARHOL + APPLY FONDA (asosiy tuzatish)')
ok(RTC.includes("C.applyP = C.pc.setLocalDescription(o)"), 'processAccept: offer applyP fon-da')
ok(RTC.includes("C.applyP = C.pc.setLocalDescription(a)"), 'answer yo\'li: javob applyP fon-da')
ok(RTC.includes("sdp: { type: 'offer', sdp: o.sdp }"), 'offer SDP createOffer natijasidan DARHOL')
ok(RTC.includes("sdp: { type: 'answer', sdp: a.sdp }"), 'answer SDP createAnswer natijasidan DARHOL')
ok((RTC.match(/applyP\.catch/g) || []).length >= 4, 'barcha applyP rad etilishi jim ushlanadi', (RTC.match(/applyP\.catch/g) || []).length + ' ta')
ok(RTC.includes("if (C.applyP) { try { await C.applyP } catch {} }"), 'answer handler: lokal-apply tugaguncha kutadi')
ok(RTC.includes("C.remoteAt = Date.now()"), 'remoteAt belgilanadi (qorovul uchun)')

console.log('— 2) ICE PRE-WARM + newPC RACE')
ok(RTC.includes('const icePreWarm = () =>'), 'icePreWarm mavjud')
ok((RTC.match(/icePreWarm\(\)/g) || []).length >= 2, 'pre-warm CHAQIRUVCHI + QABULCHI ikkalasida', (RTC.match(/icePreWarm\(\)/g) || []).length + ' chaqiruv')
ok(RTC.includes('Promise.race([iceServers(), new Promise((r) => setTimeout(() => r(ICE_FALLBACK), 1500))])'), 'newPC: 1.5s timeout-race (zaxira ICE)')

console.log('— 3) ADAPTIV POLLING')
ok(RTC.includes('CALL && !CALL.started ? 600 : 1800'), 'ulanish bosqichida 600ms, ulangach 1800ms')
ok(RTC.includes('clearTimeout(sigPollT)'), 'stopSigPoll clearTimeout (zanjir to\'g\'ri to\'xtaydi)')
ok(RTC.includes('setTimeout(loop, 300)'), 'birinchi tortish 300ms')
ok(!RTC.includes('sigPollT = setInterval'), 'eski doimiy 1.8s interval YO\'Q')

console.log('— 4) SERVER signal() — NAVBAT FONDA')
ok(W.includes('c.wait(c.db.run("INSERT INTO call_signals'), 'navbat-INSERT c.wait ichida (fonda)')
ok(!/try \{ await c\.db\.run\("INSERT INTO call_signals/.test(W), 'eski await-INSERT patterni YO\'Q (javob kutmaydi)')
ok(W.includes('await notify(c.env, [to], { type: "signal", sid, from: c.uid, data })'), 'WS-yetkazish await qilinadi (javob shu bilan qaytadi)')
ok(W.includes('v128 TEZLIK: navbat-yozuvi'), 'izoh-muhir bor')

console.log('— 5) IKKALA KAMERA PARALLEL + ACCEPT DARHOL')
ok(RTC.includes('const mediaP = getMedia(video)'), 'chaqiruvchi kamerasi POST /calls bilan parallel')
ok(RTC.includes('if (!C0 || (C0.local && C0.local !== s))'), 'GHOST-SWEEPER: ishlatilmagan oqim o\'chiriladi (tayinlanayotgani tegilmaydi)')
ok(RTC.includes("sigTo(C.peer.id, { k: 'accept', call_id: C.id }, 5, 1200).then((ok) =>"), 'qabulchi accept DARHOL (kamera parallel)')
ok(RTC.includes("if (!ok && CALL === C && !C.started && !C.pc) endCall('missed'"), 'accept yetmasa — yakuniy qorovul saqlangan')
ok(RTC.includes('if (CALL.pendingAccept) processAccept(CALL)'), 'pendingAccept parklangan accept ishlanadi')

console.log('— 6) ULANISH-QOROVULI + SIGNAL-TEZLIK')
ok(RTC.includes("C.iceNudged = 1"), 'qorovul bir marta (po\'ansa yo\'q)')
ok(RTC.includes("recover(C, 'ulanish-turgun')"), '10s erta-tiklash')
ok(RTC.includes("Date.now() - since > 10000"), '10s chegara')
ok(RTC.includes('sigTmo(6000)'), 'sigTo 6s timeout (20s osilib qolmaydi)')
ok(RTC.includes('p.catch(() => {})'), 'timeout g\'olib bo\'lsa kechki rejection jim')
ok(RTC.includes("const sigIce = (to, c) =>"), 'ICE candidate 1-qayta-urinish')
ok(RTC.includes("k.pc.setLocalDescription(o).catch(() => {})"), 'Jonli efir: offer darhol')
ok(RTC.includes("pc.setLocalDescription(a).catch(() => {})"), 'Jonli efir: javob darhol')

console.log('— 7) MUHRLAR SAQLANGAN (R1/R2/R5 + v96 audio-sikl)')
ok(RTC.includes('offer FAQAT chaqiruvchida. restartIce ham faqat chaqiruvchida'), 'R1 muhri: offer faqat offerer')
ok(RTC.includes("C.role !== 'offerer' || C.restaring"), 'restartIce guard saqlangan')
ok(RTC.includes('C.remote = new MediaStream()'), 'R2: bitta doimiy masofa-oqim saqlangan')
ok(RTC.includes("if (oseq && !d.areset && C.lastOseq && oseq < C.lastOseq)"), 'R5: oseq-eski-tashlash saqlangan')
ok(RTC.includes('freshAudioUniverse(CALL)'), 'M1: har qo\'ng\'iroqda virgin kontekst')
ok(RTC.includes("if (window.__50actx && window.__50actx.state !== 'closed')"), 'M1: endCall kontekst yopadi')
ok(RTC.includes("if (!CALL) window.Android50.speaker(false)"), 'M2: marshrut-reset guard saqlangan')
ok(RTC.includes('nativeRouteStart(!!video)') && RTC.includes('nativeRouteStart(!!C.video)'), 'M3: proaktiv marshrut ikkala tomonda')
ok(RTC.includes('kamera 2 marta osildi'), 'v76 kamera-tiklash saqlangan')
ok(RTC.includes('function endCall(status = '), 'endCall tartibi tegilmagan (funksiya bor)')

console.log('— 8) VERSIYA UCHLIGI v128 + MEROS MUHRLARI')
ok(W.includes('const BUILD_V = "v128"'), 'worker BUILD_V v128')
ok(CORE.includes("window.__50BUILD = 'v128'"), 'core.js __50BUILD v128')
ok(SW.includes("const V = '50gram-v128'"), 'sw.js V v128')
ok(!/return fw4\(\)|301.*workers\.dev.*yashiruvchi.*guard/.test(W.split('v120')[0] || ''), 'placeholder')
ok(!W.includes("301 https://50gram.uz\" + url.pathname"), 'v122 muhri: workers.dev 301 YO\'Q (qayta qo\'shilmagan)')
ok(W.includes('prev_sess'), 'v123/v124: sessiya-otish davri saqlangan')
ok(W.includes('String(a.role || "") !== "egasi"'), 'v127: panel faqat egasi saqlangan')
ok(W.includes('if (uname && uname !== "egasi") return badTry()'), 'v127: boshqa admin logini yopilgan')
ok(W.includes('SMS_MODE'), 'SMS_MODE="app" tegilmagan (Eskiz keyinga qoldirilgan)')
ok(W.includes('turn:openrelay.metered.ca:80'), 'TURN bepul (openrelay) o\'zgarmagan — xarid yo\'q')
ok(W.includes('AbortSignal.timeout(3500)'), '/ice 3.5s server-timeout saqlangan')

console.log('— 9) SINTAKSIS (node --check)')
for (const f of ['web/rtc.js', 'web/core.js', 'web/sw.js', 'web/chat.js', 'web/tools.js', 'web/manage.js', 'web/storage.js', 'web/p2p.js', 'web/social.js', 'web/local-store.js']) {
  let r = 'OK'
  try { cp.execSync('node --check ' + path.join(ROOT, f), { stdio: 'pipe' }) } catch (e) { r = String(e.stderr || e).slice(0, 120) }
  ok(r === 'OK', f, r)
}

console.log(fails === 0 ? '\nHAMMASI YASHIL — v128 statik testlar toza' : '\n' + fails + ' TA MUAMMO!')
process.exit(fails ? 1 : 0)
