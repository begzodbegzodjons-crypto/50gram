'use client'

import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type PaymentInfo, type Topic } from '@/lib/api'
import { Avatar, timeAgo, AVATAR_EMOJIS } from './media'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Loader2,
  LogOut,
  Save,
  Wallet,
  TrendingUp,
  Receipt,
  Phone,
  Ban,
  UserRound,
  CheckCircle2,
  XCircle,
  Contact,
  UserPlus,
  MessageCirclePlus,
  Search,
  Trash2,
  AtSign,
  BadgeCheck,
} from 'lucide-react'
import { toast } from 'sonner'

const fmtSum = (n: number) => Math.round(n).toLocaleString('uz-UZ')

interface LinkedUser {
  id: string
  username: string
  name: string
  avatar: string
  bio: string | null
}

interface ContactItem {
  id: string
  name: string
  phone: string
  createdAt: string
  linked: LinkedUser | null
}

export default function ProfileView() {
  const me = useStore((s) => s.me)
  const topics = useStore((s) => s.topics)
  const logout = useStore((s) => s.logout)
  const openChat = useStore((s) => s.openChat)

  const [name, setName] = useState(me?.name ?? '')
  const [username, setUsername] = useState(me?.username ?? '')
  const [phone, setPhone] = useState(me?.phone ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const [avatar, setAvatar] = useState(me?.avatar ?? '🙂')
  const [interestSlugs, setInterestSlugs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Username live tekshiruvi
  const [unameState, setUnameState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle')
  const [unameMsg, setUnameMsg] = useState('')
  const changedUname = username.trim().toLowerCase() !== (me?.username ?? '')

  // Kontaktlar
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [cSearch, setCSearch] = useState('')
  const [cName, setCName] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)

  // To'lovlar
  const [pay, setPay] = useState<PaymentInfo | null>(null)
  const [payTab, setPayTab] = useState<'paid' | 'income'>('paid')

  // Qora ro'yxat (bloklangan foydalanuvchilar)
  const [blocked, setBlocked] = useState<{ id: string; name: string; avatar: string; username: string }[]>([])

  const loadInterests = useCallback(async () => {
    if (!me) return
    try {
      const fresh = await api<{ interests: { topicId: string }[] }>('/api/me')
      const ids = new Set(fresh.interests.map((i) => i.topicId))
      setInterestSlugs(topics.filter((t) => ids.has(t.id)).map((t) => t.slug))
    } catch {}
  }, [me, topics])

  const loadStats = useCallback(async () => {
    try {
      setPay(await api<PaymentInfo>('/api/payments'))
    } catch {}
    try {
      const r = await api<{ blocked: { id: string; name: string; avatar: string; username: string }[] }>('/api/blocks')
      setBlocked(r.blocked)
    } catch {}
  }, [])

  // Kontaktlar yuklash
  const loadContacts = useCallback(async () => {
    try {
      const r = await api<{ contacts: ContactItem[] }>('/api/contacts')
      setContacts(r.contacts)
    } catch {}
  }, [])

  useEffect(() => {
    void loadInterests()
    void loadStats()
    void loadContacts()
  }, [loadInterests, loadStats, loadContacts])

  // Username debounced tekshirish
  useEffect(() => {
    if (!changedUname) {
      setUnameState('idle')
      setUnameMsg('')
      return
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase())) {
      setUnameState('bad')
      setUnameMsg('3-20 belgi: lotin harflari, raqamlar, _')
      return
    }
    setUnameState('checking')
    setUnameMsg('')
    const t = setTimeout(async () => {
      try {
        const r = await api<{ available: boolean; reason?: string }>(
          `/api/auth/username-check?username=${encodeURIComponent(username.trim().toLowerCase())}`
        )
        if (r.available) {
          setUnameState('ok')
          setUnameMsg('Bu nom bo\u2018sh — olish mumkin')
        } else {
          setUnameState('bad')
          setUnameMsg(r.reason || 'Bu nom band')
        }
      } catch {
        setUnameState('idle')
      }
    }, 450)
    return () => clearTimeout(t)
  }, [username, changedUname])

  const save = async () => {
    if (changedUname && unameState !== 'ok') {
      toast.error('Foydalanuvchi nomi tekshirilishi kerak — band bo\u2018lmasin')
      return
    }
    setSaving(true)
    try {
      await api('/api/me', {
        method: 'PATCH',
        body: {
          name,
          bio,
          avatar,
          phone,
          topicSlugs: interestSlugs,
          ...(changedUname ? { username: username.trim().toLowerCase() } : {}),
        },
      })
      toast.success('Sozlamalar saqlandi ✅')
      window.location.reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleInterest = (slug: string) => {
    setInterestSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  const unblock = async (u: { id: string; name: string }) => {
    try {
      await api('/api/blocks', { method: 'DELETE', body: { userId: u.id } })
      setBlocked((prev) => prev.filter((b) => b.id !== u.id))
      toast.success(`${u.name} blokdan chiqarildi`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ===== Kontakt amallari =====
  const addContact = async () => {
    if (!cName.trim() || !cPhone.trim()) {
      toast.error('Ism va telefon raqam kiriting')
      return
    }
    setAddingContact(true)
    try {
      const created = await api<ContactItem>('/api/contacts', {
        method: 'POST',
        body: { name: cName.trim(), phone: cPhone.trim() },
      })
      setContacts((prev) => [created, ...prev])
      if (created.linked) {
        toast.success(`Kontaktlar saqlandi — ${created.linked.name} 50Gram\u2018da topildi 🎉`)
      } else {
        toast.success('Kontakt saqlandi — bu raqam 50Gram\u2018da hali yo\u2018q')
      }
      setCName('')
      setCPhone('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddingContact(false)
    }
  }

  const deleteContact = async (c: ContactItem) => {
    try {
      await api(`/api/contacts/${c.id}`, { method: 'DELETE' })
      setContacts((prev) => prev.filter((x) => x.id !== c.id))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const messageContact = async (c: ContactItem) => {
    if (!c.linked) return
    setStarting(c.id)
    try {
      const r = await api<{ chatId: string }>('/api/chats', {
        method: 'POST',
        body: { type: 'direct', memberId: c.linked.id },
      })
      openChat(r.chatId)
      toast.success(`${c.linked.name} bilan suhbat ochildi`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setStarting(null)
    }
  }

  if (!me) return null

  const topicColors = ['text-acc-blue', 'text-acc-orange', 'text-acc-red', 'text-acc-pink', 'text-acc-purple', 'text-acc-green']
  const filteredContacts = contacts.filter(
    (c) => c.name.toLowerCase().includes(cSearch.toLowerCase()) || c.phone.includes(cSearch)
  )

  return (
    <div className="h-full">
      <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 pb-28 md:pb-8 space-y-6">
          <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2.5">
            <span className="neu h-10 w-10 rounded-full flex items-center justify-center">
              👤
            </span>
            Profil va sozlamalar
          </h2>

          {/* Akkaunt — avatar, ism, username, telefon, bio */}
          <div className="neu p-5 space-y-4 rounded-[1.6rem]">
            <div className="flex items-center gap-4">
              <div className="neu-avatar h-20 w-20 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-4xl">
                {avatar}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-lg truncate flex items-center gap-1.5">
                  {name}
                  {me.isAdmin && <BadgeCheck className="h-4 w-4 text-acc-blue shrink-0" />}
                </p>
                <p className="text-sm text-muted-foreground">@{me.username}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{bio || 'Bio yo\u2019q'}</p>
              </div>
            </div>

            <div className="groove" />

            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avatar</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {AVATAR_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setAvatar(e)}
                    className={cn(
                      'h-9 w-9 rounded-full text-lg flex items-center justify-center transition-all',
                      avatar === e ? 'neu-active' : 'neu-xs neu-press'
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pf-name" className="font-semibold flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" /> Ism
              </Label>
              <Input id="pf-name" className="input-neu rounded-full border-0" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            {/* Username — band bo'lsa o'zgartirib bo'lmaydi */}
            <div className="space-y-2">
              <Label htmlFor="pf-username" className="font-semibold flex items-center gap-1.5">
                <AtSign className="h-3.5 w-3.5" /> Foydalanuvchi nomi (username)
              </Label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">@</span>
                <Input
                  id="pf-username"
                  className="input-neu rounded-full border-0 pl-8 pr-11"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {unameState === 'checking' && <Loader2 className="h-4.5 w-4.5 animate-spin text-muted-foreground" />}
                  {unameState === 'ok' && <CheckCircle2 className="h-5 w-5 text-acc-green" />}
                  {unameState === 'bad' && <XCircle className="h-5 w-5 text-acc-red" />}
                </span>
              </div>
              {unameMsg && (
                <p className={cn('text-xs', unameState === 'ok' ? 'text-acc-green' : 'text-acc-red')}>{unameMsg}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Boshqa foydalanuvchilar shu nom bilan sizni topadi — nomni band emasligini tekshiramiz
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pf-bio" className="font-semibold">Bio</Label>
              <Textarea id="pf-bio" className="input-neu min-h-16 resize-none rounded-2xl border-0" value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-phone" className="font-semibold flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Telefon raqam
              </Label>
              <Input
                id="pf-phone"
                inputMode="tel"
                className="input-neu rounded-full border-0"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Shu raqam orqali sizni kontaktlardagilar 50Gram&apos;da topib yozishadi
              </p>
            </div>
          </div>

          {/* Kontaktlar — telefon daftari */}
          <div className="neu p-5 rounded-[1.6rem] space-y-4">
            <div className="flex items-center gap-2">
              <span className="neu-sm h-9 w-9 rounded-full flex items-center justify-center">
                <Contact className="h-4 w-4 text-acc-blue" />
              </span>
              <div>
                <h3 className="font-bold text-lg leading-none">Kontaktlar</h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Raqam saqlanganda 50Gram akkaunti avtomatik chiqadi
                </p>
              </div>
              <span className="neu-badge ml-auto px-2.5 h-6 flex items-center text-xs font-bold">
                {contacts.length}
              </span>
            </div>

            {/* Kontakt qo'shish */}
            <div className="neu-in-sm rounded-[1.2rem] p-3.5 space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <Input
                  placeholder="Kontakt ismi"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="input-neu rounded-full border-0 bg-[var(--neu-light)] h-10 text-sm"
                />
                <Input
                  placeholder="+998 90 123 45 67"
                  inputMode="tel"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  className="input-neu rounded-full border-0 bg-[var(--neu-light)] h-10 text-sm"
                />
              </div>
              <Button size="sm" className="w-full h-9 rounded-full" onClick={addContact} disabled={addingContact}>
                {addingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
                Kontakt saqlash
              </Button>
            </div>

            {/* Kontakt qidirish */}
            {contacts.length > 0 && (
              <div className="relative">
                <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Kontaktlardan qidirish..."
                  value={cSearch}
                  onChange={(e) => setCSearch(e.target.value)}
                  className="input-neu rounded-full border-0 pl-10 h-10 text-sm"
                />
              </div>
            )}

            {/* Kontakt ro'yxati */}
            <div className="space-y-1.5">
              {filteredContacts.length === 0 ? (
                <p className="neu-in-sm text-sm text-muted-foreground text-center py-4 rounded-2xl">
                  {contacts.length === 0 ? 'Hali kontakt yo\u2018q — yuqoridan qo\u2018shing' : 'Topilmadi'}
                </p>
              ) : (
                filteredContacts.map((c) => (
                  <div key={c.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                    <Avatar emoji={c.linked?.avatar ?? '👤'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                        {c.name}
                        {c.linked && (
                          <span className="neu-badge px-1.5 h-4.5 flex items-center text-[9px] font-bold text-acc-green shrink-0">
                            50 GRAM
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.phone}
                        {c.linked ? ` · @${c.linked.username}` : ' · 50Gram\u2018da yo\u2018q'}
                      </p>
                    </div>
                    {c.linked ? (
                      <Button
                        size="sm"
                        className="rounded-full h-8 px-3 shrink-0"
                        onClick={() => void messageContact(c)}
                        disabled={starting === c.id}
                      >
                        {starting === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <MessageCirclePlus className="h-3.5 w-3.5 mr-1" />
                        )}
                        Yozish
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full h-8 px-3 shrink-0"
                        onClick={() => void deleteContact(c)}
                        title="O'chirish"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {c.linked && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full h-8 px-2.5 shrink-0"
                        onClick={() => void deleteContact(c)}
                        title="O'chirish"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* To'lov tarixi — hamyon, sarflangan va daromad */}
          <div className="neu p-5 rounded-[1.6rem] space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="neu-sm h-9 w-9 rounded-full flex items-center justify-center">
                  <Wallet className="h-4 w-4 text-acc-green" />
                </span>
                <div>
                  <h3 className="font-bold text-lg leading-none">Hamyon &amp; to&apos;lovlar</h3>
                  <p className="text-[11px] text-muted-foreground mt-1">Pullik kanal obunalari tarixi</p>
                </div>
              </div>
              <div className="neu-in-sm px-3.5 py-2 rounded-2xl text-right">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Balans</p>
                <p className="text-lg font-bold leading-none mt-0.5">{fmtSum(pay?.balance ?? me.balance)} <span className="text-xs font-semibold text-muted-foreground">so&apos;m</span></p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="neu-in-sm rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1">
                  <Receipt className="h-3.5 w-3.5 text-acc-red" /> Sarflangan
                </div>
                <p className="text-xl font-bold">{fmtSum(pay?.spentTotal ?? 0)}</p>
                <p className="text-[11px] text-muted-foreground">so&apos;m · {pay?.payments.length ?? 0} to&apos;lov</p>
              </div>
              <div className="neu-in-sm rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-acc-green" /> Daromad
                </div>
                <p className="text-xl font-bold">{fmtSum(pay?.incomeTotal ?? 0)}</p>
                <p className="text-[11px] text-muted-foreground">so&apos;m · {pay?.income.length ?? 0} kirim</p>
              </div>
            </div>

            {/* Tab: mening to'lovlarim / daromadlarim */}
            <div className="flex gap-1.5">
              {([
                { key: 'paid' as const, label: 'To\u2018lovlarim' },
                { key: 'income' as const, label: 'Daromadlarim' },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setPayTab(t.key)}
                  className={cn(
                    'flex-1 h-9 rounded-full text-[13px] font-semibold transition-all',
                    payTab === t.key ? 'neu-sm neu-press text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.key === 'paid' ? 'To\u2018lovlarim' : 'Daromadlarim'}
                  {' '}({(t.key === 'paid' ? pay?.payments.length : pay?.income.length) ?? 0})
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              {payTab === 'paid' && (pay?.payments.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Hali to&apos;lov yo&apos;q — pullik kanalga obuna bo&apos;lsangiz bu yerda ko&apos;rinadi
                </p>
              )}
              {payTab === 'income' && (pay?.income.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Hali daromad yo&apos;q — pullik kanal oching, obunachilar to&apos;lovi shu yerda to&apos;planadi
                </p>
              )}
              {payTab === 'paid' &&
                pay?.payments.map((p) => (
                  <div key={p.id} className="neu-sm flex items-center gap-2.5 p-3 rounded-[1.1rem]">
                    <span className="neu-xs h-8 w-8 rounded-full flex items-center justify-center text-sm">💸</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{p.channelName}</p>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(p.createdAt)} · {p.method}</p>
                    </div>
                    <span className="text-sm font-bold text-acc-red shrink-0">-{fmtSum(p.amount)} so&apos;m</span>
                  </div>
                ))}
              {payTab === 'income' &&
                pay?.income.map((p) => (
                  <div key={p.id} className="neu-sm flex items-center gap-2.5 p-3 rounded-[1.1rem]">
                    <span className="neu-xs h-8 w-8 rounded-full flex items-center justify-center text-sm">💰</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{p.channelName}</p>
                      <p className="text-[11px] text-muted-foreground">@{p.from} · {timeAgo(p.createdAt)}</p>
                    </div>
                    <span className="text-sm font-bold text-acc-green shrink-0">+{fmtSum(p.amount)} so&apos;m</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Qora ro'yxat — bloklangan foydalanuvchilar */}
          <div className="neu p-5 rounded-[1.6rem]">
            <div className="flex items-center gap-2 mb-1">
              <span className="neu-sm h-9 w-9 rounded-full flex items-center justify-center">
                <Ban className="h-4 w-4 text-acc-red" />
              </span>
              <h3 className="font-bold text-lg">Qora ro&apos;yxat</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Bloklangan foydalanuvchilar sizga xabar yuborolmaydi
            </p>
            {blocked.length === 0 ? (
              <p className="neu-in-sm text-sm text-muted-foreground text-center py-4 rounded-2xl">
                Hali hech kim bloklanmagan
              </p>
            ) : (
              <div className="space-y-1.5">
                {blocked.map((b) => (
                  <div key={b.id} className="neu-sm flex items-center gap-2.5 p-2.5 rounded-[1.1rem]">
                    <Avatar emoji={b.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{b.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">@{b.username}</p>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-full h-8 px-3 shrink-0" onClick={() => void unblock(b)}>
                      Chiqarish
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Qiziqishlar */}
          <div className="neu p-5 space-y-3 rounded-[1.6rem]">
            <div>
              <h3 className="font-bold text-lg">Qiziqishlarim</h3>
              <p className="text-xs text-muted-foreground">
                Lenta va gazeta shu mavzular bo&apos;yicha tuziladi
              </p>
            </div>
            <div className="groove" />
            <div className="flex flex-wrap gap-2">
              {topics.map((t: Topic, i) => (
                <button
                  key={t.slug}
                  onClick={() => toggleInterest(t.slug)}
                  className={cn(
                    'px-3.5 py-1.5 text-sm rounded-full transition-all font-medium',
                    interestSlugs.includes(t.slug)
                      ? cn('neu-sm', topicColors[i % topicColors.length])
                      : 'neu-in-sm text-muted-foreground'
                  )}
                >
                  {t.emoji} {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Saqlash */}
          <div className="flex gap-3">
            <Button
              onClick={save}
              disabled={saving || name.trim().length < 2 || (changedUname && unameState !== 'ok')}
              className="flex-1 h-12 rounded-full"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Saqlash
            </Button>
            <Button variant="outline" onClick={logout} className="h-12 rounded-full">
              <LogOut className="h-4 w-4 mr-1" /> Chiqish
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
