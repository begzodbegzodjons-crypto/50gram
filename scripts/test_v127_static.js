#!/usr/bin/env node
/* v127 STATIK TESTLAR — «PANEL FAQAT EGASI + AKKAUNT ICHIDA AVTOMATIK BOSHQARUV»
 *  Foydalanuvchi: "dasturni boshqaruvchisi faqat men o'zim — boshqa dasturga umuman
 *  admin qo'shish niyatim yo'q, barchasini o'zim bajaraman ... har bir foydalanuvchi
 *  kanal gruppa ochsa o'zi admin funksiyalarini akkauntini ichida avtomatik boshqarish"
 *  v127-1 PANEL FAQAT EGASI:
 *   1) panelLogin: boshqa admin loginlari BUTUNLAY yopiladi (badTry — brute-posbon)
 *   2) admAuth: roli != egasi bo'lgan token DARHOL o'ladi (401)
 *   3) panelAdminsAdd: boshqa admin qo'shish 403 (butunlay o'chirilgan)
 *   4) Panel UI: «Adminlar» tab O'CHIRILGAN, loadAdmins/o'chirilgan, egasi eslatma
 *  v127-2 AKKAUNT ICHIDA AVTOMATIK BOSHQARUV:
 *   5) Server: kanal/guruh yaratgan foydalanuvchi role='owner' (avtomatik admin)
 *   6) Klient: «👑 Mening boshqaruvim» — akkauntda AVTOMATIK bo'lim (myAdminRows)
 *  MUHRLAR: v126 (boshqaruv markazi), v125, v124, v123, v122, versiya uchligi v127.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process')
const ROOT = path.join(__dirname, '..')
let fails = 0
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++ }

const W = fs.readFileSync(path.join(ROOT, 'worker/src/index.ts'), 'utf8')
const A = fs.readFileSync(path.join(ROOT, 'worker/src/auth.ts'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'web/core.js'), 'utf8')
const SW = fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')
const MG = fs.readFileSync(path.join(ROOT, 'web/manage.js'), 'utf8')

console.log('— 1) PANEL FAQAT EGASI: LOGIN (v127-1)')
ok(W.includes('if (uname && uname !== "egasi") return badTry()'), 'boshqa admin loginlari BUTUNLAY yopilgan (badTry)')
ok(W.includes('v127: PANEL FAQAT EGASI — boshqa admin loginlari BUTUNLAY yopildi'), 'izoh-muhir (login)')
ok(W.includes('const want = str(c.env.ADMIN_PASS || "Balandtoglar1", 64)'), 'egasi paroli env master (o\'zgarmagan)')
ok(W.includes('const pass = str(c.b.pass ?? c.b.p, 64)'), 'eski {pass} formati saqlangan (CI E2E mos)')
ok(W.includes('fwLokal(ip, "auth", 12, 24 * 3_600_000)'), 'brute-posbon saqlangan (12/1soat → 24soat)')
ok(W.includes('INSERT IGNORE INTO panel_admins(username'), 'panelBootstrap: egasi satr kafolati')

console.log('— 2) PANEL FAQAT EGASI: admAuth (v127-1)')
ok(W.includes('String(a.role || "") !== "egasi"') && W.includes('v127: PANEL FAQAT EGASI — boshqa roldagi'), 'egasi-emas token DARHOL o\'ladi (401)')
ok(W.includes('async function admAuth'), 'admAuth saqlangan (har panel-so\'rovida)')

console.log('— 3) ADMIN QO\'SHISH BUTUNLAY YO\'Q (v127-1)')
ok(W.includes('fail("Boshqa admin qo‘shish o‘chirilgan — panel faqat dastur egasiga tegishli (v127)", 403)'), 'panelAdminsAdd → 403 (doim)')
ok(W.includes('["POST", "/panel/admins/add", panelAdminsAdd, true]'), 'yo\'l ro\'yxatda qoladi (403 javob)')
ok(!/INSERT INTO panel_admins\(username, pass_hash/.test(W), 'DB\'ga yangi admin YOZISHI MUMKIN EMAS (INSERT yo\'q)')
ok(W.includes('row.role === "egasi") fail("Egasi hisobi o\'zgartirilmaydi'), 'egasi hisobi himoyasi saqlangan (set/del)')

console.log('— 4) PANEL UI: ADMINLAR TAB YO\'Q (v127-1)')
ok(!W.includes('<button data-t="ad">Adminlar</button>'), '«Adminlar» tab tugmasi O\'CHIRILGAN')
ok(W.includes('v127: ADMINLAR BO'), 'section eslatma-muhiri bor')
ok(W.includes('Bu panel FAQAT dastur egasiga tegishli'), 'egasi eslatmatni matni')
ok(!W.includes('function loadAdmins()'), 'loadAdmins funksiyasi O\'CHIRILGAN')
ok(!W.includes("$('adadd')"), 'adadd handler O\'CHIRILGAN')
ok(!W.includes("if(t==='ad')loadAdmins()") && !W.includes("if(cur==='ad')loadAdmins()"), 'loadAdmins chaqiruvlari yo\'q')
ok(W.includes("var NEED={rp:'reports',an:'analitika',md:'media',mn:'payments',tk:'tickets',sz:'settings'}"), 'NEED xaritasi ad\'siz (toza)')
ok(!W.includes('.tabs button[data-t=ad]'), 'tab-selector qoldig\'i yo\'q')

console.log('— 5) SERVER: YARATGAN ODAM AVTOMATIK ADMIN (v127-2)')
ok(W.includes("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'owner',?)"), 'kanal/guruh yaratuvchi role=\'owner\' (avtomatik)')
ok(W.includes("role IN ('owner','admin')"), 'owner+admin admin-hisoblanadi (msg/pin/a\'zolar)')

console.log('— 6) KLIENT: AKKAUNT ICHIDA AVTOMATIK BOSHQARUV (v127-2)')
ok(MG.includes('function myAdminRows()'), 'myAdminRows — avtomatik bo\'lim')
ok(MG.includes('👑 Mening boshqaruvim'), '«Mening boshqaruvim» sarlavhasi')
ok(MG.includes('${myAdminRows()}'), 'renderMe ICHIDA avtomatik joylashgan (akkaunt)')
ok(MG.includes("c.role === 'owner' || c.role === 'admin'"), 'egasi/admin chatlari filtri')
ok(MG.includes("row('adm-' + c.id"), 'har chat uchun boshqaruv qatori')
ok(MG.includes("a.startsWith('adm-')"), 'bosish → openChatInfo (to\'liq admin panel)')
ok(MG.includes('async function openChatInfo'), 'openChatInfo saqlangan (a\'zolar/so\'rovlar/tahrir/ruxsatlar)')

console.log('— 7) VERSIYA UCHLIGI v127')
ok(/BUILD_V = "v127"/.test(W), 'worker BUILD_V = v127')
ok(/__50BUILD = 'v127'/.test(CORE), 'core.js __50BUILD = v127')
ok(/'50gram-v127'/.test(SW), 'sw.js V = 50gram-v127')

console.log('— 8) v126 MUHRLARI SAQLANGAN (boshqaruv markazi)')
ok(W.includes('CREATE TABLE IF NOT EXISTS panel_admins'), 'panel_admins jadvali')
ok(W.includes('const PANEL_ROLES') && W.includes('ROLE_PERMS') && W.includes('function permOk'), 'rolar infrastrukturasi (permOk)')
ok(W.includes('async function pbHash') && W.includes('async function pbVerify'), 'PBKDF2 hash/verify')
ok(W.includes('function b32enc') && W.includes('async function totpCheck'), 'MFA/TOTP saqlangan (egasi uchun)')
ok(W.includes('CREATE TABLE IF NOT EXISTS reports') && W.includes('["POST", "/report", userReport]'), 'shikoyatlar saqlangan')
ok(W.includes('CREATE TABLE IF NOT EXISTS gk_log') && W.includes('function gkLog(c: C'), 'guruh-adminlari nazorati (gk_log) saqlangan')
ok(W.includes('CREATE TABLE IF NOT EXISTS app_settings') && W.includes('async function setGet'), 'tizim darvozalari saqlangan')
ok(W.includes('await admAuth(c, "admins")'), 'admins-ruxsat tekshiruvi saqlangan (egasi)')
ok(W.includes('INSERT INTO adm_log(ts,act,tgt,note,actor,ip)'), 'audit: aktor+IP saqlangan')
ok(W.includes('IS_EGASI=!!m.egasi'), 'UI rol-gating o\'zgarishsiz')

console.log('— 9) ESKI MUHRLAR (v125/v124/v123/v122)')
ok(W.includes('ODDIY kirish sessiyani AYLANTIRMAYDI'), 'v124: sess-reuse saqlangan')
ok(W.includes('if (force || !u.sess) {'), 'v124: force-rotatsiya saqlangan')
ok(W.includes('ALTER TABLE users ADD COLUMN devs MEDIUMTEXT NULL'), 'v124: devs ustuni')
ok(CORE.includes('logout(true, true)'), 'v123: deadTok saqlangan')
ok((W.match(/payload\.s === su\.prev_sess/g) || []).length === 2, 'v123: prev_sess darvoza 2 joyda')
ok(W.includes('QAYTA QO' + String.fromCharCode(39) + 'SMANG'), 'v122: 301 qayta qo\'shilmagan')
ok(A.includes('export async function verifyJwtLenient'), 'v125: lenient tekshiruv saqlangan')
ok((W.split('!(await verifyJwtLenient(').length - 1) === 2, 'v125: zombi-muhir 2 joyda')
ok(W.includes('SMS_MODE'), 'SMS_MODE tegilmagan (app rejim)')
ok(W.includes('const SCHEMA_V = 126'), 'schema-ver belgisi (yangi migratsiya YO\'Q — 126 qoladi)')

console.log('— 10) SINTAKSIS')
for (const f of ['core.js', 'sw.js', 'config.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'tools.js', 'p2p.js', 'storage.js']) {
  let r = 'ok'
  try { cp.execSync('node --check ' + path.join(ROOT, 'web/' + f), { stdio: 'pipe' }) } catch (e) { r = String(e.stderr || e.message).slice(0, 120) }
  ok(r === 'ok', 'node --check web/' + f, r !== 'ok' ? r : '')
}

console.log(fails === 0 ? '\nJAMI: HAMMASI YASHIL ✓ (v127: panel faqat egasi + akkauntda avtomatik boshqaruv)' : '\nJAMI: ' + fails + ' MUVAFFAQIYATSIZ ✗')
process.exit(fails === 0 ? 0 : 1)
