// ============================================================
// 50 Gram Worker — AUTH / ME / USERS / KONTAKTLAR
// ============================================================
import type { Conn } from './db'
import { q, one, count, exec } from './db'
import { hashPassword, verifyPassword, signJwt } from './auth'
import { json, err, readJson, newId, nowMs, isoOf, normPhone, str, bool } from './util'
import type { Env } from './env'

export interface Ctx {
  env: Env
  uid: string
  db: Conn
}

// ---------- ortak select ----------
const USER_COLS = `id, username, name, phone, balance, avatar, bio, is_admin, is_banned, ban_reason, created_ms`

export function serializeMe(u: any, interests: { topic_id: string; weight: number }[]) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    phone: u.phone ?? null,
    balance: Number(u.balance ?? 0),
    avatar: u.avatar ?? '🙂',
    bio: u.bio ?? null,
    isAdmin: bool(u.is_admin),
    interests: interests.map((i) => ({ topicId: i.topic_id, weight: Number(i.weight) })),
  }
}

export async function interestsOf(c: Ctx, uid: string) {
  return q<{ topic_id: string; weight: number }>(
    c.db,
    'SELECT topic_id, weight FROM user_interests WHERE user_id=?',
    [uid]
  )
}

export async function mePayload(c: Ctx, uid: string) {
  const user = await one<any>(c.db, `SELECT ${USER_COLS} FROM users WHERE id=?`, [uid])
  if (!user) return null
  return serializeMe(user, await interestsOf(c, uid))
}

// ==================== AUTH ====================
export async function apiRegister(req: Request, env: Env, db: Conn) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const username = str(body.username, 40).trim().toLowerCase()
  const name = str(body.name, 80).trim()
  const password = str(body.password, 200)
  const avatar = str(body.avatar, 8) || '🙂'
  const phone = str(body.phone, 30).replace(/[^\d+]/g, '').trim() || null
  const topicSlugs: string[] = Array.isArray(body.topicSlugs) ? body.topicSlugs.slice(0, 10) : []

  if (!/^[a-z0-9_]{3,20}$/.test(username)) return err('Foydalanuvchi nomi 3-20 belgi, faqat lotin harflari va raqamlar')
  if (name.length < 2) return err('Ism juda qisqa')
  if (password.length < 4) return err('Parol kamida 4 belgidan iborat bo\u2018lsin')
  if (topicSlugs.length < 3) return err('Kamida 3 ta mavzu tanlang')
  if (phone && phone.replace(/\D/g, '').length < 9) return err('Telefon raqam noto\u2018g\u2018ri (masalan: +998901234567)')

  if (await one(db, 'SELECT id FROM users WHERE username=?', [username])) return err('Bu foydalanuvchi nomi band', 409)
  if (phone && (await one(db, 'SELECT id FROM users WHERE phone=?', [phone])))
    return err('Bu telefon raqam allaqachon ro\u2018yxatdan o\u2018tgan', 409)

  const topics = topicSlugs.length
    ? await q<any>(db, `SELECT id FROM topics WHERE slug IN (${topicSlugs.map(() => '?').join(',')})`, topicSlugs)
    : []
  if (topics.length < 3) return err('Kamida 3 ta mavzu tanlang')

  const id = newId()
  await exec(db, 'INSERT INTO users (id,username,password,name,phone,avatar,created_ms) VALUES (?,?,?,?,?,?,?)', [
    id,
    username,
    await hashPassword(password),
    name,
    phone,
    avatar,
    nowMs(),
  ])
  for (const t of topics) {
    await exec(db, 'INSERT IGNORE INTO user_interests (user_id,topic_id,weight) VALUES (?,?,1)', [id, t.id])
  }

  // Yangi foydalanuvchini "50 Gram Jamoasi" kanaliga avto-obuna
  const welcome = await one<any>(db, "SELECT id FROM chats WHERE type='channel' AND name IN ('50 Gram Jamoasi','UzbekGram Jamoasi') LIMIT 1")
  if (welcome) {
    await exec(db, 'INSERT IGNORE INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [
      welcome.id,
      id,
      'member',
      nowMs(),
    ])
    await exec(db, 'INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [welcome.id, id, nowMs()])
  }

  const token = await signJwt({ sub: id }, env.JWT_SECRET, 60 * 60 * 24 * 90)
  const me = await mePayload({ env, uid: id, db } as Ctx, id)
  return json({ token, me })
}

