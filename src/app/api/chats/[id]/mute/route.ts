import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Chatni ovozsiz qilish / ovozini yoqish =====
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params
  const body = await req.json().catch(() => ({}))

  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership) return jsonError('Ruxsat yo\u2018q', 403)

  const muted = typeof body.muted === 'boolean' ? body.muted : !membership.muted
  await db.chatMember.update({
    where: { chatId_userId: { chatId, userId: me.id } },
    data: { muted },
  })

  return Response.json({ ok: true, muted })
}
