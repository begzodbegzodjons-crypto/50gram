import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Chatlar ro'yxati =====
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const myMemberships = await db.chatMember.findMany({ where: { userId: me.id } })
  const chatIds = myMemberships.map((m) => m.chatId)
  if (!chatIds.length) return Response.json([])

  const chats = await db.chat.findMany({
    where: { id: { in: chatIds } },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatar: true, username: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  // O'qilmaganlar: men uchun yetkazilmagan xabarlar
  const undelivered = await db.messageDelivery.groupBy({
    by: ['messageId'],
    where: { userId: me.id },
    _count: true,
  })
  const pendingMsgIds = undelivered.map((u) => u.messageId)
  const pendingMsgs = await db.message.findMany({
    where: { id: { in: pendingMsgIds } },
    select: { chatId: true },
  })
  const unreadByChat: Record<string, number> = {}
  pendingMsgs.forEach((m) => (unreadByChat[m.chatId] = (unreadByChat[m.chatId] || 0) + 1))

  const mySubscriptions = await db.subscription.findMany({ where: { userId: me.id } })
  const subSet = new Set(mySubscriptions.map((s) => s.channelId))

  const result = chats.map((c) => {
    const others = c.members.filter((m) => m.userId !== me.id)
    const isDirect = c.type === 'direct'
    const other = isDirect ? others[0]?.user : null
    const last = c.messages[0]
    const myMember = c.members.find((m) => m.userId === me.id)

    return {
      id: c.id,
      type: c.type,
      name: isDirect ? other?.name ?? 'Suhbat' : c.name ?? 'Nomsiz',
      avatar: isDirect ? other?.avatar ?? '🙂' : c.avatar,
      description: c.description,
      memberCount: c.members.length,
      unreadCount: unreadByChat[c.id] || 0,
      lastMessageAt: last?.createdAt ?? c.createdAt,
      otherUserId: isDirect ? other?.id ?? null : null,
      ownerId: c.ownerId,
      subscribed: subSet.has(c.id),
      muted: myMember?.muted ?? false,
      members: c.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        username: m.user.username,
      })),
    }
  })

  result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  return Response.json(result)
}

// ===== Yangi chat / guruh / kanal yaratish =====
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const type = body.type as 'direct' | 'group' | 'channel'
  if (!['direct', 'group', 'channel'].includes(type)) return jsonError('Noto\u2018g\u2018ri tur')

  if (type === 'direct') {
    const otherId = String(body.memberId || '')
    const other = await db.user.findUnique({ where: { id: otherId } })
    if (!other) return jsonError('Foydalanuvchi topilmadi', 404)

    // Mavjud direct chatni qidirish
    const myChats = await db.chatMember.findMany({ where: { userId: me.id }, select: { chatId: true } })
    const theirChats = await db.chatMember.findMany({ where: { userId: otherId }, select: { chatId: true } })
    const mySet = new Set(myChats.map((c) => c.chatId))
    const shared = theirChats.map((c) => c.chatId).filter((id) => mySet.has(id))
    if (shared.length) {
      const existing = await db.chat.findFirst({
        where: { id: { in: shared }, type: 'direct' },
      })
      if (existing) return Response.json({ chatId: existing.id })
    }

    const chat = await db.chat.create({ data: { type: 'direct' } })
    await db.chatMember.createMany({
      data: [
        { chatId: chat.id, userId: me.id, role: 'owner' },
        { chatId: chat.id, userId: otherId, role: 'member' },
      ],
    })
    return Response.json({ chatId: chat.id })
  }

  const name = String(body.name || '').trim()
  if (name.length < 2) return jsonError('Nom juda qisqa')
  const avatar = String(body.avatar || (type === 'channel' ? '📢' : '👥')).slice(0, 8)
  const description = String(body.description || '').slice(0, 300)
  const isPublic = body.isPublic !== false // default ochiq
  const isPaid = body.isPaid === true && type === 'channel' // pullik faqat kanal
  const price = isPaid ? Math.max(0, Number(body.price) || 0) : 0
  const inviteCode = isPublic ? null : `50g-${Math.random().toString(36).slice(2, 10)}`

  const chat = await db.chat.create({
    data: {
      type,
      name,
      avatar,
      description,
      ownerId: me.id,
      isPublic,
      isPaid,
      price,
      inviteCode,
    },
  })

  await db.chatMember.create({ data: { chatId: chat.id, userId: me.id, role: 'owner' } })

  if (type === 'channel') {
    await db.subscription.create({ data: { channelId: chat.id, userId: me.id } }).catch(() => {})
  }

  if (Array.isArray(body.memberIds) && body.memberIds.length) {
    const ids: string[] = body.memberIds.filter((id: unknown) => typeof id === 'string' && id !== me.id)
    if (ids.length) {
      await db.chatMember.createMany({
        data: ids.map((id: string) => ({ chatId: chat.id, userId: id, role: 'member' })),
      })
    }
  }

  return Response.json({ chatId: chat.id })
}
