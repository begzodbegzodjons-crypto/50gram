// ============================================================
// 50 Gram Worker — CHATLAR / A'ZOLAR / XABARLAR (REST) / BLOK / SHIKOYAT
// ============================================================
import type { Ctx } from './api-auth'
import { q, one, count, exec } from './db'
import { json, err, readJson, newId, nowMs, isoOf, makeInvite, str, bool } from './util'

// ---------- ChatInfo seriyalash (client ChatInfo tipiga mos) ----------
function serializeChat(c: any, myUserId: string, opts: { other?: any; memberCount: number; unread: number; lastMs: number | null; subscribed: boolean; muted: boolean }) {
  const isDirect = c.type === 'direct'
  return {
    id: c.id,
    type: c.type,
    name: isDirect ? opts.other?.name ?? 'Suhbat' : c.name ?? 'Nomsiz',
    avatar: isDirect ? opts.other?.avatar ?? '🙂' : c.avatar ?? null,
    description: c.description ?? null,
    memberCount: opts.memberCount,
    unreadCount: opts.unread,
    lastMessageAt: opts.lastMs != null ? isoOf(opts.lastMs) : isoOf(Number(c.created_ms)),
    otherUserId: isDirect ? opts.other?.id ?? null : null,
    ownerId: c.owner_id ?? null,
    subscribed: opts.subscribed,
    muted: opts.muted,
  }
}

// ==================== CHATLAR RO'YXATI ====================
export async function apiChatsGet(c: Ctx) {
  const memberships = await q<{ chat_id: string; muted: number }>(
    c.db,
    'SELECT chat_id, muted FROM chat_members WHERE user_id=?',
    [c.uid]
  )
  if (!memberships.length) return json([])

  const ids = memberships.map((m) => m.chat_id)
  const ph = ids.map(() => '?').join(',')
  const chats = await q<any>(
    c.db,
    `SELECT ch.*, cm.muted AS my_muted FROM chats ch
     JOIN chat_members cm ON cm.chat_id = ch.id AND cm.user_id = ?
     WHERE ch.id IN (${ph})`,
    [c.uid, ...ids]
  )
  if (!chats.length) return json([])

  // a'zolar
  const members = await q<any>(
    c.db,
    `SELECT m.chat_id, m.user_id, u.id, u.name, u.avatar, u.username
     FROM chat_members m JOIN users u ON u.id = m.user_id
     WHERE m.chat_id IN (${ph})`,
    ids
  )
  const membersByChat = new Map<string, any[]>()
  for (const m of members) {
    if (!membersByChat.has(m.chat_id)) membersByChat.set(m.chat_id, [])
    membersByChat.get(m.chat_id)!.push({ id: m.user_id, name: m.name, avatar: m.avatar ?? '🙂', username: m.username })
  }

  // o'qilmaganlar: men uchun yetkazilmagan xabarlar (chat bo'yicha)
  const unreadRows = await q<{ chat_id: string; n: number }>(
    c.db,
    `SELECT msg.chat_id, COUNT(*) AS n FROM message_delivery d
     JOIN messages msg ON msg.id = d.message_id
     WHERE d.user_id=? GROUP BY msg.chat_id`,
    [c.uid]
  )
  const unreadMap = new Map(unreadRows.map((r) => [r.chat_id, Number(r.n)]))

  // oxirgi xabar vaqtlari
  const lastRows = await q<{ chat_id: string; last_ms: number }>(
    c.db,
    `SELECT chat_id, MAX(created_ms) AS last_ms FROM messages WHERE chat_id IN (${ph}) GROUP BY chat_id`,
    ids
  )
  const lastMap = new Map(lastRows.map((r) => [r.chat_id, Number(r.last_ms)]))

  // obunalar
  const subs = await q<{ channel_id: string }>(c.db, 'SELECT channel_id FROM subscriptions WHERE user_id=?', [c.uid])
  const subSet = new Set(subs.map((s) => s.channel_id))
  const mutedMap = new Map(memberships.map((m) => [m.chat_id, bool(m.muted)]))

  const result = chats.map((ch) => {
    const mem = membersByChat.get(ch.id) ?? []
    const other = ch.type === 'direct' ? mem.find((m) => m.id !== c.uid) : null
    return serializeChat(ch, c.uid, {
      other,
      memberCount: mem.length,
      unread: unreadMap.get(ch.id) ?? 0,
      lastMs: lastMap.get(ch.id) ?? Number(ch.created_ms),
      subscribed: subSet.has(ch.id),
      muted: mutedMap.get(ch.id) ?? false,
    })
  })
  result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  return json(result)
}

