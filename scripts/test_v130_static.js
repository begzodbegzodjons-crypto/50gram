#!/usr/bin/env node
/* v130 STATIK TESTLAR — «BIRINCHI QO'NG'IROQDA OVOZ KELMADI + KICHIK OYNA QOTIB QOLDI»
 *  Foydalanuvchi: "sinap ko'rildi — birinchi qo'ng'iroqda bir tarafni ovozi kelmadi,
 *  keyingilarida keldi. Nima qilish kerak? Video qo'ng'iroq vaqtida o'zini ko'rsatadigan
 *  kichik oyna orada qotib qolmoqda."
 *
 *  JONLI-JURNAL DALILI (run 38698395677, 300 yozuv — 10-15 06:52-07:17 foydalanuvchi sinovi):
 *   ① call 1792047155252438 (BIRINCHI qo'ng'iroq): dekoder-olik DETEKTOR ISHLADI
 *      (inA=+16KB lekin smp=+0 kon=+0 → a-reset #1) — lekin a-reset 10-15s ovoz-sukut
 *      qoldirdi; keyingi qo'ng'iroqlar (06:53/06:54/06:55/06:56) smp=+240000, k=18-100% — TOZA.
 *      → ildiz: sessiyaning BIRINCHI qo'ng'iroqida WebView Opus-dekoderi qotadi
 *        («birinchi PC» kasalligi) — profilaktika KERAK, faqat davos emas.
 *   ② KICHIK OYNA (self-view): element-darajasidagi muzlash — oqim tirik, element
 *      currentTime turibdi. Hech qanday qorovul YO'Q edi (faqat .ra audio elState nazorati bor).
 *  v130: decoderPreWarm (lokal loopback, 1 marta/sessiya) + birinchi-20s tez tashxis
 *  (2.5s getStats / 2.2s oyna) + oyna-qotdi element-qorovuli (self-view + masofa-oyna)
 *  + ekran-qaytganda elementlarni jonlantirish.
 *  MUHRLAR: v129 (detektor/narvon/mikro-jim), v128 tezlik-qanoti, R1/R2/R5, M1/M2/M3,
 *  v122 (301 yo'q), v123/v124 (sessiya), v127 (panel faqat egasi), versiya uchligi v130.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const RTC = fs.readFileSync(path.join(ROOT, 'web/rtc.js'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')

console.log('— 1) DEKODER-OLDIN-ISSIQ (birinchi qo\'ng\'iroq profilaktikasi)')
ok(RTC.includes('async function decoderPreWarm(C)'), 'decoderPreWarm funksiyasi bor')
ok(RTC.includes('window.__50decWarm = 1'), 'sessiyada FAQAT 1 MARTA belgisi')
ok(RTC.includes('new RTCPeerConnection({ iceServers: [] })'), 'lokal loopback — TASHQIGA hech narsa chiqmaydi')
ok(RTC.includes('ctx.createMediaStreamDestination()'), 'jim Ostsillyator treki (destination\'ga ulanmagan — JIMSIZ)')
ok(RTC.includes("clog('dekoder-oldin-issiq'"), 'jurnal: dekoder-oldin-issiq belgisi')
ok((RTC.match(/decoderPreWarm\(CALL\)|decoderPreWarm\(C\)/g) || []).length >= 2, 'chaqiruvchi VA qabulchida chaqiriladi')

console.log('— 2) BIRINCHI-20s TEZ TASHXIS (a-reset 10-14s → 3-5s)')
ok(RTC.includes('const minWin = (C.started && now - C.started < 20000) ? 2200 : 4500'), 'adaptiv oyna: birinchi 20s = 2.2s')
ok(RTC.includes("Date.now() - C.started > 20000) return"), 'tez-sikl FAQAT birinchi 20s (keyin jimtaq)')
ok(RTC.includes('}, 2500)'), 'tez-sikl 2.5s kadans')

console.log('— 3) OYNA-QOTDI: element-qorovuli (kichik oyna + masofa-oyna)')
ok(RTC.includes("clog('oyna-qotdi'"), 'jurnal: oyna-qotdi belgisi')
ok(RTC.includes('lv.srcObject = null') && RTC.includes('lv.srcObject = C.local'), 'o\'z-oyna (self-view) null→qayta bog\'lash')
ok(RTC.includes('rv.srcObject = null') && RTC.includes('rv.srcObject = C.remote'), 'masofa-oyna null→qayta bog\'lash')
ok(RTC.includes('C.locFixAt || 0) > 9000') && RTC.includes('C.remFixAt || 0) > 9000'), '9s cooldown — to\'qnashuv yo\'q')
ok(RTC.includes('dL === 0 && (dOutV > 0 || dInV > 0)'), 'o\'z-oyna sharti: element qotgan LEKIN oqim tirik')
ok(RTC.includes('dInV > 0 && dR === 0'), 'masofa-oyna sharti: video oqmoqda lekin element qotgan')
ok(RTC.includes("if (!C.video || C.aOnly") === false && RTC.includes('C.video && !C.aOnly && C.el'), 'faqat VIDEO qo\'ng\'iroqda, faqat-ovoz rejimida tegilmaydi')

console.log('— 4) EKRAN-QAYTDI: fon-rejim elementlari')
ok(RTC.includes("clog('ekran-qaytdi'"), 'jurnal: ekran-qaytdi belgisi')
ok(/visibilitychange[\s\S]{0,900}lv\.srcObject = null/.test(RTC), 'visibilitychange ichida video-elementlar jonlantiriladi')
ok(RTC.includes('C.lc0 = undefined; C.rc0 = undefined'), 'qorovul-baseline reset (yalg\'on-o\'q posboni)')

console.log('— 5) v129 SAQLANGAN (detektor + narvon + mikro-jim)')
ok(RTC.includes("dInA > 4000 && dSmpl === 0 && dKon === 0"), 'dekoder-olik detektori saqlangan')
ok(RTC.includes("clog('dekoder-olik'"), 'dekoder-olik belgisi saqlangan')
ok(RTC.includes("C.micSilN = (C.micSilN || 0) + 1"), 'mikro-jim o\'z hisoblagichi saqlangan')
ok(RTC.includes("outR < 5 && dOutA > 15000"), 'mikro-jim chegara outR<5 saqlangan')
ok(RTC.includes("if ((C.aRstReq || 0) < 2)"), 'a-reset ×2 saqlangan')

console.log('— 6) v128 TEZLIK-QANOTI SAQLANGAN')
ok(RTC.includes('C.applyP = C.pc.setLocalDescription(o)'), 'offer SDP darhol (applyP fonda)')
ok(RTC.includes('icePreWarm'), 'ICE pre-warm')
ok(RTC.includes('CALL && !CALL.started ? 600 : 1800'), 'adaptiv polling saqlangan')
ok(RTC.includes('ulanish-qorovuli'), '10s ulanish-qorovuli saqlangan')
ok(RTC.includes('EARLY-OFFER PARKING'), 'offer-parklash saqlangan')

console.log('— 7) MUHRLAR: R1/R2/R5 + M1/M2/M3 + eski muhrlar')
ok(RTC.includes('qabul qiluvchi hech qachon offer yaratmasligi uchun GLARE KONSTRUKTIV MUMKIN EMAS'), 'R1')
ok(RTC.includes('R2: oqim DOIM xuddi shu obyekt'), 'R2')
ok(RTC.includes('R5: eski javob qabul qilinmaydi'), 'R5')
ok(RTC.includes('muhr=v96') && RTC.includes('toza-yiqilish OK'), 'M1/M2/M3 endCall muhri')
ok(W.includes('SMS_MODE'), 'SMS_MODE bor')
ok(W.includes('panelLogin') && W.includes('Boshqa admin qo\u2018shish o\u2018chirilgan'), 'v127 panel faqat egasi')
ok(!/301/.test(W.match(/async function fetch[\s\S]{0,2000}/)?.[0] || ''), 'v122: fetch-da 301 yo\'q')

console.log('— 8) VERSIYA UCHLIGI v130 (worker/core/sw sinxron)')
ok(W.includes('const BUILD_V = "v130"'), 'worker BUILD_V=v130')
ok(CORE.includes("window.__50BUILD = 'v130'"), 'core __50BUILD=v130')
ok(SW.includes("const V = '50gram-v130'"), 'sw V=50gram-v130')
ok(!RTC.includes('__50BUILD'), 'rtc.js versiya-satiri yo\'q (uchlik core/sw/worker)')

console.log('— 9) SINTAKSIS (node --check ×3)')
for (const f of ['web/rtc.js', 'web/core.js', 'web/sw.js']) {
  const r = cp.spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  ok(r.status === 0, f + ' --check', r.stderr ? r.stderr.slice(0, 120) : '')
}

console.log('')
if (fails) { console.log('✗ ' + fails + ' TEST BUZILDI'); process.exit(1) }
console.log('✓ v130 statik testlar: HAMMASI YASHIL')
