# 50 Gram — Deploy qo'llanma (GitHub + TiDB Cloud + Cloudflare)

Arxitektura — hammasi bepul tarifdan boshlanadi:

```
Brauzer/Telefon (PWA, IndexedDB)  ←WebSocket→  Cloudflare Worker (REST + real-time)
        |                                          |-- Durable Object (har user: WS, presence)
        |                                          '-- TiDB Cloud Serverless (SQL)
        '-- statik UI: Cloudflare Pages (50 Gram dizayni, o'zgarmagan)
```

Gibrid model: shaxsiy/guruh xabarlari serverda **vaqtincha** — hamma a'zoga
yetkazilgach content o'chadi (purged). Kanal postlari doimiy. 7 kunlik TTL zaxira.

| Xizmat | Vazifa | Bepul limit |
|--------|--------|-------------|
| GitHub | Kod ombori + CI/CD | cheksiz private repo |
| TiDB Cloud Serverless | Baza (MySQL-mos) | ~5GB, 50M req/oy |
| Cloudflare Workers | REST API + WebSocket (Durable Object) | 100k req/kun |
| Cloudflare Pages | Statik 50 Gram UI | cheksiz trafik |
| Cloudflare Cron | 7 kunlik purge, hikoya/OTP tozalash | mavjud |

---

## 1. GitHub

Repo tayyor — push qolgan (PAT bilan):

```bash
# 1) github.com → Settings → Developer settings → Personal access tokens →
#    Tokens (classic) → Generate new token → scope: repo → token
# 2) Lokal loyihada:
git remote add origin https://<TOKEN>@github.com/<akkaunt>/50gram.git
git push -u origin main
```

## 2. TiDB Cloud

1. https://tidbcloud.com → bepul hisob (GitHub bilan kirish mumkin)
2. **Create Cluster → Serverless** → Region: `ap-southeast-1` (Singapore)
3. **SQL Editor** oching → `cloudflare/db/schema.sql` mazmunini to'liq pastega
   qo'yib **Run** bosing (barcha jadvallar yaratiladi)
4. Connect panelidan ulanish satrini nusxalang:
   `mysql://<user>.<prefix>:<PAROL>@gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000/test`
   — oxiridagi bazani `uzbekgram` ga o'zgartiring (yoki URL'ga `/uzbekgram` qo'shing)
5. Seed (lokalda, bun bilan):
   ```bash
   DATABASE_URL="mysql://...:4000/uzbekgram?ssl={"rejectUnauthorized":true}" bun cloudflare/db/seed.ts
   ```
   Demo loginlar: aziz, dilnoza, jasur, malika, sardor, kamola — parol: demo123

## 3. Cloudflare (Worker + DO)

1. https://dash.cloudflare.com → hisob oching (bepul)
2. **Account ID** olaman: Dashboard bosh sahifada o'ngda
3. **API Token**: My Profile → API Tokens → **Create Token** →
   "Edit Cloudflare Workers" shabloni → (Pages deploy uchun ham Cloudflare Pages: Edit ruxsatini qo'shing)
4. Lokal yoki CI orqali deploy:
   ```bash
   cd cloudflare/worker
   npm install
   npx wrangler secret put DATABASE_URL   # TiDB ulanish satrini paste
   npx wrangler secret put JWT_SECRET     # uzun tasodifiy satr (openssl rand -hex 32)
   npx wrangler deploy
   ```
   → Worker URL chiqadi: `https://50gram-api.<subdomain>.workers.dev`

`wrangler.jsonc` dagi `<ACCOUNT_ID>` ni to'ldiring (yoki o'chirib tashlasangiz,
wrangler hisob tanlashni so'raydi).

## 4. Cloudflare Pages (UI)

**A yo'l — GitHub orqali (tavsiya):**
1. Pages → **Create a project → Connect to Git** → repo tanlang
2. Build settings:
   - Framework preset: **None**
   - Build command:
     `NEXT_PUBLIC_API_BASE=https://50gram-api.<subdomain>.workers.dev NEXT_PUBLIC_WS_BASE=wss://50gram-api.<subdomain>.workers.dev bash scripts/cf-export.sh`
   - Output directory: `out`
3. Save & Deploy → har push'da avtomatik yangilanadi

**B yo'l — qo'lda:** lokalda `scripts/cf-export.sh` ni env'lar bilan yugurtirib
`npx wrangler pages deploy out` qilish.

## 5. GitHub Actions (ixtiyoriy — worker auto-deploy)

Repo → Settings → Secrets and variables → Actions:
| Tab | Nomi | Qiymat |
|-----|------|--------|
| Secrets | CLOUDFLARE_API_TOKEN | 3-qadamdagi token |
| Secrets | CLOUDFLARE_ACCOUNT_ID | Account ID |
| Variables | CF_DEPLOY | `1` |
| Variables | CF_API_URL | `https://50gram-api.<subdomain>.workers.dev` |
| Variables | CF_WS_URL | `wss://50gram-api.<subdomain>.workers.dev/ws` |
| Variables | CF_PAGES_PROJECT | `50gram` |

Har push → typecheck + build → Worker va Pages avtomatik yangilanadi.

## 6. Tekshiruv

- Pages URL ochiladi → login `aziz/demo123`
- Ikkita brauzer oynasida 2 foydalanuvchi → real-time xabar yuborish ✓
- Admin panel (aziz) → statistika ✓
- `https://50gram-api.<subdomain>.workers.dev/api/stats` → JSON ✓

---

## Tez yordam

| Muammo | Yechim |
|--------|--------|
| Worker 500 beradi | `npx wrangler tail` — loglarni jonli ko'rish |
| "Avtorizatsiya kerak" | JWT_SECRET o'zgarganmi? Token eski — qaytadan login |
| Chat "Ulanmoqda" turibdi | NEXT_PUBLIC_WS_BASE to'g'rimi (wss://.../ws)? DO migration bor (`npx wrangler deployments list`) |
| DB xatolari | schema.sql to'liq bajarilganmi? TiDB URL'da baza nomi `/uzbekgram`mi? |
| Pages'da API xatosi | NEXT_PUBLIC_API_BASE build paytida berilganmi (env build'ga yopiladi)? |

Foydali buyruqlar:

```bash
cd cloudflare/worker
npx wrangler tail              # jonli loglar
npx wrangler secret list       # secretlar ro'yxati
npx wrangler deploy            # qayta deploy
npx wrangler pages deploy out  # UI'ni qayta yuklash
```
