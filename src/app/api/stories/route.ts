import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { gradientFor } from '@/lib/topics'

// ===== Hikoyalar (24 soat yashaydi) =====
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  // Muddati o'tganlarni o'chirish
  await db.story.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const stories = await db.story.findMany({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    take: 100,
  })

  return Response.json(
    stories.map((s) => ({
      id: s.id,
      userId: s.user.id,
      userName: s.user.name,
      userAvatar: s.user.avatar,
      image: s.image,
      gradient: s.gradient,
      caption: s.caption,
      createdAt: s.createdAt,
      mine: s.userId === me.id,
    }))
  )
}

export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const image = typeof body.image === 'string' && body.image.startsWith('data:image') ? body.image : null
  const caption = String(body.caption || '').slice(0, 200)
  if (!image && !caption) return jsonError('Rasm yoki matn kerak')

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)

  const story = await db.story.create({
    data: {
      userId: me.id,
      image,
      gradient: image ? null : gradientFor(caption || me.name),
      caption: caption || null,
      expiresAt,
    },
  })

  return Response.json({ id: story.id })
}
