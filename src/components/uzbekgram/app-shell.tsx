'use client'

import { useStore, type Screen } from '@/lib/store'
import ChatsView from './chats-view'
import FeedView from './feed-view'
import NewsView from './news-view'
import ProfileView from './profile-view'
import { Logo3D } from './media'
import AdminView from './admin-view'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { MessageCircle, Newspaper, Sparkles, User, Wifi, WifiOff, ShieldCheck } from 'lucide-react'

// Har bir bo'lim o'z aksent rangida — Soft UI identiteti
const NAV: { key: Screen; label: string; color: string; icon: typeof MessageCircle; adminOnly?: boolean }[] = [
  { key: 'chats', label: 'Suhbatlar', color: 'text-acc-blue', icon: MessageCircle },
  { key: 'feed', label: 'Lenta', color: 'text-acc-orange', icon: Sparkles },
  { key: 'news', label: 'Gazeta', color: 'text-acc-purple', icon: Newspaper },
  { key: 'profile', label: 'Profil', color: 'text-acc-pink', icon: User },
]

export default function AppShell() {
  const me = useStore((s) => s.me)
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const socketConnected = useStore((s) => s.socketConnected)

  // Admin uchun qo'shimcha nav elementi
  const navItems = me?.isAdmin
    ? [...NAV, { key: 'admin' as Screen, label: 'Admin', color: 'text-acc-red', icon: ShieldCheck, adminOnly: true }]
    : NAV

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      <Toaster position="top-center" richColors />

      <div className="flex flex-1 overflow-hidden">
        {/* ===== Desktop neu sidebar ===== */}
        <aside className="hidden md:flex flex-col w-64 bg-background">
          <div className="p-5 flex items-center gap-3">
            {/* Doira logo — yumshoq bo'rtgan */}
            <div className="neu h-12 w-12 rounded-[1.2rem] flex items-center justify-center text-2xl neu-float">
              ✈️
            </div>
            <div>
              <Logo3D className="text-2xl leading-none text-foreground" />
              <p className="text-[10px] font-medium text-muted-foreground mt-1 uppercase tracking-[0.18em]">
                messenjer
              </p>
            </div>
          </div>

          {/* O'yilgan ajratuvchi chiziq */}
          <div className="groove mx-6" />

          <nav className="flex-1 px-4 py-5 space-y-1.5">
            {navItems.map((n) => {
              const active = screen === n.key
              return (
                <button
                  key={n.key}
                  onClick={() => setScreen(n.key)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-2xl text-left transition-all',
                    active ? 'neu-active neu-press' : 'border border-transparent bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground active:scale-[0.98]'
                  )}
                >
                  <n.icon className={cn('h-[18px] w-[18px]', active ? n.color : 'text-muted-foreground')} />
                  <span className={cn(active && n.color)}>{n.label}</span>
                  {active && (
                    <span className={cn('ml-auto h-2 w-2 rounded-full', 'bg-current', n.color)} />
                  )}
                </button>
              )
            })}
          </nav>

          <div className="px-4 pb-5 space-y-3">
            {/* Ulanish holati — ichkariga botgan chip */}
            <div className="neu-in-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground rounded-full">
              {socketConnected ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-acc-green" />
                  <Wifi className="h-3.5 w-3.5 text-acc-green" /> Ulangan
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-acc-red animate-pulse" />
                  <WifiOff className="h-3.5 w-3.5 text-acc-red" /> Ulanmoqda...
                </>
              )}
            </div>

            <button
              onClick={() => setScreen('profile')}
              className="border border-border bg-[var(--neu-light)] neu-press w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-left"
            >
              <div className="neu-avatar h-9 w-9 bg-[linear-gradient(145deg,var(--neu-light),var(--neu-bg))] flex items-center justify-center text-lg">
                {me?.avatar}
              </div>
              <div className="min-w-0 text-left">
                <p className="text-sm font-semibold truncate text-foreground">{me?.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">@{me?.username}</p>
              </div>
            </button>
          </div>
        </aside>

        {/* Vertikal o'yilgan chiziq — sidebar va kontent orasida */}
        <div className="hidden md:block groove-v my-6" />

        {/* ===== Kontent ===== */}
        <main className="flex-1 overflow-hidden">
          {screen === 'chats' && <ChatsView />}
          {screen === 'feed' && <FeedView />}
          {screen === 'news' && <NewsView />}
          {screen === 'profile' && <ProfileView />}
          {screen === 'admin' && me?.isAdmin && <AdminView />}
        </main>
      </div>

      {/* ===== Mobil neu pastki navigatsiya — suzib turuvchi yumshoq panel ===== */}
      <nav className="md:hidden px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 bg-background z-40">
        <div className="sokin-dock flex items-center justify-around px-2 py-2">
          {navItems.map((n) => {
            const active = screen === n.key
            return (
              <button
                key={n.key}
                onClick={() => setScreen(n.key)}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-4 py-2 rounded-full min-w-[64px] transition-all',
                  active ? 'neu-active neu-press' : 'neu-press text-muted-foreground'
                )}
              >
                <n.icon className={cn('h-5 w-5', active ? n.color : '')} />
                <span className={cn('text-[9px] font-semibold', active ? n.color : '')}>
                  {n.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
