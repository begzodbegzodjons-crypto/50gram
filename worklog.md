# 50gram Ish Jurnali (multi-agent)

---

Task ID: 33-b (v87→v89, davomi)
Agent: Super Z (asosiy)
Task: E2E FAIL ildizi va yakuniy tuzatishlar

Work Log:
- v88 E2E ikki marta FAIL — jurnal forenzikasi bilan HAL QILUVCHI ILDIZ topildi: NAVBATDAGI ZAHARLI SIGNAL. Yangi chaqiruv C.id=0 holatida eski hangup'ning call_id'ini o'zlashtirib oladi (handleSignalEv: `if (d.call_id && !C.id) C.id = d.call_id`) va sameCall bilan o'zini o'ldiradi. Isbot: A jurnali 16:48:32.080 chaqirildi → 16:48:32.894 sig:navbat 2 ta | hangup,call_closed (9 daqiqalik eski!) → 16:48:32.896 endCall. Foydalanuvchining 16:02–16:03 'pc=new' o'limlari — xuddi shu ildiz (tez qayta urinishlar zahari).
- Server navbatida o'qishda yosh filtri YO'Q edi; 2-daqiqalik tozalash (sweeper) kechikkanda zahar 9+ daqiqa yashaydi.
- v89 (commit c212550): (a) yakunlovchi signallar (hangup/busy/call_closed) yangi chaqiruv id'sini o'zlashtirmaydi; (b) server signalQueue SELECT'ga `created_at > now-2min` filtri.
- CI ISBOT (v89, c212550): Deploy ✅ / Smoke ✅ / MEDIA E2E ✅ — 27/27 tekshiruv yashil: A inA=49587 inV=714208 fr=329, B inA=60553 inV=716423 fr=390, ikkala ekranda 960×540 video (rvfc 35/38), ikkala audio currentTime 3.2s paused:false. E2E navbatdagi eski zahar BOR holda o'tdi — zahar endi zararsiz (isbot).
- Qo'shimcha: E2E konsol BOSHI ham chop etiladi; jurnal.yml har pushda avtomatik ishlaydi (GitHub dispatch API 500 outage chetlab o'tiladi).

Stage Summary:
- KETMA-KET TO'RT TA ILDIZ yo'q qilindi (v87): ishonchsiz RMS snapshot, kech mikro-jim, jurnal 900-belgi kesuvi, kuzatuv mayaklari yo'qligi.
- v88: 5s qayta-boglash + brauzer ruxsat xabari.
- v89: zaharli signal o'limi (qo'ng'iroq umuman bog'lanmasligining hal qiluvchi ildizi) — E2E PROVEN.
- Versiya: v89 (worker/core/sw sinxron). Barcha da'volar CI run'lari bilan tasdiqlangan.

---
Task ID: 34
Agent: Super Z (asosiy)
Task: v89'dan keyin ham B eshitmaydi (A→B'da video ham qotadi) — jurnal取证 + v90

