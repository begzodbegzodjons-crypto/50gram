// ============================================================
// 50 Gram — TiDB Cloud seed (demo kontent)
// Ishlatish: DATABASE_URL="mysql://user:pass@host:4000/uzbekgram?ssl..." bun cloudflare/db/seed.ts
// ============================================================
import { createConnection } from 'mysql2/promise'
import { pbkdf2Sync, randomBytes } from 'crypto'

const url = process.env.DATABASE_URL
if (!url || !url.startsWith('mysql')) {
  console.error('DATABASE_URL=mysql://... kerak (TiDB Cloud Serverless)')
  process.exit(1)
}

// Parol xeshi — Worker auth.ts bilan AYNAN bir xil format
function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(pw, Buffer.from(salt, 'hex'), 120000, 32, 'sha256').toString('hex')
  return `pbkdf2$120000$${salt}$${hash}`
}

function newId(): string {
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const bytes = randomBytes(16)
  let out = ''
  let t = Date.now()
  for (let i = 0; i < 10; i++) {
    out = B32[t % 32] + out
    t = Math.floor(t / 32)
  }
  for (let i = out.length; i < 26; i++) out += B32[bytes[i % 16] % 32]
  return out
}

const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

const conn = await createConnection({ uri: url, multipleStatements: false })
const exec = async (sql: string, params: unknown[] = []) => conn.execute(sql, params)
const id = () => newId()

console.log('🌱 Tozalash...')
for (const t of [
  'message_delivery', 'messages', 'chat_bans', 'chat_members', 'chats',
  'feed_likes', 'feed_comments', 'post_topics', 'feed_posts',
  'stories', 'news_articles', 'subscriptions', 'payments',
  'user_interests', 'contacts', 'blocks', 'reports', 'ads', 'admin_logs',
  'topics', 'users', 'presence', 'otp_codes',
]) {
  await exec(`DELETE FROM ${t}`)
}

// ---------- mavzular ----------
const TOPICS = [
  ['sport', 'Sport', '⚽'], ['texnologiya', 'Texnologiya', '💻'], ['kino', 'Kino va serial', '🎬'],
  ['musiqa', 'Musiqa', '🎵'], ['biznes', 'Biznes', '💼'], ['sayohat', 'Sayohat', '✈️'],
  ['ovqat', 'Ovqat', '🍽️'], ['fan', 'Fan va ta\u2019lim', '🔬'], ['avto', 'Avtomobil', '🚗'],
  ['salomatlik', 'Salomatlik', '🏥'],
]
const topicIds: Record<string, string> = {}
for (const [slug, name, emoji] of TOPICS) {
  const tid = id()
  topicIds[slug] = tid
  await exec('INSERT INTO topics (id,slug,name,emoji) VALUES (?,?,?,?)', [tid, slug, name, emoji])
}

// ---------- foydalanuvchilar ----------
const USERS = [
  ['aziz', 'Aziz Karimov', '+998901112233', '🙂', true],
  ['dilnoza', 'Dilnoza Rustamova', '+998902223344', '🌸', false],
  ['jasur', 'Jasur Toshkentov', '+998903334455', '😎', false],
  ['malika', 'Malika Yusupova', '+998904445566', '🦋', false],
  ['sardor', 'Sardor Aliyev', '+998905556677', '🚀', false],
  ['kamola', 'Kamola Nazarova', '+998906667788', '🎨', false],
]
const userIds: Record<string, string> = {}
for (const [username, name, phone, avatar, isAdmin] of USERS) {
  const uid = id()
  userIds[username] = uid
  await exec(
    'INSERT INTO users (id,username,password,name,phone,balance,avatar,is_admin,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [uid, username, hashPassword('demo123'), name, phone, 1000000, avatar, isAdmin, now - 30 * 864e5, iso(now - 30 * 864e5)]
  )
  // qiziqishlar: har biriga 3 ta mavzu
  const slugs = [['sport', 'avto', 'biznes'], ['musiqa', 'kino', 'sayohat'], ['texnologiya', 'fan', 'biznes'],
    ['kino', 'musiqa', 'salomatlik'], ['avto', 'sport', 'sayohat'], ['ovqat', 'sayohat', 'musiqa']][USERS.findIndex((u) => u[0] === username)]
  for (const slug of slugs) {
    await exec('INSERT INTO user_interests (user_id,topic_id,weight) VALUES (?,?,1)', [uid, topicIds[slug]])
  }
}

