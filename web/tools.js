// ==========================================================================
// 50 GRAM TOOLLAR (v119) — TARJIMON
// (v119: REYTING foydalanuvchi talabi bilan TO'LIQ OLIB TASHLANDI — tab, dock
//  tugmasi, /rating so'rovi va barcha CSS'lar. Tarjimon o'zgarishsiz qoldi.)
// Tarjimon: matn, ovoz (Whisper AI -> tarjima -> TTS ovoz), PDF hujjat (6 til)
// v116 PDF YUKLAB OLISH: «PDF sifatida saqlash» (oyna + chop etish — orqaga
// qaytish yo'q edi) OLIB TASHLANDI. Endi tarjima UZLUK hujjat ko'rinishida
// turadi va «PDF yuklab olish» tugmasi bitta HAQIQIY .pdf fayl yaratib,
// to'g'ridan-to'g'ri yuklab beradi (canvas -> JPEG -> PDF, kutubxonasiz —
// xitoy/kirill/lotin brauzer shrifti bilan chiziladi, server shart emas).
// v115 OVOZ KUCHAYTIRILDI: AGC mikrofon + audio normalizatsiya (WAV) — shovqinli/
//        sokin joyda ham ishlaydi; serverda haqiqiy o'zbek neyral ovozi (Edge TTS).
// Bu fayl FAQAT QO'SHIMCHA — mavjud funksiyalarga tegmaydi (muhr qoidasi).
// ==========================================================================
(() => {
  'use strict'
  const $ = (id) => document.getElementById(id)

  // ------------------------- Tillar (server TR_LANGS bilan bir xil) -------------------------
  const TILL = [
    { k: 'uz', n: "O‘zbek", f: '🇺🇿' },
    { k: 'ru', n: 'Русский', f: '🇷🇺' },
    { k: 'en', n: 'English', f: '🇬🇧' },
    { k: 'zh', n: '中文', f: '🇨🇳' },
    { k: 'tr', n: 'Türkçe', f: '🇹🇷' },
    { k: 'de', n: 'Deutsch', f: '🇩🇪' },
  ]
  const tilN = (k) => { const t = TILL.find((x) => x.k === k); return t ? t.f + ' ' + t.n : k }

  // ------------------------- TARJIMON -------------------------
  let trTo = localStorage.getItem('g50tr') || 'uz'
  let trRejim = 'text'
  const trSaqla = () => localStorage.setItem('g50tr', trTo)

  function tilChiplar(sel) {
    return TILL.map((t) => '<span class="tilchip' + (t.k === sel ? ' on' : '') + '" data-til="' + t.k + '">' + t.f + ' ' + t.n + '</span>').join('')
  }

  window.trOch = () => {
    const p = $('tr-panellar')
    if (!p || p.dataset.tayyor === '1') return
    p.dataset.tayyor = '1'
    // Matn paneli
    $('tr-text').innerHTML =
      '<div class="tilqator" id="tr-tilqator">' + tilChiplar(trTo) + '<button class="tilswap" id="tr-swap" title="Almashtirish">⇄</button></div>' +
      '<textarea id="tr-in" class="tr-ta" placeholder="Matnni yozing — til avtomatik aniqlanadi…" maxlength="5000"></textarea>' +
      '<button class="btn big" id="tr-go">🌐 Tarjima qilish</button>' +
      '<div id="tr-out" class="tr-out hide"><div class="tr-out-t"></div><button class="lnk" id="tr-cp">📋 Nusxa olish</button></div>'
    // Ovoz paneli
    $('tr-voice').innerHTML =
      '<div class="tilqator" id="trv-tilqator">' + tilChiplar(trTo) + '</div>' +
      '<button class="micbtn" id="trv-mic"><span>🎙</span></button>' +
      '<div class="micstat" id="trv-stat">Tilni tanlang va mikrocni bosing</div>' +
      '<div id="trv-res" class="trv-res hide">' +
      '<div class="trv-karta"><div class="mut"> aniqlangan matn</div><div class="trv-t" id="trv-src"></div></div>' +
      '<div class="trv-karta main"><div class="mut" id="trv-to-n">Tarjima</div><div class="trv-t big" id="trv-dst"></div>' +
      '<div class="trv-ctl"><button class="lnk" id="trv-play">🔊 Ovozni eshitish</button><button class="lnk" id="trv-cp">📋 Nusxa</button></div></div></div>'
    // PDF paneli
    $('tr-pdf').innerHTML =
      '<div class="tilqator" id="trp-tilqator">' + tilChiplar(trTo) + '</div>' +
      '<label class="pdfdrop" id="trp-drop"><input type="file" id="trp-file" accept="application/pdf,.pdf" hidden><b>📄 PDF hujjatni tanlang</b><span>30 sahifagacha · matnli PDF</span></label>' +
      '<div id="trp-prog" class="hide"><div class="pbar"><i id="trp-bar"></i></div><div class="mut" id="trp-stat"></div></div>' +
      '<div id="trp-res" class="trp-res hide"></div>' +
      '<div id="trp-ctl" class="hide"><button class="lnk" id="trp-copy">📋 Hammasini nusxalash</button><button class="lnk" id="trp-print">⬇️ PDF yuklab olish</button><button class="lnk" id="trp-txt">📄 Matn (.txt)</button></div>'
    trBind()
  }

  function tilQatorBogla(qid, cb) {
    const q = $(qid)
    if (!q) return
    q.onclick = (e) => {
      const chip = e.target.closest('[data-til]')
      if (!chip) return
      trTo = chip.dataset.til
      trSaqla()
      qsa('.tilchip', q).forEach((c) => c.classList.toggle('on', c.dataset.til === trTo))
      cb && cb()
    }
  }

  // --- Matn tarjima ---
  let trBusy = false
  async function trMatn() {
    if (trBusy) return
    const inp = $('tr-in'), out = $('tr-out')
    const matn = (inp.value || '').trim()
    if (!matn) { toast('Avval matn yozing'); return }
    trBusy = true
    $('tr-go').disabled = true
    $('tr-go').textContent = '⏳ Tarjima qilinmoqda…'
    try {
      const r = await post('/translate', { text: matn, to: trTo })
      out.classList.remove('hide')
      out.querySelector('.tr-out-t').textContent = r.translated || '—'
      out.querySelector('#tr-cp').onclick = () => { copy(r.translated || ''); toast('📋 Nusxalandi') }
    } catch (e) { toast('⚠️ ' + (e.message || 'Tarjima ishlamadi')) }
    trBusy = false
    $('tr-go').disabled = false
    $('tr-go').textContent = '🌐 Tarjima qilish'
  }

  // --- Ovozli tarjima (naqsh: chat.js pickRecorder — WebView uchun xavfsiz) ---
  // v115: AGC (avtomatik ovoz kuchi) + 1 kanal — sokin/past mikrofonlarda ham yaxshi yoziladi
  let trRec = null, trTaymer = 0, trvAudio = null
  function trRecorder(stream) {
    if (!window.MediaRecorder) throw new Error('yozib olish qo‘llanmaydi')
    for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) {
      if (MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(t)) continue
      try { return new MediaRecorder(stream, { mimeType: t }) } catch {}
    }
    try { return new MediaRecorder(stream) } catch (e) { throw new Error('bu qurilma yozib ololmadi') }
  }
  const blobB64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob) })

  // v115: yozuvni TAYYORLASH — dekodlash -> 16 kHz mono -> pik-normalizatsiya -> WAV.
  // Foyda: (1) sokin gapirilgan ovoz kuchi ko'tarilib yuboriladi (Whisper «eshtadi»),
  // (2) jirilli shovqinli ovoz baribir bir xil darajada keladi — «sokin joyda gapiring» xatosi yo'qoladi,
  // (3) WAV formatini Whisper 100% tushunadi (webm konteyner muammolari yo'q).
  // Ishlamasa (eski WebView) — xom blob o'zgarishsiz yuboriladi.
  async function trOvozTayyorla(blob) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const OAC = window.OfflineAudioContext
      if (!AC || !OAC) return blob
      const tmp = new AC()
      const buf = await tmp.decodeAudioData(await blob.arrayBuffer())
      try { tmp.close && tmp.close() } catch {}
      const sek = Math.min(buf.duration, 58)
      if (sek < 0.2) return blob
      const off = new OAC(1, Math.max(1, Math.floor(sek * 16000)), 16000)
      const src = off.createBufferSource()
      src.buffer = buf
      src.connect(off.destination)
      src.start(0, 0, sek)
      const out = await off.startRendering()
      const d = out.getChannelData(0)
      let peak = 0
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a }
      const g = peak > 0.0015 ? Math.min(0.88 / peak, 14) : 1
      const n = d.length
      const wav = new ArrayBuffer(44 + n * 2)
      const v = new DataView(wav)
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
      v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
      ws(36, 'data'); v.setUint32(40, n * 2, true)
      for (let i = 0; i < n; i++) { let s = d[i] * g; s = s > 1 ? 1 : s < -1 ? -1 : s; v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true) }
      return new Blob([wav], { type: 'audio/wav' })
    } catch { return blob }
  }

  async function trOvozBoshla() {
    if (trRec) return
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Bu brauzer ovoz yozishni qo‘llamaydi')
    let stream = null
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }) } catch { return toast('🎤 Mikrofon ruxsati berilmagan — brauzer sozlamasidan yoqing') }
      const mr = trRecorder(stream)
      const chunks = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mr.onstop = async () => {
        clearInterval(trTaymer)
        stream.getTracks().forEach((t) => t.stop())
        trRec = null
        $('trv-mic').classList.remove('rec')
        const dur = Math.round((Date.now() - Number($('trv-mic').dataset.t0 || Date.now())) / 1000)
        if (!chunks.length || dur < 1) { $('trv-stat').textContent = '⚠️ Ovoz yozib olinmadi — qaytadan bosing'; return }
        await trOvozYubor(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }))
      }
      mr.start(250)
      vibrate(20)
      $('trv-mic').dataset.t0 = String(Date.now())
      $('trv-mic').classList.add('rec')
      $('trv-stat').textContent = '🔴 Yozib olinmoqda… gapiring (60 s gacha). Shovqinli joyda ham ishlaydi. To‘xtatish uchun bosing.'
      trRec = mr
      let s = 0
      clearInterval(trTaymer)
      trTaymer = setInterval(() => { s++; if (s >= 60) trOvozToxta() }, 1000)
    } catch (e) {
      try { stream && stream.getTracks().forEach((t) => t.stop()) } catch {}
      toast('⚠️ Ovoz yozish ishlamadi: ' + (e.message || 'noma’lum'))
    }
  }
  function trOvozToxta() {
    clearInterval(trTaymer)
    if (!trRec) return
    const mr = trRec
    trRec = null
    $('trv-mic').classList.remove('rec')
    try { mr.state !== 'inactive' ? mr.stop() : mr.onstop() } catch { $('trv-stat').textContent = 'Qaytadan urinib ko‘ring' }
  }
  async function trOvozYubor(blob) {
    const res = $('trv-res'), stat = $('trv-stat')
    stat.textContent = '⏳ Aniqlanmoqda va tarjima qilinmoqda…'
    res.classList.add('hide')
    try {
      const tayyor = await trOvozTayyorla(blob)
      const audio = await blobB64(tayyor)
      const r = await post('/translate/speech', { audio, to: trTo })
      $('trv-src').textContent = r.text || '—'
      $('trv-dst').textContent = r.translated || '—'
      $('trv-to-n').textContent = '🌐 ' + tilN(r.to) + ' tarjimasi'
      res.classList.remove('hide')
      if (r.audio) {
        stat.textContent = '✅ Tayyor'
        try { trvAudio = new Audio(r.audio); await trvAudio.play() } catch {}
      } else {
        stat.textContent = '✅ Matn tayyor — ovoz xizmati band, birozdan keyin 🔺 bosing'
      }
    } catch (e) {
      stat.textContent = '⚠️ ' + (e.message || 'Ishlamadi')
      toast('⚠️ ' + (e.message || 'Ishlamadi'))
    }
  }

  // --- PDF tarjima ---
  let pdfjsMod = null
  async function pdfjsOlish() {
    if (pdfjsMod) return pdfjsMod
    toast('📄 PDF modul yuklanmoqda…')
    pdfjsMod = await import('./pdfjs/pdf.min.mjs')
    pdfjsMod.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.min.mjs'
    return pdfjsMod
  }
  async function pdfTarjima(file) {
    if (file.size > 30 * 1024 * 1024) { toast('⚠️ PDF 30 MB dan kichik bo‘lsin'); return }
    const prog = $('trp-prog'), bar = $('trp-bar'), stat = $('trp-stat'), res = $('trp-res')
    prog.classList.remove('hide'); res.classList.add('hide'); $('trp-ctl').classList.add('hide')
    bar.style.width = '4%'
    stat.textContent = '📄 Sahifalar o‘qilmoqda…'
    let pdf
    try {
      const lib = await pdfjsOlish()
      pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise
    } catch (e) { prog.classList.add('hide'); toast('⚠️ PDF ochilmadi: ' + (e.message || 'shifrlangan bo‘lishi mumkin')); return }
    const sahSon = Math.min(pdf.numPages, 30)
    let matn = ''
    for (let p = 1; p <= sahSon; p++) {
      const pg = await pdf.getPage(p)
      const tc = await pg.getTextContent()
      let oxirgiY = null, satr = ''
      const satrlar = []
      for (const it of tc.items) {
        if (!it.str) continue
        const y = Math.round(it.transform[5])
        if (oxirgiY !== null && Math.abs(y - oxirgiY) > 3) { satrlar.push(satr); satr = it.str } else satr += (satr && !satr.endsWith(' ') ? ' ' : '') + it.str
        oxirgiY = y
      }
      if (satr) satrlar.push(satr)
      matn += satrlar.join('\n') + '\n\n'
      bar.style.width = Math.round(4 + (p / sahSon) * 26) + '%'
      stat.textContent = '📄 ' + p + '/' + sahSon + ' sahifa o‘qildi'
    }
    const paras = matn.split(/\n{2,}/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 1)
    if (!paras.length) { prog.classList.add('hide'); toast('⚠️ PDF ichida matn topilmadi (skan qilingan rasm bo‘lishi mumkin)'); return }
    // Bo'laklash (1200 belgi) — ketma-ket tarjima
    const bulaklar = []
    let cur = ''
    for (const p of paras) {
      if (cur && (cur + '\n' + p).length > 1200) { bulaklar.push(cur); cur = p } else cur = cur ? cur + '\n' + p : p
    }
    if (cur) bulaklar.push(cur)
    const tarjimalar = []
    for (let i = 0; i < bulaklar.length; i++) {
      stat.textContent = '🌐 Tarjima: ' + (i + 1) + '/' + bulaklar.length + ' bo‘lak…'
      bar.style.width = Math.round(30 + (i / bulaklar.length) * 68) + '%'
      try {
        const r = await post('/translate', { text: bulaklar[i], to: trTo })
        tarjimalar.push(r.translated || '')
      } catch (e) { tarjimalar.push('[' + (e.message || 'tarjima ishlamadi') + ']') }
    }
    bar.style.width = '100%'
    // v116: tarjimani UZLUK hujjatga yig'ish — bo'lak-bo'lak asl+tarjima juftlari
    // o'rniga yagona paragrafli hujjat. Paragraf chegaralari: tarjimon \n ni
    // saqlasa — asl paragraflar bo'yicha; saqlamasa — gaplarga bo'lib guruhlaymiz.
    const trParalar = []
    for (const t of tarjimalar) {
      for (let s of String(t || '').split('\n')) {
        s = s.trim()
        if (s) trParalar.push(s)
      }
    }
    if (trParalar.length === 1 && trParalar[0].length > 700) {
      const gaplar = trParalar[0].split(/(?<=[.!?…。！？])\s+/)
      trParalar.length = 0
      for (let i = 0; i < gaplar.length; i += 3) trParalar.push(gaplar.slice(i, i + 3).join(' '))
    }
    res.innerHTML = '<div class="trp-doc">' + trParalar.map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>'
    res.classList.remove('hide')
    $('trp-ctl').classList.remove('hide')
    prog.classList.add('hide')
    const toliq = bulaklar.map((b, i) => b + '\n— — —\n' + (tarjimalar[i] || '') + '\n\n').join('')
    window.__trpToliq = toliq
    toast('✅ Tarjima tayyor — ' + sahSon + ' sahifa')
    $('trp-copy').onclick = () => { copy(toliq); toast('📋 Nusxalandi') }
    $('trp-txt').onclick = () => {
      const bl = new Blob([toliq], { type: 'text/plain;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(bl)
      a.download = '50gram-tarjima-' + trTo + '.txt'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    }
    // v116: HAQIQIY PDF — bitta fayl, to'g'ridan-to'g'ri yuklab olish.
    // (eski oyna + chop etish oqimi OLIB TASHLANDI — orqaga qaytish yo'q edi)
    $('trp-print').onclick = async () => {
      const btn = $('trp-print')
      const eski = btn.textContent
      btn.textContent = '⏳ PDF tayyorlanmoqda…'
      try {
        const blob = await pdfHujjat(trParalar, sahSon)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = '50gram-tarjima-' + trTo + '.pdf'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 8000)
        toast('✅ PDF yuklab olindi — ' + trParalar.length + ' paragraf')
      } catch (e) {
        toast('⚠️ PDF yaratilmadi: ' + (e.message || 'xato') + ' — .txt sinab koring')
      }
      btn.textContent = eski
    }
  }

  // v116: HAQIQIY PDF YARATISH — canvas(A4) → JPEG sahifalar → yig'ma PDF.
  // Kutubxona KERAK EMAS: PDF tuzilishi qo'lda yig'iladi (DCTDecode rasm-sahifalar).
  // Xitoy/kirill/lotin brauzer shrifti bilan chiziladi — server/so'rov shart emas.
  async function pdfHujjat(paralar, sahSon) {
    const PW = 1240, PH = 1754, MX = 100          // A4 @150dpi + hoshiya
    const SH = '30px -apple-system,"Segoe UI",Roboto,"Noto Sans SC","Noto Sans",sans-serif'
    const LH = 47, ORA = 17
    const cnv = document.createElement('canvas')
    cnv.width = PW; cnv.height = PH
    const ctx = cnv.getContext('2d')
    const UZUN = PW - MX * 2
    const CJK = /[\u1100-\u11FF\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/
    // Qatorlarga bo'lish: so'z (lotin) + bitta CJK belgisi — sindirish nuqtalari
    const qatorBol = (matn) => {
      const tok = []
      let cur = ''
      const flush = () => { if (cur) { tok.push(cur); cur = '' } }
      for (const ch of matn) {
        if (/\s/.test(ch)) { flush(); tok.push(' ') } else if (CJK.test(ch)) { flush(); tok.push(ch) } else cur += ch
      }
      flush()
      const qatorlar = []
      let q = ''
      const sindir = (t) => {
        // bitta token qatorga sig'masa — belgima-belgi sindirish (uzun URL va h.k.)
        let s = t
        let i = 0
        while (i < s.length && ctx.measureText(q + s[i]).width <= UZUN) { q += s[i]; i++ }
        qatorlar.push(q)
        s = s.slice(i)
        while (ctx.measureText(s).width > UZUN) {
          let j = 1
          while (j < s.length && ctx.measureText(s.slice(0, j + 1)).width <= UZUN) j++
          qatorlar.push(s.slice(0, j))
          s = s.slice(j)
        }
        q = s
      }
      for (const t of tok) {
        if (t === ' ') { if (q) q += ' '; continue }
        if (q && ctx.measureText(q + t).width > UZUN) {
          if (ctx.measureText(t).width > UZUN) sindir(t)
          else { qatorlar.push(q); q = t }
        } else q += t
      }
      if (q.trim()) qatorlar.push(q.trim())
      return qatorlar.length ? qatorlar : ['']
    }
    const sahifalar = []
    let y = 0
    const yangiSahifa = (birinchi) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, PW, PH)
      ctx.textAlign = 'left'
      y = MX + 8
      if (birinchi) {
        ctx.fillStyle = '#1E8E4D'
        ctx.font = '600 40px -apple-system,"Segoe UI",Roboto,sans-serif'
        ctx.fillText('50 Gram tarjimasi', MX, y + 32)
        y += 44
        ctx.font = '26px -apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif'
        ctx.fillStyle = '#6b7280'
        const s = new Date()
        const sana = s.getFullYear() + '.' + String(s.getMonth() + 1).padStart(2, '0') + '.' + String(s.getDate()).padStart(2, '0')
        ctx.fillText(tilN(trTo) + ' · manba ' + sahSon + ' sahifa · ' + sana, MX, y + 28)
        y += 42
        ctx.strokeStyle = '#d7dce3'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(MX, y); ctx.lineTo(PW - MX, y); ctx.stroke()
        y += 40
      }
    }
    const sahifaYop = () => {
      ctx.fillStyle = '#9aa2af'
      ctx.font = '22px -apple-system,Roboto,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(String(sahifalar.length + 1), PW / 2, PH - 46)
      sahifalar.push(cnv.toDataURL('image/jpeg', 0.82))
    }
    yangiSahifa(true)
    for (const p of paralar) {
      ctx.font = SH
      ctx.fillStyle = '#171c26'
      const qatorlar = qatorBol(p)
      for (const q of qatorlar) {
        if (y + LH > PH - MX) { sahifaYop(); yangiSahifa(false) }
        ctx.fillText(q, MX, y)
        y += LH
      }
      y += ORA
      if (sahifalar.length % 4 === 3) await new Promise((r) => setTimeout(r))
    }
    sahifaYop()
    // JPEG → PDF yig'ish (katalog + sahifalar + rasm + kontent + xref) — qo'lda
    const baytlar = []
    for (const d of sahifalar) {
      const b = atob(d.split(',')[1])
      const u = new Uint8Array(b.length)
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
      baytlar.push(u)
    }
    const n = baytlar.length
    const WB = 595.28, HB = 841.89
    const enc = new TextEncoder()
    const qismlar = [], xref = []
    let ofset = 0
    const yoz = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; qismlar.push(b); ofset += b.length }
    const objBosh = (raqam) => { xref[raqam] = ofset; yoz(raqam + ' 0 obj\n') }
    yoz(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]))
    objBosh(1); yoz('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    const kids = []
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R')
    objBosh(2); yoz('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n')
    for (let i = 0; i < n; i++) {
      const jpg = baytlar[i]
      const pSah = 3 + i * 3, pRas = pSah + 1, pKont = pSah + 2
      xref[pRas] = ofset
      yoz(pRas + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + PW + ' /Height ' + PH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n')
      yoz(jpg)
      yoz('\nendstream\nendobj\n')
      const kont = 'q ' + WB + ' 0 0 ' + HB + ' 0 0 cm /Im0 Do Q'
      xref[pKont] = ofset
      yoz(pKont + ' 0 obj\n<< /Length ' + kont.length + ' >>\nstream\n' + kont + '\nendstream\nendobj\n')
      objBosh(pSah); yoz('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + WB + ' ' + HB + '] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ' + pRas + ' 0 R >> >> /Contents ' + pKont + ' 0 R >>\nendobj\n')
    }
    const INFO = 3 + n * 3
    objBosh(INFO); yoz('<< /Title (50 Gram Translation) /Producer (50gram.uz) >>\nendobj\n')
    const xrefPos = ofset
    let xr = 'xref\n0 ' + (INFO + 1) + '\n0000000000 65535 f \n'
    for (let i = 1; i <= INFO; i++) xr += String(xref[i] || 0).padStart(10, '0') + ' 00000 n \n'
    xr += 'trailer\n<< /Size ' + (INFO + 1) + ' /Root 1 0 R /Info ' + INFO + ' 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF'
    yoz(xr)
    return new Blob(qismlar, { type: 'application/pdf' })
  }

  // ------------------------- Hodisalarni bog'lash -------------------------
  function trBind() {
    qsa('#trseg div').forEach((d) => {
      d.onclick = () => {
        trRejim = d.dataset.m
        qsa('#trseg div').forEach((x) => x.classList.toggle('on', x === d))
        $('tr-text').classList.toggle('hide', trRejim !== 'text')
        $('tr-voice').classList.toggle('hide', trRejim !== 'voice')
        $('tr-pdf').classList.toggle('hide', trRejim !== 'pdf')
      }
    })
    $('tr-go').onclick = trMatn
    $('tr-swap').onclick = () => {
      // til almashtirish: tarjima natijasini kirishga qaytarish
      const out = $('tr-out')
      const t = out.querySelector('.tr-out-t').textContent
      if (t && t !== '—') { $('tr-in').value = t; out.classList.add('hide'); trMatn() }
    }
    $('trv-mic').onclick = () => { trRec ? trOvozToxta() : trOvozBoshla() }
    $('trv-play').onclick = () => {
      if (trvAudio) { try { trvAudio.currentTime = 0 } catch {}; trvAudio.play().catch(() => {}) }
    }
    $('trp-file').onchange = (e) => { const f = e.target.files[0]; if (f) pdfTarjima(f); e.target.value = '' }
    tilQatorBogla('tr-tilqator')
    tilQatorBogla('trv-tilqator')
    tilQatorBogla('trp-tilqator')
  }

  // ------------------------- Xabar ichida tarjima (chat kontekst-menyusi) -------------------------
  window.trMsg = async (m) => {
    if (!m || !m.body) return
    toast('🌐 Tarjima qilinmoqda…')
    try {
      const r = await post('/translate', { text: String(m.body).slice(0, 4000), to: trTo })
      const sh = sheet('<div class="trmsg"><div class="mut">' + esc('🌐 ' + (r.from && r.from !== 'auto' ? tilN(r.from) : 'Aniqlangan til') + ' → ' + tilN(r.to)) + '</div><div class="trt">' + esc(r.translated || '—') + '</div><button class="btn" id="trm-cp">📋 Nusxa olish</button></div>')
      const cp = sh.querySelector('#trm-cp')
      if (cp) cp.onclick = () => { copy(r.translated || ''); toast('📋 Nusxalandi') }
    } catch (e) { toast('⚠️ ' + (e.message || 'Tarjima ishlamadi')) }
  }
})()
