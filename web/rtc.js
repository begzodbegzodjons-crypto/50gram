/* 50 Gram — audio/video qo'ng'iroqlar va jonli efir (WebRTC) */
'use strict'
let iceCache = null, iceAt = 0
async function iceServers(force) {
  // KESH 10 daqiqa (avval 30): TURN cred kvotasi/muddati tugasa ham tez tiklanadi —
  // 'failed' holatida force bilan DARHOL yangi creds olinadi.
  if (!force && iceCache && Date.now() - iceAt < 10 * 60000) return iceCache
  try { iceCache = (await api('/ice')).iceServers; iceAt = Date.now() } catch { iceCache = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] }
  // Task 34: openrelay.metered.ca o‘lgan (sinovda 400 TURN allocate error) — soxta zaxira olib tashlandi.
  // Serverda Cloudflare TURN sozlangan (/ice → turn.cloudflare.com UDP/TCP/TLS-443, TTL 24h) — relay test o‘tdi.
  // TURN bo‘lmasa ham soxta TURN BERMAYMIZ: ulanmasa tomoshabin watchdog‘i aniq holat ko‘rsatadi.
  return iceCache
}
const sig = (to, data) => post('/signal', { to, data }).catch(() => {})
async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Brauzer qo‘ng‘iroqni qo‘llamaydi (HTTPS kerak)')
  // APK: OS darajasidagi kamera/mikrofon ruxsat kafolati — WebView ichki ruxsati
  // tushib qolgan bo‘lsa ham haqiqiy Android ruxsat oynasi chiqadi (Android50.ensurePerms)
  try {
    if (window.Android50 && typeof window.Android50.ensurePerms === 'function') {
      window.Android50.ensurePerms()
      await new Promise((r) => setTimeout(r, 380)) // OS oynasi chiqishi/javob berishiga ozgina vaqt
    }
  } catch {}
  const con = { audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false }
  let last = null
  for (let i = 0; i < 2; i++) {
    let got = null
    try {
      // MUHIM: getUserMedia ba'zi qurilmalarda (WebView ruxsati bekorga qolganda) ABADIY osilib qoladi —
      // 12s watchdog: osilib qolsa aniq xato bilan yopiladi, «Ulanmoqda…» cheksiz qolmaydi
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(con).then((s) => { got = s; return s }),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('hang'), { name: 'MediaHangError' })), 12000)),
      ])
    } catch (e) {
      last = e
      try { if (got) got.getTracks().forEach((t) => t.stop()) } catch {} // kechikkan oqim sizhtirmasligi uchun
      if (e && e.name === 'MediaHangError') break // qayta urinishning ma'nosi yo'q — osilib qolgan
      if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) throw new Error(video ? 'Kamera topilmadi' : 'Mikrofon topilmadi')
      if (e && (e.name === 'NotReadableError' || e.name === 'AbortError')) { await new Promise((r) => setTimeout(r, 450)); continue } // qurilma band — bir marta qayta urinamiz
      break
    }
  }
  // MUHIM: Chrome ruxsat bir marta rad etilsa boshqa hech qachon oyna ko'rsatmaydi —
  // shuning uchun foydalanuvchiga aniq yo'nalish beramiz (🔒 belgi orqali yoqish)
  if (last && (last.name === 'NotAllowedError' || last.name === 'SecurityError')) {
    throw new Error('Kamera va mikrofonga ruxsat berilmagan — Sozlamalarda ilova ruxsatlaridan Kamera va Mikrofoni yoqing')
  }
  if (last && last.name === 'MediaHangError') {
    throw new Error('Kamera javob bermadi — ilovani to‘liq yopib qayta oching, so‘ng Sozlamalardan Kamera/Mikrofon ruxsatini tekshiring')
  }
  throw new Error(video ? 'Kamera/mikrofon ochilmadi — qayta urinib ko‘ring' : 'Mikrofon ochilmadi — qayta urinib ko‘ring')
}
// ---------------- AVTOMATIK RUXSAT (brauzer/PWA) ----------------
// Bir marta ruxsat berilsa — keyingi barcha qo'ng'iroqlar, ovozli/video xabarlar va
// jonli efir HECH QANDAY oynasiz ishlaydi (brauzer ruxsatni eslab qoladi). Ruxsat hali
// so'ralmagan bo'lsa — birinchi bosishda bir marta so'raymiz; rad etilgan bo'lsa zeriktirmaymiz.
window.__50warmup = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return
  let cam = null, mic = null
  try { cam = await navigator.permissions.query({ name: 'camera' }) } catch {}
  try { mic = await navigator.permissions.query({ name: 'microphone' }) } catch {}
  if ((cam && cam.state === 'denied') || (mic && mic.state === 'denied')) return
  if (cam && mic && cam.state === 'granted' && mic.state === 'granted') return
  document.addEventListener('pointerdown', () => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 640 } } })
      .then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {})
  }, { once: true })
}
async function newPC(onIce) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() })
  pc.onicecandidate = (e) => e.candidate && onIce(e.candidate.toJSON())
  return pc
}

