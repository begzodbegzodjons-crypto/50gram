import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Kanal/guruh qora ro'yxati =====

// Ro'yxatni olish (egasi/admin)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonError('Ruxsat yo\u2018q', 403)
  }

  const bans = await db.chatBan.findMany({
    where: { chatId },
    include: { user: { select: { id: true, name: true, avatar: true, username: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({
    bans: bans.map((b) => ({
      id: b.user.id,
      name: b.user.name,
      avatar: b.user.avatar,
      username: b.user.username,
      reason: b.reason,
      bannedAt: b.createdAt,
    })),
  })
}

// Qora ro'yxatga qo'shish (egasi/admin)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId) return jsonError('userId kerak')

  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonError('Ruxsat yo\u2018q', 403)
  }

  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)
  if (userId === chat.ownerId) return jsonError('Egani bloklash mumkin emas', 400)
  if (userId === me.id) return jsonError('O\u2018zingizni bloklash mumkin emas', 400)

  await db.chatBan.upsert({
    where: { chatId_userId: { chatId, userId } },
    update: { reason: String(body?.reason || '') || null },
    create: { chatId, userId, reason: String(body?.reason || '') || null },
  })

  // Qora ro'yxatdagini chatdan ham chiqaramiz
  await db.chatMember.delete({ where: { chatId_userId: { chatId, userId } } }).catch(() => {})
  await db.subscription.delete({ where: { channelId_userId: { channelId: chatId, userId } } }).catch(() => {})

  return Response.json({ ok: true })
}

// Qora ro'yxatdan chiqarish (egasi/admin)
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId) return jsonError('userId kerak')

  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonError('Ruxsat yo\u2018q', 403)
  }

  await db.chatBan.delete({ where: { chatId_userId: { chatId, userId } } }).catch(() => {})
  return Response.json({ ok: true })
}
