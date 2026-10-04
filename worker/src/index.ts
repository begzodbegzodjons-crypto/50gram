// =====================================================================
// 50 GRAM API — Cloudflare Workers + TiDB Cloud Serverless + Durable Objects
// Frontend (web/) shu Worker orqali Static Assets sifatida beriladi; API: /api/*
// =====================================================================
import { makeDb, ph, type Db } from "./db"
import { signJwt, verifyJwt, sha256, randomStr, randomCode, hmacHex } from "./auth"
import { sendSms, smsConfigured } from "./sms"
import { pushUsers } from "./push"
import { SecFirewall } from "./firewall"
export { UserSocket } from "./realtime"
export { SecFirewall }

export interface Env {
  DATABASE_URL: string
  JWT_SECRET: string
  DEV_MODE?: string
  TEST_PHONES?: string
  // DEV rejim kodi FAQAT shu raqamlarga qaytariladi (operator). Bo'sh/yo'q bo'lsa —
  // DEV_MODE=1 bo'lsa ham HECH KIMGA kod javobda qaytmaydi (hisob o'tlash yo'li yopilgan)
  DEV_PHONES?: string
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
  // SEC FIREWALL — doimiy IP-bloklanganlar ombori (Durable Object, "global" nusxa)
  SEC?: { get: (id: any) => { fetch: (url: string, init?: any) => Promise<Response> }; idFromName: (s: string) => any }
  AI?: any
  // FOYDALANUVCHI MANBALARI (manba nomi klientga HECH QACHON chiqmaydi — mahfiy):
  // MY_YT: YouTube kanal ID (UC...) yoki @handle — vergul bilan ajratilgan
  // MY_IG: Instagram profil nomi — ochiq (public) akkaunt bo'lishi shart
  MY_YT?: string
  MY_IG?: string
  // IG ochiq akkaunt ham server-IP'dan bloklansa — foydalanuvchi o'z brauzeridan 'sessionid'
  // cookie qiymatini beradi (wrangler secret put MY_IG_COOKIE) — shunda IG API ishonchli ochiladi
  MY_IG_COOKIE?: string
  __db?: Db
  // Statik assetlar binlash (wrangler.toml [assets] binding) — APK yuklab olish uchun
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
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
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", ...SEC_H, ...CORS } })
// Xavfsizlik sarlavhalari — barcha javoblarga (klient uchun ko'rinmas, faqat brauzer qatlami)
const SEC_H: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
}
class HttpError extends Error {
  constructor(msg: string, public status = 400) { super(msg) }
}
const fail = (msg: string, status = 400): never => { throw new HttpError(msg, status) }
const now = () => Date.now()

// =====================================================================
// SEC FIREWALL — izolyat-ichki qatlam (FOYDALANUVCHIGA KO'RINMAS).
// Oddiy foydalanuvchi: NOL qo'shimcha kechikish (xotira-tekshiruvi xolos).
// Hujumchi: milliyatlar ichida to'siladi (lokal) + doimiy blok (DO, barcha
// shaharlarda amal qiladi). Bloklanganga javob — ODDIY "Not found" 404:
// blok bor-yo'qligi, sababi, muddati HECH QANDAY shaklda oshkor qilinmaydi.
//
// KESH MODEL: lokal bloklar VAQTINCHALIK (max 2 daqiqa, v=0) — DO markaziy
// ombor ularni ≤45s ichida tasdiqlasa to'liq muddatga uzaytiriladi (v=1).
// Shunda blokni yechish (unblock) barcha izolyatlarda o'zi-o'zidan tarqaladi
// (eskirgan kesh — hujumchiga emas, foydalanuvchiga qaytishi mumkin bo'lgan
// yagona xavf — ≤2 daqiqada butunlay tozalanadi).
// =====================================================================
const FW_KESH = new Map<string, { u: number; t: number; v: 0 | 1 }>() // ip → {muddat, qo'yilgan vaqt, tasdiqlanganmi}
const FW_RATE = new Map<string, { n: number; t: number }>() // 10s toshqin oynasi
const FW_4XX = new Map<string, { n: number; t: number }>() // 10 daqiqalik 4xx oynasi
const FW_ALOC = new Map<string, { n: number; t: number }>() // lokal ochkolar (ip|tur)
const FW_DATA = new Map<number, { n: number; t: number }>() // ma'lumot-tortish posboni (uid)
let FW_YANGI = 0
// TIZIM ILDIGA / ADMIN YO'LLARIGA URINISH — bitta urinishda ham 30 kun blok
// (skanerlarning sevimli manzillari kengaytirildi — oddiy foydalanuvchi bu yo'llarga
//  HECH QACHON kirmaydi, barchasi ilova ichidan ma'lum yo'llargina so'raydi)
const FW_TRAP = /^\/api\/(?:adm(?:in)?|debug|trdbg|srcdbg|dump|purge|internal|root|shell|eval|config|backup|secret|telescope|actuator|\.env|env|phpmyadmin|wp-admin|wp-login|wp-content|wp-json|wp-includes|xmlrpc|phpinfo|cgi-bin|console|git|svn|hg|aws|\.git|\.svn|\.aws|\.ds_store|jenkins|hudson|cpanel|webmin|adminer|swagger|openapi|api-docs|graphql|graphiql|rpc|soap|wsdl|server-status|metrics|prometheus|grafana|kibana|elastic|solr|docker|vagrant|composer|vendor|manager|examples|docs)(?:\/|$)/i
// In'ektsiya / traversal belgilari (yo'l + so'rov satrida)
const FW_INJ = /(?:\.\.[\\/]|%2e%2e(?:%2f|%5c)|<script|javascript:|onerror\s*=|union[\s+]+select|information_schema|sleep\s*\(|benchmark\s*\(|load_file|into[\s+]+outfile|waitfor[\s+]+delay|\/etc\/passwd|\$\{(?:jndi|env\())/i
// RUXSAT ETILGAN MIJOZLAR — faqat sayt (brauzer) va ilova (APK WebView + APK fon xizmati).
//  mozilla    — barcha brauzerlar + Android/iOS WebView (PWA sayti)
//  50gramapp  — APK WebView qo'shimcha belgisi (" 50GramApp/2.x")
//  dalvik     — APK fon xizmati (KeepAliveService polling, HttpURLConnection standart UA)
// Qolgan HAR QANDAY mijoz (curl, wget, python, go, skanerlar, botlar) = tashqi jashnchi —
// 1-urinishdayoq 30 kun blok (hujumchi hech narsa ololmaydi, "Not found" degan javob ko'radi).
const FW_UA_OK = /mozilla|50gramapp|dalvik/i
const fwIp = (req: Request) => (req.headers.get("cf-connecting-ip") || "").trim()
const FW_404 = () => new Response("Not found", { status: 404, headers: { ...SEC_H } })
// Lokal (izolyat) blok — VAQTINCHA 2 daqiqa: DO tasdiqlasa uzayadi, yechilsa o'zi tozalanadi
const fwLBlok = (ip: string, dur: number) => { const t = Date.now(); FW_KESH.set(ip, { u: t + Math.min(dur, 120_000), t, v: 0 }) }
function fwBlokli(ip: string) {
  const e = FW_KESH.get(ip)
  if (e && e.u > Date.now()) return true
  if (e) FW_KESH.delete(ip)
  return false
}
// Doimiy bloklar ro'yxatini yangilash. DO — yagona ishonchli manba: ro'yxatda YO'Q
// bo'lgan bloklar keshdan ham o'chadi (v=1 — darhol; v=0 — 90s dan eskirganlari).
// Shuning uchun blokni yechish (unblock) butun tarmoq bo'ylab tez tarqaladi,
// hech qanday qoldiq qolmaydi.
let FW_FYANGI = 0 // majburiy (bloklanganlar yo'li) refresh oxirgi vaqti
// DO blok ro'yxatini keshga qo'llash: ro'yxatda yo'qlar o'chadi (v=1 — darhol,
// v=0 — 90s dan eskirganlari), ro'yxatdagilar to'liq muddat bilan yoziladi (v=1).
function fwQollash(j: any) {
  const nw = new Set<string>()
  for (const [ip2] of (j.blocks || []) as Array<[string, number]>) nw.add(String(ip2))
  const t2 = Date.now()
  for (const [ip2, e] of FW_KESH) {
    if (nw.has(ip2)) continue
    if (e.v === 1 || t2 - e.t > 90_000) FW_KESH.delete(ip2)
  }
  for (const [ip2, until] of (j.blocks || []) as Array<[string, number]>) FW_KESH.set(String(ip2), { u: Number(until), t: t2, v: 1 })
  return nw
}
async function fwYangola(env: Env) {
  if (Date.now() - FW_YANGI < 45_000 || !env.SEC) return
  FW_YANGI = Date.now()
  try {
    const r = await env.SEC!.get(env.SEC!.idFromName("global")).fetch("https://fw/?op=refresh")
    fwQollash(await r.json())
  } catch {}
}
// Bloklangan IP uchun majburiy tekshiruv (≤50ms, 300ms interval): DO yangi ro'yxatida
// IP yo'q bo'lsa — lokal yozuv DARHOL o'chadi. Shuning uchun blok yechilishi butun
// tarmoqda birinchi so'rovdayoq ko'rinadi (qoldiq 404 qolmaydi).
async function fwTekshir(env: Env, ip: string) {
  if (!env.SEC || Date.now() - FW_FYANGI < 300) return
  FW_FYANGI = Date.now()
  try {
    const r = await env.SEC!.get(env.SEC!.idFromName("global")).fetch("https://fw/?op=refresh")
    const nw = fwQollash(await r.json())
    if (!nw.has(ip)) FW_KESH.delete(ip)
  } catch {}
}
// Oddiy so'rovlar: fon rejimida (hech qachon kutmaydi — NOL kechikish)
function fwKeshYana(env: Env, wait: (p: Promise<unknown>) => void) {
  if (Date.now() - FW_YANGI < 45_000 || !env.SEC) return
  wait(fwYangola(env))
}
// Lokal ochko — shu izolyatda MILLIYATLAR ichida to'siq (DO javobini kutmaydi).
// need <= 1 bo'lsa — BIRINCHI urinishdayoq DARHOL blok (hujumchi hech narsa ololmaydi).
function fwLokal(ip: string, kind: string, need: number, dur: number) {
  if (need <= 1) { fwLBlok(ip, dur); FW_ALOC.delete(ip + "|" + kind); return true }
  const k = ip + "|" + kind
  const t = Date.now()
  const e = FW_ALOC.get(k)
  if (!e || t - e.t > 3_600_000) { if (FW_ALOC.size > 5000) FW_ALOC.clear(); FW_ALOC.set(k, { n: 1, t }); return false }
  e.n++
  if (e.n >= need) { fwLBlok(ip, dur); FW_ALOC.delete(k); return true }
  return false
}
// DO'ga doimiy ochko (fon rejimida — asosiy so'rov sekinlamaydi)
function fwOchko(env: Env, wait: (p: Promise<unknown>) => void, ip: string, kind: string, weight = 1) {
  if (!ip || !env.SEC) return
  wait((async () => {
    try {
      const st = env.SEC!.get(env.SEC!.idFromName("global"))
      const r = await st.fetch("https://fw/?op=strike", { method: "POST", body: JSON.stringify({ ip, kind, weight }) })
      const j: any = await r.json()
      if (j && j.until > Date.now()) FW_KESH.set(ip, { u: j.until, t: Date.now(), v: 1 })
    } catch {}
  })())
}
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
    // Task 39: izohlar — javob-replies, stiker izohlar va reaksiyalar (baholash)
    "ALTER TABLE post_comments ADD COLUMN parent_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE post_comments ADD COLUMN sticker VARCHAR(64) NOT NULL DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS idx_pc_parent ON post_comments (parent_id)",
    "CREATE TABLE IF NOT EXISTS comment_reacts (comment_id BIGINT NOT NULL, user_id BIGINT NOT NULL, emoji VARCHAR(8) NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(comment_id,user_id,emoji))",
    "CREATE INDEX IF NOT EXISTS idx_creacts_c ON comment_reacts (comment_id)",
    // Task 57: yagona faol sessiya — logout barcha tokenlarni o'ldiradi, yangi kirish eskisini
    "ALTER TABLE users ADD COLUMN sess VARCHAR(24) NULL",
    // Task 56: paralel-kirish himoyasi — logout bayrog'i va sessiya muddati (ms)
    "ALTER TABLE users ADD COLUMN logout_at BIGINT NULL",
    "ALTER TABLE users ADD COLUMN token_exp BIGINT NULL",
    // Eski foydalanuvchilar: sessiya muddati = ro'yxatdan o'tgan vaqt + 180 kun (taxmin, JWT muddati bilan mos)
    "UPDATE users SET token_exp = created_at + 15552000000 WHERE token_exp IS NULL",
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
    // Telefon maxfiyligi to'g'ri ishlaydi: 0=Hamma, 1=Kontaktlarim (kontakt ko'radi — ilgari yashirin edi, tuzatildi), 2=Hech kim.
    // Shu tufayli profil ochilganda raqam «Kontaktlarim» rejimida ham ko'rinadi (Telegram mantiqi).
    phone: self || u.privacy_phone === 0 || (u.privacy_phone === 1 && !!contactName) ? u.phone : null,
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
  // TEZLIK: foydalanuvchilar, kontakt-xarita va istoriya bayroqlari bir-biridan
  // bog'liq emas — PARALLEL so'raladi (3 ketma-ket HTTP so'rov → 1 to'lqin)
  const [rows, m, flags] = await Promise.all([
    c.db.q(`SELECT ${USER_COLS} FROM users WHERE id IN (${ph(u)})`, u),
    cmap ? Promise.resolve(cmap) : contactMap(c),
    storyFlags(c, u),
  ])
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
  await ensureSchema(c.db)
  const phone = normPhone(c.b.phone)
  const t = now()
  const devPhones = (c.env.DEV_PHONES || "").split(",").map((x) => x.trim()).filter(Boolean)
  const smsOn = smsConfigured(c.env)
  const test = (c.env.TEST_PHONES || "").split(",").map((x) => x.trim().split(":")).find(([p]) => p === phone)
  // PARALEL KIRISH HIMOYASI (muallif tizimi): hisob tizimda FAOL bo'lsa — logout qilmagan
  // VA sessiyasi hali yaroqli (token_exp o'tmagan) — shu raqamga yangi kod BERILMAYDI:
  // "raqam band — tizimda mavjud". Logout qilingan yoki sessiyasi eskirgan hisobga KOD
  // BERILADI (qayta kirish). Operator raqamlari (DEV_PHONES) — yagona istisno, doim kiradi.
  // Haqiqiy SMS (Eskiz) ulanganda bu qo'riqchi shart emas — kod faqat haqiqiy egasiga boradi.
  if (!smsOn && !test) {
    const ex = await c.db.one("SELECT id, logout_at, token_exp, last_seen FROM users WHERE phone=?", [phone])
    // BAND qoidasi: sessiya yaroqli VA (logout qilmagan YOKI hisob hali TIRIK — oxirgi
    // faollik 24 soat ichida: ping/storageBeat har daqiqada keladi). last_seen sharti
    // masofaviy logout'ni bekor qiladi: boshqa qurilma hali ishlatayotgan bo'lsa raqam
    // BAND qoladi (paralel yo'q). Haqiqiy chiqish last_seen=0 qiladi → raqam OCHIQ.
    if (ex && +(ex.token_exp || 0) > t && (!ex.logout_at || +(ex.last_seen || 0) > t - 86_400_000) && !devPhones.includes(phone))
      return fail("Bu raqam band — tizimda mavjud. Kod olish uchun avval ilovadan chiqish (Logout) qiling", 409)
  }
  // SINOV REJIMI (SMS hali ulanmagan): HAR QANDAY raqam kodni ilova ICHIDA oladi —
  // "avvalgiday": raqam kiritildi → kod darhol qizil yozuvda ko'rinadi.
  // Eskiz ulanganda (smsOn=true) bu tarmoq o'chadi — o'sha paytdan haqiqiy SMS yuboriladi.
  let devSelf = false
  if (!smsOn && !test && c.env.DEV_MODE === "1") devSelf = true
  // Kutish muddati: haqiqiy SMS (Eskiz) pullik/pumping-xavfli — 55s; ilova-ichki kod bepul — 20s
  const cd = smsOn ? 55000 : 20000
  const prev = await c.db.one("SELECT sent_at FROM otp WHERE phone=?", [phone])
  if (prev && t - prev.sent_at < cd) fail(smsOn ? "Kodni qayta so‘rash uchun 1 daqiqa kuting" : "Kodni qayta so‘rash uchun 20 soniya kuting", 429)
  const code = test ? test[1] : randomCode()
  await c.db.run("REPLACE INTO otp(phone,code_hash,expires_at,sent_at,tries) VALUES(?,?,?,?,0)", [phone, await sha256(phone + code + c.env.JWT_SECRET), t + 5 * 60000, t])
  if (test) return json({ ok: true, phone })
  if (smsOn) {
    await sendSms(c.env, phone, code)
    return json({ ok: true, phone })
  }
  if (devSelf) return json({ ok: true, phone, dev_code: code })
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
    // BRUTE-FORCE HIMoyasi: noto'g'ri kod urinishlari hisobga olinadi — 12 xato/1 soat
    // bo'lsa IP 24 soatga to'siladi (bu haqda hujumchiga ma'lumot bermaydigan javob)
    const fip = fwIp(c.req)
    if (fip) {
      if (fwLokal(fip, "auth", 12, 24 * 3_600_000)) { fwOchko(c.env, c.wait, fip, "auth"); return FW_404() }
      fwOchko(c.env, c.wait, fip, "auth")
    }
    fail("Kod noto‘g‘ri")
  }
  await c.db.run("DELETE FROM otp WHERE phone=?", [phone])
  await ensureSchema(c.db)
  const tnow = now(), texp = tnow + 180 * 86400 * 1000
  const sess = randomStr(16)
  let u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE phone=?`, [phone])
  if (!u) {
    const id = newId()
    await c.db.run("INSERT INTO users(id,phone,created_at,last_seen,token_exp,sess) VALUES(?,?,?,?,?,?)", [id, phone, tnow, tnow, texp, sess])
    u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE id=?`, [id])
  } else {
    // Kirish → hisob yana FAOL bo'ldi + YANGI YAGONA SESSIYA: eskirgan barcha tokenlar
    // o'lik bo'lib qoladi (sess mos kelmadi → 401) — bir raqam, bitta faol qurilma.
    await c.db.run("UPDATE users SET logout_at=NULL, token_exp=?, last_seen=?, sess=? WHERE id=?", [texp, tnow, sess, u.id])
  }
  const token = await signJwt({ sub: String(u.id), s: sess }, c.env.JWT_SECRET, 180 * 86400)
  return json({ token, user: pubUser(u, u.id), is_new: !u.first_name })
}

