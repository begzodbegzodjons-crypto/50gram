import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Kanalga obuna / bekor qilish (toggle)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: channelId } = await ctx.params
  const channel = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!channel) return jsonError('Kanal topilmadi', 404)

  const existing = await db.subscription.findUnique({
    where: { channelId_userId: { channelId, userId: me.id } },
  })

  if (existing) {
    if (channel.ownerId === me.id) return jsonError('O\u2018z kanalingizdan chiqib bo\u2018lmaydi')
    await db.subscription.delete({ where: { channelId_userId: { channelId, userId: me.id } } })
    await db.chatMember.delete({ where: { chatId_userId: { chatId: channelId, userId: me.id } } }).catch(() => {})
    return Response.json({ subscribed: false })
  }

  await db.subscription.create({ data: { channelId, userId: me.id } })
  await db.chatMember.create({ data: { chatId: channelId, userId: me.id, role: 'member' } }).catch(() => {})
  return Response.json({ subscribed: true })
}