Work Log:
- Jurnal dispatch (run 37715986801) — foydalanuvchi yangi qo'ng'iroqlari TOPILDI (01:58-01:59, ikkala yo'nalish):
  * Call 1791424728712501 (Y→X, 22s): X deaf k=0% rb=1, Y k=16% eshitadi. Video ikkala tomonda oqadi (kadrlar +93/+70, +139).
  * Call 1791424760839132 (X→Y, 25s): X deaf k=0% rb=1, Y k=84% eshitadi. Video oqadi.
  * X=1790856718955563 (Chrome/154 WebView), Y=1790858672586492 (Chrome/153) — ikkalasi APK (50GramApp/2.6).
- HAL QILUVCHI TOPILMA: deaf tomonda rebind ISHLAYDI (rb=1) lekin yordam BERMAYDI; inA faol audio tezligida (+13-19KB/5s — Opus jimligi ~10x kam); element play() QABUL qiladi (ovoz=ra o'zgarmagan). Lekin qutqaruv narvoni 'v'@25s / 'wa'@40s — foydalanuvchi 20-25s'da qo'qib tashlaydi → 'wa' (eng kuchli zaxira) real qo'ng'iroqda HECH QACHON ulgurmagan. Calls juda qisqa.
- v90 (commit 4c8efbd + 48cdc5a): (1) narvon 3x tez: rebind@5s → video-element yo'li@10s → WebAudio yo'li@15s; (2) jimlik belgisi endi getStats audioLevel (dekoder chiqishi — WebAudio remote-tap yolg'on nol beradigan WebView'da ham to'g'ri), alv yo'q bo'lsa eski k; (3) stat'ga hal qiluvchi maydonlar: alv= (audioLevel), smp= (totalSamplesReceived), kon= (concealedSamples), el= (element currentTime/muted/volume/paused/readyState) — keyingi jurnal element-qotish/dekoder-jimlik/metr-yolg'oni/yuboruvchi-jimligini ANIQ ajratadi; (4) 'qa' signali — kiruvchi video yomon tomon qarshi tomonga bitrat pasaytirishni so'raydi (video qotish uchun); (5) rasm siqishi 20s timeout (osilsa asl fayl yuboriladi — izsiz "hech narsa bo'lmadi" turi).
- Rasm/fayl funksiyalari to'liq kod-tekshiruvi qilindi: sendFile (v81 instrumentatsiya: boshlanmoqda→siqildi→yuklandi→YUBORILDI), upload (AES-GCM, chunked binary 2x parallel 4x retry, sha256), qabul (IDB kesh→chunk→decrypt), v86 saqlash (WebView share-sheet), R2 asosiy+D1 zaxira, MEDIA_KEEP_BYTES. Topilgan yagona zaiflik: resizeImage abadiy osilishi mumkin edi → v90'da 20s timeout qo'yildi.
- CI ISBOT (final 48cdc5a): Deploy ✅ / Smoke ✅ / E2E ✅ (=== E2E PASS ===) / Jurnal ✅. Production jurnalida v90 maydonlari LIVE: "alv=6% smp=+240000 kon=+0 | el=cur+5 mu=0 vol=1 pa=0 rd=4" — dekoder to'liq tezlikda (48kHz), element real-vaqtda ijroda.

Stage Summary:
- Asosiy ildiz (ehtimollik tartibida): qutqaruv narvoni juda SEKIN edi — real deaf qo'ng'iroqlar 20-25s'da o'lgani uchun 'v'/'wa' zaxira yo'llari hech qachon sinalmagan. v90 bunday holatni 15s ichida barcha yo'llarni sinab hal qiladi.
- Agar yana shikoyat bo'lsa: alv/smp/kon/el maydonlari sababni BIR jurnalda aniq beradi (element qotgan cur+0 / dekoder jim smp+0 / metr yolg'oni cur>0+alv>0 / yuboruvchi jim).
- Versiya: v90 (worker/core/sw sinxron). Rasm/fayl tekshiruvi yakunlandi: arxitektura to'g'ri, yagona zaiflik (resize hang) tuzatildi.

---
Task ID: 35
Agent: Super Z (asosiy)
Task: 50gram.uz domenini Worker'ga ulash (foydalanuvchi DNS yozuvlarini berdi)

Work Log:
- Tekshiruv: web/ da qattiq URL YO'Q (API = location.origin + '/api', WebSocket ham shundan) — domen ulanganda kod o'zgarmaydi.
- .github/workflows/domen.yml yozildi (commit 4d28e46): mode=zona|yozuvlar|ulash|tekshir|hammasi. Python urllib bilan CF API: zona yaratish/tekshirish + NS chiqarish; pochta yozuvlarini (mail/webmail/ftp A, MX, SPF, DMARC — DNS-only) idempotent yaratish; zona active bo'lgach ziddiyatli A/CNAME o'chirib worker custom domain ulash (50gram.uz + www); tekshir: curl 200 + __50BUILD + apk.
- CI sinov (run 37723935961, mode=zona): deploy token'ida com.cloudflare.api.account.zone.create RUXSATI YOQ — zona Dashboard orqali qo'shilishi kerak. Kutilgan holat; workflow baribir ishlab turadi (zona bor bo'lsa GET qilib oladi... token zone:o'qishsiz — Dashboard yo'li asosiy).
- Push 4d28e46 CI: Deploy ✅ (37723930515) / E2E ✅ (37723930608) / Jurnal ✅ (37723930544).
- Jurnal tahlili: v90 deploy (02:39) dan keyin HAQIQIY qo'ng'iroq YO'Q — faqat E2E chaqiruvlari (02:25/02:34, e2ediag belgilari, alv/smp/el maydonlari LIVE). Deaf juftlik (1790856718955563/1790858672586492) oxirgi real qo'ng'iroqlari 01:58-01:59 (v89 davri) — v90 narvoni (5s/10s/15s) haqiqiy qurilmada hali sinovdan o'tmagan.

Stage Summary:
- Domen uchun foydalanuvchidan 2 qadam kutilyapti: (1) Cloudflare Dashboard → Add domain → 50gram.uz (yozuvlar avto-import, NS beriladi); (2) registrar'da NS almashtirish. Keyin menga xabar — men CI (hammasi/tekshir) orqali yakunlayman; token ruxsati yetmasa oxirgi 2 klik (Workers → Custom domain) ko'rsatiladi.
- Pochta (MX/SPF/DMARC/mail/webmail) saqlanadi; 50gram.uz ildizi endi ILOVA bo'ladi (eski sayt o'rniga) — muhim bo'lsa app.50gram.uz alternativi bor.
- Audio: v90 real qurilmada kutilmoqda; alv/smp/kon/el bir qo'ng'iroqda ildizni aniq ko'rsatadi.

---
Task ID: 35-b
Agent: Super Z (asosiy)
Task: Domen ulash davomi — foydalanuvchi bilan jonli yo'riqnoma

Work Log:
- Foydalanuvchi Workers → 50gram → Domains orqali «Connect your domain» oynasini ochdi → zona yaratish oqimi (confirm-scanned-records) tugadi: 8 yozuv (4 A, 1 CNAME, 1 MX, 2 TXT) avto-import qilindi.
- domen.yml yaxshilandi: zona umumiy ro'yxatdan topiladigan bo'ldi + mail/webmail/ftp uchun PATCH proxied=false qo'shildi (commit: proxy-kulrang).
- CI yozuvlar run'i (37731277849): ZONA BOR (76c80bed6fd4c447f45b7796a38d6e67, pending) + NS_SERVERLAR=leland/meilani.ns.cloudflare.com. DNS YOZISH RUXSATI YOQ (code 10000 Authentication error) — deploy token faqat Worker'ga ruxsatli.
- Foydalanuvchi my.eskiz.uz'da NS'larni kiritdi (leland + meilani) va Saqlash bosdi.
- ulash run'i: ZONA_HOLATI=pending; activation_check yuborildi (tezlashtirish). Registry hali eski NS beradi (ns1/ns2.eskiz.uz) — tarqalish kutilmoqda.

Stage Summary:
- Qolgan odam-qadamlari: (1) DNS Records'da mail/webmail/ftp kalitlarini kulrang qilish (boshqacha iloji yo'q — token DNS yozishga ruxsatsiz); (2) zona active bo'lgach «tekshir» xabari → CI ulash (50gram.uz + www → worker) va tekshir.
- Ilovada qattiq URL yo'qligi tasdiqlangan — domen ulanganda kod o'zgarmaydi.

