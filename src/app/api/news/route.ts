import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { rankItems, type InterestMap } from '@/lib/recommend'

// ===== Elektron gazeta =====
// GET /api/news?mode=for-you|latest&topic=slug
export async function GET(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'for-you'
  const topicSlug = url.searchParams.get('topic')

  const where = topicSlug ? { topic: { slug: topicSlug } } : {}

  const articles = await db.newsArticle.findMany({
    where,
    include: { topic: true },
    take: 200,
  })

  const serialize = (a: typeof articles[number], reason?: string) => ({
    id: a.id,
    source: a.source,
    title: a.title,
    summary: a.summary,
    content: a.content,
    image: a.image,
    gradient: a.gradient,
    emoji: a.emoji,
    viewCount: a.viewCount,
    publishedAt: a.publishedAt,
    topic: { id: a.topic.id, slug: a.topic.slug, name: a.topic.name, emoji: a.topic.emoji },
    reason,
  })

  if (mode === 'latest' || topicSlug) {
    const sorted = [...articles].sort(
      (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()
    )
    return Response.json(sorted.slice(0, 60).map((a) => serialize(a)))
  }

  // "Siz uchun" — qiziqish algoritmi
  const interests = await db.userInterest.findMany({ where: { userId: me.id } })
  const interestMap: InterestMap = {}
  interests.forEach((i) => (interestMap[i.topicId] = i.weight))

  const allTopics = await db.topic.findMany()
  const topicNames = Object.fromEntries(allTopics.map((t) => [t.id, t.name]))

  const ranked = rankItems(
    articles.map((a) => ({
      id: a.id,
      topicIds: [a.topicId],
      likeCount: Math.round(a.viewCount / 6), // yangiliklarda like yo'q, view dan hosil qilamiz
      commentCount: 0,
      viewCount: a.viewCount,
      createdAt: a.publishedAt,
      channelId: null,
    })),
    { interests: interestMap, subscribedChannelIds: new Set(), userId: me.id, topicNameById: topicNames }
  )

  const byId = Object.fromEntries(articles.map((a) => [a.id, a]))
  return Response.json(
    ranked
      .filter((r) => byId[r.item.id])
      .map((r) => serialize(byId[r.item.id], r.reason))
  )
}

// Ko'rish statistikasi
export async function POST(req: Request) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const body = await req.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id) return jsonError('ID kerak')

  await db.newsArticle.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {})
  return Response.json({ ok: true })
}
