'use client'

// API klienti — token bilan ishlaydi
// Lokal dev: shu Next.js API route'lariga; Cloudflare: Worker manziliga
// (NEXT_PUBLIC_API_BASE orqali).

const TOKEN_KEY = 'uzbekgram_token'
export const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE) || ''

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Xatolik yuz berdi')
  }
  return data as T
}

// ---------- Tiplar ----------

export interface Me {
  id: string
  username: string
  name: string
  phone: string | null
  balance: number
  avatar: string
  bio: string | null
  isAdmin?: boolean
  interests: { topicId: string; weight: number }[]
}

export interface Topic {
  id: string
  slug: string
  name: string
  emoji: string
}

export interface ChatInfo {
  id: string
  type: 'direct' | 'group' | 'channel'
  name: string // direct bo'lsa qarshi tomon ismi
  avatar: string | null
  description: string | null
  memberCount: number
  unreadCount: number
  lastMessageAt: string | null
  otherUserId: string | null // direct uchun
  ownerId: string | null
  subscribed: boolean
  muted?: boolean
  myRole?: 'owner' | 'admin' | 'member'
  isPublic?: boolean
  isPaid?: boolean
  price?: number
  inviteCode?: string | null
  members?: { id: string; name: string; avatar: string; username: string }[]
}

export interface ServerMessage {
  id: string
  chatId: string
  senderId: string
  type: 'text' | 'image'
  content: string | null
  caption: string | null
  pinned?: boolean
  mediaName: string | null
  purged: boolean
  createdAt: string
}

export interface FeedPost {
  id: string
  content: string
  image: string | null
  gradient: string | null
  emoji: string | null
  likeCount: number
  commentCount: number
  viewCount: number
  createdAt: string
  authorId: string
  authorName: string
  authorAvatar: string
  authorUsername: string
  channelId: string | null
  channelName: string | null
  likedByMe: boolean
  topics: Topic[]
  reason?: string
}

export interface NewsItem {
  id: string
  source: string
  title: string
  summary: string
  content: string
  image: string | null
  gradient: string | null
  emoji: string | null
  viewCount: number
  publishedAt: string
  topic: Topic
  reason?: string
}

export interface StoryItem {
  id: string
  userId: string
  userName: string
  userAvatar: string
  image: string | null
  gradient: string | null
  caption: string | null
  createdAt: string
  mine?: boolean
}

export interface ChannelInfo {
  id: string
  name: string
  avatar: string | null
  description: string | null
  memberCount: number
  subscribed: boolean
  ownerId: string | null
  isPaid: boolean
  price: number
  mine: boolean
}

export interface ChannelDetail {
  id: string
  type: 'group' | 'channel'
  name: string | null
  description: string | null
  avatar: string | null
  ownerId: string | null
  myRole: 'owner' | 'admin' | 'member'
  isPublic: boolean
  isPaid: boolean
  price: number
  inviteCode: string | null
  memberCount: number
  pinned: { id: string; content: string | null; createdAt: string }[]
  bans: {
    id: string
    name: string
    avatar: string
    username: string
    reason: string | null
    bannedAt: string
  }[]
  members: {
    id: string
    name: string
    avatar: string
    username: string
    phone: string | null
    role: 'owner' | 'admin' | 'member'
    joinedAt: string
  }[]
}

export interface PaymentInfo {
  balance: number
  spentTotal: number
  incomeTotal: number
  payments: { id: string; channelName: string; amount: number; method: string; createdAt: string }[]
  income: { id: string; channelName: string; amount: number; from: string; createdAt: string }[]
}

export interface ServerStats {
  storedMessages: number
  storedMediaBytes: number
  purgedMessages: number
  totalMessages: number
}