// ==================== YANGI CHAT / GURUH / KANAL ====================
export async function apiChatsPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const type = str(body.type, 10)
  if (!['direct', 'group', 'channel'].includes(type)) return err('Noto\u2018g\u2018ri tur')

  if (type === 'direct') {
    const otherId = str(body.memberId, 26)
    if (!(await one(c.db, 'SELECT id FROM users WHERE id=?', [otherId]))) return err('Foydalanuvchi topilmadi', 404)

    const shared = await one<any>(
      c.db,
      `SELECT ch.id FROM chats ch
       WHERE ch.type='direct' AND
             EXISTS (SELECT 1 FROM chat_members a WHERE a.chat_id=ch.id AND a.user_id=?) AND
             EXISTS (SELECT 1 FROM chat_members b WHERE b.chat_id=ch.id AND b.user_id=?)
       LIMIT 1`,
      [c.uid, otherId]
    )
    if (shared) return json({ chatId: shared.id })

    const chatId = newId()
    await exec(c.db, 'INSERT INTO chats (id,type,owner_id,created_ms) VALUES (?,?,?,?)', [chatId, 'direct', c.uid, nowMs()])
    await exec(
      c.db,
      'INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?,?),(?,?,?,?,?)',
      [chatId, c.uid, 'owner', nowMs(), chatId, otherId, 'member', nowMs()]
    )
    return json({ chatId })
  }

  const name = str(body.name, 120).trim()
  if (name.length < 2) return err('Nom juda qisqa')
  const avatar = str(body.avatar, 8) || (type === 'channel' ? '📢' : '👥')
  const description = str(body.description, 300)
  const isPublic = body.isPublic !== false
  const isPaid = body.isPaid === true && type === 'channel'
  const price = isPaid ? Math.max(0, Number(body.price) || 0) : 0
  const inviteCode = isPublic ? null : makeInvite()

  const chatId = newId()
  await exec(
    c.db,
    'INSERT INTO chats (id,type,name,description,avatar,owner_id,is_public,is_paid,price,invite_code,created_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [chatId, type, name, description, avatar, c.uid, isPublic, isPaid, price, inviteCode, nowMs()]
  )
  await exec(c.db, 'INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chatId, c.uid, 'owner', nowMs()])
  if (type === 'channel') {
    await exec(c.db, 'INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chatId, c.uid, nowMs()])
  }
  if (Array.isArray(body.memberIds) && body.memberIds.length) {
    const others = body.memberIds.map((v: unknown) => str(v, 26)).filter((v: string) => v && v !== c.uid)
    for (const uid of others.slice(0, 200)) {
      await exec(c.db, 'INSERT IGNORE INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [
        chatId,
        uid,
        'member',
        nowMs(),
      ])
    }
  }
  return json({ chatId })
}

