'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AVATAR_EMOJIS, Logo3D } from './media'
import {
  Loader2,
  ShieldCheck,
  Zap,
  Users,
  Leaf,
  Phone,
  ArrowRight,
  MessageSquareCode,
} from 'lucide-react'

export default function AuthScreen() {
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const topics = useStore((s) => s.topics)

  const [loginData, setLoginData] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // ===== 2 qadamli ro'yxatdan o'tish: telefon + SMS kod → Ism/Familiya =====
  const [step, setStep] = useState<1 | 2>(1)
  const [phone, setPhone] = useState('')
  const [sentCode, setSentCode] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState('🙂')
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])

  const phoneDigits = phone.replace(/\D/g, '')
  const phoneValid = phoneDigits.length >= 9

  const toggleTopic = (slug: string) => {
    setSelectedTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : prev.length < 6 ? [...prev, slug] : prev
    )
  }

  const doLogin = async () => {
    setError('')
    setBusy(true)
    try {
      await login(loginData.username.trim(), loginData.password)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 1-qadam: telefon raqamga SMS kod "yuborish" (demo rejimda kod ekranda ko'rsatiladi)
  const sendCode = () => {
    setError('')
    if (!phoneValid) {
      setError('Telefon raqamni to\u2018liq kiriting — masalan: +998 90 123 45 67')
      return
    }
    const c = String(Math.floor(10000 + Math.random() * 90000))
    setSentCode(c)
    setCode('')
  }

  const confirmCode = () => {
    setError('')
    if (code.trim() !== sentCode) {
      setError('Kod xato. SMS dagi 5 xonali kodni kiriting')
      return
    }
    setStep(2)
  }

  // 2-qadam: Ism + Familiya + parol + mavzular → hisob yaratish
  const doRegister = async () => {
    setError('')
    if (name.trim().length < 2 || surname.trim().length < 2) {
      setError('Ism va familiyangizni to\u2018liq kiriting')
      return
    }
    if (password.length < 4) {
      setError('Parol kamida 4 belgidan iborat bo\u2018lsin')
      return
    }
    if (selectedTopics.length < 3) {
      setError('Kamida 3 ta mavzu tanlang')
      return
    }
    setBusy(true)
    try {
      const username = 'u' + phoneDigits.slice(-9)
      await register({
        username,
        name: `${name.trim()} ${surname.trim()}`,
        phone,
        password,
        avatar,
        topicSlugs: selectedTopics,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Mavzular uchun aylanma aksent ranglar
  const topicColors = ['text-acc-blue', 'text-acc-orange', 'text-acc-red', 'text-acc-pink', 'text-acc-purple', 'text-acc-green']

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-10 items-center">
        {/* Chap: brend panel */}
        <div className="hidden lg:block space-y-7">
          <div>
            <div className="flex items-center gap-4 mb-5">
              <div className="neu h-16 w-16 rounded-[1.4rem] flex items-center justify-center text-4xl neu-float">
                ✈️
              </div>
              <div>
                <Logo3D className="text-6xl" />
                <p className="text-muted-foreground text-sm uppercase tracking-[0.18em] mt-1">
                  O&apos;zbekistonning zamonaviy messenjeri
                </p>
              </div>
            </div>
            <p className="text-lg text-foreground/80 leading-relaxed">
              Suhbatlar, kanallar, guruhlar va hikoyalar — <b className="text-acc-blue">hammasi bitta ilovada</b>.{' '}
              Tez, qulay va ishonchli.
            </p>
          </div>

          {/* Ajratuvchi chiziq */}
          <div className="groove max-w-md" />

          <div className="space-y-4">
            {[
              { icon: ShieldCheck, t: 'Xavfsiz uzatish', d: 'Rasmlar va fayllar himoyalangan holda uzatiladi', c: 'text-acc-blue' },
              { icon: Zap, t: 'Doim yangi lenta', d: 'Yangiliklar va qiziqarli postlar bir joyda', c: 'text-acc-orange' },
              { icon: Users, t: 'Guruh, kanal, hikoya', d: 'Elektron gazeta va kanallar bilan birga', c: 'text-acc-purple' },
              { icon: Leaf, t: 'Tez va yengil', d: 'Cheksiz foydalanuvchi — ilova hech qachon sekinlashmaydi', c: 'text-acc-green' },
            ].map((f) => (
              <div key={f.t} className="neu-sm neu-press flex gap-3 items-center p-3 pr-5 rounded-[1.3rem]">
                <div className={cn('neu h-11 w-11 rounded-full flex items-center justify-center shrink-0')}>
                  <f.icon className={cn('h-5 w-5', f.c)} />
                </div>
                <div>
                  <p className="font-semibold">{f.t}</p>
                  <p className="text-sm text-muted-foreground">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* O'ng: forma kartasi */}
        <div className="neu p-6 sm:p-8 rounded-[1.8rem]">
          {/* Mobil logo */}
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="neu h-12 w-12 rounded-[1.1rem] flex items-center justify-center text-2xl">
              ✈️
            </div>
            <div>
              <Logo3D className="text-3xl" />
              <p className="text-xs text-muted-foreground uppercase tracking-[0.18em] mt-0.5">
                Messenjer
              </p>
            </div>
          </div>

          <Tabs defaultValue="register">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="register">Ro&apos;yxatdan o&apos;tish</TabsTrigger>
              <TabsTrigger value="login">Kirish</TabsTrigger>
            </TabsList>

            {/* ===== Ro'yxatdan o'tish — 2 qadam ===== */}
            <TabsContent value="register" className="space-y-4">
              {/* Qadamlar indikatori */}
              <div className="flex items-center gap-2">
                {[
                  { n: 1, t: 'Telefon raqam' },
                  { n: 2, t: 'Ma\u2019lumotlaringiz' },
                ].map((s, i) => (
                  <div key={s.n} className="flex items-center gap-2 flex-1">
                    <div
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all w-full justify-center',
                        step === s.n ? 'bg-acc-blue text-white shadow-[0_6px_16px_-6px_rgba(31,138,128,0.6)]' : 'neu-in-sm text-muted-foreground'
                      )}
                    >
                      <span className={cn(
                        'h-5 w-5 rounded-full flex items-center justify-center text-[10px]',
                        step === s.n ? 'bg-white/20' : 'bg-background'
                      )}>
                        {s.n}
                      </span>
                      <span className="whitespace-nowrap hidden sm:inline">{s.t}</span>
                    </div>
                    {i === 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                  </div>
                ))}
              </div>

              {/* ===== 1-QADAM: Telefon raqam + SMS kod ===== */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone" className="font-semibold">Telefon raqamingiz</Label>
                    <div className="relative">
                      <Phone className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="reg-phone"
                        className="input-neu rounded-full border-0 pl-10 h-12 text-base"
                        placeholder="+998 90 123 45 67"
                        inputMode="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !sentCode && sendCode()}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Do&apos;stlaringiz sizni telefon raqamingiz orqali ham topadi
                    </p>
                  </div>

                  {!sentCode ? (
                    <Button onClick={sendCode} className="w-full h-12 text-base rounded-full">
                      SMS kod yuborish
                    </Button>
                  ) : (
                    <>
                      <div className="neu-in-sm p-3.5 rounded-2xl flex items-start gap-3">
                        <MessageSquareCode className="h-5 w-5 text-acc-blue shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground leading-relaxed">
                          <b className="text-foreground">SMS yuborildi</b> — {phone} raqamiga.
                          <div className="mt-1.5">
                            Demo rejim (haqiqiy SMS gateway ulanmagan): kodingiz —{' '}
                            <code className="neu-xs px-2 py-1 rounded-lg text-base font-black text-acc-blue tracking-widest">{sentCode}</code>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-code" className="font-semibold">5 xonali kodni kiriting</Label>
                        <Input
                          id="reg-code"
                          className="input-neu rounded-full border-0 h-12 text-base text-center tracking-[0.5em] font-bold"
                          placeholder="— — — — —"
                          inputMode="numeric"
                          maxLength={5}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={(e) => e.key === 'Enter' && confirmCode()}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => { setSentCode(''); setCode(''); setError('') }} className="h-12 rounded-full">
                          Raqamni o&apos;zgartirish
                        </Button>
                        <Button onClick={confirmCode} disabled={code.length < 5} className="flex-1 h-12 text-base rounded-full">
                          Tasdiqlash
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ===== 2-QADAM: Ism + Familiya + avatar + parol + mavzular ===== */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="reg-name" className="font-semibold">Ismingiz</Label>
                      <Input id="reg-name" className="input-neu rounded-full border-0" placeholder="Aziz" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-surname" className="font-semibold">Familiyangiz</Label>
                      <Input id="reg-surname" className="input-neu rounded-full border-0" placeholder="Karimov" value={surname} onChange={(e) => setSurname(e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                      Avatar tanlang
                    </Label>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {AVATAR_EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
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
                    <Label htmlFor="reg-password" className="font-semibold">Parol <span className="text-muted-foreground font-normal normal-case tracking-normal">(qayta kirish uchun)</span></Label>
                    <Input
                      id="reg-password"
                      type="password"
                      className="input-neu rounded-full border-0"
                      placeholder="••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && doRegister()}
                    />
                  </div>

                  <div>
                    <Label className="font-semibold">
                      Qiziqishlaringiz <span className="text-muted-foreground">({selectedTopics.length}/6, kamida 3)</span>
                    </Label>
                    <p className="text-[11px] text-muted-foreground mb-2">
                      Lentangiz va gazetangiz shu mavzular bo&apos;yicha tuziladi
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((t, i) => (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => toggleTopic(t.slug)}
                          className={cn(
                            'px-3 py-1.5 text-sm rounded-full transition-all font-medium',
                            selectedTopics.includes(t.slug)
                              ? cn('neu-sm', topicColors[i % topicColors.length])
                              : 'neu-in-sm text-muted-foreground'
                          )}
                        >
                          {t.emoji} {t.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setStep(1); setError('') }} className="h-12 rounded-full">
                      Orqaga
                    </Button>
                    <Button onClick={doRegister} disabled={busy} className="flex-1 h-12 text-base rounded-full">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hisob yaratish 🚀'}
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <p className="neu-in-sm text-sm font-medium text-acc-red px-3.5 py-2.5 rounded-2xl">{error}</p>
              )}
            </TabsContent>

            {/* ===== Kirish ===== */}
            <TabsContent value="login" className="space-y-4">
              <div className="neu-in-sm p-3.5 text-xs text-muted-foreground rounded-2xl">
                <b className="font-semibold text-foreground">Demo hisoblar:</b> aziz, dilnoza, jasur, malika, sardor,
                kamola — parol: <code className="neu-xs px-1.5 py-0.5 rounded-md text-foreground">demo123</code>
              </div>
              <div className="space-y-2">
                <Label htmlFor="log-username" className="font-semibold">Foydalanuvchi nomi yoki telefon</Label>
                <Input id="log-username" className="input-neu rounded-full border-0" placeholder="aziz yoki +998901234567" value={loginData.username} onChange={(e) => setLoginData({ ...loginData, username: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="log-password" className="font-semibold">Parol</Label>
                <Input
                  id="log-password"
                  type="password"
                  className="input-neu rounded-full border-0"
                  placeholder="demo123"
                  value={loginData.password}
                  onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && doLogin()}
                />
              </div>

              {error && (
                <p className="neu-in-sm text-sm font-medium text-acc-red px-3.5 py-2.5 rounded-2xl">{error}</p>
              )}
              <Button onClick={doLogin} disabled={busy} className="w-full h-12 text-base rounded-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Kirish'}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
