/* v110 LOKAL TEKSHIRUV — 500MB fayllar + kalitlar doimiyligi + ovoz avto-yuklash + himoya kuchaytirish
 * FUNKSIONAL kripto sinovlari (sha256Stream vs WebCrypto, AES-CTR roundtrip) + statik qofiyalar
 * Ishga tushirish: node scripts/test_admin_v110.js
 */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0, n = 0
const ok = (cond, label, extra = '') => { n++; console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }

const idx = readFileSync(join(ROOT, 'worker/src/index.ts'), 'utf8')
const fw = readFileSync(join(ROOT, 'worker/src/firewall.ts'), 'utf8')
const core = readFileSync(join(ROOT, 'web/core.js'), 'utf8')
const sw = readFileSync(join(ROOT, 'web/sw.js'), 'utf8')
const chatjs = readFileSync(join(ROOT, 'web/chat.js'), 'utf8')
const p2pjs = readFileSync(join(ROOT, 'web/p2p.js'), 'utf8')

console.log('== v110 LOKAL TEKSHIRUV ==')

// ---------- 1) VERSIYA QULFI — uch manba bir xil v110 ----------
ok(/BUILD_V = "v110"/.test(idx), 'worker BUILD_V = v110')
ok(/window\.__50BUILD = 'v110'/.test(core), 'core.js __50BUILD = v110')
ok(/const V = '50gram-v110'/.test(sw), 'sw.js V = 50gram-v110')
ok(!/50gram-v109/.test(sw) && !/BUILD_V = "v109"/.test(idx) && !/__50BUILD = 'v109'/.test(core), 'eski qulflar qolmagan')

// ---------- 2) 500MB SERVER ----------
ok(/const MAX_SIZE = 500 \* 1024 \* 1024/.test(idx), 'worker MAX_SIZE = 500MB')
ok(/Fayl hajmi 500 MB dan oshmasin/.test(idx), 'server xato-matni 500MB')
ok(/chunks > 1200\) fail\("Bo‘laklar soni noto‘g‘ri"\)/.test(idx), 'bo‘laklar chegarasi 1200 (500MB = 250x2MB)')
ok(/ab\.byteLength > 2_200_000/.test(idx), 'binary bo’lak PUT 2.2MB (2MB bo’lak + zaxira)')
ok(/data\.length > 1_100_000/.test(idx), 'eski base64 zaxira yo’li 1.1MB (o’zgarmagan — D1 param limiti)')

