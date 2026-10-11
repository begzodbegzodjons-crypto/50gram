import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: barcha guruh/kanallarni ko'rish =====

export async function GET(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''

  const chats = await db.chat.findMany({
    where: {
      type: { in: ['group', 'channel'] },
      ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      _count: { select: { members: true, messages: true } },
    },
  })

  // Egalarini alohida olish (Chat modelida owner relation yo'q)
  const ownerIds = [...new Set(chats.map((c) => c.ownerId).filter(Boolean))] as string[]
  const owners = await db.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, username: true, isBanned: true },
  })
  const ownerMap = Object.fromEntries(owners.map((o) => [o.id, o]))

  return Response.json({
    chats: chats.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      description: c.description,
      avatar: c.avatar,
      isPublic: c.isPublic,
      isPaid: c.isPaid,
      price: c.price,
      memberCount: c._count.members,
      messageCount: c._count.messages,
      owner: c.ownerId ? ownerMap[c.ownerId] ?? null : null,
      createdAt: c.createdAt,
    })),
  })
}