---
Task ID: 36
Agent: Super Z (asosiy)
Task: v91 — VIDEO qo'ng'iroqda birtomonlama ovoz ildizi (APK 2.6 quloqchi tuzoq) + uzluksiz qutqaruv narvoni

Work Log:
- Ildiz tahlili (kod + jurnal dalillari bilan): (1) real qo'ng'iroqlarda ikkala qurilma APK 50GramApp/2.6 — speaker() ko'prigi v2.8'da YOZILGAN lekin qurilmalarda YO'Q (rebuild kutilmoqda); (2) Chromium WebView WebRTC MODE_IN_COMMUNICATION o'rnatadi → ovoz QULOQCHIGA yo'naladi; video qo'ng'iroqda telefon yuz oldida = eshitilmaydi, audio qo'ng'iroqda quloq yonida = eshitiladi — shikoyatning «faqat video»ligi izohlandi; (3) X qurilma (k=0% rb=1, inA faol, el ijroda) — tap yolg'on nol (v84 isboti) barcha eski narvonlarni chalg'itgan; (4) v90'dagi JONLI XATO: wa-qaytish qorovuli inR (tap) bilan — ishlayotgan 'wa' (karnay) yo'li tap-yolg'onida BEKOR qilinar edi.
- rtc.js v91: (a) modeOrd() — APK+video: ['wa','ra','v'] (WebAudio → STREAM_MUSIC → KARNAY, quloqchi marshrutini chetlab o'tadi), desktop: ['ra','v','wa']; (b) default audioMode callUser/incomingCall'da APK video='wa'; (c) wa-qaytish qorovuli alv-gated (dekoder audioLevel) — tap yolg'oni ishlayotgan yo'lni buzolmaydi; (d) uzluksiz narvon: z1 rebind → z2/z3 rejim almashtirish → z4 rebuildCallElements (elementlar 0 dan) → z5 nativeKick → z>=6 AYLANISH + har 3-oynada kick (abadiy jimlik mumkin emas); (e) pickNext waDeadOnce'da wa'ni tashlab o'tadi; (f) playRemote spkMuted waGain.gain=0 (avval WebAudio «Dinamik»ga bo'ysunmasdi!) + tiklash; (g) 'Dinamik' tugmasi APK 2.6'da video rejimda wa/ra almashtiradi; (h) connected'da speaker qayta tasdiqlash (2.5s/7s) + routeInfo jurnalga; (i) stat'ga fb=/kk= maydonlari.
- TDZ xatosi ushlandi va tuzatildi (alvAvail wa-qorovulda ishlatilib pastda e'lon qilingandi) — node --check TDZ'ni ushlab olmaydi, qo'lda topildi.
- APK v3.0 (MainActivity.java, keyingi rebuild uchun): speaker() endi avval setMode(MODE_IN_COMMUNICATION) keyin setCommunicationDevice (tartib muhim — kommunikatsiya rejimisiz setCommunicationDevice ta'sirsiz); off'da clearCommunicationDevice + MODE_NORMAL; YANGI audioKick(video) — ovoz darajalari (VOICE_CALL>=35%, MUSIC>=20%) + NORMAL↔COMMUNICATION marshrut-kick + video'da karnay; YANGI routeInfo() — mode/spk/vc/mu/dev jurnalga; version 3.0, UA 50GramApp/3.0.
- Versiya v91 sinxron: worker BUILD_V + core.js __50BUILD + sw.js V.
- TDZ sababli sinov: node --check 3 faylda OK.

Stage Summary:
- Simptom: video qo'ng'iroqda bir tomon ovozi chiqmaydi (APK qurilmalar). Ildiz: APK 2.6'da speaker ko'prigi yo'q → Chromium comm-rejim ovozi quloqchiga → video'da ko'rinmaydi; + v90 wa-qaytish qorovuli tap-yolg'onida ishlayotgan karnay yo'lini buzardi.
- v91: APK video qo'ng'iroqda ovoz endi WebAudio (KARNAY) orqali; tap yolg'oni yo'lni buzolmaydi (alv-gated); qutqaruv hech qachon to'xtamaydi (aylanish); Dinamik WebAudio'ni boshqaradi; APK 3.0 audioKick/routeInfo bilan rebuild-ga tayyor.
- Kutilayotgan isbot: foydalanuvchi video qo'ng'iroq qiladi → jurnal'da ovoz=wa + alv>0 + eshitish tasdiqlanadi.

---
Task ID: 37
Agent: Super Z (asosiy)
Task: v92 — «bir qarasang ishlaydi, bir qarasang ishlamaydi» — ovoz tizimining TASODIFIYLIGINI yo'q qilish (foydalanuvchi: butkul yangidan qil)

Work Log:
- Foydalanuvchi shikoyati: video qo'ng'iroq ba'zan ishlaydi, ba'zan ishlamaydi; avval boshida ishlagan. Butunlay yangidan qilishni so'radi.
- rtc.js 2055 qatori to'liq o'qildi; evalStats qutqaruv tizimida 3 ta TASODIFIYLIK manbasi topildi:
  (1) v91 wa-qorovuli dInA>0 bilan ishlar edi — Opus SUKUTI ham paket yuboradi (dInA>0, ~10x kam): qarshi tomon 15s gapirmasa audioLevel=0 → ISHLAYOTGAN karnay yo'li 'ra'ga (quloqchi) almashtirilardi → video'da jim. SUKUT O'ZI YO'LNI BUZARDI — har qo'ng'iroqda sukut payti boshqacha = tasodif.
  (2) alv mavjud bo'lmasa + AudioContext suspended — qutqaruv umuman ishlamasdi.
  (3) AudioContext har qo'ng'iroqda close() qilinib qayta ochilardi — natija noaniq (suspended qolishi mumkin edi).
- v92 tuzatishlar (rtc.js):
  (a) routeFor(C) — ANIQLANGAN yo'nalish: APK spkOn?'wa':'ra'; browser 'ra'. Default: video→karnay, audio→quloqchi. modeOrd() o'chirildi.
  (b) JIMLIK-QUTQARUVCHI endi NUTQ DALILI bilan: faqat dInA>8000 (faol gapirish; Opus sukuti bunday bo'lolmaydi) VA eshitish dalili yo'q (alv<1 VA k<1). Sukutda (dInA≤8000) yo'l HECH QACHON o'zgartirilmaydi. Bosqichlar: z1 o'z-yo'li-tiklash → z3 fizik yo'l almashtirish (wa↔ra) → z4 elementlar 0-dan → z5 nativeKick → z6+ aylanish.
  (c) unlockAudio — GLOBAL window.__50actx: bir marta ochiladi (bosish ichida; __50warmup birinchi bosishida ham), hech qachon yopilmaydi (endCall endi ctx.close() qilmaydi).
  (d) connectWA — suspended = ISHLAMAYDI (pill chiqadi; avval suspended=OK deb qaraldi — yashirin jimlik); waGain'dan KEYIN analyser (C.waAn) qo'shildi.
  (e) rmsWa(C) + namunovchi: 'wa' rejimida ijro-zanjiri metrikasi (waGain'dan keyin — oqim-tap yolg'onlari chetlab o'tiladi); boshqa rejimlarda oqim-tap.
  (f) tryEl/playRemote — kaskad YO'Q: play() rad etilsa «Ovozni yoqish» pill; ijro dalili kelganda pill o'zi yashirinadi.
  (g) «Dinamik» APK'da = KARNAY↔QULOQCHI (spkOn; WebAudio APK 2.6'da ham karnayga chiqaradi — ko'prik kerak emas); browserda eski jim/ochiq.
  (h) stat satriga eshit= (everHeard) va sil= (silN) maydonlari.
- Versiya v92: worker BUILD_V + core.js __50BUILD + sw.js V (3-yo'qlik). node --check rtc.js OK.
- Commit 9019c82 → deploy run 37750606718 SUCCESS (Current Version ID 4d175c50).
- ISBOT (CI): smoke run 37750597966 SUCCESS — health {"ok":true}, «versiyalar: sw=v92 core=v92 worker=v92», «3-yo'qlik versiya qulfi: OK (v92)», jonli /api/build v92 tasdiqlandi.
- ISBOT (CI): MEDIA E2E run 37751555952 SUCCESS — A: inA=51645 inV=728277 fr=334; B: inA=61309 inV=732045 fr=395; ikkala audio currentTime 3.2s adv, muted=false — IKKALA TOMON ovoz+video oqadi va ijro etiladi.

Stage Summary:
- Tasodifiylik ildizlari yo'q qilindi: sukut endi yo'lni buza olmaydi (nutq-dalilli qutqaruv), AudioContext barqaror (global), ijro metrikasi haqiqiy zanjirdan olinadi.
- E2E da ikkala tomonda audio+video aqiqiy oqishi isbotlandi (server/browser qismi).
- APK qurilmalarda (WebView quloqchi-tuzoq) yakuniy isbot foydalanuvchining REAL video qo'ng'irog'i bilan bo'ladi — jurnalda ovoz=wa + alv>0 + eshit=1 kutiladi.
- Eslatma: domen line (Task 35) hali ham kutish rejimida — zona pending.