export async function apiLogin(req: Request, env: Env, db: Conn) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const raw = str(body.username, 60).trim()
  const password = str(body.password, 200)

  const digitsOnly = raw.replace(/\D/g, '')
  const user = await one<any>(
    db,
    `SELECT ${USER_COLS}, password FROM users WHERE username=? OR phone=? LIMIT 1`,
    [raw.toLowerCase(), digitsOnly || raw]
  )
  if (!user || !(await verifyPassword(password, user.password))) {
    return err('Foydalanuvchi nomi / telefon yoki parol xato', 401)
  }
  if (bool(user.is_banned)) {
    return err('Sizning akkauntingiz bloklangan. Sabab: ' + (user.ban_reason || 'ko\u2018rsatilmagan'), 403)
  }
  const token = await signJwt({ sub: user.id }, env.JWT_SECRET, 60 * 60 * 24 * 90)
  const me = await mePayload({ env, uid: user.id, db } as Ctx, user.id)
  return json({ token, me })
}

export async function apiUsernameCheck(c: Ctx, url: URL) {
  const raw = (url.searchParams.get('username') || '').trim().toLowerCase()
  if (!/^[a-z0-9_]{3,20}$/.test(raw)) {
    return json({ available: false, reason: '3-20 belgi, faqat lotin harflari, raqamlar va _' })
  }
  const exists = await one<any>(c.db, 'SELECT id FROM users WHERE username=?', [raw])
  if (exists && exists.id !== c.uid) return json({ available: false, reason: 'Bu foydalanuvchi nomi band' })
  return json({ available: true })
}

// ==================== ME ====================
export async function apiMeGet(c: Ctx) {
  const me = await mePayload(c, c.uid)
  if (!me) return err('Topilmadi', 404)
  return json(me)
}

export async function apiMePatch(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const me = await one<any>(c.db, 'SELECT * FROM users WHERE id=?', [c.uid])
  if (!me) return err('Topilmadi', 404)

  const sets: string[] = []
  const args: unknown[] = []

  if (typeof body.name === 'string' && body.name.trim().length >= 2) {
    sets.push('name=?')
    args.push(str(body.name.trim(), 80))
  }
  if (typeof body.avatar === 'string') {
    sets.push('avatar=?')
    args.push(str(body.avatar, 8))
  }
  if (typeof body.bio === 'string') {
    sets.push('bio=?')
    args.push(str(body.bio, 200))
  }
  if (typeof body.username === 'string') {
    const uname = body.username.trim().toLowerCase()
    if (uname !== me.username) {
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) return err('Foydalanuvchi nomi 3-20 belgi, faqat lotin harflari, raqamlar va _')
      const exists = await one(c.db, 'SELECT id FROM users WHERE username=?', [uname])
      if (exists) return err('Bu foydalanuvchi nomi band — boshqasini tanlang', 409)
      sets.push('username=?')
      args.push(uname)
    }
  }
  if (body.phone !== undefined) {
    const phone = str(body.phone, 30).replace(/[^\d+]/g, '')
    if (phone && phone.length >= 9) {
      const existing = await one(c.db, 'SELECT id FROM users WHERE phone=?', [phone])
      if (existing && existing.id !== c.uid) return err('Bu telefon raqam boshqa foydalanuvchida', 409)
      sets.push('phone=?')
      args.push(phone)
    } else if (!phone) {
      sets.push('phone=NULL')
    }
  }
  if (sets.length) {
    await exec(c.db, `UPDATE users SET ${sets.join(',')} WHERE id=?`, [...args, c.uid])
  }

  if (Array.isArray(body.topicSlugs)) {
    const slugs: string[] = body.topicSlugs.slice(0, 10)
    const topics = slugs.length
      ? await q<any>(c.db, `SELECT id FROM topics WHERE slug IN (${slugs.map(() => '?').join(',')})`, slugs)
      : []
    for (const t of topics) {
      await exec(
        c.db,
        `INSERT INTO user_interests (user_id,topic_id,weight) VALUES (?,?,1)
         ON DUPLICATE KEY UPDATE weight=GREATEST(weight,1)`,
        [c.uid, t.id]
      )
    }
  }

  const interests = await interestsOf(c, c.uid)
  const fresh = await one<any>(c.db, `SELECT ${USER_COLS} FROM users WHERE id=?`, [c.uid])
  if (!fresh) return err('Topilmadi', 404)
  return json({
    id: fresh.id,
    username: fresh.username,
    name: fresh.name,
    avatar: fresh.avatar,
    bio: fresh.bio ?? null,
    isAdmin: bool(fresh.is_admin),
    interests: interests.map((i) => ({ topicId: i.topic_id, weight: Number(i.weight) })),
  })
}

