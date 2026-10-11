# UZBEKGRAM — Deploy yo'riqnomasi (GitHub + TiDB Cloud + Cloudflare)

Dastur kodi **umuman o'zgartirilmagan**. Bu fayl faqat ishga tushirish bosqichlarini tushuntiradi.
Taxminiy vaqt: 20–30 daqiqa. Hammasi bepul tariffda ishlaydi.

```
Foydalanuvchi (telefon/PC)                Cloudflare                        Ma'lumotlar bazasi
┌─────────────────────────┐   HTTPS/WS   ┌──────────────────────┐   HTTP    ┌──────────────────┐
│  Pages (web/index.html) │ ───────────► │ Worker (API)         │ ────────► │ TiDB Serverless  │
│  IndexedDB (xabarlar)   │              │ • auth.ts  (JWT)     │           │ users, chats,    │
│  WebRTC P2P (fayl)      │ ◄──────────► │ • realtime (Durable  │           │ message_queue…   │
└─────────────────────────┘   signal     │    Object WebSocket) │           └──────────────────┘
                                         │ • index.ts (API)     │   obyekt  ┌──────────────────┐
                                         └──────────────────────┘ ────────► │ R2 (media, TTL)  │
                                                                            └──────────────────┘
```

## 1-qadam. TiDB Cloud (ma'lumotlar bazasi)

1. https://tidbcloud.com saytida bepul akkaunt oching (Google/GitHub bilan ham bo'ladi).
2. **Create Cluster** → **Serverless** → hudud: `Singapore` yoki `Frankfurt` (O'zbekistonga eng yaqini shular) → **Create**.
3. Cluster ochilgach, parolni birinchi so'ralganda saqlab qo'ying.
4. Chap panelda **SQL Editor** oching → butun `db/schema.sql` tarkibini paste qilib **Run** bosing.
   Bu `uzbekgram` bazasini va barcha jadvallarni yaratadi (users, otp_codes, chats, message_queue, posts, ads, transactions…).
5. **Connect** tugmasi → **Connect with: Node.js** yoki umumiy satr → ulanish satrini nusxalang.
   U taxminan shunday ko'rinadi:

   ```
   mysql://<user>.root:<PAROL>@gateway01.<hudud>.prod.aws.tidbcloud.com:4000/uzbekgram
   ```

   ⚠️ Satr oxiriga `/uzbekgram` (baza nomi) qo'shilganiga ishonch hosil qiling.

> TiDB Serverless'da `message_queue` va `otp_codes` jadvallarida TTL bor — vaqtincha
> xabarlar 14 kundan, SMS kodlar 10 daqiqadan o'tib avtomatik o'chadi (shartnoma shart emas).

## 2-qadam. Cloudflare (API server)

1. https://dash.cloudflare.com saytida akkaunt oching (bepul).
2. Terminalda:

   ```bash
   cd worker
   npm install

   # a) Media uchun R2: birinchi marta R2 ni yoqish so'raladi → tasdiqlang
   npx wrangler r2 bucket create uzbekgram-media

   # b) Maxfiyliklar:
   npx wrangler secret put DATABASE_URL
   #   → 1-qadamdan olingan mysql://... satrini paste qiling
   npx wrangler secret put JWT_SECRET
   #   → uzun tasodifiy satr kiriting (masalan: openssl rand -hex 32 natijasi)

   # v) Ishga tushirish:
   npx wrangler deploy
   ```

3. Oxirida wrangler URL chiqaradi, masalan:
   `https://uzbekgram-api.<sizning-subdomen>.workers.dev` — **shu URLni nusxalab oling**.

### SMS (keyinchalik, ixtiyoriy)

Hozircha `DEV_MODE="1"` — ro'yxatdan o'tishda SMS yuborilmaydi, kod ekranda qaytadi.
Haqiqiy SMS uchun https://eskiz.uz dan token oling va:

```bash
npx wrangler secret put SMS_TOKEN   # Eskiz tokeni
npx wrangler secret put DEV_MODE    # qiymat: 0
```

## 3-qadam. Cloudflare Pages (web interfeys)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. `uzbekgram` reposini ulang. Sozlamalar:
   - **Build command:** bo'sh (hech narsa build qilinmaydi)
   - **Build output directory:** `web`
3. **Save and Deploy**.

Pages beradigan manzil: `https://uzbekgram.pages.dev`

### Frontend'ga API manzilini aytish

`web/local-store.js` 1-qatoridagi `API` manzili ikki usulda o'rnatiladi:

- **Doimiy usul:** `web/local-store.js` da
  `"https://uzbekgram-api.<sizning-subdomen>.workers.dev"` ni o'z Worker URL'ingizga almashtirib, commit qiling.
- **Yoki brauzerda (test uchun):** konsolda
  `localStorage.setItem("api", "https://uzbekgram-api.<subdomen>.workers.dev")` yozib sahifani yangilang.

## 4-qadam. GitHub (kod saqlash + avtomatik deploy)

1. GitHub'da yangi repo yarating: masalan `uzbekgram`.
2. Bu papkani ulang va push qiling:

   ```bash
   git init
   git add .
   git commit -m "Uzbekgram: boshlang'ich commit"
   git remote add origin https://github.com/<siz>/uzbekgram.git
   git push -u origin main
   ```

3. **Avtomatik deploy'ni yoqish** (har push'da Worker+Pages o'zi yangilanadi):
   - Cloudflare → My Profile → **API Tokens** → *Edit Cloudflare Workers* shabloni
     (qo'shimcha **Pages: Edit** ham kerak) → token yarating.
   - GitHub repo → Settings → Secrets and variables → Actions → `New repository secret`:
     - `CLOUDFLARE_API_TOKEN` = token
     - `CLOUDFLARE_ACCOUNT_ID` = Cloudflare dashboard o'ng paneldagi Account ID
   - Shundan keyin `git push` → `.github/workflows/deploy.yml` o'zi ishlaydi.

## Tekshirish ro'yxati

- [ ] `https://...workers.dev/auth/request-otp` ga POST qib `dev_code` qaytmoqda (DEV_MODE=1)
- [ ] Pages sayt ochiladi, telefon raqam + kod bilan kirmoqda
- [ ] Ikki brauzerda ikki raqam bilan kirib, xabar almashmoqda
- [ ] `wrangler tail` bilan real vaqt loglarini ko'rish mumkin

## Umumiy arxitektura qisqacha

- **Xabarlar hech qachon serverda yig'ilmaydi:** har bir xabar qabul qiluvchi navbatiga
  yoziladi → qurilma olib IndexedDB'ga saqlaydi → `ack` → server yozuvi DARHOL o'chadi.
- **Real-time:** har foydalanuvchiga bitta Durable Object (WebSocket, hibernation — bepul plandaga mos).
- **Media (rasm/video/fayl):** R2'da vaqtincha — oxirgi qabul qiluvchi olgach o'chadi;
  katta fayllar WebRTC P2P orqali to'g'ridan-to'g'ri qurilmadan qurilmaga o'tadi.
- **Lenta (post/kanal/e'lon/reklama):** ommaviy kontent TiDB'da doimiy saqlanadi.
