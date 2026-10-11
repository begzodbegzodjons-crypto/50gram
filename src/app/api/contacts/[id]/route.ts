import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Kontakt o'chirish =====
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id } = await ctx.params
  const contact = await db.contact.findUnique({ where: { id } })
  if (!contact || contact.ownerId !== me.id) return jsonError('Kontakt topilmadi', 404)

  await db.contact.delete({ where: { id } })
  return Response.json({ ok: true })
}