// ---------------- Qo'ng'iroqlar ----------------
let CALL = null
// ISHONCHLI SIGNAL: avvalgi sig() xatoni JIM yutardi — 'accept'/'offer'/'answer' yo'qolsa
// qo'ng'iroq ABADIY «Ulanmoqda…» da qolardi (aynan foydalanuvchi shikoyati). Endi 3 martagacha
// qayta uriniladi; muhim signallarda natija tekshiriladi — yetmasa qo'ng'iroq aniq xato bilan yopiladi.
async function sigTo(to, data, tries = 3, gap = 700) {
  for (let i = 0; i < tries; i++) {
    try { await post('/signal', { to, data }); return true }
    catch (e) { if (i < tries - 1) await new Promise((r) => setTimeout(r, gap)) }
  }
  return false
}
// ULANISH QOROVULI: qabul qilingach ikkala tomonda ham taymer bor — 25s'da ulanmasa ICE
// restart (yangi tarmoq yo'li), 45s'da ham ulanmasa ANIQ xato bilan yopiladi.
// Avval: qabul qiluvchida umuman taymer yo'q edi, chaqiruvchiki 'accept' kelishi bilan o'chardi.
function armConnectWatchdog(C) {
  clearTimeout(C.connWatch); clearTimeout(C.connWatch2)
  C.connWatch = setTimeout(() => {
    if (CALL !== C || C.started || !C.pc || C.pc.connectionState === 'connected' || C.pc.connectionState === 'closed') return
    restartIce(C, true) // tarmoq yo'li ishlamayapti — YANGI TURN creds bilan qayta urinamiz
  }, 25000)
  C.connWatch2 = setTimeout(() => {
    if (CALL !== C || C.started) return
    endCall('missed', true, 'Ulanib bo‘lmadi — internetni tekshirib, qayta urinib ko‘ring')
  }, 45000)
}
// SVG ikonkalar — har bir qurilmada aniq ko'rinadi (emoji o'rniga)
const IC = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor" style="transform:rotate(135deg)"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5a3 3 0 0 0-6 0v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52a5 5 0 0 1-5-5H5a7 7 0 0 0 6 6.92V21h2v-3.08c.96-.14 1.86-.49 2.65-.98L19.73 21 21 19.73 4.27 3z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg>',
  spk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 5h-3.17L15 3H9L7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-8 13a5 5 0 1 1 5-5c0 .72-.16 1.4-.43 2.02L18 13.5v5h-5l1.48-1.48c-.62.27-1.3.43-2.02.43z" transform="scale(0.9) translate(1.3,1.3)"/><path d="M12 8.5a4.5 4.5 0 1 0 4.5 4.5H12V8.5z" opacity="0"/></svg>'
}
function callUI(peer, video, state) {
  const el = document.createElement('div')
  el.className = 'over call' + (video ? ' vid' : '')
  // OVOZ (tuzatildi — «qarshi tomon ovozi kelmayapti»): ovoz FAQAT .ra audio elementdan
  // chiqadi, .remote video esa TILLANGAN (faqat rasm). Sabablar: 1) ikkala element ham
  // ovoz chiqarsa — takrorlangan/echo ovoz; 2) ayrim qurilmalarda (WebView) video element
  // WebRTC ovozini o'zi o'ynatmaydi — aynan shu «ovoz kelmaydi» ildizi. .ra har qurilmada
  // ishonchli, «Dinamik» tugmasi ham endi rostan ovozni boshqaradi.
  el.innerHTML = `<video class="remote" autoplay playsinline muted></video><video class="local" autoplay playsinline muted></video><audio class="ra" autoplay></audio>
    <div class="cinfo">${avHTML(peer, 120, { noStory: true })}<h2>${esc(uname(peer))}</h2><div class="cst">${state}</div></div>
    <div class="cbar"></div>`
  document.body.appendChild(el)
  return el
}
function callButtons(kind) {
  const b = qs('.cbar', CALL.el)
  const wrap = (cls, icon, label, act) => `<div class="cbtn ${cls}"><button class="cb ${cls}" data-c="${act}">${icon}</button><span>${label}</span></div>`
  if (kind === 'incoming') {
    b.innerHTML = wrap('end', IC.end, 'Rad etish', 'decline') + wrap('ok', CALL.video ? IC.cam : IC.phone, 'Javob berish', 'accept')
  } else {
    b.innerHTML = `<div class="cbtn mic"><button class="cb" data-c="mic">${IC.mic}</button><span>Mikrofon</span></div>`
      + (CALL.video ? `<div class="cbtn cam"><button class="cb" data-c="cam">${IC.cam}</button><span>Kamera</span></div><div class="cbtn"><button class="cb" data-c="flip">${IC.flip}</button><span>Almashtirish</span></div>` : `<div class="cbtn spk"><button class="cb" data-c="spk">${IC.spk}</button><span>Dinamik</span></div>`)
      + wrap('end', IC.end, 'Tugatish', 'hang')
  }
  b.onclick = (e) => {
    const t = e.target.closest('[data-c]')
    const k = t?.dataset.c; if (!k) return
    if (k === 'accept') acceptCall()
    if (k === 'decline') endCall('declined', true)
    if (k === 'hang') endCall('ended', true)
    if (k === 'mic') { const tr = CALL.local?.getAudioTracks()[0]; if (tr) { tr.enabled = !tr.enabled; t.classList.toggle('off', !tr.enabled); t.innerHTML = tr.enabled ? IC.mic : IC.micOff } }
    if (k === 'cam') { const tr = CALL.local?.getVideoTracks()[0]; if (tr) { tr.enabled = !tr.enabled; t.classList.toggle('off', !tr.enabled); t.innerHTML = tr.enabled ? IC.cam : IC.camOff } }
    if (k === 'flip') flipCam()
    if (k === 'spk') { const a = qs('.ra', CALL.el); a.muted = !a.muted; t.classList.toggle('off', a.muted) }
  }
}
const setCallState = (t) => CALL && (qs('.cst', CALL.el).textContent = t)
async function callUser(uid, video) {
  if (CALL) return toast('Siz allaqachon qo‘ng‘iroqdasiz')
  if (uid === S.me.id) return
  let peer = S.users.get(uid)
  if (!peer) try { peer = await api('/users/' + uid); S.users.set(uid, peer) } catch (e) { return toast('⚠️ ' + e.message) }
  CALL = { peer, video: !!video, outgoing: true, ice: [], el: callUI(peer, video, 'Ulanmoqda…') }
  startSigPoll() // qo'ng'iroq davomida navbat-polling: WS zombi bo'lsa ham signallar yetadi
  callButtons('active')
  ringTone(true) // JIRINGLASH DARHOL: tarmoq javobini kutmasdan — bosgan paytdanoq eshitiladi
  try {
    CALL.local = await getMedia(video)
    qs('.local', CALL.el).srcObject = CALL.local
    const r = await post('/calls', { to: uid, video: !!video })
    if (!CALL) return
    CALL.id = r.call_id
    setCallState('Chaqirilmoqda…')
    CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', true, 'Javob bermadi'), 75000)
  } catch (e) {
    // XATO KO‘RINADIGAN bo‘lsin: nima uchun kamera ochilmaganini qo‘ng‘iroq oynasida ham ko‘rsatamiz
    try { if (CALL) setCallState('⚠️ ' + e.message) } catch {}
    toast('⚠️ ' + e.message)
    endCall('ended', !!CALL?.id, '⚠️ ' + e.message)
  }
}
// ---------------- FON REJIMIDA QO'NG'IROQ ----------------
// APK (native WebView): window.Android50 bridge — to'liq ekran qo'ng'iroq bildirishnomasi (Javob berish/Rad etish)
// PWA: sw.js qo'ng'iroq bildirishnomasi ko'rsatadi (push call payload).
// WS uzilgan bo'lsa: ulanganda /calls/pending orqali "ringing" qo'ng'iroq qayta o'ynatiladi.
const nativeCall = () => (window.Android50 && typeof window.Android50.callIncoming === 'function') ? window.Android50 : null
const nativeCallCancel = () => { try { window.Android50 && window.Android50.callStarted && window.Android50.callStarted() } catch {} }
let pendingNativeCall = null
window.__50call = (act, id) => {
  const ev = pendingNativeCall
  if (act === 'answer') {
    pendingNativeCall = null
    if (ev && !CALL) { incomingCall(ev); acceptCall(); return } // UI hali yaratilmagan (fon rejimi) — yaratamiz
    if (CALL && String(CALL.id) === String(id)) { nativeCallCancel(); acceptCall(); return }
    // Bildirishnoma orqali javob, lekin JS hodisani olmagan (WS o'lgan/fon) — qo'ng'iroqni serverdan olamiz
    nativeCallCancel()
    api('/calls/pending').then((r) => {
      if (r && r.call && !CALL) { incomingCall({ call_id: r.call.call_id, video: r.call.video, from: r.call.from }); acceptCall() }
      else if (!CALL) post(`/calls/${id}/status`, { status: 'declined' }).catch(() => {})
    }).catch(() => { toast('Qo‘ng‘iroqqa ulanolmadik — internetni tekshiring') })
  } else if (act === 'decline') {
    pendingNativeCall = null
    nativeCallCancel()
    if (CALL && String(CALL.id) === String(id)) endCall('declined', true)
    else post(`/calls/${id}/status`, { status: 'declined' }).catch(() => {})
  }
}
document.addEventListener('visibilitychange', () => {
  // Foydalanuvchi bildirishnomani emas, ilovani o'zi ochgan bo'lsa — qo'ng'iroq oynasini ko'rsatamiz
  if (!document.hidden && pendingNativeCall && !CALL) {
    const ev = pendingNativeCall
    pendingNativeCall = null
    incomingCall(ev)
  }
  // APK/PWA fonga kirib-chiqqanda WebView mediani to'xtatishi mumkin — qo'ng'iroq ovozini
  // va rasmni qayta ishga tushiramiz (aks holda qo'ng'iroq «qotib qoldi»day tuyuladi)
  if (!document.hidden && CALL) { try { playRemote(CALL) } catch {} }
})
function incomingCall(ev) {
  if (CALL) { sig(ev.from.id, { k: 'busy', call_id: ev.call_id }); return }
  // FON REJIMIDA (APK): sahifa yashirin bo'lsa — native to'liq ekran qo'ng'iroq oynasi (tugmalar bilan)
  const nb = nativeCall()
  if (nb && document.hidden) {
    pendingNativeCall = ev
    try { nb.callIncoming(JSON.stringify({ id: ev.call_id, name: uname(ev.from), video: !!ev.video })) } catch {}
    return
  }
  S.users.set(ev.from.id, { ...(S.users.get(ev.from.id) || {}), ...ev.from })
  const peer = S.users.get(ev.from.id)
  CALL = { id: ev.call_id, peer, video: !!ev.video, outgoing: false, ice: [], el: callUI(peer, ev.video, ev.video ? 'Video qo‘ng‘iroq…' : 'Qo‘ng‘iroq…') }
  startSigPoll() // qo'ng'iroq davomida navbat-polling: WS zombi bo'lsa ham signallar yetadi
  CALL.el.classList.add('incoming')
  callButtons('incoming')
  ringTone(true)
  vibrate([400, 200, 400, 200, 400])
  notifyLocal('📞 ' + uname(peer), ev.video ? 'Video qo‘ng‘iroq' : 'Ovozli qo‘ng‘iroq')
  nativeCallCancel() // APK: agar native bildirishnoma chiqqan bo'lsa — endi UI bor, yopamiz
  CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', false), 75000)
}
on('call', incomingCall)
// WS qayta ulanganda: WS uzilgan paytda kelgan qo'ng'iroq bo'lsa — darhol qo'ng'iroq oynasi
window.__50wsOpen = async () => {
  // MUHIM: qo'ng'iroq davomida (CALL bor) HAM davom etish kerak — avvalgi `if (CALL) return`
  // tufayli offer qayta yuborish O'LIK KOD edi (aynan kerak bo'lgan paytida ishlamardi).
  if (!CALL && !pendingNativeCall) {
    try {
      const r = await api('/calls/pending')
      if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, from: r.call.from })
    } catch {}
  }
  // QO'NG'IROQ davomida WS qayta ulandi va hali ulanmagan bo'lsa — offer qayta yuboriladi
  // (uzilish paytida yo'qolgan offer/answer tufayli «Ulanmoqda…» da osilib qolmaslik uchun)
  try { if (CALL && !CALL.started && CALL.pc && CALL.pc.localDescription) restartIce(CALL) } catch {}
  // WS tiklanganda navbatdagi signallarni ham o'qib olamiz (uzilish paytida yig'ilganlari)
  try { drainSigQueue() } catch {}
  // Task 34: WS uzilib-tiklanganda efir signalari (offer/ICE) YO‘QOLGAN bo‘lishi mumkin —
  // tomoshabin hali ulanmagan bo‘lsa darhol qayta ulanishni so‘raymiz.
  const L = LIVE
  if (L && !L.host && !L.rejoining && (!L.pc || L.pc.connectionState !== 'connected')) liveRejoin()
}
async function acceptCall() {
  const C = CALL; if (!C) return
  ringTone(false); clearTimeout(C.timeout)
  setCallState('Ulanmoqda…')
  callButtons('active')
  try {
    C.local = await getMedia(C.video)
    qs('.local', C.el).srcObject = C.local
    await setupPC(C)
    // 'accept' yo'qolsa chaqiruvchi hech qachon offer yaratmaydi — 5 marta/1.2s (≈6s qamrov)
    const ok = await sigTo(C.peer.id, { k: 'accept', call_id: C.id }, 5, 1200)
    if (!ok) return endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
    armConnectWatchdog(C) // 45s ichida ulanmasa — aniq xato (abadiy «Ulanmoqda…» yo‘q)
    post(`/calls/${C.id}/status`, { status: 'active' }).catch(() => {})
  } catch (e) {
    try { if (CALL) setCallState('⚠️ ' + e.message) } catch {}
    toast('⚠️ ' + e.message)
    endCall('declined', true, '⚠️ ' + e.message)
  }
}
// QARSHI TOMON MEDIASINI O'YNATISH — «ovoz kelmayapti» tuzatuvi (jonli efirdagi livePlay bilan
// bir xil isbotlangan yondashuv). autoplay atributi yolg'iz yetarli emas: srcObject ontrack
// ichida KEYINROQ o'rnatiladi — ba'zi brauzer/WebView'lar play()ni bloklaydi va jim qoladi.
// Bloklansa — tillangan holda o'ynatamiz va birinchi bosishda ovozni qaytaramiz.
function playRemote(C) {
  if (!C?.el || CALL !== C) return
  const v = qs('.remote', C.el), a = qs('.ra', C.el)
  if (!a) return
  try { a.muted = false; a.volume = 1 } catch {}
  let p; try { p = a.play() } catch (e) { p = null }
  if (p && p.catch) p.catch(() => {
    if (a.muted) return
    a.muted = true
    try { const q = a.play(); if (q && q.catch) q.catch(() => {}) } catch {}
    document.addEventListener('pointerdown', () => { if (CALL === C) { try { a.muted = false; a.play().catch(() => {}) } catch {} } }, { once: true })
  })
  try { if (v && v.paused) v.play().catch(() => {}) } catch {}
}
async function setupPC(C) {
  C.pc = await newPC((c) => sig(C.peer.id, { k: 'ice', call_id: C.id, c }))
  for (const t of C.local.getTracks()) C.pc.addTrack(t, C.local)
  // TEZLIK/SIFAT: video yuborish 900 kbit bilan cheklanadi (jonli efirdagi bilan bir xil) —
  // cheksiz 720p kuchsiz tarmoqda tarmoqni to'ldi: video QOTARDI, ovoz bo'linardi.
  limitBitrate(C.pc)
  C.pc.ontrack = (e) => {
    const st = e.streams[0] || new MediaStream([e.track])
    qs('.remote', C.el).srcObject = st
    qs('.ra', C.el).srcObject = st
    if (e.track.kind === 'audio' && !e.track.onunmute) e.track.onunmute = () => playRemote(C) // ovoz treki jonlanganda ham o'ynatamiz
    if (C.video) C.el.classList.add('live')
    playRemote(C)
  }
  C.pc.onconnectionstatechange = () => {
    const s = C.pc.connectionState
    if (s === 'connected') {
      clearTimeout(C.dropT) // qayta ulandi — qotish qorovulini to'xtat
      playRemote(C)
      if (!C.started) {
        C.started = Date.now()
        clearTimeout(C.timeout); clearTimeout(C.connWatch); clearTimeout(C.connWatch2)
        C.tick = setInterval(() => setCallState(fmtDur((Date.now() - C.started) / 1000)), 1000)
        if (C.video) qs('.cinfo', C.el).classList.add('mini')
      }
    }
    if (s === 'disconnected') {
      // QOTISHNING ILDIZI: avval faqat MATN chiqarilardi — hech narsa qayta ulamasdi va
      // qo'ng'iroq ABADIY muzlab qolardi (aynan foydalanuvchi shikoyati). Endi 3s ichida
      // o'zi tiklanmasa — ICE restart (yangi yo'l + yangi TURN creds), ikkala tomonda ham.
      setCallState('Aloqa uzildi, qayta ulanmoqda…')
      clearTimeout(C.dropT)
      C.dropT = setTimeout(() => {
        if (CALL !== C || !C.pc || C.pc.connectionState === 'connected' || C.restaring) return
        C.restaring = true
        Promise.resolve(restartIce(C, true)).catch(() => {}).finally(() => { C.restaring = false })
      }, 3000)
    }
    if (s === 'failed') {
      // ULANMADI: ikkala tomonda ham qayta urinish — avval YANGI ICE konfiguratsiyasi (TURN
      // creds tiklanadi), keyin ICE restart (2 martagacha), bo'lmasa aniq xato.
      // Avval faqat chaqiruvchi 1 marta urinardi, qabul qiluvchi umuman jim qolardi.
      C.iceTries = (C.iceTries || 0) + 1
      if (C.iceTries <= 2 && !C.restaring) {
        C.restaring = true
        setCallState('Qayta ulanmoqda…')
        Promise.resolve(restartIce(C, true)).catch(() => {}).finally(() => { C.restaring = false })
      } else if (!C.started) endCall('missed', true, 'Aloqa yo‘q — internetni tekshirib, qayta urinib ko‘ring')
    }
  }
}
async function restartIce(C, fresh) {
  try {
    // fresh: tarmoq yo'li ishlamayotgan bo'lsa — yangi TURN creds olib konfiguratsiyani
    // yangilaymiz (Cloudflare TURN cred muddati/kvotasi tugagan bo'lishi mumkin).
    if (fresh) { try { const srv = await iceServers(true); C.pc.setConfiguration?.({ iceServers: srv }) } catch {} }
    const o = await C.pc.createOffer({ iceRestart: true }); await C.pc.setLocalDescription(o); sig(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON() })
  } catch {}
}
async function flipCam() {
  const C = CALL; if (!C?.local) return
  C.facing = C.facing === 'environment' ? 'user' : 'environment'
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: C.facing } })
    const nt = s.getVideoTracks()[0]
    const snd = C.pc?.getSenders().find((x) => x.track?.kind === 'video')
    if (snd) await snd.replaceTrack(nt)
    C.local.getVideoTracks().forEach((t) => { t.stop(); C.local.removeTrack(t) })
    C.local.addTrack(nt)
    qs('.local', C.el).srcObject = C.local
  } catch { toast('Kamera almashtirilmadi') }
}
async function flushIce(C) { for (const c of C.ice.splice(0)) try { await C.pc.addIceCandidate(c) } catch {} }
function endCall(status = 'ended', report = true, msg) {
  const C = CALL; if (!C) return
  CALL = null
  stopSigPoll() // navbat-polling to'xtasin
  ringTone(false)
  nativeCallCancel() // APK: qo'ng'iroq bildirishnomasini yopish
  clearTimeout(C.timeout); clearInterval(C.tick)
  clearTimeout(C.connWatch); clearTimeout(C.connWatch2); clearTimeout(C.dropT)
  const dur = C.started ? Math.round((Date.now() - C.started) / 1000) : 0
  if (report && C.id) {
    sig(C.peer.id, { k: 'hangup', call_id: C.id })
    post(`/calls/${C.id}/status`, { status: C.started ? 'ended' : status, duration: dur }).catch(() => {})
  }
  try { C.pc?.close() } catch {}
  C.local?.getTracks().forEach((t) => t.stop())
  qs('.cst', C.el).textContent = msg || (C.started ? 'Tugadi · ' + fmtDur(dur) : 'Tugadi')
  qs('.cbar', C.el).innerHTML = ''
  // Xato sababi ko‘rinib tursin — darhol yo‘qolmasin (oddiy yopilish 1.2s, xato 3.2s)
  setTimeout(() => C.el.remove(), msg ? 3200 : 1200)
}

