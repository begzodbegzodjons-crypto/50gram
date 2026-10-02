// =====================================================================
// 50 GRAM API — Cloudflare Workers + TiDB Cloud Serverless + Durable Objects
// Frontend (web/) shu Worker orqali Static Assets sifatida beriladi; API: /api/*
// =====================================================================
import { makeDb, ph, type Db } from "./db"
import { signJwt, verifyJwt, sha256, randomStr, randomCode, hmacHex } from "./auth"
import { sendSms, smsConfigured } from "./sms"
import { pushUsers } from "./push"
export { UserSocket } from "./realtime"

export interface Env {
  DATABASE_URL: string
  JWT_SECRET: string
  DEV_MODE?: string
  TEST_PHONES?: string
  ESKIZ_EMAIL?: string
  ESKIZ_PASSWORD?: string
  ESKIZ_FROM?: string
  SMS_TEXT?: string
  TURN_KEY_ID?: string
  TURN_KEY_TOKEN?: string
  // Web Push (VAPID): public = base64url(65-baytli P-256 nuqta), private = base64url(JSON {d,x,y})
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  USER_SOCKET: any
  AI?: any
  __db?: Db
}

type C = {
  env: Env
  db: Db
  uid: number
  req: Request
  url: URL
  p: Record<string, string>
  b: any
  wait: (p: Promise<unknown>) => void
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
}
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } })
class HttpError extends Error {
  constructor(msg: string, public status = 400) { super(msg) }
}
const fail = (msg: string, status = 400): never => { throw new HttpError(msg, status) }
const now = () => Date.now()
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000)
const DAY = 86400000
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)
const normPhone = (p: unknown) => {
  let d = String(p || "").replace(/\D/g, "")
  if (d.length === 9) d = "998" + d
  if (d.length < 10 || d.length > 15) fail("Telefon raqam noto‘g‘ri")
  return "+" + d
}
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/
const USER_COLS = "id,phone,first_name,last_name,username,bio,avatar_ver,privacy_phone,privacy_last_seen,last_seen,prefs"
const CHAT_COLS = "id,type,title,description,username,avatar_ver,owner_id,is_public,invite_hash,join_approval,permissions,settings,member_count,last_msg_at,created_at,pinned_id"
const PREF_KEYS = new Set(["sounds", "vibrate", "preview", "autoload", "stickerauto", "livealerts"])
const DEF_PERMS = { send: 1, media: 1, stickers: 1, links: 1, polls: 1, invite: 1 }
const DEF_SET = { signatures: 0, comments: 1, reactions: 1, protect: 0, slow: 0 }
const MSG_KINDS = new Set(["text", "sticker", "gif", "photo", "video", "voice", "round", "file", "contact", "poll", "location"])
const NOTIFY_CAP = 40

// ------------------------- Coin / Martaba (jonli efir iqtisodiyoti) -------------------------
// coin — sarflanadigan valyuta (sovg'a yuborish), earned — umumiy yig'ilgan ball (martaba, kamaymaydi)
const GIFTS: Record<string, number> = { star: 5, heart: 10, rose: 25, fire: 49, cake: 149, crown: 199, diamond: 499, rocket: 999 }
const LEVELS = [
  { n: "Yangi a'zo", e: "🌱", min: 0 },
  { n: "Yulduz", e: "⭐", min: 500 },
  { n: "Bronza", e: "🥉", min: 2000 },
  { n: "Kumush", e: "🥈", min: 10000 },
  { n: "Oltin", e: "🥇", min: 30000 },
  { n: "Platina", e: "💠", min: 100000 },
  { n: "Brilliant", e: "💎", min: 300000 },
  { n: "Afsona", e: "👑", min: 1000000 },
]
function levelOf(earned: number) {
  let i = 0
  for (let k = 0; k < LEVELS.length; k++) if (earned >= LEVELS[k].min) i = k
  const cur = LEVELS[i], nx = LEVELS[i + 1] || null
  const pct = nx ? Math.min(100, Math.round(((earned - cur.min) / (nx.min - cur.min)) * 100)) : 100
  return { i: i + 1, name: cur.n, emoji: cur.e, min: cur.min, next: nx ? nx.min : null, next_name: nx ? nx.n : null, pct }
}
async function walletOf(c: C, uid: number) {
  await ensureSchema(c.db)
  await c.db.run("INSERT IGNORE INTO wallets(user_id,coins,earned,spent,gifts_sent,gifts_recv,last_daily,updated_at) VALUES(?,500,0,0,0,0,0,?)", [uid, now()])
  return await c.db.one("SELECT * FROM wallets WHERE user_id=?", [uid])
}
// Task 29 sxemasi: yangi jadvallar mavjud emas bo'lsa (migratsiya o'tmagan deploy) — o'z-o'zidan yaratadi.
// Idempotent: har isolatda bir marta, har bayonot alohida try/catch (ayrimlari allaqachon bo'lsa xato emas).
let t29ok = false
async function ensureSchema(db: Db) {
  if (t29ok) return
  const stmts = [
    "CREATE TABLE IF NOT EXISTS wallets (user_id BIGINT PRIMARY KEY, coins BIGINT NOT NULL DEFAULT 500, earned BIGINT NOT NULL DEFAULT 0, spent BIGINT NOT NULL DEFAULT 0, gifts_sent INT NOT NULL DEFAULT 0, gifts_recv INT NOT NULL DEFAULT 0, last_daily BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_wallets_earned ON wallets (earned)",
    "CREATE TABLE IF NOT EXISTS msg_comments (id BIGINT PRIMARY KEY, chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL, user_id BIGINT NOT NULL, body VARCHAR(500) NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_msg_comments_mid ON msg_comments (message_id)",
    "CREATE INDEX IF NOT EXISTS idx_msg_comments_chat ON msg_comments (chat_id, created_at)",
    "ALTER TABLE live_viewers ADD COLUMN rewarded INT NOT NULL DEFAULT 0",
  ]
  for (const s of stmts) { try { await db.run(s) } catch {} }
  try {
    await db.one("SELECT user_id FROM wallets LIMIT 1")
    t29ok = true // so'rov o'tdi — jadval bor
  } catch { t29ok = false }
}

// ------------------------- Realtime -------------------------
async function notify(env: Env, uids: number[], ev: unknown) {
  const body = JSON.stringify(ev)
  const uniq = [...new Set(uids)].slice(0, NOTIFY_CAP + 1)
  await Promise.all(uniq.map(async (u) => {
    try {
      const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(u)))
      await stub.fetch("https://do/push", { method: "POST", body })
    } catch (e) { console.log("notify xato", u, String(e)) }
  }))
}
async function memberIds(c: C, chatId: number) {
  // Katta kanallarda ham birinchi NOTIFY_CAP faol a'zoga real vaqt hodisasi boradi (qolganlari 4s poll bilan ushlaydi)
  const rows = await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? AND status='active' LIMIT " + NOTIFY_CAP, [chatId])
  return rows.map((r) => r.user_id as number)
}
function notifyChat(c: C, chatId: number, ev: unknown, extra: number[] = []) {
  c.wait(memberIds(c, chatId).then((ids) => notify(c.env, [...ids, ...extra], ev)))
}

// ------------------------- Formatlash -------------------------
function pubUser(u: any, viewer: number, contactName?: { first_name: string; last_name: string }) {
  if (!u) return null
  const self = u.id === viewer
  const t = now()
  return {
    id: u.id,
    first_name: contactName?.first_name || u.first_name,
    last_name: contactName ? contactName.last_name : u.last_name,
    real_name: (u.first_name + " " + (u.last_name || "")).trim(),
    username: u.username || null,
    bio: u.bio || "",
    avatar_ver: u.avatar_ver || 0,
    phone: self || u.privacy_phone === 0 ? u.phone : null,
    online: u.privacy_last_seen === 2 && !self ? null : t - (u.last_seen || 0) < 70000,
    last_seen: u.privacy_last_seen === 2 && !self ? null : u.last_seen || 0,
    is_contact: !!contactName,
  }
}
async function contactMap(c: C) {
  const rows = await c.db.q("SELECT phone,first_name,last_name FROM contacts WHERE owner_id=?", [c.uid])
  return new Map(rows.map((r) => [r.phone as string, r]))
}
async function usersByIds(c: C, ids: number[], cmap?: Map<string, any>) {
  const out = new Map<number, any>()
  const u = [...new Set(ids)].filter(Boolean)
  if (!u.length) return out
  const m = cmap || (await contactMap(c))
  const rows = await c.db.q(`SELECT ${USER_COLS} FROM users WHERE id IN (${ph(u)})`, u)
  const flags = await storyFlags(c, u)
  for (const r of rows) out.set(r.id, { ...pubUser(r, c.uid, m.get(r.phone)), story: flags.get(r.id) || null })
  return out
}
async function storyFlags(c: C, ids: number[]) {
  const m = new Map<number, { count: number; unseen: number }>()
  if (!ids.length) return m
  const rows = await c.db.q(
    `SELECT s.user_id, COUNT(*) AS cnt, SUM(CASE WHEN v.viewer_id IS NULL THEN 1 ELSE 0 END) AS unseen
     FROM stories s LEFT JOIN story_views v ON v.story_id=s.id AND v.viewer_id=?
     WHERE s.user_id IN (${ph(ids)}) AND s.expires_at>? GROUP BY s.user_id`,
    [c.uid, ...ids, now()],
  )
  for (const r of rows) m.set(r.user_id, { count: Number(r.cnt), unseen: Number(r.unseen) })
  return m
}
const parse = (s: unknown, def: any) => { try { return { ...def, ...(s ? JSON.parse(String(s)) : {}) } } catch { return { ...def } } }
function chatOut(r: any) {
  return {
    id: r.id, type: r.type, title: r.title, description: r.description, username: r.username || null,
    avatar_ver: r.avatar_ver || 0, owner_id: r.owner_id, is_public: r.is_public, join_approval: r.join_approval,
    permissions: parse(r.permissions, DEF_PERMS), settings: parse(r.settings, DEF_SET),
    member_count: r.member_count, last_msg_at: r.last_msg_at, created_at: r.created_at, pinned_id: r.pinned_id || 0,
    role: r.role || null, last_read: r.last_read || 0, muted: r.muted || 0, pinned: r.pinned || 0, unread: Number(r.unread || 0),
  }
}
function msgOut(m: any) {
  return {
    id: m.id, chat_id: m.chat_id, sender_id: m.sender_id, kind: m.kind,
    body: m.deleted ? null : m.body, meta: m.deleted ? null : parse(m.meta, {}),
    edited: m.edited, deleted: m.deleted, created_at: m.created_at, updated_at: m.updated_at,
  }
}

// ------------------------- Ruxsatlar -------------------------
async function member(c: C, chatId: number) {
  return c.db.one("SELECT role,status,last_read FROM chat_members WHERE chat_id=? AND user_id=?", [chatId, c.uid])
}
const isAdm = (m: any) => m && m.status === "active" && (m.role === "owner" || m.role === "admin")
async function needChat(c: C, id: number) {
  const ch = await c.db.one(`SELECT ${CHAT_COLS},direct_key FROM chats WHERE id=?`, [id])
  if (!ch) fail("Chat topilmadi", 404)
  return ch
}
async function needAdmin(c: C, id: number) {
  const m = await member(c, id)
  if (!isAdm(m)) fail("Bu amal faqat adminlar uchun", 403)
  return m
}
async function blockedBetween(c: C, a: number, b: number) {
  const r = await c.db.one("SELECT user_id FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1", [a, b, b, a])
  return !!r
}
async function checkUsername(c: C, name: string, selfUser?: number, selfChat?: number) {
  if (!USERNAME_RE.test(name)) fail("Username: 5–32 belgi, harf bilan boshlansin (a-z, 0-9, _)")
  const u = await c.db.one("SELECT id FROM users WHERE username=?", [name])
  const ch = await c.db.one("SELECT id FROM chats WHERE username=?", [name])
  if ((u && u.id !== selfUser) || (ch && ch.id !== selfChat)) fail("Bu username band")
}
function avatarOk(v: unknown) {
  if (v === null) return null
  const s = String(v || "")
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) fail("Rasm formati noto‘g‘ri")
  if (s.length > 600000) fail("Rasm juda katta")
  return s
}
// Kontaktlar va shaxsiy chat hamrohlari — istoriya/efirlarni ko'rishi mumkin bo'lganlar
async function circle(c: C) {
  const rows = await c.db.q(
    `SELECT u.id FROM users u JOIN contacts k ON k.phone=u.phone WHERE k.owner_id=?
     UNION SELECT m2.user_id AS id FROM chat_members m1 JOIN chats ch ON ch.id=m1.chat_id AND ch.type='direct'
     JOIN chat_members m2 ON m2.chat_id=ch.id WHERE m1.user_id=?`,
    [c.uid, c.uid],
  )
  const blocked = await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=?", [c.uid])
  const bl = new Set(blocked.map((r) => r.user_id))
  return [...new Set([c.uid, ...rows.map((r) => r.id as number)])].filter((x) => !bl.has(x))
}

// ------------------------- Auth -------------------------
async function authOtp(c: C) {
  const phone = normPhone(c.b.phone)
  const t = now()
  const prev = await c.db.one("SELECT sent_at FROM otp WHERE phone=?", [phone])
  if (prev && t - prev.sent_at < 55000) fail("Kodni qayta so‘rash uchun 1 daqiqa kuting", 429)
  const test = (c.env.TEST_PHONES || "").split(",").map((x) => x.trim().split(":")).find(([p]) => p === phone)
  const code = test ? test[1] : randomCode()
  await c.db.run("REPLACE INTO otp(phone,code_hash,expires_at,sent_at,tries) VALUES(?,?,?,?,0)", [phone, await sha256(phone + code + c.env.JWT_SECRET), t + 5 * 60000, t])
  if (test) return json({ ok: true, phone })
  if (smsConfigured(c.env)) {
    await sendSms(c.env, phone, code)
    return json({ ok: true, phone })
  }
  if (c.env.DEV_MODE === "1") return json({ ok: true, phone, dev_code: code })
  return fail("SMS xizmati sozlanmagan (ESKIZ_EMAIL/ESKIZ_PASSWORD)", 503)
}
async function authVerify(c: C) {
  const phone = normPhone(c.b.phone)
  const code = String(c.b.code || "").replace(/\D/g, "")
  const o = await c.db.one("SELECT * FROM otp WHERE phone=?", [phone])
  if (!o || o.expires_at < now()) fail("Kod eskirgan, qaytadan so‘rang")
  if (o.tries >= 5) fail("Juda ko‘p urinish. Yangi kod so‘rang", 429)
  if ((await sha256(phone + code + c.env.JWT_SECRET)) !== o.code_hash) {
    await c.db.run("UPDATE otp SET tries=tries+1 WHERE phone=?", [phone])
    fail("Kod noto‘g‘ri")
  }
  await c.db.run("DELETE FROM otp WHERE phone=?", [phone])
  let u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE phone=?`, [phone])
  if (!u) {
    const id = newId()
    await c.db.run("INSERT INTO users(id,phone,created_at,last_seen) VALUES(?,?,?,?)", [id, phone, now(), now()])
    u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE id=?`, [id])
  }
  const token = await signJwt({ sub: String(u.id) }, c.env.JWT_SECRET, 180 * 86400)
  return json({ token, user: pubUser(u, u.id), is_new: !u.first_name })
}

