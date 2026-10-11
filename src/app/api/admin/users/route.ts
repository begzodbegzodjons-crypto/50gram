import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: foydalanuvchilarni boshqarish =====

export async function GET(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [{ username: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }],
        }
      : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      username: true,
      name: true,
      phone: true,
      avatar: true,
      bio: true,
      isAdmin: true,
      isBanned: true,
      banReason: true,
      createdAt: true,
      _count: { select: { messages: true, members: true, posts: true } },
    },
  })

  return Response.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      phone: u.phone,
      avatar: u.avatar,
      bio: u.bio,
      isAdmin: u.isAdmin,
      isBanned: u.isBanned,
      banReason: u.banReason,
      createdAt: u.createdAt,
      messageCount: u._count.messages,
      chatCount: u._count.members,
      postCount: u._count.posts,
    })),
  })
}

// Bloklash / blokdan chiqarish / admin qilish
export async function POST(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const userId = String(body.userId || '')
  const action = String(body.action || '')
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return jsonError('Foydalanuvchi topilmadi', 404)

  if (user.id === admin.id) return jsonError('O\u2018zingizni boshqara olmaysiz', 400)

  let message = ''

  if (action === 'ban') {
    const reason = String(body.reason || '').trim() || 'Dastur qoidalarini buzish'
    await db.user.update({ where: { id: userId }, data: { isBanned: true, banReason: reason, token: null } })
    message = `${user.name} bloklandi`
  } else if (action === 'unban') {
    await db.user.update({ where: { id: userId }, data: { isBanned: false, banReason: null } })
    message = `${user.name} blokdan chiqarildi`
  } else if (action === 'makeAdmin') {
    await db.user.update({ where: { id: userId }, data: { isAdmin: true } })
    message = `${user.name} admin qilindi`
  } else if (action === 'removeAdmin') {
    await db.user.update({ where: { id: userId }, data: { isAdmin: false } })
    message = `${user.name} adminlikdan olindi`
  } else {
    return jsonError('Noma\u2018lum amal')
  }

  await db.adminLog.create({ data: { action: `user:${action}`, target: userId, detail: user.username } })

  return Response.json({ ok: true, message })
}
