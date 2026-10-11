'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Avatar, timeAgo } from './media'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Loader2,
  Search,
  Users,
  Ban,
  ShieldCheck,
  Megaphone,
  Send,
  Trash2,
  BarChart3,
  MessagesSquare,
  Radio,
  UserPlus,
  FileText,
  MessageSquare,
  Flag,
  Crown,
  RefreshCw,
  CircleCheck,
  CircleX,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'

const fmtSum = (n: number) => Math.round(n).toLocaleString('uz-UZ')

// ===== Tiplar =====
interface AdminStats {
  users: number
  bannedUsers: number
  admins: number
  groups: number
  channels: number
  directChats: number
  messages: number
  feedPosts: number
  ads: number
  contacts: number
  reports: number
  recentUsers: { id: string; username: string; name: string; avatar: string; createdAt: string }[]
}

interface AdminUser {
  id: string
  username: string
  name: string
  phone: string | null
  avatar: string
  bio: string | null
  isAdmin: boolean
  isBanned: boolean
  banReason: string | null
  createdAt: string
  messageCount: number
  chatCount: number
  postCount: number
}

interface AdminChat {
  id: string
  type: 'group' | 'channel'
  name: string | null
  description: string | null
  avatar: string | null
  isPublic: boolean
  isPaid: boolean
  price: number
  memberCount: number
  messageCount: number
  owner: { id: string; name: string; username: string; isBanned: boolean } | null
  createdAt: string
}

interface AdItem {
  id: string
  title: string
  text: string
  image: string | null
  link: string | null
  targetKind: 'groups' | 'channels' | 'all'
  status: string
  sentCount: number
  createdAt: string
  sentAt: string | null
}

type Tab = 'overview' | 'users' | 'chats' | 'ads'

const TARGET_LABEL: Record<string, string> = {
  groups: 'Guruhlarga',
  channels: 'Kanallarga',
  all: 'Hammaga (guruh + kanal + lenta)',
}

