// ============================================================
// 50 Gram Worker — ADMIN (statistika, foydalanuvchilar, chatlar, reklama)
// ============================================================
import type { Ctx } from './api-auth'
import { q, one, count, exec } from './db'
import { json, err, readJson, newId, nowMs, isoOf, str, bool } from './util'

async function adminGuard(c: Ctx): Promise<boolean> {
  const me = await one<{ is_admin: number }>(c.db, 'SELECT is_admin FROM users WHERE id=?', [c.uid])
  return bool(me?.is_admin)
}

async function log(c: Ctx, action: string, target?: string | null, detail?: string | null) {
  await exec(c.db, 'INSERT INTO admin_logs (id,action,target,detail,created_ms) VALUES (?,?,?,?,?)', [
    newId(),
    action,
    target ?? null,
    detail ?? null,
    nowMs(),
  ])
}

// ==================== STATISTIKA ====================
export async function apiAdminStats(c: Ctx) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const [users, bannedUsers, admins, groups, channels, directChats, messages, feedPosts, ads, contacts, reports] = await Promise.all([
    count(c.db, 'SELECT COUNT(*) AS n FROM users'),
    count(c.db, 'SELECT COUNT(*) AS n FROM users WHERE is_banned=1'),
    count(c.db, 'SELECT COUNT(*) AS n FROM users WHERE is_admin=1'),
    count(c.db, "SELECT COUNT(*) AS n FROM chats WHERE type='group'"),
    count(c.db, "SELECT COUNT(*) AS n FROM chats WHERE type='channel'"),
    count(c.db, "SELECT COUNT(*) AS n FROM chats WHERE type='direct'"),
    count(c.db, 'SELECT COUNT(*) AS n FROM messages'),
    count(c.db, 'SELECT COUNT(*) AS n FROM feed_posts'),
    count(c.db, 'SELECT COUNT(*) AS n FROM ads'),
    count(c.db, 'SELECT COUNT(*) AS n FROM contacts'),
    count(c.db, 'SELECT COUNT(*) AS n FROM reports'),
  ])
  const recentUsers = await q<any>(
    c.db,
    'SELECT id, username, name, avatar, created_ms FROM users ORDER BY created_ms DESC LIMIT 5'
  )
  return json({
    users,
    bannedUsers,
    admins,
    groups,
    channels,
    directChats,
    messages,
    feedPosts,
    ads,
    contacts,
    reports,
    recentUsers: recentUsers.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      avatar: u.avatar ?? '🙂',
      createdAt: isoOf(Number(u.created_ms)),
    })),
  })
}

// ==================== FOYDALANUVCHILAR ====================
export async function apiAdminUsersGet(c: Ctx, url: URL) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const raw = (url.searchParams.get('q') || '').trim().toLowerCase()
  const like = `%${raw}%`
  const users = await q<any>(
    c.db,
    `SELECT u.*,
       (SELECT COUNT(*) FROM messages m WHERE m.sender_id=u.id) AS message_count,
       (SELECT COUNT(*) FROM chat_members cm WHERE cm.user_id=u.id) AS chat_count,
       (SELECT COUNT(*) FROM feed_posts fp WHERE fp.author_id=u.id) AS post_count
     FROM users u
     ${raw ? 'WHERE u.username LIKE ? OR u.name LIKE ? OR u.phone LIKE ?' : ''}
     ORDER BY u.created_ms DESC LIMIT 200`,
    raw ? [like, like, like] : []
  )
  return json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      phone: u.phone ?? null,
      avatar: u.avatar ?? '🙂',
      bio: u.bio ?? null,
      isAdmin: bool(u.is_admin),
      isBanned: bool(u.is_banned),
      banReason: u.ban_reason ?? null,
      createdAt: isoOf(Number(u.created_ms)),
      messageCount: Number(u.message_count),
      chatCount: Number(u.chat_count),
      postCount: Number(u.post_count),
    })),
  })
}

export async function apiAdminUsersPost(req: Request, c: Ctx) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const userId = str(body.userId, 26)
  const action = str(body.action, 20)
  const user = await one<any>(c.db, 'SELECT id, username, name FROM users WHERE id=?', [userId])
  if (!user) return err('Foydalanuvchi topilmadi', 404)
  if (user.id === c.uid) return err('O\u2018zingizni boshqara olmaysiz', 400)

  let message = ''
  if (action === 'ban') {
    const reason = str(body.reason, 200).trim() || 'Dastur qoidalarini buzish'
    await exec(c.db, 'UPDATE users SET is_banned=1, ban_reason=? WHERE id=?', [reason, userId])
    // barcha qurilmalar ulanishi uziladi (DO keyingi amalda token tekshiradi)
    message = `${user.name} bloklandi`
  } else if (action === 'unban') {
    await exec(c.db, 'UPDATE users SET is_banned=0, ban_reason=NULL WHERE id=?', [userId])
    message = `${user.name} blokdan chiqarildi`
  } else if (action === 'makeAdmin') {
    await exec(c.db, 'UPDATE users SET is_admin=1 WHERE id=?', [userId])
    message = `${user.name} admin qilindi`
  } else if (action === 'removeAdmin') {
    await exec(c.db, 'UPDATE users SET is_admin=0 WHERE id=?', [userId])
    message = `${user.name} adminlikdan olindi`
  } else {
    return err('Noma\u2018lum amal')
  }
  await log(c, `user:${action}`, userId, user.username)
  return json({ ok: true, message })
}

