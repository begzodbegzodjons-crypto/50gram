import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { subActive, genInviteCode } from '@/lib/channel'

// Kanal boshqaruv API
//   GET    — kanal ma'lumoti + obunachilar ro'yxati + mening obuna holatim
//   PATCH  — kanalni tahrirlash (faqat egasi): nom, tavsif, emoji, ochiq/yopiq, pullik/narx
//   DELETE — kanalni butunlay o'chirish (faqat egasi)

// ===== GET: kanal batafsil =====
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id } = await ctx.params
  const chat = await db.chat.findFirst({
    where: { id, type: 'channel' },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, avatar: true, username: true, phone: true } } },
      },
    },
  })
  if (!chat) return jsonError('Kanal topilmadi', 404)

  const myMember = chat.members.find((m) => m.userId === me.id)
  const isOwner = chat.ownerId === me.id
  // Yopiq kanalni faqat a'zolar ko'radi
  if (chat.visibility === 'private' && !myMember && !isOwner) {
    return jsonError('Bu yopiq kanal — faqat taklif kodi bilan kiriladi', 403)
  }

  const subs = await db.subscription.findMany({ where: { channelId: id } })
  const subMap = new Map(subs.map((s) => [s.userId, s]))

  // Obunachi ro'yxati — egasi va adminlarga to'liq, oddiy a'zoga umumiy son
  const subscribers = isOwner || myMember?.role === 'admin'
    ? chat.members
        .filter((m) => m.userId !== chat.ownerId)
        .map((m) => {
          const s = subMap.get(m.userId)
          return {
            id: m.user.id,
            name: m.user.name,
            avatar: m.user.avatar,
            username: m.user.username,
            phone: m.user.phone,
            role: m.role,
            paid: !!s?.paid,
            active: subActive(s ? { paid: s.paid, expiresAt: s.expiresAt } : null),
            expiresAt: s?.expiresAt ?? null,
            joinedAt: m.createdAt,
          }
        })
    : []

  const mySub = subMap.get(me.id) ?? null

  return Response.json({
    id: chat.id,
    name: chat.name,
    avatar: chat.avatar,
    description: chat.description,
    visibility: chat.visibility,
    isPaid: chat.isPaid,
    price: chat.price,
    inviteCode: isOwner || myMember?.role === 'admin' ? chat.inviteCode : null,
    ownerId: chat.ownerId,
    owner: chat.ownerId
      ? chat.members.find((m) => m.userId === chat.ownerId)?.user ?? null
      : null,
    memberCount: chat.members.length,
    createdAt: chat.createdAt,
    myRole: isOwner ? 'owner' : myMember?.role ?? null,
    mySubscription: mySub
      ? {
          paid: mySub.paid,
          active: subActive({ paid: mySub.paid, expiresAt: mySub.expiresAt }),
          expiresAt: mySub.expiresAt,
          joinedAt: mySub.createdAt,
        }
      : null,
    subscribers,
  })
}

// ===== PATCH: kanalni tahrirlash (faqat egasi) =====
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id } = await ctx.params
  const chat = await db.chat.findFirst({ where: { id, type: 'channel' } })
  if (!chat) return jsonError('Kanal topilmadi', 404)
  if (chat.ownerId !== me.id) return jsonError('Faqat kanal egasi o‘zgartirishi mumkin', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto‘g‘ri so‘rov')

  const data: {
    name?: string
    description?: string
    avatar?: string
    visibility?: string
    isPaid?: boolean
    price?: number
    inviteCode?: string
  } = {}

  if (typeof body.name === 'string' && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 100)
  if (typeof body.description === 'string') data.description = body.description.slice(0, 300)
  if (typeof body.avatar === 'string' && body.avatar.trim()) data.avatar = body.avatar.trim().slice(0, 8)
  if (body.visibility === 'public' || body.visibility === 'private') {
    data.visibility = body.visibility
    // Yopiq kanalga o'tganda kod yo'q bo'lsa — generatsiya qilinadi
    if (body.visibility === 'private' && !chat.inviteCode) data.inviteCode = genInviteCode()
  }
  if (typeof body.isPaid === 'boolean') data.isPaid = body.isPaid
  if (typeof body.price === 'number' && !Number.isNaN(body.price)) {
    const p = Math.max(0, Math.min(body.price, 10_000_000))
    data.price = p
    // Narx 0 bo'lsa — kanal bepul bo'ladi
    if (p === 0) data.isPaid = false
  }
  if (data.isPaid && data.price !== undefined && data.price <= 0) data.isPaid = false

  const updated = await db.chat.update({ where: { id }, data })

  // Pullikdan bepulga o'tsa — cheklangan obunalarni to'liq qilamiz? Yo'q: muddat o'zgaradi emas,
  // shunchaki yangi obunalar bepul bo'ladi. Mavjud pullik obunalar muddati bilan qoladi.

  return Response.json({
    ok: true,
    channel: {
      id: updated.id,
      name: updated.name,
      avatar: updated.avatar,
      description: updated.description,
      visibility: updated.visibility,
      isPaid: updated.isPaid,
      price: updated.price,
      inviteCode: updated.inviteCode,
    },
  })
}

// ===== DELETE: kanalni o'chirish (faqat egasi) =====
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id } = await ctx.params
  const chat = await db.chat.findFirst({ where: { id, type: 'channel' } })
  if (!chat) return jsonError('Kanal topilmadi', 404)
  if (chat.ownerId !== me.id) return jsonError('Faqat kanal egasi o‘chirishi mumkin', 403)

  // Bog'liq yozuvlarni tozalash (Subscription/FeedPost/ChannelPayment — alohida jadval, cascade yo'q)
  await db.$transaction([
    db.subscription.deleteMany({ where: { channelId: id } }),
    db.feedPost.deleteMany({ where: { channelId: id } }),
    db.channelPayment.deleteMany({ where: { channelId: id } }),
    db.chat.delete({ where: { id } }), // members + messages cascade
  ])

  return Response.json({ ok: true })
}
