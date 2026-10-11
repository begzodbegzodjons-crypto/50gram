import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== To'lov tarixi =====
// GET /api/payments
//  - balance: mening demo hamyonim
//  - payments: men to'lagan obunalar
//  - income: mening kanallarimga kelgan daromadlar
//  - incomeTotal: jami daromad
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const [user, payments, income] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, select: { balance: true } }),
    db.payment.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.payment.findMany({
      where: { ownerId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { username: true } } },
    }),
  ])

  const incomeTotal = income.reduce((s, p) => s + p.amount, 0)
  const spentTotal = payments.reduce((s, p) => s + p.amount, 0)

  return Response.json({
    balance: user?.balance ?? 0,
    spentTotal,
    incomeTotal,
    payments: payments.map((p) => ({
      id: p.id,
      channelName: p.channelName,
      amount: p.amount,
      method: p.method,
      createdAt: p.createdAt,
    })),
    income: income.map((p) => ({
      id: p.id,
      channelName: p.channelName,
      amount: p.amount,
      from: p.user.username,
      createdAt: p.createdAt,
    })),
  })
}
