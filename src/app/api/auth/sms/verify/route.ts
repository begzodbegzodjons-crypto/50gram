import { db } from '@/lib/db'
import { makeToken, jsonError } from '@/lib/auth'
import { normalizePhone } from '@/lib/phone'

// SMS kodni tekshirish:
//  - raqam ro'yxatdan o'tgan bo'lsa → to'g'ridan-to'g'ri kirish (token qaytadi)
//  - yangi raqam bo'lsa → isNewUser=true (keyingi qadam: Ism va Familiya)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const phone = normalizePhone(String(body.phone || ''))
  const code = String(body.code || '').replace(/\D/g, '')
  if (!phone) return jsonError('Telefon raqam noto\u2018g\u2018ri')
  if (code.length !== 5) return jsonError('Kod 5 xonali bo\u2018lishi kerak')

  const rec = await db.smsVerification.findUnique({ where: { phone } })
  if (!rec) return jsonError('Avval SMS kod oling', 400)
  if (rec.expiresAt.getTime() < Date.now()) {
    await db.smsVerification.delete({ where: { phone } }).catch(() => {})
    return jsonError('Kod muddati o\u2018tgan — yangi kod oling', 410)
  }
  if (rec.attempts >= 5) {
    await db.smsVerification.delete({ where: { phone } }).catch(() => {})
    return jsonError('Juda ko\u2018p noto\u2018g\u2018ri urinish — yangi kod oling', 429)
  }

  if (rec.code !== code) {
    await db.smsVerification.update({ where: { phone }, data: { attempts: { increment: 1 } } })
    return jsonError('Kod xato — tekshirib qayta kiriting', 401)
  }

  // Kod to'g'ri — foydalanuvchi bor-yo'qligini tekshiramiz
  const user = await db.user.findUnique({
    where: { phone },
    include: { interests: true },
  })

  if (user) {
    // Mavjud foydalanuvchi → biryo'la kirish
    const token = makeToken()
    await db.user.update({ where: { id: user.id }, data: { token } })
    await db.smsVerification.delete({ where: { phone } }).catch(() => {})

    return Response.json({
      ok: true,
      isNewUser: false,
      token,
      me: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        bio: user.bio,
        balance: user.balance,
        interests: user.interests.map((i) => ({ topicId: i.topicId, weight: i.weight })),
      },
    })
  }

  // Yangi raqam → ro'yxatdan o'tishni davom ettirish (ism/familiya bosqichi).
  // Kodni o'chirmaymiz — register bosqichida yana tekshiramiz, lekin urinishlarni nolga tushiramiz.
  await db.smsVerification.update({ where: { phone }, data: { attempts: 0 } })

  return Response.json({ ok: true, isNewUser: true, phone })
}
