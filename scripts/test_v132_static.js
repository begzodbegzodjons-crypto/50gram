#!/usr/bin/env node
/* v132 STATIK TESTLAR — «CHATLAR RO'YXATI: BOSIB TURISH MENYUSI (Tozalash / O'chirish)»
 *  Foydalanuvchi: "chatlar bo'limida kimlar bilan gaplashgan akkaunt ustiga bosib turganda
 *  funksiya chiqib o'chirish va tozalash degan funksiya yo'q — yozishgan akkaunlarni o'chirish
 *  imkoniyati funksiyasi yo'q shuni joriy qil — boshqa xech qaysi funksiyani o'zgartirma"
 *
 *  NIMA QO'SHILDI (faqat web/core.js — QO'SHIMCHA blok, hech narsa o'zgartirilmagan):
 *   - chatCtxMenu(id): chatlar ro'yxati elementi ustida meny — «Suhbatni tozalash» + «O'chirish»
 *   - 480ms bosib-turish (touchstart/touchmove/touchend) + contextmenu (kompyuter o'ng-tugma)
 *   - Ruxsatlar server bilan aynan mos: direct — a'zo o'zi; guruh/kanal — tozalash admin/owner,
 *     o'chirish faqat egasi (worker deleteChat/clearChat TEGILMAGAN — mavjud yo'llar ishlatildi)
 *   - O'chirishdan keyingi kesh-tozalash WS 'chat_deleted' xandleri bilan bir xil (idempotent)
 *  MUHRLAR: R1/R2/R5, M1/M2/M3 (v96), v122 (301 yo'q), v123/v124 (sessiya), v127 (panel faqat
 *  egasi), SMS_MODE="app", TURN-openrelay, v128 (tezlik), v129 (dekoder-detektor), v130
 *  (o'z-oyna qorovuli), v131 (sessiya o'lmaydi — /auth/refresh + uch nusxa) — hammasi saqlangan.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const RTC = fs.readFileSync(path.join(ROOT, 'web/rtc.js'), 'utf8')
const CHAT = fs.readFileSync(path.join(ROOT, 'web/chat.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')

console.log('— 1) YANGI MENYU (chatCtxMenu — faqat QO\'SHIMCHA)')
ok(CORE.includes('function chatCtxMenu(id)'), 'chatCtxMenu funksiyasi bor')
ok(CORE.includes('data-k="clear"'), '«Suhbatni tozalash» elementi')
ok(CORE.includes('data-k="del"'), '«O\'chirish» elementi')
ok(CORE.includes("if (k === 'clear') return clearChatConfirm(c)"), 'Tozalash mavjud clearChatConfirm orqali (yangi kod YO\'Q — ishonchli yo\'l)')
ok(CORE.includes("await del('/chats/' + id)"), 'O\'chirish mavjud DELETE /chats/:id yo\'li orqali')
ok(CORE.includes("const canClear = c.type === 'direct' || adm"), 'Tozalash ruxsati: direct yoki admin/owner')
ok(CORE.includes("const canDel = c.type === 'direct' || owner"), 'O\'chirish ruxsati: direct yoki faqat egasi')
ok(CORE.includes("if (!canClear && !canDel) return"), 'Ruxsatsiz chatda meny OCHMAYDI (403 o\'lik-tugma yo\'q)')
ok(CORE.includes("S.chats.delete(id); S.msgs.delete(id)"), 'O\'chirilgach kesh-tozalash (chat_deleted xandleri bilan bir xil)')
ok(CORE.includes("IDB.del('chats', S.me.id + ':' + id)"), 'IDB chat-yozuvi ham tozalanadi')
ok(CORE.includes("if (S.cur === id) closeChat()"), 'Ochiq turgan chat o\'chirilsa yopiladi')

console.log('— 2) BOSIB TURISH + O\'NG-TUGMA (msg ctxMenu bilan bir xil pattern)')
ok(CORE.includes("clPress = setTimeout(() => { clPress = -1; chatCtxMenu(+it.dataset.chat) }, 480)"), '480ms bosib-turish (xabarlar menyusi bilan bir xil)')
ok(CORE.includes("if (clPress === -1) e.preventDefault(); else clearTimeout(clPress); clPress = 0"), 'touchend: ghost-click to\'xtatiladi (menyudan keyin chat OCHMAYDI)')
ok(CORE.includes("addEventListener('touchmove', () => { if (clPress > 0) clearTimeout(clPress) }"), 'touchmove: surilsa bekor (scroll ishlaydi)')
ok(CORE.includes("addEventListener('contextmenu', (e) => { const it = e.target.closest('[data-chat]'); if (it) { e.preventDefault(); chatCtxMenu(+it.dataset.chat) } })"), 'kompyuter: o\'ng-tugma menyusi')
ok(CORE.includes("addEventListener('touchstart', (e) => {\n  const it = e.target.closest('[data-chat]')"), 'touchstart faqat [data-chat] elementida')

console.log('— 3) ESKI FUNSKIYALAR O\'ZGARMAGAN (faqat qo\'shimcha)')
ok(CORE.includes("$('chatlist').addEventListener('click', (e) => { const it = e.target.closest('[data-chat]'); if (it) openChat(+it.dataset.chat) })"), 'oddiy bosish → openChat O\'ZGARMAGAN')
ok(CORE.indexOf('chatCtxMenu') > CORE.indexOf("openChat(+it.dataset.chat) })"), 'yangi blok MAVJUD handlerdan KEYIN qo\'shilgan (tilim yo\'q)')
ok(CHAT.includes('function clearChatConfirm(c)'), 'chat.js clearChatConfirm TEGILMAGAN')
ok(CORE.includes('function renderChats()'), 'renderChats TEGILMAGAN (funksiya bor)')

console.log('— 4) WORKER MUHRLARI (deleteChat/clearChat tegilmagan)')
ok(W.includes('async function deleteChat(c: C)'), 'deleteChat mavjud (bevosita suhbat — a\'zo o\'zi)')
ok(W.includes('if (ch.type === "direct") { if (!m) fail("Ruxsat yo‘q", 403) }'), 'direct-chat o\'chirish ruxsati O\'ZGARMAGAN')
ok(W.includes('else if (ch.owner_id !== c.uid) fail("Faqat egasi o‘chira oladi", 403)'), 'guruh/kanal: faqat egasi (saqlangan)')
ok(W.includes('["DELETE", "/chats/:id", deleteChat]'), 'route: DELETE /chats/:id saqlangan')
ok(W.includes('["DELETE", "/chats/:id/messages", clearChat]'), 'route: DELETE /chats/:id/messages (tozalash) saqlangan')
ok(W.includes('SUHBATNI TOZALASH'), 'clearChat izoh-muhri saqlangan')

console.log('— 5) MEROS MUHRLARI (v122/v123/v124/v127/SMS/TURN)')
ok(!W.includes('301 https://50gram.uz" + url.pathname'), 'v122 muhri: workers.dev 301 YO\'Q')
ok(W.includes('prev_sess'), 'v123/v124: sessiya-otish davri saqlangan')
ok(W.includes('String(a.role || "") !== "egasi"'), 'v127: panel faqat egasi (admAuth)')
ok(W.includes('if (uname && uname !== "egasi") return badTry()'), 'v127: boshqa admin logini yopilgan')
ok(W.includes('SMS_MODE'), 'SMS_MODE="app" tegilmagan')
ok(W.includes('turn:openrelay.metered.ca:80'), 'TURN bepul (openrelay) o\'zgarmagan')
ok(W.includes('AbortSignal.timeout(3500)'), '/ice 3.5s server-timeout saqlangan')

console.log('— 6) v128 TEZLIK MUHRLARI (rtc.js)')
ok(RTC.includes('const icePreWarm = () =>'), 'ICE pre-warm saqlangan')
ok(RTC.includes('CALL && !CALL.started ? 600 : 1800'), 'adaptiv polling saqlangan')
ok(RTC.includes('sdp: { type: \'offer\', sdp: o.sdp }'), 'SDP-darhol saqlangan')
ok(RTC.includes('freshAudioUniverse(CALL)'), 'M1 audio-sikl saqlangan')
ok(RTC.includes('offer FAQAT chaqiruvchida. restartIce ham faqat chaqiruvchida'), 'R1 muhri saqlangan')

console.log('— 7) v129/v130 AUDIO MUHRLARI (rtc.js — Task 75/76 tuzatishlari)')
ok(RTC.includes('async function decoderPreWarm(C)'), 'v129: decoderPreWarm saqlangan')
ok(RTC.includes("dInA > 4000 && dSmpl === 0 && dKon === 0"), 'v129: dekoder-o\'lik detektori saqlangan')
ok(RTC.includes('C.micSilN = (C.micSilN || 0) + 1'), 'v129: mikro-jim alohida hisoblagich')
ok(RTC.includes('lv.srcObject = null') && RTC.includes('lv.srcObject = C.local'), 'v130: o\'z-oyna null→qayta bog\'lash (kichik-oyna qotishi)')
ok(RTC.includes('rv.srcObject = null') && RTC.includes('rv.srcObject = C.remote'), 'v130: masofa-oyna qorovuli')

console.log('— 8) v131 SESSIYA MUHRLARI (core.js — deploy sessiyani O\'LDIRMAYDI)')
ok(/async function authRefresh\(c: C\)/.test(W), 'v131 worker: authRefresh saqlangan')
ok(/\["POST", "\/auth\/refresh", authRefresh\]/.test(W), 'v131 worker: /auth/refresh route saqlangan')
ok(/function applyToken\(t\)/.test(CORE), 'v131 klient: applyToken (uch nusxa) saqlangan')
ok(/async function g50SessRestore\(\)/.test(CORE), 'v131 klient: g50SessRestore saqlangan')
ok(/if \(S\.token\) IDB\.put\('kv', 'sess', \{ token: S\.token, me: S\.me \}\)/.test(CORE), 'v131 klient: IDB sess-nusxa saqlangan')

console.log('— 9) VERSIYA UCHLIGI v132')
ok(W.includes('const BUILD_V = "v132"'), 'worker BUILD_V v132')
ok(CORE.includes("window.__50BUILD = 'v132'"), 'core.js __50BUILD v132')
ok(SW.includes("const V = '50gram-v132'"), 'sw.js V v132')
ok(!W.includes('const BUILD_V = "v131"') && !CORE.includes("__50BUILD = 'v131'") && !SW.includes("'50gram-v131'"), 'eski v131 izlari QOLMAGAN')

console.log('— 10) SINTAKSIS (node --check)')
for (const f of ['web/core.js', 'web/sw.js', 'web/rtc.js', 'web/chat.js', 'web/tools.js', 'web/manage.js', 'web/storage.js', 'web/p2p.js', 'web/social.js', 'web/local-store.js']) {
  let r = 'OK'
  try { cp.execSync('node --check ' + path.join(ROOT, f), { stdio: 'pipe' }) } catch (e) { r = String(e.stderr || e).slice(0, 120) }
  ok(r === 'OK', f, r)
}

console.log(fails === 0 ? '\nHAMMASI YASHIL — v132 statik testlar toza' : '\n' + fails + ' TA MUAMMO!')
process.exit(fails ? 1 : 0)
