import { db } from '@/lib/db'
import { hashPassword, makeToken, jsonError } from '@/lib/auth'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const username = String(body.username || '').trim().toLowerCase()
  const name = String(body.name || '').trim()
  const password = String(body.password || '')
  const avatar = String(body.avatar || '🙂').slice(0, 8)
  const phone = String(body.phone || '').replace(/[^\d+]/g, '').trim() || null
  const topicSlugs: string[] = Array.isArray(body.topicSlugs) ? body.topicSlugs : []

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return jsonError('Foydalanuvchi nomi 3-20 belgi, faqat lotin harflari va raqamlar')
  }
  if (name.length < 2) return jsonError('Ism juda qisqa')
  if (password.length < 4) return jsonError('Parol kamida 4 belgidan iborat bo\u2018lsin')
  if (topicSlugs.length < 3) return jsonError('Kamida 3 ta mavzu tanlang')

  if (phone && phone.replace(/\D/g, '').length < 9) {
    return jsonError('Telefon raqam noto\u2018g\u2018ri (masalan: +998901234567)')
  }

  const exists = await db.user.findUnique({ where: { username } })
  if (exists) return jsonError('Bu foydalanuvchi nomi band', 409)
  if (phone) {
    const phoneExists = await db.user.findUnique({ where: { phone } })
    if (phoneExists) return jsonError('Bu telefon raqam allaqachon ro\u2018yxatdan o\u2018tgan', 409)
  }

  const topics = await db.topic.findMany({ where: { slug: { in: topicSlugs } } })
  const token = makeToken()

  const user = await db.user.create({
    data: {
      username,
      name,
      phone,
      password: hashPassword(password),
      avatar,
      token,
      interests: {
        create: topics.map((t) => ({ topicId: t.id, weight: 1 })),
      },
    },
  })

  // Yangi foydalanuvchini "50 Gram Jamoasi" kanaliga avto-obuna qilamiz
  const welcome = await db.chat.findFirst({
    where: { type: 'channel', name: { in: ['50 Gram Jamoasi', 'UzbekGram Jamoasi'] } },
  })
  if (welcome) {
    await db.chatMember.create({ data: { chatId: welcome.id, userId: user.id, role: 'member' } }).catch(() => {})
    await db.subscription.create({ data: { channelId: welcome.id, userId: user.id } }).catch(() => {})
  }

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
      interests: topics.map((t) => ({ topicId: t.id, weight: 1 })),
    },
  })
}