// ---------------- SIGNAL NAVBAT-POLLING (hal qiluvchi zaxira yo'l) ----------------
// Ildiz: signal FAQAT WebSocket orqali yurardi. WS o'lik/zombi bo'lsa (mobil tarmoqda
// tez-tez), POST /signal serverga yetardi LEKIN qabul qiluvchiga yetmasdi — 0 ta soketga
// push bo'lardi va qo'ng'iroq «Ulanmoqda…» da qolardi. Endi server har signalni 2 daqiqaga
// navbatga yozadi, klient qo'ng'iroq davomida polling bilan ALBATTA oladi.
let lastSid = 0, sigPollT = 0, sigPollBusy = false
async function drainSigQueue() {
  if (!CALL || sigPollBusy) return
  sigPollBusy = true
  try {
    const r = await api('/signal/queue?since=' + lastSid)
    for (const s of r.signals || []) {
      if (s.sid > lastSid) lastSid = s.sid
      try { handleSignalEv({ type: 'signal', sid: s.sid, from: s.from, data: s.data }) } catch {}
    }
  } catch {}
  sigPollBusy = false
}
function startSigPoll() {
  stopSigPoll()
  sigPollT = setInterval(drainSigQueue, 1800)
  drainSigQueue()
}
function stopSigPoll() { if (sigPollT) { clearInterval(sigPollT); sigPollT = 0 } }

