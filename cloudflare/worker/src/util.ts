// ============================================================
// 50 Gram Worker — yordamchilar
// ============================================================
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    },
  })

export const err = (message: string, status = 400) => json({ error: message }, status)

export async function readJson(req: Request): Promise<any | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

// --- Idlar: ULID uslubidagi 26 belgili satr (client string kutadi) ---
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // vaqt bo'yicha tartiblanadigan old qism (ms, 48 bit → 10 belgi)
  let out = ''
  let t = Date.now()
  for (let i = 9; i >= 0; i--) {
    out = B32[(t % 32)] + (i > 0 ? out : '')
    t = Math.floor(t / 32)
    if (i === 0 && t > 0) {
      // xavfsizlik uchun davomi random'dan
      break
    }
  }
  for (let i = out.length; i < 26; i++) out += B32[bytes[i % 16] % 32]
  return out
}

export const nowMs = () => Date.now()

export function isoOf(ms: number): string {
  return new Date(ms).toISOString()
}

export function normPhone(p: string): string {
  const digits = String(p || '').replace(/\D/g, '')
  if (digits.length === 9) return '+998' + digits
  return '+' + digits
}

export function makeInvite(): string {
  return '50g-' + Math.random().toString(36).slice(2, 10)
}

// --- gradientFor (UI bilan bir xil) ---
export const GRADIENTS = [
  'from-emerald-400 to-teal-600',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600',
  'from-cyan-400 to-sky-600',
  'from-lime-400 to-green-600',
  'from-fuchsia-400 to-purple-600',
  'from-yellow-400 to-amber-600',
  'from-teal-400 to-cyan-600',
]

export function gradientFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}

export const clampWeight = (w: number) => Math.min(6, Math.max(0, w))
export const WEIGHT_BOOST = { view: 0.05, like: 0.3, comment: 0.45, storyView: 0.02 }

export function str(v: unknown, max = 5000): string {
  return String(v ?? '').slice(0, max)
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true'
}