// ==================== GURUH & KANALLAR ====================
export async function apiAdminChatsGet(c: Ctx, url: URL) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const raw = (url.searchParams.get('q') || '').trim().toLowerCase()
  const like = `%${raw}%`
  const chats = await q<any>(
    c.db,
    `SELECT ch.*,
       (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id=ch.id) AS member_count,
       (SELECT COUNT(*) FROM messages msg WHERE msg.chat_id=ch.id) AS message_count
     FROM chats ch WHERE ch.type IN ('group','channel')
     ${raw ? "AND (ch.name LIKE ? OR ch.description LIKE ?)" : ''}
     ORDER BY ch.created_ms DESC LIMIT 200`,
    raw ? [like, like] : []
  )
  const ownerIds = [...new Set(chats.map((ch) => ch.owner_id).filter(Boolean))]
  const ph = ownerIds.map(() => '?').join(',')
  const owners = ownerIds.length
    ? await q<any>(c.db, `SELECT id, name, username, is_banned FROM users WHERE id IN (${ph})`, ownerIds)
    : []
  const ownerMap = new Map(owners.map((o) => [o.id, o]))
  return json({
    chats: chats.map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name ?? null,
      description: ch.description ?? null,
      avatar: ch.avatar ?? null,
      isPublic: bool(ch.is_public),
      isPaid: bool(ch.is_paid),
      price: Number(ch.price ?? 0),
      memberCount: Number(ch.member_count),
      messageCount: Number(ch.message_count),
      owner: ch.owner_id
        ? ownerMap.has(ch.owner_id)
          ? { id: ch.owner_id, name: ownerMap.get(ch.owner_id)!.name, username: ownerMap.get(ch.owner_id)!.username, isBanned: bool(ownerMap.get(ch.owner_id)!.is_banned) }
          : null
        : null,
      createdAt: isoOf(Number(ch.created_ms)),
    })),
  })
}

export async function apiAdminChatDelete(c: Ctx, chatId: string) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const chat = await one<any>(c.db, 'SELECT name FROM chats WHERE id=?', [chatId])
  if (!chat) return err('Chat topilmadi', 404)
  await exec(c.db, 'DELETE FROM message_delivery WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)', [chatId])
  await exec(c.db, 'DELETE FROM feed_posts WHERE source_message_id IN (SELECT id FROM messages WHERE chat_id=?)', [chatId])
  await exec(c.db, 'DELETE FROM messages WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chat_bans WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM subscriptions WHERE channel_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chat_members WHERE chat_id=?', [chatId])
  await exec(c.db, 'DELETE FROM chats WHERE id=?', [chatId])
  await log(c, 'delete_chat', chatId, chat.name || '')
  return json({ ok: true, message: `${chat.name || 'Chat'} o'chirildi` })
}

// ==================== REKLAMA ====================
export async function apiAdminAdsGet(c: Ctx) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const ads = await q<any>(c.db, 'SELECT * FROM ads ORDER BY created_ms DESC LIMIT 100')
  return json({
    ads: ads.map((a) => ({
      id: a.id,
      title: a.title,
      text: a.text,
      image: a.image ?? null,
      link: a.link ?? null,
      targetKind: a.target_kind,
      status: a.status,
      sentCount: Number(a.sent_count),
      sentAt: a.sent_ms ? isoOf(Number(a.sent_ms)) : null,
      createdAt: isoOf(Number(a.created_ms)),
    })),
  })
}

export async function apiAdminAdsPost(req: Request, c: Ctx) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const title = str(body.title, 120).trim()
  const text = str(body.text, 5000).trim()
  const link = str(body.link, 255).trim() || null
  const image = str(body.image, 255).trim() || null
  const targetKind = ['groups', 'channels', 'all'].includes(body.targetKind) ? body.targetKind : 'groups'
  if (title.length < 3) return err('Reklama sarlavhasi kamida 3 belgi')
  if (text.length < 5) return err('Reklama matni juda qisqa')

  const id = newId()
  await exec(
    c.db,
    'INSERT INTO ads (id,title,text,image,link,target_kind,status,created_ms) VALUES (?,?,?,?,?,?,?,?)',
    [id, title, text, image, link, targetKind, 'draft', nowMs()]
  )
  await log(c, 'create_ad', id, title)
  return json({
    ok: true,
    ad: { id, title, text, image, link, targetKind, status: 'draft', sentCount: 0, sentAt: null, createdAt: isoOf(nowMs()) },
  })
}

