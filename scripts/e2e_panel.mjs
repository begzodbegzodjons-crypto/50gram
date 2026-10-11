/* 50 GRAM — MAXFIY ADMIN PANEL E2E (v104 → v105 → v106 kengaytirilgan): 50gram.uz/?adminpanel paneldagi API qatlami
 * Jonli sinov (CI runner IP'sidan — sandbox IP firewall-bloklangani uchun lokal sinov mumkin emas):
 *   1) STATIK: /?adminpanel → panel HTML (id="pw" + noindex); / → ODDIY ilova (panel IZI YO'Q)
 *   2) PAROL: xato parol → 401; to'g'ri parol (ADMIN_PASS) → adm-token
 *   3) TOKEN: adm-token'siz /panel/stats → 401 (begona kirib ololmaydi)
 *   4) STATISTIKA: total/blocked/today/online/countries maydonlari
 *   5) FOYDALANUVCHILAR: ro'yxat + qidiruv (yangi test foydalanuvchi topiladi)
 *   6) BLOK: paneldan bloklash → foydalanuvchining /api/me 401 (SESSIYA-DARVOZA ISBOTI),
 *      qayta kod so'rash → 403 "bloklangan" (KIRISH-BLOK ISBOTI)
 *   7) BLOKDAN CHIQARISH: /api/me yana 200 — foydalanuvchi tiklandi
 *   8) BROADCAST: validatsiya (bo'sh → 400)
 *   9) v105 FOYDALANUVCHI OYNASI: /panel/user — profil+davlat+statistika; yomon id → 404; tokensiz → 401
 *  10) v105 ALOHIDA XABAR: /panel/dm — bo'sh → 400, yo'q → 404, bloklanganga → 400,
 *      JONLI YUBORISH FAQAT O'Z TEST HISOBIGA (real foydalanuvchilarga TEGMAYDI)
 *  11) v105 XAVFSIZLIK: /panel/security — statistika + taqsimotlar + 2-qadamdagi xato-parol
 *      urinishi jurnalga tushgani (IP+davlat+tur) — SIGNALIZATSIYA JURNALI jonli dalil
 *  12) v106 KANALLAR: ro'yxat + hisoblar (nc/ng/nb), TEST KANALI yaratiladi (o'zi o'chiriladi):
 *      ma'lumot oynasi (xabarlar+mlist), BLOK → yozish 403 ISBOTI → blokdan chiqarish → yozish 200,
 *      YOMON SO'ZLI xabar → bad:1 belgisi → cleanbad o'chiradi, oddiy xabar → msg/delete,
 *      egasini chiqarish → 400 (posbon), TAGI BILAN O'CHIRISH → chat 404 (o'zi-tozalanadi)
 *  13) v106 HIMOYA TUGMASI: fwtoggle off → security.fwoff=1 → fwtoggle ON (qayta YOQILADI —
 *      himoya faol holatda qoladi), boshqaruv jurnali /panel/log yozuvlari
 *  BROADCAST jonli yuborish SINALMAYDI (haqiqiy foydalanuvchilarga xabar ketmasin).
 * Ishga tushirish: E2E_BASE=https://... node scripts/e2e_panel.mjs
 */
import { readFileSync } from 'node:fs'
const BASE = (process.env.E2E_BASE || 'https://50gram.begzodbegzodjons.workers.dev').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const PANEL_PASS = process.env.PANEL_PASS || 'Balandtoglar1'
const T = { phone: '998900000090', full: '+998900000090' } // panel-test foydalanuvchisi (013-016 band — boshqalar tegilmaydi)

let fails = 0
const ok = (cond, label, extra = '') => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label + (extra ? ' — ' + extra : '')); if (!cond) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const j = async (path, opt = {}) => {
  const r = await fetch(BASE + path, { headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opt.h || {}) }, redirect: 'manual', ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined })
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = { raw: t } }
  return { st: r.status, d, h: r.headers }
}

