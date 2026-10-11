// ============================================================
// UzbekGram Chat Service (WebSocket) — GIBRID MODEL YADROSI
// ============================================================
// printsip:
//  1. Xabar serverga keladi → DB ga yoziladi + yetkazilmagan
//     a'zolar uchun MessageDelivery qatorlari ochiladi
//  2. Onlayn a'zolarga darhol yetkaziladi
//  3. Har bir a'zo 'chat:ack' yuboradi → qatori o'chadi
//  4. Hammaga yetkazilgach: content = null, purged = true
//     → SERVERDAN MA'LUMOT O'CHIB KETADI (faqat "yetkazildi" belgisi qoladi)
//  5. Offline a'zolar onlayn bo'lgach 'chat:sync' orqali oladi → keyin purge
//  6. 7 kundan ortiq yetkazilmagan kontent ham avtomatik purge (maxfiylik)
// ============================================================

import { createServer } from 'http'
import { Server } from 'socket.io'
import { PrismaClient } from '@prisma/client'

// Baza: schema.prisma'dagi env("DATABASE_URL")dan o'z-o'zi oladi
// (bun .env'ni avtomatik yuklaydi, Docker'da compose env beradi)
const db = new PrismaClient()

const MAX_MEDIA_AGE_DAYS = 7 // yetkazilmagan media uchun maksimal saqlash muddati

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 8e6, // shifrlangan rasm payloadlari uchun
})

// socketId → { userId, username }
const sockets = new Map<string, { userId: string; username: string }>()
// userId → Set<socketId>
const userSockets = new Map<string, Set<string>>()

function socketsOf(userId: string): Set<string> {
  return userSockets.get(userId) ?? new Set()
}

function onlineUserIds(): string[] {
  return [...userSockets.keys()]
}

// Xabarni barcha a'zolar soketlariga yuborish
function emitToChat(chatId: string, event: string, payload: unknown, excludeSocketId?: string) {
  db.chatMember
    .findMany({ where: { chatId }, select: { userId: true } })
    .then((members) => {
      for (const m of members) {
        for (const sid of socketsOf(m.userId)) {
          if (sid !== excludeSocketId) io.to(sid).emit(event, payload)
        }
      }
    })
    .catch(() => {})
}

async function purgeIfDelivered(messageId: string) {
  const remaining = await db.messageDelivery.count({ where: { messageId } })
  if (remaining === 0) {
    const msg = await db.message.update({
      where: { id: messageId },
      data: { content: null, purged: true, deliveredAt: new Date() },
    })
    emitToChat(msg.chatId, 'chat:purged', {
      messageId: msg.id,
      chatId: msg.chatId,
      deliveredAt: msg.deliveredAt,
    })
    console.log(`[purge] ${msg.id} — serverdan o'chirildi`)
  }
}

// 7 kundan oshgan yetkazilmagan kontentni tozalash (maxfiylik himoyasi)
async function purgeStale() {
  const cutoff = new Date(Date.now() - MAX_MEDIA_AGE_DAYS * 24 * 3600 * 1000)
  const stale = await db.message.findMany({
    where: { purged: false, createdAt: { lt: cutoff } },
    select: { id: true },
  })
  for (const m of stale) {
    await db.messageDelivery.deleteMany({ where: { messageId: m.id } })
    const msg = await db.message.update({
      where: { id: m.id },
      data: { content: null, purged: true, deliveredAt: new Date() },
    })
    emitToChat(msg.chatId, 'chat:purged', { messageId: msg.id, chatId: msg.chatId })
  }
  if (stale.length) console.log(`[purge-stale] ${stale.length} ta eski xabar tozalandi`)
}

setInterval(() => void purgeStale(), 10 * 60 * 1000).unref()

