import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Kanal postini o'chirish (HTTP usuli — soket orqali ham bor)
// DELETE /api/channels/[id]/messages/[messageId]
//   Ruxsat: kanal egasi yoki admini (yoki post muallifi)
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> }
) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: channelId, messageId } = await ctx.params
  const channel = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!channel) return jsonError('Kanal topilmadi', 404)

  const isOwner = channel.ownerId === me.id
  let isAdmin = false
  if (!isOwner) {
    const member = await db.chatMember.findUnique({
      where: { chatId_userId: { chatId: channelId, userId: me.id } },
    })
    isAdmin = member?.role === 'admin'
  }

  const msg = await db.message.findUnique({ where: { id: messageId } })
  if (!msg || msg.chatId !== channelId) return jsonError('Post topilmadi', 404)

  if (!isOwner && !isAdmin && msg.senderId !== me.id) {
    return jsonError('Bu postni o‘chirishga ruxsatingiz yo‘q', 403)
  }

  await db.$transaction([
    db.message.delete({ where: { id: messageId } }),
    // Lentadagi mos postni ham o'chiramiz
    db.feedPost.deleteMany({
      where: { OR: [{ messageId }, { channelId, content: msg.content ?? '' }] },
    }),
  ])

  return Response.json({ ok: true })
}