// ==================== CHAT DETAIL (kanal/guruh boshqaruvi) ====================
export async function apiChatGet(c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role, muted FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership) return err('Ruxsat yo\u2018q', 403)

  const chat = await one<any>(c.db, 'SELECT * FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)

  const members = await q<any>(
    c.db,
    `SELECT m.user_id, m.role, m.created_ms, u.name, u.avatar, u.username, u.phone
     FROM chat_members m JOIN users u ON u.id = m.user_id
     WHERE m.chat_id=? ORDER BY m.created_ms ASC`,
    [chatId]
  )
  const pinned = await q<any>(
    c.db,
    'SELECT id, content, caption, created_ms FROM messages WHERE chat_id=? AND pinned=1 ORDER BY created_ms DESC LIMIT 5',
    [chatId]
  )
  const canSeeBans = ['owner', 'admin'].includes(membership.role)
  const bans = canSeeBans
    ? await q<any>(
        c.db,
        `SELECT b.user_id, b.reason, b.created_ms, u.name, u.avatar, u.username
         FROM chat_bans b JOIN users u ON u.id = b.user_id WHERE b.chat_id=? ORDER BY b.created_ms DESC`,
        [chatId]
      )
    : []

  return json({
    id: chat.id,
    type: chat.type,
    name: chat.name ?? null,
    description: chat.description ?? null,
    avatar: chat.avatar ?? null,
    ownerId: chat.owner_id ?? null,
    myRole: membership.role,
    muted: bool(membership.muted),
    isPublic: bool(chat.is_public),
    isPaid: bool(chat.is_paid),
    price: Number(chat.price ?? 0),
    inviteCode: chat.invite_code ?? null,
    memberCount: members.length,
    pinned: pinned.map((m) => ({ id: m.id, content: m.caption || m.content || null, createdAt: isoOf(Number(m.created_ms)) })),
    bans: bans.map((b) => ({
      id: b.user_id,
      name: b.name,
      avatar: b.avatar ?? '🙂',
      username: b.username,
      reason: b.reason ?? null,
      bannedAt: isoOf(Number(b.created_ms)),
    })),
    members: members.map((m) => ({
      id: m.user_id,
      name: m.name,
      avatar: m.avatar ?? '🙂',
      username: m.username,
      phone: m.phone ?? null,
      role: m.role,
      joinedAt: isoOf(Number(m.created_ms)),
    })),
  })
}

export async function apiChatPatch(req: Request, c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership) return err('Ruxsat yo\u2018q', 403)
  if (!['owner', 'admin'].includes(membership.role)) return err('Faqat egasi yoki admin o\u2018zgartiradi', 403)

  const chat = await one<any>(c.db, 'SELECT is_paid FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)

  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.name === 'string' && body.name.trim().length >= 2) {
    sets.push('name=?')
    args.push(str(body.name.trim(), 120))
  }
  if (typeof body.description === 'string') {
    sets.push('description=?')
    args.push(str(body.description, 300))
  }
  if (typeof body.avatar === 'string') {
    sets.push('avatar=?')
    args.push(str(body.avatar, 8))
  }
  if (typeof body.isPublic === 'boolean') {
    sets.push('is_public=?')
    args.push(body.isPublic)
    sets.push('invite_code=?')
    args.push(body.isPublic ? null : makeInvite())
  }
  if (typeof body.isPaid === 'boolean') {
    sets.push('is_paid=?')
    args.push(body.isPaid)
    if (!body.isPaid) {
      sets.push('price=0')
    }
  }
  if (typeof body.price === 'number' && body.price >= 0) {
    sets.push('price=?')
    args.push(Math.min(body.price, 100000000))
  }
  if (body.regenerateInvite === true) {
    sets.push('invite_code=?')
    args.push(makeInvite())
  }
  if (sets.length) {
    await exec(c.db, `UPDATE chats SET ${sets.join(',')} WHERE id=?`, [...args, chatId])
  }
  const updated = await one<any>(
    c.db,
    'SELECT id, name, description, avatar, is_public, is_paid, price, invite_code FROM chats WHERE id=?',
    [chatId]
  )
  return json({
    ok: true,
    chat: updated
      ? {
          id: updated.id,
          name: updated.name ?? null,
          description: updated.description ?? null,
          avatar: updated.avatar ?? null,
          isPublic: bool(updated.is_public),
          isPaid: bool(updated.is_paid),
          price: Number(updated.price ?? 0),
          inviteCode: updated.invite_code ?? null,
        }
      : null,
  })
}