io.on('connection', (socket) => {
  let authed = false

  socket.on('auth', async (data: { userId: string; token?: string }) => {
    try {
      const user = await db.user.findUnique({
        where: { id: String(data.userId || '') },
        select: { id: true, username: true, token: true, isBanned: true },
      })
      if (!user || !data.token || user.token !== data.token) {
        socket.emit('auth:error', { message: 'Avtorizatsiya xato' })
        return
      }
      // Admin tomonidan bloklangan foydalanuvchi ulana olmaydi
      if (user.isBanned) {
        socket.emit('auth:error', { message: 'Akkauntingiz bloklangan' })
        return
      }
      authed = true
      sockets.set(socket.id, { userId: user.id, username: user.username })
      if (!userSockets.has(user.id)) userSockets.set(user.id, new Set())
      userSockets.get(user.id)!.add(socket.id)

      socket.emit('auth:ok', {})
      socket.emit('presence:state', { online: onlineUserIds() })
      socket.broadcast.emit('presence:update', { userId: user.id, online: true })

      // Offline bo'lganimda to'plangan xabarlar — endi yetkazamiz
      const pending = await db.messageDelivery.findMany({
        where: { userId: user.id },
        select: { messageId: true },
      })
      if (pending.length) {
        const msgs = await db.message.findMany({
          where: { id: { in: pending.map((p) => p.messageId) } },
          orderBy: { createdAt: 'asc' },
        })
        const senders = await db.user.findMany({
          where: { id: { in: [...new Set(msgs.map((m) => m.senderId))] } },
          select: { id: true, name: true, avatar: true },
        })
        const senderMap = Object.fromEntries(senders.map((s) => [s.id, s]))
        socket.emit('chat:sync', {
          messages: msgs.map((m) => ({
            id: m.id,
            chatId: m.chatId,
            senderId: m.senderId,
            senderName: senderMap[m.senderId]?.name ?? '',
            senderAvatar: senderMap[m.senderId]?.avatar ?? '🙂',
            type: m.type,
            content: m.content,
            caption: m.caption,
            mediaName: m.mediaName,
            purged: false,
            createdAt: m.createdAt,
          })),
        })
        console.log(`[sync] ${user.username} ga ${msgs.length} ta kutgan xabar yetkazildi`)
      }
    } catch (e) {
      console.error('[auth] xato:', e)
    }
  })

  // ===== Xabar yuborish =====
  socket.on(
    'chat:send',
    async (data: {
      chatId: string
      tempId: string
      type: 'text' | 'image'
      content: string
      caption?: string
      mediaName?: string
      topicSlugs?: string[]
    }) => {
      if (!authed) return
      const me = sockets.get(socket.id)
      if (!me) return

      const { chatId, tempId, type } = data
      const content = String(data.content || '')
      const caption = String(data.caption || '').slice(0, 2000) || null
      if (!chatId || !tempId || (!content && !caption)) return

      // Bloklangan foydalanuvchi yozolmaydi (token bekor qilingan)
      const meFresh = await db.user.findUnique({
        where: { id: me.userId },
        select: { isBanned: true },
      })
      if (meFresh?.isBanned) {
        socket.emit('chat:error', { tempId, message: 'Akkauntingiz bloklangan' })
        return
      }

      const membership = await db.chatMember.findUnique({
        where: { chatId_userId: { chatId, userId: me.userId } },
      })
      if (!membership) {
        socket.emit('chat:error', { tempId, message: 'Siz bu chat a\u2018zosi emassiz' })
        return
      }

      const chat = await db.chat.findUnique({ where: { id: chatId } })
      if (!chat) return

      // Qora ro'yxatdagi foydalanuvchi yozolmaydi
      const banned = await db.chatBan.findUnique({
        where: { chatId_userId: { chatId, userId: me.userId } },
      })
      if (banned) {
        socket.emit('chat:error', { tempId, message: 'Siz bu chatga bloklangansiz' })
        return
      }

      // Shaxsiy suhbatda blok tekshiruvi
      if (chat.type === 'direct') {
        const otherMember = await db.chatMember.findFirst({
          where: { chatId, userId: { not: me.userId } },
          select: { userId: true },
        })
        if (otherMember) {
          const blockedByOther = await db.block.findUnique({
            where: { blockerId_blockedId: { blockerId: otherMember.userId, blockedId: me.userId } },
          })
          if (blockedByOther) {
            socket.emit('chat:error', { tempId, message: 'Foydalanuvchi sizni bloklagan' })
            return
          }
        }
      }

      // Kanalda faqat egasi va adminlar yozadi
      if (chat.type === 'channel' && !['owner', 'admin'].includes(membership.role)) {
        socket.emit('chat:error', { tempId, message: 'Kanalda faqat egasi va adminlar yozadi' })
        return
      }

      const members = await db.chatMember.findMany({
        where: { chatId },
        select: { userId: true },
      })
      const others = members.map((m) => m.userId).filter((id) => id !== me.userId)

      // KANAL: postlar doimiy saqlanadi (obunachilar keyin ham ko'radi)
      // DIRECT/GROUP: gibrid model — hamma yetkazgach serverdan o'chadi
      const isChannel = chat.type === 'channel'

      const msg = await db.message.create({
        data: {
          chatId,
          senderId: me.userId,
          type,
          content: content || null,
          caption,
          mediaName: data.mediaName || null,
          pending:
            isChannel
              ? undefined
              : { create: others.map((userId) => ({ userId })) },
        },
      })

      // Yuboruvchiga tasdiq (tempId → real id)
      socket.emit('chat:sent', { tempId, messageId: msg.id, createdAt: msg.createdAt })

      // Barcha a'zolarga yetkazish
      const sender = await db.user.findUnique({
        where: { id: me.userId },
        select: { name: true, avatar: true },
      })
      const payload = {
        id: msg.id,
        chatId,
        senderId: me.userId,
        senderName: sender?.name ?? '',
        senderAvatar: sender?.avatar ?? '🙂',
        type,
        content: content || null,
        caption,
        mediaName: data.mediaName || null,
        purged: false,
        createdAt: msg.createdAt,
      }
      for (const userId of [...others, me.userId]) {
        for (const sid of socketsOf(userId)) {
          io.to(sid).emit('chat:message', payload)
        }
      }

      // Kanal postiga: Lenta uchun FeedPost ham yaratamiz (izoh bilan)
      if (chat.type === 'channel') {
        let topicIds: string[] = []
        if (Array.isArray(data.topicSlugs) && data.topicSlugs.length) {
          const topics = await db.topic.findMany({ where: { slug: { in: data.topicSlugs } } })
          topicIds = topics.map((t) => t.id)
        }
        await db.feedPost.create({
          data: {
            authorId: me.userId,
            channelId: chat.id,
            channelName: chat.name,
            content: caption || (type === 'text' ? content : '📷 Rasmli post'),
            gradient: type === 'image' ? 'from-sky-400 to-blue-600' : 'from-emerald-400 to-teal-600',
            emoji: chat.avatar || '📢',
            sourceMessageId: msg.id,
            topics: topicIds.length ? { create: topicIds.map((topicId) => ({ topicId })) } : undefined,
          },
        })
      }

      console.log(`[msg] ${me.username} → chat ${chatId} (${type}, ${content.length} bayt)`)
    }
  )

  // ===== Yetkazildi tasdiqlash → purge =====
  socket.on('chat:ack', async (data: { messageIds: string[] }) => {
    if (!authed) return
    const me = sockets.get(socket.id)
    if (!me) return
    const ids: string[] = Array.isArray(data.messageIds) ? data.messageIds.slice(0, 100) : []

    for (const messageId of ids) {
      const row = await db.messageDelivery.findUnique({
        where: { messageId_userId: { messageId, userId: me.userId } },
      })
      if (!row) continue
      await db.messageDelivery.delete({
        where: { messageId_userId: { messageId, userId: me.userId } },
      })
      await purgeIfDelivered(messageId)
    }
  })

  // ===== "yozmoqda..." indikatori =====
  socket.on('chat:typing', (data: { chatId: string }) => {
    if (!authed) return
    const me = sockets.get(socket.id)
    if (!me) return
    emitToChat(data.chatId, 'chat:typing', { chatId: data.chatId, userId: me.userId, name: me.username }, socket.id)
  })

  // ===== Butun chat tarixini o'chirish (tozalash) =====
  // Kanal/guruh: faqat egasi/admin. Shaxsiy suhbat: istalgan a'zo o'z nusxasi uchun tozalashi mumkin.
  socket.on('chat:clear', async (data: { chatId: string }) => {
    if (!authed) return
    const me = sockets.get(socket.id)
    if (!me) return

    const chatId = String(data.chatId || '')
    if (!chatId) return

    const membership = await db.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: me.userId } },
    })
    if (!membership) return

    const chat = await db.chat.findUnique({ where: { id: chatId } })
    if (!chat) return

    const isAdmin = ['owner', 'admin'].includes(membership.role)
    if (chat.type !== 'direct' && !isAdmin) {
      socket.emit('chat:error', { tempId: chatId, message: 'Tozalashga ruxsat yo\u2018q' })
      return
    }

    // Lenta nusxalarini ham o'chiramiz
    const msgs = await db.message.findMany({ where: { chatId }, select: { id: true } })
    for (const m of msgs) {
      await db.feedPost.deleteMany({ where: { sourceMessageId: m.id } })
    }

    const del = await db.message.deleteMany({ where: { chatId } })
    await db.messageDelivery.deleteMany({ where: { messageId: { in: msgs.map((m) => m.id) } } }).catch(() => {})

    emitToChat(chatId, 'chat:cleared', { chatId })
    console.log(`[clear] ${me.username} → chat ${chatId}: ${del.count} xabar o'chirildi`)
  })

  // ===== Kanal postini / xabarni o'chirish (muallif yoki egasi/admin) =====
  socket.on('chat:delete', async (data: { chatId: string; messageId: string }) => {
    if (!authed) return
    const me = sockets.get(socket.id)
    if (!me) return

    const chatId = String(data.chatId || '')
    const messageId = String(data.messageId || '')
    if (!chatId || !messageId) return

    const membership = await db.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: me.userId } },
    })
    if (!membership) return

    const msg = await db.message.findUnique({ where: { id: messageId } })
    if (!msg || msg.chatId !== chatId) return

    const canDelete =
      msg.senderId === me.userId ||
      ['owner', 'admin'].includes(membership.role)
    if (!canDelete) {
      socket.emit('chat:error', { tempId: messageId, message: 'O\u2018chirishga ruxsat yo\u2018q' })
      return
    }

    await db.message.delete({ where: { id: messageId } }).catch(() => {})
    // Lenta nusxasini ham o'chiramiz (bog'langan bo'lsa)
    await db.feedPost.deleteMany({ where: { sourceMessageId: messageId } })

    emitToChat(chatId, 'chat:deleted', { chatId, messageId })
    console.log(`[delete] ${me.username} → msg ${messageId} o'chirildi`)
  })

  // ===== Postni qadash / yechish (egasi/admin) =====
  socket.on('chat:pin', async (data: { chatId: string; messageId: string; pinned: boolean }) => {
    if (!authed) return
    const me = sockets.get(socket.id)
    if (!me) return

    const chatId = String(data.chatId || '')
    const messageId = String(data.messageId || '')
    const pinned = !!data.pinned

    const membership = await db.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId: me.userId } },
    })
    if (!membership || !['owner', 'admin'].includes(membership.role)) return

    const msg = await db.message.update({
      where: { id: messageId },
      data: { pinned },
    }).catch(() => null)
    if (!msg || msg.chatId !== chatId) return

    emitToChat(chatId, 'chat:pinned', { chatId, messageId, pinned })
  })

  socket.on('disconnect', () => {
    const me = sockets.get(socket.id)
    if (me) {
      const set = userSockets.get(me.userId)
      set?.delete(socket.id)
      if (set && set.size === 0) {
        userSockets.delete(me.userId)
        socket.broadcast.emit('presence:update', { userId: me.userId, online: false })
      }
      sockets.delete(socket.id)
    }
  })

  socket.on('error', (err) => console.error(`[socket] ${socket.id}:`, err))
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`50 Gram Chat Service — port ${PORT} (gibrid model: yetkazildi → purge)`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
