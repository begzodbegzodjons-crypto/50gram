/* 50 Gram — audio/video qo'ng'iroqlar va jonli efir (WebRTC) */
'use strict'
let iceCache = null, iceAt = 0
async function iceServers() {
  if (iceCache && Date.now() - iceAt < 30 * 60000) return iceCache
  try { iceCache = (await api('/ice')).iceServers; iceAt = Date.now() } catch { iceCache = [{ urls: 'stun:stun.l.google.com:19302' }] }
  // MUHIM (Task 33): ba'zi tarmoqlar (mobil operator CGNAT, korporativ NAT) faqat STUN orqali
  // P2P ulanmaydi — efir "qotib qoladi", izohlar esa ishlaydi. Ochiq TURN zaxirasi qo'shamiz.
  const hasTurn = (iceCache || []).some((s) => [].concat(s?.urls || []).some((u) => String(u).indexOf('turn') === 0))
  if (!hasTurn) iceCache.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'], username: 'openrelayproject', credential: 'openrelayproject' })
  return iceCache
}
const sig = (to, data) => post('/signal', { to, data }).catch(() => {})
async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Brauzer qo‘ng‘iroqni qo‘llamaydi (HTTPS kerak)')
  const con = { audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false }
  let last = null
  for (let i = 0; i < 2; i++) {
    try { return await navigator.mediaDevices.getUserMedia(con) }
    catch (e) {
      last = e
      if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) throw new Error(video ? 'Kamera topilmadi' : 'Mikrofon topilmadi')
      if (e && (e.name === 'NotReadableError' || e.name === 'AbortError')) { await new Promise((r) => setTimeout(r, 450)); continue } // qurilma band — bir marta qayta urinamiz
      break
    }
  }
  // MUHIM: Chrome ruxsat bir marta rad etilsa boshqa hech qachon oyna ko'rsatmaydi —
  // shuning uchun foydalanuvchiga aniq yo'nalish beramiz (🔒 belgi orqali yoqish)
  if (last && (last.name === 'NotAllowedError' || last.name === 'SecurityError')) {
    throw new Error('Ruxsat berilmagan — manzil satridagi 🔒 belgi orqali Kamera va Mikrofonga “Ruxsat berilgan” qiling')
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
  el.innerHTML = `<video class="remote" autoplay playsinline></video><video class="local" autoplay playsinline muted></video><audio class="ra" autoplay></audio>
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
  callButtons('active')
  try {
    CALL.local = await getMedia(video)
    qs('.local', CALL.el).srcObject = CALL.local
    const r = await post('/calls', { to: uid, video: !!video })
    if (!CALL) return
    CALL.id = r.call_id
    setCallState('Chaqirilmoqda…')
    ringTone(true)
    CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', true, 'Javob bermadi'), 75000)
  } catch (e) { toast('⚠️ ' + e.message); endCall('ended', !!CALL?.id) }
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
    if (ev && !CALL) incomingCall(ev) // UI hali yaratilmagan (fon rejimi) — yaratamiz
    if (CALL && String(CALL.id) === String(id)) { nativeCallCancel(); acceptCall() }
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
  if (CALL || pendingNativeCall) return
  try {
    const r = await api('/calls/pending')
    if (r && r.call && !CALL) incomingCall({ call_id: r.call.call_id, video: r.call.video, from: r.call.from })
  } catch {}
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
    sig(C.peer.id, { k: 'accept', call_id: C.id })
    post(`/calls/${C.id}/status`, { status: 'active' }).catch(() => {})
  } catch (e) { toast('⚠️ ' + e.message); endCall('declined', true) }
}
async function setupPC(C) {
  C.pc = await newPC((c) => sig(C.peer.id, { k: 'ice', call_id: C.id, c }))
  for (const t of C.local.getTracks()) C.pc.addTrack(t, C.local)
  C.pc.ontrack = (e) => {
    const st = e.streams[0]
    qs('.remote', C.el).srcObject = st
    qs('.ra', C.el).srcObject = st
    if (C.video) C.el.classList.add('live')
  }
  C.pc.onconnectionstatechange = () => {
    const s = C.pc.connectionState
    if (s === 'connected' && !C.started) {
      C.started = Date.now()
      clearTimeout(C.timeout)
      C.tick = setInterval(() => setCallState(fmtDur((Date.now() - C.started) / 1000)), 1000)
      if (C.video) qs('.cinfo', C.el).classList.add('mini')
    }
    if (s === 'disconnected') setCallState('Aloqa uzildi, qayta ulanmoqda…')
    if (s === 'failed') { if (C.outgoing) restartIce(C); else setCallState('Aloqa yomon…') }
  }
}
async function restartIce(C) {
  try { const o = await C.pc.createOffer({ iceRestart: true }); await C.pc.setLocalDescription(o); sig(C.peer.id, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON() }) } catch {}
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
  ringTone(false)
  nativeCallCancel() // APK: qo'ng'iroq bildirishnomasini yopish
  clearTimeout(C.timeout); clearInterval(C.tick)
  const dur = C.started ? Math.round((Date.now() - C.started) / 1000) : 0
  if (report && C.id) {
    sig(C.peer.id, { k: 'hangup', call_id: C.id })
    post(`/calls/${C.id}/status`, { status: C.started ? 'ended' : status, duration: dur }).catch(() => {})
  }
  try { C.pc?.close() } catch {}
  C.local?.getTracks().forEach((t) => t.stop())
  qs('.cst', C.el).textContent = msg || (C.started ? 'Tugadi · ' + fmtDur(dur) : 'Tugadi')
  qs('.cbar', C.el).innerHTML = ''
  setTimeout(() => C.el.remove(), 1200)
}

// Signal: qo'ng'iroq va efir uchun
on('signal', async (ev) => {
  const d = ev.data || {}, from = ev.from
  if (d.k && d.k[0] === 'l') return liveSignal(from, d)
  const C = CALL
  if (!C || C.id !== d.call_id || C.peer.id !== from) return
  try {
    if (d.k === 'accept' && C.outgoing) {
      ringTone(false); clearTimeout(C.timeout)
      setCallState('Ulanmoqda…')
      await setupPC(C)
      const o = await C.pc.createOffer()
      await C.pc.setLocalDescription(o)
      sig(from, { k: 'offer', call_id: C.id, sdp: C.pc.localDescription.toJSON() })
    }
    if (d.k === 'offer' && C.pc) {
      await C.pc.setRemoteDescription(d.sdp)
      await flushIce(C)
      const a = await C.pc.createAnswer()
      await C.pc.setLocalDescription(a)
      sig(from, { k: 'answer', call_id: C.id, sdp: C.pc.localDescription.toJSON() })
    }
    if (d.k === 'answer' && C.pc) { await C.pc.setRemoteDescription(d.sdp); await flushIce(C) }
    if (d.k === 'ice') { if (C.pc?.remoteDescription) await C.pc.addIceCandidate(d.c).catch(() => {}); else C.ice.push(d.c) }
    if (d.k === 'hangup') endCall('ended', false)
    if (d.k === 'busy') endCall('missed', true, 'Band')
  } catch (e) { console.warn('signal', e) }
})

// Qo'ng'iroq ohangi (fayl kerak emas — WebAudio)
let ringCtx = null, ringTimer = 0
function ringTone(on) {
  clearInterval(ringTimer)
  if (!on) { try { ringCtx?.close() } catch {} ringCtx = null; return }
  try {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)()
    const beepOnce = () => {
      if (!ringCtx) return
      const o = ringCtx.createOscillator(), g = ringCtx.createGain()
      o.frequency.value = 440; g.gain.value = 0.06
      o.connect(g); g.connect(ringCtx.destination)
      o.start(); o.stop(ringCtx.currentTime + 0.9)
    }
    beepOnce(); ringTimer = setInterval(beepOnce, 3000)
  } catch {}
}

// ---------------- Jonli efir ----------------
// "O‘rgimchak to‘ri" daraxti: efirchi efirni 4 ta tomoshabinga uzatadi, har bir tomoshabin olgan efirini
// yana 3 ta tomoshabinga uzatadi. Shu sababli tomoshabinlar soni cheklanmaydi (10 000 ta ~8 bosqich).
// Izohlar, yuraklar, SOVG'ALAR va tomoshabinlar soni ham shu daraxt bo‘ylab (DataChannel) tarqaladi.
let LIVE = null
// Task 29: sovg'alar — coin iqtisodiyoti (serverdagi GIFTS narxlari bilan bir xil)
const LIVE_GIFTS = [
  { id: 'star', name: 'Yulduz', p: 5 }, { id: 'heart', name: 'Yurak', p: 10 },
  { id: 'rose', name: 'Gul', p: 25 }, { id: 'fire', name: 'Olov', p: 49 },
  { id: 'cake', name: 'Tort', p: 149 }, { id: 'crown', name: 'Toj', p: 199 },
  { id: 'diamond', name: 'Olmos', p: 499 }, { id: 'rocket', name: 'Raketa', p: 999 },
]
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
  for (let i = 0; i < 5; i++) {
    const f = document.createElement('div'); f.className = 'fly'
    f.textContent = '❤️'; f.style.left = (74 + Math.random() * 16) + '%'
    f.style.animationDelay = (i * 0.12) + 's'
    el.appendChild(f); setTimeout(() => f.remove(), 1900)
  }
}
function flyGift(el, gid, name, from) {
  if (!el) return
  const f = document.createElement('div')
  f.className = 'flygift'
  f.innerHTML = `<img src="${giftImg(gid)}" alt=""><span><b>${esc(from || '')}</b>${esc(name || '')}</span>`
  el.appendChild(f)
  setTimeout(() => f.remove(), 3400)
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
    <div class="lhd"><div class="lh-u">${avHTML(user, 40, { noStory: true })}<div class="lh-t"><b>${esc(uname(user))}</b>${user.lvl ? `<span class="lvlbadge mini" style="background:linear-gradient(135deg,#a5d8ff,#4dabf7)">${user.lvl.emoji} ${esc(user.lvl.name)}</span>` : ''}</div></div><span class="lb">🔴 EFIR · <span class="lvc">0</span> 👁</span><button class="ic" data-lx>✕</button></div>
    ${host ? '<div class="learn">🪙 <b id="l-coins">0</b> coin · <small>tomoshabinlar sovg‘alari</small></div>' : ''}
    <div class="ltop" id="l-top"></div>
    ${host ? '' : '<div class="wait">⏳ Efirga ulanmoqda…</div>'}
    <div class="lcm"></div>
    <div class="lrail">
      <button class="rb" data-lh title="Yurak — +1 ball">❤️</button>
      <button class="rb gift" data-lg title="Sovg‘a yuborish">🎁</button>
    </div>
    <div class="lbot"><input class="inp" maxlength="300" placeholder="Izoh yozing… +2 ball"><button class="cb" data-ls>➤</button>${host ? '<button class="cb" data-lf>🔄</button><button class="cb end" data-le>Tugatish</button>' : ''}</div>
    <div class="lgift hide" id="l-gift">
      <div class="lg-h"><b>🎁 Sovg‘a yuborish</b><span class="lg-bal" id="lg-bal">…</span><button class="ic" data-lgx>✕</button></div>
      <div class="lg-daily" id="lg-daily"></div>
      <div class="lg-grid">${LIVE_GIFTS.map((g) => `<button class="gcard" data-g="${g.id}"><img src="${giftImg(g.id)}" alt="" loading="lazy"><b>${g.name}</b><span>🪙 ${g.p}</span></button>`).join('')}</div>
      <div class="hint">Sovg‘a coin bilan olinadi — efirchining balli va coin’i oshadi, ekraningizda chiroyli animatsiya uchadi!</div>
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
  qs('[data-lh]', el).onclick = () => { send('', true); heartBurst(el) }
  qs('[data-lx]', el).onclick = () => (host ? endLive() : leaveLive())
  const le = qs('[data-le]', el); if (le) le.onclick = endLive
  const lf = qs('[data-lf]', el); if (lf) lf.onclick = liveFlip
  // Sovg‘a paneli (TikTok-uslubi)
  const gp = qs('#l-gift', el)
  qs('[data-lg]', el).onclick = () => { gp.classList.toggle('hide'); if (!gp.classList.contains('hide')) updateGiftPanel(el) }
  qs('[data-lgx]', el).onclick = () => gp.classList.add('hide')
  gp.onclick = async (e) => {
    const g = e.target.closest('[data-g]'); if (!g || !LIVE) return
    const gi = LIVE_GIFTS.find((x) => x.id === g.dataset.g)
    try {
      const r = await post(`/lives/${LIVE.id}/gift`, { gift: gi.id, n: 1 })
      gp.classList.add('hide')
      flyGift(el, gi.id, gi.name, S.me.first_name)
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
function liveSetCount(v) { if (LIVE) { LIVE.viewers = v; qs('.lvc', LIVE.el).textContent = v } }
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
  if (m.t === 'g') { flyGift(LIVE.el, m.g, '×' + (m.gn || 1), m.n); liveTopAdd(m.n, m.cost || 0) }
  liveRelay(m)
  if (m.t === 'end') liveEnded()
}
function liveEnded() {
  const L = LIVE; if (!L || L.host) return
  LIVE = null
  clearTimeout(L.retry); clearTimeout(L.dropT)
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
    <div class="hint">Tomoshabinlar soni cheklanmagan (o‘rgimchak to‘ri). Ular izoh/yurak bilan <b>ball yig‘adi</b>, sovg‘a yuborsa — sizga <b>coin</b> va <b>martaba</b> qo‘shiladi. 🎁</div><button class="btn big" id="lv-s">Efirni boshlash</button>`)
  qs('#lv-s', sh).onclick = async () => {
    const title = qs('#lv-t', sh).value.trim(), cid = +qs('#lv-c', sh).value
    closeSheet(sh)
    try {
      const stream = await getMedia(true)
      const r = await post('/lives', { title, chat_id: cid })
      LIVE = { id: r.id, host: true, stream, kids: new Map(), viewers: 0 }
      LIVE.el = liveUI(S.me, title, true)
      qs('.lv', LIVE.el).srcObject = stream
      toast('🔴 Efir boshlandi')
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
  k.pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(k.pc.connectionState) && L.kids.get(uid) === k) L.kids.delete(uid) }
  const o = await k.pc.createOffer()
  await k.pc.setLocalDescription(o)
  limitBitrate(k.pc)
  sig(uid, { k: 'loffer', live_id: L.id, sdp: k.pc.localDescription.toJSON() })
}
function armRetry(L) {
  clearTimeout(L.retry)
  L.retry = setTimeout(() => { if (LIVE === L && !L.gotUp) liveRejoin() }, 15000)
}
async function watchLive(id) {
  if (LIVE) { if (LIVE.id === id) return; if (LIVE.host) return toast('Avval efiringizni tugating'); await leaveLive() }
  LTOP.clear()
  try {
    const r = await post(`/lives/${id}/join`)
    LIVE = { id, host: false, hostId: r.user.id, parentId: r.parent, ice: [], kids: new Map(), stream: new MediaStream(), viewers: r.viewers, tries: 0 }
    LIVE.el = liveUI(r.user, r.title, false)
    liveSetCount(r.viewers)
    armRetry(LIVE)
  } catch (e) { toast('⚠️ ' + e.message); loadLives() }
}
// Yuqoridagi tomoshabin uzilsa — boshqasiga qayta ulanish (farzandlar ulanishda qoladi)
async function liveRejoin() {
  const L = LIVE; if (!L || L.host || L.rejoining) return
  L.rejoining = true
  const old = L.parentId
  const pc = L.pc; L.pc = null; L.gotUp = false; L.ice = []
  try { pc?.close() } catch {}
  try {
    const r = await post(`/lives/${L.id}/join`, { exclude: old && old !== L.hostId ? [old] : [] })
    if (LIVE !== L) return
    L.parentId = r.parent
    L.tries++
    if (L.tries > 3) { const w = qs('.wait', L.el); if (w) w.textContent = '⏳ Ulanish sekin, kutilmoqda…' }
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
  L.gotUp = true; L.tries = 0; clearTimeout(L.retry)
  qs('.wait', L.el)?.remove()
  if (!L.ready && L.stream.getVideoTracks().length) { L.ready = true; post(`/lives/${L.id}/ready`).catch(() => {}) }
}
async function leaveLive() {
  const L = LIVE; if (!L) return
  LIVE = null
  clearTimeout(L.retry); clearTimeout(L.dropT)
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
  try { const r = await post(`/lives/${L.id}/end`); toast(`Efir tugadi · ${r.viewers || 0} tomoshabin`) } catch {}
  loadLives()
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
      const pc = await newPC((c) => sig(from, { k: 'lice', live_id: L.id, c }))
      L.pc = pc
      pc.ontrack = (e) => onUpTrack(L, e)
      pc.ondatachannel = (e) => { e.channel.onmessage = (m) => { try { liveMsg(JSON.parse(m.data)) } catch {} } }
      pc.onconnectionstatechange = () => {
        if (L.pc !== pc || LIVE !== L) return
        const st = pc.connectionState
        if (st === 'failed') liveRejoin()
        else if (st === 'disconnected') { clearTimeout(L.dropT); L.dropT = setTimeout(() => { if (L.pc === pc && pc.connectionState !== 'connected') liveRejoin() }, 5000) }
      }
      await pc.setRemoteDescription(d.sdp)
      for (const c of L.ice.splice(0)) await pc.addIceCandidate(c).catch(() => {})
      const a = await pc.createAnswer()
      await pc.setLocalDescription(a)
      sig(from, { k: 'lanswer', live_id: L.id, sdp: pc.localDescription.toJSON() })
    }
    if (d.k === 'lice') { if (L.pc?.remoteDescription) await L.pc.addIceCandidate(d.c).catch(() => {}); else L.ice.push(d.c) }
  } catch (e) { console.warn('live', e) }
}
on('live_join', (ev) => {
  const L = LIVE; if (!L || L.id !== ev.live_id) return
  if (L.host) { liveSetCount(ev.viewers); liveComment(ev.from.first_name, 'qo‘shildi 👋'); liveRelayCount() }
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
  flyGift(L.el, ev.gift, '×' + (ev.n || 1), ev.from?.first_name)
  liveTopAdd(ev.from?.first_name, ev.cost || 0)
  const c = qs('#l-coins', L.el); if (c) c.textContent = fmtN(ev.host_coins || 0)
  // Barcha tomoshabinlarga ham ko‘rinsin — daraxt bo‘ylab
  liveRelay({ t: 'g', n: ev.from?.first_name, g: ev.gift, gn: ev.n, cost: ev.cost })
})
on('live_end', (ev) => { if (LIVE && LIVE.id === ev.live_id && !LIVE.host) { liveRelay({ t: 'end' }); liveEnded() } })
window.addEventListener('beforeunload', () => { if (CALL) endCall('ended', true); if (LIVE && !LIVE.host) fetch(`${API}/lives/${LIVE.id}/leave`, { method: 'POST', keepalive: true, headers: { authorization: 'Bearer ' + S.token } }) })
