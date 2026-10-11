'use client'

import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import AuthScreen from '@/components/uzbekgram/auth-screen'
import AppShell from '@/components/uzbekgram/app-shell'
import { Logo3D } from '@/components/uzbekgram/media'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const me = useStore((s) => s.me)
  const authLoading = useStore((s) => s.authLoading)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (authLoading) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-background">
        <div className="neu h-24 w-24 rounded-[1.8rem] flex items-center justify-center text-5xl mb-5 neu-float">
          ✈️
        </div>
        <h1 className="mb-3">
          <Logo3D className="text-5xl" />
        </h1>
        <div className="groove w-56 my-3" />
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground mb-6">
          Gibrid messenjer
        </p>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return me ? <AppShell /> : <AuthScreen />
}
