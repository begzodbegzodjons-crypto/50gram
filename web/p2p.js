/* 50 Gram — qo'shimcha media manba (zaxira nusxalar) */
'use strict'
const P2P = (() => {
  const ctx = new Map()          // mediaId -> { chat, sha, size }
  const touched = new Set()
  let haveQ = [], haveT = 0
  const sessions = new Map()     // sid -> RTCPeerConnection holati
  let iceCache = null, iceAt = 0
  let serving = 0
  const MAX_SERVE = 3, PIECE = 16 * 1024

  const enabled = () => localStorage.getItem('g50_share') !== '0'
  const canServe = () => enabled() && navigator.onLine !== false && serving < MAX_SERVE

  async function ice() {
    if (iceCache && Date.now() - iceAt < 3600e3) return iceCache
    try { iceCache = (await api('/ice')).iceServers; iceAt = Date.now() } catch { iceCache = [{ urls: 'stun:stun.l.google.com:19302' }] }
    return iceCache
  }
  async function sha256Hex(blob) {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fayl qaysi chatga tegishli ekanini eslab qolish (xabarlar ko'rsatilganda chaqiriladi)
  // info: { chat, sha, size, key, iv, mime } — xabar meta'sidan
  function note(id, info = {}) {
    if (!id) return
    const o = ctx.get(id) || {}
    const n = { ...o }
    for (const k of ['chat', 'sha', 'size', 'key', 'iv', 'mime']) if (info[k] !== undefined && info[k] !== null) n[k] = info[k]
    ctx.set(id, n)
  }
  // Serverga "bu fayl mening qurilmamda bor" deb xabar berish (fayl o'zi yuborilmaydi)
  function have(id, chat) {
    if (!S.token || !enabled()) return
    if (chat !== undefined && chat !== null) note(id, { chat })
    const c = chat ?? ctx.get(id)?.chat
    if (c === undefined || c === null) return
    haveQ.push({ m: id, c, s: ctx.get(id)?.size || 0 })
    clearTimeout(haveT)
    haveT = setTimeout(() => {
      const items = haveQ.splice(0, 200)
      if (items.length) post('/p2p/have', { items }).catch(() => {})
      if (haveQ.length) have(haveQ[0].m, haveQ[0].c)
    }, 1500)
  }
  function touch(id) { if (touched.has(id)) return; touched.add(id); have(id) }
  const signal = (to, chat, data) => post('/p2p/signal', { to, chat, data })

  // ---------- So'rovchi tomoni ----------
  function request(peer, chat, want, timeout = 25000) {
    return new Promise(async (resolve, reject) => {
      const sid = Math.random().toString(36).slice(2) + Date.now().toString(36)
      const pc = new RTCPeerConnection({ iceServers: await ice() })
      const dc = pc.createDataChannel('g50', { ordered: true })
      dc.binaryType = 'arraybuffer'
      let head = null, parts = [], got = 0, text = ''
      const done = (err, val) => {
        clearTimeout(tm); sessions.delete(sid)
        try { dc.close() } catch {} try { pc.close() } catch {}
        err ? reject(err) : resolve(val)
      }
      const tm = setTimeout(() => done(new Error('vaqt tugadi')), timeout)
      sessions.set(sid, { pc, peer, chat, onNo: () => done(new Error('manbada yo‘q')) })
      pc.onicecandidate = (e) => e.candidate && signal(peer, chat, { t: 'ice', sid, c: e.candidate.toJSON(), r: 1 }).catch(() => {})
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) done(new Error('ulanish uzildi')) }
      dc.onopen = () => dc.send(JSON.stringify(want))
      dc.onmessage = (e) => {
        if (typeof e.data === 'string') {
          if (!head) { try { head = JSON.parse(e.data) } catch { return done(new Error('xato javob')) } if (!head.ok) done(new Error('manbada yo‘q')); return }
          if (e.data === '\u0000end') {
            if (want.type === 'media') {
              if (got !== head.size) return done(new Error('fayl to‘liq kelmadi'))
              return done(null, new Blob(parts, { type: head.mime || 'application/octet-stream' }))
            }
            try { return done(null, JSON.parse(text)) } catch { return done(new Error('xato ma’lumot')) }
          }
          text += e.data
          if (text.length > 20e6) done(new Error('juda katta'))
        } else {
          parts.push(e.data); got += e.data.byteLength
          if (head && got > head.size) done(new Error('hajm noto‘g‘ri'))
        }
      }
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await signal(peer, chat, { t: 'offer', sid, sdp: pc.localDescription.sdp, want })
      } catch (e) { done(e) }
    })
  }
  async function peersFor(q) {
    try { return (await api('/p2p/peers?' + new URLSearchParams(q))).peers || [] } catch { return [] }
  }
  // Faylni boshqa onlayn foydalanuvchidan olish
  const inflight = new Map()
  function fetchMedia(id) {
    if (inflight.has(id)) return inflight.get(id)
    const p = (async () => {
      if (!window.RTCPeerConnection) throw new Error('P2P qo‘llanmaydi')
      const info = ctx.get(id) || { chat: S.cur || 0 }
      const peers = await peersFor({ media: id, chat: info.chat || 0 })
      if (!peers.length) throw new Error('Fayl serverda o‘chgan va hozir uni saqlagan onlayn foydalanuvchi yo‘q')
      for (const peer of peers) {
        try {
          const blob = await request(peer, info.chat || 0, { type: 'media', id })
          if (info.sha && (await sha256Hex(blob)) !== info.sha) continue // soxta fayl — keyingi manba
          if (info.size && blob.size !== info.size) continue
          await IDB.put('media', id, blob)
          Store.record(id, blob.size, info.chat || 0, 0)
          have(id, info.chat || 0) // endi bu qurilma ham manba
          return blob
        } catch {}
      }
      throw new Error('Manbalardan olib bo‘lmadi, keyinroq urinib ko‘ring')
    })().finally(() => inflight.delete(id))
    inflight.set(id, p)
    return p
  }
  // Serverda qolmagan eski xabarlarni boshqa a'zolar qurilmasidan olish
  async function history(chat, before, limit = 300) {
    if (!window.RTCPeerConnection) throw new Error('P2P qo‘llanmaydi')
    const peers = await peersFor({ chat })
    if (!peers.length) throw new Error('Hozir bu chatda onlayn a’zo yo‘q')
    for (const peer of peers) {
      try {
        const list = await request(peer, chat, { type: 'hist', chat, before: before || 0, limit }, 30000)
        if (!Array.isArray(list) || !list.length) continue
        const { ok } = await post('/p2p/verify', { chat_id: chat, messages: list })
        const okSet = new Set(ok)
        const good = list.filter((m) => okSet.has(m.id)).map((m) => ({ ...m, p2p: 1 }))
        if (good.length) return good
      } catch {}
    }
    return []
  }

  // ---------- Manba (beruvchi) tomoni ----------
  async function serve(ev) {
    const d = ev.data, w = d.want || {}
    if (!canServe()) return signal(ev.from, ev.chat, { t: 'no', sid: d.sid }).catch(() => {})
    let payload = null
    if (w.type === 'media') {
      const blob = await IDB.get('media', String(w.id))
      if (blob) payload = { blob }
    } else if (w.type === 'hist' && +w.chat === ev.chat) {
      const rec = await IDB.get('chats', S.me.id + ':' + ev.chat)
      const before = +w.before || Infinity
      const lim = Math.min(500, +w.limit || 300)
      const list = (rec?.messages || []).filter((m) => m.chat_id === ev.chat && m.sig && !m.deleted && m.id < before).slice(-lim)
        .map(({ pending, p2p, ...m }) => m)
      if (list.length) payload = { text: JSON.stringify(list) }
    }
    if (!payload) return signal(ev.from, ev.chat, { t: 'no', sid: d.sid }).catch(() => {})
    serving++
    const pc = new RTCPeerConnection({ iceServers: await ice() })
    const end = () => { if (!sessions.has(d.sid)) return; sessions.delete(d.sid); serving--; setTimeout(() => { try { pc.close() } catch {} }, 1500) }
    sessions.set(d.sid, { pc, peer: ev.from, chat: ev.chat, onNo: end })
    const tm = setTimeout(end, 120000)
    pc.onicecandidate = (e) => e.candidate && signal(ev.from, ev.chat, { t: 'ice', sid: d.sid, c: e.candidate.toJSON() }).catch(() => {})
    pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { clearTimeout(tm); end() } }
    pc.ondatachannel = (e) => {
      const dc = e.channel; dc.binaryType = 'arraybuffer'
      dc.bufferedAmountLowThreshold = 256 * 1024
      const drain = () => new Promise((r) => { if (dc.bufferedAmount < 1024 * 1024) return r(); dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r() } })
      dc.onmessage = async () => {
        try {
          if (payload.blob) {
            const b = payload.blob
            dc.send(JSON.stringify({ ok: true, size: b.size, mime: b.type }))
            for (let i = 0; i < b.size; i += PIECE) { await drain(); dc.send(await b.slice(i, i + PIECE).arrayBuffer()) }
          } else {
            const t = payload.text
            dc.send(JSON.stringify({ ok: true }))
            for (let i = 0; i < t.length; i += PIECE) { await drain(); dc.send(t.slice(i, i + PIECE)) }
          }
          dc.send('\u0000end')
        } catch {}
        clearTimeout(tm); setTimeout(end, 4000)
      }
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp })
      const ans = await pc.createAnswer()
      await pc.setLocalDescription(ans)
      await signal(ev.from, ev.chat, { t: 'answer', sid: d.sid, sdp: pc.localDescription.sdp })
    } catch { clearTimeout(tm); end() }
  }
  on('p2p', async (ev) => {
    const d = ev.data || {}
    if (d.t === 'offer') return serve(ev)
    const s = sessions.get(d.sid)
    if (!s || s.peer !== ev.from) return
    try {
      if (d.t === 'answer') await s.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp })
      else if (d.t === 'ice' && d.c) await s.pc.addIceCandidate(d.c)
      else if (d.t === 'no') s.onNo()
    } catch {}
  })
  return { note, have, touch, fetchMedia, history, sha256Hex, enabled, ctx }
})()
