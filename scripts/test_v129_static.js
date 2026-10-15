#!/usr/bin/env node
/* v129 STATIK TESTLAR — «OVOZ KELMAYAPTI / QO'NG'IROQ QOTIB QOLYAPTI» (Task 75)
 *  Foydalanuvchi: "A foydalanuvchi B foydalanuvchiga video qo'ng'iroq qilsa A
 *  foydalanuvchida video qotib qolyapti ovoz ham kelmayapti — B foydalanuvchi A
 *  foydalanuvchiga video qo'ng'iroq qilsa ishlayapti — tuzat yana buzildi"
 *
 *  JONLI-JURNAL ILDIZLARI (run 38686515909, 300 yozuv):
 *   ① DEKODER-O'LIK: inA=+12365 bayt kelgan, smp=+0 (NOL namuna decode), kon=+0
 *      → yagona davo a-reset; narvon bosqich-7 (35-40s) ga yetib bormagan.
 *   ② NARVON-ZAHARI: mikro-jimning else-shoxi C.silN'ni har oynada nolga tushirgan
 *      → «bosqich 1» har 5s aylanagan, a-reset HEB QACHON so'ralmagan (jurnal-dalil).
 *   ③ MIKRO-JIM CHEGARASI: yuboruvchi mikrofoni jim oqim ch=4% — outR<1 chegarasidan
 *      qochgan → «mening ovozim yetmayapti» davolansiz qolgan.
 *  v129: darhol-dekoder-detektor + hisoblagich-ajratish + outR<5 + a-reset ×2.
 *  MUHRLAR: v128 tezlik-qanoti (SDP-darhol/applyP/pre-warm/adaptiv-poll/parallel-kamera),
 *  R1 (offer faqat chaqiruvchi), R2 (bitta oqim), R5 (oseq), M1/M2/M3 (v96 endCall),
 *  v122 (301 yo'q), v123/v124 (sessiya), v127 (panel faqat egasi), versiya uchligi v129.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const RTC = fs.readFileSync(path.join(ROOT, 'web/rtc.js'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')

console.log('— 1) DEKODER-O\'LIK DETEKTORI (asosiy tuzatish)')
ok(RTC.includes("dInA > 4000 && dSmpl === 0 && dKon === 0"), 'detektor sharti: baytlar oqadi + NOL namuna + NOL concealment')
ok(RTC.includes("clog('dekoder-olik'"), 'jurnal: dekoder-olik belgisi')
ok(RTC.includes("if ((C.aRstReq || 0) < 2)"), 'a-reset 2 martagacha ruxsat (detektor)')
ok(RTC.includes("C.st0 = null // baseline 0 dan"), 'detektor baseline tozalaydi')
ok(RTC.includes("let decFired = false") && RTC.includes("!decFired"), 'decFired — boshqa qutqaruvlar o\'sha oynada to\'qnashmaydi')

console.log('— 2) NARVON-ZAHARI: hisoblagichlar AJRATILGAN')
ok(RTC.includes("C.micSilN = (C.micSilN || 0) + 1"), 'mikro-jim O\'Z hisoblagichi (micSilN)')
ok(!/if \(outR !== -1 && outR < 5[\s\S]{0,400}\} else C\.silN = 0/.test(RTC), 'mikro-jim else-shoxi endi silN\'ga TEGMAYDI (narvon ozod)')
ok(RTC.includes("C.aRstReq = (C.aRstReq || 0) + 1"), 'bosqich-7 a-reset ham hisoblangan (×2)')
ok((RTC.match(/aRstReq/g) || []).length >= 5, 'aRstReq 2 martalik (detektor + narvon + areset-tozalash)')

console.log('— 3) MIKRO-JIM CHEGARASI (ch=4% qochishi yopildi)')
ok(RTC.includes("outR < 5 && dOutA > 15000"), 'chegara outR<5 + dOutA>15000 (uzluksiz-oqim dalili)')
ok(RTC.includes("C.micSilN >= 2"), '2 ketma-ket oyna (yalg\'on-heal posboni saqlangan)')
ok(RTC.includes("(C.heals || 0) < 4"), 'heal-4 cap saqlangan (video-muzlash churnidan himoya)')

console.log('— 4) A-RESET BASELINE (yangi dekoder toza o\'lchanadi)')
ok(RTC.includes("C.st0 = null; C.decDead = 0; C.decCool = Date.now()"), 'areset-javob: baseline+detektor reset')
ok(RTC.includes("C.st0 = null; C.decDead = 0"), 'audioTransceiverReset: baseline reset')

console.log('— 5) v128 TEZLIK-QANOTI SAQLANGAN (jurnal: ulanish 2-5s isbotlangan)')
ok(RTC.includes("C.applyP = C.pc.setLocalDescription(o)"), 'offer SDP darhol (applyP fonda)')
ok(RTC.includes("C.applyP = C.pc.setLocalDescription(a)"), 'answer SDP darhol (applyP fonda)')
ok(RTC.includes("icePreWarm"), 'ICE pre-warm')
ok(RTC.includes("setTimeout(() => r(ICE_FALLBACK), 1500)"), 'newPC 1.5s zaxira-race')
ok(RTC.includes("CALL && !CALL.started ? 600 : 1800"), 'adaptiv polling 600ms/1800ms')
ok(RTC.includes("sigTmo(6000)"), 'sigTo 6s timeout')
ok(RTC.includes("ulanish-qorovuli"), '10s ulanish-qorovuli')
ok(RTC.includes("sigTo(C.peer.id, { k: 'accept', call_id: C.id }, 5, 1200)"), 'qabulchi accept darhol (parallel kamera)')
ok(RTC.includes("EARLY-OFFER PARKING"), 'offer-parklash saqlangan')
ok(W.includes("c.wait(c.db.run(\"INSERT INTO call_signals"), 'server: navbat-INSERT fonda (c.wait)')

console.log('— 6) MUHRLAR: R1/R2/R5 + M1/M2/M3 (audio-hayotiy sikl)')
ok(RTC.includes("qabul qiluvchi hech qachon offer yaratmasligi uchun GLARE KONSTRUKTIV MUMKIN EMAS"), 'R1 (offer faqat chaqiruvchi)')
ok(RTC.includes("R2: oqim DOIM xuddi shu obyekt"), 'R2 (bitta doimiy oqim)')
ok(RTC.includes("R5: eski javob qabul qilinmaydi"), 'R5 (oseq)')
ok(RTC.includes("muhr=v96"), 'M1/M2/M3 endCall muhri (v96)')
ok(RTC.includes("toza-yiqilish OK"), 'toza-yiqilish tartibi')

console.log('— 7) ESKI MUHRLAR: v122/v123/v124/v127')
ok(!/301/.test(W.match(/async function fetch[\s\S]{0,2000}/)?.[0] || '') , 'v122: fetch-da 301 yo\'q')
ok(W.includes('SMS_MODE'), 'SMS_MODE rejimi bor')
ok(W.includes("panelLogin") && W.includes("Boshqa admin qo\u2018shish o\u2018chirilgan"), 'v127: panel faqat egasi')
ok(W.includes("v124") || W.includes("sess-rotatsiya"), 'v123/v124 sessiya muhri')

console.log('— 8) VERSIYA UCHLIGI v129 (worker/core/sw sinxron)')
ok(W.includes('const BUILD_V = "v129"'), 'worker BUILD_V=v129')
ok(CORE.includes("window.__50BUILD = 'v129'"), 'core __50BUILD=v129')
ok(SW.includes("const V = '50gram-v129'"), 'sw V=50gram-v129')

console.log('— 9) SINTAKSIS (node --check ×3)')
for (const f of ['web/rtc.js', 'web/core.js', 'web/sw.js']) {
  const r = cp.spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  ok(r.status === 0, f + ' --check', r.stderr ? r.stderr.slice(0, 120) : '')
}

console.log('')
if (fails) { console.log('✗ ' + fails + ' TEST BUZILDI'); process.exit(1) }
console.log('✓ v129 statik testlar: HAMMASI YASHIL')
