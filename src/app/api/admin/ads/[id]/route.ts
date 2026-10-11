import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: reklama tahrirlash / o'chirish =====

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const { id } = await ctx.params
  const ad = await db.ad.findUnique({ where: { id } })
  if (!ad) return jsonError('Reklama topilmadi', 404)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const data: { title?: string; text?: string; link?: string | null; image?: string | null; targetKind?: string; status?: string } = {}
  if (typeof body.title === 'string' && body.title.trim().length >= 3) data.title = body.title.trim()
  if (typeof body.text === 'string' && body.text.trim().length >= 5) data.text = body.text.trim()
  if (body.link !== undefined) data.link = String(body.link || '').trim() || null
  if (body.image !== undefined) data.image = String(body.image || '').trim() || null
  if (['groups', 'channels', 'all'].includes(body.targetKind)) data.targetKind = body.targetKind
  if (['draft', 'active', 'paused', 'completed'].includes(body.status)) data.status = body.status

  const updated = await db.ad.update({ where: { id }, data })
  return Response.json({ ok: true, ad: updated })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const { id } = await ctx.params
  await db.ad.delete({ where: { id } }).catch(() => {})
  await db.adminLog.create({ data: { action: 'delete_ad', target: id } })
  return Response.json({ ok: true })
}
