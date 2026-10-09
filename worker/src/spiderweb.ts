// =====================================================================
// 50 GRAM — O'RGIMCHAK TO'RI (taqsimlangan xotira tizimi) — ALOHIDA MODUL
// =====================================================================
// Task 46 (v97): foydalanuvchi talabi — «o'rgimchaklari to'ri tizimini ALOHIDA
// yozib kuchaytir, 1000 lab–100 000 lab foydalanuvchilar uchun mosla».
//
// BU MODUL NIMA QILADI:
//   Server — faqat KO'PRIK. Fayl baytlari qurilmalarda (shifrlangan, AES-256-GCM,
//   kalit faqat chat a'zolarida) va R2'da (vaqtinchalik markaziy kesh) saqlanadi.
//   Bu modul to'rning MIYASI:
//     1) peer_have  — qaysi qurilmada qaysi fayl bor (fayl emas, faqat yozuv)
//     2) nodes      — har qurilma bergan joy (≤30 GB) va ishonchliligi (score)
//     3) pin_jobs   — server tuzgan vazifa: «bu faylning nusxasini saqla»
//     4) planReplicas — nusxalar soni kamaysa avtomatik yangi qurilmalarga vazifa
//     5) p2p/signal — qurilmalar WebRTC orqali bir-biridan olishi uchun signal
//     6) p2p/verify — boshqa qurilmadan olingan tarix server imzosi bilan tekshiriladi
//
// MASSHTAB (100–100 000 bir vaqtda foydalanuvchi):
//   - p2pHave: avval HAR ELEMENT uchun 2-3 so'rov edi (200 element = ~500 so'rov
//     bir so'rovda!). Endi IN()-guruhli 2 so'rov — yuk 100 martadan ortiq kamaydi,
//     javob va DB holati BITTA-BITTA BIR XIL (xulq o'zgarmagan).
//   - planReplicas: avval har fayl uchun 2 ta og'ir JOIN-so'rov (1000 fayl =
//     2000 so'rov bir cron'da). Endi guruhlangan (GROUP BY, 100lik paketlarda) —
//     natija bir xil, cron vaqti bir necha barobar qisqaradi.
//   - Har foydalanuvchiga alohida Durable Object (UserSocket) — foydalanuvchilar
//     bir-biriga UMUMIAN halaqit qilmaydi (izolyatlar har biri alohida yadroda).
//
// MUHR QOIDALARI (o'zgartirish TAQIQLANGAN — xulq kafolati):
//   M1: REPLICA_MIN=15, REPLICA_MAX=20, kamida 2 ta «doimiy onlayn» (score≥0.5) nusxa.
//   M2: fayl bajarilmagan vazifa (pin_job) bilan qurilmada bo'lsa — chat a'zosi
//       bo'lmasa ham peer_have qabul qilinadi (fayl shifrlangan, xavfsiz).
//   M3: javob shakllari o'zgarmasin: {ok,saved}, {peers}, {jobs,drops,pinned,...}.
// =====================================================================
import type { Db } from "./db"

// Har bir foydalanuvchining qurilmasi o'z izolyatida — masshtab asosi
export type SC = {
  env: any
  db: Db
  uid: number
  req: Request
  url: URL
  p: Record<string, string>
  b: any
  wait: (p: Promise<unknown>) => void
}

export type SpiderDeps = {
  str: (v: unknown, max: number) => string
  json: (d: unknown, status?: number) => Response
  fail: (msg: string, status?: number) => never
  now: () => number
  ph: (n: any) => string
  canSee: (c: SC, uid: number, chatId: number) => Promise<boolean>
  notify: (env: any, uids: number[], ev: unknown) => Promise<void>
  signMsg: (env: any, m: any) => any
  ONLINE_MS: number
}

const GB = 1024 * 1024 * 1024
export const NODE_MAX = 30 * GB
export const REPLICA_MIN = 15
export const REPLICA_MAX = 20
export const NODE_ALIVE = 7 * 86400000 // shu muddatda ko'rinmagan qurilma nusxasi hisobga olinmaydi
export const NODE_MAX_JOBS = 25

