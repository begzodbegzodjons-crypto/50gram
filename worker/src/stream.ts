// =====================================================================
// StreamRoom — jonli efir xonasi (Durable Object).
//
// CHEKSIZ TOMOSHABIN: har bir DO bitta efirni ko'taradi. Tomoshabinlar
// limitga (STREAM_SHARD_CAP, default 300) yetganda yangi "mirror" DO
// avtomatik ochiladi — mirror ildiz (root) DO'dan bo'linmalarni oladi va
// o'z tomoshabinlariga tarqatadi. Shu tarzda mirror'lar cheksiz qo'shiladi.
//
//  host ──WS──► ROOT DO ──WS──► tomoshabinlar (gacha CAP)
//                  │
//                  ├──/push──► MIRROR-1 DO ──WS──► tomoshabinlar (gacha CAP)
//                  ├──/push──► MIRROR-2 DO ──WS──► ...
//                  └── ... (kerak bo'lganda avtomatik ochiladi)
//
// Funksiyalar: jonli video/ovoz, ko'ruvchilar soni (hozir/unikal/peak),
// yurakchalar (layk), efir chati (muhokama), efir tugaganda statistika.
// =====================================================================
import type { Env } from "./index"

type Att = { role: "host" | "viewer" | "mirror"; uid?: number }

export class StreamRoom {
  private cap: number
  private isMirror: boolean
  private streamId: string

  // ---- root holati ----
  private mime: string | null = null
  private firstChunk: ArrayBuffer | null = null
  private mirrors = new Map<number, number>()   // mirrorIndex -> tomoshabinlar soni
  private uids = new Set<string>()              // unikal ko'ruvchilar
  private likes = 0
  private comments = 0
  private peak = 0
  private ended = false

  // ---- mirror holati ----
  private mCache: ArrayBuffer | null = null

  constructor(private state: DurableObjectState, private env: Env) {
    this.streamId = state.id.name || state.id.toString()
    this.isMirror = this.streamId.includes(":")
    this.cap = Math.max(2, Number(env.STREAM_SHARD_CAP || 300))
  }

  private j(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
  }

  private sockets(): WebSocket[] {
    return this.state.getWebSockets()
  }

  private directViewers(): number {
    return this.sockets().filter((ws) => {
      const a = ws.deserializeAttachment() as Att | null
      return a?.role === "viewer"
    }).length
  }

  private mirrorViewers(): number {
    let n = 0
    for (const v of this.mirrors.values()) n += v
    return n
  }

  private viewersNow(): number {
    return this.directViewers() + this.mirrorViewers()
  }

