// =====================================================================
// 50 GRAM — Web Push (Telegram-uslubidagi bildirishnomalar)
// VAPID (RFC 8292, ES256) + payload shifrlash (RFC 8291 aes128gcm)
// Cloudflare Workers WebCrypto bilan — tashqi kutubxona kerak emas.
// =====================================================================
import { makeDb, type Db } from "./db"

const enc = new TextEncoder()
const B64URL = (u: Uint8Array) => {
  let s = ""
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const fromB64u = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/")
  while (s.length % 4) s += "="
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
const cat = (...arrs: Uint8Array[]) => {
  const n = arrs.reduce((a, b) => a + b.length, 0)
  const o = new Uint8Array(n)
  let i = 0
  for (const a of arrs) { o.set(a, i); i += a.length }
  return o
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, lenBytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, lenBytes * 8))
}

// VAPID kaliti: VAPID_PRIVATE_KEY = base64url(JSON {d,x,y}), VAPID_PUBLIC_KEY = base64url(65-baytli nuqta)
let privKeyCache: { jwk: JsonWebKey; key: CryptoKey } | null = null
async function privKeyOf(env: { VAPID_PRIVATE_KEY?: string }) {
  if (!privKeyCache) {
    const raw = env.VAPID_PRIVATE_KEY || ""
    const jwk = JSON.parse(new TextDecoder().decode(fromB64u(raw)))
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
    privKeyCache = { jwk, key }
  }
  return privKeyCache
}
async function vapidJwt(env: { VAPID_PRIVATE_KEY?: string }, endpoint: string) {
  const { key } = await privKeyOf(env)
  const aud = new URL(endpoint).origin
  const h = B64URL(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))
  const p = B64URL(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: "mailto:admin@50gram.uz" })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${p}`)))
  return `${h}.${p}.${B64URL(sig)}`
}

// Payload shifrlash: aes128gcm (RFC 8188/8291) — bitta record (rs=4096, payload < 4079 bayt)
async function encryptPayload(payload: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const clientPub = fromB64u(p256dhB64)
  const authKey = fromB64u(authB64)
  const eph = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair
  // ECDH: vaqtinchalik shaxsiy kalit × MIJOZ ochiq kaliti (p256dh) — muhim: eph.publicKey emas!
  const clientPubKey = await crypto.subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, true, [])
  const shared = new Uint8Array(await (crypto.subtle as any).deriveBits({ name: "ECDH", public: clientPubKey }, eph.privateKey as any, 256))
  const ephPub = new Uint8Array((await crypto.subtle.exportKey("raw", eph.publicKey)) as ArrayBuffer)
  // PRK_key = HKDF(salt=auth, IKM=ecdh, info="WebPush: info" || 0x00 || clientPub || ephPub)
  const prk = await hkdf(authKey, shared, cat(enc.encode("WebPush: info"), new Uint8Array(1), clientPub, ephPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12)
  const pt = cat(enc.encode(payload), new Uint8Array([2, 0])) // ayirgich + kamida 1 bayt padding
  const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, pt))
  const rs = 4096
  const head = cat(salt, new Uint8Array([0, 0, (rs >> 8) & 255, rs & 255]), new Uint8Array([ephPub.length]), ephPub)
  return cat(head, ct)
}

export type PushSub = { endpoint: string; p256dh: string; auth: string }

// Bitta obunaga push yuborish: 201=ok, 404/410=obuna o'lgan, qolgani vaqtinchalik xato
export async function webPushSend(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string },
  sub: PushSub,
  payload: string,
  urgency = "normal",
  ttl = 86400,
): Promise<number> {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth)
  const jwt = await vapidJwt(env, sub.endpoint)
  const r = await fetch(sub.endpoint, {
    method: "POST",
    body: body as unknown as BodyInit,
    headers: {
      ttl: String(ttl),
      urgency,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  })
  return r.status
}

// Bir nechta foydalanuvchiga push: WS orqali ONLAYN bo'lsa push yuborilmaydi (ikkilanash yo'q).
// DO javob bermasa — baribir yuboriladi (ishonchlilik birinchi).
// opts.force — QO'NG'IROQLAR UCHUN: "online" tekshiruvi o'tkazilmaydi, push HAR DOIM yuboriladi.
// Sabab: WS "zombi" bo'lsa (soket ko'rinishi tirik, aslida o'lik) DO uni online hisoblab
// pushni o'tkazib yuborardi — qo'ng'iroq qabul qiluvchiga UMUMAN yetmasdi.
export async function pushUsers(
  env: { DATABASE_URL: string; USER_SOCKET: any; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; __db?: Db },
  uids: number[],
  payload: { t: string; b?: string; c?: number; tag?: string; call?: number },
  opts?: { urgency?: string; ttl?: number; db?: Db; force?: boolean },
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !uids.length) return
  const ids = [...new Set(uids)].slice(0, 40)
  const db = opts?.db || env.__db || makeDb(env.DATABASE_URL)
  const body = JSON.stringify(payload)
  await Promise.all(ids.map(async (uid) => {
    try {
      const subs = await db.q("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id=?", [uid])
      if (!subs.length) return // obunasi yo'q — DO so'rovi ham kerak emas (subrequest tejash)
      if (!opts?.force) {
        try {
          const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(uid)))
          const r = await stub.fetch("https://do/online")
          const j: any = await r.json().catch(() => ({ online: false }))
          if (j && j.online) return
        } catch {} // DO javob bermasa — baribir push yuboriladi (ishonchlilik birinchi)
      }
      for (const s of subs) {
        try {
          const st = await webPushSend(env, s as PushSub, body, opts?.urgency || "normal", opts?.ttl || 86400)
          if (st === 404 || st === 410) {
            const h = await crypto.subtle.digest("SHA-256", enc.encode(s.endpoint))
            const hex = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("")
            await db.run("DELETE FROM push_subs WHERE endpoint_hash=?", [hex])
          }
        } catch {}
      }
    } catch {}
  }))
}
