// ============================================================
// 50 Gram — qurilmadagi lokal ombor (IndexedDB)
//  - messages: har chatning xabar tarixi (chatId indeksi)
//  - media:    rasm/blob fayllar (xabar idsi bilan)
// Shifrlash: AES-GCM-256, kalit PBKDF2(chatId + qurilma salt, 120k iter)
// Format:    "enc:v1:<iv:b64>:<data:b64>"
// Serverda matnlar/purgelar qolmaydi — kontent faqat qurilmada.
// ============================================================

const DB_NAME = '50gram-local'
const DB_VERSION = 1
const MESSAGES = 'messages'
const MEDIA = 'media'

export interface LocalMessage {
  id: string
  chatId: string
  senderId: string
  senderName?: string
  type: string // 'text' | 'image' | ...
  content?: string
  caption?: string
  pinned?: boolean
  mediaName?: string
  createdAt: number
  mine: boolean
}

// --- Qurilma salt (bir marta yaratiladi, localStorage'da turadi) ---
function deviceSalt(): string {
  if (typeof window === 'undefined') return 'server'
  let salt = window.localStorage.getItem('50gram-device-salt')
  if (!salt) {
    const arr = crypto.getRandomValues(new Uint8Array(16))
    salt = Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    window.localStorage.setItem('50gram-device-salt', salt)
  }
  return salt
}

// --- Kalit derivatsiyasi: PBKDF2(chatId, qurilma salt, 120k, SHA-256) → AES-GCM 256 ---
async function deriveKey(chatId: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(chatId), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(chatId + ':' + deviceSalt()),
      iterations: 120000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// --- b64 yordamchilari (katta bufferlar bo'laklab o'tkaziladi) ---
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ============================================================
// IndexedDB yadros
// ============================================================
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB mavjud emas (SSR)'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(MESSAGES)) {
          const s = db.createObjectStore(MESSAGES, { keyPath: 'id' })
          s.createIndex('chatId', 'chatId', { unique: false })
        }
        if (!db.objectStoreNames.contains(MEDIA)) {
          db.createObjectStore(MEDIA, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

// ============================================================
// Xabarlar (messages store)
// ============================================================
export async function saveLocalMessage(m: LocalMessage): Promise<void> {
  await tx(MESSAGES, 'readwrite', (s) => s.put(m))
}

export async function getChatMessages(chatId: string): Promise<LocalMessage[]> {
  const all = await tx<LocalMessage[]>(
    MESSAGES,
    'readonly',
    (s) => s.index('chatId').getAll(chatId) as IDBRequest<LocalMessage[]>
  )
  return (all || []).sort((a, b) => a.createdAt - b.createdAt)
}

export async function deleteLocalMessage(id: string): Promise<void> {
  // media ham birga o'chiriladi
  await deleteMedia(id)
  await tx(MESSAGES, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

export async function clearChatMessages(chatId: string): Promise<void> {
  const all = await getChatMessages(chatId)
  for (const m of all) {
    await deleteMedia(m.id)
    await tx(MESSAGES, 'readwrite', (s) => s.delete(m.id))
  }
}

// ============================================================
// Media (media store)
// ============================================================
// Yaratilgan object URL'lar keshi — bir xil id uchun doim bir xil URL
const urlCache = new Map<string, string>()

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  // eski url keshi tozalash (yangi blob qo'yildi)
  const old = urlCache.get(id)
  if (old) {
    try {
      URL.revokeObjectURL(old)
    } catch {}
    urlCache.delete(id)
  }
  await tx(MEDIA, 'readwrite', (s) => s.put({ id, blob }))
}

export async function getMediaUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) return cached
  try {
    const rec = await tx<{ id: string; blob: Blob } | undefined>(
      MEDIA,
      'readonly',
      (s) => s.get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>
    )
    if (!rec || !rec.blob) return null
    const url = URL.createObjectURL(rec.blob)
    urlCache.set(id, url)
    return url
  } catch {
    return null
  }
}

export async function rememberMediaUrl(id: string, url: string): Promise<void> {
  // masalan yuborish paytida createObjectURL qilingan bo'lsa — eslab qolamiz
  urlCache.set(id, url)
}

async function deleteMedia(id: string): Promise<void> {
  const old = urlCache.get(id)
  if (old) {
    try {
      URL.revokeObjectURL(old)
    } catch {}
    urlCache.delete(id)
  }
  try {
    await tx(MEDIA, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
  } catch {}
}

// ============================================================
// Shifrlash: encryptForChat / decryptForChat
// ============================================================
export async function encryptForChat(chatId: string, buf: ArrayBuffer): Promise<string> {
  const key = await deriveKey(chatId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf)
  return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(data))}`
}

export async function decryptForChat(chatId: string, content: string): Promise<ArrayBuffer> {
  const parts = content.split(':')
  if (parts.length !== 4 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Noma\u2019lum shifrlash formati')
  }
  const iv = b64ToBytes(parts[2])
  const data = b64ToBytes(parts[3])
  const key = await deriveKey(chatId)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    data as unknown as BufferSource
  )
  return plain
}

// ============================================================
// Rasm siqish: max kenglik + sifat, jpeg chiqish
// ============================================================
function loadImageEl(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

export async function compressImage(file: File, maxW = 1280, quality = 0.82): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement
  try {
    source = await createImageBitmap(file)
  } catch {
    source = await loadImageEl(file)
  }
  const w0 = 'width' in source ? source.width : (source as HTMLImageElement).naturalWidth
  const h0 = 'height' in source ? source.height : (source as HTMLImageElement).naturalHeight
  const scale = Math.min(1, maxW / Math.max(1, w0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d mavjud emas')
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
  if ('close' in source && typeof source.close === 'function') source.close()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Rasmlarni siqish amalga oshmadi'))
      },
      'image/jpeg',
      quality
    )
  })
}

// ============================================================
// Statistika (Profil va boshqa joylar uchun)
// ============================================================
export async function getLocalStats(): Promise<{ messages: number; media: number; chats: number }> {
  try {
    const [msgCount, mediaCount, chats] = await Promise.all([
      tx<number>(MESSAGES, 'readonly', (s) => s.count() as IDBRequest<number>),
      tx<number>(MEDIA, 'readonly', (s) => s.count() as IDBRequest<number>),
      getChatKeys(),
    ])
    return { messages: msgCount, media: mediaCount, chats: chats.length }
  } catch {
    return { messages: 0, media: 0, chats: 0 }
  }
}

async function getChatKeys(): Promise<string[]> {
  const all = await tx<LocalMessage[]>(
    MESSAGES,
    'readonly',
    (s) => s.getAll() as IDBRequest<LocalMessage[]>
  )
  return Array.from(new Set((all || []).map((m) => m.chatId)))
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  try {
    const est = await navigator.storage?.estimate?.()
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0 }
  } catch {
    return { usage: 0, quota: 0 }
  }
}
