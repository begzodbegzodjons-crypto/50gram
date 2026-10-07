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
