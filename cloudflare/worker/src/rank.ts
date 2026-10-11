// ============================================================
// 50 Gram Worker — tavsiya algoritmi (src/lib/recommend.ts porti)
// ============================================================
export interface ScorableItem {
  id: string
  topicIds: string[]
  likeCount: number
  commentCount: number
  viewCount: number
  createdAtMs: number
  channelId?: string | null
  authorId?: string | null
}

export interface RankedItem<T> {
  item: T
  score: number
  reason: string
}

export interface RankContext {
  interests: Record<string, number>
  subscribedChannelIds: Set<string>
  userId: string
  topicNameById: Record<string, string>
}

export function rankItems<T extends ScorableItem>(items: T[], ctx: RankContext, limit = 60): RankedItem<T>[] {
  const now = Date.now()
  const ranked = items.map((item) => {
    const ageHours = Math.max(0, (now - item.createdAtMs) / 36e5)

    let topicAffinity = 0
    let bestTopic: string | null = null
    let bestWeight = 0
    for (const tid of item.topicIds) {
      const w = ctx.interests[tid] ?? 0
      if (w > bestWeight) {
        bestWeight = w
        bestTopic = tid
      }
      topicAffinity += w
    }
    topicAffinity = item.topicIds.length ? topicAffinity / item.topicIds.length : 0

    const engagement = Math.min(3, (item.likeCount * 2 + item.commentCount * 1.5 + item.viewCount * 0.05) / 10)
    const recency = 3 * Math.exp(-ageHours / 18)
    const isSubscribed = !!(item.channelId && ctx.subscribedChannelIds.has(item.channelId))
    const subscriptionBonus = isSubscribed ? 2.2 : 0
    const selfPenalty = item.channelId === null && item.authorId === ctx.userId ? -1.2 : 0

    const score = topicAffinity * 2.5 + engagement + recency + subscriptionBonus + selfPenalty

    let reason = 'Trend bo\u2019lyapti'
    if (isSubscribed) reason = 'Siz obuna bo\u2019lgan kanal'
    else if (bestTopic && bestWeight >= 1) reason = `${ctx.topicNameById[bestTopic] ?? ''} bo\u2019yicha qiziqishingiz bor`
    else if (engagement > 2) reason = 'Ko\u2019p muhokama qilinyapti'
    else if (recency > 2.2) reason = 'Yangi kontent'

    return { item, score, reason }
  })
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}
