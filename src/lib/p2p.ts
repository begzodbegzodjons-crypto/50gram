'use client'

// ============================================================
// UzbekGram P2P — WebRTC DataChannel orqali TO'G'RIDAN-TO'G'RI
// fayl uzatish (gibrid modelning "katta fayllar P2P" qismi).
//
// Server faqat SDP/ICE SIGNALNI yetkazib beradi — fayl baytlari
// HECH QACHON serverga kelmaydi. WebRTC kanali DTLS bilan
// shifrlangan (brauzer darajasida, majburiy).
//
// Muvaffaqiyatsizlikda chaqiruvchi tomon SERVER RELAY yo'liga
// qaytadi (fallback) — fayl hech qachon yo'qolmaydi.
// ============================================================

import type { Socket } from 'socket.io-client'

const CHUNK = 16 * 1024 // 16KB — RTCDataChannel uchun xavfsiz o'lcham
const CONNECT_TIMEOUT = 12_000 // offer → connected
const DONE_TIMEOUT = 60_000 // connected → barcha baytlar

export interface P2PProgress {
  sent: number
  total: number
}

export type P2PSignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'reject' }

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

// ===== Yuboruvchi: faylni peer'ga uzatish =====
// qaytaradigan funksiya = bekor qilish (abort)
export function sendFileP2P(
  socket: Socket,
  opts: { peerId: string; chatId: string; file: Blob; name: string },
  cb: {
    onProgress?: (p: P2PProgress) => void
    onDone?: () => void
    onFail?: (why: string) => void
  }
): () => void {
  let finished = false
  let cleaned = false

  const pc = new RTCPeerConnection(ICE_CONFIG)
  const dc = pc.createDataChannel('ug-file', { ordered: true })
  dc.binaryType = 'arraybuffer'

  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => fail('P2P ulanish vaqti tugadi'),
    CONNECT_TIMEOUT
  )
  let doneTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (connectTimer) clearTimeout(connectTimer)
    if (doneTimer) clearTimeout(doneTimer)
    socket.off('p2p:signal', onSignal)
    try { dc.close() } catch {}
    try { pc.close() } catch {}
  }
  const fail = (why: string) => {
    if (finished) return
    finished = true
    cleanup()
    cb.onFail?.(why)
  }
  const done = () => {
    if (finished) return
    finished = true
    cleanup()
    cb.onDone?.()
  }

  const onSignal = (d: { from: string; chatId?: string; payload: P2PSignalPayload }) => {
    if (d.from !== opts.peerId) return
    const p = d.payload
    if (p.kind === 'answer') {
      void pc.setRemoteDescription(p.sdp).catch(() => fail('SDP javob xatosi'))
    } else if (p.kind === 'ice') {
      void pc.addIceCandidate(p.candidate).catch(() => {})
    } else if (p.kind === 'reject') {
      fail('Qarshi tomon P2Pni rad etdi')
    }
  }
  socket.on('p2p:signal', onSignal)

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('p2p:signal', {
        to: opts.peerId,
        chatId: opts.chatId,
        payload: { kind: 'ice', candidate: e.candidate.toJSON() },
      })
    }
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
      doneTimer = setTimeout(() => fail('P2P uzatish vaqti tugadi'), DONE_TIMEOUT)
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      fail('P2P ulanish o\'rnatilmadi')
    }
  }

  dc.onopen = () => {
    // 1) meta (matn) → 2) bayt chunklari
    dc.send(JSON.stringify({ name: opts.name, size: opts.file.size, mime: opts.file.type || 'image/jpeg' }))
    void (async () => {
      let offset = 0
      const total = opts.file.size
      try {
        while (offset < total) {
          // buffer to'lib ketmasligi uchun kutamiz (backpressure)
          if (dc.bufferedAmount > 1 << 20) {
            await new Promise((r) => setTimeout(r, 25))
            continue
          }
          const buf = await opts.file.slice(offset, offset + CHUNK).arrayBuffer()
          dc.send(buf)
          offset += buf.byteLength
          cb.onProgress?.({ sent: offset, total })
        }
      } catch {
        fail('Fayl yuborish xatosi')
      }
    })()
  }
  dc.onmessage = (ev) => {
    if (typeof ev.data === 'string' && ev.data === 'received') done()
  }
  dc.onerror = () => fail('P2P kanal xatosi')

  void (async () => {
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('p2p:signal', {
        to: opts.peerId,
        chatId: opts.chatId,
        payload: { kind: 'offer', sdp: pc.localDescription!.toJSON() },
      })
    } catch {
      fail('Offer yaratilmadi')
    }
  })()

  return cleanup
}

// ===== Qabul qiluvchi: taklifni qabul qilib faylni Blob qilib olish =====
export function acceptFileP2P(
  socket: Socket,
  opts: { peerId: string; chatId: string; offer: RTCSessionDescriptionInit },
  cb: {
    onProgress?: (p: P2PProgress) => void
    onDone: (file: Blob, name: string) => void
    onFail?: (why: string) => void
  }
): void {
  let finished = false
  let cleaned = false

  const pc = new RTCPeerConnection(ICE_CONFIG)
  let dc: RTCDataChannel | null = null

  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => fail('P2P ulanish vaqti tugadi'),
    CONNECT_TIMEOUT
  )
  let doneTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (connectTimer) clearTimeout(connectTimer)
    if (doneTimer) clearTimeout(doneTimer)
    socket.off('p2p:signal', onSignal)
    try { dc?.close() } catch {}
    try { pc.close() } catch {}
  }
  const fail = (why: string) => {
    if (finished) return
    finished = true
    cleanup()
    cb.onFail?.(why)
  }

  const onSignal = (d: { from: string; chatId?: string; payload: P2PSignalPayload }) => {
    if (d.from !== opts.peerId) return
    const p = d.payload
    if (p.kind === 'ice') void pc.addIceCandidate(p.candidate).catch(() => {})
  }
  socket.on('p2p:signal', onSignal)

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('p2p:signal', {
        to: opts.peerId,
        chatId: opts.chatId,
        payload: { kind: 'ice', candidate: e.candidate.toJSON() },
      })
    }
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
      doneTimer = setTimeout(() => fail('P2P qabul vaqti tugadi'), DONE_TIMEOUT)
    }
  }

  pc.ondatachannel = (e) => {
    dc = e.channel
    dc.binaryType = 'arraybuffer'
    let meta: { name: string; size: number; mime: string } | null = null
    const chunks: ArrayBuffer[] = []
    let received = 0

    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          meta = JSON.parse(ev.data)
        } catch {
          return
        }
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
        doneTimer = setTimeout(() => fail('P2P qabul vaqti tugadi'), DONE_TIMEOUT)
        return
      }
      chunks.push(ev.data as ArrayBuffer)
      received += (ev.data as ArrayBuffer).byteLength
      cb.onProgress?.({ sent: received, total: meta?.size ?? 0 })
      if (meta && received >= meta.size) {
        dc?.send('received')
        const blob = new Blob(chunks, { type: meta.mime || 'image/jpeg' })
        const name = meta.name || 'fayl'
        finished = true
        cleanup()
        cb.onDone(blob, name)
      }
    }
  }

  void (async () => {
    try {
      await pc.setRemoteDescription(opts.offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('p2p:signal', {
        to: opts.peerId,
        chatId: opts.chatId,
        payload: { kind: 'answer', sdp: pc.localDescription!.toJSON() },
      })
    } catch {
      fail('SDP javob yaratilmadi')
    }
  })()
}
