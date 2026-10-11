import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { clampWeight } from '@/lib/recommend'

export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return jsonError('Avtorizatsiya kerak', 401)

  const interests = await db.userInterest.findMany({ where: { userId: user.id } })
  return Response.json({
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone,
    balance: user.balance,
    avatar: user.avatar,
    bio: user.bio,
    isAdmin: user.isAdmin,
    interests: interests.map((i) => ({ topicId: i.topicId, weight: i.weight })),
  })
}

// Profil, username yoki qiziqishlarni yangilash
export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const data: { name?: string; avatar?: string; bio?: string; phone?: string | null; username?: string } = {}
  if (typeof body.name === 'string' && body.name.trim().length >= 2) data.name = body.name.trim()
  if (typeof body.avatar === 'string') data.avatar = body.avatar.slice(0, 8)
  if (typeof body.bio === 'string') data.bio = body.bio.slice(0, 200)

  // Username o'zgartirish — band bo'lsa xato, format noto'g'ri bo'lsa xato
  if (typeof body.username === 'string') {
    const uname = body.username.trim().toLowerCase()
    if (uname !== user.username) {
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
        return jsonError('Foydalanuvchi nomi 3-20 belgi, faqat lotin harflari, raqamlar va _')
      }
      const exists = await db.user.findUnique({ where: { username: uname } })
      if (exists) return jsonError('Bu foydalanuvchi nomi band — boshqasini tanlang', 409)
      data.username = uname
    }
  }

  if (body.phone !== undefined) {
    const phone = String(body.phone || '').replace(/[^\d+]/g, '')
    if (phone && phone.replace(/\D/g, '').length >= 9) {
      const existing = await db.user.findUnique({ where: { phone } })
      if (existing && existing.id !== user.id) {
        return jsonError('Bu telefon raqam boshqa foydalanuvchida', 409)
      }
      data.phone = phone
    } else if (!phone) {
      data.phone = null
    }
  }

  if (Object.keys(data).length) {
    await db.user.update({ where: { id: user.id }, data })
  }

  if (Array.isArray(body.topicSlugs)) {
    const topics = await db.topic.findMany({ where: { slug: { in: body.topicSlugs } } })
    for (const t of topics) {
      const existing = await db.userInterest.findUnique({
        where: { userId_topicId: { userId: user.id, topicId: t.id } },
      })
      if (existing) {
        await db.userInterest.update({
          where: { userId_topicId: { userId: user.id, topicId: t.id } },
          data: { weight: clampWeight(Math.max(existing.weight, 1)) },
        })
      } else {
        await db.userInterest.create({ data: { userId: user.id, topicId: t.id, weight: 1 } })
      }
    }
  }

  const interests = await db.userInterest.findMany({ where: { userId: user.id } })
  const fresh = await db.user.findUnique({ where: { id: user.id } })
  return Response.json({
    id: fresh!.id,
    username: fresh!.username,
    name: fresh!.name,
    avatar: fresh!.avatar,
    bio: fresh!.bio,
    isAdmin: fresh!.isAdmin,
    interests: interests.map((i) => ({ topicId: i.topicId, weight: i.weight })),
  })
}
