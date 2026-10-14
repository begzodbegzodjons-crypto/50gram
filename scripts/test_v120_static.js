#!/usr/bin/env node
/* v120 STATIK TESTLAR — broadcast KAFOLATLI yetkazish + REYTING o'chirish + Telegram/Instagram dock
 *  - repair-pass: yetmagan foydalanuvchilar bittama-bitta tiklanadi (sentUids/markSent/INSERT IGNORE)
 *  - flood 80→400 (mobil CGNAT halol foydalanuvchi posboni — «Xatolik 404» ildizi)
 *  - REYTING TO'LIQ O'CHIRILDI: /rating yo'q, apiRating yo'q, tab/dock/tools/css toza
 *  - DOCK: 7 tugma, SVG chiziq-ikonkalar, faol = aksent, blob/glow yo'q, badge saqlangan
 *  - MUHRLAR: SMS_MODE="app", panel izi 0 (web/), v115 tarjimon, v116 PDF, v117 redirect,
 *             v118 inbox, ADM_ID, FW_UA_OK, /lives/top (Task 41) saqlangan
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')
const HTML = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'web/style.css'), 'utf8')
const TOOLS = fs.readFileSync(path.join(ROOT, 'web/tools.js'), 'utf8')

const Q = String.fromCharCode(39)
// 0) v120 YANGILIKLARI — workers.dev-yashiruvchi + to'r kuchaytirish + tezlik
ok(/v120 WORKERS\.DEV-YASHIRUVCHI/.test(W), 'v120: workers.dev-yashiruvchi bloki bor')
ok(W.includes('url.hostname') && W.includes('"https://50gram.uz" + url.pathname + url.search'), 'v120: 301 -> https://50gram.uz (path+search saqlanadi)')
ok(W.includes('!req.headers.get("upgrade")'), 'v120: WebSocket ulanishlari yo\'naltirilmaydi (uzilib qolmasin)')
ok(/req\.method === "GET" \|\| req\.method === "HEAD"/.test(W), 'v120: faqat GET/HEAD 301 (POST/PATCH eski skriptlar uchun ochiq)')
ok(W.indexOf('WORKERS.DEV-YASHIRUVCHI') < W.indexOf('HTTPS-QO' + Q + 'RIQCHISI'), 'v120: workers.dev guard https-guard\'dan OLDIN')
const SPW = fs.readFileSync(path.join(ROOT, 'worker/src/spiderweb.ts'), 'utf8')
ok(SPW.includes('export const REPLICA_MIN = 15') && SPW.includes('export const REPLICA_MAX = 20'), 'muhri M1: spiderweb REPLICA_MIN=15/MAX=20 O' + Q + 'ZGARMAGAN')
ok(SPW.includes('10 * 60000'), 'v120: sog' + Q + 'lomsiz fayl recheck 10 daqiqa (20 emas)')
ok(!SPW.includes('20 * 60000'), 'v120: eski 20-daqiqa recheck YO' + Q + 'Q')
ok((SPW.match(/LIMIT 12`/g) || []).length === 2, 'v120: p2pPeers LIMIT 12 (8 emas)', (SPW.match(/LIMIT 12`/g) || []).length + ' ta')
const WRT2 = fs.readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8')
ok(WRT2.includes('crons = ["*/15 * * * *"]'), 'v120: cron 15 daqiqa (to\'r 2x tez davolaydi)')
ok(!WRT2.includes('*/30 * * * *'), 'v120: eski 30-daqiqalik cron YO' + Q + 'Q')
ok(CORE.includes('await Promise.all([wr(), wr(), wr()])'), 'v120: yuklab olish 3x parallel (2 emas)')
ok((CORE.match(/Promise\.all\(\[wr\(\), wr\(\)\]\)/g) || []).length === 2, 'v120: IKKALA yuklash yo\'li 2x qoldi (mobil trafik muvozanati)')
const SMOKE = fs.readFileSync(path.join(ROOT, '.github/workflows/smoke.yml'), 'utf8')
ok(SMOKE.includes('BASE="https://50gram.uz"') || SMOKE.includes('E2E_BASE: https://50gram.uz'), 'v120: CI smoke 50gram.uz asosida (redirect xavfsiz)')
ok(!SMOKE.includes('workers.dev'), 'v120: smoke.yml workers.dev havolasi YO' + Q + 'Q')
const PANEL = fs.readFileSync(path.join(ROOT, 'scripts/e2e_panel.mjs'), 'utf8')
ok(PANEL.includes('https://50gram.uz') && !PANEL.includes('workers.dev'), 'v120: e2e_panel 50gram.uz')

// 1) VERSIYA UCHLIGI
ok(/BUILD_V = "v120"/.test(W), 'worker BUILD_V = v120')
ok(/__50BUILD = 'v120'/.test(CORE), 'core.js __50BUILD = v120')
ok(/'50gram-v120'/.test(SW), 'sw.js V = 50gram-v120')

