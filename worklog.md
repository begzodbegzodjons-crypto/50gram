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
