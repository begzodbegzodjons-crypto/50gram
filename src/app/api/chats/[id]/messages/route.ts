import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'

// ===== Chat ma'lumotlari + xabarlar =====
// GET /api/chats/[id]/messages
//  - inbox: men uchun hali yetkazilmagan xabarlar (content bilan — serverda kutib turganlar)
//  - recent: oxirgi xabarlar (purged bo'lsa content=null — faqat "yetkazildi" belgisi)
//  - kanal uchun postlar serverda persist bo'ladi (obunachilar keyin ham ko'radi)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: chatId } = await ctx.params

  const membership = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: me.id } },
  })
  if (!membership) return jsonError('Ruxsat yo\u2018q', 403)

  const chat = await db.chat.findUnique({
    where: { id: chatId },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatar: true, username: true } } } },
    },
  })
  if (!chat) return jsonError('Chat topilmadi', 404)

  // Men uchun kutilayotgan xabarlar (offline bo'lganimda to'planganlar)
  const pendingRows = await db.messageDelivery.findMany({
    where: { userId: me.id },
    select: { messageId: true },
  })
  const pendingIds = pendingRows.map((r) => r.messageId)
  const pendingAll = await db.message.findMany({
    where: { id: { in: pendingIds } },
    orderBy: { createdAt: 'asc' },
  })
  const inbox = pendingAll.filter((m) => m.chatId === chatId)

  // So'nggi 60 xabar (kanal postlari persist — to'liq tarix)
  const recent = await db.message.findMany({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

  const senderIds = new Set<string>([...inbox, ...recent].map((m) => m.senderId))
  const senders = await db.user.findMany({
    where: { id: { in: [...senderIds] } },
    select: { id: true, name: true, avatar: true },
  })
  const senderMap = Object.fromEntries(senders.map((s) => [s.id, s]))

  const serialize = (m: (typeof recent)[number]) => ({
    id: m.id,
    chatId: m.chatId,
    senderId: m.senderId,
    senderName: senderMap[m.senderId]?.name ?? '',
    senderAvatar: senderMap[m.senderId]?.avatar ?? '🙂',
    type: m.type,
    content: m.purged ? null : m.content,
    caption: m.caption,
    pinned: m.pinned,
    mediaName: m.mediaName,
    purged: m.purged,
    createdAt: m.createdAt,
  })

  const other = chat.members.find((m) => m.userId !== me.id)?.user
  const myRole = membership.role

  return Response.json({
    chat: {
      id: chat.id,
      type: chat.type,
      name: chat.type === 'direct' ? other?.name ?? 'Suhbat' : chat.name,
      avatar: chat.type === 'direct' ? other?.avatar ?? '🙂' : chat.avatar,
      description: chat.description,
      ownerId: chat.ownerId,
      otherUserId: chat.type === 'direct' ? other?.id ?? null : null,
      myRole,
      isPublic: chat.isPublic,
      isPaid: chat.isPaid,
      price: chat.price,
      inviteCode: chat.inviteCode,
      memberCount: chat.members.length,
      members: chat.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        username: m.user.username,
        role: m.role,
      })),
    },
    inbox: inbox.map(serialize),
    recent: recent.reverse().map(serialize),
  })
}