// ==================== MAVZULAR ====================
export async function apiTopics(c: Ctx) {
  const topics = await q(c.db, 'SELECT id, slug, name, emoji FROM topics ORDER BY id')
  return json(topics)
}

// ==================== FOYDALANUVCHI QIDIRUV ====================
export async function apiUsers(c: Ctx, url: URL) {
  const raw = (url.searchParams.get('q') || '').trim()
  const digits = raw.toLowerCase().replace(/[\s()\-\+]/g, '').replace(/\D/g, '')

  const likeName = `%${raw}%`
  const likeUser = `%${raw.toLowerCase()}%`
  const likePhone = `%${digits || raw.toLowerCase()}%`
  const users = await q<any>(
    c.db,
    `SELECT id, username, name, avatar, bio, phone FROM users
     WHERE id<>? AND (username LIKE ? OR name LIKE ? OR phone LIKE ?)
     ORDER BY created_ms DESC LIMIT 20`,
    [c.uid, likeUser, likeName, likePhone]
  )
  return json(users)
}

// ==================== KONTAKTLAR ====================
export async function apiContactsGet(c: Ctx) {
  const contacts = await q<any>(
    c.db,
    `SELECT k.id, k.name, k.phone, k.created_ms,
            u.id AS l_id, u.username AS l_username, u.name AS l_name, u.avatar AS l_avatar, u.bio AS l_bio
     FROM contacts k LEFT JOIN users u ON u.id = k.linked_user_id
     WHERE k.owner_id=? ORDER BY k.created_ms DESC`,
    [c.uid]
  )
  return json({
    contacts: contacts.map((k) => ({
      id: k.id,
      name: k.name,
      phone: k.phone,
      createdAt: isoOf(Number(k.created_ms)),
      linked: k.l_id
        ? { id: k.l_id, username: k.l_username, name: k.l_name, avatar: k.l_avatar ?? '🙂', bio: k.l_bio ?? null }
        : null,
    })),
  })
}

export async function apiContactsPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const name = str(body.name, 80).trim()
  const phone = normPhone(body.phone)
  if (name.length < 1) return err('Kontakt nomi kerak')
  if (phone.replace(/\D/g, '').length < 9) return err('Telefon raqam noto\u2018g\u2018ri (masalan: +998901234567)')

  const linkedUser = await one<any>(c.db, 'SELECT id, username, name, avatar, bio FROM users WHERE phone=?', [phone])
  if (linkedUser && linkedUser.id === c.uid) return err('Bu o\u2018zingizning raqamingiz')
  if (await one(c.db, 'SELECT id FROM contacts WHERE owner_id=? AND phone=?', [c.uid, phone]))
    return err('Bu kontakt allaqachon saqlangan', 409)

  const id = newId()
  await exec(c.db, 'INSERT INTO contacts (id,owner_id,name,phone,linked_user_id,created_ms) VALUES (?,?,?,?,?,?)', [
    id,
    c.uid,
    name,
    phone,
    linkedUser?.id ?? null,
    nowMs(),
  ])
  return json({
    id,
    name,
    phone,
    linked: linkedUser
      ? { id: linkedUser.id, username: linkedUser.username, name: linkedUser.name, avatar: linkedUser.avatar ?? '🙂', bio: linkedUser.bio ?? null }
      : null,
  })
}

export async function apiContactDelete(c: Ctx, id: string) {
  const contact = await one<any>(c.db, 'SELECT id, owner_id FROM contacts WHERE id=?', [id])
  if (!contact || contact.owner_id !== c.uid) return err('Kontakt topilmadi', 404)
  await exec(c.db, 'DELETE FROM contacts WHERE id=?', [id])
  return json({ ok: true })
}
