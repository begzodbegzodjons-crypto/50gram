'use client'

// ============================================================
// ChannelAdmin — KANAL VA GURUH to'liq boshqaruv paneli
//   Tab 1: Postlar — yangi post (matn / rasm+izoh), o'chirish, qadash
//   Tab 2: A'zolar — qidirib qo'shish, olib tashlash, admin qilish
//   Tab 3: Sozlamalar — nom/tavsif/avatar, ochiq-yopiq, pullik-narx,
//          taklifnoma kodi, kanalni o'chirish
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type ChannelDetail, type ServerMessage } from '@/lib/api'
import { compressImage, encryptForChat } from '@/lib/local-store'
import { Avatar, timeAgo, CHANNEL_EMOJIS } from './media'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Settings,
  Users,
  Megaphone,
  ImagePlus,
  X,
  Copy,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Crown,
  ShieldCheck,
  Link2,
  Search,
  Ban,
  Eraser,
} from 'lucide-react'
import { toast } from 'sonner'

interface UserBrief {
  id: string
  username: string
  name: string
  avatar: string
  phone?: string | null
}

type TabKey = 'posts' | 'members' | 'bans' | 'settings'

export default function ChannelAdmin({
  chatId,
  open,
  onOpenChange,
  onDeleted,
}: {
  chatId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted: () => void
}) {
  const me = useStore((s) => s.me)
  const socket = useStore((s) => s.socket)

  const [detail, setDetail] = useState<ChannelDetail | null>(null)
  const [posts, setPosts] = useState<ServerMessage[]>([])
  const [tab, setTab] = useState<TabKey>('posts')
  const [loading, setLoading] = useState(true)
  const [canAdmin, setCanAdmin] = useState(false)

  // Composer
  const [postText, setPostText] = useState('')
  const [postImage, setPostImage] = useState<File | null>(null)
  const [postPreview, setPostPreview] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // A'zolar
  const [memberQuery, setMemberQuery] = useState('')
  const [found, setFound] = useState<UserBrief[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  // Sozlamalar (form)
  const [fName, setFName] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fAvatar, setFAvatar] = useState('📢')
  const [fPublic, setFPublic] = useState(true)
  const [fPaid, setFPaid] = useState(false)
  const [fPrice, setFPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api<ChannelDetail>(`/api/chats/${chatId}`)
      setDetail(d)
      setCanAdmin(['owner', 'admin'].includes(d.myRole))
      setFName(d.name ?? '')
      setFDesc(d.description ?? '')
      setFAvatar(d.avatar ?? (d.type === 'channel' ? '📢' : '👥'))
      setFPublic(d.isPublic)
      setFPaid(d.isPaid)
      setFPrice(d.isPaid ? String(d.price) : '')
      const msgs = await api<{ recent: ServerMessage[] }>(`/api/chats/${chatId}/messages`)
      setPosts(msgs.recent.slice().reverse())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Socket: post o'chirilganda/boshqa admin post qo'shganda ro'yxatni yangilash
  useEffect(() => {
    if (!open || !socket) return
    const onDeleted = (d: { chatId: string; messageId: string }) => {
      if (d.chatId !== chatId) return
      setPosts((p) => p.filter((x) => x.id !== d.messageId))
    }
    const onNew = (m: ServerMessage) => {
      if (m.chatId !== chatId) return
      setPosts((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]))
    }
    const onPinned = (d: { chatId: string; messageId: string; pinned: boolean }) => {
      if (d.chatId !== chatId) return
      setPosts((p) => p.map((x) => (x.id === d.messageId ? { ...x, pinned: d.pinned } : x)))
    }
    const onCleared = (d: { chatId: string }) => {
      if (d.chatId !== chatId) return
      setPosts([])
    }
    socket.on('chat:deleted', onDeleted)
    socket.on('chat:message', onNew)
    socket.on('chat:pinned', onPinned)
    socket.on('chat:cleared', onCleared)
    return () => {
      socket.off('chat:deleted', onDeleted)
      socket.off('chat:message', onNew)
      socket.off('chat:pinned', onPinned)
      socket.off('chat:cleared', onCleared)
    }
  }, [open, socket, chatId])

  // A'zo qidirish
  useEffect(() => {
    if (tab !== 'members') return
    const t = setTimeout(async () => {
      try {
        const r = await api<UserBrief[]>(`/api/users?q=${encodeURIComponent(memberQuery)}`)
        const memberIds = new Set((detail?.members ?? []).map((m) => m.id))
        setFound(r.filter((u) => !memberIds.has(u.id)).slice(0, 8))
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [memberQuery, tab, detail])

  // ===== Yangi post yuborish (matn yoki rasm+izoh) =====
  const sendPost = async () => {
    if (!socket || !me || posting) return
    const text = postText.trim()
    if (!text && !postImage) return

    setPosting(true)
    try {
      const tempId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      if (postImage) {
        const compressed = await compressImage(postImage)
        if (compressed.size > 3 * 1024 * 1024) {
          toast.error('Rasm juda katta — kichikroq rasm tanlang')
          return
        }
        const encrypted = await encryptForChat(chatId, await compressed.arrayBuffer())
        socket.emit('chat:send', {
          chatId,
          tempId,
          type: 'image',
          content: encrypted,
          caption: text || null,
          mediaName: postImage.name,
        })
      } else {
        socket.emit('chat:send', { chatId, tempId, type: 'text', content: text })
      }
      setPostText('')
      setPostImage(null)
      setPostPreview(null)
      toast.success('Post e\u2019lon qilindi ✅')
    } catch (e) {
      toast.error((e as Error).message || 'Post yuborilmadi')
    } finally {
      setPosting(false)
    }
  }

  const pickImage = (f: File | null) => {
    setPostImage(f)
    setPostPreview(f ? URL.createObjectURL(f) : null)
  }

  // ===== Post amallari =====
  const deletePost = (m: ServerMessage) => {
    socket?.emit('chat:delete', { chatId, messageId: m.id })
    setPosts((p) => p.filter((x) => x.id !== m.id))
    toast.success('Post o\u2018chirildi')
  }

  // ===== Barcha postlarni tozalash =====
  const clearAllPosts = () => {
    socket?.emit('chat:clear', { chatId })
    toast.success('Barcha postlar tozalanmoqda...')
  }

  // ===== Qora ro'yxat amallari =====
  const banMember = async (u: ChannelDetail['members'][number]) => {
    setBusyId(u.id)
    try {
      await api(`/api/chats/${chatId}/ban`, { body: { userId: u.id } })
      await load()
      toast.success(`${u.name} qora ro\u2018yxatga qo\u2018shildi`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const unbanUser = async (u: ChannelDetail['bans'][number]) => {
    setBusyId(u.id)
    try {
      await api(`/api/chats/${chatId}/ban`, { method: 'DELETE', body: { userId: u.id } })
      await load()
      toast.success(`${u.name} qora ro\u2018yxatdan chiqarildi`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const togglePin = (m: ServerMessage) => {
    socket?.emit('chat:pin', { chatId, messageId: m.id, pinned: !m.pinned })
    setPosts((p) => p.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)))
  }

  // ===== A'zo amallari =====
  const addMember = async (u: UserBrief) => {
    setBusyId(u.id)
    try {
      await api(`/api/chats/${chatId}/members`, { body: { userId: u.id } })
      setFound((f) => f.filter((x) => x.id !== u.id))
      await load()
      toast.success(`${u.name} qo\u2018shildi`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const removeMember = async (u: ChannelDetail['members'][number]) => {
    setBusyId(u.id)
    try {
      await api(`/api/chats/${chatId}/members`, { method: 'DELETE', body: { userId: u.id } })
      await load()
      toast.success(`${u.name} olib tashlandi`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const setRole = async (u: ChannelDetail['members'][number], role: 'admin' | 'member') => {
    setBusyId(u.id)
    try {
      await api(`/api/chats/${chatId}/members`, { method: 'PATCH', body: { userId: u.id, role } })
      await load()
      toast.success(role === 'admin' ? `${u.name} endi admin` : `${u.name} oddiy a\u2018zo`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  // ===== Sozlamalarni saqlash =====
  const saveSettings = async () => {
    setSaving(true)
    try {
      await api(`/api/chats/${chatId}`, {
        method: 'PATCH',
        body: {
          name: fName,
          description: fDesc,
          avatar: fAvatar,
          isPublic: fPublic,
          isPaid: fPaid,
          price: fPaid ? Math.max(0, Number(fPrice) || 0) : 0,
        },
      })
      await load()
      toast.success('Sozlamalar saqlandi ✅')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const regenerateInvite = async () => {
    try {
      await api(`/api/chats/${chatId}`, { method: 'PATCH', body: { regenerateInvite: true } })
      await load()
      toast.success('Yangi taklifnoma kodi yaratildi')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const deleteChat = async () => {
    try {
      await api(`/api/chats/${chatId}`, { method: 'DELETE' })
      toast.success(detail?.type === 'channel' ? 'Kanal o\u2018chirildi' : 'Guruh o\u2018chirildi')
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const leaveChat = async () => {
    try {
      await api(`/api/chats/${chatId}/leave`, { body: {} })
      toast.success('Chiqdingiz')
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const isOwner = detail?.myRole === 'owner'
  const isChannel = detail?.type === 'channel'

  const TABS: { key: TabKey; label: string; icon: typeof Megaphone }[] = [
    { key: 'posts', label: 'Postlar', icon: Megaphone },
    { key: 'members', label: 'A\u2019zolar', icon: Users },
    ...(canAdmin ? [{ key: 'bans' as TabKey, label: 'Qora ro\u2018yxat', icon: Ban }] : []),
    { key: 'settings', label: 'Sozlamalar', icon: Settings },
  ]

  const roleBadge = (role: string) => {
    if (role === 'owner')
      return (
        <span className="neu-xs inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-acc-orange">
          <Crown className="h-3 w-3" /> Egasi
        </span>
      )
    if (role === 'admin')
      return (
        <span className="neu-xs inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-acc-blue">
          <ShieldCheck className="h-3 w-3" /> Admin
        </span>
      )
    return <span className="neu-in-sm px-2 py-0.5 rounded-full text-[10px] font-semibold text-muted-foreground">a&apos;zo</span>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[86vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-bold flex items-center gap-2.5">
            <span className="neu-sm h-9 w-9 rounded-full flex items-center justify-center text-lg">
              {detail?.avatar ?? (isChannel ? '📢' : '👥')}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{detail?.name}</span>
              <span className="block text-[11px] font-medium text-muted-foreground">
                {isChannel ? 'Kanal boshqaruvi' : 'Guruh boshqaruvi'} · {detail?.memberCount} {'a\u2019zo'}
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Tab tugmalari */}
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-1 h-9 rounded-full text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all',
                tab === t.key ? 'neu-sm neu-press text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground text-center py-8">Ma&apos;lumot topilmadi</p>
        ) : (
          <ScrollArea className="flex-1 min-h-0 -mx-2 px-2">
            <div className="pb-2">
              {/* ================= POSTLAR ================= */}
              {tab === 'posts' && canAdmin && (
                <div className="space-y-4">
                  {/* Composer */}
                  <div className="neu-in-sm p-3.5 space-y-3 rounded-[1.3rem]">
                    <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Yangi post
                    </Label>
                    {postPreview && (
                      <div className="relative">
                        { }
                        <img src={postPreview} alt="Tanlangan rasm" className="rounded-xl max-h-40 w-auto object-cover" />
                        <button
                          onClick={() => pickImage(null)}
                          className="absolute top-1.5 right-1.5 neu-sm h-7 w-7 rounded-full flex items-center justify-center"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <Textarea
                      placeholder={postImage ? 'Rasmga izoh yozing (ixtiyoriy)...' : 'Post matni...'}
                      value={postText}
                      onChange={(e) => setPostText(e.target.value)}
                      className="input-neu min-h-16 resize-none rounded-2xl border-0"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onClick={(e) => {
                          // value'ni tanlash boshlanishida tozalash — File reference buzmashligi uchun
                          e.currentTarget.value = ''
                        }}
                        onChange={(e) => {
                          pickImage(e.target.files?.[0] ?? null)
                        }}
                      />
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => fileRef.current?.click()}>
                        <ImagePlus className="h-4 w-4 mr-1" /> Rasm
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-full ml-auto"
                        onClick={() => void sendPost()}
                        disabled={posting || (!postText.trim() && !postImage)}
                      >
                        {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        E&apos;lon qilish
                      </Button>
                    </div>
                  </div>

                  {/* Postlar ro'yxati */}
                  {posts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      Hali post yo&apos;q — yuqoridan boshlang
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {posts.map((m) => (
                        <div key={m.id} className="neu-sm p-3 rounded-[1.2rem]">
                          <div className="flex items-start gap-2.5">
                            <span className="neu-xs h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-sm">
                              {m.type === 'image' ? '📷' : '✍️'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-sm break-words', m.pinned && 'font-semibold')}>
                                {m.type === 'image'
                                  ? m.caption || '📷 Rasmli post'
                                  : m.content || '(bo\u2018sh post)'}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {timeAgo(m.createdAt)}
                                {m.pinned && ' · 📌 qadalgan'}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => togglePin(m)}
                                title={m.pinned ? 'Qadashni yechish' : 'Qadash'}
                                className="neu-xs neu-press h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground"
                              >
                                {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                onClick={() => deletePost(m)}
                                title="O'chirish"
                                className="neu-xs neu-press h-7 w-7 rounded-full flex items-center justify-center text-acc-red"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tab === 'posts' && !canAdmin && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Post boshqaruvi faqat egasi va adminlar uchun
                </p>
              )}

              {/* ================= A'ZOLAR ================= */}
              {tab === 'members' && (
                <div className="space-y-4">
                  {canAdmin && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        A&apos;zo qo&apos;shish — ism, username yoki telefon
                      </Label>
                      <div className="relative">
                        <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Qidirish..."
                          value={memberQuery}
                          onChange={(e) => setMemberQuery(e.target.value)}
                          className="input-neu rounded-full border-0 pl-10"
                        />
                      </div>
                      {found.length > 0 && (
                        <div className="space-y-1.5">
                          {found.map((u) => (
                            <div key={u.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                              <Avatar emoji={u.avatar} size="sm" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold truncate">{u.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  @{u.username}
                                  {u.phone ? ` · ${u.phone}` : ''}
                                </p>
                              </div>
                              <Button size="sm" className="rounded-full h-8 px-3" disabled={busyId === u.id} onClick={() => void addMember(u)}>
                                {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="groove" />

                  <div className="space-y-1.5">
                    {detail.members.map((m) => (
                      <div key={m.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                        <Avatar emoji={m.avatar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">
                            {m.name} {m.id === me?.id && <span className="text-muted-foreground font-normal">(siz)</span>}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            @{m.username}
                            {m.phone ? ` · ${m.phone}` : ''}
                          </p>
                        </div>
                        {roleBadge(m.role)}
                        {isOwner && m.role !== 'owner' && (
                          <button
                            onClick={() => void setRole(m, m.role === 'admin' ? 'member' : 'admin')}
                            title={m.role === 'admin' ? 'Adminlikni olish' : 'Admin qilish'}
                            disabled={busyId === m.id}
                            className="neu-xs neu-press h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground shrink-0"
                          >
                            {m.role === 'admin' ? <ShieldOffIcon /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {canAdmin && m.role !== 'owner' && (
                          <button
                            onClick={() => void banMember(m)}
                            title="Qora ro'yxatga qo'shish"
                            disabled={busyId === m.id}
                            className="neu-xs neu-press h-7 w-7 rounded-full flex items-center justify-center text-acc-orange shrink-0"
                          >
                            {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {canAdmin && m.role !== 'owner' && (
                          <button
                            onClick={() => void removeMember(m)}
                            title="Olib tashlash"
                            disabled={busyId === m.id}
                            className="neu-xs neu-press h-7 w-7 rounded-full flex items-center justify-center text-acc-red shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ================= QORA RO'YXAT ================= */}
              {tab === 'bans' && canAdmin && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Qora ro&apos;yxatdagi foydalanuvchilar bu chatga qayta qo&apos;shilolmaydi va yozolmaydi.
                  </p>
                  {(detail.bans?.length ?? 0) === 0 ? (
                    <div className="text-center py-8">
                      <p className="neu-in-sm inline-flex h-14 w-14 items-center justify-center rounded-full text-2xl mb-3">🛡️</p>
                      <p className="text-sm font-semibold text-foreground">Qora ro&apos;yxat bo&apos;sh</p>
                      <p className="text-xs text-muted-foreground mt-1">A&apos;zolar bo&apos;limida 🚫 tugma orqali qo&apos;shasiz</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.bans.map((b) => (
                        <div key={b.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                          <Avatar emoji={b.avatar} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate">{b.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              @{b.username}
                              {b.reason ? ` · ${b.reason}` : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full h-8 px-3 shrink-0"
                            disabled={busyId === b.id}
                            onClick={() => void unbanUser(b)}
                          >
                            {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Chiqarish'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ================= SOZLAMALAR ================= */}
              {tab === 'settings' && canAdmin && (
                <div className="space-y-4">
                  {/* Avatar tanlash */}
                  <div>
                    <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Rasmcha</Label>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {CHANNEL_EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => setFAvatar(e)}
                          className={cn(
                            'h-9 w-9 rounded-full text-base flex items-center justify-center transition-all',
                            fAvatar === e ? 'neu-active' : 'neu-xs neu-press'
                          )}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ca-name" className="font-semibold">Nom</Label>
                    <Input id="ca-name" className="input-neu rounded-full border-0" value={fName} onChange={(e) => setFName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ca-desc" className="font-semibold">Tavsif</Label>
                    <Textarea id="ca-desc" className="input-neu min-h-16 resize-none rounded-2xl border-0" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
                  </div>

                  {isChannel && (
                    <>
                      <div className="groove" />
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">Ochiq kanal</p>
                          <p className="text-[11px] text-muted-foreground">
                            {fPublic ? 'Hammaga kashf etishda ko\u2018rinadi' : 'Yopiq — faqat taklifnoma kodi bilan'}
                          </p>
                        </div>
                        <Switch checked={fPublic} onCheckedChange={setFPublic} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">Pullik obuna</p>
                          <p className="text-[11px] text-muted-foreground">
                            {fPaid ? 'A\u2019zo bo\u2018lish uchun to\u2018lov talab qilinadi' : 'Bepul obuna'}
                          </p>
                        </div>
                        <Switch checked={fPaid} onCheckedChange={setFPaid} />
                      </div>
                      {fPaid && (
                        <div className="space-y-2">
                          <Label htmlFor="ca-price" className="font-semibold">
                            Obuna narxi (so&apos;m/oy)
                          </Label>
                          <Input
                            id="ca-price"
                            inputMode="numeric"
                            className="input-neu rounded-full border-0"
                            placeholder="masalan: 25000"
                            value={fPrice}
                            onChange={(e) => setFPrice(e.target.value.replace(/\D/g, ''))}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {!fPublic && detail.inviteCode && (
                    <>
                      <div className="groove" />
                      <div className="neu-in-sm p-3.5 rounded-[1.2rem] space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5" /> Taklifnoma kodi
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="neu-xs px-3 py-1.5 rounded-lg text-sm font-bold text-acc-blue select-all">
                            {detail.inviteCode}
                          </code>
                          <button
                            onClick={() => {
                              void navigator.clipboard?.writeText(detail.inviteCode ?? '')
                              toast.success('Kod nusxalandi')
                            }}
                            className="neu-xs neu-press h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground"
                            title="Nusxalash"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void regenerateInvite()}
                            className="neu-xs neu-press h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground"
                            title="Kodni yangilash"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  <Button onClick={() => void saveSettings()} disabled={saving || fName.trim().length < 2} className="w-full rounded-full">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Saqlash'}
                  </Button>

                  <div className="groove" />

                  {/* Xavfli zona */}
                  <div className="neu-in-sm p-3.5 rounded-[1.2rem] space-y-2.5">
                    <p className="text-xs font-bold uppercase tracking-wide text-acc-red flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> Xavfli amallar
                    </p>
                    <Button variant="outline" onClick={clearAllPosts} className="w-full rounded-full">
                      <Eraser className="h-4 w-4 mr-1" />
                      Barcha postlarni tozalash
                    </Button>
                    {!isOwner && (
                      <Button variant="outline" onClick={() => void leaveChat()} className="w-full rounded-full">
                        <LogOut className="h-4 w-4 mr-1" />
                        {isChannel ? 'Kanaldan chiqish' : 'Guruhdan chiqish'}
                      </Button>
                    )}
                    {isOwner && !confirmDelete && (
                      <Button variant="outline" onClick={() => setConfirmDelete(true)} className="w-full rounded-full text-acc-red">
                        <Trash2 className="h-4 w-4 mr-1" />
                        {isChannel ? 'Kanalni o\u2018chirish' : 'Guruhni o\u2018chirish'}
                      </Button>
                    )}
                    {isOwner && confirmDelete && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {isChannel
                            ? 'Kanal, postlar va obunachilar butunlay o\u2018chadi. Ishonchingiz komilmi?'
                            : 'Guruh va barcha xabarlar butunlay o\u2018chadi. Ishonchingiz komilmi?'}
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full">
                            Bekor qilish
                          </Button>
                          <Button onClick={() => void deleteChat()} className="flex-1 rounded-full bg-acc-red hover:bg-acc-red/90 text-white">
                            Ha, o&apos;chirish
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {tab === 'settings' && !canAdmin && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Sozlamalar faqat egasi va adminlar uchun
                  </p>
                  <Button variant="outline" onClick={() => void leaveChat()} className="w-full rounded-full">
                    <LogOut className="h-4 w-4 mr-1" /> Chiqish
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ShieldOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m2 2 20 20" />
    </svg>
  )
}