export function makeSpiderWeb(d: SpiderDeps) {
  const { str, json, fail, now, ph, canSee, notify, signMsg } = d

  async function hasJob(c: SC, media: string, chatId: number) {
    return !!(await c.db.one("SELECT 1 AS x FROM pin_jobs WHERE media_id=? AND user_id=? AND chat_id=?", [media, c.uid, chatId]))
  }
  async function anyJob(c: SC, a: number, b: number, chatId: number) {
    return !!(await c.db.one("SELECT 1 AS x FROM pin_jobs WHERE user_id IN (?,?) AND chat_id=? LIMIT 1", [a, b, chatId]))
  }
  async function dropMedia(db: Db, where: string, params: unknown[]) {
    await db.run(`UPDATE media SET dropped=1 WHERE ${where}`, params)
    await db.run(`DELETE FROM pin_jobs WHERE media_id IN (SELECT id FROM media WHERE dropped=1 AND ${where})`, params)
  }

  // "Men bu faylning nusxasini qurilmamda saqlayapman" — batch (masshtab: 2 so'rov)
  async function p2pHave(c: SC) {
    const items = (Array.isArray(c.b.items) ? c.b.items : []).slice(0, 200)
      .map((x: any) => ({ m: str(x?.m, 32), c: Math.max(0, Number(x?.c) || 0), p: x?.p ? 1 : 0, s: Math.max(0, Number(x?.s) || 0) }))
      .filter((x: any) => /^[A-Za-z0-9_-]{6,32}$/.test(x.m))
    if (!items.length) return json({ ok: true, saved: 0 })
    const t = now()
    const chats = [...new Set(items.map((x: any) => x.c))] as number[]
    const ok = new Set<number>()
    for (const ch of chats) if (await canSee(c, c.uid, ch)) ok.add(ch)
    const ids = items.map((x: any) => x.m)
    // BATCH (Task 46 masshtab): avval elementiga 2 so'rov edi — endi 2 ta guruh-so'rov.
    const jobRows = await c.db.q(`SELECT media_id, chat_id FROM pin_jobs WHERE user_id=? AND media_id IN (${ph(ids)})`, [c.uid, ...ids])
    const jobMap = new Map<string, number>(jobRows.map((r: any) => [r.media_id, Number(r.chat_id)]))
    const medRows = await c.db.q(`SELECT id, chat_id, dropped FROM media WHERE id IN (${ph(ids)})`, ids)
    const medMap = new Map<string, any>(medRows.map((r: any) => [r.id, r]))
    const rows: unknown[][] = []
    const delJobs: string[] = []
    for (const x of items) {
      // Server topshirgan vazifa bo'yicha saqlangan nusxa (chat a'zosi bo'lmasa ham — fayl shifrlangan)
      const job = jobMap.get(x.m)
      if (job !== undefined) { x.c = job; x.p = 1 } else if (!ok.has(x.c)) continue
      const med = medMap.get(x.m)
      if (!med || med.dropped || Number(med.chat_id) !== x.c) { if (job !== undefined) delJobs.push(x.m); continue }
      rows.push([x.m, c.uid, x.c, x.p, x.s, t])
      if (job !== undefined) delJobs.push(x.m)
    }
    if (rows.length) await c.db.run(`REPLACE INTO peer_have(media_id,user_id,chat_id,pinned,size,updated_at) VALUES ${rows.map(() => "(?,?,?,?,?,?)").join(",")}`, rows.flat())
    if (delJobs.length) await c.db.run(`DELETE FROM pin_jobs WHERE user_id=? AND media_id IN (${ph(delJobs)})`, [c.uid, ...delJobs])
    return json({ ok: true, saved: rows.length })
  }

  async function p2pPeers(c: SC) {
    const chatId = Math.max(0, +(c.url.searchParams.get("chat") || 0))
    const media = str(c.url.searchParams.get("media"), 32)
    if (!media && !chatId) fail("chat yoki media kerak")
    if (!(await canSee(c, c.uid, chatId)) && !(media && (await hasJob(c, media, chatId)))) fail("Ruxsat yo‘q", 403)
    const since = now() - d.ONLINE_MS
    const rows = media
      ? await c.db.q(
        `SELECT h.user_id FROM peer_have h JOIN users u ON u.id=h.user_id LEFT JOIN nodes n ON n.user_id=h.user_id
         WHERE h.media_id=? AND h.chat_id=? AND h.user_id<>? AND u.last_seen>? ORDER BY COALESCE(n.score,0) DESC, u.last_seen DESC LIMIT 8`,
        [media, chatId, c.uid, since])
      : await c.db.q(
        `SELECT m.user_id FROM chat_members m JOIN users u ON u.id=m.user_id
         WHERE m.chat_id=? AND m.status='active' AND m.user_id<>? AND u.last_seen>? ORDER BY u.last_seen DESC LIMIT 8`,
        [chatId, c.uid, since])
    return json({ peers: rows.map((r: any) => r.user_id) })
  }

  async function p2pSignal(c: SC) {
    const to = +c.b.to, chatId = Math.max(0, +c.b.chat || 0), data = c.b.data
    if (!to || to === c.uid || !data || typeof data !== "object") fail("Noto‘g‘ri signal")
    if (JSON.stringify(data).length > 30000) fail("Signal juda katta")
    if (data.t === "offer") {
      // So'rovni server tekshiradi: so'rovchi chatni ko'ra oladimi va manba qurilmada shu chatga tegishli fayl bormi
      const w = data.want || {}
      if (!(await canSee(c, c.uid, chatId)) && !(w.type === "media" && (await hasJob(c, str(w.id, 32), chatId)))) fail("Ruxsat yo‘q", 403)
      if (w.type === "media") {
        const h = await c.db.one("SELECT 1 AS ok FROM peer_have WHERE media_id=? AND user_id=? AND chat_id=?", [str(w.id, 32), to, chatId])
        if (!h) fail("Manba topilmadi", 404)
      } else if (w.type === "hist") {
        if (!chatId) fail("chat kerak")
        const mm = await c.db.one("SELECT status FROM chat_members WHERE chat_id=? AND user_id=?", [chatId, to])
        if (mm?.status !== "active") fail("Manba topilmadi", 404)
      } else fail("So‘rov turi noto‘g‘ri")
    } else {
      // offer/answer/ice: ikki tomondan biri kanalni ko'ra olishi yoki tarmoq vazifasi bo'lishi kerak
      if (!(await canSee(c, c.uid, chatId)) && !(await canSee(c, to, chatId)) && !(await anyJob(c, c.uid, to, chatId))) fail("Ruxsat yo‘q", 403)
    }
    await notify(c.env, [to], { type: "p2p", from: c.uid, chat: chatId, data })
    return json({ ok: true })
  }

  // Boshqa qurilmadan olingan eski xabarlar haqiqiyligini tekshirish (server imzosi bo'yicha)
  async function p2pVerify(c: SC) {
    const chatId = +c.b.chat_id
    if (!chatId || !(await canSee(c, c.uid, chatId))) fail("Ruxsat yo‘q", 403)
    const list = (Array.isArray(c.b.messages) ? c.b.messages : []).slice(0, 500)
    const ok: number[] = []
    for (const m of list) {
      if (!m || m.chat_id !== chatId || m.deleted || typeof m.sig !== "string") continue
      if ((await signMsg(c.env, m)) === m.sig) ok.push(m.id)
    }
    return json({ ok })
  }

  // Nusxalar sonini tekshirib, yetishmasa yangi qurilmalarga vazifa beradi.
  // Task 46 MASSHTAB: ikkita og'ir hisob guruhlangan so'rovda (100lik paket), natija bir xil.
  async function planReplicas(db: Db, limit = 200, onlyId?: string) {
    const t = now()
    const list = onlyId
      ? await db.q("SELECT id,size,chat_id,gone FROM media WHERE id=? AND keep=1 AND dropped=0 AND complete=1", [onlyId])
      : await db.q("SELECT id,size,chat_id,gone FROM media WHERE keep=1 AND dropped=0 AND complete=1 AND next_check<? ORDER BY next_check LIMIT " + Math.min(1000, limit), [t])
    if (!list.length) return 0
    const cntMap = new Map<string, { cnt: number; strong: number }>()
    const jobMap = new Map<string, number>()
    for (let i = 0; i < list.length; i += 100) {
      const pack = list.slice(i, i + 100).map((m: any) => m.id)
      const counts = await db.q(
        `SELECT h.media_id, COUNT(*) AS cnt, SUM(CASE WHEN n.score>=0.5 THEN 1 ELSE 0 END) AS strong
         FROM peer_have h JOIN nodes n ON n.user_id=h.user_id WHERE h.media_id IN (${ph(pack)}) AND n.last_beat>? GROUP BY h.media_id`, [...pack, t - NODE_ALIVE])
      for (const r of counts) cntMap.set(r.media_id, { cnt: Number(r.cnt), strong: Number(r.strong || 0) })
      const jobs = await db.q(`SELECT media_id, COUNT(*) AS cnt FROM pin_jobs WHERE media_id IN (${ph(pack)}) GROUP BY media_id`, pack)
      for (const r of jobs) jobMap.set(r.media_id, Number(r.cnt))
    }
    for (const m of list) {
      const have = cntMap.get(m.id)?.cnt || 0
      const strong = cntMap.get(m.id)?.strong || 0
      const pending = jobMap.get(m.id) || 0
      let need = Math.max(0, REPLICA_MIN - have - pending)
      if (have + pending < REPLICA_MAX && strong < 2) need = Math.max(need, 2 - strong) // kamida 2 ta "doimiy onlayn" qurilma
      if (need > 0) {
        // Yarmi eng ishonchli qurilmalardan, yarmi tasodifiy (yuk bir joyga to'planmasin)
        const seed = Math.floor(Math.random() * 100000)
        const cand = await db.q(
          `SELECT n.user_id FROM nodes n
           WHERE n.last_beat>? AND n.quota-n.used>?
             AND n.user_id NOT IN (SELECT user_id FROM peer_have WHERE media_id=?)
             AND n.user_id NOT IN (SELECT user_id FROM pin_jobs WHERE media_id=?)
             AND (SELECT COUNT(*) FROM pin_jobs p WHERE p.user_id=n.user_id) < ?
           ORDER BY (n.score * 0.6 + ((n.user_id * 7919 + ?) % 1000) / 2500.0) DESC LIMIT ?`,
          [t - 86400000, Number(m.size) * 2 + 50 * 1024 * 1024, m.id, m.id, NODE_MAX_JOBS, seed, need])
        for (const x of cand)
          await db.run("REPLACE INTO pin_jobs(media_id,user_id,chat_id,created_at) VALUES(?,?,?,?)", [m.id, x.user_id, m.chat_id, t])
      }
      const healthy = have >= REPLICA_MIN && strong >= 2
      await db.run("UPDATE media SET replicas=?, next_check=? WHERE id=?", [have, t + (healthy ? 6 * 3600000 : 20 * 60000), m.id])
    }
    return list.length
  }

  // Qurilma har daqiqada: "men onlaynman, shuncha joy berdim, shunchasi band" — javobda vazifalar
  async function storageBeat(c: SC) {
    const t = now()
    const quota = Math.max(0, Math.min(NODE_MAX, Number(c.b.quota) || 0))
    const used = Math.max(0, Math.min(NODE_MAX * 2, Number(c.b.used) || 0))
    const n = await c.db.one("SELECT * FROM nodes WHERE user_id=?", [c.uid])
    if (!n) {
      await c.db.run("INSERT INTO nodes(user_id,quota,used,online_ms,score,first_beat,last_beat) VALUES(?,?,?,0,0,?,?)", [c.uid, quota, used, t, t])
    } else {
      const gap = t - n.last_beat
      const online = n.online_ms + (gap > 0 && gap < 150000 ? gap : 0)
      const score = Math.min(1, online / Math.max(86400000, t - n.first_beat))
      await c.db.run("UPDATE nodes SET quota=?, used=?, online_ms=?, score=?, last_beat=? WHERE user_id=?", [quota, used, online, score, t, c.uid])
    }
    // last_seen + token_exp (sliding sessiya): faol qurilma sessiyasini hech qachon o'chirib qo'ymaydi
    await c.db.run("UPDATE users SET last_seen=?, token_exp=? WHERE id=?", [t, t + 180 * 86400 * 1000, c.uid])
    const drops = (await c.db.q(
      "SELECT h.media_id FROM peer_have h JOIN media m ON m.id=h.media_id WHERE h.user_id=? AND m.dropped=1 LIMIT 200", [c.uid])).map((r: any) => r.media_id)
    if (drops.length) await c.db.run(`DELETE FROM peer_have WHERE user_id=? AND media_id IN (${ph(drops)})`, [c.uid, ...drops])
    const jobs = quota > 0 && c.b.accept !== false
      ? await c.db.q(
        `SELECT j.media_id, j.chat_id, m.size, m.sha, m.mime, m.gone FROM pin_jobs j JOIN media m ON m.id=j.media_id
         WHERE j.user_id=? AND m.dropped=0 ORDER BY j.created_at LIMIT 10`, [c.uid])
      : []
    const st = await c.db.one("SELECT COUNT(*) AS cnt, SUM(size) AS used FROM peer_have WHERE user_id=? AND pinned=1", [c.uid])
    return json({ jobs, drops, pinned: Number(st?.cnt || 0), pinned_bytes: Number(st?.used || 0), target: [REPLICA_MIN, REPLICA_MAX] })
  }

  // Qurilma joy bo'shatdi — server darhol boshqa qurilmaga nusxa buyuradi
  async function storageDrop(c: SC) {
    const ids = (Array.isArray(c.b.ids) ? c.b.ids : []).slice(0, 500).map((x: unknown) => str(x, 32)).filter(Boolean)
    if (!ids.length) return json({ ok: true })
    await c.db.run(`DELETE FROM peer_have WHERE user_id=? AND media_id IN (${ph(ids)})`, [c.uid, ...ids])
    await c.db.run(`DELETE FROM pin_jobs WHERE user_id=? AND media_id IN (${ph(ids)})`, [c.uid, ...ids])
    await c.db.run(`UPDATE media SET next_check=0 WHERE id IN (${ph(ids)})`, ids)
    c.wait(planReplicas(c.db, 50))
    return json({ ok: true })
  }

  async function storageStats(c: SC) {
    const t = now()
    const nodes = await c.db.one("SELECT COUNT(*) AS cnt, SUM(quota) AS quota, SUM(used) AS used FROM nodes WHERE last_beat>?", [t - NODE_ALIVE])
    const media = await c.db.one("SELECT COUNT(*) AS cnt, SUM(CASE WHEN replicas>=? THEN 1 ELSE 0 END) AS jobs FROM media WHERE keep=1 AND dropped=0", [REPLICA_MIN])
    // Task 46: R2 holati (shifrlangan baytlar jami) + to'r o'z-o'zini tiklash ko'rsatkichi
    const r2 = await c.db.one("SELECT COALESCE(SUM(size),0) AS n, SUM(CASE WHEN gone=1 THEN 1 ELSE 0 END) AS gone FROM media WHERE keep=1 AND dropped=0 AND gone=0 AND complete=1")
    const goneAll = await c.db.one("SELECT COUNT(*) AS cnt FROM media WHERE gone=1 AND dropped=0")
    return json({
      nodes: Number(nodes?.cnt || 0), quota: Number(nodes?.quota || 0), used: Number(nodes?.used || 0),
      files: Number(media?.cnt || 0), healthy: Number(media?.jobs || 0),
      r2_bytes: Number(r2?.n || 0), healing: Number(goneAll?.cnt || 0),
    })
  }

  return { p2pHave, p2pPeers, p2pSignal, p2pVerify, planReplicas, storageBeat, storageDrop, storageStats, hasJob, anyJob, dropMedia, NODE_MAX, REPLICA_MIN, REPLICA_MAX, NODE_ALIVE, NODE_MAX_JOBS }
}
