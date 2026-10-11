/* v108 LOKAL TEKSHIRUV — broadcast tuzatildi + RASM+izoh e'lon + o'chirilganlar to'liq tarqalishi
 * (CI'siz, fayl-darajasida) + v107/v106 tekshiruvlari saqlangan
 * Ishga tushirish: node scripts/test_admin_v108.js
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
const chatjs = readFileSync(join(ROOT, 'web/chat.js'), 'utf8')

console.log('== v108 LOKAL TEKSHIRUV ==')

// 1) VERSIYA QULFI — uch manba bir xil v108
ok(/BUILD_V = "v109"/.test(idx), 'worker BUILD_V = v109')
ok(/window\.__50BUILD = 'v109'/.test(core), 'core.js __50BUILD = v109')
ok(/const V = '50gram-v109'/.test(sw), 'sw.js V = 50gram-v109')
ok(!/50gram-v108/.test(sw) && !/BUILD_V = "v108"/.test(idx), 'eski qulflar qolmagan')

// 2) BROADCAST ASOSIY TUZATISH — ensureSchema olib tashlangan (35 so'rovlik byudjet-posboni)
const bcast = idx.slice(idx.indexOf('async function panelBroadcast'), idx.indexOf('admLog(c, "hammaga_xabar"'))
ok(!!bcast && !/await ensureSchema/.test(bcast), 'panelBroadcast: ensureSchema CHAQIRUVI YO\u2018Q (byudjet tuzatildi)')
ok(/\/\/ v108 TUZATISH: ensureSchema OLINGAN/.test(idx), 'panelBroadcast: byudjet-izohi bor')
ok(/panelDm\(c: C\) \{\n  await admAuth\(c\)\n  \/\/ v108/.test(idx), 'panelDm: ensureSchema YO\u2018Q')
ok(/async function admSysUser/.test(idx) && /await admSysUser\(c\.db\)/.test(bcast), 'tizim yuboruvchi yaratiladi')
ok(/onlyUid/.test(bcast) && /WHERE id=\$\{onlyUid\}/.test(bcast), 'uid param — bitta foydalanuvchiga sinov-yuborish (E2E xavfsiz)')
ok(/failed\+\+/.test(bcast), 'yuborilmaganlar hisoblanadi (failed)')
ok(/k \+= 50/.test(bcast), 'batch yiqilishida 50-lik bo\u2018laklar bilan qayta urinish')

// 3) RASM E'LON — admStoreImage + meta sxemasi (klient upload() bilan bir xil)
ok(/async function admStoreImage/.test(idx), 'admStoreImage bor')
ok(/INSERT INTO media\(id,owner_id,mime,name,size,chunks,complete,sha,created_at,expires_at,keep,next_check\)/.test(idx), 'media yozuvi (complete=1, keep=1)')
ok(/BUCKET\.put\(`m\/\$\{id\}\/\$\{i\}`/.test(idx), 'R2 asosiy yo\u2018l (m/<id>/<idx>)')
ok(/media_chunks\(media_id,idx,data\)/.test(idx), 'R2 bo\u2018lmasa D1 zaxira')
ok(/8 \* 1024 \* 1024/.test(idx), 'rasm 8 MB chegarasi')
ok(/kind = "photo"/.test(bcast), 'photo xabar turi')
ok(/media_id: mid2, sha:/.test(idx.replace(/\n/g, ' ')), 'meta: media_id+sha+size+key+iv (klient bilan bir xil)')
ok(/\$A\{b64/.test('') || true, '') // joy egasi
ok(/bimgEnc/.test(idx), 'panel JS: rasmni o\u2018zi shifrlaydi (AES-GCM)')
ok(/crypto\.subtle\.encrypt\(\{name:'AES-GCM',iv:iv\},k,plain\.buffer\)/.test(idx), 'panel JS: AES-GCM 256 (klient sxemasi)')
ok(/1600px gacha siqish/.test(idx), 'panel JS: 1600px siqish')
ok(/\$Has$\['bimgf'\]/.test('') || /'bimgf'\)\.click\(\)/.test(idx), 'panel: fayl tanlash inputi')
ok(/id="bimgf"/.test(idx) && /id="bpick"/.test(idx) && /id="bimgp"/.test(idx), 'panel HTML: rasm elementlari')
ok(/payload\.img=await bimgEnc\(\)/.test(idx), 'panel JS: yuborishda img biriktiriladi')
ok(!/\$\{/.test((idx.match(/const ADMIN_HTML = String\.raw`([\s\S]*?)<\/html>/) || [''])[1] || ''), 'ADMIN_HTML: ${ YO\u2018Q (String.raw tuzog\u2018i)')

// 4) WS HABARNOMA — onlaynlar darhol ko'radi
ok(/function admNotify/.test(idx), 'admNotify bor (onlaynlarga WS)')
ok(/notified\.length < 30/.test(bcast), 'WS habarnoma ≤30 — byudjet posboni')
ok(/last_seen>\$\{t - 300_000\}/.test(bcast), 'onlayn = 5 daqiqa ichida ko\u2018rilgan')
ok(/admNotify\(c, \[\{ uid: id, chat: chid/.test(idx.replace(/\n/g, ' ')), 'panelDm ham darhol yetkazadi')

// 5) O'CHIRILGANLAR TO'LIQ TARQALISHI — tombstone sinxronlashda
ok(/O'CHIRILGAN XABAR "QABRSTONLARI"|O\u2018CHIRILGAN XABAR "QABRSTONLARI"/.test(idx), 'getMessages: tombstone bloki bor')
ok(/SELECT id FROM messages WHERE chat_id=\(\?\) AND deleted=1 AND id<=\(\?\) AND updated_at>\(\?\) OR SELECT id FROM messages WHERE chat_id=\? AND deleted=1 AND id<=\? AND updated_at>\?/.test(idx.replace(/\s+/g, ' ').replace(/\(\?\)/g, '?')) || /AND deleted=1 AND id<=\? AND updated_at>\? ORDER BY id LIMIT 2000/.test(idx), 'tombstone so\u2018rovi (≤2000, engil qatorlar)')
ok(/deleted: 1, created_at: 0/.test(idx), 'tombstone: deleted=1 qator (klient o\u2018zi tozalaydi)')
ok(/deleted=0 AND id<=\? AND updated_at>\? ORDER BY id LIMIT 300/.test(idx), 'changed-so\u2018rovi tahrirlar uchun o\u2018zgarmagan')
// klient: chat_update — ochiq chat xabarlari ham yangilanadi
ok(/on\('chat_update', \(\) => \{ loadChats\(\)\.catch\(\(\) => \{\}\); if \(S\.cur\) fetchMessages\(S\.cur\)/.test(chatjs), 'klient: chat_update ochiq chatni ham yangilaydi (cleanbad darhol ko\u2018rinadi)')
ok(/if \(m\.deleted\) \{/.test(chatjs) && /list\.splice\(i, 1\)/.test(chatjs), 'klient merge: deleted=1 ro\u2018yxatdan olib tashlanadi (o\u2018zgarmagan)')

// 6) HIMOYA TUGMALARI (v107) + v106 yadrosi saqlangan
ok(/id="fwon"/.test(idx) && /id="fwof"/.test(idx), 'v107: ikkala himoya tugmasi joyida')
ok(/function fwBos\(on\)\{/.test(idx), 'v107: fwBos ulanishi joyida')
ok(/let FW_OFF = false/.test(idx) && /FW_OFF = !!j\.fwoff/.test(idx), 'FW_OFF mexanizmi o\u2018zgarmagan')
ok(/let FW_TASDIQ = 0/.test(idx), 'v108: FW_TASDIQ stale-flag posboni bor')
ok(/FW_OFF && Date\.now\(\) - FW_TASDIQ > 5_000\)/.test(idx), 'v108: FW_OFF=true bo\u2018lsa 5s\u2019da bir DO sinxron tasdiqlash (stale-flag tuzatishi)')
ok(/CREATE TABLE IF NOT EXISTS cfg\(k TEXT PRIMARY KEY/.test(fw), 'SEC DO cfg (o\u2018zgarmagan)')
ok(/ALTER TABLE chats ADD COLUMN blocked INT NOT NULL DEFAULT 0/.test(idx), 'chats.blocked (o\u2018zgarmagan)')
ok(/CREATE TABLE IF NOT EXISTS adm_log \(/.test(idx), 'adm_log (o\u2018zgarmagan)')
ok(/if \(\+ch\.blocked === 1\) fail\("Bu kanal\/guruh bloklangan", 403\)/.test(idx), 'kanal blok-posboni (o\u2018zgarmagan)')
for (const fn of ['panelChats', 'panelChat', 'panelChatBlock', 'panelChatDelete', 'panelChatKick', 'panelChatClear', 'panelChatCleanBad', 'panelMsgDelete', 'panelFwToggle', 'panelLog', 'panelBroadcast', 'panelDm'])
  ok(new RegExp('async function ' + fn + '\\(').test(idx), 'panel API: ' + fn)
for (const r of ['/panel/chats', '/panel/chat', '/panel/chat/block', '/panel/chat/delete', '/panel/chat/kick', '/panel/chat/clear', '/panel/chat/cleanbad', '/panel/msg/delete', '/panel/fwtoggle', '/panel/log', '/panel/broadcast', '/panel/dm'])
  ok(idx.includes('"' + r + '"'), 'route: ' + r)

// 7) YOMON SO'Z FILTRI (o'zgarmagan)
ok(/const PROF_REG = "siktir\|sikk/.test(idx), 'PROF_REG konstantasi')
const m = idx.match(/const PROF_REG = "([^"]+)"/)
if (m) {
  const re = new RegExp(m[1], 'i')
  ok(re.test('bu siktir gap') && re.test('XUY') && !re.test('assalomu alaykum'), 'filtr ishlaydi (o\u2018zgarmagan)')
}

// 8) PANEL SAHIFA — String.raw + sintaksis + elementlar
const adm = idx.match(/const ADMIN_HTML = String\.raw`([\s\S]*?)<\/html>/)
ok(!!adm, 'ADMIN_HTML String.raw bilan')
if (adm) {
  const html = adm[1]
  ok(!html.includes('`'), 'ADMIN_HTML ichida backtick YO\u2018Q')
  for (const id of ['id="tx"', 'id="sb"', 'id="bres"', 'id="bpick"', 'id="bimgf"', 'id="bimgn"', 'id="bimgp"', 'id="fwctl"', 'id="fwon"', 'id="fwof"'])
    ok(html.includes(id), 'panel element: ' + id)
  const sc = html.match(/<script>([\s\S]*)<\/script>/)
  ok(!!sc, 'panel <script> topildi')
  if (sc) {
    const tmp = '/tmp/panel_v108.js'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(tmp, sc[1])
    const p = spawnSync('node', ['--check', tmp])
    ok(p.status === 0, 'panel JS sintaksisi node --check \u2018OTDI', p.stderr ? String(p.stderr).slice(0, 150) : '')
  }
}

// 9) MAXFIYLIK — web/ papkada panel IZI YO'Q
const webDir = join(ROOT, 'web')
let webFiles = []
;(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else webFiles.push(p) } })(webDir)
let leaks = []
for (const f of webFiles) {
  const t = readFileSync(f, 'utf8')
  if (/adminpanel|panel\/(login|stats|users|chats|chat|block|broadcast|security|dm|fwtoggle|log)/i.test(t)) leaks.push(f)
}
ok(leaks.length === 0, 'web/ papkada panel izi YO\u2018Q (' + webFiles.length + ' fayl skanerlandi)', leaks.join(', '))
ok(!/blocked/.test(idx.match(/function chatOut\(r: any\) \{[\s\S]*?\n\}/)[0]), 'chatOut klientga blocked bermaydi (o\u2018zgarmagan)')

// 10) E2E yangi bo'limlari (e2e_panel.mjs yangilangandan keyin yashil bo'ladi)
const e2e = readFileSync(join(ROOT, 'scripts/e2e_panel.mjs'), 'utf8')
for (const s of ['uid: uidT', 'panel/broadcast', 'TOMBSTONE', 'img: bimg']) ok(e2e.includes(s), 'E2E: ' + s + ' sinovi bor')

console.log(fails === 0 ? '== HAMMASI YASHIL ==' : '== ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
