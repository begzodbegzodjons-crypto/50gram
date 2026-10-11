import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Kanallarni kashf qilish — faqat OCHIQ kanallar (yopiq faqat taklifnoma bilan)
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const channels = await db.chat.findMany({
    where: { type: 'channel', isPublic: true },
    include: { members: true },
    orderBy: { createdAt: 'asc' },
  })

  const subs = await db.subscription.findMany({ where: { userId: me.id } })
  const subSet = new Set(subs.map((s) => s.channelId))

  return Response.json(
    channels.map((c) => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      description: c.description,
      memberCount: c.members.length,
      ownerId: c.ownerId,
      isPaid: c.isPaid,
      price: c.price,
      subscribed: subSet.has(c.id),
      mine: c.ownerId === me.id,
    }))
  )
}