// SID DEDUP: bir signal WS va navbat orqali IKKI MARTA kelishi mumkin — ikkinchi ishlov
// setRemoteDescription/addIceCandidate xatolariga olib kelardi. Endi sid bo'yicha o'tkazib yuboriladi.
const sigSeen = new Set()
function sigDedup(sid) {
  if (!sid) return false
  if (sigSeen.has(sid)) return true
  if (sigSeen.size > 600) sigSeen.clear()
  sigSeen.add(sid)
  return false
}
async function handleSignalEv(ev) {
  const d = ev.data || {}, from = ev.from
  if (sigDedup(ev.sid)) return // WS + navbat ikki marta yetkazishi mumkin (jonli efir ham)
  if (d.k && d.k[0] === 'l') return liveSignal(from, d)
  const C = CALL
  if (!C || C.peer.id !== from) return
  // POYG'A TUZATISH: sekin tarmoqda POST /calls javobi kechiksa, qarshi tomonning 'accept'i
  // CALL.id hali tayinlanmasidan turib kelardi va JIM drop qilinardi — qabul qiluvchi abadiy
  // «Ulanmoqda…» da qolardi. Endi: call_id hali bo'lmasa qabul qilinadi (adopt), bor bo'lsa
  // va mos kelmasagina drop.
  if (d.call_id && C.id && String(C.id) !== String(d.call_id)) return
  if (d.call_id && !C.id && d.k === 'accept') C.id = d.call_id
  try {
    if (d.k === 'accept' && C.outgoing && !C.pc) {
      ringTone(false); clearTimeout(C.timeout)
      setCallState('Ulanmoqda…')
      await setupPC(C)
      const o = await C.pc.createOffer()
      await C.pc.setLocalDescription(o)
      // 'offer' yo'qolsa qabul qiluvchi abadiy kutadi — 3 marta qayta urinamiz, yetmasa aniq yopamiz
      const ok = await sigTo(from, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON() })
      if (!ok && !C.started) return endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
      armConnectWatchdog(C)
    }
    if (d.k === 'offer' && C.pc) {
      // GLARE TUZATISH: ikkala tomon bir vaqtda offer yuborsa (WS qayta ulanishda ikkalasi ham
      // restartIce qiladi), 'have-local-offer' holatida setRemoteDescription XATO berardi va
      // ulanish buzilardi — endi rollback qilib javob beramiz (Perfect Negotiation qisqasi).
      if (C.pc.signalingState === 'have-local-offer') { try { await C.pc.setLocalDescription({ type: 'rollback' }) } catch {} }
      await C.pc.setRemoteDescription(d.sdp)
      await flushIce(C)
      const a = await C.pc.createAnswer()
      await C.pc.setLocalDescription(a)
      const ok = await sigTo(from, { k: 'answer', call_id: C.id, sdp: C.pc.localDescription.toJSON() })
      if (!ok && !C.started) endCall('missed', true, 'Signal yetmadi — internetni tekshirib ko‘ring')
    }
    if (d.k === 'answer' && C.pc) { await C.pc.setRemoteDescription(d.sdp); await flushIce(C) }
    if (d.k === 'ice') { if (C.pc?.remoteDescription) await C.pc.addIceCandidate(d.c).catch(() => {}); else C.ice.push(d.c) }
    if (d.k === 'hangup') endCall('ended', false)
    if (d.k === 'busy') endCall('missed', true, 'Band')
  } catch (e) { console.warn('signal', e) }
}
on('signal', handleSignalEv)

