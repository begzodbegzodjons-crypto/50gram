# 50 Gram

Tez va sokin dizaynli o‘zbek messenjeri: chatlar, guruhlar, kanallar, lenta (yangiliklar, e’lonlar), istoriyalar, audio/video qo‘ng‘iroqlar, jonli efir, ovozli va dumaloq video xabarlar, istalgan fayl, stiker/GIF.

**Texnologiyalar:** Cloudflare Workers (API + sayt + Durable Objects realtime) · TiDB Cloud Serverless (ma’lumotlar bazasi) · WebRTC (qo‘ng‘iroq, efir, P2P fayl uzatish).

## Tuzilma

```
db/schema.sql        TiDB jadvallari
worker/              Cloudflare Worker (API, WebSocket, cron tozalash)
web/                 Ilova (PWA): index.html, *.js, style.css, logo, ikonkalar
```

## 1. TiDB Cloud

1. https://tidbcloud.com → **Create Cluster → Serverless** (bepul).
2. **SQL Editor** → `db/schema.sql` faylini to‘liq ishga tushiring.
3. **Connect → Serverless Driver** → ulanish URL’ini nusxalang (`mysql://user:parol@host/test`).

## 2. Cloudflare

```bash
npm i -g wrangler
wrangler login
cd worker
npm install
wrangler secret put DATABASE_URL     # TiDB URL
wrangler secret put JWT_SECRET       # kamida 32 ta tasodifiy belgi
wrangler secret put ESKIZ_EMAIL      # eskiz.uz login (SMS)
wrangler secret put ESKIZ_PASSWORD
npm run deploy
```

Sayt va API bitta manzilda ishlaydi: `https://50gram.<subdomen>.workers.dev`. `web/config.js` bo‘sh qoladi.

Saytni alohida Cloudflare Pages’ga joylasangiz, `web/config.js` ichiga Worker manzilini yozing:
`window.API_URL = 'https://50gram.<subdomen>.workers.dev'`

### SMS (Eskiz.uz)

Eskiz’da ro‘yxatdan o‘ting va SMS matni shablonini tasdiqlating (masalan: `50 Gram tasdiqlash kodi: 123456`). Matn `SMS_TEXT` o‘zgaruvchisi bilan mos bo‘lishi kerak.

Sinov uchun `wrangler.toml` ichidagi `TEST_PHONES` (SMS yuborilmaydi). **Haqiqiy ishga tushirishda `DEV_MODE = "0"` va `TEST_PHONES = ""` bo‘lsin.**

### Qo‘ng‘iroqlar har qanday tarmoqda ulanishi uchun (TURN)

Cloudflare Dashboard → **Calls → TURN** → kalit yarating:

```bash
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_TOKEN
```

TURN bo‘lmasa, ko‘p hollarda faqat STUN bilan ulanadi. Lekin ayrim mobil operatorlarda qo‘ng‘iroq ulanmasligi mumkin.

## 3. GitHub orqali avtomatik deploy

`.github/workflows/deploy.yml` tayyor. GitHub → Settings → Secrets bo‘limiga qo‘shing:

- `CLOUDFLARE_API_TOKEN` (Workers ruxsati bilan)
- `CLOUDFLARE_ACCOUNT_ID`

`main` ga har push → avtomatik deploy.

## Ma’lumotlar qayerda saqlanadi

- Xabarlar va fayllar **telefonning o‘zida** (IndexedDB) saqlanadi.
- Server faqat yetkazish uchun vaqtincha saqlaydi, so‘ng avtomatik o‘chiradi:
  - shaxsiy chat — 14 kun;
  - guruh/kanal — 30 kun;
  - istoriya — 24 soat;
  - lenta — 60 kun.
- Serverdan o‘chgan faylni ilova **onlayn turgan boshqa a’zolar qurilmasidan** WebRTC orqali olib beradi (“o‘rgimchak to‘ri”).
- Har foydalanuvchi qurilmasidan sozlamada tanlagan hajmda (maksimal 30 GB) joy beradi. Har fayl 15–20 ta qurilmada nusxalanadi.

### Halol cheklovlar

- Hech kim onlayn bo‘lmasa, server muddati o‘tgan eski fayl vaqtincha ochilmaydi. Egasidan biri onlayn bo‘lganda qaytadan keladi.
- iPhone brauzerlari fon rejimida ishlamaydi: ilova ochiq bo‘lganda “server” vazifasini bajaradi.
- Brauzer saqlash joyini o‘zi cheklashi mumkin. Ilova “doimiy saqlash” ruxsatini so‘raydi.
- Jonli efir: tomoshabinlar soni cheklanmagan. "O‘rgimchak to‘ri" daraxti ishlaydi: efirchi efirni 4 ta tomoshabinga, har bir tomoshabin olgan efirni yana 3 tasiga uzatadi (10 000 tomoshabin ~8 bosqich, 1 000 000 ~12 bosqich). Har bosqich ~0,2–0,5 soniya kechikish qo‘shadi. Har tomoshabin ~3 × 0,9 Mbit/s yuklaydi (upload). Biror tomoshabin chiqib ketsa, undan keyingilar avtomatik boshqasiga qayta ulanadi. Izohlar va ❤️ ham daraxt orqali tarqaladi, server yuklanmaydi.
- P2P (o‘rgimchak to‘ri) har qanday internetda ishlaydi: Wi‑Fi ham, mobil internet (4G/5G) ham. Alohida "faqat Wi‑Fi" sozlamasi yo‘q.
- Hamyon/Premium to‘lovlari uchun Click/Payme merchant shartnomasi kerak (hozircha ulanmagan).

## Sinovdan o‘tgan

- Backend: 88 ta API sinovi, jumladan:
  - ro‘yxatdan o‘tish, noto‘g‘ri kod rad etilishi;
  - profil rasmi, kontaktlar, qidiruv;
  - chat, tahrir, o‘chirish, reaksiya, so‘rovnoma, fayl;
  - guruh/kanal boshqaruvi (admin, chiqarish, ban, yopiq kanal + tasdiqlash, ruxsatlar);
  - istoriya, lenta, like/izoh, qo‘ng‘iroq, efir, blok, P2P/storage.
- Brauzer (2 foydalanuvchi):
  - kirish, barcha bo‘limlar;
  - real vaqtda xabar yetkazish;
  - ovozli qo‘ng‘iroq ulanishi;
  - jonli efir tomoshabinga yetishi.
