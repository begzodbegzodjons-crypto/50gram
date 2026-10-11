'use client'

import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type ChannelInfo, type ChatInfo } from '@/lib/api'
import { Avatar, timeAgo, Logo3D, CHANNEL_EMOJIS } from './media'
import { clearChatMessages } from '@/lib/local-store'
import ChatPanel from './chat-panel'
import ChannelAdmin from './channel-admin'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Users,
  Search,
  Loader2,
  Megaphone,
  Compass,
  Ticket,
  Crown,
  MoreVertical,
  BellOff,
  Bell,
  Eraser,
  Trash2,
  Ban,
  Flag,
  LogOut,
} from 'lucide-react'
import { toast } from 'sonner'

interface UserBrief {
  id: string
  username: string
  name: string
  avatar: string
  bio: string | null
  phone?: string | null
}

type Filter = 'all' | 'channel' | 'group' | 'direct'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Barchasi' },
  { key: 'direct', label: 'Shaxsiy' },
  { key: 'group', label: 'Guruhlar' },
  { key: 'channel', label: 'Kanallar' },
]

const fmtSum = (n: number) => n.toLocaleString('uz-UZ')

export default function ChatsView() {
  const me = useStore((s) => s.me)
  const socket = useStore((s) => s.socket)
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)
  const onlineUserIds = useStore((s) => s.onlineUserIds)

  const [chats, setChats] = useState<ChatInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [adminChatId, setAdminChatId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<UserBrief[]>([])
  const [creating, setCreating] = useState(false)

  // Guruh formasi
  const [groupName, setGroupName] = useState('')
  const [groupAvatar, setGroupAvatar] = useState('👥')
  const [groupPrivate, setGroupPrivate] = useState(false)

  // Kanal formasi
  const [chName, setChName] = useState('')
  const [chAvatar, setChAvatar] = useState('📢')
  const [chDesc, setChDesc] = useState('')
  const [chPublic, setChPublic] = useState(true)
  const [chPaid, setChPaid] = useState(false)
  const [chPrice, setChPrice] = useState('')

  // Kashf etish
  const [discover, setDiscover] = useState<ChannelInfo[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [balance, setBalance] = useState(me?.balance ?? 0)

  const refresh = useCallback(async () => {
    try {
      const list = await api<ChatInfo[]>('/api/chats')
      setChats(list)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh, activeChatId])

  // Yangi xabar → chatlar ro'yxatini yangilash
  useEffect(() => {
    if (!socket) return
    const handler = () => void refresh()
    socket.on('chat:message', handler)
    socket.on('chat:sync', handler)
    return () => {
      socket.off('chat:message', handler)
      socket.off('chat:sync', handler)
    }
  }, [socket, refresh])

  // Foydalanuvchi qidirish (ism / username / telefon)
  useEffect(() => {
    if (!newChatOpen) return
    const t = setTimeout(async () => {
      try {
        const r = await api<UserBrief[]>(`/api/users?q=${encodeURIComponent(search)}`)
        setResults(r)
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [search, newChatOpen])

  // Kashf etish ro'yxati
  const loadDiscover = useCallback(async () => {
    setDiscovering(true)
    try {
      const r = await api<ChannelInfo[]>('/api/channels/discover')
      setDiscover(r)
    } catch {}
    setDiscovering(false)
  }, [])

  useEffect(() => {
    if (discoverOpen) void loadDiscover()
  }, [discoverOpen, loadDiscover])

  const startDirect = async (userId: string) => {
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/chats', {
        body: { type: 'direct', memberId: userId },
      })
      setNewChatOpen(false)
      setSearch('')
      await refresh()
      openChat(res.chatId)
    } finally {
      setCreating(false)
    }
  }

  const createGroup = async () => {
    if (groupName.trim().length < 2) return
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/chats', {
        body: {
          type: 'group',
          name: groupName.trim(),
          avatar: groupAvatar,
          isPublic: !groupPrivate,
          memberIds: [],
        },
      })
      setNewGroupOpen(false)
      setGroupName('')
      setGroupPrivate(false)
      await refresh()
      openChat(res.chatId)
    } finally {
      setCreating(false)
    }
  }

  const createChannel = async () => {
    if (chName.trim().length < 2) return
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/chats', {
        body: {
          type: 'channel',
          name: chName.trim(),
          avatar: chAvatar,
          description: chDesc,
          isPublic: chPublic,
          isPaid: chPaid,
          price: chPaid ? Number(chPrice) || 0 : 0,
        },
      })
      setNewChannelOpen(false)
      setChName('')
      setChDesc('')
      setChPaid(false)
      setChPrice('')
      setChPublic(true)
      await refresh()
      openChat(res.chatId)
      toast.success('Kanal yaratildi — endi boshqaruv panelidan post qo\u2018shing')
    } finally {
      setCreating(false)
    }
  }

  // ===== Obuna bo'lish (bepul / pullik) =====
  const joinChannel = async (c: ChannelInfo) => {
    setJoiningId(c.id)
    try {
      const res = await api<{ chatId: string; paid?: number }>(`/api/chats/${c.id}/join`, { body: {} })
      if (res.paid && res.paid > 0) {
        setBalance((b) => b - res.paid!)
        toast.success(`Obuna bo\u2018ldingiz! ${fmtSum(res.paid)} so\u2018m to\u2018landi`)
      } else {
        toast.success('Obuna bo\u2018ldingiz ✅')
      }
      await refresh()
      openChat(c.id)
      setDiscoverOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setJoiningId(null)
    }
  }

  // ===== Chat amallari (menyu) =====
  const refreshChat = useCallback(async () => {
    try {
      const list = await api<ChatInfo[]>('/api/chats')
      setChats(list)
    } catch {}
  }, [])

  const toggleMute = async (c: ChatInfo) => {
    try {
      const r = await api<{ muted: boolean }>(`/api/chats/${c.id}/mute`, { body: { muted: !c.muted } })
      toast.success(r.muted ? 'Chat ovozsiz qilindi 🔕' : 'Ovozi yoqildi 🔔')
      void refreshChat()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const clearChat = (c: ChatInfo) => {
    socket?.emit('chat:clear', { chatId: c.id })
    void clearChatMessages(c.id)
    if (activeChatId === c.id) {
      // ochiq chat bo'lsa ChatPanel ham 'chat:cleared' orqali tozalaydi
    }
    toast.success('Suhbat tarixi tozalandi 🧹')
  }

  const reportSpam = async (c: ChatInfo) => {
    try {
      await api('/api/reports', {
        body: { chatId: c.id, targetUserId: c.type === 'direct' ? c.otherUserId : null, kind: 'spam' },
      })
      toast.success('Shikoyat yuborildi — rahmat!')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const blockUser = async (c: ChatInfo) => {
    if (!c.otherUserId) return
    try {
      await api('/api/blocks', { body: { userId: c.otherUserId } })
      toast.success('Foydalanuvchi bloklandi — endi sizga yozolmaydi')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const deleteChatRow = async (c: ChatInfo) => {
    try {
      if (c.type === 'direct') {
        await api(`/api/chats/${c.id}/leave`, { body: {} })
        toast.success('Suhbat o\'chirildi')
      } else if (c.ownerId === me?.id) {
        await api(`/api/chats/${c.id}`, { method: 'DELETE' })
        toast.success(c.type === 'channel' ? 'Kanal o\'chirildi' : 'Guruh o\'chirildi')
      } else {
        await api(`/api/chats/${c.id}/leave`, { body: {} })
        toast.success(c.type === 'channel' ? 'Obunadan chiqdingiz' : 'Guruhdan chiqdingiz')
      }
      await clearChatMessages(c.id)
      if (activeChatId === c.id) openChat(null)
      void refreshChat()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const joinByCode = async () => {
    if (!inviteCode.trim()) return
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/join', { body: { code: inviteCode.trim() } })
      setInviteCode('')
      setDiscoverOpen(false)
      await refresh()
      openChat(res.chatId)
      toast.success('Taklifnoma orqali qo\u2018shildingiz 🎉')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const visible = chats.filter((c) => filter === 'all' || c.type === filter)

  const renderChatRow = (c: ChatInfo) => {
    const active = activeChatId === c.id
    const canManage = c.ownerId === me?.id || c.myRole === 'admin'
    return (
      <div
        key={c.id}
        className={cn(
          'group relative flex items-center gap-1 rounded-[1.4rem] transition-all',
          active ? 'neu-sm' : 'hover:bg-accent/50'
        )}
      >
        <button
          onClick={() => openChat(c.id)}
          className="flex-1 flex items-center gap-3 px-3 py-3 text-left min-w-0"
        >
          <Avatar emoji={c.avatar} online={c.type === 'direct' && onlineUserIds.has(c.otherUserId ?? '')} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm truncate text-foreground flex items-center gap-1.5">
                <span className="truncate">{c.name}</span>
                {c.muted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                {c.type === 'channel' && c.isPaid && (
                  <span className="neu-badge px-1.5 py-0.5 text-[8px] font-bold shrink-0">PRO</span>
                )}
                {canManage && c.type !== 'direct' && (
                  <Crown className="h-3 w-3 text-acc-orange shrink-0" />
                )}
              </p>
              <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                {timeAgo(c.lastMessageAt)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p className="text-xs text-muted-foreground truncate">
                {c.type === 'channel'
                  ? c.description || 'kanal'
                  : c.type === 'group'
                    ? `${c.memberCount} a\u2019zo`
                    : '@' + (c.members?.find((m) => m.id === c.otherUserId)?.username ?? 'suhbat')}
              </p>
              {c.unreadCount > 0 && (
                <span className="neu-badge min-w-5 h-5 px-1.5 text-[11px] font-bold flex items-center justify-center shrink-0 leading-none">
                  {c.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Chat amallari menyusi */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/70 transition-all mr-1.5"
              title="Amallar"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void toggleMute(c)}>
              {c.muted ? <Bell className="h-4 w-4 mr-2" /> : <BellOff className="h-4 w-4 mr-2" />}
              {c.muted ? 'Ovozini yoqish' : 'Ovozsiz qilish'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => clearChat(c)}>
              <Eraser className="h-4 w-4 mr-2" /> Tarixni tozalash
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reportSpam(c)}>
              <Flag className="h-4 w-4 mr-2" /> Spam deb xabar qilish
            </DropdownMenuItem>
            {c.type === 'direct' && c.otherUserId && (
              <DropdownMenuItem onClick={() => void blockUser(c)}>
                <Ban className="h-4 w-4 mr-2" /> Bloklash
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void deleteChatRow(c)}
              className="text-acc-red focus:text-acc-red"
            >
              {c.type === 'direct' ? (
                <>
                  <Trash2 className="h-4 w-4 mr-2" /> Suhbatni o&apos;chirish
                </>
              ) : c.ownerId === me?.id ? (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {c.type === 'channel' ? 'Kanalni o&apos;chirish' : 'Guruhni o&apos;chirish'}
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4 mr-2" />
                  {c.type === 'channel' ? 'Obunadan chiqish' : 'Guruhdan chiqish'}
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Chatlar ro'yxati */}
      <div
        className={cn(
          'w-full md:w-80 lg:w-96 flex flex-col bg-background',
          activeChatId && 'hidden md:flex'
        )}
      >
        <div className="p-4 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-2xl font-extrabold tracking-tight">Suhbatlar</h2>
            <div className="flex gap-1.5 shrink-0">
              {/* Yangi guruh */}
              <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" title="Yangi guruh" className="rounded-full">
                    <Users className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-bold">Yangi guruh</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="neu-avatar h-14 w-14 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-2xl">
                        {groupAvatar}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['👥','🎮','🍔','🎓','🏠','⚽','🎨','📚'].map((e) => (
                          <button
                            key={e}
                            onClick={() => setGroupAvatar(e)}
                            className={cn(
                              'h-8 w-8 rounded-full text-base flex items-center justify-center transition-all',
                              groupAvatar === e ? 'neu-active' : 'neu-xs neu-press'
                            )}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Guruh nomi</Label>
                      <Input
                        placeholder="Masalan: Do'stlar jamoasi"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                        className="input-neu rounded-full border-0"
                      />
                    </div>
                    <div className="flex items-center justify-between neu-in-sm px-4 py-3 rounded-2xl">
                      <div>
                        <p className="text-sm font-semibold">Yopiq guruh</p>
                        <p className="text-[11px] text-muted-foreground">Faqat taklifnoma kodi bilan</p>
                      </div>
                      <Switch checked={groupPrivate} onCheckedChange={setGroupPrivate} />
                    </div>
                    <Button onClick={createGroup} disabled={creating || groupName.trim().length < 2} className="w-full rounded-full">
                      Guruh yaratish
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Yangi kanal */}
              <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" title="Yangi kanal" className="rounded-full">
                    <Megaphone className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[86vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="font-bold">Yangi kanal</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="neu-avatar h-14 w-14 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-2xl">
                        {chAvatar}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CHANNEL_EMOJIS.slice(0, 8).map((e) => (
                          <button
                            key={e}
                            onClick={() => setChAvatar(e)}
                            className={cn(
                              'h-8 w-8 rounded-full text-base flex items-center justify-center transition-all',
                              chAvatar === e ? 'neu-active' : 'neu-xs neu-press'
                            )}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Kanal nomi</Label>
                      <Input
                        placeholder="Masalan: Texnologiyalar dunyosi"
                        value={chName}
                        onChange={(e) => setChName(e.target.value)}
                        className="input-neu rounded-full border-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Tavsif</Label>
                      <Textarea
                        placeholder="Kanal haqida qisqacha..."
                        value={chDesc}
                        onChange={(e) => setChDesc(e.target.value)}
                        className="input-neu min-h-14 resize-none rounded-2xl border-0"
                      />
                    </div>
                    <div className="flex items-center justify-between neu-in-sm px-4 py-3 rounded-2xl">
                      <div>
                        <p className="text-sm font-semibold">Ochiq kanal</p>
                        <p className="text-[11px] text-muted-foreground">
                          {chPublic ? 'Hammaga kashf etishda ko\u2018rinadi' : 'Yopiq — taklifnoma kodi bilan'}
                        </p>
                      </div>
                      <Switch checked={chPublic} onCheckedChange={setChPublic} />
                    </div>
                    <div className="flex items-center justify-between neu-in-sm px-4 py-3 rounded-2xl">
                      <div>
                        <p className="text-sm font-semibold">Pullik obuna</p>
                        <p className="text-[11px] text-muted-foreground">
                          {chPaid ? 'A\u2019zolar to\u2018lov qiladi' : 'Bepul obuna'}
                        </p>
                      </div>
                      <Switch checked={chPaid} onCheckedChange={setChPaid} />
                    </div>
                    {chPaid && (
                      <div className="space-y-2">
                        <Label className="font-semibold">Obuna narxi (so&apos;m/oy)</Label>
                        <Input
                          inputMode="numeric"
                          placeholder="masalan: 25000"
                          value={chPrice}
                          onChange={(e) => setChPrice(e.target.value.replace(/\D/g, ''))}
                          className="input-neu rounded-full border-0"
                        />
                      </div>
                    )}
                    <Button onClick={createChannel} disabled={creating || chName.trim().length < 2} className="w-full rounded-full">
                      Kanal yaratish
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Kashf etish */}
              <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" title="Kanallarni kashf etish" className="rounded-full">
                    <Compass className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[86vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="font-bold flex items-center gap-2">
                      Kanallarni kashf etish
                      <span className="neu-in-sm px-2.5 py-1 rounded-full text-[10px] font-bold text-muted-foreground">
                        hamyon: {fmtSum(balance)} so&apos;m
                      </span>
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Ticket className="h-3.5 w-3.5" /> Taklifnoma kodi bilan qo&apos;shilish
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="50g-xxxxxx"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && joinByCode()}
                        className="input-neu rounded-full border-0 flex-1"
                      />
                      <Button onClick={() => void joinByCode()} disabled={creating || !inviteCode.trim()} className="rounded-full shrink-0">
                        Qo&apos;shilish
                      </Button>
                    </div>
                  </div>
                  <div className="groove" />
                  <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
                    <div className="space-y-1.5 pb-2">
                      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Ochiq kanallar
                      </Label>
                      {discovering ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : discover.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Hali ochiq kanal yo&apos;q</p>
                      ) : (
                        discover.map((c) => (
                          <div key={c.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.2rem]">
                            <Avatar emoji={c.avatar} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold truncate">{c.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {c.memberCount} obunachi
                                {c.isPaid && c.price > 0 ? ` · ${fmtSum(c.price)} so\u2018m/oy` : ' · bepul'}
                              </p>
                            </div>
                            {c.subscribed || c.mine ? (
                              <span className="neu-in-sm px-3 py-1.5 rounded-full text-[11px] font-bold text-muted-foreground shrink-0">
                                {c.mine ? 'sizniki' : 'a\u2019zosiz'}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                className="rounded-full h-8 px-3.5 shrink-0"
                                disabled={joiningId === c.id}
                                onClick={() => void joinChannel(c)}
                              >
                                {joiningId === c.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : c.isPaid && c.price > 0 ? (
                                  `${fmtSum(c.price)} so\u2018m`
                                ) : (
                                  'A\u2019zo bo\u2018lish'
                                )}
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Qidiruv — ichkariga botgan pill */}
          <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
            <DialogTrigger asChild>
              <button className="input-neu w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-muted-foreground hover:opacity-90 transition-opacity">
                <Search className="h-4 w-4 shrink-0" />
                Qidiring — ism, username yoki telefon...
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-bold">Suhbat boshlash</DialogTitle>
              </DialogHeader>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ism, username yoki telefon raqam..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input-neu rounded-full border-0 pl-10"
                />
              </div>
              <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1.5">
                {results.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Hech kim topilmadi
                  </p>
                )}
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => startDirect(u.id)}
                    disabled={creating}
                    className="neu-sm neu-press w-full flex items-center gap-3 p-2.5 rounded-[1.2rem] text-left"
                  >
                    <Avatar emoji={u.avatar} size="sm" />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        @{u.username}
                        {u.phone ? ` · ${u.phone}` : ''}
                      </p>
                    </div>
                    {creating && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {/* Pill filtrlar */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
            {FILTERS.map((f) => {
              const count = f.key === 'all' ? chats.length : chats.filter((c) => c.type === f.key).length
              if (f.key !== 'all' && count === 0) return null
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'h-9 px-4 rounded-full text-sm whitespace-nowrap transition-all flex items-center gap-1.5',
                    active
                      ? 'neu-sm text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                  {f.key !== 'all' && count > 0 && (
                    <span className="neu-badge h-4.5 min-w-4.5 px-1 text-[10px] font-bold flex items-center justify-center leading-none">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="groove mx-5" />

        <ScrollArea className="flex-1 px-3 py-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 px-4">
              <p className="neu-in-sm inline-flex h-16 w-16 items-center justify-center rounded-full text-3xl mb-3">💬</p>
              <p className="font-semibold text-foreground">Hali suhbat yo&apos;q</p>
              <p className="text-sm mt-1">&quot;Qidirish&quot; maydoni bilan boshlang</p>
            </div>
          ) : (
            <div className="space-y-1">{visible.map(renderChatRow)}</div>
          )}
        </ScrollArea>
      </div>

      {/* Vertikal ajratuvchi */}
      <div className="hidden md:block groove-v my-5" />

      {/* Chat paneli */}
      <div className={cn('flex-1', !activeChatId && 'hidden md:flex')}>
        {activeChatId ? (
          <ChatPanel
            chatId={activeChatId}
            onBack={() => openChat(null)}
            onOpenAdmin={(id) => setAdminChatId(id)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="neu h-24 w-24 rounded-[1.8rem] flex items-center justify-center text-5xl mb-5 neu-float">
              ✈️
            </div>
            <h3 className="text-3xl font-extrabold mb-3">
              <Logo3D />
            </h3>
            <div className="groove w-48 my-3" />
            <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
              Chapdan suhbat tanlang yoki yangi suhbat, guruh va kanal boshlang
            </p>
          </div>
        )}
      </div>

      {/* Boshqaruv paneli */}
      {adminChatId && (
        <ChannelAdmin
          chatId={adminChatId}
          open={!!adminChatId}
          onOpenChange={(v) => {
            if (!v) {
              setAdminChatId(null)
              void refresh()
            }
          }}
          onDeleted={() => {
            setAdminChatId(null)
            openChat(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
