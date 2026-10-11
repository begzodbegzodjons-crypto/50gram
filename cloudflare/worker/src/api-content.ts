// ============================================================
// 50 Gram Worker — LENTA / HIKOYALAR / GAZETA / TO'LOVLAR / STATISTIKA
// ============================================================
import type { Ctx } from './api-auth'
import { q, one, count, exec } from './db'
import { json, err, readJson, newId, nowMs, isoOf, gradientFor, str, bool, clampWeight, WEIGHT_BOOST } from './util'
import { rankItems } from './rank'

// ---------- post seriyalash ----------
function serializePost(p: any, opts: { likedByMe: boolean; reason?: string }) {
  return {
    id: p.id,
    content: p.content,
    image: p.image ?? null,
    gradient: p.gradient ?? null,
    emoji: p.emoji ?? null,
    likeCount: Number(p.like_count ?? 0),
    commentCount: Number(p.comment_count ?? 0),
    viewCount: Number(p.view_count ?? 0),
    createdAt: isoOf(Number(p.created_ms)),
    authorId: p.author_id,
    authorName: p.author_name,
    authorAvatar: p.author_avatar ?? '🙂',
    authorUsername: p.author_username,
    channelId: p.channel_id ?? null,
    channelName: p.channel_name ?? null,
    likedByMe: opts.likedByMe,
    topics: (p.topics_json ? JSON.parse(p.topics_json) : []).map((t: any) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      emoji: t.emoji,
    })),
    reason: opts.reason,
  }
}

async function postsFor(c: Ctx, limit = 300) {
  const posts = await q<any>(
    c.db,
    `SELECT p.*, u.name AS author_name, u.avatar AS author_avatar, u.username AS author_username,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.id, 'slug', t.slug, 'name', t.name, 'emoji', t.emoji))
         FROM post_topics pt JOIN topics t ON t.id = pt.topic_id WHERE pt.post_id = p.id) AS topics_json,
        (SELECT 1 FROM feed_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
     FROM feed_posts p JOIN users u ON u.id = p.author_id
     ORDER BY p.created_ms DESC LIMIT ${limit}`,
    [c.uid]
  )
  return posts
}

async function interestsFor(c: Ctx) {
  const interests = await q<{ topic_id: string; weight: number }>(
    c.db,
    'SELECT topic_id, weight FROM user_interests WHERE user_id=?',
    [c.uid]
  )
  const map: Record<string, number> = {}
  for (const i of interests) map[i.topic_id] = Number(i.weight)
  return map
}

// ==================== LENTA ====================
export async function apiFeedGet(c: Ctx, url: URL) {
  const mode = url.searchParams.get('mode') || 'for-you'
  const posts = await postsFor(c)

  const serialize = (p: any, reason?: string) =>
    serializePost(p, { likedByMe: bool(p.liked_by_me), reason })

  if (mode === 'trend') {
    const sorted = [...posts].sort(
      (a, b) =>
        Number(b.like_count) * 2 + Number(b.comment_count) * 1.5 + Number(b.view_count) * 0.05 -
        (Number(a.like_count) * 2 + Number(a.comment_count) * 1.5 + Number(a.view_count) * 0.05)
    )
    return json(sorted.slice(0, 60).map((p) => serialize(p)))
  }

  const interests = await interestsFor(c)
  const subs = await q<{ channel_id: string }>(c.db, 'SELECT channel_id FROM subscriptions WHERE user_id=?', [c.uid])
  const subSet = new Set(subs.map((s) => s.channel_id))
  const topics = await q<{ id: string; name: string }>(c.db, 'SELECT id, name FROM topics')
  const topicNames: Record<string, string> = {}
  for (const t of topics) topicNames[t.id] = t.name

  const ranked = rankItems(
    posts.map((p) => ({
      id: p.id,
      topicIds: (p.topics_json ? (JSON.parse(p.topics_json) as any[]) : []).map((t) => t.id),
      likeCount: Number(p.like_count),
      commentCount: Number(p.comment_count),
      viewCount: Number(p.view_count),
      createdAtMs: Number(p.created_ms),
      channelId: p.channel_id ?? null,
      authorId: p.author_id,
    })),
    { interests, subscribedChannelIds: subSet, userId: c.uid, topicNameById: topicNames }
  )
  const byId = new Map(posts.map((p) => [p.id, p]))
  return json(ranked.filter((r) => byId.has(r.item.id)).map((r) => serialize(byId.get(r.item.id), r.reason)))
}