// ------------------------- Profil -------------------------
async function getMe(c: C) {
  const u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE id=?`, [c.uid])
  if (!u) fail("Hisob topilmadi", 401)
  const f = await storyFlags(c, [c.uid])
  return json({ ...pubUser(u, c.uid), privacy_phone: u.privacy_phone, privacy_last_seen: u.privacy_last_seen, prefs: parse((u as any).prefs, { sounds: 1, vibrate: 1, preview: 1, autoload: 1 }), story: f.get(c.uid) || null })
}
async function patchMe(c: C) {
  const b = c.b, sets: string[] = [], vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(col + "=?"); vals.push(v) }
  if ("first_name" in b) { const v = str(b.first_name, 64); if (!v) fail("Ism kiriting"); put("first_name", v) }
  if ("last_name" in b) put("last_name", str(b.last_name, 64))
  if ("bio" in b) put("bio", str(b.bio, 200))
  if ("username" in b) {
    const v = str(b.username, 32).replace(/^@/, "")
    if (v) await checkUsername(c, v, c.uid)
    put("username", v || null)
  }
  if ("privacy_phone" in b) put("privacy_phone", [0, 1, 2].includes(+b.privacy_phone) ? +b.privacy_phone : 1)
  if ("privacy_last_seen" in b) put("privacy_last_seen", [0, 1, 2].includes(+b.privacy_last_seen) ? +b.privacy_last_seen : 0)
  if ("avatar" in b) { const a = avatarOk(b.avatar); put("avatar", a); put("avatar_ver", a ? now() : 0) }
  if (b.prefs && typeof b.prefs === "object") {
    const u0 = await c.db.one("SELECT prefs FROM users WHERE id=?", [c.uid])
    const cur = parse(u0?.prefs, {})
    const np: Record<string, number> = {}
    for (const k of Object.keys(b.prefs)) if (PREF_KEYS.has(k)) np[k] = b.prefs[k] === 0 || b.prefs[k] === false ? 0 : 1
    put("prefs", JSON.stringify({ ...cur, ...np }))
  }
  if (sets.length) await c.db.run(`UPDATE users SET ${sets.join(",")} WHERE id=?`, [...vals, c.uid])
  return getMe(c)
}
async function avatar(c: C, table: "users" | "chats") {
  const r = await c.db.one(`SELECT avatar FROM ${table} WHERE id=?`, [+c.p.id])
  if (!r?.avatar) return new Response("", { status: 404, headers: CORS })
  const [head, data] = String(r.avatar).split(",")
  const mime = head.slice(5, head.indexOf(";"))
  const bin = Uint8Array.from(atob(data), (x) => x.charCodeAt(0))
  return new Response(bin, { headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable", ...CORS } })
}
async function getUser(c: C) {
  const id = +c.p.id
  const m = await usersByIds(c, [id])
  const u = m.get(id)
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  const iBlocked = !!(await c.db.one("SELECT 1 AS x FROM blocks WHERE user_id=? AND blocked_id=?", [c.uid, id]))
  const live = await c.db.one("SELECT id FROM lives WHERE user_id=? AND ended_at=0 AND started_at>?", [id, now() - 12 * 3600000])
  const direct = await c.db.one("SELECT id FROM chats WHERE direct_key=?", [[c.uid, id].sort((a, b) => a - b).join(":")])
  const w = await c.db.one("SELECT earned FROM wallets WHERE user_id=?", [id]).catch(() => null) as any
  return json({ ...u, lvl: levelOf(Number(w?.earned || 0)), i_blocked: iBlocked, live_id: live?.id || null, chat_id: direct?.id || null })
}

// ------------------------- Qidiruv -------------------------
async function search(c: C) {
  const q = str(c.url.searchParams.get("q"), 64)
  if (q.length < 2) return json({ users: [], chats: [] })
  const digits = q.replace(/\D/g, "")
  const like = "%" + q.replace(/[%_]/g, "") + "%"
  const uname = q.replace(/^@/, "").replace(/[%_]/g, "") + "%"
  let ids: number[] = []
  if (digits.length >= 9 && digits.length === q.replace(/[\s+()-]/g, "").length) {
    const ph9 = digits.length === 9 ? "+998" + digits : "+" + digits
    ids = (await c.db.q("SELECT id FROM users WHERE phone=? AND first_name<>''", [ph9])).map((r) => r.id)
  } else {
    ids = (await c.db.q(
      `SELECT id FROM users WHERE first_name<>'' AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name,' ',last_name) LIKE ?) LIMIT 25`,
      [uname, like, like, like],
    )).map((r) => r.id)
    const cs = await c.db.q("SELECT u.id FROM contacts k JOIN users u ON u.phone=k.phone WHERE k.owner_id=? AND (k.first_name LIKE ? OR k.last_name LIKE ?)", [c.uid, like, like])
    ids = [...new Set([...cs.map((r) => r.id), ...ids])]
  }
  const um = await usersByIds(c, ids.filter((x) => x !== c.uid))
  const chats = await c.db.q(
    `SELECT ${CHAT_COLS} FROM chats WHERE type<>'direct' AND is_public=1 AND (title LIKE ? OR username LIKE ?) ORDER BY member_count DESC LIMIT 20`,
    [like, uname],
  )
  return json({ users: [...um.values()], chats: chats.map(chatOut) })
}
async function discover(c: C) {
  const rows = await c.db.q(
    `SELECT ${CHAT_COLS.split(",").map((x) => "c." + x).join(",")}, m.role FROM chats c LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=? AND m.status='active'
     WHERE c.type<>'direct' AND c.is_public=1 ORDER BY c.member_count DESC, c.last_msg_at DESC LIMIT 40`,
    [c.uid],
  )
  return json(rows.map(chatOut))
}

// ------------------------- Kontaktlar / bloklar -------------------------
async function listContacts(c: C) {
  const rows = await c.db.q(
    `SELECT k.phone AS k_phone, k.first_name AS k_first, k.last_name AS k_last, u.id FROM contacts k LEFT JOIN users u ON u.phone=k.phone
     WHERE k.owner_id=? ORDER BY k.first_name`,
    [c.uid],
  )
  const um = await usersByIds(c, rows.filter((r) => r.id).map((r) => r.id))
  return json(rows.map((r) => ({ phone: r.k_phone, first_name: r.k_first, last_name: r.k_last, user: r.id ? um.get(r.id) || null : null })))
}
async function addContact(c: C) {
  const phone = normPhone(c.b.phone)
  const first = str(c.b.first_name, 64)
  if (!first) fail("Ism kiriting")
  await c.db.run("REPLACE INTO contacts(owner_id,phone,first_name,last_name,created_at) VALUES(?,?,?,?,?)", [c.uid, phone, first, str(c.b.last_name, 64), now()])
  const u = await c.db.one("SELECT id FROM users WHERE phone=? AND first_name<>''", [phone])
  const um = u ? await usersByIds(c, [u.id]) : new Map()
  return json({ phone, first_name: first, last_name: str(c.b.last_name, 64), user: u ? um.get(u.id) : null })
}
async function delContact(c: C) {
  await c.db.run("DELETE FROM contacts WHERE owner_id=? AND phone=?", [c.uid, normPhone(decodeURIComponent(c.p.phone))])
  return json({ ok: true })
}
async function listBlocks(c: C) {
  const rows = await c.db.q("SELECT blocked_id FROM blocks WHERE user_id=?", [c.uid])
  const um = await usersByIds(c, rows.map((r) => r.blocked_id))
  return json([...um.values()])
}
async function block(c: C, on: boolean) {
  const id = +c.p.id
  if (id === c.uid) fail("O‘zingizni bloklab bo‘lmaydi")
  if (on) await c.db.run("REPLACE INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)", [c.uid, id, now()])
  else await c.db.run("DELETE FROM blocks WHERE user_id=? AND blocked_id=?", [c.uid, id])
  return json({ ok: true })
}

// ------------------------- Chatlar -------------------------
async function chatSummaries(c: C, onlyId?: number) {
  const rows = await c.db.q(
    `SELECT ${CHAT_COLS.split(",").map((x) => "c." + x).join(",")}, m.role, m.last_read, m.muted, m.pinned,
      (SELECT COUNT(*) FROM messages x WHERE x.chat_id=c.id AND x.id>m.last_read AND x.sender_id<>? AND x.deleted=0) AS unread
     FROM chat_members m JOIN chats c ON c.id=m.chat_id
     WHERE m.user_id=? AND m.status='active' ${onlyId ? "AND c.id=?" : ""} ORDER BY c.last_msg_at DESC LIMIT 300`,
    onlyId ? [c.uid, c.uid, onlyId] : [c.uid, c.uid],
  )
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const last = await c.db.q(
    `SELECT * FROM messages WHERE id IN (SELECT MAX(id) FROM messages WHERE chat_id IN (${ph(ids)}) AND deleted=0 GROUP BY chat_id)`,
    ids,
  )
  const lastMap = new Map(last.map((m) => [m.chat_id, msgOut(m)]))
  const directIds = rows.filter((r) => r.type === "direct").map((r) => r.id)
  const peers = directIds.length
    ? await c.db.q(`SELECT chat_id, user_id, last_read AS peer_last_read FROM chat_members WHERE chat_id IN (${ph(directIds)}) AND user_id<>?`, [...directIds, c.uid])
    : []
  const um = await usersByIds(c, [...peers.map((p) => p.user_id), c.uid])
  const peerMap = new Map(peers.map((p) => [p.chat_id, p]))
  return rows.map((r) => {
    const o: any = chatOut(r)
    o.last_message = lastMap.get(r.id) || null
    if (r.type === "direct") {
      const p = peerMap.get(r.id)
      o.peer = p ? um.get(p.user_id) : um.get(c.uid)
      o.saved = !p
      o.peer_last_read = p ? p.peer_last_read : o.last_read
    }
    return o
  })
}
async function listChats(c: C) {
  return json({ chats: await chatSummaries(c), now: now() })
}
async function openDirect(c: C) {
  const peer = +c.b.user_id
  const u = await c.db.one("SELECT id FROM users WHERE id=?", [peer])
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  const key = [c.uid, peer].sort((a, b) => a - b).join(":")
  let ch = await c.db.one("SELECT id FROM chats WHERE direct_key=?", [key])
  if (!ch) {
    if (peer !== c.uid && (await blockedBetween(c, c.uid, peer))) fail("Bu foydalanuvchiga yozib bo‘lmaydi", 403)
    const id = newId(), t = now()
    await c.db.run("INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES(?,?,?,0,?,?,?,?,?)",
      [id, "direct", c.uid, randomStr(10), key, peer === c.uid ? 1 : 2, t, t])
    await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, c.uid, t])
    if (peer !== c.uid) await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, peer, t])
    ch = { id }
  }
  const s = await chatSummaries(c, ch.id)
  return json(s[0])
}
async function createChat(c: C) {
  const type = c.b.type === "channel" ? "channel" : "group"
  const title = str(c.b.title, 128)
  if (!title) fail("Nom kiriting")
  const username = str(c.b.username, 32).replace(/^@/, "")
  if (username) await checkUsername(c, username)
  const id = newId(), t = now()
  const pub = c.b.is_public === 0 || c.b.is_public === false ? 0 : 1
  const av = c.b.avatar ? avatarOk(c.b.avatar) : null
  await c.db.run(
    `INSERT INTO chats(id,type,title,description,username,avatar,avatar_ver,owner_id,is_public,invite_hash,join_approval,permissions,settings,member_count,last_msg_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [id, type, title, str(c.b.description, 500), username || null, av, av ? t : 0, c.uid, pub, randomStr(12), c.b.join_approval ? 1 : 0,
      JSON.stringify(DEF_PERMS), JSON.stringify(DEF_SET), t, t],
  )
  await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'owner',?)", [id, c.uid, t])
  const add: number[] = Array.isArray(c.b.members) ? c.b.members.map(Number).filter((x: number) => x && x !== c.uid).slice(0, 200) : []
  for (const u of add) await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, u, t])
  await recount(c, id)
  await sysMsg(c, id, type === "channel" ? "Kanal yaratildi" : "Guruh yaratildi")
  if (add.length) c.wait(notify(c.env, add, { type: "chat_update", chat_id: id }))
  return json((await chatSummaries(c, id))[0])
}
async function recount(c: C, id: number) {
  const r = await c.db.one("SELECT COUNT(*) AS cnt FROM chat_members WHERE chat_id=? AND status='active'", [id])
  await c.db.run("UPDATE chats SET member_count=? WHERE id=?", [Number(r?.cnt || 0), id])
}
async function sysMsg(c: C, chatId: number, text: string) {
  const id = newId(), t = now()
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,'system',?,NULL,?,?,?)",
    [id, chatId, c.uid, text, t, t, t + 100 * 365 * DAY])
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, chatId])
  const m = msgOut(await c.db.one("SELECT * FROM messages WHERE id=?", [id]))
  notifyChat(c, chatId, { type: "message", chat_id: chatId, message: m })
}
async function getChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  const active = m && m.status === "active"
  if (!active && (ch.type === "direct" || !ch.is_public)) {
    const hash = c.url.searchParams.get("hash")
    if (!hash || hash !== ch.invite_hash) fail("Bu yopiq chat", 403)
  }
  let o: any = active ? (await chatSummaries(c, id))[0] : chatOut(ch)
  o.joined = !!active
  o.banned = m?.status === "banned"
  const req = await c.db.one("SELECT 1 AS x FROM join_requests WHERE chat_id=? AND user_id=?", [id, c.uid])
  o.requested = !!req
  if (isAdm(m)) {
    o.invite_hash = ch.invite_hash
    const rc = await c.db.one("SELECT COUNT(*) AS cnt FROM join_requests WHERE chat_id=?", [id])
    o.requests = Number(rc?.cnt || 0)
  }
  return json(o)
}
async function chatByInvite(c: C) {
  const ch = await c.db.one(`SELECT ${CHAT_COLS} FROM chats WHERE invite_hash=? AND type<>'direct'`, [c.p.hash])
  if (!ch) fail("Havola yaroqsiz yoki bekor qilingan", 404)
  const m = await member(c, ch.id)
  return json({ ...chatOut(ch), joined: m?.status === "active", invite_hash: c.p.hash })
}
async function chatByUsername(c: C) {
  const name = c.p.name.replace(/^@/, "")
  const ch = await c.db.one(`SELECT ${CHAT_COLS} FROM chats WHERE username=? AND type<>'direct'`, [name])
  if (ch) { const m = await member(c, ch.id); return json({ chat: { ...chatOut(ch), joined: m?.status === "active" } }) }
  const u = await c.db.one("SELECT id FROM users WHERE username=?", [name])
  if (u) return json({ user: (await usersByIds(c, [u.id])).get(u.id) })
  return fail("Topilmadi", 404)
}
async function patchChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chatni sozlab bo‘lmaydi")
  await needAdmin(c, id)
  const b = c.b, sets: string[] = [], vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(col + "=?"); vals.push(v) }
  if ("title" in b) { const v = str(b.title, 128); if (!v) fail("Nom bo‘sh bo‘lmasin"); put("title", v) }
  if ("description" in b) put("description", str(b.description, 500))
  if ("username" in b) { const v = str(b.username, 32).replace(/^@/, ""); if (v) await checkUsername(c, v, undefined, id); put("username", v || null) }
  if ("is_public" in b) put("is_public", b.is_public ? 1 : 0)
  if ("join_approval" in b) put("join_approval", b.join_approval ? 1 : 0)
  if (b.permissions && typeof b.permissions === "object") {
    const cur = parse(ch.permissions, DEF_PERMS)
    for (const k of Object.keys(DEF_PERMS)) if (k in b.permissions) cur[k] = b.permissions[k] ? 1 : 0
    put("permissions", JSON.stringify(cur))
  }
  if (b.settings && typeof b.settings === "object") {
    const cur = parse(ch.settings, DEF_SET)
    for (const k of Object.keys(DEF_SET)) if (k in b.settings) cur[k] = k === "slow" ? Math.max(0, Math.min(3600, +b.settings[k] || 0)) : b.settings[k] ? 1 : 0
    put("settings", JSON.stringify(cur))
  }
  if ("avatar" in b) { const a = avatarOk(b.avatar); put("avatar", a); put("avatar_ver", a ? now() : 0) }
  if (sets.length) await c.db.run(`UPDATE chats SET ${sets.join(",")} WHERE id=?`, [...vals, id])
  notifyChat(c, id, { type: "chat_update", chat_id: id })
  return getChat(c)
}
async function deleteChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (ch.type === "direct") { if (!m) fail("Ruxsat yo‘q", 403) }
  else if (ch.owner_id !== c.uid) fail("Faqat egasi o‘chira oladi", 403)
  const ids = (await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? LIMIT 41", [id])).map((r) => r.user_id)
  await dropMedia(c.db, "chat_id=?", [id])
  await c.db.run("DELETE FROM messages WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chat_members WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM join_requests WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chats WHERE id=?", [id])
  c.wait(notify(c.env, ids, { type: "chat_deleted", chat_id: id }))
  return json({ ok: true })
}
async function revokeInvite(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const h = randomStr(12)
  await c.db.run("UPDATE chats SET invite_hash=? WHERE id=?", [h, id])
  return json({ invite_hash: h })
}
async function joinChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Bu shaxsiy chat")
  const m = await member(c, id)
  if (m?.status === "banned") fail("Siz bu chatdan chetlatilgansiz", 403)
  if (m?.status === "active") return json({ joined: true })
  const viaHash = c.b.hash && c.b.hash === ch.invite_hash
  if (!ch.is_public && !viaHash) fail("Bu yopiq chat — taklif havolasi kerak", 403)
  if (ch.join_approval) {
    await c.db.run("REPLACE INTO join_requests(chat_id,user_id,created_at) VALUES(?,?,?)", [id, c.uid, now()])
    const admins = (await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? AND role IN ('owner','admin') AND status='active' LIMIT 20", [id])).map((r) => r.user_id)
    c.wait(notify(c.env, admins, { type: "join_request", chat_id: id }))
    return json({ joined: false, requested: true })
  }
  await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, c.uid, now()])
  await recount(c, id)
  if (ch.type === "group") await sysMsg(c, id, "guruhga qo‘shildi")
  return json({ joined: true, chat: (await chatSummaries(c, id))[0] })
}
async function leaveChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chatni o‘chiring")
  if (ch.owner_id === c.uid) fail("Egasi chiqib keta olmaydi — kanal/guruhni o‘chiring")
  await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", [id, c.uid])
  await recount(c, id)
  if (ch.type === "group") await sysMsg(c, id, "guruhni tark etdi")
  return json({ ok: true })
}
async function listMembers(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (!m || m.status !== "active") fail("Ruxsat yo‘q", 403)
  if (ch.type === "channel" && !isAdm(m)) fail("Kanal a‘zolarini faqat adminlar ko‘radi", 403)
  const st = c.url.searchParams.get("status") === "banned" ? "banned" : "active"
  const rows = await c.db.q("SELECT user_id, role, status FROM chat_members WHERE chat_id=? AND status=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at LIMIT 500", [id, st])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json(rows.map((r) => ({ ...um.get(r.user_id), role: r.role, status: r.status })).filter((x) => x.id))
}
async function addMembers(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chat")
  const m = await member(c, id)
  const perms = parse(ch.permissions, DEF_PERMS)
  if (!isAdm(m) && !(ch.type === "group" && m?.status === "active" && perms.invite)) fail("A‘zo qo‘shishga ruxsat yo‘q", 403)
  const ids: number[] = (Array.isArray(c.b.user_ids) ? c.b.user_ids : []).map(Number).filter(Boolean).slice(0, 100)
  const t = now()
  for (const u of ids) {
    const ex = await c.db.one("SELECT status FROM chat_members WHERE chat_id=? AND user_id=?", [id, u])
    if (ex?.status === "active") continue
    if (ex?.status === "banned" && !isAdm(m)) continue
    await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, u, t])
  }
  await recount(c, id)
  if (ids.length) await sysMsg(c, id, `${ids.length} ta a‘zo qo‘shildi`)
  c.wait(notify(c.env, ids, { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function memberAction(c: C) {
  const id = +c.p.id, target = +c.p.uid, action = c.p.action
  const ch = await needChat(c, id)
  const me = await needAdmin(c, id)
  const t = await c.db.one("SELECT role,status FROM chat_members WHERE chat_id=? AND user_id=?", [id, target])
  if (target === ch.owner_id) fail("Egasiga nisbatan bu amalni bajarib bo‘lmaydi", 403)
  if (t?.role === "admin" && me.role !== "owner" && action !== "unban") fail("Adminni faqat egasi boshqaradi", 403)
  switch (action) {
    case "admin":
    case "unadmin":
      if (me.role !== "owner") fail("Admin tayinlashni faqat egasi qila oladi", 403)
      if (!t || t.status !== "active") fail("A‘zo emas")
      await c.db.run("UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=?", [action === "admin" ? "admin" : "member", id, target])
      break
    case "kick":
      await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", [id, target])
      break
    case "ban":
      await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','banned',?)", [id, target, now()])
      await c.db.run("DELETE FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
      break
    case "unban":
      await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=? AND status='banned'", [id, target])
      break
    default: fail("Noma’lum amal")
  }
  await recount(c, id)
  c.wait(notify(c.env, [target], { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function listRequests(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const rows = await c.db.q("SELECT user_id FROM join_requests WHERE chat_id=? ORDER BY created_at LIMIT 200", [id])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json([...um.values()])
}
async function requestAction(c: C) {
  const id = +c.p.id, target = +c.p.uid
  await needAdmin(c, id)
  const r = await c.db.one("SELECT 1 AS x FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
  if (!r) fail("So‘rov topilmadi", 404)
  await c.db.run("DELETE FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
  if (c.p.action === "approve") {
    await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, target, now()])
    await recount(c, id)
  }
  c.wait(notify(c.env, [target], { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function muteChat(c: C) {
  await c.db.run("UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?", [c.b.muted ? 1 : 0, +c.p.id, c.uid])
  return json({ ok: true })
}
// Chatni ro'yxat boshiga qadash (faqat o'zi uchun)
async function pinChat(c: C) {
  const id = +c.p.id
  const m = await member(c, id)
  if (!m || m.status !== "active") fail("Avval qo‘shiling", 403)
  await c.db.run("UPDATE chat_members SET pinned=? WHERE chat_id=? AND user_id=?", [c.b.on ? 1 : 0, id, c.uid])
  return json({ ok: true, pinned: c.b.on ? 1 : 0 })
}
// Xabarni yuqoriga qadash (e'lon kuni) — guruh/kanalda admin, shaxsiy chatda o'zi
async function pinMessage(c: C) {
  const m = await ownMsg(c, false)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "direct" && !isAdm(await member(c, m.chat_id))) fail("Qadash faqat adminlarda", 403)
  const on = !!c.b.on
  await c.db.run("UPDATE chats SET pinned_id=? WHERE id=?", [on ? m.id : 0, m.chat_id])
  const out = on ? (await enrich(c, [m]))[0] : null
  notifyChat(c, m.chat_id, { type: "pinned", chat_id: m.chat_id, message: out })
  return json({ ok: true, pinned_id: on ? m.id : 0, message: out })
}

// ------------------------- Xabarlar -------------------------
async function enrich(c: C, msgs: any[]) {
  const ids = msgs.map((m) => m.id)
  const out = msgs.map(msgOut) as any[]
  if (!ids.length) return out
  const rx = await c.db.q(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${ph(ids)})`, ids)
  const polls = msgs.filter((m) => m.kind === "poll").map((m) => m.id)
  const votes = polls.length ? await c.db.q(`SELECT message_id, user_id, opt FROM poll_votes WHERE message_id IN (${ph(polls)})`, polls) : []
  const cm = await c.db.q(`SELECT message_id, COUNT(*) AS cnt FROM msg_comments WHERE message_id IN (${ph(ids)}) GROUP BY message_id`).catch((): any[] => [])
  const cmMap = new Map(cm.map((x) => [x.message_id, Number(x.cnt)]))
  for (const m of out) {
    const r: Record<string, number[]> = {}
    for (const x of rx) if (x.message_id === m.id) (r[x.emoji] ||= []).push(x.user_id)
    m.reactions = r
    m.comment_count = cmMap.get(m.id) || 0
    if (m.kind === "poll") {
      const v: Record<number, number> = {}
      let mine = -1
      for (const x of votes) if (x.message_id === m.id) { v[x.opt] = (v[x.opt] || 0) + 1; if (x.user_id === c.uid) mine = x.opt }
      m.votes = v; m.my_vote = mine
    }
  }
  await Promise.all(out.map(async (m) => { if (!m.deleted) m.sig = await signMsg(c.env, m) }))
  return out
}
async function getMessages(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (!(m && m.status === "active") && !(ch.type !== "direct" && ch.is_public)) fail("Ruxsat yo‘q", 403)
  const after = +(c.url.searchParams.get("after") || 0)
  const since = +(c.url.searchParams.get("since") || 0)
  const before = +(c.url.searchParams.get("before") || 0)
  const latestQ = +(c.url.searchParams.get("latest") || 0)
  const latest = latestQ ? Math.min(200, Math.max(1, latestQ)) : 0 // 0 = param yo'q (before/sinch rejimlar ishlaydi)
  const t = now()
  let all: any[]
  let more = false
  if (latest) {
    // Tez ochilish: eng oxirgi N xabar bitta so'rovda (10 martagacha so'rov o'rniga 1)
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT " + latest, [id])
    all = rows.reverse()
    more = rows.length === latest
  } else if (before) {
    // Orqaga sahifalash: butun tarix saqlangan — eski yozishmalar hech qachon yo'qolmaydi
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 100", [id, before])
    all = rows.reverse()
    more = rows.length === 100
  } else {
    const fresh = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND id>? ORDER BY id LIMIT 300", [id, after])
    const changed = since && after
      ? await c.db.q("SELECT * FROM messages WHERE chat_id=? AND id<=? AND updated_at>? ORDER BY id LIMIT 300", [id, after, since])
      : []
    all = [...changed, ...fresh]
    more = fresh.length === 300
  }
  const messages = await enrich(c, all)
  const um = await usersByIds(c, [...new Set(all.map((x) => x.sender_id))])
  const peer = ch.type === "direct" ? await c.db.one("SELECT last_read FROM chat_members WHERE chat_id=? AND user_id<>?", [id, c.uid]) : null
  return json({ messages, users: Object.fromEntries(um), now: t, peer_last_read: peer?.last_read ?? null, more })
}
async function sendMessage(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (!m || m.status !== "active") fail(m?.status === "banned" ? "Siz chetlatilgansiz" : "Avval qo‘shiling", 403)
  const kind = String(c.b.kind || "text")
  if (!MSG_KINDS.has(kind)) fail("Xabar turi noto‘g‘ri")
  const body = str(c.b.body, 4096)
  const meta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (meta && meta.length > 6000) fail("Xabar juda katta")
  if (kind === "text" && !body) fail("Bo‘sh xabar")
  const adm = isAdm(m)
  if (ch.type === "channel" && !adm) fail("Kanalga faqat adminlar yozadi", 403)
  if (ch.type === "group" && !adm) {
    const p = parse(ch.permissions, DEF_PERMS)
    if (!p.send) fail("Guruhda yozish yopilgan", 403)
    if (["photo", "video", "voice", "round", "file"].includes(kind) && !p.media) fail("Media yuborish taqiqlangan", 403)
    if (["sticker", "gif"].includes(kind) && !p.stickers) fail("Stiker va GIF taqiqlangan", 403)
    if (kind === "poll" && !p.polls) fail("So‘rovnoma taqiqlangan", 403)
    if (!p.links && /(https?:\/\/|www\.|t\.me\/)/i.test(body)) fail("Havola yuborish taqiqlangan", 403)
    const s = parse(ch.settings, DEF_SET)
    if (s.slow > 0) {
      const last = await c.db.one("SELECT created_at FROM messages WHERE chat_id=? AND sender_id=? ORDER BY id DESC LIMIT 1", [id, c.uid])
      const left = last ? Math.ceil((last.created_at + s.slow * 1000 - now()) / 1000) : 0
      if (left > 0) fail(`Sekin rejim: ${left} soniya kuting`, 429)
    }
  }
  let peerId = 0
  if (ch.type === "direct") {
    const p = await c.db.one("SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?", [id, c.uid])
    peerId = p?.user_id || 0
    if (peerId && (await blockedBetween(c, c.uid, peerId))) fail("Bu foydalanuvchi bilan yozishib bo‘lmaydi", 403)
  }
  const mid = newId(), t = now()
  const exp = t + 100 * 365 * DAY // o'chmas tarix: faqat foydalanuvchi o'chira oladi
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [mid, id, c.uid, kind, body || null, meta, t, t, exp])
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, id])
  await c.db.run("UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?", [mid, id, c.uid])
  const mediaId = c.b.meta?.media_id
  if (mediaId) {
    await c.db.run("UPDATE media SET expires_at=?, keep=1, chat_id=?, next_check=0 WHERE id=? AND owner_id=?", [exp, id, String(mediaId), c.uid])
    c.wait(planReplicas(c.db, 1, String(mediaId)))
  }
  const out = (await enrich(c, [await c.db.one("SELECT * FROM messages WHERE id=?", [mid])]))[0]
  out.client_id = c.b.client_id || null
  notifyChat(c, id, { type: "message", chat_id: id, message: out })
  c.wait(pushChatMsg(c, id, ch, out)) // qurilmasi yopiq a'zolarga Web Push
  return json(out)
}
async function ownMsg(c: C, needOwner = true) {
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [+c.p.id])
  if (!m || m.deleted) fail("Xabar topilmadi", 404)
  const mem = await member(c, m.chat_id)
  if (!mem || mem.status !== "active") fail("Ruxsat yo‘q", 403)
  if (needOwner && m.sender_id !== c.uid) {
    const ch = await needChat(c, m.chat_id)
    if (!(ch.type !== "direct" && isAdm(mem))) fail("Faqat o‘z xabaringiz", 403)
  }
  return m
}
async function pushMsg(c: C, mid: number) {
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [mid])
  const out = (await enrich(c, [m]))[0]
  notifyChat(c, m.chat_id, { type: "message_update", chat_id: m.chat_id, message: out })
  return out
}
async function editMessage(c: C) {
  const m = await ownMsg(c)
  if (m.sender_id !== c.uid || m.kind !== "text") fail("Faqat o‘z matnli xabaringizni tahrirlaysiz", 403)
  const body = str(c.b.body, 4096)
  if (!body) fail("Bo‘sh xabar")
  await c.db.run("UPDATE messages SET body=?, edited=1, updated_at=? WHERE id=?", [body, now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function deleteMessage(c: C) {
  const m = await ownMsg(c)
  const mid = parse(m.meta, {}).media_id
  if (mid) await dropMedia(c.db, "id=?", [String(mid)])
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE id=?", [now(), m.id])
  await c.db.run("DELETE FROM reactions WHERE message_id=?", [m.id])
  return json(await pushMsg(c, m.id))
}
async function react(c: C) {
  const m = await ownMsg(c, false)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "direct" && !parse(ch.settings, DEF_SET).reactions) fail("Reaksiyalar o‘chirilgan")
  const e = str(c.b.emoji, 16)
  const cur = await c.db.one("SELECT emoji FROM reactions WHERE message_id=? AND user_id=?", [m.id, c.uid])
  if (cur && (cur.emoji === e || !e)) await c.db.run("DELETE FROM reactions WHERE message_id=? AND user_id=?", [m.id, c.uid])
  else if (e) await c.db.run("REPLACE INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)", [m.id, c.uid, e])
  await c.db.run("UPDATE messages SET updated_at=? WHERE id=?", [now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function vote(c: C) {
  const m = await ownMsg(c, false)
  if (m.kind !== "poll") fail("So‘rovnoma emas")
  const meta = parse(m.meta, {})
  const opt = +c.b.opt
  if (!(opt >= 0 && opt < (meta.options || []).length)) fail("Variant noto‘g‘ri")
  await c.db.run("REPLACE INTO poll_votes(message_id,user_id,opt) VALUES(?,?,?)", [m.id, c.uid, opt])
  await c.db.run("UPDATE messages SET updated_at=? WHERE id=?", [now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function markRead(c: C) {
  const id = +c.p.id
  const last = +c.b.last_id || 0
  const ch = await needChat(c, id)
  await c.db.run("UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=? AND last_read<?", [last, id, c.uid, last])
  if (ch.type === "direct") {
    // O'CHMAS TARIX: o'qilgan xabarlar ham serverda butunlay saqlanadi — hech narsa avtomatik o'chmaydi
    notifyChat(c, id, { type: "read", chat_id: id, user_id: c.uid, last_id: last })
  }
  return json({ ok: true })
}
async function typing(c: C) {
  const id = +c.p.id
  const m = await member(c, id)
  if (!m || m.status !== "active") return json({ ok: false })
  const ids = (await memberIds(c, id)).filter((x) => x !== c.uid)
  c.wait(notify(c.env, ids, { type: "typing", chat_id: id, user_id: c.uid, action: str(c.b.action, 10) || "text" }))
  return json({ ok: true })
}

// ------------------------- Web Push (Telegram-uslubidagi bildirishnomalar) -------------------------
const PUSH_PREVIEW: Record<string, string> = {
  photo: "📷 Rasm", video: "🎬 Video", voice: "🎤 Ovozli xabar", round: "📹 Video xabar",
  file: "📎 Fayl", sticker: "🙂 Stiker", gif: "GIF", poll: "📊 So‘rovnoma",
  location: "📍 Joylashuv", contact: "👤 Kontakt",
}
async function pushSubscribe(c: C) {
  const ep = str(c.b.endpoint, 768)
  const p256dh = str(c.b.keys?.p256dh, 255)
  const auth = str(c.b.keys?.auth, 120)
  if (!/^https:\/\//.test(ep) || !p256dh || !auth) fail("Push ma‘lumotlari noto‘g‘ri")
  const h = await sha256(ep)
  const t = now()
  await c.db.run("REPLACE INTO push_subs(endpoint_hash,user_id,endpoint,p256dh,auth,ua,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    [h, c.uid, ep, p256dh, auth, str(c.req.headers.get("user-agent") || "", 200), t, t])
  return json({ ok: true })
}
async function pushUnsubscribe(c: C) {
  const ep = str(c.b.endpoint, 768)
  if (ep) await c.db.run("DELETE FROM push_subs WHERE endpoint_hash=? AND user_id=?", [await sha256(ep), c.uid])
  else await c.db.run("DELETE FROM push_subs WHERE user_id=?", [c.uid])
  return json({ ok: true })
}
// Yangi xabarni offline a'zolarga push qilish (ovoz uchirilganlar va push o'chirganlar chiqariladi)
async function pushChatMsg(c: C, chatId: number, ch: any, m: any) {
  try {
    const rows = await c.db.q("SELECT user_id, muted FROM chat_members WHERE chat_id=? AND status='active' AND user_id<>? LIMIT " + NOTIFY_CAP, [chatId, c.uid])
    let ids = rows.filter((r) => !r.muted).map((r) => r.user_id as number)
    if (!ids.length) return
    const pr = await c.db.q(`SELECT id, prefs FROM users WHERE id IN (${ph(ids)})`, ids)
    const off = new Set(pr.filter((r) => { try { return JSON.parse(String(r.prefs || "{}")).push === 0 } catch { return false } }).map((r) => Number(r.id)))
    ids = ids.filter((id) => !off.has(id))
    if (!ids.length) return
    const sender = await c.db.one("SELECT first_name, last_name FROM users WHERE id=?", [c.uid])
    const nm = ((sender?.first_name || "") + " " + (sender?.last_name || "")).trim() || "Foydalanuvchi"
    const prev = m.kind === "text" ? String(m.body || "") : (PUSH_PREVIEW[m.kind] || "Yangi xabar")
    const title = ch.type === "direct" ? nm : ch.title || (ch.type === "channel" ? "Kanal" : "Guruh")
    const body = ch.type === "group" ? `${nm}: ${prev}` : prev
    await pushUsers(c.env, ids, { t: title.slice(0, 80), b: body.slice(0, 240), c: chatId, tag: "g50c" + chatId }, { db: c.db, ttl: 3600 })
  } catch (e) { console.log("push xato", String(e)) }
}

// ------------------------- Media (bo'laklab) -------------------------
const MAX_SIZE = 30 * 1024 * 1024
function abToB64(u: Uint8Array): string {
  let s = "", CH = 0x8000
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH))
  return btoa(s)
}
function b64ToU8(s: string): Uint8Array {
  const bin = atob(s), u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
async function mediaCreate(c: C) {
  const size = +c.b.size || 0, chunks = +c.b.chunks || 1
  if (size <= 0 || size > MAX_SIZE) fail("Fayl hajmi 30 MB dan oshmasin")
  if (chunks < 1 || chunks > 80) fail("Bo‘laklar soni noto‘g‘ri")
  const id = randomStr(22)
  await c.db.run("INSERT INTO media(id,owner_id,mime,name,size,chunks,complete,created_at,expires_at) VALUES(?,?,?,?,?,?,0,?,?)",
    [id, c.uid, str(c.b.mime, 100) || "application/octet-stream", str(c.b.name, 200) || "fayl", size, chunks, now(), now() + DAY])
  return json({ id })
}
async function mediaPut(c: C) {
  const m = await c.db.one("SELECT owner_id,chunks FROM media WHERE id=?", [c.p.id])
  if (!m || m.owner_id !== c.uid) fail("Topilmadi", 404)
  const idx = +c.p.idx
  if (!(idx >= 0 && idx < m.chunks)) fail("Bo‘lak raqami noto‘g‘ri")
  // Yangi mijozlar binary (33% kam trafik, tezroq), eski mijozlar base64 text — ikkalasi ham qo‘llanadi
  let data: string
  const ct = c.req.headers.get("content-type") || ""
  if (ct.includes("octet-stream")) {
    const ab = await c.req.arrayBuffer()
    if (ab.byteLength > 1_200_000) fail("Bo‘lak juda katta")
    data = abToB64(new Uint8Array(ab))
  } else {
    data = await c.req.text()
    if (data.length > 1_100_000 || !/^[A-Za-z0-9+/=]*$/.test(data.slice(0, 200))) fail("Bo‘lak noto‘g‘ri")
  }
  await c.db.run("REPLACE INTO media_chunks(media_id,idx,data) VALUES(?,?,?)", [c.p.id, idx, data])
  return json({ ok: true })
}
async function mediaDone(c: C) {
  const m = await c.db.one("SELECT owner_id,chunks FROM media WHERE id=?", [c.p.id])
  if (!m || m.owner_id !== c.uid) fail("Topilmadi", 404)
  const r = await c.db.one("SELECT COUNT(*) AS cnt FROM media_chunks WHERE media_id=?", [c.p.id])
  if (Number(r?.cnt) !== m.chunks) fail("Fayl to‘liq yuklanmadi")
  const sha = /^[a-f0-9]{64}$/.test(String(c.b.sha || "")) ? String(c.b.sha) : null
  await c.db.run("UPDATE media SET complete=1, sha=? WHERE id=?", [sha, c.p.id])
  return json({ ok: true, id: c.p.id })
}
async function mediaMeta(c: C) {
  const m = await c.db.one("SELECT id,mime,name,size,chunks,complete,sha,gone,dropped FROM media WHERE id=?", [c.p.id])
  if (!m || !m.complete || m.gone || m.dropped) fail("Fayl serverda yo‘q (muddati tugagan bo‘lishi mumkin)", 404)
  return json(m)
}
async function mediaChunk(c: C) {
  const r = await c.db.one("SELECT data FROM media_chunks WHERE media_id=? AND idx=?", [c.p.id, +c.p.idx])
  if (!r) fail("Topilmadi", 404)
  const cc = { "cache-control": "private, max-age=31536000, immutable", ...CORS }
  if ((c.req.headers.get("accept") || "").includes("octet-stream")) {
    return new Response(b64ToU8(String(r.data)), { headers: { "content-type": "application/octet-stream", ...cc } })
  }
  return new Response(r.data, { headers: { "content-type": "text/plain", ...cc } })
}

// ------------------------- Istoriyalar -------------------------
async function listStories(c: C) {
  const ids = await circle(c)
  const rows = await c.db.q(
    `SELECT s.*, v.viewer_id AS seen_by FROM stories s LEFT JOIN story_views v ON v.story_id=s.id AND v.viewer_id=?
     WHERE s.user_id IN (${ph(ids)}) AND s.expires_at>? ORDER BY s.created_at`,
    [c.uid, ...ids, now()],
  )
  const own = rows.filter((r) => r.user_id === c.uid).map((r) => r.id)
  const vc = own.length ? await c.db.q(`SELECT story_id, COUNT(*) AS cnt FROM story_views WHERE story_id IN (${ph(own)}) GROUP BY story_id`, own) : []
  const vcm = new Map(vc.map((r) => [r.story_id, Number(r.cnt)]))
  const um = await usersByIds(c, [...new Set(rows.map((r) => r.user_id))])
  const groups = new Map<number, any>()
  for (const r of rows) {
    if (!groups.has(r.user_id)) groups.set(r.user_id, { user: um.get(r.user_id), stories: [] })
    groups.get(r.user_id).stories.push({
      id: r.id, kind: r.kind, media_id: r.media_id, text_body: r.text_body, bg: r.bg,
      meta: r.meta ? parse(r.meta, null) : null, created_at: r.created_at,
      seen: r.user_id === c.uid || !!r.seen_by, views: r.user_id === c.uid ? vcm.get(r.id) || 0 : undefined,
    })
  }
  const list = [...groups.values()].filter((g) => g.user)
  for (const g of list) g.unseen = g.stories.filter((s: any) => !s.seen).length
  list.sort((a, b) => (a.user.id === c.uid ? -1 : b.user.id === c.uid ? 1 : (b.unseen > 0 ? 1 : 0) - (a.unseen > 0 ? 1 : 0) || b.stories.at(-1).created_at - a.stories.at(-1).created_at))
  return json(list)
}
async function createStory(c: C) {
  const kind = ["photo", "video", "text"].includes(c.b.kind) ? c.b.kind : fail("Tur noto‘g‘ri")
  if (kind !== "text" && !c.b.media_id) fail("Rasm yoki video kerak")
  if (kind === "text" && !str(c.b.text_body, 500)) fail("Matn kiriting")
  const id = newId(), t = now(), exp = t + DAY
  const smeta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (smeta && smeta.length > 6000) fail("Istoriya juda katta")
  await c.db.run("INSERT INTO stories(id,user_id,kind,media_id,text_body,bg,meta,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [id, c.uid, kind, c.b.media_id || null, str(c.b.text_body, 500) || null, str(c.b.bg, 200) || null, smeta, t, exp])
  if (c.b.media_id) await c.db.run("UPDATE media SET expires_at=? WHERE id=? AND owner_id=?", [exp, String(c.b.media_id), c.uid])
  return json({ id })
}
async function viewStory(c: C) {
  const s = await c.db.one("SELECT user_id FROM stories WHERE id=? AND expires_at>?", [+c.p.id, now()])
  if (!s) fail("Istoriya topilmadi", 404)
  if (s.user_id === c.uid) return json({ ok: true })
  const reaction = str(c.b.reaction, 16) || null
  await c.db.run("REPLACE INTO story_views(story_id,viewer_id,reaction,viewed_at) VALUES(?,?,?,?)", [+c.p.id, c.uid, reaction, now()])
  if (reaction) c.wait(notify(c.env, [s.user_id], { type: "story_reaction", story_id: +c.p.id, user_id: c.uid, reaction }))
  return json({ ok: true })
}
async function storyViews(c: C) {
  const s = await c.db.one("SELECT user_id FROM stories WHERE id=?", [+c.p.id])
  if (!s || s.user_id !== c.uid) fail("Ruxsat yo‘q", 403)
  const rows = await c.db.q("SELECT viewer_id, reaction, viewed_at FROM story_views WHERE story_id=? ORDER BY viewed_at DESC LIMIT 300", [+c.p.id])
  const um = await usersByIds(c, rows.map((r) => r.viewer_id))
  return json(rows.map((r) => ({ user: um.get(r.viewer_id), reaction: r.reaction, viewed_at: r.viewed_at })).filter((x) => x.user))
}
async function deleteStory(c: C) {
  await c.db.run("DELETE FROM stories WHERE id=? AND user_id=?", [+c.p.id, c.uid])
  await c.db.run("DELETE FROM story_views WHERE story_id=?", [+c.p.id])
  return json({ ok: true })
}

// ------------------------- 🔥 Trend lenta (internetdan jonli, UMUMAN saqlanmaydi) -------------------------
// O'zbekcha RSS manbalar (kun.uz, daryo, gazeta, BBC Uzbek, spot, nuz) — paralel agregat + tarjima.
// Kategoriyalar kalit-so'z bo'yicha; kirill/inliz sarlavhalar avtomatik o'zbekchaga tarjima qilinadi.
// Hech qanday DB yozuvi yo'q — so'rov to'g'ridan-to'g'ri internetdan olinadi. Manba nomi ko'rsatilmaydi.
const TREND_UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" }
// Ishonchli RSS manbalar (Cloudflare Worker'dan 200 qaytaradi; Google News DC IP'larga 503 beradi)
// spot.uz o'zbekcha (oz) versiyasi + nuz.uz qo'shildi — ko'proq har xil o'zbek kontenti
const TREND_FEEDS: Array<[string, string]> = [
  ["kun", "https://kun.uz/news/rss"],
  ["daryo", "https://daryo.uz/rss/"],
  ["gazeta", "https://www.gazeta.uz/oz/rss/"],
  ["bbc", "https://feeds.bbci.co.uk/uzbek/latin/rss.xml"],
  ["spot", "https://www.spot.uz/oz/rss/"],
  ["nuz", "https://nuz.uz/feed"],
]
// Kategoriyalash: kalit-so'zlar bo'yicha (manba ikkinchi darajali maslahatchi)
const CAT_RE: Record<string, RegExp> = {
  tech: /(texnologiya|sun['ʻ]iy intellekt|sun'iy intellekt|iphone|ipad|android|samsung|xiaomi|google|youtube|telegram|instagram|tiktok|ilova|dastur|kompyuter|noutbuk|robot|internet|kiber|gadget|chatgpt|openai|apple|smartfon|protsessor|videoo['ʻ]yin|kriptovalyut|bitcoin|elektron)/i,
  sport: /(futbol|futbolchi|jamoa|\bgol\b|o['ʻ]yinch[ii]|turnir|chempion|chempionat|kubok|\bliga\b|tennis|boks|shaxmat|olimpiada|sportchi|sport\b|darvozabon|mavsum|transfer|trener|\bmatch\b|musobaqa|\bcup\b|\bleague\b|fifa|uefa|governor|dzudo|kurash|bokschi|g['ʻ]alaba\s*qozondi)/i,
  salomatlik: /(so['ʻ]g['ʻ]liq|sog'liq|tibbiyot|virus|kasallik|vaksina|shifokor|dori|epidemiya|saraton|covid|infeksiya|psixolog|kaloriya|tibbiy)/i,
  fan: /(kosmos|\bnasa\b|tadqiqot|olim\b|ilmiy|kashfiyot|fizika|kimyo|biologiya|astronom|planet|yo['ʻ]ldosh|raketa|genetika|arxeolog)/i,
  shou: /(kino|film|multfilm|musiq|qo['ʻ]shiq|aktyor|aktrisa|serial|shou\b|premiya|koncert|yulduz\b|rejissyor|oskar|festival|grammy|estrada|chart)/i,
  biznes: /(iqtisod|dollar|yevro|so['ʻ]m\b|investitsiya|bank|bozor|narx\b|neft|biznes|eksport|import|soliq|tadbirkor|aksiya|kapital|byudjet|tarif|savdo|kontrakt| narxi|javobgarlik)/i,
}
const UZ_HINT = /(o['ʻ]zbekiston|uzbekiston|toshkent|mirziyoyev|samarqand|buxoro|andijon|namangan|farg['ʻ]ona|nukus|qarshi|jizzax|termiz|urganch|navoiy|kokand)/i
function classify(text: string, src: string): string {
  for (const k of ["tech", "sport", "salomatlik", "fan", "shou", "biznes"]) if (CAT_RE[k].test(text)) return k
  if (UZ_HINT.test(text)) return "uz"
  if (src === "spot") return "biznes"
  if (src === "bbc") return "world"
  return "uz"
}
const decodeEnt = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n) } catch { return "" } })
const stripHtml = (s: string) => decodeEnt(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim()
function tagGet(block: string, tag: string): string {
  const m = block.match(new RegExp("<" + tag + ">(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</" + tag + ">"))
  return m ? m[1].trim() : ""
}
async function gnewsFetch(src: string, url: string, n: number): Promise<any[]> {
  const UA = { headers: TREND_UA, cf: { cacheTtl: 900, cacheEverything: true } } as any
  try {
    let r = await fetch(url, UA)
    // Google parallel burst'ni cheklaydi — 1 marta kutib qayta urinish
    if (r.status === 429 || r.status === 503) {
      await new Promise((res) => setTimeout(res, 350))
      r = await fetch(url, UA)
    }
    if (!r.ok) { console.log("trend", src, "HTTP", r.status); return [] }
    const xml = await r.text()
    const out: any[] = []
    for (const block of xml.split("<item>").slice(1)) {
      if (out.length >= n) break
      const rawTitle = tagGet(block, "title")
      const link = tagGet(block, "link")
      if (!rawTitle || !link) continue
      const desc = tagGet(block, "description")
      const imgM = desc.match(/<img[^>]+src="(https:\/\/[^"]+)"/)
      const mcM = !imgM ? (block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"[^>]*medium="image"/) || block.match(/<media:thumbnail[^>]+url="(https:\/\/[^"]+)"/) || block.match(/<enclosure[^>]+url="(https:\/\/[^"]+)"/)) : null
      const pub = tagGet(block, "pubDate")
      const ts = pub ? Date.parse(pub) : NaN
      // Manba nomini yashirish: "Sarlavha - Manba nomi" -> "Sarlavha"
      const title = rawTitle.replace(/\s+[-–—]\s+[^-–—]{2,42}$/, "").trim() || rawTitle
      out.push({
        kind: "news", src, title, url: link,
        snippet: stripHtml(desc).slice(0, 300),
        image: imgM ? imgM[1] : mcM ? mcM[1] : "",
        time: isNaN(ts) ? now() : ts,
      })
    }
    if (!out.length) console.log("trendempty", src, r.status, xml.length, xml.slice(0, 150).replace(/\s+/g, " "))
    return out
  } catch (e: any) { console.log("trenderr", src, String(e?.message || e).slice(0, 120)); return [] }
}
// KRITIK TUZATISH: eski UZ_MARK /​[oʻ‘’gʻʼ]/ belgilar to'plami har qanday "o"/"g" harfini moslab,
// deyarli BARCHA inglizcha sarlavhalarni "o'zbekcha" deb tasniflab yuborardi (tarjima o'tkazib yuborilardi).
const EN_STOP = /\b(the|and|of|in|for|with|to|on|at|from|by|after|before|over|into|about|new|how|why|what|who|top|best|first|vs|amid|says|said|will|would|can|could|should|may|might|must|as|is|are|was|were|be|been|has|have|had|his|her|its|their|this|that|these|those|more|most|than|not|but|or|if|when|while|during|against|out|up|down|off|back|just|now|day|days|year|years|world|us|uk|video|watch|live|report|reports|did|does|do|get|got|make|made|take|took|see|seen|show|showed|reveal|revealed|claim|claims|warn|warned|hit|killed|died|death|major|huge|big|police|man|woman|people|old|time|win|wins|lost|lose|beat|wins|open|opens|amid|here|there|still|again|der|die|das|und|ist|mit|von|auf|fur|für|im|den|dem|ein|eine|einen|nicht|sich|zur|zum|aus|werden|wurde|nach|bei|als|auch|zu|le|la|les|des|une|dans|sur|est|pour|avec|pas|plus|ce|cette|que|qui|el|los|las|por|con|para|del|como|pero|más|ile|için|daha|çok|cin|film|official|video|music|shorts|part)\b/i
const UZ_MARK = /[oO]['ʻʼ‘’][a-z]|\w+moq(da)?\b|\b(ning|bilan|uchun|yangi|haqida|bo‘yicha|yili|keldi|berdi|ayti|deya|qilmoq|birinchi|katta|yana|ham|va|bu|emas|qarshi|taxmin|xabar|tashrif|bayon|prezident|vazir|davlat|talab)\b/i
function needsTr(s: string): boolean {
  if (!s || s.length < 3) return false
  if (/[а-яёӯғҳ]/i.test(s)) return true // kirill matn — tarjima kerak
  if (UZ_MARK.test(s)) return false // oʻzbekcha belgilar bor
  return EN_STOP.test(s)
}
async function trToUz(s: string): Promise<string> {
  // DIQQAT: free plan 50 subrequest/invocation — retry YO'Q, kesh konvergatsiyani ta'minlaydi.
  // Zanjir: clients5 (tez, ishonchli) -> gtx (429 bloklari ko'p) — WF AI oxirgi zaxira
  try {
    const r2 = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=uz&q=" + encodeURIComponent(s.slice(0, 900)), { headers: TREND_UA })
    if (r2.ok) {
      const j2: any = await r2.json()
      const out2 = Array.isArray(j2) ? String(j2?.[0]?.[0] || "").trim() : String(j2?.sentences?.[0]?.trans || "").trim()
      if (out2 && out2 !== s) return out2
    }
  } catch {}
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=uz&dt=t&q=" + encodeURIComponent(s.slice(0, 900)), { headers: TREND_UA })
    if (r.ok) {
      const j: any = await r.json()
      const out = (j?.[0] || []).map((x: any[]) => String(x?.[0] || "")).join("").trim()
      if (out && out !== s) return out
    }
  } catch {}
  return s
}
// Kirill (o'zbek) -> lotin transliteratsiya: subrequest KERAK EMAS, 100% ishlaydi
const CYR_MAP: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", ғ: "g‘", д: "d", е: "e", ж: "j", з: "z", и: "i", й: "y", к: "k", қ: "q", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o‘", ф: "f", х: "x", ҳ: "h", ц: "ts", ч: "ch", ш: "sh", ъ: "‘", ь: "", ы: "i", э: "e", ю: "yu", я: "ya", ё: "yo", щ: "sh" }
function cyrToLat(s: string): string {
  let out = ""
  for (const ch of s) {
    const lo = ch.toLowerCase()
    const m = CYR_MAP[lo]
    if (m === undefined) { out += ch; continue }
    if (ch !== lo && m) out += m.charAt(0).toUpperCase() + m.slice(1)
    else out += m
  }
  return out
}
const hasCyr = (s: string) => /[а-яёӯғҳ]/i.test(s)
// Workers AI tarjima (zaxira bosqich): binding — subrequest limitiga KIRMAYDI.
// DIQQAT: eski @cf/meta/m2m100_1.2B modeli Cloudflare tomonidan o'chirilgan — llama-3.1 ishlatiladi.
async function trAI(env: Env, s: string): Promise<string> {
  try {
    if (!env.AI) return s
    const r: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You are a translator. Translate the user's text to Uzbek (Latin script). Reply with ONLY the translation, nothing else." },
        { role: "user", content: s.slice(0, 350) },
      ],
      max_tokens: 300,
    })
    const t = String(r?.response || "").trim().replace(/^(?:['‘ʻ"]|tarjima:|translation:)\s*/i, "").trim()
    // Yordamchi o'zbekcha belgi tekshiruvi: javob matni o'zbekcha ko'rinsagina qabul qilinadi
    if (!t || t === s || t.length < 3) return s
    return t
  } catch { return s }
}
// Tarjima keshi: har matn 1 marta tarjima qilinadi, 6 soat edge-keshda turadi.
// Zanjir: gtx (bepul, ba'zan 429) -> Workers AI -> kirill bo'lsa lokal transliteratsiya.
async function trToUzCached(c: C, s: string): Promise<string> {
  if (!s) return s
  const h = (await sha256(s)).slice(0, 20)
  const ck = "https://trend.50gram.internal/tr1/" + h
  try {
    const hit = await caches.default.match(ck)
    if (hit) return await hit.text()
  } catch {}
  let out = await trToUz(s)
  if (out === s) out = await trAI(c.env, s)
  if ((out === s || hasCyr(out)) && hasCyr(s)) out = cyrToLat(s)
  if (out && out !== s) {
    const resp = new Response(out, { headers: { "cache-control": "public, s-maxage=21600" } })
    c.wait(caches.default.put(ck, resp).catch(() => {}))
  }
  return out
}
// --- O'ZBEK KONTENTI — 100% O'zbekiston ---
// 1) Sertifikatlangan o'zbek kanallari (YouTube kanal RSS — eng tez va ishonchli manba, ~300ms)
// 2) Piped/Invidious QIDIRUV: o'zbekcha so'rovlar (faqat 1..90s va UZ sarlavha) — yangi kontent
// Dailymotion va chet-el trending (US region) OLIB TASHLANDI — foydalanuvchi: "faqat o'zbekistondagi trendagilari".
// MUHIM: faqat Cloudflare'da TURMAYDIGAN instansalar (worker CF'li saytga to'g'ridan-to'g'ri ulanolmaydi).
const PIPED_APIS = ["https://api.piped.private.coffee", "https://pipedapi.adminforge.de"]
const INVID_APIS = ["https://invidious.nerdvpn.de"]
async function fT(url: string, ms: number, cacheTtl = 600): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: TREND_UA, signal: AbortSignal.timeout(ms), cf: { cacheTtl, cacheEverything: true } } as any)
    return r.ok ? r : null
  } catch { return null }
}
// Sertifikatlangan o'zbek kanallari — haqiqiy qidiruv orqali topilgan va tekshirilgan (komik, hazil, dubljaz, vines)
const UZ_CHANNELS = [
  "UCd5_-70CbGPmmz2YusxX1zQ", // YANGI TV — komik sketchlar
  "UCZm8kCDX5sFagGux3qz5hRg", // Umidjon Murodullayev — qisqa hazillar
  "UCccjqZeIXuVeZyi9C5Bil4A", // 404 uz
  "UCHyWMPoLqTWteebdhjKoB4Q", // Uzbek vid
  "UCfKQvap5T1SKGBRgZKhyhXg", // MANGU_YT
  "UCuXexJqac0W-TUTab-Yqt8g", // ANYONE SHOW — qisqa hazillar
  "UCfjrghi9WYjRAd9B9zArkFQ", // Uzbek Vines
  "UCIU-k8B7_Cd8AJOtncj4hOQ", // Anilan Dublaj UZ
  "UCoqpEBq2svog4P1bk-Is1rA", // Anilan UZ
  "UCXMqPws1-cBxaXX9asB0WiA", // Anilan DUBLAJ
]
// Kanal RSS: tez (~300ms/kanal, parallel), videoId+sarlavha+ko'rish soni+yuklangan vaqt bor
async function uzChannelShorts(): Promise<any[]> {
  const feeds = await Promise.all(UZ_CHANNELS.map(async (ch) => {
    const r = await fT("https://www.youtube.com/feeds/videos.xml?channel_id=" + ch, 6000, 300)
    if (!r) return []
    try {
      const xml = await r.text()
      const out: any[] = []
      for (const e of xml.split("<entry>").slice(1).slice(0, 5)) {
        const vid = tagGet(e, "yt:videoId")
        const title = tagGet(e, "title")
        const pub = tagGet(e, "published")
        const vm = e.match(/<media:statistics views="(\d+)"/)
        const views = vm ? +vm[1] : 0
        if (!vid || !title) continue
        out.push({
          kind: "short", vid: "yt", yt: vid, uz: 1, src: "ch",
          title, image: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
          views, duration: 0,
          time: pub ? (Date.parse(pub) || now()) : now(),
          url: "https://www.youtube.com/watch?v=" + vid, cat: "video",
        })
      }
      return out
    } catch { return [] }
  }))
  return feeds.flat()
}
const UZ_RE = /(o['ʻ‘ʼ]?zbek|uzbek|Ўзбек|Ӯзбек|узбек|Узбек|ткент|Тошкент|Ташкент|тошкент|ткент|samarqand|samarkand|Самарканд|buxoro|bukhara|Бухара|andijon|Андижон|namangan|Наманган|nukus|Нукус|termiz|Термез|qarshi|Карши|jizzax|Жиззах|navoiy|Навои|urganch|Урганч|qo['ʻ‘ʼ]qon|Коканд|kokand|farg['ʻ‘ʼ]ona|fergana|Фергана|xorazm|Хоразм|surxondaryo|sirdaryo|qashqadaryo|chilonzor|yunusobod|zbekiston|zbekiston|Ўзбекистон|Узбекистон|o'zbekcha|oʻzbekcha)/i
async function youtubeTrending(): Promise<any[]> {
  // Chet-el trending OLINGAN (foydalanuvchi: faqat o'zbek kontenti) — faqat UZ qidiruvi va kanallar qoladi.
  return []
}
// --- O'ZBEK SHORTS: Piped/Invidious QIDIRUV — faqat o'zbekcha (1..90s VA sarlavha UZ) ---
// Chet-el kontenti QATIY filtrlanadi: UZ_RE mos kelmasa — umuman qo'shilmaydi.
const UZ_QUERIES = ["o‘zbekiston shorts", "o‘zbekcha shorts", "o‘zbek komik shorts", "toshkent shorts", "o‘zbekcha hazil", "qiziqarli o‘zbekcha video", "o‘zbek prank", "o‘zbekcha dubljaz"]
async function uzSearch(): Promise<any[]> {
  const one = async (base: string, q: string): Promise<any[]> => {
    const r = await fT(base + "/search?q=" + encodeURIComponent(q) + "&filter=videos", 9000)
    if (!r) return []
    try {
      const j: any = await r.json()
      return ((j.items || []) as any[]).map((v: any) => {
        const id = String(v.url || "").split("v=")[1]
        const dur = +v.duration || 0
        if (!id || dur < 1 || dur > 90) return null // FAQAT haqiqiy Shorts uzunligi — uzun video va jonli efir yo'q
        const title = String(v.title || "")
        if (!UZ_RE.test(title)) return null // QATIY: faqat o'zbekcha sarlavhali videolar
        return {
          kind: "short", vid: "yt", yt: id.split("&")[0], uz: 1, src: "s",
          title, image: String(v.thumbnail || ""),
          views: +v.views || 0, duration: dur,
          time: +v.uploaded > 0 ? +v.uploaded : now(),
          url: "https://www.youtube.com/watch?v=" + id.split("&")[0], cat: "video",
        }
      }).filter((v: any) => v && v.title)
    } catch { return [] }
  }
  const out: any[] = []
  const seen = new Set<string>()
  const res = await Promise.allSettled([
    ...PIPED_APIS.flatMap((b) => UZ_QUERIES.map((q) => one(b, q))),
    ...INVID_APIS.map((b) => oneInvid(b)),
  ])
  for (const r of res) {
    if (r.status !== "fulfilled") continue
    for (const v of r.value) { if (v && !seen.has(v.yt)) { seen.add(v.yt); out.push(v) } }
  }
  return out
}
// Invidious qidiruv zaxira manbasi (formati boshqa: videoId/lengthSeconds/viewCount)
async function oneInvid(base: string): Promise<any[]> {
  const q = UZ_QUERIES[Math.floor(Math.random() * UZ_QUERIES.length)]
  const r = await fT(base + "/api/v1/search?q=" + encodeURIComponent(q) + "&type=video", 8000)
  if (!r) return []
  try {
    const j: any = await r.json()
    return (Array.isArray(j) ? j : []).map((v: any) => {
      const dur = +v.lengthSeconds || 0
      const title = String(v.title || "")
      if (!v.videoId || dur < 1 || dur > 90 || !UZ_RE.test(title)) return null
      return {
        kind: "short", vid: "yt", yt: String(v.videoId), uz: 1, src: "s",
        title, image: String(v.videoThumbnails?.[0]?.url || ""),
        views: +v.viewCount || 0, duration: dur,
        time: +v.published > 0 ? +v.published * 1000 : now(),
        url: "https://www.youtube.com/watch?v=" + v.videoId, cat: "video",
      }
    }).filter((v: any) => v && v.title)
  } catch { return [] }
}
// Reddit (403: serverdan bloklangan) va TikTok (O'zbekistonda VPN'siz ishlamaydi) manbalari olib tashlandi.
// --- Yagona video hovuzi: stale-while-revalidate — eski hovuz DARHOL qaytadi, yangilash fonda ketadi.
// Bu foydalanuvchining asosiy shikoyati ("lenta juda sekin ochmoqda") uchun asosiy yechim:
// upstream sekin/o'lik bo'lsa ham foydalanuvchi DOIM keshlangan kontentni zudlik bilan oladi.
const POOL_FRESH_MS = 20 * 60 * 1000
async function cacheGetJSON<T>(ck: string): Promise<{ t: number; data: T } | null> {
  try { const hit = await caches.default.match(ck); if (hit) return await hit.json() } catch {}
  return null
}
async function cachePutJSON(ck: string, obj: unknown): Promise<void> {
  try {
    const r = json(obj)
    r.headers.set("cache-control", "public, s-maxage=1200")
    await caches.default.put(ck, r)
  } catch {}
}
async function buildVideoPool(): Promise<{ shorts: any[]; vids: any[] }> {
  // Kanal yangiliklari (vaqt bo'yicha) + qidiruv topganlari (ko'rish soni bo'yicha) — 2:1 aralashtiriladi
  const [chan, uz] = await Promise.all([uzChannelShorts(), uzSearch()])
  const seen = new Set<string>()
  const ch = chan.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt)).sort((a: any, b: any) => (b.time || 0) - (a.time || 0))
  const se = uz.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt)).sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
  const shorts: any[] = []
  let ci = 0, si = 0
  while ((ci < ch.length || si < se.length) && shorts.length < 48) {
    for (let k = 0; k < 2 && ci < ch.length; k++) shorts.push(ch[ci++])
    if (si < se.length) shorts.push(se[si++])
  }
  return { shorts: shorts.slice(0, 48), vids: [] }
}
async function videoPool(c: C): Promise<{ shorts: any[]; vids: any[] }> {
  const ck = "https://trend.50gram.internal/poolv8"
  const meta = await cacheGetJSON<{ shorts: any[]; vids: any[] }>(ck)
  if (meta && meta.data && meta.data.shorts?.length) {
    if (now() - meta.t < POOL_FRESH_MS) return meta.data
    c.wait(buildVideoPool().then((d) => { if (d.shorts.length) return cachePutJSON(ck, { t: now(), data: d }) }).catch(() => {}))
    return meta.data
  }
  const d = await buildVideoPool()
  if (d.shorts.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
async function newsPool(c: C): Promise<any[]> {
  // Barcha manbalar PARALLEL yuklanadi + stale-while-revalidate: eski pool DARHOL qaytadi (sovuq sahifa ham tez)
  const ck = "https://trend.50gram.internal/poolN4"
  const meta = await cacheGetJSON<any[]>(ck)
  if (meta && meta.data?.length) {
    if (now() - meta.t < 15 * 60 * 1000) return meta.data
    c.wait(buildNewsPool().then((d) => { if (d.length) return cachePutJSON(ck, { t: now(), data: d }) }).catch(() => {}))
    return meta.data
  }
  const d = await buildNewsPool()
  if (d.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
async function buildNewsPool(): Promise<any[]> {
  const res = await Promise.all(TREND_FEEDS.map(async ([src, url]) => {
    const items = await gnewsFetch(src, url, 40)
    for (const it of items) { it.cat = classify((it.title || "") + " " + (it.snippet || ""), src); delete it.src }
    return items
  }))
  // Eng yangilari oldinda
  return res.flat().sort((a, b) => (b.time || 0) - (a.time || 0))
}
const CAT_KEYS = ["uz", "world", "tech", "sport", "biznes", "shou", "fan", "salomatlik"]
const TREND_CATS = new Set([...CAT_KEYS, "video"])
// --- Analiz tizimi: global vaznlarni o'qish (qarorlar keshi 2 daq) ---
// FAQAT agregat hisoblagichlar (kategoriya bo'yicha ko'rish/bosish/vaqt) — hech qanday yangilik kontenti saqlanmaydi.
async function trendWeights(c: C): Promise<Record<string, number>> {
  const ck = "https://trend.50gram.internal/tw2"
  try {
    const hit = await caches.default.match(ck)
    if (hit) return await hit.json()
  } catch {}
  const w: Record<string, number> = {}
  try {
    const rows = await c.db.q("SELECT cat, imp, clk, wt FROM trend_stats")
    for (const r of rows) {
      const imp = +r.imp || 0, clk = +r.clk || 0, wt = +r.wt || 0
      // Qaror formulasi: CTR (bosish/ko'rish) + ko'rish vaqti logarifmi — shu mavzu lentada oldinga suriladi
      w[String(r.cat)] = Math.round(Math.min(6, (imp ? (clk / imp) * 20 : 0) + Math.log10(wt + 10) * 1.2))
    }
  } catch {}
  const resp = json(w)
  resp.headers.set("cache-control", "public, s-maxage=120")
  c.wait(caches.default.put(ck, resp.clone()).catch(() => {}))
  return w
}
async function trendEv(c: C) {
  const b: any = c.b || {} // router allaqachon JSON body'ni parse qilgan
  const cat = str(b?.cat, 20), ev = str(b?.ev, 6)
  if (!TREND_CATS.has(cat)) fail("Noto‘g‘ri kategoriya")
  const n = Math.max(1, Math.min(50, +b?.n || 1))
  const t = now()
  if (ev === "imp") await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,?,0,0,?) ON DUPLICATE KEY UPDATE imp=imp+?,upd=?", [cat, n, t, n, t])
  else if (ev === "clk") await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,0,?,0,?) ON DUPLICATE KEY UPDATE clk=clk+?,upd=?", [cat, n, t, n, t])
  else if (ev === "wt") {
    const ms = Math.max(0, Math.min(3600000, +b?.ms || 0))
    if (!ms) return json({ ok: true })
    await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,0,0,?,?) ON DUPLICATE KEY UPDATE wt=wt+?,upd=?", [cat, ms, t, ms, t])
  } else fail("Noto‘g‘ri hodisa")
  return json({ ok: true })
}
// Tarjima zanjiri diagnostikasi (auth talab qiladi): har bosqichning holati
async function trendTrDbg(c: C) {
  const q = str(c.url.searchParams.get("q") || "Princess Kate surprises Sussex residents today", 300)
  const st: any = { q }
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=uz&dt=t&q=" + encodeURIComponent(q), { headers: TREND_UA })
    const txt = await r.text()
    st.gtx = { status: r.status, isJson: txt.trim().startsWith("["), result: txt.trim().startsWith("[") ? String(JSON.parse(txt)?.[0]?.map((x: any[]) => x?.[0]).join("") || "").slice(0, 80) : txt.slice(0, 60) }
  } catch (e: any) { st.gtx = { err: String(e?.message || e).slice(0, 80) } }
  try {
    const r2 = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=uz&q=" + encodeURIComponent(q), { headers: TREND_UA })
    const t2 = await r2.text()
    st.c5 = { status: r2.status, isJson: t2.trim().startsWith("["), result: t2.trim().startsWith("[") ? String(JSON.parse(t2)?.[0]?.[0] || "").slice(0, 80) : t2.slice(0, 60) }
  } catch (e: any) { st.c5 = { err: String(e?.message || e).slice(0, 80) } }
  try {
    if (c.env.AI) {
      const r3: any = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: "You are a translator. Translate to Uzbek (Latin). Reply with ONLY the translation." },
          { role: "user", content: q.slice(0, 300) },
        ],
        max_tokens: 300,
      })
      st.ai = { result: String(r3?.response || JSON.stringify(r3).slice(0, 80)).slice(0, 80) }
    } else st.ai = { err: "AI binding yo'q" }
  } catch (e: any) { st.ai = { err: String(e?.message || e).slice(0, 120) } }
  return json(st)
}
// Diagnostika: video manbalariga worker'dan kirish holati (status/ms/hajm)
async function trendSrcDbg(c: C) {
  const st: any = {}
  const trySrc = async (name: string, url: string) => {
    const t0 = Date.now()
    try {
      const r = await fetch(url, { headers: TREND_UA, signal: AbortSignal.timeout(8000) })
      const txt = await r.text()
      let n = 0
      try { const j = JSON.parse(txt); n = (Array.isArray(j) ? j.length : (j.items?.length || (j.list?.length || 0))) } catch {}
      st[name] = { status: r.status, ms: Date.now() - t0, bytes: txt.length, items: n, head: txt.slice(0, 90).replace(/\s+/g, " ") }
    } catch (e: any) { st[name] = { err: String(e?.message || e).slice(0, 90), ms: Date.now() - t0 } }
  }
  await Promise.all([
    trySrc("piped_coffee", "https://api.piped.private.coffee/trending?region=US"),
    trySrc("piped_kavin", "https://pipedapi.kavin.rocks/trending?region=US"),
    trySrc("invid_nerdvpn", "https://invidious.nerdvpn.de/api/v1/trending?region=US"),
    trySrc("dm_api", "https://api.dailymotion.com/videos?fields=id&sort=trending&limit=3"),
  ])
  // cf.cacheEverything opsiyasi bilan (fT xuddi shunday so'raydi) — farqni ko'rish uchun
  const t0 = Date.now()
  try {
    const r = await fetch("https://api.piped.private.coffee/trending?region=US", { headers: TREND_UA, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 600, cacheEverything: true } } as any)
    const txt = await r.text()
    let n = 0; try { n = JSON.parse(txt).length } catch {}
    st.piped_coffee_cf = { status: r.status, ms: Date.now() - t0, items: n, head: txt.slice(0, 80).replace(/\s+/g, " ") }
  } catch (e: any) { st.piped_coffee_cf = { err: String(e?.message || e).slice(0, 90), ms: Date.now() - t0 } }
  // fT + aynan youtubeTrending mapping simulatsiyasi
  const t1 = Date.now()
  try {
    const r = await fT("https://api.piped.private.coffee/trending?region=US", 8000)
    if (!r) st.ft_coffee = { ok: false, ms: Date.now() - t1 }
    else {
      const j: any = await r.json()
      const list = Array.isArray(j) ? j : j.items || []
      const out = (list || []).map((v: any) => { const id = String(v.url || "").split("v=")[1]; return id ? String(v.title || "") : null }).filter(Boolean)
      st.ft_coffee = { ok: true, status: r.status, ms: Date.now() - t1, raw: list.length, mapped: out.length, sample: out.slice(0, 2) }
    }
  } catch (e: any) { st.ft_coffee = { ok: false, err: String(e?.message || e).slice(0, 90), ms: Date.now() - t1 } }
  // To'liq youtubeTrending() chaqiruvi (natija sanog'i)
  const t2 = Date.now()
  try {
    const yt = await youtubeTrending()
    st.yt_full = { count: yt.length, ms: Date.now() - t2, sample: yt.slice(0, 2).map((v: any) => v.yt + " " + String(v.title).slice(0, 30)) }
  } catch (e: any) { st.yt_full = { err: String(e?.message || e).slice(0, 90), ms: Date.now() - t2 } }
  return json(st)
}
async function trendInsights(c: C) {
  const rows = await c.db.q("SELECT cat, imp, clk, wt FROM trend_stats ORDER BY clk DESC").catch(() => [])
  let imp = 0, clk = 0, wt = 0
  for (const r of rows) { imp += +r.imp || 0; clk += +r.clk || 0; wt += +r.wt || 0 }
  const scores = rows.map((r) => {
    const i = +r.imp || 0, k = +r.clk || 0, w = +r.wt || 0
    return {
      cat: String(r.cat), imp: i, clk: k, wt: w,
      ctr: i ? Math.round((k / i) * 1000) / 10 : 0,
      score: Math.min(100, Math.round((i ? (k / i) * 400 : 0) + Math.log10(w + 10) * 18)),
    }
  }).sort((a, b) => b.score - a.score)
  const max = scores[0]?.score || 1
  for (const s of scores) (s as any).bar = Math.max(5, Math.round((s.score / max) * 100))
  return json({
    ok: true, total_imp: imp, total_clk: clk, total_wt: wt,
    ctr: imp ? Math.round((clk / imp) * 1000) / 10 : 0,
    cats: scores, top: scores[0]?.cat || "",
  })
}
async function trend(c: C) {
  const page = Math.max(1, Math.min(40, +(c.url.searchParams.get("page") || 1)))
  const onlyCat = str(c.url.searchParams.get("cat") || "", 20)
  const catsW = str(c.url.searchParams.get("cats") || "", 200) // foydalanuvchi qiziqishlari: "sport:5,tech:3"
  const cacheKey = "https://trend.50gram.internal/t10?p=" + page + "&cat=" + onlyCat
  try {
    const hit = await caches.default.match(cacheKey)
    if (hit) return new Response(hit.body, hit)
  } catch {}
  let items: any[] = []
  if (onlyCat === "video") {
    // Video: FAQAT haqiqiy Shorts (uzun videolar va jonli efirlar sekin/qotadi — foydalanuvchi talabi)
    const vp = await videoPool(c)
    const all = vp.shorts
    const s0 = ((page - 1) * 12) % Math.max(1, all.length)
    items = all.slice(s0, s0 + 12)
    if (items.length < 12 && all.length) items.push(...all.slice(0, 12 - items.length))
  } else {
    const pool = await newsPool(c)
    if (onlyCat && CAT_KEYS.includes(onlyCat)) {
      items = pool.filter((x) => x.cat === onlyCat).slice((page - 1) * 12, page * 12)
    } else {
      // Barchasi: kategoriyalar FOYDALANUVCHI qiziqishi + ANALIZ TIZIMI qarorlari bo'yicha round-robin
      const w: Record<string, number> = {}
      for (const part of catsW.split(",")) { const [k, v] = part.split(":"); if (CAT_KEYS.includes(k)) w[k] = +v || 0 }
      const gw = await trendWeights(c)
      const keys = CAT_KEYS.slice().sort((a, b) => ((w[b] || 0) + (gw[b] || 0) * 1.5) - ((w[a] || 0) + (gw[a] || 0) * 1.5))
      const byCat = new Map(keys.map((k) => [k, pool.filter((x) => x.cat === k)] as [string, any[]]))
      const perPage = 4
      const picked: any[] = []
      const cursors = new Map(keys.map((k) => [k, (page - 1) * perPage] as [string, number]))
      let left = keys.length * perPage
      while (left > 0) {
        let added = false
        for (const k of keys) {
          const arr = byCat.get(k) || [], cur = cursors.get(k)!
          if (cur >= arr.length || picked.length >= 44) continue
          picked.push(arr[cur]); cursors.set(k, cur + 1); left--; added = true
        }
        if (!added) break
      }
      // Har sahifaga trend Shorts aralashtiriladi (uzun videolar sekin — qo'shilmaydi)
      const vp = await videoPool(c)
      const vall = vp.shorts
      const v0 = ((page - 1) * 3) % Math.max(1, vall.length)
      const picks = vall.slice(v0, v0 + 3)
      for (let i = 3, vi = 0; i < picked.length && vi < picks.length; i += 7) picked.splice(i, 0, picks[vi++])
      if (picked.length && picks.length && !picked.some((x) => x.kind === "video" || x.kind === "short")) picked.push(picks[0])
      items = picked
    }
  }
  // Tarjima: avval Shorts/video sarlavhalari (foydalanuvchi birinchi ko'radi), so'ng yangiliklar.
  // PARALLEL tarjima — sovuq sahifa 1-2s ichida tayyor (kesh 6 soat, takroriy so'rov bepul).
  const trList = [...items.filter((x) => x.kind === "short" || x.kind === "video"), ...items.filter((x) => x.kind !== "short" && x.kind !== "video")]
    .filter((x) => x && x.title && needsTr(x.title))
    .slice(0, 10)
  if (trList.length) {
    const results = await Promise.all(trList.map(async (it) => ({ it, t: await trToUzCached(c, it.title) })))
    for (const { it, t } of results) if (t && t !== it.title) it.title = t
  }
  items = items.filter((x) => x && x.title)
  for (const x of items) x.id = (await sha256(x.url)).slice(0, 12)
  const out = { ok: true, page, items }
  const resp = json(out)
  // Video sahifasida YouTube yo'q bo'lsa 60s kesh (hovuz tuzatilgach tez yangilanadi); qolganlari 600s
  const badVid = onlyCat === "video" && items.length > 0 && !items.some((x: any) => x.vid === "yt")
  resp.headers.set("cache-control", "public, s-maxage=" + (badVid ? 60 : 600) + ", stale-while-revalidate=180")
  c.wait(caches.default.put(cacheKey, resp.clone()).catch(() => {}))
  return resp
}
async function chatStats(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const one = async (sql: string, v: unknown[] = []) => Number((await c.db.one(sql, v))?.n || 0)
  const [members, admins, banned, msgs, posts, views, likes, comments, today] = await Promise.all([
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND status='active'", [id]),
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND role IN ('owner','admin') AND status='active'", [id]),
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND status='banned'", [id]),
    one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND deleted=0", [id]),
    one("SELECT COUNT(*) n FROM posts WHERE chat_id=?", [id]),
    one("SELECT COALESCE(SUM(views),0) n FROM posts WHERE chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM post_comments pc JOIN posts p ON p.id=pc.post_id WHERE p.chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND created_at>?", [id, now() - DAY]),
  ])
  return json({ ok: true, members, admins, banned, messages: msgs, posts, views, likes, comments, today })
}

// ------------------------- Lenta -------------------------
async function feed(c: C) {
  const before = +(c.url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER
  const mode = c.url.searchParams.get("mode") === "subs" ? "subs" : "all"
  const my = (await c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid])).map((r) => r.chat_id)
  const myList = my.length ? my : [0]
  let rows: any[]
  if (mode === "subs") {
    const circ = await circle(c)
    rows = await c.db.q(
      `SELECT p.* FROM posts p WHERE p.id<? AND ((p.chat_id=0 AND p.author_id IN (${ph(circ)})) OR p.chat_id IN (${ph(myList)})) ORDER BY p.id DESC LIMIT 20`,
      [before, ...circ, ...myList],
    )
  } else {
    rows = await c.db.q(
      `SELECT p.* FROM posts p LEFT JOIN chats ch ON ch.id=p.chat_id
       WHERE p.id<? AND (p.chat_id=0 OR ch.is_public=1 OR p.chat_id IN (${ph(myList)})) ORDER BY p.id DESC LIMIT 20`,
      [before, ...myList],
    )
  }
  const blocked = new Set((await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=? UNION SELECT blocked_id AS user_id FROM blocks WHERE user_id=?", [c.uid, c.uid])).map((r) => r.user_id))
  rows = rows.filter((r) => !blocked.has(r.author_id))
  return json(await postsOut(c, rows))
}
async function postsOut(c: C, rows: any[]) {
  const ids = rows.map((r) => r.id)
  const liked = ids.length ? new Set((await c.db.q(`SELECT post_id FROM post_likes WHERE user_id=? AND post_id IN (${ph(ids)})`, [c.uid, ...ids])).map((r) => r.post_id)) : new Set()
  const um = await usersByIds(c, rows.map((r) => r.author_id))
  const chIds = [...new Set(rows.map((r) => r.chat_id).filter(Boolean))]
  const chs = chIds.length ? await c.db.q(`SELECT ${CHAT_COLS} FROM chats WHERE id IN (${ph(chIds)})`, chIds) : []
  const chm = new Map(chs.map((r) => [r.id, chatOut(r)]))
  return rows.map((r) => ({
    id: r.id, text_body: r.text_body, media_id: r.media_id, media_kind: r.media_kind, like_count: r.like_count,
    comment_count: r.comment_count, views: Number(r.views || 0), created_at: r.created_at, liked: liked.has(r.id),
    meta: r.meta ? parse(r.meta, null) : null,
    author: um.get(r.author_id) || null, chat: r.chat_id ? chm.get(r.chat_id) || null : null,
    can_delete: r.author_id === c.uid,
  }))
}
async function createPost(c: C) {
  const text = str(c.b.text_body, 3000)
  if (!text && !c.b.media_id) fail("Post bo‘sh")
  const chatId = +c.b.chat_id || 0
  if (chatId) await needAdmin(c, chatId)
  const id = newId()
  const meta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (meta && meta.length > 6000) fail("Post juda katta")
  await c.db.run("INSERT INTO posts(id,author_id,chat_id,text_body,media_id,media_kind,meta,created_at) VALUES(?,?,?,?,?,?,?,?)",
    [id, c.uid, chatId, text || null, c.b.media_id || null, c.b.media_id ? (c.b.media_kind === "video" ? "video" : "photo") : null, meta, now()])
  if (c.b.media_id) {
    await c.db.run("UPDATE media SET expires_at=?, keep=1, chat_id=0, next_check=0 WHERE id=? AND owner_id=?", [now() + 100 * 365 * DAY, String(c.b.media_id), c.uid])
    c.wait(planReplicas(c.db, 1, String(c.b.media_id)))
  }
  return json((await postsOut(c, [await c.db.one("SELECT * FROM posts WHERE id=?", [id])]))[0])
}
async function deletePost(c: C) {
  const p = await c.db.one("SELECT author_id, chat_id, media_id FROM posts WHERE id=?", [+c.p.id])
  if (!p) fail("Post topilmadi", 404)
  if (p.author_id !== c.uid && !(p.chat_id && isAdm(await member(c, p.chat_id)))) fail("Ruxsat yo‘q", 403)
  if (p.media_id) await dropMedia(c.db, "id=?", [String(p.media_id)])
  for (const t of ["post_likes", "post_comments"]) await c.db.run(`DELETE FROM ${t} WHERE post_id=?`, [+c.p.id])
  await c.db.run("DELETE FROM posts WHERE id=?", [+c.p.id])
  return json({ ok: true })
}
async function likePost(c: C) {
  const id = +c.p.id
  const ex = await c.db.one("SELECT 1 AS x FROM post_likes WHERE post_id=? AND user_id=?", [id, c.uid])
  if (ex) await c.db.run("DELETE FROM post_likes WHERE post_id=? AND user_id=?", [id, c.uid])
  else await c.db.run("REPLACE INTO post_likes(post_id,user_id) VALUES(?,?)", [id, c.uid])
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM post_likes WHERE post_id=?", [id])
  await c.db.run("UPDATE posts SET like_count=? WHERE id=?", [Number(n?.cnt || 0), id])
  return json({ liked: !ex, like_count: Number(n?.cnt || 0) })
}
// Reels — vertikal video lenta: ochiq kanallar + shaxsiy video postlar (ko'rilgani hisoblanadi)
async function reels(c: C) {
  const before = +(c.url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER
  const my = (await c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid])).map((r) => r.chat_id)
  const myList = my.length ? my : [0]
  const rows = await c.db.q(
    `SELECT p.* FROM posts p LEFT JOIN chats ch ON ch.id=p.chat_id
     WHERE p.media_kind='video' AND p.id<? AND (p.chat_id=0 OR ch.is_public=1 OR p.chat_id IN (${ph(myList)}))
     ORDER BY p.id DESC LIMIT 10`,
    [before, ...myList],
  )
  const blocked = new Set((await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=? UNION SELECT blocked_id AS user_id FROM blocks WHERE user_id=?", [c.uid, c.uid])).map((r) => r.user_id))
  const list = rows.filter((r) => !blocked.has(r.author_id))
  if (list.length) await c.db.run(`UPDATE posts SET views=views+1 WHERE id IN (${ph(list.map((x) => x.id))})`, list.map((x) => x.id))
  return json(await postsOut(c, list))
}
async function listComments(c: C) {
  const rows = await c.db.q("SELECT * FROM post_comments WHERE post_id=? ORDER BY id LIMIT 200", [+c.p.id])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json(rows.map((r) => ({ id: r.id, text_body: r.text_body, created_at: r.created_at, user: um.get(r.user_id) || null })))
}
async function addComment(c: C) {
  const text = str(c.b.text_body, 1000)
  if (!text) fail("Izoh bo‘sh")
  const p = await c.db.one("SELECT chat_id FROM posts WHERE id=?", [+c.p.id])
  if (!p) fail("Post topilmadi", 404)
  if (p.chat_id) { const ch = await needChat(c, p.chat_id); if (!parse(ch.settings, DEF_SET).comments) fail("Izohlar o‘chirilgan") }
  await c.db.run("INSERT INTO post_comments(id,post_id,user_id,text_body,created_at) VALUES(?,?,?,?,?)", [newId(), +c.p.id, c.uid, text, now()])
  await c.db.run("UPDATE posts SET comment_count=comment_count+1 WHERE id=?", [+c.p.id])
  return listComments(c)
}

// ------------------------- Qo'ng'iroqlar (WebRTC signalizatsiya) -------------------------
async function ice(c: C) {
  const servers: any[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }]
  if (c.env.TURN_KEY_ID && c.env.TURN_KEY_TOKEN) {
    try {
      const r = await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/" + c.env.TURN_KEY_ID + "/credentials/generate-ice-servers", {
        method: "POST",
        headers: { Authorization: `Bearer ${c.env.TURN_KEY_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      })
      const j: any = await r.json()
      const s = j.iceServers
      if (Array.isArray(s)) servers.push(...s)
      else if (s) servers.push(s)
    } catch (e) { console.log("TURN xato", String(e)) }
  }
  return json({ iceServers: servers })
}
async function callPending(c: C) {
  // WS uzilgan paytda kelgan qo'ng'iroqni qayta o'ynatish: ilova ochilganda o'zini "ringing" holatda topadi
  const row = await c.db.one("SELECT * FROM calls WHERE callee_id=? AND status='ringing' AND started_at>? ORDER BY started_at DESC LIMIT 1", [c.uid, now() - 80 * 1000])
  if (!row) return json({ call: null })
  const from = (await usersByIds(c, [+row.caller_id])).get(+row.caller_id)
  if (!from) return json({ call: null })
  return json({ call: { call_id: row.id, video: !!row.video, from: { ...from, first_name: (from as any).real_name || from.first_name, last_name: "" } } })
}
async function startCall(c: C) {
  const to = +c.b.to
  if (!to || to === c.uid) fail("Kimga qo‘ng‘iroq?")
  if (await blockedBetween(c, c.uid, to)) fail("Bu foydalanuvchiga qo‘ng‘iroq qilib bo‘lmaydi", 403)
  const id = newId()
  await c.db.run("INSERT INTO calls(id,caller_id,callee_id,video,status,started_at) VALUES(?,?,?,?,'ringing',?)", [id, c.uid, to, c.b.video ? 1 : 0, now()])
  const me = (await usersByIds(c, [c.uid])).get(c.uid)
  // qo'ng'iroq qiluvchi qabul qiluvchining kontakt nomini ko'rmaydi — haqiqiy ismi yuboriladi
  c.wait(notify(c.env, [to], { type: "call", call_id: id, video: !!c.b.video, from: { ...me, first_name: me.real_name, last_name: "" } }))
  c.wait(pushUsers(c.env, [to], { t: `${me?.real_name || "50 Gram"} qo‘ng‘iroq qilmoqda`, b: c.b.video ? "📹 Video qo‘ng‘iroq" : "📞 Audio qo‘ng‘iroq", c: 0, tag: "g50call" + id, call: 1 }, { urgency: "high", ttl: 90 }))
  return json({ call_id: id })
}
async function signal(c: C) {
  const to = +c.b.to
  const data = c.b.data
  if (!to || !data) fail("Noto‘g‘ri signal")
  if (JSON.stringify(data).length > 30000) fail("Signal juda katta")
  await notify(c.env, [to], { type: "signal", from: c.uid, data })
  return json({ ok: true })
}
async function callStatus(c: C) {
  const call = await c.db.one("SELECT * FROM calls WHERE id=?", [+c.p.id])
  if (!call || (call.caller_id !== c.uid && call.callee_id !== c.uid)) fail("Qo‘ng‘iroq topilmadi", 404)
  const st = String(c.b.status)
  if (st === "active" && call.status === "ringing") {
    await c.db.run("UPDATE calls SET status='active' WHERE id=?", [call.id])
    return json({ ok: true })
  }
  if (!["ended", "missed", "declined"].includes(st) || call.ended_at) return json({ ok: true })
  const final = call.status === "active" ? "ended" : st === "ended" ? "missed" : st
  await c.db.run("UPDATE calls SET status=?, ended_at=? WHERE id=?", [final, now(), call.id])
  // Chatga qo'ng'iroq yozuvi
  const key = [call.caller_id, call.callee_id].sort((a: number, b: number) => a - b).join(":")
  let ch = await c.db.one("SELECT id FROM chats WHERE direct_key=?", [key])
  const t = now()
  if (!ch) {
    const id = newId()
    await c.db.run("INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES(?,?,?,0,?,?,2,?,?)", [id, "direct", call.caller_id, randomStr(10), key, t, t])
    for (const u of [call.caller_id, call.callee_id]) await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, u, t])
    ch = { id }
  }
  const mid = newId()
  const meta = JSON.stringify({ video: call.video, status: final, duration: Math.max(0, Math.round(+c.b.duration || 0)) })
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,'call',NULL,?,?,?,?)", [mid, ch.id, call.caller_id, meta, t, t, t + 100 * 365 * DAY])
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, ch.id])
  const out = (await enrich(c, [await c.db.one("SELECT * FROM messages WHERE id=?", [mid])]))[0]
  c.wait(notify(c.env, [call.caller_id, call.callee_id], { type: "message", chat_id: ch.id, message: out }))
  return json({ ok: true })
}

// ------------------------- Jonli efir -------------------------
async function startLive(c: C) {
  const chatId = +c.b.chat_id || 0
  if (chatId) await needAdmin(c, chatId)
  await c.db.run("UPDATE lives SET ended_at=? WHERE user_id=? AND ended_at=0", [now(), c.uid])
  const id = newId()
  await c.db.run("INSERT INTO lives(id,user_id,chat_id,title,started_at) VALUES(?,?,?,?,?)", [id, c.uid, chatId, str(c.b.title, 200), now()])
  if (chatId) await sysMsg(c, chatId, "🔴 Jonli efir boshlandi")
  // Doiradagilarga (kontaktlar + to'g'ridan-to'g'ri chatdoshlar) real vaqt bildirishnomasi — avatarida LIVE belgisi ko'rinsin
  try {
    const u = await c.db.one("SELECT * FROM users WHERE id=?", [c.uid])
    const ids = await circle(c)
    c.wait(notify(c.env, ids, { type: "live_start", live_id: id, from: c.uid, user: pubUser(u, c.uid) }))
  } catch (e) { console.log("live_start notify xato", String(e)) }
  return json({ id })
}
async function listLives(c: C) {
  const ids = await circle(c)
  const my = (await c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid])).map((r) => r.chat_id)
  const rows = await c.db.q(
    `SELECT * FROM lives WHERE ended_at=0 AND started_at>? AND (user_id IN (${ph(ids)}) ${my.length ? `OR chat_id IN (${ph(my)})` : ""}) ORDER BY started_at DESC LIMIT 30`,
    [now() - 12 * 3600000, ...ids, ...my],
  )
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  // Efirchilar martabasi (coin darajalari) — ro'yxatda tega ko'rinsin
  const hosts = rows.map((r) => r.user_id)
  const wl = hosts.length ? await c.db.q(`SELECT user_id, earned FROM wallets WHERE user_id IN (${ph(hosts)})`, hosts).catch((): any[] => []) : []
  const lv = new Map(wl.map((x) => [x.user_id, levelOf(Number(x.earned))]))
  return json(rows.map((r) => ({ id: r.id, title: r.title, chat_id: r.chat_id, viewers: r.viewers, started_at: r.started_at, user: um.get(r.user_id) ? { ...um.get(r.user_id), lvl: lv.get(r.user_id) || levelOf(0) } : null })))
}
async function liveRow(c: C) {
  const l = await c.db.one("SELECT * FROM lives WHERE id=?", [+c.p.id])
  if (!l || l.ended_at) fail("Efir tugagan", 404)
  return l
}
// Efir "o'rgimchak to'ri" (daraxt): efirchi 4 ta tomoshabinga, har tomoshabin yana 3 tasiga uzatadi.
// Tomoshabinlar soni cheklanmaydi: 10 000 tomoshabin ~8 bosqichda, 1 000 000 ~12 bosqichda yetadi.
const HOST_FAN = 4
const FAN = 3
async function liveCount(c: C, l: any) {
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM live_viewers WHERE live_id=?", [l.id])
  const v = Number(n?.cnt || 0)
  await c.db.run("UPDATE lives SET viewers=? WHERE id=?", [v, l.id])
  return v
}
async function detachFromParent(c: C, l: any, row: any) {
  if (!row) return
  if (row.parent_id === l.user_id) await c.db.run("UPDATE lives SET host_kids=CASE WHEN host_kids>0 THEN host_kids-1 ELSE 0 END WHERE id=?", [l.id])
  else if (row.parent_id) await c.db.run("UPDATE live_viewers SET kids=CASE WHEN kids>0 THEN kids-1 ELSE 0 END WHERE live_id=? AND user_id=?", [l.id, row.parent_id])
}
async function pickParent(c: C, l: any, me: any, exclude: number[]) {
  const fresh = await c.db.one("SELECT host_kids FROM lives WHERE id=?", [l.id])
  // O'z "farzandlari" bo'lgan tomoshabin faqat o'zidan yuqoriroq bosqichga ulanadi (aylana hosil bo'lmaydi)
  const maxDepth = me && me.kids > 0 ? me.depth - 1 : 1000
  if (Number(fresh?.host_kids || 0) < HOST_FAN && !exclude.includes(l.user_id)) return { id: l.user_id, depth: 0 }
  const ex = [c.uid, ...exclude.filter((x) => Number.isFinite(x))].slice(0, 20)
  const r = await c.db.one(
    `SELECT user_id, depth FROM live_viewers WHERE live_id=? AND ready=1 AND kids<? AND depth<=? AND user_id NOT IN (${ph(ex)}) ORDER BY depth, joined_at LIMIT 1`,
    [l.id, FAN, maxDepth, ...ex],
  )
  if (r) return { id: r.user_id, depth: r.depth }
  // Bo'sh joy topilmasa — efirchiga to'g'ridan-to'g'ri (vaqtincha ortiqcha)
  return { id: l.user_id, depth: 0 }
}
async function joinLive(c: C) {
  const l = await liveRow(c)
  if (l.user_id === c.uid) fail("Bu sizning efiringiz")
  const exclude = Array.isArray(c.b.exclude) ? c.b.exclude.map(Number) : []
  const me = await c.db.one("SELECT * FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  await detachFromParent(c, l, me)
  const par = await pickParent(c, l, me, exclude)
  const depth = par.depth + 1
  if (me) await c.db.run("UPDATE live_viewers SET parent_id=?, depth=? WHERE live_id=? AND user_id=?", [par.id, depth, l.id, c.uid])
  else await c.db.run("INSERT INTO live_viewers(live_id,user_id,parent_id,depth,kids,ready,joined_at) VALUES(?,?,?,?,0,0,?)", [l.id, c.uid, par.id, depth, now()])
  if (par.id === l.user_id) await c.db.run("UPDATE lives SET host_kids=host_kids+1 WHERE id=?", [l.id])
  else await c.db.run("UPDATE live_viewers SET kids=kids+1 WHERE live_id=? AND user_id=?", [l.id, par.id])
  const v = me ? l.viewers : await liveCount(c, l)
  const um = await usersByIds(c, [c.uid, l.user_id])
  const u = um.get(c.uid)
  const from = { id: c.uid, first_name: u.real_name }
  // Efirchi martabasi (coin darajasi) — jonli efir yuqori panelida ko'rinsin
  const hw = await c.db.one("SELECT earned FROM wallets WHERE user_id=?", [l.user_id]).catch(() => null) as any
  const evs: Promise<unknown>[] = [notify(c.env, [par.id], { type: "live_join", live_id: l.id, from, viewers: v, parent: true })]
  if (par.id !== l.user_id && !me) evs.push(notify(c.env, [l.user_id], { type: "live_join", live_id: l.id, from, viewers: v, parent: false }))
  c.wait(Promise.all(evs))
  return json({ id: l.id, title: l.title, viewers: v, user: um.get(l.user_id) ? { ...um.get(l.user_id), lvl: levelOf(Number(hw?.earned || 0)) } : null, started_at: l.started_at, parent: par.id, depth })
}
// Tomoshabin efirni olib bo'lgach, o'zi ham boshqalarga uzata oladi
async function readyLive(c: C) {
  const l = await liveRow(c)
  await c.db.run("UPDATE live_viewers SET ready=? WHERE live_id=? AND user_id=?", [c.b.ready === false ? 0 : 1, l.id, c.uid])
  return json({ ok: true })
}
async function leaveLive(c: C) {
  const l = await c.db.one("SELECT * FROM lives WHERE id=?", [+c.p.id])
  if (!l) return json({ ok: true })
  const me = await c.db.one("SELECT * FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  if (!me) return json({ ok: true })
  await detachFromParent(c, l, me)
  await c.db.run("DELETE FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  // Uning "farzandlari" boshqa tomoshabinga qayta ulanadi
  const kids = (await c.db.q("SELECT user_id FROM live_viewers WHERE live_id=? AND parent_id=?", [l.id, c.uid])).map((r) => r.user_id)
  if (kids.length) await c.db.run("UPDATE live_viewers SET parent_id=0 WHERE live_id=? AND parent_id=?", [l.id, c.uid])
  const v = await liveCount(c, l)
  c.wait(Promise.all([
    notify(c.env, [l.user_id], { type: "live_leave", live_id: l.id, from: c.uid, viewers: v }),
    kids.length ? notify(c.env, kids, { type: "live_rejoin", live_id: l.id, from: c.uid }) : Promise.resolve(),
  ]))
  return json({ ok: true })
}
async function liveComment(c: C) {
  const l = await liveRow(c)
  const text = str(c.b.text, 300)
  const heart = !!c.b.heart
  if (!text && !heart) fail("Bo‘sh")
  const me = (await usersByIds(c, [c.uid])).get(c.uid)
  // BALL YIG'ISH: efirdagi faollik uchun kichik mukofot — har tomoshabin bir efirda ko'pi bilan 20 marta
  let rewarded = false
  if (l.user_id !== c.uid && (heart || text.length > 1)) {
    await walletOf(c, c.uid)
    const v = await c.db.one("SELECT rewarded FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
    if (v && Number(v.rewarded) < 20) {
      await c.db.run("UPDATE live_viewers SET rewarded=rewarded+1 WHERE live_id=? AND user_id=?", [l.id, c.uid])
      const add = heart ? 1 : 2
      await c.db.run("UPDATE wallets SET coins=coins+?, earned=earned+?, updated_at=? WHERE user_id=?", [add, add, now(), c.uid])
      rewarded = true
    }
  }
  // Izoh faqat efirchiga boradi — u daraxt bo'ylab barcha tomoshabinlarga tarqatadi (server yuklanmaydi)
  c.wait(notify(c.env, [l.user_id], { type: "live_comment", live_id: l.id, from: { id: c.uid, first_name: me.real_name }, text, heart }))
  return json({ ok: true, rewarded, host: l.user_id === c.uid })
}
async function endLive(c: C) {
  const l = await liveRow(c)
  if (l.user_id !== c.uid) fail("Ruxsat yo‘q", 403)
  const top = (await c.db.q("SELECT user_id FROM live_viewers WHERE live_id=? AND parent_id=? LIMIT " + NOTIFY_CAP, [l.id, l.user_id])).map((r) => r.user_id)
  const total = await liveCount(c, l)
  await c.db.run("UPDATE lives SET ended_at=? WHERE id=?", [now(), l.id])
  await c.db.run("DELETE FROM live_viewers WHERE live_id=?", [l.id])
  // Doiradagilarga ham xabar — avatarlardagi LIVE belgisi darhol yo'qolsin
  try {
    const ids = await circle(c)
    c.wait(Promise.all([
      notify(c.env, top, { type: "live_end", live_id: l.id }),
      notify(c.env, ids, { type: "live_end", live_id: l.id, from: l.user_id }),
    ]))
  } catch { c.wait(notify(c.env, top, { type: "live_end", live_id: l.id })) }
  return json({ ok: true, viewers: Math.max(total, l.viewers) })
}

// ------------------------- Coin / Martaba endpointlari -------------------------
async function getWallet(c: C) {
  const w = await walletOf(c, c.uid)
  const top = await c.db.q("SELECT user_id, earned, gifts_recv FROM wallets ORDER BY earned DESC LIMIT 15")
  const best = top.filter((x) => Number(x.earned) > 0)
  const um = await usersByIds(c, best.map((r) => r.user_id))
  return json({
    coins: Number(w.coins), earned: Number(w.earned), spent: Number(w.spent),
    gifts_sent: Number(w.gifts_sent), gifts_recv: Number(w.gifts_recv),
    level: levelOf(Number(w.earned)),
    daily_left: Math.max(0, 20 * 3600000 - (now() - Number(w.last_daily))),
    top: best.map((r, i) => ({ pos: i + 1, user: um.get(r.user_id) || null, earned: Number(r.earned), gifts: Number(r.gifts_recv) })),
  })
}
async function dailyBonus(c: C) {
  const w = await walletOf(c, c.uid)
  const left = 20 * 3600000 - (now() - Number(w.last_daily))
  if (left > 0) fail(`Kunlik bonus allaqachon olindi — ${Math.ceil(left / 3600000)} soatdan keyin yana olasiz`)
  await c.db.run("UPDATE wallets SET coins=coins+100, last_daily=?, updated_at=? WHERE user_id=?", [now(), now(), c.uid])
  const w2 = await c.db.one("SELECT coins, earned FROM wallets WHERE user_id=?", [c.uid])
  return json({ ok: true, added: 100, coins: Number(w2?.coins || 0), level: levelOf(Number(w2?.earned || 0)) })
}
async function giftLive(c: C) {
  const l = await liveRow(c)
  const gid = str(c.b.gift, 24)
  const n = Math.min(10, Math.max(1, +c.b.n || 1))
  const price = GIFTS[gid]
  if (!price) fail("Sovg‘a topilmadi")
  if (l.user_id === c.uid) fail("O‘zingizga sovg‘a yubora olmaysiz")
  const cost = price * n
  await walletOf(c, c.uid)
  await walletOf(c, l.user_id)
  const mine = await c.db.one("SELECT coins FROM wallets WHERE user_id=?", [c.uid])
  if (Number(mine?.coins || 0) < cost) fail("Coin yetarli emas — kunlik bonus oling yoki efirda izoh bilan ball to‘plang", 402)
  await c.db.run("UPDATE wallets SET coins=coins-?, spent=spent+?, gifts_sent=gifts_sent+?, updated_at=? WHERE user_id=?", [cost, cost, n, now(), c.uid])
  await c.db.run("UPDATE wallets SET coins=coins+?, earned=earned+?, gifts_recv=gifts_recv+?, updated_at=? WHERE user_id=?", [cost, cost, n, now(), l.user_id])
  const hw = await c.db.one("SELECT coins, earned FROM wallets WHERE user_id=?", [l.user_id])
  const um = await usersByIds(c, [c.uid])
  const from = um.get(c.uid)
  c.wait(notify(c.env, [l.user_id], { type: "live_gift", live_id: l.id, from: { id: c.uid, first_name: from?.real_name || "" }, gift: gid, n, cost, host_coins: Number(hw?.coins || 0) }))
  const mw = await c.db.one("SELECT coins FROM wallets WHERE user_id=?", [c.uid])
  return json({ ok: true, coins: Number(mw?.coins || 0), cost, host: { coins: Number(hw?.coins || 0), earned: Number(hw?.earned || 0) } })
}

// ------------------------- Kanal postlari izohlari -------------------------
async function msgCommentsAllowed(c: C, mid: number) {
  await ensureSchema(c.db)
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [mid])
  if (!m || m.deleted) fail("Xabar topilmadi", 404)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "channel") fail("Izohlar faqat kanal postlarida")
  if (!parse(ch.settings, DEF_SET).comments) fail("Bu kanalda izohlar o‘chirilgan")
  const mem = await member(c, m.chat_id)
  if (!mem || mem.status !== "active") fail("Izoh yozish uchun kanal a'zosi bo‘ling", 403)
  return { m, ch }
}
async function listMsgComments(c: C) {
  const { m, ch } = await msgCommentsAllowed(c, +c.p.id)
  const mem = await member(c, m.chat_id)
  const adm = isAdm(mem)
  const rows = await c.db.q("SELECT * FROM msg_comments WHERE message_id=? ORDER BY id ASC LIMIT 200", [m.id])
  // VAQTINCHA debug (Task 29 test): enrich agregatini to'g'ridan-to'g'ri tekshirish
  let dbg: any = null
  try {
    dbg = await c.db.q(`SELECT message_id, COUNT(*) AS cnt FROM msg_comments WHERE message_id IN (${ph([m.id])}) GROUP BY message_id`)
  } catch (e: any) { dbg = { err: String(e?.message || e) } }
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json({
    comments: rows.map((r) => ({ id: r.id, user_id: r.user_id, body: r.body, created_at: r.created_at, mine: r.user_id === c.uid, can_del: r.user_id === c.uid || adm })),
    users: Object.fromEntries(um),
    count: rows.length,
    dbg,
    readonly: ch.type === "channel" && !isAdm(await member(c, m.chat_id)) && parse(ch.permissions, DEF_PERMS).send === 0 ? 0 : 1,
  })
}
async function addMsgComment(c: C) {
  const { m } = await msgCommentsAllowed(c, +c.p.id)
  const body = str(c.b.text || c.b.body, 500)
  if (!body) fail("Bo‘sh izoh")
  const id = newId(), t = now()
  await c.db.run("INSERT INTO msg_comments(id,chat_id,message_id,user_id,body,created_at) VALUES(?,?,?,?,?,?)", [id, m.chat_id, m.id, c.uid, body, t])
  const um = await usersByIds(c, [c.uid])
  const me = um.get(c.uid)
  // Post muallifiga real vaqt bildirishnoma
  c.wait(notify(c.env, [m.sender_id], { type: "comment", chat_id: m.chat_id, mid: m.id, from: me }))
  return json({ ok: true, comment: { id, user_id: c.uid, body, created_at: t, mine: true, can_del: true }, users: Object.fromEntries(um) })
}
async function delMsgComment(c: C) {
  const { m } = await msgCommentsAllowed(c, +c.p.id)
  const row = await c.db.one("SELECT * FROM msg_comments WHERE id=?", [+c.p.cid])
  if (!row || row.message_id !== m.id) fail("Izoh topilmadi", 404)
  const mem = await member(c, m.chat_id)
  if (row.user_id !== c.uid && !isAdm(mem)) fail("Faqat o‘z izohingizni o‘chirasiz", 403)
  await c.db.run("DELETE FROM msg_comments WHERE id=?", [row.id])
  return json({ ok: true })
}

// ------------------------- P2P tarmoq ("o'rgimchak to'ri") -------------------------
// Server fayl/xabar muddati tugab o'chirgandan keyin ham, ma'lumot onlayn foydalanuvchilar
// qurilmasidan boshqa a'zoga WebRTC orqali to'g'ridan-to'g'ri uzatiladi.
// Server faqat: kimda nima borligini, ruxsatni va imzoni (soxtalashtirilmaganini) tekshiradi.
const ONLINE_MS = 70000
function sigText(m: any) {
  return [m.id, m.chat_id, m.sender_id, m.kind, m.body ?? "", JSON.stringify(m.meta ?? {}), m.created_at].join("|")
}
function signMsg(env: Env, m: any) { return hmacHex(env.JWT_SECRET, sigText(m)) }
// Foydalanuvchi chatni ko'rish huquqiga egami (a'zo yoki ochiq guruh/kanal). chat=0 — ochiq lenta
async function canSee(c: C, uid: number, chatId: number) {
  if (chatId === 0) return true
  const r = await c.db.one(
    "SELECT ch.type, ch.is_public, m.status FROM chats ch LEFT JOIN chat_members m ON m.chat_id=ch.id AND m.user_id=? WHERE ch.id=?",
    [uid, chatId])
  if (!r) return false
  if (r.status === "active") return true
  return r.status !== "banned" && r.type !== "direct" && !!r.is_public
}
async function p2pHave(c: C) {
  const items = (Array.isArray(c.b.items) ? c.b.items : []).slice(0, 200)
    .map((x: any) => ({ m: str(x?.m, 32), c: Math.max(0, Number(x?.c) || 0), p: x?.p ? 1 : 0, s: Math.max(0, Number(x?.s) || 0) }))
    .filter((x: any) => /^[A-Za-z0-9_-]{6,32}$/.test(x.m))
  const chats = [...new Set(items.map((x: any) => x.c))] as number[]
  const ok = new Set<number>()
  for (const ch of chats) if (await canSee(c, c.uid, ch)) ok.add(ch)
  const t = now()
  let n = 0
  for (const x of items) {
    // Server topshirgan vazifa bo'yicha saqlangan nusxa (chat a'zosi bo'lmasa ham — fayl shifrlangan)
    const job = await c.db.one("SELECT chat_id FROM pin_jobs WHERE media_id=? AND user_id=?", [x.m, c.uid])
    if (job) { x.c = job.chat_id; x.p = 1 } else if (!ok.has(x.c)) continue
    const med = await c.db.one("SELECT chat_id, dropped FROM media WHERE id=?", [x.m])
    if (!med || med.dropped || med.chat_id !== x.c) { if (job) await c.db.run("DELETE FROM pin_jobs WHERE media_id=? AND user_id=?", [x.m, c.uid]); continue }
    await c.db.run("REPLACE INTO peer_have(media_id,user_id,chat_id,pinned,size,updated_at) VALUES(?,?,?,?,?,?)", [x.m, c.uid, x.c, x.p, x.s, t])
    if (job) await c.db.run("DELETE FROM pin_jobs WHERE media_id=? AND user_id=?", [x.m, c.uid])
    n++
  }
  return json({ ok: true, saved: n })
}
async function p2pPeers(c: C) {
  const chatId = Math.max(0, +(c.url.searchParams.get("chat") || 0))
  const media = str(c.url.searchParams.get("media"), 32)
  if (!media && !chatId) fail("chat yoki media kerak")
  if (!(await canSee(c, c.uid, chatId)) && !(media && (await hasJob(c, media, chatId)))) fail("Ruxsat yo‘q", 403)
  const since = now() - ONLINE_MS
  const rows = media
    ? await c.db.q(
      `SELECT h.user_id FROM peer_have h JOIN users u ON u.id=h.user_id LEFT JOIN nodes n ON n.user_id=h.user_id
       WHERE h.media_id=? AND h.chat_id=? AND h.user_id<>? AND u.last_seen>? ORDER BY COALESCE(n.score,0) DESC, u.last_seen DESC LIMIT 8`,
      [media, chatId, c.uid, since])
    : await c.db.q(
      `SELECT m.user_id FROM chat_members m JOIN users u ON u.id=m.user_id
       WHERE m.chat_id=? AND m.status='active' AND m.user_id<>? AND u.last_seen>? ORDER BY u.last_seen DESC LIMIT 8`,
      [chatId, c.uid, since])
  return json({ peers: rows.map((r) => r.user_id) })
}
async function p2pSignal(c: C) {
  const to = +c.b.to, chatId = Math.max(0, +c.b.chat || 0), data = c.b.data
  if (!to || to === c.uid || !data || typeof data !== "object") fail("Noto‘g‘ri signal")
  if (JSON.stringify(data).length > 30000) fail("Signal juda katta")
  if (data.t === "offer") {
    // So'rovni server tekshiradi: so'rovchi chatni ko'ra oladimi va manba qurilmada shu chatga tegishli fayl bormi
    const w = data.want || {}
    if (!(await canSee(c, c.uid, chatId)) && !(w.type === "media" && (await hasJob(c, str(w.id, 32), chatId)))) fail("Ruxsat yo‘q", 403)
    if (w.type === "media") {
      const h = await c.db.one("SELECT 1 AS ok FROM peer_have WHERE media_id=? AND user_id=? AND chat_id=?", [str(w.id, 32), to, chatId])
      if (!h) fail("Manba topilmadi", 404)
    } else if (w.type === "hist") {
      if (!chatId) fail("chat kerak")
      const mm = await c.db.one("SELECT status FROM chat_members WHERE chat_id=? AND user_id=?", [chatId, to])
      if (mm?.status !== "active") fail("Manba topilmadi", 404)
    } else fail("So‘rov turi noto‘g‘ri")
  } else {
    // offer/answer/ice: ikki tomondan biri kanalni ko'ra olishi yoki tarmoq vazifasi bo'lishi kerak
    if (!(await canSee(c, c.uid, chatId)) && !(await canSee(c, to, chatId)) && !(await anyJob(c, c.uid, to, chatId))) fail("Ruxsat yo‘q", 403)
  }
  await notify(c.env, [to], { type: "p2p", from: c.uid, chat: chatId, data })
  return json({ ok: true })
}
// Boshqa qurilmadan olingan eski xabarlar haqiqiyligini tekshirish (server imzosi bo'yicha)
async function p2pVerify(c: C) {
  const chatId = +c.b.chat_id
  if (!chatId || !(await canSee(c, c.uid, chatId))) fail("Ruxsat yo‘q", 403)
  const list = (Array.isArray(c.b.messages) ? c.b.messages : []).slice(0, 500)
  const ok: number[] = []
  for (const m of list) {
    if (!m || m.chat_id !== chatId || m.deleted || typeof m.sig !== "string") continue
    if ((await signMsg(c.env, m)) === m.sig) ok.push(m.id)
  }
  return json({ ok })
}

// ------------------------- Taqsimlangan xotira (har qurilma ≤ 30 GB) -------------------------
// Har bir fayl 15–20 ta qurilmada nusxa bo'lib saqlanadi. Server qaysi qurilmada nima borligini
// kuzatadi, ishonchli (ko'p onlayn) qurilmalarni tanlaydi va nusxa kamaysa avtomatik tiklaydi.
// Fayllar qurilmaga yuborilishidan oldin shifrlanadi (AES-256-GCM), kalit faqat chat a'zolarida.
const GB = 1024 * 1024 * 1024
const NODE_MAX = 30 * GB
const REPLICA_MIN = 15, REPLICA_MAX = 20
const NODE_ALIVE = 7 * DAY        // shu muddatda ko'rinmagan qurilma nusxasi hisobga olinmaydi
const NODE_MAX_JOBS = 25
async function hasJob(c: C, media: string, chatId: number) {
  return !!(await c.db.one("SELECT 1 AS x FROM pin_jobs WHERE media_id=? AND user_id=? AND chat_id=?", [media, c.uid, chatId]))
}
async function anyJob(c: C, a: number, b: number, chatId: number) {
  return !!(await c.db.one("SELECT 1 AS x FROM pin_jobs WHERE user_id IN (?,?) AND chat_id=? LIMIT 1", [a, b, chatId]))
}
async function dropMedia(db: Db, where: string, params: unknown[]) {
  await db.run(`UPDATE media SET dropped=1 WHERE ${where}`, params)
  await db.run(`DELETE FROM pin_jobs WHERE media_id IN (SELECT id FROM media WHERE dropped=1 AND ${where})`, params)
}
// Nusxalar sonini tekshirib, yetishmasa yangi qurilmalarga vazifa beradi
async function planReplicas(db: Db, limit = 200, onlyId?: string) {
  const t = now()
  const list = onlyId
    ? await db.q("SELECT id,size,chat_id,gone FROM media WHERE id=? AND keep=1 AND dropped=0 AND complete=1", [onlyId])
    : await db.q("SELECT id,size,chat_id,gone FROM media WHERE keep=1 AND dropped=0 AND complete=1 AND next_check<? ORDER BY next_check LIMIT " + Math.min(1000, limit), [t])
  for (const m of list) {
    const r = await db.one(
      `SELECT COUNT(*) AS cnt, SUM(CASE WHEN n.score>=0.5 THEN 1 ELSE 0 END) AS strong
       FROM peer_have h JOIN nodes n ON n.user_id=h.user_id WHERE h.media_id=? AND n.last_beat>?`, [m.id, t - NODE_ALIVE])
    const have = Number(r?.cnt || 0), strong = Number(r?.strong || 0)
    const j = await db.one("SELECT COUNT(*) AS cnt FROM pin_jobs WHERE media_id=?", [m.id])
    const pending = Number(j?.cnt || 0)
    let need = Math.max(0, REPLICA_MIN - have - pending)
    if (have + pending < REPLICA_MAX && strong < 2) need = Math.max(need, 2 - strong) // kamida 2 ta "doimiy onlayn" qurilma
    if (need > 0) {
      // Yarmi eng ishonchli qurilmalardan, yarmi tasodifiy (yuk bir joyga to'planmasin)
      const seed = Math.floor(Math.random() * 100000)
      const cand = await db.q(
        `SELECT n.user_id FROM nodes n
         WHERE n.last_beat>? AND n.quota-n.used>?
           AND n.user_id NOT IN (SELECT user_id FROM peer_have WHERE media_id=?)
           AND n.user_id NOT IN (SELECT user_id FROM pin_jobs WHERE media_id=?)
           AND (SELECT COUNT(*) FROM pin_jobs p WHERE p.user_id=n.user_id) < ?
         ORDER BY (n.score * 0.6 + ((n.user_id * 7919 + ?) % 1000) / 2500.0) DESC LIMIT ?`,
        [t - DAY, Number(m.size) * 2 + 50 * 1024 * 1024, m.id, m.id, NODE_MAX_JOBS, seed, need])
      for (const x of cand)
        await db.run("REPLACE INTO pin_jobs(media_id,user_id,chat_id,created_at) VALUES(?,?,?,?)", [m.id, x.user_id, m.chat_id, t])
    }
    const healthy = have >= REPLICA_MIN && strong >= 2
    await db.run("UPDATE media SET replicas=?, next_check=? WHERE id=?", [have, t + (healthy ? 6 * 3600000 : 20 * 60000), m.id])
  }
  return list.length
}
// Qurilma har daqiqada: "men onlaynman, shuncha joy berdim, shunchasi band" — javobda vazifalar
async function storageBeat(c: C) {
  const t = now()
  const quota = Math.max(0, Math.min(NODE_MAX, Number(c.b.quota) || 0))
  const used = Math.max(0, Math.min(NODE_MAX * 2, Number(c.b.used) || 0))
  const n = await c.db.one("SELECT * FROM nodes WHERE user_id=?", [c.uid])
  if (!n) {
    await c.db.run("INSERT INTO nodes(user_id,quota,used,online_ms,score,first_beat,last_beat) VALUES(?,?,?,0,0,?,?)", [c.uid, quota, used, t, t])
  } else {
    const gap = t - n.last_beat
    const online = n.online_ms + (gap > 0 && gap < 150000 ? gap : 0)
    const score = Math.min(1, online / Math.max(DAY, t - n.first_beat))
    await c.db.run("UPDATE nodes SET quota=?, used=?, online_ms=?, score=?, last_beat=? WHERE user_id=?", [quota, used, online, score, t, c.uid])
  }
  await c.db.run("UPDATE users SET last_seen=? WHERE id=?", [t, c.uid])
  const drops = (await c.db.q(
    "SELECT h.media_id FROM peer_have h JOIN media m ON m.id=h.media_id WHERE h.user_id=? AND m.dropped=1 LIMIT 200", [c.uid])).map((r) => r.media_id)
  if (drops.length) await c.db.run(`DELETE FROM peer_have WHERE user_id=? AND media_id IN (${ph(drops)})`, [c.uid, ...drops])
  const jobs = quota > 0 && c.b.accept !== false
    ? await c.db.q(
      `SELECT j.media_id, j.chat_id, m.size, m.sha, m.mime, m.gone FROM pin_jobs j JOIN media m ON m.id=j.media_id
       WHERE j.user_id=? AND m.dropped=0 ORDER BY j.created_at LIMIT 10`, [c.uid])
    : []
  const st = await c.db.one("SELECT COUNT(*) AS cnt, SUM(size) AS used FROM peer_have WHERE user_id=? AND pinned=1", [c.uid])
  return json({ jobs, drops, pinned: Number(st?.cnt || 0), pinned_bytes: Number(st?.used || 0), target: [REPLICA_MIN, REPLICA_MAX] })
}
// Qurilma joy bo'shatdi — server darhol boshqa qurilmaga nusxa buyuradi
async function storageDrop(c: C) {
  const ids = (Array.isArray(c.b.ids) ? c.b.ids : []).slice(0, 500).map((x: unknown) => str(x, 32)).filter(Boolean)
  if (!ids.length) return json({ ok: true })
  await c.db.run(`DELETE FROM peer_have WHERE user_id=? AND media_id IN (${ph(ids)})`, [c.uid, ...ids])
  await c.db.run(`DELETE FROM pin_jobs WHERE user_id=? AND media_id IN (${ph(ids)})`, [c.uid, ...ids])
  await c.db.run(`UPDATE media SET next_check=0 WHERE id IN (${ph(ids)})`, ids)
  c.wait(planReplicas(c.db, 50))
  return json({ ok: true })
}
async function storageStats(c: C) {
  const t = now()
  const nodes = await c.db.one("SELECT COUNT(*) AS cnt, SUM(quota) AS quota, SUM(used) AS used FROM nodes WHERE last_beat>?", [t - NODE_ALIVE])
  const media = await c.db.one("SELECT COUNT(*) AS cnt, SUM(CASE WHEN replicas>=? THEN 1 ELSE 0 END) AS jobs FROM media WHERE keep=1 AND dropped=0", [REPLICA_MIN])
  return json({ nodes: Number(nodes?.cnt || 0), quota: Number(nodes?.quota || 0), used: Number(nodes?.used || 0), files: Number(media?.cnt || 0), healthy: Number(media?.jobs || 0) })
}

// ------------------------- Router -------------------------
type H = (c: C) => Promise<Response>
const routes: Array<[string, string, H, boolean?]> = [
  ["POST", "/auth/otp", authOtp, true],
  ["POST", "/auth/verify", authVerify, true],
  ["GET", "/avatar/u/:id", (c) => avatar(c, "users"), true],
  ["GET", "/avatar/c/:id", (c) => avatar(c, "chats"), true],
  ["GET", "/health", async () => json({ ok: true, app: "50 Gram" }), true],
  ["GET", "/me", getMe],
  ["PATCH", "/me", patchMe],
  ["POST", "/ping", async (c) => { await c.db.run("UPDATE users SET last_seen=? WHERE id=?", [now(), c.uid]); return json({ ok: true, now: now() }) }],
  ["GET", "/users/:id", getUser],
  ["GET", "/search", search],
  ["GET", "/discover", discover],
  ["GET", "/resolve/:name", chatByUsername],
  ["GET", "/contacts", listContacts],
  ["POST", "/contacts", addContact],
  ["DELETE", "/contacts/:phone", delContact],
  ["GET", "/blocks", listBlocks],
  ["POST", "/blocks/:id", (c) => block(c, true)],
  ["DELETE", "/blocks/:id", (c) => block(c, false)],
  ["GET", "/chats", listChats],
  ["POST", "/chats", createChat],
  ["POST", "/chats/direct", openDirect],
  ["GET", "/invite/:hash", chatByInvite],
  ["GET", "/chats/:id", getChat],
  ["PATCH", "/chats/:id", patchChat],
  ["DELETE", "/chats/:id", deleteChat],
  ["POST", "/chats/:id/invite", revokeInvite],
  ["POST", "/chats/:id/join", joinChat],
  ["POST", "/chats/:id/leave", leaveChat],
  ["POST", "/chats/:id/mute", muteChat],
  ["POST", "/chats/:id/pin", pinChat],
  ["POST", "/messages/:id/pin", pinMessage],
  ["GET", "/chats/:id/members", listMembers],
  ["POST", "/chats/:id/members", addMembers],
  ["POST", "/chats/:id/members/:uid/:action", memberAction],
  ["GET", "/chats/:id/stats", chatStats],
  ["GET", "/chats/:id/requests", listRequests],
  ["POST", "/chats/:id/requests/:uid/:action", requestAction],
  ["GET", "/chats/:id/messages", getMessages],
  ["POST", "/chats/:id/messages", sendMessage],
  ["POST", "/chats/:id/read", markRead],
  ["POST", "/chats/:id/typing", typing],
  ["PATCH", "/messages/:id", editMessage],
  ["DELETE", "/messages/:id", deleteMessage],
  ["POST", "/messages/:id/react", react],
  ["POST", "/messages/:id/vote", vote],
  ["POST", "/media", mediaCreate],
  ["PUT", "/media/:id/:idx", mediaPut],
  ["POST", "/media/:id/done", mediaDone],
  ["GET", "/media/:id", mediaMeta],
  ["GET", "/media/:id/:idx", mediaChunk],
  ["GET", "/stories", listStories],
  ["POST", "/stories", createStory],
  ["POST", "/stories/:id/view", viewStory],
  ["GET", "/stories/:id/views", storyViews],
  ["DELETE", "/stories/:id", deleteStory],
  ["GET", "/feed", feed],
  ["GET", "/reels", reels],
  ["GET", "/trend", trend],
  ["POST", "/trend/ev", trendEv],
  ["GET", "/trend/insights", trendInsights],
  ["GET", "/trend/trdbg", trendTrDbg],
  ["GET", "/trend/srcdbg", trendSrcDbg, true],
  ["POST", "/posts", createPost],
  ["DELETE", "/posts/:id", deletePost],
  ["POST", "/posts/:id/like", likePost],
  ["GET", "/posts/:id/comments", listComments],
  ["POST", "/posts/:id/comments", addComment],
  ["GET", "/push/vapid", async (c) => json({ key: c.env.VAPID_PUBLIC_KEY || "" }), true],
  ["POST", "/push/subscribe", pushSubscribe],
  ["POST", "/push/unsubscribe", pushUnsubscribe],
  ["GET", "/ice", ice],
  ["POST", "/calls", startCall],
  ["GET", "/calls/pending", callPending],
  ["POST", "/calls/:id/status", callStatus],
  ["POST", "/signal", signal],
  ["POST", "/p2p/have", p2pHave],
  ["GET", "/p2p/peers", p2pPeers],
  ["POST", "/p2p/signal", p2pSignal],
  ["POST", "/p2p/verify", p2pVerify],
  ["POST", "/storage/beat", storageBeat],
  ["POST", "/storage/drop", storageDrop],
  ["GET", "/storage/stats", storageStats],
  ["GET", "/lives", listLives],
  ["POST", "/lives", startLive],
  ["POST", "/lives/:id/join", joinLive],
  ["POST", "/lives/:id/leave", leaveLive],
  ["POST", "/lives/:id/ready", readyLive],
  ["POST", "/lives/:id/comment", liveComment],
  ["POST", "/lives/:id/gift", giftLive],
  ["POST", "/lives/:id/end", endLive],
  ["GET", "/wallet", getWallet],
  ["POST", "/wallet/daily", dailyBonus],
  ["GET", "/messages/:id/comments", listMsgComments],
  ["POST", "/messages/:id/comments", addMsgComment],
  ["DELETE", "/messages/:id/comments/:cid", delMsgComment],
]
function match(method: string, path: string) {
  const parts = path.split("/").filter(Boolean)
  for (const [m, pat, h, open] of routes) {
    if (m !== method) continue
    const pp = pat.split("/").filter(Boolean)
    if (pp.length !== parts.length) continue
    const p: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) p[pp[i].slice(1)] = decodeURIComponent(parts[i])
      else if (pp[i] !== parts[i]) { ok = false; break }
    }
    if (ok) return { h, p, open: !!open }
  }
  return null
}

async function cleanup(env: Env) {
  const db = env.__db || makeDb(env.DATABASE_URL)
  try { await ensureSchema(db) } catch {}
  const t = now()
  // O'CHMAS TARIX: xabarlar, fayllar va istoriyalar faqat foydalanuvchi o'zi o'chirmaguncha saqlanadi.
  // Cron faqat texnik chiqindilarni tozalaydi (kodlar, pin joblar, P2P reyestri) — hech qanday yozishmani o'chirmaydi.
  // MIGRATSIYA-HIMOYA: eskirgan qisqa-TTL yozishmalar (eski versiya qoldiqlari) tasodifan tozalanib qolmasin.
  await db.run("UPDATE messages SET expires_at=? WHERE expires_at>0 AND expires_at<?", [t + 100 * 365 * DAY, t + 30 * DAY])
  await db.run("UPDATE media SET expires_at=?, keep=1, next_check=0 WHERE expires_at>0 AND expires_at<? AND dropped=0 AND gone=0 AND (keep=1 OR chat_id>0)", [t + 100 * 365 * DAY, t + 30 * DAY])
  await db.run("DELETE FROM media_chunks WHERE media_id IN (SELECT id FROM media WHERE ((expires_at>0 AND expires_at<?) OR dropped=1) AND gone=0)", [t])
  await db.run("DELETE FROM media WHERE expires_at>0 AND expires_at<? AND keep=0", [t])
  await db.run("DELETE FROM media WHERE dropped=1 AND created_at<? AND id NOT IN (SELECT media_id FROM peer_have)", [t - 30 * DAY])
  await db.run("DELETE FROM pin_jobs WHERE created_at<?", [t - 2 * DAY])
  await planReplicas(db, 300)
  await db.run("DELETE FROM otp WHERE expires_at<?", [t])
  await db.run("DELETE FROM push_subs WHERE updated_at<?", [t - 90 * DAY]) // 90 kun ishlatilmagan obunalar
  await db.run("DELETE FROM peer_have WHERE updated_at<?", [t - 120 * DAY])
  await db.run("UPDATE lives SET ended_at=? WHERE ended_at=0 AND started_at<?", [t, t - 12 * 3600000])
}

export default {
  async fetch(req: Request, env: Env, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
    const path = url.pathname.slice(4).replace(/\/+$/, "") || "/"
    try {
      if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) fail("Server sozlanmagan: JWT_SECRET (kamida 16 belgi)", 500)
      if (!env.DATABASE_URL && !env.__db) fail("Server sozlanmagan: DATABASE_URL", 500)
      const db = env.__db || makeDb(env.DATABASE_URL)
      const wait = (p: Promise<unknown>) => { const s = p.catch((e) => console.log("fon xato", String(e))); ctx?.waitUntil ? ctx.waitUntil(s) : void s }
      // WebSocket
      if (path === "/ws") {
        const payload = await verifyJwt(url.searchParams.get("token") || "", env.JWT_SECRET)
        if (!payload) return json({ error: "Avtorizatsiya kerak" }, 401)
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket kerak" }, 426)
        const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(payload.sub)))
        return stub.fetch(req)
      }
      const r = match(req.method, path)
      if (!r) fail("Topilmadi", 404)
      let uid = 0
      if (!r!.open) {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const payload = await verifyJwt(token, env.JWT_SECRET)
        if (!payload) fail("Avtorizatsiya kerak", 401)
        uid = Number(payload.sub)
      }
      let b: any = {}
      const ct = req.headers.get("content-type") || ""
      if (["POST", "PATCH", "DELETE"].includes(req.method) && ct.includes("json")) b = await req.json().catch(() => ({}))
      return await r!.h({ env, db, uid, req, url, p: r!.p, b: b || {}, wait })
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status)
      console.log("Server xatosi", e?.stack || String(e))
      return json({ error: "Server xatosi. Birozdan keyin urinib ko‘ring" }, 500)
    }
  },
  async scheduled(_ev: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(cleanup(env))
  },
}
export { cleanup }
