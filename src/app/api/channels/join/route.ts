import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { subActive } from '@/lib/channel'

// Yopiq kanalga TAKLIF KODI bilan kirish
// POST /api/channels/join  body: { inviteCode }
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  const code = String(body?.inviteCode || '').trim().toUpperCase()
  if (!code) return jsonError('Kod kiritilmagan', 400)

  const channel = await db.chat.findFirst({
    where: { type: 'channel', inviteCode: code },
  })
  if (!channel) return jsonError("Bunday kodli kanal topilmadi", 404)

  if (channel.ownerId === me.id) return jsonError('Bu sizning kanalingiz', 400)

  // Pullik bo'lsa — to'lov ham kerak bo'ladi (kod faqat kirish eshigi)
  const existing = await db.subscription.findUnique({
    where: { channelId_userId: { channelId: channel.id, userId: me.id } },
  })

  if (existing && subActive({ paid: existing.paid, expiresAt: existing.expiresAt })) {
    return Response.json({ chatId: channel.id, name: channel.name, already: true })
  }

  if (channel.isPaid) {
    // Pullik: balansdan to'lov
    const buyer = await db.user.findUnique({ where: { id: me.id } })
    if (!buyer) return jsonError('Foydalanuvchi topilmadi', 404)
    if (buyer.balance < channel.price) {
      return jsonError(
        `Kod to\u2018g\u2018ri, lekin balansda mablag\u2018 yetarli emas — ${channel.price.toLocaleString('uz-UZ')} so\u2018m kerak`,
        402
      )
    }
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    await db.$transaction([
      db.user.update({ where: { id: me.id }, data: { balance: { decrement: channel.price } } }),
      ...(channel.ownerId
        ? [db.user.update({ where: { id: channel.ownerId }, data: { balance: { increment: channel.price } } })]
        : []),
      db.channelPayment.create({
        data: {
          channelId: channel.id,
          channelName: channel.name ?? 'Kanal',
          userId: me.id,
          ownerId: channel.ownerId ?? '',
          amount: channel.price,
        },
      }),
      existing
        ? db.subscription.update({
            where: { channelId_userId: { channelId: channel.id, userId: me.id } },
            data: { paid: true, expiresAt },
          })
        : db.subscription.create({ data: { channelId: channel.id, userId: me.id, paid: true, expiresAt } }),
      db.chatMember.upsert({
        where: { chatId_userId: { chatId: channel.id, userId: me.id } },
        update: {},
        create: { chatId: channel.id, userId: me.id, role: 'member' },
      }),
    ])
    return Response.json({ chatId: channel.id, name: channel.name, paid: true })
  }

  // Bepul yopiq kanal
  if (existing) {
    await db.subscription.update({
      where: { channelId_userId: { channelId: channel.id, userId: me.id } },
      data: { paid: false, expiresAt: null },
    })
  } else {
    await db.subscription.create({ data: { channelId: channel.id, userId: me.id } })
  }
  await db.chatMember
    .upsert({
      where: { chatId_userId: { chatId: channel.id, userId: me.id } },
      update: {},
      create: { chatId: channel.id, userId: me.id, role: 'member' },
    })
    .catch(() => {})

  return Response.json({ chatId: channel.id, name: channel.name })
}
