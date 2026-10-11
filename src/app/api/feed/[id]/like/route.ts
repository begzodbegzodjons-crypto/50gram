import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { WEIGHT_BOOST, clampWeight } from '@/lib/recommend'

// Like toggle — algoritm og'irligini ham oshiradi
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: postId } = await ctx.params
  const post = await db.feedPost.findUnique({
    where: { id: postId },
    include: { topics: true },
  })
  if (!post) return jsonError('Post topilmadi', 404)

  const existing = await db.like.findUnique({
    where: { postId_userId: { postId, userId: me.id } },
  })

  let liked: boolean
  if (existing) {
    await db.like.delete({ where: { postId_userId: { postId, userId: me.id } } })
    await db.feedPost.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } })
    liked = false
  } else {
    await db.like.create({ data: { postId, userId: me.id } })
    await db.feedPost.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } })
    liked = true

    // Algoritm: post mavzulariga qiziqish oshiriladi
    for (const pt of post.topics) {
      const cur = await db.userInterest.findUnique({
        where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
      })
      const w = clampWeight((cur?.weight ?? 0.4) + WEIGHT_BOOST.like)
      await db.userInterest.upsert({
        where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
        create: { userId: me.id, topicId: pt.topicId, weight: w },
        update: { weight: w },
      })
    }
  }

  const fresh = await db.feedPost.findUnique({ where: { id: postId }, select: { likeCount: true } })
  return Response.json({ liked, likeCount: fresh?.likeCount ?? 0 })
}
