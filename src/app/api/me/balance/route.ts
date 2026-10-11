import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// Demo balans: hisobni to'ldirish (haqiqiy to'lov shlyuz ulanganda ushbu endpoint
// payment provider webhook'iga almashadi)
const TOPUP_OPTIONS = [10000, 25000, 50000, 100000]

export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const user = await db.user.findUnique({ where: { id: me.id }, select: { balance: true } })
  const payments = await db.channelPayment.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const earned = await db.channelPayment.aggregate({
    where: { ownerId: me.id },
    _sum: { amount: true },
  })

  return Response.json({
    balance: user?.balance ?? 0,
    options: TOPUP_OPTIONS,
    payments: payments.map((p) => ({
      id: p.id,
      channelName: p.channelName,
      amount: p.amount,
      createdAt: p.createdAt,
    })),
    earned: earned._sum.amount ?? 0, // kanalingizdan tushgan daromad
  })
}

export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount || 0)
  if (!TOPUP_OPTIONS.includes(amount)) return jsonError('Noto‘g‘ri summa', 400)

  const user = await db.user.update({
    where: { id: me.id },
    data: { balance: { increment: amount } },
    select: { balance: true },
  })

  return Response.json({ ok: true, balance: user.balance })
}
