'use client'

import { useEffect, useState, useCallback } from 'react'
import type { StoryItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

const DURATION = 5000

// Har bir hikoya uchun alohida taymer (index o'zgarganda qayta yaraladi)
function Timer({ onTick, onDone }: { onTick: (p: number) => void; onDone: () => void }) {
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / DURATION)
      onTick(p)
      if (p >= 1) {
        clearInterval(timer)
        onDone()
      }
    }, 50)
    return () => clearInterval(timer)
  }, [onTick, onDone])
  return null
}

export default function StoryViewer({
  stories,
  startIndex,
  onClose,
}: {
  stories: StoryItem[]
  startIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [progress, setProgress] = useState(0)

  const next = useCallback(() => {
    setIndex((i) => (i + 1 < stories.length ? i + 1 : -1))
  }, [stories.length])

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    if (index < 0) onClose()
  }, [index, onClose])

  if (index < 0) return null
  const s = stories[index]

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,23,35,0.92)] backdrop-blur-sm flex items-center justify-center">
      <Timer key={index} onTick={setProgress} onDone={next} />
      {/* Yopish — yumshoq doira tugma */}
      <button
        onClick={onClose}
        className="neu-sm neu-press absolute top-4 right-4 z-20 h-10 w-10 rounded-full text-foreground flex items-center justify-center"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Progress barlar — yumshoq trek */}
      <div className="absolute top-4 left-4 right-16 flex gap-1.5 z-20">
        {stories.map((_, i) => (
          <div key={i} className="h-1.5 flex-1 bg-white/25 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/90 rounded-full"
              style={{ width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* Header — yumshoq chip */}
      <div className="absolute top-8 left-4 z-20">
        <div className="neu-sm flex items-center gap-2 px-2.5 py-1.5 rounded-full">
          <div className="neu-avatar h-8 w-8 rounded-full bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-sm">
            {s.userAvatar || '🙂'}
          </div>
          <div>
            <p className="text-foreground text-xs font-semibold leading-none">{s.userName}</p>
            <p className="text-muted-foreground text-[10px] mt-0.5">
              {new Date(s.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>

      {/* Content — yumshoq ramka ichida */}
      <button
        className="absolute inset-y-0 left-0 w-1/3 z-10 flex items-center justify-start pl-3 group"
        onClick={prev}
        aria-label="Oldingi"
      >
        <span className="neu-sm neu-press h-11 w-11 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronLeft className="h-6 w-6 text-foreground" />
        </span>
      </button>

      <div className="neu relative w-full max-w-md aspect-[9/16] max-h-[85vh] mx-auto overflow-hidden rounded-[2rem]">
        {s.image ? (
          <img src={s.image} alt={s.caption || 'Hikoya'} className="w-full h-full object-cover" />
        ) : (
          <div className={cn('w-full h-full bg-gradient-to-br flex items-center justify-center', s.gradient || 'from-[#2fa398] to-[#2b4c7e]')}>
            <p className="text-white text-2xl font-bold text-center px-8 drop-shadow-[1px_1px_3px_rgba(0,0,0,0.3)]">
              {s.caption}
            </p>
          </div>
        )}
        {s.image && s.caption && (
          <p className="absolute bottom-6 inset-x-0 text-center text-white font-semibold px-6 drop-shadow-[1px_1px_3px_rgba(0,0,0,0.5)]">
            {s.caption}
          </p>
        )}
      </div>

      <button
        className="absolute inset-y-0 right-0 w-1/3 z-10 flex items-center justify-end pr-3 group"
        onClick={next}
        aria-label="Keyingi"
      >
        <span className="neu-sm neu-press h-11 w-11 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="h-6 w-6 text-foreground" />
        </span>
      </button>
    </div>
  )
}
