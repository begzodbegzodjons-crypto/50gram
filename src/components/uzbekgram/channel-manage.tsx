'use client'

// ============================================================
// ChannelManage — KANAL BOSHQARUV PANELI (to'liq)
//   • Egasi: sozlamalarni tahrirlash (nom/tavsif/emoji/ochiq-yopiq/pullik-narx),
//     taklif kodi, obunachilarni qo'shish/olib tashlash/admin qilish,
//     kanalni o'chirish
//   • Obunachi: obuna holati, yangilash, chiqish
//   • Mehmon: bepul/pullik obuna bo'lish (to'lov tasdiqlash oynasi bilan)
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { api, type ChannelDetail, type UserBrief } from '@/lib/api'
import { useStore } from '@/lib/store'
import { Avatar } from './media'
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
  Loader2,
  Search,
  Settings2,
  Users,
  Copy,
  Check,
  X,
  Trash2,
  Star,
  Crown,
  LogOut,
  Gem,
  Globe,
  Lock,
  Wallet,
  RefreshCw,
  UserPlus,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { CHANNEL_EMOJIS } from './media'

export function fmtMoney(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Kanal belgilari (badges) — boshqa joylarda ham ishlatiladi
export function ChannelBadges({
  visibility,
  isPaid,
  price,
  small,
}: {
  visibility?: string
  isPaid?: boolean
  price?: number
  small?: boolean
}) {
  const cls = small
    ? 'text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1'
    : 'text-[11px] px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1'
  return (
    <>
      {visibility === 'private' ? (
        <span className={cn(cls, 'glass-chip text-acc-violet')}>
          <Lock className="h-3 w-3" /> Yopiq
        </span>
      ) : (
        <span className={cn(cls, 'glass-chip text-acc-cyan')}>
          <Globe className="h-3 w-3" /> Ochiq
        </span>
      )}
      {isPaid ? (
        <span className={cn(cls, 'bg-gradient-to-r from-[#f7b733] to-[#fc6a1f] text-white shadow-[0_4px_12px_-4px_rgba(252,106,31,0.5)]')}>
          <Gem className="h-3 w-3" /> {fmtMoney(price ?? 0)} so'm/30k
        </span>
      ) : (
        <span className={cn(cls, 'glass-chip text-acc-lime')}>
          <Check className="h-3 w-3" /> Bepul
        </span>
      )}
    </>
  )
}

interface ManageProps {
  channelId: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onChanged?: (channelId: string) => void
  onDeleted?: (channelId: string) => void
  onSubscribe?: (channelId: string) => void
}

// ============================================================
// ASOSIY OYNA — kanal ma'lumoti + boshqaruv
// ============================================================
export function ChannelManageDialog({ channelId, open, onOpenChange, onChanged, onDeleted }: ManageProps) {
  const socket = useStore((s) => s.socket)

  const [detail, setDetail] = useState<ChannelDetail | null>(null)
  const [loading, setLoading] = useState(false)

  // Tahrirlash formasi
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editAvatar, setEditAvatar] = useState('📢')
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('public')
  const [editPaid, setEditPaid] = useState(false)
  const [editPrice, setEditPrice] = useState('15000')
  const [saving, setSaving] = useState(false)

  // Obunachi qo'shish
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<UserBrief[]>([])
  const [searching, setSearching] = useState(false)

  // O'chirish tasdiqlash
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteText, setDeleteText] = useState('')

  const load = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    try {
      const d = await api<ChannelDetail>(`/api/channels/${channelId}`)
      setDetail(d)
      setEditName(d.name ?? '')
      setEditDesc(d.description ?? '')
      setEditAvatar(d.avatar ?? '📢')
      setEditVisibility(d.visibility)
      setEditPaid(d.isPaid)
      setEditPrice(d.price ? String(d.price) : '15000')
    } catch (e) {
      toast.error((e as Error).message)
      onOpenChange(false)
    }
    setLoading(false)
  }, [channelId, onOpenChange])

  useEffect(() => {
    if (open && channelId) void load()
    if (!open) {
      setDetail(null)
      setConfirmDelete(false)
      setDeleteText('')
      setUserSearch('')
      setUserResults([])
    }
  }, [open, channelId, load])

  // A'zo qidirish (egasi uchun)
  useEffect(() => {
    if (!open || detail?.myRole !== 'owner') return
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<UserBrief[]>(`/api/users?q=${encodeURIComponent(userSearch)}`)
        setUserResults(r.filter((u) => u.id !== detail?.ownerId && !detail?.subscribers.some((s) => s.id === u.id)))
      } catch {}
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [userSearch, open, detail?.myRole, detail?.ownerId, detail?.subscribers])

  // ===== Sozlamalarni saqlash =====
  const saveSettings = async () => {
    if (!detail) return
    if (editName.trim().length < 2) {
      toast.error('Kanal nomi juda qisqa')
      return
    }
    const priceNum = Number(editPrice.replace(/[^\d]/g, '')) || 0
    if (editPaid && priceNum < 1000) {
      toast.error("Pullik kanal narxi kamida 1 000 so'm")
      return
    }
    setSaving(true)
    try {
      const res = await api<{ ok: boolean }>(`/api/channels/${detail.id}`, {
        method: 'PATCH',
        body: {
          name: editName.trim(),
          description: editDesc.trim(),
          avatar: editAvatar,
          visibility: editVisibility,
          isPaid: editPaid,
          price: editPaid ? priceNum : 0,
        },
      })
      if (res.ok) {
        toast.success("Kanal sozlamalari saqlandi ✅")
        await load()
        onChanged?.(detail.id)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ===== Obunachi qo'shish (egasi) =====
  const addSubscriber = async (u: UserBrief) => {
    if (!detail) return
    try {
      await api(`/api/channels/${detail.id}/members`, { body: { userId: u.id } })
      toast.success(`${u.name} kanalga qo'shildi`)
      setUserSearch('')
      await load()
      onChanged?.(detail.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ===== Obunachini olib tashlash =====
  const removeSubscriber = async (userId: string, name: string) => {
    if (!detail) return
    try {
      await api(`/api/channels/${detail.id}/members/${userId}`, { method: 'DELETE' })
      toast.success(`${name} olib tashlandi`)
      await load()
      onChanged?.(detail.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ===== Admin qilish / olish =====
  const toggleAdmin = async (userId: string, currentRole: string) => {
    if (!detail) return
    const role = currentRole === 'admin' ? 'member' : 'admin'
    try {
      await api(`/api/channels/${detail.id}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      })
      toast.success(role === 'admin' ? 'Admin tayinlandi ⭐' : 'Adminlik olib tashlandi')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ===== Kanalni o'chirish =====
  const deleteChannel = async () => {
    if (!detail) return
    try {
      await api(`/api/channels/${detail.id}`, { method: 'DELETE' })
      socket?.emit('channel:removed', { chatId: detail.id })
      toast.success(`"${detail.name}" kanali o'chirildi`)
      onOpenChange(false)
      onDeleted?.(detail.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ===== Kanaldan chiqish (obunachi) =====
  const leaveChannel = async () => {
    if (!detail) return
    try {
      await api(`/api/channels/${detail.id}/subscribe`, { method: 'DELETE' })
      toast.success("Kanaldan chiqdingiz")
      onOpenChange(false)
      onChanged?.(detail.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const isOwner = detail?.myRole === 'owner'
  const isAdmin = detail?.myRole === 'admin' || isOwner

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        {loading || !detail ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-acc-cyan" />
          </div>
        ) : (
          <ScrollArea className="max-h-[85vh]">
            <div className="p-5 space-y-4">
              {/* ===== Header: avatar + nom + belgilar ===== */}
              <div className="flex items-start gap-3">
                <div className="av-ring-soft h-16 w-16 shrink-0">
                  <div className="av-inner text-3xl">{detail.avatar ?? '📢'}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <DialogHeader className="space-y-1">
                    <DialogTitle className="text-xl font-black leading-tight break-words">
                      {detail.name}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <ChannelBadges visibility={detail.visibility} isPaid={detail.isPaid} price={detail.price} small />
                    <span className="glass-chip text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                      {detail.memberCount} obunachi
                    </span>
                  </div>
                </div>
                {detail.myRole && (
                  <span className="glass-chip text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1">
                    {isOwner ? (
                      <><Crown className="h-3 w-3 text-acc-amber" /> Egasi</>
                    ) : isAdmin ? (
                      <><Star className="h-3 w-3 text-acc-violet" /> Admin</>
                    ) : (
                      'A\u2019zo'
                    )}
                  </span>
                )}
              </div>

              {detail.description && (
                <p className="text-sm text-ink-2 leading-relaxed glass-in rounded-2xl px-4 py-3">
                  {detail.description}
                </p>
              )}

              {/* ===== Egasi/Admin: boshqaruv bo'limlari ===== */}
              {isAdmin && (
                <>
                  {/* Taklif kodi (yopiq kanal) */}
                  {detail.visibility === 'private' && detail.inviteCode && (
                    <div className="glass-in rounded-2xl p-4">
                      <p className="text-xs font-bold text-acc-violet flex items-center gap-1.5 mb-2">
                        <Lock className="h-3.5 w-3.5" /> TAKLIF KODI — shu kod bilan obunachilar kiradi
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-center text-lg font-black tracking-[0.3em] bg-white/70 rounded-xl py-2.5 px-3 select-all">
                          {detail.inviteCode}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0 rounded-xl"
                          onClick={() => {
                            void navigator.clipboard.writeText(detail.inviteCode!)
                            toast.success('Kod nusxalandi 📋')
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Sozlamalar */}
                  <SettingsSection
                    state={{
                      name: editName,
                      desc: editDesc,
                      avatar: editAvatar,
                      visibility: editVisibility,
                      paid: editPaid,
                      price: editPrice,
                    }}
                    setState={{
                      setName: setEditName,
                      setDesc: setEditDesc,
                      setAvatar: setEditAvatar,
                      setVisibility: setEditVisibility,
                      setPaid: setEditPaid,
                      setPrice: setEditPrice,
                    }}
                    saving={saving}
                    onSave={saveSettings}
                  />

                  {/* Obunachilar */}
                  <div className="glass-in rounded-2xl p-4">
                    <p className="text-xs font-bold text-acc-cyan flex items-center gap-1.5 mb-3">
                      <Users className="h-3.5 w-3.5" /> OBUNACHILAR ({detail.subscribers.length})
                    </p>

                    {/* Qo'shish (faqat egasi) */}
                    {isOwner && (
                      <div className="space-y-2 mb-3">
                        <div className="relative">
                          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
                          <Input
                            placeholder="Obunachi qo'shish: telefon raqam yoki ism..."
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            className="field h-10 border-0 rounded-full pl-10 text-sm"
                          />
                        </div>
                        {userSearch.trim() !== '' && (
                          <div className="max-h-36 overflow-y-auto space-y-1.5">
                            {searching && userResults.length === 0 && (
                              <div className="flex justify-center py-2">
                                <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
                              </div>
                            )}
                            {!searching && userResults.length === 0 && (
                              <p className="text-xs text-ink-3 text-center py-2">Topilmadi</p>
                            )}
                            {userResults.map((u) => (
                              <button
                                key={u.id}
                                onClick={() => void addSubscriber(u)}
                                className="glass-sm glass-hover w-full flex items-center gap-2.5 p-2 rounded-[1rem] text-left"
                              >
                                <Avatar emoji={u.avatar} size="sm" />
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-sm truncate">{u.name}</p>
                                  <p className="text-[11px] text-ink-3 truncate">{u.phone ?? '@' + u.username}</p>
                                </div>
                                <span className="glass-chip h-7 w-7 flex items-center justify-center shrink-0">
                                  <UserPlus className="h-3.5 w-3.5 text-acc-lime" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ro'yxat */}
                    {detail.subscribers.length === 0 ? (
                      <p className="text-xs text-ink-3 text-center py-3">
                        Hali obunachi yo&apos;q
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto -mx-1 px-1">
                        {detail.subscribers.map((s) => (
                          <div key={s.id} className="glass-sm flex items-center gap-2.5 p-2 rounded-[1rem]">
                            <Avatar emoji={s.avatar} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                                {s.name}
                                {s.role === 'admin' && (
                                  <Star className="h-3 w-3 text-acc-violet fill-acc-violet shrink-0" />
                                )}
                              </p>
                              <p className="text-[11px] text-ink-3 truncate">
                                {s.phone ? `${s.phone} · ` : ''}@{s.username}
                                {s.paid && s.active && s.expiresAt && (
                                  <span className="text-acc-amber font-semibold"> · {fmtDate(s.expiresAt)} gacha</span>
                                )}
                                {s.paid && !s.active && (
                                  <span className="text-acc-rose font-semibold"> · muddat tugagan</span>
                                )}
                              </p>
                            </div>
                            {isOwner && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => void toggleAdmin(s.id, s.role)}
                                  className={cn(
                                    'h-7 w-7 rounded-full flex items-center justify-center transition-colors press',
                                    s.role === 'admin'
                                      ? 'bg-[rgba(97,83,232,0.14)] text-acc-violet'
                                      : 'glass-chip text-ink-3 hover:text-acc-violet'
                                  )}
                                  title={s.role === 'admin' ? 'Adminlikni olish' : 'Admin qilish'}
                                >
                                  <Star className={cn('h-3.5 w-3.5', s.role === 'admin' && 'fill-current')} />
                                </button>
                                <button
                                  onClick={() => void removeSubscriber(s.id, s.name)}
                                  className="h-7 w-7 rounded-full glass-chip flex items-center justify-center text-ink-3 hover:text-acc-rose transition-colors press"
                                  title="Olib tashlash"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Xavfli zona: o'chirish */}
                  {isOwner && (
                    <div className="rounded-2xl border-2 border-[rgba(236,74,119,0.30)] bg-[rgba(236,74,119,0.06)] p-4">
                      {confirmDelete ? (
                        <div className="space-y-3">
                          <p className="text-sm font-semibold text-acc-rose flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            Tasdiqlash: kanal nomini yozing — <b>{detail.name}</b>
                          </p>
                          <Input
                            value={deleteText}
                            onChange={(e) => setDeleteText(e.target.value)}
                            placeholder={detail.name ?? ''}
                            className="field h-10 border-0 rounded-full"
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => {
                                setConfirmDelete(false)
                                setDeleteText('')
                              }}
                            >
                              Bekor qilish
                            </Button>
                            <Button
                              className="flex-1 bg-acc-rose hover:bg-acc-rose/90 text-white"
                              disabled={deleteText !== detail.name}
                              onClick={() => void deleteChannel()}
                            >
                              <Trash2 className="h-4 w-4" /> O&apos;chirish
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-acc-rose press"
                        >
                          <Trash2 className="h-4 w-4" /> Kanalni butunlay o&apos;chirish
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ===== Obunachi: holat + chiqish ===== */}
              {detail.myRole && !isAdmin && (
                <div className="space-y-3">
                  {detail.mySubscription?.paid ? (
                    detail.mySubscription.active ? (
                      <div className="glass-in rounded-2xl p-4 flex items-center gap-3">
                        <Gem className="h-5 w-5 text-acc-amber shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold">Pullik obuna faol</p>
                          <p className="text-xs text-ink-3">{fmtDate(detail.mySubscription.expiresAt)} gacha</p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border-2 border-[rgba(252,106,31,0.35)] bg-[rgba(252,106,31,0.08)] p-4">
                        <p className="text-sm font-semibold text-acc-amber mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" /> Obuna muddati tugadi
                        </p>
                        <p className="text-xs text-ink-2 mb-3">
                          Yangi postlarni davom etib ko&apos;rish uchun obunani yangilang
                          ({fmtMoney(detail.price)} so&apos;m / 30 kun)
                        </p>
                        <RenewButton channelId={detail.id} channelName={detail.name ?? 'Kanal'} price={detail.price} onDone={() => { void load(); onChanged?.(detail.id) }} />
                      </div>
                    )
                  ) : (
                    <div className="glass-in rounded-2xl p-4 flex items-center gap-3">
                      <Check className="h-5 w-5 text-acc-lime shrink-0" />
                      <p className="text-sm font-semibold flex-1">Bepul obuna faol</p>
                    </div>
                  )}

                  <Button variant="outline" className="w-full text-acc-rose hover:text-acc-rose" onClick={() => void leaveChannel()}>
                    <LogOut className="h-4 w-4" /> Kanaldan chiqish
                  </Button>
                </div>
              )}

              {/* ===== Mehmon (a'zo emas) ===== */}
              {!detail.myRole && (
                <div className="space-y-3">
                  {detail.isPaid ? (
                    <div className="glass-in rounded-2xl p-4 space-y-3">
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Gem className="h-4 w-4 text-acc-amber" /> Pullik kanal — {fmtMoney(detail.price)} so&apos;m / 30 kun
                      </p>
                      <p className="text-xs text-ink-3">
                        To&apos;lov profilingizdagi balansdan yechiladi. Bu kanal postlarini
                        ko&apos;rish uchun obuna bo&apos;ling.
                      </p>
                      <SubscribePaymentButton
                        channelId={detail.id}
                        channelName={detail.name ?? 'Kanal'}
                        price={detail.price}
                        onDone={() => {
                          void load()
                          onChanged?.(detail.id)
                        }}
                      />
                    </div>
                  ) : (
                    <SubscribeFreeButton
                      channelId={detail.id}
                      onDone={() => {
                        void load()
                        onChanged?.(detail.id)
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Sozlamalar bo'limi (egasi tahrirlaydi)
// ============================================================
interface SettingsProps {
  state: {
    name: string
    desc: string
    avatar: string
    visibility: 'public' | 'private'
    paid: boolean
    price: string
  }
  setState: {
    setName: (v: string) => void
    setDesc: (v: string) => void
    setAvatar: (v: string) => void
    setVisibility: (v: 'public' | 'private') => void
    setPaid: (v: boolean) => void
    setPrice: (v: string) => void
  }
  saving: boolean
  onSave: () => void
}

function SettingsSection({ state, setState, saving, onSave }: SettingsProps) {
  const priceNum = Number(state.price.replace(/[^\d]/g, '')) || 0
  return (
    <div className="glass-in rounded-2xl p-4 space-y-3">
      <p className="text-xs font-bold text-acc-fuchsia flex items-center gap-1.5">
        <Settings2 className="h-3.5 w-3.5" /> KANAL SOZLAMALARI
      </p>

      <div className="flex items-center gap-3">
        <div className="av-ring-soft h-12 w-12 shrink-0">
          <div className="av-inner text-2xl">{state.avatar}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {CHANNEL_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setState.setAvatar(e)}
              className={cn(
                'h-7 w-7 rounded-full text-sm flex items-center justify-center transition-all press',
                state.avatar === e ? 'grad-bg grad-glow' : 'glass-chip glass-hover'
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <Input
        value={state.name}
        onChange={(e) => setState.setName(e.target.value)}
        placeholder="Kanal nomi"
        className="field h-10 border-0 rounded-full"
      />
      <Textarea
        value={state.desc}
        onChange={(e) => setState.setDesc(e.target.value)}
        placeholder="Tavsif"
        className="field-soft min-h-14 resize-none border-0 text-sm"
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setState.setVisibility('public')}
          className={cn(
            'rounded-xl border p-2.5 text-left transition-all press',
            state.visibility === 'public'
              ? 'border-[rgba(61,123,255,0.45)] bg-white/85'
              : 'border-transparent bg-white/40'
          )}
        >
          <p className="text-xs font-semibold flex items-center gap-1">
            <Globe className="h-3 w-3 text-acc-cyan" /> Ochiq
          </p>
        </button>
        <button
          type="button"
          onClick={() => setState.setVisibility('private')}
          className={cn(
            'rounded-xl border p-2.5 text-left transition-all press',
            state.visibility === 'private'
              ? 'border-[rgba(61,123,255,0.45)] bg-white/85'
              : 'border-transparent bg-white/40'
          )}
        >
          <p className="text-xs font-semibold flex items-center gap-1">
            <Lock className="h-3 w-3 text-acc-violet" /> Yopiq
          </p>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setState.setPaid(false)}
          className={cn(
            'rounded-xl border p-2.5 text-left transition-all press',
            !state.paid
              ? 'border-[rgba(61,123,255,0.45)] bg-white/85'
              : 'border-transparent bg-white/40'
          )}
        >
          <p className="text-xs font-semibold">🎁 Bepul</p>
        </button>
        <button
          type="button"
          onClick={() => setState.setPaid(true)}
          className={cn(
            'rounded-xl border p-2.5 text-left transition-all press',
            state.paid
              ? 'border-[rgba(61,123,255,0.45)] bg-white/85'
              : 'border-transparent bg-white/40'
          )}
        >
          <p className="text-xs font-semibold">💎 Pullik</p>
        </button>
      </div>

      {state.paid && (
        <div className="bg-white/50 rounded-xl px-3 py-2 flex items-center gap-2">
          <Label className="text-xs font-semibold whitespace-nowrap">Narxi / 30 kun:</Label>
          <Input
            inputMode="numeric"
            value={state.price ? fmtMoney(Number(state.price.replace(/[^\d]/g, ''))) : ''}
            onChange={(e) => setState.setPrice(e.target.value)}
            className="field h-8 border-0 flex-1 text-right font-bold text-sm"
          />
          <span className="text-xs text-ink-3 whitespace-nowrap">so&apos;m</span>
        </div>
      )}

      <Button onClick={onSave} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Saqlash
      </Button>
    </div>
  )
}

// ============================================================
// Bepul obuna tugmasi
// ============================================================
function SubscribeFreeButton({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await api(`/api/channels/${channelId}/subscribe`, { body: {} })
      toast.success("Obuna bo'ldingiz ✅ Postlar 'Suhbatlar' bo'limida ko'rinadi")
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button className="w-full h-12 text-base" disabled={busy} onClick={() => void go()}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      Bepul obuna bo&apos;lish
    </Button>
  )
}

// ============================================================
// Pullik obuna — to'lov tasdiqlash oynasi bilan
// ============================================================
export function SubscribePaymentDialog({
  channelId,
  channelName,
  price,
  open,
  onOpenChange,
  onDone,
}: {
  channelId: string
  channelName: string
  price: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const me = useStore((s) => s.me)
  const setMe = useStore((s) => s.setMe)
  const [busy, setBusy] = useState(false)
  const balance = me?.balance ?? 0
  const enough = balance >= price

  const pay = async () => {
    setBusy(true)
    try {
      const res = await api<{ balance: number }>(`/api/channels/${channelId}/subscribe`, { body: {} })
      setMe({ ...me!, balance: res.balance })
      toast.success(`To'lov o'tdi 💳 ${channelName} ga obuna bo'ldingiz`)
      onOpenChange(false)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-black flex items-center gap-2.5">
            <span className="bg-gradient-to-r from-[#f7b733] to-[#fc6a1f] h-9 w-9 rounded-xl flex items-center justify-center">
              <Gem className="h-4.5 w-4.5 text-white" />
            </span>
            To&apos;lovni tasdiqlash
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="glass-in rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Kanal</span>
              <span className="font-semibold">{channelName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Muddat</span>
              <span className="font-semibold">30 kun</span>
            </div>
            <div className="grad-line" />
            <div className="flex justify-between text-sm">
              <span className="text-ink-3 flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" /> Balansingiz
              </span>
              <span className="font-semibold">{fmtMoney(balance)} so&apos;m</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">To&apos;lov</span>
              <span className="font-bold text-acc-rose">−{fmtMoney(price)} so&apos;m</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Qoladi</span>
              <span className={cn('font-semibold', enough ? 'text-acc-lime' : 'text-acc-rose')}>
                {fmtMoney(balance - price)} so&apos;m
              </span>
            </div>
          </div>
          {!enough && (
            <p className="text-xs font-semibold text-acc-rose bg-[rgba(236,74,119,0.08)] rounded-xl px-3 py-2.5">
              Balansda mablag&apos; yetarli emas — Profil bo&apos;limidan hisobni to&apos;ldiring
            </p>
          )}
          <Button className="w-full h-11 text-base" disabled={busy || !enough} onClick={() => void pay()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gem className="h-4 w-4" />}
            To&apos;lash va obuna bo&apos;lish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Panel ichidagi pullik obuna tugmasi (oyna ochadi)
function SubscribePaymentButton({
  channelId,
  channelName,
  price,
  onDone,
}: {
  channelId: string
  channelName: string
  price: number
  onDone: () => void
}) {
  const [payOpen, setPayOpen] = useState(false)
  return (
    <>
      <Button className="w-full h-11 text-base" onClick={() => setPayOpen(true)}>
        <Gem className="h-4 w-4" /> Obuna bo&apos;lish — {fmtMoney(price)} so&apos;m
      </Button>
      <SubscribePaymentDialog
        channelId={channelId}
        channelName={channelName}
        price={price}
        open={payOpen}
        onOpenChange={setPayOpen}
        onDone={onDone}
      />
    </>
  )
}

// Obunani yangilash tugmasi (muddati tugagan)
function RenewButton({ channelId, channelName, price, onDone }: { channelId: string; channelName: string; price: number; onDone: () => void }) {
  const [payOpen, setPayOpen] = useState(false)
  return (
    <>
      <Button className="w-full" onClick={() => setPayOpen(true)}>
        <RefreshCw className="h-4 w-4" /> Obunani yangilash — {fmtMoney(price)} so&apos;m
      </Button>
      <SubscribePaymentDialog
        channelId={channelId}
        channelName={channelName}
        price={price}
        open={payOpen}
        onOpenChange={setPayOpen}
        onDone={onDone}
      />
    </>
  )
}