export async function apiAdminAdPatch(req: Request, c: Ctx, id: string) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const ad = await one(c.db, 'SELECT id FROM ads WHERE id=?', [id])
  if (!ad) return err('Reklama topilmadi', 404)
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.title === 'string' && body.title.trim().length >= 3) {
    sets.push('title=?')
    args.push(str(body.title.trim(), 120))
  }
  if (typeof body.text === 'string' && body.text.trim().length >= 5) {
    sets.push('text=?')
    args.push(str(body.text.trim(), 5000))
  }
  if (body.link !== undefined) {
    sets.push('link=?')
    args.push(str(body.link, 255).trim() || null)
  }
  if (body.image !== undefined) {
    sets.push('image=?')
    args.push(str(body.image, 255).trim() || null)
  }
  if (['groups', 'channels', 'all'].includes(body.targetKind)) {
    sets.push('target_kind=?')
    args.push(body.targetKind)
  }
  if (['draft', 'active', 'paused', 'completed'].includes(body.status)) {
    sets.push('status=?')
    args.push(body.status)
  }
  if (sets.length) await exec(c.db, `UPDATE ads SET ${sets.join(',')} WHERE id=?`, [...args, id])
  const updated = await q<any>(c.db, 'SELECT * FROM ads WHERE id=?', [id])
  return json({ ok: true, ad: updated[0] ?? null })
}

export async function apiAdminAdDelete(c: Ctx, id: string) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  await exec(c.db, 'DELETE FROM ads WHERE id=?', [id])
  await log(c, 'delete_ad', id)
  return json({ ok: true })
}

export async function apiAdminAdSend(req: Request, c: Ctx, id: string) {
  if (!(await adminGuard(c))) return err('Faqat administrator uchun', 403)
  const ad = await one<any>(c.db, 'SELECT * FROM ads WHERE id=?', [id])
  if (!ad) return err('Reklama topilmadi', 404)
  const body = (await readJson(req)) ?? {}
  const onlyChatId = str(body.chatId, 26)

  const content = `📢 REKLAMA — ${ad.title}\n\n${ad.text}${ad.link ? `\n\n👉 ${ad.link}` : ''}`
  const emoji = ad.image || '📣'

  const typeIn = ad.target_kind === 'groups' ? "('group')" : ad.target_kind === 'channels' ? "('channel')" : "('group','channel')"
  const where = onlyChatId ? 'ch.id = ?' : `ch.type IN ${typeIn}`
  const targets = await q<any>(
    c.db,
    `SELECT ch.id, ch.type FROM chats ch WHERE ${where}`,
    onlyChatId ? [onlyChatId] : []
  )
  if (!targets.length) return err('Yuborish uchun mos chatlar topilmadi')

  let sent = 0
  for (const chat of targets) {
    const isChannel = chat.type === 'channel'
    const msgId = newId()
    await exec(
      c.db,
      'INSERT INTO messages (id,chat_id,sender_id,type,content,created_ms) VALUES (?,?,?,?,?,?)',
      [msgId, chat.id, c.uid, 'text', content, nowMs()]
    )
    if (!isChannel) {
      // guruh/direct: yetkazish navbatlari ochamiz
      const members = await q<{ user_id: string }>(c.db, 'SELECT user_id FROM chat_members WHERE chat_id=?', [chat.id])
      const others = members.map((m) => m.user_id).filter((uid) => uid !== c.uid)
      for (const uid of others) {
        await exec(c.db, 'INSERT IGNORE INTO message_delivery (message_id,user_id) VALUES (?,?)', [msgId, uid])
      }
    }
    sent++
    // real-time signal
    await notifyChat(c, chat.id, { t: 'chat:message' })
  }

  // 'all' — lentalarga umumiy reklama posti
  if (ad.target_kind === 'all' && !onlyChatId) {
    await exec(
      c.db,
      'INSERT INTO feed_posts (id,author_id,channel_name,content,gradient,emoji,created_ms) VALUES (?,?,?,?,?,?,?)',
      [newId(), c.uid, '50 Gram Reklama', `${ad.title}\n\n${ad.text}${ad.link ? `\n\n👉 ${ad.link}` : ''}`, 'from-rose-500 to-red-600', emoji, nowMs()]
    )
  }

  await exec(c.db, 'UPDATE ads SET status=?, sent_count=sent_count+?, sent_ms=? WHERE id=?', ['completed', sent, nowMs(), id])
  await log(c, 'send_ad', id, `${ad.title} → ${sent} ta chat`)
  return json({ ok: true, sent, message: `Reklama ${sent} ta chatga yuborildi` })
}

// DO'ga real-time signal yuborish (chat a'zolariga)
export async function notifyChat(c: Ctx, chatId: string, event: unknown) {
  try {
    const members = await q<{ user_id: string }>(c.db, 'SELECT user_id FROM chat_members WHERE chat_id=?', [chatId])
    for (const m of members) {
      const stub = c.env.USER_SOCKET.get(c.env.USER_SOCKET.idFromName(m.user_id))
      await stub.fetch('https://do/notify', { method: 'POST', body: JSON.stringify(event) }).catch(() => {})
    }
  } catch {}
}

export { log as adminLog }
