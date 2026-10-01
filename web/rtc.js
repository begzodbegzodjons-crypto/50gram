/* 50 Gram — audio/video qo'ng'iroqlar va jonli efir (WebRTC) */
'use strict'
let iceCache = null, iceAt = 0
async function iceServers() {
  if (iceCache && Date.now() - iceAt < 30 * 60000) return iceCache
  try { iceCache = (await api('/ice')).iceServers; iceAt = Date.now() } catch { iceCache = [{ urls: 'stun:stun.l.google.com:19302' }] }
  return iceCache
}
const sig = (to, data) => post('/signal', { to, data }).catch(() => {})
async function getMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Brauzer qo‘ng‘iroqni qo‘llamaydi (HTTPS kerak)')
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false }) }
  catch (e) { throw new Error(video ? 'Kamera/mikrofonga ruxsat bering' : 'Mikrofonga ruxsat bering') }
}
async function newPC(onIce) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() })
  pc.onicecandidate = (e) => e.candidate && onIce(e.candidate.toJSON())
  return pc
}

// ---------------- Qo'ng'iroqlar ----------------
let CALL = null
function callUI(peer, video, state) {
  const el = document.createElement('div')
  el.className = 'over call' + (video ? ' vid' : '')
  el.innerHTML = `<video class="remote" autoplay playsinline></video><video class="local" autoplay playsinline muted></video><audio class="ra" autoplay></audio>
    <div class="cinfo">${avHTML(peer, 110, { noStory: true })}<h2>${esc(uname(peer))}</h2><div class="cst">${state}</div></div>
    <div class="cbar"></div>`
  document.body.appendChild(el)
  return el
}
function callButtons(kind) {
  const b = qs('.cbar', CALL.el)
  if (kind === 'incoming') b.innerHTML = `<button class="cb end" data-c="decline">📵</button><button class="cb ok" data-c="accept">${CALL.video ? '📹' : '📞'}</button>`
  else b.innerHTML = `<button class="cb" data-c="mic">🎙</button>${CALL.video ? '<button class="cb" data-c="cam">📷</button><button class="cb" data-c="flip">🔄</button>' : '<button class="cb" data-c="spk">🔊</button>'}<button class="cb end" data-c="hang">📵</button>`
  b.onclick = (e) => {
    const k = e.target.closest('[data-c]')?.dataset.c; if (!k) return
    if (k === 'accept') acceptCall()
    if (k === 'decline') endCall('declined', true)
    if (k === 'hang') endCall('ended', true)
    if (k === 'mic') { const t = CALL.local?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; e.target.closest('.cb').classList.toggle('off', !t.enabled) } }
    if (k === 'cam') { const t = CALL.local?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; e.target.closest('.cb').classList.toggle('off', !t.enabled) } }
    if (k === 'flip') flipCam()
    if (k === 'spk') { const a = qs('.ra', CALL.el); a.muted = !a.muted; e.target.closest('.cb').classList.toggle('off', a.muted) }
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
    CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', true, 'Javob bermadi'), 45000)
  } catch (e) { toast('⚠️ ' + e.message); endCall('ended', !!CALL?.id) }
}
on('call', (ev) => {
  if (CALL) { sig(ev.from.id, { k: 'busy', call_id: ev.call_id }); return }
  S.users.set(ev.from.id, { ...(S.users.get(ev.from.id) || {}), ...ev.from })
  const peer = S.users.get(ev.from.id)
  CALL = { id: ev.call_id, peer, video: !!ev.video, outgoing: false, ice: [], el: callUI(peer, ev.video, ev.video ? 'Video qo‘ng‘iroq…' : 'Qo‘ng‘iroq…') }
  callButtons('incoming')
  ringTone(true)
  vibrate([400, 200, 400, 200, 400])
  notifyLocal('📞 ' + uname(peer), ev.video ? 'Video qo‘ng‘iroq' : 'Ovozli qo‘ng‘iroq')
  CALL.timeout = setTimeout(() => CALL && !CALL.started && endCall('missed', false), 45000)
})
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
// Izohlar, yuraklar va tomoshabinlar soni ham shu daraxt bo‘ylab (DataChannel) tarqaladi.
let LIVE = null
function liveUI(user, title, host) {
  const el = document.createElement('div')
  el.className = 'over live'
  el.innerHTML = `<video class="lv" autoplay playsinline ${host ? 'muted' : ''}></video>
    <div class="lhd">${avHTML(user, 36, { noStory: true })}<div><b>${esc(uname(user))}</b><small>${esc(title || 'Jonli efir')}</small></div><span class="lb">🔴 EFIR · <span class="lvc">0</span> 👁</span><button class="ic" data-lx>✕</button></div>
    ${host ? '' : '<div class="wait">⏳ Efirga ulanmoqda…</div>'}
    <div class="lcm"></div>
    <div class="lbot"><input class="inp" maxlength="300" placeholder="Izoh yozing…"><button class="cb" data-lh>❤️</button>${host ? '<button class="cb" data-lf>🔄</button><button class="cb end" data-le>Tugatish</button>' : ''}</div>`
  document.body.appendChild(el)
  const inp = qs('.lbot input', el)
  const send = (text, heart) => LIVE && post(`/lives/${LIVE.id}/comment`, { text, heart }).catch((e) => toast('⚠️ ' + e.message))
  inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { send(inp.value.trim(), false); inp.value = '' } }
  qs('[data-lh]', el).onclick = () => send('', true)
  qs('[data-lx]', el).onclick = () => (host ? endLive() : leaveLive())
  const le = qs('[data-le]', el); if (le) le.onclick = endLive
  const lf = qs('[data-lf]', el); if (lf) lf.onclick = liveFlip
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
  const chans = [...S.chats.values()].filter((c) => c.type !== 'direct' && (c.role === 'owner' || c.role === 'admin'))
  const sh = sheet(h3('🔴 Jonli efir') + `<input class="inp" id="lv-t" maxlength="200" placeholder="Efir mavzusi">
    <label class="mut">Kimga ko‘rsatiladi</label><select class="inp" id="lv-c"><option value="0">👥 Kontaktlarim va suhbatdoshlarim</option>${chans.map((c) => `<option value="${c.id}" ${c.id === chatId ? 'selected' : ''}>${c.type === 'channel' ? '📢' : '👥'} ${esc(c.title)}</option>`).join('')}</select>
    <div class="hint">Tomoshabinlar soni cheklanmagan: har bir tomoshabin efirni keyingi tomoshabinlarga uzatadi (o‘rgimchak to‘ri).</div><button class="btn big" id="lv-s">Efirni boshlash</button>`)
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
function onUpTrack(L, e) {
  if (LIVE !== L) return
  const tr = e.track
  for (const t of L.stream.getTracks()) if (t.kind === tr.kind && t !== tr) L.stream.removeTrack(t)
  if (!L.stream.getTracks().includes(tr)) L.stream.addTrack(tr)
  // Yangi manbadan kelgan treklarni farzandlarga ham almashtirib beramiz
  for (const k of L.kids.values()) { const s = k.pc.getSenders().find((x) => x.track?.kind === tr.kind); if (s && s.track !== tr) s.replaceTrack(tr).catch(() => {}) }
  const v = qs('.lv', L.el)
  if (v.srcObject !== L.stream) v.srcObject = L.stream
  v.play?.().catch(() => {})
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
on('live_end', (ev) => { if (LIVE && LIVE.id === ev.live_id && !LIVE.host) { liveRelay({ t: 'end' }); liveEnded() } })
window.addEventListener('beforeunload', () => { if (CALL) endCall('ended', true); if (LIVE && !LIVE.host) fetch(`${API}/lives/${LIVE.id}/leave`, { method: 'POST', keepalive: true, headers: { authorization: 'Bearer ' + S.token } }) })
