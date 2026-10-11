import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Kanalga obunachi qo'shish (faqat egasi)
// POST /api/channels/[id]/members  body: { userId } yoki { phone }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: channelId } = await ctx.params
  const channel = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!channel) return jsonError('Kanal topilmadi', 404)
  if (channel.ownerId !== me.id) return jsonError('Faqat kanal egasi obunachi qo‘shadi', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto‘g‘ri so‘rov')

  // Telefon raqam bilan ham qo'shish mumkin
  let userId = String(body.userId || '')
  if (!userId && body.phone) {
    const phone = String(body.phone).replace(/[^\d+]/g, '')
    const u = await db.user.findUnique({ where: { phone } })
    if (!u) return jsonError('Bu telefon raqamli foydalanuvchi topilmadi', 404)
    userId = u.id
  }
  if (!userId) return jsonError('Foydalanuvchi ko‘rsatilmagan')

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return jsonError('Foydalanuvchi topilmadi', 404)
  if (userId === channel.ownerId) return jsonError('Kanal egasi allaqachon a‘zo', 400)

  const exists = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: channelId, userId } },
  })
  if (exists) return jsonError(`${user.name} allaqachon kanalda`, 400)

  await db.$transaction([
    db.chatMember.create({ data: { chatId: channelId, userId, role: 'member' } }),
    // Egasi qo'shgan a'zo — bepul to'liq obuna (pullik kanalga ham to'lovsiz kiradi)
    db.subscription.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: {},
      create: { channelId, userId, paid: false, expiresAt: null },
    }),
  ])

  return Response.json({
    ok: true,
    member: { id: user.id, name: user.name, avatar: user.avatar, username: user.username, phone: user.phone },
  })
}
