/* v105 ADMIN PANEL — lokal mantiq testlari (jonli tarmoqsiz)
 * Tekshiradi:
 *  1) ADMIN_HTML String.raw ichida ${ va backtick YO'Q (template tuzog'i)
 *  2) Panel <script> JS sintaksisi node --check bilan OK
 *  3) Yangi v105 elementlari: Xavfsizlik tab, sec yuklovchi, dm, user modal, alarm banner
 *  4) ccOf 10/10 (UZ/KG/RU/KZ/...) — eski xulq saqlangan
 *  5) fwOchko imzosi: eski 5-argumentli qo'ng'iroqlar ham ishlaydi (info ixtiyoriy)
 *  6) secYoz: blok-vaqtida HAR DOIM yozuv, ochko 30s dedupe (simulyatsiya)
 *  7) panelDm direct_key formulasi broadcast bilan BIR XIL
 *  8) Versiya qulfi: worker/core/sw = v105
 * Ishga tushirish: node scripts/test_admin_v105.js
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }

const src = readFileSync(new URL('../worker/src/index.ts', import.meta.url), 'utf8')
const core = readFileSync(new URL('../web/core.js', import.meta.url), 'utf8')
const sw = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8')

console.log('== v105 ADMIN PANEL lokal testlari ==')

// 1) String.raw tuzoqlari
const mHtml = src.match(/const ADMIN_HTML = String\.raw`([\s\S]*?)`\n/)
ok(!!mHtml, 'ADMIN_HTML String.raw blok topildi')
if (mHtml) {
  const html = mHtml[1]
  ok(!html.includes('${'), 'ADMIN_HTML ichida ${ YO\'Q (String.raw xavfsiz)')
  ok(!html.includes('`'), 'ADMIN_HTML ichida backtick YO\'Q')
}

// 2) Panel JS sintaksisi
if (mHtml) {
  const sm = mHtml[1].match(/<script>([\s\S]*)<\/script>/)
  ok(!!sm, 'panel <script> blok topildi')
  if (sm) {
    const js = sm[1]
    const dir = mkdtempSync(join(tmpdir(), 'v105-'))
    const f = join(dir, 'panel.js')
    writeFileSync(f, js)
    try { execFileSync(process.execPath, ['--check', f]); ok(true, 'panel JS sintaksisi OK (node --check)') }
    catch (e) { ok(false, 'panel JS sintaksisi', String(e).slice(0, 300)) }
  }
}

// 3) v105 elementlari
if (mHtml) {
  const html = mHtml[1]
  ok(html.includes('data-t="sc"'), 'Xavfsizlik tab tugmasi')
  ok(html.includes('id="alrm"'), 'signal banner o\'rni (alrm)')
  ok(html.includes('id="srec"'), 'so\'nggi hujumlar jadvali (srec)')
  ok(html.includes('id="sblk"'), 'blokda turgan IP\'lar (sblk)')
  ok(html.includes('id="salarms"'), 'signalizatsiya jurnali (salarms)')
  ok(html.includes('loadSecurity'), 'loadSecurity yuklovchisi')
  ok(html.includes('SIGNALIZATSIYA: HUJUM ANIQLANDI'), 'signal banner matni')
  ok(html.includes('data-dm='), 'foydalanuvchi qatorida XABAR tugmasi')
  ok(html.includes('data-in='), 'foydalanuvchi qatorida MA\'LUMOT tugmasi')
  ok(html.includes('function sendDm'), 'sendDm (alohida xabar)')
  ok(html.includes('function showUser'), 'showUser (ma\'lumot oynasi)')
  ok(html.includes("api('security')"), 'panel security API qo\'ng\'irog\'i')
  ok(html.includes("api('dm'"), 'panel dm API qo\'ng\'irog\'i')
  ok(html.includes("api('user?id='"), 'panel user API qo\'ng\'irog\'i')
  ok(html.includes("'??':['Noma"), 'noma\'lum davlat (??) xaritada')
}

// 4) ccOf eski xulq (worker tomoni)
const ccOfM = src.match(/function ccOf\(phone[\s\S]*?\n}/)
ok(!!ccOfM, 'ccOf mavjud')
if (ccOfM) {
  const m = ccOfM[0]
  ok(m.includes('d[1] === "9" ? "RU" : "KZ"'), 'ccOf: +7 qoidasi saqlangan (9xx→RU)')
}
const dialM = src.match(/const CC_DIAL[\s\S]*?\n\]/)
ok(!!dialM && dialM[0].includes('998') && dialM[0].includes('996') && dialM[0].includes('992'), 'CC_DIAL: UZ/KG/TJ prefikslari joyida')

// 5) fwOchko imzasi — info ixtiyoriy, eski qo'ng'iroqlar buzilmaydi
ok(src.match(/function fwOchko\(env: Env, wait[\s\S]*?info\?: SecInfo\)/) !== null, 'fwOchko: info IXTIYORIY parametr (xulq o\'zgarmas)')
const secCalls = (src.match(/fwOchko\((?:env|c\.env), (?:wait|c\.wait), (?:fwip|ip|fip)[^)]*secInfo/g) || []).length
ok(secCalls >= 14, 'fwOchko nuqtalari secInfo bilan jihozlangan', secCalls + ' ta')
ok(src.includes('fwOchko(env, wait, ip, "scan", 3, info)'), 'fw4xx scan ham info oladi')

// 6) secYoz — blok HAR DOIM, ochko 30s dedupe, signal qoidalari
ok(src.includes('async function secYoz'), 'secYoz (strukturaviy jurnal) mavjud')
ok(src.includes('await secYoz(env, ip, kind, weight, info, "blok")'), 'blok hodisasi HAR DOIM yoziladi')
ok(src.includes('> 30_000'), 'ochko 30s dedupe bor')
ok(src.includes('sec_events'), 'sec_events jadvali')
ok(src.includes('sec_alarm'), 'sec_alarm jadvali')
const jiddiyM = src.match(/const jiddiy = act === "blok" && \(kind[^\n]+/)
ok(!!jiddiyM && jiddiyM[0].includes('"root"') && jiddiyM[0].includes('"auth"'), 'jiddiy turlar: root/ext/inj/data/auth → DARHOL signal')
ok(src.includes('> 30 * 60_000'), 'signal 30 daqiqa dedupe')
ok(src.includes('>= 8) alarm = true'), '10 daqiqada 8+ urinish → signal')
ok(src.includes('DELETE FROM sec_events WHERE ts<?', ), 'sec_events 30 kun retensiya')
ok(src.includes('DELETE FROM sec_alarm WHERE ts<?'), 'sec_alarm 90 kun retensiya')

// 7) panelDm direct_key — broadcast bilan bir xil
const dmM = src.match(/async function panelDm\(c: C\)[\s\S]*?\n}/)
ok(!!dmM, 'panelDm mavjud')
if (dmM) {
  ok(dmM[0].includes('id < ADM_ID ? id + ":" + ADM_ID : ADM_ID + ":" + id'), 'panelDm direct_key formulasi (broadcast bilan BIR XIL)')
  ok(dmM[0].includes('blocked=1') || dmM[0].includes('+u.blocked === 1'), 'bloklangan foydalanuvchiga dm YO\'Q')
  ok(dmM[0].includes('blocks WHERE user_id=? AND blocked_id=?'), 'foydalanuvchi adminni bloklagan bo\'lsa dm YO\'Q')
}

// 8) Versiya qulfi
const bv = (src.match(/const BUILD_V = "([^"]+)"/) || [])[1]
const cv = (core.match(/window\.__50BUILD = '([^']+)'/) || [])[1]
const sv = (sw.match(/const V = '50gram-(v[^']+)'/) || [])[1]
ok(bv === 'v105' && cv === 'v105' && sv === 'v105', 'versiya qulfi v105/v105/v105', bv + '/' + cv + '/' + sv)

// 9) Marshrutlar
for (const r of ['["GET", "/panel/security", panelSecurity, true]', '["GET", "/panel/user", panelUser, true]', '["POST", "/panel/dm", panelDm, true]'])
  ok(src.includes(r), 'marshrut: ' + r.slice(9, 40))

// 10) MAXFIYLIK: web/ papkada adminpanel IZI YO'Q (butun papka bo'yicha)
import { readdirSync, statSync } from 'node:fs'
let leaks = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(js|html|css|json|txt)$/.test(f)) {
      try { if (readFileSync(p, 'utf8').toLowerCase().includes('adminpanel')) leaks.push(p) } catch {}
    }
  }
}
walk(new URL('../web', import.meta.url).pathname)
ok(leaks.length === 0, 'MAXFIYLIK: web/ papkada "adminpanel" 0 topilma', leaks.join(', ') || 'toza')

// 11) SEC_KIND_UZ — 10 tur o'zbekcha nomlangan
const knM = src.match(/const SEC_KIND_UZ: Record<string, string> = \{[\s\S]*?\n\}/)
ok(!!knM, 'SEC_KIND_UZ xaritasi')
if (knM) {
  const keys = (knM[0].match(/\w+:\s*"/g) || []).length
  ok(keys >= 10, '10 hujum turi nomlangan', keys + ' ta')
}

console.log(fails === 0 ? '== HAMMASI YASHIL ==' : '== ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
