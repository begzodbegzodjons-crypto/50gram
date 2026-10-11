import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'
import { normalizePhone } from '@/lib/phone'
import { randomInt } from 'crypto'

// SMS kod yuborish (demo rejim: kod javobda qaytadi — UI "test SMS" sifatida ko'rsatadi)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const phone = normalizePhone(String(body.phone || ''))
  if (!phone) {
    return jsonError('Telefon raqam noto\u2018g\u2018ri. Namuna: +998 90 123 45 67')
  }

  // Qayta yuborish spamdan himoya: 30 sekund ichida qayta so'rash mumkin emas
  const existing = await db.smsVerification.findUnique({ where: { phone } })
  if (existing && Date.now() - existing.createdAt.getTime() < 30_000) {
    const wait = Math.ceil((30_000 - (Date.now() - existing.createdAt.getTime())) / 1000)
    return jsonError(`Kodni qayta yuborish uchun ${wait} sekund kuting`, 429)
  }

  const code = String(randomInt(10000, 99999))
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 daqiqa amal qiladi

  await db.smsVerification.upsert({
    where: { phone },
    create: { phone, code, expiresAt },
    update: { code, expiresAt, attempts: 0, createdAt: new Date() },
  })

  // Ro'yxatdan o'tgan foydalanuvchimi yoki yangimi — UI bosqichini oldindan bilishi uchun
  const user = await db.user.findUnique({ where: { phone }, select: { id: true } })

  return Response.json({
    ok: true,
    phone,
    isNewUser: !user,
    // DEMO REJIM: haqiqiy SMS shlyuzi ulanmaguncha kodni javobda qaytaramiz
    devCode: code,
  })
}