  // root: hozirgi holatni barcha qurilmalarga (direct + mirror) yuborish
  private broadcast(json: unknown, includeHost = true) {
    const msg = JSON.stringify(json)
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment() as Att | null
      if (!includeHost && a?.role === "host") continue
      if (a?.role === "viewer" || (includeHost && a?.role === "host")) {
        try { ws.send(msg) } catch {}
      }
    }
    this.ctlMirrors(json)
  }

  // root -> barcha mirror'lar: /ctl POST
  private ctlMirrors(json: unknown) {
    if (this.isMirror) return
    const body = JSON.stringify(json)
    for (const i of this.mirrors.keys()) {
      this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(`${this.streamId}:${i}`))
        .fetch("https://do/ctl", { method: "POST", body })
        .catch(() => {})
    }
  }

  // root -> barcha mirror'lar: bo'linma (binary) POST
  private pushMirrors(chunk: ArrayBuffer) {
    if (this.isMirror) return
    for (const i of this.mirrors.keys()) {
      this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(`${this.streamId}:${i}`))
        .fetch("https://do/push", { method: "POST", body: chunk })
        .catch(() => {})
    }
  }

  private touchViewers() {
    const now = this.viewersNow()
    if (now > this.peak) this.peak = now
    this.broadcast({ t: "viewers", now, total: this.uids.size, likes: this.likes, comments: this.comments })
  }

  private end(stats?: { peak?: number; total?: number; likes?: number; comments?: number }) {
    if (this.ended) return
    this.ended = true
    const s = {
      peak: stats?.peak ?? this.peak,
      total: stats?.total ?? this.uids.size,
      likes: stats?.likes ?? this.likes,
      comments: stats?.comments ?? this.comments,
    }
    this.broadcast({ t: "ended", stats: s })
    for (const ws of this.sockets()) try { ws.close(1000, "ended") } catch {}
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, "")

    // ---------- MIRROR ----------
    if (this.isMirror) {
      // root'dan yangi bo'linma keldi — barcha tomoshabinlarga tarqatamiz
      if (path === "/push" && req.method === "POST") {
        const buf = await req.arrayBuffer()
        if (!this.mCache) this.mCache = buf
        for (const ws of this.sockets()) {
          const a = ws.deserializeAttachment() as Att | null
          if (a?.role === "viewer") try { ws.send(buf) } catch {}
        }
        return new Response("ok")
      }
      // root'dan boshqaruv xabari (viewers/chat/like/ended)
      if (path === "/ctl" && req.method === "POST") {
        const msg = await req.text()
        for (const ws of this.sockets()) {
          const a = ws.deserializeAttachment() as Att | null
          if (a?.role === "viewer") try { ws.send(msg) } catch {}
        }
        if (JSON.parse(msg).t === "ended") {
          for (const ws of this.sockets()) try { ws.close(1000, "ended") } catch {}
        }
        return new Response("ok")
      }
    }

    // ---------- UMUMIY (root + mirror): WebSocket ulanish ----------
    if (req.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const server = pair[1]
      this.state.acceptWebSocket(server)

      if (this.isMirror) {
        server.serializeAttachment({ role: "viewer" } as Att)
        server.send(JSON.stringify({ t: "hello", mime: this.mime }))
        if (this.mCache) server.send(this.mCache)             // kech qo'shilganlar ham to'liq ko'radi
        const idx = Number(this.streamId.split(":")[1] || 0)
        // o'zini root'ga tanishtirish (hozirgi tomoshabinlar soni bilan)
        this.reportToRoot(idx, "join").catch(() => {})
      } else {
        const role = (new URL(req.url).searchParams.get("role") === "host" ? "host" : "viewer") as Att["role"]
        server.serializeAttachment({ role } as Att)
        if (role === "host") {
          this.ended = false
          server.send(JSON.stringify({ t: "hello", host: true }))
        } else {
          server.send(JSON.stringify({ t: "hello", mime: this.mime, live: !this.ended && !!this.mime }))
          if (this.firstChunk) server.send(this.firstChunk)    // init bo'linma — kech qo'shilganlar uchun
          this.touchViewers()
        }
      }
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    // ---------- ROOT: tomoshabin bo'linish qarori (sharding) ----------
    if (path === "/enter" && req.method === "POST") {
      const { uid, role } = (await req.json()) as { uid: number; role: string }
      if (role === "host" || this.ended) return this.j({ mode: "direct" })
      const direct = this.directViewers()
      if (direct + 1 <= this.cap) return this.j({ mode: "direct" })
      // sig'madi — joy bo'lgan mirrorni topamiz, bo'lmasa yangi ochamiz
      let target = -1
      for (const [i, v] of this.mirrors) if (v + 1 <= this.cap) { target = i; break }
      if (target === -1) {
        target = this.mirrors.size ? Math.max(...this.mirrors.keys()) + 1 : 0
        this.mirrors.set(target, 0)
      }
      return this.j({ mode: "mirror", mirror: target, uid })
    }

    // ---------- ROOT: mirror hisobotlari ----------
    if (path === "/join" && req.method === "POST") {
      const { uid, mirror, count } = (await req.json()) as { uid: number; mirror: number; count: number }
      if (typeof mirror === "number") this.mirrors.set(mirror, Math.max(0, count))
      this.uids.add(String(uid))
      this.touchViewers()
      return new Response("ok")
    }

    if (path === "/leave" && req.method === "POST") {
      const { uid, mirror, count } = (await req.json()) as { uid: number; mirror: number; count: number }
      if (typeof mirror === "number") {
        if (Math.max(0, count) === 0) this.mirrors.delete(mirror)
        else this.mirrors.set(mirror, count)
      }
      this.touchViewers()
      return new Response("ok")
    }

    if (path === "/like" && req.method === "POST") {
      const { from } = (await req.json()) as { from?: number }
      this.likes++
      this.broadcast({ t: "like", likes: this.likes, from })
      return new Response("ok")
    }

    if (path === "/chat" && req.method === "POST") {
      const { from, name, text } = (await req.json()) as { from: number; name: string; text: string }
      this.comments++
      this.broadcast({ t: "chat", from, name, text: String(text).slice(0, 300), comments: this.comments })
      return new Response("ok")
    }

    // ---------- ROOT: host meta/mime mirror'larga ----------
    if (path === "/init" && req.method === "POST") {
      const { mime } = (await req.json()) as { mime: string }
      this.mime = mime
      return new Response("ok")
    }

    // ---------- ROOT: statistika ----------
    if (path === "/stats" && req.method === "POST") {
      return this.j({
        live: !this.ended && !!this.mime,
        viewers_now: this.viewersNow(),
        viewers_peak: this.peak,
        viewers_total: this.uids.size,
        likes: this.likes,
        comments: this.comments,
        mirrors: this.mirrors.size,
        cap: this.cap,
      })
    }

    // ---------- ROOT: tashqaridan to'xtatish (host WS yopilganda ham) ----------
    if (path === "/stop" && req.method === "POST") {
      this.end()
      return new Response("ok")
    }

    return this.j({ error: "Noma'lum yo'l" }, 404)
  }

  // mirror: root'ga a'zo hisobotini yuborish
  private async reportToRoot(idx: number, what: "join" | "leave") {
    const root = this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(this.streamId.split(":")[0]))
    const count = this.directViewers()
    const uid = 0 // unikal hisob root'da umumiy — mirror faqat son beradi
    const path = what === "join" ? "/join" : "/leave"
    await root.fetch(`https://do${path}`, { method: "POST", body: JSON.stringify({ uid, mirror: idx, count }) })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (data === "ping") return ws.send("pong")
    const att = (ws.deserializeAttachment() as Att | null) || { role: "viewer" as const }

    // ---- HOST (root) ----
    if (att.role === "host" && !this.isMirror) {
      if (typeof data === "string") {
        let m: any = null
        try { m = JSON.parse(data) } catch {}
        if (!m) return
        if (m.t === "meta" && m.mime) {
          this.mime = String(m.mime)
          for (const i of this.mirrors.keys())
            this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(`${this.streamId}:${i}`))
              .fetch("https://do/init", { method: "POST", body: JSON.stringify({ mime: this.mime }) }).catch(() => {})
          this.broadcast({ t: "init", mime: this.mime }, false)
        } else if (m.t === "end") {
          this.end()
        }
        return
      }
      // media bo'linma: cache (kech qo'shilganlar uchun) + tarqatish
      const buf = data as ArrayBuffer
      if (!this.firstChunk) this.firstChunk = buf.slice(0)
      for (const ws2 of this.sockets()) {
        const a = ws2.deserializeAttachment() as Att | null
        if (a?.role === "viewer") try { ws2.send(buf) } catch {}
      }
      this.pushMirrors(buf)
      return
    }

    // ---- TOMOSHABIN (root yoki mirror) ----
    if (att.role === "viewer" && typeof data === "string") {
      let m: any = null
      try { m = JSON.parse(data) } catch {}
      if (!m) return

      if (m.t === "like") {
        const root = this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(this.streamId.split(":")[0]))
        await root.fetch("https://do/like", { method: "POST", body: JSON.stringify({ from: m.from || att.uid || 0 }) }).catch(() => {})
      } else if (m.t === "chat") {
        const root = this.env.STREAM_ROOM.get(this.env.STREAM_ROOM.idFromName(this.streamId.split(":")[0]))
        await root.fetch("https://do/chat", {
          method: "POST",
          body: JSON.stringify({ from: m.from || att.uid || 0, name: String(m.name || "Mehmon").slice(0, 40), text: String(m.text || "").slice(0, 300) }),
        }).catch(() => {})
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = (ws.deserializeAttachment() as Att | null) || null
    if (this.isMirror) {
      const idx = Number(this.streamId.split(":")[1] || 0)
      this.reportToRoot(idx, "leave").catch(() => {})
      return
    }
    if (att?.role === "host") this.end()
    else this.touchViewers()
  }
}
