// JWT (HS256) — WebCrypto, tashqi kutubxonasiz
const enc = new TextEncoder()
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const u = new Uint8Array(buf as ArrayBuffer)
  let s = ""
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const fromB64url = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/")
  while (s.length % 4) s += "="
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

const keys = new Map<string, Promise<CryptoKey>>()
function key(secret: string) {
  if (!keys.has(secret))
    keys.set(secret, crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]))
  return keys.get(secret)!
}

export async function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number) {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })))
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<any | null> {
  try {
    const [h, b, s] = (token || "").split(".")
    if (!h || !b || !s) return null
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(s), enc.encode(`${h}.${b}`))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(b)))
    return payload.exp > Date.now() / 1000 ? payload : null
  } catch {
    return null
  }
}

export async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("")
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
export function randomStr(n: number) {
  const a = crypto.getRandomValues(new Uint8Array(n))
  let s = ""
  for (const x of a) s += ALPHA[x % ALPHA.length]
  return s
}
export function randomCode() {
  const a = crypto.getRandomValues(new Uint32Array(1))[0]
  return String(100000 + (a % 900000))
}

export async function hmacHex(secret: string, data: string) {
  const sig = await crypto.subtle.sign("HMAC", await key("msg:" + secret), enc.encode(data))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
}
