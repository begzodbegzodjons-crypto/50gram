'use client'

import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type NewsItem, type ChannelInfo } from '@/lib/api'
import { GradientVisual, timeAgo, CHANNEL_EMOJIS } from './media'
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
  Newspaper,
  Sparkles,
  Clock,
  Megaphone,
  Plus,
  Loader2,
  Eye,
  X,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'

export default function NewsView() {
  const topics = useStore((s) => s.topics)
  const openChat = useStore((s) => s.openChat)

  const [tab, setTab] = useState<'for-you' | 'latest' | 'channels'>('for-you')
  const [articles, setArticles] = useState<NewsItem[]>([])
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState<NewsItem | null>(null)
  const [viewed, setViewed] = useState<Set<string>>(new Set())

  // Kanal yaratish
  const [createOpen, setCreateOpen] = useState(false)
  const [chName, setChName] = useState('')
  const [chAvatar, setChAvatar] = useState('📢')
  const [chDesc, setChDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const loadNews = useCallback(async () => {
    setLoading(true)
    try {
      const mode = activeTopic ? 'latest' : tab === 'latest' ? 'latest' : 'for-you'
      const url = `/api/news?mode=${mode}${activeTopic ? `&topic=${activeTopic}` : ''}`
      const a = await api<NewsItem[]>(url)
      setArticles(a)
    } catch {}
    setLoading(false)
  }, [tab, activeTopic])

  const loadChannels = useCallback(async () => {
    try {
      const c = await api<ChannelInfo[]>('/api/channels/discover')
      setChannels(c)
    } catch {}
  }, [])

  useEffect(() => {
    if (tab === 'channels') void loadChannels()
    else void loadNews()
  }, [tab, loadNews, loadChannels])

  const openArticle = (a: NewsItem) => {
    setReading(a)
    if (!viewed.has(a.id)) {
      setViewed((prev) => new Set(prev).add(a.id))
      void api('/api/news', { method: 'POST', body: { id: a.id } }).catch(() => {})
    }
  }

  const toggleSub = async (ch: ChannelInfo) => {
    try {
      const res = await api<{ subscribed: boolean }>(`/api/channels/${ch.id}/subscribe`, {
        method: 'POST',
      })
      setChannels((prev) =>
        prev.map((c) =>
          c.id === ch.id
            ? { ...c, subscribed: res.subscribed, memberCount: c.memberCount + (res.subscribed ? 1 : -1) }
            : c
        )
      )
      toast.success(res.subscribed ? 'Obuna bo\u2019ldingiz ✅' : 'Obuna bekor qilindi')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const createChannel = async () => {
    if (chName.trim().length < 2) return
    setCreating(true)
    try {
      await api('/api/chats', {
        body: { type: 'channel', name: chName.trim(), avatar: chAvatar, description: chDesc.trim() },
      })
      setCreateOpen(false)
      setChName('')
      setChDesc('')
      toast.success('Kanal yaratildi! 📢 Suhbatlar bo\u2019limida ko\u2019rinadi')
      void loadChannels()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const topicColors = ['text-acc-blue', 'text-acc-orange', 'text-acc-red', 'text-acc-pink', 'text-acc-purple', 'text-acc-green']

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-28 md:pb-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2.5">
              <span className="neu h-10 w-10 rounded-full flex items-center justify-center">
                <Newspaper className="h-4.5 w-4.5 text-acc-purple" />
              </span>
              Elektron gazeta
            </h2>
            <div className="neu-in-sm rounded-full p-1 flex gap-1 flex-wrap">
              {(
                [
                  ['for-you', 'Yangi', Sparkles, 'text-acc-orange'],
                  ['latest', 'Barchasi', Clock, 'text-acc-blue'],
                  ['channels', 'Kanallar', Megaphone, 'text-acc-pink'],
                ] as const
              ).map(([key, label, Icon, color]) => (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key)
                    if (key !== 'channels') setActiveTopic(null)
                  }}
                  className={cn(
                    'px-3 py-1.5 text-xs sm:text-sm rounded-full flex items-center gap-1 transition-all',
                    tab === key ? cn('neu-sm font-semibold', color) : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="groove mb-4" />

          {tab === 'channels' ? (
            /* ===== Kanallar tab ===== */
            <div className="space-y-4">
              <Button
                onClick={() => setCreateOpen(true)}
                className="w-full h-12 rounded-full"
              >
                <Plus className="h-4 w-4 mr-1" /> Kanal yaratish
              </Button>
              {channels.map((ch) => (
                <div key={ch.id} className="neu neu-press flex items-center gap-3 p-3.5 rounded-[1.4rem]">
                  <GradientVisual gradient="from-[#ff9d5c] to-[#ff7bc2]" emoji={ch.avatar} className="h-12 w-12 rounded-full shrink-0" big />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{ch.name}</p>
                      {ch.subscribed && (
                        <span className="neu-in-sm text-[10px] font-semibold text-acc-green px-2 py-0.5 rounded-full">✓ obuna</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {ch.description || 'Tavsif yo\u2019q'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {ch.memberCount} obunachi
                    </p>
                  </div>
                  {ch.subscribed ? (
                    <Button variant="outline" size="sm" onClick={() => openChat(ch.id)} className="shrink-0 rounded-full">
                      Suhbatda
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => toggleSub(ch)} className="shrink-0 rounded-full">
                      Obuna bo&apos;lish
                    </Button>
                  )}
                </div>
              ))}
              {channels.length === 0 && (
                <p className="text-center text-muted-foreground py-10 text-sm">
                  Hali kanal yo&apos;q — birinchisini yaratish sizga nasib etadi!
                </p>
              )}
              <div className="groove" />
              <p className="text-[11px] text-muted-foreground text-center pb-2">
                Obuna bo&apos;lgan kanallar &quot;Suhbatlar&quot; bo&apos;limida ham ko&apos;rinadi — kanal egasi
                xabar yozganda u lentaga ham chiqadi
              </p>
            </div>
          ) : (
            /* ===== Yangiliklar ===== */
            <>
              {/* Mavzu filtrlari — neu chip */}
              <div className="flex gap-2 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => setActiveTopic(null)}
                  className={cn(
                    'shrink-0 px-3.5 py-1.5 text-xs rounded-full transition-all font-medium',
                    !activeTopic ? 'neu-sm text-foreground' : 'neu-in-sm text-muted-foreground'
                  )}
                >
                  Hammasi
                </button>
                {topics.map((t, i) => (
                  <button
                    key={t.slug}
                    onClick={() => setActiveTopic(t.slug)}
                    className={cn(
                      'shrink-0 px-3.5 py-1.5 text-xs rounded-full transition-all font-medium',
                      activeTopic === t.slug
                        ? cn('neu-sm', topicColors[i % topicColors.length])
                        : 'neu-in-sm text-muted-foreground'
                    )}
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : articles.length === 0 ? (
                <p className="text-center text-muted-foreground py-16 text-sm font-medium">
                  Bu mavzuda hali yangilik yo&apos;q
                </p>
              ) : (
                <div className="space-y-6">
                  {articles.map((a) => (
                    <article
                      key={a.id}
                      onClick={() => openArticle(a)}
                      className="neu neu-press overflow-hidden cursor-pointer rounded-[1.6rem]"
                    >
                      {a.image ? (
                        <img src={a.image} alt="" className="w-full h-44 object-cover" />
                      ) : (
                        <GradientVisual gradient={a.gradient} emoji={a.emoji} className="h-36 rounded-b-none" big />
                      )}
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="neu-in-sm text-[11px] font-semibold text-acc-blue px-2.5 py-0.5 rounded-full">
                            {a.topic.emoji} {a.topic.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{a.source}</span>
                          <span className="text-[11px] text-muted-foreground">• {timeAgo(a.publishedAt)}</span>
                        </div>
                        <h3 className="font-bold text-lg leading-snug mb-1">{a.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{a.summary}</p>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-2">
                          <Eye className="h-3 w-3" /> {a.viewCount} ko&apos;rish
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* ===== Maqola o'qish ===== */}
      <Dialog open={!!reading} onOpenChange={(o) => !o && setReading(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogTitle className="sr-only">Maqola</DialogTitle>
          {reading && (
            <>
              <button
                onClick={() => setReading(null)}
                className="neu-sm neu-press absolute top-3 right-3 z-10 h-9 w-9 rounded-full text-foreground flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
              {reading.image ? (
                <img src={reading.image} alt="" className="w-full h-56 object-cover shrink-0" />
              ) : (
                <GradientVisual gradient={reading.gradient} emoji={reading.emoji} className="h-44 shrink-0 rounded-b-none" big />
              )}
              <div className="p-6 overflow-y-auto">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="neu-in-sm text-[11px] font-semibold text-acc-blue px-2.5 py-0.5 rounded-full">
                    {reading.topic.emoji} {reading.topic.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{reading.source}</span>
                  <span className="text-xs text-muted-foreground">• {timeAgo(reading.publishedAt)}</span>
                </div>
                <h2 className="text-2xl font-bold leading-snug mb-4">{reading.title}</h2>
                <div className="groove mb-4" />
                <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">
                  {reading.content.split('\n\n').map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Kanal yaratish ===== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black">Yangi kanal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="neu-avatar h-14 w-14 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-2xl shrink-0">
                {chAvatar}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_EMOJIS.map((e) => (
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
                placeholder="Masalan: Toshkent Ulangohchilari"
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
                className="input-neu min-h-16 resize-none rounded-2xl border-0"
              />
            </div>
            <Button
              onClick={createChannel}
              disabled={creating || chName.trim().length < 2}
              className="w-full rounded-full"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Yaratish
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
