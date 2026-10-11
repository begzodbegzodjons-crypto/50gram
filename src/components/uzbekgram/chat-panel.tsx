'use client'

// ============================================================
// ChatPanel — gibrid xabar almashinuvi
//  - Matn: server orqali, hammaga yetkazilgach serverdan o'chadi
//  - Rasm: AES-GCM bilan shifrlanadi → server faqat shifrlangan
//    nusxani ko'radi → yetkazilgach o'chadi → qurilmada qoladi
//  - Tarix: IndexedDB (qurilma), serverda emas
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { api, type ChatInfo, type ServerMessage } from '@/lib/api'
import {
  compressImage,
  encryptForChat,
  decryptForChat,
  saveLocalMessage,
  getChatMessages,
  saveMedia,
  getMediaUrl,
  rememberMediaUrl,
  deleteLocalMessage,
  clearChatMessages,
  type LocalMessage,
} from '@/lib/local-store'
import { Avatar } from './media'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ArrowLeft,
  Send,
  ImageIcon,
  ShieldCheck,
  Loader2,
  Settings2,
  Trash2,
  Pin,
  PinOff,
  Crown,
  MoreVertical,
  CheckCircle2,
  BellOff,
  Bell,
  Eraser,
  Ban,
  Flag,
  LogOut,
} from 'lucide-react'
import { toast } from 'sonner'

type MsgStatus = 'sending' | 'sent' | 'purged' | 'error'

type ChatExtra = ChatInfo & {
  myRole?: 'owner' | 'admin' | 'member'
  isPublic?: boolean
  isPaid?: boolean
  price?: number
  inviteCode?: string | null
  muted?: boolean
}

interface DisplayMessage extends LocalMessage {
  status?: MsgStatus
  decrypted?: boolean
  caption?: string
  pinned?: boolean
}