export async function apiFeedPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')

  const content = str(body.content, 5000).trim()
  const image = typeof body.image === 'string' && body.image.startsWith('data:image') ? body.image : null
  if (!image && content.length < 2) return err('Bo\u2018sh post')

  const topicSlugs: string[] = Array.isArray(body.topicSlugs) ? body.topicSlugs.slice(0, 3) : []
  if (!topicSlugs.length) return err('Kamida 1 ta mavzu tanlang')
  const topics = await q<any>(c.db, `SELECT id, emoji FROM topics WHERE slug IN (${topicSlugs.map(() => '?').join(',')})`, topicSlugs)
  if (!topics.length) return err('Kamida 1 ta mavzu tanlang')

  const id = newId()
  await exec(
    c.db,
    'INSERT INTO feed_posts (id,author_id,content,image,gradient,emoji,created_ms) VALUES (?,?,?,?,?,?,?)',
    [id, c.uid, content, image, image ? null : gradientFor(content.slice(0, 24)), str(body.emoji, 8) || topics[0].emoji, nowMs()]
  )
  for (const t of topics) {
    await exec(c.db, 'INSERT IGNORE INTO post_topics (post_id,topic_id) VALUES (?,?)', [id, t.id])
    await exec(
      c.db,
      'INSERT INTO user_interests (user_id,topic_id,weight) VALUES (?,?,1) ON DUPLICATE KEY UPDATE weight=LEAST(6, weight+?)',
      [c.uid, t.id, WEIGHT_BOOST.like]
    )
  }
  return json({ id })
}

// ---------- like / comment / view: umumiy qiziqish oshirish ----------
async function boostTopics(c: Ctx, postId: string, boost: number) {
  const pts = await q<{ topic_id: string }>(c.db, 'SELECT topic_id FROM post_topics WHERE post_id=?', [postId])
  for (const pt of pts) {
    const cur = await one<{ weight: number }>(c.db, 'SELECT weight FROM user_interests WHERE user_id=? AND topic_id=?', [
      c.uid,
      pt.topic_id,
    ])
    const w = clampWeight(Number(cur?.weight ?? 0.4) + boost)
    await exec(
      c.db,
      `INSERT INTO user_interests (user_id,topic_id,weight) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE weight=?`,
      [c.uid, pt.topic_id, w, w]
    )
  }
}

export async function apiFeedLike(c: Ctx, postId: string) {
  const post = await one<any>(c.db, 'SELECT id FROM feed_posts WHERE id=?', [postId])
  if (!post) return err('Post topilmadi', 404)
  const existing = await one(c.db, 'SELECT 1 FROM feed_likes WHERE post_id=? AND user_id=?', [postId, c.uid])
  let liked: boolean
  if (existing) {
    await exec(c.db, 'DELETE FROM feed_likes WHERE post_id=? AND user_id=?', [postId, c.uid])
    await exec(c.db, 'UPDATE feed_posts SET like_count=like_count-1 WHERE id=?', [postId])
    liked = false
  } else {
    await exec(c.db, 'INSERT INTO feed_likes (post_id,user_id,created_ms) VALUES (?,?,?)', [postId, c.uid, nowMs()])
    await exec(c.db, 'UPDATE feed_posts SET like_count=like_count+1 WHERE id=?', [postId])
    liked = true
    await boostTopics(c, postId, WEIGHT_BOOST.like)
  }
  const fresh = await one<{ like_count: number }>(c.db, 'SELECT like_count FROM feed_posts WHERE id=?', [postId])
  return json({ liked, likeCount: Number(fresh?.like_count ?? 0) })
}

