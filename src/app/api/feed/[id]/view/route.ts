import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { WEIGHT_BOOST, clampWeight } from '@/lib/recommend'

// Ko'rish — algoritm uchun eng keng tarqalgan signal
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: postId } = await ctx.params
  const post = await db.feedPost.findUnique({ where: { id: postId }, include: { topics: true } })
  if (!post) return jsonError('Post topilmadi', 404)

  await db.feedPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } })

  for (const pt of post.topics) {
    const cur = await db.userInterest.findUnique({
      where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
    })
    const w = clampWeight((cur?.weight ?? 0.2) + WEIGHT_BOOST.view)
    await db.userInterest.upsert({
      where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
      create: { userId: me.id, topicId: pt.topicId, weight: w },
      update: { weight: w },
    })
  }

  return Response.json({ ok: true })
}
