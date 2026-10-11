import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Kanaldan/guruhdan chiqish (obunani bekor qilish) =====
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Chat topilmadi', 404)
  if (chat.ownerId === me.id) {
    return jsonError('Ega chiqishi mumkin emas — kanalni o\u2018chirish orqali', 400)
  }

  await db.chatMember.delete({ where: { chatId_userId: { chatId, userId: me.id } } }).catch(() => {})
  await db.subscription.delete({ where: { channelId_userId: { channelId: chatId, userId: me.id } } }).catch(() => {})

  return Response.json({ ok: true })
}
