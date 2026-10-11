'use client'

// ============================================================
// 50 Gram — Real-time klient (Cloudflare Durable Object WebSocket)
// socket.io-client bilan bir xil minimal API: on/off/emit/disconnect.
// Frame format: { e: "event", d: data }
// ============================================================

type Handler = (data: any) => void

export class RealtimeSocket {
  connected = false
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private attempts = 0
  private manualClose = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private base: string,
    private userId: string,
    private getToken: () => string | null
  ) {
    this.open()
  }

  private url(): string {
    let b = this.base
    if (!/^wss?:\/\//.test(b)) {
      b = (typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss://' : 'ws://') + b
    }
    return /\/ws$/.test(b) ? b : b.replace(/\/$/, '') + '/ws'
  }

  private open() {
    try {
      this.ws = new WebSocket(this.url())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.connected = true
      this.attempts = 0
      this.fire('connect', {})
      // DO auth frame kutadi
      this.emit('auth', { userId: this.userId, token: this.getToken() })
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ e: 'ping' }))
      }, 25_000)
    }
    this.ws.onclose = () => {
      const was = this.connected
      this.connected = false
      if (this.pingTimer) clearInterval(this.pingTimer)
      if (was) this.fire('disconnect', {})
      if (!this.manualClose) this.scheduleReconnect()
    }
    this.ws.onerror = () => {}
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      try {
        const frame = JSON.parse(ev.data)
        if (frame?.e) this.fire(frame.e, frame.d ?? {})
      } catch {}
    }
  }

  private scheduleReconnect() {
    if (this.attempts >= 10) return
    this.attempts++
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.open(), 1500)
  }

  private fire(event: string, data: unknown) {
    const set = this.handlers.get(event)
    if (set) for (const fn of [...set]) fn(data)
  }

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn)
  }

  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn)
  }

  emit(event: string, data?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ e: event, d: data ?? {} }))
    }
  }

  disconnect() {
    this.manualClose = true
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}