async function authLogout(c: C) {
  // MUALLIF TIZIMI: chiqish — hisob "bo'shaydi" → shu raqamga yana kod beriladi.
  // last_seen=0: "hozir faol" belgisi o'chadi — qayta kirish DARHOL ochiladi.
  // Chiqmagan faol hisob esa "BAND" qoladi — boshqa qurilmadan shu raqamga kod
  // olib bo'lmaydi (bir raqam — bir faol foydalanuvchi, paralel ishlatish yo'q).
  await c.db.run("UPDATE users SET logout_at=?, last_seen=0 WHERE id=?", [now(), c.uid])
  return json({ ok: true })
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
  // TEZLIK: 5 ta so'rov oldin ketma-ket edi (5 ta HTTP davra yurishi = sekundlab kutish).
  // Barchasi bir-biridan bog'liq emas — PARALLEL yuboriladi, javob ~3-5 baravar tez qaytadi.
  const [m, iBlocked, live, direct, w] = await Promise.all([
    usersByIds(c, [id]),
    c.db.one("SELECT 1 AS x FROM blocks WHERE user_id=? AND blocked_id=?", [c.uid, id]),
    c.db.one("SELECT id FROM lives WHERE user_id=? AND ended_at=0 AND started_at>?", [id, now() - 12 * 3600000]),
    c.db.one("SELECT id FROM chats WHERE direct_key=?", [[c.uid, id].sort((a: number, b: number) => a - b).join(":")]),
    c.db.one("SELECT earned FROM wallets WHERE user_id=?", [id]).catch(() => null) as any,
  ])
  const u = m.get(id)
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  return json({ ...u, lvl: levelOf(Number(w?.earned || 0)), i_blocked: !!iBlocked, live_id: live?.id || null, chat_id: direct?.id || null })
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
  // Trend REYTING: obunachilar soni bo'yicha kamayish tartibida — 1-o'rin eng trend kanal.
  // LIMIT 200 (avval 40 edi) — klient "yana ko'rsatish" bilan to'liq ro'yxatni aylantiradi.
  const rows = await c.db.q(
    `SELECT ${CHAT_COLS.split(",").map((x) => "c." + x).join(",")}, m.role FROM chats c LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=? AND m.status='active'
     WHERE c.type<>'direct' AND c.is_public=1 ORDER BY c.member_count DESC, c.last_msg_at DESC LIMIT 200`,
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
  const cm = await c.db.q(`SELECT message_id, COUNT(*) AS cnt FROM msg_comments WHERE message_id IN (${ph(ids)}) GROUP BY message_id`, ids).catch((): any[] => [])
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
    // Tez ochilish: eng oxirgi N xabar bitta so'rovda (10 martagacha so'rov o'rniga 1). O'chirilganlar tarixda ko'rinmaydi.
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 ORDER BY id DESC LIMIT " + latest, [id])
    all = rows.reverse()
    more = rows.length === latest
  } else if (before) {
    // Orqaga sahifalash: butun tarix saqlangan — eski yozishmalar hech qachon yo'qolmaydi
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id<? ORDER BY id DESC LIMIT 100", [id, before])
    all = rows.reverse()
    more = rows.length === 100
  } else {
    const fresh = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id>? ORDER BY id LIMIT 300", [id, after])
    const changed = since && after
      ? await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id<=? AND updated_at>? ORDER BY id LIMIT 300", [id, after, since])
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
  // O'chirish ruxsati (Telegram-uslubi): o'z xabari — hamma joyda; bevosita suhbatdagi qarshi tomon xabari — ikkala tomon ham o'chiradi;
  // guruh/kanalda — adminlar. ownMsg(needOwner=false) bilan ochiq qabul qilib, keyin qo'lda tekshiramiz.
  const m = await ownMsg(c, false)
  if (m.sender_id !== c.uid) {
    const ch = await needChat(c, m.chat_id)
    const mem = await member(c, m.chat_id)
    const can = ch.type === "direct" || (ch.type !== "direct" && mem && isAdm(mem))
    if (!can) fail("Faqat o‘z xabaringiz", 403)
  }
  const mid = parse(m.meta, {}).media_id
  if (mid) await dropMedia(c.db, "id=?", [String(mid)])
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE id=?", [now(), m.id])
  // Qadalgan xabar o'chirilsa — qadash ham olinadi
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=? AND pinned_id=?", [m.chat_id, m.id]).catch(() => {})
  await c.db.run("DELETE FROM reactions WHERE message_id=?", [m.id])
  return json(await pushMsg(c, m.id))
}
// SUHBATNI TOZALASH: barcha yozishmalar ikkala tomonda ham o'chiriladi (Telegram "Clear history" uslubi).
// Bevosita suhbat — a'zoning o'zi, guruh/kanal — faqat admin/owner.
async function clearChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const mem = await member(c, id)
  if (!mem || mem.status !== "active") fail("Ruxsat yo‘q", 403)
  if (ch.type !== "direct" && !isAdm(mem)) fail("Faqat adminlar tozalashi mumkin", 403)
  const t = now()
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE chat_id=? AND deleted=0", [t, id])
  await c.db.run("UPDATE media SET dropped=1 WHERE chat_id=? AND dropped=0", [id]).catch(() => {})
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=?", [id]).catch(() => {})
  await c.db.run("UPDATE chat_members SET pinned=0 WHERE chat_id=?", [id]).catch(() => {})
  notifyChat(c, id, { type: "chat_cleared", chat_id: id, now: t })
  return json({ ok: true, now: t })
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
const decodeEnt = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/&copy;|&#169;/gi, "©").replace(/&laquo;/gi, "«").replace(/&raquo;/gi, "»").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&ldquo;|&#8220;/g, "“").replace(/&rdquo;|&#8221;/g, "”").replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return "" } }).replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n) } catch { return "" } })
const stripHtml = (s: string) => decodeEnt(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim()
function tagGet(block: string, tag: string): string {
  const m = block.match(new RegExp("<" + tag + ">(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</" + tag + ">"))
  return m ? m[1].trim() : ""
}
// Qisqa deterministik id (djb2) — yangilik URL'dan barqaror id (kesh/kartalar uchun)
function hId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
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
        id: "n" + hId(link), kind: "news", src, title, url: link,
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
// ANILAN KANALLARI OLIB TASHLANDI (2026-10, foydalanuvchi 5+ marta shikoyat qilgan): 3 ta Anilan
// kanal (Dublaj/UZ/DUBLAJ) 100% MINECRAFT o'yin videolari — sarlavhalarida ko'pincha "minecraft"
// yozilmaydi ("MEN BIR BLOK USTIDA 100 KUN OMON QOLDIM..."), shuning uchun sarlavha-filtri ularni
// USHLAY OLMAEDI. Yagona ishonchli yechim: kanal manbasini BATAMOM olib tashlash + BLOCK_VIDS.
const UZ_CHANNELS = [
  "UCd5_-70CbGPmmz2YusxX1zQ", // YANGI TV — komik sketchlar
  "UCZm8kCDX5sFagGux3qz5hRg", // Umidjon Murodullayev — qisqa hazillar
  "UCccjqZeIXuVeZyi9C5Bil4A", // 404 uz
  "UCHyWMPoLqTWteebdhjKoB4Q", // Uzbek vid
  "UCfKQvap5T1SKGBRgZKhyhXg", // MANGU_YT
  "UCuXexJqac0W-TUTab-Yqt8g", // ANYONE SHOW — qisqa hazillar
  "UCfjrghi9WYjRAd9B9zArkFQ", // Uzbek Vines
]
// MINECRAFT VIDEO-ID QATIY BLOK: Anilan kanallarining so'nggi videolari — eski hovuz/CDN/kyent
// keshlarida qolganlari ham qayta ko'rinishi MUMKIN EMAS (foydalanuvchi: "batamom o'chir").
const BLOCK_VIDS = new Set([
  "A0VSlf71MBg", "Jd-ve41f-aY", "iTdKFb675xM", "N1W5nsZKLaE", "TMHOBYLjUw8", // Anilan Dublaj UZ
  "xpnmQhCFceY", "l6pjLj-v0FE", "eiQb0DeZGSk", "qhmMzT-5OSQ", "G7aNRr0R-sk", // Anilan UZ
  "o4fAgHxlJAw", "by4wzlyfwUQ", "ThhEzyvVeZI", "Fa2ghDWxPBI", "xJ5gtl7UzBs", // Anilan DUBLAJ
])
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
          id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz: 1, src: "ch", chid: ch,
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

// ================= FOYDALANUVCHI MANBALARI (MAHFIY) =================
// Foydalanuvchining o'z YouTube kanali va Instagram akkauntidan kontent avtomatik
// olinadi va umumiy hovuzga ALGORITM bo'yicha aralashtiriladi. QAYSI PLATFORMADAN
// olingani klientga UMUMAN ko'rinmaydi (url/src/yuklab olish yo'q — manba SIR).
const listVar = (v?: string) => String(v || "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean).slice(0, 6)

// @handle -> UC kanal ID (1 so'rov: kanal sahifasidagi externalId)
async function ytChannelIdOf(handle: string): Promise<string> {
  if (/^UC[\w-]{22}$/.test(handle)) return handle
  const r = await fT("https://www.youtube.com/@" + encodeURIComponent(handle), 8000, 3600)
  if (!r) return ""
  try {
    const h = await r.text()
    const m = h.match(/"externalId":"(UC[\w-]{22})"/) || h.match(/channel\/(UC[\w-]{22})/)
    return m ? m[1] : ""
  } catch { return "" }
}
// Kanalning SHORTS tabi (1 so'rov): 41 tagacha shorts videoId + sarlavha. Uzun videolar KIRMAYDI.
// shortsLockupViewModel bloklari: entityId = shorts-shelf-item-{vid}, primaryText = toza sarlavha.
async function ytShortsOfChannel(ch: string): Promise<any[]> {
  const r = await fT("https://www.youtube.com/channel/" + ch + "/shorts", 9000, 1200)
  if (!r) return []
  try {
    const h = await r.text()
    const out: any[] = []
    const seen = new Set<string>()
    for (const chunk of h.split('"shortsLockupViewModel"').slice(1)) {
      const idM = chunk.match(/"shorts-shelf-item-([\w-]{11})"/)
      if (!idM || seen.has(idM[1])) continue
      seen.add(idM[1])
      const tM = chunk.match(/"primaryText":\{"content":"(.*?)"/)
      const title = (tM ? tM[1] : "").replace(/\\u([\dA-Fa-f]{4})/g, (_, x) => { try { return String.fromCharCode(parseInt(x, 16)) } catch { return "" } }).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, " ").trim()
      const vid = idM[1]
      // mine:1 — FOYDALANUVCHI kanali belgisi: klient lentaSning BOSHIGA chiqaradi
      // (manba nomi baribir SIR — sanitizer src/chid/url'ni o'chiradi, mine bayrog'i qoladi)
      out.push({
        id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz: 1, src: "", chid: ch, mine: 1,
        title: title.slice(0, 140), image: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
        views: 0, duration: 0, time: now(), url: "", cat: "video",
      })
      if (out.length >= 24) break
    }
    return out
  } catch { return [] }
}
// Foydalanuvchi kanallari: @handle UC'ga aylantiriladi, shorts tabi o'qiladi
async function ytMine(env: Env): Promise<any[]> {
  const ids = listVar(env.MY_YT)
  if (!ids.length) return []
  const chans = await Promise.all(ids.map((h) => ytChannelIdOf(h).catch(() => "")))
  const uniq = [...new Set(chans.filter(Boolean))]
  if (!uniq.length) return []
  const lists = await Promise.all(uniq.map((c) => ytShortsOfChannel(c).catch(() => [] as any[])))
  return lists.flat()
}
// Instagram: datacenter-IP'larga IG cheklov qilishi mumkin — 3 bosqichli zanjir, muvaffaqiyatsizlik jim o'tadi
const IG_HEADERS: Record<string, string> = { "x-ig-app-id": "936619743392459", accept: "application/json" }
async function igWebProfile(env: Env, user: string): Promise<any[]> {
  const sess = String(env.MY_IG_COOKIE || "").trim()
  const hosts = [
    { u: "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(user), h: { ...IG_HEADERS, ...TREND_UA, ...(sess ? { cookie: "sessionid=" + sess } : {}) } },
    { u: "https://i.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(user), h: { ...IG_HEADERS, "user-agent": "Instagram 219.0.0.12.117 Android", ...(sess ? { cookie: "sessionid=" + sess } : {}) } },
  ]
  for (const { u, h } of hosts) {
    const r = await fT2(u, h, 8000, 1800)
    if (!r) continue
    try {
      const j: any = await r.json()
      const edges = j?.data?.user?.edge_owner_to_timeline_media?.edges || []
      const out: any[] = []
      for (const e of edges) {
        const n = e?.node || {}
        const code = String(n.shortcode || "")
        if (!code) continue
        const cap = stripHtml(String(n.edge_media_to_caption?.edges?.[0]?.node?.text || ""))
        const child = n.edge_sidecar_to_children?.edges?.[0]?.node || n
        const vurl = String(child.video_url || n.video_url || "")
        const iurl = String(child.display_url || n.display_url || n.thumbnail_src || "")
        const media = vurl || iurl
        if (!media) continue
        out.push({
          id: "ig" + code, kind: "short", vid: vurl ? "mp4" : "img", mp4: vurl || undefined, img: vurl ? undefined : iurl,
          uz: 1, src: "", mine: 1, title: cap.slice(0, 140),
          image: iurl, views: 0, duration: 0,
          time: +n.taken_at_timestamp > 0 ? +n.taken_at_timestamp * 1000 : now(),
          url: "", cat: "video",
        })
        if (out.length >= 12) break
      }
      if (out.length) return out
    } catch {}
  }
  return []
}
// Zaxira: ochiq RSSHUB nusxalari (ba'zan ishlaydi) — media:content/enclosure URL'lari
async function igRsshub(user: string): Promise<any[]> {
  for (const base of ["https://rsshub.rssforever.com", "https://rsshub.app"]) {
    const r = await fT(base + "/instagram/user/" + encodeURIComponent(user), 8000, 1800)
    if (!r) continue
    try {
      const xml = await r.text()
      const out: any[] = []
      for (const block of xml.split("<item>").slice(1)) {
        const link = tagGet(block, "link")
        const code = (link.match(/\/(p|reel|reels)\/([\w-]+)/) || [])[2] || ""
        const title = stripHtml(tagGet(block, "title")).slice(0, 140)
        if (!code) continue
        const mm = block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"[^>]*medium="video"/) || block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"/) || block.match(/<enclosure[^>]+url="(https:\/\/[^"]+)"/)
        if (!mm) continue
        const isVid = /medium="video"|\.(mp4|mov)/i.test(mm[0])
        out.push({
          id: "ig" + code, kind: "short", vid: isVid ? "mp4" : "img", mp4: isVid ? mm[1] : undefined, img: isVid ? undefined : mm[1],
          uz: 1, src: "", mine: 1, title,
          image: isVid ? "" : mm[1], views: 0, duration: 0, time: now(), url: "", cat: "video",
        })
        if (out.length >= 12) break
      }
      if (out.length) return out
    } catch {}
  }
  return []
}
async function igMine(env: Env): Promise<any[]> {
  const users = listVar(env.MY_IG)
  if (!users.length) return []
  const lists = await Promise.all(users.map(async (u) => {
    const a = await igWebProfile(env, u).catch(() => [] as any[])
    if (a.length) return a
    return igRsshub(u).catch(() => [] as any[])
  }))
  return lists.flat()
}
// FOYDALANUVCHI HOVUZI: YT + IG — 30 daqiqa edge-kesh (IG CDN havolalari yangi qoladi)
async function minePool(env: Env): Promise<any[]> {
  if (!listVar(env.MY_YT).length && !listVar(env.MY_IG).length) return []
  // minev2: foydalanuvchining o'z kanali ulandi (YANGI TV olib tashlandi) — eski kesh bekor
  const ck = "https://trend.50gram.internal/minev2"
  const meta = await cacheGetJSON<any[]>(ck)
  if (meta && meta.data?.length) return meta.data
  const [yt, ig] = await Promise.all([ytMine(env).catch(() => [] as any[]), igMine(env).catch(() => [] as any[])])
  const seen = new Set<string>()
  const out = [...yt, ...ig].filter((v) => v && !seen.has(v.id) && seen.add(v.id))
  if (out.length) {
    // ALGORITM: YT va IG navbatma-navbat aralashtiriladi (bitta platforma hukmronlik qilmasin)
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[out[i], out[j]] = [out[j], out[i]] }
    cWaitPut(ck, { t: now(), data: out })
  }
  return out
}
// kichik yordamchi: keshga yozish (await qilinmaydi)
function cWaitPut(ck: string, obj: unknown): void {
  cachePutJSON(ck, obj).catch(() => {})
}
async function fT2(url: string, headers: Record<string, string>, ms: number, cacheTtl = 600): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), cf: { cacheTtl, cacheEverything: true } } as any)
    return r.ok ? r : null
  } catch { return null }
}
async function youtubeTrending(): Promise<any[]> {
  // Chet-el trending OLINGAN (foydalanuvchi: faqat o'zbek kontenti) — faqat UZ qidiruvi va kanallar qoladi.
  return []
}
// --- O'ZBEK SHORTS: Piped/Invidious QIDIRUV — faqat o'zbekcha (1..90s VA sarlavha UZ) ---
// Chet-el kontenti QATIY filtrlanadi: UZ_RE mos kelmasa — umuman qo'shilmaydi.
const UZ_QUERIES = ["o‘zbekiston shorts", "o‘zbekcha shorts", "o‘zbek komik shorts", "toshkent shorts", "o‘zbekcha hazil", "qiziqarli o‘zbekcha video", "o‘zbek prank", "o‘zbekcha dubljaz", "o‘zbekcha qo‘shiq", "o‘zbekcha to‘y", "o‘zbek futbol", "o‘zbek raqs", "o‘zbekcha multfilm", "o‘zbek kino", "samarqand", "buxoro", "o‘zbek taom", "o‘zbekcha clip"]
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
        // UPLOADER-FILTR: sarlavhasida "minecraft" yozilmagan Minecraft/o'yin kanallari ham
        // kanal nomi bo'yicha kesiladi (Anilan uslubi — foydalanuvchi "batamom o'chir" dedi)
        if (/minecraft|minekraf|maynkraft|anilan|минекрафт|майнкрафт/i.test(String((v as any).uploaderName || ""))) return null
        if (!UZ_RE.test(title)) return null // QATIY: faqat o'zbekcha sarlavhali videolar
        return {
          id: "yt" + id.split("&")[0], kind: "short", vid: "yt", yt: id.split("&")[0], uz: 2, src: "s", // 2: UZ_RE qATIY filtr'dan o'tgan — to'liq o'zbekcha
          title, image: String(v.thumbnail || "https://i.ytimg.com/vi/" + id.split("&")[0] + "/hqdefault.jpg"), // bo'sh thumbnail — hqdefault zaxira (qora qopqoq bo'lmasin)
          views: +v.views || 0, duration: dur,
          time: +v.uploaded > 0 ? +v.uploaded : now(),
          url: "https://www.youtube.com/watch?v=" + id.split("&")[0], cat: "video",
        }
      }).filter((v: any) => v && v.title)
    } catch { return [] }
  }
  const out: any[] = []
  const seen = new Set<string>()
  // HAR BUILD'DA TASODIFIY 7 ta so'rov: hovuz har yangilanishida boshqa mavzular chiqadi
  // (bir xillik yo'q) + subrequest limiti (50) doim xavfsiz qoladi
  const qs = UZ_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 7)
  const res = await Promise.allSettled([
    ...PIPED_APIS.flatMap((b) => qs.map((q) => one(b, q))),
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
      // UPLOADER-FILTR (Piped bilan bir xil): Minecraft-kanallar nomi bo'yicha ham kesiladi
      if (/minecraft|minekraf|maynkraft|anilan|минекрафт|майнкрафт/i.test(String(v.author || ""))) return null
      if (!v.videoId || dur < 1 || dur > 90 || !UZ_RE.test(title)) return null
      return {
        id: "yt" + String(v.videoId), kind: "short", vid: "yt", yt: String(v.videoId), uz: 2, src: "s", // 2: UZ_RE qATIY filtr'dan o'tgan
        title, image: String(v.videoThumbnails?.[0]?.url || "https://i.ytimg.com/vi/" + String(v.videoId) + "/hqdefault.jpg"),
        views: +v.viewCount || 0, duration: dur,
        time: +v.published > 0 ? +v.published * 1000 : now(),
        url: "https://www.youtube.com/watch?v=" + v.videoId, cat: "video",
      }
    }).filter((v: any) => v && v.title)
  } catch { return [] }
}
// Reddit (403: serverdan bloklangan) va TikTok (O'zbekistonda VPN'siz ishlamaydi) manbalari olib tashlandi.

