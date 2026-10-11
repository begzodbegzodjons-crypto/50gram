// Kanal uchun umumiy yordamchilar
import { db } from '@/lib/db'
import { jsonError, getUserFromRequest } from '@/lib/auth'

// Obuna hozir faolmi (pullik bo'lsa muddat tekshiriladi)
export function subActive(sub: { paid: boolean; expiresAt: Date | null } | null): boolean {
  if (!sub) return false
  if (!sub.paid) return true // bepul obuna — cheksiz
  return !!sub.expiresAt && sub.expiresAt.getTime() > Date.now()
}

// Kanal yopiq bo'lsa — taklif kodi generatori
export function genInviteCode(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return s
}

// Kanalni topish + ruxsat tekshiruvi (owner | admin | member | null)
export async function channelWithRole(channelId: string, meId: string) {
  const chat = await db.chat.findFirst({ where: { id: channelId, type: 'channel' } })
  if (!chat) return { chat: null, role: null as null | 'owner' | 'admin' | 'member' }
  if (chat.ownerId === meId) return { chat, role: 'owner' as const }
  const member = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId: channelId, userId: meId } },
  })
  const role = member?.role === 'admin' ? ('admin' as const) : member ? ('member' as const) : null
  return { chat, role }
}

export async function requireMe(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) {
    return { me: null, err: jsonError('Avtorizatsiya kerak', 401) }
  }
  return { me, err: null }
}

export function money(n: number): string {
  return new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(n) + " so'm"
}
