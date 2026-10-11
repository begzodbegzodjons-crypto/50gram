import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Taklifnoma kodi bilan yopiq kanal/guruhga qo'shilish =====
// GET  /api/join?code=xxx  — kod haqida ma'lumot
// POST /api/join  { code } — qo'shilish
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const code = new URL(req.url).searchParams.get('code')?.trim() || ''
  const chat = await db.chat.findUnique({ where: { inviteCode: code } })
  if (!chat) return jsonError('Taklifnoma kodi noto\u2018g\u2018ri', 404)

  const member = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: chat.id, userId: me.id } },
  })

  return Response.json({
    chatId: chat.id,
    name: chat.name,
    avatar: chat.avatar,
    description: chat.description,
    type: chat.type,
    isPaid: chat.isPaid,
    price: chat.price,
    memberCount: await db.chatMember.count({ where: { chatId: chat.id } }),
    alreadyMember: !!member,
  })
}

export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  const code = String(body?.code || '').trim()
  if (!code) return jsonError('Kod kiritilmagan')

  const chat = await db.chat.findUnique({ where: { inviteCode: code } })
  if (!chat) return jsonError('Taklifnoma kodi noto\u2018g\u2018ri', 404)

  const existing = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: chat.id, userId: me.id } },
  })
  if (existing) return Response.json({ ok: true, chatId: chat.id, already: true })

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

  await db.chatMember.create({ data: { chatId: chat.id, userId: me.id, role: 'member' } })
  if (chat.type === 'channel') {
    await db.subscription.create({ data: { channelId: chat.id, userId: me.id } }).catch(() => {})
  }

  return Response.json({ ok: true, chatId: chat.id })
}
