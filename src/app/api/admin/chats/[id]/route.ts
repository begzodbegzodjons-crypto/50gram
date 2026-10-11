import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: chatni (guruh/kanal) o'chirish =====
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const { id } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id } })
  if (!chat) return jsonError('Chat topilmadi', 404)

  await db.chat.delete({ where: { id } }) // a'zolar, xabarlar — cascade
  await db.adminLog.create({ data: { action: 'delete_chat', target: id, detail: chat.name || '' } })

  return Response.json({ ok: true, message: `${chat.name || 'Chat'} o'chirildi` })
}