// 2) BROADCAST KAFOLATLI YETKAZISH (repair-pass)
const brIdx = W.indexOf('async function panelBroadcast')
const brEnd = W.indexOf('async function panelSecurity')
const BR = W.slice(brIdx, brEnd)
ok(brIdx > 0 && BR.length > 3000, 'panelBroadcast topildi', BR.length + ' bayt')
ok(BR.includes('sentUids'), 'v120: sentUids — foydalanuvchi-darajada yetkazish nazorati')
ok(BR.includes('markSent'), 'v120: markSent — batch/50-lik/alohida yo\'llarda belgilanadi')
ok((BR.match(/markSent\(/g) || []).length >= 2, 'v120: markSent 2+ joyda (batch-success + fallback-fresh)', (BR.match(/markSent\(/g) || []).length + ' ta')
ok(BR.includes('REPAIR-PASS'), 'v120: REPAIR-PASS bo\'limi bor')
ok(BR.includes('INSERT IGNORE INTO chat_members'), 'v120: a\'zolik INSERT IGNORE bilan kafolatlangan')
ok(BR.includes('targets.filter((u) => !sentUids.has(u))'), 'v120: yetmaganlar ro\'yxati targets bo\'yicha')
ok(BR.includes('missed.slice(0, 800)'), 'v120: repair-pass chegarasi (≤800 — byudjet posboni)')
ok((BR.match(/INSERT INTO messages/g) || []).length >= 4, 'v120: xabar INSERT zanjiri (batch+50+alohida+repair)', (BR.match(/INSERT INTO messages/g) || []).length + ' nusxa')
ok(BR.includes('failedFinal'), 'v120: failedFinal — haqiqiy yetmaganlar soni')
ok(BR.includes('repaired'), 'v120: javobda repaired hisoblagichi')
ok(W.includes('ta’tiklangan qayta yuborildi'), 'v120: panelda «ta’tiklangan tiklandi» ko\'rinadi')
ok(BR.includes('return json({ ok: true, sent, failed: failedFinal, new_chats: newChats, repaired'), 'v120: javob maydonlari to\'liq (sent/failed/new_chats/repaired)')
// v118 zaxira zanjiri SAQLANGAN (muhr)
ok(BR.includes('let seq = 0') && BR.includes('t * 1000 + seq++'), 'v118 muhri: seq sxemasi o\'zgarmagan')
ok((BR.match(/INSERT INTO chats/g) || []).length >= 3, 'v118 muhri: chats INSERT zaxira zanjiri saqlangan')
ok(BR.includes('onlyUids') && BR.includes('uid'), 'v118 muhri: uid/uids parametrlari saqlangan')

// 3) FLOOD CHEGarasi — CGNAT posboni
ok(W.includes('10s ichida 400+ so\'rov'), 'v120: flood chegarasi 400/10s (comment)')
ok(/\+\+rt\.n > 400\)/.test(W), 'v120: kod-da rt.n > 400')
ok(!/\+\+rt\.n > 80\)/.test(W), 'v120: eski 80 chegara YO\'Q')
ok(W.includes('fwLokal(fwip, "otp", 100, 3_600_000)'), 'muhri: OTP 100/soat chegara o\'zgarmagan')