export async function apiChatDelete(c: Ctx, chatId: string) {
  const chat = await one<any>(c.db, 'SELECT owner_id, name FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (chat.owner_id !== c.uid) return err('Faqat egasi o\u2018chirishi mumkin', 403)

  await exec(c.db, 'DELETE FROM message_delivery WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)', [chatId])
  await exec(c.db, 'DELETE FROM feed_posts WHERE source_message_id IN (SELECT id FROM messages WHERE chat_id=?)', [chatId])
  await exec(c.db, 'DELETE FROM messages WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chat_bans WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chats WHERE id=?', [chatId])
  return json({ ok: true })
}

// ==================== A'ZOLAR ====================
export async function apiMembersPost(req: Request, c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership || !['owner', 'admin'].includes(membership.role)) return err('Faqat egasi yoki admin qo\u2018shadi', 403)

  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId) return err('Foydalanuvchi tanlanmagan')
  const target = await one<any>(c.db, 'SELECT id, name, avatar, username FROM users WHERE id=?', [userId])
  if (!target) return err('Foydalanuvchi topilmadi', 404)
  const chat = await one<any>(c.db, 'SELECT type FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (await one(c.db, 'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, userId]))
    return err('Bu foydalanuvchi allaqachon a\u2018zo', 409)

  await exec(c.db, 'INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chatId, userId, 'member', nowMs()])
  if (chat.type === 'channel') {
    await exec(c.db, 'INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chatId, userId, nowMs()])
  }
  return json({ ok: true, member: { id: target.id, name: target.name, avatar: target.avatar ?? '🙂', username: target.username, role: 'member' } })
}

export async function apiMembersDelete(req: Request, c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership || !['owner', 'admin'].includes(membership.role)) return err('Faqat egasi yoki admin o\u2018chiradi', 403)

  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId) return err('Foydalanuvchi ko\u2018rsatilmagan')
  const chat = await one<any>(c.db, 'SELECT owner_id FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (userId === chat.owner_id) return err('Egani o\u2018chirib bo\u2018lmaydi', 400)

  await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, userId])
  await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=? AND user_id=?', [chatId, userId])
  return json({ ok: true })
}

