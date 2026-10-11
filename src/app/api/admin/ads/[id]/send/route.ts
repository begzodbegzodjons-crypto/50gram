import { db } from '@/lib/db'
import { getAdminFromRequest, jsonError } from '@/lib/auth'

// ===== Admin: reklamani guruh/kanallarga yuborish =====
// targetKind: groups → barcha guruhlarga | channels → barcha kanallarga | all → guruh + kanal + lenta

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromRequest(req)
  if (!admin) return jsonError('Faqat administrator uchun', 403)

  const { id } = await ctx.params
  const ad = await db.ad.findUnique({ where: { id } })
  if (!ad) return jsonError('Reklama topilmadi', 404)

  const body = await req.json().catch(() => ({}))
  // Bitta chatga yuborish (ixtiyoriy) — ko'rsatilmagan bo'lsa barcha mos chatlarga
  const onlyChatId = String(body.chatId || '')

  const content = `📢 REKLAMA — ${ad.title}\n\n${ad.text}${ad.link ? `\n\n👉 ${ad.link}` : ''}`
  const emoji = ad.image || '📣'

  const where: { type: string | { in: string[] }; id?: string } =
    ad.targetKind === 'groups'
      ? { type: 'group' }
      : ad.targetKind === 'channels'
        ? { type: 'channel' }
        : { type: { in: ['group', 'channel'] } }
  if (onlyChatId) where.id = onlyChatId

  const targets = await db.chat.findMany({ where, select: { id: true, type: true } })
  if (targets.length === 0) return jsonError('Yuborish uchun mos chatlar topilmadi')

  let sent = 0

  for (const chat of targets) {
    const members = await db.chatMember.findMany({ where: { chatId: chat.id }, select: { userId: true } })
    const others = members.map((m) => m.userId).filter((uid) => uid !== admin.id)

    await db.message.create({
      data: {
        chatId: chat.id,
        senderId: admin.id,
        type: 'text',
        content,
        pending:
          chat.type === 'channel'
            ? undefined
            : { create: others.map((userId) => ({ userId })) },
      },
    })
    sent++
  }

  // 'all' — lentalarga ham umumiy reklama posti
  if (ad.targetKind === 'all' && !onlyChatId) {
    await db.feedPost.create({
      data: {
        authorId: admin.id,
        channelName: '50 Gram Reklama',
        content: `${ad.title}\n\n${ad.text}${ad.link ? `\n\n👉 ${ad.link}` : ''}`,
        gradient: 'from-rose-500 to-red-600',
        emoji,
      },
    })
  }

  await db.ad.update({
    where: { id },
    data: { status: 'completed', sentCount: { increment: sent }, sentAt: new Date() },
  })

  await db.adminLog.create({
    data: { action: 'send_ad', target: id, detail: `${ad.title} → ${sent} ta chat` },
  })

  return Response.json({ ok: true, sent, message: `Reklama ${sent} ta chatga yuborildi` })
}