// ================= YOUTUBE GLOBAL TREND SHORTS (foydalanuvchi talabi) =================
// DAILYMOTION OLIB TASHLANDI (2026-10-04): DM videolar O'zbekistonda ochilmaydi/geo-bloklangan
// — klientda DM/IG/FB embedlarning ijro-kuzatuvi YO'Q (postMessage handshake yo'q), qopqoq 1.2s'da
// ketardi va video o'ynamasa slayd BITTAQ QORA turib qolardi (skrinshot: "How to Make Perfect
// Toffee Apples, 24 · 0:38" — DM topic-qidiruvidan inglizcha video). DM = qora ekran + ingliz
// kontent — hovuzdan BATAMOM chiqarildi.
// "youtubeda millionlab shorts videolar bor — trenddagi millionlab shortslarni 50gram
// dasturga reels bo'limiga olib ko'rsatadigan qilib ishla" — YouTube TREND (FEshorts)
// lentasi OCHIQ jamoaviy kontent: akkaunt, parol yoki API-kalit KERAK EMAS.
// 2 qatlam: ① YouTube qidiruv-shorts filtr (EgIYAQ== — viral shortslar)  ② HTML shelf
// zaxirasi. YouTube akkaunt/parol/API-kalit KERAK EMAS (ochiq jamoaviy kontent).
// O'yin/jangovar kontent + Minecraft QATIY chiqariladi (foydalanuvchi: "batamom o'chir")
const GAME_RE = /minecraft|minekraf|maynkraft|минекрафт|майнкрафт|gameplay|game\s?play|gta\s?[1-6]|gta\s?online|pubg|roblox|brawl\s?stars|free\s?fire|fortnite|dota\s?2|counter\s?strike|csgo|cs2|fifa\s?\d|ea\s?fc|clash\s?(of\s?clans|royale)|among\s?us|genshin|o['ʻ‘ʼ]?yin(?!choq)|oyun\s?oyn|o['ʻ‘ʼ]?yinlash/i
function ytCount(s: string): number {
  if (!s) return 0
  const m = s.match(/([\d.,]+)\s*([KkMmBb]|mln|mlrd|ming)/)
  if (!m) { const n = parseInt(s.replace(/[^\d]/g, ""), 10); return isNaN(n) ? 0 : n }
  let n = parseFloat(m[1].replace(/,/g, ""))
  const sfx = m[2].toLowerCase()
  if (sfx === "mlrd" || sfx === "b") n *= 1e9
  else if (sfx === "mln" || sfx === "m") n *= 1e6
  else if (sfx === "ming" || sfx === "k") n *= 1e3
  return Math.round(n)
}
function ytTrendItem(id: string, title: string, views: number, img: string, uz = 0): any {
  const vid = String(id).slice(0, 11)
  return {
    id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz, src: "tr",
    title: String(title).slice(0, 140), image: img || "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
    views, duration: 0, time: now(),
    url: "https://www.youtube.com/watch?v=" + vid, cat: "video",
  }
}
// ① ASOSIY: YouTube QIDIRUV + SHORTS FILTR (innertube, params=EgIYAQ==) — "trenddagi
// millionlab shortslar" manbasi: qidiruv natijalari MILLIONLAB ko'rishli viral shortslar.
// O'ZBEKISTON BIRINCHI (foydalanuvchi talabi: "ko'proq o'zbekistondagi trendlar, o'zbeklarning
// shortslarini ko'rsatadigan qil"): har hovuz qurilishida tasodifiy 5 ta O'ZBEK mavzu
// (gl=UZ, hl=uz — YouTube o'zbekistonlik yaratuvchilarni ko'rsatadi) + 1 ta global mavzu
// (kichik ulush — xilma-xillik uchun). Akkaunt/parol/API-kalit KERAK EMAS (ochiq jamoaviy manba).
const YT_PUBKEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8" // youtube.com sahifasidagi OCHIQ kalit (maxfiy emas)
const UZ_TREND_QUERIES = [
  "o‘zbekcha shorts", "o‘zbek shorts", "o‘zbekiston shorts", "toshkent shorts", "o‘zbek komediya shorts",
  "o‘zbek qo‘shiq shorts", "o‘zbek raqs shorts", "o‘zbekcha hazil", "o‘zbek to‘y", "o‘zbek futbol shorts",
  "o‘zbekcha dubljaz", "samarqand shorts", "buxoro shorts", "o‘zbek taomlari shorts", "o‘zbekcha multfilm",
  "o‘zbek milliy", "navoiy", "o‘zbek kino shorts", "andijon shorts", "farg‘ona shorts",
]
const GLOBAL_QUERIES = ["funny shorts", "viral shorts", "satisfying shorts", "music shorts", "animals shorts", "food shorts"]
// Daraxt bo'ylab barcha shortsLockupViewModel yig'uvchi (layout o'zgarsa ham ishlaydi)
function collectShorts(o: any, out: any[]) {
  if (!o || typeof o !== "object") return
  if (Array.isArray(o)) { for (const v of o) collectShorts(v, out); return }
  const lock = o.shortsLockupViewModel
  if (lock) {
    const id = ((((lock.onTap || {}).innertubeCommand || {}).reelWatchEndpoint || {}).videoId) || ""
    const om = lock.overlayMetadata || {}
    const title = (om.primaryText || {}).content || ""
    const views = ytCount((om.secondaryText || {}).content || "")
    if (id && title && !out.some((x: any) => x.yt === id)) out.push(ytTrendItem(id, title, views, ""))
  }
  for (const k of Object.keys(o)) collectShorts(o[k], out)
}
async function ytSearchShorts(): Promise<any[]> {
  const uzQ = UZ_TREND_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 5)
  const gq = GLOBAL_QUERIES[Math.floor(Math.random() * GLOBAL_QUERIES.length)]
  const jobs = [...uzQ.map((q) => ({ q, uz: 1 })), { q: gq, uz: 0 }]
  const res = await Promise.allSettled(jobs.map(async (job) => {
    const r = await fetch("https://www.youtube.com/youtubei/v1/search?key=" + YT_PUBKEY + "&prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": TREND_UA["user-agent"],
        "x-origin": "https://www.youtube.com",
        "x-youtube-client-name": "1",
        "x-youtube-client-version": "2.20241126.01.00",
        "accept-language": job.uz ? "uz,ru" : "en",
      },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20241126.01.00", hl: job.uz ? "uz" : "en", gl: job.uz ? "UZ" : "US" } }, query: job.q, params: "EgIYAQ==" }),
      signal: AbortSignal.timeout(9000),
      cf: { cacheTtl: 1800, cacheEverything: true },
    } as any)
    if (!r.ok) { console.log("ytsearch", r.status); return [] }
    const j: any = await r.json()
    const out: any[] = []
    collectShorts(j, out)
    for (const v of out) v.uz = job.uz ? (UZ_RE.test(String(v.title || "")) ? 2 : 1) : 0 // 2=QATIY o'zbekcha sarlavha (hovuz interleave 1-daraja)
    return out
  }))
  const out: any[] = []
  for (const r of res) { if (r.status === "fulfilled") for (const v of r.value) out.push(v) }
  return out
}
// ② youtube.com/shorts HTML shelf-parser — zaxira (ba'zi holatlarda ishlaydi)
async function ytShortsShelf(): Promise<any[]> {
  const r = await fT("https://www.youtube.com/shorts", 9000, 900)
  if (!r) return []
  try {
    const h = await r.text()
    const out: any[] = []
    const seen = new Set<string>()
    for (const chunk of h.split('"shortsLockupViewModel"').slice(1)) {
      const idM = chunk.match(/"shorts-shelf-item-([\w-]{11})"/) || chunk.match(/reelsWatchEndpoint.{0,40}videoId\\?":\\?"([\w-]{11})/)
      if (!idM || seen.has(idM[1])) continue
      seen.add(idM[1])
      const tM = chunk.match(/"primaryText":\{"content":"(.*?)"/)
      const title = (tM ? tM[1] : "").replace(/\\u([\dA-Fa-f]{4})/g, (_, x) => { try { return String.fromCharCode(parseInt(x, 16)) } catch { return "" } }).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, " ").trim()
      if (!title) continue
      const vM = chunk.match(/"secondaryText":\{"content":"(.*?)"/)
      out.push(ytTrendItem(idM[1], title, ytCount(vM ? vM[1] : ""), ""))
      if (out.length >= 48) break
    }
    return out
  } catch { return [] }
}
// ASOSIY: YouTube TREND Shorts — qidiruv-shorts filtr (millionlab ko'rishli viral shortslar)
// + HTML shelf zaxirasi. Piped/Invidious TRENDING olib tashlandi (tekshirildi: 0 ta short
// qaytaradi — faqat jonli efir/uzun videolar). Ikkalasi bo'sh bo'lsa hovuz qolgan manbalar bilan.
async function ytGlobalTrend(): Promise<any[]> {
  const [search, shelf] = await Promise.all([ytSearchShorts(), ytShortsShelf()])
  const seen = new Set<string>()
  return [...search, ...shelf].filter((v: any) => v && v.yt && !BLOCK_VIDS.has(v.yt) && !GAME_RE.test(String(v.title || "")) && !seen.has(v.yt) && seen.add(v.yt))
}
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
// Dailymotion — yana bir platforma (foydalanuvchi: "insta va boshqa platformalardan ham").
// API'siz ochiq (key yo'q), sort=trending, embed player'ilova tomonda allaqachon qo'llanadi.
// HAR XIL MAVZULAR: umumiy trending (ko'pincha bir xil o'yin kontenti chiqaradi) bilan birga
// har safar TASODIFIY 6 ta mavzu bo'yicha qidiruv — hovuz har yangilanishida boshqa mavzular
// (musiqa, oshpazlik, futbol, tabiat...) — "faqat bir turdagi videolar" muammosining yechimi.
const DM_TOPICS = ["music", "dance", "cooking", "football", "animals", "nature", "travel", "cars", "comedy", "science", "art", "fitness", "magic", "fishing", "camping", "cats", "dogs", "satisfying", "adventure", "food", "basketball", "surfing", "parkour", "drone", "timelapse", "wildlife", "space", "ocean"]
function dmPick(): Promise<any[]> {
  const topics = DM_TOPICS.slice().sort(() => Math.random() - 0.5).slice(0, 6)
  return Promise.all(topics.map(async (t) => {
    const r = await fT("https://api.dailymotion.com/videos?fields=id,title,duration,views_total,thumbnail_360_url,created_time&search=" + encodeURIComponent(t) + "&sort=trending&limit=14&shorter_than=5", 7000, 900)
    if (!r) return []
    try {
      const j: any = await r.json()
      return ((j.list || []) as any[]).map((v: any) => {
        const dur = +v.duration || 0
        if (!v.id || !v.title || dur < 3 || dur > 180) return null
        return {
          id: "dm" + String(v.id), kind: "short", vid: "dm", embed: String(v.id), uz: 0, src: "dm:" + t,
          title: String(v.title), image: String(v.thumbnail_360_url || ""),
          views: +v.views_total || 0, duration: dur,
          time: +v.created_time > 0 ? +v.created_time * 1000 : now(),
          url: "https://www.dailymotion.com/video/" + v.id, cat: "video",
        }
      }).filter(Boolean)
    } catch { return [] }
  })).then((a) => a.flat())
}
async function dmTrending(): Promise<any[]> {
  const [gen, topics] = await Promise.all([dmTrendingGeneral(), dmPick()])
  const seen = new Set<string>()
  const out: any[] = []
  for (const v of [...topics, ...gen]) { if (v && v.embed && !seen.has(v.embed)) { seen.add(v.embed); out.push(v) } } // mavzular birinchi — xilma-xillik kafolatlangan
  return out
}
async function dmTrendingGeneral(): Promise<any[]> {
  const r = await fT("https://api.dailymotion.com/videos?fields=id,title,duration,views_total,thumbnail_360_url,created_time&sort=trending&limit=24&shorter_than=5", 7000, 900)
  if (!r) return []
  try {
    const j: any = await r.json()
    return ((j.list || []) as any[]).map((v: any) => {
      const dur = +v.duration || 0
      if (!v.id || !v.title || dur < 3 || dur > 180) return null
      return {
        id: "dm" + String(v.id), kind: "short", vid: "dm", embed: String(v.id), uz: 0, src: "dm",
        title: String(v.title), image: String(v.thumbnail_360_url || ""),
        views: +v.views_total || 0, duration: dur,
        time: +v.created_time > 0 ? +v.created_time * 1000 : now(),
        url: "https://www.dailymotion.com/video/" + v.id, cat: "video",
      }
    }).filter(Boolean)
  } catch { return [] }
}
// Mixkit OLIB TASHLANDI (2026-10): stock videolar OVOZSIZ chiqardi — foydalanuvchi shikoyati
// ("mushuk ovozi yo'q reels videolarni juda ko'p ko'rsatmoqda"). Ovozsiz kontent hovuzga kirmasin.
async function buildVideoPool(env: Env): Promise<{ shorts: any[]; vids: any[] }> {
  // KO'P PLATFORMALI AQILLI HOVUZ (foydalanuvchi: "juda ko'p joylardan olish, faqat youtube emas"):
  // ① YOUTUBE GLOBAL TREND SHORTS (foydalanuvchi talabi: "trenddagi millionlab shortslarni
  //    reels bo'limiga olib ko'rsat" — hovuzning ASOSIY manbasi endi shu)
  // ② FOYDALANUVCHI MANBALARI (mahfiy: o'z YT shorts + IG reels/rasmlari — algoritm bilan kuchli ko'rinadi)
  // ③ YouTube kanallar (round-robin) ④ YouTube qidiruv ⑤ Dailymotion (tasodifiy mavzular)
  // Mixkit OLIB TASHLANDI: stock videolar OVOZSIZ — foydalanuvchi "mushuk ovozi yo'q reels juda ko'p" dedi.
  // Har qadamda BOSHQA platformadan — platforma round-robin, hech biri hukmronlik qilmaydi.
  const [tr0, chan0, uz0, mine] = await Promise.all([ytGlobalTrend(), uzChannelShorts(), uzSearch(), minePool(env)]) // DM olib tashlandi (qora ekran — yuqoridagi izohga qarang)
  // MINECRAFT QATIY FILTR (foydalanuvchi: "tagi bilan o'chirib yo'q qilib tashla"): Minecraft/
  // Maynkraft/Майнкрафт videolari hovuzga UMUMAN kirmasin — Anilan-dublaj kanallari yangi
  // videolari asosan Minecraft bo'lgani uchun sarlavha bo'yicha qat'iy kesiladi (latin+kirill).
  const BAD_RE = /minecraft|minekraf|maynkraft|минекрафт|майнкрафт/i
  // Sarlavha-filtri + VIDEO-ID blok: sarlavhasida "minecraft" yozilmagan o'yin videolari ham
  // (Anilan dublaj uslubi) ID bo'yicha kesiladi — foydalanuvchi "batamom o'chir" dedi.
  const noBad = (arr: any[]) => (arr || []).filter((v: any) => v && !BAD_RE.test(String(v.title || "")) && !BLOCK_VIDS.has(String(v.yt || "")) && !GAME_RE.test(String(v.title || "")))
  const tr = noBad(tr0), chan = noBad(chan0), uz = noBad(uz0)
  // Foydalanuvchi manbalari: yaroqli vidyo (yt/mp4) va rasmlar (img) — dedupe, BOMBA-reklama yo'q
  const mm: any[] = []
  const mseen = new Set<string>()
  for (const v of mine || []) { const k = String(v?.id || ""); if (k && (v.yt || v.mp4 || v.img) && !mseen.has(k)) { mseen.add(k); mm.push(v) } }
  const seen = new Set<string>()
  const chRaw = chan.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt))
  // KANALLAR ROUND-ROBIN + kanal bo'yicha cheklov (3): bir kanal (masalan Minecraft-dublaj
  // kanallari) hovuzni bosib olmasligi kerak — aks holda foydalanuvchiga DOIM bir turdagi
  // video chiqadi ("faqat minecraft" shikoyati). Har qadamda BOSHQA kanal video qo'shiladi.
  const byCh = new Map<string, any[]>()
  for (const v of chRaw) { const k = String(v.chid || "?"); if (!byCh.has(k)) byCh.set(k, []); byCh.get(k)!.push(v) }
  for (const [k, arr] of byCh) byCh.set(k, arr.sort((a: any, b: any) => (b.time || 0) - (a.time || 0)))
  const ch: any[] = []
  const curs = new Map([...byCh.keys()].map((k) => [k, 0] as [string, number]))
  const perCh = new Map([...byCh.keys()].map((k) => [k, 0] as [string, number]))
  while (true) {
    let added = false
    for (const k of byCh.keys()) {
      const arr = byCh.get(k)!, i = curs.get(k)!
      if (i >= arr.length || perCh.get(k)! >= 2) continue // 2: bir kanal ko'p joy olmasin (Minecraft-dublaj kanallari)
      ch.push(arr[i]); curs.set(k, i + 1); perCh.set(k, perCh.get(k)! + 1); added = true
    }
    if (!added) break
  }
  // QOLGAN trend itemlar kanal/qidiruv dedupesidan KEYIN (hovuzni to'ldiradi)
  const tr2 = tr.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt))
  const se = uz.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt)).sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
  // Mine itemlar umumiy hovuz bilan ham kesishadi (foydalanuvchi kanali RSS'da ham bo'lsa — takror slot yo'q)
  const mmo = mm.filter((v: any) => !v.yt || !seen.has(v.yt))
  // O'ZBEKISTON-BIRINCHI INTERLEAVE (foydalanuvchi talabi: "ko'proq o'zbekistondagi trendlar,
  // o'zbeklarning shortslarini ko'rsatadigan qil"): UZ kontenti FAQAT hovuz boshida emas — BUTUN
  // hovuz bo'ylab ~3:1 nisbatda aralashtiriladi. NO-REPEAT rb-bucket hovuzning istalgan chuqur
  // qismini olibdi (rb*37 offseti 1073 gacha) — AVVAL chuqur oynalar TO'LIQ inglizcha chiqardi
  // ("2 ta video ko'rsatib 3-chisi inglizcha/qora" shikoyati shu tufayli edi). Endi istalgan
  // 12-lik oynada ~75% o'zbek kontenti bor.
  // uz=2 (QATIY o'zbekcha sarlavha) → uzA; uz=1 (UZ qidiruvidan, sarlavha chetkiy bo'lishi mumkin) → uzB; uz=0 → global.
  const uzA: any[] = [], uzB: any[] = [], glT: any[] = []
  for (const v of tr2) { const u = v.uz || 0; if (u === 2) uzA.push(v); else if (u === 1) uzB.push(v); else glT.push(v) }
  const mkCur = (arr: any[]) => { let i = 0; return (): any => (i < arr.length ? arr[i++] : null) }
  const cA = mkCur(uzA), cB = mkCur(uzB), cG = mkCur(glT), cM = mkCur(mmo), cC = mkCur(ch), cS = mkCur(se)
  // UZ manbalar tugasa — global zaxira (lenta hech qachon to'xtamasin)
  const uzNext = (): any => cA() || cB() || cG()
  const shorts: any[] = []
  while (shorts.length < 240) {
    let added = 0
    // 1 tsikl = 8 slayd: uzTrend + uzQidiruv + kanal + foydalanuvchi + uzTrend + foydalanuvchi + global + global
    // → 4-6 o'zbek-mansabli + 2 global (foydalanuvchi manbalari ham o'zbek kanali — amalda ~75% UZ)
    for (const src of [uzNext, cS, cC, cM, uzNext, cM, cG, cG]) { const v = src(); if (v) { shorts.push(v); added++ } }
    if (!added) break
  }
  return { shorts: shorts.slice(0, 240), vids: [] }
}
async function videoPool(c: C): Promise<{ shorts: any[]; vids: any[] }> {
  // v18: trend manba = qidiruv-shorts filtr (haqiqiy viral shortslar) — eski hovuz bekor —
  // eski hovuz (v16, trendsiz) BATAMOM bekor, yangi kesh kaliti
  // v19: O'ZBEKISTON-BIRINCHI hovuz (o'zbek qidiruv gl=UZ + uz-first sort) — eski (inglizcha-og'ir) hovuz bekor
  // v20: DM OLIB TASHLANDI (O'zbekistonda qora ekran) + UZ-interleave BUTUN hovuz bo'ylab (~75% o'zbek kontenti
  // istalgan oynada) + uz=2 qat'iy o'zbekcha-belgi — eski (DM'li/orqada-uz) hovuz BATAMOM bekor
  const ck = "https://trend.50gram.internal/poolv20"
  const meta = await cacheGetJSON<{ shorts: any[]; vids: any[] }>(ck)
  if (meta && meta.data && meta.data.shorts?.length) {
    if (now() - meta.t < POOL_FRESH_MS) return meta.data
    c.wait(buildVideoPool(c.env).then((d) => { if (d.shorts.length) return cachePutJSON(ck, { t: now(), data: d }) }).catch(() => {}))
    return meta.data
  }
  const d = await buildVideoPool(c.env)
  if (d.shorts.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
async function newsPool(c: C): Promise<any[]> {
  // Barcha manbalar PARALLEL yuklanadi + stale-while-revalidate: eski pool DARHOL qaytadi (sovuq sahifa ham tez)
  // ARXIV: yangilashda avvalgi generatsiya poolN4old'ga ko'chiriladi — maqola o'qishda eski id'lar ham topiladi
  const ck = "https://trend.50gram.internal/poolN4"
  const meta = await cacheGetJSON<any[]>(ck)
  if (meta && meta.data?.length) {
    if (now() - meta.t < 15 * 60 * 1000) return meta.data
    c.wait(Promise.all([
      cachePutJSON("https://trend.50gram.internal/poolN4old", { t: meta.t, data: meta.data }),
      buildNewsPool().then((d) => { if (d.length) return cachePutJSON(ck, { t: now(), data: d }) }),
    ]).catch(() => {}))
    return meta.data
  }
  const d = await buildNewsPool()
  if (d.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
// Maqola o'qish uchun: id bo'yicha item (joriy pool → arxiv pool). URL FAQAT serverda qoladi —
// klient hech qachon manba saytni ko'rmaydi/bilmaydi (foydalanuvchi talabi: manba SIR saqlansin).
// id trend() bilan BIR XIL formuladan hisoblanadi: sha256(native_id || url || title).slice(0,12)
async function newsItemById(c: C, id: string): Promise<any | null> {
  for (const key of ["https://trend.50gram.internal/poolN4", "https://trend.50gram.internal/poolN4old"]) {
    const meta = await cacheGetJSON<any[]>(key)
    for (const x of meta?.data || []) {
      if (!x || x.kind !== "news" || !x.url) continue
      const iid = (await sha256(x.id || x.url || x.title || String(x.time))).slice(0, 12)
      if (iid === id) return x
    }
  }
  return null
}
// Maqola matnini HTML'dan ajratish (readability-lite): script/style/nav/footer/aside tozalanadi,
// <article>/<main> bloki afzal ko'riladi, <p> paragraflar yig'iladi — MANBA NOMI HECH QANDAY SHAKLDA QAYTMAYDI
function extractArticle(html: string): { paras: string[]; image: string; title: string } {
  // og:image/og:title avval, RAW html'dan olinadi (keyin meta teglar tozalanadi)
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  const image = og ? decodeEnt(og[1]) : ""
  const tMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = tMatch ? stripHtml(tMatch[1]) : ""
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|svg|form|nav|header|footer|aside|button|select|video|audio)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|noscript|iframe|svg|form|link|meta)[^>]*\/?>/gi, " ")
  const art = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i)
  if (art) h = art[0]
  // Sayt qoldiqlari (mualliflik, obuna, texnik yordam) — HECH QACHON o'qilmaydi (manba nomi shu yerda yashiringan)
  const JUNK_RE = /(barcha huquqlar|huquqlar himoyalangan|yozma roz|saytdagi xabarlar|rozlilik|roziligi|xato topdingizmi|xatingizni oldik|to['’‘ʼ]g['’‘ʼ]irlaymiz|ro['’‘ʼ]yxatdan o['’‘ʼ]t(ing|ish)|ctrl\+enter|copyright|©|ijro etuvchi|tizimli xabar|shu sayt|bizning sayt)/i
  const raw: string[] = []
  const pm = h.matchAll(/<p[\s>][\s\S]*?<\/p\s*>/gi)
  for (const m of pm) {
    let t = stripHtml(m[0].replace(/<br\s*\/?>/gi, " "))
    // Havola-qatorlar / obuna / manba eslatmalari / juda qisqa bo'laklar — tashlanadi
    if (t.length < 35) continue
    if (/(obuna bo|telegram|instagram|facebook|youtube|@[\w_]{4,}|https?:\/\/|www\.|manba:|izohlan|ko'rishlar soni|reklama|\d{1,2}:\d{2}$)/i.test(t)) continue
    if (/^[\s\d.,:;!?%()'"«»\-—+]+$/.test(t)) continue
    if (JUNK_RE.test(t)) continue
    // MANBA SIRI: matn ichida manba sayt nomi uchrasa ham tozalanadi (kun.uz, daryo.uz, BBC...)
    t = t.replace(/\b(kun\s?\.?\s?uz|daryo\s?\.?\s?uz|gazeta\s?\.?\s?uz|spot\s?\.?\s?uz|nuz\s?\.?\s?uz|bbc|ббс)\b/gi, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim()
    if (t.length < 30) continue
    t = t.replace(/\s+/g, " ").trim()
    if (raw.length && raw[raw.length - 1] === t) continue
    raw.push(t)
    if (raw.length >= 130) break
  }
  // Juda oz chiqsa — bo'sag'ichni pasaytirib qayta urinish
  if (raw.length < 3) {
    for (const m of h.matchAll(/<p[\s>][\s\S]*?<\/p\s*>/gi)) {
      const t = stripHtml(m[0])
      if (t.length >= 18 && !raw.includes(t)) raw.push(t)
      if (raw.length >= 60) break
    }
  }
  return { paras: raw.slice(0, 130).map((p) => p.slice(0, 1200)), image, title: title.slice(0, 200) }
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
// YANGILIQ TO'LIQ O'QISH (Task 47): maqola matni SERVERDA olinadi va faqat paragraflar
// qaytariladi — manba sayt nomi/URL/havolasi klientga UMUMAN bormaydi (foydalanuvchi talabi:
// "to'liq o'qish" ilovada, manba SIR). id faqat hovuzdagi itemlarga mos keladi (SSRF xavfsiz).
async function trendArticle(c: C) {
  const id = str(c.url.searchParams.get("id") || "", 48)
  if (!id) fail("id kerak")
  const ck = "https://art.50gram.internal/a2/" + id
  const hit = await cacheGetJSON<any>(ck)
  if (hit && hit.data?.paras?.length) return json({ ...hit.data, cached: true })
  const item = await newsItemById(c, id)
  if (!item?.url) fail("Yangilik topilmadi — lentani yangilang", 404)
  let out: any
  try {
    const r = await fetch(item.url, { headers: TREND_UA, signal: AbortSignal.timeout(9000), cf: { cacheTtl: 1800, cacheEverything: true } } as any)
    if (!r.ok) fail("Yangilik yuklanmadi", 502)
    const html = await r.text()
    const ex = extractArticle(html)
    const paras = ex.paras.length >= 2 ? ex.paras : [item.snippet || item.title].filter(Boolean)
    const words = paras.join(" ").split(/\s+/).length
    out = {
      ok: true, id, kind: "news",
      title: item.title || ex.title || "",
      image: item.image || ex.image || "",
      paras, mins: Math.max(1, Math.round(words / 170)),
      time: item.time || now(),
      cat: item.cat || "uz",
    }
  } catch (e: any) {
    // Sayt ochilmasa — kamida sarlavha + qisqa mazmun bilan o'qib bo'ladi
    if (item.snippet || item.title) {
      out = { ok: true, id, kind: "news", title: item.title || "", image: item.image || "", paras: [item.snippet || item.title], mins: 1, time: item.time || now(), cat: item.cat || "uz", lite: true }
    } else fail("Yangilik yuklanmadi — keyinroq urinib ko'ring", 502)
  }
  if (out.paras?.length) { try { await cachePutJSON(ck, { t: now(), data: out }) } catch {} ; return json(out) }
  return json(out)
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
// QORA EKRAN ILDIZ-FILTRI (foydalanuvchi: "inglizcha sarlavhali shortslar qora ekran bo'lib
// ishlamaydi"): embed-qilib bo'lmaydigan YT videolari (UMG musiqalari, maxfiy/o'chirilgan,
// mintaqa-blokgan) iframe'da HECH QACHON o'ynamaydi — qora ekran. YouTube oEmbed video
// embedga yaroqsiz bo'lsa 401/404 qaytaradi — shu xususiyatdan foydalaniladi.
// Natija 24 SOAT keshlanadi — bir xil video har so'rovda qayta tekshirilmaydi (tezlik).
async function ytEmbedOk(id: string): Promise<boolean> {
  const ck = "https://trend.50gram.internal/emd1/" + id
  try {
    const hit = await caches.default.match(ck)
    if (hit) return (await hit.text()) === "1"
  } catch {}
  let ok = true
  try {
    const r = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id) + "&format=json", { signal: AbortSignal.timeout(3500) })
    ok = r.ok // 200=yaroqli, 401/403/404=embed taqiqlangan/o'chirilgan — QORA EKRAN bo'ladi
  } catch {} // tarmoq xatosida video ayblamasin (klient watchdog + onError baribir himoyalaydi)
  try { await caches.default.put(ck, new Response(ok ? "1" : "0", { headers: { "cache-control": "public, max-age=86400" } })) } catch {}
  return ok
}
async function trend(c: C) {
  const page = Math.max(1, Math.min(40, +(c.url.searchParams.get("page") || 1)))
  const onlyCat = str(c.url.searchParams.get("cat") || "", 20)
  const catsW = str(c.url.searchParams.get("cats") || "", 200) // foydalanuvchi qiziqishlari: "sport:5,tech:3"
  // t17: HAR KIRISHDA BOSHQA SHORTSLAR (foydalanuvchi talabi: "har safar kirganda boshqa shortslar
  // ko'rsatsin — takror zerikarli"): klient tasodifiy rb-bucket (0..29) yuboradi, server hovuzning
  // HAR XIL qismidan qaytaradi. Eski t16 keshlari (bir xil pool[0..12] har kirishda) bekor.
  const rb = Math.max(0, Math.min(29, +(c.url.searchParams.get("rb") || 0) || 0))
  // t18: UZ-interleave + DM olib tashlangan hovuz — eski t17 javoblari (DM'li, chuqur sahifalari ingliz) darhal o'lsin
  const cacheKey = "https://trend.50gram.internal/t18?p=" + page + "&cat=" + onlyCat + (onlyCat === "video" ? "&rb=" + rb : "")
  try {
    const hit = await caches.default.match(cacheKey)
    if (hit) return new Response(hit.body, hit)
  } catch {}
  let items: any[] = []
  if (onlyCat === "video") {
    // Video: FAQAT haqiqiy Shorts (uzun videolar va jonli efirlar sekin/qotadi — foydalanuvchi talabi)
    const vp = await videoPool(c)
    const all = vp.shorts
    // RB-BUCKET (foydalanuvchi talabi: "har safar kirganda boshqa shortslar"): rb*37 ofset
    // hovuzning boshqa-boshqa qismini oladi + sahifa ichida Fisher-Yates — har kirishda boshqa
    // 12 ta short, boshqa tartib. rb=0 (Trend bo'limi) eski tartibda qoladi.
    const s0 = (((page - 1) * 12) + rb * 37) % Math.max(1, all.length)
    items = all.slice(s0, s0 + 12)
    if (items.length < 12 && all.length) items.push(...all.slice(0, 12 - items.length))
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[items[i], items[j]] = [items[j], items[i]] }
    // QORA EKRAN ILDIZ-FILTRI (foydalanuvchi: "inglizcha videolar qora ekran bo'lib ko'rsatmayapti"):
    // embed-yaroqsiz YT videolar olib tashlanadi — o'rniga hovuzdan TEKSHIRILGAN yaroqli video
    // qo'yiladi. Ko'pi 6 ta almashtirish-tekshiruvi (subrequest limiti xavfsizligi uchun).
    // Keshlanganida 0 ta so'rov — tezlik umuman ta'sir qilmaydi.
    const badSet = new Set<string>()
    const yids = [...new Set(items.filter((x: any) => x.vid === "yt" && x.yt).map((x: any) => String(x.yt)))]
    if (yids.length) {
      await Promise.all(yids.map(async (id) => { if (!(await ytEmbedOk(id))) badSet.add(id) }))
      if (badSet.size) {
        const repl: any[] = []
        for (let i = 0; i < all.length && repl.length < Math.min(6, badSet.size); i++) {
          const cand: any = all[(s0 + 12 + i) % all.length]
          if (!cand || cand.vid !== "yt" || !cand.yt || badSet.has(String(cand.yt)) || items.some((x: any) => x.yt === cand.yt) || repl.some((x: any) => x.yt === cand.yt)) continue
          if (await ytEmbedOk(cand.yt)) repl.push(cand)
        }
        let ri = 0
        items = items.map((x: any) => (x.vid === "yt" && badSet.has(String(x.yt)) && ri < repl.length) ? repl[ri++] : x)
        items = items.filter((x: any) => x && !(x.vid === "yt" && badSet.has(String(x.yt))))
      }
    }
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
      // HAR YANGILASHDA BOSHQA TARTIB (Fisher-Yates): foydalanuvchi "yangiliklar yangilansin" —
      // har pool qayta qurilganda sahifa tartibi ham o'zgaradi, bir xillik yo'q
      for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[picked[i], picked[j]] = [picked[j], picked[i]] }
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
  items = items.filter((x) => x && (x.title || x.img)) // img-slidelar sarlavhasiz ham keladi
  // ID: manba-native id'dan (yt id/dm id/mk id — yuqorida berilgan) — URL EMAS!
  // AVVAL id=sha256(url) edi: Mixkit bir kategoriyadagi 4-10 video BIR XIL URL'ga ega —
  // hamma BIR XIL id chiqarardi → klient dedupe ularni tushirardi → hovuz 5-6 tagacha
  // qisqarardi → lenta "5-6 tadan keyin qotib qolmoqda" (asosiy ildiz sabab shu edi!)
  for (const x of items) x.id = (await sha256(x.id || x.url || x.title || String(x.time))).slice(0, 12)
  // MANBA SIRI (foydalanuvchi talabi): QATIY — HAMMA itemdan URL/manba/chid O'CHIRILADI.
  // Klient hech qachon qaysi platformadan (YT/IG/DM) olinganini bilmasligi kerak.
  for (const x of items) { delete x.url; delete x.src; delete x.chid; delete x.audio }
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
  // QORA EKRAN HIMoyasi: media fayli serverdan tozalangan (gone/dropped) YUKI to'liq
  // yuklanmagan postlar QAYTARILMAYDI — ular hech qachon o'ynamaydi, faqat qora karta bo'lardi
  // (media "Xotira posboni" tomonidan bo'shatilgan eski postlar shu tufayli qora turardi).
  const rows = await c.db.q(
    `SELECT p.* FROM posts p LEFT JOIN chats ch ON ch.id=p.chat_id
     JOIN media m ON m.id=p.media_id AND m.complete=1 AND m.gone=0 AND m.dropped=0
     WHERE p.media_kind='video' AND p.id<? AND (p.chat_id=0 OR ch.is_public=1 OR p.chat_id IN (${ph(myList)}))
     ORDER BY p.id DESC LIMIT 10`,
    [before, ...myList],
  )
  const blocked = new Set((await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=? UNION SELECT blocked_id AS user_id FROM blocks WHERE user_id=?", [c.uid, c.uid])).map((r) => r.user_id))
  const list = rows.filter((r) => !blocked.has(r.author_id))
  if (list.length) await c.db.run(`UPDATE posts SET views=views+1 WHERE id IN (${ph(list.map((x) => x.id))})`, list.map((x) => x.id))
  return json(await postsOut(c, list))
}
// Task 39: izohlar — ildiz + javoblar (chuqurlik 1, Telegram uslubi), reaksiyalar, stiker izohlar
const REACT_EMOJIS = ["❤️", "👍", "🔥", "😮", "😂", "🥰", "👏", "😢"]
async function listComments(c: C) {
  await ensureSchema(c.db) // yangi ustunlar (parent_id/sticker) mavjudligini kafolatlash
  const rows = await c.db.q("SELECT id,parent_id,user_id,text_body,sticker,created_at FROM post_comments WHERE post_id=? ORDER BY id LIMIT 300", [+c.p.id])
  const um = await usersByIds(c, [...new Set(rows.map((r) => r.user_id))])
  const agg = new Map<number, any[]>(), mine = new Set<string>()
  const ids = rows.map((r) => r.id as number)
  if (ids.length) {
    const rg = await c.db.q(`SELECT comment_id,emoji,COUNT(*) AS n FROM comment_reacts WHERE comment_id IN (${ph(ids)}) GROUP BY comment_id,emoji`, ids).catch((): any[] => [])
    for (const r of rg) { const a = agg.get(Number(r.comment_id)) || []; a.push({ emoji: r.emoji, n: Number(r.n), mine: false }); agg.set(Number(r.comment_id), a) }
    const mr = await c.db.q(`SELECT comment_id,emoji FROM comment_reacts WHERE user_id=? AND comment_id IN (${ph(ids)})`, [c.uid, ...ids]).catch((): any[] => [])
    for (const r of mr) mine.add(Number(r.comment_id) + "\u0000" + String(r.emoji))
    for (const [cid, a] of agg) for (const x of a) if (mine.has(cid + "\u0000" + x.emoji)) x.mine = true
  }
  const nodes = rows.map((r) => ({ id: r.id, parent_id: Number(r.parent_id || 0), text_body: r.text_body || "", sticker: r.sticker || "", created_at: r.created_at, user: um.get(r.user_id) || null, mine: r.user_id === c.uid, reacts: agg.get(r.id) || [], reply_count: 0, replies: [] as any[] }))
  const map = new Map(nodes.map((n) => [n.id, n]))
  const roots: any[] = []
  for (const n of nodes) { if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.replies.push(n); else roots.push(n) }
  for (const r of roots) r.reply_count = r.replies.length
  return json({ roots, total: rows.length, emojis: REACT_EMOJIS })
}
async function addComment(c: C) {
  await ensureSchema(c.db)
  const text = str(c.b.text_body, 1000)
  const sticker = str(c.b.sticker, 64)
  if (!text && !sticker) fail("Izoh bo‘sh")
  let parentId = Math.max(0, +c.b.parent_id || 0)
  const p = await c.db.one("SELECT id,author_id,chat_id FROM posts WHERE id=?", [+c.p.id])
  if (!p) fail("Post topilmadi", 404)
  if (p.chat_id) { const ch = await needChat(c, p.chat_id); if (!parse(ch.settings, DEF_SET).comments) fail("Izohlar o‘chirilgan") }
  let parent: any = null
  if (parentId) {
    parent = await c.db.one("SELECT id,parent_id,user_id FROM post_comments WHERE id=? AND post_id=?", [parentId, +c.p.id])
    if (!parent) fail("Javob beriladigan izoh topilmadi", 404)
    if (+parent.parent_id) parentId = +parent.parent_id // javob javobga — ildiz ostiga (chuqurlik 1)
  }
  const id = newId(), t = now()
  await c.db.run("INSERT INTO post_comments(id,post_id,parent_id,user_id,text_body,sticker,created_at) VALUES(?,?,?,?,?,?,?)", [id, +c.p.id, parentId, c.uid, text, sticker, t])
  await c.db.run("UPDATE posts SET comment_count=comment_count+1 WHERE id=?", [+c.p.id])
  const target = parent ? +parent.user_id : +p.author_id
  if (target && target !== c.uid) c.wait(notify(c.env, [target], { type: "comment", post_id: +c.p.id, comment_id: id, reply: !!parent }))
  const um = await usersByIds(c, [c.uid])
  return json({ id, parent_id: parentId, text_body: text, sticker, created_at: t, user: um.get(c.uid) || null, mine: true, reacts: [], reply_count: 0, replies: [] })
}
// Izohga emoji-reaksiya qo‘yish/olib tashlash (toggle)
async function reactComment(c: C) {
  await ensureSchema(c.db)
  const id = +c.p.id
  const emoji = str(c.b.emoji, 8)
  if (!REACT_EMOJIS.includes(emoji)) fail("Emoji qo‘llanmaydi")
  const row = await c.db.one("SELECT id FROM post_comments WHERE id=?", [id])
  if (!row) fail("Izoh topilmadi", 404)
  const ex = await c.db.one("SELECT 1 AS x FROM comment_reacts WHERE comment_id=? AND user_id=? AND emoji=?", [id, c.uid, emoji])
  if (ex) await c.db.run("DELETE FROM comment_reacts WHERE comment_id=? AND user_id=? AND emoji=?", [id, c.uid, emoji])
  else await c.db.run("INSERT INTO comment_reacts(comment_id,user_id,emoji,created_at) VALUES(?,?,?,?)", [id, c.uid, emoji, now()])
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM comment_reacts WHERE comment_id=? AND emoji=?", [id, emoji])
  return json({ on: !ex, emoji, n: Number(n?.cnt || 0) })
}
// Izohni o'chirish: muallif, post egasi yoki kanal admini (javoblari bilan birga)
async function deleteComment(c: C) {
  await ensureSchema(c.db)
  const row = await c.db.one("SELECT id,user_id,post_id FROM post_comments WHERE id=?", [+c.p.id])
  if (!row) fail("Izoh topilmadi", 404)
  const p = await c.db.one("SELECT author_id,chat_id FROM posts WHERE id=?", [+row.post_id])
  let can = row.user_id === c.uid || !!(p && +p.author_id === c.uid)
  if (!can && p && +p.chat_id > 0) {
    const m = await c.db.one("SELECT role FROM chat_members WHERE chat_id=? AND user_id=?", [+p.chat_id, c.uid])
    can = !!m && ["owner", "admin"].includes(String(m.role))
  }
  if (!can) fail("Ruxsat yo‘q", 403)
  await c.db.run(`DELETE FROM comment_reacts WHERE comment_id IN (SELECT id FROM post_comments WHERE id=? OR parent_id=?)`, [row.id, row.id]).catch(() => {})
  const cnt = await c.db.one("SELECT COUNT(*) AS cnt FROM post_comments WHERE id=? OR parent_id=?", [row.id, row.id])
  await c.db.run("DELETE FROM post_comments WHERE id=? OR parent_id=?", [row.id, row.id])
  await c.db.run("UPDATE posts SET comment_count=GREATEST(0,comment_count-?) WHERE id=?", [Number(cnt?.cnt || 1), +row.post_id])
  return json({ ok: true })
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
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json({
    comments: rows.map((r) => ({ id: r.id, user_id: r.user_id, body: r.body, created_at: r.created_at, mine: r.user_id === c.uid, can_del: r.user_id === c.uid || adm })),
    users: Object.fromEntries(um),
    count: rows.length,
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
  // last_seen + token_exp (sliding sessiya): faol qurilma sessiyasini hech qachon o'chirib qo'ymaydi
  await c.db.run("UPDATE users SET last_seen=?, token_exp=? WHERE id=?", [t, t + 180 * 86400 * 1000, c.uid])
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
  ["POST", "/auth/logout", authLogout],
  ["GET", "/avatar/u/:id", (c) => avatar(c, "users"), true],
  ["GET", "/avatar/c/:id", (c) => avatar(c, "chats"), true],
  ["GET", "/health", async () => json({ ok: true, app: "50 Gram" }), true],
  ["GET", "/me", getMe],
  ["PATCH", "/me", patchMe],
  ["POST", "/ping", async (c) => { const t = now(); await c.db.run("UPDATE users SET last_seen=?, token_exp=? WHERE id=?", [t, t + 180 * 86400 * 1000, c.uid]); return json({ ok: true, now: t }) }],
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
  ["DELETE", "/chats/:id/messages", clearChat],
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
  ["GET", "/trend/article", trendArticle],
  ["POST", "/trend/ev", trendEv],
  ["GET", "/trend/insights", trendInsights],
  ["POST", "/posts", createPost],
  ["DELETE", "/posts/:id", deletePost],
  ["POST", "/posts/:id/like", likePost],
  ["GET", "/posts/:id/comments", listComments],
  ["POST", "/posts/:id/comments", addComment],
  ["POST", "/comments/:id/react", reactComment],
  ["DELETE", "/comments/:id", deleteComment],
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
  // VAQTINCHA test vositalari O'CHIRILDI (xavfsizlik): /adm/*, /trend/trdbg, /trend/srcdbg —
  // endi bu yo'llar firewall TRAP hisoblanadi (urinish = 30 kun blok)
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
  // TiDB XOTIRA POSBONI (Task 39): server — faqat ko'prik. Asosiy xotira — foydalanuvchilar
  // qurilmalari (planReplicas kamida 15 nusxa yig'adi, P2P o'rgimchak to'ri yetkazadi).
  // Serverdagi shifrlangan media keshi chegaradan oshsa — eng eski va kamida 2 ta qurilmada
  // ishonchli nusxasi bor fayllar serverdan bo'shatiladi (dropped=1 → chunklar sweep'da o'chadi).
  // Keyin ham fayl qurilmalar orasidan topiladi; server joyi abadiy o'smaydi.
  try {
    const MEDIA_KEEP_BYTES = 2.5 * 1024 * 1024 * 1024 // ~2.5 GB — TiDB bepul limit xavfsiz zonasida
    const msz = await db.one("SELECT COALESCE(SUM(size),0) AS n FROM media WHERE dropped=0 AND gone=0 AND keep=1")
    if (Number(msz?.n || 0) > MEDIA_KEEP_BYTES) {
      const cands = await db.q("SELECT id FROM media WHERE dropped=0 AND gone=0 AND keep=1 AND replicas>=2 ORDER BY created_at LIMIT 100")
      if (cands.length) {
        const ids = cands.map((x) => x.id)
        await db.run(`UPDATE media SET dropped=1 WHERE id IN (${ph(ids)})`, ids)
        console.log("Xotira posboni:", ids.length, "fayl serverdan bo'shatildi (nusxalari qurilmalarda)")
      }
    }
  } catch (e) { console.log("Xotira posboni xatosi", String(e)) }
}

// 4xx skaner nazorati — chegara oshsa true (blok) qaytaradi
function fw4xx(env: Env, wait: (p: Promise<unknown>) => void, ip: string) {
  const e = FW_4XX.get(ip), t = Date.now()
  if (!e || t - e.t > 600_000) { if (FW_4XX.size > 5000) FW_4XX.clear(); FW_4XX.set(ip, { n: 1, t }); return false }
  if (++e.n <= 100) return false
  FW_4XX.delete(ip)
  fwLBlok(ip, 30 * 60_000)
  fwOchko(env, wait, ip, "scan", 3)
  return true
}
export default {
  async fetch(req: Request, env: Env, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url)
    // APK: majburiy yuklab olish (attachment) — ba'zi brauzerlar download atributiga
    // e'tibor bermaydi yoki faylni ochishga harakat qiladi; sarlavha buni hal qiladi
    if (url.pathname === "/50gram.apk") {
      const asset = await env.ASSETS!.fetch(new Request(url.toString(), { method: "GET" }))
      const h = new Headers(asset.headers)
      h.set("Content-Disposition", 'attachment; filename="50gram.apk"')
      h.set("Cache-Control", "public, max-age=3600")
      for (const [k, v] of Object.entries(SEC_H)) h.set(k, v)
      return new Response(asset.body, { status: asset.status, headers: h })
    }
    // index.html: HAR SAFAR qayta tasdiqlansin — APK WebView va brauzer hech qachon eski
    // qobiqni (masalan TEST rejimi bannerisiz nusxani) xotirasidan qaytarmasin (Task 39)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS!.fetch(new Request(url.toString(), { method: "GET" }))
      const h = new Headers(asset.headers)
      h.set("Cache-Control", "no-cache, must-revalidate")
      for (const [k, v] of Object.entries(SEC_H)) h.set(k, v)
      return new Response(asset.body, { status: asset.status, headers: h })
    }
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
    const wait = (p: Promise<unknown>) => { const s = p.catch((e) => console.log("fon xato", String(e))); ctx?.waitUntil ? ctx.waitUntil(s) : void s }
    // ---- FW OPS (egaga maxfiy boshqaruv): blok yechish — FIREWALLDAN OLDIN ishlaydi.
    // Nega oldin: eganing IP'si xato bilan bloklansa ham o'zini qutqara olsin (JWT tekshiruvi
    // lokal — DB faqat o'qish). Ruxsat: DEV_PHONES'dagi raqamning yaroqli JWT tokeni.
    // Boshqa har qanday urinish — oddiy "Not found" (hech qanday ma'lumot sizchtirmaydi).
    if (url.pathname === "/api/fw/fix" && req.method === "POST") {
      const b: any = await req.json().catch(() => ({}))
      let ok = false
      try {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const payload = env.JWT_SECRET && token ? await verifyJwt(token, env.JWT_SECRET) : null
        if (payload) {
          const db = env.__db || makeDb(env.DATABASE_URL)
          const u = await db.one("SELECT phone FROM users WHERE id=?", [Number(payload.sub)]).catch(() => null)
          const admins = listVar(env.DEV_PHONES).map((s) => (s.startsWith("+") ? s : "+" + s))
          const ph2 = String(u?.phone || "")
          if (ph2 && admins.includes(ph2)) ok = true
        }
      } catch {}
      if (!ok) return FW_404()
      const ip = str(b?.ip, 50) || fwIp(req)
      if (!ip) return json({ ok: false, err: "ip yo'q" })
      let out: any = { ok: true, ip }
      try {
        const st = env.SEC!.get(env.SEC!.idFromName("global"))
        const r = await st.fetch("https://fw/?op=unblock&ip=" + encodeURIComponent(ip))
        const j: any = await r.json().catch(() => ({}))
        out = { ...j, ip }
      } catch (e: any) { out = { ok: false, err: String(e?.message || e).slice(0, 60) } }
      return json(out)
    }
    // ---- SEC FIREWALL: ko'rinmas himoya qatlami (oddij foydalanuvchi hech narsa sezmaydi) ----
    const fwip = fwIp(req)
    // SOVUQ IZOLYAT: yangi tug'ilgan izolyatda blok-ro'yxat hali yuklanmagan — birinchi so'rov
    // UNI KUTADI (≤200ms, izolyat umri ichida BIR martalik). Aks holda bloklangan IP birinchi
    // so'rovda o'tib ketardi (xavfsizlik teshigi) va bloklar izolyatlar orasida notekis ishlar edi.
    if (env.SEC && FW_YANGI === 0) { try { await fwYangola(env) } catch {} }
    fwKeshYana(env, wait)
    if (fwip) {
      if (fwBlokli(fwip)) {
        // Blok lokal keshdan chiqdi — DO hali ham tasdiqlayaptimi? (≤50ms, faqat
        // bloklanganlar to'laydi; halol foydalanuvchi bu yo'lga umuman kirmaydi).
        try { await fwTekshir(env, fwip) } catch {}
        if (fwBlokli(fwip)) return FW_404()
      }
      // TASHQI MIJOZ NAZORATI: faqat sayt (brauzer) va ilova (APK WebView/fon xizmati)
      // ruxsat etilgan. Curl, skaner, skript, bot — tashqi jashnchi: 1-URINISHDA DARHOL
      // 30 kun blok. Oddiy foydalanuvchi (sayt/app) hech qachon shu to'siqqa urilmaydi.
      const fua = req.headers.get("user-agent") || ""
      if (!FW_UA_OK.test(fua)) { fwLBlok(fwip, 30 * DAY); fwOchko(env, wait, fwip, "ext"); return FW_404() }
      // Toshqin: 1 IP → 10s ichida 80+ so'rov = darhol lokal blok + doimiy ochko
      const rt = FW_RATE.get(fwip), tn = Date.now()
      if (!rt || tn - rt.t > 10_000) { if (FW_RATE.size > 5000) FW_RATE.clear(); FW_RATE.set(fwip, { n: 1, t: tn }) }
      else if (++rt.n > 80) { fwLBlok(fwip, 15 * 60_000); fwOchko(env, wait, fwip, "flood", 2); return FW_404() }
      // Tizim ildiziga/admin yo'llariga RUXSATGIZ kirishga urinish — DARHOL 30 kun blok
      if (FW_TRAP.test(url.pathname)) { fwLBlok(fwip, 30 * DAY); fwOchko(env, wait, fwip, "root"); return FW_404() }
      // In'ektsiya/traversal belgilari (yo'l + query) — 1-URINISHDA DARHOL 30 kun blok
      let dec = url.pathname + (url.search || "")
      try { dec += " " + decodeURIComponent(dec) } catch {}
      if (FW_INJ.test(dec)) {
        fwLBlok(fwip, 30 * DAY)
        fwOchko(env, wait, fwip, "inj")
        return FW_404()
      }
      // OTP PUMPING: 50 so'rov/1 soat (mobil tarmoq CGNAT — bir IP'da YUZLARGA foydalanuvchi
      // bo'lishi mumkin; avvalgi 25/12soat chegara ODDIY foydalanuvchilarni ham urib yuborardi)
      if (url.pathname === "/api/auth/otp" && fwLokal(fwip, "otp", 50, 3_600_000)) { fwOchko(env, wait, fwip, "otp"); return FW_404() }
    }
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
    // Hajm chegarasi — ulkan payload bilan abuse (upload bo'laklari ≤1.2MB, JSON ≤2MB)
    const clen = +(req.headers.get("content-length") || 0)
    if (clen > 26_000_000) { if (fwip) fwOchko(env, wait, fwip, "flood", 3); return json({ error: "Hajm juda katta" }, 413) }
    const path = url.pathname.slice(4).replace(/\/+$/, "") || "/"
    try {
      if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) fail("Server sozlanmagan: JWT_SECRET (kamida 16 belgi)", 500)
      if (!env.DATABASE_URL && !env.__db) fail("Server sozlanmagan: DATABASE_URL", 500)
      const db = env.__db || makeDb(env.DATABASE_URL)
      // WebSocket
      if (path === "/ws") {
        const payload = await verifyJwt(url.searchParams.get("token") || "", env.JWT_SECRET)
        if (!payload) { if (fwip) { if (fwLokal(fwip, "tok", 60, 3_600_000)) return FW_404(); fwOchko(env, wait, fwip, "tok") } return json({ error: "Avtorizatsiya kerak" }, 401) }
        // Yagona sessiya nazorati (WS uchun ham): logout/qayta kirish eski ulanishni o'chiradi
        const su = await db.one("SELECT sess, logout_at, token_exp FROM users WHERE id=?", [Number(payload.sub)])
        if (!su || su.logout_at || (su.token_exp && +su.token_exp < now()) || (payload.s && payload.s !== su.sess))
          return json({ error: "Avtorizatsiya kerak" }, 401)
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket kerak" }, 426)
        const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(payload.sub)))
        return stub.fetch(req)
      }
      const r = match(req.method, path)
      if (!r) { if (fwip && fw4xx(env, wait, fwip)) return FW_404(); return FW_404() }
      let uid = 0
      if (!r!.open) {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const payload = await verifyJwt(token, env.JWT_SECRET)
        if (!payload) { if (fwip) { if (fwLokal(fwip, "tok", 60, 3_600_000)) return FW_404(); fwOchko(env, wait, fwip, "tok") } fail("Avtorizatsiya kerak", 401) }
        uid = Number(payload.sub)
        // YAGONA FAOL SESSIYA (bir raqam — bitta faol qurilma): logout barcha tokenlarni
        // o'ldiradi (logout_at), yangi kirish esa eskisini (sess mos emas → 401). Eski
        // tokenlar (s klaimsiz) moslik bo'yicha ishlaydi — yangilanish yumshoq o'tadi.
        const su = await db.one("SELECT sess, logout_at, token_exp FROM users WHERE id=?", [uid])
        if (!su || su.logout_at || (su.token_exp && +su.token_exp < now())) fail("Avtorizatsiya kerak", 401)
        if (payload.s && payload.s !== su.sess) fail("Avtorizatsiya kerak", 401)
        // MA'LUMOT TORTISH POSBONI (hatto yaroqli token bilan ham ma'lumot olib qochish mumkin emas):
        // bitta hisob 10 daqiqada 3000+ so'rov = skript (inson UI'da bunga yaqinlasha olmaydi —
        // ping 45s, qo'ng'iroq polling 20s, lenta paginatsiyasi... hammasi birgalikda << 300).
        // Chegaradan oshsa — IP 12 soat blok (skript NOL ma'lumot oladi, "Not found" ko'radi).
        if (fwip) {
          const de = FW_DATA.get(uid), dt = Date.now()
          if (!de || dt - de.t > 600_000) { if (FW_DATA.size > 10000) FW_DATA.clear(); FW_DATA.set(uid, { n: 1, t: dt }) }
          else if (++de.n > 3000) { FW_DATA.delete(uid); fwLBlok(fwip, 12 * 3_600_000); fwOchko(env, wait, fwip, "data"); return FW_404() }
        }
      }
      let b: any = {}
      const ct = req.headers.get("content-type") || ""
      if (["POST", "PATCH", "DELETE"].includes(req.method) && ct.includes("json")) b = await req.json().catch(() => ({}))
      const res = await r!.h({ env, db, uid, req, url, p: r!.p, b: b || {}, wait })
      // Skanerlash nazorati: 1 IP → 10 daqiqada 100+ xato (401/429 hisobga kirmaydi) → 30 daqiqa blok
      if (fwip && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429 && fw4xx(env, wait, fwip)) return FW_404()
      return res
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