export async function apiMembersPatch(req: Request, c: Ctx, chatId: string) {
  const chat = await one<any>(c.db, 'SELECT owner_id FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (chat.owner_id !== c.uid) return err('Faqat egasi rol beradi', 403)

  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  const role = str(body?.role, 10)
  if (!userId || !['admin', 'member'].includes(role)) return err('Noto\u2018g\u2018ri so\u2018rov')
  if (userId === chat.owner_id) return err('Ega roli o\u2018zgartirilmaydi', 400)

  await exec(c.db, 'UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=?', [role, chatId, userId])
  return json({ ok: true })
}

// ==================== XABARLAR (REST tarix) ====================
function serializeMessage(m: any) {
  return {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    senderName: m.sender_name ?? '',
    senderAvatar: m.sender_avatar ?? '🙂',
    type: m.type,
    content: bool(m.purged) ? null : m.content ?? null,
    caption: m.caption ?? null,
    pinned: bool(m.pinned),
    mediaName: m.media_name ?? null,
    purged: bool(m.purged),
    createdAt: isoOf(Number(m.created_ms)),
  }
}

const MSG_SELECT = `SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
 FROM messages m LEFT JOIN users u ON u.id = m.sender_id`

export async function apiChatMessages(c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership) return err('Ruxsat yo\u2018q', 403)

  const chat = await one<any>(c.db, 'SELECT * FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)

  const members = await q<any>(
    c.db,
    `SELECT m.user_id, m.role, u.id, u.name, u.avatar, u.username
     FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id=?`,
    [chatId]
  )

  // men uchun kutilayotganlar (faqat shu chatniki)
  const inbox = await q<any>(
    c.db,
    `${MSG_SELECT} JOIN message_delivery d ON d.message_id = m.id AND d.user_id = ?
     WHERE m.chat_id=? ORDER BY m.created_ms ASC LIMIT 200`,
    [c.uid, chatId]
  )

  // so'nggi 60
  const recent = await q<any>(c.db, `${MSG_SELECT} WHERE m.chat_id=? ORDER BY m.created_ms DESC LIMIT 60`, [chatId])

  const other = chat.type === 'direct' ? members.find((m) => m.user_id !== c.uid) : null

  return json({
    chat: {
      id: chat.id,
      type: chat.type,
      name: chat.type === 'direct' ? other?.name ?? 'Suhbat' : chat.name ?? null,
      avatar: chat.type === 'direct' ? other?.avatar ?? '🙂' : chat.avatar ?? null,
      description: chat.description ?? null,
      ownerId: chat.owner_id ?? null,
      otherUserId: chat.type === 'direct' ? other?.user_id ?? null : null,
      myRole: membership.role,
      isPublic: bool(chat.is_public),
      isPaid: bool(chat.is_paid),
      price: Number(chat.price ?? 0),
      inviteCode: chat.invite_code ?? null,
      memberCount: members.length,
      members: members.map((m) => ({
        id: m.user_id,
        name: m.name,
        avatar: m.avatar ?? '🙂',
        username: m.username,
        role: m.role,
      })),
    },
    inbox: inbox.map(serializeMessage),
    recent: recent.reverse().map(serializeMessage),
  })
}

// ==================== OVOZSIZ ====================
export async function apiMutePost(req: Request, c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT muted FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership) return err('Ruxsat yo\u2018q', 403)
  const body = (await readJson(req)) ?? {}
  const muted = typeof body.muted === 'boolean' ? body.muted : !bool(membership.muted)
  await exec(c.db, 'UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?', [muted, chatId, c.uid])
  return json({ ok: true, muted })
}

// ==================== KANAL/GURUH QORA RO'YXATI ====================
export async function apiBansGet(c: Ctx, chatId: string) {
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership || !['owner', 'admin'].includes(membership.role)) return err('Ruxsat yo\u2018q', 403)
  const bans = await q<any>(
    c.db,
    `SELECT b.user_id, b.reason, b.created_ms, u.name, u.avatar, u.username
     FROM chat_bans b JOIN users u ON u.id = b.user_id WHERE b.chat_id=? ORDER BY b.created_ms DESC`,
    [chatId]
  )
  return json({
    bans: bans.map((b) => ({
      id: b.user_id,
      name: b.name,
      avatar: b.avatar ?? '🙂',
      username: b.username,
      reason: b.reason ?? null,
      bannedAt: isoOf(Number(b.created_ms)),
    })),
  })
}

export async function apiBansPost(req: Request, c: Ctx, chatId: string) {
  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId) return err('userId kerak')
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership || !['owner', 'admin'].includes(membership.role)) return err('Ruxsat yo\u2018q', 403)
  const chat = await one<any>(c.db, 'SELECT owner_id FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (userId === chat.owner_id) return err('Egani bloklash mumkin emas', 400)
  if (userId === c.uid) return err('O\u2018zingizni bloklash mumkin emas', 400)

  await exec(
    c.db,
    `INSERT INTO chat_bans (chat_id,user_id,reason,created_ms) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE reason=VALUES(reason)`,
    [chatId, userId, str(body?.reason, 200) || null, nowMs()]
  )
  await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, userId])
  await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=? AND user_id=?', [chatId, userId])
  return json({ ok: true })
}

export async function apiBansDelete(req: Request, c: Ctx, chatId: string) {
  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId) return err('userId kerak')
  const membership = await one<any>(c.db, 'SELECT role FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  if (!membership || !['owner', 'admin'].includes(membership.role)) return err('Ruxsat yo\u2018q', 403)
  await exec(c.db, 'DELETE FROM chat_bans WHERE chat_id=? AND user_id=?', [chatId, userId])
  return json({ ok: true })
}

