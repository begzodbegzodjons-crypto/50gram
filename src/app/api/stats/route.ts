import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Server yuklamasi statistikasi =====
// Gibrid modelning yashash dalili: hamma xabar yetkazilgach server bo'shaydi
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const total = await db.message.count()
  const purged = await db.message.count({ where: { purged: true } })
  const stored = await db.message.count({ where: { purged: false } })

  // Hozir serverda turgan haqiqiy tarkib hajmi (bayt)
  const active = await db.message.findMany({
    where: { purged: false, type: 'image' },
    select: { content: true },
  })
  const storedMediaBytes = active.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)

  return Response.json({
    totalMessages: total,
    purgedMessages: purged,
    storedMessages: stored,
    storedMediaBytes,
  })
}
