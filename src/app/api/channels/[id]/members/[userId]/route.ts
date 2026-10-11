import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// A'zoni boshqarish (faqat egasi)
//   DELETE /api/channels/[id]/members/[userId] — obunachini olib tashlash
//   PATCH  /api/channels/[id]/members/[userId] — admin qilish / adminlikni olish
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: channelId, userId } = await ctx.params
  const channel = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!channel) return jsonError('Kanal topilmadi', 404)
  if (channel.ownerId !== me.id) return jsonError('Faqat kanal egasi olib tashlaydi', 403)
  if (userId === channel.ownerId) return jsonError('O‘zingizni olib tashlab bo‘lmaydi', 400)

  const member = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: channelId, userId } },
  })
  if (!member) return jsonError('A‘zo topilmadi', 404)

  await db.$transaction([
    db.chatMember.delete({ where: { chatId_userId: { chatId: channelId, userId } } }),
    db.subscription.deleteMany({ where: { channelId, userId } }),
  ])

  return Response.json({ ok: true })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: channelId, userId } = await ctx.params
  const channel = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!channel) return jsonError('Kanal topilmadi', 404)
  if (channel.ownerId !== me.id) return jsonError('Faqat kanal egasi rolni o‘zgartiradi', 403)
  if (userId === channel.ownerId) return jsonError('Ega roli o‘zgarmaydi', 400)

  const body = await req.json().catch(() => null)
  const role = body?.role
  if (role !== 'admin' && role !== 'member') return jsonError('Rol: admin yoki member', 400)

  const member = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: channelId, userId } },
  })
  if (!member) return jsonError('A‘zo topilmadi', 404)

  await db.chatMember.update({
    where: { chatId_userId: { chatId: channelId, userId } },
    data: { role },
  })

  return Response.json({ ok: true, role })
}
