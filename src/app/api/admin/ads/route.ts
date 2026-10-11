import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: reklama boshqarish =====

export async function GET(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const ads = await db.ad.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return Response.json({ ads })
}

export async function POST(req: Request) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const title = String(body.title || '').trim()
  const text = String(body.text || '').trim()
  const link = String(body.link || '').trim() || null
  const image = String(body.image || '').trim() || null
  const targetKind = ['groups', 'channels', 'all'].includes(body.targetKind) ? body.targetKind : 'groups'

  if (title.length < 3) return jsonError('Reklama sarlavhasi kamida 3 belgi')
  if (text.length < 5) return jsonError('Reklama matni juda qisqa')

  const ad = await db.ad.create({
    data: { title, text, link, image, targetKind, status: 'draft' },
  })

  await db.adminLog.create({ data: { action: 'create_ad', target: ad.id, detail: title } })

  return Response.json({ ok: true, ad })
}
