import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { rankItems, type InterestMap, WEIGHT_BOOST, clampWeight } from '@/lib/recommend'
import { gradientFor } from '@/lib/topics'

// ===== Lenta (Feed) =====
// GET /api/feed?mode=for-you|trend
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const mode = new URL(req.url).searchParams.get('mode') || 'for-you'

  const posts = await db.feedPost.findMany({
    include: {
      topics: { include: { topic: true } },
      likes: { where: { userId: me.id } },
      author: { select: { id: true, name: true, avatar: true, username: true } },
    },
    take: 300,
  })

  const interests = await db.userInterest.findMany({ where: { userId: me.id } })
  const interestMap: InterestMap = {}
  interests.forEach((i) => (interestMap[i.topicId] = i.weight))

  const subs = await db.subscription.findMany({ where: { userId: me.id } })
  const subSet = new Set(subs.map((s) => s.channelId))

  const allTopics = await db.topic.findMany()
  const topicNames = Object.fromEntries(allTopics.map((t) => [t.id, t.name]))

  const serialize = (p: typeof posts[number], reason?: string) => ({
    id: p.id,
    content: p.content,
    image: p.image,
    gradient: p.gradient,
    emoji: p.emoji,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    viewCount: p.viewCount,
    createdAt: p.createdAt,
    authorId: p.authorId,
    authorName: p.author.name,
    authorAvatar: p.author.avatar,
    authorUsername: p.author.username,
    channelId: p.channelId,
    channelName: p.channelName,
    likedByMe: p.likes.length > 0,
    topics: p.topics.map((t) => ({
      id: t.topic.id,
      slug: t.topic.slug,
      name: t.topic.name,
      emoji: t.topic.emoji,
    })),
    reason,
  })

  if (mode === 'trend') {
    const sorted = [...posts].sort(
      (a, b) => b.likeCount * 2 + b.commentCount * 1.5 + b.viewCount * 0.05 - (a.likeCount * 2 + a.commentCount * 1.5 + a.viewCount * 0.05)
    )
    return Response.json(sorted.slice(0, 60).map((p) => serialize(p)))
  }

  // "Siz uchun" — shaxsiylashtirilgan algoritm
  const byId = Object.fromEntries(posts.map((p) => [p.id, p]))
  const rankable = posts.map((p) => ({
    id: p.id,
    topicIds: p.topics.map((t) => t.topicId),
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    viewCount: p.viewCount,
    createdAt: p.createdAt,
    channelId: p.channelId,
  }))
  const ranked = rankItems(rankable, {
    interests: interestMap,
    subscribedChannelIds: subSet,
    userId: me.id,
    topicNameById: topicNames,
  })

  return Response.json(
    ranked
      .filter((r) => byId[r.item.id])
      .map((r) => serialize(byId[r.item.id], r.reason))
  )
}

// ===== Yangi post yaratish =====
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('Noto\u2018g\u2018ri so\u2018rov')

  const content = String(body.content || '').trim()
  if (content.length < 2) return jsonError('Post matni juda qisqa')
  const image = typeof body.image === 'string' && body.image.startsWith('data:image') ? body.image : null
  if (!image && content.length < 2) return jsonError('Bo\u2018sh post')

  const topicSlugs: string[] = Array.isArray(body.topicSlugs) ? body.topicSlugs.slice(0, 3) : []
  const topics = await db.topic.findMany({ where: { slug: { in: topicSlugs } } })
  if (!topics.length) return jsonError('Kamida 1 ta mavzu tanlang')

  const post = await db.feedPost.create({
    data: {
      authorId: me.id,
      content,
      image,
      gradient: image ? null : gradientFor(content.slice(0, 24)),
      emoji: body.emoji ? String(body.emoji).slice(0, 8) : topics[0].emoji,
      topics: { create: topics.map((t) => ({ topicId: t.id })) },
    },
  })

  // O'z mavzu qiziqishiga ham ozgina oshirish
  for (const t of topics) {
    await db.userInterest.upsert({
      where: { userId_topicId: { userId: me.id, topicId: t.id } },
      create: { userId: me.id, topicId: t.id, weight: 1 },
      update: { weight: { increment: WEIGHT_BOOST.like } },
    })
  }

  return Response.json({ id: post.id })
}