// ---------- 3) YUKLASH POSBONLARI (himoya kuchaytirildi) ----------
ok(/fwSoat\(FW_UP, c\.uid, 12000\)/.test(idx), 'bo’lak-PUT 12000/soat (avval 4000 — 500MB uchun)')
ok(/const FW_UPB = new Map/.test(idx), 'FW_UPB: BAYT-posbon bor (v110)')
ok(/ub\.n \+= bytes\?\.byteLength \|\| 0/.test(idx), 'bayt-posbon: har bo’lak baytlari hisobga qo’shiladi')
ok(/6 \* 1024 \* 1024 \* 1024\) fail\("Juda ko‘p yuklash/.test(idx), 'bayt-chegara 6GB/soat (R2 toshqin qatlami 2)')
ok(/const FW_MSG = new Map/.test(idx), 'FW_MSG: xabar-spam posboni bor (v110)')
ok(/fwSoat\(FW_MSG, c\.uid, 900\)\) fail\("Juda ko‘p xabar/.test(idx), 'xabar 900/soat — bot-spam to’sig’i (panel e’lonlari shu yo’ldan o’tmaydi)')
ok(/function authTanaSkan/.test(idx), 'authTanaSkan: kirish-tana skaneri bor (v110)')
ok(/async function authOtp\(c: C\) \{\n  if \(authTanaSkan\(c\)\) return FW_404\(\)/.test(idx), 'authOtp: tana-skaner ulangan')
ok(/async function authVerify\(c: C\) \{\n  if \(authTanaSkan\(c\)\) return FW_404\(\)/.test(idx), 'authVerify: tana-skaner ulangan')
ok(/fwLBlok\(fip, 30 \* DAY\)\n  fwOchko\(c\.env, c\.wait, fip, "inj", 1, secInfo\(c\.req, c\.url\)\)/.test(idx), 'tana-in’ektsiya: 1-urinishdayoq 30 kun blok + jurnal')

// ---------- 4) KALITLAR DOIMIYLIGI (mkeys) — «kalit yo'q» + «yuklanmoqda» ildizi ----------
ok(/indexedDB\.open\('50gram', 5\)/.test(core), 'IDB versiya 5 (mkeys ombori uchun)')
ok(/contains\('mkeys'\)\) d\.createObjectStore\('mkeys'\)/.test(core), 'mkeys ombori yaratiladi')
ok(/async function mkeysYukla/.test(core), 'mkeysYukla: saqlangan kalitlarni tiklash')
ok(/for \(const \[id, info\] of await IDB\.entries\('mkeys'\)\) P2P\.note\(String\(id\), info \|\| \{\}\)/.test(core), 'mkeysYukla: kalitlar P2P.ctx’ga qaytariladi')
ok(/try \{ mkeysYukla\(\) \} catch \{\}/.test(core), 'mkeysYukla startApp’da chaqiriladi (ishga tushishda)')
ok(/try \{ IDB\.put\('mkeys', id, info\) \} catch \{\}/.test(core), 'yuklash (kichik GCM yo’li): kalit mkeys’ga yoziladi')
ok(/try \{ IDB\.put\('mkeys', id0, info\) \} catch \{\}/.test(core), 'yuklash (katta CTR yo’li): kalit mkeys’ga yoziladi')
ok(/if \(mt\.key\) try \{ IDB\.put\('mkeys', String\(mt\.media_id\)/.test(chatjs), 'noteMedia: kelgan xabar kaliti mkeys’ga yoziladi')
ok(/for \(const m of d\?\.messages \|\| \[\]\) if \(m && m\.meta && m\.meta\.media_id && typeof noteMedia === 'function'\) noteMedia\(m\)/.test(core), 'loadChatLocal: lokal xabarlar kalitlari qayta yoziladi (qayta ochilganda!)')
ok(/'chat', 'sha', 'size', 'key', 'iv', 'mime', 'enc', 'cs'/.test(p2pjs), 'P2P.note: enc/cs maydonlari ham saqlanadi')

// ---------- 5) OQIMLI SHIFRLASH (CTR) + oqimli SHA-256 ----------
ok(/function sha256Stream/.test(core), 'sha256Stream: oqimli SHA-256 bor (500MB xotirasiz)')
ok(/const ctrKey = \(key64\)/.test(core) && /function ctrBlock/.test(core) && /const ctrCrypt/.test(core), 'AES-CTR yordamchilari bor')
ok(/const KATTA = plain\.size > 30 \* 1024 \* 1024/.test(core), '30MB dan KATTA fayl alohida yo’l')
ok(/const CS = KATTA \? 2 \* 1024 \* 1024 : CHUNK/.test(core), 'katta fayl 2MB bo’lak, kichik 512KB (eski o’zgarmagan)')
ok(/if \(plain\.size > 500 \* 1024 \* 1024 - 4096\) throw new Error\('Fayl 500 MB dan katta'\)/.test(core), 'core.js: 500MB chegara')
ok(/enc: 'ctr', cs: CS/.test(core), 'katta fayl meta: enc=ctr + cs (qabul qiluvchi oqimli ochadi)')
ok(/async function decryptChunked/.test(core), 'decryptChunked: bo’lakma-bo’lak ochish (xotira ~2 bo’lak)')
ok(/if \(info\.enc === 'ctr'\) return URL\.createObjectURL\(await decryptChunked\(cipher, info\)\)/.test(core), 'mediaUrl: ctr fayl oqimli ochiladi (GCM eski yo’li o’zgarmagan)')
ok(/parts\[i\] = new Blob\(\[u\]\)/.test(core), 'getCipher: har bo’lak Blob’ga o’raladi (500MB xotira xavfsiz)')
ok(/const cs = \+P2P\.ctx\.get\(id\)\?\.cs \|\| CHUNK/.test(core), 'restoreToServer: cs bo’yicha tiklash (katta fayl ham tiklanadi)')
ok(/Store\.record\(id0, 0, null, 0\)/.test(core), 'katta fayl lokal keshga yozilmaydi (oqim bilan o’qiladi)')
ok(/mediaCache\.set\(id0, Promise\.resolve\(URL\.createObjectURL\(plain\)\)\)/.test(core), 'yuboruvchida darhol ko’rinadi (blob-URL, xotirasiz)')

// ---------- 6) OVOZ AVTO-YUKLASH («yuklanmoqda» bug tugadi) ----------
ok(/async function playVoice/.test(chatjs), 'playVoice endi async (avto-yuklash)')
ok(/if \(!au\.src\) \{/.test(chatjs) && /au\.src = await mediaUrl\(mid\)/.test(chatjs), 'bosishda o’zi yuklaydi va ijro etadi')
ok(!/if \(!au\.src\) \{ toast\('⏳ Yuklanmoqda…'\); return \}/.test(chatjs), 'o’lik «⏳ Yuklanmoqda…» toasti OLIB TASHLANGAN')
ok(/Ovoz yuklanmadi/.test(chatjs), 'xato bo’lsa aniq sabab ko’rsatiladi')

// ---------- 7) 500MB MIJOZ LIMITLARI ----------
ok(/file\.size > 500 \* 1024 \* 1024\)/.test(chatjs), 'chat.js sendFile: 500MB chegara')
ok(/Fayl 500 MB dan katta bo‘lmasin/.test(chatjs), 'chat.js toast matni 500MB')
ok(/file\.size <= 30 \* 1024 \* 1024\) \{\n      await Outbox\.add/.test(chatjs), 'outbox navbati 30MB bilan cheklangan (IDB blob-limiti — katta fayllar onlayn)')

// ---------- 8) MUHRLANGAN QISMNING SAQLANISHI (regressiya-yo'q) ----------
ok(/id="fwon"/.test(idx) && /id="fwof"/.test(idx), 'v107: himoya JUFT tugmasi joyida')
ok(/function fwBos\(on\)\{/.test(idx), 'v107: fwBos joyida')
ok(/let FW_OFF = false/.test(idx) && /FW_OFF = !!j\.fwoff/.test(idx), 'FW_OFF mexanizmi joyida')
ok(/FW_OFF && Date\.now\(\) - FW_TASDIQ > 5_000\)/.test(idx), 'v108: stale-flag posboni joyida')
ok(/SMS_MODE="app"|smsConfigured/.test(idx), 'Eskiz SMS (o’zgarmagan)')
for (const fn of ['panelChats', 'panelChatBlock', 'panelChatDelete', 'panelChatClear', 'panelChatCleanBad', 'panelMsgDelete', 'panelFwToggle', 'panelBroadcast', 'panelDm', 'admStoreImage', 'admNotify'])
  ok(new RegExp('function ' + fn).test(idx), 'panel: ' + fn + ' joyida')
ok(/O'CHIRILGAN XABAR "QABRSTONLARI"|O\u2018CHIRILGAN XABAR "QABRSTONLARI"/.test(idx), 'v108: tombstone sinxronlash joyida')
ok(/if \(\+ch\.blocked === 1\) fail\("Bu kanal\/guruh bloklangan", 403\)/.test(idx), 'v106: kanal blok-posboni joyida')

// ---------- 9) FUNKSIONAL KRIPTO SINOV (haqiqiy WebCrypto — node 20) ----------
console.log('  — FUNKSIONAL: sha256Stream + AES-CTR roundtrip —')
const b64e = (u) => { let s = ''; u = new Uint8Array(u); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s) }
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const seg1 = core.slice(core.indexOf('function sha256Stream'), core.indexOf('// v110 OQIMLI SHIFRLASH'))
const seg2 = core.slice(core.indexOf('const ctrKey'), core.indexOf("// Katta fayl (enc:'ctr')"))
const seg3 = core.slice(core.indexOf('async function decryptChunked'), core.indexOf('async function upload'))
try {
  const M = new Function('b64d', seg1 + '\n' + seg2 + '\n' + seg3 + '\nreturn {sha256Stream, ctrKey, ctrBlock, ctrCrypt, decryptChunked}')(b64d)

  // 9a) sha256Stream — WebCrypto digest bilan BAYT-BAYT mos (turli uzunliklar: blok-chegaralari)
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 65537, 1_048_576 + 13]) {
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = (i * 7 + size) & 255
    const want = hexOf(await crypto.subtle.digest('SHA-256', data))
    const sh = M.sha256Stream()
    for (let o = 0; o < size; o += 300_000) sh.update(data.subarray(o, Math.min(size, o + 300_000)))
    ok(sh.hex() === want, `sha256Stream(${size}B, oqim) === WebCrypto`, sh.hex().slice(0, 12) + '…')
  }

  // 9b) AES-CTR roundtrip: 2.5MB+7 fayl, 1MB bo'laklar — shifrlash→yig'ish→oqimli ochish = ASL
  {
    const CS = 1024 * 1024, SZ = 2 * CS + 7
    const plain = new Uint8Array(SZ)
    for (let i = 0; i < SZ; i++) plain[i] = (i * 31 + 5) & 255
    const raw = crypto.getRandomValues(new Uint8Array(32)), ivr = crypto.getRandomValues(new Uint8Array(12))
    const k = await crypto.subtle.importKey('raw', raw, { name: 'AES-CTR', length: 256 }, false, ['encrypt'])
    const num = Math.ceil(SZ / CS)
    const sh = M.sha256Stream(), parts = []
    for (let i = 0; i < num; i++) {
      const part = plain.slice(i * CS, (i + 1) * CS)
      const ct = new Uint8Array(await M.ctrCrypt(k, ivr, part, i * CS))
      sh.update(ct); parts.push(new Blob([ct]))
    }
    const cipher = new Blob(parts)
    ok(cipher.size === SZ, 'CTR: shifrlangan hajm = asl hajm (CTR xususiyati)', String(cipher.size))
    const info = { key: b64e(raw), iv: b64e(ivr), cs: CS, mime: 'application/octet-stream' }
    const decBlob = await M.decryptChunked(cipher, info)
    const dec = new Uint8Array(await decBlob.arrayBuffer())
    let same = dec.length === SZ
    for (let i = 0; i < SZ && same; i++) if (dec[i] !== plain[i]) same = false
    ok(same, 'CTR roundtrip: deSHIFR = ASL fayl (bo’lak-ofsetlar to’g’ri)')
    const wantSha = hexOf(await crypto.subtle.digest('SHA-256', await cipher.arrayBuffer()))
    ok(sh.hex() === wantSha, 'oqimli sha(shifrlangan) === butun-blob sha (butunlik muhri)')
  }
} catch (e) {
  ok(false, 'FUNKSIONAL kripto sinov ishladi', String(e && e.message).slice(0, 120))
}

// ---------- 10) SINTAKSIS: node --check ----------
console.log('  — SINTAKSIS —')
for (const f of ['web/core.js', 'web/chat.js', 'web/p2p.js', 'web/storage.js', 'web/sw.js', 'web/social.js', 'web/rtc.js', 'web/manage.js']) {
  const r = spawnSync('node', ['--check', join(ROOT, f)], { encoding: 'utf8' })
  ok(r.status === 0, 'node --check ' + f, (r.stderr || '').split('\n')[0].slice(0, 90))
}
// Panel JS (worker xotirasidagi ADMIN_HTML'dan ajratib) sintaksisi
const aStart = idx.indexOf('const ADMIN_HTML = String.raw`')
const aEnd = idx.indexOf('</html>`', aStart)
if (aStart >= 0 && aEnd > aStart) {
  const html = idx.slice(aStart, aEnd + '</html>'.length)
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
  const t = join(mkdtempSync(join(tmpdir(), 'g50v110-')), 'panel.js')
  writeFileSync(t, scripts)
  const r = spawnSync('node', ['--check', t], { encoding: 'utf8' })
  ok(r.status === 0, 'panel JS node --check (ADMIN_HTML)', (r.stderr || '').split('\n')[0].slice(0, 90))
} else ok(false, 'ADMIN_HTML ajratildi')

// ---------- 11) MAXFIYLIK: web/ papkasida panel izi YO'Q ----------
console.log('  — MAXFIYLIK —')
let leaked = 0
const scan = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) { if (f.name === 'ios' || f.name === 'stickers' || f.name === 'fonts') continue; scan(p) } else if (/\.(js|css|html|json)$/.test(f.name)) { try { const t = readFileSync(p, 'utf8'); if (/adminpanel|panel\/fwtoggle|fwBos|panelBroadcast|admStoreImage/.test(t)) { leaked++; console.log('    ✗ MAXFIYLIK Buzildi: ' + p) } } catch {} } } }
scan(join(ROOT, 'web'))
ok(leaked === 0, 'web/ papkasida panel maxfiy izi YO’Q', leaked + ' ta topilma')

// ---------- 12) tsc BASELINE (13 eski stream.ts xatosi — yangisi YO'Q) ----------
console.log('  — TSC —')
const tr = spawnSync('npx', ['tsc', '--noEmit'], { cwd: join(ROOT, 'worker'), encoding: 'utf8', timeout: 240000 })
const errs = (tr.stdout || '').split('\n').filter((l) => /error TS/.test(l))
ok(errs.length === 13, 'tsc xatolari = 13 (baseline, yangisi YO’Q)', 'topildi: ' + errs.length)
ok(!errs.some((l) => /index\.ts/.test(l)), 'index.ts’da tsc xatosi YO’Q')

console.log(`\nJAMI: ${n} tekshiruv, ${fails} muvaffaqiyatsiz`)
process.exit(fails ? 1 : 0)
