'use client'

import { cn } from '@/lib/utils'

// ===== Vaqt formatlash =====
export function timeAgo(input: string | number | Date | null | undefined): string {
  if (!input) return ''
  const d = new Date(input)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'hozir'
  if (min < 60) return `${min} daqiqa oldin`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} soat oldin`
  const day = Math.floor(h / 24)
  if (day < 7) return `${day} kun oldin`
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long' })
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ===== "50 Gram" 3D logotip — "50" qizil, "Gram" moviy =====
export function Logo3D({ className }: { className?: string }) {
  return (
    <span className={cn('logo3d', className)}>
      <span className="logo3d-red">50</span>
      <span className="logo3d-blue">Gram</span>
    </span>
  )
}

// ===== Avatar — yumshoq doira (Soft UI) =====
export function Avatar({
  emoji,
  size = 'md',
  online,
  className,
}: {
  emoji: string | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  online?: boolean
  className?: string
}) {
  const sizes = {
    xs: 'h-7 w-7 text-xs',
    sm: 'h-9 w-9 text-base',
    md: 'h-11 w-11 text-lg',
    lg: 'h-13 w-13 text-xl',
    xl: 'h-20 w-20 text-4xl',
  }
  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'neu-avatar flex items-center justify-center bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] select-none',
          sizes[size]
        )}
      >
        <span>{emoji || '🙂'}</span>
      </div>
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-acc-green border-[2.5px] border-[var(--neu-bg)]" />
      )}
    </div>
  )
}

// ===== Gradient vizual (ramsiz kontent uchun) — yumshoq bo'rtgan kvadrat =====
export function GradientVisual({
  gradient,
  emoji,
  className,
  big,
}: {
  gradient?: string | null
  emoji?: string | null
  className?: string
  big?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-gradient-to-br shadow-[0_6px_18px_rgba(34,48,45,0.14)] rounded-[1.25rem]',
        gradient || 'from-[#2fa398] to-[#2b4c7e]',
        className
      )}
    >
      <span className={cn(big ? 'text-6xl' : 'text-4xl', 'drop-shadow-[1px_1px_2px_rgba(0,0,0,0.2)] select-none')}>
        {emoji || '📰'}
      </span>
    </div>
  )
}

// ===== Emoji tanlash (ro'yxatdan o'tish, profil) =====
export const AVATAR_EMOJIS = [
  '🙂','😎','🤓','🥳','💪','🚀','⚽','🎬','🎵','💻','🌸','🏥','✈️','💼','👨‍💻','👩‍🎨','🎥','🧑‍🔬','🧕','👨‍🍳','🦉','⚡','🔥','🌟',
]

export const CHANNEL_EMOJIS = ['📢','✈️','⚽','💻','🎬','🎵','💼','✈️','🍽️','🔬','🚗','🏥','📰','🌟','🎓','🖼️']
