import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin statistikasi =====
export async function GET(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const [users, bannedUsers, admins, groups, channels, directChats, messages, feedPosts, ads, contacts, reports] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { isBanned: true } }),
      db.user.count({ where: { isAdmin: true } }),
      db.chat.count({ where: { type: 'group' } }),
      db.chat.count({ where: { type: 'channel' } }),
      db.chat.count({ where: { type: 'direct' } }),
      db.message.count(),
      db.feedPost.count(),
      db.ad.count(),
      db.contact.count(),
      db.report.count(),
    ])

  const recentUsers = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, username: true, name: true, avatar: true, createdAt: true },
  })

  return Response.json({
    users,
    bannedUsers,
    admins,
    groups,
    channels,
    directChats,
    messages,
    feedPosts,
    ads,
    contacts,
    reports,
    recentUsers,
  })
}
