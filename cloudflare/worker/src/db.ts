// ============================================================
// 50 Gram Worker — TiDB Serverless drayveri o'rami
// execute() javob shakli (array yoki {rows}) farqini bartaraf qiladi
// ============================================================
import { connect } from '@tidbcloud/serverless'

export type Conn = ReturnType<typeof connect>

export function openDb(url: string): Conn {
  return connect({ url })
}

export async function q<T = any>(conn: Conn, sql: string, params?: unknown[]): Promise<T[]> {
  const res = (await conn.execute(sql, params as never)) as unknown
  if (Array.isArray(res)) return res as T[]
  const r = res as { rows?: T[] }
  return (r?.rows ?? []) as T[]
}

export async function one<T = any>(conn: Conn, sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await q<T>(conn, sql, params)
  return rows[0] ?? null
}

export async function count(conn: Conn, sql: string, params?: unknown[]): Promise<number> {
  const row = await one<{ n: number }>(conn, sql, params)
  return Number(row?.n ?? 0)
}

export async function exec(conn: Conn, sql: string, params?: unknown[]): Promise<void> {
  await conn.execute(sql, params as never)
}
