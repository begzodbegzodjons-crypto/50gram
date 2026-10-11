// ============================================================
// 50 Gram Worker — umumiy tiplar
// ============================================================
export interface Env {
  DATABASE_URL: string // TiDB Cloud Serverless ulanish satri (secret)
  JWT_SECRET: string // token imzosi (secret)
  SMS_TOKEN?: string // Eskiz.uz (keyinroq SMS login uchun)
  DEV_MODE?: string // "1" — ro'yxatdan o'tishda SMS tekshiruv o'tkazilmaydi
  USER_SOCKET: DurableObjectNamespace
}
