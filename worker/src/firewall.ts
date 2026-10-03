// =====================================================================
// SEC FIREWALL — ko'rinmas himoya devori (50 Gram)
// ---------------------------------------------------------------------
// TAMOYIL: himoya haqida foydalanuvchiga HECH QANDAY ma'lumot berilmaydi
// (ilovada hech qanday ko'rinishi yo'q). Bloklangan IP oddiy "Not found"
// 404 oladi — nima uchun bloklangani, qancha bloklangani, blok bor-yo'qligi
// hattoki ma'lum bo'lmaydi (hujumchi hech narsa "sezmaydi").
//
// ARXITEKTURA:
//  • Durable Object (bitta "global" nusxa, SQLite backend) — bloklar DOIMIY:
//    isolate qayta ishga tushsa ham, boshqa shahar/PoP'dan kirsaham blok amal qiladi.
//  • index.ts tomonda isolate-ichki kesh (Map) — oddiy foydalanuvchiga NOL
//    qo'shimcha kechikish (DO so'rovi umuman qilinmaydi), hujumchi esa shu
//    PoP'da MILLIYATLAR ichida to'siladi.
//  • Fail-open: DO ishlamasa ilova ishlashda davom etadi (lokal kesh baribir
//    darg'aza to'sadi) — mavjudlik (availability) ustuvor.
//
// DARAJALAR — HUJUM = 1-URINISHDARHOL BLOK (foydalanuvchi talabi):
//  root  — tizim ildiziga/admin yo'llariga kirishga urinish  → DARHOL 30 kun
//  ext   — sayt/ilova EMAS mijoz (curl, skaner, bot)         → DARHOL 30 kun
//  inj   — in'ektsiya / traversal belgilari                  → DARHOL 30 kun
//  data  — bitta hisobdan ma'lumot tortish toshqini          → DARHOL 12 soat
//  auth  — login/kod brute-force (8 urinish/1 soat)          → 24 soat
//  flood — so'rov toshqini (3 ochko)                         → 15 daqiqa
//  tok   — yaroqsiz token toshqini (60/1 soat)               → 1 soat
//  scan  — 4xx toshqini (3 ochko)                            → 30 daqiqa
//
// "unblock" op faqat worker ICHIDAN chaqiriladi (DO tashqaridan murojaat
// qilinmaydi) — operatsion ehtiyoj uchun, hech qanday ochiq route yo'q.
// =====================================================================

const DAY = 86_400_000
const HOUR = 3_600_000

type Strike = { ip: string; kind: string; weight?: number }
type StrikeRes = { until: number; blocked: boolean }

// kind → [kerak ochko, blok muddati]
const TH: Record<string, [number, number]> = {
  root: [1, 30 * DAY],
  ext: [1, 30 * DAY],
  inj: [1, 30 * DAY],
  data: [1, 12 * HOUR],
  auth: [8, 24 * HOUR],
  flood: [3, 15 * 60_000],
  tok: [60, HOUR],
  scan: [3, 30 * 60_000],
}

export class SecFirewall {
  state: any
  ready = false

  constructor(state: any, _env: unknown) {
    this.state = state
  }

  init() {
    if (this.ready) return
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS blk(ip TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT NOT NULL)")
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS att(ip TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY(ip,k))")
    this.ready = true
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url)
      if (url.searchParams.get("op") === "refresh") return Response.json(await this.refresh())
      // UNBLOCK — faqat worker ichidan (DO'ga tashqaridan yo'l yo'q). Blok + ochkolarni tozaydi.
      if (url.searchParams.get("op") === "unblock") {
        this.init()
        const ip = (url.searchParams.get("ip") || "").trim()
        if (!ip) return Response.json({ ok: false })
        this.state.storage.sql.exec("DELETE FROM blk WHERE ip=?", ip)
        this.state.storage.sql.exec("DELETE FROM att WHERE ip=?", ip)
        return Response.json({ ok: true, ip })
      }
      if (req.method !== "POST") return new Response("Not found", { status: 404 })
      const b = (await req.json().catch(() => ({}))) as Strike
      if (!b || !b.ip || !TH[b.kind]) return new Response("Not found", { status: 404 })
      return Response.json(await this.strike(b))
    } catch {
      return Response.json({ until: 0, blocked: false })
    }
  }

  // Faol bloklar ro'yxati (isolate keshini yangilash uchun) + eskirgan yozuvlarni tozalash
  async refresh(): Promise<{ blocks: Array<[string, number]> }> {
    this.init()
    const t = Date.now()
    try { this.state.storage.sql.exec("DELETE FROM blk WHERE until <= ?", t) } catch {}
    try { this.state.storage.sql.exec("DELETE FROM att WHERE t < ?", t - 2 * HOUR) } catch {}
    const rows = this.state.storage.sql.exec("SELECT ip, until FROM blk WHERE until > ? LIMIT 5000", t).toArray()
    return { blocks: rows.map((r: any) => [String(r.ip), Number(r.until)]) }
  }

  // Ochko qo'shish — chegara oshsa IP bloklanadi (juft obyektli SQLite, konsistent)
  async strike(b: Strike): Promise<StrikeRes> {
    this.init()
    const t = Date.now()
    const { ip, kind } = b
    const [need, dur] = TH[kind]
    const w = Math.max(1, Math.min(100, Number(b.weight) || 1))
    // root — bir marta ham kechirilmaydi (tizim ildiziga urinish = jiddiy niyat)
    if (kind === "root") {
      const until = t + dur
      this.state.storage.sql.exec(
        "INSERT INTO blk(ip,until,reason) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET until=MAX(until, excluded.until), reason=excluded.reason",
        ip, until, kind,
      )
      return { until, blocked: true }
    }
    this.state.storage.sql.exec(
      "INSERT INTO att(ip,k,n,t) VALUES(?,?,?,?) ON CONFLICT(ip,k) DO UPDATE SET n=n+excluded.n, t=excluded.t",
      ip, kind, w, t,
    )
    const r = this.state.storage.sql.exec("SELECT n, t FROM att WHERE ip=? AND k=? LIMIT 1", ip, kind).toArray()
    let n = Number(r[0]?.n || 0)
    const first = Number(r[0]?.t || t)
    // 1 soat ochko yo'q bo'lsa — hisob noldan boshlanadi (eski dog'lar insonni ta'qib qilmasin)
    if (t - first > HOUR && n < need) {
      this.state.storage.sql.exec("UPDATE att SET n=?, t=? WHERE ip=? AND k=?", w, t, ip, kind)
      n = w
    }
    if (n >= need) {
      const until = t + dur
      this.state.storage.sql.exec(
        "INSERT INTO blk(ip,until,reason) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET until=MAX(until, excluded.until), reason=excluded.reason",
        ip, until, kind,
      )
      this.state.storage.sql.exec("DELETE FROM att WHERE ip=?", ip)
      return { until, blocked: true }
    }
    return { until: 0, blocked: false }
  }
}
