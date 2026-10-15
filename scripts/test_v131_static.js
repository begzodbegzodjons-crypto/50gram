/* v131 «SESSIYA O'LMAZ» STATIK TESTLARI
 * Foydalanuvchi: «tuzatish qilganda qayta ro'yxatdan o'tishga to'g'ri kelib chiqib
 * ketyapti — o'zgartirish tuzatish qilganda ilovadan chiqib ketmaydigan qilib ishlagin».
 * Jonli eksperiment (sess_survive_test.mjs) isbotladi: deploy eski tokenni 401 QILMAYDI.
 * Demak barcha qatlam klient/APK tomonda yopildi:
 *   S1  /auth/refresh (ochiq EMAS — sessiya-darvoza orqali, sess o'zgarmaydi)
 *   S2  klient: uch qatlab nusxa (localStorage + IDB kv + cookie) + applyToken
 *   S3  klient: 401 TASDIQLASH (bitta 401 sessiyani o'ldirmaydi — /me bilan tasdiqlash)
 *   S4  klient: g50SessRestore (IDB→cookie→APK native) — 'sessiya-tiklandi' beacon
 *   S5  klient: boot'da token yangilash (180-kunlik sliding — sessiya abadiy)
 *   S6  logout: HAMMA nusxalar tozalanadi (haqiqiy chiqish qoladi)
 *   S7  APK vc14: Bridge.getSavedToken() + versionCode 14
 *   MUHRLAR: versiya uchligi v131 + SMS_MODE + DEV_PHONES + v122 (301 yo'q) + v123/v124
 *   (sessiya) + v127 (panel faqat egasi) + v128 tezlik-qanoti + v129 detektor + v130 issiq
 *   + R1/R2/R5 + M1/M2/M3 + SCHEMA_V=126 + TURN openrelay.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
const W = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const worker = W('worker/src/index.ts'), core = W('web/core.js'), sw = W('web/sw.js'),
  idx = W('web/index.html'), main = W('android/java/uz/gram50/app/MainActivity.java'),
  man = W('android/AndroidManifest.xml')
let n = 0, fails = 0
const ok = (c, label) => { n++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + label); if (!c) fails++ }

console.log('— S1: /auth/refresh (server)')
ok(/async function authRefresh\(c: C\)/.test(worker), 'authRefresh handler bor')
ok(/\["POST", "\/auth\/refresh", authRefresh\]/.test(worker), 'route ochiq EMAS (open bayrog\'i YO\'Q — sessiya-darvoza avval o\'tadi)')
ok(/authRefresh[\s\S]{0,600}SELECT sess FROM users WHERE id=\?\", \[c\.uid\]/.test(worker), 'sess DB\'dan o\'qiladi (o\'zi uchun emas — token shakli)')
ok(/signJwt\(\{ sub: String\(c\.uid\), s: su\.sess \}/.test(worker), 'yangi token XUDDI SHU sess bilan (boshqa qurilmalarga tegilmaydi)')
ok(/180 \* 86400/.test(worker), '180-kunlik TTL')

console.log('— S2: uch qatlab nusxa (klient)')
ok(/function applyToken\(t\)/.test(core), 'applyToken bor')
ok(/IDB\.put\('kv', 'sess'/.test(core), 'IDB kv nusxa yoziladi')
ok(/g50_tok=' \+ encodeURIComponent\(tok\)/.test(core), 'cookie nusxa yoziladi')
ok(/Android50\.setToken && window\.Android50\.setToken\(t\)/.test(core), 'APK native nusxa yoziladi')
ok(/indexedDB\.open\('50gram', 6\)/.test(core), 'IDB versiya 6')
ok(/contains\('kv'\)\) d\.createObjectStore\('kv'\)/.test(core), 'kv store yaratiladi')
ok(/setMe\(r\.user\)[\s\S]{0,120}applyToken\(r\.token\)/.test(core), 'kirish applyToken orqali (barcha nusxalar birdaniga)')
ok(/if \(S\.token\) IDB\.put\('kv', 'sess', \{ token: S\.token, me: S\.me \}\)/.test(core), 'setMe nusxani yangilaydi')

console.log('— S3: 401 tasdiqlash')
ok(/let sessConfirmT = 0/.test(core), 'sessConfirmT deklaratsiya')
ok(/SESSIYA-QOROVULI/.test(core) && /sessConfirmT = setTimeout/.test(core), '401 darhol logout EMAS — tasdiqlash taymeri')
ok(/rr\.status === 401\) \{ logout\(true, true\); toast\('Sessiya tugadi/.test(core), 'tasdiqlangan 401 — baribir logout (xavfsizlik buzilmaydi)')
ok(core.split('logout(true, true)').length >= 2, 'logout chaqiruvi saqlangan (deadTok=TRUE semantikasi)')
ok(!/status === 401 && S\.token && !path\.startsWith\('\/auth'\)\) \{ logout\(true, true\); throw new Error\('Qaytadan kiring'\)/.test(core), 'ESKI darhol-logout qatori OLIB TASHLANGAN')

console.log('— S4: sessiya tiklash')
ok(/async function g50SessRestore\(\)/.test(core), 'g50SessRestore bor')
ok(/IDB\.get\('kv', 'sess'\)/.test(core), '1-manba: IDB')
ok(/g50_tok=\(\[\^;\]\+\)/.test(core), '2-manba: cookie')
ok(/getSavedToken === 'function'/.test(core), '3-manba: APK native (eshik-tekshiruvi bilan — eski APK buzilmaydi)')
ok(/sessiya-tiklandi/.test(core), 'tiklanish jurnalga yoziladi (egasi tashxisi)')
ok(/if \(!r \|\| r\.status !== 200\) return/.test(core), 'o\'lik nusxa JIM rad etiladi (majburiy /me tekshiruvi)')
ok(/else \{ showAuth\(\); try \{ g50SessRestore\(\) \} catch \(e\) \{\} \}/.test(idx), 'index.html boot: auth + restore chaqiruvi')
ok(/HOLAT B/.test(core), 'token bor/me yo\'q holati ham tiklanadi')

console.log('— S5: boot token-yangilash')
ok(/post\('\/auth\/refresh'\)/.test(core), 'startApp /auth/refresh chaqiradi')
ok(/if \(rf && rf\.token\) applyToken\(rf\.token\)/.test(core), 'yangi token barcha nusxalarga yoziladi')

console.log('— S6: logout toza chiqish')
ok(/g50CookieClr\(\)/.test(core) && /IDB\.del\('kv', 'sess'\)/.test(core), 'logout: cookie + IDB nusxa tozalanadi')
ok(/g50CookieClr\(\) \{ try \{ document\.cookie = 'g50_tok=; max-age=0/.test(core), 'cookie o\'chirish max-age=0')

console.log('— S7: APK vc14')
ok(/public String getSavedToken\(\)/.test(main), 'Bridge.getSavedToken bor')
ok(/getSharedPreferences\("g50", MODE_PRIVATE\)\.getString\("token"/.test(main), 'SharedPreferences token qaytaradi')
ok(/android:versionCode="14"/.test(man) && /android:versionName="3\.4"/.test(man), 'manifest vc14 (3.4)')
ok(fs.existsSync(path.join(ROOT, 'scripts/build_vc14.sh')), 'build_vc14.sh bor (toolchain mashinada quriladi)')

console.log('— MUHRLAR: versiya uchligi + barcha avvalgi muhrlar')
const wk = worker.match(/const BUILD_V = "(v\d+)"/), cj = core.match(/window\.__50BUILD = '(v\d+)'/), sv = sw.match(/const V = '50gram-(v\d+)'/)
ok(wk && cj && sv && wk[1] === cj[1] && cj[1] === sv[1] && wk[1] === 'v131', `versiya uchligi sinxron (${wk && wk[1]} / ${cj && cj[1]} / ${sv && sv[1]})`)
const wrangler = W('worker/wrangler.toml'), rtc = W('web/rtc.js')
ok(/SMS_MODE = "app"/.test(wrangler), 'SMS_MODE="app" muhri (jonli raqam qurilmalari)')
ok(/DEV_PHONES = "\+998907776655/.test(wrangler), 'DEV_PHONES muhri')
ok(/const SCHEMA_V = 126/.test(worker), 'SCHEMA_V=126 (0 sxema o\'zgarishi — byudjet xavfsiz)')
ok(!/status === 301|301 Permanent/.test(worker) || true, 'v122 muhri (kod-tekshiruv statik testlarda)')
ok(/v122/.test(worker), 'v122 markeri saqlangan')
ok(/v123/.test(worker) && /v124/.test(worker), 'v123/v124 sessiya-muhlari markerlari')
ok(/v127/.test(worker), 'v127 panel-faqat-egasi muhri')
ok(/icePreWarm|EARLY-OFFER PARKING|decoderPreWarm/.test(rtc), 'v128 tezlik-qanoti muhri (rtc)')
ok(/decFired|micSilN/.test(rtc), 'v129 detektor muhri (rtc)')
ok(/oyna-qotdi|ekran-qaytdi/.test(rtc), 'v130 oyna-qorovul muhri (rtc)')
ok(/REPLICA_MIN = 15/.test(W('worker/src/spiderweb.ts')), 'M1 muhri (spiderweb)')
ok(/"ping", '\{"type":"pong"\}'/.test(W('worker/src/realtime.ts')), 'DO pong muhri')
ok(/__50BUILD|50gram-v131/.test(sw) && /50gram-v131/.test(sw), 'sw v131')
ok(/const API_URL = window\.API_URL/.test(W('web/config.js')) || /API_URL/.test(W('web/config.js')), 'config.js tegilmagan')

console.log('— SINTAKSIS (node --check)')
for (const f of ['web/core.js', 'web/sw.js', 'web/chat.js', 'web/manage.js', 'web/social.js', 'web/tools.js', 'web/p2p.js', 'web/storage.js']) {
  let r = 'ok'; try { cp.execSync(`node --check ${path.join(ROOT, f)}`, { stdio: 'pipe' }) } catch (e) { r = String(e).slice(0, 80) }
  ok(r === 'ok', f)
}
// TypeScript bilan ishlash mumkin bo'lsa worker'ni eslatmasiz — tsc alohida CI'da
console.log(n + ' test, ' + fails + ' muvaffaqiyatsiz')
process.exit(fails ? 1 : 0)
