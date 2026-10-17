#!/usr/bin/env node
/* v133 STATIK TESTLAR — «KANALLAR SAHIFASIDA QIDIRUV (kanal va guruhlarni izlash)»
 *  Foydalanuvchi: "kanal va gruppa sahifasida kanal va gruppalarni izlash funksiyasi yo'q —
 *  shuni ham qo'sh, boshqa hech narsaga tegma"
 *
 *  NIMA QO'SHILDI (faqat web/index.html +1 qator va web/manage.js QO'SHIMCHA blok):
 *   - #chq input (.search uslubi — kontaktlar tabidagi bilan bir xil ko'rinish)
 *   - chanQDraw(): «Mening kanal va guruhlarim» (lokal filtri — yopiq xususiylar ham) +
 *     «Topilgan kanal va guruhlar» (mavjud /search API — public chatlar) bo'limlari
 *   - renderChannels O'RAMI (chat.js openChat-orami namunasi) — qidiruv faol bo'lsa
 *     natijalar saqlanadi, bo'shatilsa oddiy ko'rinish qaytadi
 *   - natija-qatorlari data-sr belgisida — mavjud data-ch handleri 0 ta'sir
 *  MUHRLAR: v122/v123/v124/v127/SMS/TURN + v128 tezlik + v129/v130 audio + v131 sessiya +
 *  v132 (chatlar ro'yxati menyusi) — hammasi saqlangan. Worker'da FAQAT versiya-satri.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const RTC = fs.readFileSync(path.join(ROOT, 'web/rtc.js'), 'utf8')
const CHAT = fs.readFileSync(path.join(ROOT, 'web/chat.js'), 'utf8')
const MANAGE = fs.readFileSync(path.join(ROOT, 'web/manage.js'), 'utf8')
const HTML = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')

console.log('— 1) YANGI QIDIRUV (faqat QO\'SHIMCHA)')
ok(HTML.includes('<div class="search"><input id="chq" placeholder="🔎 Kanal va guruhlarni izlash" autocomplete="off"></div>'), 'index.html: #chq qidiruv-maydoni (.search uslubida)')
ok(HTML.indexOf('id="chq"') > HTML.indexOf('id="t-channels"') && HTML.indexOf('id="chq"') < HTML.indexOf('id="chanlist"'), '#chq aynan kanallar tabida (header bilan chanlist orasida)')
ok(MANAGE.includes('function chanQDraw()'), 'chanQDraw funksiyasi bor')
ok(MANAGE.includes('const chanQMatch = (c, q) => (c.title || \'\').toLowerCase().includes(q) || (c.username || \'\').toLowerCase().includes(q)'), 'nom + @username bo\'yicha lokal moslashtirish')
ok(MANAGE.includes("api('/search?q=' + encodeURIComponent(v))"), 'ommati qidiruvi mavjud /search API orqali (backend TEGILMAGAN)')
ok(MANAGE.includes("(r.chats || []).filter((c) => c.type !== 'direct')"), 'natijalar FAQAT kanal/guruh (direct + users chetlatilgan)')
ok(MANAGE.includes('chanQDraw() // DARHOL'), 'lokal filtr DARHOL chizadi (tarmoq kutmaydi)')
ok(MANAGE.includes('if (chanQ !== v) return'), 'poyga-himoya: eski javob tashlanadi (300ms debounce + javob-tekshiruvi)')
ok(MANAGE.includes('«${esc(chanQ)}» bo‘yicha hech narsa topilmadi'), 'bo\'sh natija holati (o\'zbekcha xabar)')

console.log('— 2) ESKI KO\'RINISH SAQLANGAN (renderChannels orami)')
ok(MANAGE.includes('const _renderChannels = renderChannels'), 'asl renderChannels ushlab olingan (chat.js orami namunasi)')
ok(MANAGE.includes('if (chanQ) return chanQDraw()'), 'qidiruv faol — natijalar saqlanadi (fon-yangilanish buzmaydi)')
ok(MANAGE.includes('return _renderChannels()'), 'qidiruv yo\'q — ASL renderChannels to\'liq ishlaydi')
ok(MANAGE.includes('if (!chanQ) return renderChannels()'), 'input bo\'shatilsa oddiy ko\'rinish qaytadi')

console.log('— 3) MAVJUD HANDLERLAR 0 TA\'SIR')
ok(MANAGE.includes("$('chanlist').addEventListener('click', (e) => {\n  if (e.target.closest('[data-more]')) { discShow += 30; if (chanDrawRef) chanDrawRef(); return }\n  const it = e.target.closest('[data-ch]'); if (!it) return"), 'asl data-ch handleri HARFMA-HARF saqlangan')
ok(MANAGE.includes('data-sr="${c.id}"'), 'yangi qatorlar O\'Z belgisida (data-sr) — data-ch bilan TO\'QNASHUV YO\'Q')
ok(MANAGE.includes("const it = e.target.closest('[data-sr]'); if (!it) return"), 'natijalar uchun ALOHIDA listener (eski handler tegilmagan)')
ok(MANAGE.includes('if (c && c.joined !== false) return openChat(id)'), 'qo\'shilgan chat → to\'g\'ridan openChat (kanallar tabi bilan bir xil)')
ok(MANAGE.includes('if (d) chatPreview(d)'), 'qo\'shilmagan → chatPreview (discover bilan bir xil yo\'l)')
ok(MANAGE.includes('async function renderChannels()'), 'asl renderChannels funksiyasi mavjud (o\'chirilmagan)')

console.log('— 4) WORKER TEGILMAGAN (/search + /discover)')
ok(W.includes('["GET", "/search", search]') || /"GET",\s*"\/search"/.test(W), '/search route saqlangan')
ok(W.includes('type<>\'direct\' AND is_public=1'), 'search: public chatlar filtri saqlangan')
ok(W.includes('["GET", "/discover", discover]'), '/discover route saqlangan (kanallar ro\'yxati)')

console.log('— 5) MEROS MUHRLARI (v122/v123/v124/v127/SMS/TURN + v131 sessiya)')
ok(!W.includes('301 https://50gram.uz" + url.pathname'), 'v122: workers.dev 301 YO\'Q')
ok(W.includes('prev_sess'), 'v123/v124: sessiya-otish davri saqlangan')
ok(W.includes('String(a.role || "") !== "egasi"'), 'v127: panel faqat egasi')
ok(W.includes('if (uname && uname !== "egasi") return badTry()'), 'v127: boshqa admin logini yopilgan')
ok(W.includes('SMS_MODE'), 'SMS_MODE="app" tegilmagan')
ok(W.includes('turn:openrelay.metered.ca:80'), 'TURN openrelay o\'zgarmagan')
ok(/async function authRefresh\(c: C\)/.test(W), 'v131: authRefresh saqlangan')
ok(/async function g50SessRestore\(\)/.test(CORE), 'v131: g50SessRestore saqlangan')

console.log('— 6) v128/v129/v130 + v132 MUHRLARI')
ok(RTC.includes('const icePreWarm = () =>') && RTC.includes('CALL && !CALL.started ? 600 : 1800'), 'v128: tezlik-qanot saqlangan')
ok(RTC.includes('async function decoderPreWarm(C)'), 'v129: dekoder-prewarm saqlangan')
ok(RTC.includes('lv.srcObject = null') && RTC.includes('lv.srcObject = C.local'), 'v130: o\'z-oyna qorovuli saqlangan')
ok(CORE.includes('function chatCtxMenu(id)') && CORE.includes('data-k="del"'), 'v132: chatlar ro\'yxati menyusi saqlangan')
ok(CORE.includes("$('chatlist').addEventListener('click', (e) => { const it = e.target.closest('[data-chat]'); if (it) openChat(+it.dataset.chat) })"), 'v132: chat ro\'yxati oddiy bosishi saqlangan')

console.log('— 7) VERSIYA UCHLIGI v133')
ok(W.includes('const BUILD_V = "v133"'), 'worker BUILD_V v133')
ok(CORE.includes("window.__50BUILD = 'v133'"), 'core.js __50BUILD v133')
ok(SW.includes("const V = '50gram-v133'"), 'sw.js V v133')
ok(!W.includes('const BUILD_V = "v132"') && !CORE.includes("__50BUILD = 'v132'") && !SW.includes("'50gram-v132'"), 'eski v132 izlari QOLMAGAN')

console.log('— 8) SINTAKSIS (node --check ×10)')
for (const f of ['web/core.js', 'web/sw.js', 'web/rtc.js', 'web/chat.js', 'web/manage.js', 'web/tools.js', 'web/storage.js', 'web/p2p.js', 'web/social.js', 'web/local-store.js']) {
  let r = 'OK'
  try { cp.execSync('node --check ' + path.join(ROOT, f), { stdio: 'pipe' }) } catch (e) { r = String(e.stderr || e).slice(0, 120) }
  ok(r === 'OK', f, r)
}

console.log(fails === 0 ? '\nHAMMASI YASHIL — v133 statik testlar toza' : '\n' + fails + ' TA MUAMMO!')
process.exit(fails ? 1 : 0)
