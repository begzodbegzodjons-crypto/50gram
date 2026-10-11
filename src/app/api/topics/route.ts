import { db } from '@/lib/db'

export async function GET() {
  const topics = await db.topic.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true, emoji: true },
  })
  return Response.json(topics)
}