// Qo'ng'iroq ohangi (fayl kerak emas — WebAudio)
// TUZATILDI (foydalanuvchi: «jiringlash ovozi yo'q, jim»): 1) AudioContext await'lardan
// keyin yaratilardi — brauzer uni SUSPEND holatda qoldirardi = umuman OVOZ CHIQMASDI;
// endi har safar resume() chaqiriladi. 2) Ovoz juda past edi (0.06) — endi haqiqiy
// ringback kabi ikki qisqa jiringlash, aniq eshitiladigan darajada (0.14).
let ringCtx = null, ringTimer = 0
function ringTone(on) {
  clearInterval(ringTimer)
  if (!on) { try { ringCtx?.close() } catch {} ringCtx = null; return }
  try {
    if (!ringCtx) ringCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {})
    const beepAt = (t, f, d) => {
      const o = ringCtx.createOscillator(), g = ringCtx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.14, t + 0.03) // yumshoq boshlanish
      g.gain.setValueAtTime(0.14, t + d - 0.06)
      g.gain.linearRampToValueAtTime(0.0001, t + d) // yumshoq tugash
      o.connect(g); g.connect(ringCtx.destination)
      o.start(t); o.stop(t + d)
    }
    const beepOnce = () => {
      if (!ringCtx) return
      if (ringCtx.state === 'suspended') { ringCtx.resume().catch(() => {}); return } // jiringlash yo'qolmasin
      const t = ringCtx.currentTime + 0.02
      beepAt(t, 425, 0.42); beepAt(t + 0.62, 425, 0.42) // «dirin-dirin» — haqiqiy qo'ng'iroq ohangi
    }
    beepOnce(); ringTimer = setInterval(beepOnce, 2400)
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
function limitBitrate(pc) {
  const s = pc.getSenders().find((x) => x.track?.kind === 'video'); if (!s) return
  try {
    const p = s.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = 900000
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
