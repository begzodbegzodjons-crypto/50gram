import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Shaxsiy qora ro'yxat (foydalanuvchini bloklash) =====

// Bloklanganlar ro'yxati
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const blocks = await db.block.findMany({
    where: { blockerId: me.id },
    include: {
      blocked: { select: { id: true, name: true, avatar: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({
    blocked: blocks.map((b) => ({
      id: b.blocked.id,
      name: b.blocked.name,
      avatar: b.blocked.avatar,
      username: b.blocked.username,
      blockedAt: b.createdAt,
    })),
  })
}

// Bloklash
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId || userId === me.id) return jsonError('Noto\u2018g\u2018ri foydalanuvchi')

  await db.block.upsert({
    where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
    update: {},
    create: { blockerId: me.id, blockedId: userId },
  })

  return Response.json({ ok: true })
}

// Blokdan chiqarish
export async function DELETE(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (!userId) return jsonError('userId kerak')

  await db.block.delete({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } } }).catch(() => {})
  return Response.json({ ok: true })
}
