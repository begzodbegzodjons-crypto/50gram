// ============================================================
// 50 Gram Worker — JWT (HS256) + parol xeshi (PBKDF2-SHA256, WebCrypto)
// Seed script (node) bilan bir xil format: pbkdf2$120000$salt$hash
// ============================================================
const enc = new TextEncoder()

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const [h, b, s] = (token || '').split('.')
    if (!h || !b || !s) return null
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${b}`))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(b)))
    if (payload.exp <= Date.now() / 1000) return null
    return { sub: String(payload.sub) }
  } catch {
    return null
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return hex(new Uint8Array(d))
}

export function hex(buf: Uint8Array): string {
  return [...buf].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// --- Parol: PBKDF2-SHA256, 120 000 iteratsiya, 32 bayt ---
async function pbkdf2Bits(password: string, saltHex: string, iterations = 120000): Promise<string> {
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16))), iterations },
    keyMat,
    256
  )
  return hex(new Uint8Array(bits))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  const hash = await pbkdf2Bits(password, salt)
  return `pbkdf2$120000$${salt}$${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = parseInt(parts[1], 10) || 120000
  const candidate = await pbkdf2Bits(password, parts[2], iterations)
  // doimiy vaqtli solishtirish
  const a = enc.encode(candidate)
  const b = enc.encode(parts[3])
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
