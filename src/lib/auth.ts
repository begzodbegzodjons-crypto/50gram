import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import type { User } from '@prisma/client'

// Parolni scrypt bilan xeshlash (salt:hash)
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const original = Buffer.from(hash, 'hex')
  return candidate.length === original.length && timingSafeEqual(candidate, original)
}

export function makeToken(): string {
  return randomBytes(24).toString('hex')
}

// So'rovdan foydalanuvchini olish (Authorization: Bearer <token>)
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const user = await db.user.findUnique({ where: { token } })
  return user
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

// So'rovdan ADMINni olish — faqat isAdmin foydalanuvchi
export async function getAdminFromRequest(req: Request): Promise<User | null> {
  const user = await getUserFromRequest(req)
  if (!user || !user.isAdmin) return null
  return user
}

export function ok<T>(data: T) {
  return Response.json(data as object)
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