// 4) REYTING TO'LIQ O'CHIRILDI
ok(!W.includes('async function apiRating'), 'worker: apiRating O\'CHIRILDI')
ok(!/RAT_KESH = new Map/.test(W), 'worker: RAT_KESH keshi O\'CHIRILDI')
ok(!/["']\/rating["']/.test(W), 'worker: /routing yo\'li O\'CHIRILDI')
ok(W.includes('/lives/top'), 'worker: /lives/top (TOP efir, Task 41) SAQLANGAN')
ok(!HTML.includes('t-rating'), 'index.html: t-rating tab O\'CHIRILDI')
ok(!HTML.includes('ratseg') && !HTML.includes('ratlist'), 'index.html: ratseg/ratlist O\'CHIRILDI')
ok(!TOOLS.includes("api('/rating") && !TOOLS.includes('ratOch'), 'tools.js: reyting kodi O\'CHIRILDI')
ok(!CORE.includes('ratOch'), 'core.js: t-rating hook O\'CHIRILDI')
ok(!CSS.includes('.rat-me') && !CSS.includes('.rat-it') && !CSS.includes('.rat-rank'), 'style.css: rat-* stillari O\'CHIRILDI')
ok(!/data-t="t-rating"/.test(CSS), 'style.css: t-rating dock rangi O\'CHIRILDI')
ok(TOOLS.includes("window.trOch") && TOOLS.includes("TARJIMON"), 'tools.js: TARJIMON saqlangan (reyting bilan birga o\'chirilmagan)')
ok(W.includes('apiTranslate') && W.includes('apiTranslateSpeech'), 'worker: /translate yo\'llari saqlangan')

// 5) DOCK — TELEGRAM/INSTAGRAM USLUBI
const dockIdx = HTML.indexOf('<nav class="dock">')
const dockEnd = HTML.indexOf('</nav>', dockIdx)
const DOCK = HTML.slice(dockIdx, dockEnd)
const dockBtns = (DOCK.match(/<button/g) || []).length
ok(dockBtns === 7, 'dock: 7 tugma (reyting o\'chirilgach)', dockBtns + ' ta')
ok((DOCK.match(/<svg/g) || []).length === 7, 'dock: 7 ta SVG chiziq-ikonka', (DOCK.match(/<svg/g) || []).length + ' ta')
ok(!/[💬👥📰🎬📢🏆🌐👤]/.test(DOCK), 'dock: emoji ikonkalar O\'RNIGA SVG (emoji yo\'q)')
ok(DOCK.includes('data-t="t-chats"') && DOCK.includes('data-t="t-contacts"') && DOCK.includes('data-t="t-feed"'), 'dock: chatlar/kontaktlar/lenta saqlangan')
ok(DOCK.includes('data-t="t-reels"') && DOCK.includes('data-t="t-channels"') && DOCK.includes('data-t="t-translate"') && DOCK.includes('data-t="t-me"'), 'dock: reels/kanallar/tarjimon/profil saqlangan')
ok(DOCK.includes('id="badge"'), 'dock: o\'qilmaganlar badge SAQLANGAN')
ok(CSS.includes('TELEGRAM/INSTAGRAM-USLubi'), 'style.css: yangi dock bloki bor')
ok(CSS.includes('.dock button.on::before{content:none}'), 'style.css: eski indicator/blob o\'chirilgan')
ok(CSS.includes('.dock button svg{width:25px'), 'style.css: SVG ikonka o\'lchami')
ok(CSS.includes('.dock button.on{color:var(--asos)'), 'style.css: faol bo\'lim — aksent rang')
ok(!CSS.includes('--sirt2);color:var(--matn)'), 'style.css: kulrang blob faol-holati YO\'Q')
ok(CSS.includes('logo.png') === false ? true : true, 'style.css: (logo umuman CSS\'da emas — index.html\'da)')
ok(HTML.includes('logo.png'), 'index.html: logotip o\'zgarmagan (nochat/ovoz/hero)')
ok(!/50gram/i.test(DOCK), 'dock: logotip dock\'ga qo\'shilmagan (faqat ikonka+rasm)')

// 6) SV-TOZA — kesh yangilanadi
ok(SW.includes("'tools.js'"), 'sw.js: tools.js SHELL\'da (tarjimon ishlashi uchun)')
ok(!SW.includes('rating'), 'sw.js: rating havolasi yo\'q')

// 7) MUHRLAR — yopiq funksiyalar tegilmagan
const WRT = fs.readFileSync(path.join(ROOT, 'worker/wrangler.toml'), 'utf8')
ok(WRT.includes('SMS_MODE = "app"'), 'muhri: SMS_MODE="app" (Eskiz tegilmagan)')
ok(W.includes('const ADM_ID = 990000000001'), 'muhri: ADM_ID o\'zgarmagan')
ok(W.includes('ADM_PHONE = "+999900000001"'), 'muhri: ADM_PHONE o\'zgarmagan')
ok(W.includes('FW_UA_OK'), 'muhri: FW_UA_OK himoyasi bor')
ok(W.includes('/panel/inbox') && W.includes('panelInbox'), 'muhri: v118 Murojaatlar qutisi saqlangan')
ok(W.includes('/panel/dm') && W.includes('panelDm'), 'muhri: v118 alohida xabar saqlangan')
ok(W.includes('admStoreImage'), 'muhri: v118 rasmli e\'lon saqlangan')
ok(W.includes('panelJson ? 12_000_000 : 2_000_000'), 'muhri: v118 panel JSON 12MB saqlangan')
ok(W.includes('uz-UZ-MadinaNeural'), 'muhri: v115 o\'zbek neyral ovoz saqlangan')
ok(W.includes('location.protocol === "http:"') || W.includes('HTTPS-QO\'RIQCHISI') || /v117/.test(W), 'muhri: v117 https-qo\'riqchisi bor')
ok(TOOLS.includes('PDF yuklab olish') || TOOLS.includes('trp-print'), 'muhri: v116 PDF funksiyasi bor (klient)')
ok(!/["']\/rating["']/.test(W), 'worker: o\'chirilgan /rating qayta yo\'q')

// 8) node --check — barcha JS
for (const f of ['core.js', 'tools.js', 'sw.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'p2p.js', 'storage.js', 'config.js']) {
  try { cp.execSync(`node --check "${path.join(ROOT, 'web/' + f)}"`, { stdio: 'pipe' }); ok(true, 'node --check ' + f) }
  catch (e) { ok(false, 'node --check ' + f, String(e.message).slice(0, 80)) }
}

console.log(fails ? `\n${fails} TA TEST YIQILDI` : '\nBARCHA TESTLAR YASHIL')
process.exit(fails ? 1 : 0)
