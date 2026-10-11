'use client'

import { create } from 'zustand'
import { io } from 'socket.io-client'
import { RealtimeSocket } from '@/lib/realtime'
import { api, getToken, setToken, type Me, type Topic } from '@/lib/api'

export type Screen = 'chats' | 'feed' | 'news' | 'profile' | 'admin'

interface UgState {
  // Auth
  me: Me | null
  authLoading: boolean
  topics: Topic[]
  onlineUserIds: Set<string>
  socket: Socket | null
  socketConnected: boolean

  // Navigatsiya
  screen: Screen
  activeChatId: string | null

  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (data: {
    username: string
    name: string
    phone?: string
    password: string
    avatar: string
    topicSlugs: string[]
  }) => Promise<void>
  logout: () => void
  setScreen: (s: Screen) => void
  openChat: (chatId: string | null) => void
  setTopics: (t: Topic[]) => void
  connectSocket: () => void
  disconnectSocket: () => void
  markOnline: (ids: string[]) => void
}

export const useStore = create<UgState>((set, get) => ({
  me: null,
  authLoading: true,
  topics: [],
  onlineUserIds: new Set(),
  socket: null,
  socketConnected: false,

  screen: 'chats',
  activeChatId: null,

  init: async () => {
    try {
      const topics = await api<Topic[]>('/api/topics')
      set({ topics })
    } catch {}

    if (!getToken()) {
      set({ authLoading: false })
      return
    }
    try {
      const me = await api<Me>('/api/me')
      set({ me, authLoading: false })
      get().connectSocket()
    } catch {
      setToken(null)
      set({ authLoading: false })
    }
  },

  login: async (username, password) => {
    const res = await api<{ token: string; me: Me }>('/api/auth/login', {
      body: { username, password },
    })
    setToken(res.token)
    set({ me: res.me })
    get().connectSocket()
  },

  register: async (data) => {
    const res = await api<{ token: string; me: Me }>('/api/auth/register', { body: data })
    setToken(res.token)
    set({ me: res.me })
    get().connectSocket()
  },

  logout: () => {
    get().disconnectSocket()
    setToken(null)
    set({ me: null, screen: 'chats', activeChatId: null, onlineUserIds: new Set() })
  },

  setScreen: (s) => set({ screen: s, activeChatId: null }),
  openChat: (chatId) => set({ activeChatId: chatId, screen: 'chats' }),
  setTopics: (t) => set({ topics: t }),

  connectSocket: () => {
    const { socket, me } = get()
    if (socket || !me) return
    // Dev muhitda (port 3000) XTransform proxy yo'q → chat-service'ga
    // to'g'ridan-to'g'ri ulanamiz; production'da XTransform header ishlaydi.
    // Cloudflare rejimi: NEXT_PUBLIC_WS_BASE berilgan bo'lsa — Durable Object
    // WebSocket'ga ulanamiz (socket.io emas). Aks holda lokal dev — socket.io.
    const wsBase =
      typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_WS_BASE as string | undefined) : undefined
    const s = wsBase
      ? (new RealtimeSocket(wsBase, me.id, getToken) as unknown as ReturnType<typeof io>)
      : (() => {
          const socketUrl =
            typeof window !== 'undefined' && window.location.port === '3000'
              ? `${window.location.protocol}//${window.location.hostname}:3003`
              : '/?XTransformPort=3003'
          return io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1500,
          })
        })()
    s.on('connect', () => {
      set({ socketConnected: true })
      s.emit('auth', { userId: me.id, token: getToken() })
    })
    s.on('disconnect', () => set({ socketConnected: false }))
    s.on('presence:state', (data: { online: string[] }) => {
      get().markOnline(data.online)
    })
    s.on('presence:update', (data: { userId: string; online: boolean }) => {
      const prev = new Set(get().onlineUserIds)
      if (data.online) prev.add(data.userId)
      else prev.delete(data.userId)
      set({ onlineUserIds: prev })
    })
    set({ socket: s })
  },

  disconnectSocket: () => {
    get().socket?.disconnect()
    set({ socket: null, socketConnected: false })
  },

  markOnline: (ids) => set({ onlineUserIds: new Set(ids) }),
}))
