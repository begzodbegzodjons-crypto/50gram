// UzbekGram tavsiya algoritmi (Lenta + Gazeta uchun umumiy yadro)
//
// Score = mavzu qiziqishi * 2.5
//       + engagement (like/comment/ko’rish)
//       + dolzarblik (recency decay)
//       + obuna bonusi
//
// Har bir amal (ko’rish, like, komment) foydalanuvchining mavzu og’irligini
// oshiradi — lentada shu mavzular ko’proq chiqadi.

export interface InterestMap {
  [topicId: string]: number
}

export interface ScorableItem {
  id: string
  topicIds: string[]
  likeCount: number
  commentCount: number
  viewCount: number
  createdAt: Date
  channelId?: string | null
}

export interface RankedItem<T> {
  item: T
  score: number
  reason: string // foydalanuvchiga ko’rsatiladigan izoh
}

export interface RankContext {
  interests: InterestMap
  subscribedChannelIds: Set<string>
  userId: string
  topicNameById: { [topicId: string]: string }
}

export function rankItems<T extends ScorableItem>(
  items: T[],
  ctx: RankContext,
  limit = 60
): RankedItem<T>[] {
  const now = Date.now()

  const ranked = items.map((item) => {
    const ageHours = Math.max(0, (now - item.createdAt.getTime()) / 36e5)

    // 1) Mavzu qiziqishi
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

    // 2) Engagement (0..3)
    const engagement = Math.min(
      3,
      (item.likeCount * 2 + item.commentCount * 1.5 + item.viewCount * 0.05) / 10
    )

    // 3) Dolzarblik: har 18 soatda kuchini yo’qotadi
    const recency = 3 * Math.exp(-ageHours / 18)

    // 4) Obuna + shaxsiy sabab
    const isSubscribed = !!(item.channelId && ctx.subscribedChannelIds.has(item.channelId))
    const subscriptionBonus = isSubscribed ? 2.2 : 0

    let score =
      topicAffinity * 2.5 + engagement + recency + subscriptionBonus

    // O’z postini o’z lentasida pastga tushirish
    if (item.channelId === null) {
      // FeedPost.authorId bilan solishtirish kerak — chaqiruvchi tomonda filterlanadi,
      // bu yerda unchalik muhim emas
    }

    // Sabab matni
    let reason = 'Trend bo\u2019lyapti'
    if (isSubscribed) reason = 'Siz obuna bo\u2019lgan kanal'
    else if (bestTopic && bestWeight >= 1) {
      reason = `${ctx.topicNameById[bestTopic] ?? ''} bo’yicha qiziqishingiz bor`
    } else if (engagement > 2) reason = 'Ko\u2019p muhokama qilinyapti'
    else if (recency > 2.2) reason = 'Yangi kontent'

    return { item, score, reason }
  })

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}

// Foydalanuvchi amallari bo’yicha mavzu og’irligini oshirish
export const WEIGHT_BOOST = {
  view: 0.05,
  like: 0.3,
  comment: 0.45,
  storyView: 0.02,
}

export function clampWeight(w: number): number {
  return Math.min(6, Math.max(0, w))
}
