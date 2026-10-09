/* 50 Gram — audio/video qo'ng'iroqlar va jonli efir (WebRTC)
   ═══════════════════════════════════════════════════════════════════════════
   v77: QO'NG'IROQ DVIGATELI 0 DAN QAYTA YOZILDI (eski ~1160 qatorli yamaq-qatlami
   to'liq o'chirildi — 2 kunlik «birtomonlama ovoz» ildizlari konstruktiv yo'q qilindi)

   «A chaqiradi, B'da hammasi joyida; A'da B videosi ko'rinadi, OVOZI kelmayapti»
   ning 3 ta ildizi (hammasi o'chirildi):

   1) IKKI TOMONLI OFFER — GLARE (asosiy ildiz): avvalgi kodda chaqiruvchi HAM,
      qabul qiluvchi HAM createOffer + ICE restart qilardi (6+ qorovul har ikki
      tomonda). Mobil tarmoqdagi qisqa uzilishda IKKALA tomon bir vaqtda offer
      yuborardi → rollback ping-pongi → SDP holati buzilib BITTOMONLAMA media
      qolardi (v64 izohida aynan shu simptom qayd etilgan). CI E2E toza tarmoqda
      glare'ni hech qachon ushlab olmasdi — shuning uchun testlar yashil, hayotda
      buzilgan edi.
      → R1: offer FAQAT CHAQIRUVCHI tomonda yaratiladi (boshlang'ich + ICE restart).
        Qabul qiluvchi HECH QACHON offer yaratmaydi — yordam kerak bo'lsa 'needice'
        so'rov yuboradi. GLARE KONSTRUKTIV MUMKIN EMAS.

   2) ontrack'da OQIM ALMASHTIRILISHI: C.remoteStream = e.streams[0] — har trek
      hodisasi elementlar oqimini QAYTA YOZARDI; audio oxirgi kelsa (yoki oqim
      aniqlanmasa) elementlarda video-yakka oqim qolardi → ovoz abadiy yo'qolardi.
      → R2: har qo'ng'iroqda BITTA doimiy MediaStream yaratiladi; ontrack faqat
        TREK QO'SHADI; elementlar srcObject bir marta bog'lanadi.

   3) play() rad etilsa ovoz JIMLASh: avvalgi kod audio elementni o'zi MUTED qilib
      bitta bosishni kutardi — WebView'da (autoplay gesture'i sarflanadi) ovoz
      abadiy jim qolardi. → R3: 3-qatlamli ovoz zanjiri (audio-element →
      video-element → WebAudio) + AudioContext qo'ng'iroq boshida FOYDALANUVCHI
      BOSISHI ICHIDA ochiladi + har bosishda zanjir tiklanadi. Faqat BITTA yo'l
      ovoz chiqaradi (qolganlari jimsiz) — takroriy ovoz/echo yo'q.

   Qo'shimcha kafolatlar:
   R4: getUserMedia natijasida audio treki MAJBURIY tekshiriladi (mikrofon yo'q —
       aniq xato, «sirli birtomonlama ovoz» imkonsiz).
   R5: offer/answer oseq (navbat raqami) bilan belgilanadi — eski javob qabul
       qilinmaydi (restart'dan keyin kechikkan javob ICE'ni buzolmaydi).
   R6: BITTA sog'liq-halqasi (5s) — rollarga bo'lingan tiklash narvoni, har 15s
       statistika jurnalga yoziladi (inA/inV/outA/outV + ovoz yo'li).

   v91 (OVOZ-QULOQCHI — ASOSIY TUZATISH): real jurnal (Task 34) — APK'da VIDEO qo'ng'iroqda
   bir tomon ovozi chiqmaydi (X: k=0% rb=1, inA FAOL +13-19KB/5s, element ijroda — lekin
   eshitilmaydi). Ildizlar:
   1) APK 2.6'da speaker ko'prigi YO'Q (v2.8'da yozilgan, qurilmalarga o'rnatilmagan) —
      Chromium WebRTC MODE_IN_COMMUNICATION o'rnatadi va ovoz QULOQCHIGA yo'naladi;
      video qo'ng'iroqda telefon YUZ OLDIDA bo'lgani uchun eshitilmaydi, audio qo'ng'iroqda
      QULOQ YONIDA — eshitiladi (shikoyatning «faqat video»ligi ana shundan).
   2) 'wa' (WebAudio → STREAM_MUSIC → KARNAY) yo'li quloqchi marshrutini CHETLAB O'TADI —
      lekin v84/v90'dagi qorovul tap-yolg'on nol (k=0) tufayli ishlayotgan 'wa'dan
      ORQAGA qaytarardi — qutqaruvchi o'ldiruvchi bo'lgan.
   Tuzatishlar: (1) APK video qo'ng'iroqda default ovoz yo'li endi 'wa' (karnay);
   (2) wa-qaytish qorovuli endi DEKODER dalili (alv=getStats audioLevel) bilan — tap
   yolg'oni ishlayotgan yo'lni buzolmaydi; (3) qutqaruv narvoni UZLUKSIZ: rebind →
   rejim → rejim → elementlarni-0dan-qurish → native-kick → AYLANISH (abadiy jimlik
   mumkin emas); (4) «Dinamik» WebAudio'ni ham o'chiradi/tiklaydi; (5) APK 3.0:
   audioKick/routeInfo ko'priklari + to'g'ri marshrut tartibi.

   v92 (ANIQLANGAN OVOZ — TASODIFIYLIK YO'Q QILINDI): «bir qarasang ishlaydi, bir
   qarasang ishlamaydi» degan shikoyatning ildizi — QUTQARUV TIZIMINING O'ZI
   tasodifiy edi. 3 ta manba topildi va yo'q qilindi:
   a) v91 wa-qorovuli dInA>0 bilan ishlar edi — lekin Opus SUKUTI ham paket yuboradi
      (dInA>0, ~10x kam). Ya'ni qarshi tomon 15s GAPIRMASA — audioLevel=0 bo'lardi →
      ISHLAYOTGAN karnay yo'li 'ra'ga (quloqchi) almashtirilardi → video'da jim.
      SUKUT O'ZI YO'LNI BUZARDI — har qo'ng'iroqda sukut payti boshqacha → tasodif.
   b) alv ishlamasa + AudioContext suspended bo'lsa — qutqaruv UMUMAN ishlamardi.
   c) AudioContext har qo'ng'iroqda yopilib qayta ochilardi — natija noaniq.
   v92 QOIDALARI (hammasi aniqlangan — xuddi shu sharoitda xuddi shu natija):
   (1) YO'NALISH faqat 3 narsaga bog'liq: platforma + qo'ng'iroq turi + «Dinamik».
   (2) Qutqaruv FAQAT «qarshi tomon NUTQ ko'chirmoqda (dInA>8KB/5s — sukuti bunday
       bo'lolmaydi) LEKIN eshitish dalili YO'Q (alv/k<1)» bo'lsa ishlaydi. Sukutda
       yo'l HECH QACHON o'zgartirilmaydi.
   (3) AudioContext GLOBAL — bir marta ochiladi (bosish ichida), HECH QACHON
       yopilmaydi; 'wa' yo'lida ijro metrikasi waGain'DAN KEYIN o'lchanadi (oqim-tap
       yolg'onlari chetlab o'tiladi).
   (4) play() rad etilsa — «Ovozni yoqish» tugmasi (kaskad qayta urinishlar YO'Q).

   v95 (TOZA KAINOT — «1-QO'NG'IROQ ZO'R, KEYINGISI JIM» KASALLIGI HAL QILINDI):
   Foydalanuvchi dalili: BIRINCHI video qo'ng'iroq mukammal, KEYINGI qo'ng'iroqlarda
   ovoz yo'qoladi. Bu HAL QILUVCHI dalil — muammo o'rtada (qo'ng'iroq davomida) EMAS,
   QO'NG'IROQLAR ORASIDA. 3 ta iflos meros manbasi topildi va yo'q qilindi:
   a) GLOBAL AudioContext qo'ng'iroqlar orasida SAQLANARDI — v94 forenzikasi ko'rsatgan
      «running lekin ichi o'lik» holatga aynan shu tushardi; 2-qo'ng'iroq o'lik
      kontekstda tug'ilardi. v95: endCall kontekstni YOPADI, har qo'ng'iroq foydalanuvchi
      bosishi ichida VIRGIN kontekst ochadi (freshAudioUniverse — 4-marta resume narvoni).
   b) endCall TARTIBI buzuk edi: speaker(false) (native HAL reset) TIRIK WebRTC
      sessiyasi ustida ishlar edi — clearCommunicationDevice + MODE_NORMAL jonli
      yo'lni ostidan tortardi → WebView audio-HAL yarim-yiqilgan holatda qolardi →
      keyingi qo'ng'iroq pleyout-quvuri o'lik tug'ilardi. v95: avval MEDIA to'liq
      o'ladi (elementlar srcObject=null → masofa treklari stop → pc.close →
      mikrofon stop), SO'NG 700ms'dan KEYIN guarded OS-marshrut reset.
   c) Qo'ng'iroq boshida PROAKTIV audioKick — OS ovoz-yo'li har qo'ng'iroq boshida
      OLDINDAN 0 dan o'rnatiladi (NORMAL → COMMUNICATION + karnay), avvalgi
      qo'ng'iroqdan qolgan HAL-zamblikka tayanmaydi. audioKick endi faqat kech
      qutqaruv EMAS — har qo'ng'iroqning BIRINCHI qadami.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict'
// ─────────────────────────────── ICE / MEDIA ───────────────────────────────
let iceCache = null, iceAt = 0
// OFFLINE ZAXIRA (v79): server /ice javob bermasa ham TURN bo'lsin — STUN yolg'iz
// NAT ostidagi ikki xil tarmoqni (Wi-Fi ↔ mobil) ko'pincha bog'lay olmaydi
const ICE_FALLBACK = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:8080'], username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: ['turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
]
async function iceServers(force) {
  // KESH 10 daqiqa: TURN cred muddati tugasa 'failed'da force bilan DARHOL yangilanadi
  if (!force && iceCache && Date.now() - iceAt < 10 * 60000) return iceCache
  try { iceCache = (await api('/ice')).iceServers; iceAt = Date.now() } catch { iceCache = ICE_FALLBACK }
  return iceCache
}
const sig = (to, data) => post('/signal', { to, data }).catch(() => {})
async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Brauzer qo‘ng‘iroqni qo‘llamaydi (HTTPS kerak)')
  // APK: OS darajasidagi kamera/mikrofon ruxsat kafolati — WebView ichki ruxsati
  // tushib qolgan bo'lsa ham haqiqiy Android ruxsat oynasi chiqadi (Android50.ensurePerms)
  try {
    if (window.Android50 && typeof window.Android50.ensurePerms === 'function') {
      window.Android50.ensurePerms()
      await new Promise((r) => setTimeout(r, 380))
    }
  } catch {}
  // WARMUP-POYG'ASI: ilova ochilishidagi birinchi bosishda __50warmup ham getUserMedia
  // qo'zg'atadi — ba'zi qurilmalarda IKKITA kamera so'rovi bir vaqtda ikkinchisini osiradi.
  // Warmup tinchguncha (≤3s) kutamiz.
  try { if (window.__50warmP) await Promise.race([window.__50warmP.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]) } catch {}
  const hangMs = window.Android50 ? 16000 : 12000
  let last = null
  for (let i = 0; i < 2; i++) {
    // 1-urinish: sifatli (720p + echo-cancel). 2-urinish: YENGIL sozlamalar —
    // band/past-qurilmali kameralarda yengil urinish ko'p hollarda ochiladi.
    const con = i === 0
      ? { audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false }
      : { audio: true, video: video ? { facingMode: 'user' } : false }
    let got = null
    const gp = navigator.mediaDevices.getUserMedia(con).then((s) => { got = s; return s })
    try {
      // getUserMedia ba'zi qurilmalarda ABADIY osilib qoladi — qorovul aniq xato bilan yopadi
      return await Promise.race([
        gp,
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('hang'), { name: 'MediaHangError' })), hangMs)),
      ])
    } catch (e) {
      last = e
      // GHOST-SWEEPER: taymer yutsa getUserMedia promise'i keyinroq yechilib KAMERANI
      // BAND qolmasin — kech yechilgan oqim DARHOL o'chiriladi
      try { gp.then((s) => { try { s.getTracks().forEach((t) => t.stop()) } catch {} }).catch(() => {}) } catch {}
      try { if (got) got.getTracks().forEach((t) => t.stop()) } catch {}
      if (e && e.name === 'MediaHangError') {
        if (i === 0) { await new Promise((r) => setTimeout(r, 3500)); continue }
        break
      }
      if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) throw new Error(video ? 'Kamera topilmadi' : 'Mikrofon topilmadi')
      if (e && (e.name === 'NotReadableError' || e.name === 'AbortError')) { await new Promise((r) => setTimeout(r, 700)); continue }
      break
    }
  }
  if (last && (last.name === 'NotAllowedError' || last.name === 'SecurityError')) {
    // v88: brauzer va APK uchun HAR XIL ko'rsatma — brauzerda ruxsat manzil-satrida beriladi
    if (window.Android50) throw new Error('Kamera va mikrofonga ruxsat berilmagan — Sozlamalarda ilova ruxsatlaridan Kamera va Mikrofoni yoqing')
    throw new Error('Kamera/mikrofonga ruxsat berilmagan — manzil satridagi 🎥/🎤 ikonkani bosib “Ruxsat berish”ni tanlang (yoki sahifani yangilab, so‘rovga rozi bo‘ling)')
  }
  if (last && last.name === 'MediaHangError') {
    throw new Error('Kamera javob bermadi — yana bir marta bosing; ishlamasa ilovani to‘liq yopib qayta oching')
  }
  throw new Error(video ? 'Kamera/mikrofon ochilmadi — qayta urinib ko‘ring' : 'Mikrofon ochilmadi — qayta urinib ko‘ring')
}
// R4 KAFOLATI: media oqimi tayyor — treklar MAJBURIY tekshiriladi (R4 darhol xato,
// «mikrofonsiz qo'ng'iroq» = birtomonlama ovoz = taqiqlangan)
function validateMedia(s, video) {
  if (!s) throw new Error('Mikrofon ochilmadi')
  s.getTracks().forEach((t) => { try { t.enabled = true } catch {} })
  if (!s.getAudioTracks().length) {
    try { s.getTracks().forEach((t) => t.stop()) } catch {}
    throw new Error('Mikrofon topilmadi — boshqa ilova egallab olgan bo‘lishi mumkin')
  }
  if (video && !s.getVideoTracks().length) {
    try { s.getTracks().forEach((t) => t.stop()) } catch {}
    throw new Error('Kamera topilmadi — boshqa ilova egallab olgan bo‘lishi mumkin')
  }
  return s
}
// ---------------- AVTOMATIK RUXSAT (brauzer/PWA) — bir marta so'raymiz ----------------
window.__50warmup = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return
  let cam = null, mic = null
  try { cam = await navigator.permissions.query({ name: 'camera' }) } catch {}
  try { mic = await navigator.permissions.query({ name: 'microphone' }) } catch {}
  if ((cam && cam.state === 'denied') || (mic && mic.state === 'denied')) return
  if (cam && mic && cam.state === 'granted' && mic.state === 'granted') return
  document.addEventListener('pointerdown', () => {
    // v92: birinchi bosishda GLOBAL AudioContext ham ochiladi — qo'ng'iroqsiz ilova
    // ishlatilganda ham ovoz-qulfi tayyor bo'ladi
    try { if (!window.__50actx || window.__50actx.state === 'closed') window.__50actx = new (window.AudioContext || window.webkitAudioContext)() } catch {}
    try { if (window.__50actx && window.__50actx.state === 'suspended') window.__50actx.resume().catch(() => {}) } catch {}
    let ws = null
    const p = navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 640 } } })
      .then((s) => { ws = s; s.getTracks().forEach((t) => t.stop()) }).catch(() => {})
    window.__50warmP = p
    // GHOST-SWEEPER (warmup): ruxsat so'rovi osilib qolsa kech yechilgan oqim kamerani band qilmasin
    setTimeout(() => { try { p.then(() => { try { if (ws) ws.getTracks().forEach((t) => t.stop()) } catch {} }).catch(() => {}) } catch {} }, 6000)
    setTimeout(() => { if (window.__50warmP === p) window.__50warmP = null }, 8000)
  }, { once: true })
}
async function newPC(onIce) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() })
  pc.onicecandidate = (e) => e.candidate && onIce(e.candidate.toJSON())
  return pc
}
// ─────────────────────── ISHONCHLI SIGNAL + KLIENT JURNALI ───────────────────────
// sigTo: muhim signallar (accept/offer/answer) 3 martagacha qayta uriniladi —
// 'accept'/'answer' yo'qolsa qo'ng'iroq abadiy osilib qolmasdi
async function sigTo(to, data, tries = 3, gap = 700) {
  for (let i = 0; i < tries; i++) {
    try { await post('/signal', { to, data }); return true }
    catch (e) { if (i < tries - 1) await new Promise((r) => setTimeout(r, gap)) }
  }
  return false
}
let clogBuf = [], clogLastId = ''
function clog(tag, extra) {
  const line = new Date().toISOString().slice(11, 23) + ' ' + tag + (extra ? ' | ' + extra : '')
  clogBuf.push(line)
  if (clogBuf.length > 70) clogBuf.splice(0, clogBuf.length - 70)
  try { console.info('[call]', line) } catch {}
}
function shipClog() {
  if (!clogBuf.length || !S.token) return
  // v87: har POSTga 6 qator (avval 14 edi) — worker bitta xabarni 3000 belgigacha oladi,
  // 14 qator birlashganda 900+ belgi bo'lib OXIRGI qatorlar (stat/endCall!) KESILIB QOLARDI
  // — jurnalda «B tomon stat yo'q» muammosining ildizi shu edi.
  const lines = clogBuf.splice(0, 6)
  try {
    fetch(API + '/clog', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token }, body: JSON.stringify({ c: String(clogLastId || (CALL && CALL.id) || ''), m: lines.join(' ¦ ') }), keepalive: true }).catch(() => {})
  } catch {}
}
setInterval(() => { if (CALL && clogBuf.length >= 4) shipClog() }, 10000)
function logSig(tag, extra) { try { console.info('[sig]', tag, '|', extra || '') } catch {}; clog('sig:' + tag, extra) }
// SIGNAL NAVBAT-POLLING: WS zombi bo'lsa ham signallar yetadi (server fetch-and-delete navbat)
let lastSid = 0, sigPollT = 0, sigPollBusy = false, sigPollAt = 0, sigFails = 0, sigLogAt = 0
async function drainSigQueue() {
  if (!CALL) return
  // QOTIQ QOROVULI: api() 20s+retry gacha osilib qolishi mumkin — 8s'dan keyin qulflangan
  // bo'lsa ham yangi so'rov ketadi (fetch-and-delete atomic + sid-dedup → xavfsiz)
  if (sigPollBusy && Date.now() - sigPollAt < 8000) return
  sigPollBusy = true
  sigPollAt = Date.now()
  try {
    const r = await api('/signal/queue?since=' + lastSid)
    sigFails = 0
    const sigs = (r && r.signals) || []
    if (sigs.length) logSig('navbat ' + sigs.length + ' ta', sigs.map((s) => (s.data || {}).k).join(','))
    for (const s of sigs) {
      const sid = +s.sid || 0
      if (sid > lastSid) lastSid = sid
      try { handleSignalEv({ type: 'signal', sid, from: s.from, data: s.data }) } catch (e) { logSig('navbat-ishlov xato', String((e && e.message) || e)) }
    }
  } catch (e) {
    sigFails++
    if (Date.now() - sigLogAt > 4000) { sigLogAt = Date.now(); logSig('navbat-xato #' + sigFails, String((e && e.message) || e)) }
    if (sigFails >= 3) { sigFails = 0; logSig('navbat-xato', '3+ ketma-ket — WS majburiy qayta ulanadi'); try { S.ws && S.ws.readyState === 1 && S.ws.close() } catch {} }
  }
  sigPollBusy = false
}
function startSigPoll() {
  stopSigPoll()
  sigFails = 0
  logSig('poll yoqildi', 'lastSid=' + lastSid)
  sigPollT = setInterval(drainSigQueue, 1800)
  drainSigQueue()
}
function stopSigPoll() { if (sigPollT) { clearInterval(sigPollT); sigPollT = 0 } }
// Yangi CHAQIRUVCHI boshlanishida eski juvonlarni supurish (yangi qo'ng'iroqning o'z
// signallari hali bo'lolmaydi — supurish xavfsiz)
async function purgeStaleSignals() {
  try {
    const r = await api('/signal/queue?since=0')
    const sigs = (r && r.signals) || []
    if (sigs.length) {
      for (const s of sigs) { const sid = +s.sid || 0; if (sid > lastSid) lastSid = sid }
      logSig('eski-navbat supurildi', sigs.length + ' ta eski juvon tashlandi')
    }
  } catch {}
}
// SID DEDUP: signal WS + navbat orqali IKKI MARTA kelishi mumkin
const sigSeen = new Set()
function sigDedup(sid) {
  if (!sid) return false
  if (sigSeen.has(sid)) return true
  if (sigSeen.size > 600) sigSeen.clear()
  sigSeen.add(sid)
  return false
}
// ───────────────────────────── QO'NG'IROQ HOLAT MASHINASI ─────────────────────────────
let CALL = null
const setCallState = (t) => CALL && (qs('.cst', CALL.el).textContent = t)
// SVG ikonkalar — har bir qurilmada aniq ko'rinadi (emoji o'rniga)
const IC = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor" style="transform:rotate(135deg)"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5a3 3 0 0 0-6 0v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52a5 5 0 0 1-5-5H5a7 7 0 0 0 6 6.92V21h2v-3.08c.96-.14 1.86-.49 2.65-.98L19.73 21 21 19.73 4.27 3z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>',
  spk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 5h-3.17L15 3H9L7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-8 13a5 5 0 1 1 5-5c0 .72-.16 1.4-.43 2.02L18 13.5v5h-5l1.48-1.48c-.62.27-1.3.43-2.02.43z" transform="scale(0.9) translate(1.3,1.3)"/><path d="M12 8.5a4.5 4.5 0 1 0 4.5 4.5H12V8.5z" opacity="0"/></svg>',
  aonly: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>'
}
function callUI(peer, video, state) {
  const el = document.createElement('div')
  el.className = 'over call' + (video ? ' vid' : '')
  // OVOZ: faqat BITTA element ovoz chiqaradi (playRemote zanjiri boshqaradi —
  // 'ra' audio → 'v' video → 'wa' WebAudio). .local doim jimsiz (mikrofon qaytishi yo'q).
  el.innerHTML = `<video class="remote" autoplay playsinline muted></video><video class="local" autoplay playsinline muted></video><audio class="ra" autoplay></audio>
    <div class="qi hide" title="Aloqa sifati"><i></i><i></i><i></i></div>
    <button class="l-un hide" type="button">🔊 Ovozni yoqish</button>
    <div class="cinfo">${avHTML(peer, 120, { noStory: true })}<h2>${esc(uname(peer))}</h2><div class="cst">${state}</div><div class="aom">🔊 Faqat ovoz rejimi</div></div>
    <div class="cbar"></div>`
  document.body.appendChild(el)
  // R3: qo'ng'iroq oynasida HAR bosish — ovoz zanjirini tiklashga urinish
  // (autoplay bloki / fonga kirish ovozi o'chgan bo'lsa — tekkanida QAYTADI)
  el.addEventListener('pointerdown', () => { const C = CALL; if (C && C.el === el) { unlockAudio(C); playRemote(C) } })
  const pill = qs('.l-un', el)
  if (pill) pill.onclick = (e) => { e.stopPropagation(); const C = CALL; if (C && C.el === el) { unlockAudio(C); playRemote(C) } }
  return el
}
function callButtons(kind) {
  const b = qs('.cbar', CALL.el)
  const wrap = (cls, icon, label, act) => `<div class="cbtn ${cls}"><button class="cb ${cls}" data-c="${act}">${icon}</button><span>${label}</span></div>`
  if (kind === 'incoming') {
    b.innerHTML = wrap('end', IC.end, 'Rad etish', 'decline') + wrap('ok', CALL.video ? IC.cam : IC.phone, 'Javob berish', 'accept')
  } else {
    b.innerHTML = `<div class="cbtn mic"><button class="cb" data-c="mic">${IC.mic}</button><span>Mikrofon</span></div>`
      + (CALL.video ? `<div class="cbtn cam"><button class="cb" data-c="cam">${IC.cam}</button><span>Kamera</span></div><div class="cbtn"><button class="cb" data-c="flip">${IC.flip}</button><span>Almashtirish</span></div><div class="cbtn"><button class="cb" data-c="aonly">${IC.aonly}</button><span>Faqat ovoz</span></div>` : ``)
      + `<div class="cbtn spk"><button class="cb" data-c="spk">${IC.spk}</button><span>Dinamik</span></div>`
      + wrap('end', IC.end, 'Tugatish', 'hang')
  }
  b.onclick = (e) => {
    const t = e.target.closest('[data-c]')
    const k = t?.dataset.c; if (!k) return
    const C = CALL
    if (k === 'accept') acceptCall()
    if (k === 'decline') endCall('declined', true)
    if (k === 'hang') endCall('ended', true)
    if (k === 'mic') { const tr = C?.local?.getAudioTracks()[0]; if (tr) { tr.enabled = !tr.enabled; t.classList.toggle('off', !tr.enabled); t.innerHTML = tr.enabled ? IC.mic : IC.micOff } }
    if (k === 'cam') { const tr = C?.local?.getVideoTracks()[0]; if (tr) { tr.enabled = !tr.enabled; t.classList.toggle('off', !tr.enabled); t.innerHTML = tr.enabled ? IC.cam : IC.camOff } }
    if (k === 'flip') flipCam()
    if (k === 'aonly') { const C2 = CALL; if (C2) { C2.aOnly = !C2.aOnly; applyAudioOnly(C2, true) } }
    if (k === 'spk') {
      if (C) {
        // v92: APK'da «Dinamik» = KARNAY↔QULOQCHI yo'nalishi (aniqlangan ishlaydi —
        // APK 2.6'da ham, ko'prik bo'lmaganida ham WebAudio karnayga chiqaradi).
        // Browserda = jim/ochiq (eski xulq).
        if (window.Android50) {
          C.spkOn = !C.spkOn
          t.classList.toggle('off', !C.spkOn)
          try { const A = window.Android50; if (typeof A.speaker === 'function') A.speaker(C.spkOn) } catch {}
          C.audioMode = routeFor(C)
          clog('dinamik', 'yo\'nalish → ' + C.audioMode + (C.spkOn ? ' (karnay)' : ' (quloqchi)'))
        } else {
          C.spkMuted = !C.spkMuted
          t.classList.toggle('off', C.spkMuted)
        }
        playRemote(C)
      }
    }
  }
}
// ───────── R3: OVOZ CHIQISH ZANJIRI — faqat BITTA yo'l ovoz chiqaradi ─────────
// 'ra' = .ra audio element (Jitsi-uslubi — ajratilgan ovoz elementi, asosiy yo'l)
// 'v'  = .remote video elementi (ba'zi qurilmalarda yagona ishlaydigan yo'l)
// 'wa' = WebAudio (AudioContext qo'ng'iroq boshida FOYDALANUVCHI BOSISHI ICHIDA
//        ochiladi — autoplay siyosatidan chetlab o'tadi, eng ishonchli zaxira)
const callEls = (C) => ({ v: qs('.remote', C.el), a: qs('.ra', C.el), pill: qs('.l-un', C.el) })
// v92: AudioContext GLOBAL — bir marta ochiladi (foydalanuvchi bosishida), HECH QACHON
// yopilmaydi. Har qo'ng'iroqda qayta ochilish noaniq natija berardi (ba'zan suspended
// qolardi — «bir qarasang ishlaydi» tasodifiyligi manbalaridan biri).
function unlockAudio(C) {
  try {
    if (!window.__50actx || window.__50actx.state === 'closed') {
      try { window.__50actx = new (window.AudioContext || window.webkitAudioContext)() } catch { window.__50actx = null }
    }
    const ctx = window.__50actx
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    if (C && ctx) C.ctx = ctx
    return ctx || null
  } catch { return null }
}
// v95: HAR QO'NG'IROQ — VIRGIN AUDIO-KAINOT. Eski global kontekst QO'NG'IROQLAR
// ORASIDA saqlanmasin: endCall uni yopadi, shu funksiya foydalanuvchi BOSISHI ichida
// 0 dan ochadi (gesture ichida yaratilgani uchun autoplay-qulfi yangi kontekstga ham
// taalluqli; «suspended tug'ilish» holatida 4-marta resume narvoni ishlaydi).
// v92 «hech qachon yopilmaydi» siyosati BEKOR QILINDI — aynan shu saqlanuvchi kontekst
// qo'ng'iroqlar orasida «running lekin ichi o'lik» holatga tushib, 2+ qo'ng'iroqni jim
// qilardi (foydalanuvchi dalili: 1-qo'ng'iroq zo'r, keyingilari jim).
function freshAudioUniverse(C) {
  try {
    const old = window.__50actx
    const ost = old ? old.state : 'yo‘q'
    if (old && old.state !== 'closed') { try { old.close() } catch {} }
    window.__50actx = null
    if (C) { C.ctx = null; C.waSrc = null; C.waGain = null; C.waAn = null; C.an_in = null; C.an_out = null }
    unlockAudio(C)
    const ctx = window.__50actx
    if (ctx && ctx.state !== 'running') {
      for (const d of [150, 400, 900]) {
        setTimeout(() => { try { if (window.__50actx === ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}) } catch {} }, d)
      }
    }
    clog('audio-kainot', 'kontekst 0 dan: eski=' + ost + ' yangi=' + (ctx ? ctx.state : 'YARATILMADI'))
    return ctx || null
  } catch (e) { try { clog('audio-kainot-xato', String((e && e.message) || e).slice(0, 80)) } catch {}; return null }
}
// v95: PROAKTIV NATIVE MARSHRUT — har qo'ng'iroq boshida (foydalanuvchi bosishi ichida,
// media ochilishidan OLDIN) OS ovoz-yo'li 0 dan o'rnatiladi: ovoz darajalari, NORMAL →
// COMMUNICATION, video bo'lsa karnay. Avvalgi qo'ng'iroq HALni ifloslatgan bo'lsa ham —
// bu kick uni YUVADI (audioKick avval faqat kech qutqaruv edi — endi BIRINCHI qadam).
function nativeRouteStart(video) {
  try {
    const A = window.Android50
    if (A && typeof A.audioKick === 'function') A.audioKick(video ? 1 : 0)
  } catch {}
}
function connectWA(C) {
  try {
    // v84 ILDIZ-TUZATISH: WebAudio tuguni FAQAT AUDIO-trekli oqim (remoteA) bilan
    // yaratiladi va audio trek bo'lmasa UMUMAN ulanmaydi. MediaStreamAudioSourceNode
    // yaratilish paytidagi trekka bog'lanadi — keyinchalik qo'shilgan trekkni KO'RMAYDI
    // (video trek birinchi kelib tugun audio-treksiz yaratilsa — abadiy jimlik;
    // jurnal isboti: call 1791365978038092, A tomon ovoz=wa k=0% ch=2%).
    const st = C.remoteA || C.remote
    if (!st || !st.getAudioTracks().length) return false
    const ctx = C.ctx || unlockAudio(C)
    if (!ctx) return false
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    if (!C.waSrc) {
      C.waSrc = ctx.createMediaStreamSource(st)
      C.waGain = ctx.createGain(); C.waGain.gain.value = 1
      C.waSrc.connect(C.waGain); C.waGain.connect(ctx.destination)
      // v92: IJRO METRIKASI — waGain'dan KEYINgi nuqtada o'lchov (oqim-tap EMAS):
      // «jim tugun» kasalligi aniqlanadi (oqim-tap yolg'on ijobiy berardi — v84 isboti)
      try { C.waAn = ctx.createAnalyser(); C.waAn.fftSize = 512; C.waGain.connect(C.waAn) } catch { C.waAn = null }
      clog('ovoz-wa', 'WebAudio zanjiri ulandi (audio-trek=' + st.getAudioTracks().length + ', turn=' + (C.relay === undefined ? '?' : C.relay) + ')')
    }
    return ctx.state === 'running' // v92: suspended = ISHLAMAYDI (pill chiqadi — aniqlangan)
  } catch (e) { clog('ovoz-wa-xato', String((e && e.message) || e).slice(0, 100)); return false }
}
// v94: YANGI OQIM-O'RAM BILAN manba tuguni — MediaStreamAudioSourceNode oqim-OBJEKTiga
// bog'lanadi. Ba'zi WebView'larda (Chrome/154 WebView dalillari: k=0% smp=+0 lekin
// baytlar keladi) eski oqim-obyektga bog'langan tugun TIRIK trekkadan ham jim oqadi.
// Davo: track atrofida BITTA YANGI MediaStream o'raymiz — tugun toza tug'iladi.
function freshWASource(C) {
  try {
    const tr = (C.remoteA || C.remote) && (C.remoteA || C.remote).getAudioTracks()[0]
    if (!tr) return false
    const ctx = C.ctx || unlockAudio(C)
    if (!ctx) return false
    try { if (C.waSrc) { C.waSrc.disconnect(); C.waSrc = null } } catch {}
    try { if (C.waAn) { C.waAn.disconnect(); C.waAn = null } } catch {}
    const fs = (typeof MediaStream === 'function') ? new MediaStream([tr]) : (C.remoteA || C.remote)
    C.waSrc = ctx.createMediaStreamSource(fs)
    C.waGain = ctx.createGain(); C.waGain.gain.value = 1
    C.waSrc.connect(C.waGain); C.waGain.connect(ctx.destination)
    try { C.waAn = ctx.createAnalyser(); C.waAn.fftSize = 512; C.waGain.connect(C.waAn) } catch { C.waAn = null }
    clog('ovoz-wa-yangi', 'manba YANGI o\u2018ramdan qurildi (trek=' + tr.readyState + ', ctx=' + ctx.state + ')')
    return true
  } catch (e) { clog('ovoz-wa-yangi-xato', String((e && e.message) || e).slice(0, 100)); return false }
}
// v94: AUDIOCONTEXT QAYTA TUG'ILISHI — kontekst "running" ko'rinsa-da ICHKI HOLATI
// o'lik bo'lishi mumkin (Chrome/154 WebView gumoni: masofa ovozi barcha o'lchovlarda
// nol, mikrofon o'lchovi ishlaydi). FAQAT CHIQAR YO'L: kontekstni yopib, 0 dan ochish.
function rebirthCtx(C) {
  try {
    const old = window.__50actx
    const st = old ? old.state : 'yo‘q'
    try { old && old.close && old.close() } catch {}
    window.__50actx = null; C.ctx = null
    C.waSrc = null; C.waGain = null; C.waAn = null; C.an_in = null; C.an_out = null
    unlockAudio(C)
    const now = window.__50actx
    clog('ovoz-qayta-tug', 'AudioContext 0 dan: eski=' + st + ' yangi=' + (now ? now.state : 'YARATILMADI'))
    return !!(now && now.state === 'running')
  } catch (e) { clog('ovoz-qayta-tug-xato', String((e && e.message) || e).slice(0, 100)); return false }
}
// v92: kaskad YO'Q — play() rad etilsa «Ovozni yoqish» tugmasi chiqadi (aniqlangan xulq);
// ijro dalili kelganda tugma o'zi yashirinadi.
function tryEl(el, mode) {
  let p; try { p = el.play() } catch { return false }
  if (p && p.then) p.then(() => {
    const C = CALL
    if (C && C.el && C.audioMode === mode) { C.audioBlocked = false; const pill = qs('.l-un', C.el); if (pill) pill.classList.add('hide') }
  }).catch((er) => {
    // v94: play() rad etilishi JURNALGA — ismi va sababi (avvalgida jim yutardi)
    const C = CALL
    if (C) C.playRejN = (C.playRejN || 0) + 1
    try { clog('ovoz-play-rad', mode + ' #' + ((C && C.playRejN) || 0) + ' ' + String((er && er.name) || '?') + ' ' + String((er && er.message) || '').slice(0, 60)) } catch {}
    if (C && C.el && C.audioMode === mode) { C.audioBlocked = true; const pill = qs('.l-un', C.el); if (pill) pill.classList.remove('hide') }
  })
  return true
}
// v92: playRemote — ANIQLANGAN (deterministic). Yo'nalish routeFor()'dan keladi
// (platforma + qo'ng'iroq turi + «Dinamik»); kaskad/qayta-urinishlar YO'Q — play()
// rad etilsa «Ovozni yoqish» tugmasi. Jimlik-qutqaruv faqat evalStats'da NUTQ DALILI bilan.
function playRemote(C) {
  if (!C?.el || CALL !== C || !C.remote) return
  const { v, a, pill } = callEls(C)
  if (!v || !a) return
  // R2: oqim DOIM xuddi shu obyekt — bir marta bog'lanadi, hech qachon almashtirilmaydi
  if (v.srcObject !== C.remote) v.srcObject = C.remote
  // v82.1: <audio> elementga FAQAT AUDIO-trekli oqim. Ba'zi Android WebView'larida
  // audio-element + VIDEO-trekli oqim = JIMLIK (jurnal isboti). Klassik xato sinfi.
  const aOnly = C.remoteA || C.remote
  if (a.srcObject !== aOnly) a.srcObject = aOnly
  if (!C.audioMode) C.audioMode = routeFor(C)
  const mode = C.audioMode
  // browserda «Dinamik» = jim/ochiq; APK'da yo'nalish «Dinamik» tugmasida o'zgaradi
  const mut = !!C.spkMuted && !window.Android50
  // WebAudio ovozi: faqat 'wa' yo'li va jimlanmagan bo'lsa
  try { if (C.waGain) C.waGain.gain.value = (mode === 'wa' && !mut) ? 1 : 0 } catch {}
  if (mode === 'wa') {
    v.muted = true; a.muted = true
    if (connectWA(C)) { C.audioBlocked = false; if (pill) pill.classList.add('hide') }
    else { C.audioBlocked = true; if (pill) pill.classList.remove('hide') }
  } else if (mode === 'v') {
    a.muted = true; v.muted = mut
    tryEl(v, 'v')
  } else {
    v.muted = true; a.muted = mut
    tryEl(a, 'ra')
  }
  if (C.audioPrev !== mode) { C.audioPrev = mode; clog('ovoz-yol', mode + ' (turn=' + (C.relay === undefined ? '?' : C.relay) + ')') }
}
// v92: YO'NALISH SIYOSATI — ANIQLANGAN (deterministic). Rejim FAQAT quyidagilarga
// bog'liq: platforma + qo'ng'iroq turi + foydalanuvchining «Dinamik» tanlovi.
// DALIL (Task 34, real jurnal): APK 2.6'da speaker ko'prigi yo'q — Chromium
// MODE_IN_COMMUNICATION ovozi QULOQCHIGA boradi; video'da telefon yuz oldida —
// eshitilmaydi (X: k=0% rb=1). WebAudio (AudioContext → STREAM_MUSIC) KARNAYGA
// chiqadi — quloqchi marshrutini chetlab o'tadi.
// APK: spkOn=true → 'wa' (karnay), false → 'ra' (quloqchi).
// Default: video → karnay, audio → quloqchi (oddiy telefon qo'ng'irog'i kabi).
// Browser: doim 'ra' (element — eng standart yo'l).
function routeFor(C) { return window.Android50 ? (C.spkOn ? 'wa' : 'ra') : 'ra' }
// v91: NATIVE OVOZ-KICK — jimlik aniqlanganda ovoz marshrutini OS darajasida urib ko'rish
// (APK 3.0: audioKick — rejim NORMAL↔COMMUNICATION + karnay + ovoz darajalari;
// eski APK'larda speaker-toggle zaxirasi; ko'prik umuman yo'q bo'lsa — jurnalga yozamiz)
function nativeKick(C) {
  try {
    const A = window.Android50
    if (!A) return 0
    C.kickN = (C.kickN || 0) + 1
    if (typeof A.audioKick === 'function') {
      try { A.audioKick(C.video ? 1 : 0) } catch {}
      let ri = ''
      try { if (typeof A.routeInfo === 'function') ri = String(A.routeInfo() || '') } catch {}
      clog('ovoz-kick', 'native audioKick #' + C.kickN + (ri ? ' | ' + ri : ''))
      return 1
    }
    if (typeof A.speaker === 'function') {
      try { A.speaker(false) } catch {}
      setTimeout(() => { try { const C2 = CALL; if (C2 === C) A.speaker(!C.spkMuted) } catch {} }, 350)
      clog('ovoz-kick', 'speaker-toggle #' + C.kickN)
      return 1
    }
    clog('ovoz-kick', 'ko\'prik yo\'q (APK 2.6) — faqat ilova ichki yo\'llar')
  } catch {}
  return 0
}
// v91: ELEMENTLARNI 0 DAN QURISH — ayrim WebView'da element NAMUNASI abadiy jim bo'lib
// qoladi (qayta bog'lash ham yordam bermaydi — X qurilma: rb=1, ovoz baribir yo'q).
// Yangi DOM tugunlari yangi ijrochilik bilan ochiladi — ko'p hollarda tiklaydi.
function rebuildCallElements(C) {
  try {
    if (!C?.el || CALL !== C) return
    C.fbN = (C.fbN || 0) + 1
    const ov = qs('.remote', C.el), oa = qs('.ra', C.el)
    if (!ov || !oa) return
    const nv = document.createElement('video')
    nv.className = 'remote'; nv.autoplay = true; nv.setAttribute('playsinline', ''); nv.muted = true
    const na = document.createElement('audio'); na.className = 'ra'; na.autoplay = true
    ov.replaceWith(nv); oa.replaceWith(na)
    try { nv.srcObject = C.remote } catch {}
    try { na.srcObject = C.remoteA || C.remote } catch {}
    try { if (C.waSrc) { C.waSrc.disconnect(); C.waSrc = null } } catch {}
    try { if (C.waAn) { C.waAn.disconnect(); C.waAn = null } } catch {}
    try { C.an_in = null } catch {}
    clog('ovoz-yangi-element', 'video+audio elementlar 0 dan qurildi #' + C.fbN + ' (turn=' + (C.relay === undefined ? '?' : C.relay) + ')')
    playRemote(C)
  } catch (e) { clog('ovoz-yangi-element-xato', String((e && e.message) || e).slice(0, 100)) }
}
// v85: AUDIO ELEMENTINI MAJBURIY QAYTA BOGLASH — jurnal-isbot (call 1791367548875607,
// A tomon): ovoz=ra + k=0% lekin inA=+14996 bayt oqyapti va rmut=yo'q. Ya'ni masofa
// ovozi BAYTLAR BILAN KELYAPTI, trek TIRIK — lekin element JIM ijro etmoqda. Ildiz:
// playRemote faqat srcObject OBYEKTI o'zgarganda qayta bog'laydi (a.srcObject !== aOnly) —
// remoteA ICHIGA keyin qo'silgan trek obyektni o'zgartirmaydi. Eski WebView'da bo'sh
// MediaStream'ga bog'langan element keyin qo'silgan audio-trekni ABADIY KO'RMAYDI.
// Davo: srcObject=null → qayta bog'lash → play() — element o'z ijrochisini yangilaydi.
function rebindRemoteAudio(C) {
  try {
    if (!C?.el || CALL !== C) return
    const a = qs('.ra', C.el)
    if (!a) return
    const st = C.remoteA || C.remote
    if (!st || !st.getAudioTracks().length) return // trek hali yo'q — ontrack yana chaqiradi
    a.srcObject = null
    a.srcObject = st
    if (!C.spkMuted) a.muted = false
    if (C.audioMode === 'ra') tryEl(a, 'ra')
    clog('ovoz-qayta-boglash', 'audio element yangidan bog‘landi (trek=' + st.getAudioTracks().length + ', turn=' + (C.relay === undefined ? '?' : C.relay) + ')')
  } catch (e) { clog('ovoz-qayta-boglash-xato', String((e && e.message) || e).slice(0, 100)) }
}
async function flipCam() {
  const C = CALL; if (!C?.local) return
  C.facing = C.facing === 'environment' ? 'user' : 'environment'
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: C.facing } })
    const nt = s.getVideoTracks()[0]
    const snd = C.pc?.getSenders().find((x) => x.track?.kind === 'video')
    if (snd) await snd.replaceTrack(nt) // RENEGOTIATION YO'Q — SDP o'zgarmaydi
    C.local.getVideoTracks().forEach((t) => { t.stop(); C.local.removeTrack(t) })
    C.local.addTrack(nt)
    qs('.local', C.el).srcObject = C.local
  } catch { toast('Kamera almashtirilmadi') }
}
// ═══ v82: AVTOMATIK SIFAT MOSLASHUVI + SIFAT KO'RSATKICHI + FAQAT-OVOZ REJIMI ═══
// Darajalar: L0 = to'liq sifat (1.2Mbps, HD), L1 = o'rta (600k, yarmi aniqlik),
// L2 = yengil (300k, chorak aniqlik, 20fps). Tarmoq sekinlashsa AVTOMATIK pasayadi
// (muzlagan o'rniga ravon past sifat), tiklanganda ko'tariladi. AUDIO HECH QACHON
// cheklanmaydi — eng yomon tarmoqda ham ovoz boradi.
const QA_LV = [
  { br: 1200000, sc: 1, fps: 30 },
  { br: 600000, sc: 2, fps: 30 },
  { br: 220000, sc: 4, fps: 15 }, // v87: L2 yengillashtirildi (300k/20fps → 220k/15fps)
  { br: 140000, sc: 6, fps: 10 }, // v87: YANGI L3 — juda zaif tarmoq: muzlash o'rniga ravon past-sifat
]
function applyVideoLevel(C) {
  try {
    const snd = C.sndV || (C.pc && C.pc.getSenders().find((x) => x.track?.kind === 'video'))
    if (!snd) return
    const lv = QA_LV[C.qaLvl || 0]
    const p = snd.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = lv.br
    try { p.encodings[0].scaleResolutionDownBy = lv.sc } catch {}
    try { p.encodings[0].maxFramerate = lv.fps } catch {}
    snd.setParameters(p).catch(() => {})
  } catch {}
}
// Sifat ko'rsatkichi — qo'ng'iroq oynasi yuqorisida 3 ustunli signal
function setQualityUI(C, lvl) {
  try {
    if (!C?.el) return
    const q = qs('.qi', C.el)
    if (q) { q.className = 'qi lv' + lvl; q.title = lvl === 0 ? 'Aloqa yaxshi' : lvl === 1 ? 'Aloqa o\u02bcrta' : 'Aloqa yomon' }
  } catch {}
}
// v82.1: oqim ovoz darajasi (RMS 0–100%). O'lchov shoxi CHIQISHGA ULANMAYDI —
// ovozga ta'sir qilmaydi. -1 = o'lcha olmadi (AudioContext yo'q/jim).
function rmsPct(C, stream, key) {
  try {
    if (!C.ctx || C.ctx.state !== 'running' || !stream) return -1
    if (!C['an_' + key]) {
      const src = C.ctx.createMediaStreamSource(stream)
      const an = C.ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an) // destination'ga ULANMAYDI — faqat o'lchov
      C['an_' + key] = an
    }
    const an = C['an_' + key]
    const buf = C['ab_' + key] || (C['ab_' + key] = new Float32Array(an.fftSize))
    an.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400))
  } catch { return -1 }
}
// v87: UZLUKSIZ RMS NAMUNAVCHI — avvalgi o'lchov BITTA 32ms snapshot edi: gap paytida
// olingan snapshot 0% qaytarardi → «k=0%» dalili NOTO'G'RI bo'lardi (shikoyat paytida
// k=0% ko'rilgan). Endi har 250ms o'lchaymiz va 5s oyna ICHIDA HECH BO'LMASA BIR marta
// eshitilgan MAKSIMUM darajani saqlaymiz — evalStats shu maksimumni o'qiydi: «bu oynada
// ovoz bo'lganmi?» degan ISHONCHLI javob (gaplar yolg'on nol bermaydi).
// v92: rejimga qarab MANBA tanlanadi — 'wa' rejimida IJRO ZANJIRI metrikasi (rmsWa —
// waGain'dan keyin), boshqa rejimlarda oqim-tap (rmsPct).
setInterval(() => {
  const C = CALL
  if (!C || !C.ctx || C.ctx.state !== 'running') return
  try {
    if (C.audioMode === 'wa' && C.waAn) { const v = rmsWa(C); if (v >= 0) C.inWin = Math.max(C.inWin || -1, v) }
    else if (C.remote || C.remoteA) { const v = rmsPct(C, C.remoteA || C.remote, 'in'); if (v >= 0) C.inWin = Math.max(C.inWin || -1, v) }
    if (C.local) { const v = rmsPct(C, C.local, 'out'); if (v >= 0) C.outWin = Math.max(C.outWin || -1, v) }
  } catch {}
}, 250)
// v92: WebAudio IJRO ZANJIRI metrikasi — waGain'DAN KEYINGI nuqtada o'lchaydi
// (oqim-tap EMAS!). wa tuguni «jim tugun» bo'lsa 0 qaytaradi — qutqaruv uni ko'radi
// (oqim-tap esa yolg'on ijobiy berardi va ishlayotgan yo'l buzilmagan bo'lardi).
function rmsWa(C) {
  try {
    const an = C.waAn
    if (!an || !C.ctx || C.ctx.state !== 'running') return -1
    const buf = C.ab_wa || (C.ab_wa = new Float32Array(an.fftSize))
    an.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400))
  } catch { return -1 }
}
// FAQAT-OVOZ rejimi: chiquvchi video TARMODA UMUMAN YURIMAYDI (replaceTrack(null) —
// renegotiation yo'q), masofa-video yashiriladi, ovoz davom etadi. Qarshi tomonda ham
// avtomatik yoqiladi (signal orqali) — ikkala tomonda trafik tejaladi.
function applyAudioOnly(C, send) {
  try {
    if (!C || !C.el) return
    const on = !!C.aOnly
    const vt = C.local && C.local.getVideoTracks()[0]
    const snd = C.sndV || (C.pc && C.pc.getSenders().find((x) => x.track?.kind === 'video'))
    if (on) {
      if (vt && snd) snd.replaceTrack(null).catch(() => { try { vt.enabled = false } catch {} })
      else if (vt) { try { vt.enabled = false } catch {} }
    } else {
      if (vt && snd) snd.replaceTrack(vt).catch(() => {})
      else if (vt) { try { vt.enabled = true } catch {} }
      C.vDead = 0; C.ovDead = 0; C.outDead = 0
      if (C.video && C.started) applyVideoLevel(C)
    }
    C.el.classList.toggle('aud-only', on)
    const b = qs('.cb[data-c="aonly"]', C.el)
    if (b) b.classList.toggle('off', on)
    clog('faqat-ovoz', (send ? 'men yoqdim' : 'qarshi tomon') + ' → ' + (on ? 'YOQILDI' : 'OCHILDI') + ' (turn=' + (C.relay === undefined ? '?' : C.relay) + ')')
    if (send) sig(C.peer.id, { k: 'aonly', call_id: C.id, on: on ? 1 : 0 })
  } catch (e) { clog('faqat-ovoz-xato', String((e && e.message) || e).slice(0, 100)) }
}
function limitBitrate(pc, max) {
  const s = pc.getSenders().find((x) => x.track?.kind === 'video'); if (!s) return
  try {
    const p = s.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = max || 900000
    s.setParameters(p).catch(() => {})
  } catch {}
}
// CHIQUVCHI MEDIA TIKLASH — OS kamerani/mikrofonni musodara qilib qo'ysa (fon rejimi,
// boshqa ilova), yangi getUserMedia + sender.replaceTrack — RENEGOTIATION'SIZ (R1 buzilmaydi)
async function healOutgoing(C, kind) {
  if (!C?.local) return
  C.healing = C.healing || {}
  if (C.healing[kind]) return
  C.healing[kind] = true
  const isV = kind === 'video'
  const getT = (s) => isV ? s.getVideoTracks() : s.getAudioTracks()
  try {
    const old = getT(C.local)[0]
    if (!old || old.readyState !== 'live' || !old.enabled) return
    const snd = C.pc?.getSenders().find((x) => x.track && x.track.kind === kind)
    if (!snd) return
    old.stop()
    try { C.local.removeTrack(old) } catch {}
    const con = isV
      ? { video: { facingMode: C.facing || 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
      : { audio: { echoCancellation: true, noiseSuppression: true } }
    const s = await navigator.mediaDevices.getUserMedia(con)
    const nt = getT(s)[0]
    if (!nt) throw new Error('yangi trek bo\'sh')
    await snd.replaceTrack(nt)
    try { C.local.addTrack(nt); qs('.local', C.el).srcObject = C.local } catch {}
    if (kind === 'audio') { try { C.an_out = null } catch {} } // v84: o'lchov tuguni yangi trekga qayta yaratiladi
    C['h_' + kind] = (C['h_' + kind] || 0) + 1
    clog('chiqish-tiklandi', kind + ' yangi trek #' + C['h_' + kind] + ' (turn=' + (C.relay === undefined ? '?' : C.relay) + ')')
  } catch (e) {
    clog('chiqish-tiklash-xato', kind + ' | ' + String((e && e.message) || e).slice(0, 120))
  } finally { C.healing[kind] = false }
}
// v74: qo'ng'iroqda ekran uxlamasin (OS kamera/mikrofonni to'xtatmasligi uchun)
async function holdWake(on) {
  try {
    if (on) { if (CALL && !CALL.wake && navigator.wakeLock?.request) CALL.wake = await navigator.wakeLock.request('screen').catch(() => null) }
    else { try { CALL?.wake?.release?.() } catch {}; if (CALL) CALL.wake = null }
  } catch {}
}
async function setupPC(C) {
  // POYG'A GUARDI: setupPC bir CALL uchun faqat BIR MARTA ishlaydi
  if (C.pc || C.pcStarting) return
  C.pcStarting = true
  try {
    C.pc = await newPC((c) => sig(C.peer.id, { k: 'ice', call_id: C.id, c }))
    for (const t of C.local.getTracks()) C.pc.addTrack(t, C.local)
    C.sndV = C.pc.getSenders().find((x) => x.track?.kind === 'video') || null
    C.qaLvl = 0
    applyVideoLevel(C)
    if (C.aOnly) applyAudioOnly(C, false) // «Faqat ovoz» oldin yoqilgan bo'lsa — yangi sender'ga darhol qo'llanadi
    // R2 — HAL QILUVCHI TUZATISH: BITTA doimiy masofa-oqim. ontrack faqat treklar
    // QO'SHADI; .remote/.ra elementlari srcObject bilan BIR MARTA bog'lanadi va
    // hech qachon almashtirilmaydi — «oxirgi trek hodisasi boshqa turdagi ovozi
    // o'chirib qo'yardi» ildizi KONSTRUKTIV MUMKIN EMAS.
    C.remote = new MediaStream()
    C.pc.ontrack = (e) => {
      try {
        const t = e.track
        for (const o of C.remote.getTracks()) if (o.kind === t.kind && o !== t) { try { C.remote.removeTrack(o) } catch {} }
        if (!C.remote.getTracks().includes(t)) C.remote.addTrack(t)
        // v82.1: audio uchun ALOHIDA audio-trekli oqim — <audio> element shuni eshitadi
        if (t.kind === 'audio') {
          if (!C.remoteA) C.remoteA = new MediaStream()
          for (const o of C.remoteA.getTracks()) if (o !== t) { try { C.remoteA.removeTrack(o) } catch {} }
          if (!C.remoteA.getTracks().includes(t)) C.remoteA.addTrack(t)
          // v84 ILDIZ-TUZATISH: WebAudio tugunlari yaratilish paytidagi trekka bog'lanadi.
          // Yangi audio trek keldi — eski tugun eski/bo'sh trekga bog'langan bo'lishi mumkin
          // (k=0 jimlik ildizi) — tugunlarni tozalaymiz, playRemote darhol qayta yaratadi.
          try { if (C.waSrc) { C.waSrc.disconnect(); C.waSrc = null } } catch {}
          try { C.an_in = null } catch {}
          // v85: audio trek keldi — element BO'SH oqimga erta bog'langan bo'lishi mumkin
          // (eski WebView: bo'sh MediaStream bilan bog'langan <audio> keyin qo'silgan
          // trekni ko'rmaydi — abadiy jimlik). 400ms debounce bilan majburiy qayta
          // bog'laymiz — trek allaqachon remoteA ichida, element endi uni ko'radi.
          clearTimeout(C.aRebindT)
          C.aRebindT = setTimeout(() => { if (CALL === C) rebindRemoteAudio(C) }, 400)
        }
      } catch {}
      clog('masofa-trek', e.track.kind + ' ready=' + e.track.readyState)
      e.track.onunmute = () => { const C2 = CALL; if (C2 === C) { clog('trek-tirik', e.track.kind); playRemote(C2) } }
      const C2 = CALL
      if (C2 === C) playRemote(C2)
    }
    C.pc.onconnectionstatechange = () => {
      if (CALL !== C || !C.pc) return
      const s = C.pc.connectionState
      if (s === 'connected') {
        clog('ulanildi', 'turn=' + (C.relay === undefined ? '?' : C.relay) + ' | audio=' + (C.audioMode || '?') + (C.audioBlocked ? '(blok)' : ''))
        C.recTries = 0; C.recAt = 0
        playRemote(C)
        try { const qi = qs('.qi', C.el); if (qi) qi.classList.remove('hide') } catch {}
        try { holdWake(true) } catch {}
        // APK: video qo'ng'iroqda ovoz KARNAYGA chiqsin
        try { if (C.video && window.Android50) { window.Android50.keepScreen && window.Android50.keepScreen(true); if (C.spkOn && window.Android50.speaker) window.Android50.speaker(true) } } catch {}
        // v91: marshrutni QAYTA TASDIQLASH — Chromium masofa-oqim ijrosi boshlanganda
        // o'zi qayta yo'naltirishi mumkin (2.5s va 7s'da yana bir marta karnayga qo'yamiz)
        try {
          if (C.video && window.Android50 && typeof window.Android50.speaker === 'function') {
            const reSpk = () => { try { const C2 = CALL; if (C2 === C && C2.spkOn && typeof window.Android50.speaker === 'function') window.Android50.speaker(true) } catch {} }
            setTimeout(reSpk, 2500); setTimeout(reSpk, 7000)
          }
        } catch {}
        // v91: native marshrut dalili jurnalga (APK 3.0+)
        try { if (window.Android50 && typeof window.Android50.routeInfo === 'function') clog('marshrut', window.Android50.routeInfo()) } catch {}
        if (!C.started) {
          C.started = Date.now()
          clearTimeout(C.timeout)
          setCallState(fmtDur(0))
          C.tick = setInterval(() => setCallState(fmtDur((Date.now() - C.started) / 1000)), 1000)
          if (C.video) qs('.cinfo', C.el).classList.add('mini')
        }
      }
      if (s === 'disconnected' && C.started) {
        clog('uzildi', 'disconnected — sog\'liq-halqasi qayta ulaydi')
        setCallState('Aloqa uzildi, qayta ulanmoqda…')
      }
      if (s === 'failed') {
        clog('ulanmadi', 'failed')
        if (C.started) recover(C, 'pc-failed')
        else endCall('missed', true, 'Aloqa yo‘q — internetni tekshirib, qayta urinib ko‘ring')
      }
    }
  } finally { C.pcStarting = false }
}
// R1: offer FAQAT chaqiruvchida. restartIce ham faqat chaqiruvchida —
// qabul qiluvchi hech qachon offer yaratmasligi uchun GLARE KONSTRUKTIV MUMKIN EMAS
async function restartIce(C) {
  if (!C.pc || C.role !== 'offerer' || C.restaring) return
  C.restaring = true
  try {
    try { const srv = await iceServers(true); C.pc.setConfiguration?.({ iceServers: srv }) } catch {}
    C.oseq = (C.oseq || 0) + 1
    const o = await C.pc.createOffer({ iceRestart: true })
    await C.pc.setLocalDescription(o)
    C.offerAt = Date.now()
    sigTo(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq: C.oseq }, 3, 900)
    clog('ice-restart', 'offer #' + C.oseq)
  } catch (e) { clog('ice-restart-xato', String((e && e.message) || e).slice(0, 120)) }
  finally { C.restaring = false }
}
// v94: AUDIO TRANSCEIVER 0 DAN — qarshi tomonning dekoderi o'lganda (a-reset so'rovi)
// bizning audio m-line'ni TO'XTATIB yangisini qo'shamiz → qarshi tomonda YANGI
// receiver/dekoder tug'iladi (renegotiation offer mavjud offer/answer yo'lidan yuradi).
// areset=1: qarshi tomonning «eski offer» qorovulidan O'TISH uchun (ataylab yangi).
async function audioTransceiverReset(C) {
  if (!C.pc || C.aRstBusy) return
  C.aRstBusy = true
  try {
    const tr = C.pc.getTransceivers().find((t) => (t.sender && t.sender.track && t.sender.track.kind === 'audio') || (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio'))
    const at = C.local && C.local.getAudioTracks()[0]
    if (tr && typeof tr.stop === 'function') { try { tr.stop() } catch {} }
    if (at && C.pc.signalingState === 'stable') {
      C.pc.addTransceiver(at, { direction: 'sendrecv' })
    } else {
      clog('a-reset-xato', 'transceiver qayta qo‘shilmadi (tr=' + !!tr + ' track=' + !!at + ' sig=' + C.pc.signalingState + ')')
      return
    }
    C.oseq = (C.oseq || 0) + 1
    const o = await C.pc.createOffer()
    await C.pc.setLocalDescription(o)
    C.offerAt = Date.now()
    sigTo(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq: C.oseq, areset: 1 }, 3, 900)
    clog('a-reset', 'YANGI m-line offer yuborildi (oseq=' + C.oseq + ')')
  } catch (e) { clog('a-reset-xato', String((e && e.message) || e).slice(0, 120)) }
  finally { C.aRstBusy = false }
}
// TIKLASH NARVONI (rollarga bo'lingan): offerer o'zi ICE restart qiladi,
// answerer esa offererdan SO'RAYDI ('needice') — ikki tomonlama offer YO'Q
function recover(C, why) {
  const t = Date.now()
  if (C.recAt && t - C.recAt < 12000) return // bir tiklash har 12s dan tez emas
  C.recAt = t
  C.recTries = (C.recTries || 0) + 1
  if (C.recTries > 3) { endCall('missed', true, 'Aloqa yo‘q — internetni tekshirib, qayta urinib ko‘ring'); return }
  setCallState('Qayta ulanmoqda…')
  C.silN = 0 // v92: yangi PC — jimlik-qutqaruv bosqichi 0 dan
  clog('tiklash', why + ' #' + C.recTries + ' (' + (C.role === 'offerer' ? 'o\'zim restart' : 'needice so\'rov') + ')')
  if (C.role === 'offerer') restartIce(C)
  else sigTo(C.peer.id, { k: 'needice', call_id: C.id }, 3, 900)
}
async function flushIce(C) { for (const c of C.ice.splice(0)) try { await C.pc.addIceCandidate(c) } catch {} }
function endCall(status = 'ended', report = true, msg) {
  const C = CALL; if (!C) return
  try { console.info('[call] endCall', status, '|', msg || '') } catch {}
  CALL = null
  C.ringMode = ''
  clearInterval(C.nbT)
  stopSigPoll()
  ringTone(false)
  nativeCallCancel()
  try { holdWake(false) } catch {}
  try { if (C.video && window.Android50) { window.Android50.keepScreen && window.Android50.keepScreen(false) } } catch {}
  clearTimeout(C.timeout); clearInterval(C.tick); clearTimeout(C.camT)
  const dur = C.started ? Math.round((Date.now() - C.started) / 1000) : 0
  clog('endCall', 'status=' + status + ' | ' + (msg || '') + ' | davomiylik=' + dur + 's | pc=' + (C.pc ? C.pc.connectionState : 'yo\'q') + ' | turn=' + (C.relay === undefined ? '?' : C.relay) + ' | ovoz=' + (C.audioMode || '?'))
  clogLastId = C.id || clogLastId
  if (report && C.id) {
    sig(C.peer.id, { k: 'hangup', call_id: C.id })
    post(`/calls/${C.id}/status`, { status: C.started ? 'ended' : status, duration: dur }).catch(() => {})
  }
  // ── v95: TOZA YIQILISH TARTIBI — avval MEDIA to'liq o'ladi, KEYIN OS-marshrut reset ──
  // (1) elementlar ovoz-sinkni DARHOL qo'yib yuboradi
  try { const ce = callEls(C); if (ce.v) ce.v.srcObject = null; if (ce.a) ce.a.srcObject = null } catch {}
  try { // (2) masofa treklari ANIQ to'xtatiladi — receiver pleyout-resurslari ozod bo'ladi
    if (C.remote) C.remote.getTracks().forEach((t) => { try { t.stop() } catch {} })
    if (C.remoteA) C.remoteA.getTracks().forEach((t) => { try { t.stop() } catch {} })
  } catch {}
  try { C.pc?.close() } catch {} // (3) PC yopiladi
  C.local?.getTracks().forEach((t) => t.stop()) // (4) mikrofon/kamera ozod
  try { C.waSrc?.disconnect?.(); C.waGain?.disconnect?.(); C.waAn?.disconnect?.() } catch {}
  try { // (5) GLOBAL AudioContext YOPILADI — har keyingi qo'ng'iroq VIRGIN kontekst bilan
        // tug'iladi (eski siyosat uni saqlardi — «running lekin ichi o'lik» merosi 2+
        // qo'ng'iroqni jim qilardi; v95: endCall yopadi, boshida freshAudioUniverse ochadi)
    if (window.__50actx && window.__50actx.state !== 'closed') { try { window.__50actx.close() } catch {} }
    window.__50actx = null
  } catch {}
  C.ctx = null
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'callend', tag: 'g50call' + C.id }) } catch {}
  qs('.cst', C.el).textContent = msg || (C.started ? 'Tugadi · ' + fmtDur(dur) : 'Tugadi')
  qs('.cbar', C.el).innerHTML = ''
  setTimeout(() => C.el.remove(), msg ? 3200 : 1200)
  try { // (6) OS-marshrut reset — media to'liq o'lgandan 700ms KEYIN va faqat yangi
        // qo'ng'iroq boshlanmagan bo'lsa (guard). AUDIO qo'ng'iroqlar uchun ham: NORMAL
        // rejimga qaytish keyingi jiringlash/ovozi ham to'g'ri yo'nalgan bo'ladi.
    if (window.Android50 && typeof window.Android50.speaker === 'function') {
      setTimeout(() => { try { if (!CALL) window.Android50.speaker(false) } catch {} }, 700)
    }
  } catch {}
  try { window.__50buildCheck && window.__50buildCheck() } catch {}
  for (let i = 0; i < 12 && clogBuf.length; i++) shipClog()
}
// ───────────────────────────── QO'NG'IROQ OQIMLARI ─────────────────────────────
// CHAQIRUVCHI (offerer): qo'ng'iroq AVVAL yuboriladi — qarshi tomon DARHOL jiringlaydi,
// kamera parallel ochiladi (kamera osilsa ham chaqiruv YO'QOLMAYDI — v76 isbotlangan tartib)
async function callUser(uid, video) {
  if (CALL) return toast('Siz allaqachon qo‘ng‘iroqdasiz')
  if (uid === S.me.id) return
  let peer = S.users.get(uid)
  if (!peer) try { peer = await api('/users/' + uid); S.users.set(uid, peer) } catch (e) { return toast('⚠️ ' + e.message) }
  // v92: yo'nalish routeFor()da hal qilinadi — APK: video→karnay (spkOn=true),
  // audio→quloqchi; browser: element. AudioContext GLOBAL (unlockAudio ichida).
  CALL = { id: 0, peer, video: !!video, outgoing: true, role: 'offerer', spkOn: !!video, ice: [], el: callUI(peer, video, 'Chaqirilmoqda…'), t0: Date.now(), ringMode: 'out' }
  // v95: FOYDALANUVCHI BOSISHI ICHIDA — proaktiv native marshrut + virgin AudioContext
  nativeRouteStart(!!video)
  freshAudioUniverse(CALL)
  clog('chaqirildi', 'to=' + uid + ' video=' + !!video)
  startSigPoll()
  purgeStaleSignals()
  callButtons('active')
  ringTone(true)
  try {
    const r = await post('/calls', { to: uid, video: !!video })
    if (!CALL) return
    CALL.id = r.call_id
    setCallState('Chaqirilmoqda…')
    CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', true, 'Javob berilmadi'), 60000)
    // Halol UI: kamera 2.5s+ kutsa — foydalanuvchi NIMA kutayotganini ko'rsin
    const C1 = CALL
    CALL.camT = setTimeout(() => { if (CALL === C1 && !C1.local && !C1.started) setCallState('Kamera ochilmoqda…') }, 2500)
    const local = await getMedia(video)
    // OQIM-OQISH HIMOYASI: getMedia davomida qo'ng'iroq yopilsa — ghost oqim kamerani band qolmasin
    if (!CALL) { try { local.getTracks().forEach((t) => t.stop()) } catch {}; return }
    CALL.local = validateMedia(local, video)
    qs('.local', CALL.el).srcObject = CALL.local
    camOk()
    clearTimeout(CALL.camT)
    clog('media tayyor', 'audio=' + CALL.local.getAudioTracks().length + ' video=' + CALL.local.getVideoTracks().length)
    if (CALL.pendingAccept) processAccept(CALL) // kamera ochilyotganda accept kelgan bo'lsa
  } catch (e) {
    try { if (CALL) setCallState('⚠️ ' + e.message) } catch {}
    toast('⚠️ ' + e.message)
    camFail(CALL, e)
    endCall('ended', !!CALL?.id, '⚠️ ' + e.message)
  }
}
// QABUL QILUVCHI (answerer): hech qachon offer yaratmaydi — faqat javob beradi (R1)
async function acceptCall() {
  const C = CALL
  if (!C || C.accepting) return // «Javob berish» UI + native bir vaqtda bosilsa — bir marta
  C.accepting = true
  C.ringMode = ''
  clearInterval(C.nbT)
  nativeCallCancel()
  C.acceptAt = Date.now()
  ringTone(false); clearTimeout(C.timeout)
  setCallState('Kamera ochilmoqda…')
  callButtons('active')
  // v95: FOYDALANUVCHI «Javob berish» BOSISHI ICHIDA — proaktiv native marshrut +
  // virgin AudioContext (qabul qiluvchi tomonda ham xuddi shu toza-kainot kafolati)
  nativeRouteStart(!!C.video)
  freshAudioUniverse(C)
  try {
    const local = await getMedia(C.video)
    if (CALL !== C) { try { local.getTracks().forEach((t) => t.stop()) } catch {}; return }
    C.local = validateMedia(local, C.video)
    qs('.local', C.el).srcObject = C.local
    camOk()
    clog('media tayyor', 'audio=' + C.local.getAudioTracks().length + ' video=' + C.local.getVideoTracks().length)
    setCallState('Ulanmoqda…')
    await setupPC(C)
    // 'accept' yo'qolsa chaqiruvchi hech qachon offer yaratmaydi — 5 marta/1.2s
    const ok = await sigTo(C.peer.id, { k: 'accept', call_id: C.id }, 5, 1200)
    if (!ok) return endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
    post(`/calls/${C.id}/status`, { status: 'active' }).catch(() => {})
    // EARLY-OFFER PARKING: accept yuborilishidan OLDIN kelgan offer bo'lsa — hoziroq javob
    if (C.pendingOffer && CALL === C && C.pc) {
      const po = C.pendingOffer
      C.pendingOffer = null
      logSig('parklangan offer', "accept'dan keyin ishlanmoqda")
      try { await handleSignalEv({ sid: 0, from: C.peer.id, data: po }) } catch (e) { logSig('parklangan offer xato', String((e && e.message) || e)) }
    }
  } catch (e) {
    try { if (CALL) setCallState('⚠️ ' + e.message) } catch {}
    toast('⚠️ ' + e.message)
    camFail(C, e)
    endCall('declined', true, '⚠️ ' + e.message)
  }
}
// CHAQIRUVCHI: accept keldi — media tayyor bo'lsa offer yaratamiz (yagona offer manbai)
async function processAccept(C) {
  if (!C || C.role !== 'offerer' || C.pc || C.processing) return
  C.processing = true
  try {
    C.pendingAccept = false
    if (!C.local) return // kamera hali ochilmoqda — callUser oxiri yuboradi
    setCallState('Ulanmoqda…')
    await setupPC(C)
    C.oseq = 1
    const o = await C.pc.createOffer()
    await C.pc.setLocalDescription(o)
    C.offerAt = Date.now()
    const ok = await sigTo(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq: C.oseq })
    if (!ok && !C.started) return endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
  } catch (e) {
    try { if (CALL) setCallState('⚠️ ' + ((e && e.message) || 'Ulanmadi')) } catch {}
    clog('offer-xato', String((e && e.message) || e).slice(0, 120))
  } finally { C.processing = false }
}
// ---------------- FON REJIMIDA QO'NG'IROQ (APK/PWA zaxira yo'llari) ----------------
const nativeCall = () => (window.Android50 && typeof window.Android50.callIncoming === 'function') ? window.Android50 : null
const nativeCallCancel = () => { try { window.Android50 && window.Android50.callStarted && window.Android50.callStarted() } catch {} }
let pendingNativeCall = null
window.__50call = (act, id) => {
  if (act === 'answer') {
    pendingNativeCall = null
    nativeCallCancel()
    if (CALL) {
      if (String(CALL.id) === String(id)) acceptCall()
      else post(`/calls/${id}/status`, { status: 'declined' }).catch(() => {})
      return
    }
    // SERVER-HAQIQAT BILAN JAVOB: bildirishnoma eski bo'lishi mumkin — /calls/pending
    // serverda HOZIR ham jiringlayotgan qo'ng'iroqni qaytaradi
    api('/calls/pending').then((r) => {
      if (CALL) return
      const c = r && r.call
      if (c) { incomingCall({ call_id: c.call_id, video: c.video, started_at: c.started_at, from: c.from }, true); acceptCall() }
      else { toast('Qo‘ng‘iroq vaqti o‘tgan'); post(`/calls/${id}/status`, { status: 'declined' }).catch(() => {}) }
    }).catch(() => { toast('Qo‘ng‘iroqqa ulanolmadik — internetni tekshiring') })
  } else if (act === 'decline') {
    pendingNativeCall = null
    nativeCallCancel()
    if (CALL && String(CALL.id) === String(id)) endCall('declined', true)
    else post(`/calls/${id}/status`, { status: 'declined' }).catch(() => {})
  }
}
try {
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data || {}
    if (d.type === 'callanswer' && d.call_id) window.__50call('answer', d.call_id)
    if (d.type === 'calldecline' && d.call_id) window.__50call('decline', d.call_id)
    // v78: SW'dan «QO'NG'IROQ KELDI» impulsi (push sahifa EKRANDA kelganda) — WS kechiksa
    // ham /calls/pending zudlik bilan tekshiriladi va qo'ng'iroq oynasi chiqadi
    if (d.type === 'pushcall' && !CALL) {
      api('/calls/pending').then((r) => {
        if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, started_at: r.call.started_at, from: r.call.from }, true)
      }).catch(() => {})
    }
  })
} catch {}
function incomingCall(ev, force) {
  // DEDUP: shu qo'ng'iroq uchun UI ochiq — jim o'tkazamiz (boshqaga 'busy' YO'Q:
  // WS hodisa ikki marta yetkazilsa chaqiruvchi yolg'on «Band» olmasdi)
  if (CALL) { if (String(CALL.id) === String(ev.call_id)) return; sig(ev.from.id, { k: 'busy', call_id: ev.call_id }); return }
  const age = ev.started_at ? (Date.now() - (S.tSkew || 0)) - +ev.started_at : 0
  if (!force && age > 45000) {
    // GHOST HIMOYASI: klient soati noto'g'ri bo'lishi mumkin — SERVERDAN tasdiqlaymiz
    api('/calls/pending').then((r) => {
      const c = r && r.call
      if (c && String(c.call_id) === String(ev.call_id) && !CALL) incomingCall({ call_id: c.call_id, video: c.video, started_at: c.started_at, from: c.from }, true)
      else if (!CALL) post(`/calls/${ev.call_id}/status`, { status: 'declined' }).catch(() => {})
    }).catch(() => {})
    return
  }
  if (force && age > 78000) { post(`/calls/${ev.call_id}/status`, { status: 'declined' }).catch(() => {}); return }
  const nb = nativeCall()
  // APK FON REJIMI: sahifa yashirin bo'lsa native to'liq ekran oyna (⚠️ force — in-app UI)
  if (nb && document.hidden && !force) {
    pendingNativeCall = ev
    try { nb.callIncoming(JSON.stringify({ id: ev.call_id, name: uname(ev.from), video: !!ev.video })) } catch {}
    return
  }
  S.users.set(ev.from.id, { ...(S.users.get(ev.from.id) || {}), ...ev.from })
  const peer = S.users.get(ev.from.id)
  // v92: kiruvchi ham xuddi shu siyosat: video→karnay (spkOn=true), audio→quloqchi
  CALL = { id: ev.call_id, peer, video: !!ev.video, outgoing: false, role: 'answerer', spkOn: !!ev.video, ice: [], el: callUI(peer, ev.video, ev.video ? 'Video qo‘ng‘iroq…' : 'Qo‘ng‘iroq…'), t0: Date.now(), ringMode: 'in' }
  clog('kirish-qo\'ng\'iroq', 'call=' + ev.call_id + ' from=' + ev.from.id + ' video=' + !!ev.video)
  startSigPoll()
  CALL.el.classList.add('incoming')
  callButtons('incoming')
  ringTone(true, 'in')
  vibrate([400, 200, 400, 200, 400])
  notifyLocal('📞 ' + uname(peer), ev.video ? 'Video qo‘ng‘iroq' : 'Ovozli qo‘ng‘iroq')
  if (nb) { // APK: native oyna ZAXIRA sifatida ham, har 6s jonlanadi (fon rejimida jiringlash davom etsin)
    const nbShow = () => { try { nb.callIncoming(JSON.stringify({ id: ev.call_id, name: uname(peer), video: !!ev.video })) } catch {} }
    nbShow()
    CALL.nbT = setInterval(nbShow, 6000)
  }
  CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', true), 65000)
}
on('call', incomingCall)
// ZAXIRA YO'L: WS zombi bo'lsa ham 6s ichida qo'ng'iroq ko'rinadi (/calls/pending)
setInterval(() => {
  if (!S.token || CALL) return
  api('/calls/pending').then((r) => {
    if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, started_at: r.call.started_at, from: r.call.from })
  }).catch(() => {})
}, 6000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pendingNativeCall && !CALL) {
    const ev = pendingNativeCall
    pendingNativeCall = null
    incomingCall(ev)
  }
  // Fon'dan qaytganda: AudioContext + elementlarni jonlantirish (WebView mediani to'xtatishi mumkin)
  if (!document.hidden && CALL) {
    const C = CALL
    try { if (C.ctx && C.ctx.state === 'suspended') C.ctx.resume().catch(() => {}) } catch {}
    try { playRemote(C) } catch {}
  }
  if (!document.hidden && S.token) {
    if (CALL) {
      if (!CALL.started && CALL.ringMode && !ringTimer) ringTone(true, CALL.ringMode || undefined)
      try { if (ringCtx && ringCtx.state === 'suspended') ringCtx.resume().catch(() => {}) } catch {}
    } else {
      api('/calls/pending').then((r) => {
        if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, started_at: r.call.started_at, from: r.call.from })
      }).catch(() => {})
    }
  }
})
window.__50wsOpen = async () => {
  if (!CALL && !pendingNativeCall) {
    try {
      const r = await api('/calls/pending')
      if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, started_at: r.call.started_at, from: r.call.from })
    } catch {}
  }
  // QO'NG'IROQ davomida WS qayta ulandi va JAVOB hali kelmagan bo'lsa — XUDDI SHU offerni
  // qayta yuboramiz (IDEMPOTENT — qabul qiluvchi xuddi shu SDP uchun javobni qaytaradi).
  // ⚠️ Yangi offer YARATILMAYDI (faqat offerer yaratadi — glare yo'q).
  try {
    const C = CALL
    if (C && C.role === 'offerer' && C.pc && C.pc.localDescription && !C.pc.remoteDescription && C.offerAt && Date.now() - C.offerAt > 5000) {
      sig(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq: C.oseq })
    }
  } catch {}
  try { drainSigQueue() } catch {}
  const L = LIVE
  if (L && !L.host && !L.rejoining && (!L.pc || L.pc.connectionState !== 'connected')) liveRejoin()
}
// ─────────────────────── SIGNAL ISHLOVCHISI (yagona nuqta) ───────────────────────
async function handleSignalEv(ev) {
  const d = ev.data || {}, from = ev.from
  if (sigDedup(ev.sid)) return
  if (d.k && d.k[0] === 'l') return liveSignal(from, d)
  const C = CALL
  if (d.k !== 'ice') logSig('k=' + d.k, 'from=' + from + ' call_id=' + d.call_id + ' | C=' + (C ? (C.outgoing ? 'out' : 'in') + ' id=' + C.id + ' pc=' + !!C.pc + ' started=' + !!C.started : 'YO‘Q'))
  if (!C || String(C.peer.id) !== String(from)) {
    if (['ice', 'accept', 'offer', 'answer', 'needice'].includes(d.k)) logSig('DROP peer', 'k=' + d.k + ' from=' + from)
    return
  }
  if (d.call_id && C.id && String(C.id) !== String(d.call_id)) { logSig('DROP call_id', 'k=' + d.k + ' kelgan=' + d.call_id + ' bizniki=' + C.id); return }
  if (d.call_id && !C.id) {
    // v89 HAL QILUVCHI TUZATISH: yakunlovchi signallar (hangup/busy/call_closed) yangi
    // qo'ng'iroqning id'sini O'ZLASHTIRMAYDI. AVVALGI XATO: yangi chaqiruv C.id=0 holatda
    // navbatdagi ESKI hangup'ning call_id'ini o'zlashtirib olardi (C.id = eski call) va
    // shu zaharli signal o'zini-o'zi 'sameCall' bilan O'LDIRARDI. Isbot: E2E 16:38/16:48 —
    // yangi chaqiruv 0.8s'da 9 daqiqalik eski hangup'dan o'ldi; foydalanuvchining
    // 16:02–16:03 'pc=new' o'limlari — xuddi shu ildiz (tez qayta urinishlar zahari).
    if (d.k === 'hangup' || d.k === 'busy' || d.k === 'call_closed') { logSig('eski-juvon tashlandi', 'k=' + d.k + ' (yangi chaqiruv, id hali yo\u2018q — navbat zahari)'); return }
    C.id = d.call_id
  }
  try {
    // ── YAKUNLOVCHI SIGNALLAR — eski-juvon himoyasi (jurnal-isbot 09:56:42) ──
    const sameCall = !d.call_id || !C.id || String(C.id) === String(d.call_id)
    if ((d.k === 'hangup' || d.k === 'busy') && C.outgoing && !C.id && Date.now() - (C.t0 || 0) < 6000) {
      logSig('eski-juvon tashlandi', 'k=' + d.k + ' (yangi chaqiruv, call_id hali yo\'q)')
      return
    }
    if (d.k === 'hangup' && sameCall) return endCall('ended', false)
    if (d.k === 'busy' && sameCall) return endCall('missed', true, 'Band')
    if (d.k === 'call_closed') {
      if (sameCall && !C.started && d.call_id && C.id) endCall('missed', false, d.status === 'declined' ? 'Rad etildi' : 'Javob berilmadi')
      return
    }
    // ── accept: faqat CHAQIRUVCHI oladi ──
    if (d.k === 'accept' && C.role === 'offerer' && !C.pc) {
      ringTone(false); clearTimeout(C.timeout); clearTimeout(C.camT)
      if (!C.local) { // kamera hali ochilmoqda — PARKING: media tayyor bo'lgach offer yuboriladi
        C.pendingAccept = true
        logSig('accept kutishda', 'kamera ochilmoqda — media tayyor bo‘lgach offer yuboriladi')
        return
      }
      await processAccept(C)
      return
    }
    // ── needice: qabul qiluvchi tiklanishni SO'RAYDI — offerer o'zi restart qiladi (R1) ──
    if (d.k === 'needice' && C.role === 'offerer') {
      clog('needice', 'qarshi tomon so‘radi — ICE restart')
      if (C.pc && !C.restaring) restartIce(C)
      return
    }
    // ── aonly: qarshi tomon «Faqat ovoz» rejimini yoqdi/o'chirdi (v82) ──
    if (d.k === 'aonly') {
      C.aOnly = !!d.on
      applyAudioOnly(C, false)
      return
    }
    // ── v94: a-reset — QARSHI TOMON dekoderi o'lganini so'raydi: bizning audio
    // transceiver'ni TO'XTATIB, YANGI m-line bilan qayta qo'shamiz (renegotiation) —
    // qarshi tomonda YANGI receiver/dekoder tug'iladi (Chrome/154 WebView jimligi uchun
    // yagona haqiqiy chora: wa/ra/v hammasi BIR qabul quvuridan oqadi) ──
    if (d.k === 'a-reset') {
      clog('a-reset', 'qarshi tomon so‘rovi — audio transceiver 0 dan qurilmoqda')
      audioTransceiverReset(C)
      return
    }
    // ── v90: qa — qarshi tomon KIRUVCHI video sifati yomon deb xabar beradi: bizning
    // CHIQUVCHI bitratimiz uni bog'ib qo'yyapti — darhol pasaytiramiz (renegotiation YO'Q) ──
    if (d.k === 'qa') {
      const nl = Math.min(3, +d.lvl || 0)
      if (nl > (C.qaLvl || 0)) {
        C.qaLvl = nl; C.qaAt = Date.now()
        applyVideoLevel(C)
        clog('sifat-masofa', 'qarshi tomon so\u2018rovi \u2192 L' + nl + ' (video yengillashtirildi)')
      }
      return
    }
    // ── offer: FAQAT offerer yaratadi (qabul qiluvchi faqat JAVOB beradi) ──
    if (d.k === 'offer') {
      if (!C.pc) { // EARLY-OFFER PARKING: pc hali tayyor emas (getMedia ishlayapti)
        C.pendingOffer = d
        logSig('offer kutishda', 'pc hali tayyor emas — acceptCall ishlanadi')
        return
      }
      const oseq = +d.oseq || 0
      // IDEMPOTENT: xuddi shu offer qayta keldi (WS+navbat/WS-restart) — javobni qaytaramiz
      if (d.sdp && C.pc.remoteDescription && C.pc.remoteDescription.sdp === d.sdp.sdp && C.pc.localDescription) {
        sigTo(from, { k: 'answer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq }, 3, 900)
        return
      }
      // ESKI offer (yangi restart'dan keyin kechikib keldi) — qabul qilinmaydi
      // v94: a-reset offeri ATAYLAB yangi — oseq-tartibidan TASHQARI (areset belgisi)
      if (oseq && !d.areset && C.lastOseq && oseq < C.lastOseq) { logSig('eski offer tashlandi', 'oseq=' + oseq + ' oxirgi=' + C.lastOseq); return }
      if (C.pc.signalingState !== 'stable') { logSig('offer drop', 'signaling=' + C.pc.signalingState); return }
      C.lastOseq = oseq
      await C.pc.setRemoteDescription(d.sdp)
      await flushIce(C)
      const a = await C.pc.createAnswer()
      await C.pc.setLocalDescription(a)
      const ok = await sigTo(from, { k: 'answer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq }, 3, 900)
      // v94: a-reset javobi — O'Z MIKROFONIMIZNI yangi transceiver'ga qayta ulaymiz.
      // Sabab: qarshi tomon eski (umumiy) audio m-line'ni to'xtatdi — bizning mikrofon
      // o'sha m-line'da yurardi; qayta ulanmasa qarshi tomon bizni eshitmay qoladi.
      // MUHIM: AVVAL answer yuboriladi (peer 'stable'ga qaytadi), KEYIN yangi offer.
      if (d.areset && C.local && ok) {
        try {
          const at2 = C.local.getAudioTracks()[0]
          const ntr = C.pc.getTransceivers().find((t) => !t.stopped && t.receiver && t.receiver.track && t.receiver.track.kind === 'audio' && (!t.sender || !t.sender.track))
          if (at2 && ntr) {
            await ntr.sender.replaceTrack(at2)
            try { ntr.direction = 'sendrecv' } catch {}
            await C.pc.setLocalDescription(await C.pc.createOffer())
            await sigTo(from, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON(), oseq: (C.oseq = (C.oseq || 0) + 1), areset: 1 }, 3, 900)
            clog('a-reset', 'mikrofon yangi transceiverga qayta ulandi + offer yuborildi')
          }
        } catch (er) { clog('a-reset-xato', 'mikrofon ulash: ' + String((er && er.message) || er).slice(0, 100)) }
      }
      if (!ok && !C.started) endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
      return
    }
    // ── answer: faqat CHAQIRUVCHI oladi (R5: eski javob qabul qilinmaydi) ──
    if (d.k === 'answer' && C.pc) {
      if (C.pc.signalingState !== 'have-local-offer') { logSig('answer drop', 'signaling=' + C.pc.signalingState); return }
      if (C.oseq && d.oseq && +d.oseq !== C.oseq) { logSig('eski javob tashlandi', 'oseq=' + d.oseq + ' bizniki=' + C.oseq); return }
      if (C.pc.remoteDescription && d.sdp && C.pc.remoteDescription.sdp === d.sdp.sdp) return
      await C.pc.setRemoteDescription(d.sdp)
      await flushIce(C)
      return
    }
    if (d.k === 'ice') { if (C.pc?.remoteDescription) await C.pc.addIceCandidate(d.c).catch(() => {}); else C.ice.push(d.c) }
  } catch (e) {
    console.warn('signal', e)
    clog('signal-xato', (d.k || '?') + ' ' + String((e && e.message) || e).slice(0, 120))
  }
}
on('signal', handleSignalEv)
// SERVERDAN PROAKTIV YOPISH: qarshi tomon rad etdi/ketdi — server 'call_closed' yuboradi
on('call_closed', (ev) => {
  const C = CALL
  if (!C || !ev || !ev.call_id) return
  if (String(C.id) !== String(ev.call_id)) return
  if (C.started) return // faol qo'ng'iroq 'hangup' orqali yopiladi
  endCall('missed', false, ev.status === 'declined' ? 'Rad etildi' : 'Javob berilmadi')
})
// ─────────────── R6: SOG'LIQ-HALQASI (yagona qorovul — 5s) ───────────────
// Avvalgi 6 xil taymer/qsorovul o'rniga BITTA mustaqil halqa: har 5s holatni tekshirib
// TO'G'RILAYDI. Tiklash rollarga bo'lingan (R1): offerer o'zi restart, answerer so'raydi.
function evalStats(C, st) {
  let inA = 0, inV = 0, outA = 0, outV = 0, fr = 0, fd = 0, lostV = 0, recvV = 0, lostA = 0, recvA = 0, rtt = -1
  let alvL = -1, smpl = 0, kon = 0 // v90: dekoder o'lchovlari — audioLevel, totalSamplesReceived, concealedSamples
  st.forEach((r) => {
    // TURN relay belgisi — «mobil tarmoqda media yo'q» deganda birinchi savolga javob
    if (r.type === 'candidate-pair' && r.state === 'succeeded') {
      C.relay = (r.localCandidateType === 'relay' || r.remoteCandidateType === 'relay') ? 1 : 0
      if (typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime
    }
    if (r.type === 'inbound-rtp' && !r.isRemote) {
      if (r.kind === 'audio') {
        inA += r.bytesReceived || 0; lostA = r.packetsLost || 0; recvA = r.packetsReceived || 0
        // v90: audioLevel — Chromium DEKODER CHIQISHIDagi ovoz (0-1). WebAudio remote-tap
        // ba'zi WebView'larda yolg'on nol beradi — bu o'lchov mustaqil va ishonchli.
        if (typeof r.audioLevel === 'number') { alvL = Math.max(alvL, Math.round(r.audioLevel * 100)); C.hasAlv = 1 }
        if (typeof r.totalSamplesReceived === 'number') { smpl += r.totalSamplesReceived || 0; C.hasSmpl = 1 }
        kon += r.concealedSamples || 0
      }
      if (r.kind === 'video') { inV += r.bytesReceived || 0; fr = r.framesDecoded || 0; fd = r.framesDropped || 0; lostV = r.packetsLost || 0; recvV = r.packetsReceived || 0 }
    }
    if (r.type === 'outbound-rtp') {
      if (r.kind === 'audio') outA += r.bytesSent || 0
      if (r.kind === 'video') outV += r.bytesSent || 0
    }
  })
  const now = Date.now(), s = C.st0
  if (!s) { C.st0 = { t: now, inA, inV, outA, outV, fr, fd, lostV, recvV, lostA, recvA, smpl, kon }; return }
  if (now - s.t < 4500) return // ~5s oynada bir marta
  const dts = Math.max(1, (now - s.t) / 1000)
  const dInA = inA - s.inA, dInV = inV - s.inV, dOutA = outA - s.outA, dOutV = outV - s.outV
  const dSmpl = Math.max(0, smpl - (s.smpl || 0)), dKon = Math.max(0, kon - (s.kon || 0))
  C.st0 = { t: now, inA, inV, outA, outV, fr, fd, lostV, recvV, lostA, recvA, smpl, kon }
  C.statN = (C.statN || 0) + 1
  // ── v82.1: OVOZ DARAJASI (RMS) — «kim jim» savoliga aniq javob ──
  // v84: kiruvchi o'lchov remoteA (faqat-audio oqim) bilan — an_in eski/bo'sh trekka
  // bog'lanib qolmasligi uchun audio-trek o'zgarganda null qilinadi (ontrack)
  // v87: namunovchining 5s OYNA MAKSIMUMI (bitta snapshot emas!) — -1 = o'lchanmadi
  let inR = C.inWin === undefined ? -1 : C.inWin
  let outR = C.outWin === undefined ? -1 : C.outWin
  const alvR = alvL // v90: dekoder-chiqishi ovozi (yo'q bo'lsa -1)
  C.inWin = -1; C.outWin = -1
  // v90: ELEMENT HOLATI — element IJRO etmoqdami? currentTime harakati = ijro isboti.
  // Keyingi jurnal bu bilan ANIQ ajratadi: element qotgan (cur+0) / dekoder jim (cur>0,
  // smp+0) / metr yolg'on (cur>0, alv>0, k=0) / yuboruvchi jim (smp>0, alv=0).
  let elState = 'yo‘q'
  try {
    const aEl = C.el && qs('.ra', C.el)
    if (aEl) {
      const ct = aEl.currentTime || 0
      const dCur = C.cur0 === undefined ? -1 : Math.round((ct - C.cur0) * 10) / 10
      C.cur0 = ct
      elState = 'cur+' + dCur + ' mu=' + (aEl.muted ? 1 : 0) + ' vol=' + aEl.volume + ' pa=' + (aEl.paused ? 1 : 0) + ' rd=' + aEl.readyState
    }
  } catch {}
  const at = C.local && C.local.getAudioTracks()[0]
  const rat = C.remote && C.remote.getAudioTracks()[0]
  try { if (C.ctx && C.ctx.state !== 'running') C.ctx.resume().catch(() => {}) } catch {}
  // v87: stat har 2-oynada (10s — avval 15s edi, 29s'lik qo'ng'iroqlarda 1 tagina chiqardi)
  // v92: eshit= — qo'ng'iroq davomida HECH BO'LMASA BIR marta eshitish dalili bo'lganmi
  if (C.statN % 2 === 0) clog('stat', `inA=+${dInA} inV=+${dInV} outA=+${dOutA} outV=+${dOutV} kadrlar=+${fr - s.fr} | ovoz=${C.audioMode || '?'}${C.audioBlocked ? '(blok)' : ''} eshit=${C.everHeard ? 1 : 0} k=${inR}% ch=${outR}% mik=${at ? (at.enabled ? 'on' : 'O‘CHIRILGAN') : 'yo‘q'} rmut=${rat ? (rat.muted ? 'ha' : 'yo‘q') : '?'} sil=${C.silN || 0} fb=${C.fbN || 0} kk=${C.kickN || 0} vx=${C.qaLvl || 0} | alv=${alvR}% smp=+${dSmpl} kon=+${dKon} | el=${elState} | turn=${C.relay === undefined ? '?' : C.relay} | ctx=${C.ctx ? C.ctx.state : 'yo‘q'} aS=${C.hasAlv ? 1 : 0} sS=${C.hasSmpl ? 1 : 0} rej=${C.playRejN || 0}`)
  // ── v92: JIMLIK-QUTQARUVCHI — NUTQ DALILI BILAN (ANIQLANGAN) ──
  // v91 XATOSI (shikoyatning asosiy ildizi): qorovul dInA>0 bilan ishlar edi — lekin
  // Opus SUKUTI ham paket yuboradi (dInA>0, ~10x kam). Ya'ni qarshi tomon 15s GAPIRMASA
  // audioLevel=0 bo'lardi → ISHLAYOTGAN karnay yo'li 'ra'ga (quloqchi) almashtirilardi →
  // video qo'ng'iroqda JIM. SUKUT O'ZI YO'LNI BUZARDI — sukut payti har qo'ng'iroqda
  // boshqacha bo'lgani uchun «bir qarasang ishlaydi, bir qarasang ishlamaydi».
  // v92 QOIDA: qutqaruv FAQAT ikkala shart birga bo'lganda ishlaydi:
  //   NUTQ DALILI: dInA > 8000 bayt/5s (faol gapirish — Opus sukuti bunday bo'lolmaydi)
  //   ES HITISH DALILI YO'Q: alv<1 (dekoder energiyasi) VA k<1 (ijro/oqim metrikasi)
  // Sukutda (dInA≤8000) yo'l HECH QACHON o'zgartirilmaydi — ishlayotgan yo'l buzilmaydi.
  const alvAvail = alvR >= 0
  const mut = !!C.spkMuted && !window.Android50 // browser «Dinamik»-jim — foydalanuvchi tanlovi, qutqaruv aralashmaydi
  const heard = (alvAvail && alvR > 1) || inR > 1
  if (heard) { C.everHeard = 1; C.silN = 0 }
  else if (dInA > 8000 && !mut) {
    C.silN = (C.silN || 0) + 1
    const z = C.silN
    if (z === 1) {
      // 1-oyna: o'z yo'limiz ICHIDA tiklash (yo'lni o'zgartirmasdan).
      // v94: wa manbasi YANGI oqim-o'ramdan quriladi (Chrome/154 «tirik trekka jim
      // oqadigan eski manba-tugun» kasalligiga birinchi javob).
      unlockAudio(C)
      if (C.audioMode === 'wa') freshWASource(C)
      else rebindRemoteAudio(C)
      playRemote(C)
      clog('ovoz-jim', 'bosqich 1: o\'z yo\'li tiklandi (rejim=' + C.audioMode + ' alv=' + alvR + '% k=' + inR + '%)')
    } else if (z === 3) {
      // 3-oyna: BOSHQA FIZIK yo'lga o'tish — v94: UCHTA yo'l aylanadi (wa→ra→v→wa).
      // 'v' = video-element ovozi — ba'zi qurilmalarda yagona ishlaydigan yo'l (v85 dalili).
      const seq = ['wa', 'ra', 'v']
      const i = seq.indexOf(C.audioMode)
      C.audioMode = seq[(i + 1 + seq.length) % seq.length] || 'wa'
      playRemote(C)
      clog('ovoz-almashtirildi', C.audioMode + ' yo\'liga o\'tildi (nutq=' + Math.round(dInA / 1000) + 'KB/5s, eshitish dalili yo\'q)')
    } else if (z === 4) {
      clog('ovoz-jim', 'bosqich 4: elementlar 0 dan qurilmoqda')
      rebuildCallElements(C)
    } else if (z === 5) {
      // v94: AudioContext QAYTA TUG'ILISHI — "running" lekin ichi o'lik kontekstga yagona JS-davo
      rebirthCtx(C)
      if (C.audioMode === 'wa') freshWASource(C)
      playRemote(C)
      clog('ovoz-jim', 'bosqich 5: kontekst qayta tug\'ildi, rejim=' + C.audioMode)
    } else if (z === 6) {
      clog('ovoz-jim', 'bosqich 6: native ovoz-kick (OS marshrutini urish)')
      nativeKick(C)
    } else if (z === 7) {
      // v94: DEKODER-QAYTA-QURISH so'rovi — barcha JS yo'llari o'lgan bo'lsa (wa/ra/v +
      // yangi manba + yangi kontekst ham jim) — qarshi tomonning audio m-line'ini yangilash
      // SO'RALADI: yangi m-line = qarshi tomonda YANGI receiver/dekoder (renegotiation).
      if (!C.aRstReq) {
        C.aRstReq = 1
        clog('ovoz-jim', 'bosqich 7: a-reset — qarshi tomondan yangi dekoder so\'raldi')
        sigTo(C.peer.id, { k: 'a-reset', call_id: C.id }, 3, 900)
      } else { nativeKick(C); clog('ovoz-jim', 'bosqich 7: native kick (a-reset allaqachon so\'rilgan)') }
    } else if (z >= 8) {
      // AYLANISH: uch fizik yo'l almashadi — abadiy jimlik mumkin emas
      const seq = ['wa', 'ra', 'v']
      const i = seq.indexOf(C.audioMode)
      C.audioMode = seq[(i + 1 + seq.length) % seq.length] || 'wa'
      playRemote(C)
      if (z % 3 === 0) nativeKick(C)
      if (z % 5 === 0) rebuildCallElements(C)
      if (z % 7 === 0 && C.audioMode === 'wa') freshWASource(C)
      if (z > 40) C.silN = 8 // hisoblagich cheksiz o'smasin
      clog('ovoz-jim', 'aylanish: rejim=' + C.audioMode + ' (z=' + z + ')')
    }
  } else if (!dInA) C.silN = 0 // sukut/tarmoq jim — hech narsaga tegilmaydi (v91 ildizi yo'q)
  // dInA 0..8000 orasida (pasli ovoz/sukut) — silN saqlanadi, o'zgarmaydi
  // ── KIRUVCHI OVOZ o'lgan — narvon: 3-oyna elementlarni jonlantir, 5-oynada tiklash ──
  if (dInA === 0) {
    C.inDead = (C.inDead || 0) + 1
    if (C.inDead === 3) { clog('ovoz-yoq', 'kiruvchi ovoz ~15s to‘xtadi — elementlar jonlantiriladi'); playRemote(C) }
    if (C.inDead >= 5) { C.inDead = 3; recover(C, 'audio-kelmadi') }
  } else { C.inDead = 0; C.recTries = 0; C.recAt = 0 }
  // ── KIRUVCHI VIDEO o'lgan (video qo'ng'iroqda; faqat-ovoz rejimida kutilgan holat) ──
  if (C.video && dInV === 0 && !C.aOnly) {
    C.vDead = (C.vDead || 0) + 1
    if (C.vDead >= 5) { C.vDead = 3; recover(C, 'video-kelmadi') }
  } else C.vDead = 0
  // ── CHIQUVCHI OVOZ o'lgan — mikrofonni OS musodara qilgan: replaceTrack (renegotiation YO'Q)
  if (dOutA === 0 && at && at.readyState === 'live' && at.enabled) {
    C.outDead = (C.outDead || 0) + 1
    if (C.outDead >= 4 && (C.heals || 0) < 4) { C.outDead = 0; C.heals = (C.heals || 0) + 1; healOutgoing(C, 'audio') }
  } else C.outDead = 0
  // ── v82.1+v87: MIKROFON-JIM davolash — tarmoqga yuborilyapti (outA>0) lekin mikrofon
  // oqimi 15s JIM (oyna-max RMS<1%): WebView capture-pipelini qotishi. AVVALGI XATO:
  // 30s (6-oyna) kutilardi — 29s'lik qo'ng'iroqda UMUMAN ulgurmagan! Endi 15s (3-oyna)
  // va 4 martagacha davolaydi. replaceTrack — renegotiation yo'q.
  // v94: faqat KUCHLI nutq dalilida (dOutA>12000 — Opus sukuti ~1-2KB/5s, gapirish 8-15KB).
  // Avvalgi shart dOutA>0 edi — TINGLAYOTGAN (gapirmayotgan) tomonda YALG'ON heal bo'lar,
  // har 15s mikrofon ochilishi churn = video muzlashlarga xissa qo'shgan (X jurnali: heal #1-#4).
  if (outR !== -1 && outR < 1 && dOutA > 12000 && at && at.readyState === 'live' && at.enabled) {
    C.silN = (C.silN || 0) + 1
    if (C.silN >= 3 && (C.heals || 0) < 4) { C.silN = 0; C.heals = (C.heals || 0) + 1; clog('mikro-jim', 'mikrofon 15s jim oqmoqda (oyna-max<1%) — qayta ochilmoqda #' + C.heals); healOutgoing(C, 'audio') }
  } else C.silN = 0
  // ── CHIQUVCHI VIDEO o'lgan (faqat-ovoz rejimida video ataylab yuborilmaydi) ──
  const vt = C.local && C.local.getVideoTracks()[0]
  if (C.video && !C.aOnly && dOutV === 0 && dOutA > 0 && vt && vt.readyState === 'live' && vt.enabled) {
    C.ovDead = (C.ovDead || 0) + 1
    if (C.ovDead >= 4 && (C.heals || 0) < 3) { C.ovDead = 0; C.heals = (C.heals || 0) + 1; healOutgoing(C, 'video') }
  } else C.ovDead = 0
  // ── v82: SIFAT BAHOSI (ko'rsatkich) + AVTOMATIK MOSLASHUV ──
  try {
    let bad = 0
    if (rtt >= 0 && rtt > 0.45) bad++ // kechikish >450ms
    const useV = !C.aOnly
    const lp = useV ? (recvV - (s.recvV || 0)) : (recvA - (s.recvA || 0))
    const ll = useV ? (lostV - (s.lostV || 0)) : (lostA - (s.lostA || 0))
    if (lp + ll > 40 && ll / (lp + ll) > 0.08) bad++ // paket yo'qotish >8%
    const dFr = fr - (s.fr || 0), dFd = fd - (s.fd || 0)
    if (useV && dFr + dFd > 60 && dFd / (dFr + dFd) > 0.5) bad++ // kadrlar yarmidan ko'p tashlanmoqda
    if (C.video && useV && C.statN >= 2) {
      if (dInV * 8 / dts / 1000 < 50) bad++ // kiruvchi video juda sekin (muzlash)
      const vt2 = C.local && C.local.getVideoTracks()[0]
      if (vt2 && vt2.readyState === 'live' && vt2.enabled && dOutV * 8 / dts / 1000 < 50) bad++ // chiquvchi video to'silgan
    }
    setQualityUI(C, bad === 0 ? 0 : bad === 1 ? 1 : 2)
    if (C.video && useV && C.started) {
      C.qaLvl = C.qaLvl || 0
      if (bad >= 2) { C.qBadN = (C.qBadN || 0) + 1; C.qGoodN = 0 }
      else if (bad === 0) { C.qGoodN = (C.qGoodN || 0) + 1; C.qBadN = 0 }
      else { C.qBadN = 0; C.qGoodN = 0 }
      if (C.qBadN >= 2 && C.qaLvl < 3 && now - (C.qaAt || 0) > 10000) {
        C.qaLvl++; C.qaAt = now; C.qBadN = 0
        applyVideoLevel(C)
        // v90: qarshi tomonga ham xabar — uning KIRUVCHISI ham yomon bo'lishi mumkin
        try { sig(C.peer.id, { k: 'qa', call_id: C.id, lvl: C.qaLvl }) } catch {}
        clog('sifat-pasaydi', 'L' + C.qaLvl + ' — tarmoq sekin, video yengillashtirildi (bad=' + bad + ')')
      } else if (C.qGoodN >= 4 && C.qaLvl > 0 && now - (C.qaAt || 0) > 15000) {
        C.qaLvl--; C.qaAt = now; C.qGoodN = 0
        applyVideoLevel(C)
        clog('sifat-oshdi', 'L' + C.qaLvl + ' — tarmoq yaxshi, sifat tiklandi')
      }
    }
  } catch {}
}
setInterval(() => {
  const C = CALL
  if (!C) return
  try {
    // 1) DOM butunligi: oyna tasodifan o'chirilgan bo'lsa — toza yopamiz
    if (!document.body.contains(C.el)) { endCall('ended', false); return }
    // 2) Vaqt budjeti: hali ulanmagan — taymerlar muzlagan bo'lsa ham aniq yopiladi
    if (!C.started) {
      const deadline = C.acceptAt ? C.acceptAt + 45000 : (C.t0 || 0) + 75000
      if (Date.now() > deadline) { endCall('missed', true, C.acceptAt ? 'Ulanib bo‘lmadi' : 'Javob berilmadi'); return }
    }
    // 3) Jiringlash qorovusi: kirish qo'ng'irog'i ko'rinib turganda ovoz jimsiz bo'lsa — jonlanadi
    if (!C.started && C.ringMode && !ringTimer) ringTone(true, C.ringMode || undefined)
    try { if (ringCtx && ringCtx.state === 'suspended') ringCtx.resume().catch(() => {}) } catch {}
    // 4) PC 'failed' — tiklash narvoni
    if (C.pc && C.pc.connectionState === 'failed' && C.started) { recover(C, 'pc-failed-halqa'); return }
    // 5) Media statistikasi — faqat ulangan qo'ng'iroqda
    if (C.started && C.pc && C.pc.connectionState === 'connected') {
      C.pc.getStats().then((st) => { if (CALL === C) evalStats(C, st) }).catch(() => {})
    }
  } catch {}
}, 5000)
// ---------------- v76: KAMERA XATO-TASHXISI + AVTO-TIKLANISH ----------------
async function camFail(C, e) {
  const name = (e && e.name) || ''
  if (name !== 'MediaHangError' && name !== 'NotAllowedError' && name !== 'NotReadableError' && name !== 'AbortError') return
  let diag = name
  try {
    const p = await navigator.permissions.query({ name: 'camera' }).catch(() => null)
    const m = await navigator.permissions.query({ name: 'microphone' }).catch(() => null)
    if (p) diag += ' camPerm=' + p.state
    if (m) diag += ' micPerm=' + m.state
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const cams = devs.filter((d) => d.kind === 'videoinput').length
    const mics = devs.filter((d) => d.kind === 'audioinput').length
    const labeled = devs.find((d) => (d.kind === 'videoinput' || d.kind === 'audioinput') && d.label)
    diag += ' cam=' + cams + ' mic=' + mics + (labeled ? ' (label bor)' : ' (label yo\'q — ruxsat yo\'q)')
  } catch {}
  clog('kamera-xato', diag)
  try {
    const st = JSON.parse(sessionStorage.getItem('g50_camfail') || 'null')
    const t = Date.now()
    const n = st && t - st.ts < 5 * 60000 ? (st.n || 0) + 1 : 1
    if (n === 2 && !st.rel && C) {
      // 2-MARTA: sahifa yangilanadi — WebView media-steki tozalanadi, qo'ng'iroq o'zi qayta yoqiladi
      sessionStorage.setItem('g50_camfail', JSON.stringify({ n, ts: t, rel: 1, uid: C.peer.id, video: C.video ? 1 : 0 }))
      clog('kamera-tiklash', 'kamera 2 marta osildi — sahifa yangilanadi va qo\'ng\'iroq qayta yoqiladi')
      shipClog()
      setTimeout(() => { try { location.reload() } catch {} }, 900)
    } else {
      sessionStorage.setItem('g50_camfail', JSON.stringify({ n, ts: t }))
    }
  } catch {}
}
function camOk() { try { sessionStorage.removeItem('g50_camfail') } catch {} }
// RELOAD'DAN KEYINGI AVTO-QAYTA-CHAQIRUV (camFail sahifani yangilaganda)
window.__50camRedial = async () => {
  try {
    const st = JSON.parse(sessionStorage.getItem('g50_camfail') || 'null')
    if (!st || !st.rel || !st.uid) return
    if (Date.now() - st.ts > 90000) return
    for (let i = 0; i < 50; i++) {
      if (S.me && S.me.id && S.token) break
      await new Promise((r) => setTimeout(r, 300))
    }
    if (!S.me || !S.token || CALL) return
    const uid = st.uid, video = !!st.video
    setTimeout(() => {
      if (CALL || !S.me) return
      toast('Kamera tizimi tiklandi — qo‘ng‘iroq qayta yoqilmoqda…')
      clog('kamera-tiklash', 'reload tugadi — qo‘ng‘iroq avtomatik qayta yoqilmoqda')
      callUser(uid, video)
    }, 1200 + Math.floor(Math.random() * 2500))
  } catch {}
}
// ---------------- Qo'ng'iroq ohangi 2.0 (WebAudio sintez — 0 KB) ----------------
// v78 «BA'ZI TELEFONLARDA JIRINGLAMAYDI» ildizlari: AudioContext SUSPENDED bo'lsa ovoz
// UMUMAN chiqmasdi (resume rad etiladi, zaxira yo'q); tebranish faqat 1 marta edi.
// YANGI DVIGATEL: 1) 4 marta resume urinishi (0/150/400/900ms) 2) baribir jim bo'lsa
// WAV-zaxira ovoz (runtime'da sintez, 0 KB tarmoq) 3) har bosishda qulf ochiladi
// 4) KIRISH: zamonaviy kalimba-arpejio + yumshoq echo 5) tebranish LOOP (jiringlash davomi)
let ringCtx = null, ringTimer = 0, ringVibT = 0, ringFall = null, ringGuard = 0
function ringUnlock() {
  try { if (ringCtx && ringCtx.state === 'suspended') ringCtx.resume().catch(() => {}) } catch {}
}
try { document.addEventListener('pointerdown', ringUnlock, { capture: true }) } catch {}
// ZAXIRA OVOZ: WebAudio ishlamasa — haqiqiy WAV fayl (runtime'da sintez qilinadi)
function ringFallbackWav() {
  const SR = 8000, DUR = 1.6, n = Math.floor(SR * DUR)
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + n, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, SR, true); v.setUint32(28, SR, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  ws(36, 'data'); v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) { // ikki nota: E5 (0–0.5s) → C5 (0.55–1.55s), yumshoq kempanda
    const t = i / SR, first = t < 0.5, lt = first ? t : t - 0.55
    const f = first ? 659.26 : 523.25
    const env = Math.max(0, Math.min(1, lt * 60)) * Math.exp(-Math.max(0, lt) * 4.2)
    const s = Math.sin(2 * Math.PI * f * t) * 0.75 + Math.sin(4 * Math.PI * f * t) * 0.25
    v.setUint8(44 + i, Math.max(0, Math.min(255, 128 + s * env * 110)))
  }
  let s = ''
  const u = new Uint8Array(buf)
  for (let i = 0; i < u.length; i += 4096) s += String.fromCharCode.apply(null, u.subarray(i, Math.min(u.length, i + 4096)))
  return 'data:audio/wav;base64,' + btoa(s)
}
function ringFallbackStart() {
  if (ringFall) return
  try {
    ringFall = new Audio(ringFallbackWav())
    ringFall.loop = true
    ringFall.volume = 0.9
    ringFall.play().catch(() => {})
  } catch {}
}
function ringFallbackStop() { try { if (ringFall) { ringFall.pause(); try { ringFall.currentTime = 0 } catch {} } } catch {} ringFall = null }
function ringTone(on, mode) {
  clearInterval(ringTimer); clearInterval(ringVibT); clearInterval(ringGuard)
  ringVibT = 0; ringGuard = 0
  ringFallbackStop()
  if (!on) { try { ringCtx && ringCtx.close() } catch {} ringCtx = null; return }
  try {
    if (!ringCtx) ringCtx = new (window.AudioContext || window.webkitAudioContext)()
    ringUnlock()
    for (const d of [150, 400, 900]) setTimeout(ringUnlock, d) // qulfni yechish: 4 urinish
    // QOROVUL: 300ms'da bir tekshiradi — WebAudio jonlansa zaxira o'chadi, jim qolsa
    // 900ms'dan keyin WAV-zaxira ishga tushadi → hech qachon JIM qolmaydi
    setTimeout(() => {
      clearInterval(ringGuard)
      ringGuard = setInterval(() => {
        if (!ringCtx) { clearInterval(ringGuard); return }
        if (ringCtx.state === 'running') { ringFallbackStop(); clearInterval(ringGuard); return }
        ringFallbackStart()
      }, 300)
    }, 900)
    const note = (t, f, d, vol) => {
      const layer = (type, mult, v) => {
        const o = ringCtx.createOscillator(), g = ringCtx.createGain()
        o.type = type
        o.frequency.value = f * mult
        g.gain.setValueAtTime(0.0001, t)
        g.gain.linearRampToValueAtTime(v, t + 0.015)
        g.gain.exponentialRampToValueAtTime(0.0001, t + d)
        o.connect(g); g.connect(ringCtx.destination)
        o.start(t); o.stop(t + d + 0.05)
      }
      layer('sine', 1, vol)            // asos — iliq kalimba
      layer('triangle', 2, vol * 0.32) // yuqori oberton — yorqinlik
      layer('sine', 4, vol * 0.08)     // shirin «havo»
    }
    if (mode === 'in') {
      // ZAMONAVIY KALIMBA-ARPEJJIO (v78): pentatonika, 2 jumlali naqsh — chiroyli va yumshoq
      const playIn = () => {
        if (!ringCtx || ringCtx.state !== 'running') return
        const t0 = ringCtx.currentTime + 0.02
        const E5 = 659.26, A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.5
        const seq = [
          [0.00, E5, 0.42, 0.30], [0.22, B5, 0.42, 0.28], [0.44, C6, 0.44, 0.30], [0.66, E6, 1.05, 0.32],
          [1.60, A5, 0.36, 0.24], [1.82, C6, 0.36, 0.26], [2.04, B5, 1.10, 0.30],
        ]
        for (const [dt, f, d, v] of seq) note(t0 + dt, f, d, v)
      }
      playIn(); ringTimer = setInterval(playIn, 3200)
      // TEBRANISH LOOP: javob berungacha har 2.2s takrorlanadi (avval faqat 1 marta edi)
      const vib = () => { try { vibrate([380, 160, 380, 160, 380]) } catch {} }
      vib(); ringVibT = setInterval(vib, 2200)
    } else {
      const beepOnce = () => {
        if (!ringCtx || ringCtx.state !== 'running') return
        const t = ringCtx.currentTime + 0.02
        note(t, 425, 0.42, 0.18); note(t + 0.62, 425, 0.42, 0.18)
      }
      beepOnce(); ringTimer = setInterval(beepOnce, 2400)
    }
  } catch {}
}
// ---------------- Jonli efir ----------------
// "O‘rgimchak to‘ri" daraxti: efirchi efirni 4 ta tomoshabinga uzatadi, har bir tomoshabin olgan efirini
// yana 3 ta tomoshabinga uzatadi. Shu sababli tomoshabinlar soni cheklanmaydi (10 000 ta ~8 bosqich).
// Izohlar, yuraklar, SOVG'ALAR va tomoshabinlar soni ham shu daraxt bo‘ylab (DataChannel) tarqaladi.
let LIVE = null
// Task 40: 26 xil sovg'a — coin iqtisodiyoti (serverdagi GIFTS narxlari bilan bir xil).
// cat: pop = Mashhur, ani = Kuchli hayvonlar, mul = Multfilm qahramonlari.
// fx: 'sm' kichik uchish, 'md' o'rta (jarangli), 'lg' katta (ekran silkinadi), 'tk' TO'LIQ EKRAN takeover
const LIVE_GIFTS = [
  { id: 'star', name: 'Yulduz', p: 5, cat: 'pop' }, { id: 'heart', name: 'Yurak', p: 10, cat: 'pop' },
  { id: 'rose', name: 'Gul', p: 25, cat: 'pop' }, { id: 'mushuk', name: 'Mushuk', p: 15, cat: 'ani' },
  { id: 'kuchuk', name: 'Kuchukcha', p: 20, cat: 'ani' }, { id: 'kapibara', name: 'Kapibara', p: 39, cat: 'ani' },
  { id: 'fire', name: 'Olov', p: 49, cat: 'pop' }, { id: 'robot', name: 'Robot', p: 99, cat: 'mul' },
  { id: 'panda', name: 'Panda', p: 129, cat: 'ani' }, { id: 'bori', name: 'Bo‘ri', p: 159, cat: 'ani' },
  { id: 'alien', name: 'Alien', p: 179, cat: 'mul' }, { id: 'cake', name: 'Tort', p: 149, cat: 'pop' },
  { id: 'crown', name: 'Toj', p: 199, cat: 'pop' }, { id: 'burgut', name: 'Burgut', p: 219, cat: 'ani' },
  { id: 'fil', name: 'Fil', p: 259, cat: 'ani' }, { id: 'yolbars', name: 'Yo‘lbars', p: 299, cat: 'ani' },
  { id: 'akula', name: 'Akula', p: 349, cat: 'ani' }, { id: 'sher', name: 'Sher', p: 399, cat: 'ani' },
  { id: 'superqahramon', name: 'Superqahramon', p: 449, cat: 'mul' }, { id: 'diamond', name: 'Olmos', p: 499, cat: 'pop' },
  { id: 'dinozavr', name: 'Dinozavr', p: 599, cat: 'ani' }, { id: 'kit', name: 'Kit', p: 649, cat: 'ani' },
  { id: 'feniks', name: 'Feniks', p: 749, cat: 'ani' }, { id: 'rocket', name: 'Raketa', p: 999, cat: 'pop' },
  { id: 'ajdar', name: 'Ajdar', p: 1299, cat: 'ani' }, { id: 'galaktika', name: 'Galaktika', p: 1999, cat: 'mul' },
]
const giftFx = (p) => (p >= 499 ? 'tk' : p >= 349 ? 'lg' : p >= 129 ? 'md' : 'sm')
const giftById = (id) => LIVE_GIFTS.find((x) => x.id === id)
const giftImg = (id) => 'stickers/gifts/' + id + '.svg'
let WALLET = null
async function refreshWallet() { try { WALLET = await api('/wallet') } catch {} return WALLET }
// Efir TOP sovg‘achilari (shu efir davomi uchun)
const LTOP = new Map()
function liveTopAdd(name, cost) {
  if (!LIVE || !cost) return
  const k = name || '?'
  LTOP.set(k, (LTOP.get(k) || 0) + cost)
  const box = qs('#l-top', LIVE.el); if (!box) return
  const arr = [...LTOP.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  box.innerHTML = arr.map(([n, c], i) => `<span class="lt ${i === 0 ? 'l1' : ''}">${['🥇','🥈','🥉'][i] || ''} ${esc(n)} · ${c}</span>`).join('')
}
function ballFloat(el, txt) {
  const f = document.createElement('div'); f.className = 'ballf'; f.textContent = txt + ' ball'
  el.appendChild(f); setTimeout(() => f.remove(), 1500)
}
function heartBurst(el) {
  // TEZLIK: 3 ta yurak — tez-tez bosilganda ham DOM engil qoladi
  for (let i = 0; i < 3; i++) {
    const f = document.createElement('div'); f.className = 'fly'
    f.textContent = '❤️'; f.style.left = (74 + Math.random() * 16) + '%'
    f.style.animationDelay = (i * 0.12) + 's'
    el.appendChild(f); setTimeout(() => f.remove(), 1900)
  }
}
function flyGift(el, gid, name, from, cost) {
  if (!el) return
  const fx = giftFx(cost || giftById(gid)?.p || 0)
  // Task 40: qimmat sovg'a (Olmos, Raketa, Feniks, Ajdar, Galaktika…) — TO'LIQ EKRAN TAKEOVER
  if (fx === 'tk') return giftTakeover(el, gid, name, from, cost)
  // Katta sovg'a (Akula, Sher, Superqahramon) — ekran silkinadi
  if (fx === 'lg') { el.classList.remove('lshake'); void el.offsetWidth; el.classList.add('lshake'); setTimeout(() => el.classList.remove('lshake'), 700) }
  // TEZLIK: bir vaqtda ko'pi bilan 3 ta uchuvchi sovg'a — sovg'a to'lqinida DOM to'lib, efir qotib qolmasin
  const fgs = el.querySelectorAll('.flygift')
  if (fgs.length >= 3) fgs[0].remove()
  const f = document.createElement('div')
  f.className = 'flygift' + (fx === 'lg' ? ' fg-l' : fx === 'md' ? ' fg-m' : '')
  f.innerHTML = `<img src="${giftImg(gid)}" alt=""><span><b>${esc(from || '')}</b>${esc(name || '')}</span>`
  el.appendChild(f)
  setTimeout(() => f.remove(), fx === 'sm' ? 3400 : 3800)
}
// TO'LIQ EKRAN TAKEOVER — nur nurlari aylanadi, sovg'a kattalashib chiqadi, ism va coin ko'rinadi
function giftTakeover(el, gid, name, from, cost) {
  if (!el) return
  const g = giftById(gid)
  const t = document.createElement('div')
  t.className = 'gtake'
  t.innerHTML = `<div class="gt-rays"></div><div class="gt-body"><img src="${giftImg(gid)}" alt=""><div class="gt-name">${esc(g?.name || gid)}${name && String(name).indexOf('×') === 0 ? ' ' + esc(name) : ''}</div><div class="gt-from">🎁 ${esc(from || '')} sovg‘a berdi</div><div class="gt-cost">🪙 ${fmtN(cost || g?.p || 0)} coin</div></div>`
  el.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}
// COMBO — bir xil sovg'a ketma-ket yuborilsa ×2, ×3… ko'payib boradi (TikTok uslubi)
function giftCombo(el, gid) {
  const L = LIVE; if (!el || !L) return
  const t = Date.now()
  if (L.cb && L.cb.gid === gid && t - L.cb.t < 2600) L.cb.n++
  else L.cb = { gid, n: 1, t }
  if (L.cb.n < 2) { if (L.cbT) { clearTimeout(L.cbT); L.cbT = 0 } return }
  let chip = qs('.lcombo', el)
  if (!chip) { chip = document.createElement('div'); chip.className = 'lcombo'; el.appendChild(chip) }
  chip.textContent = '🔥 COMBO ×' + L.cb.n
  chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop')
  if (L.cbT) clearTimeout(L.cbT)
  L.cbT = setTimeout(() => { const c = qs('.lcombo', el); if (c) c.remove(); if (LIVE === L) L.cb = null }, 2600)
}
// ---- Task 41: OVOZ EFFEKLARI — hammasi WebAudio sintez (audio fayl YO'Q, 0 KB yuklama) ----
let sndCtx = 0
let sndOn = true
try { sndOn = (localStorage.getItem('g50snd') || '1') === '1' } catch {}
function sndC() {
  try {
    sndCtx = sndCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (sndCtx.state === 'suspended') sndCtx.resume().catch(() => {})
    return sndCtx
  } catch { return null }
}
function tone(c, f0, f1, dur, type, vol, delay = 0) {
  try {
    const t = c.currentTime + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(c.destination)
    o.start(t); o.stop(t + dur + 0.05)
  } catch {}
}
// Kichik sovg'a — pufakcha "pop"
function sndPop() { const c = sndC(); if (!c || !sndOn) return; tone(c, 380, 780, 0.1, 'sine', 0.13) }
// O'rta sovg'a — oltin tanga "ding-ding"
function sndCoin() { const c = sndC(); if (!c || !sndOn) return; tone(c, 988, 988, 0.07, 'square', 0.055); tone(c, 1319, 1319, 0.28, 'square', 0.055, 0.07) }
// Katta sovg'a — shovqin (whoosh) + portlash
function sndBoom() {
  const c = sndC(); if (!c || !sndOn) return
  try {
    const t = c.currentTime, len = Math.floor(c.sampleRate * 0.4)
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = c.createBufferSource(); src.buffer = buf
    const f = c.createBiquadFilter(); f.type = 'lowpass'
    f.frequency.setValueAtTime(500, t)
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.16)
    f.frequency.exponentialRampToValueAtTime(280, t + 0.38)
    const g = c.createGain(); g.gain.setValueAtTime(0.13, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    src.connect(f).connect(g).connect(c.destination); src.start(t)
  } catch {}
  tone(c, 150, 62, 0.45, 'sine', 0.2, 0.14)
}
// TO'LIQ EKRAN sovg'a — fozil fanfara (arpeggio + yulduz miltillashi)
function sndFanfare() {
  const c = sndC(); if (!c || !sndOn) return
  ;[523, 659, 784, 1047].forEach((f, i) => tone(c, f, f, 0.22, 'triangle', 0.11, i * 0.11))
  tone(c, 2093, 1568, 0.5, 'sine', 0.05, 0.46)
}
// Hayvon sovg'alari — o'ynoqi "boing"
function sndBoing() { const c = sndC(); if (!c || !sndOn) return; tone(c, 320, 165, 0.14, 'sine', 0.09) }
// Tomoshabin qo'shildi — yumshoq "salom"
function sndJoin() { const c = sndC(); if (!c || !sndOn) return; tone(c, 660, 660, 0.08, 'sine', 0.05); tone(c, 880, 880, 0.12, 'sine', 0.05, 0.09) }
// Yurak — juda jim pop (tez-tez bosilgani uchun)
function sndHeart() { const c = sndC(); if (!c || !sndOn) return; tone(c, 500, 900, 0.07, 'sine', 0.035) }
// Sovg'a ovoz routeri: daraja bo'yicha + hayvonlarga qo'shimcha "boing"
function sndGift(gid, cost) {
  const fx = giftFx(cost || giftById(gid)?.p || 0)
  if (fx === 'tk') return sndFanfare()
  if (fx === 'lg') return sndBoom()
  if (fx === 'md') { sndCoin(); if (giftById(gid)?.cat === 'ani') sndBoing(); return }
  sndPop()
}
async function updateGiftPanel(el) {
  const bal = qs('#lg-bal', el), daily = qs('#lg-daily', el)
  if (!bal) return
  await refreshWallet()
  if (WALLET) bal.innerHTML = `🪙 <b>${fmtN(WALLET.coins)}</b> coin`
  if (daily && WALLET) {
    const ready = WALLET.daily_left <= 0
    daily.innerHTML = ready ? '<button class="btn gh" id="lg-db">🎁 Kunlik bonus olish: +100 coin</button>' : `<small class="mut">Kunlik bonus: ${Math.ceil(WALLET.daily_left / 3600000)} soatdan yana</small>`
    const db = qs('#lg-db', daily)
    if (db) db.onclick = async () => { try { const r = await post('/wallet/daily'); toast('🎉 +' + r.added + ' coin!'); await refreshWallet(); updateGiftPanel(el) } catch (e) { toast('⚠️ ' + e.message) } }
  }
}
function liveUI(user, title, host) {
  const el = document.createElement('div')
  el.className = 'over live v2'
  el.innerHTML = `<video class="lv" autoplay playsinline ${host ? 'muted' : ''}></video>
    <div class="lhd"><div class="lh-u">${avHTML(user, 40, { noStory: true })}<div class="lh-t"><b>${esc(uname(user))}</b>${user.lvl ? `<span class="lvlbadge mini" style="background:linear-gradient(135deg,#a5d8ff,#4dabf7)">${user.lvl.emoji} ${esc(user.lvl.name)}</span>` : ''}</div></div><span class="lb">🔴 EFIR · <span class="lvc">0</span> 👁 · 🏆 <span class="lpk">0</span></span><button class="ic" data-lx>✕</button></div>
    ${host ? '<div class="learn">🪙 <b id="l-coins">0</b> coin · <small>tomoshabinlar sovg‘alari</small></div>' : ''}
    <div class="ltop" id="l-top"></div>
    ${host ? '' : '<div class="wait">⏳ Efirga ulanmoqda…</div>'}
    <div class="lcm"></div>
    <div class="lrail">
      <button class="rb" data-lh title="Yurak — +1 ball">❤️</button>
      <button class="rb gift" data-lg title="Sovg‘a yuborish">🎁</button>
      <button class="rb snd" data-lsnd title="Ovoz effektlari">${sndOn ? '🔊' : '🔇'}</button>
    </div>
    <div class="lbot"><input class="inp" maxlength="300" placeholder="Izoh yozing… +2 ball"><button class="cb" data-ls>➤</button>${host ? '<button class="cb" data-lf>🔄</button><button class="cb end" data-le>Tugatish</button>' : ''}</div>
    <div class="lgift hide" id="l-gift">
      <div class="lg-h"><b>🎁 Sovg‘a yuborish</b><span class="lg-bal" id="lg-bal">…</span><button class="ic" data-lgx>✕</button></div>
      <div class="gtabs"><button class="gt on" data-gt="pop">🔥 Mashhur</button><button class="gt" data-gt="ani">🐾 Hayvonlar</button><button class="gt" data-gt="mul">🎬 Multfilm</button></div>
      <div class="lg-daily" id="lg-daily"></div>
      <div class="lg-grid" id="lg-grid"></div>
      <div class="hint">Sovg‘a coin bilan olinadi — ketma-ket yuborsangiz COMBO 🔥, katta sovg‘a butun ekranni nur bilan to‘ldiradi!</div>
    </div>`
  document.body.appendChild(el)
  const inp = qs('.lbot input', el)
  const send = async (text, heart) => {
    if (!LIVE) return
    try {
      const r = await post(`/lives/${LIVE.id}/comment`, { text, heart })
      if (r && r.rewarded) ballFloat(el, heart ? '+1' : '+2')
    } catch (e) { toast('⚠️ ' + e.message) }
  }
  inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { send(inp.value.trim(), false); inp.value = '' } }
  qs('[data-ls]', el).onclick = () => { if (inp.value.trim()) { send(inp.value.trim(), false); inp.value = '' } }
  // TEZLIK: yurak spam'i DOM va serverni yuklamasin — 350ms'da bir marta so'rov, bosishlar ko'rinishi saqlanadi
  let lastHeartAt = 0
  qs('[data-lh]', el).onclick = () => { const t = Date.now(); if (t - lastHeartAt < 350) return; lastHeartAt = t; send('', true); heartBurst(el); sndHeart() }
  qs('[data-lx]', el).onclick = () => (host ? endLive() : leaveLive())
  const le = qs('[data-le]', el); if (le) le.onclick = endLive
  const lf = qs('[data-lf]', el); if (lf) lf.onclick = liveFlip
  // Ovoz effektlari yoqish/o'chirish (xotirada eslab qolinadi)
  qs('[data-lsnd]', el).onclick = () => { sndOn = !sndOn; try { localStorage.setItem('g50snd', sndOn ? '1' : '0') } catch {}; qs('[data-lsnd]', el).textContent = sndOn ? '🔊' : '🔇'; if (sndOn) sndPop() }
  // Sovg‘a paneli (TikTok-uslubi) — 26 sovg‘a 3 ta katrgoria tab’ida
  const gp = qs('#l-gift', el), grid = qs('#lg-grid', el)
  const renderGrid = (cat) => { grid.innerHTML = LIVE_GIFTS.filter((g) => g.cat === cat).map((g) => `<button class="gcard" data-g="${g.id}"><img src="${giftImg(g.id)}" alt="" loading="lazy"><b>${g.name}</b><span>🪙 ${g.p}</span></button>`).join('') }
  renderGrid('pop')
  qsa('.gt', el).forEach((b) => { b.onclick = () => { qsa('.gt', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); renderGrid(b.dataset.gt) } })
  qs('[data-lg]', el).onclick = () => { gp.classList.toggle('hide'); if (!gp.classList.contains('hide')) updateGiftPanel(el) }
  qs('[data-lgx]', el).onclick = () => gp.classList.add('hide')
  gp.onclick = async (e) => {
    const g = e.target.closest('[data-g]'); if (!g || !LIVE) return
    const gi = LIVE_GIFTS.find((x) => x.id === g.dataset.g)
    try {
      const r = await post(`/lives/${LIVE.id}/gift`, { gift: gi.id, n: 1 })
      gp.classList.add('hide')
      flyGift(el, gi.id, gi.name, S.me.first_name, gi.p)
      giftCombo(el, gi.id)
      sndGift(gi.id, gi.p)
      if (WALLET) WALLET.coins = r.coins
      toast(`🎁 ${gi.name} yuborildi — efirchi +${r.cost} ball oldi`)
    } catch (e2) { toast('⚠️ ' + e2.message) }
  }
  if (host) refreshWallet().then(() => { const c = qs('#l-coins', el); if (c && WALLET) c.textContent = fmtN(WALLET.coins) })
  return el
}
function liveComment(name, text, heart) {
  if (!LIVE) return
  if (heart) { const f = document.createElement('div'); f.className = 'fly'; f.textContent = '❤️'; LIVE.el.appendChild(f); setTimeout(() => f.remove(), 1500) }
  if (!text) return
  const box = qs('.lcm', LIVE.el)
  const d = document.createElement('div')
  d.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`
  box.appendChild(d)
  while (box.children.length > 30) box.firstChild.remove()
}
function liveSetCount(v) {
  if (!LIVE) return
  LIVE.viewers = v
  // Task 41: peak — efir davomida eng yuqori tomoshabinlar soni (🏆 bilan ko'rsatiladi)
  if (v > (LIVE.peak || 0)) LIVE.peak = v
  const c = qs('.lvc', LIVE.el); if (c) c.textContent = v
  const p = qs('.lpk', LIVE.el); if (p) p.textContent = LIVE.peak || 0
}
// Xabarni barcha "farzand" tomoshabinlarga uzatish
function liveRelay(msg) {
  const L = LIVE; if (!L) return
  const s = JSON.stringify(msg)
  for (const k of L.kids.values()) if (k.dc?.readyState === 'open') try { k.dc.send(s) } catch {}
}
// Efirchi tomoshabinlar sonini ko‘pi bilan 3 soniyada bir marta tarqatadi
function liveRelayCount() {
  const L = LIVE; if (!L?.host || L.nT) return
  L.nT = setTimeout(() => { L.nT = 0; if (LIVE === L) liveRelay({ t: 'n', v: L.viewers }) }, 3000)
}
function liveMsg(m) {
  if (!LIVE || !m) return
  if (m.t === 'c') liveComment(m.n, m.x, m.h)
  if (m.t === 'n') liveSetCount(m.v)
  if (m.t === 'g') { flyGift(LIVE.el, m.g, '×' + (m.gn || 1), m.n, m.cost); giftCombo(LIVE.el, m.g); sndGift(m.g, m.cost); liveTopAdd(m.n, m.cost || 0) }
  liveRelay(m)
  if (m.t === 'end') liveEnded()
}
function liveEnded() {
  const L = LIVE; if (!L || L.host) return
  LIVE = null
  clearTimeout(L.retry); clearTimeout(L.dropT); clearTimeout(L.connT)
  try { L.pc?.close() } catch {}
  for (const k of L.kids.values()) try { k.pc.close() } catch {}
  const w = document.createElement('div'); w.className = 'wait'; w.textContent = '⬛ Efir tugadi'; L.el.appendChild(w)
  setTimeout(() => L.el.remove(), 2000)
  loadLives()
}
function limitBitrate(pc, max) {
  const s = pc.getSenders().find((x) => x.track?.kind === 'video'); if (!s) return
  try {
    const p = s.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = max || 900000
    s.setParameters(p).catch(() => {})
  } catch {}
}
function startLive(chatId = 0) {
  if (LIVE || CALL) return toast('Avval joriy efir/qo‘ng‘iroqni tugating')
  LTOP.clear()
  const chans = [...S.chats.values()].filter((c) => c.type !== 'direct' && (c.role === 'owner' || c.role === 'admin'))
  const sh = sheet(h3('🔴 Jonli efir') + `<input class="inp" id="lv-t" maxlength="200" placeholder="Efir mavzusi">
    <label class="mut">Kimga ko‘rsatiladi</label><select class="inp" id="lv-c"><option value="0">👥 Kontaktlarim va suhbatdoshlarim</option>${chans.map((c) => `<option value="${c.id}" ${c.id === chatId ? 'selected' : ''}>${c.type === 'channel' ? '📢' : '👥'} ${esc(c.title)}</option>`).join('')}</select>
    <div class="hint">Tomoshabinlar soni cheklanmagan. Ular izoh/yurak bilan <b>ball yig‘adi</b>, sovg‘a yuborsa — sizga <b>coin</b> va <b>martaba</b> qo‘shiladi. 🎁</div><button class="btn big" id="lv-s">Efirni boshlash</button><button class="btn gh" id="lv-top" style="margin-top:8px">🏆 TOP efir reytingi</button>`)
  qs('#lv-top', sh).onclick = () => { closeSheet(sh); topLiveSheet() }
  qs('#lv-s', sh).onclick = async () => {
    const title = qs('#lv-t', sh).value.trim(), cid = +qs('#lv-c', sh).value
    closeSheet(sh)
    try {
      const stream = await getMedia(true)
      const r = await post('/lives', { title, chat_id: cid })
      LIVE = { id: r.id, host: true, stream, kids: new Map(), viewers: 0, peak: 0 }
      LIVE.el = liveUI(S.me, title, true)
      qs('.lv', LIVE.el).srcObject = stream
      toast('🔴 Efir boshlandi')
      sndFanfare()
    } catch (e) { toast('⚠️ ' + e.message) }
  }
}
async function liveFlip() {
  if (!LIVE?.host) return
  LIVE.facing = LIVE.facing === 'environment' ? 'user' : 'environment'
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: LIVE.facing } })
    const nt = s.getVideoTracks()[0]
    for (const k of LIVE.kids.values()) { const snd = k.pc.getSenders().find((x) => x.track?.kind === 'video'); if (snd) await snd.replaceTrack(nt) }
    LIVE.stream.getVideoTracks().forEach((t) => { t.stop(); LIVE.stream.removeTrack(t) })
    LIVE.stream.addTrack(nt)
    qs('.lv', LIVE.el).srcObject = LIVE.stream
  } catch { toast('Kamera almashtirilmadi') }
}
// Efirchi ham, tomoshabin ham o‘zidagi efirni yangi tomoshabinga uzatadi
async function addChild(uid) {
  const L = LIVE; if (!L || !L.stream || !L.stream.getTracks().length) return
  try { L.kids.get(uid)?.pc.close() } catch {}
  const k = { ice: [] }
  L.kids.set(uid, k)
  k.pc = await newPC((c) => sig(uid, { k: 'lice', live_id: L.id, c }))
  for (const t of L.stream.getTracks()) k.pc.addTrack(t, L.stream)
  k.dc = k.pc.createDataChannel('live')
  k.dc.onopen = () => { try { k.dc.send(JSON.stringify({ t: 'n', v: L.viewers || 0 })) } catch {} }
  // Task 34: efirchi tomonda ham watchdog — farzand PC 10s ichida ulanmasa ICE restart,
  // yana 10s da ulanmasa o‘chiriladi (tomoshabin o‘zi qayta ulanishni so‘raydi).
  k.pc.onconnectionstatechange = () => {
    const st = k.pc.connectionState
    if (st === 'connected') clearTimeout(k.watchT)
    if (['failed', 'closed'].includes(st) && L.kids.get(uid) === k) { clearTimeout(k.watchT); L.kids.delete(uid) }
  }
  k.watchT = setTimeout(() => {
    if (LIVE !== L || L.kids.get(uid) !== k || k.pc.connectionState === 'connected') return
    try { k.pc.restartIce() } catch {}
    setTimeout(() => {
      if (LIVE === L && L.kids.get(uid) === k && k.pc.connectionState !== 'connected') {
        try { k.pc.close() } catch {}
        if (L.kids.get(uid) === k) L.kids.delete(uid)
      }
    }, 10000)
  }, 10000)
  const o = await k.pc.createOffer()
  await k.pc.setLocalDescription(o)
  limitBitrate(k.pc)
  sig(uid, { k: 'loffer', live_id: L.id, sdp: k.pc.localDescription.toJSON() })
}
function armRetry(L) {
  clearTimeout(L.retry)
  L.retry = setTimeout(() => { if (LIVE === L && !L.gotUp) liveRejoin() }, 15000)
}
// Task 34 (QORA EKRAN ildizi): oldin ontrack kelganda .wait o‘chib retry BEKOR qilinardi —
// ICE keyin ulanmasa abadiy qora ekran (izoh/layk ishlayverardi, chunki ular HTTP orqali).
// Endi .wait haqiqiy 'connected' holatigacha ko‘rinadi va bosqichma-bosqich yangilanadi.
function liveWait(L, mode) {
  if (LIVE !== L || L.host) return
  let w = qs('.wait', L.el)
  if (mode === 'ok') { if (w) w.remove(); return }
  if (!w) { w = document.createElement('div'); w.className = 'wait'; L.el.appendChild(w) }
  const t = L.tries || 0
  if (t >= 4) {
    if (!qs('#l-retry', w)) {
      w.innerHTML = '🚫 Bu tarmoq efir oqimini o‘tkazmayapti — boshqa tarmoq (Wi-Fi / mobil) sinab ko‘ring<br><button class="btn big" id="l-retry">🔄 Qayta urinish</button>'
      const b = qs('#l-retry', w)
      if (b) b.onclick = (ev) => { ev.stopPropagation(); L.tries = 0; liveWait(L); liveRejoin() }
    }
  } else {
    w.textContent = t > 0 ? `📶 Ulanish sekin — qayta ulanmoqda… (${t})` : mode === 'media' ? '📶 Media ulanmoqda…' : '⏳ Efirga ulanmoqda…'
  }
}
async function watchLive(id) {
  if (LIVE) { if (LIVE.id === id) return; if (LIVE.host) return toast('Avval efiringizni tugating'); await leaveLive() }
  LTOP.clear()
  try {
    const r = await post(`/lives/${id}/join`)
    LIVE = { id, host: false, hostId: r.user.id, parentId: r.parent, ice: [], kids: new Map(), stream: new MediaStream(), viewers: r.viewers, peak: r.peak || 0, tries: 0 }
    LIVE.el = liveUI(r.user, r.title, false)
    // Task 41: hafta reytingida 1-o'rindagi efir — maxsus chip
    if (r.rank === 1 && r.peak > 0) { const t1 = document.createElement('div'); t1.className = 'ltop1'; t1.textContent = '🏆 HAFTANING TOP EFIRI'; LIVE.el.appendChild(t1) }
    liveSetCount(r.viewers)
    liveWait(LIVE)
    armRetry(LIVE)
  } catch (e) { toast('⚠️ ' + e.message); loadLives() }
}
// Yuqoridagi tomoshabin uzilsa — boshqasiga qayta ulanish (farzandlar ulanishda qoladi)
async function liveRejoin() {
  const L = LIVE; if (!L || L.host || L.rejoining) return
  L.rejoining = true
  const old = L.parentId
  clearTimeout(L.connT); clearTimeout(L.dropT)
  const pc = L.pc; L.pc = null; L.gotUp = false; L.ice = []
  try { pc?.close() } catch {}
  try {
    const r = await post(`/lives/${L.id}/join`, { exclude: old && old !== L.hostId ? [old] : [] })
    if (LIVE !== L) return
    L.parentId = r.parent
    L.tries++
    liveWait(L)
    armRetry(L)
  } catch (e) {
    if (LIVE === L && /tugagan/i.test(e.message || '')) liveEnded()
    else if (LIVE === L) armRetry(L)
  } finally { L.rejoining = false }
}
// Tomoshabin videosini ishga tushirish (Task 33 — QORA EKRAN tuzatuvi).
// Sabab: tomoshabin videosi OVOZLI (muted emas). Tracklar kelganda foydalanuvchining
// dastlabki bosishi "tugagan" bo'ladi — brauzer autoplay siyosati play()ni bloklaydi
// va .catch(() => {}) buni jim yutib yuborardi → video abadiy to'xtab qolarardi
// (qora ekran), izoh/sovg'a/layk esa ishlab turardi. Yechim: bloklansa — jim (muted)
// boshlaymiz va "🔊 Ovozni yoqish" tugmasi chiqaramiz (bitta bosishda ovoz tiklanadi).
function livePlay(L) {
  const v = qs('.lv', L.el); if (!v) return
  if (v.srcObject !== L.stream) v.srcObject = L.stream
  let p; try { p = v.play() } catch (e) { p = null }
  if (p && p.catch) p.catch(() => {
    if (v.muted) return
    v.muted = true
    try { const q = v.play(); if (q && q.catch) q.catch(() => {}) } catch {}
    let un = qs('.l-un', L.el)
    if (!un) {
      un = document.createElement('button')
      un.className = 'l-un'
      un.type = 'button'
      un.textContent = '🔊 Ovozni yoqish'
      un.onclick = (ev) => { ev.stopPropagation(); v.muted = false; try { v.play() } catch {} un.remove() }
      L.el.appendChild(un)
    }
  })
}
function onUpTrack(L, e) {
  if (LIVE !== L) return
  const tr = e.track
  for (const t of L.stream.getTracks()) if (t.kind === tr.kind && t !== tr) L.stream.removeTrack(t)
  if (!L.stream.getTracks().includes(tr)) L.stream.addTrack(tr)
  // Yangi manbadan kelgan treklarni farzandlarga ham almashtirib beramiz
  for (const k of L.kids.values()) { const s = k.pc.getSenders().find((x) => x.track?.kind === tr.kind); if (s && s.track !== tr) s.replaceTrack(tr).catch(() => {}) }
  livePlay(L)
  L.gotUp = true; clearTimeout(L.retry)
  // Task 34: .wait shu yerda O‘CHMAYDI — ontrack SDP bosqichida keladi, ICE hali ulanmagan
  // bo‘lishi mumkin. Oyna faqat haqiqiy 'connected' da o‘chadi (pastda onconnectionstatechange).
  liveWait(L, L.pc && L.pc.connectionState === 'connected' ? 'ok' : 'media')
  if (!L.ready && L.stream.getVideoTracks().length) { L.ready = true; post(`/lives/${L.id}/ready`).catch(() => {}) }
}
async function leaveLive() {
  const L = LIVE; if (!L) return
  LIVE = null
  clearTimeout(L.retry); clearTimeout(L.dropT); clearTimeout(L.connT)
  try { L.pc?.close() } catch {}
  for (const k of L.kids.values()) try { k.pc.close() } catch {}
  L.el.remove()
  await post(`/lives/${L.id}/leave`).catch(() => {})
}
async function endLive() {
  const L = LIVE; if (!L) return
  if (!(await confirmBox('Efirni tugatasizmi?', 'Tugatish'))) return
  liveRelay({ t: 'end' })
  LIVE = null
  clearTimeout(L.nT)
  setTimeout(() => { for (const k of L.kids.values()) try { k.pc.close() } catch {} }, 800)
  L.stream.getTracks().forEach((t) => t.stop())
  L.el.remove()
  try { const r = await post(`/lives/${L.id}/end`); toast(r.record && r.peak ? `🏆 REKORD — ${r.peak} tomoshabin! Yangi balandlik!` : `Efir tugadi · ${r.viewers || 0} tomoshabin`) } catch {}
  loadLives()
}
// Task 41: TOP efir reytingi oynasi — haftaning eng ko'p tomoshabin yig'gan 10 efiri
async function topLiveSheet() {
  const sh = sheet(h3('🏆 TOP efir — hafta reytingi') + '<div class="tl-list"><div class="tl-empty">⏳ Yuklanmoqda…</div></div>')
  try {
    const rows = await api('/lives/top')
    const box = qs('.tl-list', sh)
    if (!rows.length) box.innerHTML = '<div class="tl-empty">Hali reyting bo‘sh — birinchi bo‘lib rekord o‘rnating! 🔴</div>'
    else box.innerHTML = rows.map((r) => `<div class="tl-row${r.live ? ' now' : ''}"${r.live ? ` data-tl="${r.id}"` : ''}><span class="tl-pos ${r.pos <= 3 ? 'p' + r.pos : ''}">${['🥇', '🥈', '🥉'][r.pos - 1] || r.pos}</span>${avHTML(r.user, 44, { noStory: true })}<div class="tl-mid"><b>${esc(uname(r.user))}${r.user && r.user.lvl ? ` <span class="lvlbadge mini" style="background:linear-gradient(135deg,#a5d8ff,#4dabf7)">${r.user.lvl.emoji} ${esc(r.user.lvl.name)}</span>` : ''}</b><small>${esc(r.title || 'Efir')} · ${r.live ? '<i class="tl-on">🔴 jonli hozir</i>' : new Date(r.started_at).toLocaleDateString()}</small></div><div class="tl-n">👁 <b>${fmtN(r.peak)}</b></div></div>`).join('')
    box.onclick = (e) => { const row = e.target.closest('[data-tl]'); if (!row) return; closeSheet(sh); watchLive(+row.dataset.tl) }
  } catch (e) { const b = qs('.tl-list', sh); if (b) b.innerHTML = '<div class="tl-empty">⚠️ Yuklanmadi — keyinroq urinib ko‘ring</div>' }
}
async function liveSignal(from, d) {
  const L = LIVE
  if (!L || L.id !== d.live_id) return
  try {
    const k = L.kids.get(from)
    if (k && from !== L.parentId) {
      if (d.k === 'lanswer') { await k.pc.setRemoteDescription(d.sdp); for (const c of k.ice.splice(0)) await k.pc.addIceCandidate(c).catch(() => {}) }
      if (d.k === 'lice') { if (k.pc.remoteDescription) await k.pc.addIceCandidate(d.c).catch(() => {}); else k.ice.push(d.c) }
      return
    }
    if (L.host || from !== L.parentId) return
    if (d.k === 'loffer') {
      const old = L.pc; L.pc = null; L.ice = []
      try { old?.close() } catch {}
      clearTimeout(L.connT); clearTimeout(L.dropT)
      const pc = await newPC((c) => sig(from, { k: 'lice', live_id: L.id, c }))
      L.pc = pc
      pc.ontrack = (e) => onUpTrack(L, e)
      pc.ondatachannel = (e) => { e.channel.onmessage = (m) => { try { liveMsg(JSON.parse(m.data)) } catch {} } }
      pc.onconnectionstatechange = () => {
        if (L.pc !== pc || LIVE !== L) return
        const st = pc.connectionState
        if (st === 'connected') {
          // Task 34: haqiqiy ulanish — holat oynasi o‘chadi, watchdoglar to‘xtaydi, video o‘ynaydi
          clearTimeout(L.connT)
          L.tries = 0; L.gotUp = true
          liveWait(L, 'ok')
          livePlay(L)
        }
        else if (st === 'failed') { clearTimeout(L.connT); liveRejoin() }
        else if (st === 'disconnected') { clearTimeout(L.dropT); L.dropT = setTimeout(() => { if (L.pc === pc && pc.connectionState !== 'connected') liveRejoin() }, 5000) }
      }
      await pc.setRemoteDescription(d.sdp)
      for (const c of L.ice.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      const a = await pc.createAnswer()
      await pc.setLocalDescription(a)
      sig(from, { k: 'lanswer', live_id: L.id, sdp: pc.localDescription.toJSON() })
      // Task 34: ULANISH WATCHDOG — javob yuborilgach 12s ichida 'connected' bo‘lmasa,
      // yangi ota bilan qayta ulanamiz (eski yo‘nalish o‘lgan bo‘lishi mumkin).
      clearTimeout(L.connT)
      L.connT = setTimeout(() => { if (LIVE === L && L.pc === pc && pc.connectionState !== 'connected') liveRejoin() }, 12000)
    }
    if (d.k === 'lice') { if (L.pc?.remoteDescription) await L.pc.addIceCandidate(d.c).catch(() => {}); else L.ice.push(d.c) }
  } catch (e) { console.warn('live', e) }
}
on('live_join', (ev) => {
  const L = LIVE; if (!L || L.id !== ev.live_id) return
  if (L.host) { liveSetCount(ev.viewers); liveComment(ev.from.first_name, 'qo‘shildi 👋'); sndJoin(); liveRelayCount() }
  if (ev.parent !== false) addChild(ev.from.id)
})
on('live_leave', (ev) => {
  const L = LIVE; if (!L?.host || L.id !== ev.live_id) return
  liveSetCount(ev.viewers); liveRelayCount()
  const k = L.kids.get(ev.from); if (k) { try { k.pc.close() } catch {} L.kids.delete(ev.from) }
})
on('live_rejoin', (ev) => { const L = LIVE; if (L && !L.host && L.id === ev.live_id && ev.from === L.parentId) liveRejoin() })
on('live_comment', (ev) => {
  const L = LIVE; if (!L?.host || L.id !== ev.live_id) return
  liveComment(ev.from.first_name, ev.text, ev.heart)
  liveRelay({ t: 'c', n: ev.from.first_name, x: ev.text, h: ev.heart })
})
on('live_gift', (ev) => {
  const L = LIVE; if (!L || !L.host || L.id !== ev.live_id) return
  flyGift(L.el, ev.gift, '×' + (ev.n || 1), ev.from?.first_name, ev.cost)
  giftCombo(L.el, ev.gift)
  sndGift(ev.gift, ev.cost)
  liveTopAdd(ev.from?.first_name, ev.cost || 0)
  const c = qs('#l-coins', L.el); if (c) c.textContent = fmtN(ev.host_coins || 0)
  // Barcha tomoshabinlarga ham ko‘rinsin — daraxt bo‘ylab
  liveRelay({ t: 'g', n: ev.from?.first_name, g: ev.gift, gn: ev.n, cost: ev.cost })
})
on('live_end', (ev) => { if (LIVE && LIVE.id === ev.live_id && !LIVE.host) { liveRelay({ t: 'end' }); liveEnded() } })
window.addEventListener('beforeunload', () => { if (CALL) endCall('ended', true); if (LIVE && !LIVE.host) fetch(`${API}/lives/${LIVE.id}/leave`, { method: 'POST', keepalive: true, headers: { authorization: 'Bearer ' + S.token } }) })
