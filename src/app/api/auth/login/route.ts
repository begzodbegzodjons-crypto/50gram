import { db } from '@/lib/db'
import { verifyPassword, makeToken, jsonError } from '@/lib/auth'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  // username YOKI telefon raqam bilan kirish mumkin
  const raw = String(body.username || '').trim()
  const password = String(body.password || '')

  const user = await db.user.findFirst({
    where: { OR: [{ username: raw.toLowerCase() }, { phone: raw.replace(/[^\d+]/g, '') }] },
    include: { interests: true },
  })
  if (!user || !verifyPassword(password, user.password)) {
    return jsonError('Foydalanuvchi nomi / telefon yoki parol xato', 401)
  }
  if (user.isBanned) {
    return jsonError('Sizning akkauntingiz bloklangan. Sabab: ' + (user.banReason || 'ko\u2018rsatilmagan'), 403)
  }

  const token = makeToken()
  await db.user.update({ where: { id: user.id }, data: { token } })

  return Response.json({
    token,
    me: {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone,
      balance: user.balance,
      avatar: user.avatar,
      bio: user.bio,
      isAdmin: user.isAdmin,
      interests: user.interests.map((i) => ({ topicId: i.topicId, weight: i.weight })),
    },
  })
}
