import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Foydalanuvchilarni qidirish — ism, username YOKI TELEFON RAQAMI bo'yicha
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const raw = new URL(req.url).searchParams.get('q')?.trim() || ''
  const q = raw.toLowerCase().replace(/[\s()\-\+]/g, '') // raqam formatini tozalash

  const users = await db.user.findMany({
    where: raw
      ? {
          OR: [
            { username: { contains: q } },
            { name: { contains: raw } },
            { phone: { contains: q.replace(/\D/g, '') || q } },
          ],
        }
      : {},
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: { id: true, username: true, name: true, avatar: true, bio: true, phone: true },
  })

  return Response.json(users.filter((u) => u.id !== me.id))
}