export default function AdminView() {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Foydalanuvchilar
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [usersLoading, setUsersLoading] = useState(false)
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banLoading, setBanLoading] = useState(false)

  // Chatlar
  const [chats, setChats] = useState<AdminChat[]>([])
  const [chatQuery, setChatQuery] = useState('')
  const [chatsLoading, setChatsLoading] = useState(false)

  // Reklama
  const [ads, setAds] = useState<AdItem[]>([])
  const [adTitle, setAdTitle] = useState('')
  const [adText, setAdText] = useState('')
  const [adLink, setAdLink] = useState('')
  const [adEmoji, setAdEmoji] = useState('📣')
  const [adTarget, setAdTarget] = useState<'groups' | 'channels' | 'all'>('all')
  const [adSaving, setAdSaving] = useState(false)
  const [adSending, setAdSending] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      setStats(await api<AdminStats>('/api/admin/stats'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async (q = '') => {
    setUsersLoading(true)
    try {
      const r = await api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`)
      setUsers(r.users)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const loadChats = useCallback(async (q = '') => {
    setChatsLoading(true)
    try {
      const r = await api<{ chats: AdminChat[] }>(`/api/admin/chats?q=${encodeURIComponent(q)}`)
      setChats(r.chats)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChatsLoading(false)
    }
  }, [])

  const loadAds = useCallback(async () => {
    try {
      const r = await api<{ ads: AdItem[] }>('/api/admin/ads')
      setAds(r.ads)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])
  useEffect(() => {
    if (tab === 'users') void loadUsers()
    if (tab === 'chats') void loadChats()
    if (tab === 'ads') void loadAds()
  }, [tab, loadUsers, loadChats, loadAds])

  // Qidiruv debounced
  useEffect(() => {
    if (tab !== 'users') return
    const t = setTimeout(() => void loadUsers(userQuery), 400)
    return () => clearTimeout(t)
  }, [userQuery, tab, loadUsers])
  useEffect(() => {
    if (tab !== 'chats') return
    const t = setTimeout(() => void loadChats(chatQuery), 400)
    return () => clearTimeout(t)
  }, [chatQuery, tab, loadChats])

  const userAction = async (u: AdminUser, action: string, reason?: string) => {
    try {
      const r = await api<{ message: string }>('/api/admin/users', {
        method: 'POST',
        body: { userId: u.id, action, reason },
      })
      toast.success(r.message)
      setBanTarget(null)
      setBanReason('')
      void loadUsers(userQuery)
      void loadStats()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const deleteChat = async (c: AdminChat) => {
    if (!confirm(`${c.name || 'Chat'} o'chirilsinmi? Barcha xabarlar ham o'chadi.`)) return
    try {
      const r = await api<{ message: string }>(`/api/admin/chats/${c.id}`, { method: 'DELETE' })
      toast.success(r.message)
      setChats((prev) => prev.filter((x) => x.id !== c.id))
      void loadStats()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const createAd = async () => {
    if (adTitle.trim().length < 3 || adText.trim().length < 5) {
      toast.error('Sarlavha kamida 3, matn kamida 5 belgi')
      return
    }
    setAdSaving(true)
    try {
      await api('/api/admin/ads', {
        method: 'POST',
        body: { title: adTitle.trim(), text: adText.trim(), link: adLink.trim(), image: adEmoji, targetKind: adTarget },
      })
      toast.success('Reklama saqlandi — endi "Yuborish" bosing')
      setAdTitle('')
      setAdText('')
      setAdLink('')
      void loadAds()
      void loadStats()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAdSaving(false)
    }
  }

  const sendAd = async (ad: AdItem) => {
    if (!confirm(`"${ad.title}" ${TARGET_LABEL[ad.targetKind]}ga yuborilsinmi?`)) return
    setAdSending(ad.id)
    try {
      const r = await api<{ message: string }>(`/api/admin/ads/${ad.id}/send`, { method: 'POST' })
      toast.success(r.message)
      void loadAds()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAdSending(null)
    }
  }

  const deleteAd = async (ad: AdItem) => {
    if (!confirm(`"${ad.title}" reklamasini o'chirsangiz, uni qaytarib olish mumkin emas.`)) return
    try {
      await api(`/api/admin/ads/${ad.id}`, { method: 'DELETE' })
      setAds((prev) => prev.filter((x) => x.id !== ad.id))
      toast.success('Reklama o\u2018chirildi')
      void loadStats()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'overview', label: 'Umumiy', icon: BarChart3 },
    { key: 'users', label: 'Foydalanuvchilar', icon: Users },
    { key: 'chats', label: 'Guruh & Kanal', icon: MessagesSquare },
    { key: 'ads', label: 'Reklama', icon: Megaphone },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Sarlavha + tablar */}
      <div className="px-4 md:px-6 pt-5 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          <span className="neu h-10 w-10 rounded-full flex items-center justify-center text-xl">
            🛡️
          </span>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight leading-none">Admin panel</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Dasturni to&apos;liq nazorat — foydalanuvchilar, guruhlar, kanallar va reklama
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="ml-auto rounded-full h-9 w-9"
            title="Yangilash"
            onClick={() => {
              void loadStats()
              if (tab === 'users') void loadUsers(userQuery)
              if (tab === 'chats') void loadChats(chatQuery)
              if (tab === 'ads') void loadAds()
            }}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'h-9 px-4 rounded-full text-sm whitespace-nowrap transition-all flex items-center gap-1.5 font-medium',
                tab === t.key
                  ? 'neu-sm text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="groove mx-1" />
      </div>

      <ScrollArea className="flex-1 px-4 md:px-6 pb-24 md:pb-6">
        {/* ===== UMUMIY ===== */}
        {tab === 'overview' && (
          <div className="space-y-5 max-w-3xl">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              </div>
            ) : stats ? (
              <>
                {/* Statistika kartalar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Foydalanuvchi', value: stats.users, icon: Users, color: 'text-acc-blue', sub: `${stats.admins} admin` },
                    { label: 'Guruhlar', value: stats.groups, icon: MessagesSquare, color: 'text-acc-green', sub: `${stats.directChats} shaxsiy suhbat` },
                    { label: 'Kanallar', value: stats.channels, icon: Radio, color: 'text-acc-purple', sub: `${stats.feedPosts} lenta post` },
                    { label: 'Xabarlar', value: stats.messages, icon: MessageSquare, color: 'text-acc-orange', sub: `${stats.contacts} kontakt` },
                  ].map((s) => (
                    <div key={s.label} className="neu p-4 rounded-[1.3rem]">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <s.icon className={cn('h-3.5 w-3.5', s.color)} /> {s.label}
                      </div>
                      <p className="text-2xl font-extrabold mt-1.5 leading-none">{s.value.toLocaleString('uz-UZ')}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{s.sub}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Bloklangan', value: stats.bannedUsers, icon: Ban, color: 'text-acc-red' },
                    { label: 'Reklamalar', value: stats.ads, icon: Megaphone, color: 'text-acc-orange' },
                    { label: 'Shikoyatlar', value: stats.reports, icon: Flag, color: 'text-acc-pink' },
                  ].map((s) => (
                    <div key={s.label} className="neu-sm flex items-center gap-3 p-3.5 rounded-[1.2rem]">
                      <span className="neu-xs h-9 w-9 rounded-full flex items-center justify-center shrink-0">
                        <s.icon className={cn('h-4 w-4', s.color)} />
                      </span>
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground">{s.label}</p>
                        <p className="text-lg font-bold leading-none mt-0.5">{s.value.toLocaleString('uz-UZ')}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Yangi foydalanuvchilar */}
                <div className="neu p-5 rounded-[1.6rem]">
                  <div className="flex items-center gap-2 mb-3">
                    <UserPlus className="h-4 w-4 text-acc-green" />
                    <h3 className="font-bold">Yangi foydalanuvchilar</h3>
                  </div>
                  <div className="space-y-1.5">
                    {stats.recentUsers.map((u) => (
                      <div key={u.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                        <Avatar emoji={u.avatar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{u.name}</p>
                          <p className="text-[11px] text-muted-foreground">@{u.username} · {timeAgo(u.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* ===== FOYDALANUVCHILAR ===== */}
        {tab === 'users' && (
          <div className="space-y-3 max-w-3xl">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Ism, username yoki telefon bilan qidirish..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                className="input-neu rounded-full border-0 pl-10"
              />
            </div>
            {usersLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {users.map((u) => (
                  <div key={u.id} className="neu flex items-center gap-3 p-3 rounded-[1.3rem]">
                    <Avatar emoji={u.avatar} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{u.name}</p>
                        {u.isAdmin && (
                          <span className="neu-badge px-1.5 h-4.5 flex items-center text-[9px] font-bold text-acc-blue shrink-0">
                            ADMIN
                          </span>
                        )}
                        {u.isBanned && (
                          <span className="neu-badge px-1.5 h-4.5 flex items-center text-[9px] font-bold text-acc-red shrink-0">
                            BLOKLANGAN
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        @{u.username}
                        {u.phone ? ` · ${u.phone}` : ''} · {u.messageCount} xabar · {u.chatCount} chat · {timeAgo(u.createdAt)}
                      </p>
                      {u.isBanned && u.banReason && (
                        <p className="text-[11px] text-acc-red truncate mt-0.5">Sabab: {u.banReason}</p>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="rounded-full h-8 px-3 shrink-0">
                          Boshqarish
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.isBanned ? (
                          <DropdownMenuItem onClick={() => void userAction(u, 'unban')}>
                            <CircleCheck className="h-4 w-4 text-acc-green" /> Blokdan chiqarish
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => { setBanTarget(u); setBanReason('') }}>
                            <CircleX className="h-4 w-4 text-acc-red" /> Bloklash
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {u.isAdmin ? (
                          <DropdownMenuItem onClick={() => void userAction(u, 'removeAdmin')}>
                            <ShieldCheck className="h-4 w-4 text-acc-orange" /> Adminlikdan olish
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void userAction(u, 'makeAdmin')}>
                            <Crown className="h-4 w-4 text-acc-blue" /> Admin qilish
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-10">Hech kim topilmadi</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== GURUH & KANALLAR ===== */}
        {tab === 'chats' && (
          <div className="space-y-3 max-w-3xl">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Guruh / kanal nomi bilan qidirish..."
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                className="input-neu rounded-full border-0 pl-10"
              />
            </div>
            {chatsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {chats.map((c) => (
                  <div key={c.id} className="neu flex items-center gap-3 p-3 rounded-[1.3rem]">
                    <div className="neu-avatar h-11 w-11 rounded-full flex items-center justify-center text-lg shrink-0">
                      {c.avatar || (c.type === 'channel' ? '📢' : '👥')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{c.name || 'Nomsiz'}</p>
                        <span className="neu-badge px-1.5 h-4.5 flex items-center text-[9px] font-bold text-muted-foreground shrink-0">
                          {c.type === 'channel' ? 'KANAL' : 'GURUH'}
                        </span>
                        {c.isPaid && (
                          <span className="neu-badge px-1.5 h-4.5 flex items-center text-[9px] font-bold text-acc-green shrink-0">
                            PULLIK
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.memberCount} a&apos;zo · {c.messageCount} xabar · egasi: {c.owner ? `${c.owner.name} (@${c.owner.username})` : '—'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full h-8 px-3 shrink-0 text-acc-red hover:text-acc-red"
                      onClick={() => void deleteChat(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> O&apos;chirish
                    </Button>
                  </div>
                ))}
                {chats.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-10">Hech narsa topilmadi</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== REKLAMA ===== */}
        {tab === 'ads' && (
          <div className="space-y-5 max-w-3xl">
            {/* Yangi reklama yaratish */}
            <div className="neu p-5 rounded-[1.6rem] space-y-3">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-acc-orange" />
                <h3 className="font-bold">Yangi reklama</h3>
              </div>
              <div className="grid md:grid-cols-[1fr_2fr] gap-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Belgi (emoji)</Label>
                    <Input value={adEmoji} onChange={(e) => setAdEmoji(e.target.value.slice(0, 4))} className="input-neu rounded-full border-0 text-center text-xl h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Havola (ixtiyoriy)</Label>
                    <Input value={adLink} onChange={(e) => setAdLink(e.target.value)} placeholder="@50gram kanal" className="input-neu rounded-full border-0 h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Qayerga yuborish</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(['all', 'groups', 'channels'] as const).map((k) => (
                        <button
                          key={k}
                          onClick={() => setAdTarget(k)}
                          className={cn(
                            'px-3 py-1.5 text-xs rounded-full font-semibold transition-all',
                            adTarget === k ? 'neu-sm text-foreground' : 'neu-in-sm text-muted-foreground'
                          )}
                        >
                          {TARGET_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Sarlavha</Label>
                    <Input value={adTitle} onChange={(e) => setAdTitle(e.target.value)} placeholder="Reklama sarlavhasi" className="input-neu rounded-full border-0 h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Matn</Label>
                    <Textarea value={adText} onChange={(e) => setAdText(e.target.value)} placeholder="Reklama matni..." className="input-neu min-h-20 resize-none rounded-2xl border-0" />
                  </div>
                  <Button className="w-full h-11 rounded-full" onClick={createAd} disabled={adSaving}>
                    {adSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                    Reklamani saqlash
                  </Button>
                </div>
              </div>
            </div>

            {/* Reklamalar ro'yxati */}
            <div className="space-y-2">
              {ads.length === 0 && (
                <p className="neu-in-sm text-sm text-muted-foreground text-center py-5 rounded-2xl">
                  Hali reklama yo&apos;q — yuqorida yaratib, keyin yuboring
                </p>
              )}
              {ads.map((ad) => (
                <div key={ad.id} className="neu p-4 rounded-[1.3rem] space-y-2.5">
                  <div className="flex items-start gap-3">
                    <span className="neu-xs h-9 w-9 rounded-full flex items-center justify-center text-lg shrink-0">
                      {ad.image || '📣'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">{ad.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-line">{ad.text}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full neu-in-sm text-muted-foreground">
                          {TARGET_LABEL[ad.targetKind]}
                        </span>
                        {ad.status === 'completed' ? (
                          <span className="text-[10px] font-bold text-acc-green flex items-center gap-1">
                            <CircleCheck className="h-3 w-3" /> Yuborilgan: {ad.sentCount} ta chatga
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                            Qoralama · {timeAgo(ad.createdAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="rounded-full h-8 px-4"
                      onClick={() => void sendAd(ad)}
                      disabled={adSending === ad.id}
                    >
                      {adSending === ad.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Send className="h-3.5 w-3.5 mr-1" />
                      )}
                      Yuborish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full h-8 px-3 text-acc-red hover:text-acc-red"
                      onClick={() => void deleteAd(ad)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Bloklash dialogi */}
      <Dialog open={!!banTarget} onOpenChange={(o) => !o && setBanTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold flex items-center gap-2">
              <Ban className="h-5 w-5 text-acc-red" />
              {banTarget?.name} bloklash
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Blok sababi</Label>
              <Textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Masalan: spam qilgan, qoidabuzarlik..."
                className="input-neu min-h-20 resize-none rounded-2xl border-0"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Bloklangan foydalanuvchi akkauntga kira olmaydi va xabar yubora olmaydi.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 h-11 rounded-full"
                disabled={banLoading}
                onClick={async () => {
                  if (!banTarget) return
                  setBanLoading(true)
                  await userAction(banTarget, 'ban', banReason.trim() || 'Dastur qoidalarini buzish')
                  setBanLoading(false)
                }}
              >
                {banLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4 mr-1" />}
                Bloklash
              </Button>
              <Button variant="outline" className="h-11 rounded-full" onClick={() => setBanTarget(null)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
