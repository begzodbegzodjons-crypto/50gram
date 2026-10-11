'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type FeedPost, type StoryItem, type Topic } from '@/lib/api'
import { compressImage } from '@/lib/local-store'
import { Avatar, GradientVisual, timeAgo } from './media'
import StoryViewer from './story-viewer'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Heart,
  MessageCircle,
  Eye,
  Plus,
  ImagePlus,
  Loader2,
  Flame,
  Sparkles,
  Send,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface CommentItem {
  id: string
  content: string
  createdAt: string
  userName: string
  userAvatar: string
  userUsername: string
}

export default function FeedView() {
  const me = useStore((s) => s.me)
  const topics = useStore((s) => s.topics)

  const [mode, setMode] = useState<'for-you' | 'trend'>('for-you')
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [stories, setStories] = useState<StoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set())

  // Story
  const [storyOpen, setStoryOpen] = useState(false)
  const [storyIndex, setStoryIndex] = useState(0)

  // Composer
  const [composerOpen, setComposerOpen] = useState(false)
  const [postText, setPostText] = useState('')
  const [postImage, setPostImage] = useState<string | null>(null)
  const [postTopics, setPostTopics] = useState<string[]>([])
  const [posting, setPosting] = useState(false)

  // Comments
  const [commentPost, setCommentPost] = useState<FeedPost | null>(null)
  const [comments, setComments] = useState<CommentItem[]>([])
  const [commentText, setCommentText] = useState('')

  const observerRef = useRef<IntersectionObserver | null>(null)

  const loadFeed = useCallback(async () => {
    try {
      const p = await api<FeedPost[]>(`/api/feed?mode=${mode}`)
      setPosts(p)
    } catch {}
    setLoading(false)
  }, [mode])

  const loadStories = useCallback(async () => {
    try {
      const s = await api<StoryItem[]>('/api/stories')
      setStories(s)
    } catch {}
  }, [])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  useEffect(() => {
    void loadStories()
  }, [loadStories])

  // Ko'rishlar — algoritm signalini yig'ish
  const markViewed = useCallback((postId: string) => {
    setViewedIds((prev) => {
      if (prev.has(postId)) return prev
      const next = new Set(prev)
      next.add(postId)
      void api(`/api/feed/${postId}/view`, { method: 'POST' }).catch(() => {})
      return next
    })
  }, [])

  useEffect(() => {
    if (loading || mode !== 'for-you') return
    const t = setTimeout(() => {
      observerRef.current?.disconnect()
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) markViewed(e.target.getAttribute('data-post')!)
          })
        },
        { threshold: 0.4 }
      )
      document.querySelectorAll('[data-post]').forEach((el) => observerRef.current?.observe(el))
    }, 500)
    return () => {
      clearTimeout(t)
      observerRef.current?.disconnect()
    }
  }, [posts, loading, mode, markViewed])

  // ===== Amallar =====
  const toggleLike = async (post: FeedPost) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }
          : p
      )
    )
    try {
      await api(`/api/feed/${post.id}/like`, { method: 'POST' })
    } catch {
      void loadFeed()
    }
  }

  const openComments = async (post: FeedPost) => {
    setCommentPost(post)
    try {
      const c = await api<CommentItem[]>(`/api/feed/${post.id}/comment`)
      setComments(c)
    } catch {}
  }

  const sendComment = async () => {
    if (!commentPost || !commentText.trim()) return
    try {
      const c = await api<CommentItem>(`/api/feed/${commentPost.id}/comment`, {
        body: { content: commentText.trim() },
      })
      setComments((prev) => [...prev, c])
      setCommentText('')
      setPosts((prev) =>
        prev.map((p) => (p.id === commentPost.id ? { ...p, commentCount: p.commentCount + 1 } : p))
      )
    } catch {}
  }

  const createPost = async () => {
    if (postText.trim().length < 2 || postTopics.length === 0) return
    setPosting(true)
    try {
      await api('/api/feed', {
        body: { content: postText.trim(), image: postImage, topicSlugs: postTopics },
      })
      setComposerOpen(false)
      setPostText('')
      setPostImage(null)
      setPostTopics([])
      toast.success('Post lenta\u2019ga chiqdi! 🎉')
      void loadFeed()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPosting(false)
    }
  }

  const onPickImage = async (file: File) => {
    try {
      const blob = await compressImage(file, 1080, 0.75)
      if (blob.size > 1.8 * 1024 * 1024) {
        toast.error('Rasm juda katta, kichikroq rasm tanlang')
        return
      }
      const reader = new FileReader()
      reader.onload = () => setPostImage(reader.result as string)
      reader.readAsDataURL(blob)
    } catch {
      toast.error('Rasmni qayta ishlashda xatolik')
    }
  }

  const createStory = async (file: File) => {
    try {
      const blob = await compressImage(file, 1080, 0.75)
      if (blob.size > 1.5 * 1024 * 1024) {
        toast.error('Hikoya rasmi juda katta')
        return
      }
      const reader = new FileReader()
      reader.onload = async () => {
        await api('/api/stories', { body: { image: reader.result } })
        toast.success('Hikoya 24 soat ko\u2019rinadi ✨')
        void loadStories()
      }
      reader.readAsDataURL(blob)
    } catch {
      toast.error('Xatolik yuz berdi')
    }
  }

  const togglePostTopic = (slug: string) => {
    setPostTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : prev.length < 3 ? [...prev, slug] : prev
    )
  }

  const topicColors = ['text-acc-blue', 'text-acc-orange', 'text-acc-red', 'text-acc-pink', 'text-acc-purple', 'text-acc-green']

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-28 md:pb-6">
          {/* Header — sarlavha + neu rejim tugmalari */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2.5">
              <span className="neu h-10 w-10 rounded-full flex items-center justify-center">
                <Sparkles className="h-4.5 w-4.5 text-acc-orange" />
              </span>
              Lenta
            </h2>
            <div className="neu-in-sm rounded-full p-1 flex gap-1">
              <button
                onClick={() => setMode('for-you')}
                className={cn(
                  'px-3.5 py-1.5 text-sm rounded-full flex items-center gap-1 transition-all',
                  mode === 'for-you'
                    ? 'neu-sm font-semibold text-acc-orange'
                    : 'text-muted-foreground'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" /> Yangi
              </button>
              <button
                onClick={() => setMode('trend')}
                className={cn(
                  'px-3.5 py-1.5 text-sm rounded-full flex items-center gap-1 transition-all',
                  mode === 'trend'
                    ? 'neu-sm font-semibold text-acc-red'
                    : 'text-muted-foreground'
                )}
              >
                <Flame className="h-3.5 w-3.5" /> Trend
              </button>
            </div>
          </div>

          {/* Hikoyalar — doira avatarlar */}
          <div className="flex gap-4 overflow-x-auto pb-4 mb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Mening hikoyam */}
            <label className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer">
              <div className="relative">
                <div className="neu-avatar h-12 w-12 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-xl">
                  {me?.avatar ?? '🙂'}
                </div>
                <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[linear-gradient(135deg,#2fa398,#1f8a80)] text-white flex items-center justify-center shadow-[0_3px_10px_-2px_rgba(31,138,128,0.5)]">
                  <Plus className="h-3 w-3" />
                </span>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">Hikoya</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void createStory(f)
                  e.target.value = ''
                }}
              />
            </label>

            {stories.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setStoryIndex(i)
                  setStoryOpen(true)
                }}
                className="flex flex-col items-center gap-1.5 shrink-0 group"
              >
                <div
                  className={cn(
                    'h-12 w-12 rounded-full p-[2.5px] bg-gradient-to-br group-hover:-translate-y-0.5 transition-transform shadow-[3px_3px_8px_var(--neu-dark),-2px_-2px_6px_var(--neu-light)]',
                    s.mine ? 'from-[#2fa398] to-[#2b4c7e]' : 'from-[#c9a23a] via-[#d9775a] to-[#8b5f9e]'
                  )}
                >
                  <div className="h-full w-full rounded-full bg-[var(--neu-bg)] p-[2px] flex items-center justify-center text-lg overflow-hidden">
                    {s.userAvatar || '🙂'}
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground max-w-14 truncate">
                  {s.mine ? 'siz' : s.userName.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>

          <div className="groove mb-4" />

          {/* Composer trigger — neu panel */}
          <button
            onClick={() => setComposerOpen(true)}
            className="neu neu-press w-full flex items-center gap-3 p-3.5 mb-5 text-left rounded-[1.5rem]"
          >
            <Avatar emoji={me?.avatar} />
            <span className="text-muted-foreground text-sm flex-1">
              Nima yangiliklar, {me?.name.split(' ')[0]}? Mavzuni belgilashni unutmang...
            </span>
            <span className="neu-sm h-9 w-9 rounded-full flex items-center justify-center shrink-0">
              <ImagePlus className="h-4 w-4 text-acc-blue" />
            </span>
          </button>

          {/* Postlar — 3D kartalar */}
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="neu inline-flex h-20 w-20 items-center justify-center rounded-full text-4xl mb-4">📰</p>
              <p className="font-semibold text-foreground text-lg">Lenta hali bo&apos;sh</p>
              <p className="text-sm mt-1">Birinchi postni siz yozing!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((p) => (
                <article
                  key={p.id}
                  data-post={p.id}
                  className="neu overflow-hidden transition-transform hover:-translate-y-0.5 rounded-[1.6rem]"
                >
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <Avatar emoji={p.authorAvatar} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{p.authorName}</p>
                        {p.channelName && (
                          <span className="neu-in-sm text-[10px] font-semibold text-muted-foreground px-2.5 py-0.5 rounded-full">
                            📢 {p.channelName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{timeAgo(p.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <p className="px-4 pb-3 text-[15px] leading-relaxed">{p.content}</p>

                  {p.image ? (
                    <img src={p.image} alt="" className="w-full max-h-96 object-cover" />
                  ) : (
                    <GradientVisual gradient={p.gradient} emoji={p.emoji} className="h-44 mx-4 mb-3 rounded-2xl" big />
                  )}

                  {/* Amallar paneli */}
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      onClick={() => toggleLike(p)}
                      className={cn(
                        'neu-xs neu-press flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-full transition-all',
                        p.likedByMe ? 'text-acc-red font-semibold' : 'text-muted-foreground'
                      )}
                    >
                      <Heart className={cn('h-4 w-4', p.likedByMe && 'fill-current')} />
                      {p.likeCount}
                    </button>
                    <button
                      onClick={() => openComments(p)}
                      className="neu-xs neu-press flex items-center gap-1.5 px-3.5 py-1.5 text-sm text-muted-foreground rounded-full"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {p.commentCount}
                    </button>
                    <span className="ml-auto neu-in-sm flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-full">
                      <Eye className="h-3.5 w-3.5" /> {p.viewCount}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ===== Post yozish dialog ===== */}
      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black">Yangi post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3">
              <Avatar emoji={me?.avatar} />
              <Textarea
                placeholder="Fikringizni yozing..."
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
                className="input-neu min-h-24 resize-none rounded-2xl border-0"
              />
            </div>

            {postImage && (
              <div className="relative">
                <img src={postImage} alt="" className="neu max-h-52 w-full object-cover rounded-2xl" />
                <button
                  onClick={() => setPostImage(null)}
                  className="absolute top-2 right-2 neu-xs h-7 w-7 rounded-full text-acc-red flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div>
              <Label className="text-xs font-black uppercase tracking-wide">
                Mavzular ({postTopics.length}/3)
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {topics.map((t, i) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => togglePostTopic(t.slug)}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-full transition-all font-medium',
                      postTopics.includes(t.slug)
                        ? cn('neu-sm', topicColors[i % topicColors.length])
                        : 'neu-in-sm text-muted-foreground'
                    )}
                  >
                    {t.emoji} {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="neu-xs neu-press flex items-center gap-2 text-sm font-medium cursor-pointer px-3.5 py-2 rounded-full">
                <ImagePlus className="h-4 w-4 text-acc-blue" />
                Rasm
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onPickImage(f)
                    e.target.value = ''
                  }}
                />
              </label>
              <Button
                onClick={createPost}
                disabled={posting || postText.trim().length < 2 || postTopics.length === 0}
                className="rounded-full"
              >
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Chop etish'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Kommentlar dialog ===== */}
      <Dialog open={!!commentPost} onOpenChange={(o) => !o && setCommentPost(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black">Kommentlar</DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto -mx-1 px-1">
            <div className="space-y-3">
              {comments.length === 0 && (
                <p className="text-sm font-medium text-muted-foreground text-center py-6">
                  Birinchi komment sizniki bo&apos;lsin!
                </p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar emoji={c.userAvatar} size="sm" />
                  <div className="flex-1 neu-in-sm rounded-2xl px-3.5 py-2">
                    <p className="text-xs font-semibold">
                      {c.userName}
                      <span className="ml-2 text-muted-foreground font-normal">
                        {timeAgo(c.createdAt)}
                      </span>
                    </p>
                    <p className="text-sm">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Komment yozing..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendComment()}
              className="input-neu rounded-full border-0"
            />
            <Button onClick={sendComment} size="icon" className="shrink-0 rounded-full p-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Story viewer ===== */}
      {storyOpen && (
        <StoryViewer
          stories={stories}
          startIndex={storyIndex}
          onClose={() => setStoryOpen(false)}
        />
      )}
    </div>
  )
}
