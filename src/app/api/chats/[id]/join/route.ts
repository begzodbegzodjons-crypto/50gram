import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Kanal/guruhga qo'shilish (obuna bo'lish) =====
// Ochiq bepul: darhol a'zo bo'ladi
// Pullik: demo hamyondan yechib, Payment yozadi, keyin a'zo qiladi
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id: chatId } })
  if (!chat) return jsonError('Kanal topilmadi', 404)
  if (chat.type === 'direct') return jsonError('Noto\u2018g\u2018ri tur', 400)

  const existing = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (existing) return Response.json({ ok: true, already: true, chatId })

  // Qora ro'yxatda bo'lsa — qo'shilish mumkin emas
  const banned = await db.chatBan.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (banned) {
    return jsonError('Siz bu chatga bloklangansiz (qora ro\u2018yxatda)', 403)
  }

  // Pullik kanal — to'lov oqimi
  if (chat.isPaid && chat.price > 0 && chat.ownerId !== me.id) {
    if (me.balance < chat.price) {
      return jsonError(`Hamyon yetarli emas. Narx: ${chat.price.toLocaleString('uz-UZ')} so\u2018m`, 402)
    }
    await db.$transaction([
      db.user.update({ where: { id: me.id }, data: { balance: { decrement: chat.price } } }),
      db.payment.create({
        data: {
          userId: me.id,
          ownerId: chat.ownerId ?? '',
          channelId: chat.id,
          channelName: chat.name ?? 'Kanal',
          amount: chat.price,
          method: 'hamyon',
        },
      }),
    ])
  }

  await db.chatMember.create({ data: { chatId, userId: me.id, role: 'member' } })
  if (chat.type === 'channel') {
    await db.subscription.create({ data: { channelId: chatId, userId: me.id } }).catch(() => {})
  }

  return Response.json({
    ok: true,
    chatId,
    paid: chat.isPaid && chat.price > 0 && chat.ownerId !== me.id ? chat.price : 0,
  })
}
