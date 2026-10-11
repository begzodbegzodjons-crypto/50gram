// =====================================================================
// 50 GRAM API — Cloudflare Workers + TiDB Cloud Serverless + Durable Objects
// Frontend (web/) shu Worker orqali Static Assets sifatida beriladi; API: /api/*
// =====================================================================
import { makeDb, ph, type Db } from "./db"
import { signJwt, verifyJwt, sha256, randomStr, randomCode, hmacHex } from "./auth"
import { sendSms, smsConfigured } from "./sms"
import { pushUsers } from "./push"
import { SecFirewall } from "./firewall"
// v97: O'RGIMCHAK TO'RI — taqsimlangan xotira tizimi ALOHIDA modulda (Task 46)
import { makeSpiderWeb } from "./spiderweb"
export { UserSocket } from "./realtime"
export { SecFirewall }

export interface Env {
  DATABASE_URL: string
  JWT_SECRET: string
  DEV_MODE?: string
  TEST_PHONES?: string
  // DEV rejim kodi FAQAT shu raqamlarga qaytariladi (operator). Bo'sh/yo'q bo'lsa —
  // DEV_MODE=1 bo'lsa ham HECH KIMGA kod javobda qaytmaydi (hisob o'tlash yo'li yopilgan)
  DEV_PHONES?: string
  ESKIZ_EMAIL?: string
  ESKIZ_PASSWORD?: string
  ESKIZ_FROM?: string
  SMS_TEXT?: string
  // SMS MASTER-SWITCH: "app" = kod ilova ichida qizil yozuvda (Eskiz TINCH yotadi);
  // "eskiz" = haqiqiy SMS (secretlar + balans kerak). Batafsil: sms.ts va wrangler.toml
  SMS_MODE?: string
  // v104 MAXFIY ADMIN PANEL paroli (50gram.uz/?adminpanel). Yo'q bo'lsa kod ichidagi
  // zaxira qiymat ishlaydi (wrangler.toml'dagi ADMIN_PASS bilan bir xil) — panel hech qachon yopilmaydi
  ADMIN_PASS?: string
  TURN_KEY_ID?: string
  TURN_KEY_TOKEN?: string
  // Web Push (VAPID): public = base64url(65-baytli P-256 nuqta), private = base64url(JSON {d,x,y})
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  USER_SOCKET: any
  // SEC FIREWALL — doimiy IP-bloklanganlar ombori (Durable Object, "global" nusxa)
  SEC?: { get: (id: any) => { fetch: (url: string, init?: any) => Promise<Response> }; idFromName: (s: string) => any }
  AI?: any
  // FOYDALANUVCHI MANBALARI (manba nomi klientga HECH QACHON chiqmaydi — mahfiy):
  // MY_YT: YouTube kanal ID (UC...) yoki @handle — vergul bilan ajratilgan
  // MY_IG: Instagram profil nomi — ochiq (public) akkaunt bo'lishi shart
  MY_YT?: string
  MY_IG?: string
  // IG ochiq akkaunt ham server-IP'dan bloklansa — foydalanuvchi o'z brauzeridan 'sessionid'
  // cookie qiymatini beradi (wrangler secret put MY_IG_COOKIE) — shunda IG API ishonchli ochiladi
  MY_IG_COOKIE?: string
  __db?: Db
  // Statik assetlar binlash (wrangler.toml [assets] binding) — APK yuklab olish uchun
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  // R2 FAYL OMBORI (v79): fayllarning ASOSIY manbasi — D1 bazada faqat bo'sh "marker"
  // qoladi (hisob-kitob uchun), baytlar R2'da. Binding yo'q bo'lsa kod avtomatik eski
  // D1-yo'liga qaytadi (deploy muhitida bucket bo'lmasa ham ilova ishlashda davom etadi).
  BUCKET?: { get: (k: string) => Promise<{ bodyUsed: boolean; arrayBuffer: () => Promise<ArrayBuffer>; writeHttpMetadata: (h: Headers) => void } | null>; put: (k: string, v: ArrayBuffer | Uint8Array | string) => Promise<unknown>; delete: (k: string) => Promise<unknown>; list?: (o: any) => Promise<{ objects: { key: string }[] }> }
}

type C = {
  env: Env
  db: Db
  uid: number
  req: Request
  url: URL
  p: Record<string, string>
  b: any
  wait: (p: Promise<unknown>) => void
}

const CORS = {
  "access-control-allow-origin": "*",
  // x-dev (v73): qurilma guvohnomasi — raqam qurilmaga bog'lanadi, egasi hech qachon bloklanmaydi
  "access-control-allow-headers": "authorization,content-type,x-dev",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
}
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json; charset=utf-8", ...SEC_H, ...CORS } })
// Xavfsizlik sarlavhalari — barcha javoblarga (klient uchun ko'rinmas, faqat brauzer qatlami)
// v98: HSTS (brauzer 1 yil faqat HTTPS eslab qoladi — www/subdomenlar ham, includeSubDomains)
// + Permissions-Policy (mikrofon/kamera FAQAT o'z saytdan — qo'ng'iroqlar buzilmaydi; geolokatsiya,
// to'lov, USB va boshqa kuchli API'lar tashqi sahifalarga umuman berilmaydi).
const SEC_H: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), interest-cohort=()",
}
class HttpError extends Error {
  constructor(msg: string, public status = 400) { super(msg) }
}
const fail = (msg: string, status = 400): never => { throw new HttpError(msg, status) }
const now = () => Date.now()

// ---- XATO JURNALI (doimiy) — «jim hal bo'lish» tugatilishi, server tomonda ----
// console.log Cloudflare Workers'da SAQLANMAYDI: 500-sinf xato yuz berganda ildiz
// jurnalda ko'rinmasdi. Endi har server-xato D1'ga yoziladi (err_jurnal) va egaga
// /api/jurnal orqali o'qiladi. HECH QACHON javobni buzmaydi: o'z xatosini yutadi,
// faqat fon (waitUntil) ichida yozadi. Tozalash: cleanup() 14 kundan eskilarni o'chadi.
function jurnalYoz(env: Env, path: string, uid: number, src: string, msg: string): Promise<void> {
  return (async () => {
    try {
      const db = env.__db || makeDb(env.DATABASE_URL)
      // jadval kafolati: t29ok keshlangan bo'lsa — instant return, xarajatsiz
      try { await ensureSchema(db) } catch {}
      await db.run(
        "INSERT INTO err_jurnal (ts, path, uid, src, msg) VALUES (?,?,?,?,?)",
        [Date.now(), String(path || "").slice(0, 110), uid || 0, String(src || "").slice(0, 14), String(msg ?? "").replace(/\s+/g, " ").trim().slice(0, 560)],
      )
    } catch {}
  })()
}

// =====================================================================
// SEC FIREWALL — izolyat-ichki qatlam (FOYDALANUVCHIGA KO'RINMAS).
// Oddiy foydalanuvchi: NOL qo'shimcha kechikish (xotira-tekshiruvi xolos).
// Hujumchi: milliyatlar ichida to'siladi (lokal) + doimiy blok (DO, barcha
// shaharlarda amal qiladi). Bloklanganga javob — ODDIY "Not found" 404:
// blok bor-yo'qligi, sababi, muddati HECH QANDAY shaklda oshkor qilinmaydi.
//
// KESH MODEL: lokal bloklar VAQTINCHALIK (max 2 daqiqa, v=0) — DO markaziy
// ombor ularni ≤45s ichida tasdiqlasa to'liq muddatga uzaytiriladi (v=1).
// Shunda blokni yechish (unblock) barcha izolyatlarda o'zi-o'zidan tarqaladi
// (eskirgan kesh — hujumchiga emas, foydalanuvchiga qaytishi mumkin bo'lgan
// yagona xavf — ≤2 daqiqada butunlay tozalanadi).
// =====================================================================
const FW_KESH = new Map<string, { u: number; t: number; v: 0 | 1 }>() // ip → {muddat, qo'yilgan vaqt, tasdiqlanganmi}
const FW_RATE = new Map<string, { n: number; t: number }>() // 10s toshqin oynasi
const FW_4XX = new Map<string, { n: number; t: number }>() // 10 daqiqalik 4xx oynasi
const FW_ALOC = new Map<string, { n: number; t: number }>() // lokal ochkolar (ip|tur)
const FW_DATA = new Map<number, { n: number; t: number }>() // ma'lumot-tortish posboni (uid)
// v98 YUKLASH POSBONI: o'g'irlangan token bilan R2'ni to'ldirishga urinish — hisob bo'yicha
// soatlik chegara. Haqiqiy foydalanuvchi BIRGA ham yaqinlasholmaydi:
//   v110: bo'lak-PUT 12000/soat (500MB fayl = 250 ta 2MB bo'lak — 5 ta 500MB fayl ham erkin)
//   fayl-yaratish: 600/soat | BAYT-posbon: 6GB/soat (toshqin bayt bo'yicha ham to'siladi).
// Oshsa — 429 (429 fw4xx hisobga kirmaydi, IP bloklanmaydi — ehtiyot korrigisi). R2 10GB
// posboni (cleanup'dagi bosqichli) bilan BIRGA: o'g'irlangan token toshqini ham bucketni to'ldirolmaydi.
const FW_UP = new Map<number, { n: number; t: number }>() // bo'lak-PUT hisobi (uid)
const FW_UPF = new Map<number, { n: number; t: number }>() // fayl-yaratish hisobi (uid)
const FW_UPB = new Map<number, { n: number; t: number }>() // v110: yuklangan BAYTLAR (uid) — 6GB/soat
const FW_MSG = new Map<number, { n: number; t: number }>() // v110: xabar-spam posboni (uid) — 900/soat
const FW_JLOG = new Map<string, number>() // fw-jurnal dedupe (ip|kind → oxirgi yozilgan vaqt)
// soatlik hisobgar: chegara oshsa true (klientga 429) — RAM gigiyenasi bilan
function fwSoat(m: Map<number, { n: number; t: number }>, uid: number, need: number) {
  const t = Date.now(), e = m.get(uid)
  if (!e || t - e.t > 3_600_000) { if (m.size > 10000) m.clear(); m.set(uid, { n: 1, t }); return false }
  e.n++
  return e.n > need
}
let FW_YANGI = 0
// v108 STALE-FLAG POSBONI: himoya O'CHIQ holati izolyatda UZOQ qolmasin. Egapanel himoyani
// yoqib qo'ygach, uzoq bo'sh turgan izolyat eski FW_OFF=true bilan uyg'onsa — birinchi
// so'rovlar HIMoyasiz o'tib ketardi (SECURITY E2E'da kuzatildi: curl 200, INJ 401).
// Yechim: FW_OFF=true ko'rinsa — har 5 sekundda KAMIDA BIR MARTA DO bilan sinxron tasdiqlash
// (DO yagona ishonchli manba). Himoya YONIQ bo'lganda — 0 xarajat (bu yo'l umuman ishlamaydi).
let FW_TASDIQ = 0
// v106 HIMOYA-HOLATI (egapanel tugmasi): true = himoya qatlami VAQTINCHA O'CHIQ
// (egasi o'zgartirish kiritayotganda — hujum-himoya hech narsani bloklamaydi, iz ham qolmaydi).
// Manba: SEC DO cfg jadvali — har refresh'da (≤45s) fwQollash orqali yangilanadi. Boshlang'ich: YONIQ.
let FW_OFF = false
// TIZIM ILDIGA / ADMIN YO'LLARIGA URINISH — bitta urinishda ham 30 kun blok
// (skanerlarning sevimli manzillari kengaytirildi — oddiy foydalanuvchi bu yo'llarga
//  HECH QACHON kirmaydi, barchasi ilova ichidan ma'lum yo'llargina so'raydi)
const FW_TRAP = /^\/api\/(?:adm(?:in)?|debug|trdbg|srcdbg|dump|purge|internal|root|shell|eval|config|backup|secret|telescope|actuator|\.env|env|phpmyadmin|wp-admin|wp-login|wp-content|wp-json|wp-includes|xmlrpc|phpinfo|cgi-bin|console|git|svn|hg|aws|\.git|\.svn|\.aws|\.ds_store|jenkins|hudson|cpanel|webmin|adminer|swagger|openapi|api-docs|graphql|graphiql|rpc|soap|wsdl|server-status|metrics|prometheus|grafana|kibana|elastic|solr|docker|vagrant|composer|vendor|manager|examples|docs|setup|install|myadmin|mysql|postgres|redis|mongo|tomcat|jboss|weblogic|nexus|artifactory|portainer|kubernetes|nagios|zabbix|splunk|sonarqube|airflow|superset|metabase|terraform|ansible|staging|c99|r57|wso|alfa|bypass)(?:\/|$)/i
// v98: /api ostida FAYL-KENGAYTMA so'rovlari (skanerlar backdoor/arxiv/qolib qoldiqlarni qidiradi)
// — ilovada hech bir /api yo'li kengaytma bilan tugamaydi. Ushlanganda DARHOL blok (trap kabi).
const FW_TRAPX = /\.(?:php|asp|aspx|jsp|cgi|pl|py|sh|bash|env|json|xml|yml|yaml|sql|bak|old|orig|save|swp|log|ini|conf|cfg|zip|tar|gz|tgz|rar|7z|exe|dll|dat|db|sqlite|pem|key|crt|p12|txt)$/i
// In'ektsiya / traversal belgilari (yo'l + so'rov satrida)
const FW_INJ = /(?:\.\.[\\/]|%2e%2e(?:%2f|%5c)|<script|javascript:|onerror\s*=|union[\s+]+select|information_schema|sleep\s*\(|benchmark\s*\(|load_file|into[\s+]+outfile|waitfor[\s+]+delay|\/etc\/passwd|\$\{(?:jndi|env\())/i
// RUXSAT ETILGAN MIJOZLAR — faqat sayt (brauzer) va ilova (APK WebView + APK fon xizmati).
//  mozilla    — barcha brauzerlar + Android/iOS WebView (PWA sayti)
//  50gramapp  — APK WebView qo'shimcha belgisi (" 50GramApp/2.x")
//  dalvik     — APK fon xizmati (KeepAliveService polling, HttpURLConnection standart UA)
// Qolgan HAR QANDAY mijoz (curl, wget, python, go, skanerlar, botlar) = tashqi jashnchi —
// 1-urinishdayoq 30 kun blok (hujumchi hech narsa ololmaydi, "Not found" degan javob ko'radi).
const FW_UA_OK = /mozilla|50gramapp|dalvik/i
const fwIp = (req: Request) => (req.headers.get("cf-connecting-ip") || "").trim()
const FW_404 = () => new Response("Not found", { status: 404, headers: { ...SEC_H } })
// Lokal (izolyat) blok — VAQTINCHA 2 daqiqa: DO tasdiqlasa uzayadi, yechilsa o'zi tozalanadi
// v106: himoya O'CHIQ bo'lsa — lokal blok ham qo'yilmaydi (to'liq pass-through)
const fwLBlok = (ip: string, dur: number) => { if (FW_OFF) return; const t = Date.now(); FW_KESH.set(ip, { u: t + Math.min(dur, 120_000), t, v: 0 }) }
function fwBlokli(ip: string) {
  if (FW_OFF) return false // v106: himoya o'chiq — blok-tekshiruvi o'tkazilmaydi
  const e = FW_KESH.get(ip)
  if (e && e.u > Date.now()) return true
  if (e) FW_KESH.delete(ip)
  return false
}
// Doimiy bloklar ro'yxatini yangilash. DO — yagona ishonchli manba: ro'yxatda YO'Q
// bo'lgan bloklar keshdan ham o'chadi (v=1 — darhol; v=0 — 90s dan eskirganlari).
// Shuning uchun blokni yechish (unblock) butun tarmoq bo'ylab tez tarqaladi,
// hech qanday qoldiq qolmaydi.
let FW_FYANGI = 0 // majburiy (bloklanganlar yo'li) refresh oxirgi vaqti
// DO blok ro'yxatini keshga qo'llash: ro'yxatda yo'qlar o'chadi (v=1 — darhol,
// v=0 — 90s dan eskirganlari), ro'yxatdagilar to'liq muddat bilan yoziladi (v=1).
function fwQollash(j: any) {
  // v106: himoya-holati ham shu yo'lakda tarqaladi (DO yagona manba → barcha izolyatlar ≤45s)
  FW_OFF = !!j.fwoff
  FW_TASDIQ = Date.now() // v108: har refresh — DO bilan tasdiqlash hisoblanadi
  const nw = new Set<string>()
  for (const [ip2] of (j.blocks || []) as Array<[string, number]>) nw.add(String(ip2))
  const t2 = Date.now()
  for (const [ip2, e] of FW_KESH) {
    if (nw.has(ip2)) continue
    if (e.v === 1 || t2 - e.t > 90_000) FW_KESH.delete(ip2)
  }
  for (const [ip2, until] of (j.blocks || []) as Array<[string, number]>) FW_KESH.set(String(ip2), { u: Number(until), t: t2, v: 1 })
  return nw
}
async function fwYangola(env: Env) {
  if (Date.now() - FW_YANGI < 45_000 || !env.SEC) return
  FW_YANGI = Date.now()
  try {
    const r = await env.SEC!.get(env.SEC!.idFromName("global")).fetch("https://fw/?op=refresh")
    fwQollash(await r.json())
  } catch {}
}
// Bloklangan IP uchun majburiy tekshiruv (≤50ms, 300ms interval): DO yangi ro'yxatida
// IP yo'q bo'lsa — lokal yozuv DARHOL o'chadi. Shuning uchun blok yechilishi butun
// tarmoqda birinchi so'rovdayoq ko'rinadi (qoldiq 404 qolmaydi).
async function fwTekshir(env: Env, ip: string) {
  if (!env.SEC || Date.now() - FW_FYANGI < 300) return
  FW_FYANGI = Date.now()
  try {
    const r = await env.SEC!.get(env.SEC!.idFromName("global")).fetch("https://fw/?op=refresh")
    const nw = fwQollash(await r.json())
    if (!nw.has(ip)) FW_KESH.delete(ip)
  } catch {}
}
// Oddiy so'rovlar: fon rejimida (hech qachon kutmaydi — NOL kechikish)
function fwKeshYana(env: Env, wait: (p: Promise<unknown>) => void) {
  if (Date.now() - FW_YANGI < 45_000 || !env.SEC) return
  wait(fwYangola(env))
}
// Lokal ochko — shu izolyatda MILLIYATLAR ichida to'siq (DO javobini kutmaydi).
// need <= 1 bo'lsa — BIRINCHI urinishdayoq DARHOL blok (hujumchi hech narsa ololmaydi).
function fwLokal(ip: string, kind: string, need: number, dur: number) {
  if (FW_OFF) return false // v106: himoya o'chiq — lokal ochkolar ham hisoblanmaydi
  if (need <= 1) { fwLBlok(ip, dur); FW_ALOC.delete(ip + "|" + kind); return true }
  const k = ip + "|" + kind
  const t = Date.now()
  const e = FW_ALOC.get(k)
  if (!e || t - e.t > 3_600_000) { if (FW_ALOC.size > 5000) FW_ALOC.clear(); FW_ALOC.set(k, { n: 1, t }); return false }
  e.n++
  if (e.n >= need) { fwLBlok(ip, dur); FW_ALOC.delete(k); return true }
  return false
}
// DO'ga doimiy ochko (fon rejimida — asosiy so'rov sekinlamaydi).
// v98: ochko BLOKGA aylanganda (faqat shunda) err_jurnal'ga yoziladi — egaga /api/jurnal
// orqali hujum urinishlari KO'RINADI («yadroga kirishga urinishlar bloklandi» dalili).
// Dedupe: bir (ip|kind) juftligi 1 soatda BIR marta yoziladi — hujum toshqinida jurnal o'smaydi.
// v105: hujum-hodisa konteksti — hujum qayerdan (davlat/shahar — Cloudflare cf.geodan,
// bepul, API yo'q) va ilovaning QAYSI QISMIGA (yo'l). fwOchko'ga ixtiyoriy parametr —
// barcha eski qo'ng'iroqlar o'zgarishsiz ishlaydi (xulq 0% o'zgargan).
type SecInfo = { p?: string; cc?: string; city?: string }
function secInfo(req: Request, url: URL): SecInfo {
  const cf = (req as any)?.cf || {}
  return { p: String(url.pathname || "").slice(0, 110), cc: String(cf.country || "").slice(0, 8), city: String(cf.city || "").slice(0, 60) }
}
// v105 SIGNALIZATSIYA + JURNAL: har ochko/blok → sec_events (D1) strukturaviy yozuv.
// Jiddiy blok (root/ext/inj/data/auth) → DARHOL sec_alarm (egaga signal — panelda qizil
// banner). 10 daqiqada 8+ ochko ham signal. 30 daqiqada signal SPAM'i YO'Q (dedupe).
// Faqat fon (waitUntil) + try/catch — HECH QACHON javobni buzmaydi, himoya xulqi o'zgarmas.
async function secYoz(env: Env, ip: string, kind: string, weight: number, info: SecInfo | undefined, act: string) {
  try {
    const db = env.__db || makeDb(env.DATABASE_URL)
    try { await ensureSchema(db) } catch {}
    const t = Date.now()
    const cc = str(info?.cc, 8) || "??", city = str(info?.city, 60), pth = str(info?.p, 110)
    const kn = SEC_KIND_UZ[kind] || kind
    await db.run(
      "INSERT INTO sec_events (ts, ip, cc, city, kind, path, act, note) VALUES (?,?,?,?,?,?,?,?)",
      [t, ip.slice(0, 60), cc, city, String(kind).slice(0, 20), pth, String(act).slice(0, 14),
        act === "blok" ? "Bloklandi (" + kn + ") — " + (weight > 1 ? weight + "x daraja" : "himoya ishlagan") : "Urinish ushlandi (" + kn + ") — to'siqqa naylon"],
    )
    const jiddiy = act === "blok" && (kind === "root" || kind === "ext" || kind === "inj" || kind === "data" || kind === "auth")
    let alarm = jiddiy
    if (!alarm) {
      const c10 = await db.one("SELECT COUNT(*) AS n FROM sec_events WHERE ts>?", [t - 600_000]).catch(() => null)
      if (Number(c10?.n || 0) >= 8) alarm = true
    }
    if (alarm) {
      const la = await db.one("SELECT ts FROM sec_alarm ORDER BY id DESC LIMIT 1").catch(() => null)
      if (!la || t - Number(la.ts) > 30 * 60_000) {
        await db.run(
          "INSERT INTO sec_alarm (id, ts, kind, ip, cc, n, note) VALUES (?,?,?,?,?,?,?)",
          [newId(), t, String(kind).slice(0, 20), ip.slice(0, 60), cc, jiddiy ? weight : 1,
            jiddiy ? "SIGNAL: " + kn + " hujumi bloklandi (" + (cc === "??" ? "davlat noma'lum" : cc) + ") — dastur himoyalangan, egaga xabar berildi" : "SIGNAL: 10 daqiqada 8+ hujum urinishi (" + kn + ") — himoya o'zi ishlagan"],
        )
      }
    }
  } catch {}
}
// v105 jurnal dedupe: bir (ip|kind) 30 sekundda BIR marta sec_events'ga yoziladi
// (toshqin hujumida D1 yozuvlari portlab ketmasin; blok hodisasi — HAR DOIM yoziladi)
const FW_SLOG = new Map<string, number>()
function fwOchko(env: Env, wait: (p: Promise<unknown>) => void, ip: string, kind: string, weight = 1, info?: SecInfo) {
  if (!ip || !env.SEC || FW_OFF) return // v106: himoya o'chiq — DO'ga hech narsa yozilmaydi
  wait((async () => {
    try {
      const st = env.SEC!.get(env.SEC!.idFromName("global"))
      const r = await st.fetch("https://fw/?op=strike", { method: "POST", body: JSON.stringify({ ip, kind, weight }) })
      const j: any = await r.json()
      const blok = j && j.until > Date.now()
      if (blok) {
        FW_KESH.set(ip, { u: j.until, t: Date.now(), v: 1 })
        const dk = ip + "|" + kind, t = Date.now()
        if (!FW_JLOG.has(dk) || t - FW_JLOG.get(dk)! > 3_600_000) {
          if (FW_JLOG.size > 2000) FW_JLOG.clear()
          FW_JLOG.set(dk, t)
          jurnalYoz(env, "fw:" + kind, 0, "fw", "himoya: IP *" + ip.slice(-6) + " bloklandi (" + kind + ")")
        }
      }
      // v105: strukturaviy xavfsizlik yozuvi (blok — HAR DOIM; ochko — 30s dedupe)
      if (blok) { await secYoz(env, ip, kind, weight, info, "blok") }
      else {
        const sk = ip + "|" + kind, tn = Date.now(), lw = FW_SLOG.get(sk)
        if (!lw || tn - lw > 30_000) {
          if (FW_SLOG.size > 4000) FW_SLOG.clear()
          FW_SLOG.set(sk, tn)
          await secYoz(env, ip, kind, weight, info, "ochko")
        }
      }
    } catch {}
  })())
}
// v105: hujum turlarining o'zbekcha nomlari (panel «Xavfsizlik» bo'limida ko'rinadi)
const SEC_KIND_UZ: Record<string, string> = {
  root: "Yadro/admin yo‘llariga kirish", ext: "Begona mijoz (skaner/bot)", inj: "In‘ektsiya/SQL hujumi",
  data: "Ma’lumot tortish toshqini", auth: "Parol/kod brute-force", flood: "So‘rov toshqini",
  tok: "Yaroqsiz token toshqini", otp: "OTP pumping", clog: "Jurnal toshqini", scan: "4xx skaner",
}
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000)
const DAY = 86400000
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)
const normPhone = (p: unknown) => {
  let d = String(p || "").replace(/\D/g, "")
  if (d.length === 9) d = "998" + d
  if (d.length < 10 || d.length > 15) fail("Telefon raqam noto‘g‘ri")
  return "+" + d
}
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/
const USER_COLS = "id,phone,first_name,last_name,username,bio,avatar_ver,privacy_phone,privacy_last_seen,last_seen,prefs"
const CHAT_COLS = "id,type,title,description,username,avatar_ver,owner_id,is_public,invite_hash,join_approval,permissions,settings,member_count,last_msg_at,created_at,pinned_id,blocked"
// chatOut() maydonlarni ANIQ tanlaydi — shuning uchun blocked ustuni klient javoblarida KO'RINMAYDI
// (faqat server ichida sendMessage/joinChat/panel tekshiruvlari ishlatadi)
// Sozlamalar sinxronizatsiyasi (v71): klient yuboradigan HAMMA kalitlar — aks holda
// push-filtr (pushChatMsg'dagi prefs.push===0) o'lik kod bo'lib qoladi va tungi
// ovozsizlik/Reels/animatsiya sozlamalari qurilmalar orasida ko'chmaydi.
const PREF_KEYS = new Set(["sounds", "vibrate", "preview", "autoload", "stickerauto", "livealerts", "push", "shauto", "shadv", "shdbl", "shq", "nightmute", "noanim"])
const DEF_PERMS = { send: 1, media: 1, stickers: 1, links: 1, polls: 1, invite: 1 }
const DEF_SET = { signatures: 0, comments: 1, reactions: 1, protect: 0, slow: 0 }
const MSG_KINDS = new Set(["text", "sticker", "gif", "photo", "video", "voice", "round", "file", "contact", "poll", "location"])
const NOTIFY_CAP = 40
// BUILD QOROVUSI (qo'ng'iroq qo'riqxonasi — «o'zgarmas qotirish»): har deploy bilan shu
// konstanta + web/core.js'dagi __50BUILD + web/sw.js'dagi V BIRGA oshiriladi. Klient har
// 90s /api/build'ni so'raydi — versiyasi mos kelmasa ilova o'zi yangilanadi. Shu tufayli
// tuzatish HAR QURILMAGA ~1 daqiqada yetib boradi (eski kod xotirada qolib «o'zi buzildi»
// effekti abadiy yo'qoladi).
const BUILD_V = "v115"

// ------------------------- Coin / Martaba (jonli efir iqtisodiyoti) -------------------------
// coin — sarflanadigan valyuta (sovg'a yuborish), earned — umumiy yig'ilgan ball (martaba, kamaymaydi)
// Task 40: 26 xil sovg'a — klient (web/rtc.js LIVE_GIFTS) narxlari bilan BIR XIL bo'lishi shart
const GIFTS: Record<string, number> = {
  star: 5, heart: 10, rose: 25, fire: 49, cake: 149, crown: 199, diamond: 499, rocket: 999,
  mushuk: 15, kuchuk: 20, kapibara: 39, robot: 99, panda: 129, bori: 159, alien: 179,
  burgut: 219, fil: 259, yolbars: 299, akula: 349, sher: 399, superqahramon: 449,
  dinozavr: 599, kit: 649, feniks: 749, ajdar: 1299, galaktika: 1999,
}
const LEVELS = [
  { n: "Yangi a'zo", e: "🌱", min: 0 },
  { n: "Yulduz", e: "⭐", min: 500 },
  { n: "Bronza", e: "🥉", min: 2000 },
  { n: "Kumush", e: "🥈", min: 10000 },
  { n: "Oltin", e: "🥇", min: 30000 },
  { n: "Platina", e: "💠", min: 100000 },
  { n: "Brilliant", e: "💎", min: 300000 },
  { n: "Afsona", e: "👑", min: 1000000 },
]
function levelOf(earned: number) {
  let i = 0
  for (let k = 0; k < LEVELS.length; k++) if (earned >= LEVELS[k].min) i = k
  const cur = LEVELS[i], nx = LEVELS[i + 1] || null
  const pct = nx ? Math.min(100, Math.round(((earned - cur.min) / (nx.min - cur.min)) * 100)) : 100
  return { i: i + 1, name: cur.n, emoji: cur.e, min: cur.min, next: nx ? nx.min : null, next_name: nx ? nx.n : null, pct }
}
async function walletOf(c: C, uid: number) {
  await ensureSchema(c.db)
  await c.db.run("INSERT IGNORE INTO wallets(user_id,coins,earned,spent,gifts_sent,gifts_recv,last_daily,updated_at) VALUES(?,500,0,0,0,0,0,?)", [uid, now()])
  return await c.db.one("SELECT * FROM wallets WHERE user_id=?", [uid])
}
// Task 29 sxemasi: yangi jadvallar mavjud emas bo'lsa (migratsiya o'tmagan deploy) — o'z-o'zidan yaratadi.
// Idempotent: har isolatda bir marta, har bayonot alohida try/catch (ayrimlari allaqachon bo'lsa xato emas).
let t29ok = false
async function ensureSchema(db: Db) {
  if (t29ok) return
  const stmts = [
    "CREATE TABLE IF NOT EXISTS wallets (user_id BIGINT PRIMARY KEY, coins BIGINT NOT NULL DEFAULT 500, earned BIGINT NOT NULL DEFAULT 0, spent BIGINT NOT NULL DEFAULT 0, gifts_sent INT NOT NULL DEFAULT 0, gifts_recv INT NOT NULL DEFAULT 0, last_daily BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_wallets_earned ON wallets (earned)",
    "CREATE TABLE IF NOT EXISTS msg_comments (id BIGINT PRIMARY KEY, chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL, user_id BIGINT NOT NULL, body VARCHAR(500) NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_msg_comments_mid ON msg_comments (message_id)",
    "CREATE INDEX IF NOT EXISTS idx_msg_comments_chat ON msg_comments (chat_id, created_at)",
    "ALTER TABLE live_viewers ADD COLUMN rewarded INT NOT NULL DEFAULT 0",
    // Task 41: TOP efir reytingi — efirning eng yuqori tomoshabinlar rekordi
    "ALTER TABLE lives ADD COLUMN peak INT NOT NULL DEFAULT 0",
    // Task 39: izohlar — javob-replies, stiker izohlar va reaksiyalar (baholash)
    "ALTER TABLE post_comments ADD COLUMN parent_id BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE post_comments ADD COLUMN sticker VARCHAR(64) NOT NULL DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS idx_pc_parent ON post_comments (parent_id)",
    "CREATE TABLE IF NOT EXISTS comment_reacts (comment_id BIGINT NOT NULL, user_id BIGINT NOT NULL, emoji VARCHAR(8) NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(comment_id,user_id,emoji))",
    "CREATE INDEX IF NOT EXISTS idx_creacts_c ON comment_reacts (comment_id)",
    // Task 57: yagona faol sessiya — logout barcha tokenlarni o'ldiradi, yangi kirish eskisini
    "ALTER TABLE users ADD COLUMN sess VARCHAR(24) NULL",
    // v73: QURILMA GUVOHNOMASI — har qurilma o'z g50_dev kalitini yuboradi (x-dev), raqam shu
    // kalitga bog'lanadi. EGASI o'z qurilmasidan qayta kirsa HECH QACHON «mavjud» blokini olmaydi
    // (938607999 kabi qotib qolgan holatlar ildizi: blok qurilmani farqlamasdi).
    "ALTER TABLE users ADD COLUMN dev VARCHAR(40) NULL",
    // Task 56: paralel-kirish himoyasi — logout bayrog'i va sessiya muddati (ms)
    "ALTER TABLE users ADD COLUMN logout_at BIGINT NULL",
    "ALTER TABLE users ADD COLUMN token_exp BIGINT NULL",
    // Eski foydalanuvchilar: sessiya muddati = ro'yxatdan o'tgan vaqt + 180 kun (taxmin, JWT muddati bilan mos)
    "UPDATE users SET token_exp = created_at + 15552000000 WHERE token_exp IS NULL",
    // QO'NG'IROQ SIGNAL NAVBATI: WS o'lgan qurilmaga accept/offer/answer/ICE yetib bormasdi —
    // qo'ng'iroq «Ulanmoqda…» da abadiy qolardi. Endi har signal 2 daqiqaga navbatga yoziladi,
    // klient WS o'lsa /signal/queue orqali o'qiydi (fetch-and-delete).
    "CREATE TABLE IF NOT EXISTS call_signals (id BIGINT PRIMARY KEY, to_uid BIGINT NOT NULL, from_uid BIGINT NOT NULL, body MEDIUMTEXT NOT NULL, created_at BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_csignals_to ON call_signals (to_uid, id)",
    // XATO JURNALI (doimiy): serverdagi 500-sinf xatolar D1'ga yoziladi — console.log
    // Cloudflare'da saqlanmaydi va «keyin o'zi buzildi» deganda ildiz ko'rinmasdi.
    // Egaga /api/jurnal orqali o'qiladi (o'zbekcha tashxis doktrinasi: log bilan topish).
    "CREATE TABLE IF NOT EXISTS err_jurnal (id BIGINT AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, path VARCHAR(120) NOT NULL DEFAULT '', uid BIGINT NOT NULL DEFAULT 0, src VARCHAR(16) NOT NULL DEFAULT '', msg VARCHAR(600) NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_errj_ts ON err_jurnal (ts)",
    // KOD–SHEMA MOSLIGI (v71): kod ishlatadigan ustunlar ENDI sxemada ham bo'lishi kafolatlanadi —
    // eski bazada ham (ALTER), toza o'rnatishda ham (schema.sql) bir xil. Aks holda toza o'rnatishda
    // «Unknown column» → /me, /users, /search, /chats, post/istoriya joylash — deyarli hamma endpoint 500.
    "ALTER TABLE users ADD COLUMN prefs MEDIUMTEXT NULL",
    "ALTER TABLE posts ADD COLUMN meta MEDIUMTEXT NULL",
    "ALTER TABLE posts ADD COLUMN views BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE stories ADD COLUMN meta MEDIUMTEXT NULL",
    // Trend pozitiv-qayta o'rganish statistikasi (trendWeights/trendEv/trendInsights ishlatadi)
    "CREATE TABLE IF NOT EXISTS trend_stats (cat VARCHAR(20) PRIMARY KEY, imp BIGINT NOT NULL DEFAULT 0, clk BIGINT NOT NULL DEFAULT 0, wt BIGINT NOT NULL DEFAULT 0, upd BIGINT NOT NULL DEFAULT 0)",
    // v104 ADMIN PANEL: blok bayrog'i — egapanel bloklaydi, sessiya-darvoza/kirish nuqtalari tekshiradi
    "ALTER TABLE users ADD COLUMN blocked INT NOT NULL DEFAULT 0",
    // v105 XAVFSIZLIK JURNALI: har himoya-ochko/blok strukturaviy yozuv (IP, DAVLAT, tur,
    // ilovaning qaysi qismi hujumga uchradi, chora). Panel «Xavfsizlik» bo'limi o'qiydi —
    // egada kim/qayerdan/qancha hujum dalili. Retensiyasi 30 kun (cleanup).
    "CREATE TABLE IF NOT EXISTS sec_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, ip VARCHAR(64) NOT NULL DEFAULT '', cc VARCHAR(8) NOT NULL DEFAULT '', city VARCHAR(60) NOT NULL DEFAULT '', kind VARCHAR(24) NOT NULL DEFAULT '', path VARCHAR(120) NOT NULL DEFAULT '', act VARCHAR(16) NOT NULL DEFAULT '', note VARCHAR(200) NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_sec_ts ON sec_events (ts)",
    "CREATE INDEX IF NOT EXISTS idx_sec_ip ON sec_events (ip, ts)",
    // v105 SIGNALIZATSIYA: hujum aniqlanganda egaga signal-yozuv (panelda qizil banner) —
    // jiddiy blok (root/ext/inj/data/auth-blok) DARHOL signal; 10 daqiqada 8+ ochko ham signal.
    "CREATE TABLE IF NOT EXISTS sec_alarm (id BIGINT PRIMARY KEY, ts BIGINT NOT NULL, kind VARCHAR(24) NOT NULL DEFAULT '', ip VARCHAR(64) NOT NULL DEFAULT '', cc VARCHAR(8) NOT NULL DEFAULT '', n INT NOT NULL DEFAULT 0, note VARCHAR(200) NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_secalm_ts ON sec_alarm (ts)",
    // v106: KANAL/GURUH BLOKI — egapanel bloklaydi (bloklangan kanal/guruhga yozish va kirish yopiladi,
    // default 0 — ilova xulqi o'zgarmagan; flag faqat paneldan qo'yiladi)
    "ALTER TABLE chats ADD COLUMN blocked INT NOT NULL DEFAULT 0",
    // v106: BOSHQARUV JURNALI — panel amallari tarixi (blok/ochirish/chetlatish/himoya holati) —
    // egada har bir boshqaruv amali dalili bilan. Retensiyasi 90 kun (cleanup).
    "CREATE TABLE IF NOT EXISTS adm_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, act VARCHAR(32) NOT NULL DEFAULT '', tgt VARCHAR(64) NOT NULL DEFAULT '', note VARCHAR(300) NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS idx_admlog_ts ON adm_log (ts)",
  ]
  for (const s of stmts) { try { await db.run(s) } catch {} }
  try {
    await db.one("SELECT user_id FROM wallets LIMIT 1")
    t29ok = true // so'rov o'tdi — jadval bor
  } catch { t29ok = false }
}

// ------------------------- Realtime -------------------------
async function notify(env: Env, uids: number[], ev: unknown) {
  const body = JSON.stringify(ev)
  const uniq = [...new Set(uids)].slice(0, NOTIFY_CAP + 1)
  await Promise.all(uniq.map(async (u) => {
    try {
      const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(u)))
      await stub.fetch("https://do/push", { method: "POST", body })
    } catch (e) { console.log("notify xato", u, String(e)) }
  }))
}
async function memberIds(c: C, chatId: number) {
  // Katta kanallarda ham birinchi NOTIFY_CAP faol a'zoga real vaqt hodisasi boradi (qolganlari 4s poll bilan ushlaydi)
  const rows = await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? AND status='active' LIMIT " + NOTIFY_CAP, [chatId])
  return rows.map((r) => r.user_id as number)
}
function notifyChat(c: C, chatId: number, ev: unknown, extra: number[] = []) {
  c.wait(memberIds(c, chatId).then((ids) => notify(c.env, [...ids, ...extra], ev)))
}

// ------------------------- Formatlash -------------------------
function pubUser(u: any, viewer: number, contactName?: { first_name: string; last_name: string }) {
  if (!u) return null
  const self = u.id === viewer
  const t = now()
  return {
    id: u.id,
    first_name: contactName?.first_name || u.first_name,
    last_name: contactName ? contactName.last_name : u.last_name,
    real_name: (u.first_name + " " + (u.last_name || "")).trim(),
    username: u.username || null,
    bio: u.bio || "",
    avatar_ver: u.avatar_ver || 0,
    // Telefon maxfiyligi to'g'ri ishlaydi: 0=Hamma, 1=Kontaktlarim (kontakt ko'radi — ilgari yashirin edi, tuzatildi), 2=Hech kim.
    // Shu tufayli profil ochilganda raqam «Kontaktlarim» rejimida ham ko'rinadi (Telegram mantiqi).
    phone: self || u.privacy_phone === 0 || (u.privacy_phone === 1 && !!contactName) ? u.phone : null,
    online: u.privacy_last_seen === 2 && !self ? null : t - (u.last_seen || 0) < 70000,
    last_seen: u.privacy_last_seen === 2 && !self ? null : u.last_seen || 0,
    is_contact: !!contactName,
  }
}
async function contactMap(c: C) {
  const rows = await c.db.q("SELECT phone,first_name,last_name FROM contacts WHERE owner_id=?", [c.uid])
  return new Map(rows.map((r) => [r.phone as string, r]))
}
async function usersByIds(c: C, ids: number[], cmap?: Map<string, any>) {
  const out = new Map<number, any>()
  const u = [...new Set(ids)].filter(Boolean)
  if (!u.length) return out
  // TEZLIK: foydalanuvchilar, kontakt-xarita va istoriya bayroqlari bir-biridan
  // bog'liq emas — PARALLEL so'raladi (3 ketma-ket HTTP so'rov → 1 to'lqin)
  const [rows, m, flags] = await Promise.all([
    c.db.q(`SELECT ${USER_COLS} FROM users WHERE id IN (${ph(u)})`, u),
    cmap ? Promise.resolve(cmap) : contactMap(c),
    storyFlags(c, u),
  ])
  for (const r of rows) out.set(r.id, { ...pubUser(r, c.uid, m.get(r.phone)), story: flags.get(r.id) || null })
  return out
}
async function storyFlags(c: C, ids: number[]) {
  const m = new Map<number, { count: number; unseen: number }>()
  if (!ids.length) return m
  const rows = await c.db.q(
    `SELECT s.user_id, COUNT(*) AS cnt, SUM(CASE WHEN v.viewer_id IS NULL THEN 1 ELSE 0 END) AS unseen
     FROM stories s LEFT JOIN story_views v ON v.story_id=s.id AND v.viewer_id=?
     WHERE s.user_id IN (${ph(ids)}) AND s.expires_at>? GROUP BY s.user_id`,
    [c.uid, ...ids, now()],
  )
  for (const r of rows) m.set(r.user_id, { count: Number(r.cnt), unseen: Number(r.unseen) })
  return m
}
const parse = (s: unknown, def: any) => { try { return { ...def, ...(s ? JSON.parse(String(s)) : {}) } } catch { return { ...def } } }
function chatOut(r: any) {
  return {
    id: r.id, type: r.type, title: r.title, description: r.description, username: r.username || null,
    avatar_ver: r.avatar_ver || 0, owner_id: r.owner_id, is_public: r.is_public, join_approval: r.join_approval,
    permissions: parse(r.permissions, DEF_PERMS), settings: parse(r.settings, DEF_SET),
    member_count: r.member_count, last_msg_at: r.last_msg_at, created_at: r.created_at, pinned_id: r.pinned_id || 0,
    role: r.role || null, last_read: r.last_read || 0, muted: r.muted || 0, pinned: r.pinned || 0, unread: Number(r.unread || 0),
  }
}
function msgOut(m: any) {
  return {
    id: m.id, chat_id: m.chat_id, sender_id: m.sender_id, kind: m.kind,
    body: m.deleted ? null : m.body, meta: m.deleted ? null : parse(m.meta, {}),
    edited: m.edited, deleted: m.deleted, created_at: m.created_at, updated_at: m.updated_at,
  }
}

// ------------------------- Ruxsatlar -------------------------
async function member(c: C, chatId: number) {
  return c.db.one("SELECT role,status,last_read FROM chat_members WHERE chat_id=? AND user_id=?", [chatId, c.uid])
}
const isAdm = (m: any) => m && m.status === "active" && (m.role === "owner" || m.role === "admin")
async function needChat(c: C, id: number) {
  const ch = await c.db.one(`SELECT ${CHAT_COLS},direct_key FROM chats WHERE id=?`, [id])
  if (!ch) fail("Chat topilmadi", 404)
  return ch
}
async function needAdmin(c: C, id: number) {
  const m = await member(c, id)
  if (!isAdm(m)) fail("Bu amal faqat adminlar uchun", 403)
  return m
}
async function blockedBetween(c: C, a: number, b: number) {
  const r = await c.db.one("SELECT user_id FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1", [a, b, b, a])
  return !!r
}
async function checkUsername(c: C, name: string, selfUser?: number, selfChat?: number) {
  if (!USERNAME_RE.test(name)) fail("Username: 5–32 belgi, harf bilan boshlansin (a-z, 0-9, _)")
  const u = await c.db.one("SELECT id FROM users WHERE username=?", [name])
  const ch = await c.db.one("SELECT id FROM chats WHERE username=?", [name])
  if ((u && u.id !== selfUser) || (ch && ch.id !== selfChat)) fail("Bu username band")
}
function avatarOk(v: unknown) {
  if (v === null) return null
  const s = String(v || "")
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) fail("Rasm formati noto‘g‘ri")
  if (s.length > 600000) fail("Rasm juda katta")
  return s
}
// Kontaktlar va shaxsiy chat hamrohlari — istoriya/efirlarni ko'rishi mumkin bo'lganlar
async function circle(c: C) {
  const rows = await c.db.q(
    `SELECT u.id FROM users u JOIN contacts k ON k.phone=u.phone WHERE k.owner_id=?
     UNION SELECT m2.user_id AS id FROM chat_members m1 JOIN chats ch ON ch.id=m1.chat_id AND ch.type='direct'
     JOIN chat_members m2 ON m2.chat_id=ch.id WHERE m1.user_id=?`,
    [c.uid, c.uid],
  )
  const blocked = await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=?", [c.uid])
  const bl = new Set(blocked.map((r) => r.user_id))
  return [...new Set([c.uid, ...rows.map((r) => r.id as number)])].filter((x) => !bl.has(x))
}

// ------------------------- Auth -------------------------
// v110 AUTH-TANA SKANERI: kirish so'rovlarida (otp/verify) tana FAQAT {phone, code, force, dev}
// bo'lishi mumkin — boshqa har qanday in'ektsiya/traversal qolipi (FW_INJ) = skaner/bot:
// BIRINCHI urinishdayoq 30 kun blok + jurnal (halol foydalanuvchi bu qoliplarni UMUMAN yubormaydi).
// true qaytarsa — chaqiruvchi FW_404() bilan javob beradi (hujumchiga hech narsa oshkor qilinmaydi).
function authTanaSkan(c: C): boolean {
  const fip = fwIp(c.req)
  if (!fip) return false
  let raw = ""
  try { raw = JSON.stringify(c.b || {}) } catch { return false }
  if (!FW_INJ.test(raw)) return false
  fwLBlok(fip, 30 * DAY)
  fwOchko(c.env, c.wait, fip, "inj", 1, secInfo(c.req, c.url))
  return true
}
async function authOtp(c: C) {
  if (authTanaSkan(c)) return FW_404()
  await ensureSchema(c.db)
  const phone = normPhone(c.b.phone)
  const t = now()
  const devPhones = (c.env.DEV_PHONES || "").split(",").map((x) => x.trim()).filter(Boolean)
  const smsOn = smsConfigured(c.env)
  const test = (c.env.TEST_PHONES || "").split(",").map((x) => x.trim().split(":")).find(([p]) => p === phone)
  // «BITTA RAQAM — BITTA FAOL DASTUR» HIMOYASI (muallif tizimi, v73 — qurilma-mos):
  // begona odam boshqa foydalanuvchi FAOL ishlatayotgan raqamiga kira olmaydi —
  // «Bu raqam tarmoqda mavjud» javobi (409). v72 KAMCHILIGI (938607999 tuzog'i): qoida
  // qurilmani farqlamasdi — brauzer oynasi ochiq turganda last_seen yangilanib bordi va
  // EGANNING O'ZI ham (shu brauzerdan qayta kirganda) 409 olardi. v73: har qurilma o'z
  // g50_dev guvohnomasini yuboradi (x-dev sarlavha), raqam shu guvohnomaga bog'lanadi:
  //  - EGASI o'z qurilmasidan qayta kirsa (dev mos) → DARHOL ochiq, 409 YO'Q;
  //  - boshqa qurilma + hisob faol (last_seen 15 daqiqadan yangi) → 409 «tarmoqda mavjud»;
  //  - LEKIN QOTIB QOLISH YO'Q («shunaqa holatlar bo'lmasin»): 409 ekranida «Bu mening
  //    raqamim» tugmasi bor — force=1 bilan kod beriladi, verify sess aylantiradi va eski
  //    qurilma 401 bilan avtomatik uchadi (bitta raqam — bitta faol sessiya saqlanadi);
  //  - logout qilingan / 15+ daqiqa yopiq turgan / eski hisob (dev NULL) → ochiq.
  // Haqiqiy SMS (Eskiz) ulanganda bu qo'riqchi shart emas — kod faqat haqiqiy egasiga boradi.
  const dev = String(c.req.headers.get("x-dev") || "").slice(0, 40)
  if (!smsOn && !test) {
    const ex = await c.db.one("SELECT id, logout_at, token_exp, last_seen, dev, blocked FROM users WHERE phone=?", [phone])
    // v104 ADMIN PANEL BLOK: bloklangan raqamga kod BERILMAYDI (verify ham baribir yopiq —
    // bu yerda erta to'xtatish foydalanuvchiga aniq sababni ko'rsatadi)
    if (ex && +ex.blocked === 1) fail("Hisobingiz bloklangan", 403)
    const faol = ex && !ex.logout_at && +(ex.token_exp || 0) > t && +(ex.last_seen || 0) > t - 15 * 60_000
    const ozQurilma = !!faol && !!dev && ex.dev === dev
    if (faol && !ozQurilma && !devPhones.includes(phone) && !c.b.force)
      return fail("Bu raqam tarmoqda mavjud — bitta raqam faqat bitta dasturda ishlaydi. Agar bu raqam sizniki bo'lsa, «Bu mening raqamim» tugmasini bosib kod oling", 409)
  }
  // ILOVA-ICHKI REJIM (SMS_MODE="app", Eskiz O'CHIQ): kod HAR QANDAY raqam uchun ilova
  // ICHIDA qaytadi (QIZIL yozuv) — yangi raqam ro'yxatdan o'tadi, logout qilgan ega qaytadi.
  // XAVFSIZLIK (v72): faol hisob yuqoridagi BAND qoidasi bilan qo'riqlanadi — ilova ochiq
  // turganda begona odam shu raqamga kod ola olmaydi (409 «tarmoqda mavjud»). Eskizga
  // o'tganda (SMS_MODE="eskiz" + secretlar) smsOn=true bo'ladi — bu tarmoq o'zi o'chadi.
  let devSelf = false
  if (!smsOn && !test && c.env.DEV_MODE === "1") devSelf = true
  // Kutish muddati: haqiqiy SMS (Eskiz) pullik/pumping-xavfli — 55s; ilova-ichki kod bepul — 20s
  const cd = smsOn ? 55000 : 20000
  const prev = await c.db.one("SELECT sent_at FROM otp WHERE phone=?", [phone])
  if (prev && t - prev.sent_at < cd) fail(smsOn ? "Kodni qayta so‘rash uchun 1 daqiqa kuting" : "Kodni qayta so‘rash uchun 20 soniya kuting", 429)
  const code = test ? test[1] : randomCode()
  await c.db.run("REPLACE INTO otp(phone,code_hash,expires_at,sent_at,tries) VALUES(?,?,?,?,0)", [phone, await sha256(phone + code + c.env.JWT_SECRET), t + 5 * 60000, t])
  if (test) return json({ ok: true, phone })
  if (smsOn) {
    await sendSms(c.env, phone, code)
    return json({ ok: true, phone })
  }
  if (devSelf) return json({ ok: true, phone, dev_code: code })
  return fail("SMS xizmati sozlanmagan (SMS_MODE=eskiz qiling va ESKIZ secretlarini qo‘ying)", 503)
}
async function authVerify(c: C) {
  if (authTanaSkan(c)) return FW_404()
  // v73: kirish paytida raqam shu qurilma guvohnomasiga bog'lanadi (dev) — keyingi
  // qayta kirishlarda aynan SHU qurilma «o'z raqami» ekanini bilib, DARHOL ochadi.
  const dev = String(c.req.headers.get("x-dev") || "").slice(0, 40)
  const phone = normPhone(c.b.phone)
  const code = String(c.b.code || "").replace(/\D/g, "")
  const o = await c.db.one("SELECT * FROM otp WHERE phone=?", [phone])
  if (!o || o.expires_at < now()) fail("Kod eskirgan, qaytadan so‘rang")
  if (o.tries >= 5) fail("Juda ko‘p urinish. Yangi kod so‘rang", 429)
  if ((await sha256(phone + code + c.env.JWT_SECRET)) !== o.code_hash) {
    await c.db.run("UPDATE otp SET tries=tries+1 WHERE phone=?", [phone])
    // BRUTE-FORCE HIMoyasi: noto'g'ri kod urinishlari hisobga olinadi — 12 xato/1 soat
    // bo'lsa IP 24 soatga to'siladi (bu haqda hujumchiga ma'lumot bermaydigan javob)
    const fip = fwIp(c.req)
    if (fip) {
      if (fwLokal(fip, "auth", 12, 24 * 3_600_000)) { fwOchko(c.env, c.wait, fip, "auth", 1, secInfo(c.req, c.url)); return FW_404() }
      fwOchko(c.env, c.wait, fip, "auth", 1, secInfo(c.req, c.url))
    }
    fail("Kod noto‘g‘ri")
  }
  await c.db.run("DELETE FROM otp WHERE phone=?", [phone])
  await ensureSchema(c.db)
  const tnow = now(), texp = tnow + 180 * 86400 * 1000
  const sess = randomStr(16)
  let u = await c.db.one(`SELECT ${USER_COLS}, blocked FROM users WHERE phone=?`, [phone])
  if (!u) {
    const id = newId()
    await c.db.run("INSERT INTO users(id,phone,created_at,last_seen,token_exp,sess,dev) VALUES(?,?,?,?,?,?,?)", [id, phone, tnow, tnow, texp, sess, dev || null])
    u = await c.db.one(`SELECT ${USER_COLS} FROM users WHERE id=?`, [id])
  } else {
    // v104 ADMIN PANEL BLOK: bloklangan hisob yangi sessiya OLOLMAYDI (eski tokenlari ham
    // sessiya-darvozada 401 oladi — blok = ilova umuman ochilmaydi)
    if (+u.blocked === 1) fail("Hisobingiz bloklangan", 403)
    // Kirish → hisob yana FAOL bo'ldi + YANGI YAGONA SESSIYA: eskirgan barcha tokenlar
    // o'lik bo'lib qoladi (sess mos kelmadi → 401) — bir raqam, bitta faol qurilma.
    // v73: qurilma guvohnomasi ham yangilanadi (bo'sh bo'lsa — eski saqlanadi, eski mijozlar buzilmasin).
    await c.db.run("UPDATE users SET logout_at=NULL, token_exp=?, last_seen=?, sess=?, dev=COALESCE(NULLIF(?,''),dev) WHERE id=?", [texp, tnow, sess, dev, u.id])
  }
  const token = await signJwt({ sub: String(u.id), s: sess }, c.env.JWT_SECRET, 180 * 86400)
  return json({ token, user: pubUser(u, u.id), is_new: !u.first_name })
}

async function authLogout(c: C) {
  // MUALLIF TIZIMI: chiqish — hisob "bo'shaydi" → shu raqamga yana kod beriladi.
  // last_seen=0: "hozir faol" belgisi o'chadi — qayta kirish DARHOL ochiladi.
  // Chiqmagan faol hisob esa "BAND" qoladi — boshqa qurilmadan shu raqamga kod
  // olib bo'lmaydi (bir raqam — bir faol foydalanuvchi, paralel ishlatish yo'q).
  await c.db.run("UPDATE users SET logout_at=?, last_seen=0 WHERE id=?", [now(), c.uid])
  return json({ ok: true })
}

// ------------------------- Profil -------------------------
async function getMe(c: C) {
  // TEZLIK (umumiy): profil va istoriya bayroqlari mustaqil — parallel (1 davra tezroq, ilova ochilishida)
  const [u, f] = await Promise.all([
    c.db.one(`SELECT ${USER_COLS} FROM users WHERE id=?`, [c.uid]),
    storyFlags(c, [c.uid]),
  ])
  if (!u) fail("Hisob topilmadi", 401)
  return json({ ...pubUser(u, c.uid), privacy_phone: u.privacy_phone, privacy_last_seen: u.privacy_last_seen, prefs: parse((u as any).prefs, { sounds: 1, vibrate: 1, preview: 1, autoload: 1 }), story: f.get(c.uid) || null })
}
async function patchMe(c: C) {
  const b = c.b, sets: string[] = [], vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(col + "=?"); vals.push(v) }
  if ("first_name" in b) { const v = str(b.first_name, 64); if (!v) fail("Ism kiriting"); put("first_name", v) }
  if ("last_name" in b) put("last_name", str(b.last_name, 64))
  if ("bio" in b) put("bio", str(b.bio, 200))
  if ("username" in b) {
    const v = str(b.username, 32).replace(/^@/, "")
    if (v) await checkUsername(c, v, c.uid)
    put("username", v || null)
  }
  if ("privacy_phone" in b) put("privacy_phone", [0, 1, 2].includes(+b.privacy_phone) ? +b.privacy_phone : 1)
  if ("privacy_last_seen" in b) put("privacy_last_seen", [0, 1, 2].includes(+b.privacy_last_seen) ? +b.privacy_last_seen : 0)
  if ("avatar" in b) { const a = avatarOk(b.avatar); put("avatar", a); put("avatar_ver", a ? now() : 0) }
  if (b.prefs && typeof b.prefs === "object") {
    const u0 = await c.db.one("SELECT prefs FROM users WHERE id=?", [c.uid])
    const cur = parse(u0?.prefs, {})
    const np: Record<string, number> = {}
    for (const k of Object.keys(b.prefs)) if (PREF_KEYS.has(k)) np[k] = b.prefs[k] === 0 || b.prefs[k] === false ? 0 : 1
    put("prefs", JSON.stringify({ ...cur, ...np }))
  }
  if (sets.length) await c.db.run(`UPDATE users SET ${sets.join(",")} WHERE id=?`, [...vals, c.uid])
  return getMe(c)
}
async function avatar(c: C, table: "users" | "chats") {
  const r = await c.db.one(`SELECT avatar FROM ${table} WHERE id=?`, [+c.p.id])
  if (!r?.avatar) return new Response("", { status: 404, headers: CORS })
  const [head, data] = String(r.avatar).split(",")
  const mime = head.slice(5, head.indexOf(";"))
  const bin = Uint8Array.from(atob(data), (x) => x.charCodeAt(0))
  return new Response(bin, { headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable", ...CORS } })
}
async function getUser(c: C) {
  const id = +c.p.id
  // TEZLIK 3-4x (foydalanuvchi shikoyati: profil «juda sekin» ochilyapti): avval 7 ta TiDB
  // HTTP so'rov yuborilardi (usersByIds=3 + blok/efir/direct/wallet=4). Har biri HTTP davra —
  // shu asosiy kechikish manbasi. Endi FAQAT 2 ta PARALLEL so'rov:
  //   A) foydalanuvchi + kontakt-nomi — bitta LEFT JOIN,
  //   B) blok/efir/direct-chat/coin/istoriya — bitta UNION.
  const uk = USER_COLS.split(",").map((x) => "u." + x.trim()).join(",")
  const dk = [c.uid, id].sort((a: number, b: number) => a - b).join(":")
  const [rows, extras] = await Promise.all([
    c.db.q(
      `SELECT ${uk}, k.first_name AS k_first, k.last_name AS k_last
       FROM users u LEFT JOIN contacts k ON k.owner_id=? AND k.phone=u.phone WHERE u.id=?`,
      [c.uid, id],
    ),
    c.db.q(
      `SELECT 'ib' AS k, 0 AS v1, 0 AS v2 FROM blocks WHERE user_id=? AND blocked_id=?
       UNION ALL SELECT 'live', id, 0 FROM lives WHERE user_id=? AND ended_at=0 AND started_at>?
       UNION ALL SELECT 'direct', id, 0 FROM chats WHERE direct_key=?
       UNION ALL SELECT 'earn', earned, 0 FROM wallets WHERE user_id=?
       UNION ALL SELECT 'story', COUNT(*), SUM(CASE WHEN v.viewer_id IS NULL THEN 1 ELSE 0 END)
         FROM stories s LEFT JOIN story_views v ON v.story_id=s.id AND v.viewer_id=?
         WHERE s.user_id=? AND s.expires_at>?`,
      [c.uid, id, id, now() - 12 * 3600000, dk, id, c.uid, id, now()],
    ).catch(() => [] as any[]),
  ])
  const u = rows[0]
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  let iBlocked = false, liveId = 0, directId = 0, earned = 0, story: any = null
  for (const r of extras) {
    if (r.k === "ib") iBlocked = true
    else if (r.k === "live") liveId = Number(r.v1) || liveId
    else if (r.k === "direct") directId = Number(r.v1) || directId
    else if (r.k === "earn") earned = Number(r.v1) || 0
    else if (r.k === "story") story = { count: Number(r.v1) || 0, unseen: Number(r.v2) || 0 }
  }
  const kn = u.k_first != null ? { first_name: u.k_first, last_name: u.k_last } : undefined
  return json({ ...pubUser(u, c.uid, kn), story, lvl: levelOf(earned), i_blocked: iBlocked, live_id: liveId || null, chat_id: directId || null })
}

// ------------------------- Qidiruv -------------------------
async function search(c: C) {
  const q = str(c.url.searchParams.get("q"), 64)
  if (q.length < 2) return json({ users: [], chats: [] })
  const digits = q.replace(/\D/g, "")
  const like = "%" + q.replace(/[%_]/g, "") + "%"
  const uname = q.replace(/^@/, "").replace(/[%_]/g, "") + "%"
  // TEZLIK (umumiy): kanal/guruh qidiruvi foydalanuvchi qidiruviga bog'liq emas —
  // oldindan boshlanadi (parallel), qidiruv yozish paytida sezilarli tezroq javob qaytaradi
  const chatsP = c.db.q(
    `SELECT ${CHAT_COLS} FROM chats WHERE type<>'direct' AND is_public=1 AND (title LIKE ? OR username LIKE ?) ORDER BY member_count DESC LIMIT 20`,
    [like, uname],
  )
  let ids: number[] = []
  if (digits.length >= 9 && digits.length === q.replace(/[\s+()-]/g, "").length) {
    const ph9 = digits.length === 9 ? "+998" + digits : "+" + digits
    ids = (await c.db.q("SELECT id FROM users WHERE phone=? AND first_name<>''", [ph9])).map((r) => r.id)
  } else {
    ids = (await c.db.q(
      `SELECT id FROM users WHERE first_name<>'' AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name,' ',last_name) LIKE ?) LIMIT 25`,
      [uname, like, like, like],
    )).map((r) => r.id)
    const cs = await c.db.q("SELECT u.id FROM contacts k JOIN users u ON u.phone=k.phone WHERE k.owner_id=? AND (k.first_name LIKE ? OR k.last_name LIKE ?)", [c.uid, like, like])
    ids = [...new Set([...cs.map((r) => r.id), ...ids])]
  }
  const [um, chats] = await Promise.all([usersByIds(c, ids.filter((x) => x !== c.uid)), chatsP])
  return json({ users: [...um.values()], chats: chats.map(chatOut) })
}
async function discover(c: C) {
  // Trend REYTING: obunachilar soni bo'yicha kamayish tartibida — 1-o'rin eng trend kanal.
  // LIMIT 200 (avval 40 edi) — klient "yana ko'rsatish" bilan to'liq ro'yxatni aylantiradi.
  const rows = await c.db.q(
    `SELECT ${CHAT_COLS.split(",").map((x) => "c." + x).join(",")}, m.role FROM chats c LEFT JOIN chat_members m ON m.chat_id=c.id AND m.user_id=? AND m.status='active'
     WHERE c.type<>'direct' AND c.is_public=1 ORDER BY c.member_count DESC, c.last_msg_at DESC LIMIT 200`,
    [c.uid],
  )
  return json(rows.map(chatOut))
}

// ------------------------- Kontaktlar / bloklar -------------------------
async function listContacts(c: C) {
  const rows = await c.db.q(
    `SELECT k.phone AS k_phone, k.first_name AS k_first, k.last_name AS k_last, u.id FROM contacts k LEFT JOIN users u ON u.phone=k.phone
     WHERE k.owner_id=? ORDER BY k.first_name`,
    [c.uid],
  )
  const um = await usersByIds(c, rows.filter((r) => r.id).map((r) => r.id))
  return json(rows.map((r) => ({ phone: r.k_phone, first_name: r.k_first, last_name: r.k_last, user: r.id ? um.get(r.id) || null : null })))
}
async function addContact(c: C) {
  const phone = normPhone(c.b.phone)
  const first = str(c.b.first_name, 64)
  if (!first) fail("Ism kiriting")
  await c.db.run("REPLACE INTO contacts(owner_id,phone,first_name,last_name,created_at) VALUES(?,?,?,?,?)", [c.uid, phone, first, str(c.b.last_name, 64), now()])
  const u = await c.db.one("SELECT id FROM users WHERE phone=? AND first_name<>''", [phone])
  const um = u ? await usersByIds(c, [u.id]) : new Map()
  return json({ phone, first_name: first, last_name: str(c.b.last_name, 64), user: u ? um.get(u.id) : null })
}
async function delContact(c: C) {
  await c.db.run("DELETE FROM contacts WHERE owner_id=? AND phone=?", [c.uid, normPhone(decodeURIComponent(c.p.phone))])
  return json({ ok: true })
}
async function listBlocks(c: C) {
  const rows = await c.db.q("SELECT blocked_id FROM blocks WHERE user_id=?", [c.uid])
  const um = await usersByIds(c, rows.map((r) => r.blocked_id))
  return json([...um.values()])
}
async function block(c: C, on: boolean) {
  const id = +c.p.id
  if (id === c.uid) fail("O‘zingizni bloklab bo‘lmaydi")
  if (on) await c.db.run("REPLACE INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)", [c.uid, id, now()])
  else await c.db.run("DELETE FROM blocks WHERE user_id=? AND blocked_id=?", [c.uid, id])
  return json({ ok: true })
}

// ------------------------- Chatlar -------------------------
async function chatSummaries(c: C, onlyId?: number) {
  const rows = await c.db.q(
    `SELECT ${CHAT_COLS.split(",").map((x) => "c." + x).join(",")}, m.role, m.last_read, m.muted, m.pinned,
      (SELECT COUNT(*) FROM messages x WHERE x.chat_id=c.id AND x.id>m.last_read AND x.sender_id<>? AND x.deleted=0) AS unread
     FROM chat_members m JOIN chats c ON c.id=m.chat_id
     WHERE m.user_id=? AND m.status='active' ${onlyId ? "AND c.id=?" : ""} ORDER BY c.last_msg_at DESC LIMIT 300`,
    onlyId ? [c.uid, c.uid, onlyId] : [c.uid, c.uid],
  )
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  // TEZLIK (umumiy): oxirgi xabarlar va direct-peer qatorlari mustaqil — parallel
  // (chatlar ro'yxati eng ko'p so'raladigan og'ir endpoint — ilova ochilishi, 30s sinxron, WS reconnect)
  const directIds = rows.filter((r) => r.type === "direct").map((r) => r.id)
  const [last, peers] = await Promise.all([
    c.db.q(
      `SELECT * FROM messages WHERE id IN (SELECT MAX(id) FROM messages WHERE chat_id IN (${ph(ids)}) AND deleted=0 GROUP BY chat_id)`,
      ids,
    ),
    directIds.length
      ? c.db.q(`SELECT chat_id, user_id, last_read AS peer_last_read FROM chat_members WHERE chat_id IN (${ph(directIds)}) AND user_id<>?`, [...directIds, c.uid])
      : Promise.resolve([] as any[]),
  ])
  const lastMap = new Map(last.map((m) => [m.chat_id, msgOut(m)]))
  const um = await usersByIds(c, [...peers.map((p) => p.user_id), c.uid])
  const peerMap = new Map(peers.map((p) => [p.chat_id, p]))
  return rows.map((r) => {
    const o: any = chatOut(r)
    o.last_message = lastMap.get(r.id) || null
    if (r.type === "direct") {
      const p = peerMap.get(r.id)
      o.peer = p ? um.get(p.user_id) : um.get(c.uid)
      o.saved = !p
      o.peer_last_read = p ? p.peer_last_read : o.last_read
    }
    return o
  })
}
async function listChats(c: C) {
  return json({ chats: await chatSummaries(c), now: now() })
}
async function openDirect(c: C) {
  const peer = +c.b.user_id
  const u = await c.db.one("SELECT id FROM users WHERE id=?", [peer])
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  const key = [c.uid, peer].sort((a, b) => a - b).join(":")
  let ch = await c.db.one("SELECT id FROM chats WHERE direct_key=?", [key])
  if (!ch) {
    if (peer !== c.uid && (await blockedBetween(c, c.uid, peer))) fail("Bu foydalanuvchiga yozib bo‘lmaydi", 403)
    const id = newId(), t = now()
    await c.db.run("INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES(?,?,?,0,?,?,?,?,?)",
      [id, "direct", c.uid, randomStr(10), key, peer === c.uid ? 1 : 2, t, t])
    await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, c.uid, t])
    if (peer !== c.uid) await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, peer, t])
    ch = { id }
  }
  const s = await chatSummaries(c, ch.id)
  return json(s[0])
}
async function createChat(c: C) {
  const type = c.b.type === "channel" ? "channel" : "group"
  const title = str(c.b.title, 128)
  if (!title) fail("Nom kiriting")
  const username = str(c.b.username, 32).replace(/^@/, "")
  if (username) await checkUsername(c, username)
  const id = newId(), t = now()
  const pub = c.b.is_public === 0 || c.b.is_public === false ? 0 : 1
  const av = c.b.avatar ? avatarOk(c.b.avatar) : null
  await c.db.run(
    `INSERT INTO chats(id,type,title,description,username,avatar,avatar_ver,owner_id,is_public,invite_hash,join_approval,permissions,settings,member_count,last_msg_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [id, type, title, str(c.b.description, 500), username || null, av, av ? t : 0, c.uid, pub, randomStr(12), c.b.join_approval ? 1 : 0,
      JSON.stringify(DEF_PERMS), JSON.stringify(DEF_SET), t, t],
  )
  await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'owner',?)", [id, c.uid, t])
  const add: number[] = Array.isArray(c.b.members) ? c.b.members.map(Number).filter((x: number) => x && x !== c.uid).slice(0, 200) : []
  for (const u of add) await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, u, t])
  await recount(c, id)
  await sysMsg(c, id, type === "channel" ? "Kanal yaratildi" : "Guruh yaratildi")
  if (add.length) c.wait(notify(c.env, add, { type: "chat_update", chat_id: id }))
  return json((await chatSummaries(c, id))[0])
}
async function recount(c: C, id: number) {
  const r = await c.db.one("SELECT COUNT(*) AS cnt FROM chat_members WHERE chat_id=? AND status='active'", [id])
  await c.db.run("UPDATE chats SET member_count=? WHERE id=?", [Number(r?.cnt || 0), id])
}
async function sysMsg(c: C, chatId: number, text: string) {
  const id = newId(), t = now()
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,'system',?,NULL,?,?,?)",
    [id, chatId, c.uid, text, t, t, t + 100 * 365 * DAY])
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, chatId])
  const m = msgOut(await c.db.one("SELECT * FROM messages WHERE id=?", [id]))
  notifyChat(c, chatId, { type: "message", chat_id: chatId, message: m })
}
async function getChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  const active = m && m.status === "active"
  if (!active && (ch.type === "direct" || !ch.is_public)) {
    const hash = c.url.searchParams.get("hash")
    if (!hash || hash !== ch.invite_hash) fail("Bu yopiq chat", 403)
  }
  let o: any = active ? (await chatSummaries(c, id))[0] : chatOut(ch)
  o.joined = !!active
  o.banned = m?.status === "banned"
  const req = await c.db.one("SELECT 1 AS x FROM join_requests WHERE chat_id=? AND user_id=?", [id, c.uid])
  o.requested = !!req
  if (isAdm(m)) {
    o.invite_hash = ch.invite_hash
    const rc = await c.db.one("SELECT COUNT(*) AS cnt FROM join_requests WHERE chat_id=?", [id])
    o.requests = Number(rc?.cnt || 0)
  }
  return json(o)
}
async function chatByInvite(c: C) {
  const ch = await c.db.one(`SELECT ${CHAT_COLS} FROM chats WHERE invite_hash=? AND type<>'direct'`, [c.p.hash])
  if (!ch) fail("Havola yaroqsiz yoki bekor qilingan", 404)
  const m = await member(c, ch.id)
  return json({ ...chatOut(ch), joined: m?.status === "active", invite_hash: c.p.hash })
}
async function chatByUsername(c: C) {
  const name = c.p.name.replace(/^@/, "")
  const ch = await c.db.one(`SELECT ${CHAT_COLS} FROM chats WHERE username=? AND type<>'direct'`, [name])
  if (ch) { const m = await member(c, ch.id); return json({ chat: { ...chatOut(ch), joined: m?.status === "active" } }) }
  const u = await c.db.one("SELECT id FROM users WHERE username=?", [name])
  if (u) return json({ user: (await usersByIds(c, [u.id])).get(u.id) })
  return fail("Topilmadi", 404)
}
async function patchChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chatni sozlab bo‘lmaydi")
  await needAdmin(c, id)
  const b = c.b, sets: string[] = [], vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(col + "=?"); vals.push(v) }
  if ("title" in b) { const v = str(b.title, 128); if (!v) fail("Nom bo‘sh bo‘lmasin"); put("title", v) }
  if ("description" in b) put("description", str(b.description, 500))
  if ("username" in b) { const v = str(b.username, 32).replace(/^@/, ""); if (v) await checkUsername(c, v, undefined, id); put("username", v || null) }
  if ("is_public" in b) put("is_public", b.is_public ? 1 : 0)
  if ("join_approval" in b) put("join_approval", b.join_approval ? 1 : 0)
  if (b.permissions && typeof b.permissions === "object") {
    const cur = parse(ch.permissions, DEF_PERMS)
    for (const k of Object.keys(DEF_PERMS)) if (k in b.permissions) cur[k] = b.permissions[k] ? 1 : 0
    put("permissions", JSON.stringify(cur))
  }
  if (b.settings && typeof b.settings === "object") {
    const cur = parse(ch.settings, DEF_SET)
    for (const k of Object.keys(DEF_SET)) if (k in b.settings) cur[k] = k === "slow" ? Math.max(0, Math.min(3600, +b.settings[k] || 0)) : b.settings[k] ? 1 : 0
    put("settings", JSON.stringify(cur))
  }
  if ("avatar" in b) { const a = avatarOk(b.avatar); put("avatar", a); put("avatar_ver", a ? now() : 0) }
  if (sets.length) await c.db.run(`UPDATE chats SET ${sets.join(",")} WHERE id=?`, [...vals, id])
  notifyChat(c, id, { type: "chat_update", chat_id: id })
  return getChat(c)
}
async function deleteChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (ch.type === "direct") { if (!m) fail("Ruxsat yo‘q", 403) }
  else if (ch.owner_id !== c.uid) fail("Faqat egasi o‘chira oladi", 403)
  const ids = (await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? LIMIT 41", [id])).map((r) => r.user_id)
  await SW.dropMedia(c.db, "chat_id=?", [id])
  await c.db.run("DELETE FROM messages WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chat_members WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM join_requests WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chats WHERE id=?", [id])
  c.wait(notify(c.env, ids, { type: "chat_deleted", chat_id: id }))
  return json({ ok: true })
}
async function revokeInvite(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const h = randomStr(12)
  await c.db.run("UPDATE chats SET invite_hash=? WHERE id=?", [h, id])
  return json({ invite_hash: h })
}
async function joinChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Bu shaxsiy chat")
  // v106: egapanel bloklagan kanal/guruhga kirish yopiq (flag faqat paneldan qo'yiladi)
  if (+ch.blocked === 1) fail("Bu chat bloklangan", 403)
  const m = await member(c, id)
  if (m?.status === "banned") fail("Siz bu chatdan chetlatilgansiz", 403)
  if (m?.status === "active") return json({ joined: true })
  const viaHash = c.b.hash && c.b.hash === ch.invite_hash
  if (!ch.is_public && !viaHash) fail("Bu yopiq chat — taklif havolasi kerak", 403)
  if (ch.join_approval) {
    await c.db.run("REPLACE INTO join_requests(chat_id,user_id,created_at) VALUES(?,?,?)", [id, c.uid, now()])
    const admins = (await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? AND role IN ('owner','admin') AND status='active' LIMIT 20", [id])).map((r) => r.user_id)
    c.wait(notify(c.env, admins, { type: "join_request", chat_id: id }))
    return json({ joined: false, requested: true })
  }
  await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, c.uid, now()])
  await recount(c, id)
  if (ch.type === "group") await sysMsg(c, id, "guruhga qo‘shildi")
  return json({ joined: true, chat: (await chatSummaries(c, id))[0] })
}
async function leaveChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chatni o‘chiring")
  if (ch.owner_id === c.uid) fail("Egasi chiqib keta olmaydi — kanal/guruhni o‘chiring")
  await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", [id, c.uid])
  await recount(c, id)
  if (ch.type === "group") await sysMsg(c, id, "guruhni tark etdi")
  return json({ ok: true })
}
async function listMembers(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const m = await member(c, id)
  if (!m || m.status !== "active") fail("Ruxsat yo‘q", 403)
  if (ch.type === "channel" && !isAdm(m)) fail("Kanal a‘zolarini faqat adminlar ko‘radi", 403)
  const st = c.url.searchParams.get("status") === "banned" ? "banned" : "active"
  const rows = await c.db.q("SELECT user_id, role, status FROM chat_members WHERE chat_id=? AND status=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at LIMIT 500", [id, st])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json(rows.map((r) => ({ ...um.get(r.user_id), role: r.role, status: r.status })).filter((x) => x.id))
}
async function addMembers(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  if (ch.type === "direct") fail("Shaxsiy chat")
  const m = await member(c, id)
  const perms = parse(ch.permissions, DEF_PERMS)
  if (!isAdm(m) && !(ch.type === "group" && m?.status === "active" && perms.invite)) fail("A‘zo qo‘shishga ruxsat yo‘q", 403)
  const ids: number[] = (Array.isArray(c.b.user_ids) ? c.b.user_ids : []).map(Number).filter(Boolean).slice(0, 100)
  const t = now()
  for (const u of ids) {
    const ex = await c.db.one("SELECT status FROM chat_members WHERE chat_id=? AND user_id=?", [id, u])
    if (ex?.status === "active") continue
    if (ex?.status === "banned" && !isAdm(m)) continue
    await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, u, t])
  }
  await recount(c, id)
  if (ids.length) await sysMsg(c, id, `${ids.length} ta a‘zo qo‘shildi`)
  c.wait(notify(c.env, ids, { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function memberAction(c: C) {
  const id = +c.p.id, target = +c.p.uid, action = c.p.action
  const ch = await needChat(c, id)
  const me = await needAdmin(c, id)
  const t = await c.db.one("SELECT role,status FROM chat_members WHERE chat_id=? AND user_id=?", [id, target])
  if (target === ch.owner_id) fail("Egasiga nisbatan bu amalni bajarib bo‘lmaydi", 403)
  if (t?.role === "admin" && me.role !== "owner" && action !== "unban") fail("Adminni faqat egasi boshqaradi", 403)
  switch (action) {
    case "admin":
    case "unadmin":
      if (me.role !== "owner") fail("Admin tayinlashni faqat egasi qila oladi", 403)
      if (!t || t.status !== "active") fail("A‘zo emas")
      await c.db.run("UPDATE chat_members SET role=? WHERE chat_id=? AND user_id=?", [action === "admin" ? "admin" : "member", id, target])
      break
    case "kick":
      await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", [id, target])
      break
    case "ban":
      await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','banned',?)", [id, target, now()])
      await c.db.run("DELETE FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
      break
    case "unban":
      await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=? AND status='banned'", [id, target])
      break
    default: fail("Noma’lum amal")
  }
  await recount(c, id)
  c.wait(notify(c.env, [target], { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function listRequests(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const rows = await c.db.q("SELECT user_id FROM join_requests WHERE chat_id=? ORDER BY created_at LIMIT 200", [id])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json([...um.values()])
}
async function requestAction(c: C) {
  const id = +c.p.id, target = +c.p.uid
  await needAdmin(c, id)
  const r = await c.db.one("SELECT 1 AS x FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
  if (!r) fail("So‘rov topilmadi", 404)
  await c.db.run("DELETE FROM join_requests WHERE chat_id=? AND user_id=?", [id, target])
  if (c.p.action === "approve") {
    await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','active',?)", [id, target, now()])
    await recount(c, id)
  }
  c.wait(notify(c.env, [target], { type: "chat_update", chat_id: id }))
  return json({ ok: true })
}
async function muteChat(c: C) {
  await c.db.run("UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?", [c.b.muted ? 1 : 0, +c.p.id, c.uid])
  return json({ ok: true })
}
// Chatni ro'yxat boshiga qadash (faqat o'zi uchun)
async function pinChat(c: C) {
  const id = +c.p.id
  const m = await member(c, id)
  if (!m || m.status !== "active") fail("Avval qo‘shiling", 403)
  await c.db.run("UPDATE chat_members SET pinned=? WHERE chat_id=? AND user_id=?", [c.b.on ? 1 : 0, id, c.uid])
  return json({ ok: true, pinned: c.b.on ? 1 : 0 })
}
// Xabarni yuqoriga qadash (e'lon kuni) — guruh/kanalda admin, shaxsiy chatda o'zi
async function pinMessage(c: C) {
  const m = await ownMsg(c, false)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "direct" && !isAdm(await member(c, m.chat_id))) fail("Qadash faqat adminlarda", 403)
  const on = !!c.b.on
  await c.db.run("UPDATE chats SET pinned_id=? WHERE id=?", [on ? m.id : 0, m.chat_id])
  const out = on ? (await enrich(c, [m]))[0] : null
  notifyChat(c, m.chat_id, { type: "pinned", chat_id: m.chat_id, message: out })
  return json({ ok: true, pinned_id: on ? m.id : 0, message: out })
}

// ------------------------- Xabarlar -------------------------
async function enrich(c: C, msgs: any[]) {
  const ids = msgs.map((m) => m.id)
  const out = msgs.map(msgOut) as any[]
  if (!ids.length) return out
  // TEZLIK (umumiy): reaksiyalar, so'rovnoma ovozlari va izohlar soni bir-biridan mustaqil —
  // 3 ketma-ket TiDB so'rovi (3 HTTP davra) o'rniga BIR to'lqinda parallel so'raladi.
  // Bu xabarlar ro'yxati va YUBORILGAN har xabar tezligini oshiradi.
  const polls = msgs.filter((m) => m.kind === "poll").map((m) => m.id)
  const [rx, votes, cm] = await Promise.all([
    c.db.q(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${ph(ids)})`, ids),
    polls.length ? c.db.q(`SELECT message_id, user_id, opt FROM poll_votes WHERE message_id IN (${ph(polls)})`, polls) : Promise.resolve([] as any[]),
    c.db.q(`SELECT message_id, COUNT(*) AS cnt FROM msg_comments WHERE message_id IN (${ph(ids)}) GROUP BY message_id`, ids).catch((): any[] => []),
  ])
  const cmMap = new Map(cm.map((x) => [x.message_id, Number(x.cnt)]))
  for (const m of out) {
    const r: Record<string, number[]> = {}
    for (const x of rx) if (x.message_id === m.id) (r[x.emoji] ||= []).push(x.user_id)
    m.reactions = r
    m.comment_count = cmMap.get(m.id) || 0
    if (m.kind === "poll") {
      const v: Record<number, number> = {}
      let mine = -1
      for (const x of votes) if (x.message_id === m.id) { v[x.opt] = (v[x.opt] || 0) + 1; if (x.user_id === c.uid) mine = x.opt }
      m.votes = v; m.my_vote = mine
    }
  }
  await Promise.all(out.map(async (m) => { if (!m.deleted) m.sig = await signMsg(c.env, m) }))
  return out
}
async function getMessages(c: C) {
  const id = +c.p.id
  // TEZLIK (umumiy): chat ma'lumoti va a'zolik tekshiruvi mustaqil — parallel
  const [ch, m] = await Promise.all([needChat(c, id), member(c, id)])
  if (!(m && m.status === "active") && !(ch.type !== "direct" && ch.is_public)) fail("Ruxsat yo‘q", 403)
  const after = +(c.url.searchParams.get("after") || 0)
  const since = +(c.url.searchParams.get("since") || 0)
  const before = +(c.url.searchParams.get("before") || 0)
  const latestQ = +(c.url.searchParams.get("latest") || 0)
  const latest = latestQ ? Math.min(200, Math.max(1, latestQ)) : 0 // 0 = param yo'q (before/sinch rejimlar ishlaydi)
  const t = now()
  let all: any[]
  let more = false
  if (latest) {
    // Tez ochilish: eng oxirgi N xabar bitta so'rovda (10 martagacha so'rov o'rniga 1). O'chirilganlar tarixda ko'rinmaydi.
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 ORDER BY id DESC LIMIT " + latest, [id])
    all = rows.reverse()
    more = rows.length === latest
  } else if (before) {
    // Orqaga sahifalash: butun tarix saqlangan — eski yozishmalar hech qachon yo'qolmaydi
    const rows = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id<? ORDER BY id DESC LIMIT 100", [id, before])
    all = rows.reverse()
    more = rows.length === 100
  } else {
    const fresh = await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id>? ORDER BY id LIMIT 300", [id, after])
    const changed = since && after
      ? await c.db.q("SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND id<=? AND updated_at>? ORDER BY id LIMIT 300", [id, after, since])
      : []
    // v108: O'CHIRILGAN XABAR "QABRSTONLARI" (tombstone) — WS hodisasini o'tkazib yuborgan
    // klient (fon/oflayn bo'lgan) o'chirilgan xabarlarni sinxronlashda ham bilishi SHART —
    // aks holda paneldan o'chirilgan yomon so'zlar kanal/guruhda QOLIB KETARDI («o'chmayapti»
    // shikoyatining ildizi: changed-so'rovi deleted=1 qatorlarni BERMASDI). Engil qatorlar —
    // faqat id; klient merge() deleted=1 ni ko'rib ro'yxatdan olib tashlaydi (media ham bo'shadi).
    const dels = since && after
      ? await c.db.q("SELECT id FROM messages WHERE chat_id=? AND deleted=1 AND id<=? AND updated_at>? ORDER BY id LIMIT 2000", [id, after, since])
      : []
    const tombs = dels.map((r) => ({ id: +r.id, chat_id: id, sender_id: 0, kind: "text", body: null, meta: null, edited: 0, deleted: 1, created_at: 0, updated_at: since }))
    all = [...changed, ...fresh, ...tombs]
    more = fresh.length === 300
  }
  // TEZLIK (umumiy): boyitish, mualliflar va peer oxirgi o'qish mustaqil — parallel.
  // Chat ochilish ketma-ketligi: 5 davra → 3 to'lqin (~40% tezroq).
  const [messages, um, peer] = await Promise.all([
    enrich(c, all),
    usersByIds(c, [...new Set(all.map((x) => x.sender_id))]),
    ch.type === "direct" ? c.db.one("SELECT last_read FROM chat_members WHERE chat_id=? AND user_id<>?", [id, c.uid]) : Promise.resolve(null as any),
  ])
  return json({ messages, users: Object.fromEntries(um), now: t, peer_last_read: peer?.last_read ?? null, more })
}
async function sendMessage(c: C) {
  // v110 XABAR-SPAM POSBONI: 900 xabar/soat (15/daqixa uzluksiz — inson uchun KOP).
  // O'g'irlangan token boti chatlarni spam bilan to'ldirolmaydi. Oddiy foydalanuvchi
  // bu chegaraga hech qachon yaqinlasholmaydi; panel e'lonlari shu yo'ldan O'TMAYDI.
  if (fwSoat(FW_MSG, c.uid, 900)) fail("Juda ko‘p xabar — birozdan keyin davom eting", 429)
  const id = +c.p.id
  const ch = await needChat(c, id)
  // v106: egapanel bloklagan kanal/guruhga yozib bo'lmaydi (flag faqat paneldan qo'yiladi,
  // default 0 — oddiy foydalanuvchi uchun bu qator hech qachon ishga tushmaydi)
  if (+ch.blocked === 1) fail("Bu kanal/guruh bloklangan", 403)
  const m = await member(c, id)
  if (!m || m.status !== "active") fail(m?.status === "banned" ? "Siz chetlatilgansiz" : "Avval qo‘shiling", 403)
  const kind = String(c.b.kind || "text")
  if (!MSG_KINDS.has(kind)) fail("Xabar turi noto‘g‘ri")
  const body = str(c.b.body, 4096)
  const meta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (meta && meta.length > 6000) fail("Xabar juda katta")
  if (kind === "text" && !body) fail("Bo‘sh xabar")
  const adm = isAdm(m)
  if (ch.type === "channel" && !adm) fail("Kanalga faqat adminlar yozadi", 403)
  if (ch.type === "group" && !adm) {
    const p = parse(ch.permissions, DEF_PERMS)
    if (!p.send) fail("Guruhda yozish yopilgan", 403)
    if (["photo", "video", "voice", "round", "file"].includes(kind) && !p.media) fail("Media yuborish taqiqlangan", 403)
    if (["sticker", "gif"].includes(kind) && !p.stickers) fail("Stiker va GIF taqiqlangan", 403)
    if (kind === "poll" && !p.polls) fail("So‘rovnoma taqiqlangan", 403)
    if (!p.links && /(https?:\/\/|www\.|t\.me\/)/i.test(body)) fail("Havola yuborish taqiqlangan", 403)
    const s = parse(ch.settings, DEF_SET)
    if (s.slow > 0) {
      const last = await c.db.one("SELECT created_at FROM messages WHERE chat_id=? AND sender_id=? ORDER BY id DESC LIMIT 1", [id, c.uid])
      const left = last ? Math.ceil((last.created_at + s.slow * 1000 - now()) / 1000) : 0
      if (left > 0) fail(`Sekin rejim: ${left} soniya kuting`, 429)
    }
  }
  let peerId = 0
  if (ch.type === "direct") {
    const p = await c.db.one("SELECT user_id FROM chat_members WHERE chat_id=? AND user_id<>?", [id, c.uid])
    peerId = p?.user_id || 0
    if (peerId && (await blockedBetween(c, c.uid, peerId))) fail("Bu foydalanuvchi bilan yozishib bo‘lmaydi", 403)
  }
  const mid = newId(), t = now()
  const exp = t + 100 * 365 * DAY // o'chmas tarix: faqat foydalanuvchi o'chira oladi
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [mid, id, c.uid, kind, body || null, meta, t, t, exp])
  // TEZLIK (umumiy): chat/a'zo/media belgilari yangilashlari bir-biriga bog'liq emas
  // (har xil jadval) — parallel. Xabar yuborish ~2 HTTP davra tezroq.
  const mediaId = c.b.meta?.media_id
  await Promise.all([
    c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, id]),
    c.db.run("UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?", [mid, id, c.uid]),
    mediaId ? c.db.run("UPDATE media SET expires_at=?, keep=1, chat_id=?, next_check=0 WHERE id=? AND owner_id=?", [exp, id, String(mediaId), c.uid]) : Promise.resolve(),
  ])
  if (mediaId) c.wait(SW.planReplicas(c.db, 1, String(mediaId)))
  const out = (await enrich(c, [await c.db.one("SELECT * FROM messages WHERE id=?", [mid])]))[0]
  out.client_id = c.b.client_id || null
  notifyChat(c, id, { type: "message", chat_id: id, message: out })
  c.wait(pushChatMsg(c, id, ch, out)) // qurilmasi yopiq a'zolarga Web Push
  return json(out)
}
async function ownMsg(c: C, needOwner = true) {
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [+c.p.id])
  if (!m || m.deleted) fail("Xabar topilmadi", 404)
  const mem = await member(c, m.chat_id)
  if (!mem || mem.status !== "active") fail("Ruxsat yo‘q", 403)
  if (needOwner && m.sender_id !== c.uid) {
    const ch = await needChat(c, m.chat_id)
    if (!(ch.type !== "direct" && isAdm(mem))) fail("Faqat o‘z xabaringiz", 403)
  }
  return m
}
async function pushMsg(c: C, mid: number) {
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [mid])
  const out = (await enrich(c, [m]))[0]
  notifyChat(c, m.chat_id, { type: "message_update", chat_id: m.chat_id, message: out })
  return out
}
async function editMessage(c: C) {
  const m = await ownMsg(c)
  if (m.sender_id !== c.uid || m.kind !== "text") fail("Faqat o‘z matnli xabaringizni tahrirlaysiz", 403)
  const body = str(c.b.body, 4096)
  if (!body) fail("Bo‘sh xabar")
  await c.db.run("UPDATE messages SET body=?, edited=1, updated_at=? WHERE id=?", [body, now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function deleteMessage(c: C) {
  // O'chirish ruxsati (Telegram-uslubi): o'z xabari — hamma joyda; bevosita suhbatdagi qarshi tomon xabari — ikkala tomon ham o'chiradi;
  // guruh/kanalda — adminlar. ownMsg(needOwner=false) bilan ochiq qabul qilib, keyin qo'lda tekshiramiz.
  const m = await ownMsg(c, false)
  if (m.sender_id !== c.uid) {
    const ch = await needChat(c, m.chat_id)
    const mem = await member(c, m.chat_id)
    const can = ch.type === "direct" || (ch.type !== "direct" && mem && isAdm(mem))
    if (!can) fail("Faqat o‘z xabaringiz", 403)
  }
  const mid = parse(m.meta, {}).media_id
  if (mid) await SW.dropMedia(c.db, "id=?", [String(mid)])
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE id=?", [now(), m.id])
  // Qadalgan xabar o'chirilsa — qadash ham olinadi
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=? AND pinned_id=?", [m.chat_id, m.id]).catch(() => {})
  await c.db.run("DELETE FROM reactions WHERE message_id=?", [m.id])
  return json(await pushMsg(c, m.id))
}
// SUHBATNI TOZALASH: barcha yozishmalar ikkala tomonda ham o'chiriladi (Telegram "Clear history" uslubi).
// Bevosita suhbat — a'zoning o'zi, guruh/kanal — faqat admin/owner.
async function clearChat(c: C) {
  const id = +c.p.id
  const ch = await needChat(c, id)
  const mem = await member(c, id)
  if (!mem || mem.status !== "active") fail("Ruxsat yo‘q", 403)
  if (ch.type !== "direct" && !isAdm(mem)) fail("Faqat adminlar tozalashi mumkin", 403)
  const t = now()
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE chat_id=? AND deleted=0", [t, id])
  await c.db.run("UPDATE media SET dropped=1 WHERE chat_id=? AND dropped=0", [id]).catch(() => {})
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=?", [id]).catch(() => {})
  await c.db.run("UPDATE chat_members SET pinned=0 WHERE chat_id=?", [id]).catch(() => {})
  notifyChat(c, id, { type: "chat_cleared", chat_id: id, now: t })
  return json({ ok: true, now: t })
}
async function react(c: C) {
  const m = await ownMsg(c, false)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "direct" && !parse(ch.settings, DEF_SET).reactions) fail("Reaksiyalar o‘chirilgan")
  const e = str(c.b.emoji, 16)
  const cur = await c.db.one("SELECT emoji FROM reactions WHERE message_id=? AND user_id=?", [m.id, c.uid])
  if (cur && (cur.emoji === e || !e)) await c.db.run("DELETE FROM reactions WHERE message_id=? AND user_id=?", [m.id, c.uid])
  else if (e) await c.db.run("REPLACE INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)", [m.id, c.uid, e])
  await c.db.run("UPDATE messages SET updated_at=? WHERE id=?", [now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function vote(c: C) {
  const m = await ownMsg(c, false)
  if (m.kind !== "poll") fail("So‘rovnoma emas")
  const meta = parse(m.meta, {})
  const opt = +c.b.opt
  if (!(opt >= 0 && opt < (meta.options || []).length)) fail("Variant noto‘g‘ri")
  await c.db.run("REPLACE INTO poll_votes(message_id,user_id,opt) VALUES(?,?,?)", [m.id, c.uid, opt])
  await c.db.run("UPDATE messages SET updated_at=? WHERE id=?", [now(), m.id])
  return json(await pushMsg(c, m.id))
}
async function markRead(c: C) {
  const id = +c.p.id
  const last = +c.b.last_id || 0
  const ch = await needChat(c, id)
  await c.db.run("UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=? AND last_read<?", [last, id, c.uid, last])
  if (ch.type === "direct") {
    // O'CHMAS TARIX: o'qilgan xabarlar ham serverda butunlay saqlanadi — hech narsa avtomatik o'chmaydi
    notifyChat(c, id, { type: "read", chat_id: id, user_id: c.uid, last_id: last })
  }
  return json({ ok: true })
}
async function typing(c: C) {
  const id = +c.p.id
  const m = await member(c, id)
  if (!m || m.status !== "active") return json({ ok: false })
  const ids = (await memberIds(c, id)).filter((x) => x !== c.uid)
  c.wait(notify(c.env, ids, { type: "typing", chat_id: id, user_id: c.uid, action: str(c.b.action, 10) || "text" }))
  return json({ ok: true })
}

// ------------------------- Web Push (Telegram-uslubidagi bildirishnomalar) -------------------------
const PUSH_PREVIEW: Record<string, string> = {
  photo: "📷 Rasm", video: "🎬 Video", voice: "🎤 Ovozli xabar", round: "📹 Video xabar",
  file: "📎 Fayl", sticker: "🙂 Stiker", gif: "GIF", poll: "📊 So‘rovnoma",
  location: "📍 Joylashuv", contact: "👤 Kontakt",
}
async function pushSubscribe(c: C) {
  const ep = str(c.b.endpoint, 768)
  const p256dh = str(c.b.keys?.p256dh, 255)
  const auth = str(c.b.keys?.auth, 120)
  if (!/^https:\/\//.test(ep) || !p256dh || !auth) fail("Push ma‘lumotlari noto‘g‘ri")
  const h = await sha256(ep)
  const t = now()
  await c.db.run("REPLACE INTO push_subs(endpoint_hash,user_id,endpoint,p256dh,auth,ua,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    [h, c.uid, ep, p256dh, auth, str(c.req.headers.get("user-agent") || "", 200), t, t])
  return json({ ok: true })
}
async function pushUnsubscribe(c: C) {
  const ep = str(c.b.endpoint, 768)
  if (ep) await c.db.run("DELETE FROM push_subs WHERE endpoint_hash=? AND user_id=?", [await sha256(ep), c.uid])
  else await c.db.run("DELETE FROM push_subs WHERE user_id=?", [c.uid])
  return json({ ok: true })
}

// FON XABAR SUMMASI (v78) — APK KeepAliveService har ~20s so'raydi (Web Push WebView'da
// ishlamaydi — Android xizmati o'zi o'qilmagan xabarlarni tekshiradi). Ovoz uchirilgan
// chatlar, push'ni butunlay o'chirgan foydalanuvchi va o'chirilgan xabarlar chiqariladi.
// Javob: {n: nechta chatda o'qilmagan, last: eng yangi xabar sarlavhasi} yoki {n:0}.
async function notifyUnread(c: C) {
  try {
    const pr = await c.db.one("SELECT prefs FROM users WHERE id=?", [c.uid])
    try { if (JSON.parse(String(pr?.prefs || "{}")).push === 0) return json({ n: 0 }) } catch {}
    const rows = await c.db.q(
      `SELECT m.chat_id, m.kind, m.body, m.created_at, u.first_name, u.last_name, ch.type AS chtype, ch.title AS chtitle
       FROM messages m
       JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=? AND cm.status='active' AND cm.muted=0
       JOIN chats ch ON ch.id=m.chat_id
       LEFT JOIN users u ON u.id=m.sender_id
       WHERE m.id>cm.last_read AND m.sender_id<>? AND m.deleted=0
       ORDER BY m.id DESC LIMIT 40`, [c.uid, c.uid]) as any[]
    if (!rows || !rows.length) return json({ n: 0 })
    const chats = new Set(rows.map((r) => r.chat_id))
    const last = rows[0]
    const nm = ((last.first_name || "") + " " + (last.last_name || "")).trim() || "Foydalanuvchi"
    const prev = last.kind === "text" ? String(last.body || "") : (PUSH_PREVIEW[last.kind] || "Yangi xabar")
    const title = last.chtype === "direct" ? nm : (last.chtitle || "Guruh")
    const body = last.chtype === "group" ? `${nm}: ${prev}` : prev
    return json({ n: chats.size, chat_id: last.chat_id, t: title.slice(0, 80), b: body.slice(0, 240) })
  } catch { return json({ n: 0 }) }
}
// Yangi xabarni offline a'zolarga push qilish (ovoz uchirilganlar va push o'chirganlar chiqariladi)
async function pushChatMsg(c: C, chatId: number, ch: any, m: any) {
  try {
    const rows = await c.db.q("SELECT user_id, muted FROM chat_members WHERE chat_id=? AND status='active' AND user_id<>? LIMIT " + NOTIFY_CAP, [chatId, c.uid])
    let ids = rows.filter((r) => !r.muted).map((r) => r.user_id as number)
    if (!ids.length) return
    const pr = await c.db.q(`SELECT id, prefs FROM users WHERE id IN (${ph(ids)})`, ids)
    const off = new Set(pr.filter((r) => { try { return JSON.parse(String(r.prefs || "{}")).push === 0 } catch { return false } }).map((r) => Number(r.id)))
    ids = ids.filter((id) => !off.has(id))
    if (!ids.length) return
    const sender = await c.db.one("SELECT first_name, last_name FROM users WHERE id=?", [c.uid])
    const nm = ((sender?.first_name || "") + " " + (sender?.last_name || "")).trim() || "Foydalanuvchi"
    const prev = m.kind === "text" ? String(m.body || "") : (PUSH_PREVIEW[m.kind] || "Yangi xabar")
    const title = ch.type === "direct" ? nm : ch.title || (ch.type === "channel" ? "Kanal" : "Guruh")
    const body = ch.type === "group" ? `${nm}: ${prev}` : prev
    await pushUsers(c.env, ids, { t: title.slice(0, 80), b: body.slice(0, 240), c: chatId, tag: "g50c" + chatId }, { db: c.db, ttl: 3600 })
  } catch (e) { console.log("push xato", String(e)) }
}

// ------------------------- Media (bo'laklab) -------------------------
// v110 EGANI TALABI: 500 MB gacha fayllar (avval 30MB). Bo'laklar: kichik fayl 512KB,
// katta fayl (>30MB) mijozda 2MB — 500MB = 250 bo'lak (1200 chegarada 4.8 barobar zaxira).
const MAX_SIZE = 500 * 1024 * 1024
function abToB64(u: Uint8Array): string {
  let s = "", CH = 0x8000
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH))
  return btoa(s)
}
function b64ToU8(s: string): Uint8Array {
  const bin = atob(s), u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
async function mediaCreate(c: C) {
  // v98 YUKLASH POSBONI: fayl-yaratish 600/soat — o'g'irlangan token bo'sh media-yozuvlari
  // bilan D1'ni to'ldirmasin (oddiy foydalanuvchi soatiga o'nlab fayl yuboradi, 600 DAN YAQIN HAM KELMAYDI)
  if (fwSoat(FW_UPF, c.uid, 600)) fail("Juda ko‘p yuklash — birozdan keyin davom eting", 429)
  const size = +c.b.size || 0, chunks = +c.b.chunks || 1
  // v110 EGANI TALABI: 500 MB gacha fayllar (avval 30MB edi). Katta fayl = ko'p bo'lak:
  // 500MB = 250 ta 2MB bo'lak (mijoz v110'dan) yoki 977 ta 512KB bo'lak — chegara 1200.
  if (size <= 0 || size > MAX_SIZE) fail("Fayl hajmi 500 MB dan oshmasin")
  if (chunks < 1 || chunks > 1200) fail("Bo‘laklar soni noto‘g‘ri")
  const id = randomStr(22)
  await c.db.run("INSERT INTO media(id,owner_id,mime,name,size,chunks,complete,created_at,expires_at) VALUES(?,?,?,?,?,?,0,?,?)",
    [id, c.uid, str(c.b.mime, 100) || "application/octet-stream", str(c.b.name, 200) || "fayl", size, chunks, now(), now() + DAY])
  return json({ id })
}
async function mediaPut(c: C) {
  // v98 YUKLASH POSBONI: bo'lak-PUT 12000/soat (v110: 500MB fayllar uchun kengaytirildi —
  // oddiy foydalanuvchi 500MB = 250 PUT, 5 ta katta fayl ham erkin). R2 10GB'ni toshqin bilan
  // to'ldirish imkoni yo'q (bosqichli posbon + v110 BAYT-posbon bilan UCH qatlam).
  if (fwSoat(FW_UP, c.uid, 12000)) fail("Juda ko‘p yuklash — birozdan keyin davom eting", 429)
  // v110 BAYT POSBONI: soatiga 6GB — halol foydalanuvchi 12 ta 500MB fayl ham yuklay oladi;
  // o'g'irlangan token bayt bo'yicha ham to'siladi (R2 toshqin himoyasi qatlami 2).
  // Hisob shu yerda (quyida) BAYT bo'yicha yuritiladi — fwSoat so'rov sanaydi, bu esa bayt.
  const upb = FW_UPB.get(c.uid), upbt = Date.now()
  if (!upb || upbt - upb.t > 3_600_000) { if (FW_UPB.size > 10000) FW_UPB.clear(); FW_UPB.set(c.uid, { n: 0, t: upbt }) }
  const m = await c.db.one("SELECT owner_id,chunks,gone,chat_id FROM media WHERE id=?", [c.p.id])
  // v97 O'Z-O'ZINI TIKLASH: server nusxasi yo'qolgan (gone=1) faylga to'r a'zosi
  // (egasi / chat a'zosi / pin-job egasi) shifrlangan bo'laklarni QAYTA yuklashi mumkin
  const tiklaydi = !!m && m.gone === 1 && (m.owner_id === c.uid || (await canSee(c, c.uid, Number(m.chat_id))) || (await SW.hasJob(c, String(c.p.id), c.uid)))
  if (!m || (m.owner_id !== c.uid && !tiklaydi)) fail("Topilmadi", 404)
  const idx = +c.p.idx
  if (!(idx >= 0 && idx < m.chunks)) fail("Bo‘lak raqami noto‘g‘ri")
  // Yangi mijozlar binary (33% kam trafik, tezroq), eski mijozlar base64 text — ikkalasi ham qo‘llanadi
  let data: string
  let bytes: Uint8Array | null = null
  const ct = c.req.headers.get("content-type") || ""
  if (ct.includes("octet-stream")) {
    const ab = await c.req.arrayBuffer()
    // v110: 2MB bo'laklar (katta fayllar 500MB'gacha) — chegarada 200KB zaxira
    if (ab.byteLength > 2_200_000) fail("Bo‘lak juda katta")
    bytes = new Uint8Array(ab)
    data = abToB64(bytes)
  } else {
    data = await c.req.text()
    // v110: zaxira (R2 o'chgan) D1 yo'li eski 512KB bo'laklar uchun — 1.1MB limit qoldi
    if (data.length > 1_100_000 || !/^[A-Za-z0-9+/=]*$/.test(data.slice(0, 200))) fail("Bo‘lak noto‘g‘ri")
  }
  // v79 R2 ASOSIY YO'L: baytlar R2'ga (kalit m/<id>/<idx>), D1'ga faqat bo'sh MARKER —
  // bazaning hajmi fayllar bilan o'smaydi (TiDB posboni endi bo'lmaydi). R2 yozuvi
  // muvaffaqiyatsiz bo'lsa yoki binding bo'lmasa — eski D1-yo'li ishlaydi (zaxira).
  let r2ok = false
  if (c.env.BUCKET && bytes) {
    try {
      await c.env.BUCKET.put(`m/${c.p.id}/${idx}`, bytes)
      r2ok = true
    } catch (e) { jurnalYoz(c.env, "mediaPut", c.uid, "r2", String(e).slice(0, 200)) }
  }
  await c.db.run("REPLACE INTO media_chunks(media_id,idx,data) VALUES(?,?,?)", [c.p.id, idx, r2ok ? "" : data])
  // v110: bayt-posbon — shu bo'lak baytlari hisobga qo'shiladi; chegara oshsa 429 (keyingi bo'laklar o'tmaydi)
  const ub = FW_UPB.get(c.uid)
  if (ub) ub.n += bytes?.byteLength || 0
  if ((ub?.n || 0) > 6 * 1024 * 1024 * 1024) fail("Juda ko‘p yuklash — birozdan keyin davom eting", 429)
  return json({ ok: true, r2: r2ok, tik: tiklaydi ? 1 : 0 })
}
async function mediaDone(c: C) {
  const m = await c.db.one("SELECT owner_id,chunks,gone,chat_id,sha FROM media WHERE id=?", [c.p.id])
  // v97 TIKLASH: gone=1 faylni egasi yoki to'r a'zosi (chat a'zosi / pin-job egasi) yakunlaydi
  const tiklaydi = !!m && m.gone === 1 && (m.owner_id === c.uid || (await canSee(c, c.uid, Number(m.chat_id))) || (await SW.hasJob(c, String(c.p.id), c.uid)))
  if (!m || (m.owner_id !== c.uid && !tiklaydi)) fail("Topilmadi", 404)
  const r = await c.db.one("SELECT COUNT(*) AS cnt FROM media_chunks WHERE media_id=?", [c.p.id])
  if (Number(r?.cnt) !== m.chunks) fail("Fayl to‘liq yuklanmadi")
  const sha = /^[a-f0-9]{64}$/.test(String(c.b.sha || "")) ? String(c.b.sha) : null
  if (tiklaydi) {
    // BUTUNLIK MUHRI: serverda eski sha bor bo'lsa — tiklangan nusxa AYNAN shu bo'lishi shart
    if (m.sha && sha && sha !== m.sha) fail("Tiklangan fayl butunligi mos emadi")
    await c.db.run("UPDATE media SET complete=1, gone=0, sha=? WHERE id=?", [m.sha || sha, c.p.id])
    jurnalYoz(c.env, "mediaDone", c.uid, "tikla", "server nusxa to'rdan tiklandi " + String(c.p.id).slice(0, 8))
    return json({ ok: true, id: c.p.id, tik: 1 })
  }
  await c.db.run("UPDATE media SET complete=1, sha=? WHERE id=?", [sha, c.p.id])
  return json({ ok: true, id: c.p.id })
}
async function mediaMeta(c: C) {
  const m = await c.db.one("SELECT id,mime,name,size,chunks,complete,sha,gone,dropped FROM media WHERE id=?", [c.p.id])
  if (!m || !m.complete || m.gone || m.dropped) fail("Fayl serverda yo‘q (muddati tugagan bo‘lishi mumkin)", 404)
  return json(m)
}
async function mediaChunk(c: C) {
  const cc = { "cache-control": "private, max-age=31536000, immutable", ...CORS }
  const wantBin = (c.req.headers.get("accept") || "").includes("octet-stream")
  // v97: idx faqat butun son — aks holda NaN DB'ga yetib 500 bo'lardi va gone-detektor
  // yolg'on yonardi (yo'l soya-si: /media/:id/restore-info kabi 3-bo'lakli so'rovlar)
  if (!Number.isInteger(+c.p.idx) || +c.p.idx < 0) fail("Topilmadi", 404)
  // v79 R2 ASOSIY YO'L: yangi bo'laklar R2'da (D1'da marker ''). Eski fayllar D1'da
  // base64 — ikkalasi ham o'qiladi (klient Accept sarlavhasi bo'yicha binary/base64).
  if (c.env.BUCKET) {
    try {
      const obj = await c.env.BUCKET.get(`m/${c.p.id}/${+c.p.idx}`)
      if (obj) {
        const ab = await obj.arrayBuffer()
        if (wantBin) return new Response(ab, { headers: { "content-type": "application/octet-stream", ...cc } })
        return new Response(abToB64(new Uint8Array(ab)), { headers: { "content-type": "text/plain", ...cc } })
      }
    } catch (e) { jurnalYoz(c.env, "mediaChunk", c.uid, "r2", String(e).slice(0, 200)) }
  }
  const r = await c.db.one("SELECT data FROM media_chunks WHERE media_id=? AND idx=?", [c.p.id, +c.p.idx])
  if (!r) { await goneDetect(c, String(c.p.id)); fail("Topilmadi", 404) }
  // Bo'sh marker = R2'da bo'lishi kerak edi lekin topilmadi (bucket tozalangan) — yo'q.
  // v97: shu yerda to'r o'z-o'zini davolaydi (gone=1 → planReplicas → tiklash)
  if (!String(r.data || "").length) { await goneDetect(c, String(c.p.id)); fail("Bo‘lak R2 omborida yo‘q", 404) }
  if (wantBin) return new Response(b64ToU8(String(r.data)), { headers: { "content-type": "application/octet-stream", ...cc } })
  return new Response(r.data, { headers: { "content-type": "text/plain", ...cc } })
}

// ------------------------- Istoriyalar -------------------------
async function listStories(c: C) {
  const ids = await circle(c)
  const rows = await c.db.q(
    `SELECT s.*, v.viewer_id AS seen_by FROM stories s LEFT JOIN story_views v ON v.story_id=s.id AND v.viewer_id=?
     WHERE s.user_id IN (${ph(ids)}) AND s.expires_at>? ORDER BY s.created_at`,
    [c.uid, ...ids, now()],
  )
  const own = rows.filter((r) => r.user_id === c.uid).map((r) => r.id)
  // TEZLIK (umumiy): ko'rishlar soni va mualliflar mustaqil — parallel (ilova ochilishi + har 60s)
  const [vc, um] = await Promise.all([
    own.length ? c.db.q(`SELECT story_id, COUNT(*) AS cnt FROM story_views WHERE story_id IN (${ph(own)}) GROUP BY story_id`, own) : Promise.resolve([] as any[]),
    usersByIds(c, [...new Set(rows.map((r) => r.user_id))]),
  ])
  const vcm = new Map(vc.map((r) => [r.story_id, Number(r.cnt)]))
  const groups = new Map<number, any>()
  for (const r of rows) {
    if (!groups.has(r.user_id)) groups.set(r.user_id, { user: um.get(r.user_id), stories: [] })
    groups.get(r.user_id).stories.push({
      id: r.id, kind: r.kind, media_id: r.media_id, text_body: r.text_body, bg: r.bg,
      meta: r.meta ? parse(r.meta, null) : null, created_at: r.created_at,
      seen: r.user_id === c.uid || !!r.seen_by, views: r.user_id === c.uid ? vcm.get(r.id) || 0 : undefined,
    })
  }
  const list = [...groups.values()].filter((g) => g.user)
  for (const g of list) g.unseen = g.stories.filter((s: any) => !s.seen).length
  list.sort((a, b) => (a.user.id === c.uid ? -1 : b.user.id === c.uid ? 1 : (b.unseen > 0 ? 1 : 0) - (a.unseen > 0 ? 1 : 0) || b.stories.at(-1).created_at - a.stories.at(-1).created_at))
  return json(list)
}
async function createStory(c: C) {
  const kind = ["photo", "video", "text"].includes(c.b.kind) ? c.b.kind : fail("Tur noto‘g‘ri")
  if (kind !== "text" && !c.b.media_id) fail("Rasm yoki video kerak")
  if (kind === "text" && !str(c.b.text_body, 500)) fail("Matn kiriting")
  const id = newId(), t = now(), exp = t + DAY
  const smeta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (smeta && smeta.length > 6000) fail("Istoriya juda katta")
  await c.db.run("INSERT INTO stories(id,user_id,kind,media_id,text_body,bg,meta,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [id, c.uid, kind, c.b.media_id || null, str(c.b.text_body, 500) || null, str(c.b.bg, 200) || null, smeta, t, exp])
  if (c.b.media_id) await c.db.run("UPDATE media SET expires_at=? WHERE id=? AND owner_id=?", [exp, String(c.b.media_id), c.uid])
  return json({ id })
}
async function viewStory(c: C) {
  const s = await c.db.one("SELECT user_id FROM stories WHERE id=? AND expires_at>?", [+c.p.id, now()])
  if (!s) fail("Istoriya topilmadi", 404)
  if (s.user_id === c.uid) return json({ ok: true })
  const reaction = str(c.b.reaction, 16) || null
  await c.db.run("REPLACE INTO story_views(story_id,viewer_id,reaction,viewed_at) VALUES(?,?,?,?)", [+c.p.id, c.uid, reaction, now()])
  if (reaction) c.wait(notify(c.env, [s.user_id], { type: "story_reaction", story_id: +c.p.id, user_id: c.uid, reaction }))
  return json({ ok: true })
}
async function storyViews(c: C) {
  const s = await c.db.one("SELECT user_id FROM stories WHERE id=?", [+c.p.id])
  if (!s || s.user_id !== c.uid) fail("Ruxsat yo‘q", 403)
  const rows = await c.db.q("SELECT viewer_id, reaction, viewed_at FROM story_views WHERE story_id=? ORDER BY viewed_at DESC LIMIT 300", [+c.p.id])
  const um = await usersByIds(c, rows.map((r) => r.viewer_id))
  return json(rows.map((r) => ({ user: um.get(r.viewer_id), reaction: r.reaction, viewed_at: r.viewed_at })).filter((x) => x.user))
}
async function deleteStory(c: C) {
  await c.db.run("DELETE FROM stories WHERE id=? AND user_id=?", [+c.p.id, c.uid])
  await c.db.run("DELETE FROM story_views WHERE story_id=?", [+c.p.id])
  return json({ ok: true })
}

// ------------------------- 🔥 Trend lenta (internetdan jonli, UMUMAN saqlanmaydi) -------------------------
// O'zbekcha RSS manbalar (kun.uz, daryo, gazeta, BBC Uzbek, spot, nuz) — paralel agregat + tarjima.
// Kategoriyalar kalit-so'z bo'yicha; kirill/inliz sarlavhalar avtomatik o'zbekchaga tarjima qilinadi.
// Hech qanday DB yozuvi yo'q — so'rov to'g'ridan-to'g'ri internetdan olinadi. Manba nomi ko'rsatilmaydi.
const TREND_UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" }
// Ishonchli RSS manbalar (Cloudflare Worker'dan 200 qaytaradi; Google News DC IP'larga 503 beradi)
// spot.uz o'zbekcha (oz) versiyasi + nuz.uz qo'shildi — ko'proq har xil o'zbek kontenti
const TREND_FEEDS: Array<[string, string]> = [
  ["kun", "https://kun.uz/news/rss"],
  ["daryo", "https://daryo.uz/rss/"],
  ["gazeta", "https://www.gazeta.uz/oz/rss/"],
  ["bbc", "https://feeds.bbci.co.uk/uzbek/latin/rss.xml"],
  ["spot", "https://www.spot.uz/oz/rss/"],
  ["nuz", "https://nuz.uz/feed"],
]
// Kategoriyalash: kalit-so'zlar bo'yicha (manba ikkinchi darajali maslahatchi)
const CAT_RE: Record<string, RegExp> = {
  tech: /(texnologiya|sun['ʻ]iy intellekt|sun'iy intellekt|iphone|ipad|android|samsung|xiaomi|google|youtube|telegram|instagram|tiktok|ilova|dastur|kompyuter|noutbuk|robot|internet|kiber|gadget|chatgpt|openai|apple|smartfon|protsessor|videoo['ʻ]yin|kriptovalyut|bitcoin|elektron)/i,
  sport: /(futbol|futbolchi|jamoa|\bgol\b|o['ʻ]yinch[ii]|turnir|chempion|chempionat|kubok|\bliga\b|tennis|boks|shaxmat|olimpiada|sportchi|sport\b|darvozabon|mavsum|transfer|trener|\bmatch\b|musobaqa|\bcup\b|\bleague\b|fifa|uefa|governor|dzudo|kurash|bokschi|g['ʻ]alaba\s*qozondi)/i,
  salomatlik: /(so['ʻ]g['ʻ]liq|sog'liq|tibbiyot|virus|kasallik|vaksina|shifokor|dori|epidemiya|saraton|covid|infeksiya|psixolog|kaloriya|tibbiy)/i,
  fan: /(kosmos|\bnasa\b|tadqiqot|olim\b|ilmiy|kashfiyot|fizika|kimyo|biologiya|astronom|planet|yo['ʻ]ldosh|raketa|genetika|arxeolog)/i,
  shou: /(kino|film|multfilm|musiq|qo['ʻ]shiq|aktyor|aktrisa|serial|shou\b|premiya|koncert|yulduz\b|rejissyor|oskar|festival|grammy|estrada|chart)/i,
  biznes: /(iqtisod|dollar|yevro|so['ʻ]m\b|investitsiya|bank|bozor|narx\b|neft|biznes|eksport|import|soliq|tadbirkor|aksiya|kapital|byudjet|tarif|savdo|kontrakt| narxi|javobgarlik)/i,
}
const UZ_HINT = /(o['ʻ]zbekiston|uzbekiston|toshkent|mirziyoyev|samarqand|buxoro|andijon|namangan|farg['ʻ]ona|nukus|qarshi|jizzax|termiz|urganch|navoiy|kokand)/i
function classify(text: string, src: string): string {
  for (const k of ["tech", "sport", "salomatlik", "fan", "shou", "biznes"]) if (CAT_RE[k].test(text)) return k
  if (UZ_HINT.test(text)) return "uz"
  if (src === "spot") return "biznes"
  if (src === "bbc") return "world"
  return "uz"
}
const decodeEnt = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/&copy;|&#169;/gi, "©").replace(/&laquo;/gi, "«").replace(/&raquo;/gi, "»").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&ldquo;|&#8220;/g, "“").replace(/&rdquo;|&#8221;/g, "”").replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return "" } }).replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n) } catch { return "" } })
const stripHtml = (s: string) => decodeEnt(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim()
function tagGet(block: string, tag: string): string {
  const m = block.match(new RegExp("<" + tag + ">(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</" + tag + ">"))
  return m ? m[1].trim() : ""
}
// Qisqa deterministik id (djb2) — yangilik URL'dan barqaror id (kesh/kartalar uchun)
function hId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
async function gnewsFetch(src: string, url: string, n: number): Promise<any[]> {
  const UA = { headers: TREND_UA, cf: { cacheTtl: 900, cacheEverything: true } } as any
  try {
    let r = await fetch(url, UA)
    // Google parallel burst'ni cheklaydi — 1 marta kutib qayta urinish
    if (r.status === 429 || r.status === 503) {
      await new Promise((res) => setTimeout(res, 350))
      r = await fetch(url, UA)
    }
    if (!r.ok) { console.log("trend", src, "HTTP", r.status); return [] }
    const xml = await r.text()
    const out: any[] = []
    for (const block of xml.split("<item>").slice(1)) {
      if (out.length >= n) break
      const rawTitle = tagGet(block, "title")
      const link = tagGet(block, "link")
      if (!rawTitle || !link) continue
      const desc = tagGet(block, "description")
      const imgM = desc.match(/<img[^>]+src="(https:\/\/[^"]+)"/)
      const mcM = !imgM ? (block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"[^>]*medium="image"/) || block.match(/<media:thumbnail[^>]+url="(https:\/\/[^"]+)"/) || block.match(/<enclosure[^>]+url="(https:\/\/[^"]+)"/)) : null
      const pub = tagGet(block, "pubDate")
      const ts = pub ? Date.parse(pub) : NaN
      // Manba nomini yashirish: "Sarlavha - Manba nomi" -> "Sarlavha"
      const title = rawTitle.replace(/\s+[-–—]\s+[^-–—]{2,42}$/, "").trim() || rawTitle
      out.push({
        id: "n" + hId(link), kind: "news", src, title, url: link,
        snippet: stripHtml(desc).slice(0, 300),
        image: imgM ? imgM[1] : mcM ? mcM[1] : "",
        time: isNaN(ts) ? now() : ts,
      })
    }
    if (!out.length) console.log("trendempty", src, r.status, xml.length, xml.slice(0, 150).replace(/\s+/g, " "))
    return out
  } catch (e: any) { console.log("trenderr", src, String(e?.message || e).slice(0, 120)); return [] }
}
// KRITIK TUZATISH: eski UZ_MARK /​[oʻ‘’gʻʼ]/ belgilar to'plami har qanday "o"/"g" harfini moslab,
// deyarli BARCHA inglizcha sarlavhalarni "o'zbekcha" deb tasniflab yuborardi (tarjima o'tkazib yuborilardi).
const EN_STOP = /\b(the|and|of|in|for|with|to|on|at|from|by|after|before|over|into|about|new|how|why|what|who|top|best|first|vs|amid|says|said|will|would|can|could|should|may|might|must|as|is|are|was|were|be|been|has|have|had|his|her|its|their|this|that|these|those|more|most|than|not|but|or|if|when|while|during|against|out|up|down|off|back|just|now|day|days|year|years|world|us|uk|video|watch|live|report|reports|did|does|do|get|got|make|made|take|took|see|seen|show|showed|reveal|revealed|claim|claims|warn|warned|hit|killed|died|death|major|huge|big|police|man|woman|people|old|time|win|wins|lost|lose|beat|wins|open|opens|amid|here|there|still|again|der|die|das|und|ist|mit|von|auf|fur|für|im|den|dem|ein|eine|einen|nicht|sich|zur|zum|aus|werden|wurde|nach|bei|als|auch|zu|le|la|les|des|une|dans|sur|est|pour|avec|pas|plus|ce|cette|que|qui|el|los|las|por|con|para|del|como|pero|más|ile|için|daha|çok|cin|film|official|video|music|shorts|part)\b/i
const UZ_MARK = /[oO]['ʻʼ‘’][a-z]|\w+moq(da)?\b|\b(ning|bilan|uchun|yangi|haqida|bo‘yicha|yili|keldi|berdi|ayti|deya|qilmoq|birinchi|katta|yana|ham|va|bu|emas|qarshi|taxmin|xabar|tashrif|bayon|prezident|vazir|davlat|talab)\b/i
function needsTr(s: string): boolean {
  if (!s || s.length < 3) return false
  if (/[а-яёӯғҳ]/i.test(s)) return true // kirill matn — tarjima kerak
  if (UZ_MARK.test(s)) return false // oʻzbekcha belgilar bor
  return EN_STOP.test(s)
}
async function trToUz(s: string): Promise<string> {
  // DIQQAT: free plan 50 subrequest/invocation — retry YO'Q, kesh konvergatsiyani ta'minlaydi.
  // Zanjir: clients5 (tez, ishonchli) -> gtx (429 bloklari ko'p) — WF AI oxirgi zaxira
  try {
    const r2 = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=uz&q=" + encodeURIComponent(s.slice(0, 900)), { headers: TREND_UA })
    if (r2.ok) {
      const j2: any = await r2.json()
      const out2 = Array.isArray(j2) ? String(j2?.[0]?.[0] || "").trim() : String(j2?.sentences?.[0]?.trans || "").trim()
      if (out2 && out2 !== s) return out2
    }
  } catch {}
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=uz&dt=t&q=" + encodeURIComponent(s.slice(0, 900)), { headers: TREND_UA })
    if (r.ok) {
      const j: any = await r.json()
      const out = (j?.[0] || []).map((x: any[]) => String(x?.[0] || "")).join("").trim()
      if (out && out !== s) return out
    }
  } catch {}
  return s
}
// Kirill (o'zbek) -> lotin transliteratsiya: subrequest KERAK EMAS, 100% ishlaydi
const CYR_MAP: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", ғ: "g‘", д: "d", е: "e", ж: "j", з: "z", и: "i", й: "y", к: "k", қ: "q", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "o‘", ф: "f", х: "x", ҳ: "h", ц: "ts", ч: "ch", ш: "sh", ъ: "‘", ь: "", ы: "i", э: "e", ю: "yu", я: "ya", ё: "yo", щ: "sh" }
function cyrToLat(s: string): string {
  let out = ""
  for (const ch of s) {
    const lo = ch.toLowerCase()
    const m = CYR_MAP[lo]
    if (m === undefined) { out += ch; continue }
    if (ch !== lo && m) out += m.charAt(0).toUpperCase() + m.slice(1)
    else out += m
  }
  return out
}
const hasCyr = (s: string) => /[а-яёӯғҳ]/i.test(s)
// Workers AI tarjima (zaxira bosqich): binding — subrequest limitiga KIRMAYDI.
// DIQQAT: eski @cf/meta/m2m100_1.2B modeli Cloudflare tomonidan o'chirilgan — llama-3.1 ishlatiladi.
async function trAI(env: Env, s: string): Promise<string> {
  try {
    if (!env.AI) return s
    const r: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You are a translator. Translate the user's text to Uzbek (Latin script). Reply with ONLY the translation, nothing else." },
        { role: "user", content: s.slice(0, 350) },
      ],
      max_tokens: 300,
    })
    const t = String(r?.response || "").trim().replace(/^(?:['‘ʻ"]|tarjima:|translation:)\s*/i, "").trim()
    // Yordamchi o'zbekcha belgi tekshiruvi: javob matni o'zbekcha ko'rinsagina qabul qilinadi
    if (!t || t === s || t.length < 3) return s
    return t
  } catch { return s }
}
// Tarjima keshi: har matn 1 marta tarjima qilinadi, 6 soat edge-keshda turadi.
// Zanjir: gtx (bepul, ba'zan 429) -> Workers AI -> kirill bo'lsa lokal transliteratsiya.
async function trToUzCached(c: C, s: string): Promise<string> {
  if (!s) return s
  const h = (await sha256(s)).slice(0, 20)
  const ck = "https://trend.50gram.internal/tr1/" + h
  try {
    const hit = await caches.default.match(ck)
    if (hit) return await hit.text()
  } catch {}
  let out = await trToUz(s)
  if (out === s) out = await trAI(c.env, s)
  if ((out === s || hasCyr(out)) && hasCyr(s)) out = cyrToLat(s)
  if (out && out !== s) {
    const resp = new Response(out, { headers: { "cache-control": "public, s-maxage=21600" } })
    c.wait(caches.default.put(ck, resp).catch(() => {}))
  }
  return out
}
// --- O'ZBEK KONTENTI — 100% O'zbekiston ---
// 1) Sertifikatlangan o'zbek kanallari (YouTube kanal RSS — eng tez va ishonchli manba, ~300ms)
// 2) Piped/Invidious QIDIRUV: o'zbekcha so'rovlar (faqat 1..90s va UZ sarlavha) — yangi kontent
// Dailymotion va chet-el trending (US region) OLIB TASHLANDI — foydalanuvchi: "faqat o'zbekistondagi trendagilari".
// MUHIM: faqat Cloudflare'da TURMAYDIGAN instansalar (worker CF'li saytga to'g'ridan-to'g'ri ulanolmaydi).
const PIPED_APIS = ["https://api.piped.private.coffee", "https://pipedapi.adminforge.de"]
const INVID_APIS = ["https://invidious.nerdvpn.de"]
async function fT(url: string, ms: number, cacheTtl = 600): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers: TREND_UA, signal: AbortSignal.timeout(ms), cf: { cacheTtl, cacheEverything: true } } as any)
    return r.ok ? r : null
  } catch { return null }
}
// Sertifikatlangan o'zbek kanallari — haqiqiy qidiruv orqali topilgan va tekshirilgan (komik, hazil, dubljaz, vines)
// ANILAN KANALLARI OLIB TASHLANDI (2026-10, foydalanuvchi 5+ marta shikoyat qilgan): 3 ta Anilan
// kanal (Dublaj/UZ/DUBLAJ) 100% MINECRAFT o'yin videolari — sarlavhalarida ko'pincha "minecraft"
// yozilmaydi ("MEN BIR BLOK USTIDA 100 KUN OMON QOLDIM..."), shuning uchun sarlavha-filtri ularni
// USHLAY OLMAEDI. Yagona ishonchli yechim: kanal manbasini BATAMOM olib tashlash + BLOCK_VIDS.
const UZ_CHANNELS = [
  "UCd5_-70CbGPmmz2YusxX1zQ", // YANGI TV — komik sketchlar
  "UCZm8kCDX5sFagGux3qz5hRg", // Umidjon Murodullayev — qisqa hazillar
  "UCccjqZeIXuVeZyi9C5Bil4A", // 404 uz
  "UCHyWMPoLqTWteebdhjKoB4Q", // Uzbek vid
  "UCfKQvap5T1SKGBRgZKhyhXg", // MANGU_YT
  "UCuXexJqac0W-TUTab-Yqt8g", // ANYONE SHOW — qisqa hazillar
  "UCfjrghi9WYjRAd9B9zArkFQ", // Uzbek Vines
]
// MINECRAFT VIDEO-ID QATIY BLOK: Anilan kanallarining so'nggi videolari — eski hovuz/CDN/kyent
// keshlarida qolganlari ham qayta ko'rinishi MUMKIN EMAS (foydalanuvchi: "batamom o'chir").
const BLOCK_VIDS = new Set([
  "A0VSlf71MBg", "Jd-ve41f-aY", "iTdKFb675xM", "N1W5nsZKLaE", "TMHOBYLjUw8", // Anilan Dublaj UZ
  "xpnmQhCFceY", "l6pjLj-v0FE", "eiQb0DeZGSk", "qhmMzT-5OSQ", "G7aNRr0R-sk", // Anilan UZ
  "o4fAgHxlJAw", "by4wzlyfwUQ", "ThhEzyvVeZI", "Fa2ghDWxPBI", "xJ5gtl7UzBs", // Anilan DUBLAJ
])
// Kanal RSS: tez (~300ms/kanal, parallel), videoId+sarlavha+ko'rish soni+yuklangan vaqt bor
async function uzChannelShorts(): Promise<any[]> {
  const feeds = await Promise.all(UZ_CHANNELS.map(async (ch) => {
    const r = await fT("https://www.youtube.com/feeds/videos.xml?channel_id=" + ch, 6000, 300)
    if (!r) return []
    try {
      const xml = await r.text()
      const out: any[] = []
      for (const e of xml.split("<entry>").slice(1).slice(0, 5)) {
        const vid = tagGet(e, "yt:videoId")
        const title = tagGet(e, "title")
        const pub = tagGet(e, "published")
        const vm = e.match(/<media:statistics views="(\d+)"/)
        const views = vm ? +vm[1] : 0
        if (!vid || !title) continue
        out.push({
          id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz: 1, src: "ch", chid: ch,
          title, image: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
          views, duration: 0,
          time: pub ? (Date.parse(pub) || now()) : now(),
          url: "https://www.youtube.com/watch?v=" + vid, cat: "video",
        })
      }
      return out
    } catch { return [] }
  }))
  return feeds.flat()
}
const UZ_RE = /(o['ʻ‘ʼ]?zbek|uzbek|Ўзбек|Ӯзбек|узбек|Узбек|ткент|Тошкент|Ташкент|тошкент|ткент|samarqand|samarkand|Самарканд|buxoro|bukhara|Бухара|andijon|Андижон|namangan|Наманган|nukus|Нукус|termiz|Термез|qarshi|Карши|jizzax|Жиззах|navoiy|Навои|urganch|Урганч|qo['ʻ‘ʼ]qon|Коканд|kokand|farg['ʻ‘ʼ]ona|fergana|Фергана|xorazm|Хоразм|surxondaryo|sirdaryo|qashqadaryo|chilonzor|yunusobod|zbekiston|zbekiston|Ўзбекистон|Узбекистон|o'zbekcha|oʻzbekcha)/i

// ================= FOYDALANUVCHI MANBALARI (MAHFIY) =================
// Foydalanuvchining o'z YouTube kanali va Instagram akkauntidan kontent avtomatik
// olinadi va umumiy hovuzga ALGORITM bo'yicha aralashtiriladi. QAYSI PLATFORMADAN
// olingani klientga UMUMAN ko'rinmaydi (url/src/yuklab olish yo'q — manba SIR).
const listVar = (v?: string) => String(v || "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean).slice(0, 6)

// @handle -> UC kanal ID (1 so'rov: kanal sahifasidagi externalId)
async function ytChannelIdOf(handle: string): Promise<string> {
  if (/^UC[\w-]{22}$/.test(handle)) return handle
  const r = await fT("https://www.youtube.com/@" + encodeURIComponent(handle), 8000, 3600)
  if (!r) return ""
  try {
    const h = await r.text()
    const m = h.match(/"externalId":"(UC[\w-]{22})"/) || h.match(/channel\/(UC[\w-]{22})/)
    return m ? m[1] : ""
  } catch { return "" }
}
// Kanalning SHORTS tabi (1 so'rov): 41 tagacha shorts videoId + sarlavha. Uzun videolar KIRMAYDI.
// shortsLockupViewModel bloklari: entityId = shorts-shelf-item-{vid}, primaryText = toza sarlavha.
async function ytShortsOfChannel(ch: string): Promise<any[]> {
  const r = await fT("https://www.youtube.com/channel/" + ch + "/shorts", 9000, 1200)
  if (!r) return []
  try {
    const h = await r.text()
    const out: any[] = []
    const seen = new Set<string>()
    for (const chunk of h.split('"shortsLockupViewModel"').slice(1)) {
      const idM = chunk.match(/"shorts-shelf-item-([\w-]{11})"/)
      if (!idM || seen.has(idM[1])) continue
      seen.add(idM[1])
      const tM = chunk.match(/"primaryText":\{"content":"(.*?)"/)
      const title = (tM ? tM[1] : "").replace(/\\u([\dA-Fa-f]{4})/g, (_, x) => { try { return String.fromCharCode(parseInt(x, 16)) } catch { return "" } }).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, " ").trim()
      const vid = idM[1]
      // mine:1 — FOYDALANUVCHI kanali belgisi: klient lentaSning BOSHIGA chiqaradi
      // (manba nomi baribir SIR — sanitizer src/chid/url'ni o'chiradi, mine bayrog'i qoladi)
      out.push({
        id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz: 1, src: "", chid: ch, mine: 1,
        title: title.slice(0, 140), image: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
        views: 0, duration: 0, time: now(), url: "", cat: "video",
      })
      if (out.length >= 24) break
    }
    return out
  } catch { return [] }
}
// Foydalanuvchi kanallari: @handle UC'ga aylantiriladi, shorts tabi o'qiladi
async function ytMine(env: Env): Promise<any[]> {
  const ids = listVar(env.MY_YT)
  if (!ids.length) return []
  const chans = await Promise.all(ids.map((h) => ytChannelIdOf(h).catch(() => "")))
  const uniq = [...new Set(chans.filter(Boolean))]
  if (!uniq.length) return []
  const lists = await Promise.all(uniq.map((c) => ytShortsOfChannel(c).catch(() => [] as any[])))
  return lists.flat()
}
// Instagram: datacenter-IP'larga IG cheklov qilishi mumkin — 3 bosqichli zanjir, muvaffaqiyatsizlik jim o'tadi
const IG_HEADERS: Record<string, string> = { "x-ig-app-id": "936619743392459", accept: "application/json" }
async function igWebProfile(env: Env, user: string): Promise<any[]> {
  const sess = String(env.MY_IG_COOKIE || "").trim()
  const hosts = [
    { u: "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(user), h: { ...IG_HEADERS, ...TREND_UA, ...(sess ? { cookie: "sessionid=" + sess } : {}) } },
    { u: "https://i.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(user), h: { ...IG_HEADERS, "user-agent": "Instagram 219.0.0.12.117 Android", ...(sess ? { cookie: "sessionid=" + sess } : {}) } },
  ]
  for (const { u, h } of hosts) {
    const r = await fT2(u, h, 8000, 1800)
    if (!r) continue
    try {
      const j: any = await r.json()
      const edges = j?.data?.user?.edge_owner_to_timeline_media?.edges || []
      const out: any[] = []
      for (const e of edges) {
        const n = e?.node || {}
        const code = String(n.shortcode || "")
        if (!code) continue
        const cap = stripHtml(String(n.edge_media_to_caption?.edges?.[0]?.node?.text || ""))
        const child = n.edge_sidecar_to_children?.edges?.[0]?.node || n
        const vurl = String(child.video_url || n.video_url || "")
        const iurl = String(child.display_url || n.display_url || n.thumbnail_src || "")
        const media = vurl || iurl
        if (!media) continue
        out.push({
          id: "ig" + code, kind: "short", vid: vurl ? "mp4" : "img", mp4: vurl || undefined, img: vurl ? undefined : iurl,
          uz: 1, src: "", mine: 1, title: cap.slice(0, 140),
          image: iurl, views: 0, duration: 0,
          time: +n.taken_at_timestamp > 0 ? +n.taken_at_timestamp * 1000 : now(),
          url: "", cat: "video",
        })
        if (out.length >= 12) break
      }
      if (out.length) return out
    } catch {}
  }
  return []
}
// Zaxira: ochiq RSSHUB nusxalari (ba'zan ishlaydi) — media:content/enclosure URL'lari
async function igRsshub(user: string): Promise<any[]> {
  for (const base of ["https://rsshub.rssforever.com", "https://rsshub.app"]) {
    const r = await fT(base + "/instagram/user/" + encodeURIComponent(user), 8000, 1800)
    if (!r) continue
    try {
      const xml = await r.text()
      const out: any[] = []
      for (const block of xml.split("<item>").slice(1)) {
        const link = tagGet(block, "link")
        const code = (link.match(/\/(p|reel|reels)\/([\w-]+)/) || [])[2] || ""
        const title = stripHtml(tagGet(block, "title")).slice(0, 140)
        if (!code) continue
        const mm = block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"[^>]*medium="video"/) || block.match(/<media:content[^>]+url="(https:\/\/[^"]+)"/) || block.match(/<enclosure[^>]+url="(https:\/\/[^"]+)"/)
        if (!mm) continue
        const isVid = /medium="video"|\.(mp4|mov)/i.test(mm[0])
        out.push({
          id: "ig" + code, kind: "short", vid: isVid ? "mp4" : "img", mp4: isVid ? mm[1] : undefined, img: isVid ? undefined : mm[1],
          uz: 1, src: "", mine: 1, title,
          image: isVid ? "" : mm[1], views: 0, duration: 0, time: now(), url: "", cat: "video",
        })
        if (out.length >= 12) break
      }
      if (out.length) return out
    } catch {}
  }
  return []
}
async function igMine(env: Env): Promise<any[]> {
  const users = listVar(env.MY_IG)
  if (!users.length) return []
  const lists = await Promise.all(users.map(async (u) => {
    const a = await igWebProfile(env, u).catch(() => [] as any[])
    if (a.length) return a
    return igRsshub(u).catch(() => [] as any[])
  }))
  return lists.flat()
}
// FOYDALANUVCHI HOVUZI: YT + IG — 30 daqiqa edge-kesh (IG CDN havolalari yangi qoladi)
async function minePool(env: Env): Promise<any[]> {
  if (!listVar(env.MY_YT).length && !listVar(env.MY_IG).length) return []
  // minev2: foydalanuvchining o'z kanali ulandi (YANGI TV olib tashlandi) — eski kesh bekor
  const ck = "https://trend.50gram.internal/minev2"
  const meta = await cacheGetJSON<any[]>(ck)
  if (meta && meta.data?.length) return meta.data
  const [yt, ig] = await Promise.all([ytMine(env).catch(() => [] as any[]), igMine(env).catch(() => [] as any[])])
  const seen = new Set<string>()
  const out = [...yt, ...ig].filter((v) => v && !seen.has(v.id) && seen.add(v.id))
  if (out.length) {
    // ALGORITM: YT va IG navbatma-navbat aralashtiriladi (bitta platforma hukmronlik qilmasin)
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[out[i], out[j]] = [out[j], out[i]] }
    cWaitPut(ck, { t: now(), data: out })
  }
  return out
}
// kichik yordamchi: keshga yozish (await qilinmaydi)
function cWaitPut(ck: string, obj: unknown): void {
  cachePutJSON(ck, obj).catch(() => {})
}
async function fT2(url: string, headers: Record<string, string>, ms: number, cacheTtl = 600): Promise<Response | null> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), cf: { cacheTtl, cacheEverything: true } } as any)
    return r.ok ? r : null
  } catch { return null }
}
async function youtubeTrending(): Promise<any[]> {
  // Chet-el trending OLINGAN (foydalanuvchi: faqat o'zbek kontenti) — faqat UZ qidiruvi va kanallar qoladi.
  return []
}
// --- O'ZBEK SHORTS: Piped/Invidious QIDIRUV — faqat o'zbekcha (1..90s VA sarlavha UZ) ---
// Chet-el kontenti QATIY filtrlanadi: UZ_RE mos kelmasa — umuman qo'shilmaydi.
const UZ_QUERIES = ["o‘zbekiston shorts", "o‘zbekcha shorts", "o‘zbek komik shorts", "toshkent shorts", "o‘zbekcha hazil", "qiziqarli o‘zbekcha video", "o‘zbek prank", "o‘zbekcha dubljaz", "o‘zbekcha qo‘shiq", "o‘zbekcha to‘y", "o‘zbek futbol", "o‘zbek raqs", "o‘zbekcha multfilm", "o‘zbek kino", "samarqand", "buxoro", "o‘zbek taom", "o‘zbekcha clip"]
async function uzSearch(): Promise<any[]> {
  const one = async (base: string, q: string): Promise<any[]> => {
    const r = await fT(base + "/search?q=" + encodeURIComponent(q) + "&filter=videos", 9000)
    if (!r) return []
    try {
      const j: any = await r.json()
      return ((j.items || []) as any[]).map((v: any) => {
        const id = String(v.url || "").split("v=")[1]
        const dur = +v.duration || 0
        if (!id || dur < 1 || dur > 90) return null // FAQAT haqiqiy Shorts uzunligi — uzun video va jonli efir yo'q
        const title = String(v.title || "")
        // UPLOADER-FILTR: sarlavhasida "minecraft" yozilmagan Minecraft/o'yin kanallari ham
        // kanal nomi bo'yicha kesiladi (Anilan uslubi — foydalanuvchi "batamom o'chir" dedi)
        if (/minecraft|minekraf|maynkraft|anilan|минекрафт|майнкрафт/i.test(String((v as any).uploaderName || ""))) return null
        if (!UZ_RE.test(title)) return null // QATIY: faqat o'zbekcha sarlavhali videolar
        return {
          id: "yt" + id.split("&")[0], kind: "short", vid: "yt", yt: id.split("&")[0], uz: 2, src: "s", // 2: UZ_RE qATIY filtr'dan o'tgan — to'liq o'zbekcha
          title, image: String(v.thumbnail || "https://i.ytimg.com/vi/" + id.split("&")[0] + "/hqdefault.jpg"), // bo'sh thumbnail — hqdefault zaxira (qora qopqoq bo'lmasin)
          views: +v.views || 0, duration: dur,
          time: +v.uploaded > 0 ? +v.uploaded : now(),
          url: "https://www.youtube.com/watch?v=" + id.split("&")[0], cat: "video",
        }
      }).filter((v: any) => v && v.title)
    } catch { return [] }
  }
  const out: any[] = []
  const seen = new Set<string>()
  // HAR BUILD'DA TASODIFIY 7 ta so'rov: hovuz har yangilanishida boshqa mavzular chiqadi
  // (bir xillik yo'q) + subrequest limiti (50) doim xavfsiz qoladi
  const qs = UZ_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 7)
  const res = await Promise.allSettled([
    ...PIPED_APIS.flatMap((b) => qs.map((q) => one(b, q))),
    ...INVID_APIS.map((b) => oneInvid(b)),
  ])
  for (const r of res) {
    if (r.status !== "fulfilled") continue
    for (const v of r.value) { if (v && !seen.has(v.yt)) { seen.add(v.yt); out.push(v) } }
  }
  return out
}
// Invidious qidiruv zaxira manbasi (formati boshqa: videoId/lengthSeconds/viewCount)
async function oneInvid(base: string): Promise<any[]> {
  const q = UZ_QUERIES[Math.floor(Math.random() * UZ_QUERIES.length)]
  const r = await fT(base + "/api/v1/search?q=" + encodeURIComponent(q) + "&type=video", 8000)
  if (!r) return []
  try {
    const j: any = await r.json()
    return (Array.isArray(j) ? j : []).map((v: any) => {
      const dur = +v.lengthSeconds || 0
      const title = String(v.title || "")
      // UPLOADER-FILTR (Piped bilan bir xil): Minecraft-kanallar nomi bo'yicha ham kesiladi
      if (/minecraft|minekraf|maynkraft|anilan|минекрафт|майнкрафт/i.test(String(v.author || ""))) return null
      if (!v.videoId || dur < 1 || dur > 90 || !UZ_RE.test(title)) return null
      return {
        id: "yt" + String(v.videoId), kind: "short", vid: "yt", yt: String(v.videoId), uz: 2, src: "s", // 2: UZ_RE qATIY filtr'dan o'tgan
        title, image: String(v.videoThumbnails?.[0]?.url || "https://i.ytimg.com/vi/" + String(v.videoId) + "/hqdefault.jpg"),
        views: +v.viewCount || 0, duration: dur,
        time: +v.published > 0 ? +v.published * 1000 : now(),
        url: "https://www.youtube.com/watch?v=" + v.videoId, cat: "video",
      }
    }).filter((v: any) => v && v.title)
  } catch { return [] }
}
// Reddit (403: serverdan bloklangan) va TikTok (O'zbekistonda VPN'siz ishlamaydi) manbalari olib tashlandi.

// ================= YOUTUBE GLOBAL TREND SHORTS (foydalanuvchi talabi) =================
// DAILYMOTION OLIB TASHLANDI (2026-10-04): DM videolar O'zbekistonda ochilmaydi/geo-bloklangan
// — klientda DM/IG/FB embedlarning ijro-kuzatuvi YO'Q (postMessage handshake yo'q), qopqoq 1.2s'da
// ketardi va video o'ynamasa slayd BITTAQ QORA turib qolardi (skrinshot: "How to Make Perfect
// Toffee Apples, 24 · 0:38" — DM topic-qidiruvidan inglizcha video). DM = qora ekran + ingliz
// kontent — hovuzdan BATAMOM chiqarildi.
// "youtubeda millionlab shorts videolar bor — trenddagi millionlab shortslarni 50gram
// dasturga reels bo'limiga olib ko'rsatadigan qilib ishla" — YouTube TREND (FEshorts)
// lentasi OCHIQ jamoaviy kontent: akkaunt, parol yoki API-kalit KERAK EMAS.
// 2 qatlam: ① YouTube qidiruv-shorts filtr (EgIYAQ== — viral shortslar)  ② HTML shelf
// zaxirasi. YouTube akkaunt/parol/API-kalit KERAK EMAS (ochiq jamoaviy kontent).
// O'yin/jangovar kontent + Minecraft QATIY chiqariladi (foydalanuvchi: "batamom o'chir")
const GAME_RE = /minecraft|minekraf|maynkraft|минекрафт|майнкрафт|gameplay|game\s?play|gta\s?[1-6]|gta\s?online|pubg|roblox|brawl\s?stars|free\s?fire|fortnite|dota\s?2|counter\s?strike|csgo|cs2|fifa\s?\d|ea\s?fc|clash\s?(of\s?clans|royale)|among\s?us|genshin|o['ʻ‘ʼ]?yin(?!choq)|oyun\s?oyn|o['ʻ‘ʼ]?yinlash/i
function ytCount(s: string): number {
  if (!s) return 0
  const m = s.match(/([\d.,]+)\s*([KkMmBb]|mln|mlrd|ming)/)
  if (!m) { const n = parseInt(s.replace(/[^\d]/g, ""), 10); return isNaN(n) ? 0 : n }
  let n = parseFloat(m[1].replace(/,/g, ""))
  const sfx = m[2].toLowerCase()
  if (sfx === "mlrd" || sfx === "b") n *= 1e9
  else if (sfx === "mln" || sfx === "m") n *= 1e6
  else if (sfx === "ming" || sfx === "k") n *= 1e3
  return Math.round(n)
}
function ytTrendItem(id: string, title: string, views: number, img: string, uz = 0): any {
  const vid = String(id).slice(0, 11)
  return {
    id: "yt" + vid, kind: "short", vid: "yt", yt: vid, uz, src: "tr",
    title: String(title).slice(0, 140), image: img || "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
    views, duration: 0, time: now(),
    url: "https://www.youtube.com/watch?v=" + vid, cat: "video",
  }
}
// ① ASOSIY: YouTube QIDIRUV + SHORTS FILTR (innertube, params=EgIYAQ==) — "trenddagi
// millionlab shortslar" manbasi: qidiruv natijalari MILLIONLAB ko'rishli viral shortslar.
// O'ZBEKISTON BIRINCHI (foydalanuvchi talabi: "ko'proq o'zbekistondagi trendlar, o'zbeklarning
// shortslarini ko'rsatadigan qil"): har hovuz qurilishida tasodifiy 5 ta O'ZBEK mavzu
// (gl=UZ, hl=uz — YouTube o'zbekistonlik yaratuvchilarni ko'rsatadi) + 1 ta global mavzu
// (kichik ulush — xilma-xillik uchun). Akkaunt/parol/API-kalit KERAK EMAS (ochiq jamoaviy manba).
const YT_PUBKEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8" // youtube.com sahifasidagi OCHIQ kalit (maxfiy emas)
const UZ_TREND_QUERIES = [
  "o‘zbekcha shorts", "o‘zbek shorts", "o‘zbekiston shorts", "toshkent shorts", "o‘zbek komediya shorts",
  "o‘zbek qo‘shiq shorts", "o‘zbek raqs shorts", "o‘zbekcha hazil", "o‘zbek to‘y", "o‘zbek futbol shorts",
  "o‘zbekcha dubljaz", "samarqand shorts", "buxoro shorts", "o‘zbek taomlari shorts", "o‘zbekcha multfilm",
  "o‘zbek milliy", "navoiy", "o‘zbek kino shorts", "andijon shorts", "farg‘ona shorts",
]
const GLOBAL_QUERIES = ["funny shorts", "viral shorts", "satisfying shorts", "music shorts", "animals shorts", "food shorts"]
// Daraxt bo'ylab barcha shortsLockupViewModel yig'uvchi (layout o'zgarsa ham ishlaydi)
function collectShorts(o: any, out: any[]) {
  if (!o || typeof o !== "object") return
  if (Array.isArray(o)) { for (const v of o) collectShorts(v, out); return }
  const lock = o.shortsLockupViewModel
  if (lock) {
    const id = ((((lock.onTap || {}).innertubeCommand || {}).reelWatchEndpoint || {}).videoId) || ""
    const om = lock.overlayMetadata || {}
    const title = (om.primaryText || {}).content || ""
    const views = ytCount((om.secondaryText || {}).content || "")
    if (id && title && !out.some((x: any) => x.yt === id)) out.push(ytTrendItem(id, title, views, ""))
  }
  for (const k of Object.keys(o)) collectShorts(o[k], out)
}
async function ytSearchShorts(): Promise<any[]> {
  const uzQ = UZ_TREND_QUERIES.slice().sort(() => Math.random() - 0.5).slice(0, 5)
  const gq = GLOBAL_QUERIES[Math.floor(Math.random() * GLOBAL_QUERIES.length)]
  const jobs = [...uzQ.map((q) => ({ q, uz: 1 })), { q: gq, uz: 0 }]
  const res = await Promise.allSettled(jobs.map(async (job) => {
    const r = await fetch("https://www.youtube.com/youtubei/v1/search?key=" + YT_PUBKEY + "&prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": TREND_UA["user-agent"],
        "x-origin": "https://www.youtube.com",
        "x-youtube-client-name": "1",
        "x-youtube-client-version": "2.20241126.01.00",
        "accept-language": job.uz ? "uz,ru" : "en",
      },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: "2.20241126.01.00", hl: job.uz ? "uz" : "en", gl: job.uz ? "UZ" : "US" } }, query: job.q, params: "EgIYAQ==" }),
      signal: AbortSignal.timeout(9000),
      cf: { cacheTtl: 1800, cacheEverything: true },
    } as any)
    if (!r.ok) { console.log("ytsearch", r.status); return [] }
    const j: any = await r.json()
    const out: any[] = []
    collectShorts(j, out)
    for (const v of out) v.uz = job.uz ? (UZ_RE.test(String(v.title || "")) ? 2 : 1) : 0 // 2=QATIY o'zbekcha sarlavha (hovuz interleave 1-daraja)
    return out
  }))
  const out: any[] = []
  for (const r of res) { if (r.status === "fulfilled") for (const v of r.value) out.push(v) }
  return out
}
// ② youtube.com/shorts HTML shelf-parser — zaxira (ba'zi holatlarda ishlaydi)
async function ytShortsShelf(): Promise<any[]> {
  const r = await fT("https://www.youtube.com/shorts", 9000, 900)
  if (!r) return []
  try {
    const h = await r.text()
    const out: any[] = []
    const seen = new Set<string>()
    for (const chunk of h.split('"shortsLockupViewModel"').slice(1)) {
      const idM = chunk.match(/"shorts-shelf-item-([\w-]{11})"/) || chunk.match(/reelsWatchEndpoint.{0,40}videoId\\?":\\?"([\w-]{11})/)
      if (!idM || seen.has(idM[1])) continue
      seen.add(idM[1])
      const tM = chunk.match(/"primaryText":\{"content":"(.*?)"/)
      const title = (tM ? tM[1] : "").replace(/\\u([\dA-Fa-f]{4})/g, (_, x) => { try { return String.fromCharCode(parseInt(x, 16)) } catch { return "" } }).replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, " ").trim()
      if (!title) continue
      const vM = chunk.match(/"secondaryText":\{"content":"(.*?)"/)
      out.push(ytTrendItem(idM[1], title, ytCount(vM ? vM[1] : ""), ""))
      if (out.length >= 48) break
    }
    return out
  } catch { return [] }
}
// ASOSIY: YouTube TREND Shorts — qidiruv-shorts filtr (millionlab ko'rishli viral shortslar)
// + HTML shelf zaxirasi. Piped/Invidious TRENDING olib tashlandi (tekshirildi: 0 ta short
// qaytaradi — faqat jonli efir/uzun videolar). Ikkalasi bo'sh bo'lsa hovuz qolgan manbalar bilan.
async function ytGlobalTrend(): Promise<any[]> {
  const [search, shelf] = await Promise.all([ytSearchShorts(), ytShortsShelf()])
  const seen = new Set<string>()
  return [...search, ...shelf].filter((v: any) => v && v.yt && !BLOCK_VIDS.has(v.yt) && !GAME_RE.test(String(v.title || "")) && !seen.has(v.yt) && seen.add(v.yt))
}
// --- Yagona video hovuzi: stale-while-revalidate — eski hovuz DARHOL qaytadi, yangilash fonda ketadi.
// Bu foydalanuvchining asosiy shikoyati ("lenta juda sekin ochmoqda") uchun asosiy yechim:
// upstream sekin/o'lik bo'lsa ham foydalanuvchi DOIM keshlangan kontentni zudlik bilan oladi.
const POOL_FRESH_MS = 20 * 60 * 1000
async function cacheGetJSON<T>(ck: string): Promise<{ t: number; data: T } | null> {
  try { const hit = await caches.default.match(ck); if (hit) return await hit.json() } catch {}
  return null
}
async function cachePutJSON(ck: string, obj: unknown): Promise<void> {
  try {
    const r = json(obj)
    r.headers.set("cache-control", "public, s-maxage=1200")
    await caches.default.put(ck, r)
  } catch {}
}
// Dailymotion — yana bir platforma (foydalanuvchi: "insta va boshqa platformalardan ham").
// API'siz ochiq (key yo'q), sort=trending, embed player'ilova tomonda allaqachon qo'llanadi.
// HAR XIL MAVZULAR: umumiy trending (ko'pincha bir xil o'yin kontenti chiqaradi) bilan birga
// har safar TASODIFIY 6 ta mavzu bo'yicha qidiruv — hovuz har yangilanishida boshqa mavzular
// (musiqa, oshpazlik, futbol, tabiat...) — "faqat bir turdagi videolar" muammosining yechimi.
const DM_TOPICS = ["music", "dance", "cooking", "football", "animals", "nature", "travel", "cars", "comedy", "science", "art", "fitness", "magic", "fishing", "camping", "cats", "dogs", "satisfying", "adventure", "food", "basketball", "surfing", "parkour", "drone", "timelapse", "wildlife", "space", "ocean"]
function dmPick(): Promise<any[]> {
  const topics = DM_TOPICS.slice().sort(() => Math.random() - 0.5).slice(0, 6)
  return Promise.all(topics.map(async (t) => {
    const r = await fT("https://api.dailymotion.com/videos?fields=id,title,duration,views_total,thumbnail_360_url,created_time&search=" + encodeURIComponent(t) + "&sort=trending&limit=14&shorter_than=5", 7000, 900)
    if (!r) return []
    try {
      const j: any = await r.json()
      return ((j.list || []) as any[]).map((v: any) => {
        const dur = +v.duration || 0
        if (!v.id || !v.title || dur < 3 || dur > 180) return null
        return {
          id: "dm" + String(v.id), kind: "short", vid: "dm", embed: String(v.id), uz: 0, src: "dm:" + t,
          title: String(v.title), image: String(v.thumbnail_360_url || ""),
          views: +v.views_total || 0, duration: dur,
          time: +v.created_time > 0 ? +v.created_time * 1000 : now(),
          url: "https://www.dailymotion.com/video/" + v.id, cat: "video",
        }
      }).filter(Boolean)
    } catch { return [] }
  })).then((a) => a.flat())
}
async function dmTrending(): Promise<any[]> {
  const [gen, topics] = await Promise.all([dmTrendingGeneral(), dmPick()])
  const seen = new Set<string>()
  const out: any[] = []
  for (const v of [...topics, ...gen]) { if (v && v.embed && !seen.has(v.embed)) { seen.add(v.embed); out.push(v) } } // mavzular birinchi — xilma-xillik kafolatlangan
  return out
}
async function dmTrendingGeneral(): Promise<any[]> {
  const r = await fT("https://api.dailymotion.com/videos?fields=id,title,duration,views_total,thumbnail_360_url,created_time&sort=trending&limit=24&shorter_than=5", 7000, 900)
  if (!r) return []
  try {
    const j: any = await r.json()
    return ((j.list || []) as any[]).map((v: any) => {
      const dur = +v.duration || 0
      if (!v.id || !v.title || dur < 3 || dur > 180) return null
      return {
        id: "dm" + String(v.id), kind: "short", vid: "dm", embed: String(v.id), uz: 0, src: "dm",
        title: String(v.title), image: String(v.thumbnail_360_url || ""),
        views: +v.views_total || 0, duration: dur,
        time: +v.created_time > 0 ? +v.created_time * 1000 : now(),
        url: "https://www.dailymotion.com/video/" + v.id, cat: "video",
      }
    }).filter(Boolean)
  } catch { return [] }
}
// Mixkit OLIB TASHLANDI (2026-10): stock videolar OVOZSIZ chiqardi — foydalanuvchi shikoyati
// ("mushuk ovozi yo'q reels videolarni juda ko'p ko'rsatmoqda"). Ovozsiz kontent hovuzga kirmasin.
async function buildVideoPool(env: Env): Promise<{ shorts: any[]; vids: any[] }> {
  // KO'P PLATFORMALI AQILLI HOVUZ (foydalanuvchi: "juda ko'p joylardan olish, faqat youtube emas"):
  // ① YOUTUBE GLOBAL TREND SHORTS (foydalanuvchi talabi: "trenddagi millionlab shortslarni
  //    reels bo'limiga olib ko'rsat" — hovuzning ASOSIY manbasi endi shu)
  // ② FOYDALANUVCHI MANBALARI (mahfiy: o'z YT shorts + IG reels/rasmlari — algoritm bilan kuchli ko'rinadi)
  // ③ YouTube kanallar (round-robin) ④ YouTube qidiruv ⑤ Dailymotion (tasodifiy mavzular)
  // Mixkit OLIB TASHLANDI: stock videolar OVOZSIZ — foydalanuvchi "mushuk ovozi yo'q reels juda ko'p" dedi.
  // Har qadamda BOSHQA platformadan — platforma round-robin, hech biri hukmronlik qilmaydi.
  const [tr0, chan0, uz0, mine] = await Promise.all([ytGlobalTrend(), uzChannelShorts(), uzSearch(), minePool(env)]) // DM olib tashlandi (qora ekran — yuqoridagi izohga qarang)
  // MINECRAFT QATIY FILTR (foydalanuvchi: "tagi bilan o'chirib yo'q qilib tashla"): Minecraft/
  // Maynkraft/Майнкрафт videolari hovuzga UMUMAN kirmasin — Anilan-dublaj kanallari yangi
  // videolari asosan Minecraft bo'lgani uchun sarlavha bo'yicha qat'iy kesiladi (latin+kirill).
  const BAD_RE = /minecraft|minekraf|maynkraft|минекрафт|майнкрафт/i
  // Sarlavha-filtri + VIDEO-ID blok: sarlavhasida "minecraft" yozilmagan o'yin videolari ham
  // (Anilan dublaj uslubi) ID bo'yicha kesiladi — foydalanuvchi "batamom o'chir" dedi.
  const noBad = (arr: any[]) => (arr || []).filter((v: any) => v && !BAD_RE.test(String(v.title || "")) && !BLOCK_VIDS.has(String(v.yt || "")) && !GAME_RE.test(String(v.title || "")))
  const tr = noBad(tr0), chan = noBad(chan0), uz = noBad(uz0)
  // Foydalanuvchi manbalari: yaroqli vidyo (yt/mp4) va rasmlar (img) — dedupe, BOMBA-reklama yo'q
  const mm: any[] = []
  const mseen = new Set<string>()
  for (const v of mine || []) { const k = String(v?.id || ""); if (k && (v.yt || v.mp4 || v.img) && !mseen.has(k)) { mseen.add(k); mm.push(v) } }
  const seen = new Set<string>()
  const chRaw = chan.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt))
  // KANALLAR ROUND-ROBIN + kanal bo'yicha cheklov (3): bir kanal (masalan Minecraft-dublaj
  // kanallari) hovuzni bosib olmasligi kerak — aks holda foydalanuvchiga DOIM bir turdagi
  // video chiqadi ("faqat minecraft" shikoyati). Har qadamda BOSHQA kanal video qo'shiladi.
  const byCh = new Map<string, any[]>()
  for (const v of chRaw) { const k = String(v.chid || "?"); if (!byCh.has(k)) byCh.set(k, []); byCh.get(k)!.push(v) }
  for (const [k, arr] of byCh) byCh.set(k, arr.sort((a: any, b: any) => (b.time || 0) - (a.time || 0)))
  const ch: any[] = []
  const curs = new Map([...byCh.keys()].map((k) => [k, 0] as [string, number]))
  const perCh = new Map([...byCh.keys()].map((k) => [k, 0] as [string, number]))
  while (true) {
    let added = false
    for (const k of byCh.keys()) {
      const arr = byCh.get(k)!, i = curs.get(k)!
      if (i >= arr.length || perCh.get(k)! >= 2) continue // 2: bir kanal ko'p joy olmasin (Minecraft-dublaj kanallari)
      ch.push(arr[i]); curs.set(k, i + 1); perCh.set(k, perCh.get(k)! + 1); added = true
    }
    if (!added) break
  }
  // QOLGAN trend itemlar kanal/qidiruv dedupesidan KEYIN (hovuzni to'ldiradi)
  const tr2 = tr.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt))
  const se = uz.filter((v: any) => v && v.yt && !seen.has(v.yt) && seen.add(v.yt)).sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
  // Mine itemlar umumiy hovuz bilan ham kesishadi (foydalanuvchi kanali RSS'da ham bo'lsa — takror slot yo'q)
  const mmo = mm.filter((v: any) => !v.yt || !seen.has(v.yt))
  // O'ZBEKISTON-BIRINCHI INTERLEAVE (foydalanuvchi talabi: "ko'proq o'zbekistondagi trendlar,
  // o'zbeklarning shortslarini ko'rsatadigan qil"): UZ kontenti FAQAT hovuz boshida emas — BUTUN
  // hovuz bo'ylab ~3:1 nisbatda aralashtiriladi. NO-REPEAT rb-bucket hovuzning istalgan chuqur
  // qismini olibdi (rb*37 offseti 1073 gacha) — AVVAL chuqur oynalar TO'LIQ inglizcha chiqardi
  // ("2 ta video ko'rsatib 3-chisi inglizcha/qora" shikoyati shu tufayli edi). Endi istalgan
  // 12-lik oynada ~75% o'zbek kontenti bor.
  // uz=2 (QATIY o'zbekcha sarlavha) → uzA; uz=1 (UZ qidiruvidan, sarlavha chetkiy bo'lishi mumkin) → uzB; uz=0 → global.
  const uzA: any[] = [], uzB: any[] = [], glT: any[] = []
  for (const v of tr2) { const u = v.uz || 0; if (u === 2) uzA.push(v); else if (u === 1) uzB.push(v); else glT.push(v) }
  const mkCur = (arr: any[]) => { let i = 0; return (): any => (i < arr.length ? arr[i++] : null) }
  const cA = mkCur(uzA), cB = mkCur(uzB), cG = mkCur(glT), cM = mkCur(mmo), cC = mkCur(ch), cS = mkCur(se)
  // UZ manbalar tugasa — global zaxira (lenta hech qachon to'xtamasin)
  const uzNext = (): any => cA() || cB() || cG()
  const shorts: any[] = []
  while (shorts.length < 240) {
    let added = 0
    // 1 tsikl = 8 slayd: uzTrend + uzQidiruv + kanal + foydalanuvchi + uzTrend + foydalanuvchi + global + global
    // → 4-6 o'zbek-mansabli + 2 global (foydalanuvchi manbalari ham o'zbek kanali — amalda ~75% UZ)
    for (const src of [uzNext, cS, cC, cM, uzNext, cM, cG, cG]) { const v = src(); if (v) { shorts.push(v); added++ } }
    if (!added) break
  }
  return { shorts: shorts.slice(0, 240), vids: [] }
}
async function videoPool(c: C): Promise<{ shorts: any[]; vids: any[] }> {
  // v18: trend manba = qidiruv-shorts filtr (haqiqiy viral shortslar) — eski hovuz bekor —
  // eski hovuz (v16, trendsiz) BATAMOM bekor, yangi kesh kaliti
  // v19: O'ZBEKISTON-BIRINCHI hovuz (o'zbek qidiruv gl=UZ + uz-first sort) — eski (inglizcha-og'ir) hovuz bekor
  // v20: DM OLIB TASHLANDI (O'zbekistonda qora ekran) + UZ-interleave BUTUN hovuz bo'ylab (~75% o'zbek kontenti
  // istalgan oynada) + uz=2 qat'iy o'zbekcha-belgi — eski (DM'li/orqada-uz) hovuz BATAMOM bekor
  const ck = "https://trend.50gram.internal/poolv20"
  const meta = await cacheGetJSON<{ shorts: any[]; vids: any[] }>(ck)
  if (meta && meta.data && meta.data.shorts?.length) {
    if (now() - meta.t < POOL_FRESH_MS) return meta.data
    c.wait(buildVideoPool(c.env).then((d) => { if (d.shorts.length) return cachePutJSON(ck, { t: now(), data: d }) }).catch(() => {}))
    return meta.data
  }
  const d = await buildVideoPool(c.env)
  if (d.shorts.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
async function newsPool(c: C): Promise<any[]> {
  // Barcha manbalar PARALLEL yuklanadi + stale-while-revalidate: eski pool DARHOL qaytadi (sovuq sahifa ham tez)
  // ARXIV: yangilashda avvalgi generatsiya poolN4old'ga ko'chiriladi — maqola o'qishda eski id'lar ham topiladi
  const ck = "https://trend.50gram.internal/poolN4"
  const meta = await cacheGetJSON<any[]>(ck)
  if (meta && meta.data?.length) {
    if (now() - meta.t < 15 * 60 * 1000) return meta.data
    c.wait(Promise.all([
      cachePutJSON("https://trend.50gram.internal/poolN4old", { t: meta.t, data: meta.data }),
      buildNewsPool().then((d) => { if (d.length) return cachePutJSON(ck, { t: now(), data: d }) }),
    ]).catch(() => {}))
    return meta.data
  }
  const d = await buildNewsPool()
  if (d.length) await cachePutJSON(ck, { t: now(), data: d })
  return d
}
// Maqola o'qish uchun: id bo'yicha item (joriy pool → arxiv pool). URL FAQAT serverda qoladi —
// klient hech qachon manba saytni ko'rmaydi/bilmaydi (foydalanuvchi talabi: manba SIR saqlansin).
// id trend() bilan BIR XIL formuladan hisoblanadi: sha256(native_id || url || title).slice(0,12)
async function newsItemById(c: C, id: string): Promise<any | null> {
  for (const key of ["https://trend.50gram.internal/poolN4", "https://trend.50gram.internal/poolN4old"]) {
    const meta = await cacheGetJSON<any[]>(key)
    for (const x of meta?.data || []) {
      if (!x || x.kind !== "news" || !x.url) continue
      const iid = (await sha256(x.id || x.url || x.title || String(x.time))).slice(0, 12)
      if (iid === id) return x
    }
  }
  return null
}
// Maqola matnini HTML'dan ajratish (readability-lite): script/style/nav/footer/aside tozalanadi,
// <article>/<main> bloki afzal ko'riladi, <p> paragraflar yig'iladi — MANBA NOMI HECH QANDAY SHAKLDA QAYTMAYDI
function extractArticle(html: string): { paras: string[]; image: string; title: string } {
  // og:image/og:title avval, RAW html'dan olinadi (keyin meta teglar tozalanadi)
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  const image = og ? decodeEnt(og[1]) : ""
  const tMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = tMatch ? stripHtml(tMatch[1]) : ""
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|svg|form|nav|header|footer|aside|button|select|video|audio)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|noscript|iframe|svg|form|link|meta)[^>]*\/?>/gi, " ")
  const art = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i)
  if (art) h = art[0]
  // Sayt qoldiqlari (mualliflik, obuna, texnik yordam) — HECH QACHON o'qilmaydi (manba nomi shu yerda yashiringan)
  const JUNK_RE = /(barcha huquqlar|huquqlar himoyalangan|yozma roz|saytdagi xabarlar|rozlilik|roziligi|xato topdingizmi|xatingizni oldik|to['’‘ʼ]g['’‘ʼ]irlaymiz|ro['’‘ʼ]yxatdan o['’‘ʼ]t(ing|ish)|ctrl\+enter|copyright|©|ijro etuvchi|tizimli xabar|shu sayt|bizning sayt)/i
  const raw: string[] = []
  const pm = h.matchAll(/<p[\s>][\s\S]*?<\/p\s*>/gi)
  for (const m of pm) {
    let t = stripHtml(m[0].replace(/<br\s*\/?>/gi, " "))
    // Havola-qatorlar / obuna / manba eslatmalari / juda qisqa bo'laklar — tashlanadi
    if (t.length < 35) continue
    if (/(obuna bo|telegram|instagram|facebook|youtube|@[\w_]{4,}|https?:\/\/|www\.|manba:|izohlan|ko'rishlar soni|reklama|\d{1,2}:\d{2}$)/i.test(t)) continue
    if (/^[\s\d.,:;!?%()'"«»\-—+]+$/.test(t)) continue
    if (JUNK_RE.test(t)) continue
    // MANBA SIRI: matn ichida manba sayt nomi uchrasa ham tozalanadi (kun.uz, daryo.uz, BBC...)
    t = t.replace(/\b(kun\s?\.?\s?uz|daryo\s?\.?\s?uz|gazeta\s?\.?\s?uz|spot\s?\.?\s?uz|nuz\s?\.?\s?uz|bbc|ббс)\b/gi, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim()
    if (t.length < 30) continue
    t = t.replace(/\s+/g, " ").trim()
    if (raw.length && raw[raw.length - 1] === t) continue
    raw.push(t)
    if (raw.length >= 130) break
  }
  // Juda oz chiqsa — bo'sag'ichni pasaytirib qayta urinish
  if (raw.length < 3) {
    for (const m of h.matchAll(/<p[\s>][\s\S]*?<\/p\s*>/gi)) {
      const t = stripHtml(m[0])
      if (t.length >= 18 && !raw.includes(t)) raw.push(t)
      if (raw.length >= 60) break
    }
  }
  return { paras: raw.slice(0, 130).map((p) => p.slice(0, 1200)), image, title: title.slice(0, 200) }
}
async function buildNewsPool(): Promise<any[]> {
  const res = await Promise.all(TREND_FEEDS.map(async ([src, url]) => {
    const items = await gnewsFetch(src, url, 40)
    for (const it of items) { it.cat = classify((it.title || "") + " " + (it.snippet || ""), src); delete it.src }
    return items
  }))
  // Eng yangilari oldinda
  return res.flat().sort((a, b) => (b.time || 0) - (a.time || 0))
}
const CAT_KEYS = ["uz", "world", "tech", "sport", "biznes", "shou", "fan", "salomatlik"]
const TREND_CATS = new Set([...CAT_KEYS, "video"])
// --- Analiz tizimi: global vaznlarni o'qish (qarorlar keshi 2 daq) ---
// FAQAT agregat hisoblagichlar (kategoriya bo'yicha ko'rish/bosish/vaqt) — hech qanday yangilik kontenti saqlanmaydi.
async function trendWeights(c: C): Promise<Record<string, number>> {
  const ck = "https://trend.50gram.internal/tw2"
  try {
    const hit = await caches.default.match(ck)
    if (hit) return await hit.json()
  } catch {}
  const w: Record<string, number> = {}
  try {
    const rows = await c.db.q("SELECT cat, imp, clk, wt FROM trend_stats")
    for (const r of rows) {
      const imp = +r.imp || 0, clk = +r.clk || 0, wt = +r.wt || 0
      // Qaror formulasi: CTR (bosish/ko'rish) + ko'rish vaqti logarifmi — shu mavzu lentada oldinga suriladi
      w[String(r.cat)] = Math.round(Math.min(6, (imp ? (clk / imp) * 20 : 0) + Math.log10(wt + 10) * 1.2))
    }
  } catch {}
  const resp = json(w)
  resp.headers.set("cache-control", "public, s-maxage=120")
  c.wait(caches.default.put(ck, resp.clone()).catch(() => {}))
  return w
}
async function trendEv(c: C) {
  const b: any = c.b || {} // router allaqachon JSON body'ni parse qilgan
  const cat = str(b?.cat, 20), ev = str(b?.ev, 6)
  if (!TREND_CATS.has(cat)) fail("Noto‘g‘ri kategoriya")
  const n = Math.max(1, Math.min(50, +b?.n || 1))
  const t = now()
  if (ev === "imp") await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,?,0,0,?) ON DUPLICATE KEY UPDATE imp=imp+?,upd=?", [cat, n, t, n, t])
  else if (ev === "clk") await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,0,?,0,?) ON DUPLICATE KEY UPDATE clk=clk+?,upd=?", [cat, n, t, n, t])
  else if (ev === "wt") {
    const ms = Math.max(0, Math.min(3600000, +b?.ms || 0))
    if (!ms) return json({ ok: true })
    await c.db.run("INSERT INTO trend_stats(cat,imp,clk,wt,upd) VALUES(?,0,0,?,?) ON DUPLICATE KEY UPDATE wt=wt+?,upd=?", [cat, ms, t, ms, t])
  } else fail("Noto‘g‘ri hodisa")
  return json({ ok: true })
}
// YANGILIQ TO'LIQ O'QISH (Task 47): maqola matni SERVERDA olinadi va faqat paragraflar
// qaytariladi — manba sayt nomi/URL/havolasi klientga UMUMAN bormaydi (foydalanuvchi talabi:
// "to'liq o'qish" ilovada, manba SIR). id faqat hovuzdagi itemlarga mos keladi (SSRF xavfsiz).
async function trendArticle(c: C) {
  const id = str(c.url.searchParams.get("id") || "", 48)
  if (!id) fail("id kerak")
  const ck = "https://art.50gram.internal/a2/" + id
  const hit = await cacheGetJSON<any>(ck)
  if (hit && hit.data?.paras?.length) return json({ ...hit.data, cached: true })
  const item = await newsItemById(c, id)
  if (!item?.url) fail("Yangilik topilmadi — lentani yangilang", 404)
  let out: any
  try {
    const r = await fetch(item.url, { headers: TREND_UA, signal: AbortSignal.timeout(9000), cf: { cacheTtl: 1800, cacheEverything: true } } as any)
    if (!r.ok) fail("Yangilik yuklanmadi", 502)
    const html = await r.text()
    const ex = extractArticle(html)
    const paras = ex.paras.length >= 2 ? ex.paras : [item.snippet || item.title].filter(Boolean)
    const words = paras.join(" ").split(/\s+/).length
    out = {
      ok: true, id, kind: "news",
      title: item.title || ex.title || "",
      image: item.image || ex.image || "",
      paras, mins: Math.max(1, Math.round(words / 170)),
      time: item.time || now(),
      cat: item.cat || "uz",
    }
  } catch (e: any) {
    // Sayt ochilmasa — kamida sarlavha + qisqa mazmun bilan o'qib bo'ladi
    if (item.snippet || item.title) {
      out = { ok: true, id, kind: "news", title: item.title || "", image: item.image || "", paras: [item.snippet || item.title], mins: 1, time: item.time || now(), cat: item.cat || "uz", lite: true }
    } else fail("Yangilik yuklanmadi — keyinroq urinib ko'ring", 502)
  }
  if (out.paras?.length) { try { await cachePutJSON(ck, { t: now(), data: out }) } catch {} ; return json(out) }
  return json(out)
}
async function trendInsights(c: C) {
  const rows = await c.db.q("SELECT cat, imp, clk, wt FROM trend_stats ORDER BY clk DESC").catch(() => [])
  let imp = 0, clk = 0, wt = 0
  for (const r of rows) { imp += +r.imp || 0; clk += +r.clk || 0; wt += +r.wt || 0 }
  const scores = rows.map((r) => {
    const i = +r.imp || 0, k = +r.clk || 0, w = +r.wt || 0
    return {
      cat: String(r.cat), imp: i, clk: k, wt: w,
      ctr: i ? Math.round((k / i) * 1000) / 10 : 0,
      score: Math.min(100, Math.round((i ? (k / i) * 400 : 0) + Math.log10(w + 10) * 18)),
    }
  }).sort((a, b) => b.score - a.score)
  const max = scores[0]?.score || 1
  for (const s of scores) (s as any).bar = Math.max(5, Math.round((s.score / max) * 100))
  return json({
    ok: true, total_imp: imp, total_clk: clk, total_wt: wt,
    ctr: imp ? Math.round((clk / imp) * 1000) / 10 : 0,
    cats: scores, top: scores[0]?.cat || "",
  })
}
// QORA EKRAN ILDIZ-FILTRI (foydalanuvchi: "inglizcha sarlavhali shortslar qora ekran bo'lib
// ishlamaydi"): embed-qilib bo'lmaydigan YT videolari (UMG musiqalari, maxfiy/o'chirilgan,
// mintaqa-blokgan) iframe'da HECH QACHON o'ynamaydi — qora ekran. YouTube oEmbed video
// embedga yaroqsiz bo'lsa 401/404 qaytaradi — shu xususiyatdan foydalaniladi.
// Natija 24 SOAT keshlanadi — bir xil video har so'rovda qayta tekshirilmaydi (tezlik).
async function ytEmbedOk(id: string): Promise<boolean> {
  const ck = "https://trend.50gram.internal/emd1/" + id
  try {
    const hit = await caches.default.match(ck)
    if (hit) return (await hit.text()) === "1"
  } catch {}
  let ok = true
  try {
    const r = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id) + "&format=json", { signal: AbortSignal.timeout(3500) })
    ok = r.ok // 200=yaroqli, 401/403/404=embed taqiqlangan/o'chirilgan — QORA EKRAN bo'ladi
  } catch {} // tarmoq xatosida video ayblamasin (klient watchdog + onError baribir himoyalaydi)
  try { await caches.default.put(ck, new Response(ok ? "1" : "0", { headers: { "cache-control": "public, max-age=86400" } })) } catch {}
  return ok
}
async function trend(c: C) {
  const page = Math.max(1, Math.min(40, +(c.url.searchParams.get("page") || 1)))
  const onlyCat = str(c.url.searchParams.get("cat") || "", 20)
  const catsW = str(c.url.searchParams.get("cats") || "", 200) // foydalanuvchi qiziqishlari: "sport:5,tech:3"
  // t17: HAR KIRISHDA BOSHQA SHORTSLAR (foydalanuvchi talabi: "har safar kirganda boshqa shortslar
  // ko'rsatsin — takror zerikarli"): klient tasodifiy rb-bucket (0..29) yuboradi, server hovuzning
  // HAR XIL qismidan qaytaradi. Eski t16 keshlari (bir xil pool[0..12] har kirishda) bekor.
  const rb = Math.max(0, Math.min(29, +(c.url.searchParams.get("rb") || 0) || 0))
  // t18: UZ-interleave + DM olib tashlangan hovuz — eski t17 javoblari (DM'li, chuqur sahifalari ingliz) darhal o'lsin
  const cacheKey = "https://trend.50gram.internal/t18?p=" + page + "&cat=" + onlyCat + (onlyCat === "video" ? "&rb=" + rb : "")
  try {
    const hit = await caches.default.match(cacheKey)
    if (hit) return new Response(hit.body, hit)
  } catch {}
  let items: any[] = []
  if (onlyCat === "video") {
    // Video: FAQAT haqiqiy Shorts (uzun videolar va jonli efirlar sekin/qotadi — foydalanuvchi talabi)
    const vp = await videoPool(c)
    const all = vp.shorts
    // RB-BUCKET (foydalanuvchi talabi: "har safar kirganda boshqa shortslar"): rb*37 ofset
    // hovuzning boshqa-boshqa qismini oladi + sahifa ichida Fisher-Yates — har kirishda boshqa
    // 12 ta short, boshqa tartib. rb=0 (Trend bo'limi) eski tartibda qoladi.
    const s0 = (((page - 1) * 12) + rb * 37) % Math.max(1, all.length)
    items = all.slice(s0, s0 + 12)
    if (items.length < 12 && all.length) items.push(...all.slice(0, 12 - items.length))
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[items[i], items[j]] = [items[j], items[i]] }
    // QORA EKRAN ILDIZ-FILTRI (foydalanuvchi: "inglizcha videolar qora ekran bo'lib ko'rsatmayapti"):
    // embed-yaroqsiz YT videolar olib tashlanadi — o'rniga hovuzdan TEKSHIRILGAN yaroqli video
    // qo'yiladi. Ko'pi 6 ta almashtirish-tekshiruvi (subrequest limiti xavfsizligi uchun).
    // Keshlanganida 0 ta so'rov — tezlik umuman ta'sir qilmaydi.
    const badSet = new Set<string>()
    const yids = [...new Set(items.filter((x: any) => x.vid === "yt" && x.yt).map((x: any) => String(x.yt)))]
    if (yids.length) {
      await Promise.all(yids.map(async (id) => { if (!(await ytEmbedOk(id))) badSet.add(id) }))
      if (badSet.size) {
        const repl: any[] = []
        for (let i = 0; i < all.length && repl.length < Math.min(6, badSet.size); i++) {
          const cand: any = all[(s0 + 12 + i) % all.length]
          if (!cand || cand.vid !== "yt" || !cand.yt || badSet.has(String(cand.yt)) || items.some((x: any) => x.yt === cand.yt) || repl.some((x: any) => x.yt === cand.yt)) continue
          if (await ytEmbedOk(cand.yt)) repl.push(cand)
        }
        let ri = 0
        items = items.map((x: any) => (x.vid === "yt" && badSet.has(String(x.yt)) && ri < repl.length) ? repl[ri++] : x)
        items = items.filter((x: any) => x && !(x.vid === "yt" && badSet.has(String(x.yt))))
      }
    }
  } else {
    const pool = await newsPool(c)
    if (onlyCat && CAT_KEYS.includes(onlyCat)) {
      items = pool.filter((x) => x.cat === onlyCat).slice((page - 1) * 12, page * 12)
    } else {
      // Barchasi: kategoriyalar FOYDALANUVCHI qiziqishi + ANALIZ TIZIMI qarorlari bo'yicha round-robin
      const w: Record<string, number> = {}
      for (const part of catsW.split(",")) { const [k, v] = part.split(":"); if (CAT_KEYS.includes(k)) w[k] = +v || 0 }
      const gw = await trendWeights(c)
      const keys = CAT_KEYS.slice().sort((a, b) => ((w[b] || 0) + (gw[b] || 0) * 1.5) - ((w[a] || 0) + (gw[a] || 0) * 1.5))
      const byCat = new Map(keys.map((k) => [k, pool.filter((x) => x.cat === k)] as [string, any[]]))
      const perPage = 4
      const picked: any[] = []
      const cursors = new Map(keys.map((k) => [k, (page - 1) * perPage] as [string, number]))
      let left = keys.length * perPage
      while (left > 0) {
        let added = false
        for (const k of keys) {
          const arr = byCat.get(k) || [], cur = cursors.get(k)!
          if (cur >= arr.length || picked.length >= 44) continue
          picked.push(arr[cur]); cursors.set(k, cur + 1); left--; added = true
        }
        if (!added) break
      }
      // Har sahifaga trend Shorts aralashtiriladi (uzun videolar sekin — qo'shilmaydi)
      const vp = await videoPool(c)
      const vall = vp.shorts
      const v0 = ((page - 1) * 3) % Math.max(1, vall.length)
      const picks = vall.slice(v0, v0 + 3)
      for (let i = 3, vi = 0; i < picked.length && vi < picks.length; i += 7) picked.splice(i, 0, picks[vi++])
      if (picked.length && picks.length && !picked.some((x) => x.kind === "video" || x.kind === "short")) picked.push(picks[0])
      // HAR YANGILASHDA BOSHQA TARTIB (Fisher-Yates): foydalanuvchi "yangiliklar yangilansin" —
      // har pool qayta qurilganda sahifa tartibi ham o'zgaradi, bir xillik yo'q
      for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[picked[i], picked[j]] = [picked[j], picked[i]] }
      items = picked
    }
  }
  // Tarjima: avval Shorts/video sarlavhalari (foydalanuvchi birinchi ko'radi), so'ng yangiliklar.
  // PARALLEL tarjima — sovuq sahifa 1-2s ichida tayyor (kesh 6 soat, takroriy so'rov bepul).
  const trList = [...items.filter((x) => x.kind === "short" || x.kind === "video"), ...items.filter((x) => x.kind !== "short" && x.kind !== "video")]
    .filter((x) => x && x.title && needsTr(x.title))
    .slice(0, 10)
  if (trList.length) {
    const results = await Promise.all(trList.map(async (it) => ({ it, t: await trToUzCached(c, it.title) })))
    for (const { it, t } of results) if (t && t !== it.title) it.title = t
  }
  items = items.filter((x) => x && (x.title || x.img)) // img-slidelar sarlavhasiz ham keladi
  // ID: manba-native id'dan (yt id/dm id/mk id — yuqorida berilgan) — URL EMAS!
  // AVVAL id=sha256(url) edi: Mixkit bir kategoriyadagi 4-10 video BIR XIL URL'ga ega —
  // hamma BIR XIL id chiqarardi → klient dedupe ularni tushirardi → hovuz 5-6 tagacha
  // qisqarardi → lenta "5-6 tadan keyin qotib qolmoqda" (asosiy ildiz sabab shu edi!)
  for (const x of items) x.id = (await sha256(x.id || x.url || x.title || String(x.time))).slice(0, 12)
  // MANBA SIRI (foydalanuvchi talabi): QATIY — HAMMA itemdan URL/manba/chid O'CHIRILADI.
  // Klient hech qachon qaysi platformadan (YT/IG/DM) olinganini bilmasligi kerak.
  for (const x of items) { delete x.url; delete x.src; delete x.chid; delete x.audio }
  const out = { ok: true, page, items }
  const resp = json(out)
  // Video sahifasida YouTube yo'q bo'lsa 60s kesh (hovuz tuzatilgach tez yangilanadi); qolganlari 600s
  const badVid = onlyCat === "video" && items.length > 0 && !items.some((x: any) => x.vid === "yt")
  resp.headers.set("cache-control", "public, s-maxage=" + (badVid ? 60 : 600) + ", stale-while-revalidate=180")
  c.wait(caches.default.put(cacheKey, resp.clone()).catch(() => {}))
  return resp
}
async function chatStats(c: C) {
  const id = +c.p.id
  await needAdmin(c, id)
  const one = async (sql: string, v: unknown[] = []) => Number((await c.db.one(sql, v))?.n || 0)
  const [members, admins, banned, msgs, posts, views, likes, comments, today] = await Promise.all([
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND status='active'", [id]),
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND role IN ('owner','admin') AND status='active'", [id]),
    one("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND status='banned'", [id]),
    one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND deleted=0", [id]),
    one("SELECT COUNT(*) n FROM posts WHERE chat_id=?", [id]),
    one("SELECT COALESCE(SUM(views),0) n FROM posts WHERE chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM post_comments pc JOIN posts p ON p.id=pc.post_id WHERE p.chat_id=?", [id]),
    one("SELECT COUNT(*) n FROM messages WHERE chat_id=? AND created_at>?", [id, now() - DAY]),
  ])
  return json({ ok: true, members, admins, banned, messages: msgs, posts, views, likes, comments, today })
}

// ------------------------- Lenta -------------------------
async function feed(c: C) {
  const before = +(c.url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER
  const mode = c.url.searchParams.get("mode") === "subs" ? "subs" : "all"
  const my = (await c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid])).map((r) => r.chat_id)
  const myList = my.length ? my : [0]
  let rows: any[]
  if (mode === "subs") {
    const circ = await circle(c)
    rows = await c.db.q(
      `SELECT p.* FROM posts p WHERE p.id<? AND ((p.chat_id=0 AND p.author_id IN (${ph(circ)})) OR p.chat_id IN (${ph(myList)})) ORDER BY p.id DESC LIMIT 20`,
      [before, ...circ, ...myList],
    )
  } else {
    rows = await c.db.q(
      `SELECT p.* FROM posts p LEFT JOIN chats ch ON ch.id=p.chat_id
       WHERE p.id<? AND (p.chat_id=0 OR ch.is_public=1 OR p.chat_id IN (${ph(myList)})) ORDER BY p.id DESC LIMIT 20`,
      [before, ...myList],
    )
  }
  const blocked = new Set((await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=? UNION SELECT blocked_id AS user_id FROM blocks WHERE user_id=?", [c.uid, c.uid])).map((r) => r.user_id))
  rows = rows.filter((r) => !blocked.has(r.author_id))
  return json(await postsOut(c, rows))
}
async function postsOut(c: C, rows: any[]) {
  const ids = rows.map((r) => r.id)
  const liked = ids.length ? new Set((await c.db.q(`SELECT post_id FROM post_likes WHERE user_id=? AND post_id IN (${ph(ids)})`, [c.uid, ...ids])).map((r) => r.post_id)) : new Set()
  const um = await usersByIds(c, rows.map((r) => r.author_id))
  const chIds = [...new Set(rows.map((r) => r.chat_id).filter(Boolean))]
  const chs = chIds.length ? await c.db.q(`SELECT ${CHAT_COLS} FROM chats WHERE id IN (${ph(chIds)})`, chIds) : []
  const chm = new Map(chs.map((r) => [r.id, chatOut(r)]))
  return rows.map((r) => ({
    id: r.id, text_body: r.text_body, media_id: r.media_id, media_kind: r.media_kind, like_count: r.like_count,
    comment_count: r.comment_count, views: Number(r.views || 0), created_at: r.created_at, liked: liked.has(r.id),
    meta: r.meta ? parse(r.meta, null) : null,
    author: um.get(r.author_id) || null, chat: r.chat_id ? chm.get(r.chat_id) || null : null,
    can_delete: r.author_id === c.uid,
  }))
}
async function createPost(c: C) {
  const text = str(c.b.text_body, 3000)
  if (!text && !c.b.media_id) fail("Post bo‘sh")
  const chatId = +c.b.chat_id || 0
  if (chatId) await needAdmin(c, chatId)
  const id = newId()
  const meta = c.b.meta && typeof c.b.meta === "object" ? JSON.stringify(c.b.meta) : null
  if (meta && meta.length > 6000) fail("Post juda katta")
  await c.db.run("INSERT INTO posts(id,author_id,chat_id,text_body,media_id,media_kind,meta,created_at) VALUES(?,?,?,?,?,?,?,?)",
    [id, c.uid, chatId, text || null, c.b.media_id || null, c.b.media_id ? (c.b.media_kind === "video" ? "video" : "photo") : null, meta, now()])
  if (c.b.media_id) {
    await c.db.run("UPDATE media SET expires_at=?, keep=1, chat_id=0, next_check=0 WHERE id=? AND owner_id=?", [now() + 100 * 365 * DAY, String(c.b.media_id), c.uid])
    c.wait(SW.planReplicas(c.db, 1, String(c.b.media_id)))
  }
  return json((await postsOut(c, [await c.db.one("SELECT * FROM posts WHERE id=?", [id])]))[0])
}
async function deletePost(c: C) {
  const p = await c.db.one("SELECT author_id, chat_id, media_id FROM posts WHERE id=?", [+c.p.id])
  if (!p) fail("Post topilmadi", 404)
  if (p.author_id !== c.uid && !(p.chat_id && isAdm(await member(c, p.chat_id)))) fail("Ruxsat yo‘q", 403)
  if (p.media_id) await SW.dropMedia(c.db, "id=?", [String(p.media_id)])
  for (const t of ["post_likes", "post_comments"]) await c.db.run(`DELETE FROM ${t} WHERE post_id=?`, [+c.p.id])
  await c.db.run("DELETE FROM posts WHERE id=?", [+c.p.id])
  return json({ ok: true })
}
async function likePost(c: C) {
  const id = +c.p.id
  const ex = await c.db.one("SELECT 1 AS x FROM post_likes WHERE post_id=? AND user_id=?", [id, c.uid])
  if (ex) await c.db.run("DELETE FROM post_likes WHERE post_id=? AND user_id=?", [id, c.uid])
  else await c.db.run("REPLACE INTO post_likes(post_id,user_id) VALUES(?,?)", [id, c.uid])
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM post_likes WHERE post_id=?", [id])
  await c.db.run("UPDATE posts SET like_count=? WHERE id=?", [Number(n?.cnt || 0), id])
  return json({ liked: !ex, like_count: Number(n?.cnt || 0) })
}
// Reels — vertikal video lenta: ochiq kanallar + shaxsiy video postlar (ko'rilgani hisoblanadi)
async function reels(c: C) {
  const before = +(c.url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER
  const my = (await c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid])).map((r) => r.chat_id)
  const myList = my.length ? my : [0]
  // QORA EKRAN HIMoyasi: media fayli serverdan tozalangan (gone/dropped) YUKI to'liq
  // yuklanmagan postlar QAYTARILMAYDI — ular hech qachon o'ynamaydi, faqat qora karta bo'lardi
  // (media "Xotira posboni" tomonidan bo'shatilgan eski postlar shu tufayli qora turardi).
  const rows = await c.db.q(
    `SELECT p.* FROM posts p LEFT JOIN chats ch ON ch.id=p.chat_id
     JOIN media m ON m.id=p.media_id AND m.complete=1 AND m.gone=0 AND m.dropped=0
     WHERE p.media_kind='video' AND p.id<? AND (p.chat_id=0 OR ch.is_public=1 OR p.chat_id IN (${ph(myList)}))
     ORDER BY p.id DESC LIMIT 10`,
    [before, ...myList],
  )
  const blocked = new Set((await c.db.q("SELECT user_id FROM blocks WHERE blocked_id=? UNION SELECT blocked_id AS user_id FROM blocks WHERE user_id=?", [c.uid, c.uid])).map((r) => r.user_id))
  const list = rows.filter((r) => !blocked.has(r.author_id))
  if (list.length) await c.db.run(`UPDATE posts SET views=views+1 WHERE id IN (${ph(list.map((x) => x.id))})`, list.map((x) => x.id))
  return json(await postsOut(c, list))
}
// Task 39: izohlar — ildiz + javoblar (chuqurlik 1, Telegram uslubi), reaksiyalar, stiker izohlar
const REACT_EMOJIS = ["❤️", "👍", "🔥", "😮", "😂", "🥰", "👏", "😢"]
async function listComments(c: C) {
  await ensureSchema(c.db) // yangi ustunlar (parent_id/sticker) mavjudligini kafolatlash
  const rows = await c.db.q("SELECT id,parent_id,user_id,text_body,sticker,created_at FROM post_comments WHERE post_id=? ORDER BY id LIMIT 300", [+c.p.id])
  const um = await usersByIds(c, [...new Set(rows.map((r) => r.user_id))])
  const agg = new Map<number, any[]>(), mine = new Set<string>()
  const ids = rows.map((r) => r.id as number)
  if (ids.length) {
    const rg = await c.db.q(`SELECT comment_id,emoji,COUNT(*) AS n FROM comment_reacts WHERE comment_id IN (${ph(ids)}) GROUP BY comment_id,emoji`, ids).catch((): any[] => [])
    for (const r of rg) { const a = agg.get(Number(r.comment_id)) || []; a.push({ emoji: r.emoji, n: Number(r.n), mine: false }); agg.set(Number(r.comment_id), a) }
    const mr = await c.db.q(`SELECT comment_id,emoji FROM comment_reacts WHERE user_id=? AND comment_id IN (${ph(ids)})`, [c.uid, ...ids]).catch((): any[] => [])
    for (const r of mr) mine.add(Number(r.comment_id) + "\u0000" + String(r.emoji))
    for (const [cid, a] of agg) for (const x of a) if (mine.has(cid + "\u0000" + x.emoji)) x.mine = true
  }
  const nodes = rows.map((r) => ({ id: r.id, parent_id: Number(r.parent_id || 0), text_body: r.text_body || "", sticker: r.sticker || "", created_at: r.created_at, user: um.get(r.user_id) || null, mine: r.user_id === c.uid, reacts: agg.get(r.id) || [], reply_count: 0, replies: [] as any[] }))
  const map = new Map(nodes.map((n) => [n.id, n]))
  const roots: any[] = []
  for (const n of nodes) { if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.replies.push(n); else roots.push(n) }
  for (const r of roots) r.reply_count = r.replies.length
  return json({ roots, total: rows.length, emojis: REACT_EMOJIS })
}
async function addComment(c: C) {
  await ensureSchema(c.db)
  const text = str(c.b.text_body, 1000)
  const sticker = str(c.b.sticker, 64)
  if (!text && !sticker) fail("Izoh bo‘sh")
  let parentId = Math.max(0, +c.b.parent_id || 0)
  const p = await c.db.one("SELECT id,author_id,chat_id FROM posts WHERE id=?", [+c.p.id])
  if (!p) fail("Post topilmadi", 404)
  if (p.chat_id) { const ch = await needChat(c, p.chat_id); if (!parse(ch.settings, DEF_SET).comments) fail("Izohlar o‘chirilgan") }
  let parent: any = null
  if (parentId) {
    parent = await c.db.one("SELECT id,parent_id,user_id FROM post_comments WHERE id=? AND post_id=?", [parentId, +c.p.id])
    if (!parent) fail("Javob beriladigan izoh topilmadi", 404)
    if (+parent.parent_id) parentId = +parent.parent_id // javob javobga — ildiz ostiga (chuqurlik 1)
  }
  const id = newId(), t = now()
  await c.db.run("INSERT INTO post_comments(id,post_id,parent_id,user_id,text_body,sticker,created_at) VALUES(?,?,?,?,?,?,?)", [id, +c.p.id, parentId, c.uid, text, sticker, t])
  await c.db.run("UPDATE posts SET comment_count=comment_count+1 WHERE id=?", [+c.p.id])
  const target = parent ? +parent.user_id : +p.author_id
  if (target && target !== c.uid) c.wait(notify(c.env, [target], { type: "comment", post_id: +c.p.id, comment_id: id, reply: !!parent }))
  const um = await usersByIds(c, [c.uid])
  return json({ id, parent_id: parentId, text_body: text, sticker, created_at: t, user: um.get(c.uid) || null, mine: true, reacts: [], reply_count: 0, replies: [] })
}
// Izohga emoji-reaksiya qo‘yish/olib tashlash (toggle)
async function reactComment(c: C) {
  await ensureSchema(c.db)
  const id = +c.p.id
  const emoji = str(c.b.emoji, 8)
  if (!REACT_EMOJIS.includes(emoji)) fail("Emoji qo‘llanmaydi")
  const row = await c.db.one("SELECT id FROM post_comments WHERE id=?", [id])
  if (!row) fail("Izoh topilmadi", 404)
  const ex = await c.db.one("SELECT 1 AS x FROM comment_reacts WHERE comment_id=? AND user_id=? AND emoji=?", [id, c.uid, emoji])
  if (ex) await c.db.run("DELETE FROM comment_reacts WHERE comment_id=? AND user_id=? AND emoji=?", [id, c.uid, emoji])
  else await c.db.run("INSERT INTO comment_reacts(comment_id,user_id,emoji,created_at) VALUES(?,?,?,?)", [id, c.uid, emoji, now()])
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM comment_reacts WHERE comment_id=? AND emoji=?", [id, emoji])
  return json({ on: !ex, emoji, n: Number(n?.cnt || 0) })
}
// Izohni o'chirish: muallif, post egasi yoki kanal admini (javoblari bilan birga)
async function deleteComment(c: C) {
  await ensureSchema(c.db)
  const row = await c.db.one("SELECT id,user_id,post_id FROM post_comments WHERE id=?", [+c.p.id])
  if (!row) fail("Izoh topilmadi", 404)
  const p = await c.db.one("SELECT author_id,chat_id FROM posts WHERE id=?", [+row.post_id])
  let can = row.user_id === c.uid || !!(p && +p.author_id === c.uid)
  if (!can && p && +p.chat_id > 0) {
    const m = await c.db.one("SELECT role FROM chat_members WHERE chat_id=? AND user_id=?", [+p.chat_id, c.uid])
    can = !!m && ["owner", "admin"].includes(String(m.role))
  }
  if (!can) fail("Ruxsat yo‘q", 403)
  await c.db.run(`DELETE FROM comment_reacts WHERE comment_id IN (SELECT id FROM post_comments WHERE id=? OR parent_id=?)`, [row.id, row.id]).catch(() => {})
  const cnt = await c.db.one("SELECT COUNT(*) AS cnt FROM post_comments WHERE id=? OR parent_id=?", [row.id, row.id])
  await c.db.run("DELETE FROM post_comments WHERE id=? OR parent_id=?", [row.id, row.id])
  await c.db.run("UPDATE posts SET comment_count=GREATEST(0,comment_count-?) WHERE id=?", [Number(cnt?.cnt || 1), +row.post_id])
  return json({ ok: true })
}

// ------------------------- Qo'ng'iroqlar (WebRTC signalizatsiya) -------------------------
async function ice(c: C) {
  // v79 TURN: STUN faqat "ko'cha manzilini" beradi — NAT ostidagi ikki telefon (biri Wi-Fi,
  // biri mobil) ko'pincha faqat TURN relay orqali bog'lanadi. Shuning uchun ENDI doimiy
  // bepul TURN (openrelay — Metered'ning ochiq xizmati, ro'yxatdan o'tishsiz) har javobda
  // BOR. Cloudflare TURN kalitlari (TURN_KEY_ID/TURN_KEY_TOKEN secretlari) qo'shilsa —
  // ularning creds'lari ham ustiga qo'shiladi (sifatliroq relay).
  const srv = {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:8080",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  }
  const servers: any[] = [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
    { urls: srv.urls.slice(0, 2), username: srv.username, credential: srv.credential },
    { urls: srv.urls.slice(2, 4), username: srv.username, credential: srv.credential },
  ]
  if (c.env.TURN_KEY_ID && c.env.TURN_KEY_TOKEN) {
    try {
      // TIMEOUT 3.5s: rtc.live.cloudflare.com javob bermasa /ice ABADIY osilib qolmasin —
      // aks holda setupPC ham osilib, qo'ng'iroq «Ulanmoqda…» da qotib qolardi (STUN zaxirasi bor)
      const r = await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/" + c.env.TURN_KEY_ID + "/credentials/generate-ice-servers", {
        method: "POST",
        headers: { Authorization: `Bearer ${c.env.TURN_KEY_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
        signal: AbortSignal.timeout(3500),
      })
      const j: any = await r.json()
      const s = j.iceServers
      if (Array.isArray(s)) servers.push(...s)
      else if (s) servers.push(s)
    } catch (e) { jurnalYoz(c.env, "/ice", c.uid, "turn", "TURN creds: " + String(e).slice(0, 300)) } // console.log'da YO'QOLARDI — TURN buzilishi ko'rinmas qolardi (STUN fallbackda mobil tarmoqda media o'tmasdi)
  }
  return json({ iceServers: servers })
}
async function callPending(c: C) {
  // O'ZI-O'ZINI TIKLASH («band bo'lib» ildizi): 90s+ eski "ringing" = hech kim javob bermagan
  // o'lik qo'ng'iroq — darhol yakunlanadi. Aks holda klient uni QAYTA-QAYTA jiringlar va
  // CALL holati band bo'lib, barcha yangi qo'ng'iroqlarga yolg'on "Band" qaytardi.
  const t0 = now()
  await c.db.run("UPDATE calls SET status='missed', ended_at=? WHERE ended_at=0 AND status='ringing' AND started_at<=? AND (callee_id=? OR caller_id=?)", [t0, t0 - 90000, c.uid, c.uid])
  // WS uzilgan paytda kelgan qo'ng'iroqni qayta o'ynatish: ilova ochilganda o'zini "ringing" holatda topadi
  const row = await c.db.one("SELECT * FROM calls WHERE callee_id=? AND status='ringing' AND started_at>? ORDER BY started_at DESC LIMIT 1", [c.uid, t0 - 80000])
  if (!row) return json({ call: null })
  const from = (await usersByIds(c, [+row.caller_id])).get(+row.caller_id)
  if (!from) return json({ call: null })
  return json({ call: { call_id: row.id, video: !!row.video, started_at: +row.started_at, from: { ...from, first_name: (from as any).real_name || from.first_name, last_name: "" } } })
}
async function startCall(c: C) {
  const to = +c.b.to
  if (!to || to === c.uid) fail("Kimga qo‘ng‘iroq?")
  if (await blockedBetween(c, c.uid, to)) fail("Bu foydalanuvchiga qo‘ng‘iroq qilib bo‘lmaydi", 403)
  const t0 = now()
  // GHOST TOZALASH («band bo‘lib qo‘ng‘iroq ketmayapti» ildizi): hech kim status yozmagan
  // eski "ringing" qatorlar qabul qiluvchida qayta-qayta jiringlar va CALL holatini band
  // qilardi — natijada HAR YANGI qo‘ng‘iroqqa yolg‘on "Band" javobi qaytardi. Endi yangi
  // qo‘ng‘iroq boshlanishida: 1) shu juftlikning barcha eski ringing yozuvlari (yangi qo‘ng‘iroq
  // ularni “supurib tashlaydi”), 2) ikkala foydalanuvchiga tegishli 90s+ eski o‘lik ringing
  // yozuvlari yakunlanadi — o‘lik holat hech qachon yangi qo‘ng‘iroqqa to‘sqinlik qilolmaydi.
  await c.db.run("UPDATE calls SET status='missed', ended_at=? WHERE ended_at=0 AND status='ringing' AND ((caller_id=? AND callee_id=?) OR (caller_id=? AND callee_id=?))", [t0, c.uid, to, to, c.uid])
  await c.db.run("UPDATE calls SET status='missed', ended_at=? WHERE ended_at=0 AND status='ringing' AND started_at<=? AND (caller_id=? OR callee_id=? OR caller_id=? OR callee_id=?)", [t0, t0 - 90000, c.uid, c.uid, to, to])
  const id = newId()
  await c.db.run("INSERT INTO calls(id,caller_id,callee_id,video,status,started_at) VALUES(?,?,?,?,'ringing',?)", [id, c.uid, to, c.b.video ? 1 : 0, t0])
  const me = (await usersByIds(c, [c.uid])).get(c.uid)
  // qo'ng'iroq qiluvchi qabul qiluvchining kontakt nomini ko'rmaydi — haqiqiy ismi yuboriladi
  c.wait(notify(c.env, [to], { type: "call", call_id: id, video: !!c.b.video, started_at: t0, from: { ...me, first_name: me.real_name, last_name: "" } }))
  // MAJBURIY PUSH (force): WS "zombi" bo‘lsa (ko‘rinadi, lekin o‘lik) DO uni "online" hisoblab
  // pushni O‘TKAZIB YUBORARDI — qo‘ng‘iroq umuman yetmasdi. Qo‘ng‘iroqda push HAR DOIM
  // yuboriladi (dublikat xavfi yo‘q — klient bir xil call_id ni ikki marta ko‘rsatmaydi).
  c.wait(pushUsers(c.env, [to], { t: `${me?.real_name || "50 Gram"} qo‘ng‘iroq qilmoqda`, b: c.b.video ? "📹 Video qo‘ng‘iroq" : "📞 Audio qo‘ng‘iroq", c: 0, tag: "g50call" + id, call: 1 }, { urgency: "high", ttl: 90, force: true }))
  return json({ call_id: id })
}
async function signal(c: C) {
  const to = +c.b.to
  const data = c.b.data
  if (!to || !data) fail("Noto‘g‘ri signal")
  const body = JSON.stringify(data)
  if (body.length > 30000) fail("Signal juda katta")
  const sid = newId()
  // NAVBAT (hal qiluvchi tuzatish): avval signal FAQAT WS orqali yurardi — agar qabul
  // qiluvchining WebSocket'i o'lik/zombi bo'lsa, POST 200 OK qaytarardi LEKIN signal 0 ta
  // soketga yetib «Ulanmoqda…» abadiy qolardi. Endi navbat 2 daqiqa saqlanadi — klient
  // polling bilan albatta oladi.
  try { await c.db.run("INSERT INTO call_signals(id,to_uid,from_uid,body,created_at) VALUES(?,?,?,?,?)", [sid, to, c.uid, body, now()]) } catch (e) { jurnalYoz(c.env, "/signal", c.uid, "sigq", "navbat INSERT: " + String(e)) } // console.log'da YO'QOLARDI — signal yo'qolishining ko'rinmas ildizi
  await notify(c.env, [to], { type: "signal", sid, from: c.uid, data })
  return json({ ok: true })
}
// KLIENT QO'NG'IROQ JURNALI (egaga /api/jurnal orqali ko'rinadi): sahifa-konsoli
// Cloudflare'da SAQLANMAYDI — haqiqiy qurilmadagi «video qotdi / ovoz kelmayapti /
// qo'ng'iroq qotib qoldi» holatlari avval LOG'SIZ yo'qolardi. Endi klient har qo'ng'iroq
// hayotiy siklini (chaqirish→javob→offer→answer→ICE→media→yopilish) shu yerga yozadi.
// Best-effort: o'z xatosi javobni hech qachon buzmaydi. So'roviga ≤3000 belgi (v87).
async function callLog(c: C) {
  // v87: 900 → 3000 belgi — klient 6 qatorni birlashtirib yuboradi; avval 900 belgi
  // OXIRGI qatorlarni (stat/endCall!) kesib tashlab, jurnal dalillari YO'QOLARDI
  const msg = String(c.b?.m || "").replace(/\s+/g, " ").trim().slice(0, 3000)
  if (!msg) return json({ ok: true })
  const path = "call:" + String(c.b?.c || "").slice(0, 24)
  c.wait(jurnalYoz(c.env, path, c.uid, "klient", msg))
  return json({ ok: true })
}
async function signalQueue(c: C) {
  // WS uzilgan bo'lsa ham signallar yetib boradi: fetch-and-delete navbat.
  // `since` — klient ko'rgan eng katta sid (qayta yuklab stale signallarni olmaslik uchun).
  const since = Math.max(0, +(c.url.searchParams.get("since") || 0))
  // v89: O'QISHDA YOSH FILTRI — 2 daqiqadan eski signallar qaytarilmaydi (davriy tozalash
  // (sweeper) kechiksa ham eski hangup/busy yangi qo'ng'iroqni hech qachon o'ldira olmaydi)
  const rows = await c.db.q("SELECT id, from_uid, body FROM call_signals WHERE to_uid=? AND id>? AND created_at>? ORDER BY id ASC LIMIT 60", [c.uid, since, now() - 2 * 60000])
  if (rows.length) {
    await c.db.run("DELETE FROM call_signals WHERE id IN (" + ph(rows.map((r) => r.id)) + ")", rows.map((r) => r.id))
  }
  const out: any[] = []
  for (const r of rows) {
    try { out.push({ sid: r.id, from: r.from_uid, data: JSON.parse(String(r.body)) }) } catch {}
  }
  return json({ signals: out })
}
async function callStatus(c: C) {
  const call = await c.db.one("SELECT * FROM calls WHERE id=?", [+c.p.id])
  if (!call || (call.caller_id !== c.uid && call.callee_id !== c.uid)) fail("Qo‘ng‘iroq topilmadi", 404)
  const st = String(c.b.status)
  if (st === "active" && call.status === "ringing") {
    await c.db.run("UPDATE calls SET status='active' WHERE id=?", [call.id])
    return json({ ok: true })
  }
  if (!["ended", "missed", "declined"].includes(st) || call.ended_at) return json({ ok: true })
  const final = call.status === "active" ? "ended" : st === "ended" ? "missed" : st
  await c.db.run("UPDATE calls SET status=?, ended_at=? WHERE id=?", [final, now(), call.id])
  // Chatga qo'ng'iroq yozuvi
  const key = [call.caller_id, call.callee_id].sort((a: number, b: number) => a - b).join(":")
  let ch = await c.db.one("SELECT id FROM chats WHERE direct_key=?", [key])
  const t = now()
  if (!ch) {
    const id = newId()
    await c.db.run("INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES(?,?,?,0,?,?,2,?,?)", [id, "direct", call.caller_id, randomStr(10), key, t, t])
    for (const u of [call.caller_id, call.callee_id]) await c.db.run("INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,'member',?)", [id, u, t])
    ch = { id }
  }
  const mid = newId()
  const meta = JSON.stringify({ video: call.video, status: final, duration: Math.max(0, Math.round(+c.b.duration || 0)) })
  await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,'call',NULL,?,?,?,?)", [mid, ch.id, call.caller_id, meta, t, t, t + 100 * 365 * DAY])
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, ch.id])
  const out = (await enrich(c, [await c.db.one("SELECT * FROM messages WHERE id=?", [mid])]))[0]
  c.wait(notify(c.env, [call.caller_id, call.callee_id], { type: "message", chat_id: ch.id, message: out }))
  // PROAKTIV YOPISH («qotib turibdi» ildizi): chaqiruvchi kutish vaqtini tugatib yuborsa /
  // bekor qilsa — qabul qiluvchining jiringlash ekrani o'z 65s taymerigacha QOLMASDI (WS
  // zombi bo'lsa 'hangup' signali ham yetmasdi). Endi server o'lgan qo'ng'iroqni IKKALA
  // tomonga xabar qiladi — klient jiringlashni zudlik bilan yopadi (faqat hali javob
  // berilmagan holatda; faol qo'ng'iroq 'hangup' orqali yopilaveradi).
  c.wait(notify(c.env, [call.caller_id, call.callee_id], { type: "call_closed", call_id: call.id, status: final }))
  // NAVBATGA HAM YOZAMIZ (qo'ng'iroq qotib qolishining oxirgi eshigi): WS zombi bo'lsa
  // 'call_closed' WS orqali yetmasdi va jiringlash ekrani o'z 65-75s taymerigacha QOTIB
  // TURARDI. Navbatga yozilsa — qarshi tomon navbat-polling (1.8s) bilan ~2s ichida yopadi.
  try {
    for (const u of [call.caller_id, call.callee_id]) {
      if (u === c.uid) continue
      const sid2 = newId()
      await c.db.run("INSERT INTO call_signals(id,to_uid,from_uid,body,created_at) VALUES(?,?,?,?,?)", [sid2, u, c.uid, JSON.stringify({ k: "call_closed", call_id: call.id, status: final }), now()])
    }
  } catch {}
  return json({ ok: true })
}

// ------------------------- Jonli efir -------------------------
async function startLive(c: C) {
  const chatId = +c.b.chat_id || 0
  if (chatId) await needAdmin(c, chatId)
  await c.db.run("UPDATE lives SET ended_at=? WHERE user_id=? AND ended_at=0", [now(), c.uid])
  const id = newId()
  await c.db.run("INSERT INTO lives(id,user_id,chat_id,title,started_at) VALUES(?,?,?,?,?)", [id, c.uid, chatId, str(c.b.title, 200), now()])
  if (chatId) await sysMsg(c, chatId, "🔴 Jonli efir boshlandi")
  // Doiradagilarga (kontaktlar + to'g'ridan-to'g'ri chatdoshlar) real vaqt bildirishnomasi — avatarida LIVE belgisi ko'rinsin
  try {
    const u = await c.db.one("SELECT * FROM users WHERE id=?", [c.uid])
    const ids = await circle(c)
    c.wait(notify(c.env, ids, { type: "live_start", live_id: id, from: c.uid, user: pubUser(u, c.uid) }))
  } catch (e) { console.log("live_start notify xato", String(e)) }
  return json({ id })
}
async function listLives(c: C) {
  await ensureSchema(c.db) // Task 41: peak kolonkasi kafolati
  // TEZLIK (umumiy): doira va guruhlarim ro'yxati mustaqil — parallel
  const [ids, myRows] = await Promise.all([
    circle(c),
    c.db.q("SELECT chat_id FROM chat_members WHERE user_id=? AND status='active'", [c.uid]),
  ])
  const my = myRows.map((r) => r.chat_id)
  const rows = await c.db.q(
    `SELECT * FROM lives WHERE ended_at=0 AND started_at>? AND (user_id IN (${ph(ids)}) ${my.length ? `OR chat_id IN (${ph(my)})` : ""}) ORDER BY started_at DESC LIMIT 30`,
    [now() - 12 * 3600000, ...ids, ...my],
  )
  // TEZLIK (umumiy): efirchilar va coin darajalari mustaqil — parallel
  const hosts = rows.map((r) => r.user_id)
  const [um, wl] = await Promise.all([
    usersByIds(c, hosts),
    hosts.length ? c.db.q(`SELECT user_id, earned FROM wallets WHERE user_id IN (${ph(hosts)})`, hosts).catch((): any[] => []) : Promise.resolve([] as any[]),
  ])
  const lv = new Map(wl.map((x) => [x.user_id, levelOf(Number(x.earned))]))
  return json(rows.map((r) => ({ id: r.id, title: r.title, chat_id: r.chat_id, viewers: r.viewers, peak: Number(r.peak || 0), started_at: r.started_at, user: um.get(r.user_id) ? { ...um.get(r.user_id), lvl: lv.get(r.user_id) || levelOf(0) } : null })))
}
// Task 41: TOP efir reytingi — oxirgi 7 kun ichida eng ko'p tomoshabin yig'gan efirlar
async function listTopLives(c: C) {
  await ensureSchema(c.db) // Task 41: peak kolonkasi kafolati
  const rows = await c.db.q(
    "SELECT id, user_id, title, viewers, peak, started_at, ended_at FROM lives WHERE started_at>? AND peak>0 ORDER BY peak DESC, started_at DESC LIMIT 10",
    [now() - 7 * DAY],
  )
  const uids = rows.map((r) => r.user_id)
  const [um, wl] = await Promise.all([
    uids.length ? usersByIds(c, uids) : Promise.resolve(new Map()),
    uids.length ? c.db.q(`SELECT user_id, earned FROM wallets WHERE user_id IN (${ph(uids)})`, uids).catch((): any[] => []) : Promise.resolve([] as any[]),
  ])
  const lv = new Map(wl.map((x) => [x.user_id, levelOf(Number(x.earned))]))
  return json(rows.map((r, i) => ({
    pos: i + 1, id: r.id, title: r.title, peak: Number(r.peak), live: !r.ended_at,
    started_at: r.started_at, ended_at: r.ended_at,
    user: um.get(r.user_id) ? { ...um.get(r.user_id), lvl: lv.get(r.user_id) || levelOf(0) } : null,
  })))
}
async function liveRow(c: C) {
  await ensureSchema(c.db) // Task 41: peak kolonkasi kafolati (har bir efir endpoint'idan oldin)
  const l = await c.db.one("SELECT * FROM lives WHERE id=?", [+c.p.id])
  if (!l || l.ended_at) fail("Efir tugagan", 404)
  return l
}
// Efir "o'rgimchak to'ri" (daraxt): efirchi 4 ta tomoshabinga, har tomoshabin yana 3 tasiga uzatadi.
// Tomoshabinlar soni cheklanmaydi: 10 000 tomoshabin ~8 bosqichda, 1 000 000 ~12 bosqichda yetadi.
const HOST_FAN = 4
const FAN = 3
async function liveCount(c: C, l: any) {
  const n = await c.db.one("SELECT COUNT(*) AS cnt FROM live_viewers WHERE live_id=?", [l.id])
  const v = Number(n?.cnt || 0)
  // Task 41: peak — bu efirning eng yuqori tomoshabinlar soni (TOP efir reytingi uchun)
  // DIQQAT: MAX(peak,?) — SQLite scalar-MAX; TiDB (MySQL) 2-argumentli MAX'ni BILMAYDI
  // → join/end har safar 500 berardi (audit isboti: run 37266389288). MySQL'da GREATEST.
  // COALESCE: peak NULL bo'lsa GREATEST NULL qaytaradi — 0 bilan himoya.
  await c.db.run("UPDATE lives SET viewers=?, peak=GREATEST(COALESCE(peak,0),?) WHERE id=?", [v, v, l.id])
  return v
}
async function detachFromParent(c: C, l: any, row: any) {
  if (!row) return
  if (row.parent_id === l.user_id) await c.db.run("UPDATE lives SET host_kids=CASE WHEN host_kids>0 THEN host_kids-1 ELSE 0 END WHERE id=?", [l.id])
  else if (row.parent_id) await c.db.run("UPDATE live_viewers SET kids=CASE WHEN kids>0 THEN kids-1 ELSE 0 END WHERE live_id=? AND user_id=?", [l.id, row.parent_id])
}
async function pickParent(c: C, l: any, me: any, exclude: number[]) {
  const fresh = await c.db.one("SELECT host_kids FROM lives WHERE id=?", [l.id])
  // O'z "farzandlari" bo'lgan tomoshabin faqat o'zidan yuqoriroq bosqichga ulanadi (aylana hosil bo'lmaydi)
  const maxDepth = me && me.kids > 0 ? me.depth - 1 : 1000
  if (Number(fresh?.host_kids || 0) < HOST_FAN && !exclude.includes(l.user_id)) return { id: l.user_id, depth: 0 }
  const ex = [c.uid, ...exclude.filter((x) => Number.isFinite(x))].slice(0, 20)
  const r = await c.db.one(
    `SELECT user_id, depth FROM live_viewers WHERE live_id=? AND ready=1 AND kids<? AND depth<=? AND user_id NOT IN (${ph(ex)}) ORDER BY depth, joined_at LIMIT 1`,
    [l.id, FAN, maxDepth, ...ex],
  )
  if (r) return { id: r.user_id, depth: r.depth }
  // Bo'sh joy topilmasa — efirchiga to'g'ridan-to'g'ri (vaqtincha ortiqcha)
  return { id: l.user_id, depth: 0 }
}
async function joinLive(c: C) {
  const l = await liveRow(c)
  if (l.user_id === c.uid) fail("Bu sizning efiringiz")
  const exclude = Array.isArray(c.b.exclude) ? c.b.exclude.map(Number) : []
  const me = await c.db.one("SELECT * FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  await detachFromParent(c, l, me)
  const par = await pickParent(c, l, me, exclude)
  const depth = par.depth + 1
  if (me) await c.db.run("UPDATE live_viewers SET parent_id=?, depth=? WHERE live_id=? AND user_id=?", [par.id, depth, l.id, c.uid])
  else await c.db.run("INSERT INTO live_viewers(live_id,user_id,parent_id,depth,kids,ready,joined_at) VALUES(?,?,?,?,0,0,?)", [l.id, c.uid, par.id, depth, now()])
  if (par.id === l.user_id) await c.db.run("UPDATE lives SET host_kids=host_kids+1 WHERE id=?", [l.id])
  else await c.db.run("UPDATE live_viewers SET kids=kids+1 WHERE live_id=? AND user_id=?", [l.id, par.id])
  const v = me ? l.viewers : await liveCount(c, l)
  const um = await usersByIds(c, [c.uid, l.user_id])
  const u = um.get(c.uid)
  const from = { id: c.uid, first_name: u.real_name }
  // Efirchi martabasi (coin darajasi) — jonli efir yuqori panelida ko'rinsin
  const hw = await c.db.one("SELECT earned FROM wallets WHERE user_id=?", [l.user_id]).catch(() => null) as any
  // Task 41: bu efir shu hafta reytingda nechinchi o'rinda (peak bo'yicha)
  const rk = await c.db.one("SELECT COUNT(*)+1 AS pos FROM lives WHERE started_at>? AND peak>?", [now() - 7 * DAY, Number(l.peak || 0)])
  const evs: Promise<unknown>[] = [notify(c.env, [par.id], { type: "live_join", live_id: l.id, from, viewers: v, parent: true })]
  if (par.id !== l.user_id && !me) evs.push(notify(c.env, [l.user_id], { type: "live_join", live_id: l.id, from, viewers: v, parent: false }))
  c.wait(Promise.all(evs))
  return json({ id: l.id, title: l.title, viewers: v, user: um.get(l.user_id) ? { ...um.get(l.user_id), lvl: levelOf(Number(hw?.earned || 0)) } : null, started_at: l.started_at, parent: par.id, depth, peak: Number(l.peak || 0), rank: Number(rk?.pos || 1) })
}
// Tomoshabin efirni olib bo'lgach, o'zi ham boshqalarga uzata oladi
async function readyLive(c: C) {
  const l = await liveRow(c)
  await c.db.run("UPDATE live_viewers SET ready=? WHERE live_id=? AND user_id=?", [c.b.ready === false ? 0 : 1, l.id, c.uid])
  return json({ ok: true })
}
async function leaveLive(c: C) {
  const l = await c.db.one("SELECT * FROM lives WHERE id=?", [+c.p.id])
  if (!l) return json({ ok: true })
  const me = await c.db.one("SELECT * FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  if (!me) return json({ ok: true })
  await detachFromParent(c, l, me)
  await c.db.run("DELETE FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
  // Uning "farzandlari" boshqa tomoshabinga qayta ulanadi
  const kids = (await c.db.q("SELECT user_id FROM live_viewers WHERE live_id=? AND parent_id=?", [l.id, c.uid])).map((r) => r.user_id)
  if (kids.length) await c.db.run("UPDATE live_viewers SET parent_id=0 WHERE live_id=? AND parent_id=?", [l.id, c.uid])
  const v = await liveCount(c, l)
  c.wait(Promise.all([
    notify(c.env, [l.user_id], { type: "live_leave", live_id: l.id, from: c.uid, viewers: v }),
    kids.length ? notify(c.env, kids, { type: "live_rejoin", live_id: l.id, from: c.uid }) : Promise.resolve(),
  ]))
  return json({ ok: true })
}
async function liveComment(c: C) {
  const l = await liveRow(c)
  const text = str(c.b.text, 300)
  const heart = !!c.b.heart
  if (!text && !heart) fail("Bo‘sh")
  const me = (await usersByIds(c, [c.uid])).get(c.uid)
  // BALL YIG'ISH: efirdagi faollik uchun kichik mukofot — har tomoshabin bir efirda ko'pi bilan 20 marta
  let rewarded = false
  if (l.user_id !== c.uid && (heart || text.length > 1)) {
    await walletOf(c, c.uid)
    const v = await c.db.one("SELECT rewarded FROM live_viewers WHERE live_id=? AND user_id=?", [l.id, c.uid])
    if (v && Number(v.rewarded) < 20) {
      await c.db.run("UPDATE live_viewers SET rewarded=rewarded+1 WHERE live_id=? AND user_id=?", [l.id, c.uid])
      const add = heart ? 1 : 2
      await c.db.run("UPDATE wallets SET coins=coins+?, earned=earned+?, updated_at=? WHERE user_id=?", [add, add, now(), c.uid])
      rewarded = true
    }
  }
  // Izoh faqat efirchiga boradi — u daraxt bo'ylab barcha tomoshabinlarga tarqatadi (server yuklanmaydi)
  c.wait(notify(c.env, [l.user_id], { type: "live_comment", live_id: l.id, from: { id: c.uid, first_name: me.real_name }, text, heart }))
  return json({ ok: true, rewarded, host: l.user_id === c.uid })
}
async function endLive(c: C) {
  const l = await liveRow(c)
  if (l.user_id !== c.uid) fail("Ruxsat yo‘q", 403)
  const top = (await c.db.q("SELECT user_id FROM live_viewers WHERE live_id=? AND parent_id=? LIMIT " + NOTIFY_CAP, [l.id, l.user_id])).map((r) => r.user_id)
  const total = await liveCount(c, l)
  await c.db.run("UPDATE lives SET ended_at=? WHERE id=?", [now(), l.id])
  await c.db.run("DELETE FROM live_viewers WHERE live_id=?", [l.id])
  // Doiradagilarga ham xabar — avatarlardagi LIVE belgisi darhol yo'qolsin
  try {
    const ids = await circle(c)
    c.wait(Promise.all([
      notify(c.env, top, { type: "live_end", live_id: l.id }),
      notify(c.env, ids, { type: "live_end", live_id: l.id, from: l.user_id }),
    ]))
  } catch { c.wait(notify(c.env, top, { type: "live_end", live_id: l.id })) }
  // Task 41: rekord — bu efir foydalanuvchining oldingi barcha efirlaridan ko'p tomoshabin yig'dimi?
  const rec = await c.db.one("SELECT MAX(peak) AS mx FROM lives WHERE user_id=? AND id<>?", [l.user_id, l.id])
  const peak = Math.max(Number(l.peak || 0), total)
  return json({ ok: true, viewers: Math.max(total, l.viewers), peak, record: peak > 0 && peak >= Number(rec?.mx || 0) })
}

// ------------------------- Coin / Martaba endpointlari -------------------------
async function getWallet(c: C) {
  const w = await walletOf(c, c.uid)
  const top = await c.db.q("SELECT user_id, earned, gifts_recv FROM wallets ORDER BY earned DESC LIMIT 15")
  const best = top.filter((x) => Number(x.earned) > 0)
  const um = await usersByIds(c, best.map((r) => r.user_id))
  return json({
    coins: Number(w.coins), earned: Number(w.earned), spent: Number(w.spent),
    gifts_sent: Number(w.gifts_sent), gifts_recv: Number(w.gifts_recv),
    level: levelOf(Number(w.earned)),
    daily_left: Math.max(0, 20 * 3600000 - (now() - Number(w.last_daily))),
    top: best.map((r, i) => ({ pos: i + 1, user: um.get(r.user_id) || null, earned: Number(r.earned), gifts: Number(r.gifts_recv) })),
  })
}
async function dailyBonus(c: C) {
  const w = await walletOf(c, c.uid)
  const left = 20 * 3600000 - (now() - Number(w.last_daily))
  if (left > 0) fail(`Kunlik bonus allaqachon olindi — ${Math.ceil(left / 3600000)} soatdan keyin yana olasiz`)
  await c.db.run("UPDATE wallets SET coins=coins+100, last_daily=?, updated_at=? WHERE user_id=?", [now(), now(), c.uid])
  const w2 = await c.db.one("SELECT coins, earned FROM wallets WHERE user_id=?", [c.uid])
  return json({ ok: true, added: 100, coins: Number(w2?.coins || 0), level: levelOf(Number(w2?.earned || 0)) })
}
async function giftLive(c: C) {
  const l = await liveRow(c)
  const gid = str(c.b.gift, 24)
  const n = Math.min(10, Math.max(1, +c.b.n || 1))
  const price = GIFTS[gid]
  if (!price) fail("Sovg‘a topilmadi")
  if (l.user_id === c.uid) fail("O‘zingizga sovg‘a yubora olmaysiz")
  const cost = price * n
  await walletOf(c, c.uid)
  await walletOf(c, l.user_id)
  const mine = await c.db.one("SELECT coins FROM wallets WHERE user_id=?", [c.uid])
  if (Number(mine?.coins || 0) < cost) fail("Coin yetarli emas — kunlik bonus oling yoki efirda izoh bilan ball to‘plang", 402)
  await c.db.run("UPDATE wallets SET coins=coins-?, spent=spent+?, gifts_sent=gifts_sent+?, updated_at=? WHERE user_id=?", [cost, cost, n, now(), c.uid])
  await c.db.run("UPDATE wallets SET coins=coins+?, earned=earned+?, gifts_recv=gifts_recv+?, updated_at=? WHERE user_id=?", [cost, cost, n, now(), l.user_id])
  const hw = await c.db.one("SELECT coins, earned FROM wallets WHERE user_id=?", [l.user_id])
  const um = await usersByIds(c, [c.uid])
  const from = um.get(c.uid)
  c.wait(notify(c.env, [l.user_id], { type: "live_gift", live_id: l.id, from: { id: c.uid, first_name: from?.real_name || "" }, gift: gid, n, cost, host_coins: Number(hw?.coins || 0) }))
  const mw = await c.db.one("SELECT coins FROM wallets WHERE user_id=?", [c.uid])
  return json({ ok: true, coins: Number(mw?.coins || 0), cost, host: { coins: Number(hw?.coins || 0), earned: Number(hw?.earned || 0) } })
}

// ========================= TARJIMON (v114) — 6 til: uz/ru/en/zh/tr/de =========================
// Foydalanuvchi talabi: chet elda (masalan Xitoyda) suhbatlashish — ovozni yozib ol, tarjima
// qilib OVOZ BILAN qaytar; PDF hujjatlarni 6 tilga tarjima. Tez va sifatli bo'lsin.
// ZANJIR (trend'da isbotlangan): Google free endpoints (2 bosqich) -> Workers AI llama zaxira.
// OVOZ: Whisper (Workers AI) matnga -> tarjima -> TTS ovoz.
// v115: o'zbek uchun HAQIQIY NEYRAL OVOZ — Microsoft Edge TTS (uz-UZ-MadinaNeural/SardorNeural).
//       Google TTS'da o'zbek YO'Q (tl=uz -> HTTP 400, tekshirildi) — TURKCHA OVOZ BEKOR QILINDI.
const TR_LANGS: Record<string, { uz: string; tts: string; flag: string }> = {
  uz: { uz: "O‘zbek", tts: "uz", flag: "🇺🇿" },
  ru: { uz: "Rus", tts: "ru", flag: "🇷🇺" },
  en: { uz: "Ingliz", tts: "en", flag: "🇬🇧" },
  zh: { uz: "Xitoy", tts: "zh-CN", flag: "🇨🇳" },
  tr: { uz: "Turk", tts: "tr", flag: "🇹🇷" },
  de: { uz: "Nemis", tts: "de", flag: "🇩🇪" },
}
// Har uid uchun engil tezlik-posboni (izolat ichida): ovoz 10/min, matn 60/min
const TR_THR = new Map<string, number[]>()
function trTez(uid: number, tur: number, limit: number): boolean {
  const t = Date.now(), k = uid + ":" + tur
  const arr = (TR_THR.get(k) || []).filter((x) => t - x < 60_000)
  if (arr.length >= limit) { TR_THR.set(k, arr); return false }
  arr.push(t); TR_THR.set(k, arr)
  if (TR_THR.size > 5000) TR_THR.clear()
  return true
}
async function tarjimaJuft(env: Env, text: string, to: string): Promise<{ t: string; from: string } | null> {
  const qisqa = text.length <= 250
  // 1a) qisqa matn: clients5 dict-chrome-ex (eng tez, trend'da isbotlangan)
  if (qisqa) try {
    const r = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=" + to + "&q=" + encodeURIComponent(text), { headers: TREND_UA })
    if (r.ok) {
      const j: any = await r.json()
      const out = Array.isArray(j) ? String(j?.[0]?.[0] ?? "").trim() : String(j?.sentences?.[0]?.trans ?? "").trim()
      if (out && out !== text) return { t: out, from: String((Array.isArray(j) && j?.[0]?.[2]) || j?.src || "auto") }
    }
  } catch {}
  // 1b) uzun matn / zaxira: gtx single (segmentlar bilan — ko'p gapirilgan matn uchun to'g'ri)
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + to + "&dt=t&q=" + encodeURIComponent(text.slice(0, 4500)), { headers: TREND_UA })
    if (r.ok) {
      const j: any = await r.json()
      const out = (j?.[0] || []).map((x: any[]) => String(x?.[0] || "")).join("").trim()
      if (out && out !== text) return { t: out, from: String(j?.[2] || "auto") }
    }
  } catch {}
  // 2) Workers AI llama — subrequest limitiga KIRMAYDI (oxirgi zaxira)
  try {
    if (!env.AI) return null
    const nom = TR_LANGS[to]?.uz || to
    const r: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You are a professional translator. Translate the user's text into " + nom + " language. Reply with ONLY the translation, nothing else." },
        { role: "user", content: text.slice(0, 1200) },
      ],
      max_tokens: 700,
    })
    const t = String(r?.response || "").trim().replace(/^(?:['‘ʻ"]|tarjima:|translation:)\s*/i, "").trim()
    if (t && t.length > 1 && t !== text) return { t, from: "auto" }
  } catch {}
  return null
}
async function tarjimaKeshli(c: C, text: string, to: string) {
  const h = await sha256(to + "|" + text)
  const ck = "https://tarjimon.50gram.internal/m/" + h
  try { const hit = await caches.default.match(ck); if (hit) { const j: any = await hit.json(); return { t: String(j.t), from: String(j.f) } } } catch {}
  const r = await tarjimaJuft(c.env, text, to)
  if (r) c.wait(caches.default.put(ck, new Response(JSON.stringify({ t: r.t, f: r.from }), { headers: { "cache-control": "public, s-maxage=21600" } })).catch(() => {}))
  return r
}
// Ovoz sintezi (v115): O'zbek — Microsoft EDGE TTS neyral ovoz (Madina=ayol, Sardor=erkak);
// qolgan tillar — Google translate_tts (180 belgili bo'laklar, baytlari birlashtiriladi).
const TTS_KESH = new Map<string, { b: string; t: number }>()
// --- EDGE TTS (bepul, kalitsiz) — token: Windows file time (5 daq. yaxlitlangan) + token -> SHA256 ---
// Manba-mos: rany2/edge-tts (drm.py + constants.py). Ovoz ro'yxati: voices/list'da uz-UZ-MadinaNeural
// va uz-UZ-SardorNeural bor (tekshirildi). Sinov: 9.1s / 4.8s haqiqiy o'zbekcha MP3 olindi.
const EJ_TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
const EJ_CHROMIUM = "143.0.3650.75"
function edgeHex32(upper?: boolean): string {
  const a = crypto.getRandomValues(new Uint8Array(16))
  let s = ""
  for (const b of a) s += b.toString(16).padStart(2, "0")
  return upper ? s.toUpperCase() : s
}
function edgeSana(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0")
  const K = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], O = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return K[d.getUTCDay()] + " " + O[d.getUTCMonth()] + " " + p(d.getUTCDate()) + " " + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " GMT+0000 (Coordinated Universal Time)"
}
function u8Birlash(list: Uint8Array[]): Uint8Array {
  const t = list.reduce((a, b) => a + b.length, 0)
  const o = new Uint8Array(t)
  let f = 0
  for (const b of list) { o.set(b, f); f += b.length }
  return o
}
async function edgeWS(url: string, cfg: string, ssml: string, dbg?: string[]): Promise<Uint8Array> {
  const maj = EJ_CHROMIUM.split(".")[0]
  let r: Response
  try {
    r = await fetch(url, {
      headers: {
        upgrade: "websocket",
        pragma: "no-cache",
        "cache-control": "no-cache",
        origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "accept-language": "en-US,en;q=0.9",
        cookie: "muid=" + edgeHex32(true) + ";",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + maj + ".0.0.0 Safari/537.36 Edg/" + maj + ".0.0.0",
      },
    } as any)
  } catch (e: any) {
    dbg?.push("fetch-throw:" + String(e?.message || e).slice(0, 60))
    throw e
  }
  const ws: any = (r as any).webSocket
  if (!ws) {
    dbg?.push("ws-yoq:" + r.status)
    throw new Error("ws-yoq:" + r.status)
  }
  dbg?.push("ws-ok:" + r.status)
  ws.accept()
  return await new Promise<Uint8Array>((res, rej) => {
    const bufs: Uint8Array[] = []
    let yakun = false
    const taymer = setTimeout(() => { try { ws.close(1000, "taymer") } catch {}; if (!yakun) { yakun = true; dbg?.push("taymer:bufs=" + bufs.length); rej(new Error("ws-taymer")) } }, 14_000)
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) {
          yakun = true; clearTimeout(taymer)
          try { ws.close(1000, "ok") } catch {}
          res(u8Birlash(bufs))
        }
        return
      }
      try {
        const dv = new DataView(ev.data as ArrayBuffer)
        const hl = dv.getUint16(0)
        const head = new TextDecoder().decode(new Uint8Array(ev.data as ArrayBuffer, 2, hl))
        if (head.includes("Path:audio") && !head.includes("audio.metadata")) bufs.push(new Uint8Array((ev.data as ArrayBuffer).slice(2 + hl)))
      } catch {}
    }
    ws.onerror = () => { clearTimeout(taymer); dbg?.push("ws-xato"); if (!yakun) { yakun = true; rej(new Error("ws-xato")) } }
    ws.onclose = () => {
      clearTimeout(taymer)
      if (!yakun) { yakun = true; dbg?.push("yopildi:bufs=" + bufs.length); if (bufs.length) res(u8Birlash(bufs)); else rej(new Error("ws-yopildi")) }
    }
    ws.send(cfg)
    ws.send(ssml)
  })
}
async function edgeMP3(text: string, voice: string, alt: boolean, dbg?: string[]): Promise<string> {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const cfg = "X-Timestamp:" + edgeSana() + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  const ssml = "X-RequestId:" + edgeHex32() + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + edgeSana() + "Z\r\nPath:ssml\r\n\r\n" +
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='uz-UZ'><voice name='" + voice + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + esc + "</prosody></voice></speak>"
  const sekin = Math.floor(Date.now() / 1000) + 11644473600
  const gec = (await sha256(String((sekin - (sekin % 300)) * 10_000_000) + EJ_TRUSTED)).toUpperCase()
  const q = "TrustedClientToken=" + EJ_TRUSTED + "&ConnectionId=" + edgeHex32() + "&Sec-MS-GEC=" + gec + "&Sec-MS-GEC-Version=1-" + EJ_CHROMIUM
  // v115.3: Workers'da outbound WebSocket FAQAT fetch+Upgrade orqali ochiladi va URL
  // https:// bo'lishi SHART (wss:// esa ishlamaydi — Cloudflare docs talabi).
  const url = alt
    ? "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?" + q
    : "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?" + q
  const b = await edgeWS(url, cfg, ssml, dbg)
  dbg?.push("bayt:" + b.length)
  return b.length > 1000 ? abToB64(b) : ""
}
// Google translate_tts — boshqa tillar uchun (o'zbek Google'da YO'Q — tl=uz 400 qaytaradi)
async function ttsG(safe: string, tl: string): Promise<string> {
  const h = (await sha256(tl + "|" + safe)).slice(0, 20)
  const hit = TTS_KESH.get(h)
  if (hit && Date.now() - hit.t < 1_800_000) return hit.b
  const parts: string[] = []
  let cur = ""
  for (const s of safe.split(/(?<=[.!?。！？;:,])\s*/)) {
    if (cur && (cur + " " + s).trim().length > 180) { parts.push(cur.trim()); cur = s } else cur = (cur + " " + s).trim()
  }
  if (cur.trim()) parts.push(cur.trim())
  if (parts.length > 5) { parts.length = 5; parts[4] = parts[4].slice(0, 180) }
  const bufs: Uint8Array[] = []
  for (let i = 0; i < parts.length; i++) {
    try {
      const r = await fetch("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + tl + "&total=" + parts.length + "&idx=" + i + "&textlen=" + parts[i].length + "&q=" + encodeURIComponent(parts[i]), { headers: TREND_UA })
      if (!r.ok) continue
      const ab = new Uint8Array(await r.arrayBuffer())
      if (ab.length > 1000) bufs.push(ab)
    } catch {}
  }
  if (!bufs.length) return ""
  const b64 = abToB64(u8Birlash(bufs))
  if (TTS_KESH.size > 80) TTS_KESH.clear()
  TTS_KESH.set(h, { b: b64, t: Date.now() })
  return b64
}
async function ttsMP3(text: string, lang: string, dbg?: string[]): Promise<string> {
  const tl = TR_LANGS[lang]?.tts || "en"
  const safe = text.replace(/\s+/g, " ").trim().slice(0, 600)
  if (!safe) return ""
  if (tl !== "uz") return ttsG(safe, tl)
  // O'zbek: HAQIQIY NEYRAL OVOZ — Edge TTS Madina (ayol) -> Sardor (erkak) -> zaxira host -> Google uz.
  // TURKCHA OVOZ OLIB TASHLANDI (foydalanuvchi talabi). Hech biri bo'lmasa audio "" — matn baribir ko'rsatiladi.
  const h = (await sha256("uz|" + safe)).slice(0, 20)
  const hit = TTS_KESH.get(h)
  if (hit && Date.now() - hit.t < 1_800_000) { dbg?.push("kesh-hit"); return hit.b }
  const urin = async (v: string, alt: boolean) => { try { return await edgeMP3(safe, v, alt, dbg) } catch { return "" } }
  const b64 = (await urin("uz-UZ-MadinaNeural", false)) || (await urin("uz-UZ-SardorNeural", false)) || (await urin("uz-UZ-MadinaNeural", true)) || (await urin("uz-UZ-SardorNeural", true)) || (await ttsG(safe, "uz"))
  if (b64) { if (TTS_KESH.size > 80) TTS_KESH.clear(); TTS_KESH.set(h, { b: b64, t: Date.now() }) }
  return b64
}
// Ovozni matnga: Whisper (Workers AI).
// v115 MUHIM TUZATISH: avval { audio: bytes } (Uint8Array) yuborilardi — JSON.stringify
// uni {"0":82,"1":73,...} OBYEKTga aylantiradi va Whisper DOIM xato qaytarardi —
// foydalanuvchi «sokin joyda gapiring» xatosini doim ko'rardi. Endi base64 + massiv urinishlari.
// v115.2: Whisper o'zbekni UYG'UR (arab yozuvi) deb transkripsiya qiladi (jonli testda
// tasdiqlandi) — arab-yozuvli natija shubhali deb, eski model ham sinanadi, baribir arab
// bo'lsa LOTIN yozuviga ko'chiriladi (o'qilishi saqlanadi — «islam alaykum bu 50 gram...»).
const AR_LAT: Record<string, string> = {
  "ش": "sh", "چ": "ch", "ڭ": "ng", "خ": "x", "غ": "g", "ژ": "j", "ج": "j",
  "ب": "b", "پ": "p", "ت": "t", "د": "d", "ر": "r", "ز": "z", "س": "s",
  "ف": "f", "ق": "q", "ك": "k", "ک": "k", "گ": "g", "ل": "l", "م": "m",
  "ن": "n", "ھ": "h", "ه": "h", "و": "o", "ۇ": "u", "ۆ": "o", "ۋ": "w",
  "ئ": "y", "ي": "y", "ی": "y", "ى": "i", "ة": "a", "ە": "a", "ې": "e",
  "ؤ": "o", "ا": "a", "ء": "",
}
function arabShubha(t: string): boolean {
  const harf = (t.match(/\p{L}/gu) || []).length
  if (harf < 8) return false
  const arab = (t.match(/[\u0600-\u06FF]/gu) || []).length
  return arab / harf > 0.6
}
function arabLotin(t: string): string {
  return t.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, (ch) =>
    /[\u064B-\u0652\u0670\u0640]/.test(ch) ? "" : (AR_LAT[ch] ?? " ")).replace(/ {2,}/g, " ").trim()
}
// v115.3: uyg'ur-arab transkripsiyasidan lotinga ko'chgan unlilarsiz matnni llama
// bilan TUZATISH («aslam lykm bo 50 grm» -> «assalomu alaykum bu 50 gram»). Xato bo'lsa aslisi qaytadi.
async function lotinTuzat(env: Env, text: string, dbg?: string[]): Promise<string> {
  try {
    if (!env.AI || !text) return text
    const r: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "Fix garbled Uzbek text. The text is phonetic Uzbek written WITHOUT vowels (auto-transliterated from Arabic-script ASR). Rewrite it as proper Uzbek in Latin script with correct vowels and apostrophes (o', g'). Reply with ONLY the corrected Uzbek text. If unsure, reply with the original text unchanged." },
        { role: "user", content: text.slice(0, 900) },
      ],
      max_tokens: 600,
    })
    const t = String(r?.response || "").trim().replace(/^["'ʻ"]/, "").trim()
    const unli = (t.match(/[aeiouou']/gi) || []).length
    dbg?.push("tuzat:" + (t && t !== text ? "ok" : "echo") + ":" + t.length)
    if (t && unli >= 3 && t.length >= Math.floor(text.length * 0.7) && t.length <= text.length * 3) return t
    return text
  } catch { dbg?.push("tuzat:xato"); return text }
}
async function whisperMatn(env: Env, bytes: Uint8Array, dbg?: string[]): Promise<string> {
  if (!env.AI) return ""
  const urin = async (m: string, audio: unknown): Promise<string> => {
    try {
      const r: any = await env.AI.run(m as any, { audio } as any)
      return String(r?.text || "").trim()
    } catch { return "" }
  }
  const b64 = abToB64(bytes)
  const arr: number[] | null = bytes.length <= 3_500_000 ? Array.from(bytes) : null
  const TURBO = "@cf/openai/whisper-large-v3-turbo", LEGACY = "@cf/openai/whisper"
  let natija = (await urin(TURBO, b64)) || (arr ? await urin(TURBO, arr) : "")
  dbg?.push("w1:" + natija.length)
  if (!natija) natija = (await urin(LEGACY, b64)) || (arr ? await urin(LEGACY, arr) : "")
  dbg?.push("w2:" + natija.length)
  if (natija && arabShubha(natija)) {
    dbg?.push("arab-shubha")
    const t2 = (await urin(LEGACY, b64)) || (arr ? await urin(LEGACY, arr) : "")
    if (t2 && !arabShubha(t2)) { dbg?.push("legacy-yaxshi"); natija = t2 }
    else natija = await lotinTuzat(env, arabLotin(natija), dbg)
  }
  return natija.slice(0, 2000)
}
async function apiTranslate(c: C) {
  const text = str(c.b.text, 5000)
  if (!text) fail("Tarjima uchun matn yuboring")
  const to = String(c.b.to || "uz")
  if (!TR_LANGS[to]) fail("Bu til qo‘llab-quvvatlanmaydi")
  if (!trTez(c.uid, 1, 60)) fail("Juda ko‘p so‘rov — bir daqiqa kuting", 429)
  let r = await tarjimaKeshli(c, text, to)
  // v115.2: xuddi shu til (yoki barcha bosqichlar javob bermasa) — matn O‘ZI qaytadi.
  // 502 «xizmat javob bermaydi» o‘rniga foydalanuvchi baribir natija ko‘radi.
  if (!r) r = { t: text, from: "auto" }
  return json({ ok: true, text, translated: r!.t, from: r!.from, to })
}
async function apiTranslateSpeech(c: C) {
  if (!trTez(c.uid, 2, 10)) fail("Ovozli tarjima limiti (10/daqiqa) — birozdan keyin urining", 429)
  const audio = String(c.b.audio || "")
  if (!audio) fail("Ovoz yozuvi yo‘q")
  const raw = audio.includes(",") ? audio.slice(audio.indexOf(",") + 1) : audio
  let bytes: Uint8Array = new Uint8Array(0)
  try { bytes = b64ToU8(raw.slice(0, 7_000_000)) } catch { fail("Ovoz yozuvini o‘qib bo‘lmadi") }
  if (bytes.length < 900) fail("Ovoz juda qisqa — yana bir marta gapirib ko‘ring")
  const to = TR_LANGS[String(c.b.to || "")] ? String(c.b.to) : "uz"
  const dbg: string[] = []
  const text = await whisperMatn(c.env, bytes, dbg)
  if (!text) fail("Ovozni aniqlab bo‘lmadi — yaqinroq borib, aniqroq gapirib ko‘ring (yoki «Matn» bo‘limidan foydalaning)", 422)
  let r = await tarjimaKeshli(c, text, to)
  // v115.2: xuddi shu til (masalan o'zbek gapirdi, natija ham o'zbek) — OVOZ BARIBIR
  // O'QILADI (echo); 502 o'rniga to'liq natija qaytadi.
  if (!r) r = { t: text, from: "auto" }
  const mp3 = await ttsMP3(r!.t, to, dbg)
  // dbg FAQAT so'rovda dbg:1 yuborgan DEV raqamga ko'rinadi (oddiy foydalanuvchiga yo'q)
  let d: string[] | undefined
  if (c.b.dbg === 1 && c.env.DEV_PHONES) {
    const uu = await c.db.one("SELECT phone FROM users WHERE id=?", [c.uid]).catch(() => null)
    const admins = listVar(c.env.DEV_PHONES).map((s) => (s.startsWith("+") ? s : "+" + s))
    if (uu && admins.includes(String(uu.phone || ""))) d = dbg
  }
  return json({ ok: true, text, translated: r!.t, from: r!.from, to, audio: mp3 ? "data:audio/mpeg;base64," + mp3 : "", dbg: d })
}

// ========================= REYTING (v114) — kanallar / guruhlar / aktiv foydalanuvchilar =========================
// Foydalanuvchi talabi: «reytinglar kanallar gruppalar va aktiv foydalanuvchi reytingi».
// Ma'lumot manbai: mavjud jadvallar (messages faolligi, chats member_count, wallets.earned
// martaba) — YANGI JADVAL YO'Q, migratsiya KERAK EMAS. 2 daqiqalik xotira-kesh — TiDB himoyasi.
const RAT_KESH = new Map<string, { j: any; t: number }>()
async function apiRating(c: C) {
  const tab = String(c.url.searchParams.get("tab") || "users")
  if (!["users", "channels", "groups"].includes(tab)) fail("Noto‘g‘ri bo‘lim")
  const hafta = now() - 7 * DAY
  let j: any = RAT_KESH.get(tab)
  if (!j || Date.now() - j.t > 120_000) {
    let list: any[] = []
    if (tab === "users") {
      const rows = await c.db.q(
        "SELECT m.sender_id AS id, COUNT(*) AS n, u.first_name, u.last_name, u.username, u.avatar_ver, COALESCE(w.earned,0) AS earned " +
        "FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN wallets w ON w.user_id=m.sender_id " +
        "WHERE m.deleted=0 AND m.created_at>=? AND m.sender_id>0 AND u.blocked=0 " +
        "GROUP BY m.sender_id ORDER BY n DESC LIMIT 50", [hafta]).catch(() => [])
      list = (rows || []).map((r: any) => ({
        id: Number(r.id), n: Number(r.n), earned: Number(r.earned || 0),
        first_name: r.first_name || "", last_name: r.last_name || "", username: r.username || "", avatar_ver: Number(r.avatar_ver || 0),
      }))
    } else if (tab === "channels") {
      const rows = await c.db.q(
        "SELECT c.id, c.title, c.username, c.avatar_ver, c.member_count, c.last_msg_at, " +
        "(SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.deleted=0 AND m.created_at>=?) AS n7 " +
        "FROM chats c WHERE c.type='channel' AND c.is_public=1 AND c.blocked=0 " +
        "ORDER BY c.member_count DESC LIMIT 50", [hafta]).catch(() => [])
      list = (rows || []).map((r: any) => ({
        id: Number(r.id), title: r.title || "", username: r.username || "", avatar_ver: Number(r.avatar_ver || 0),
        member_count: Number(r.member_count || 0), n7: Number(r.n7 || 0), last_msg_at: Number(r.last_msg_at || 0),
      }))
    } else {
      const rows = await c.db.q(
        "SELECT c.id, c.title, c.username, c.avatar_ver, c.member_count, c.last_msg_at, " +
        "(SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id AND m.deleted=0 AND m.created_at>=?) AS n7 " +
        "FROM chats c WHERE c.type='group' AND c.is_public=1 AND c.blocked=0 " +
        "ORDER BY n7 DESC, c.member_count DESC LIMIT 50", [hafta]).catch(() => [])
      list = (rows || []).map((r: any) => ({
        id: Number(r.id), title: r.title || "", username: r.username || "", avatar_ver: Number(r.avatar_ver || 0),
        member_count: Number(r.member_count || 0), n7: Number(r.n7 || 0), last_msg_at: Number(r.last_msg_at || 0),
      }))
    }
    j = { list, t: Date.now() }
    if (RAT_KESH.size > 8) RAT_KESH.clear()
    RAT_KESH.set(tab, j)
  }
  // Mening o'rnim (faqat users tab): mavqeni hisoblash — 2 yengil so'rov
  let me: any = null
  if (tab === "users") {
    try {
      const mine = await c.db.one("SELECT COUNT(*) AS n FROM messages WHERE deleted=0 AND created_at>=? AND sender_id=?", [hafta, c.uid])
      const n = Number(mine?.n || 0)
      if (n > 0) {
        const hi = await c.db.one("SELECT COUNT(*) AS c FROM (SELECT sender_id FROM messages WHERE deleted=0 AND created_at>=? AND sender_id>0 AND sender_id<>? GROUP BY sender_id HAVING COUNT(*) > ?) x", [hafta, c.uid, n])
        me = { n, rank: Number(hi?.c || 0) + 1 }
      }
    } catch {}
  }
  return json({ ok: true, tab, list: j.list, me })
}

// ------------------------- Kanal postlari izohlari -------------------------
async function msgCommentsAllowed(c: C, mid: number) {
  await ensureSchema(c.db)
  const m = await c.db.one("SELECT * FROM messages WHERE id=?", [mid])
  if (!m || m.deleted) fail("Xabar topilmadi", 404)
  const ch = await needChat(c, m.chat_id)
  if (ch.type !== "channel") fail("Izohlar faqat kanal postlarida")
  if (!parse(ch.settings, DEF_SET).comments) fail("Bu kanalda izohlar o‘chirilgan")
  const mem = await member(c, m.chat_id)
  if (!mem || mem.status !== "active") fail("Izoh yozish uchun kanal a'zosi bo‘ling", 403)
  return { m, ch }
}
async function listMsgComments(c: C) {
  const { m, ch } = await msgCommentsAllowed(c, +c.p.id)
  const mem = await member(c, m.chat_id)
  const adm = isAdm(mem)
  const rows = await c.db.q("SELECT * FROM msg_comments WHERE message_id=? ORDER BY id ASC LIMIT 200", [m.id])
  const um = await usersByIds(c, rows.map((r) => r.user_id))
  return json({
    comments: rows.map((r) => ({ id: r.id, user_id: r.user_id, body: r.body, created_at: r.created_at, mine: r.user_id === c.uid, can_del: r.user_id === c.uid || adm })),
    users: Object.fromEntries(um),
    count: rows.length,
    readonly: ch.type === "channel" && !isAdm(await member(c, m.chat_id)) && parse(ch.permissions, DEF_PERMS).send === 0 ? 0 : 1,
  })
}
async function addMsgComment(c: C) {
  const { m } = await msgCommentsAllowed(c, +c.p.id)
  const body = str(c.b.text || c.b.body, 500)
  if (!body) fail("Bo‘sh izoh")
  const id = newId(), t = now()
  await c.db.run("INSERT INTO msg_comments(id,chat_id,message_id,user_id,body,created_at) VALUES(?,?,?,?,?,?)", [id, m.chat_id, m.id, c.uid, body, t])
  const um = await usersByIds(c, [c.uid])
  const me = um.get(c.uid)
  // Post muallifiga real vaqt bildirishnoma
  c.wait(notify(c.env, [m.sender_id], { type: "comment", chat_id: m.chat_id, mid: m.id, from: me }))
  return json({ ok: true, comment: { id, user_id: c.uid, body, created_at: t, mine: true, can_del: true }, users: Object.fromEntries(um) })
}
async function delMsgComment(c: C) {
  const { m } = await msgCommentsAllowed(c, +c.p.id)
  const row = await c.db.one("SELECT * FROM msg_comments WHERE id=?", [+c.p.cid])
  if (!row || row.message_id !== m.id) fail("Izoh topilmadi", 404)
  const mem = await member(c, m.chat_id)
  if (row.user_id !== c.uid && !isAdm(mem)) fail("Faqat o‘z izohingizni o‘chirasiz", 403)
  await c.db.run("DELETE FROM msg_comments WHERE id=?", [row.id])
  return json({ ok: true })
}

// ------------------------- P2P tarmoq ("o'rgimchak to'ri") -------------------------
// Server fayl/xabar muddati tugab o'chirgandan keyin ham, ma'lumot onlayn foydalanuvchilar
// qurilmasidan boshqa a'zoga WebRTC orqali to'g'ridan-to'g'ri uzatiladi.
// Server faqat: kimda nima borligini, ruxsatni va imzoni (soxtalashtirilmaganini) tekshiradi.
const ONLINE_MS = 70000
function sigText(m: any) {
  return [m.id, m.chat_id, m.sender_id, m.kind, m.body ?? "", JSON.stringify(m.meta ?? {}), m.created_at].join("|")
}
function signMsg(env: Env, m: any) { return hmacHex(env.JWT_SECRET, sigText(m)) }
// Foydalanuvchi chatni ko'rish huquqiga egami (a'zo yoki ochiq guruh/kanal). chat=0 — ochiq lenta
async function canSee(c: C, uid: number, chatId: number) {
  if (chatId === 0) return true
  const r = await c.db.one(
    "SELECT ch.type, ch.is_public, m.status FROM chats ch LEFT JOIN chat_members m ON m.chat_id=ch.id AND m.user_id=? WHERE ch.id=?",
    [uid, chatId])
  if (!r) return false
  if (r.status === "active") return true
  return r.status !== "banned" && r.type !== "direct" && !!r.is_public
}
// ------------------------- O'RGIMCHAK TO'RI — ALOHIDA MODUL (spiderweb.ts, Task 46) -------------------------
// To'r mantiqining O'ZI endi spiderweb.ts'da (alohida yozilgan, masshtablangan: 100–100 000
// foydalanuvchi). Bu yerda faqat fabrika chaqiriladi va fayl-tiklash (o'z-o'zini davolash)
// endpointlari turadi — baytlar hech qachon serverda ko'paymaydi, server faqat ko'prik.
const SW = makeSpiderWeb({ str, json, fail, now, ph, canSee, notify, signMsg, ONLINE_MS })

// v97 TO'R O'Z-O'ZINI TIKLASH — detektor: o'qish paytida bo'lak topilmasa fayl «gone=1»
// (server nusxasi yo'q) deb belgilanadi va to'r DARHOL nusxa-yig'ish vazifalarini tuzadi
// (planReplicas). Fayl nusxalari qurilmalarda saqlangan — keyingi onlayn a'zo uni olib,
// /media/:id/restore-info → PUT → done yo'li bilan server nusxasini O'ZI tiklaydi.
// Hech narsa yo'qolmaydi: server kesh qilib bo'lguncha to'r o'zi yetkazadi.
async function goneDetect(c: C, id: string) {
  try {
    const m = await c.db.one("SELECT id FROM media WHERE id=? AND keep=1 AND complete=1 AND dropped=0 AND gone=0", [id])
    if (!m) return
    await c.db.run("UPDATE media SET gone=1, next_check=0 WHERE id=?", [id])
    c.wait(SW.planReplicas(c.db, 1, id))
    jurnalYoz(c.env, "mediaChunk", c.uid, "gone", "nusxa yoq — torga topshirildi " + id.slice(0, 8))
  } catch {}
}

// v97: TIKLASH MA'LUMOTI — server nusxasi yo'qolgan (gone=1) fayl uchun to'r a'zosi
// bo'laklar soni va sha'sini oladi, o'zidagi shifrlangan nusxani qayta yuklab serverni tiklaydi
async function mediaRestoreInfo(c: C) {
  const m = await c.db.one("SELECT id,owner_id,chat_id,chunks,sha,size,gone,dropped,complete FROM media WHERE id=?", [c.p.id])
  if (!m || !m.complete || m.dropped || m.gone !== 1) fail("Topilmadi", 404)
  if (m.owner_id !== c.uid && !(await canSee(c, c.uid, Number(m.chat_id))) && !(await SW.hasJob(c, m.id, c.uid))) fail("Ruxsat yo‘q", 403)
  return json({ gone: 1, chunks: m.chunks, sha: m.sha, size: m.size })
}

// XATO JURNALINI O'QISH — FAQAT EGAGA (DEV_PHONES). Boshqa har kim uchun yo'l mavjudligi
// ham oshkor qilinmaydi (oddiy "Not found" 404 — firewall doktrinasi bilan bir xil).
// Parametr: ?n=150 (1..300) — so'nggi n yozuv, eng yangisi birinchi.
async function adminJurnal(c: C) {
  try { await ensureSchema(c.db) } catch {} // err_jurnal jadvali birinchi o'qishdan oldin ham bo'lsin
  const u = await c.db.one("SELECT phone FROM users WHERE id=?", [c.uid]).catch(() => null)
  const admins = listVar(c.env.DEV_PHONES).map((s) => (s.startsWith("+") ? s : "+" + s))
  if (!u || !admins.includes(String(u.phone || ""))) return FW_404()
  const n = Math.min(300, Math.max(1, Math.floor(+(c.url.searchParams.get("n") || 150) || 150)))
  const rows = await c.db.q("SELECT id, ts, path, uid, src, msg FROM err_jurnal ORDER BY id DESC LIMIT " + n)
  return json({ items: rows, now: now() })
}

// =====================================================================
// MAXFIY ADMIN PANEL (v104 → v105 KENGAYTIRILGAN) — FAQAT SAYT EGASI uchun (50gram.uz/?adminpanel)
// ---------------------------------------------------------------------
// MANZIL: 50gram.uz/?adminpanel → parol → panel (statistika, foydalanuvchilar,
//   davlatlar, bloklash, hammaga xabar). Ilova ichida (web/) panel haqida BITTA
//   BAYT YO'Q: havola yo'q, fayl yo'q — sahifa shu fayldan (worker xotirasidan)
//   beriladi, noindex+nofollow (qidiruvchilarga yopiq, tab sarlavhasi neytral).
// XAVFSIZLIK:
//  • Parol: env.ADMIN_PASS (wrangler.toml) — bo'lmasa zaxira qiymat ishlaydi.
//    Xato parol urinishlari OTP brute-force posboni bilan BIR XIL hisoblanadi
//    (12 xato/1 soat → DO'da 24 soat IP-blok — hujumchiga oddiy "Not found").
//  • Sessiya: JWT_SECRET bilan imzolangan adm-token (12 soat) — tashqaridan
//    soxta qilib bo'lmaydi; har panel-so'rovida tekshiriladi (admAuth).
//  • Yo'l: /api/panel/* — FW_TRAP ro'yxatiga KIRMAYDI (u faqat /adm*, /admin,
//    /debug... ni oladi) va skanerlar lug'atida yo'q; orqada baribir parol+token.
// BLOK: users.blocked=1 → sessiya-darvoza (har autentifikatsiyalangan so'rov),
//   /ws va kirish (authOtp/authVerify) darhol 401 — foydalanuvchi ilovaga kira olmaydi.
// BROADCAST: "50gram admin" tizim yuboruvchisi (ADM_ID) har foydalanuvchi bilan
//   direct chat ochib ODATIY xabar yuboradi — klient kodiga 0 BAYT tegilmagan:
//   xabar foydalanuvchining xabar bo'limida o'zi paydo bo'ladi (onlaynlar ≤30s,
//   qolganlar ilova ochilganda). Paneldagi "barchasi" — bloklanganlar va adminni
//   o'zi bloklaganlar chisqishtiriladi.
// SUBREQUEST-BYUDJET: bepul planda so'roviga 50 subrequest — broadcast HAMMASI
//   ko'p-qatorli INSERT/UPDATE (batch 400) bilan yoziladi (2000 ta ≈ 34 so'rov).
// v105 YANGI:
//  • XAVFSIZLIK BO'LIMI: har himoya-ochko/blok → sec_events (D1) — IP, DAVLAT
//    (Cloudflare cf.country — bepul geo), shahar, hujum TURI, ilovaning QAYSI
//    QISMIGA (yo'l), chora (blok/ushlandi). Statistika: 24soat/7kun/jami urinish,
//    noyob IP'lar, turlar/davlatlar/qismlar taqsimoti, so'nggi 80 hujum jadvali.
//  • SIGNALIZATSIYA: jiddiy blok (root/ext/inj/data/auth) → DARHOL sec_alarm
//    → panelda QIZIL PARCHA QAYTUVCHI banner (egaga "hujum bo'ldi, bloklandi"
//    xabari). 10 daqiqada 8+ urinish ham signal. 30 daqiqada signal-spam yo'q.
//  • ALOHIDA XABAR (POST /panel/dm): "50gram admin" nomidan BITTA foydalanuvchiga.
//  • FOYDALANUVCHI MA'LUMOT OYNASI (GET /panel/user?id=): to'liq profil + xabar/
//    suhbat/qo'ng'iroq/fayl statistikasi + bloklash/xabar tugmalari bilan modal.
// =====================================================================
const ADM_ID = 990000000001
const ADM_PHONE = "+999900000001" // +999 davlat kodi HAQIQIYATDA mavjud emas — hech qachon to'qnashmaydi

// Telefon prefiksi → davlat (ISO) — web/core.js CC_LIST (56 davlat) bilan bir manba
const CC_DIAL: Array<[string, string]> = [
  ["998", "UZ"], ["996", "KG"], ["992", "TJ"], ["995", "GE"], ["994", "AZ"], ["993", "TM"],
  ["380", "UA"], ["375", "BY"], ["374", "AM"], ["373", "MD"], ["372", "EE"], ["371", "LV"],
  ["370", "LT"], ["385", "HR"], ["381", "RS"], ["359", "BG"], ["358", "FI"], ["351", "PT"],
  ["972", "IL"], ["971", "AE"], ["966", "SA"], ["964", "IQ"], ["98", "IR"], ["93", "AF"],
  ["90", "TR"], ["86", "CN"], ["82", "KR"], ["81", "JP"], ["91", "IN"], ["92", "PK"],
  ["84", "VN"], ["66", "TH"], ["62", "ID"], ["60", "MY"], ["63", "PH"], ["55", "BR"],
  ["49", "DE"], ["48", "PL"], ["46", "SE"], ["47", "NO"], ["45", "DK"], ["44", "GB"],
  ["43", "AT"], ["41", "CH"], ["39", "IT"], ["36", "HU"], ["34", "ES"], ["33", "FR"],
  ["31", "NL"], ["30", "GR"], ["40", "RO"], ["420", "CZ"], ["7", "KZ"], ["1", "US"],
]
function ccOf(phone: unknown): string {
  const d = String(phone || "").replace(/\D/g, "")
  for (let k = 3; k >= 1; k--) {
    for (const [pre, iso] of CC_DIAL) {
      if (pre !== d.slice(0, k)) continue
      // +7 ikki davlatga ulashadi: 9xx→Rossiya, qolganlari Qozog'iston (v101 kirish-qoidasi bilan bir xil)
      if (iso === "KZ") return d[1] === "9" ? "RU" : "KZ"
      return iso
    }
  }
  return "XX"
}

// Har panel-so'rovida: Bearer adm-token (JWT_SECRET imzosi, adm:1 klaim) tekshiriladi
async function admAuth(c: C) {
  const token = (c.req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const p = token ? await verifyJwt(token, c.env.JWT_SECRET) : null
  if (!p || p.adm !== 1) fail("Ruxsat yo‘q", 401)
}

async function panelLogin(c: C) {
  const pass = str(c.b.pass, 64)
  const want = str(c.env.ADMIN_PASS || "Balandtoglar1", 64)
  if ((await sha256("g50adm:" + pass)) !== (await sha256("g50adm:" + want))) {
    const ip = fwIp(c.req)
    if (ip) {
      // OTP-brute posboni: 12 xato parol/1 soat → 24 soat doimiy IP-blok (javob — oddiy "Not found")
      if (fwLokal(ip, "auth", 12, 24 * 3_600_000)) { fwOchko(c.env, c.wait, ip, "auth", 1, secInfo(c.req, c.url)); return FW_404() }
      fwOchko(c.env, c.wait, ip, "auth", 1, secInfo(c.req, c.url))
    }
    fail("Parol noto‘g‘ri", 401)
  }
  return json({ token: await signJwt({ adm: 1 }, c.env.JWT_SECRET, 12 * 3600), now: now() })
}

async function panelStats(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const t = now()
  const [u, m, ch, cl, phones] = await Promise.all([
    c.db.one(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS blk,
        SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS d1,
        SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS d7,
        SUM(CASE WHEN last_seen>? THEN 1 ELSE 0 END) AS on5,
        SUM(CASE WHEN last_seen>? THEN 1 ELSE 0 END) AS a24,
        SUM(CASE WHEN last_seen>? THEN 1 ELSE 0 END) AS a7
       FROM users WHERE id<>${ADM_ID}`,
      [t - DAY, t - 7 * DAY, t - 5 * 60_000, t - DAY, t - 7 * DAY],
    ),
    c.db.one("SELECT COUNT(*) AS n FROM messages WHERE deleted=0").catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM chats").catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM calls").catch(() => null),
    c.db.q("SELECT phone FROM users WHERE id<>" + ADM_ID + " AND blocked=0").catch(() => [] as any[]),
  ])
  const cc: Record<string, number> = {}
  for (const r of phones) { const k = ccOf(r.phone); cc[k] = (cc[k] || 0) + 1 }
  return json({
    total: Number(u?.total || 0), blocked: Number(u?.blk || 0),
    today: Number(u?.d1 || 0), week: Number(u?.d7 || 0),
    online: Number(u?.on5 || 0), active24: Number(u?.a24 || 0), active7: Number(u?.a7 || 0),
    messages: Number(m?.n || 0), chats: Number(ch?.n || 0), calls: Number(cl?.n || 0),
    countries: Object.keys(cc).map((k) => ({ cc: k, n: cc[k] })).sort((a, b) => b.n - a.n),
    now: t,
  })
}

async function panelUsers(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const page = Math.max(1, Math.min(500, Math.floor(+(c.url.searchParams.get("page") || 1) || 1)))
  const qq = str(c.url.searchParams.get("q"), 32)
  const conds = ["id<>" + ADM_ID]
  const params: unknown[] = []
  if (c.url.searchParams.get("blocked") === "1") conds.push("blocked=1")
  if (qq) {
    const like = "%" + qq.replace(/[%_]/g, "") + "%"
    conds.push("(phone LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR username LIKE ?)")
    params.push(like, like, like, like)
  }
  const w = "WHERE " + conds.join(" AND ")
  const LIM = 50
  const [rows, cnt] = await Promise.all([
    c.db.q(`SELECT id,phone,first_name,last_name,username,avatar_ver,created_at,last_seen,blocked FROM users ${w} ORDER BY id DESC LIMIT ${LIM} OFFSET ${(page - 1) * LIM}`, params),
    c.db.one(`SELECT COUNT(*) AS n FROM users ${w}`, params),
  ])
  return json({
    users: rows.map((r) => ({
      id: +r.id, phone: r.phone, name: ((r.first_name || "") + " " + (r.last_name || "")).trim(),
      username: r.username || "", av: +r.avatar_ver || 0, cr: +r.created_at || 0, ls: +r.last_seen || 0,
      bl: +r.blocked === 1, cc: ccOf(r.phone),
    })),
    total: Number(cnt?.n || 0), page, pages: Math.max(1, Math.ceil(Number(cnt?.n || 0) / LIM)), now: now(),
  })
}

async function panelBlock(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const on = c.b?.on ? 1 : 0
  if (!id || id === ADM_ID) fail("Noto‘g‘ri foydalanuvchi", 400)
  if (!(await c.db.one("SELECT id FROM users WHERE id=?", [id]))) fail("Foydalanuvchi topilmadi", 404)
  await c.db.run("UPDATE users SET blocked=? WHERE id=?", [on, id])
  const uu = await c.db.one("SELECT first_name, last_name, phone FROM users WHERE id=?", [id]).catch(() => null)
  await admLog(c, on ? "foy_blok" : "foy_blok_och", "user:" + id,
    (on ? "BLOKLANDI" : "Blok olib tashlandi") + ": " + ((uu ? (uu.first_name || "") + " " + (uu.last_name || "") : "") || "").trim().slice(0, 40) + " " + (uu?.phone || ""))
  return json({ ok: true, id, blocked: on })
}

// Tizim yuboruvchisi ("50gram admin") — bir marta yaratiladi, panelda KO'RINMAYDI,
// hech qachon onlayn emas (last_seen=0), qidiruvda oddiy tinch profil.
async function admSysUser(db: Db) {
  if (await db.one("SELECT id FROM users WHERE id=?", [ADM_ID])) return
  await db.run("INSERT INTO users(id,phone,first_name,last_name,created_at,last_seen) VALUES(?,?,?,?,?,0)", [ADM_ID, ADM_PHONE, "50gram", "admin", now()])
}

// Tizim yuboruvchi ("50gram admin") yozishmalarini bildirish: onlayn qabul qiluvchilarga
// WS hodisa (chat darhol paydo bo'ladi), qolganlar ilova ochilganda chatlar ro'yxatidan oladi.
// v108 tuzatish: avval broadcast HECH QANDAY hodisa yubormasdi — onlaynlar ham 30s kutardi.
function admNotify(c: C, pairs: Array<{ uid: number; chat: number; msg: any }>) {
  // ≤30 onlayn foydalanuvchi — subrequest-byudjet posboni (har biri 1 DO push)
  for (const p of pairs.slice(0, 30)) {
    try {
      c.wait((async () => {
        const stub = c.env.USER_SOCKET.get(c.env.USER_SOCKET.idFromName(String(p.uid)))
        await stub.fetch("https://do/push", { method: "POST", body: JSON.stringify({ type: "message", chat_id: p.chat, message: p.msg }) })
      })().catch(() => {}))
    } catch {}
  }
}

// v108: e'lon rasmini saqlash — klient bilan AYNAN bir xil shifrlash-sxema (AES-GCM):
// panel rasmni o'zi shifrlaydi (key/iv bilan) va base64 qilib yuboradi — worker bo'laklab
// R2'ga yozadi + media yozuvi yaratadi. Klient uchun bu ODDIY foto xabar (0 bayt farq).
async function admStoreImage(c: C, img: { b64: string; mime: string; key: string; iv: string; sha: string; name: string }): Promise<string> {
  const bytes = b64ToU8(String(img.b64 || ""))
  if (!bytes.length) fail("Rasm bo‘sh", 400)
  if (bytes.length > 8 * 1024 * 1024) fail("Rasm 8 MB dan oshmasin", 400)
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(String(img.mime || "")) ? String(img.mime) : "image/jpeg"
  const sha = /^[a-f0-9]{64}$/.test(String(img.sha || "")) ? String(img.sha) : null
  const CHUNKB = 512 * 1024
  const n = Math.max(1, Math.ceil(bytes.length / CHUNKB))
  if (n > 16) fail("Rasm juda katta", 400)
  const id = randomStr(22)
  const t = now()
  await c.db.run("INSERT INTO media(id,owner_id,mime,name,size,chunks,complete,sha,created_at,expires_at,keep,next_check) VALUES(?,?,?,?,?,?,1,?,?,?,?,0)",
    [id, ADM_ID, mime, String(img.name || "elon").slice(0, 200) || "elon", bytes.length, n, sha, t, t + 100 * 365 * DAY, 1])
  for (let i = 0; i < n; i++) {
    const part = bytes.subarray(i * CHUNKB, Math.min(bytes.length, (i + 1) * CHUNKB))
    if (c.env.BUCKET) {
      try { await c.env.BUCKET.put(`m/${id}/${i}`, part); continue } catch {}
    }
    await c.db.run("INSERT INTO media_chunks(media_id,idx,data) VALUES(?,?,?)", [id, i, abToB64(part)]).catch(() => {})
  }
  return id
}

async function panelBroadcast(c: C) {
  await admAuth(c)
  // v108 TUZATISH: ensureSchema OLINGAN — sovuq izolyatda 35 ketma-ket HTTP so'rov qilib
  // bepul-reja 50-subrequest byudjetini YOPIB qo'yardi va broadcast o'rtada o'lib qolardi
  // («oddiy xabar yozish ishlamayapti» shikoyatining ildizi). Bu yo'lda faqat bazaviy
  // jadvallar (users/chats/messages/blocks — ilova kafolati) + adm_log (admLog o'zi himoyalangan) ishlatiladi.
  const body = str(c.b.body, 4096)
  const img = c.b?.img && typeof c.b.img === "object" ? c.b.img as any : null
  if (!body && !img) fail("Xabar matni bo‘sh", 400)
  await admSysUser(c.db)
  // v108: uid — faqat bitta foydalanuvchiga sinov-yuborish (CI E2E va eganing tekshiruvi uchun)
  const onlyUid = Math.floor(+(c.b?.uid) || 0)
  const t = now()
  // "barchasi" = bloklanganlar YO'Q + adminni o'zi bloklaganlar YO'Q (foydalanuvchi xohishi hurmat)
  const where = onlyUid
    ? `WHERE id=${onlyUid}`
    : `WHERE id<>${ADM_ID} AND blocked=0 AND id NOT IN (SELECT user_id FROM blocks WHERE blocked_id=${ADM_ID})`
  const total = Number((await c.db.one("SELECT COUNT(*) AS n FROM users " + where))?.n || 0)
  if (!total) fail("Yuborish uchun foydalanuvchi topilmadi", 400)
  const rows = await c.db.q("SELECT id FROM users " + where + " ORDER BY id LIMIT 2000")
  const targets = rows.map((r) => +r.id)
  // v108: rasm bir marta saqlanadi (barcha xabarlarga BITTA media_id — R2'da bitta nusxa)
  let meta: any = null, kind = "text"
  if (img) {
    const mid2 = await admStoreImage(c, img)
    kind = "photo"
    meta = { media_id: mid2, sha: String(img.sha || ""), size: Number(img.size) || 0, key: String(img.key || ""), iv: String(img.iv || ""), mime: String(img.mime || "image/jpeg"), name: String(img.name || "elon.jpg").slice(0, 200), fsize: Number(img.fsize) || 0 }
  }
  const CS = 400
  let newChats = 0, sent = 0, failed = 0
  const notified: Array<{ uid: number; chat: number; msg: any }> = []
  for (let i = 0; i < targets.length; i += CS) {
    const part = targets.slice(i, i + CS)
    const keys = part.map((uid) => (uid < ADM_ID ? uid + ":" + ADM_ID : ADM_ID + ":" + uid))
    const ex = await c.db.q(`SELECT id, direct_key FROM chats WHERE direct_key IN (${ph(keys)})`, keys)
    const have = new Map<string, number>(ex.map((r) => [String(r.direct_key), +r.id]))
    const chatIds: number[] = [], insChats: unknown[] = [], insMem: unknown[] = []
    for (let j = 0; j < part.length; j++) {
      const chid = have.get(keys[j])
      if (chid) { chatIds.push(chid); continue }
      const nid = newId()
      chatIds.push(nid)
      insChats.push([nid, "direct", ADM_ID, 0, randomStr(10), keys[j], 2, t, t])
      insMem.push([nid, ADM_ID, "member", t], [nid, part[j], "member", t])
    }
    if (insChats.length) {
      await c.db.run(
        `INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES ${insChats.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
        insChats.flat(),
      )
      await c.db.run(
        `INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES ${insMem.map(() => "(?,?,?,?)").join(",")}`,
        insMem.flat(),
      )
      newChats += insChats.length
    }
    // xabar id'lari: t*1000+seq — ketma-ket noyob; PK to'qnashuvda — 50-lik bo'laklarda yangi id bilan
    const mrows: unknown[] = []
    for (let j = 0; j < chatIds.length; j++)
      mrows.push([t * 1000 + i + j, chatIds[j], ADM_ID, kind, body || null, meta ? JSON.stringify(meta) : null, t, t, t + 100 * 365 * DAY])
    if (mrows.length) {
      try {
        await c.db.run(
          `INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES ${mrows.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
          mrows.flat(),
        )
      } catch {
        // v108: butun batch yiqilsa — 50-lik bo'laklar bilan (yangi id) qayta urinish;
        // bo'lak yiqilsa — xar biri alohida (shu bo'lak ichida ≤50 — byudjet posboni)
        for (let k = 0; k < mrows.length; k += 50) {
          const chunk = (mrows.slice(k, k + 50) as unknown[][]).map((r) => [newId(), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]])
          try {
            await c.db.run(
              `INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
              chunk.flat(),
            )
          } catch {
            for (const r of chunk)
              await c.db.run("INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)", [newId(), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]]).catch(() => { failed++ })
          }
        }
      }
      await c.db.run(`UPDATE chats SET last_msg_at=? WHERE id IN (${ph(chatIds)})`, [t, ...chatIds])
      sent += mrows.length
      // v108: shu batchdagi onlayn qabul qiluvchilarga WS hodisa (chat DARHOL paydo bo'ladi)
      const onl = await c.db.q(`SELECT id FROM users WHERE id IN (${ph(part)}) AND last_seen>${t - 300_000}`).catch(() => [] as any[])
      if (onl.length) {
        const onlSet = new Set(onl.map((r) => +r.id))
        for (let j = 0; j < part.length && notified.length < 30; j++) {
          if (!onlSet.has(part[j])) continue
          notified.push({ uid: part[j], chat: chatIds[j], msg: { id: Number((mrows[j] as unknown[])[0]), chat_id: chatIds[j], sender_id: ADM_ID, kind, body: body || null, meta: meta || {}, edited: 0, deleted: 0, created_at: t, updated_at: t } })
        }
      }
    }
  }
  if (notified.length) admNotify(c, notified)
  const what = kind === "photo" ? "RASM+E'LON" : "E'LON"
  await admLog(c, "hammaga_xabar", "barcha", `${what} yuborildi (${sent} foydalanuvchiga, ${newChats} yangi suhbat${failed ? ", " + failed + " YETMADI" : ""}): ` + (body || "[rasm]").slice(0, 120))
  return json({ ok: true, sent, failed, new_chats: newChats, total, online: notified.length, now: t })
}

// ---- v105: XAVFSIZLIK BO'LIMI — egada hujumlar haqida TO'LIQ ma'lumot oynasi ----
// Kim (IP), qayerdan (davlat/shahar), qancha urinish, QANDAY hujum turi, ilovaning
// QAYSI QISMIGA, qanday chora qilingan (blok/ochko) — hammasi sec_events'dan.
// Signalizatsiya holati — sec_alarm'dan (oxirgi signal 30 daqiqa ichida = FAOL signal).
async function panelSecurity(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const t = now()
  const [e24, e7, eall, uip, byKind, byCc, byPath, recent, alarms, lastAl] = await Promise.all([
    c.db.one("SELECT COUNT(*) AS n FROM sec_events WHERE ts>?", [t - DAY]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM sec_events WHERE ts>?", [t - 7 * DAY]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM sec_events").catch(() => null),
    c.db.one("SELECT COUNT(DISTINCT ip) AS n FROM sec_events WHERE ts>?", [t - 7 * DAY]).catch(() => null),
    c.db.q("SELECT kind, COUNT(*) AS n FROM sec_events WHERE ts>? GROUP BY kind ORDER BY n DESC LIMIT 12", [t - 7 * DAY]).catch(() => [] as any[]),
    c.db.q("SELECT cc, COUNT(*) AS n FROM sec_events WHERE ts>? GROUP BY cc ORDER BY n DESC LIMIT 12", [t - 7 * DAY]).catch(() => [] as any[]),
    c.db.q("SELECT path, COUNT(*) AS n FROM sec_events WHERE ts>? GROUP BY path ORDER BY n DESC LIMIT 10", [t - 7 * DAY]).catch(() => [] as any[]),
    c.db.q("SELECT id, ts, ip, cc, city, kind, path, act, note FROM sec_events ORDER BY id DESC LIMIT 80").catch(() => [] as any[]),
    c.db.q("SELECT id, ts, kind, ip, cc, n, note FROM sec_alarm ORDER BY id DESC LIMIT 20").catch(() => [] as any[]),
    c.db.one("SELECT ts, kind, ip, cc, note FROM sec_alarm ORDER BY id DESC LIMIT 1").catch(() => null),
  ])
  // Hozir blokda turgan IP'lar soni — SEC DO (doimiy bloklar ombori) — faqat egaga ko'rinadi
  // v106: shu javobda himoya-holati (fwoff) ham qaytadi — DO yagona ishonchli manba
  let blocks = 0, fwoff = 0, blocksTop: Array<{ ip: string; until: number; ms: number }> = []
  try {
    const r = await c.env.SEC!.get(c.env.SEC!.idFromName("global")).fetch("https://fw/?op=refresh")
    const j: any = await r.json()
    const bl: Array<[string, number]> = j.blocks || []
    blocks = bl.length
    fwoff = j.fwoff ? 1 : 0
    blocksTop = bl
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([ip, until]) => ({ ip, until: Number(until), ms: Number(until) - t }))
  } catch {}
  return json({
    e24: Number(e24?.n || 0), e7: Number(e7?.n || 0), eall: Number(eall?.n || 0), uip: Number(uip?.n || 0),
    blocks, blocksTop, fwoff,
    kinds: (byKind as any[]).map((r) => ({ k: r.kind, n: Number(r.n), name: SEC_KIND_UZ[String(r.kind)] || String(r.kind) })),
    ccs: (byCc as any[]).map((r) => ({ cc: String(r.cc || "??"), n: Number(r.n) })),
    paths: (byPath as any[]).map((r) => ({ p: String(r.path || "?"), n: Number(r.n) })),
    recent: (recent as any[]).map((r) => ({ id: +r.id, ts: +r.ts, ip: r.ip, cc: r.cc, city: r.city || "", kind: r.kind, path: r.path, act: r.act, note: r.note })),
    alarms: (alarms as any[]).map((r) => ({ id: +r.id, ts: +r.ts, kind: r.kind, ip: r.ip, cc: r.cc, n: Number(r.n), note: r.note })),
    alarmTs: lastAl ? +lastAl.ts : 0, alarmLast: lastAl || null,
    now: t,
  })
}

// ---- v105: BITTA FOYDALANUVCHI TO'LIQ MA'LUMOT OYNASI ("barcha ma'lumot oynasi") ----
async function panelUser(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.url.searchParams.get("id") || 0) || 0)
  if (!id || id === ADM_ID) fail("Noto‘g‘ri foydalanuvchi", 400)
  const u = await c.db.one(
    `SELECT id, phone, first_name, last_name, username, bio, avatar_ver, privacy_phone, privacy_last_seen, created_at, last_seen, blocked, token_exp
     FROM users WHERE id=?`, [id],
  ).catch(() => null)
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  const [msg, ch, cl, med] = await Promise.all([
    c.db.one("SELECT COUNT(*) AS n FROM messages WHERE sender_id=?", [id]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM chat_members WHERE user_id=?", [id]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM calls WHERE caller_id=? OR callee_id=?", [id, id]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS s FROM media WHERE owner_id=? AND dropped=0 AND gone=0", [id]).catch(() => null),
  ])
  return json({
    id: +u.id, phone: u.phone, name: ((u.first_name || "") + " " + (u.last_name || "")).trim(),
    username: u.username || "", bio: u.bio || "", av: +u.avatar_ver || 0,
    cr: +u.created_at || 0, ls: +u.last_seen || 0, bl: +u.blocked === 1, cc: ccOf(u.phone),
    sessEnd: +u.token_exp || 0,
    messages: Number(msg?.n || 0), chats: Number(ch?.n || 0), calls: Number(cl?.n || 0),
    files: Number(med?.n || 0), bytes: Number(med?.s || 0),
    now: now(),
  })
}

// ---- v105: ALOHIDA XABAR — "50gram admin" nomidan BITTA foydalanuvchiga ----
// Hammaga-xabar bilan BIR XIL mexanizm (direct chat + oddiy xabar) — klient kodiga 0 bayt.
async function panelDm(c: C) {
  await admAuth(c)
  // v108: ensureSchema OLINGAN (sovuq izolyatda 35 so'rov — byudjet posboni; adm_log admLog ichida himoyalangan)
  const id = Math.floor(+(c.b?.id) || 0)
  const body = str(c.b.body, 4096)
  if (!id || id === ADM_ID) fail("Noto‘g‘ri foydalanuvchi", 400)
  if (!body) fail("Xabar matni bo‘sh", 400)
  const u = await c.db.one("SELECT id, blocked FROM users WHERE id=?", [id]).catch(() => null)
  if (!u) fail("Foydalanuvchi topilmadi", 404)
  if (+u.blocked === 1) fail("Foydalanuvchi bloklangan — avval blokdan chiqaring", 400)
  if (await c.db.one("SELECT user_id FROM blocks WHERE user_id=? AND blocked_id=?", [id, ADM_ID]).catch(() => null))
    fail("Foydalanuvchi admin xabarlarini o‘z tomonidan bloklagan — yuborilmadi", 400)
  await admSysUser(c.db)
  const t = now()
  const key = id < ADM_ID ? id + ":" + ADM_ID : ADM_ID + ":" + id
  let chid = Number((await c.db.one("SELECT id FROM chats WHERE direct_key=?", [key]).catch(() => null))?.id || 0)
  if (!chid) {
    chid = newId()
    await c.db.run(
      "INSERT INTO chats(id,type,owner_id,is_public,invite_hash,direct_key,member_count,last_msg_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [chid, "direct", ADM_ID, 0, randomStr(10), key, 2, t, t],
    )
    await c.db.run(
      "INSERT INTO chat_members(chat_id,user_id,role,joined_at) VALUES(?,?,?,?),(?,?,?,?)",
      [chid, ADM_ID, "member", t, chid, id, "member", t],
    )
  }
  const mid = t * 1000 + Math.floor(Math.random() * 500)
  try {
    await c.db.run(
      "INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [mid, chid, ADM_ID, "text", body, null, t, t, t + 100 * 365 * DAY],
    )
  } catch {
    await c.db.run(
      "INSERT INTO messages(id,chat_id,sender_id,kind,body,meta,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [newId(), chid, ADM_ID, "text", body, null, t, t, t + 100 * 365 * DAY],
    )
  }
  await c.db.run("UPDATE chats SET last_msg_at=? WHERE id=?", [t, chid])
  // v108: foydalanuvchi ONLAYN bo'lsa xabar DARHOL yetadi (WS) — avval kutish kerak edi
  admNotify(c, [{ uid: id, chat: chid, msg: { id: mid, chat_id: chid, sender_id: ADM_ID, kind: "text", body, meta: {}, edited: 0, deleted: 0, created_at: t, updated_at: t } }])
  await admLog(c, "alohida_xabar", "user:" + id, "ALOHIDA XABAR yuborildi: " + body.slice(0, 150))
  return json({ ok: true, id, chat_id: chid, now: t })
}

// =====================================================================
// v106: KANAL/GURUH MODERATSIYASI + HIMOYA TUGMASI (faqat egapanel)
// ---------------------------------------------------------------------
//  • KANALLAR BO'LIMI: barcha kanal/guruher ro'yxati (a'zolar soni, egasi,
//    xabarlar hisobi), har birining MA'LUMOT OYNASI (xabarlar + a'zolar).
//  • YOMON SO'ZLAR: so'kinish belgilari to'plamı (PROF_REG) — panel xabarlarni
//    QIZIL bilan belgilaydi; egasi bittadan yoki BARCHASINI bir zumda o'chiradi.
//    Avtomatik o'chirish YO'Q — false-positive himoyasi (egasi ko'rib tasdiqlaydi).
//  • BLOKLASH: chats.blocked=1 → kanalga yozish/kirish 403 (sendMessage/joinChat).
//    Blokdan chiqarish — yozuv butunlay olib tashlanadi (blocked=0).
//  • CHETLATISH/KICK: obunachini kanaldan chiqarish yoki ban (qayta kirish yopiq).
//  • TOZALASH: kanaldagi barcha xabarlar o'chiriladi (chat_cleared — klient o'zi tozalaydi).
//  • O'CHIRISH: kanal "tagi bilan" — xabarlar/a'zolar/media/izohlar + chat yozuvi.
//  • HIMOYA TUGMASI: o'zgartirish kiritayotganda himoya qatlamini O'CHIRISH, keyin
//    YOQISH — SEC DO cfg'da saqlanadi, barcha izolyatlarga ≤45s da yetadi.
//  • BOSHQARUV JURNALI: har panel amali adm_log'ga yoziladi (90 kun saqlanadi).
// =====================================================================
// YOMON SO'Z FILTRI (so'kinish ildizlari — uz/ru, latin+cyrillic): panel belgilash uchun.
// SQL REGEXP bilan bir xil satr ishlatiladi (cleanbad) — bitta manba.
const PROF_REG = "siktir|sikk|sikay|sikir|sikib|sikish|siksin|qanjiq|xuy|huy|pizd|eblan|blyad|blya|cyka|мудак|дебил|пизд|хуй|еба|бля|сука|наху|gandon|dalbayob|dalba"
const PROF_RE = new RegExp(PROF_REG, "i")
// Panel amali jurnali — har boshqaruv amali dalil bilan (try/catch: jurnal xato qilsa ham amal bajariladi)
async function admLog(c: C, act: string, tgt: string, note: string) {
  try { await c.db.run("INSERT INTO adm_log(ts,act,tgt,note) VALUES(?,?,?,?)", [now(), String(act).slice(0, 30), String(tgt).slice(0, 60), String(note).slice(0, 290)]) } catch {}
}

// ---- KANALLAR/GURUHLAR RO'YXATI (a'zolar soni bo'yicha) ----
async function panelChats(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const page = Math.max(1, Math.min(500, Math.floor(+(c.url.searchParams.get("page") || 1) || 1)))
  const qq = str(c.url.searchParams.get("q"), 64)
  const ft = str(c.url.searchParams.get("ft"), 10)
  const conds = ["c.type<>'direct'"]
  const params: unknown[] = []
  if (ft === "channel" || ft === "group") { conds.push("c.type=?"); params.push(ft) }
  if (ft === "blocked") conds.push("c.blocked=1")
  if (qq) {
    const like = "%" + qq.replace(/[%_]/g, "") + "%"
    conds.push("(c.title LIKE ? OR c.username LIKE ?)")
    params.push(like, like)
  }
  const w = "WHERE " + conds.join(" AND ")
  const LIM = 50
  const [rows, cnt, stat] = await Promise.all([
    c.db.q(
      `SELECT c.id, c.type, c.title, c.username, c.avatar_ver, c.member_count, c.last_msg_at, c.created_at, c.blocked,
        u.first_name, u.last_name, u.phone
       FROM chats c LEFT JOIN users u ON u.id=c.owner_id ${w}
       ORDER BY c.member_count DESC LIMIT ${LIM} OFFSET ${(page - 1) * LIM}`,
      params,
    ),
    c.db.one(`SELECT COUNT(*) AS n FROM chats c ${w}`, params),
    c.db.one(`SELECT SUM(CASE WHEN type='channel' THEN 1 ELSE 0 END) AS nc, SUM(CASE WHEN type='group' THEN 1 ELSE 0 END) AS ng, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS nb FROM chats WHERE type<>'direct'`).catch(() => null),
  ])
  // xabarlar hisobi — bitta GROUP BY so'rovi (har qatorga subquery — TiDB yuklamasi bo'lmasin)
  const ids = rows.map((r) => +r.id)
  const msgs = new Map<number, number>()
  if (ids.length) {
    const mr = await c.db.q(`SELECT chat_id, COUNT(*) AS n FROM messages WHERE chat_id IN (${ph(ids)}) AND deleted=0 GROUP BY chat_id`, ids).catch(() => [] as any[])
    for (const r of mr) msgs.set(+r.chat_id, Number(r.n))
  }
  return json({
    chats: rows.map((r) => ({
      id: +r.id, type: String(r.type), title: r.title || "", username: r.username || "", av: +r.avatar_ver || 0,
      owner: ((r.first_name || "") + " " + (r.last_name || "")).trim(), ophone: String(r.phone || ""),
      members: Number(r.member_count) || 0, msgs: msgs.get(+r.id) || 0,
      cr: +r.created_at || 0, lm: +r.last_msg_at || 0, bl: +r.blocked === 1,
    })),
    total: Number(cnt?.n || 0), page, pages: Math.max(1, Math.ceil(Number(cnt?.n || 0) / LIM)),
    nc: Number(stat?.nc || 0), ng: Number(stat?.ng || 0), nb: Number(stat?.nb || 0), now: now(),
  })
}

// ---- BITTA KANAL/GURUH TO'LIQ MA'LUMOT OYNASI (xabarlar + a'zolar bilan) ----
async function panelChat(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.url.searchParams.get("id") || 0) || 0)
  if (!id) fail("Chat topilmadi", 400)
  const ch = await c.db.one(
    "SELECT id, type, title, description, username, avatar_ver, owner_id, member_count, last_msg_at, created_at, blocked FROM chats WHERE id=?", [id],
  ).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  const [owner, mcnt, mrows, mrows2] = await Promise.all([
    c.db.one("SELECT id, first_name, last_name, phone, blocked FROM users WHERE id=?", [ch.owner_id]).catch(() => null),
    c.db.one("SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND deleted=0", [id]).catch(() => null),
    c.db.q(
      `SELECT m.user_id, m.role, m.status, u.first_name, u.last_name, u.phone, u.blocked AS ublk
       FROM chat_members m LEFT JOIN users u ON u.id=m.user_id
       WHERE m.chat_id=? AND m.status='active'
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at LIMIT 60`, [id],
    ).catch(() => [] as any[]),
    c.db.q("SELECT id, sender_id, kind, LEFT(body,180) AS body, created_at FROM messages WHERE chat_id=? AND deleted=0 ORDER BY id DESC LIMIT 40", [id]).catch(() => [] as any[]),
  ])
  const sids = [...new Set((mrows2 as any[]).map((r) => +r.sender_id))]
  const sm = new Map<number, string>()
  if (sids.length) {
    const sr = await c.db.q(`SELECT id, first_name, last_name, username FROM users WHERE id IN (${ph(sids)})`, sids).catch(() => [] as any[])
    for (const s of sr) {
      const nm = ((s.first_name || "") + " " + (s.last_name || "")).trim()
      sm.set(+s.id, nm + (s.username ? " (@" + s.username + ")" : ""))
    }
  }
  return json({
    id: +ch.id, type: String(ch.type), title: ch.title || "", username: ch.username || "", desc: ch.description || "",
    owner: owner
      ? { id: +owner.id, name: ((owner.first_name || "") + " " + (owner.last_name || "")).trim(), phone: String(owner.phone || ""), cc: ccOf(owner.phone), bl: +owner.blocked === 1 }
      : { id: 0, name: "—", phone: "", cc: "XX", bl: false },
    members: Number(ch.member_count) || 0, msgs: Number(mcnt?.n || 0),
    cr: +ch.created_at || 0, lm: +ch.last_msg_at || 0, bl: +ch.blocked === 1,
    // bad: yomon so'z belgisi (egasi ko'rib, o'zi o'chiradi — avtomatik o'chirish yo'q)
    messages: (mrows2 as any[]).map((r) => ({ id: +r.id, ts: +r.created_at, kind: String(r.kind), sender: sm.get(+r.sender_id) || "ID " + r.sender_id, body: String(r.body || "").slice(0, 180), bad: PROF_RE.test(String(r.body || "")) })),
    mlist: (mrows as any[]).map((r) => ({ id: +r.user_id, name: ((r.first_name || "") + " " + (r.last_name || "")).trim(), phone: String(r.phone || ""), cc: ccOf(r.phone), role: String(r.role), ublk: +(r.ublk || 0) === 1 })),
    now: now(),
  })
}

// ---- KANAL BLOKLASH / BLOK YOZUVINI OLIB TASHLASH ----
async function panelChatBlock(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const on = c.b?.on ? 1 : 0
  const ch = await c.db.one("SELECT id, type, title, blocked FROM chats WHERE id=?", [id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  if (+ch.blocked === on) return json({ ok: true, id, blocked: on, unchanged: true })
  await c.db.run("UPDATE chats SET blocked=? WHERE id=?", [on, id])
  await admLog(c, on ? "chat_blok" : "chat_blok_och", "chat:" + id, (on ? "BLOKLANDI" : "Blok olib tashlandi") + ": " + String(ch.title || "").slice(0, 60))
  return json({ ok: true, id, blocked: on })
}

// ---- KANALNI "TAGI BILAN" O'CHIRISH (xabarlar+a'zolar+media+izohlar+chat) ----
async function panelChatDelete(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const ch = await c.db.one("SELECT id, type, title FROM chats WHERE id=?", [id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  const ids = (await c.db.q("SELECT user_id FROM chat_members WHERE chat_id=? LIMIT 41", [id])).map((r) => r.user_id)
  await SW.dropMedia(c.db, "chat_id=?", [id])
  // izoh-reaksiya-so'rov qoldiqlarini ham tozala (deleteChat bilan bir xil + qo'shimcha to'liqlik)
  await c.db.run("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)", [id]).catch(() => {})
  await c.db.run("DELETE FROM poll_votes WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)", [id]).catch(() => {})
  await c.db.run("DELETE FROM msg_comments WHERE chat_id=?", [id]).catch(() => {})
  await c.db.run("DELETE FROM messages WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chat_members WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM join_requests WHERE chat_id=?", [id])
  await c.db.run("DELETE FROM chats WHERE id=?", [id])
  c.wait(notify(c.env, ids, { type: "chat_deleted", chat_id: id }))
  await admLog(c, "chat_ochirish", "chat:" + id, "TAGI BILAN O'CHIRILDI: " + String(ch.title || "").slice(0, 60) + " (" + ids.length + " a'zoga xabar berildi)")
  return json({ ok: true, id, members: ids.length })
}

// ---- OBUNACHINI KANALDAN CHIQARISH / CHETLATISH (ban — qayta kirish yopiq) ----
async function panelChatKick(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const uid = Math.floor(+(c.b?.uid) || 0)
  const ban = c.b?.ban ? 1 : 0
  const ch = await c.db.one("SELECT id, type, title, owner_id FROM chats WHERE id=?", [id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  if (!uid) fail("Foydalanuvchi topilmadi", 400)
  if (uid === ch.owner_id) fail("Kanal egasini chiqarib bo'lmaydi — kanalni o'chirish tugmasidan foydalaning", 400)
  const mem = await c.db.one("SELECT role, status FROM chat_members WHERE chat_id=? AND user_id=?", [id, uid]).catch(() => null)
  if (!mem || mem.status !== "active") fail("Bu foydalanuvchi kanal a'zosi emas", 404)
  if (ban) {
    await c.db.run("REPLACE INTO chat_members(chat_id,user_id,role,status,joined_at) VALUES(?,?,'member','banned',?)", [id, uid, now()])
    await c.db.run("DELETE FROM join_requests WHERE chat_id=? AND user_id=?", [id, uid]).catch(() => {})
  } else {
    await c.db.run("DELETE FROM chat_members WHERE chat_id=? AND user_id=?", [id, uid])
  }
  await recount(c, id)
  c.wait(notify(c.env, [uid], { type: "chat_update", chat_id: id }))
  await admLog(c, ban ? "chat_ban" : "chat_kick", "chat:" + id + "/u:" + uid, (ban ? "CHETLATILDI" : "KANALDAN CHIQARILDI") + ": " + String(ch.title || "").slice(0, 40))
  return json({ ok: true, id, uid, ban })
}

// ---- KANAL XABARLARINI TOZALASH (hamma yozuvlar o'chiriladi, chat qoladi) ----
async function panelChatClear(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const ch = await c.db.one("SELECT id, type, title FROM chats WHERE id=?", [id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  const t = now()
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE chat_id=? AND deleted=0", [t, id])
  await c.db.run("UPDATE media SET dropped=1 WHERE chat_id=? AND dropped=0", [id]).catch(() => {})
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=?", [id]).catch(() => {})
  await c.db.run("UPDATE chat_members SET pinned=0 WHERE chat_id=?", [id]).catch(() => {})
  notifyChat(c, id, { type: "chat_cleared", chat_id: id, now: t })
  await admLog(c, "chat_tozalash", "chat:" + id, "BARCHA XABARLAR O'CHIRILDI: " + String(ch.title || "").slice(0, 60))
  return json({ ok: true, id, now: t })
}

// ---- YOMON SO'ZLI XABARLARNI BIR ZUMDA O'CHIRISH (egasi tasdiqlagandan keyin) ----
// Bitta so'rovda ≤100 ta (subrequest-byudjet); javobda o'chirilgani qaytadi — qolganlari
// uchun egasi yana bir marta bosadi (katta kanal toshqinidan posbon).
async function panelChatCleanBad(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const id = Math.floor(+(c.b?.id) || 0)
  const ch = await c.db.one("SELECT id, type, title FROM chats WHERE id=?", [id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Chat topilmadi", 404)
  const rows = await c.db.q("SELECT id, meta FROM messages WHERE chat_id=? AND deleted=0 AND body IS NOT NULL AND body REGEXP ? LIMIT 100", [id, PROF_REG]).catch(() => [] as any[])
  if (!rows.length) return json({ ok: true, removed: 0 })
  const mids = rows.map((r) => +r.id)
  const t = now()
  // media (rasm/video/fayl) — serverdagi nusxalari ham o'chiriladi (≤20 — byudjet posboni)
  let mediaDropped = 0
  for (const r of rows) {
    if (mediaDropped >= 20) break
    const mid = parse(r.meta, {}).media_id
    if (mid) { await SW.dropMedia(c.db, "id=?", [String(mid)]).catch(() => {}); mediaDropped++ }
  }
  await c.db.run(`UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE id IN (${ph(mids)})`, [t, ...mids])
  await c.db.run(`DELETE FROM reactions WHERE message_id IN (${ph(mids)})`, mids).catch(() => {})
  await c.db.run(`DELETE FROM poll_votes WHERE message_id IN (${ph(mids)})`, mids).catch(() => {})
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=? AND pinned_id IN (" + ph(mids) + ")", [id, ...mids]).catch(() => {})
  notifyChat(c, id, { type: "chat_update", chat_id: id })
  await admLog(c, "chat_yomon_och", "chat:" + id, "YOMON SO'ZLI " + mids.length + " TA XABAR O'CHIRILDI: " + String(ch.title || "").slice(0, 50))
  return json({ ok: true, removed: mids.length })
}

// ---- BITTA XABARNI O'CHIRISH (yomon so'zli / buzuvchi yozuv) ----
async function panelMsgDelete(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const mid = Math.floor(+(c.b?.id) || 0)
  if (!mid) fail("Xabar topilmadi", 400)
  const m = await c.db.one("SELECT id, chat_id, sender_id, meta, deleted FROM messages WHERE id=?", [mid]).catch(() => null)
  if (!m || m.deleted) fail("Xabar topilmadi", 404)
  const ch = await c.db.one("SELECT id, type, title FROM chats WHERE id=?", [+m.chat_id]).catch(() => null)
  if (!ch || ch.type === "direct") fail("Faqat kanal/guruh xabarlari paneldan o'chiriladi", 404)
  const mediaId = parse(m.meta, {}).media_id
  if (mediaId) await SW.dropMedia(c.db, "id=?", [String(mediaId)]).catch(() => {})
  await c.db.run("UPDATE messages SET deleted=1, body=NULL, meta=NULL, updated_at=? WHERE id=?", [now(), mid])
  await c.db.run("UPDATE chats SET pinned_id=0 WHERE id=? AND pinned_id=?", [+m.chat_id, mid]).catch(() => {})
  await c.db.run("DELETE FROM reactions WHERE message_id=?", [mid]).catch(() => {})
  await c.db.run("DELETE FROM poll_votes WHERE message_id=?", [mid]).catch(() => {})
  // klient o'zi olib tashlaydi (message_update: deleted=1)
  const mm = await c.db.one("SELECT * FROM messages WHERE id=?", [mid])
  const out = (await enrich(c, [mm]))[0]
  notifyChat(c, +m.chat_id, { type: "message_update", chat_id: +m.chat_id, message: out })
  await admLog(c, "msg_ochirish", "msg:" + mid + "/chat:" + m.chat_id, "XABAR O'CHIRILDI: " + String(ch.title || "").slice(0, 50))
  return json({ ok: true, id: mid, chat_id: +m.chat_id })
}

// ---- HIMOYA QATLAMINI O'CHIRISH / YOQISH (egasi o'zgartirish kiritayotganda) ----
// on=1 → himoya YONIQ (oddiy holat); on=0 → himoya O'CHIQ (hujum-himoya vaqtincha ishlamaydi).
// Holat SEC DO cfg'da saqlanadi — barcha izolyatlarga ≤45s da yetadi (fwQollash).
async function panelFwToggle(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const on = c.b?.on ? 1 : 0
  try {
    const st = c.env.SEC!.get(c.env.SEC!.idFromName("global"))
    await st.fetch("https://fw/?op=cfg&v=" + (on ? "0" : "1"))
  } catch {
    fail("Himoya holatini o'zgartirib bo'lmadi", 500)
  }
  FW_OFF = !on // shu izolyatda darhol (qolganlari ≤45s)
  await admLog(c, on ? "himoya_yoqildi" : "himoya_ochirildi", "himoya", on
    ? "Himoya qatlami YOQILDI — 7 qatlam himoya ishlaydi"
    : "Himoya qatlami O'CHIRILDI (o'zgartirish kiritish paytida) — ish bo'lgach YOQISH SHART")
  return json({ ok: true, on, now: now() })
}

// ---- BOSHQARUV JURNALI (paneldagi har amal — dalil bilan) ----
async function panelLog(c: C) {
  await admAuth(c)
  await ensureSchema(c.db)
  const rows = await c.db.q("SELECT ts, act, tgt, note FROM adm_log ORDER BY id DESC LIMIT 60").catch(() => [] as any[])
  return json({
    rows: (rows as any[]).map((r) => ({ ts: +r.ts, act: String(r.act), tgt: String(r.tgt), note: String(r.note) })),
    now: now(),
  })
}

// PANEL SAHIFASI — worker xotirasidan beriladi (web/ papkada FAYL YO'Q — saytda iz yo'q).
// String.raw: ichida ${ va backtick TAQIQLANGAN (panel JS'da faqat '+' birlashmasi).
const ADMIN_HTML = String.raw`<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>50</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0e1013;color:#e6e8ec;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh}
.hidden{display:none!important}
.wrap{max-width:980px;margin:0 auto;padding:18px}
.h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 16px}
.h b{font-size:17px}
button{background:#2b6cff;border:0;color:#fff;padding:9px 16px;border-radius:9px;font-size:14px;cursor:pointer}
button:hover{filter:brightness(1.12)}
button.sec{background:#23262d;color:#e6e8ec}
button.warn{background:#8b2332}
button.grn{background:#2f7d4f}
.fwst{color:#8b919c;font-size:13px;white-space:nowrap}
.fwst b{color:#e6e8ec}
button:disabled{opacity:.45;cursor:default}
input,textarea{background:#171a1f;border:1px solid #2a2e36;color:#e6e8ec;padding:10px 12px;border-radius:9px;font-size:14px;width:100%}
input:focus,textarea:focus{outline:1px solid #2b6cff}
select{background:#171a1f;border:1px solid #2a2e36;color:#e6e8ec;padding:10px 12px;border-radius:9px;font-size:14px;width:auto;cursor:pointer}
.tabs{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}
.tabs button{background:#171a1f;color:#c9cdd4}
.tabs button.on{background:#2b6cff;color:#fff}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}
.card{background:#171a1f;border:1px solid #23262d;border-radius:12px;padding:14px}
.card small{display:block;color:#8b919c;font-size:12px;margin-bottom:4px}
.card b{font-size:22px}
.card.acc b{color:#7fb0ff}
.card.red b{color:#ff7b72}
.card.grn b{color:#4ec97a}
h3{font-size:13px;color:#8b919c;text-transform:uppercase;letter-spacing:.06em;margin:22px 0 10px}
.crow{display:flex;align-items:center;gap:10px;margin:6px 0}
.crow .nm{width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.crow .bar{height:10px;background:#2b6cff;border-radius:5px;min-width:2px}
.crow .n{color:#8b919c;font-size:13px}
.bar2{display:flex;gap:8px;margin:0 0 12px;align-items:center}
.u{display:flex;align-items:center;gap:12px;background:#171a1f;border:1px solid #23262d;border-radius:12px;padding:10px 12px;margin:8px 0}
.u img{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#23262d;flex:none}
.u .in{flex:1;min-width:0}
.u .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.u .sub{color:#8b919c;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.u .st{font-size:12px;color:#8b919c}
.tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:12px;background:#8b2332;color:#fff;margin-left:6px;vertical-align:1px}
.pg{display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0;color:#8b919c;font-size:14px}
textarea{min-height:140px;resize:vertical}
.note{color:#8b919c;font-size:13px;margin:0 0 12px}
.res{margin:10px 0 0;color:#4ec97a;font-size:14px;min-height:20px}
.err{color:#ff7b72!important}
.lg{max-width:340px;margin:12vh auto 0;padding:0 18px}
.lg h1{font-size:22px;margin:0 0 6px}
.lg p{color:#8b919c;font-size:14px;margin:0 0 18px}
/* v105: XAVFSIZLIK BO'LIMI uslublari */
.alarm{border:1px solid #a1303f;background:#2a1114;border-radius:12px;padding:12px 14px;margin:0 0 14px;animation:bl 1.6s infinite}
.alarm b{color:#ff7b72;font-size:15px}
.alarm small{display:block;color:#d98a93;font-size:12px;margin-top:3px}
.alarm.old{animation:none;background:#171a1f;border-color:#23262d}
.alarm.old b{color:#c9cdd4}
.alarm.old small{color:#8b919c}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.62}}
table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 0}
th{color:#8b919c;text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid #23262d;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td{padding:7px 8px;border-bottom:1px solid #1d2026;vertical-align:top}
tr:hover td{background:#171a1f}
.act{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;background:#1f3a2a;color:#4ec97a;white-space:nowrap}
.act.b{background:#3a1f24;color:#ff7b72}
.ip{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.mdl{position:fixed;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
.mc{background:#171a1f;border:1px solid #2a2e36;border-radius:14px;max-width:440px;width:100%;max-height:86vh;overflow-y:auto;padding:18px}
.mc h4{font-size:16px;margin:0 0 2px}
.mc .sub{color:#8b919c;font-size:13px;margin:0 0 12px}
.kv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #1d2026;font-size:14px}
.kv span{color:#8b919c}
.kv b{text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mrow2{display:flex;gap:8px;margin:14px 0 0}
.mrow2 button{flex:1}
.xcl{position:absolute;top:10px;right:12px;background:none;border:0;color:#8b919c;font-size:20px;padding:4px;cursor:pointer}
.mc{position:relative}
/* v106: KANALLAR bo'limi uslublari (xabar/a'zo qatorlari) */
.mr{display:flex;align-items:center;gap:8px;background:#131519;border:1px solid #1d2026;border-radius:10px;padding:8px 10px;margin:6px 0}
.mr .mri{flex:1;min-width:0}
.mr .mrt{color:#8b919c;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mr .mrb{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mr.mrbad{border-color:#a1303f;background:#2a1114}
.mr button{flex:none}
.mc.wide{max-width:660px}
.tyt{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;margin-right:6px;vertical-align:1px}
.tyt.chn{background:#1f3a5f;color:#7fb0ff}
.tyt.grp{background:#2b3a1f;color:#9ed07a}
@media(max-width:640px){.crow .nm{width:112px}.u{flex-wrap:wrap}table{font-size:12px}.hiddencol{display:none}}
</style>
</head>
<body>
<div id="lg" class="lg hidden">
  <h1>50</h1>
  <p>Kirish uchun parolni kiriting</p>
  <input id="pw" type="password" placeholder="Parol">
  <div class="bar2" style="margin-top:12px"><button id="lb" style="width:100%">Kirish</button></div>
  <div class="res err" id="le"></div>
</div>
<div id="app" class="wrap hidden">
  <div class="h"><b>50 · Panel</b><span><button class="sec" id="rf">Yangilash</button> <button class="sec" id="out">Chiqish</button></span></div>
  <div class="tabs">
    <button data-t="st" class="on">Statistika</button>
    <button data-t="us">Foydalanuvchilar</button>
    <button data-t="ch">Kanallar</button>
    <button data-t="br">Xabar yuborish</button>
    <button data-t="sc">Xavfsizlik</button>
  </div>
  <section id="st">
    <div class="cards" id="cards"></div>
    <h3>Davlatlar</h3>
    <div id="ccs"></div>
  </section>
  <section id="us" class="hidden">
    <div class="bar2"><input id="q" placeholder="Ism, telefon yoki @username"><button id="qb">Qidirish</button></div>
    <div class="note" id="un"></div>
    <div id="ul"></div>
    <div class="pg"><button class="sec" id="pv">← Oldingi</button><span id="pgn">1 / 1</span><button class="sec" id="nx">Keyingi →</button></div>
  </section>
  <section id="ch" class="hidden">
    <div class="bar2"><input id="cq" placeholder="Kanal yoki guruh nomi, @username"><button id="cqb">Qidirish</button><select id="cft"><option value="">Hammasi</option><option value="channel">Kanallar</option><option value="group">Guruhlar</option><option value="blocked">Bloklanganlar</option></select></div>
    <div class="note" id="cn"></div>
    <div id="cl"></div>
    <div class="pg"><button class="sec" id="cpv">← Oldingi</button><span id="cpgn">1 / 1</span><button class="sec" id="cnx">Keyingi →</button></div>
  </section>
  <section id="br" class="hidden">
    <p class="note">E’lon <b>«50gram admin»</b> nomidan barcha faol foydalanuvchining xabar bo‘limiga yuboriladi (oddiy xabar ko‘rinishida; onlaynlar darhol, qolganlar ilova ochilganda ko‘radi). RASM qo‘shilsa — rasm va ostida izoh bilan bir martada hammaga yetadi.</p>
    <textarea id="tx" maxlength="4096" placeholder="E’lon matni (rasm bilan yuborilsa — rasm ostidagi izoh)..."></textarea>
    <div class="bar2" style="margin-top:10px">
      <button id="bpick" class="sec">📷 Rasm biriktirish (ixtiyoriy)</button>
      <input type="file" id="bimgf" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden">
      <span class="note" id="bimgn"></span>
    </div>
    <img id="bimgp" class="hidden" alt="" style="max-width:280px;max-height:180px;border-radius:10px;border:1px solid #23262d;display:block;margin:0 0 10px">
    <div class="bar2" style="margin-top:10px"><span class="note" id="cnt">0 / 4096</span><button id="sb">Hammaga yuborish</button></div>
    <div class="res" id="bres"></div>
  </section>
  <section id="sc" class="hidden">
    <div id="fwctl" class="alarm old"></div>
    <div id="alrm"></div>
    <div class="cards" id="scards"></div>
    <h3>Hujum turlari (7 kun)</h3>
    <div id="skinds"></div>
    <h3>Hujum davlatlari (7 kun)</h3>
    <div id="sccs"></div>
    <h3>Hujum qilingan qismlar (7 kun)</h3>
    <div id="spaths"></div>
    <h3>So‘nggi hujum urinishlari</h3>
    <div style="overflow-x:auto"><table><thead><tr><th>Vaqt</th><th>IP</th><th>Davlat</th><th>Tur</th><th class="hiddencol">Qismi</th><th>Chora</th></tr></thead><tbody id="srec"></tbody></table></div>
    <h3>Blokda turgan IP’lar</h3>
    <div style="overflow-x:auto"><table><thead><tr><th>IP</th><th>Blok tugashi</th></tr></thead><tbody id="sblk"></tbody></table></div>
    <h3>Signalizatsiya jurnali</h3>
    <div id="salarms"></div>
    <h3>Boshqaruv jurnali (panel amallari)</h3>
    <div style="overflow-x:auto"><table><thead><tr><th>Vaqt</th><th>Amal</th><th class="hiddencol">Obyekt</th><th>Izoh</th></tr></thead><tbody id="alog"></tbody></table></div>
  </section>
</div>
<div id="mdl" class="mdl hidden"><div class="mc" id="mc"></div></div>
<script>
var T=localStorage.getItem('g50adm')||''
var cur='st',page=1,pages=1
function $(i){return document.getElementById(i)}
var M={'"':"&quot;","'":"&#39;","&":"&amp;","<":"&lt;",">":"&gt;"}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return M[c]})}
var CC={UZ:['O‘zbekiston','🇺🇿'],RU:['Rossiya','🇷🇺'],KZ:['Qozog‘iston','🇰🇿'],KG:['Qirg‘iziston','🇰🇬'],TJ:['Tojikiston','🇹🇯'],TM:['Turkmaniston','🇹🇲'],AZ:['Ozarbayjon','🇦🇿'],UA:['Ukraina','🇺🇦'],BY:['Belarus','🇧🇾'],GE:['Gruziya','🇬🇪'],AM:['Armaniston','🇦🇲'],MD:['Moldova','🇲🇩'],TR:['Turkiya','🇹🇷'],DE:['Germaniya','🇩🇪'],FR:['Fransiya','🇫🇷'],GB:['Buyuk Britaniya','🇬🇧'],IT:['Italiya','🇮🇹'],ES:['Ispaniya','🇪🇸'],NL:['Niderlandiya','🇳🇱'],PL:['Polsha','🇵🇱'],RO:['Rumyniya','🇷🇴'],CZ:['Chexiya','🇨🇿'],BG:['Bolgariya','🇧🇬'],HU:['Vengriya','🇭🇺'],SE:['Shvetsiya','🇸🇪'],NO:['Norvegiya','🇳🇴'],DK:['Daniya','🇩🇰'],FI:['Finlandiya','🇫🇮'],LT:['Litva','🇱🇹'],LV:['Latviya','🇱🇻'],EE:['Estoniya','🇪🇪'],CH:['Shveytsariya','🇨🇭'],AT:['Avstriya','🇦🇹'],RS:['Serbiya','🇷🇸'],HR:['Xorvatiya','🇭🇷'],GR:['Gretsiya','🇬🇷'],PT:['Portugaliya','🇵🇹'],IL:['Isroil','🇮🇱'],AE:['BAA','🇦🇪'],SA:['Saudiya Arabistoni','🇸🇦'],IR:['Eron','🇮🇷'],IQ:['Iroq','🇮🇶'],AF:['Afg‘oniston','🇦🇫'],CN:['Xitoy','🇨🇳'],KR:['Koreya','🇰🇷'],JP:['Yaponiya','🇯🇵'],IN:['Hindiston','🇮🇳'],PK:['Pokiston','🇵🇰'],VN:['Vetnam','🇻🇳'],TH:['Tailand','🇹🇭'],ID:['Indoneziya','🇮🇩'],MY:['Malayziya','🇲🇾'],PH:['Filippin','🇵🇭'],US:['AQSh / Kanada','🇺🇸'],BR:['Braziliya','🇧🇷'],XX:['Boshqa','🌐'],'??':['Noma’lum (VPN/proxy)','❓']}
function ccName(k){var x=CC[k];return x?(x[1]+' '+x[0]):'🌐 Boshqa'}
function api(p,m,b){
  return fetch('/api/panel/'+p,{method:m||'GET',headers:{'content-type':'application/json',authorization:'Bearer '+T},body:b?JSON.stringify(b):undefined})
    .then(function(r){return r.json().then(function(j){return{s:r.status,j:j||{}}}).catch(function(){return{s:r.status,j:{}}})})
    .catch(function(){return{s:0,j:{}}})
}
function authFail(r){if(r&&r.s===401){localStorage.removeItem('g50adm');location.reload();return true}return false}
function rel(ms){
  if(!ms)return '—'
  var d=Date.now()-ms
  if(d<70000)return '🟢 Onlayn'
  if(d<3600000)return Math.max(1,Math.round(d/60000))+' daqiqa oldin'
  if(d<86400000)return Math.round(d/3600000)+' soat oldin'
  return Math.floor(d/86400000)+' kun oldin'
}
function dt(ms){
  if(!ms)return '—'
  var d=new Date(ms),p=function(x){return (x<10?'0':'')+x}
  return p(d.getDate())+'.'+p(d.getMonth()+1)+'.'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())
}
function loadStats(){
  api('stats').then(function(r){
    if(authFail(r))return
    var s=r.j;if(!s||s.total===undefined)return
    var C=[
      ['Jami foydalanuvchi',s.total,'acc'],
      ['Hozir onlayn',s.online,'grn'],
      ['24 soatda faol',s.active24,''],
      ['7 kunda faol',s.active7,''],
      ['Bugun qo‘shildi',s.today,''],
      ['7 kunda qo‘shildi',s.week,''],
      ['Bloklangan',s.blocked,'red'],
      ['Jami xabarlar',s.messages,''],
      ['Suhbatlar',s.chats,''],
      ['Qo‘ng‘iroqlar',s.calls,'']
    ]
    var h=''
    for(var i=0;i<C.length;i++)h+='<div class="card '+C[i][2]+'"><small>'+C[i][0]+'</small><b>'+C[i][1]+'</b></div>'
    $('cards').innerHTML=h
    var mx=1
    for(var k=0;k<s.countries.length;k++)if(s.countries[k].n>mx)mx=s.countries[k].n
    var c=''
    for(var i=0;i<s.countries.length;i++){var x=s.countries[i]
      c+='<div class="crow"><span class="nm">'+ccName(x.cc)+'</span><span class="bar" style="width:'+Math.max(2,Math.round(x.n/mx*260))+'px"></span><span class="n">'+x.n+'</span></div>'}
    $('ccs').innerHTML=c||'<p class="note">Hozircha malumot yoq</p>'
  })
}
function loadUsers(p){
  if(p)page=p
  var url='users?page='+page
  var q=$('q').value.trim()
  if(q)url+='&q='+encodeURIComponent(q)
  api(url).then(function(r){
    if(authFail(r))return
    var j=r.j;if(!j||!j.users)return
    pages=j.pages
    $('un').textContent='Jami: '+j.total+' foydalanuvchi'
    var h=''
    for(var i=0;i<j.users.length;i++){var u=j.users[i]
      h+='<div class="u">'
        +'<img data-uid="'+u.id+'" src="/api/avatar/u/'+u.id+'?v='+u.av+'" alt="">'
        +'<div class="in"><div class="nm">'+esc(u.name||'(ism yozilmagan)')+(u.bl?'<span class="tag">Bloklangan</span>':'')+'</div>'
        +'<div class="sub">'+esc(u.phone)+' · '+ccName(u.cc)+(u.username?' · @'+esc(u.username):'')+'</div>'
        +'<div class="st">ID '+u.id+' · Royxat: '+dt(u.cr)+' · Faollik: '+rel(u.ls)+'</div></div>'
        +'<div><button class="sec" data-in="'+u.id+'">Ma\'lumot</button> <button class="sec" data-dm="'+u.id+'">Xabar</button> '
        +(u.bl?'<button class="sec" data-un="'+u.id+'">Blokdan chiqarish</button>':'<button class="warn" data-bl="'+u.id+'">Bloklash</button>')+'</div>'
        +'</div>'
    }
    $('ul').innerHTML=h||'<p class="note">Topilmadi</p>'
    $('pgn').textContent=page+' / '+pages
    $('pv').disabled=page<=1
    $('nx').disabled=page>=pages
    var ims=$('ul').querySelectorAll('img')
    for(var i=0;i<ims.length;i++)ims[i].onerror=function(){this.style.visibility='hidden'}
    var bs=$('ul').querySelectorAll('[data-bl],[data-un]')
    for(var i=0;i<bs.length;i++)bs[i].onclick=function(){
      var id=+(this.getAttribute('data-bl')||this.getAttribute('data-un')),on=!!this.getAttribute('data-bl')
      var msg=on?'Bu foydalanuvchi BLOKLANADI — ilovaga kira olmaydi. Davom etamizmi?':'Blok olib tashlanadi — foydalanuvchi yana kira oladi. Davom etamizmi?'
      if(!confirm(msg))return
      var btn=this;btn.disabled=true
      api('block','POST',{id:id,on:on}).then(function(r){
        if(authFail(r))return
        btn.disabled=false
        if(r.j&&r.j.ok)loadUsers()
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var ds=$('ul').querySelectorAll('[data-dm]')
    for(var i=0;i<ds.length;i++)ds[i].onclick=function(){sendDm(+(this.getAttribute('data-dm')))}
    var ins=$('ul').querySelectorAll('[data-in]')
    for(var i=0;i<ins.length;i++)ins[i].onclick=function(){showUser(+(this.getAttribute('data-in')))}
  })
}
// v105: ALOHIDA XABAR — «50gram admin» nomidan BITTA foydalanuvchiga
function sendDm(id){
  var v=prompt('Foydalanuvchiga yuboriladigan xabar («50gram admin» nomidan):')
  if(v===null)return
  v=v.trim()
  if(!v){alert('Xabar matni bo\'sh');return}
  if(!confirm('Xabar shu foydalanuvchining xabar bo\'limiga yuboriladi. Davom etamizmi?'))return
  api('dm','POST',{id:id,body:v}).then(function(r){
    if(authFail(r))return
    if(r.j&&r.j.ok)alert('✓ Xabar yuborildi («50gram admin» nomidan).')
    else alert((r.j&&r.j.error)||'Xatolik')
  })
}
// v105: BITTA FOYDALANUVCHI TO\'LIQ MA\'LUMOT OYNASI
function kvr(k,v){return '<div class="kv"><span>'+k+'</span><b>'+v+'</b></div>'}
function showUser(id){
  $('mdl').classList.remove('hidden')
  $('mc').innerHTML='<p class="note">Yuklanmoqda...</p>'
  api('user?id='+id).then(function(r){
    if(authFail(r))return
    var u=r.j
    if(!u||u.id===undefined){$('mc').innerHTML='<button class="xcl" onclick="document.getElementById(\'mdl\').classList.add(\'hidden\')">×</button><p class="note">'+esc((r.j&&r.j.error)||'Topilmadi')+'</p>';return}
    var h='<button class="xcl" id="mx">×</button>'
      +'<h4>'+esc(u.name||'(ism yozilmagan)')+'</h4>'
      +'<div class="sub">ID '+u.id+' · '+ccName(u.cc)+'</div>'
      +kvr('Telefon',esc(u.phone))
      +kvr('Foydalanuvchi nomi',u.username?'@'+esc(u.username):'—')
      +kvr('Tarjimai hol',u.bio?esc(u.bio):'—')
      +kvr('Holati',u.bl?'<span class="tag">Bloklangan</span>':'Faol')
      +kvr('Royxatdan o\'tgan',dt(u.cr))
      +kvr('Oxirgi faollik',rel(u.ls))
      +kvr('Sessiya tugashi',dt(u.sessEnd))
      +kvr('Yozgan xabarlari',String(u.messages))
      +kvr('Suhbatlari',String(u.chats))
      +kvr('Qo\'ng\'iroqlari',String(u.calls))
      +kvr('Fayllari',String(u.files))
      +'<div class="mrow2"><button id="mdm">Xabar yozish</button>'+(u.bl?'<button class="sec" id="mun">Blokdan chiqarish</button>':'<button class="warn" id="mbl">Bloklash</button>')+'</div>'
    $('mc').innerHTML=h
    $('mx').onclick=closeMdl
    $('mdm').onclick=function(){sendDm(u.id)}
    var bb=document.getElementById(u.bl?'mun':'mbl')
    if(bb)bb.onclick=function(){
      var on=!u.bl
      if(!confirm(on?'BLOKLANADI. Davom etamizmi?':'Blok olib tashlanadi. Davom etamizmi?'))return
      api('block','POST',{id:u.id,on:on}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok){closeMdl();loadUsers()}else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
  })
}
function closeMdl(){$('mdl').classList.add('hidden');$('mc').classList.remove('wide')}
$('mdl').onclick=function(e){if(e.target===this)closeMdl()}
// v106: KANALLAR/GURUHLAR BO'LIMI — ro'yxat + qidiruv + filtr (hamma/guruh/kanal/bloklangan)
var cpage=1,cpages=1
function loadChats(p){
  if(p)cpage=p
  var url='chats?page='+cpage
  var q=$('cq').value.trim()
  if(q)url+='&q='+encodeURIComponent(q)
  var ft=$('cft').value
  if(ft)url+='&ft='+ft
  api(url).then(function(r){
    if(authFail(r))return
    var j=r.j;if(!j||!j.chats)return
    cpages=j.pages
    $('cn').textContent='Jami: '+j.total+' ta chat — kanal: '+j.nc+' · guruh: '+j.ng+' · bloklangan: '+j.nb
    var h=''
    for(var i=0;i<j.chats.length;i++){var x=j.chats[i]
      h+='<div class="u">'
        +'<img src="/api/avatar/c/'+x.id+'?v='+x.av+'" alt="">'
        +'<div class="in"><div class="nm"><span class="tyt '+(x.type==='channel'?'chn':'grp')+'">'+(x.type==='channel'?'KANAL':'GURUH')+'</span>'+esc(x.title||'(nom yozilmagan)')+(x.bl?'<span class="tag">BLOKLANGAN</span>':'')+'</div>'
        +'<div class="sub">A‘zolar: '+x.members+' · Egasi: '+esc(x.owner||'—')+(x.username?' · @'+esc(x.username):'')+'</div>'
        +'<div class="st">ID '+x.id+' · Yaratilgan: '+dt(x.cr)+' · Xabarlar: '+x.msgs+' · Oxirgi: '+rel(x.lm)+'</div></div>'
        +'<div><button class="sec" data-ci="'+x.id+'">Ma\'lumot</button> '+(x.bl?'<button class="sec" data-cb="'+x.id+'" data-on="0">Blokdan chiqarish</button>':'<button class="warn" data-cb="'+x.id+'" data-on="1">Bloklash</button>')+' <button class="warn" data-cd="'+x.id+'">O‘chirish</button></div>'
        +'</div>'
    }
    $('cl').innerHTML=h||'<p class="note">Topilmadi</p>'
    $('cpgn').textContent=cpage+' / '+cpages
    $('cpv').disabled=cpage<=1
    $('cnx').disabled=cpage>=cpages
    var ims=$('cl').querySelectorAll('img')
    for(var i=0;i<ims.length;i++)ims[i].onerror=function(){this.style.visibility='hidden'}
    var cbs=$('cl').querySelectorAll('[data-cb]')
    for(var i=0;i<cbs.length;i++)cbs[i].onclick=function(){
      var id=+(this.getAttribute('data-cb')),on=+(this.getAttribute('data-on'))
      if(!confirm(on?'Bu kanal/guruh BLOKLANADI — hech kim yozolmaydi va kira olmaydi. Davom etamizmi?':'Blok yozuvi olib tashlanadi — kanal/guruh yana ishlaydi. Davom etamizmi?'))return
      var btn=this;btn.disabled=true
      api('chat/block','POST',{id:id,on:on}).then(function(r){
        if(authFail(r))return
        btn.disabled=false
        if(r.j&&r.j.ok)loadChats()
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var cds=$('cl').querySelectorAll('[data-cd]')
    for(var i=0;i<cds.length;i++)cds[i].onclick=function(){
      var id=+(this.getAttribute('data-cd'))
      if(!confirm('Kanal/guruh TAGI BILAN O\'CHIRILADI — barcha xabarlar, a‘zolar, fayllar QAYTARILMAYDIGAN holda o\'chadi. Davom etamizmi?'))return
      if(!confirm('IKKINCHI TASDIQLASH: o\'chirish QAYTARILMAYDI. Baribir o\'chirilsinmi?'))return
      var btn=this;btn.disabled=true
      api('chat/delete','POST',{id:id}).then(function(r){
        if(authFail(r))return
        btn.disabled=false
        if(r.j&&r.j.ok)loadChats()
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var cis=$('cl').querySelectorAll('[data-ci]')
    for(var i=0;i<cis.length;i++)cis[i].onclick=function(){showChat(+(this.getAttribute('data-ci')))}
  })
}
// v106: KANAL/GURUH MA'LUMOT OYNASI — xabarlar (yomon so'z belgisi bilan) + a'zolar + amallar
function showChat(id){
  $('mdl').classList.remove('hidden')
  $('mc').classList.add('wide')
  $('mc').innerHTML='<p class="note">Yuklanmoqda...</p>'
  api('chat?id='+id).then(function(r){
    if(authFail(r))return
    var x=r.j
    if(!x||x.id===undefined){$('mc').innerHTML='<button class="xcl" onclick="document.getElementById(\'mdl\').classList.add(\'hidden\')">×</button><p class="note">'+esc((r.j&&r.j.error)||'Topilmadi')+'</p>';return}
    var h='<button class="xcl" id="mx">×</button>'
      +'<h4><span class="tyt '+(x.type==='channel'?'chn':'grp')+'">'+(x.type==='channel'?'KANAL':'GURUH')+'</span>'+esc(x.title||'(nom yozilmagan)')+(x.bl?'<span class="tag">BLOKLANGAN</span>':'')+'</h4>'
      +'<div class="sub">ID '+x.id+(x.username?' · @'+esc(x.username):'')+'</div>'
      +kvr('Egasi',esc(x.owner.name||'—')+' · '+esc(x.owner.phone||'—'))
      +kvr('Tavsif',x.desc?esc(x.desc):'—')
      +kvr('A‘zolar',String(x.members))
      +kvr('Xabarlar',String(x.msgs))
      +kvr('Yaratilgan',dt(x.cr))
      +kvr('Oxirgi xabar',rel(x.lm))
    h+='<div class="mrow2">'+(x.bl?'<button class="sec" id="cbk">Blokdan chiqarish</button>':'<button class="warn" id="cbk">Bloklash</button>')+'<button class="warn" id="ccl">Xabarlarni tozalash</button><button class="warn" id="cdel">Kanalni O‘CHIRISH</button></div>'
    var bad=0
    h+='<h3>Xabarlar (oxirgi '+x.messages.length+')</h3>'
    for(var i=0;i<x.messages.length;i++){var m=x.messages[i]
      if(m.bad)bad++
      h+='<div class="mr'+(m.bad?' mrbad':'')+'"><div class="mri"><div class="mrt">'+dt(m.ts)+' · '+esc(m.sender)+(m.bad?' · <b style="color:#ff7b72">YOMON SO‘Z</b>':'')+'</div><div class="mrb">'+esc(m.kind==='text'?'':'['+m.kind+'] ')+esc(m.body||'')+'</div></div><button class="sec" data-mdel="'+m.id+'">O‘chirish</button></div>'
    }
    if(!x.messages.length)h+='<p class="note">Xabar yo‘q</p>'
    if(bad)h+='<div class="bar2" style="margin-top:10px"><button class="warn" id="cbad">YOMON SO‘ZLI '+bad+' TA XABARNI O‘CHIRISH</button></div>'
    h+='<h3>A‘zolar ('+x.mlist.length+')</h3>'
    for(var i=0;i<x.mlist.length;i++){var u=x.mlist[i]
      h+='<div class="mr"><div class="mri"><div class="mrt">'+esc(u.name||'(ism yozilmagan)')+' · '+esc(u.phone)+' · '+ccName(u.cc)+' · '+esc(u.role)+(u.ublk?' · <b style="color:#ff7b72">HISOB BLOKLANGAN</b>':'')+'</div></div>'+(u.id===x.owner.id?'<span class="act">EGASI</span>':'<button class="sec" data-mk="'+u.id+'">Chiqarish</button> <button class="sec" data-mb="'+u.id+'">Chetlatish</button>')+'</div>'
    }
    $('mc').innerHTML=h
    $('mx').onclick=closeMdl
    document.getElementById('cbk').onclick=function(){
      var on=!x.bl
      if(!confirm(on?'Bu kanal/guruh BLOKLANADI. Davom etamizmi?':'Blok yozuvi olib tashlanadi. Davom etamizmi?'))return
      api('chat/block','POST',{id:x.id,on:on}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)showChat(x.id)
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    document.getElementById('ccl').onclick=function(){
      if(!confirm('BARCHA xabarlar o‘chiriladi (chat o‘zining o‘rnida qoladi). Davom etamizmi?'))return
      api('chat/clear','POST',{id:x.id}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)showChat(x.id)
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    document.getElementById('cdel').onclick=function(){
      if(!confirm('Kanal/guruh TAGI BILAN O\'CHIRILADI — QAYTARILMAYDI. Davom etamizmi?'))return
      if(!confirm('IKKINCHI TASDIQLASH: baribir o\'chirilsinmi?'))return
      api('chat/delete','POST',{id:x.id}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok){closeMdl();loadChats()}
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var md=document.getElementById('cbad')
    if(md)md.onclick=function(){
      if(!confirm('YOMON SO‘ZLI '+bad+' ta xabar o‘chiriladi. Davom etamizmi?'))return
      api('chat/cleanbad','POST',{id:x.id}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok){alert('✓ '+r.j.removed+' ta xabar o‘chirildi.'+(r.j.removed>=100?' Yana qolgan bo‘lsa — tugmani yana bir marta bosing.':''));showChat(x.id)}
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var mds=$('mc').querySelectorAll('[data-mdel]')
    for(var i=0;i<mds.length;i++)mds[i].onclick=function(){
      var mid=+(this.getAttribute('data-mdel'))
      if(!confirm('Bu xabar o\'chiriladi (hamma a‘zolardan ham yo\'qoladi). Davom etamizmi?'))return
      api('msg/delete','POST',{id:mid}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)showChat(x.id)
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    var mks=$('mc').querySelectorAll('[data-mk]'),mbs=$('mc').querySelectorAll('[data-mb]')
    for(var i=0;i<mks.length;i++)mks[i].onclick=function(){
      var uid=+(this.getAttribute('data-mk'))
      if(!confirm('Bu a‘zo kanaldan/guruhdan CHIQARILADI. Davom etamizmi?'))return
      api('chat/kick','POST',{id:x.id,uid:uid,ban:0}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)showChat(x.id)
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
    for(var i=0;i<mbs.length;i++)mbs[i].onclick=function(){
      var uid=+(this.getAttribute('data-mb'))
      if(!confirm('Bu a‘zo CHETLATILADI — qayta kira olmaydi. Davom etamizmi?'))return
      api('chat/kick','POST',{id:x.id,uid:uid,ban:1}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)showChat(x.id)
        else alert((r.j&&r.j.error)||'Xatolik')
      })
    }
  })
}
// v105: XAVFSIZLIK BO'LIMI — hujumlar statistikasi + signalizatsiya
var KN={root:'Yadro/admin yo‘llariga kirish',ext:'Begona mijoz (skaner/bot)',inj:'In‘ektsiya/SQL',data:'Ma’lumot tortish',auth:'Parol brute-force',flood:'So‘rov toshqini',tok:'Yaroqsiz token',otp:'OTP pumping',clog:'Jurnal toshqini',scan:'4xx skaner'}
function knName(k){return KN[k]||k}
function loadSecurity(){
  api('security').then(function(r){
    if(authFail(r))return
    var s=r.j;if(!s||s.eall===undefined)return
    // v107: HIMOYA TUGMALARI — IKKITA ALOHIDA tugma (YOQISH + O‘CHIRISH), IKKALASI HAR DOIM
    // ko‘rinadi va ishlaydi (egasi so‘rovi: «himoyani o‘chirish tugmasi bor — himoyani yoqish
    // tugmasini ham ishlab chiq»). Hozirgi holat yonida qalin yozuv bilan ko‘rsatiladi.
    var fwoff=!!s.fwoff
    var fw=$('fwctl')
    fw.className=fwoff?'alarm':'alarm old'
    fw.innerHTML='<b>'+(fwoff?'⚠ HIMOYA QATLAMI O‘CHIQ — DASTUR HIMOYASIZ':'Himoya qatlami: YONIQ — dastur himoyalangan')+'</b>'
      +'<small>'+(fwoff
        ?'Hujum-himoya VAQTINCHA ishlamaydi (hech kim bloklanmaydi, iz ham qolmaydi). O‘zgartirish kiritib bo‘lingach «Himoyani YOQISH» tugmasini bosib tizmni himoyalangan holatga qaytaring.'
        :'7 qatlam himoya faol: yadro/begona-mijoz/in‘ektsiya/ma’lumot-tortish/brute-force/toshqin/skaner. Dasturga o‘zgartirish kiritayotganda «Himoyani o‘chirish» tugmasi bilan VAQTINCHA o‘chirib turib, ish bo‘lgach yana YOQING.')+'</small>'
      +'<div class="bar2" style="margin-top:10px">'
      +'<button id="fwon" class="grn">'+(fwoff?'🟢 Himoyani YOQISH (tavsiya etiladi)':'🟢 Himoyani YOQISH')+'</button>'
      +'<button id="fwof" class="warn">'+(fwoff?'Himoyani o‘chirish (hozir o‘chiq turibdi)':'Himoyani o‘chirish (faqat o‘zgartirish paytida)')+'</button>'
      +'<span class="fwst">Hozirgi holat: <b>'+(fwoff?'O‘CHIQ':'YONIQ')+'</b></span>'
      +'</div>'
    function fwBos(on){
      if(!confirm(on?'Himoya qatlami YOQILADI — hujumlar yana darhol bloklanadi (7 qatlam himoya ishga tushadi). Davom etamizmi?':'Himoya qatlami O‘CHIRILADI — hujumlar VAQTINCHA bloklanmaydi (faqat dasturga o‘zgartirish kiritish paytida ishlatilsin; ish tugagach YOQISH SHART). Davom etamizmi?'))return
      var b1=$('fwon'),b2=$('fwof');b1.disabled=true;b2.disabled=true
      api('fwtoggle','POST',{on:on}).then(function(r){
        if(authFail(r))return
        if(r.j&&r.j.ok)loadSecurity()
        else{b1.disabled=false;b2.disabled=false;alert((r.j&&r.j.error)||'Xatolik')}
      })
    }
    document.getElementById('fwon').onclick=function(){fwBos(true)}
    document.getElementById('fwof').onclick=function(){fwBos(false)}
    var aa=$('alrm'),an=s.alarmTs?(Date.now()-s.alarmTs):0
    if(s.alarmLast&&an<1800000){
      aa.innerHTML='<div class="alarm"><b>⚠ SIGNALIZATSIYA: HUJUM ANIQLANDI — himoya ishlab BLOKLAGAN</b><small>'+knName(s.alarmLast.kind)+' · IP '+esc(s.alarmLast.ip)+' · '+ccName(s.alarmLast.cc)+' · '+dt(s.alarmTs)+'</small><small>'+esc(s.alarmLast.note||'')+'</small></div>'
    }else if(s.alarmLast){
      aa.innerHTML='<div class="alarm old"><b>So‘nggi signal: '+knName(s.alarmLast.kind)+'</b><small>IP '+esc(s.alarmLast.ip)+' · '+ccName(s.alarmLast.cc)+' · '+dt(s.alarmTs)+' — '+esc(s.alarmLast.note||'')+'</small></div>'
    }else{
      aa.innerHTML='<div class="alarm old"><b>Xavfsizlik holati: ODDIY</b><small>So‘nggi 30 kun ichida signal beruvchi hujum aniqlanmagan. Dastur 7 qatlam himoya ostida.</small></div>'
    }
    var C=[
      ['24 soatda urinishlar',s.e24,'red'],
      ['7 kunda urinishlar',s.e7,'red'],
      ['Jami urinishlar (30 kun)',s.eall,''],
      ['Noyob hujumchi IP (7 kun)',s.uip,''],
      ['Blokda turgan IP',s.blocks,'acc'],
      ['Signal (30 daqiqa ichida)',s.alarmTs&&an<1800000?1:0,'red']
    ]
    var hh=''
    for(var i=0;i<C.length;i++)hh+='<div class="card '+C[i][2]+'"><small>'+C[i][0]+'</small><b>'+C[i][1]+'</b></div>'
    $('scards').innerHTML=hh
    function bars(arr,nm,val){
      var mx=1,i
      for(i=0;i<arr.length;i++)if(arr[i].n>mx)mx=arr[i].n
      var h=''
      for(i=0;i<arr.length;i++)h+='<div class="crow"><span class="nm">'+nm(arr[i])+'</span><span class="bar" style="background:#a1303f;width:'+Math.max(2,Math.round(arr[i].n/mx*260))+'px"></span><span class="n">'+val(arr[i])+'</span></div>'
      return h||'<p class="note">Hozircha malumot yoq — hujum bo‘lmagan</p>'
    }
    $('skinds').innerHTML=bars(s.kinds,function(x){return esc(x.name||knName(x.k))},function(x){return x.n})
    $('sccs').innerHTML=bars(s.ccs,function(x){return ccName(x.cc)},function(x){return x.n})
    $('spaths').innerHTML=bars(s.paths,function(x){return esc(x.p)},function(x){return x.n})
    var tr=''
    for(var i=0;i<s.recent.length;i++){var e=s.recent[i]
      tr+='<tr><td>'+dt(e.ts)+'</td><td class="ip">'+esc(e.ip)+(e.city?'<br><small style="color:#8b919c">'+esc(e.city)+'</small>':'')+'</td><td>'+ccName(e.cc)+'</td><td>'+esc(knName(e.kind))+'</td><td class="hiddencol ip">'+esc(e.path)+'</td><td><span class="act'+(e.act==='blok'?' b':'')+'">'+(e.act==='blok'?'BLOKLANDI':'Ushlandi')+'</span></td></tr>'
    }
    $('srec').innerHTML=tr||'<tr><td colspan="6" class="note">Hujum yo‘q — dastur tinch</td></tr>'
    var bl=''
    for(var i=0;i<s.blocksTop.length;i++){var b2=s.blocksTop[i]
      bl+='<tr><td class="ip">'+esc(b2.ip)+'</td><td>'+(b2.ms>86400000?Math.round(b2.ms/86400000)+' kun':b2.ms>3600000?Math.round(b2.ms/3600000)+' soat':Math.max(1,Math.round(b2.ms/60000))+' daqiqa')+' dan keyin</td></tr>'
    }
    $('sblk').innerHTML=bl||'<tr><td colspan="2" class="note">Blokda IP yo‘q — hamma ochiq</td></tr>'
    var al=''
    for(var i=0;i<s.alarms.length;i++){var a=s.alarms[i]
      al+='<div class="alarm old"><b>'+knName(a.kind)+(a.n>1?' ('+a.n+')':'')+'</b><small>IP '+esc(a.ip)+' · '+ccName(a.cc)+' · '+dt(a.ts)+'</small><small>'+esc(a.note||'')+'</small></div>'
    }
    $('salarms').innerHTML=al||'<p class="note">Signal yo‘q — hujum aniqlanmagan</p>'
  })
  // v106: BOSHQARUV JURNALI — paneldagi har amal (blok/ochirish/chetlatish/himoya)
  api('log').then(function(r){
    if(authFail(r))return
    var j=r.j;if(!j||!j.rows)return
    var h=''
    for(var i=0;i<j.rows.length;i++){var e=j.rows[i]
      h+='<tr><td>'+dt(e.ts)+'</td><td><span class="act">'+esc(e.act)+'</span></td><td class="hiddencol ip">'+esc(e.tgt)+'</td><td>'+esc(e.note)+'</td></tr>'
    }
    $('alog').innerHTML=h||'<tr><td colspan="4" class="note">Hozircha amallar yo‘q</td></tr>'
  })
}
function doLogin(){
  var pw=$('pw').value
  if(!pw)return
  $('lb').disabled=true
  $('le').textContent=''
  fetch('/api/panel/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pass:pw})})
    .then(function(r){return r.json().then(function(j){return{s:r.status,j:j||{}}}).catch(function(){return{s:r.status,j:{}}})})
    .then(function(r){
      if(r.j&&r.j.token){T=r.j.token;localStorage.setItem('g50adm',T);showApp()}
      else $('le').textContent=(r.j&&r.j.error)?r.j.error:'Kirish amalga oshmadi'
    })
    .catch(function(){$('le').textContent='Tarmoq xatosi'})
    .then(function(){$('lb').disabled=false})
}
function showApp(){$('lg').classList.add('hidden');$('app').classList.remove('hidden');loadStats()}
function logout(){localStorage.removeItem('g50adm');location.reload()}
var tabs=document.querySelectorAll('.tabs button')
for(var i=0;i<tabs.length;i++)tabs[i].onclick=function(){switchTab(this.getAttribute('data-t'))}
function switchTab(t){
  cur=t
  var bs=document.querySelectorAll('.tabs button')
  for(var i=0;i<bs.length;i++)bs[i].className=(bs[i].getAttribute('data-t')===t)?'on':''
  $('st').classList.toggle('hidden',t!=='st')
  $('us').classList.toggle('hidden',t!=='us')
  $('ch').classList.toggle('hidden',t!=='ch')
  $('br').classList.toggle('hidden',t!=='br')
  $('sc').classList.toggle('hidden',t!=='sc')
  if(t==='st')loadStats()
  if(t==='ch')loadChats()
  if(t==='sc')loadSecurity()
}
$('qb').onclick=function(){loadUsers(1)}
$('q').onkeydown=function(e){if(e.key==='Enter')loadUsers(1)}
$('pv').onclick=function(){if(page>1)loadUsers(page-1)}
$('nx').onclick=function(){if(page<pages)loadUsers(page+1)}
$('cqb').onclick=function(){loadChats(1)}
$('cq').onkeydown=function(e){if(e.key==='Enter')loadChats(1)}
$('cft').onchange=function(){loadChats(1)}
$('cpv').onclick=function(){if(cpage>1)loadChats(cpage-1)}
$('cnx').onclick=function(){if(cpage<cpages)loadChats(cpage+1)}
$('tx').oninput=function(){$('cnt').textContent=this.value.length+' / 4096'}
// v108: HAMMAGA RASM + IZOH — ilova klientining O'ZI qilgan sxema bilan (AES-GCM 256,
// 32-bayt kalit + 12-bayt iv, base64; sha256 — SHIFRLANGAN baytlar ustida). Panel rasmni
// 1600px gacha siqadi (canvas), o'zi shifrlaydi — worker faqat saqlaydi va tarqatadi.
var bimg=null
$('bpick').onclick=function(){$('bimgf').click()}
$('bimgf').onchange=function(){
  var f=this.files&&this.files[0];if(!f)return
  if(f.size>20*1024*1024){alert('Rasm 20 MB dan katta bo‘lmasin');return}
  var rd=new FileReader()
  rd.onload=function(){
    var img=new Image()
    img.onload=function(){
      // 1600px gacha siqish (gif siqilmaydi — animatsiya saqlansin)
      var w=img.width,h=img.height,mx=1600
      if(f.type==='image/gif'){bimg={file:f,name:f.name,mime:'image/gif',dataUrl:rd.result}}
      else{
        if(w>mx||h>mx){var k=w>h?mx/w:mx/h;w=Math.round(w*k);h=Math.round(h*k)}
        var cv=document.createElement('canvas');cv.width=w;cv.height=h
        var cx=cv.getContext('2d');cx.drawImage(img,0,0,w,h)
        bimg={file:f,name:f.name,mime:'image/jpeg',dataUrl:cv.toDataURL('image/jpeg',0.85)}
      }
      $('bimgn').textContent='✓ '+bimg.name
      $('bimgp').src=bimg.dataUrl;$('bimgp').classList.remove('hidden')
    }
    img.onerror=function(){alert('Rasm o‘qilmadi — boshqa fayl tanlang')}
    img.src=rd.result
  }
  rd.readAsDataURL(f)
}
function bimgClear(){bimg=null;$('bimgf').value='';$('bimgn').textContent='';$('bimgp').classList.add('hidden');$('bimgp').src=''}
function b64eU8(u){var s='',CH=0x8000;for(var i=0;i<u.length;i+=CH)s+=String.fromCharCode.apply(null,u.subarray(i,i+CH));return btoa(s)}
function hexBuf(buf){var a=new Uint8Array(buf),s='';for(var i=0;i<a.length;i++)s+=(a[i]<16?'0':'')+a[i].toString(16);return s}
async function bimgEnc(){
  // dataURL → bytes → AES-GCM (klient upload() bilan AYNAN bir xil) → {b64,key,iv,sha,size,mime,name,fsize}
  var bin=atob(bimg.dataUrl.split(',')[1]),plain=new Uint8Array(bin.length)
  for(var i=0;i<bin.length;i++)plain[i]=bin.charCodeAt(i)
  var raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12))
  var k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt'])
  var ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},k,plain.buffer))
  var sha=await crypto.subtle.digest('SHA-256',ct.buffer)
  return {b64:b64eU8(ct),key:b64eU8(raw),iv:b64eU8(iv),sha:hexBuf(sha),size:ct.length,mime:bimg.mime,name:bimg.name,fsize:plain.length}
}
$('sb').onclick=async function(){
  var v=$('tx').value.trim()
  if(!v&&!bimg){alert('E’lon matnini yozing yoki rasm biriktiring');return}
  if(!confirm(bimg?'E’lon (RASM'+(v?' + izoh':'')+') BARCHA faol foydalanuvchiga «50gram admin» nomidan yuboriladi. Davom etamizmi?':'Xabar BARCHA faol foydalanuvchiga «50gram admin» nomidan yuboriladi. Davom etamizmi?'))return
  var b=this;b.disabled=true;$('bres').className='res';$('bres').textContent='Yuborilmoqda...'
  try{
    var payload={body:v}
    if(bimg){$('bres').textContent='Rasm tayyorlanmoqda...';payload.img=await bimgEnc()}
    api('broadcast','POST',payload).then(function(r){
      b.disabled=false
      if(authFail(r))return
      if(r.j&&r.j.ok){$('bres').textContent='✓ Yuborildi: '+r.j.sent+' foydalanuvchiga ('+r.j.new_chats+' yangi suhbat'+(r.j.online?', '+r.j.online+' onlayniga darhol yetdi':'')+(r.j.failed?', '+r.j.failed+' YETMADI':'')+').';$('tx').value='';$('cnt').textContent='0 / 4096';bimgClear()}
      else{$('bres').className='res err';$('bres').textContent=(r.j&&r.j.error)||'Xatolik'}
    })
  }catch(e){b.disabled=false;$('bres').className='res err';$('bres').textContent='Rasm tayyorlanmadi: '+(e&&e.message||e)}
}
$('rf').onclick=function(){loadStats();if(cur==='us')loadUsers();if(cur==='ch')loadChats();if(cur==='sc')loadSecurity()}
$('out').onclick=logout
$('lb').onclick=doLogin
$('pw').onkeydown=function(e){if(e.key==='Enter')doLogin()}
setInterval(function(){if(cur==='st'&&!document.hidden&&T)loadStats()},60000)
if(T)showApp()
else{$('lg').classList.remove('hidden');setTimeout(function(){try{$('pw').focus()}catch(e){}},60)}
</script>
</body>
</html>`

// ------------------------- Router -------------------------
type H = (c: C) => Promise<Response>
const routes: Array<[string, string, H, boolean?]> = [
  ["POST", "/auth/otp", authOtp, true],
  ["POST", "/auth/verify", authVerify, true],
  ["POST", "/auth/logout", authLogout],
  ["GET", "/avatar/u/:id", (c) => avatar(c, "users"), true],
  ["GET", "/avatar/c/:id", (c) => avatar(c, "chats"), true],
  ["GET", "/health", async () => json({ ok: true, app: "50 Gram" }), true],
  // BUILD QOROVUSI: klient (core.js) versiyasini tekshiradi — mos kelmasa o'zi yangilanadi.
  // Ochiq (auth'siz): kirish ekranida ham eski kod yangilanib qolsin. Keshlanmaydi.
  ["GET", "/build", async () => json({ v: BUILD_V, now: now() }), true],
  // XATO JURNALI — faqat egaga (DEV_PHONES). Serverdagi har 500-sinf xato err_jurnal'ga
  // yoziladi; bu yo'l orqali o'zbekcha tashxis: «log bilan topish» doktrinasi.
  ["GET", "/jurnal", adminJurnal],
  // MAXFIY ADMIN PANEL (v104) — faqat egaga. Yo'l /panel/* — FW_TRAP'ga (/adm*, /admin...) KIRMAYDI.
  // Barchasi open:true (o'z JWT'siz) — ichkarida admAuth() adm-token tekshiradi (JWT_SECRET imzosi).
  ["POST", "/panel/login", panelLogin, true],
  ["GET", "/panel/stats", panelStats, true],
  ["GET", "/panel/users", panelUsers, true],
  ["POST", "/panel/block", panelBlock, true],
  ["POST", "/panel/broadcast", panelBroadcast, true],
  ["GET", "/panel/security", panelSecurity, true],
  ["GET", "/panel/user", panelUser, true],
  ["POST", "/panel/dm", panelDm, true],
  // v106: KANAL/GURUH MODERATSIYASI + HIMOYA TUGMASI + BOSHQARUV JURNALI
  ["GET", "/panel/chats", panelChats, true],
  ["GET", "/panel/chat", panelChat, true],
  ["POST", "/panel/chat/block", panelChatBlock, true],
  ["POST", "/panel/chat/delete", panelChatDelete, true],
  ["POST", "/panel/chat/kick", panelChatKick, true],
  ["POST", "/panel/chat/clear", panelChatClear, true],
  ["POST", "/panel/chat/cleanbad", panelChatCleanBad, true],
  ["POST", "/panel/msg/delete", panelMsgDelete, true],
  ["POST", "/panel/fwtoggle", panelFwToggle, true],
  ["GET", "/panel/log", panelLog, true],
  ["GET", "/me", getMe],
  ["PATCH", "/me", patchMe],
  ["POST", "/ping", async (c) => { const t = now(); await c.db.run("UPDATE users SET last_seen=?, token_exp=? WHERE id=?", [t, t + 180 * 86400 * 1000, c.uid]); return json({ ok: true, now: t }) }],
  ["GET", "/users/:id", getUser],
  ["GET", "/search", search],
  ["GET", "/discover", discover],
  ["GET", "/resolve/:name", chatByUsername],
  ["GET", "/contacts", listContacts],
  ["POST", "/contacts", addContact],
  ["DELETE", "/contacts/:phone", delContact],
  ["GET", "/blocks", listBlocks],
  ["POST", "/blocks/:id", (c) => block(c, true)],
  ["DELETE", "/blocks/:id", (c) => block(c, false)],
  ["GET", "/chats", listChats],
  ["POST", "/chats", createChat],
  ["POST", "/chats/direct", openDirect],
  ["GET", "/invite/:hash", chatByInvite],
  ["GET", "/chats/:id", getChat],
  ["PATCH", "/chats/:id", patchChat],
  ["DELETE", "/chats/:id", deleteChat],
  ["POST", "/chats/:id/invite", revokeInvite],
  ["POST", "/chats/:id/join", joinChat],
  ["POST", "/chats/:id/leave", leaveChat],
  ["POST", "/chats/:id/mute", muteChat],
  ["POST", "/chats/:id/pin", pinChat],
  ["POST", "/messages/:id/pin", pinMessage],
  ["GET", "/chats/:id/members", listMembers],
  ["POST", "/chats/:id/members", addMembers],
  ["POST", "/chats/:id/members/:uid/:action", memberAction],
  ["GET", "/chats/:id/stats", chatStats],
  ["GET", "/chats/:id/requests", listRequests],
  ["POST", "/chats/:id/requests/:uid/:action", requestAction],
  ["GET", "/chats/:id/messages", getMessages],
  ["POST", "/chats/:id/messages", sendMessage],
  ["DELETE", "/chats/:id/messages", clearChat],
  ["POST", "/chats/:id/read", markRead],
  ["POST", "/chats/:id/typing", typing],
  ["PATCH", "/messages/:id", editMessage],
  ["DELETE", "/messages/:id", deleteMessage],
  ["POST", "/messages/:id/react", react],
  ["POST", "/messages/:id/vote", vote],
  ["POST", "/media", mediaCreate],
  ["PUT", "/media/:id/:idx", mediaPut],
  ["POST", "/media/:id/done", mediaDone],
  ["GET", "/media/:id", mediaMeta],
  ["GET", "/media/:id/restore-info", mediaRestoreInfo], // v97: to'r → server tiklash (mediaChunk'dan OLDIN — 3-bo'lakli yo'llar tartib bilan mos keladi!)
  ["GET", "/media/:id/:idx", mediaChunk],
  ["GET", "/stories", listStories],
  ["POST", "/stories", createStory],
  ["POST", "/stories/:id/view", viewStory],
  ["GET", "/stories/:id/views", storyViews],
  ["DELETE", "/stories/:id", deleteStory],
  ["GET", "/feed", feed],
  ["GET", "/reels", reels],
  ["GET", "/trend", trend],
  ["GET", "/trend/article", trendArticle],
  ["POST", "/trend/ev", trendEv],
  ["GET", "/trend/insights", trendInsights],
  ["POST", "/posts", createPost],
  ["DELETE", "/posts/:id", deletePost],
  ["POST", "/posts/:id/like", likePost],
  ["GET", "/posts/:id/comments", listComments],
  ["POST", "/posts/:id/comments", addComment],
  ["POST", "/comments/:id/react", reactComment],
  ["DELETE", "/comments/:id", deleteComment],
  ["GET", "/push/vapid", async (c) => json({ key: c.env.VAPID_PUBLIC_KEY || "" }), true],
  ["POST", "/push/subscribe", pushSubscribe],
  ["POST", "/push/unsubscribe", pushUnsubscribe],
  ["GET", "/notify/unread", notifyUnread],
  ["GET", "/ice", ice],
  ["POST", "/calls", startCall],
  ["GET", "/calls/pending", callPending],
  ["POST", "/calls/:id/status", callStatus],
  ["POST", "/clog", callLog],
  ["POST", "/signal", signal],
  ["GET", "/signal/queue", signalQueue],
  ["POST", "/p2p/have", SW.p2pHave],
  ["GET", "/p2p/peers", SW.p2pPeers],
  ["POST", "/p2p/signal", SW.p2pSignal],
  ["POST", "/p2p/verify", SW.p2pVerify],
  ["POST", "/storage/beat", SW.storageBeat],
  ["POST", "/storage/drop", SW.storageDrop],
  ["GET", "/storage/stats", SW.storageStats],
  ["GET", "/lives", listLives],
  ["GET", "/lives/top", listTopLives],
  ["POST", "/lives", startLive],
  ["POST", "/lives/:id/join", joinLive],
  ["POST", "/lives/:id/leave", leaveLive],
  ["POST", "/lives/:id/ready", readyLive],
  ["POST", "/lives/:id/comment", liveComment],
  ["POST", "/lives/:id/gift", giftLive],
  ["POST", "/lives/:id/end", endLive],
  ["GET", "/wallet", getWallet],
  ["POST", "/wallet/daily", dailyBonus],
  // v114 TARJIMON + REYTING
  ["POST", "/translate", apiTranslate],
  ["POST", "/translate/speech", apiTranslateSpeech],
  ["GET", "/rating", apiRating],
  ["GET", "/messages/:id/comments", listMsgComments],
  ["POST", "/messages/:id/comments", addMsgComment],
  ["DELETE", "/messages/:id/comments/:cid", delMsgComment],
  // VAQTINCHA test vositalari O'CHIRILDI (xavfsizlik): /adm/*, /trend/trdbg, /trend/srcdbg —
  // endi bu yo'llar firewall TRAP hisoblanadi (urinish = 30 kun blok)
]
function match(method: string, path: string) {
  const parts = path.split("/").filter(Boolean)
  for (const [m, pat, h, open] of routes) {
    if (m !== method) continue
    const pp = pat.split("/").filter(Boolean)
    if (pp.length !== parts.length) continue
    const p: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pp.length; i++) {
      // v71: noto'g'ri % ketma-ketligi (%zz) URIError otib, butun so'rovni 500 qilardi →
      // endi dekodlash muvaffaqiyatsiz bo'lsa xom qiymat ishlatiladi (so'rov 404/oddiy oqimda davom etadi)
      if (pp[i].startsWith(":")) { try { p[pp[i].slice(1)] = decodeURIComponent(parts[i]) } catch { p[pp[i].slice(1)] = parts[i] } }
      else if (pp[i] !== parts[i]) { ok = false; break }
    }
    if (ok) return { h, p, open: !!open }
  }
  return null
}

async function cleanup(env: Env) {
  const db = env.__db || makeDb(env.DATABASE_URL)
  try { await ensureSchema(db) } catch {}
  const t = now()
  // O'CHMAS TARIX: xabarlar, fayllar va istoriyalar faqat foydalanuvchi o'zi o'chirmaguncha saqlanadi.
  // Cron faqat texnik chiqindilarni tozalaydi (kodlar, pin joblar, P2P reyestri) — hech qanday yozishmani o'chirmaydi.
  // MIGRATSIYA-HIMOYA: eskirgan qisqa-TTL yozishmalar (eski versiya qoldiqlari) tasodifan tozalanib qolmasin.
  await db.run("UPDATE messages SET expires_at=? WHERE expires_at>0 AND expires_at<?", [t + 100 * 365 * DAY, t + 30 * DAY])
  await db.run("UPDATE media SET expires_at=?, keep=1, next_check=0 WHERE expires_at>0 AND expires_at<? AND dropped=0 AND gone=0 AND (keep=1 OR chat_id>0)", [t + 100 * 365 * DAY, t + 30 * DAY])
  // v97 R2 KASBIY BOSHQARUV (Task 46: «shifrlangan kodlar tozalanib tursin, to'lib qolmay»):
  // (1) TENGLASHTIRILGAN O'CHIRISH: avvalgi versiyada R2 faqat 100 fayl o'chirdi, D1 esa
  //     HAMMASINI — 100 dan ortiq o'lik fayl bo'lsa R2'da YETIM obyektlar qolardi (ko'rinmas
  //     o'sish, 10 GB to'lib qolish xavfi). Endi R2 va D1 o'chirish BITTA batchda — yetim
  //     obyekt KAFOLATGAN yo'q. (2) YETIM SWEEP: R2 ro'yxatidan (≤1000 kalit) media yozuvi
  //     yo'q kalitlar o'chadi — tarixiy sizib qolganlar ham tozalanadi. (3) 5 batch = 500 fayl.
  try {
    if (env.BUCKET) {
      for (let batch = 0; batch < 5; batch++) {
        const dead = await db.q("SELECT id, chunks FROM media WHERE ((expires_at>0 AND expires_at<?) OR dropped=1) AND gone=0 LIMIT 100", [t])
        if (!dead.length) break
        let n = 0
        for (const drow of dead) {
          const keys: string[] = []
          for (let i = 0; i < Math.min(80, +drow.chunks || 1); i++) keys.push(`m/${drow.id}/${i}`)
          await Promise.all(keys.map((k) => env.BUCKET!.delete(k).catch(() => {})))
          n += keys.length
        }
        const ids = dead.map((drow: any) => drow.id)
        await db.run(`DELETE FROM media_chunks WHERE media_id IN (${ph(ids)})`, ids)
        await db.run(`DELETE FROM media WHERE id IN (${ph(ids)}) AND (expires_at>0 AND expires_at<? AND keep=0)`, [...ids, t])
        console.log("R2 tozalash:", n, "bo'lak,", ids.length, "fayl (D1 birga, yetimsiz)")
      }
      // YETIM SWEEP: media yozuvi yo'q R2 kalitlari (tarixiy siziblar ham shu yerda yopiladi)
      if (env.BUCKET.list) {
        const lst = await env.BUCKET.list({ prefix: "m/", limit: 1000 }).catch(() => null)
        const objs = lst?.objects || []
        if (objs.length) {
          const rids = [...new Set(objs.map((o: any) => String(o.key).split("/")[1]).filter(Boolean))]
          const alive = new Set((await db.q(`SELECT id FROM media WHERE id IN (${ph(rids)})`, rids)).map((r: any) => r.id))
          const yetim = rids.filter((id) => !alive.has(id))
          if (yetim.length) {
            let kn = 0
            for (const y of yetim) {
              const ykeys = objs.filter((o: any) => String(o.key).startsWith(`m/${y}/`)).map((o: any) => o.key)
              await Promise.all(ykeys.map((k) => env.BUCKET!.delete(k).catch(() => {})))
              kn += ykeys.length
            }
            console.log("R2 yetim tozalash:", yetim.length, "fayl,", kn, "kalit")
          }
        }
      }
    } else {
      await db.run("DELETE FROM media_chunks WHERE media_id IN (SELECT id FROM media WHERE ((expires_at>0 AND expires_at<?) OR dropped=1) AND gone=0)", [t])
      await db.run("DELETE FROM media WHERE expires_at>0 AND expires_at<? AND keep=0", [t])
    }
    await db.run("DELETE FROM media WHERE dropped=1 AND created_at<? AND id NOT IN (SELECT media_id FROM peer_have)", [t - 30 * DAY])
  } catch (e) { console.log("R2 tozalash xatosi", String(e)) }
  await db.run("DELETE FROM pin_jobs WHERE created_at<?", [t - 2 * DAY])
  // Qo'ng'iroq signal navbati: 2 daqiqadan eski yozuvlar savat (yetib bo'lgan/emirilgan)
  await db.run("DELETE FROM call_signals WHERE created_at<?", [t - 2 * 60000])
  // O'LIK QO'NG'IROQLAR SWEEP: status yozilmagan "ringing" (5 daqiqadan eski) yakunlanadi —
  // aks holda qabul qiluvchida qayta jiringlab, yangi qo'ng'iroqlarga "Band" to'sqinlik qilardi.
  await db.run("UPDATE calls SET status='missed', ended_at=? WHERE ended_at=0 AND status='ringing' AND started_at<?", [t, t - 5 * 60000])
  // Uzilgan qo'ng'iroqlar gigiyenasi: 3 soatdan eski "active" lekin hech kim tugatmagan yozuvlar yopiladi
  await db.run("UPDATE calls SET status='ended', ended_at=? WHERE ended_at=0 AND status='active' AND started_at<?", [t, t - 3 * 3600000])
  await SW.planReplicas(db, 300)
  await db.run("DELETE FROM otp WHERE expires_at<?", [t])
  await db.run("DELETE FROM push_subs WHERE updated_at<?", [t - 90 * DAY]) // 90 kun ishlatilmagan obunalar
  await db.run("DELETE FROM peer_have WHERE updated_at<?", [t - 120 * DAY])
  // Xato-jurnali gigiyenasi: 14 kundan eski server-xatolar o'chadi (jurnal abadiy o'smaydi)
  await db.run("DELETE FROM err_jurnal WHERE ts<?", [t - 14 * DAY])
  // v105: xavfsizlik hodisalari 30 kun, signalizatsiya yozuvlari 90 kun saqlanadi
  // (egada hujum dalillari uzoq muddat bor; jadvallar abadiy o'smaydi)
  await db.run("DELETE FROM sec_events WHERE ts<?", [t - 30 * DAY]).catch(() => {})
  await db.run("DELETE FROM sec_alarm WHERE ts<?", [t - 90 * DAY]).catch(() => {})
  // v106: boshqaruv jurnali 90 kun saqlanadi (jadval abadiy o'smaydi)
  await db.run("DELETE FROM adm_log WHERE ts<?", [t - 90 * DAY]).catch(() => {})
  await db.run("UPDATE lives SET ended_at=? WHERE ended_at=0 AND started_at<?", [t, t - 12 * 3600000])
  // TiDB/R2 XOTIRA POSBONI (Task 39 + v79): server — faqat ko'prik. Asosiy xotira — foydalanuvchilar
  // qurilmalari (planReplicas kamida 15 nusxa yig'adi, P2P o'rgimchak to'ri yetkazadi).
  // v79: baytlar R2'da (D1'da faqat markarlar) — chegara R2 bepul limitiga (10 GB) moslab
  // 8 GB bo'ldi. Chegaradan oshsa — eng eski va kamida 2 ta qurilmada ishonchli nusxasi
  // bor fayllar serverdan bo'shatiladi (dropped=1 → sweep R2+D1'dan o'chadi). Keyin ham
  // fayl qurilmalar orasidan topiladi; server joyi abadiy o'smaydi.
  try {
    const MEDIA_KEEP_BYTES = env.BUCKET ? 8 * 1024 * 1024 * 1024 : 2.5 * 1024 * 1024 * 1024
    // v97 BOSQICHLI POSBON: chegaradan oshsa bir yugurishda 3 bosqich (300 fayl)gacha
    // bo'shatadi — R2 bepul 10 GB chegara hech qachon to'lib qolmaydi. Fayllar serverdan
    // faqat KAMIDA 2 ta qurilmada ishonchli nusxasi bor bo'lsa bo'shatiladi (yo'qolmaydi).
    for (let round = 0; round < 3; round++) {
      const msz = await db.one("SELECT COALESCE(SUM(size),0) AS n FROM media WHERE dropped=0 AND gone=0 AND keep=1")
      if (Number(msz?.n || 0) <= MEDIA_KEEP_BYTES) break
      const cands = await db.q("SELECT id FROM media WHERE dropped=0 AND gone=0 AND keep=1 AND replicas>=2 ORDER BY created_at LIMIT 100")
      if (!cands.length) break
      const ids = cands.map((x) => x.id)
      await db.run(`UPDATE media SET dropped=1 WHERE id IN (${ph(ids)})`, ids)
      console.log("Xotira posboni:", ids.length, "fayl serverdan bo'shatildi (nusxalari qurilmalarda), bosqich", round + 1)
    }
  } catch (e) { console.log("Xotira posboni xatosi", String(e)) }
}

// 4xx skaner nazorati — chegara oshsa true (blok) qaytaradi
// KOLLABORATIV ZARAR HIMOYASI («bir marta ishlagan funksiya keyin ishlamay qoldi» ildizi):
// 1) AUDIT probe'lari (x-audit-probe:1) ATAYLAB 4xx oladi — ular hisobga KIRMASIN (aks holda
//    audit o'z runner-IP'ini 30 daqiqaga bloklaydi va keyingi CI-testlar (E2E!) YO'LDA
//    qoladi — aynan shu sababli E2E 3c2d44e da A tomoni API'si o'lib, qo'ng'iroq YIQILDI);
//    haqiqiy skaner bu sarlavhani bilishi mumkin — lekin u baribir TRAP/FLOOD/OTP/429
//    qoidalariga urilib turadi, yagona himoya shu emas.
// 2) Chegara 100→300 (haqiqiy skaner 300ni ham tez yig'adi; CGNAT/mobil-IP'dagi YUZLAR
//    halol foydalanuvchi birga yig'ilganda 4xx kam bo'ladi — kollaborativ zarar yo'q).
// 3) Birinchi blok 30→5 daqiqa (takrorlanuvchilar fwOchko daraja-3 bilan uzayadi).
function fw4xx(env: Env, wait: (p: Promise<unknown>) => void, ip: string, info?: SecInfo) {
  if (FW_OFF) return false // v106: himoya o'chiq — 4xx-skaner posboni ham o'chiq
  const e = FW_4XX.get(ip), t = Date.now()
  if (!e || t - e.t > 600_000) { if (FW_4XX.size > 5000) FW_4XX.clear(); FW_4XX.set(ip, { n: 1, t }); return false }
  if (++e.n <= 300) return false
  FW_4XX.delete(ip)
  fwLBlok(ip, 5 * 60_000)
  fwOchko(env, wait, ip, "scan", 3, info)
  return true
}
export default {
  async fetch(req: Request, env: Env, ctx?: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url)
    // APK: majburiy yuklab olish (attachment) — ba'zi brauzerlar download atributiga
    // e'tibor bermaydi yoki faylni ochishga harakat qiladi; sarlavha buni hal qiladi
    if (url.pathname === "/50gram.apk") {
      const asset = await env.ASSETS!.fetch(new Request(url.toString(), { method: "GET" }))
      const h = new Headers(asset.headers)
      h.set("Content-Disposition", 'attachment; filename="50gram.apk"')
      h.set("Cache-Control", "public, max-age=3600")
      for (const [k, v] of Object.entries(SEC_H)) h.set(k, v)
      return new Response(asset.body, { status: asset.status, headers: h })
    }
    // index.html: HAR SAFAR qayta tasdiqlansin — APK WebView va brauzer hech qachon eski
    // qobiqni (masalan TEST rejimi bannerisiz nusxani) xotirasidan qaytarmasin (Task 39)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // v104 MAXFIY ADMIN PANEL: faqat /?adminpanel so'rovda (ilovada havola YO'Q, noindex).
      // Sahifa worker xotirasidan — web/ papkada fayl yo'q, demak "saytda ma'lumot yo'q".
      if (url.searchParams.has("adminpanel"))
        return new Response(ADMIN_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", ...SEC_H },
        })
      const asset = await env.ASSETS!.fetch(new Request(url.toString(), { method: "GET" }))
      const h = new Headers(asset.headers)
      h.set("Cache-Control", "no-cache, must-revalidate")
      for (const [k, v] of Object.entries(SEC_H)) h.set(k, v)
      return new Response(asset.body, { status: asset.status, headers: h })
    }
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
    const wait = (p: Promise<unknown>) => { const s = p.catch((e) => console.log("fon xato", String(e))); ctx?.waitUntil ? ctx.waitUntil(s) : void s }
    // ---- FW OPS (egaga maxfiy boshqaruv): blok yechish — FIREWALLDAN OLDIN ishlaydi.
    // Nega oldin: eganing IP'si xato bilan bloklansa ham o'zini qutqara olsin (JWT tekshiruvi
    // lokal — DB faqat o'qish). Ruxsat: DEV_PHONES'dagi raqamning yaroqli JWT tokeni.
    // Boshqa har qanday urinish — oddiy "Not found" (hech qanday ma'lumot sizchtirmaydi).
    if (url.pathname === "/api/fw/fix" && req.method === "POST") {
      const b: any = await req.json().catch(() => ({}))
      let ok = false
      try {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const payload = env.JWT_SECRET && token ? await verifyJwt(token, env.JWT_SECRET) : null
        if (payload) {
          const db = env.__db || makeDb(env.DATABASE_URL)
          const u = await db.one("SELECT phone FROM users WHERE id=?", [Number(payload.sub)]).catch(() => null)
          const admins = listVar(env.DEV_PHONES).map((s) => (s.startsWith("+") ? s : "+" + s))
          const ph2 = String(u?.phone || "")
          if (ph2 && admins.includes(ph2)) ok = true
        }
      } catch {}
      if (!ok) return FW_404()
      const ip = str(b?.ip, 50) || fwIp(req)
      if (!ip) return json({ ok: false, err: "ip yo'q" })
      let out: any = { ok: true, ip }
      try {
        const st = env.SEC!.get(env.SEC!.idFromName("global"))
        const r = await st.fetch("https://fw/?op=unblock&ip=" + encodeURIComponent(ip))
        const j: any = await r.json().catch(() => ({}))
        out = { ...j, ip }
      } catch (e: any) { out = { ok: false, err: String(e?.message || e).slice(0, 60) } }
      return json(out)
    }
    // ---- SEC FIREWALL: ko'rinmas himoya qatlami (oddij foydalanuvchi hech narsa sezmaydi) ----
    const fwip = fwIp(req)
    // AUDIT PROBE BELGISI: CI-auditning O'Z so'rovlari — ataylab 4xx oladi, fw4xx hisobiga kirmasin
    // (aks holda audit o'z runner-IP'ini bloklab, keyingi testlarni yo'qotadi — fw4xx izohiga qarang)
    const probeQ = req.headers.get("x-audit-probe") === "1"
    // SOVUQ IZOLYAT: yangi tug'ilgan izolyatda blok-ro'yxat hali yuklanmagan — birinchi so'rov
    // UNI KUTADI (≤200ms, izolyat umri ichida BIR martalik). Aks holda bloklangan IP birinchi
    // so'rovda o'tib ketardi (xavfsizlik teshigi) va bloklar izolyatlar orasida notekis ishlar edi.
    if (env.SEC && FW_YANGI === 0) { try { await fwYangola(env) } catch {} }
    fwKeshYana(env, wait)
    // v108 STALE-FLAG POSBONI: himoya O'CHIQ ko'rinsa — 5 sekunddan OSHSA DO bilan SINXRON
    // tasdiqlash (uzoq bo'sh turgan izolyat eski "o'chiq" holat bilan uyg'onsa, SHU so'rovda
    // to'g'irlanadi — aks holda birinchi so'rovlar himoyasiz o'tib ketardi: SECURITY E2E'da
    // kuzatilgan holat. Himoya YONIQ bo'lganda bu yo'l umuman ishlamaydi — 0 xarajat).
    if (fwip && FW_OFF && Date.now() - FW_TASDIQ > 5_000) {
      FW_TASDIQ = Date.now()
      try { await fwTekshir(env, fwip) } catch {}
    }
    if (fwip && !FW_OFF) {
      // v106: himoya O'CHIQ bo'lsa bu butun blok O'TKAZIB YUBORILADI (egasi o'zgartirish
      // kiritayotganda curl/skript-sinovlar ham bloklanmaydi, iz ham qolmaydi).
      if (fwBlokli(fwip)) {
        // Blok lokal keshdan chiqdi — DO hali ham tasdiqlayaptimi? (≤50ms, faqat
        // bloklanganlar to'laydi; halol foydalanuvchi bu yo'lga umuman kirmaydi).
        try { await fwTekshir(env, fwip) } catch {}
        if (fwBlokli(fwip)) return FW_404()
      }
      // TASHQI MIJOZ NAZORATI: faqat sayt (brauzer) va ilova (APK WebView/fon xizmati)
      // ruxsat etilgan. Curl, skaner, skript, bot — tashqi jashnchi: 1-URINISHDA DARHOL
      // 30 kun blok. Oddiy foydalanuvchi (sayt/app) hech qachon shu to'siqqa urilmaydi.
      const fua = req.headers.get("user-agent") || ""
      if (!FW_UA_OK.test(fua)) { fwLBlok(fwip, 30 * DAY); fwOchko(env, wait, fwip, "ext", 1, secInfo(req, url)); return FW_404() }
      // Toshqin: 1 IP → 10s ichida 80+ so'rov = darhol lokal blok + doimiy ochko
      const rt = FW_RATE.get(fwip), tn = Date.now()
      if (!rt || tn - rt.t > 10_000) { if (FW_RATE.size > 5000) FW_RATE.clear(); FW_RATE.set(fwip, { n: 1, t: tn }) }
      else if (++rt.n > 80) { fwLBlok(fwip, 15 * 60_000); fwOchko(env, wait, fwip, "flood", 2, secInfo(req, url)); return FW_404() }
      // Tizim ildiziga/admin yo'llariga RUXSATGIZ kirishga urinish — DARHOL 30 kun blok
      if (FW_TRAP.test(url.pathname)) { fwLBlok(fwip, 30 * DAY); fwOchko(env, wait, fwip, "root", 1, secInfo(req, url)); return FW_404() }
      // v98: fayl-kengaytma datchiklari (backdoor/arxiv/qolib qoldiq qidiruvchilari) — trap kabi
      if (FW_TRAPX.test(url.pathname)) { fwLBlok(fwip, 30 * DAY); fwOchko(env, wait, fwip, "root", 1, secInfo(req, url)); return FW_404() }
      // In'ektsiya/traversal belgilari (yo'l + query) — 1-URINISHDA DARHOL 30 kun blok
      let dec = url.pathname + (url.search || "")
      try { dec += " " + decodeURIComponent(dec) } catch {}
      if (FW_INJ.test(dec)) {
        fwLBlok(fwip, 30 * DAY)
        fwOchko(env, wait, fwip, "inj", 1, secInfo(req, url))
        return FW_404()
      }
      // OTP PUMPING: 50 so'rov/1 soat (mobil tarmoq CGNAT — bir IP'da YUZLARGA foydalanuvchi
      // bo'lishi mumkin; avvalgi 25/12soat chegara ODDIY foydalanuvchilarni ham urib yuborardi)
      // v71: 50→100/soat — mobil operator CGNAT'ida yuzlab halol foydalanuvchi bitta tashqi IP'da
      // bo'ladi; 50 chegara ularni ham bloklab qo'yardi. Zararli toshqin baribir cheklangan:
      // har raqamga alohida 20-55s cooldown + auth (kod-urinish) alohida 12/24s firewall.
      if (url.pathname === "/api/auth/otp" && fwLokal(fwip, "otp", 100, 3_600_000)) { fwOchko(env, wait, fwip, "otp", 1, secInfo(req, url)); return FW_404() }
      // KLIENT QO'NG'IROQ JURNALI: 120 yozuv/1 soat (mijoz so'roviga ≤30/ql, cheklovdan katta —
      // haqiqiy foydalanuvchiga hech qachon yetmaydi, spam'ni to'sadi)
      if (url.pathname === "/api/clog" && fwLokal(fwip, "clog", 120, 3_600_000)) { fwOchko(env, wait, fwip, "clog", 1, secInfo(req, url)); return FW_404() }
    }
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
    // Hajm chegarasi — ulkan payload bilan abuse (upload bo'laklari ≤1.2MB, JSON ≤2MB)
    const clen = +(req.headers.get("content-length") || 0)
    if (clen > 26_000_000) { if (fwip) fwOchko(env, wait, fwip, "flood", 3, secInfo(req, url)); return json({ error: "Hajm juda katta" }, 413) }
    // v98 JSON QAT'II CHEGARASI: JSON tanasi ≤2MB (avatar base64 max 600KB, eng katta JSON shu —
    // boshqa barcha JSON'lar ancha kichik). 26MB JSON parse CPU/FONDSIZ ishlatilishi oldin olinadi.
    const hct = (req.headers.get("content-type") || "").toLowerCase()
    if (hct.includes("json") && clen > 2_000_000) { if (fwip) fwOchko(env, wait, fwip, "flood", 2, secInfo(req, url)); return json({ error: "Hajm juda katta" }, 413) }
    const path = url.pathname.slice(4).replace(/\/+$/, "") || "/"
    let juid = 0 // xato-jurnali uchun kuzatuv (catch scope'ida uid ko'rinmaydi)
    try {
      if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) fail("Server sozlanmagan: JWT_SECRET (kamida 16 belgi)", 500)
      if (!env.DATABASE_URL && !env.__db) fail("Server sozlanmagan: DATABASE_URL", 500)
      const db = env.__db || makeDb(env.DATABASE_URL)
      // WebSocket
      if (path === "/ws") {
        const payload = await verifyJwt(url.searchParams.get("token") || "", env.JWT_SECRET)
        if (!payload) { if (fwip) { if (fwLokal(fwip, "tok", 60, 3_600_000)) return FW_404(); fwOchko(env, wait, fwip, "tok", 1, secInfo(req, url)) } return json({ error: "Avtorizatsiya kerak" }, 401) }
        // Yagona sessiya nazorati (WS uchun ham): logout/qayta kirish eski ulanishni o'chiradi
        // v104: bloklangan hisobning WS ulanishi ham darhol yopiladi
        const su = await db.one("SELECT sess, logout_at, token_exp, blocked FROM users WHERE id=?", [Number(payload.sub)])
        if (!su || su.logout_at || (su.token_exp && +su.token_exp < now()) || (payload.s && payload.s !== su.sess) || +su.blocked === 1)
          return json({ error: "Avtorizatsiya kerak" }, 401)
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket kerak" }, 426)
        const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(String(payload.sub)))
        return stub.fetch(req)
      }
      const r = match(req.method, path)
      if (!r) { if (fwip && !probeQ && fw4xx(env, wait, fwip, secInfo(req, url))) return FW_404(); return FW_404() }
      let uid = 0
      if (!r!.open) {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const payload = await verifyJwt(token, env.JWT_SECRET)
        if (!payload) { if (fwip) { if (fwLokal(fwip, "tok", 60, 3_600_000)) return FW_404(); fwOchko(env, wait, fwip, "tok", 1, secInfo(req, url)) } fail("Avtorizatsiya kerak", 401) }
        uid = Number(payload.sub)
        juid = uid
        // YAGONA FAOL SESSIYA (bir raqam — bitta faol qurilma): logout barcha tokenlarni
        // o'ldiradi (logout_at), yangi kirish esa eskisini (sess mos emas → 401). Eski
        // tokenlar (s klaimsiz) moslik bo'yicha ishlaydi — yangilanish yumshoq o'tadi.
        // v104 ADMIN PANEL BLOK: blocked=1 hisob — HAR BIR autentifikatsiyalangan so'rovda
        // darhol 401 (ilova o'zi kirish ekraniga qaytaradi; qayta kirish ham authVerify'da yopiq)
        const su = await db.one("SELECT sess, logout_at, token_exp, blocked FROM users WHERE id=?", [uid])
        if (!su || su.logout_at || (su.token_exp && +su.token_exp < now()) || +su.blocked === 1) fail("Avtorizatsiya kerak", 401)
        if (payload.s && payload.s !== su.sess) fail("Avtorizatsiya kerak", 401)
        // MA'LUMOT TORTISH POSBONI (hatto yaroqli token bilan ham ma'lumot olib qochish mumkin emas):
        // bitta hisob 10 daqiqada 3000+ so'rov = skript (inson UI'da bunga yaqinlasha olmaydi —
        // ping 45s, qo'ng'iroq polling 20s, lenta paginatsiyasi... hammasi birgalikda << 300).
        // Chegaradan oshsa — IP 12 soat blok (skript NOL ma'lumot oladi, "Not found" ko'radi).
        // v106: himoya O'CHIQ bo'lsa — ma'lumot-tortish posboni ham o'chiq.
        if (fwip && !FW_OFF) {
          const de = FW_DATA.get(uid), dt = Date.now()
          if (!de || dt - de.t > 600_000) { if (FW_DATA.size > 10000) FW_DATA.clear(); FW_DATA.set(uid, { n: 1, t: dt }) }
          else if (++de.n > 3000) { FW_DATA.delete(uid); fwLBlok(fwip, 12 * 3_600_000); fwOchko(env, wait, fwip, "data", 1, secInfo(req, url)); return FW_404() }
        }
      }
      let b: any = {}
      const ct = req.headers.get("content-type") || ""
      if (["POST", "PATCH", "DELETE"].includes(req.method) && ct.includes("json")) b = await req.json().catch(() => ({}))
      const res = await r!.h({ env, db, uid, req, url, p: r!.p, b: b || {}, wait })
      // Skanerlash nazorati: 1 IP → 10 daqiqada 100+ xato (401/429 hisobga kirmaydi) → 30 daqiqa blok
      if (fwip && !probeQ && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429 && fw4xx(env, wait, fwip, secInfo(req, url))) return FW_404()
      return res
    } catch (e: any) {
      if (e instanceof HttpError) {
        // 500-sinf HttpError (masalan "Server sozlanmagan") ham jurnalga tushadi —
        // sozlash xatolari «jim» o'lib qolmasin. Oddiy biznes-4xx jurnalga YOZILMAYDI.
        if (e.status >= 500) wait(jurnalYoz(env, path, juid, "http", e.message))
        return json({ error: e.message }, e.status)
      }
      console.log("Server xatosi", e?.stack || String(e))
      wait(jurnalYoz(env, path, juid, "http", String(e?.message || e)))
      return json({ error: "Server xatosi. Birozdan keyin urinib ko‘ring" }, 500)
    }
  },
  async scheduled(_ev: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(cleanup(env))
  },
}
export { cleanup }
