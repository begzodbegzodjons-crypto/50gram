#!/usr/bin/env node
/* v118 STATIK TESTLAR — admin broadcast tuzatish + Murojaatlar (feedback qutisi)
 *  - 1062 ildizi: broadcast suhbat id'lari seq sxemasi (t*1000+seq), newId() yo'q
 *  - chats/chat_members INSERT zaxira zanjiri (batch → 50-lik → alohida)
 *  - /api/panel/* JSON 12MB (qolgan JSON 2MB o'zgarmas) + 413 flood-ochko panelga yo'q
 *  - GET /panel/inbox + ADMIN_HTML Murojaatlar bo'limi (o'qish/javob)
 *  - klient rasm posboni (10600000) + e'lon matni 8MB eslatmasi
 *  - MUHRLAR: SMS_MODE="app", panel izi 0 (web/), v115 tarjimon, v116 PDF, v117 redirect
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')
const HTML = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')

// 1) VERSIYA UCHLIGI
ok(/BUILD_V = "v118"/.test(W), 'worker BUILD_V = v118')
ok(/__50BUILD = 'v118'/.test(CORE), 'core.js __50BUILD = v118')
ok(/'50gram-v118'/.test(SW), 'sw.js V = 50gram-v118')

// 2) BROADCAST 1062 TUZATISHI — noyob suhbat id'lari (seq sxemasi)
const brIdx = W.indexOf('async function panelBroadcast')
const brEnd = W.indexOf('async function panelSecurity')
const BR = W.slice(brIdx, brEnd)
ok(brIdx > 0 && BR.length > 3000, 'panelBroadcast topildi', BR.length + ' bayt')
ok(BR.includes('let seq = 0'), 'v118: seq hisoblagichi bor (let seq = 0)')
ok(BR.includes('t * 1000 + seq++'), 'v118: suhbat id = t*1000+seq (kafolatlangan noyob)')
// suhbat-yaratish bo'lakida newId() YO'Q (xabar zaxirasida bo'lishi mumkin — muammo SUHBAT id'larida edi)
const chatGen = BR.slice(BR.indexOf('const chatIds: number[] = []'), BR.indexOf("// xabar id'lari: t*1000+seq"))
ok(chatGen.includes('t * 1000 + seq++') && !chatGen.includes('newId()'), 'v118: broadcastda suhbat uchun newId() YO\'Q (1062 ildizi yo\'qoldi)')
ok(BR.includes('const okChat = new Set<number>()'), 'v118: okChat — muvaffaqiyatli suhbatlar to\'plami')
ok(BR.includes('mrowByChat'), 'v118: mrowByChat — WS bildirishnoma uchun xabar xaritasi')
ok((BR.match(/INSERT INTO chats/g) || []).length >= 3, 'v118: chats INSERT zaxira zanjiri (asosiy+50-lik+alohida)', (BR.match(/INSERT INTO chats/g) || []).length + ' nusxa')
ok((BR.match(/INSERT INTO chat_members/g) || []).length >= 3, 'v118: chat_members INSERT zaxira zanjiri')
ok(BR.includes('onlyUids'), 'v118: uids massiv parametri (tanlangan guruhga + E2E ko\'p-suhbat sinovi)')
ok(BR.includes('WHERE id IN (${onlyUids.join(",")})'), 'v118: uids WHERE IN (raqamlashtirilgan — in\'ektsiyasiz)')
// xabar id'lari ham seq bilan — hamma j maslahati noyob
ok(BR.includes('const row = [t * 1000 + seq++'), 'v118: xabar id = t*1000+seq (j emas — suhbat o\'chirilsa ham noyob)')

// 3) JSON HAJMI — panel 12MB, qolganlar 2MB
ok(W.includes('url.pathname.startsWith("/api/panel/")') && W.includes('panelJson ? 12_000_000 : 2_000_000'), 'v118: JSON chegarasi — panel 12MB / qolganlar 2MB')
ok(/fwip && !panelJson\) fwOchko/.test(W), 'v118: 413 flood-ochko panel yo\'llarida YO\'Q (ego o\'zi bloklanmaydi)')
// 2MB boshqa JSON uchun saqlangan (avatar va h.k. himoyasi)
ok(W.includes('clen > (panelJson ? 12_000_000 : 2_000_000)'), 'v118: umumiy 413 gate yangilangan')

// 4) MUROJAATLAR QUTISI (server)
const inbIdx = W.indexOf('async function panelInbox')
const inbEnd = W.indexOf('// v106: KANAL/GURUH MODERATSIYASI')
const INB = W.slice(inbIdx, inbEnd)
ok(inbIdx > 0 && INB.length > 1500, 'panelInbox funksiyasi bor', INB.length + ' bayt')
ok(INB.includes('admAuth(c)'), 'panelInbox: admAuth (adm-token tekshiruvi)')
ok(INB.includes('searchParams.get("chat")'), 'panelInbox: bitta suhbat ko\'rish (?chat=ID)')
ok(INB.includes('MAX(id) AS mid FROM messages') && INB.includes('GROUP BY chat_id'), 'panelInbox: oxirgi xabar derived-table orqali (TiDB ON-subquery cheklovi chetlab o\'tilgan)')
ok(INB.includes("m.sender_id=u.id AND m.sender_id<>" + 'ADM_ID'.replace('ADM_ID', '${ADM_ID}')) || INB.includes('m.sender_id=u.id AND m.sender_id<>${ADM_ID}'), 'panelInbox: «javob kutilyapti» filtri (oxirgi xabar foydalanuvchidan)')
ok(INB.includes('ccOf('), 'panelInbox: davlat kodi hisoblanadi')
ok(/\["GET", "\/panel\/inbox", panelInbox, true\]/.test(W), 'yo\'l ro\'yxatida /panel/inbox (adm-token bilan)')

// 5) PANEL HTML — Murojaatlar bo'limi
ok(W.includes('<button data-t="in">Murojaatlar</button>'), 'panel: «Murojaatlar» tab tugmasi')
ok(W.includes('<section id="in" class="hidden">'), 'panel: #in seksiya')
ok(W.includes('function loadInbox()'), 'panel: loadInbox()')
ok(W.includes("api('inbox')"), 'panel: GET /panel/inbox chaqiriladi')
ok(W.includes('function inboxChat('), 'panel: inboxChat() — suhbat tarixi oynasi')
ok(W.includes('function inboxReply('), 'panel: inboxReply() — javob berish')
ok(W.includes("api('dm','POST',{id:uid,body:v})"), 'panel: javob /panel/dm orqali («50gram admin» nomidan)')
ok(W.includes('function inbPrev('), 'panel: inbPrev() — rasm/fayl/ovoz oldindan ko\'rish')
ok(W.includes("if(t==='in')loadInbox()"), 'panel: switchTab Murojaatlarni yuklaydi')
ok(W.includes("if(cur==='in')loadInbox()"), 'panel: Yangilash tugmasi Murojaatni ham yangilaydi')

// 6) KLIENT RASM POSBONI
ok(W.includes('10600000'), 'panel: >10.6MB base64 rasm shifrlashdan OLDIN rad etiladi (≈8MB bayt)')
ok(W.includes('8 MB gacha; katta rasmlar avtomatik siqiladi'), 'panel: e\'lon matnida 8MB eslatma')

// 7) MUHRLAR — hech narsa buzilmagan
ok(W.includes('SMS_MODE = "app"') || fs.readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8').includes('SMS_MODE = "app"'), 'MUHR: Eskiz SMS_MODE="app" tegilmagan')
ok(W.includes('/?adminpanel') || W.includes('adminpanel'), 'MUHR: maxfiy admin panel joyida')
ok(/FW_UA_OK/.test(W), 'MUHR: FW_UA_OK (brauzer/app UA ro\'yxati) joyida')
ok(W.includes('const TR_LANGS'), 'MUHR: v115 tarjimon tillari (TR_LANGS) joyida')
ok(W.includes('uz-UZ-MadinaNeural'), 'MUHR: v115 o\'zbek neyral ovozi joyida')
ok(W.includes('pdfHujjat') || true, 'MUHR: v116 PDF (web/tools.js — alohida tekshiriladi)')
ok(fs.readFileSync(path.join(ROOT, 'web/tools.js'), 'utf8').includes('pdfHujjat'), 'MUHR: v116 PDF eksport (web/tools.js) joyida')
ok(W.includes('url.protocol === "http:"') && W.includes('v117 HTTPS-QO\'RIQCHISI'), 'MUHR: v117 http→https qo\'riqchisi joyida (worker)')
// web/ ichida panel izi YO'Q
let webPanel = false
for (const f of ['index.html', 'core.js', 'app.js', 'tools.js', 'sw.js']) {
  const p = path.join(ROOT, 'web', f)
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('adminpanel')) webPanel = true
}
ok(!webPanel, 'MUHR: web/ fayllarida panel izi 0 bayt')
ok(!CORE.includes('adminpanel') && !CORE.includes('/panel/') && !HTML.includes('adminpanel'), 'MUHR: ilova kodida admin-panel yo\'l nomi yo\'q')

// 8) SINTAKSIS
for (const f of ['web/core.js', 'web/sw.js', 'web/tools.js']) {
  try { cp.execSync('node --check ' + path.join(ROOT, f), { stdio: 'pipe' }); ok(true, 'sintaksis: ' + f) }
  catch (e) { ok(false, 'sintaksis: ' + f, String(e.message).slice(0, 80)) }
}
// ADMIN_HTML JS bo'laklari — qo'pol sintaksis nazorati (String.raw ichida shuning uchun qo'lda)
const adminStart = W.indexOf('const ADMIN_HTML = String.raw')
const adminJs = W.slice(adminStart, W.indexOf('</html>`', adminStart))
for (const fn of ['function loadInbox(){', 'function inboxChat(chatId){', 'function inboxReply(uid,chatId){', 'function inbPrev(m){']) {
  ok(adminJs.includes(fn), 'ADMIN_HTML: ' + fn.replace(' {', ''))
}
// inbox modal uchun .wide klass mavjudligi (mc.wide CSS)
ok(adminJs.includes("classList.add('wide')"), 'ADMIN_HTML: modal wide rejimi')

console.log('')
if (fails) { console.log('✗ ' + fails + ' TEST YIQILDI'); process.exit(1) }
console.log('✓ BARCHA v118 STATIK TESTLAR O\'TDI')
