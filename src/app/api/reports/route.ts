import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Spam / shikoyat yuborish =====
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const chatId = body.chatId ? String(body.chatId) : null
  const targetUserId = body.targetUserId ? String(body.targetUserId) : null
  const kind = ['spam', 'scam', 'boshqa'].includes(body.kind) ? body.kind : 'spam'

  if (!chatId && !targetUserId) return jsonError('Shikoyat obyekti kerak')

  await db.report.create({
    data: { reporterId: me.id, chatId, targetUserId, kind },
  })

  return Response.json({ ok: true })
}
