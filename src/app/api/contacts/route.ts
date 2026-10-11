import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Kontaktlar (telefon daftari) =====
// Kontaktni saqlaganda raqam 50Gram a'zolari bilan avtomatik solishtiriladi

function normPhone(p: string): string {
  const digits = p.replace(/\D/g, '')
  if (digits.length === 9) return '+998' + digits // o'zbek raqami qisqa kiritilgan
  return '+' + digits
}

export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const contacts = await db.contact.findMany({
    where: { ownerId: me.id },
    orderBy: { createdAt: 'desc' },
    include: {
      linked: { select: { id: true, username: true, name: true, avatar: true, bio: true } },
    },
  })

  return Response.json({
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      createdAt: c.createdAt,
      linked: c.linked
        ? {
            id: c.linked.id,
            username: c.linked.username,
            name: c.linked.name,
            avatar: c.linked.avatar,
            bio: c.linked.bio,
          }
        : null,
    })),
  })
}

export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const name = String(body.name || '').trim()
  const rawPhone = String(body.phone || '')
  if (name.length < 1) return jsonError('Kontakt nomi kerak')

  const digits = rawPhone.replace(/\D/g, '')
  if (digits.length < 9) return jsonError('Telefon raqam noto\u2018g\u2018ri (masalan: +998901234567)')
  const phone = normPhone(rawPhone)

  // Shu raqam bilan ro'yxatdan o'tgan 50Gram foydalanuvchi bormi?
  const linkedUser = await db.user.findUnique({ where: { phone } })
  if (linkedUser && linkedUser.id === me.id) {
    return jsonError('Bu o\u2018zingizning raqamingiz')
  }

  const existing = await db.contact.findUnique({
    where: { ownerId_phone: { ownerId: me.id, phone } },
  })
  if (existing) return jsonError('Bu kontakt allaqachon saqlangan', 409)

  const contact = await db.contact.create({
    data: { ownerId: me.id, name, phone, linkedUserId: linkedUser?.id ?? null },
  })

  return Response.json({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    linked: linkedUser
      ? { id: linkedUser.id, username: linkedUser.username, name: linkedUser.name, avatar: linkedUser.avatar, bio: linkedUser.bio }
      : null,
  })
}