export async function apiFeedCommentsGet(c: Ctx, postId: string) {
  const comments = await q<any>(
    c.db,
    `SELECT k.*, u.name AS user_name, u.avatar AS user_avatar, u.username AS user_username
     FROM feed_comments k JOIN users u ON u.id = k.user_id
     WHERE k.post_id=? ORDER BY k.created_ms ASC`,
    [postId]
  )
  return json(
    comments.map((k) => ({
      id: k.id,
      content: k.content,
      createdAt: isoOf(Number(k.created_ms)),
      userName: k.user_name,
      userAvatar: k.user_avatar ?? '🙂',
      userUsername: k.user_username,
    }))
  )
}

export async function apiFeedCommentsPost(req: Request, c: Ctx, postId: string) {
  const post = await one<any>(c.db, 'SELECT id FROM feed_posts WHERE id=?', [postId])
  if (!post) return err('Post topilmadi', 404)
  const body = await readJson(req)
  const content = str(body?.content, 1000).trim()
  if (content.length < 1) return err('Komment bo\u2018sh')
  await exec(c.db, 'INSERT INTO feed_comments (id,post_id,user_id,content,created_ms) VALUES (?,?,?,?,?)', [
    newId(),
    postId,
    c.uid,
    content,
    nowMs(),
  ])
  await exec(c.db, 'UPDATE feed_posts SET comment_count=comment_count+1 WHERE id=?', [postId])
  await boostTopics(c, postId, WEIGHT_BOOST.comment)
  const me = await one<{ name: string; avatar: string; username: string }>(c.db, 'SELECT name, avatar, username FROM users WHERE id=?', [c.uid])
  return json({
    id: '',
    content,
    createdAt: isoOf(nowMs()),
    userName: me?.name ?? '',
    userAvatar: me?.avatar ?? '🙂',
    userUsername: me?.username ?? '',
  })
}

export async function apiFeedView(c: Ctx, postId: string) {
  const post = await one<any>(c.db, 'SELECT id FROM feed_posts WHERE id=?', [postId])
  if (!post) return err('Post topilmadi', 404)
  await exec(c.db, 'UPDATE feed_posts SET view_count=view_count+1 WHERE id=?', [postId])
  await boostTopics(c, postId, WEIGHT_BOOST.view)
  return json({ ok: true })
}

// ==================== HIKOYALAR ====================
export async function apiStoriesGet(c: Ctx) {
  await exec(c.db, 'DELETE FROM stories WHERE expires_ms < ?', [nowMs()])
  const stories = await q<any>(
    c.db,
    `SELECT s.*, u.name AS user_name, u.avatar AS user_avatar
     FROM stories s JOIN users u ON u.id = s.user_id
     WHERE s.expires_ms > ? ORDER BY s.created_ms ASC LIMIT 100`,
    [nowMs()]
  )
  return json(
    stories.map((s) => ({
      id: s.id,
      userId: s.user_id,
      userName: s.user_name,
      userAvatar: s.user_avatar ?? '🙂',
      image: s.image ?? null,
      gradient: s.gradient ?? null,
      caption: s.caption ?? null,
      createdAt: isoOf(Number(s.created_ms)),
      mine: s.user_id === c.uid,
    }))
  )
}

export async function apiStoriesPost(req: Request, c: Ctx) {
  const body = await readJson(req)
  if (!body) return err('Noto\u2018g\u2018ri so\u2018rov')
  const image = typeof body.image === 'string' && body.image.startsWith('data:image') ? body.image : null
  const caption = str(body.caption, 200)
  if (!image && !caption) return err('Rasm yoki matn kerak')
  const me = await one<{ name: string }>(c.db, 'SELECT name FROM users WHERE id=?', [c.uid])
  const id = newId()
  await exec(c.db, 'INSERT INTO stories (id,user_id,image,gradient,caption,created_ms,expires_ms) VALUES (?,?,?,?,?,?,?)', [
    id,
    c.uid,
    image,
    image ? null : gradientFor(caption || me?.name || 'story'),
    caption || null,
    nowMs(),
    nowMs() + 24 * 3600 * 1000,
  ])
  return json({ id })
}

