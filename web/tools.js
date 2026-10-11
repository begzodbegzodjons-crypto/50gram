// ==========================================================================
// 50 GRAM TOOLLAR (v114) — REYTING + TARJIMON
// Reyting: kanallar / guruhlar / aktiv foydalanuvchilar (7 kunlik faollik)
// Tarjimon: matn, ovoz (Whisper AI -> tarjima -> TTS ovoz), PDF hujjat (6 til)
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

  // ------------------------- REYTING -------------------------
  let ratTab = localStorage.getItem('g50rat') || 'users'
  let ratYuk = {}
  const MEDAL = ['🥇', '🥈', '🥉']
  const qisqaSon = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n || 0)

  function ratRow(i, x, tab) {
    const orn = MEDAL[i] || '<span class="rnk">' + (i + 1) + '</span>'
    if (tab === 'users') {
      const nm = ((x.first_name || '') + ' ' + (x.last_name || '')).trim() || 'Foydalanuvchi'
      const lv = x.earned >= 30000 ? '🥇' : x.earned >= 10000 ? '🥈' : x.earned >= 2000 ? '🥉' : x.earned >= 500 ? '⭐' : '🌱'
      return '<div class="item rat-it">' +
        '<div class="rat-rank">' + orn + '</div>' +
        avHTML({ id: x.id, first_name: x.first_name, last_name: x.last_name, avatar_ver: x.avatar_ver }, 44, { noStory: true }) +
        '<div class="mid"><div class="t1"><b>' + esc(nm) + '</b> <span class="lv">' + lv + '</span></div>' +
        '<div class="t2">' + (x.username ? '@' + esc(x.username) + ' · ' : '') + 'Martaba ' + qisqaSon(x.earned) + '</div></div>' +
        '<div class="rat-score"><b>' + qisqaSon(x.n) + '</b><span>xabar</span></div></div>'
    }
    const ty = tab === 'channels'
    return '<div class="item rat-it">' +
      '<div class="rat-rank">' + orn + '</div>' +
      avHTML({ id: x.id, title: x.title, avatar_ver: x.avatar_ver }, 44, { chat: true, noStory: true }) +
      '<div class="mid"><div class="t1"><b>' + esc(x.title || '(nom yozilmagan)') + '</b></div>' +
      '<div class="t2">' + (x.username ? '@' + esc(x.username) + ' · ' : '') + qisqaSon(x.member_count) + ' ' + (ty ? 'obunachi' : 'a‘zo') + '</div></div>' +
      '<div class="rat-score"><b>' + qisqaSon(x.n7) + '</b><span>7 kun</span></div></div>'
  }

  async function ratYukla(force) {
    const box = $('ratlist')
    if (!box) return
    // keshda bo‘lsa darhol chizamiz + har doim fonda yangilaymiz (stale-while-revalidate)
    if (ratYuk[ratTab] && !force) ratChiz(ratYuk[ratTab])
    if (!ratYuk[ratTab] && !force) box.innerHTML = '<div class="mut" style="padding:28px;text-align:center">⏳ Yuklanmoqda…</div>'
    try {
      const r = await api('/rating?tab=' + ratTab)
      ratYuk[ratTab] = r
      ratChiz(r)
    } catch (e) {
      if (!ratYuk[ratTab]) box.innerHTML = '<div class="mut" style="padding:28px;text-align:center">⚠️ ' + esc(e.message || 'Yuklanmadi') + '</div>'
    }
  }
  function ratChiz(r) {
    const box = $('ratlist')
    if (!box) return
    const list = r.list || []
    if (!list.length) { box.innerHTML = '<div class="mut" style="padding:28px;text-align:center">Hozircha ma’lumot yo‘q — faollik oshgani sari reyting to‘ladi 🌱</div>'; return }
    let h = ''
    if (r.me && r.me.n) h += '<div class="rat-me">Siz: <b>#' + r.me.rank + '</b> · ' + r.me.n + ' xabar (7 kun)</div>'
    h += list.map((x, i) => ratRow(i, x, r.tab)).join('')
    box.innerHTML = h
  }
  window.ratOch = () => {
    // segmentlar + yangilash tugmasi — bir marta bog'lanadi
    const seg = $('ratseg')
    if (seg && !seg.dataset.bogla) {
      seg.dataset.bogla = '1'
      qsa('#ratseg div').forEach((d) => {
        d.onclick = () => {
          ratTab = d.dataset.r
          localStorage.setItem('g50rat', ratTab)
          ratYukla(false)
        }
      })
      const rf = $('b-ratref')
      if (rf) rf.onclick = () => ratYukla(true)
    }
    qsa('#ratseg div').forEach((d) => d.classList.toggle('on', d.dataset.r === ratTab))
    ratYukla(false)
  }

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
      '<div id="trp-ctl" class="hide"><button class="lnk" id="trp-copy">📋 Hammasini nusxalash</button><button class="lnk" id="trp-print">🖨 PDF sifatida saqlash</button><button class="lnk" id="trp-txt">⬇️ Matn (.txt)</button></div>'
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

  async function trOvozBoshla() {
    if (trRec) return
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Bu brauzer ovoz yozishni qo‘llamaydi')
    let stream = null
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) } catch { return toast('🎤 Mikrofon ruxsati berilmagan — brauzer sozlamasidan yoqing') }
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
      $('trv-stat').textContent = '🔴 Yozib olinmoqda… gapiring (60 s gacha). To‘xtatish uchun bosing.'
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
      const audio = await blobB64(blob)
      const r = await post('/translate/speech', { audio, to: trTo })
      $('trv-src').textContent = r.text || '—'
      $('trv-dst').textContent = r.translated || '—'
      $('trv-to-n').textContent = '🌐 ' + tilN(r.to) + ' tarjimasi'
      res.classList.remove('hide')
      stat.textContent = '✅ Tayyor'
      if (r.audio) {
        try { trvAudio = new Audio(r.audio); await trvAudio.play() } catch {}
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
    // Chizish: har bo'lak — asl (xira) + tarjima
    res.innerHTML = bulaklar.map((b, i) =>
      '<div class="trp-blk"><div class="trp-orig">' + esc(b) + '</div><div class="trp-tr">' + esc(tarjimalar[i] || '—') + '</div></div>').join('')
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
    $('trp-print').onclick = () => {
      try {
        const w = window.open('', '_blank')
        if (!w) return toast('Pop-up bloklandi — .txt yuklab oling')
        w.document.write('<html><head><title>50 Gram tarjima</title><meta charset="utf-8"><style>body{font:13px/1.7 -apple-system,Roboto,sans-serif;margin:40px}h1{font-size:18px}.o{color:#888;margin-bottom:4px}.t{margin-bottom:26px;border-left:3px solid #1E8E4D;padding-left:12px}@media print{button{display:none}}</style></head><body><h1>50 Gram — ' + tilN(trTo) + ' tarjimasi</h1>' +
          bulaklar.map((b, i) => '<div class="o">' + esc(b) + '</div><div class="t">' + esc(tarjimalar[i] || '') + '</div>').join('') +
          '<hr><small>50gram.uz Tarjimon</small></body></html>')
        w.document.close()
        setTimeout(() => { try { w.print() } catch {} }, 600)
      } catch { toast('Chop etish ochilmadi — .txt yuklab oling') }
    }
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
