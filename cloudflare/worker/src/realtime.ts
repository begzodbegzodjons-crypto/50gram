// ============================================================
// 50 Gram Worker — UserSocket Durable Object (real-time yadro)
// Har foydalanuvchi uchun bitta DO — barcha qurilmalari shu yerga ulanadi.
// Hibernation API: ulanish kutish holatida resurs sarflamaydi (bepul tarifga mos).
// Framlar: { e: "event", d: data } — ikkala yo'nalishda.
// ============================================================
import type { Env } from './env'
import { openDb, q, one, count, exec, type Conn } from './db'
import { verifyJwt } from './auth'
import { newId, nowMs, isoOf, str, bool } from './util'

interface SocketMeta {
  authed: boolean
}

export class UserSocket {
  private conn: Conn
  private userId: string
  private env: Env

  constructor(private state: DurableObjectState, env: Env) {
    this.conn = openDb(env.DATABASE_URL)
    this.userId = state.id.toString()
    this.env = env
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // Worker/dastur: bu foydalanuvchining barcha qurilmalariga signal
    if (url.pathname === '/notify') {
      const msg = await req.text()
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(msg)
        } catch {}
      }
      return new Response('ok')
    }

    // Qurilma: WebSocket ulanish
    if (req.headers.get('upgrade') !== 'websocket') {
      return new Response('WebSocket kerak', { status: 426 })
    }
    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ authed: false } as SocketMeta)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // ---------- yordamchi: hamma ulanishlarga event ----------
  private send(ws: WebSocket | null, event: string, data: unknown) {
    const payload = JSON.stringify({ e: event, d: data })
    if (ws) {
      try {
        ws.send(payload)
      } catch {}
    } else {
      for (const s of this.state.getWebSockets()) {
        try {
          s.send(payload)
        } catch {}
      }
    }
  }

  // Boshqa foydalanuvchining DO'siga event yuborish
  private async notifyOther(env: Env, userId: string, event: string, data: unknown) {
    try {
      const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(userId))
      await stub.fetch('https://do/notify', {
        method: 'POST',
        body: JSON.stringify({ e: event, d: data }),
      })
    } catch {}
  }

  // Chat a'zolarining barchasiga (o'zini ham) event
  private async emitToChat(env: Env, conn: Conn, chatId: string, event: string, data: unknown) {
    const members = await q<{ user_id: string }>(conn, 'SELECT user_id FROM chat_members WHERE chat_id=?', [chatId])
    for (const m of members) {
      if (m.user_id === this.userId) this.send(null, event, data)
      else await this.notifyOther(env, m.user_id, event, data)
    }
  }

  // Onlaynlar ro'yxati (70s ichida heartbeat qilganlar)
  private async onlineIds(conn: Conn): Promise<string[]> {
    const rows = await q<{ user_id: string }>(
      conn,
      'SELECT user_id FROM presence WHERE updated_ms > ?',
      [nowMs() - 70_000]
    )
    return rows.map((r) => r.user_id)
  }

  // ---------- Hammaga yetkazilgach: serverdan o'chirish ----------
  private async purgeIfDelivered(env: Env, conn: Conn, messageId: string) {
    const remaining = await count(conn, 'SELECT COUNT(*) AS n FROM message_delivery WHERE message_id=?', [messageId])
    if (remaining === 0) {
      const msg = await one<{ id: string; chat_id: string }>(
        conn,
        'SELECT id, chat_id FROM messages WHERE id=?',
        [messageId]
      )
      if (!msg) return
      await exec(conn, 'UPDATE messages SET content=NULL, purged=1 WHERE id=?', [messageId])
      await this.emitToChat(env, conn, msg.chat_id, 'chat:purged', {
        messageId: msg.id,
        chatId: msg.chat_id,
        deliveredAt: isoOf(nowMs()),
      })
    }
  }

  // ---------- xabar seriyalash ----------
  private async serializeMsg(conn: Conn, messageId: string) {
    const m = await one<any>(
      conn,
      `SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
       FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id=?`,
      [messageId]
    )
    if (!m) return null
    return {
      id: m.id,
      chatId: m.chat_id,
      senderId: m.sender_id,
      senderName: m.sender_name ?? '',
      senderAvatar: m.sender_avatar ?? '🙂',
      type: m.type,
      content: bool(m.purged) ? null : m.content ?? null,
      caption: m.caption ?? null,
      pinned: bool(m.pinned),
      mediaName: m.media_name ?? null,
      purged: bool(m.purged),
      createdAt: isoOf(Number(m.created_ms)),
    }
  }

  // ============================================================
  // WebSocket xabarlari
  // ============================================================
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let frame: { e: string; d?: any }
    try {
      frame = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
    } catch {
      if (data === 'ping') return ws.send('pong')
      return
    }

    const env = this.env
    const meta = ws.deserializeAttachment() as SocketMeta

    // ---------- AUTH ----------
    if (frame.e === 'auth') {
      const token = String(frame.d?.token || '')
      const payload = await verifyJwt(token, env.JWT_SECRET)
      if (!payload || payload.sub !== this.userId) {
        this.send(ws, 'auth:error', { message: 'Avtorizatsiya xato' })
        return
      }
      const user = await one<any>(this.conn, 'SELECT id, is_banned FROM users WHERE id=?', [this.userId])
      if (!user) {
        this.send(ws, 'auth:error', { message: 'Avtorizatsiya xato' })
        return
      }
      if (bool(user.is_banned)) {
        this.send(ws, 'auth:error', { message: 'Akkauntingiz bloklangan' })
        return
      }
      meta.authed = true
      ws.serializeAttachment(meta)
      this.send(ws, 'auth:ok', {})
      this.send(ws, 'presence:state', { online: await this.onlineIds(this.conn) })

      // presence yangilash + hamma onlaynlarga "kelib qoldi"
      await exec(this.conn, 'INSERT INTO presence (user_id, updated_ms) VALUES (?,?) ON DUPLICATE KEY UPDATE updated_ms=?', [
        this.userId,
        nowMs(),
        nowMs(),
      ])
      const others = (await this.onlineIds(this.conn)).filter((id) => id !== this.userId)
      for (const uid of others) await this.notifyOther(env, uid, 'presence:update', { userId: this.userId, online: true })

      // Offline bo'lganimda to'plangan xabarlar — chat:sync
      const msgs = await q<any>(
        this.conn,
        `SELECT m.id FROM message_delivery d JOIN messages m ON m.id = d.message_id
         WHERE d.user_id=? ORDER BY m.created_ms ASC LIMIT 200`,
        [this.userId]
      )
      if (msgs.length) {
        const serialized = (await Promise.all(msgs.map((m) => this.serializeMsg(this.conn, m.id)))).filter(Boolean)
        this.send(ws, 'chat:sync', { messages: serialized })
      }
      return
    }

    if (!meta.authed) return

    switch (frame.e) {
      case 'ping': {
        await exec(this.conn, 'UPDATE presence SET updated_ms=? WHERE user_id=?', [nowMs(), this.userId]).catch(() => {})
        return ws.send('pong')
      }

      case 'chat:typing': {
        const chatId = str(frame.d?.chatId, 26)
        if (!chatId) return
        const me = await one<{ username: string; name: string }>(this.conn, 'SELECT username, name FROM users WHERE id=?', [this.userId])
        const members = await q<{ user_id: string }>(this.conn, 'SELECT user_id FROM chat_members WHERE chat_id=?', [chatId])
        for (const m of members) {
          if (m.user_id === this.userId) continue
          await this.notifyOther(env, m.user_id, 'chat:typing', { chatId, userId: this.userId, name: me?.username ?? me?.name ?? '' })
        }
        return
      }

      // ===== XABAR YUBORISH =====
      case 'chat:send': {
        const chatId = str(frame.d?.chatId, 26)
        const tempId = str(frame.d?.tempId, 40)
        const type = ['text', 'image'].includes(frame.d?.type) ? frame.d.type : 'text'
        const content = str(frame.d?.content, 6_000_000)
        const caption = str(frame.d?.caption, 2000) || null
        const mediaName = str(frame.d?.mediaName, 255) || null
        if (!chatId || !tempId || (!content && !caption)) return

        const meFresh = await one<{ is_banned: number }>(this.conn, 'SELECT is_banned FROM users WHERE id=?', [this.userId])
        if (bool(meFresh?.is_banned)) return this.send(ws, 'chat:error', { tempId, message: 'Akkauntingiz bloklangan' })

        const membership = await one<any>(this.conn, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, this.userId])
        if (!membership) return this.send(ws, 'chat:error', { tempId, message: 'Siz bu chat a\u2018zosi emassiz' })

        const chat = await one<any>(this.conn, 'SELECT * FROM chats WHERE id=?', [chatId])
        if (!chat) return
        if (await one(this.conn, 'SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?', [chatId, this.userId]))
          return this.send(ws, 'chat:error', { tempId, message: 'Siz bu chatga bloklangansiz' })

        if (chat.type === 'direct') {
          const other = await one<{ user_id: string }>(
            this.conn,
            'SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?',
            [chatId, this.userId]
          )
          if (other && (await one(this.conn, 'SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?', [other.user_id, this.userId]))) {
            return this.send(ws, 'chat:error', { tempId, message: 'Foydalanuvchi sizni bloklagan' })
          }
        }
        if (chat.type === 'channel' && !['owner', 'admin'].includes(membership.role)) {
          return this.send(ws, 'chat:error', { tempId, message: 'Kanalda faqat egasi va adminlar yozadi' })
        }

        const isChannel = chat.type === 'channel'
        const members = await q<{ user_id: string }>(this.conn, 'SELECT user_id FROM chat_members WHERE chat_id=?', [chatId])
        const others = members.map((m) => m.user_id).filter((id) => id !== this.userId)

        const msgId = newId()
        const createdMs = nowMs()
        await exec(
          this.conn,
          'INSERT INTO messages (id,chat_id,sender_id,type,content,caption,media_name,created_ms) VALUES (?,?,?,?,?,?,?,?)',
          [msgId, chatId, this.userId, type, content || null, caption, mediaName, createdMs]
        )
        if (!isChannel) {
          for (const uid of others) {
            await exec(this.conn, 'INSERT IGNORE INTO message_delivery (message_id,user_id) VALUES (?,?)', [msgId, uid])
          }
        }

        // yuboruvchiga tasdiq
        this.send(ws, 'chat:sent', { tempId, messageId: msgId, createdAt: isoOf(createdMs) })

        // hammaga yetkazish
        const payload = await this.serializeMsg(this.conn, msgId)
        if (payload) {
          for (const uid of [...others, this.userId]) {
            if (uid === this.userId) this.send(null, 'chat:message', payload)
            else await this.notifyOther(env, uid, 'chat:message', payload)
          }
        }

        // kanal posti → lenta nusxasi
        if (isChannel) {
          await exec(
            this.conn,
            'INSERT INTO feed_posts (id,author_id,channel_id,channel_name,content,gradient,emoji,source_message_id,created_ms) VALUES (?,?,?,?,?,?,?,?,?)',
            [
              newId(),
              this.userId,
              chat.id,
              chat.name,
              caption || (type === 'text' ? content : '📷 Rasmli post'),
              type === 'image' ? 'from-sky-400 to-blue-600' : 'from-emerald-400 to-teal-600',
              chat.avatar || '📢',
              msgId,
              nowMs(),
            ]
          )
        }
        return
      }

      // ===== YETKAZILDI TASDIQI → PURGE =====
      case 'chat:ack': {
        const ids: string[] = Array.isArray(frame.d?.messageIds) ? frame.d.messageIds.slice(0, 200).map((v: unknown) => str(v, 26)) : []
        for (const messageId of ids) {
          const row = await one(this.conn, 'SELECT 1 FROM message_delivery WHERE message_id=? AND user_id=?', [messageId, this.userId])
          if (!row) continue
          await exec(this.conn, 'DELETE FROM message_delivery WHERE message_id=? AND user_id=?', [messageId, this.userId])
          await this.purgeIfDelivered(env, this.conn, messageId)
        }
        return
      }

      // ===== TOZALASH =====
      case 'chat:clear': {
        const chatId = str(frame.d?.chatId, 26)
        if (!chatId) return
        const membership = await one<any>(this.conn, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, this.userId])
        if (!membership) return
        const chat = await one<any>(this.conn, 'SELECT type FROM chats WHERE id=?', [chatId])
        if (!chat) return
        const isAdmin = ['owner', 'admin'].includes(membership.role)
        if (chat.type !== 'direct' && !isAdmin) {
          return this.send(ws, 'chat:error', { tempId: chatId, message: 'Tozalashga ruxsat yo\u2018q' })
        }
        const msgs = await q<{ id: string }>(this.conn, 'SELECT id FROM messages WHERE chat_id=?', [chatId])
        if (msgs.length) {
          const ph = msgs.map(() => '?').join(',')
          await exec(this.conn, `DELETE FROM feed_posts WHERE source_message_id IN (${ph})`, msgs.map((m) => m.id))
          await exec(this.conn, `DELETE FROM message_delivery WHERE message_id IN (${ph})`, msgs.map((m) => m.id))
          await exec(this.conn, `DELETE FROM messages WHERE id IN (${ph})`, msgs.map((m) => m.id))
        }
        await this.emitToChat(env, this.conn, chatId, 'chat:cleared', { chatId })
        return
      }

      // ===== O'CHIRISH =====
      case 'chat:delete': {
        const chatId = str(frame.d?.chatId, 26)
        const messageId = str(frame.d?.messageId, 26)
        if (!chatId || !messageId) return
        const membership = await one<any>(this.conn, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, this.userId])
        if (!membership) return
        const msg = await one<{ sender_id: string }>(this.conn, 'SELECT sender_id FROM messages WHERE id=? AND chat_id=?', [messageId, chatId])
        if (!msg) return
        const canDelete = msg.sender_id === this.userId || ['owner', 'admin'].includes(membership.role)
        if (!canDelete) return this.send(ws, 'chat:error', { tempId: messageId, message: 'O\u2018chirishga ruxsat yo\u2018q' })

        await exec(this.conn, 'DELETE FROM messages WHERE id=?', [messageId])
        await exec(this.conn, 'DELETE FROM feed_posts WHERE source_message_id=?', [messageId])
        await this.emitToChat(env, this.conn, chatId, 'chat:deleted', { chatId, messageId })
        return
      }

      // ===== QADASH =====
      case 'chat:pin': {
        const chatId = str(frame.d?.chatId, 26)
        const messageId = str(frame.d?.messageId, 26)
        const pinned = !!frame.d?.pinned
        if (!chatId || !messageId) return
        const membership = await one<any>(this.conn, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, this.userId])
        if (!membership || !['owner', 'admin'].includes(membership.role)) return
        const msg = await one<{ chat_id: string }>(this.conn, 'SELECT chat_id FROM messages WHERE id=?', [messageId])
        if (!msg || msg.chat_id !== chatId) return
        await exec(this.conn, 'UPDATE messages SET pinned=? WHERE id=?', [pinned, messageId])
        await this.emitToChat(env, this.conn, chatId, 'chat:pinned', { chatId, messageId, pinned })
        return
      }
    }
  }

  // ---------- uzilish: presence'dan o'chirish ----------
  async webSocketClose(ws: WebSocket) {
    const env = this.env
    try {
      ws.close()
    } catch {}
    // boshqa ulanish qolmagan bo'lsa — offline
    if (this.state.getWebSockets().length === 0) {
      await exec(this.conn, 'DELETE FROM presence WHERE user_id=?', [this.userId]).catch(() => {})
      if (env) {
        const others = await this.onlineIds(this.conn)
        for (const uid of others) await this.notifyOther(env, uid, 'presence:update', { userId: this.userId, online: false })
      }
    }
  }
}