// ==================== GAZETA ====================
export async function apiNewsGet(c: Ctx, url: URL) {
  const mode = url.searchParams.get('mode') || 'for-you'
  const topicSlug = url.searchParams.get('topic')

  const articles = await q<any>(
    c.db,
    `SELECT n.*, t.slug AS t_slug, t.name AS t_name, t.emoji AS t_emoji
     FROM news_articles n JOIN topics t ON t.id = n.topic_id
     ${topicSlug ? 'WHERE t.slug = ?' : ''}`,
    topicSlug ? [topicSlug] : []
  )

  const serialize = (a: any, reason?: string) => ({
    id: a.id,
    source: a.source,
    title: a.title,
    summary: a.summary,
    content: a.content,
    image: a.image ?? null,
    gradient: a.gradient ?? null,
    emoji: a.emoji ?? null,
    viewCount: Number(a.view_count ?? 0),
    publishedAt: isoOf(Number(a.published_ms)),
    topic: { id: a.topic_id, slug: a.t_slug, name: a.t_name, emoji: a.t_emoji },
    reason,
  })

  if (mode === 'latest' || topicSlug) {
    const sorted = [...articles].sort((a, b) => Number(b.published_ms) - Number(a.published_ms))
    return json(sorted.slice(0, 60).map((a) => serialize(a)))
  }

  const interests = await interestsFor(c)
  const topics = await q<{ id: string; name: string }>(c.db, 'SELECT id, name FROM topics')
  const topicNames: Record<string, string> = {}
  for (const t of topics) topicNames[t.id] = t.name

  const ranked = rankItems(
    articles.map((a) => ({
      id: a.id,
      topicIds: [a.topic_id],
      likeCount: Math.round(Number(a.view_count) / 6),
      commentCount: 0,
      viewCount: Number(a.view_count),
      createdAtMs: Number(a.published_ms),
      channelId: null,
    })),
    { interests, subscribedChannelIds: new Set(), userId: c.uid, topicNameById: topicNames }
  )
  const byId = new Map(articles.map((a) => [a.id, a]))
  return json(ranked.filter((r) => byId.has(r.item.id)).map((r) => serialize(byId.get(r.item.id), r.reason)))
}

// ==================== TO'LOVLAR ====================
export async function apiPaymentsGet(c: Ctx) {
  const me = await one<{ balance: number }>(c.db, 'SELECT balance FROM users WHERE id=?', [c.uid])
  const payments = await q<any>(
    c.db,
    'SELECT * FROM payments WHERE user_id=? ORDER BY created_ms DESC LIMIT 100',
    [c.uid]
  )
  const income = await q<any>(
    c.db,
    `SELECT p.*, u.username AS from_username FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.owner_id=? ORDER BY p.created_ms DESC LIMIT 100`,
    [c.uid]
  )
  const spentTotal = payments.reduce((s, p) => s + Number(p.amount), 0)
  const incomeTotal = income.reduce((s, p) => s + Number(p.amount), 0)
  return json({
    balance: Number(me?.balance ?? 0),
    spentTotal,
    incomeTotal,
    payments: payments.map((p) => ({
      id: p.id,
      channelName: p.channel_name,
      amount: Number(p.amount),
      method: p.method,
      createdAt: isoOf(Number(p.created_ms)),
    })),
    income: income.map((p) => ({
      id: p.id,
      channelName: p.channel_name,
      amount: Number(p.amount),
      from: p.from_username,
      createdAt: isoOf(Number(p.created_ms)),
    })),
  })
}

// ==================== SERVER STATISTIKASI ====================
export async function apiStatsGet(c: Ctx) {
  const total = await count(c.db, 'SELECT COUNT(*) AS n FROM messages')
  const purged = await count(c.db, 'SELECT COUNT(*) AS n FROM messages WHERE purged=1')
  const stored = await count(c.db, 'SELECT COUNT(*) AS n FROM messages WHERE purged=0')
  const media = await q<{ total: number }>(
    c.db,
    "SELECT COALESCE(SUM(LENGTH(content)),0) AS total FROM messages WHERE purged=0 AND type='image'"
  )
  return json({
    totalMessages: total,
    purgedMessages: purged,
    storedMessages: stored,
    storedMediaBytes: Number(media[0]?.total ?? 0),
  })
}
