import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Chat (kanal/guruh) batafsil ma'lumoti =====
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership) return jsonError('Ruxsat yo\u2018q', 403)

  const chat = await db.chat.findUnique({
    where: { id: chatId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, avatar: true, username: true, phone: true } } },
        orderBy: { createdAt: 'asc' },
      },
      messages: { where: { pinned: true }, take: 5, orderBy: { createdAt: 'desc' } },
      bans: {
        include: { user: { select: { id: true, name: true, avatar: true, username: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!chat) return jsonError('Chat topilmadi', 404)

  const canSeeBans = ['owner', 'admin'].includes(membership.role)

  return Response.json({
    id: chat.id,
    type: chat.type,
    name: chat.name,
    description: chat.description,
    avatar: chat.avatar,
    ownerId: chat.ownerId,
    myRole: membership.role,
    muted: membership.muted,
    isPublic: chat.isPublic,
    isPaid: chat.isPaid,
    price: chat.price,
    inviteCode: chat.inviteCode,
    memberCount: chat.members.length,
    pinned: chat.messages.map((m) => ({ id: m.id, content: m.caption || m.content, createdAt: m.createdAt })),
    bans: canSeeBans
      ? chat.bans.map((b) => ({
          id: b.user.id,
          name: b.user.name,
          avatar: b.user.avatar,
          username: b.user.username,
          reason: b.reason,
          bannedAt: b.createdAt,
        }))
      : [],
    members: chat.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      avatar: m.user.avatar,
      username: m.user.username,
      phone: m.user.phone,
      role: m.role,
      joinedAt: m.createdAt,
    })),
  })
}

// ===== Sozlamalarni yangilash (egasi yoki admin) =====
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership) return jsonError('Ruxsat yo\u2018q', 403)
  if (!['owner', 'admin'].includes(membership.role)) {
    return jsonError('Faqat egasi yoki admin o\u2018zgartiradi', 403)
  }

  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const data: {
    name?: string
    description?: string
    avatar?: string
    isPublic?: boolean
    isPaid?: boolean
    price?: number
    inviteCode?: string | null
  } = {}

  if (typeof body.name === 'string' && body.name.trim().length >= 2) data.name = body.name.trim()
  if (typeof body.description === 'string') data.description = body.description.slice(0, 300)
  if (typeof body.avatar === 'string') data.avatar = body.avatar.slice(0, 8)
  if (typeof body.isPublic === 'boolean') data.isPublic = body.isPublic
  if (typeof body.isPaid === 'boolean') data.isPaid = body.isPaid
  if (typeof body.price === 'number' && body.price >= 0) data.price = Math.min(body.price, 100000000)
  if (data.isPaid === false || (data.isPaid === undefined && chat.isPaid && typeof body.price === 'number' && body.price === 0)) {
    data.price = 0
  }
  if (body.regenerateInvite === true) {
    data.inviteCode = `50g-${Math.random().toString(36).slice(2, 10)}`
  }

  await db.chat.update({ where: { id: chatId }, data })
  const updated = await db.chat.findUnique({ where: { id: chatId } })
  return Response.json({
    ok: true,
    chat: updated && {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      avatar: updated.avatar,
      isPublic: updated.isPublic,
      isPaid: updated.isPaid,
      price: updated.price,
      inviteCode: updated.inviteCode,
    },
  })
}

// ===== Kanal/guruhni butunlay o'chirish (faqat egasi) =====
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)
  if (chat.ownerId !== me.id) return jsonError('Faqat egasi o\u2018chirishi mumkin', 403)

  await db.chat.delete({ where: { id: chatId } }) // members/messages cascade
  return Response.json({ ok: true })
}
