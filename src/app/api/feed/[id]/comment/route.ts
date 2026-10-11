import { db } from '@/lib/db'
import { getUserFromRequest, jsonError } from '@/lib/auth'
import { WEIGHT_BOOST, clampWeight } from '@/lib/recommend'

// Kommentlar: GET (ro'yxat) + POST (qo'shish)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: postId } = await ctx.params
  const comments = await db.comment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { name: true, avatar: true, username: true } } },
  })

  return Response.json(
    comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      userName: c.user.name,
      userAvatar: c.user.avatar,
      userUsername: c.user.username,
    }))
  )
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUserFromRequest(req)
  if (!me) return jsonError('Avtorizatsiya kerak', 401)

  const { id: postId } = await ctx.params
  const post = await db.feedPost.findUnique({ where: { id: postId }, include: { topics: true } })
  if (!post) return jsonError('Post topilmadi', 404)

  const body = await req.json().catch(() => null)
  const content = String(body?.content || '').trim()
  if (content.length < 1) return jsonError('Komment bo\u2018sh')

  const comment = await db.comment.create({
    data: { postId, userId: me.id, content },
    include: { user: { select: { name: true, avatar: true, username: true } } },
  })
  await db.feedPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } })

  // Algoritm: komment — kuchli signal
  for (const pt of post.topics) {
    const cur = await db.userInterest.findUnique({
      where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
    })
    const w = clampWeight((cur?.weight ?? 0.4) + WEIGHT_BOOST.comment)
    await db.userInterest.upsert({
      where: { userId_topicId: { userId: me.id, topicId: pt.topicId } },
      create: { userId: me.id, topicId: pt.topicId, weight: w },
      update: { weight: w },
    })
  }

  return Response.json({
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    userName: comment.user.name,
    userAvatar: comment.user.avatar,
    userUsername: comment.user.username,
  })
}