export default function ChatPanel({
  chatId,
  onBack,
  onOpenAdmin,
}: {
  chatId: string
  onBack: () => void
  onOpenAdmin?: (chatId: string) => void
}) {
  const me = useStore((s) => s.me)
  const socket = useStore((s) => s.socket)
  const onlineUserIds = useStore((s) => s.onlineUserIds)

  const [chat, setChat] = useState<ChatExtra | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typingName, setTypingName] = useState<string | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  // Xabarlarni tanlab o'chirish rejimi
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Blok holati (shaxsiy suhbat)
  const [blockedByMe, setBlockedByMe] = useState(false)
  // Rasm + izoh dialogi
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [pendingCaption, setPendingCaption] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTypingSent = useRef(0)
  const tempBlob = useRef<Map<string, Blob>>(new Map()) // tempId → blob
  const tempToId = useRef<Map<string, string>>(new Map()) // tempId → messageId

  // ===== Yordamchi: xabarni qurilmaga saqlash =====
  const persistLocal = useCallback(
    async (m: LocalMessage, blob?: Blob) => {
      await saveLocalMessage(m)
      if (blob) await saveMedia(m.id, blob)
    },
    []
  )

  const setUrl = useCallback((id: string, url: string) => {
    setMediaUrls((prev) => ({ ...prev, [id]: url }))
  }, [])

  // ===== Rasm xabarini qayta ishlash (decrypt + cache) =====
  const processImage = useCallback(
    async (m: ServerMessage | DisplayMessage) => {
      const cached = await getMediaUrl(m.id)
      if (cached) {
        setUrl(m.id, cached)
        return true
      }
      if (m.type === 'image' && m.content && me) {
        try {
          const buf = await decryptForChat(m.chatId, m.content)
          const blob = new Blob([buf], { type: 'image/jpeg' })
          await saveMedia(m.id, blob)
          setUrl(m.id, URL.createObjectURL(blob))
          return true
        } catch {
          return false // kalit boshqa qurilmada (masalan yangi brauzer)
        }
      }
      return false
    },
    [me, setUrl]
  )

  // ===== Boshlang'ich yuklash =====
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setMediaUrls({})
    setSelectMode(false)
    setSelected(new Set())
    setBlockedByMe(false)

    const load = async () => {
      // 1) Qurilmadagi tarix
      let local: DisplayMessage[] = []
      try {
        local = (await getChatMessages(chatId)).map((m) => ({ ...m }))
        for (const m of local) {
          if (m.type === 'image') {
            const url = await getMediaUrl(m.id)
            if (url) setUrl(m.id, url)
          }
        }
      } catch {}
      if (cancelled) return
      setMessages(local)

      // 2) Server: chat info + kutilgan + so'nggi
      try {
        const data = await api<{
          chat: ChatExtra
          inbox: ServerMessage[]
          recent: ServerMessage[]
        }>(`/api/chats/${chatId}/messages`)
        if (cancelled) return
        setChat(data.chat)

        // Shaxsiy suhbat: blok holatini tekshiramiz
        if (data.chat.type === 'direct' && data.chat.otherUserId) {
          try {
            const r = await api<{ blocked: { id: string }[] }>('/api/blocks')
            if (!cancelled) setBlockedByMe(r.blocked.some((b) => b.id === data.chat.otherUserId))
          } catch {}
        }

        const localById = new Map(local.map((m) => [m.id, m]))
        const merged: DisplayMessage[] = [...local]

        const upsert = async (sm: ServerMessage, ack: boolean) => {
          const exists = localById.has(sm.id)
          const dm: DisplayMessage = {
            id: sm.id,
            chatId: sm.chatId,
            senderId: sm.senderId,
            senderName: (sm as ServerMessage & { senderName?: string }).senderName,
            type: sm.type,
            content: sm.content ?? undefined,
            caption: sm.caption ?? undefined,
            pinned: sm.pinned ?? false,
            mediaName: sm.mediaName ?? undefined,
            createdAt: new Date(sm.createdAt).getTime(),
            mine: sm.senderId === me?.id,
            status: sm.purged ? 'purged' : 'sent',
            decrypted: !sm.content && sm.type === 'image' ? false : undefined,
          }
          if (!exists) {
            merged.push(dm)
          } else if (dm.mine) {
            // Lokal nusxa bor — lekin purge holatini serverdan sinxronlaymiz
            const target = merged.find((m) => m.id === sm.id)
            if (target) target.status = sm.purged ? 'purged' : target.status === 'purged' ? 'purged' : target.status
          }

          if (sm.content) {
            // Hali serverda turgan — qurilmaga ko'chirib olib, keyin o'chirishga ruxsat beramiz
            if (sm.type === 'image') {
              const okDecrypt = await processImage(sm) // blobni saqlaydi + url beradi
              await persistLocal({ ...dm, content: undefined })
              if (okDecrypt) {
                setUrl(sm.id, (await getMediaUrl(sm.id))!)
              }
            } else {
              await persistLocal(dm) // matn xabari qurilmaga saqlanadi
            }
          } else if (!exists) {
            // purged + qurilmada yo'q — faqat belgi
            await persistLocal({ ...dm, content: undefined })
          }

          if (ack && sm.content) ackMessage([sm.id])
        }

        // inbox — menga yetkazilmaganlar (serverda kutib turganlar)
        for (const sm of data.inbox) await upsert(sm, true)
        // recent — purged belgilar
        for (const sm of data.recent) {
          if (!localById.has(sm.id) && !merged.some((m) => m.id === sm.id)) await upsert(sm, false)
        }

        if (cancelled) return
        merged.sort((a, b) => a.createdAt - b.createdAt)
        setMessages(merged.map((m) => ({ ...m })))
      } catch (e) {
        console.error('chat load:', e)
      }
    }

    void load()
    return () => {
      cancelled = true
    }

  }, [chatId])

  // ===== Ack (yetkazildi) — serverdan o'chirishga ruxsat =====
  const ackMessage = useCallback(
    (messageIds: string[]) => {
      socket?.emit('chat:ack', { messageIds })
    },
    [socket]
  )

  // ===== Socket hodisalari =====
  useEffect(() => {
    if (!socket || !me) return

    const onMessage = async (m: ServerMessage & { senderName?: string; senderAvatar?: string }) => {
      if (m.chatId !== chatId) return
      const dm: DisplayMessage = {
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        senderName: m.senderName,
        type: m.type,
        content: m.content ?? undefined,
        caption: m.caption ?? undefined,
        pinned: m.pinned ?? false,
        mediaName: m.mediaName ?? undefined,
        createdAt: new Date(m.createdAt).getTime(),
        mine: m.senderId === me.id,
        status: 'sent',
      }

      if (dm.type === 'image' && dm.content) {
        const okDecrypt = await processImage(m)
        if (okDecrypt) {
          const { content, ...rest } = dm
          await persistLocal(rest)
          ackMessage([m.id])
        } else {
          const { content, ...rest } = dm
          await persistLocal(rest)
        }
      } else {
        await persistLocal(dm)
        if (!dm.mine) ackMessage([m.id])
      }

      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev.map((x) => (x.id === m.id ? { ...x, status: 'sent' } : x))
        return [...prev, dm]
      })
    }

    const onSync = async (data: { messages: (ServerMessage & { senderName?: string })[] }) => {
      for (const m of data.messages) {
        if (m.chatId === chatId) await onMessage(m)
      }
    }

    const onPurged = (d: { messageId: string }) => {
      // Purge faqat serverdagi nusxaga tegishli — qurilmadagi nusxa saqlanib qoladi
      setMessages((prev) => prev.map((x) => (x.id === d.messageId ? { ...x, status: 'purged' } : x)))
    }

    // Post/xabar o'chirildi (kanal boshqaruvi yoki muallif)
    const onDeleted = (d: { chatId: string; messageId: string }) => {
      if (d.chatId !== chatId) return
      setMessages((prev) => prev.filter((x) => x.id !== d.messageId))
    }

    // Post qadaldi / yechildi
    const onPinned = (d: { chatId: string; messageId: string; pinned: boolean }) => {
      if (d.chatId !== chatId) return
      setMessages((prev) => prev.map((x) => (x.id === d.messageId ? { ...x, pinned: d.pinned } : x)))
    }

    // Chat tarixi tozalandi (o'zi yoki admin/boshqa qurilma)
    const onCleared = async (d: { chatId: string }) => {
      if (d.chatId !== chatId) return
      await clearChatMessages(chatId)
      setMessages([])
      setMediaUrls({})
      setSelected(new Set())
      setSelectMode(false)
    }

    // Server xatosi (ban/blok/ruxsat)
    const onError = (d: { tempId?: string; message?: string }) => {
      if (d.message) toast.error(d.message)
      if (d.tempId) {
        setMessages((prev) => prev.map((x) => (x.id === d.tempId ? { ...x, status: 'error' as MsgStatus } : x)))
      }
    }

    const onSent = (d: { tempId: string; messageId: string }) => {
      const realId = d.messageId
      setMessages((prev) =>
        prev.map((x) => {
          if (x.id !== d.tempId) return x
          // blobni tempId ostidan real idga ko'chiramiz
          const blob = tempBlob.current.get(d.tempId)
          if (blob) {
            saveMedia(realId, blob).then(() => {
              getMediaUrl(realId).then((u) => u && setUrl(realId, u))
            })
            tempBlob.current.delete(d.tempId)
          }
          const fixed: DisplayMessage = { ...x, id: realId, status: 'sent' }
          const rec: LocalMessage = {
            id: fixed.id,
            chatId: fixed.chatId,
            senderId: fixed.senderId,
            senderName: fixed.senderName,
            type: fixed.type,
            content: fixed.content,
            mediaName: fixed.mediaName,
            createdAt: fixed.createdAt,
            mine: fixed.mine,
          }
          void saveLocalMessage(rec)
          return fixed
        })
      )
    }

    const onTyping = (d: { chatId: string; name: string }) => {
      if (d.chatId !== chatId) return
      setTypingName(d.name)
      setTimeout(() => setTypingName((t) => (t === d.name ? null : t)), 2500)
    }

    socket.on('chat:message', onMessage)
    socket.on('chat:sync', onSync)
    socket.on('chat:purged', onPurged)
    socket.on('chat:sent', onSent)
    socket.on('chat:typing', onTyping)
    socket.on('chat:deleted', onDeleted)
    socket.on('chat:pinned', onPinned)
    socket.on('chat:cleared', onCleared)
    socket.on('chat:error', onError)

    return () => {
      socket.off('chat:message', onMessage)
      socket.off('chat:sync', onSync)
      socket.off('chat:purged', onPurged)
      socket.off('chat:sent', onSent)
      socket.off('chat:typing', onTyping)
      socket.off('chat:deleted', onDeleted)
      socket.off('chat:pinned', onPinned)
      socket.off('chat:cleared', onCleared)
      socket.off('chat:error', onError)
    }

  }, [socket, me, chatId, ackMessage, persistLocal, processImage, setUrl])

  // ===== Avto-scroll =====
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, typingName])

  // ===== Yuborish =====
  const sendText = () => {
    const text = input.trim()
    if (!text || !socket || !me) return
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const dm: DisplayMessage = {
      id: tempId,
      chatId,
      senderId: me.id,
      type: 'text',
      content: text,
      createdAt: Date.now(),
      mine: true,
      status: 'sending',
    }
    setMessages((prev) => [...prev, dm])
    setInput('')
    socket.emit('chat:send', { chatId, tempId, type: 'text', content: text })
  }

  const sendImage = async (file: File) => {
    // Rasmni oldindan ko'rish + izoh kiritish dialogini ochamiz
    setPendingImage(file)
    setPendingPreview(URL.createObjectURL(file))
    setPendingCaption('')
  }

  // Dialogdagi "Yuborish" — rasm + izoh (caption) birga ketadi
  const confirmSendImage = async () => {
    const file = pendingImage
    if (!file || !socket || !me) return
    try {
      setSending(true)
      const compressed = await compressImage(file)
      if (compressed.size > 3 * 1024 * 1024) {
        toast.error('Rasm juda katta — kichikroq rasm tanlang')
        return
      }
      const buf = await compressed.arrayBuffer()
      const encrypted = await encryptForChat(chatId, buf)
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      tempBlob.current.set(tempId, compressed)

      const dm: DisplayMessage = {
        id: tempId,
        chatId,
        senderId: me.id,
        type: 'image',
        caption: pendingCaption.trim() || undefined,
        mediaName: file.name,
        createdAt: Date.now(),
        mine: true,
        status: 'sending',
        decrypted: true,
      }
      setUrl(tempId, URL.createObjectURL(compressed))
      setMessages((prev) => [...prev, dm])
      socket.emit('chat:send', {
        chatId,
        tempId,
        type: 'image',
        content: encrypted,
        caption: pendingCaption.trim() || null,
        mediaName: file.name,
      })
      setPendingImage(null)
      setPendingPreview(null)
      setPendingCaption('')
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  const onTypingInput = () => {
    const now = Date.now()
    if (now - lastTypingSent.current > 2000 && socket) {
      lastTypingSent.current = now
      socket.emit('chat:typing', { chatId })
    }
  }

  const otherUser = chat?.otherUserId ?? null
  const isOnline = otherUser ? onlineUserIds.has(otherUser) : false

  const isChannel = chat?.type === 'channel'
  const isGroup = chat?.type === 'group'
  const isDirect = chat?.type === 'direct'
  const myRole = chat?.myRole
  const canManage = !!(myRole && ['owner', 'admin'].includes(myRole))
  const canPost = !isChannel || canManage // kanalda oddiy obunachi yozolmaydi
  const pinnedMessages = messages.filter((m) => m.pinned)

  // O'chirish/qadash ruxsatlari
  const canDeleteMsg = (m: DisplayMessage) =>
    m.mine || (canManage && (isChannel || isGroup))
  const canPinMsg = (m: DisplayMessage) => canManage && (isChannel || isGroup)

  // ===== Xabarni to'liq o'chirish: server (ruxsat bo'lsa) + qurilma =====
  const removeMessageEverywhere = async (m: DisplayMessage) => {
    if (canDeleteMsg(m) && socket) {
      socket.emit('chat:delete', { chatId, messageId: m.id })
    }
    await deleteLocalMessage(m.id)
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(m.id)
      return next
    })
  }

  // ===== Tanlash rejimi =====
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteSelected = async () => {
    if (selected.size === 0) return
    let serverCount = 0
    let localCount = 0
    for (const id of selected) {
      const m = messages.find((x) => x.id === id)
      if (!m || m.status === 'sending') continue
      if (canDeleteMsg(m) && socket) {
        socket.emit('chat:delete', { chatId, messageId: m.id })
        serverCount++
      } else {
        localCount++
      }
      await deleteLocalMessage(m.id)
    }
    const ids = selected
    setMessages((prev) => prev.filter((x) => !ids.has(x.id)))
    setSelected(new Set())
    setSelectMode(false)
    toast.success(localCount > 0 && serverCount === 0
      ? `${ids.size} ta xabar sizning nusxangizdan o'chirildi`
      : `${ids.size} ta xabar o'chirildi`)
  }

  // ===== Chat amallari (header menyusi) =====
  const muteHere = async () => {
    try {
      const r = await api<{ muted: boolean }>(`/api/chats/${chatId}/mute`, { body: {} })
      setChat((c) => (c ? { ...c, muted: r.muted } : c))
      toast.success(r.muted ? 'Chat ovozsiz qilindi 🔕' : 'Ovozi yoqildi 🔔')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const clearHere = () => {
    socket?.emit('chat:clear', { chatId })
  }

  const reportHere = async () => {
    try {
      await api('/api/reports', {
        body: { chatId, targetUserId: isDirect ? otherUser : null, kind: 'spam' },
      })
      toast.success('Shikoyat yuborildi — rahmat!')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const blockHere = async () => {
    if (!otherUser) return
    try {
      await api('/api/blocks', { body: { userId: otherUser } })
      setBlockedByMe(true)
      toast.success('Foydalanuvchi bloklandi — endi sizga yozolmaydi')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const unblockHere = async () => {
    if (!otherUser) return
    try {
      await api('/api/blocks', { method: 'DELETE', body: { userId: otherUser } })
      setBlockedByMe(false)
      toast.success('Blokdan chiqarildi')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const deleteChatHere = async () => {
    if (!chat) return
    try {
      if (chat.ownerId === me?.id && !isDirect) {
        await api(`/api/chats/${chatId}`, { method: 'DELETE' })
        toast.success(isChannel ? 'Kanal o\'chirildi' : 'Guruh o\'chirildi')
      } else {
        await api(`/api/chats/${chatId}/leave`, { body: {} })
        toast.success(isDirect
          ? 'Suhbat o\'chirildi'
          : isChannel ? 'Obunadan chiqdingiz' : 'Guruhdan chiqdingiz')
      }
      await clearChatMessages(chatId)
      onBack()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const renderStatus = (m: DisplayMessage) => {
    if (!m.mine) return null
    if (m.status === 'sending') return <span title="Yuborilmoqda">⏳</span>
    if (m.status === 'sent') return <span title="Yetkazilmoqda">✓</span>
    if (m.status === 'purged')
      return (
        <span className="inline-flex items-center gap-0.5 text-acc-green" title="Yetkazildi">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
      )
    return null
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — yumshoq panel */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Button variant="ghost" size="icon" className="md:hidden rounded-full" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar emoji={chat?.avatar ?? '🙂'} online={isOnline} />
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate flex items-center gap-1.5">
            <span className="truncate">{chat?.name ?? 'Suhbat'}</span>
            {isChannel && chat?.isPaid && (
              <span className="neu-badge px-1.5 py-0.5 text-[8px] font-bold shrink-0">PRO</span>
            )}
            {canManage && <Crown className="h-3.5 w-3.5 text-acc-orange shrink-0" />}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {typingName ? (
              <span className="text-acc-blue font-semibold">{typingName} yozmoqda...</span>
            ) : chat?.type === 'direct' ? (
              isOnline ? 'onlayn' : 'oflayn'
            ) : isChannel ? (
              <>
                {chat?.memberCount ?? 0} obunachi
                {chat?.isPaid && chat.price ? ` · ${chat.price.toLocaleString('uz-UZ')} so'm/oy` : ' · bepul'}
                {!chat?.isPublic && ' · yopiq'}
              </>
            ) : (
              `${chat?.memberCount ?? 0} a\u2019zo`
            )}
          </p>
        </div>
        {canManage && (isChannel || isGroup) && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full shrink-0"
            onClick={() => onOpenAdmin?.(chatId)}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Boshqarish
          </Button>
        )}
        {chat?.muted && <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />}

        {/* Chat amallari menyusi */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="rounded-full shrink-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => { setSelectMode(true); setSelected(new Set()) }}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Xabarlarni tanlash
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void muteHere()}>
              {chat?.muted ? <Bell className="h-4 w-4 mr-2" /> : <BellOff className="h-4 w-4 mr-2" />}
              {chat?.muted ? 'Ovozini yoqish' : 'Ovozsiz qilish'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={clearHere}>
              <Eraser className="h-4 w-4 mr-2" /> Tarixni tozalash
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reportHere()}>
              <Flag className="h-4 w-4 mr-2" /> Spam deb xabar qilish
            </DropdownMenuItem>
            {isDirect && otherUser && (
              blockedByMe ? (
                <DropdownMenuItem onClick={() => void unblockHere()}>
                  <Ban className="h-4 w-4 mr-2" /> Blokdan chiqarish
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void blockHere()}>
                  <Ban className="h-4 w-4 mr-2" /> Bloklash
                </DropdownMenuItem>
              )
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void deleteChatHere()} className="text-acc-red focus:text-acc-red">
              {isDirect ? (
                <>
                  <Trash2 className="h-4 w-4 mr-2" /> Suhbatni o&apos;chirish
                </>
              ) : chat?.ownerId === me?.id ? (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isChannel ? 'Kanalni o&apos;chirish' : 'Guruhni o&apos;chirish'}
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4 mr-2" />
                  {isChannel ? 'Obunadan chiqish' : 'Guruhdan chiqish'}
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Qadalgan postlar — kanal/guruh tepasida */}
      {pinnedMessages.length > 0 && (
        <div className="mx-4 mb-1 neu-in-sm px-3.5 py-2 rounded-full flex items-center gap-2 overflow-hidden">
          <Pin className="h-3.5 w-3.5 shrink-0 text-acc-orange" />
          <p className="text-[11px] text-muted-foreground truncate flex-1">
            {pinnedMessages[pinnedMessages.length - 1].caption || pinnedMessages[pinnedMessages.length - 1].content || 'Rasmli post'}
          </p>
        </div>
      )}

      {/* Tanlash rejimi — amallar paneli */}
      {selectMode && (
        <div className="mx-4 mb-1 neu-sm px-4 py-2 rounded-full flex items-center gap-3">
          <p className="text-sm font-semibold flex-1">
            {selected.size > 0 ? `${selected.size} ta tanlandi` : 'Xabarlarni tanlang'}
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="rounded-full h-8"
            disabled={selected.size === 0}
            onClick={() => void deleteSelected()}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> O&apos;chirish
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full h-8"
            onClick={() => { setSelectMode(false); setSelected(new Set()) }}
          >
            Bekor qilish
          </Button>
        </div>
      )}

      {/* Xabarlar */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-3 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <p className="neu-in-sm inline-flex h-16 w-16 items-center justify-center rounded-full text-3xl mb-3">👋</p>
              <p className="font-semibold text-foreground">Xabar yozib boshlang!</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn('flex items-end gap-2', m.mine ? 'justify-end' : 'justify-start')}>
              {selectMode && (
                <button
                  onClick={() => toggleSelect(m.id)}
                  className={cn(
                    'self-center h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-all mb-1',
                    selected.has(m.id)
                      ? 'bg-acc-blue text-white'
                      : 'neu-xs text-muted-foreground'
                  )}
                  title={selected.has(m.id) ? 'Tanlamaslik' : 'Tanlash'}
                >
                  {selected.has(m.id) && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
              )}
              {!m.mine && !selectMode && messages[messages.indexOf(m) - 1]?.senderId !== m.senderId && (
                <Avatar emoji="🙂" size="xs" className="hidden sm:block" />
              )}
              <div
                onClick={() => selectMode && toggleSelect(m.id)}
                className={cn(
                  'relative max-w-[85%] sm:max-w-[70%] px-4 py-2.5',
                  m.mine
                    ? 'bubble-me'
                    : 'bubble-them',
                  m.content === undefined && m.type === 'text' && 'opacity-90',
                  selectMode && 'cursor-pointer ring-2 ring-transparent hover:ring-acc-blue/40',
                  selectMode && selected.has(m.id) && 'ring-2 ring-acc-blue!'
                )}
                style={
                  m.content === undefined && m.type === 'text'
                    ? { border: '2px dashed var(--neu-dark)', background: 'var(--neu-bg)', boxShadow: 'none' }
                    : undefined
                }
              >
                {!m.mine && messages[messages.indexOf(m) - 1]?.senderId !== m.senderId && m.senderName && (
                  <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">
                    {m.senderName}
                  </p>
                )}

                {m.type === 'image' ? (
                  mediaUrls[m.id] ? (
                    <div className="space-y-1.5">
                      <img
                        src={mediaUrls[m.id]}
                        alt={m.mediaName || 'Rasm'}
                        className="rounded-xl max-h-64 w-auto object-cover shadow-[2px_2px_8px_rgba(0,0,0,0.18)]"
                      />
                      {m.caption && (
                        <p className="text-[14px] leading-snug whitespace-pre-wrap break-words">{m.caption}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-2 text-sm font-semibold opacity-90">
                      <ImageIcon className="h-5 w-5" />
                      <span>Rasm yuklanmadi</span>
                    </div>
                  )
                ) : m.content !== undefined ? (
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.content}</p>
                ) : (
                  <p className="text-sm italic opacity-75">Xabar o&apos;chirilgan</p>
                )}

                <div className={cn('flex items-center justify-end gap-1 mt-0.5 text-[10px] font-medium', m.mine ? 'text-white/75' : 'text-muted-foreground')}>
                  <span>{new Date(m.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
                  {m.pinned && <Pin className="h-3 w-3" />}
                  {renderStatus(m)}
                </div>

                {/* Post amallari — o'chirish / qadash */}
                {!selectMode && (canDeleteMsg(m) || canPinMsg(m)) && (
                  <div
                    className={cn(
                      'absolute top-1 flex gap-1 opacity-0 hover:opacity-100 transition-opacity',
                      m.mine ? '-left-16' : '-right-16'
                    )}
                  >
                    {canPinMsg(m) && (
                      <button
                        onClick={() => {
                          socket?.emit('chat:pin', { chatId, messageId: m.id, pinned: !m.pinned })
                        }}
                        title={m.pinned ? 'Qadashni yechish' : 'Qadash'}
                        className="neu-xs h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground"
                      >
                        {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {canDeleteMsg(m) && (
                      <button
                        onClick={() => void removeMessageEverywhere(m)}
                        title="O'chirish"
                        className="neu-xs h-7 w-7 rounded-full flex items-center justify-center text-acc-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {typingName && (
            <div className="flex justify-start">
              <div className="bubble-them px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-acc-blue animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-acc-purple animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2.5 w-2.5 rounded-full bg-acc-pink animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Kirish paneli */}
      <div className="p-3">
        <div className="flex items-center gap-2.5 max-w-3xl mx-auto">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onClick={(e) => {
              // Qayta bir xil fayl tanlansa ham onChange ishlashi uchun —
              // value'ni TANLASH BOSHLANISHIDA tozalaymiz (onChange'da emas!)
              e.currentTarget.value = ''
            }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void sendImage(f)
            }}
          />
          {isDirect && blockedByMe ? (
            <div className="neu-in-sm w-full px-4 py-3 text-center text-[12px] font-semibold text-muted-foreground rounded-full flex items-center justify-center gap-2">
              Siz bu foydalanuvchini bloklagansiz
              <button onClick={() => void unblockHere()} className="text-acc-blue font-bold hover:underline">
                Blokdan chiqarish
              </button>
            </div>
          ) : canPost ? (
            <>
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
                onClick={() => fileRef.current?.click()}
                disabled={sending}
                title="Rasm + izoh yuborish"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
              </Button>
              <Input
                placeholder={isChannel ? 'Kanal post yozing...' : 'Xabar yozing...'}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  onTypingInput()
                }}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendText()}
                className="input-neu h-11 border-0 rounded-full"
              />
              <Button
                onClick={sendText}
                disabled={!input.trim()}
                className="h-11 w-11 shrink-0 rounded-full p-0"
              >
                <Send className="h-5 w-5" />
              </Button>
            </>
          ) : (
            <div className="neu-in-sm w-full px-4 py-3 text-center text-[12px] font-semibold text-muted-foreground rounded-full">
              Bu kanalda faqat egasi va adminlar post yozadi
            </div>
          )}
        </div>
      </div>

      {/* Rasm + izoh oldindan ko'rish dialogi */}
      <Dialog
        open={!!pendingImage}
        onOpenChange={(v) => {
          if (!v) {
            setPendingImage(null)
            setPendingPreview(null)
            setPendingCaption('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-bold">Rasm yuborish</DialogTitle>
          </DialogHeader>
          {pendingPreview && (
             
            <img src={pendingPreview} alt="Yuboriladigan rasm" className="rounded-xl max-h-52 w-auto object-cover mx-auto" />
          )}
          <Textarea
            placeholder="Rasmga izoh yozing (ixtiyoriy)..."
            value={pendingCaption}
            onChange={(e) => setPendingCaption(e.target.value)}
            className="input-neu min-h-16 resize-none rounded-2xl border-0"
          />
          <Button onClick={() => void confirmSendImage()} disabled={sending} className="w-full rounded-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Yuborish
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