console.log('== ADMIN PANEL E2E boshlandi:', BASE, '==')
try {
  // 0) DEPLOY-SINXRON: /api/build kutilgan versiyani qaytarguncha kutish (max 3 min)
  const WANTV = 'v' + (readFileSync(new URL('../worker/src/index.ts', import.meta.url), 'utf8').match(/BUILD_V = "v([^"]+)"/) || [])[1]
  let bv = null
  for (let i = 0; i < 36; i++) {
    const b = await j('/api/build').catch(() => null)
    if (b && b.st === 200 && b.d.v) { bv = b.d.v; if (bv === WANTV) break }
    await sleep(5000)
  }
  ok(bv === WANTV, 'deploy sinxron: server versiyasi ' + WANTV, 'aslida=' + bv)

  // 1) STATIK SAHIFALAR
  const pr = await fetch(BASE + '/?adminpanel', { headers: { 'user-agent': UA } })
  const ptxt = await pr.text()
  ok(pr.status === 200 && ptxt.includes('id="pw"'), '/?adminpanel → panel HTML beriladi')
  ok((pr.headers.get('x-robots-tag') || '').includes('noindex'), 'panel noindex (qidiruvchilarga yopiq)')
  ok(!ptxt.includes('window.__50BUILD'), 'panel sahifasi ilova kodi EMAS (alohida sahifa)')
  const home = await fetch(BASE + '/', { headers: { 'user-agent': UA } })
  const htxt = await home.text()
  ok(home.status === 200 && !htxt.includes('id="pw"') && !htxt.toLowerCase().includes('adminpanel'), '/ → oddiy ilova, panel izi YO\'Q')

  // 2) PAROL NAZORATI
  const bad = await j('/api/panel/login', { method: 'POST', body: { pass: 'notogri-parol-' + Date.now() } })
  ok(bad.st === 401, 'xato parol → 401', 'st=' + bad.st)
  const anon = await j('/api/panel/stats')
  ok(anon.st === 401, 'tokensiz /panel/stats → 401', 'st=' + anon.st)
  const good = await j('/api/panel/login', { method: 'POST', body: { pass: PANEL_PASS } })
  ok(good.st === 200 && !!good.d.token, 'to\'g\'ri parol → adm-token')
  const AT = { authorization: 'Bearer ' + (good.d.token || '') }

  // 3) STATISTIKA
  const st1 = await j('/api/panel/stats', { h: AT })
  ok(st1.st === 200 && typeof st1.d.total === 'number' && Array.isArray(st1.d.countries), 'statistika maydonlari (total/countries)', JSON.stringify(st1.d).slice(0, 120))
  ok(st1.d.total >= 1, 'jami foydalanuvchi >= 1', 'total=' + st1.d.total)

  // 4) TEST FOYDALANUVCHI — ro'yxatdan o'tkazish (blok-sinovi uchun)
  const o = await j('/api/auth/otp', { method: 'POST', body: { phone: T.phone, force: 1 } })
  if (o.st !== 200 || !o.d.dev_code) throw new Error('test-user otp ' + o.st)
  const v = await j('/api/auth/verify', { method: 'POST', body: { phone: T.full, code: o.d.dev_code } })
  if (v.st !== 200 || !v.d.token) throw new Error('test-user verify ' + v.st)
  const tokT = v.d.token, uidT = v.d.user.id
  ok(!!uidT, 'test foydalanuvchi tayyor', 'uid=' + uidT)

  // 5) RO'YXAT + QIDIRUV
  const ul = await j('/api/panel/users?page=1', { h: AT })
  ok(ul.st === 200 && Array.isArray(ul.d.users) && ul.d.total >= 1, 'foydalanuvchilar ro\'yxati', 'total=' + ul.d.total)
  const uq = await j('/api/panel/users?page=1&q=' + T.phone, { h: AT })
  const found = (uq.d.users || []).find((x) => x.id === uidT)
  ok(!!found && found.phone === T.full, 'qidiruv test foydalanuvchini topadi', found ? 'cc=' + found.cc : 'topilmadi')
  ok(found && found.cc === 'UZ', 'davlat aniqlandi: UZ (+998)')

  // 6) BLOKLASH → darhol kuchga kiradi
  const bl = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 1 } })
  ok(bl.st === 200 && bl.d.ok, 'paneldan bloklash buyrug\'i')
  const meB = await j('/api/me', { h: { authorization: 'Bearer ' + tokT } })
  ok(meB.st === 401, 'bloklangan foydalanuvchi /api/me → 401 (SESSIYA-DARVOZA)', 'st=' + meB.st)
  const reOtp = await j('/api/auth/otp', { method: 'POST', body: { phone: T.phone, force: 1 } })
  ok(reOtp.st === 403, 'bloklangan raqam kod ola olmaydi → 403 (KIRISH-BLOK)', 'st=' + reOtp.st + ' msg=' + (reOtp.d.error || '').slice(0, 40))

  // 7) BLOKDAN CHIQARISH → to'liq tiklanish
  const ub = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 0 } })
  ok(ub.st === 200 && ub.d.ok, 'paneldan blokdan chiqarish')
  const meU = await j('/api/me', { h: { authorization: 'Bearer ' + tokT } })
  ok(meU.st === 200, 'tiklangan foydalanuvchi /api/me → 200', 'st=' + meU.st)

  // 8) BROADCAST: jonli yuborish SINALMAYDI (haqiqiy foydalanuvchilarga yuborilmasin).
  //    Faqat validatsiya tekshiriladi: bo'sh matn → 400.
  const b0 = await j('/api/panel/broadcast', { method: 'POST', h: AT, body: { body: '' } })
  ok(b0.st === 400, 'broadcast bo\'sh matn → 400 (validatsiya jonli)', 'st=' + b0.st)
  console.log('  ℹ BROADCAST jonli yuborish ataylab sinalmagan (haqiqiy foydalanuvchilarga xabar ketmasin) — SQL konstruktsiyasi lokal simulyatsiyada tekshirilgan')

  // 9) v105 FOYDALANUVCHI MA'LUMOT OYNASI: /panel/user?id=
  const ud = await j('/api/panel/user?id=' + uidT, { h: AT })
  ok(ud.st === 200 && ud.d.phone === T.full && ud.d.cc === 'UZ', 'v105 foydalanuvchi ma\'lumot oynasi (profil+davlat)', 'st=' + ud.st)
  ok(ud.st === 200 && typeof ud.d.messages === 'number' && typeof ud.d.files === 'number', 'v105 foydalanuvchi statistikasi (xabar/fayl hisobi)')
  const udBad = await j('/api/panel/user?id=1', { h: AT })
  ok(udBad.st === 404, 'v105 mavjud bo\'lmagan foydalanuvchi → 404', 'st=' + udBad.st)
  const udAnon = await j('/api/panel/user?id=' + uidT)
  ok(udAnon.st === 401, 'v105 tokensiz /panel/user → 401', 'st=' + udAnon.st)

  // 10) v105 ALOHIDA XABAR: validatsiyalar + TEST HISOBIGA JONLI YUBORISH (faqat o'z test foydalanuvchimizga — real foydalanuvchilarga TEGMAYDI)
  const dm0 = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: '' } })
  ok(dm0.st === 400, 'v105 dm bo\'sh matn → 400', 'st=' + dm0.st)
  const dmBad = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: 1, body: 'test' } })
  ok(dmBad.st === 404, 'v105 dm mavjud bo\'lmagan foydalanuvchi → 404', 'st=' + dmBad.st)
  const blD = await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 1 } })
  ok(blD.st === 200, 'v105 dm-sinov uchun qayta bloklash')
  const dmBl = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: 'blok-sinov' } })
  ok(dmBl.st === 400, 'v105 bloklangan foydalanuvchiga dm → 400', 'st=' + dmBl.st + ' msg=' + (dmBl.d.error || '').slice(0, 40))
  await j('/api/panel/block', { method: 'POST', h: AT, body: { id: uidT, on: 0 } })
  const dmOk = await j('/api/panel/dm', { method: 'POST', h: AT, body: { id: uidT, body: 'v105 panel dm jonli sinov xabari' } })
  ok(dmOk.st === 200 && dmOk.d.ok && dmOk.d.chat_id, 'v105 ALOHIDA XABAR JONLI YUBORILDI («50gram admin» nomidan, test hisobiga)', 'st=' + dmOk.st)

  // 11) v105 XAVFSIZLIK BO'LIMI: /panel/security (2-qadamdagi xato-parol urinishi sec_events'ga yozilgan bo'lishi kerak)
  const secAnon = await j('/api/panel/security')
  ok(secAnon.st === 401, 'v105 tokensiz /panel/security → 401', 'st=' + secAnon.st)
  await sleep(2500) // waitUntil'dagi secYoz yozuvi yerga tushsin
  const sec = await j('/api/panel/security', { h: AT })
  ok(sec.st === 200 && typeof sec.d.e24 === 'number' && typeof sec.d.eall === 'number' && typeof sec.d.uip === 'number', 'v105 xavfsizlik statistikasi (e24/eall/uip)', 'st=' + sec.st + ' j=' + JSON.stringify(sec.d).slice(0, 100))
  ok(Array.isArray(sec.d.kinds) && Array.isArray(sec.d.ccs) && Array.isArray(sec.d.paths) && Array.isArray(sec.d.recent) && Array.isArray(sec.d.alarms) && Array.isArray(sec.d.blocksTop), 'v105 xavfsizlik taqsimotlari (kinds/ccs/paths/recent/alarms/blocksTop)')
  ok(typeof sec.d.blocks === 'number', 'v105 blokda turgan IP soni (SEC DO\'dan)', 'blocks=' + sec.d.blocks)
  const authEv = (sec.d.recent || []).find((x) => x.kind === 'auth' && x.ip)
  ok(!!authEv, 'v105 PANELGA HUJUM QAYD ETILGAN (2-qadamdagi xato-parol urinishi jurnalda)', authEv ? 'ip=' + authEv.ip + ' cc=' + authEv.cc + ' act=' + authEv.act : 'topilmadi')
  console.log('  ℹ v105 xavfsizlik: ' + (sec.d.eall || 0) + ' jami urinish, ' + (sec.d.e24 || 0) + ' (24soat), ' + (sec.d.uip || 0) + ' noyob IP, ' + (sec.d.blocks || 0) + ' blokda')

  // 12) v106 KANALLAR/GURUHLAR MODERATSIYASI — TEST KANALI BILAN TO'LIQ SIKL (o'zi o'chiriladi)
  const chAnon = await j('/api/panel/chats')
  ok(chAnon.st === 401, 'v106 tokensiz /panel/chats → 401', 'st=' + chAnon.st)
  const chL = await j('/api/panel/chats?page=1', { h: AT })
  ok(chL.st === 200 && Array.isArray(chL.d.chats) && typeof chL.d.nc === 'number' && typeof chL.d.ng === 'number' && typeof chL.d.nb === 'number', 'v106 kanallar ro\u2018yxati + hisoblar (nc/ng/nb)', 'kanal=' + chL.d.nc + ' guruh=' + chL.d.ng + ' blok=' + chL.d.nb)
  const chT = await j('/api/panel/chats?page=1&ft=blocked', { h: AT })
  ok(chT.st === 200 && Array.isArray(chT.d.chats), 'v106 bloklanganlar filtri ishlaydi')
  // TEST KANALI — test foydalanuvchi egasida (oxirida TAGI BILAN o'chiriladi — iz qolmaydi)
  const mkCh = await j('/api/chats', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: { type: 'channel', title: 'Panel-v106-test-kanal', is_public: 1 } })
  ok(mkCh.st === 200 && mkCh.d.id, 'v106 test kanali yaratildi (test hisobida)', 'id=' + mkCh.d.id)
  const CID = mkCh.d.id
  if (CID) {
    const cd = await j('/api/panel/chat?id=' + CID, { h: AT })
    ok(cd.st === 200 && cd.d.type === 'channel' && Array.isArray(cd.d.messages) && Array.isArray(cd.d.mlist), 'v106 kanal ma\u2018lumot oynasi (xabarlar+a\u2018zolar)', 'st=' + cd.st)
    ok(cd.d.owner && cd.d.owner.phone === T.full, 'v106 kanal egasi ko\u2018rinadi (telefon bilan)')
    // yomon so'zli xabar + oddiy xabar (test hisobidan)
    const sm1 = await j('/api/chats/' + CID + '/messages', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: { kind: 'text', body: 'bu siktir gap test' } })
    ok(sm1.st === 200, 'v106 test kanaliga yomon so\u2018zli xabar yozildi', 'st=' + sm1.st)
    const sm2 = await j('/api/chats/' + CID + '/messages', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: { kind: 'text', body: 'v106 oddiy test xabari, salom!' } })
    ok(sm2.st === 200, 'v106 test kanaliga oddiy xabar yozildi', 'st=' + sm2.st)
    const cd2 = await j('/api/panel/chat?id=' + CID, { h: AT })
    const badMsg = (cd2.d.messages || []).find((x) => x.bad === true)
    const goodMsg = (cd2.d.messages || []).find((x) => x.bad === false && (x.body || '').includes('oddiy test xabari'))
    ok(!!badMsg, 'v106 YOMON SO\u2018Z belgisi ishlaydi (bad:true)', badMsg ? 'id=' + badMsg.id : 'topilmadi')
    ok(!!goodMsg, 'v106 oddiy xabar belgisiz (bad:false)')
    // egasini chiqarish — POSBON (400)
    const ko = await j('/api/panel/chat/kick', { method: 'POST', h: AT, body: { id: CID, uid: uidT, ban: 0 } })
    ok(ko.st === 400, 'v106 kanal EGASINI chiqarish → 400 (posbon)', 'st=' + ko.st)
    // BLOK → yozish 403 (jonli ISBOT) → blokdan chiqarish → yozish yana ochiladi
    const cb = await j('/api/panel/chat/block', { method: 'POST', h: AT, body: { id: CID, on: 1 } })
    ok(cb.st === 200 && cb.d.ok, 'v106 paneldan kanal bloklash')
    const chBlk = await j('/api/panel/chats?page=1&ft=blocked&q=Panel-v106-test', { h: AT })
    ok(chBlk.st === 200 && (chBlk.d.chats || []).some((x) => x.id === CID && x.bl === true), 'v106 bloklanganlar ro\u2018yxatida ko\u2018rinadi')
    const smB = await j('/api/chats/' + CID + '/messages', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: { kind: 'text', body: 'bloklangan kanalga yozish' } })
    ok(smB.st === 403 && /bloklangan/i.test(smB.d.error || ''), 'v106 BLOKLANGAN kanalga yozish → 403 (JONLI ISBOT)', 'st=' + smB.st)
    const juB = await j('/api/chats/' + CID + '/join', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: {} })
    ok(juB.st === 403, 'v106 bloklangan kanalga qayta kirish → 403', 'st=' + juB.st)
    const cu = await j('/api/panel/chat/block', { method: 'POST', h: AT, body: { id: CID, on: 0 } })
    ok(cu.st === 200 && cu.d.ok, 'v106 blok yozuvi olib tashlandi (blokdan chiqarish)')
    const smU = await j('/api/chats/' + CID + '/messages', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: { kind: 'text', body: 'blokdan keyin yana yozish ochiq' } })
    ok(smU.st === 200, 'v106 blokdan keyin yozish tiklandi → 200', 'st=' + smU.st)
    // YOMON SO'ZLARNI BIR ZUMDA O'CHIRISH
    const cln = await j('/api/panel/chat/cleanbad', { method: 'POST', h: AT, body: { id: CID } })
    ok(cln.st === 200 && cln.d.removed >= 1, 'v106 cleanbad yomon xabarlarni o\u2018chiradi', 'removed=' + cln.d.removed)
    const cd3 = await j('/api/panel/chat?id=' + CID, { h: AT })
    ok(!(cd3.d.messages || []).some((x) => x.bad === true), 'v106 cleanbad\u2019dan keyin yomon xabar ro\u2018yxatda YO\u2018Q')
    // BITTA XABARNI O'CHIRISH (oddiy xabar)
    if (goodMsg) {
      const md = await j('/api/panel/msg/delete', { method: 'POST', h: AT, body: { id: goodMsg.id } })
      ok(md.st === 200 && md.d.ok, 'v106 bitta xabarni o\u2018chirish (panel/msg/delete)', 'st=' + md.st)
      const md2 = await j('/api/panel/msg/delete', { method: 'POST', h: AT, body: { id: goodMsg.id } })
      ok(md2.st === 404, 'v106 o\u2018chirilgan xabar qayta o\u2018chirilmaydi → 404')
    }
    // DIRECT chat panel'dan o'chirmaydi (posbon) — dm suhbati orqali tekshiruv
    const dd = await j('/api/panel/chat/delete', { method: 'POST', h: AT, body: { id: dmOk.d.chat_id } })
    ok(dd.st === 404, 'v106 shaxsiy (direct) chat paneldan o\u2018chirmaydi → 404 (posbon)')
    // TAGI BILAN O'CHIRISH — test kanali butunlay ketadi (iz qolmaydi)
    const cdel = await j('/api/panel/chat/delete', { method: 'POST', h: AT, body: { id: CID } })
    ok(cdel.st === 200 && cdel.d.ok, 'v106 kanal TAGI BILAN o\u2018chirildi', 'st=' + cdel.st)
    const g404 = await j('/api/chats/' + CID, { h: { authorization: 'Bearer ' + tokT } })
    ok(g404.st === 404, 'v106 o\u2018chirilgan kanal /api/chats/:id → 404 (to\u2018liq ketdi)', 'st=' + g404.st)
  }

  // 13) v106 HIMOYA TUGMASI — O'CHIRISH → holat=O'CHIQ → QAYTA YOQISH (faol holatda qoladi)
  const fwAnon = await j('/api/panel/fwtoggle', { method: 'POST', body: { on: 0 } })
  ok(fwAnon.st === 401, 'v106 tokensiz /panel/fwtoggle → 401', 'st=' + fwAnon.st)
  const fw0 = await j('/api/panel/fwtoggle', { method: 'POST', h: AT, body: { on: 0 } })
  ok(fw0.st === 200 && fw0.d.ok && fw0.d.on === 0, 'v106 himoya O\u2018CHIRILDI (test rejimi)', 'st=' + fw0.st)
  await sleep(800)
  const sec2 = await j('/api/panel/security', { h: AT })
  ok(sec2.st === 200 && sec2.d.fwoff === 1, 'v106 security.fwoff=1 — himoya holati O\u2018CHIQ ko\u2018rinadi', 'fwoff=' + sec2.d.fwoff)
  const fw1 = await j('/api/panel/fwtoggle', { method: 'POST', h: AT, body: { on: 1 } })
  ok(fw1.st === 200 && fw1.d.ok && fw1.d.on === 1, 'v106 himoya QAYTA YOQILDI (doim faol holat)', 'st=' + fw1.st)
  await sleep(800)
  const sec3 = await j('/api/panel/security', { h: AT })
  ok(sec3.st === 200 && sec3.d.fwoff === 0, 'v106 security.fwoff=0 — himoya YONIQ (yakuniy holat)', 'fwoff=' + sec3.d.fwoff)
  // BOSHQARUV JURNALI — bugungi amallar ko\u2018rinadi
  const lg = await j('/api/panel/log', { h: AT })
  ok(lg.st === 200 && Array.isArray(lg.d.rows), 'v106 boshqaruv jurnali ko\u2018rinadi', 'rows=' + (lg.d.rows || []).length)
  ok((lg.d.rows || []).some((x) => x.act === 'himoya_yoqildi') && (lg.d.rows || []).some((x) => x.act === 'himoya_ochirildi'), 'v106 jurnalda himoya amallari yozilgan')
  ok((lg.d.rows || []).some((x) => x.act === 'chat_blok' || x.act === 'chat_ochirish' || x.act === 'chat_yomon_och'), 'v106 jurnalda kanal amallari yozilgan')

  // 14) YOPILISH: test foydalanuvchisini logout (iz qolmasin)
  try { await j('/api/auth/logout', { method: 'POST', h: { authorization: 'Bearer ' + tokT }, body: {} }) } catch {}
} catch (e) {
  fails++
  console.log('  ✗ FAIL istisno:', String(e && e.message || e))
}
console.log(fails === 0 ? '== ADMIN PANEL E2E: HAMMASI YASHIL ==' : '== ADMIN PANEL E2E: ' + fails + ' FAIL ==')
process.exit(fails === 0 ? 0 : 1)
