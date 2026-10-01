// Har bir foydalanuvchi uchun bitta Durable Object — uning barcha qurilmalaridagi WebSocket ulanishlari.
// Hibernation API: ulanish ochiq turganda ham DO uxlaydi (Free planda ishlaydi, SQLite backend).
export class UserSocket {
  state: any
  constructor(state: any, _env: unknown) {
    this.state = state
    try {
      // "ping" ga DO'ni uyg'otmasdan "pong" qaytaradi
      // @ts-ignore
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", '{"type":"pong"}'))
    } catch {}
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (req.headers.get("Upgrade") === "websocket") {
      // @ts-ignore
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as any[]
      this.state.acceptWebSocket(server)
      // @ts-ignore
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname === "/push" && req.method === "POST") {
      const body = await req.text()
      const sockets = this.state.getWebSockets()
      for (const ws of sockets) {
        try { ws.send(body) } catch {}
      }
      return new Response(JSON.stringify({ delivered: sockets.length }))
    }
    if (url.pathname === "/online") {
      return new Response(JSON.stringify({ online: this.state.getWebSockets().length > 0 }))
    }
    return new Response("not found", { status: 404 })
  }

  async webSocketMessage(ws: any, msg: string | ArrayBuffer) {
    if (msg === "ping") ws.send('{"type":"pong"}')
  }
  async webSocketClose(ws: any, code: number) {
    try { ws.close(code === 1005 ? 1000 : code, "bye") } catch {}
  }
  async webSocketError() {}
}
