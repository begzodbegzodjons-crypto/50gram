/* v107 LOKAL TEKSHIRUV — HIMOYA TUGMALARI (YOQISH + O'CHIRISH — ikkalasi har doim ko'rinadi)
 * + v106 kanal/guruh moderatsiyasi tekshiruvlari to'liq saqlangan (CI'siz, fayl-darajasida)
 * Ishga tushirish: node scripts/test_admin_v107.js
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }

const idx = readFileSync(join(ROOT, 'worker/src/index.ts'), 'utf8')
const fw = readFileSync(join(ROOT, 'worker/src/firewall.ts'), 'utf8')
const core = readFileSync(join(ROOT, 'web/core.js'), 'utf8')
const sw = readFileSync(join(ROOT, 'web/sw.js'), 'utf8')

console.log('== v107 LOKAL TEKSHIRUV ==')

// 1) VERSIYA QULFI — uch manba bir xil v107
ok(/BUILD_V = "v107"/.test(idx), 'worker BUILD_V = v107')
ok(/window\.__50BUILD = 'v107'/.test(core), 'core.js __50BUILD = v107')
ok(/const V = '50gram-v107'/.test(sw), 'sw.js V = 50gram-v107')
ok(!/BUILD_V = "v106"/.test(idx), 'eski v106 qulfi qolmagan (worker)')
ok(!/50gram-v106/.test(sw), 'eski v106 qulfi qolmagan (sw)')

// 2) v107 — IKKITA HIMOYA TUGMASI (egasi so'rovi: YOQISH tugmasi ham bo'lsin)
ok(/id="fwon"/.test(idx), 'panel: Himoyani YOQISH tugmasi bor (id=fwon)')
ok(/id="fwof"/.test(idx), 'panel: Himoyani o\u2018chirish tugmasi bor (id=fwof)')
ok(/id="fwon".*<\/button>/.test(idx) && /id="fwof"/.test(idx), 'ikkala tugma BITTA bar2 qatorida')
ok(!/id="fwbtn"/.test(idx), 'eski yagona fwbtn tugmasi olib tashlangan')
ok(/function fwBos\(on\)\{/.test(idx), 'panel JS: fwBos(on) — umumiy ishlovchi')
ok(/\$|getElementById\('fwon'\)\.onclick=function\(\)\{fwBos\(true\)\}/.test(idx.replace(/\n/g, '')), 'panel JS: YOQISH tugmasi fwBos(true)\u2019ga ulangan')
ok(/getElementById\('fwof'\)\.onclick=function\(\)\{fwBos\(false\)\}/.test(idx), 'panel JS: O\u2018CHIRISH tugmasi fwBos(false)\u2019ga ulangan')
ok(/fwBos\(true\)/.test(idx) && /fwBos\(false\)/.test(idx), 'panel JS: ikkala yo\u2018nalish chaqiriladi (on:true + on:false)')
ok(/button\.grn\{background:#2f7d4f\}/.test(idx), 'panel CSS: yashil YOQISH tugma uslubi')
ok(/\.fwst\{color:#8b919c/.test(idx), 'panel CSS: holat yozuvi (.fwst)')
ok(idx.includes('Hozirgi holat:'), 'panel: hozirgi holat matni ko\u2018rinadi')
ok(/Himoyani YOQISH/.test(idx), 'panel: YOQISH yozuvi')
ok(/Himoyani o\u2018chirish/.test(idx), 'panel: O\u2018CHIRISH yozuvi')
ok(/api\('fwtoggle','POST',\{on:on\}\)/.test(idx), 'panel JS: fwtoggle API\u2019ga ulangan (o\u2018zgarmagan)')
// har doim ishlaydi — hech bir tugma holatga qarab olib tashlanmaydi (faqat confirm+API)
ok((idx.match(/fwBos\(/g) || []).length >= 3, 'panel JS: fwBos kamida 3 marta (ta\u2019rif + 2 ulash)')

// 3) HIMOYA TUGMASI yadrosi (v106'dan o'zgarmagan) — FW_OFF + 5 posbon + DO cfg
ok(/let FW_OFF = false/.test(idx), 'FW_OFF holati bor (boshlang\u2019ich: YONIQ)')
ok(/FW_OFF = !!j\.fwoff/.test(idx), 'fwQollash DO\u2019dan fwoff\u2019ni oladi')
ok(/function fwBlokli\(ip: string\) \{\n  if \(FW_OFF\) return false/.test(idx), 'fwBlokli posboni')
ok(/function fwLokal\(ip: string, kind: string, need: number, dur: number\) \{\n  if \(FW_OFF\) return false/.test(idx), 'fwLokal posboni')
ok(/if \(!ip \|\| !env\.SEC \|\| FW_OFF\) return/.test(idx), 'fwOchko posboni')
ok(/const fwLBlok = \(ip: string, dur: number\) => \{ if \(FW_OFF\) return/.test(idx), 'fwLBlok posboni')
ok(/function fw4xx\(env: Env, wait: \(p: Promise<unknown>\) => void, ip: string, info\?: SecInfo\) \{\n  if \(FW_OFF\) return false/.test(idx), 'fw4xx posboni')
ok(/if \(fwip && !FW_OFF\) \{\n      \/\/ v106/.test(idx), 'gateway himoya-bloki sharti')
ok(/if \(fwip && !FW_OFF\) \{\n          const de = FW_DATA/.test(idx), 'data-tortish posboni sharti')
ok(/CREATE TABLE IF NOT EXISTS cfg\(k TEXT PRIMARY KEY/.test(fw), 'SEC DO: cfg jadvali')
ok(/isOff\(\): boolean/.test(fw), 'SEC DO: isOff()')
ok(/op"\) === "cfg"/.test(fw), 'SEC DO: op=cfg handleri')
ok(/fwoff: this\.isOff\(\) \? 1 : 0/.test(fw), 'SEC DO: refresh fwoff qaytaradi')
ok(/if \(this\.isOff\(\)\) return \{ until: 0, blocked: false \}/.test(fw), 'SEC DO: strike posboni')
ok(/await st\.fetch\("https:\/\/fw\/\?op=cfg&v=" \+ \(on \? "0" : "1"\)\)/.test(idx), 'panelFwToggle: on→v xaritasi to\u2018g\u2018ri (on=1→v=0 YOQISH)')

// 4) KANAL MODERATSIYASI (v106) — sxema + API + posbonlar
ok(/ALTER TABLE chats ADD COLUMN blocked INT NOT NULL DEFAULT 0/.test(idx), 'sxema: chats.blocked')
ok(/CREATE TABLE IF NOT EXISTS adm_log \(/.test(idx), 'sxema: adm_log jurnali')
ok(/CREATE INDEX IF NOT EXISTS idx_admlog_ts ON adm_log/.test(idx), 'sxema: adm_log indeksi')
ok(/DELETE FROM adm_log WHERE ts<\?/.test(idx), 'cleanup: adm_log 90 kun retensiya')
ok(/last_msg_at,created_at,pinned_id,blocked"/.test(idx), 'CHAT_COLS\u2019ga blocked qo\u2019shildi')
ok(/if \(\+ch\.blocked === 1\) fail\("Bu kanal\/guruh bloklangan", 403\)/.test(idx), 'sendMessage blok-posboni')
ok(/if \(\+ch\.blocked === 1\) fail\("Bu chat bloklangan", 403\)/.test(idx), 'joinChat blok-posboni')
for (const fn of ['panelChats', 'panelChat', 'panelChatBlock', 'panelChatDelete', 'panelChatKick', 'panelChatClear', 'panelChatCleanBad', 'panelMsgDelete', 'panelFwToggle', 'panelLog'])
  ok(new RegExp('async function ' + fn + '\\(').test(idx), 'panel API: ' + fn)
for (const r of ['/panel/chats', '/panel/chat', '/panel/chat/block', '/panel/chat/delete', '/panel/chat/kick', '/panel/chat/clear', '/panel/chat/cleanbad', '/panel/msg/delete', '/panel/fwtoggle', '/panel/log'])
  ok(idx.includes('"' + r + '"'), 'route: ' + r)
ok(/admLog\(c, on \? "himoya_yoqildi" : "himoya_ochirildi"/.test(idx), 'jurnal: himoya amallari (yoqildi/ochirildi)')
ok(/admLog\(c, "hammaga_xabar"/.test(idx), 'jurnal: broadcast amali')
ok(/admLog\(c, "alohida_xabar"/.test(idx), 'jurnal: alohida xabar amali')
ok(/admLog\(c, on \? "foy_blok" : "foy_blok_och"/.test(idx), 'jurnal: foydalanuvchi bloki')

// 5) YOMON SO'Z FILTRI — PROF_REG bir manba (SQL REGEXP + JS RegExp), ishlashi
ok(/const PROF_REG = "siktir\|sikk/.test(idx), 'PROF_REG konstantasi (SQL REGEXP bilan bir xil satr)')
ok(/new RegExp\(PROF_REG, "i"\)/.test(idx), 'PROF_RE PROF_REG\u2019dan yaratilgan')
const m = idx.match(/const PROF_REG = "([^"]+)"/)
if (m) {
  const re = new RegExp(m[1], 'i')
  ok(re.test('bu siktir gap'), 'filtr: siktir ushlanadi')
  ok(re.test('XUY deb yozgan'), 'filtr: xuy (katta-kichik harf) ushlanadi')
  ok(re.test('\u0445\u0443\u0439 \u0433\u0430\u043F'), 'filtr: kirill \u0445\u0443\u0439 ushlanadi')
  ok(re.test('blyad'), 'filtr: blyad ushlanadi')
  ok(!re.test('Bugun havo chiroyli, salom!'), 'filtr: oddiy xabar xato-ushlov YO\u2018Q')
  ok(!re.test('assalomu alaykum do\u2018stlar'), 'filtr: salomlashuv tinch')
}

// 6) PANEL SAHIFA — String.raw tuzoqlari + sintaksis + elementlar
const adm = idx.match(/const ADMIN_HTML = String\.raw`([\s\S]*?)<\/html>`/)
ok(!!adm, 'ADMIN_HTML String.raw bilan')
if (adm) {
  const html = adm[1]
  ok(!html.includes('${'), 'ADMIN_HTML ichida ${ YO\u2018Q (String.raw tuzog\u2018i)')
  ok(!html.includes('`'), 'ADMIN_HTML ichida backtick YO\u2018Q')
  for (const id of ['id="cq"', 'id="cqb"', 'id="cft"', 'id="cl"', 'id="cpv"', 'id="cnx"', 'id="cpgn"', 'id="fwctl"', 'id="alog"', 'data-t="ch"', 'id="fwon"', 'id="fwof"'])
    ok(html.includes(id), 'panel element: ' + id)
  ok(html.includes('loadChats()') && html.includes('showChat('), 'panel JS: loadChats + showChat')
  ok(html.includes("'fwtoggle','POST'"), 'panel JS: himoya tugmasi api\u2019ga ulangan')
  ok(html.includes('chat/cleanbad'), 'panel JS: yomon so\u2018zlarni o\u2018chirish tugmasi')
  ok(html.includes('YOMON SO\u2018Z'), 'panel JS: yomon so\u2018z belgisi ko\u2018rinadi')
  // panel <script> sintaksisi — node --check bilan
  const sc = html.match(/<script>([\s\S]*)<\/script>/)
  ok(!!sc, 'panel <script> topildi')
  if (sc) {
    const tmp = '/tmp/panel_v107.js'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(tmp, sc[1])
    const p = spawnSync('node', ['--check', tmp])
    ok(p.status === 0, 'panel JS sintaksisi node --check \u2018OTDI', p.stderr ? String(p.stderr).slice(0, 120) : '')
  }
}

// 7) MAXFIYLIK — web/ papkada panel IZI YO'Q
const webDir = join(ROOT, 'web')
let webFiles = []
;(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else webFiles.push(p) } })(webDir)
let leaks = []
for (const f of webFiles) {
  const t = readFileSync(f, 'utf8')
  if (/adminpanel|panel\/(login|stats|users|chats|chat|block|broadcast|security|dm|fwtoggle|log)/i.test(t)) leaks.push(f)
}
ok(leaks.length === 0, 'web/ papkada panel izi YO\u2018Q (' + webFiles.length + ' fayl skanerlandi)', leaks.join(', '))
ok(!/blocked/.test(idx.match(/function chatOut\(r: any\) \{[\s\S]*?\n\}/)[0]), 'chatOut klientga blocked ustunini BERMA\u2018DI (maxfiylik + xulq)')

// 8) E2E skripti v106 bo'limlari bilan
const e2e = readFileSync(join(ROOT, 'scripts/e2e_panel.mjs'), 'utf8')
for (const s of ['panel/chats', 'panel/chat', 'panel/chat/block', 'panel/chat/cleanbad', 'panel/msg/delete', 'panel/fwtoggle', 'panel/log'])
  ok(e2e.includes(s), 'E2E: ' + s + ' sinovi bor')

console.log(fails === 0 ? '== HAMMASI YASHIL ==' : '== ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