// ---------- kanallar ----------
const CHANNELS: [string, string, string, boolean, boolean, number, string][] = [
  ['50 Gram Jamoasi', '📢', 'Rasmiy jamoa kanali — yangiliklar va e\u2019lonlar', true, false, 0, 'biznes'],
  ['Toshkent Aksiya', '🔔', 'Aksiya va chegirmalar', true, false, 0, 'biznes'],
  ['Texnologiya Olami', '💻', 'Gadjetlar, IT yangiliklari', true, false, 0, 'texnologiya'],
  ['Oshxona Retseptlari', '🍽️', 'Har kuni yangi retsept', true, false, 0, 'ovqat'],
  ['Biznes Akademiya PRO', '💼', 'Pullik biznes treninglari', true, true, 25000, 'biznes'],
  ['Avto Bozor', '🚗', 'E\u2019lonlar va maslahatlar', true, false, 0, 'avto'],
]
const channelIds: Record<string, string> = {}
const chWelcome = id()
{
  const [name, emoji, desc, pub, paid, price, topic] = CHANNELS[0]
  channelIds[name] = chWelcome
  await exec(
    'INSERT INTO chats (id,type,name,description,avatar,owner_id,is_public,is_paid,price,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [chWelcome, 'channel', name, desc, emoji, userIds.aziz, pub, paid, price, now - 25 * 864e5, iso(now - 25 * 864e5)]
  )
  await exec('INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chWelcome, userIds.aziz, 'owner', now - 25 * 864e5])
  await exec('INSERT INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chWelcome, userIds.aziz, now - 25 * 864e5])
}
for (let i = 1; i < CHANNELS.length; i++) {
  const [name, emoji, desc, pub, paid, price, topic] = CHANNELS[i]
  const cid = id()
  channelIds[name] = cid
  const owner = [userIds.dilnoza, userIds.jasur, userIds.malika, userIds.aziz, userIds.sardor][i - 1]
  await exec(
    'INSERT INTO chats (id,type,name,description,avatar,owner_id,is_public,is_paid,price,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [cid, 'channel', name, desc, emoji, owner, pub, paid, price, now - (24 - i) * 864e5, iso(now - (24 - i) * 864e5)]
  )
  await exec('INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [cid, owner, 'owner', now - (24 - i) * 864e5])
  await exec('INSERT INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [cid, owner, now - (24 - i) * 864e5])
  // bir nechta obunachi
  for (const uname of ['aziz', 'dilnoza', 'jasur', 'malika', 'sardor', 'kamola'].filter((u) => u !== ['dilnoza', 'jasur', 'malika', 'aziz', 'sardor'][i - 1]).slice(0, 3)) {
    await exec('INSERT IGNORE INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [cid, userIds[uname], 'member', now - 10 * 864e5])
    await exec('INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [cid, userIds[uname], now - 10 * 864e5])
  }
}
// welcome kanalga hammasi a'zo
for (const uname of ['dilnoza', 'jasur', 'malika', 'sardor', 'kamola']) {
  await exec('INSERT IGNORE INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chWelcome, userIds[uname], 'member', now - 10 * 864e5])
  await exec('INSERT IGNORE INTO subscriptions (channel_id,user_id,created_ms) VALUES (?,?,?)', [chWelcome, userIds[uname], now - 10 * 864e5])
}

// ---------- lenta postlari ----------
const IMG = (u: string) => `https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/${u}`
const POSTS: [string, string, string | null, string, string][] = [
  ['aziz', 'Toshkent bo\u2019ylab yangi metro bekatlari ochildi! 🚇', '7a4724dc1aa6.jpg', 'sayohat', '🚀'],
  ['dilnoza', 'Bugungi konsert chiptalari sotuvda — zudlik bilan oling 🎫', '7c11e440baf6.jpg', 'musiqa', '🎵'],
  ['jasur', 'Yangiflagman: sun\u2019iy intellekt bilan ishlaydigan dronlar 🤖', 'fe437a050e51.jpg', 'texnologiya', '💻'],
  ['malika', 'Palov tayyorlashning 7 siri — oshpazlardan maslahatlar 🍚', '3fd176e9ba50.jpg', 'ovqat', '🍽️'],
  ['sardor', 'Samarqandga dam olish kunlari sayohat — eng yaxshi marshrut ✈️', '3fd176e9ba50.jpg', 'sayohat', '✈️'],
  ['kamola', 'Premyera: mahalliy kino studiyasining yangi filmi 🎬', '585e74c591da.jpg', 'kino', '🎬'],
  ['aziz', 'Futbol bo\u2019yicha milliy terma jamoa g\u2019alabasi! ⚽🏆', '585e74c591da.jpg', 'sport', '⚽'],
  ['dilnoza', 'Salomatlik uchun 5 ta oddiy odat — shifokorlar tavsiyasi 🏥', null, 'salomatlik', '🏥'],
]
for (let i = 0; i < POSTS.length; i++) {
  const [author, content, img, topic, emoji] = POSTS[i]
  const pid = id()
  await exec(
    'INSERT INTO feed_posts (id,author_id,content,image,gradient,emoji,like_count,comment_count,view_count,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [pid, userIds[author], content, img ? IMG(img) : null, img ? null : 'from-emerald-400 to-teal-600', emoji,
      Math.floor(Math.random() * 40), Math.floor(Math.random() * 8), Math.floor(Math.random() * 400), now - (i + 1) * 36e5, iso(now - (i + 1) * 36e5)]
  )
  await exec('INSERT IGNORE INTO post_topics (post_id,topic_id) VALUES (?,?)', [pid, topicIds[topic]])
}

// ---------- gazeta maqolalari ----------
const NEWS: [string, string, string, string, string][] = [
  ['Kun.uz', 'Toshkentda yangi texnopark ochildi', 'IT sohasida yangi imkoniyatlar', 'Toshkent markazida zamonaviy texnopark faoliyati boshladi. Parkda 50 dan ortiq startap ofis ochdi...'],
  ['Daryo.uz', 'Energetika: quyosh panellari loyihasi', 'Yashil energetika yo\u2019lida', 'Respublika bo\u2019ylab yangi quyosh energiyasi stansiyalari qurilmoqda...'],
  ['Gazeta.uz', 'Ta\u2019lim islohotlari davom etmoqda', 'Maktablarda yangi dastur', '2026 o\u2019quv yilidan boshlab yangi raqamli darsliklar joriy etiladi...'],
  ['Sport.uz', 'Milliy terma jamoa g\u2019alabasi', 'Futbolda tarixiy natija', 'Milliy terma jamoa Jahon chempionati saralashida g\u2019alaba qozondi...'],
  ['Kun.uz', 'Avtomobil bozorida yangi narxlar', 'Xaridorga qulay shartlar', 'Mahalliy avtoulovlarni yig\u2019uv zavodlari yangi aksiyalarni e\u2019lon qildi...'],
  ['Daryo.uz', 'Salomatlik: sport zallari mashhurlikka erishdi', 'Fitnes madaniyati o\u2019smoqda', 'Yoshlar orasida sport bilan shug\u2019ullanish qiziqishi yiliga 40% oshdi...'],
]
for (let i = 0; i < NEWS.length; i++) {
  const [source, title, summary, content] = NEWS[i]
  const nid = id()
  const topicSlugs = ['texnologiya', 'biznes', 'fan', 'sport', 'avto', 'salomatlik']
  await exec(
    'INSERT INTO news_articles (id,source,title,summary,content,gradient,emoji,topic_id,view_count,published_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [nid, source, title, summary, content, 'from-amber-400 to-orange-600', '📰', topicIds[topicSlugs[i % 6]],
      Math.floor(Math.random() * 900), now - (i + 2) * 864e5, iso(now - (i + 2) * 864e5)]
  )
}

// ---------- hikoyalar ----------
const STORIES: [string, string | null, string][] = [
  ['dilnoza', '7a4724dc1aa6.jpg', 'Buxorodagi quyosh botishi 🌅'],
  ['jasur', null, 'Yangi loyihada ishga tushdim 🚀'],
  ['malika', '3fd176e9ba50.jpg', 'Bugungi taom — palov 🍚'],
]
for (let i = 0; i < STORIES.length; i++) {
  const [author, img, caption] = STORIES[i]
  await exec(
    'INSERT INTO stories (id,user_id,image,gradient,caption,created_ms,expires_ms,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id(), userIds[author], img ? IMG(img) : null, img ? null : 'from-fuchsia-400 to-purple-600', caption,
      now - i * 36e5, now + (24 - i) * 36e5, iso(now - i * 36e5)]
  )
}

// ---------- demo suhbat (aziz ↔ dilnoza) ----------
{
  const chatId = id()
  await exec('INSERT INTO chats (id,type,owner_id,created_ms,created_at) VALUES (?,?,?,?,?)', [chatId, 'direct', userIds.aziz, now - 5 * 864e5, iso(now - 5 * 864e5)])
  await exec('INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chatId, userIds.aziz, 'owner', now - 5 * 864e5])
  await exec('INSERT INTO chat_members (chat_id,user_id,role,created_ms) VALUES (?,?,?,?)', [chatId, userIds.dilnoza, 'member', now - 5 * 864e5])
  // yetkazilgan (purged) + kanal post namunasi
  const m1 = id()
  await exec(
    'INSERT INTO messages (id,chat_id,sender_id,type,content,purged,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [m1, chatId, userIds.aziz, 'text', null, true, now - 4 * 864e5, iso(now - 4 * 864e5)]
  )
  const m2 = id()
  await exec(
    'INSERT INTO messages (id,chat_id,sender_id,type,content,purged,created_ms,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [m2, chWelcome, userIds.aziz, 'text', '50 Gram Jamoasiga xush kelibsiz! 🎉', false, now - 3 * 864e5, iso(now - 3 * 864e5)]
  )
}

console.log('✅ Seed yakunlandi!')
console.log('   Demo loginlar: aziz, dilnoza, jasur, malika, sardor, kamola — parol: demo123')
await conn.end()