// ==================== QO'SHILISH / CHIQISH ====================
async function payForChat(c: Ctx, chat: any): Promise<{ error?: Response; paid: number }> {
  if (!(bool(chat.is_paid) && Number(chat.price) > 0 && chat.owner_id !== c.uid)) return { paid: 0 }
  const price = Number(chat.price)
  const res = await one<any>(c.db, 'SELECT balance FROM users WHERE id=?', [c.uid])
  if (!res || Number(res.balance) < price) {
    return { error: err(`Hamyon yetarli emas. Narx: ${price.toLocaleString('uz-UZ')} so\u2018m`, 402), paid: 0 }
  }
  await exec(c.db, 'UPDATE users SET balance=balance-? WHERE id=? AND balance>=?', [price, c.uid, price])
  await exec(
    c.db,
    'INSERT INTO payments (id,user_id,owner_id,channel_id,channel_name,amount,method,created_ms) VALUES (?,?,?,?,?,?,?,?)',
    [newId(), c.uid, chat.owner_id ?? '', chat.id, chat.name ?? 'Kanal', price, 'hamyon', nowMs()]
  )
  return { paid: price }
}

export async function apiChatJoin(c: Ctx, chatId: string) {
  const chat = await one<any>(c.db, 'SELECT * FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Kanal topilmadi', 404)
  if (chat.type === 'direct') return err('Noto\u2018g\u2018ri tur', 400)
  if (await one(c.db, 'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid]))
    return json({ ok: true, already: true, chatId })
  if (await one(c.db, 'SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?', [chatId, c.uid]))
    return err('Siz bu chatga bloklangansiz (qora ro\u2018yxatda)', 403)

  const { error, paid } = await payForChat(c, chat)
  if (error) return error

  await exec(c.db, 'INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chatId, c.uid, 'member', nowMs()])
  if (chat.type === 'channel') {
    await exec(c.db, 'INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chatId, c.uid, nowMs()])
  }
  return json({ ok: true, chatId, paid })
}

export async function apiChatLeave(c: Ctx, chatId: string) {
  const chat = await one<any>(c.db, 'SELECT owner_id FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  if (chat.owner_id === c.uid) return err('Ega chiqishi mumkin emas — kanalni o\u2018chirish orqali', 400)
  await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [chatId, c.uid])
  await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=? AND user_id=?', [chatId, c.uid])
  return json({ ok: true })
}

// ==================== TAKLIFNOMA KODI ====================
export async function apiJoinGet(c: Ctx, url: URL) {
  const code = (url.searchParams.get('code') || '').trim()
  const chat = await one<any>(c.db, 'SELECT * FROM chats WHERE invite_code=?', [code])
  if (!chat) return err('Taklifnoma kodi noto\u2018g\u2018ri', 404)
  return json({
    chatId: chat.id,
    name: chat.name ?? null,
    avatar: chat.avatar ?? null,
    description: chat.description ?? null,
    type: chat.type,
    isPaid: bool(chat.is_paid),
    price: Number(chat.price ?? 0),
    memberCount: await count(c.db, 'SELECT COUNT(*) AS n FROM chat_members WHERE chat_id=?', [chat.id]),
    alreadyMember: !!(await one(c.db, 'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', [chat.id, c.uid])),
  })
}

export async function apiJoinPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  const code = str(body?.code, 20).trim()
  if (!code) return err('Kod kiritilmagan')
  const chat = await one<any>(c.db, 'SELECT * FROM chats WHERE invite_code=?', [code])
  if (!chat) return err('Taklifnoma kodi noto\u2018g\u2018ri', 404)
  if (await one(c.db, 'SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?', [chat.id, c.uid]))
    return json({ ok: true, chatId: chat.id, already: true })

  const { error } = await payForChat(c, chat)
  if (error) return error

  await exec(c.db, 'INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chat.id, c.uid, 'member', nowMs()])
  if (chat.type === 'channel') {
    await exec(c.db, 'INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chat.id, c.uid, nowMs()])
  }
  return json({ ok: true, chatId: chat.id })
}

// ==================== SHAXSIY BLOK ====================
export async function apiBlocksGet(c: Ctx) {
  const blocks = await q<any>(
    c.db,
    `SELECT u.id, u.name, u.avatar, u.username, b.created_ms
     FROM blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id=? ORDER BY b.created_ms DESC`,
    [c.uid]
  )
  return json({
    blocked: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      avatar: b.avatar ?? '🙂',
      username: b.username,
      blockedAt: isoOf(Number(b.created_ms)),
    })),
  })
}

export async function apiBlocksPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId || userId === c.uid) return err('Noto\u2018g\u2018ri foydalanuvchi')
  await exec(c.db, 'INSERT IGNORE INTO blocks (blocker_id,blocked_id,created_ms) VALUES (?,?,?)', [c.uid, userId, nowMs()])
  return json({ ok: true })
}

