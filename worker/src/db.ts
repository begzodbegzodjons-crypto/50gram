// TiDB Cloud Serverless ulanishi (HTTP orqali, Cloudflare Workers'da ishlaydi)
import { connect } from "@tidbcloud/serverless"

// TiDB BIGINT/DECIMAL qiymatlarini satr ko'rinishida qaytaradi — ularni songa aylantiramiz
const NUM = new Set([
  "id", "chat_id", "sender_id", "user_id", "owner_id", "author_id", "post_id", "story_id", "viewer_id",
  "message_id", "caller_id", "callee_id", "blocked_id", "live_id", "peer_id", "created_at", "updated_at",
  "expires_at", "joined_at", "last_read", "peer_last_read", "last_seen", "last_msg_at", "started_at",
  "ended_at", "viewed_at", "sent_at", "avatar_ver", "size", "chunks", "idx", "member_count", "unread",
  "like_count", "comment_count", "viewers", "cnt", "unseen", "liked", "video", "edited", "deleted",
  "is_public", "join_approval", "muted", "privacy_phone", "privacy_last_seen", "complete", "tries", "opt",
  "mid", "uid", "keep", "gone", "dropped", "next_check", "replicas", "pinned", "quota", "used", "views", "pinned_id",
  "online_ms", "score", "first_beat", "last_beat", "jobs", "free", "kids", "depth", "ready", "host_kids", "parent_id", "parent",
  "imp", "clk", "wt", "upd",
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

export function makeDb(url: string): Db {
  const conn = connect({ url })
  const q = async (sql: string, params: unknown[] = []) => {
    const r: any = await conn.execute(sql, params as any[])
    return Array.isArray(r) ? r.map(fix) : []
  }
  return {
    q,
    one: async (sql, params = []) => (await q(sql, params))[0] || null,
    run: async (sql, params = []) => { await conn.execute(sql, params as any[]) },
  }
}

export const ph = (arr: unknown[]) => arr.map(() => "?").join(",")
