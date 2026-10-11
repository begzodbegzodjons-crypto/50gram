'use client'

// ============================================================
// CreateChatDialogs — "Guruh ochish" va "Kanal ochish" oynalari.
//   • Guruh: emoji + nom + tavsif + a'zolarni qidirib tanlash
//   • Kanal: emoji + nom + tavsif (ochiq broadcast)
// Ikkalasi POST /api/chats orqali yaratiladi.
// ============================================================

import { useEffect, useState } from 'react'
import { api, type UserBrief } from '@/lib/api'
import { Avatar } from './media'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  Loader2,
  Users,
  Megaphone,
  Check,
  X,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { GROUP_EMOJIS, CHANNEL_EMOJIS } from './media'

interface CreateChatDialogsProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (chatId: string) => void
}

// ============================================================
// YANGI GURUH — a'zo tanlash bilan
// ============================================================
export function NewGroupDialog({ open, onOpenChange, onCreated }: CreateChatDialogsProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [avatar, setAvatar] = useState('👥')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<UserBrief[]>([])
  const [selected, setSelected] = useState<UserBrief[]>([])
  const [creating, setCreating] = useState(false)
  const [searching, setSearching] = useState(false)

  // Qidiruv (debounce 300ms)
  useEffect(() => {
    if (!open) return
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api<UserBrief[]>(`/api/users?q=${encodeURIComponent(search)}`)
        setResults(r.filter((u) => !selected.some((s) => s.id === u.id)))
      } catch {}
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [search, open])

  const reset = () => {
    setName('')
    setDesc('')
    setAvatar('👥')
    setSearch('')
    setResults([])
    setSelected([])
  }

  const addMember = (u: UserBrief) => {
    setSelected((prev) => [...prev, u])
    setResults((prev) => prev.filter((r) => r.id !== u.id))
  }

  const removeMember = (u: UserBrief) => {
    setSelected((prev) => prev.filter((s) => s.id !== u.id))
  }

  const create = async () => {
    if (name.trim().length < 2) return
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/chats', {
        body: {
          type: 'group',
          name: name.trim(),
          avatar,
          description: desc.trim(),
          memberIds: selected.map((s) => s.id),
        },
      })
      onOpenChange(false)
      reset()
      toast.success(`Guruh ochildi! ${selected.length > 0 ? `${selected.length + 1} a'zo` : ''} 🎉`)
      onCreated(res.chatId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 font-black">
            <span className="grad-bg grad-glow h-9 w-9 rounded-xl flex items-center justify-center">
              <Users className="h-4.5 w-4.5 text-white" />
            </span>
            Yangi guruh ochish
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Avatar + emoji tanlash */}
          <div className="flex items-center gap-3">
            <div className="av-ring-soft h-14 w-14 shrink-0">
              <div className="av-inner text-2xl">{avatar}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GROUP_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setAvatar(e)}
                  className={cn(
                    'h-8 w-8 rounded-full text-base flex items-center justify-center transition-all press',
                    avatar === e
                      ? 'grad-bg grad-glow'
                      : 'glass-chip glass-hover'
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field h-11 border-0 rounded-full"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">
              Tavsif <span className="text-ink-3 font-normal">(ixtiyoriy)</span>
            </Label>
            <Textarea
              placeholder="Guruh nima haqida?..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="field-soft min-h-16 resize-none border-0"
            />
          </div>

          {/* A'zolar tanlash */}
          <div className="space-y-2">
            <Label className="font-semibold flex items-center justify-between">
              <span>A'zolar qo'shish</span>
              <span className="text-ink-3 font-normal text-xs">{selected.length} tanlangan</span>
            </Label>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((u) => (
                  <span
                    key={u.id}
                    className="glass-chip flex items-center gap-1.5 pl-1 pr-2 py-1 text-xs font-semibold"
                  >
                    <span className="text-sm">{u.avatar}</span>
                    {u.name.split(' ')[0]}
                    <button
                      onClick={() => removeMember(u)}
                      className="text-ink-3 hover:text-acc-rose transition-colors"
                      aria-label={`${u.name} ni olib tashlash`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
              <Input
                placeholder="Telefon raqam yoki ism bo'yicha qidiring..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="field h-10 border-0 rounded-full pl-10"
              />
            </div>

            <div className="max-h-44 overflow-y-auto -mx-1 px-1 space-y-1.5">
              {searching && results.length === 0 && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
                </div>
              )}
              {!searching && results.length === 0 && (
                <p className="text-xs text-ink-3 text-center py-3">
                  Foydalanuvchi topilmadi — telefon raqam yoki ism bilan qidiring
                </p>
              )}
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addMember(u)}
                  className="glass-sm glass-hover w-full flex items-center gap-2.5 p-2 rounded-[1rem] text-left"
                >
                  <Avatar emoji={u.avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{u.name}</p>
                    <p className="text-[11px] text-ink-3 truncate">
                      {u.phone ?? '@' + u.username}
                    </p>
                  </div>
                  <span className="glass-chip h-7 w-7 flex items-center justify-center shrink-0">
                    <Check className="h-3.5 w-3.5 text-acc-lime" />
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={create}
            disabled={creating || name.trim().length < 2}
            className="w-full h-11 text-base"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Guruhni ochish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// YANGI KANAL — ochiq/yopiq + bepul/pullik sozlamalari bilan
// ============================================================
export function NewChannelDialog({ open, onOpenChange, onCreated }: CreateChatDialogsProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [avatar, setAvatar] = useState('📢')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [isPaid, setIsPaid] = useState(false)
  const [price, setPrice] = useState('15000')
  const [creating, setCreating] = useState(false)

  const priceNum = Number(price.replace(/[^\d]/g, '')) || 0

  const reset = () => {
    setName('')
    setDesc('')
    setAvatar('📢')
    setVisibility('public')
    setIsPaid(false)
    setPrice('15000')
  }

  const create = async () => {
    if (name.trim().length < 2) return
    if (isPaid && priceNum < 1000) {
      toast.error('Pullik kanal narxi kamida 1 000 so\u2018m bo\u2018lishi kerak')
      return
    }
    setCreating(true)
    try {
      const res = await api<{ chatId: string }>('/api/chats', {
        body: {
          type: 'channel',
          name: name.trim(),
          avatar,
          description: desc.trim(),
          visibility,
          isPaid,
          price: isPaid ? priceNum : 0,
        },
      })
      onOpenChange(false)
      reset()
      toast.success(
        `Kanal ochildi! ${visibility === 'private' ? '🔒 Yopiq — kod bilan kiriladi' : '📢 Ochiq — Kanallar bo\u2018limida ko\u2018rinadi'}`
      )
      onCreated(res.chatId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 font-black">
            <span className="grad-bg grad-glow h-9 w-9 rounded-xl flex items-center justify-center">
              <Megaphone className="h-4.5 w-4.5 text-white" />
            </span>
            Yangi kanal ochish
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="av-ring-soft h-14 w-14 shrink-0">
              <div className="av-inner text-2xl">{avatar}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CHANNEL_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setAvatar(e)}
                  className={cn(
                    'h-8 w-8 rounded-full text-base flex items-center justify-center transition-all press',
                    avatar === e
                      ? 'grad-bg grad-glow'
                      : 'glass-chip glass-hover'
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
              placeholder="Masalan: Toshkent Ulangohchilari"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              className="field h-11 border-0 rounded-full"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Tavsif</Label>
            <Textarea
              placeholder="Kanal haqida qisqacha..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="field-soft min-h-16 resize-none border-0"
            />
          </div>

          {/* Ochiq / Yopiq tanlash */}
          <div className="space-y-2">
            <Label className="font-semibold">Kanal turi</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={cn(
                  'rounded-2xl border p-3 text-left transition-all press',
                  visibility === 'public'
                    ? 'border-[rgba(61,123,255,0.45)] bg-white/85 shadow-[0_8px_20px_-10px_rgba(23,58,148,0.35)]'
                    : 'border-transparent glass-in'
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold text-sm">
                  🌍 Ochiq kanal
                </p>
                <p className="text-[11px] text-ink-3 mt-0.5 leading-snug">
                  "Kanallar" bo'limida hammaga ko'rinadi
                </p>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={cn(
                  'rounded-2xl border p-3 text-left transition-all press',
                  visibility === 'private'
                    ? 'border-[rgba(61,123,255,0.45)] bg-white/85 shadow-[0_8px_20px_-10px_rgba(23,58,148,0.35)]'
                    : 'border-transparent glass-in'
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold text-sm">
                  🔒 Yopiq kanal
                </p>
                <p className="text-[11px] text-ink-3 mt-0.5 leading-snug">
                  Faqat taklif kodi bilan kiriladi
                </p>
              </button>
            </div>
          </div>

          {/* Pullik / Bepul tanlash */}
          <div className="space-y-2">
            <Label className="font-semibold">Obuna turi</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPaid(false)}
                className={cn(
                  'rounded-2xl border p-3 text-left transition-all press',
                  !isPaid
                    ? 'border-[rgba(61,123,255,0.45)] bg-white/85 shadow-[0_8px_20px_-10px_rgba(23,58,148,0.35)]'
                    : 'border-transparent glass-in'
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold text-sm">🎁 Bepul</p>
                <p className="text-[11px] text-ink-3 mt-0.5 leading-snug">
                  Hammaga ochiq — bir tugma bilan obuna
                </p>
              </button>
              <button
                type="button"
                onClick={() => setIsPaid(true)}
                className={cn(
                  'rounded-2xl border p-3 text-left transition-all press',
                  isPaid
                    ? 'border-[rgba(61,123,255,0.45)] bg-white/85 shadow-[0_8px_20px_-10px_rgba(23,58,148,0.35)]'
                    : 'border-transparent glass-in'
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold text-sm">💎 Pullik</p>
                <p className="text-[11px] text-ink-3 mt-0.5 leading-snug">
                  Obunachilar balansidan to'laydi (30 kun)
                </p>
              </button>
            </div>
            {isPaid && (
              <div className="glass-in rounded-2xl px-4 py-3 flex items-center gap-3">
                <span className="text-sm font-semibold whitespace-nowrap">Narxi / 30 kun:</span>
                <Input
                  inputMode="numeric"
                  value={price ? Number(price.replace(/[^\d]/g, '')).toLocaleString('ru-RU') : ''}
                  onChange={(e) => setPrice(e.target.value)}
                  className="field h-9 border-0 flex-1 text-right font-bold"
                />
                <span className="text-sm text-ink-3 whitespace-nowrap">so'm</span>
              </div>
            )}
          </div>

          <div className="glass-in rounded-2xl px-4 py-3 flex items-start gap-2.5">
            <Megaphone className="h-4 w-4 text-acc-fuchsia shrink-0 mt-0.5" />
            <p className="text-xs text-ink-2 leading-relaxed">
              Kanal — bir tomonlama broadcast: siz yozasiz, obunachilar o'qiydi.
              Kanal postlari <b className="text-foreground">Lenta</b>ga ham chiqadi. Barcha
              sozlamalarni keyin ham <b className="text-foreground">boshqarish</b> panelida
              o'zgartirish mumkin.
            </p>
          </div>

          <Button
            onClick={create}
            disabled={creating || name.trim().length < 2}
            className="w-full h-11 text-base"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Kanalni ochish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
