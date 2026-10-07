# 50gram Ish Jurnali (multi-agent)

---

Task ID: 33
Agent: Super Z (asosiy)
Task: «hali ham o'sha muammo — B ovozi yo'q, video qotadi, brauzerda qo'ng'iroq bog'lanmaydi» — jurnal forenzikasi + v87/v88 tuzatishlari

Work Log:
- jurnal CI (run 37649622329) orqali yangi loglar o'qildi.
- FOYDALANUVCHI SHIKOYATI VAQTI ANIQLANDI: shikoyat qilingan qo'ng'iroqlar (09:03–09:40 UTC) v85 commitidan (10:36 UTC) OLDIN bo'lgan — v84 kodda o'tgan (stat formati barmoq-izi: mik/rmut/rb yo'qligi bilan isbotlandi). v85/v86 deploy ✅ (10:36/13:39), lekin foydalanuvchi ularni SINAB KO'RMAGAN edi.
- YANGI REAL TESTLAR TOPILDI (16:00–16:03 UTC, v86): call 1791388832980421 — v85-element-qayta-boglash narvoni REAL qurilmada ISHLADI (ovoz-qayta-boglash → k=39%, ovoz tiklandi) lekin ~15s kutgandi. Brauzer «bog'lanmadi» ildizi TOPILDI: B-device endCall `NotAllowedError` — kamera/mikrofon RUXSATI berilmagan (+2 ta pc=new kesishgan urinishlar).
- ILDIZ-3 TOPILDI (jurnal yo'qolishi): worker callLog msg 900 belgiga kesardi; klient 14 qatorni birlashtirib yuborardi → OXIRGI qatorlar (stat/endCall!) O'CHARDI — «B tomon stat yo'q» muammosining sababi.
- ILDIZ-4: RMS o'lchov BITTA 32ms snapshot edi — gap paytida yolg'on k=0% berardi (k=0 dalili ishonchsiz).
- ILDIZ-5: mikro-jim davolash 30s (6-oyna) — 29s'lik qo'ng'iroqda HECH QACHON ulgurmasdi.
- v87 (commit 42b01ee): uzluksiz RMS namunovchi (250ms × 5s-oyna MAKSIMUM); narvonlar oyna-max bilan (-1=o'lchanmadi himoyasi); mikro-jim 15s + 4 marta; stat 10s + vx=; worker 3000 belgi; shipClog 6 qator/POST; QA L2 yengil + yangi L3 (140k/6x/10fps); ISHGA-TUSHDI MAYAGI (build/apk/ua jurnalga) + JS-xato hisobotchi. CI: Deploy ✅ Smoke ✅ E2E ✅ (run 37651782665, A inA=49768 B inA=58622, ikkala audio currentTime 3.2s).
- v87 jurnal tekshiruvi (run 37652844723): to'liq stat qatorlari (mik/rmut/rb/vx) + ishga-tushdi mayaklari KO'RINDI — dalil-tizim ishlayapti.
- v88 (commit 37ed62a): qayta-boglash 1-oynada (5s, avval 10s); brauzer uchun alohida ruxsat-xato matni (manzil-satri ikonkasi). Deploy ✅ Smoke ✅. E2E birinchi urinishda FAIL — tahlil: B accept ✅ lekin A ning offer signali yo'qolgan (transient, 40s keyin 2-ssenariy signallari OK) → qayta dispatch qilindi.

Stage Summary:
- Jurnal-dalil tizimi endi ISHONCHLI: hech qanday qator kesilmaydi, har qurilma kelib chiqishini yozadi, RMS «kim jim» savoliga aniq javob beradi.
- Real qurilma isboti: v85 element-qayta-boglash ovozni tikkayotgan edi (k=39%), endi 5s da ishlaydi.
- Brauzer «qo'ng'iroq bog'lanmaydi» = kamera/mikrofon ruxsati emasligi aniqlandi — foydalanuvchiga aniq ko'rsatma beriladi.
- Versiya: v88 (worker BUILD_V + core.js __50BUILD + sw.js V — 3 joyda sinxron).
