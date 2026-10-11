import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Username band emasligini tekshirish (live) =====
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const raw = new URL(req.url).searchParams.get('username')?.trim().toLowerCase() || ''
  if (!/^[a-z0-9_]{3,20}$/.test(raw)) {
    return Response.json({ available: false, reason: '3-20 belgi, faqat lotin harflari, raqamlar va _' })
  }
  const exists = await db.user.findUnique({ where: { username: raw } })
  if (exists && exists.id !== me.id) {
    return Response.json({ available: false, reason: 'Bu foydalanuvchi nomi band' })
  }
  return Response.json({ available: true })
}
