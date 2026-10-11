import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== A'zolarni boshqarish (kanal obunachilari / guruh a'zolari) =====

// Qo'shish — faqat egasi/admin
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonError('Faqat egasi yoki admin qo\u2018shadi', 403)
  }

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId) return jsonError('Foydalanuvchi tanlanmagan')

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return jsonError('Foydalanuvchi topilmadi', 404)

  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)

  const existing = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  })
  if (existing) return jsonError('Bu foydalanuvchi allaqachon a\u2018zo', 409)

  await db.chatMember.create({ data: { chatId, userId, role: 'member' } })
  if (chat.type === 'channel') {
    await db.subscription.create({ data: { channelId: chatId, userId } }).catch(() => {})
  }

  return Response.json({
    ok: true,
    member: { id: target.id, name: target.name, avatar: target.avatar, username: target.username, role: 'member' },
  })
}

// Olib tashlash — faqat egasi/admin (egani o'chirib bo'lmaydi)
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonError('Faqat egasi yoki admin o\u2018chiradi', 403)
  }

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId) return jsonError('Foydalanuvchi ko\u2018rsatilmagan')

  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)
  if (userId === chat.ownerId) return jsonError('Egani o\u2018chirib bo\u2018lmaydi', 400)

  await db.chatMember.delete({ where: { chatId_userId: { chatId, userId } } }).catch(() => {})
  await db.subscription.delete({ where: { channelId_userId: { channelId: chatId, userId } } }).catch(() => {})

  return Response.json({ ok: true })
}

// Rol o'zgartirish (admin qilish / olish) — faqat egasi
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)
  if (chat.ownerId !== me.id) return jsonError('Faqat egasi rol beradi', 403)

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  const role = String(body?.role || '')
  if (!userId || !['admin', 'member'].includes(role)) return jsonError('Noto\u2018g\u2018ri so\u2018rov')
  if (userId === chat.ownerId) return jsonError('Ega roli o\u2018zgartirilmaydi', 400)

  await db.chatMember.update({
    where: { chatId_userId: { chatId, userId } },
    data: { role },
  })

  return Response.json({ ok: true })
}