export async function apiBlocksDelete(req: Request, c: Ctx) {
  const body = await readJson(req)
  const userId = str(body?.userId, 26)
  if (!userId) return err('userId kerak')
  await exec(c.db, 'DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?', [c.uid, userId])
  return json({ ok: true })
}

// ==================== SHIKOYAT ====================
export async function apiReportsPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const chatId = body.chatId ? str(body.chatId, 26) : null
  const targetUserId = body.targetUserId ? str(body.targetUserId, 26) : null
  const kind = ['spam', 'scam', 'boshqa'].includes(body.kind) ? body.kind : 'spam'
  if (!chatId && !targetUserId) return err('Shikoyat obyekti kerak')
  await exec(c.db, 'INSERT INTO reports (id,reporter_id,chat_id,target_user_id,kind,created_ms) VALUES (?,?,?,?,?,?)', [
    newId(),
    c.uid,
    chatId,
    targetUserId,
    kind,
    nowMs(),
  ])
  return json({ ok: true })
}

// ==================== KANALLARNI KASHF ETISH ====================
export async function apiDiscover(c: Ctx) {
  const channels = await q<any>(
    c.db,
    `SELECT ch.*, (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id=ch.id) AS member_count
     FROM chats ch WHERE ch.type='channel' AND ch.is_public=1 ORDER BY ch.created_ms ASC`
  )
  const subs = await q<{ channel_id: string }>(c.db, 'SELECT channel_id FROM subscriptions WHERE user_id=?', [c.uid])
  const subSet = new Set(subs.map((s) => s.channel_id))
  return json(
    channels.map((ch) => ({
      id: ch.id,
      name: ch.name ?? null,
      avatar: ch.avatar ?? null,
      description: ch.description ?? null,
      memberCount: Number(ch.member_count ?? 0),
      ownerId: ch.owner_id ?? null,
      isPaid: bool(ch.is_paid),
      price: Number(ch.price ?? 0),
      subscribed: subSet.has(ch.id),
      mine: ch.owner_id === c.uid,
    }))
  )
}

export async function apiSubscribePost(c: Ctx, channelId: string) {
  const channel = await one<any>(c.db, "SELECT * FROM chats WHERE id=? AND type='channel'", [channelId])
  if (!channel) return err('Kanal topilmadi', 404)

  const existing = await one(c.db, 'SELECT 1 FROM subscriptions WHERE channel_id=? AND user_id=?', [channelId, c.uid])
  if (existing) {
    if (channel.owner_id === c.uid) return err('O\u2018z kanalingizdan chiqib bo\u2018lmaydi')
    await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=? AND user_id=?', [channelId, c.uid])
    await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=? AND user_id=?', [channelId, c.uid])
    return json({ subscribed: false })
  }
  await exec(c.db, 'INSERT INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [channelId, c.uid, nowMs()])
  await exec(c.db, 'INSERT IGNORE INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [
    channelId,
    c.uid,
    'member',
    nowMs(),
  ])
  return json({ subscribed: true })
}
