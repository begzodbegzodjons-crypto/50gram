// TiDB Cloud Serverless ulanishi (HTTP orqali, Cloudflare Workers'da ishlaydi)
import { connect } from "@tidbcloud/serverless"

// TiDB BIGINT/DECIMAL qiymatlarini satr ko'rinishida qaytaradi — ularni songa aylantiramiz
const NUM = new Set([
  "id", "chat_id", "sender_id", "user_id", "owner_id", "author_id", "post_id", "story_id", "viewer_id",
  "message_id", "caller_id", "callee_id", "blocked_id", "live_id", "peer_id", "created_at", "updated_at",
  // to_uid/from_uid: qo'ng'iroq signal navbati — BU IKKISI YO'Q BO'LSA, navbatdan qaytgan signal
  // `from`si STRING bo'lib qoladi va klientdagi C.peer.id !== from taqqoslamasi (number!==string)
  // HAR BIR signalni (accept/offer/answer/ice/hangup) jim o'tkazib yuboradi — WS uzilgan
  // har bir qurilmada qo'ng'iroq hal bo'lishining asosiy ildizi shu edi (v63-v65 zaxira yo'li o'lik edi)
  "to_uid", "from_uid", "foreign_uid",
  "expires_at", "joined_at", "last_read", "peer_last_read", "last_seen", "last_msg_at", "started_at",
  "ended_at", "viewed_at", "sent_at", "avatar_ver", "size", "chunks", "idx", "member_count", "unread",
  "like_count", "comment_count", "viewers", "cnt", "unseen", "liked", "video", "edited", "deleted",
  "is_public", "join_approval", "muted", "privacy_phone", "privacy_last_seen", "complete", "tries", "opt",
  "mid", "uid", "keep", "gone", "dropped", "next_check", "replicas", "pinned", "quota", "used", "views", "pinned_id",
  "online_ms", "score", "first_beat", "last_beat", "jobs", "free", "kids", "depth", "ready", "host_kids", "parent_id", "parent",
  "imp", "clk", "wt", "upd",
  "coins", "earned", "spent", "gifts_sent", "gifts_recv", "last_daily", "rewarded", "daily_left",
])

function fix(row: Record<string, unknown>) {
  for (const k in row) {
    const v = row[k]
    if (typeof v === "string" && NUM.has(k) && /^-?\d+(\.\d+)?$/.test(v)) row[k] = Number(v)
  }
  return row
}

export type Db = {
  q: (sql: string, params?: unknown[]) => Promise<any[]>
  one: (sql: string, params?: unknown[]) => Promise<any | null>
  run: (sql: string, params?: unknown[]) => Promise<void>
}

// TRANTZIENT XATO QAYTASHI («avval ishlagan funksiya keyin o'zi buzildi» sinfining yashirin ildizi):
// TiDB Cloud Serverless HTTP ko'prik orqali ishlaydi — bitta DNS/TLS titrashi, bridge 5xx yoki
// 429-throttle BUTUN so'rovni 500 «Server xatosi» qilib yuborardi. O'QISH so'rovlar idempotent —
// xavfsiz qaytariladi. YOZISH (run) QAYTARILMAYDI: javob yo'qolgan bo'lsa yozuv allaqachon
// bajarilgan bo'lishi mumkin (dublikat xabar xavfi) — yozishda xato foydalanuvchi tomonidan
// qayta urinish bilan yopiladi, bu esa dublikatdan xavfsiz.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])
function tranzient(e: unknown): boolean {
  if (e instanceof TypeError) return true // fetch failed / tarmoq uzilishi
  const m = String((e as any)?.message || e || "")
  if (/\b(fetch failed|network|terminated|ECONNRESET|ETIMEDOUT|socket|timeout)\b/i.test(m)) return true
  const st = Number((e as any)?.status || 0)
  return st > 0 && TRANSIENT_STATUS.has(st) // DatabaseError.status (TiDB ko'prik javobi)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function makeDb(url: string): Db {
  const conn = connect({ url })
  const q = async (sql: string, params: unknown[] = []) => {
    let last: unknown
    for (let i = 0; i < 3; i++) {
      // 3 urinishgacha: 1-urinish + 2 qaytash (300ms, 800ms) — o'rtacha kechikish <1s,
      // foydalanuvchi hech narsa sezmagan holda titrash yutiladi.
      try {
        const r: any = await conn.execute(sql, params as any[])
        return Array.isArray(r) ? r.map(fix) : []
      } catch (e) {
        last = e
        if (i === 2 || !tranzient(e)) throw e
        await sleep(i === 0 ? 300 : 800)
      }
    }
    throw last
  }
  return {
    q,
    one: async (sql, params = []) => (await q(sql, params))[0] || null,
    run: async (sql, params = []) => { await conn.execute(sql, params as any[]) },
  }
}

export const ph = (arr: unknown[]) => arr.map(() => "?").join(",")
