/* 50 Gram — istoriyalar, lenta (yangiliklar, e'lonlar), kontaktlar */
'use strict'

// ---------------- Istoriyalar ----------------
async function loadStories() {
  const list = await api('/stories')
  S.stories = list
  for (const g of list) {
    if (g.user) S.users.set(g.user.id, g.user)
    for (const s of g.stories) if (s.media_id && s.meta) P2P.note(String(s.media_id), { chat: 0, ...s.meta })
  }
  renderStories()
  if (S.tab === 't-me') renderMe()
}
function renderStories() {
  const box = $('stories')
  if (!box || !S.me) return
  const mine = S.stories.find((g) => g.user.id === S.me.id)
  const others = S.stories.filter((g) => g.user.id !== S.me.id)
  const liveMap = new Map((S.lives || []).map((l) => [l.user.id, l]))
  box.innerHTML = `<div class="st" data-mystory>${avHTML(S.me, 58)}${mine ? '' : '<span class="plus">+</span>'}<small>Mening</small></div>` +
    others.map((g) => { const lv = liveMap.get(g.user.id); return `<div class="st" data-sto="${g.user.id}">${avHTML(g.user, 58, lv ? { live: true, liveId: lv.id } : {})}<small${lv ? ' class="onl"' : ''}>${esc(g.user.first_name || '')}</small></div>` }).join('') +
    (S.lives || []).map((l) => `<div class="st" data-live="${l.id}">${avHTML(l.user, 58, { live: true, noStory: true, liveId: l.id })}<small class="onl">🔴 Efir</small></div>`).join('')
  hydrate(box)
}
$('stories').addEventListener('click', (e) => {
  const lv = e.target.closest('[data-live]'); if (lv) { e.stopPropagation(); return watchLive(+lv.dataset.live) }
  if (e.target.closest('[data-mystory]')) {
    e.stopPropagation(); e.preventDefault()
    const mine = S.stories.find((g) => g.user.id === S.me.id)
    if (!mine) return createStory()
    const sh = sheet(h3('Istoriya') + `<div class="rows"><div data-a="view"><span class="ri">👁</span><div class="rt">Istoriyamni ko‘rish</div></div><div data-a="new"><span class="ri">➕</span><div class="rt">Yangi istoriya</div></div></div>`)
    sh.onclick = (ev) => { const it = ev.target.closest('[data-a]'); if (!it) return; closeSheet(sh); it.dataset.a === 'view' ? openStoryOf(S.me.id) : createStory() }
  }
}, true)
async function loadLives() { try { S.lives = await api('/lives'); renderStories(); renderChats() } catch {} }
// Efir boshlandi/tugadi — real vaqtda (WS) belgilarni yangilash
on('live_start', (ev) => {
  loadLives()
  if (S.tab === 't-contacts') renderContacts()
  const u = ev.user || S.users.get(ev.from)
  toast('🔴 ' + (u ? uname(u) : 'Biror kim') + ' efirga chiqdi — profil rasmini bosing')
  vibrate(20)
})
on('live_end', (ev) => {
  if ((S.lives || []).some((l) => l.id === ev.live_id)) { loadLives(); if (S.tab === 't-contacts') renderContacts() }
})

let svState = null
function openStoryOf(uid) {
  const gi = S.stories.findIndex((g) => g.user.id === uid)
  if (gi < 0) return openUser(uid)
  const g = S.stories[gi]
  const first = Math.max(0, g.stories.findIndex((s) => !s.seen))
  showStory(gi, first)
}
function closeStory() {
  if (!svState) return
  clearInterval(svState.timer)
  svState.el.remove()
  svState = null
  renderStories(); renderChats()
}
async function showStory(gi, si) {
  const g = S.stories[gi]
  if (!g) return closeStory()
  if (si >= g.stories.length) return showStory(gi + 1, 0)
  if (si < 0) return gi > 0 ? showStory(gi - 1, 0) : null
  const s = g.stories[si]
  const own = g.user.id === S.me.id
  if (!svState) {
    const el = document.createElement('div')
    el.className = 'sv'
    document.body.appendChild(el)
    svState = { el }
  }
  clearInterval(svState.timer)
  Object.assign(svState, { gi, si, paused: false, t: 0 })
  const el = svState.el
  el.innerHTML = `<div class="bars">${g.stories.map((_, i) => `<i><b style="width:${i < si ? 100 : 0}%"></b></i>`).join('')}</div>
    <div class="shd">${avHTML(g.user, 36, { noStory: true })}<div><b>${esc(uname(g.user))}</b><small>${fmtAgo(s.created_at)}</small></div><button class="xb">✕</button></div>
    <div class="body">${s.kind === 'text' ? `<div class="stext" style="background:${esc(s.bg || 'linear-gradient(135deg,#0A7CFF,#7B2FF7)')}">${linkify(s.text_body || '')}</div>` : s.kind === 'video' ? `<video data-media="${s.media_id}" autoplay playsinline></video>` : `<img data-media="${s.media_id}" alt="">`}</div>
    <div class="tap l"></div><div class="tap r"></div>
    <div class="sbot">${own ? `<button class="vw">👁 ${s.views || 0} ko‘rish</button><button class="vw" data-del>🗑</button>` : `<input class="q" placeholder="Javob yozing…" maxlength="500">${['❤️', '🔥', '😂', '😍'].map((r) => `<button class="vw" data-r="${r}">${r}</button>`).join('')}`}</div>`
  hydrate(el)
  if (!s.seen && !own) { s.seen = true; g.unseen = Math.max(0, (g.unseen || 1) - 1); post(`/stories/${s.id}/view`, {}).catch(() => {}) }
  let dur = 6000
  const vid = qs('video', el)
  if (vid) vid.onloadedmetadata = () => { if (isFinite(vid.duration)) dur = Math.min(60000, vid.duration * 1000) }
  const bar = qsa('.bars b', el)[si]
  svState.timer = setInterval(() => {
    if (!svState || svState.paused) return
    svState.t += 50
    bar.style.width = Math.min(100, (svState.t / dur) * 100) + '%'
    if (svState.t >= dur) showStory(gi, si + 1)
  }, 50)
  qs('.xb', el).onclick = closeStory
  qs('.tap.l', el).onclick = () => showStory(gi, si - 1)
  qs('.tap.r', el).onclick = () => showStory(gi, si + 1)
  qs('.shd .avw', el).onclick = () => { closeStory(); openUser(g.user.id) }
  const q = qs('.q', el)
  if (q) {
    q.onfocus = () => (svState.paused = true)
    q.onblur = () => svState && (svState.paused = false)
    q.onkeydown = async (e) => {
      if (e.key !== 'Enter' || !q.value.trim()) return
      const text = q.value.trim(); q.value = ''
      try { const c = await post('/chats/direct', { user_id: g.user.id }); await post(`/chats/${c.id}/messages`, { kind: 'text', body: '💬 Istoriyangizga: ' + text, client_id: 's' + Date.now() }); toast('✅ Yuborildi') } catch (er) { toast('⚠️ ' + er.message) }
      q.blur()
    }
  }
  qsa('[data-r]', el).forEach((b) => (b.onclick = () => { post(`/stories/${s.id}/view`, { reaction: b.dataset.r }).catch(() => {}); const f = document.createElement('div'); f.className = 'fly'; f.textContent = b.dataset.r; el.appendChild(f); setTimeout(() => f.remove(), 1200) }))
  const vw = qs('.vw:not([data-del])', el)
  if (own && vw) vw.onclick = async () => {
    svState.paused = true
    try {
      const list = await api(`/stories/${s.id}/views`)
      sheet(h3(`Ko‘rganlar (${list.length})`) + `<div class="list">${list.map((v) => `<div class="item">${avHTML(v.user, 40, { noStory: true })}<div class="mid"><div class="t1"><b>${esc(uname(v.user))}</b><span class="tm">${v.reaction || ''}</span></div><div class="t2"><span>${fmtAgo(v.viewed_at)}</span></div></div></div>`).join('') || '<div class="empty">Hali hech kim ko‘rmadi</div>'}</div>`, { onClose: () => svState && (svState.paused = false) })
    } catch (e) { toast('⚠️ ' + e.message) }
  }
  const dl = qs('[data-del]', el)
  if (dl) dl.onclick = async () => {
    svState.paused = true
    if (!(await confirmBox('Istoriya o‘chirilsinmi?', 'O‘chirish'))) { svState.paused = false; return }
    try { await del('/stories/' + s.id); if (s.media_id) Store.remove([String(s.media_id)]); closeStory(); loadStories() } catch (e) { toast('⚠️ ' + e.message) }
  }
}
window.addEventListener('keydown', (e) => {
  if (!svState || e.target.tagName === 'INPUT') return
  if (e.key === 'Escape') closeStory()
  if (e.key === 'ArrowRight') showStory(svState.gi, svState.si + 1)
  if (e.key === 'ArrowLeft') showStory(svState.gi, svState.si - 1)
})
const BGS = ['linear-gradient(135deg,#0A7CFF,#7B2FF7)', 'linear-gradient(135deg,#FF6A5C,#B3123A)', 'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#f7971e,#ffd200)', 'linear-gradient(135deg,#232526,#414345)', 'linear-gradient(135deg,#ee9ca7,#ffdde1)']
function createStory() {
  const sh = sheet(h3('Yangi istoriya') + `<div class="rows"><div data-a="media"><span class="ri">🖼</span><div class="rt">Rasm yoki video<small>Video 60 soniyagacha</small></div></div><div data-a="cam"><span class="ri">📷</span><div class="rt">Kamera</div></div><div data-a="text"><span class="ri">🔤</span><div class="rt">Matnli istoriya</div></div></div><div class="hint">Istoriya 24 soat turadi va profil rasmingiz o‘rnida ko‘rinadi.</div>`)
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    const a = it.dataset.a
    closeSheet(sh)
    if (a === 'text') return textStory()
    const f = a === 'cam' ? await pickFile('image/*,video/*', false, 'user') : await pickFile('image/*,video/*')
    if (!f) return
    const video = f.type.startsWith('video/')
    toast('⏳ Istoriya yuklanmoqda…', 8000)
    try {
      const blob = video ? f : await resizeImage(f, 1440, 0.85)
      const id = await upload(blob, f.name)
      await post('/stories', { kind: video ? 'video' : 'photo', media_id: id, meta: mediaInfo(id) })
      toast('✅ Istoriya joylandi'); loadStories()
    } catch (er) { toast('⚠️ ' + er.message) }
  }
}
function textStory() {
  let bg = BGS[0]
  const sh = sheet(h3('Matnli istoriya') + `<div id="ts-p" style="background:${bg};border-radius:16px;min-height:220px;display:flex;align-items:center;justify-content:center;padding:20px;color:#fff;font-size:22px;font-weight:700;text-align:center;white-space:pre-wrap">Matn…</div>
    <div style="display:flex;gap:8px;margin:10px 0">${BGS.map((b, i) => `<span data-bg="${i}" style="width:32px;height:32px;border-radius:50%;background:${b};cursor:pointer"></span>`).join('')}</div>
    <textarea class="inp" id="ts-t" rows="3" maxlength="500" placeholder="Nima yangiliklar?"></textarea><button class="btn big" id="ts-s">Joylash</button>`)
  qs('#ts-t', sh).oninput = (e) => (qs('#ts-p', sh).textContent = e.target.value || 'Matn…')
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-bg]'); if (b) { bg = BGS[+b.dataset.bg]; qs('#ts-p', sh).style.background = bg } })
  qs('#ts-s', sh).onclick = () => { const t = qs('#ts-t', sh).value.trim(); if (!t) return toast('Matn yozing'); tryDo(async () => { await post('/stories', { kind: 'text', text_body: t, bg }); closeSheet(sh); loadStories() }, '✅ Istoriya joylandi') }
}
on('story_reaction', (ev) => { const u = S.users.get(ev.user_id); toast(`${ev.reaction} ${u ? uname(u) : 'Kimdir'} istoriyangizga munosabat bildirdi`) })

// ---------------- Lenta: 🔥 Trend (internet), yangiliklar, e'lonlar, reels ----------------
let feedMode = 'trend', feedPosts = [], feedEnd = false, feedBusy = false
let reelsObserver = null

// ============ 🔥 TREND: internetdan jonli yangilik va videolar ============
// Serverga saqlanmaydi — to'g'ridan-to'g'ri internetdan olinadi; manba nomi ko'rsatilmaydi.
const TCATS = {
  all: ['🔥', 'Barchasi'], uz: ['🇺🇿', 'O‘zbekiston'], world: ['🌍', 'Dunyo'], tech: ['💻', 'Texnologiya'],
  sport: ['⚽', 'Sport'], biznes: ['💼', 'Biznes'], shou: ['🎬', 'Ko‘ngilochar'], fan: ['🔬', 'Fan'],
  salomatlik: ['❤️', 'Salomatlik'], video: ['🎥', 'Video'],
}
let trendItems = [], trendPage = 0, trendEnd = false, trendBusy = false, trendCat = 'all'
const tintGet = () => { try { return JSON.parse(localStorage.getItem('g50_tint') || '{}') } catch { return {} } }
function tintAdd(cat) {
  if (!TCATS[cat] || cat === 'all') return
  const t = tintGet(); t[cat] = (t[cat] || 0) + 1
  try { localStorage.setItem('g50_tint', JSON.stringify(t)) } catch {}
}
const catsParam = () => Object.entries(tintGet()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(',')
const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' mln' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' ming' : String(n || 0)
function renderTrendChips() {
  const box = $('trendchips')
  if (!box || feedMode !== 'trend') return
  box.innerHTML = Object.entries(TCATS).map(([k, [e, l]]) => `<span class="tchip ${trendCat === k ? 'on' : ''}" data-tc="${k}">${e} ${l}</span>`).join('')
}
function trendCard(x) {
  if (x.kind === 'short') return `<div class="tcard short vid" data-tv="${x.id}" style="${x.image ? `background-image:url('${esc(x.image)}')` : ''}"><span class="tch">🎬 Shorts</span><div class="pplay">▶</div><div class="tcb"><b>${esc(x.title)}</b><small>${x.views ? '👁 ' + fmtN(x.views) : ''}${x.duration ? ' · ' + fmtDur(x.duration) : ''}</small></div></div>`
  if (x.kind === 'video') return `<div class="tcard vid" data-tv="${x.id}" style="${x.image ? `background-image:url('${esc(x.image)}')` : ''}"><span class="tch">🎥 Video</span><div class="tcb"><b>${esc(x.title)}</b><small>${fmtAgo(x.time)}${x.views ? ' · 👁 ' + fmtN(x.views) : ''} · ${fmtDur(x.duration || 0)}</small></div></div>`
  const em = TCATS[x.cat] ? TCATS[x.cat][0] : '📰'
  const img = x.image ? `<img loading="lazy" src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : `<div class="tnoimg">${em}</div>`
  return `<div class="tcard${x.image ? '' : ' noimg'}" data-tn="${x.id}">${img}<div class="tcb"><span class="tch">${em} ${TCATS[x.cat] ? TCATS[x.cat][1] : 'Yangilik'}</span><b>${esc(x.title)}</b>${x.snippet ? `<small>${esc(x.snippet)}</small>` : ''}<small class="tm">${fmtAgo(x.time)}</small></div></div>`
}
function renderTrend() {
  const box = $('feedlist')
  $('t-feed').classList.remove('reelmode')
  renderTrendChips()
  box.innerHTML = trendItems.length
    ? `<div class="tgrid">${trendItems.map(trendCard).join('')}</div>` +
      (trendEnd ? '<div class="hint" style="text-align:center;padding:12px">Yangiliklar tugamaydi — birozdan keyin yana yangilanadi ✨</div>' : '<div class="tload"><span class="spin"></span></div>')
    : `<div class="empty"><span class="big">🔥</span>Yangiliklar yuklanmadi. Qaytadan urinib ko‘ring.</div>`
  obsTrend()
}
// --- Analiz tizimi beacon'lari: FAQAT agregat hisoblagichlar yuboriladi (sarlavha/URL/kanal saqlanmaydi) ---
const tevQ = new Map()
let tevT = null
function tev(cat, ev, ms) {
  if (!TCATS[cat] && cat !== 'video') return
  const k = cat + '|' + ev
  tevQ.set(k, (tevQ.get(k) || 0) + (ev === 'wt' ? (ms || 0) : 1))
  if (!tevT) tevT = setTimeout(flushTev, 4000)
}
function flushTev() {
  tevT = null
  if (!tevQ.size) return
  const items = [...tevQ.entries()].slice(0, 8)
  tevQ.clear()
  for (const [k, v] of items) {
    const [cat, ev] = k.split('|')
    api('/trend/ev', { method: 'POST', body: { cat, ev, ms: ev === 'wt' ? Math.min(v, 3600000) : undefined, n: ev === 'wt' ? 1 : Math.min(v, 50) } }).catch(() => {})
  }
}
setInterval(flushTev, 15000)
let tObs = null
const tSeen = new Set()
function obsTrend() {
  if (!('IntersectionObserver' in window)) return
  if (!tObs) tObs = new IntersectionObserver((es) => {
    for (const en of es) {
      const el = en.target
      if (en.isIntersecting && en.intersectionRatio >= 0.55 && !tSeen.has(el)) {
        tSeen.add(el)
        tObs.unobserve(el)
        const x = trendItems.find((v) => v.id === el.dataset.tv || v.id === el.dataset.tn)
        if (x) tev(x.kind === 'video' || x.kind === 'short' ? 'video' : (x.cat || 'uz'), 'imp')
      }
    }
  }, { threshold: [0.55] })
  qsa('#feedlist .tcard[data-tn],#feedlist .tcard[data-tv]').forEach((el) => { if (!tSeen.has(el)) tObs.observe(el) })
}
function trendSkeleton() {
  return `<div class="tgrid">${Array(6).fill('<div class="tcard sk"><div class="skimg"></div><div class="tcb"><b>‎</b><small>‎</small></div></div>').join('')}</div>`
}
// ZUDLIK keshi: oxirgi 1-sahifa localStorage'da (3 kun) — lenta HAR QAYTA OCHILGANDA, hatto ilova
// qayta ishga tushganda/oflaynda ham darhol chiziladi (fon yangilanadi). Bu "lenta sekin" muammosi yechimi.
function trendCacheSave(items) {
  try { localStorage.setItem('g50_trend_c3', JSON.stringify({ t: Date.now(), items: items.slice(0, 24) })) } catch {}
}
function trendCacheAge() {
  try { const d = JSON.parse(localStorage.getItem('g50_trend_c3') || ''); return d && d.t ? Date.now() - d.t : Infinity } catch { return Infinity }
}
function trendCacheGet() {
  try {
    // c3: eski c2 keshdagi Anilan-Minecraft videolari BATAMOM unutiladi (foydalanuvchi: "eski shunday" — keshda qolib ketgandi)
    const d = JSON.parse(localStorage.getItem('g50_trend_c3') || '')
    // 3 kun — mavzular tezroq yangilanadi (random algoritm bilan har safar xilma-xil ko'rinish uchun)
    if (d && d.items && d.items.length && Date.now() - d.t < 3 * 864e5) return d.items
  } catch {}
  return null
}
// FISHER-YATES: ro'yxatni joyida aralashtirish — har ochilishda boshqa tartib (bir xillik yo'q)
function shShuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}
// MINECRAFT FILTRI (foydalanuvchi talabi: "tagi bilan o'chirib yo'q qilib tashla"): Minecraft
// videolari Reels/Shorts lentasida UMUMAN ko'rinmaydi — latin + kirill sarlavhalar bo'yicha,
// bo'shliq/belgilar olib tashlab tekshiriladi (Minecraft, Maynkraft, Майнкрафт, Minе Kraf...)
const shBadT = (t) => { try { const s = String(t || '').toLowerCase().replace(/[\s_\-.,!?()[\]:'"«»]/g, ''); return /minecraft|minekraf|maynkraft|майнкрафт|минекрафт/.test(s) } catch { return false } }
// VIDEO-ID QATIY BLOK (server BLOCK_VIDS bilan bir xil): sarlavhasida "minecraft" yozilmagan
// Anilan-dublaj o'yin videolari ID bo'yicha kesiladi — manba siri tufayli klient faqat yt-ID ko'radi.
const shBadId = new Set(['A0VSlf71MBg','Jd-ve41f-aY','iTdKFb675xM','N1W5nsZKLaE','TMHOBYLjUw8','xpnmQhCFceY','l6pjLj-v0FE','eiQb0DeZGSk','qhmMzT-5OSQ','G7aNRr0R-sk','o4fAgHxlJAw','by4wzlyfwUQ','ThhEzyvVeZI','Fa2ghDWxPBI','xJ5gtl7UzBs'])
const shBadV = (x) => shBadId.has(String(x && (x.yt || x.embed) || ''))
// Barqaror ID: serverda id bo'lmasa (eski kesh/kod) manba+native-id'dan sintetik qilinadi —
// kartalarning data-trend/data-tv qiymati bilan klik-qidiruv AYNAN mos kelishi uchun
const shTrendId = (x) => x && (x.id || (x.yt ? 'yt' + x.yt : x.mp4 ? 'mk' + x.mp4 : x.ig ? 'ig' + x.ig : x.fb ? 'fb' + x.fb : x.embed ? 'dm' + x.embed : x.url ? 'n' + String(x.url).slice(-40) : ''))
async function loadTrend(reset) {
  if (trendBusy) return
  if (reset) {
    trendItems = []; trendPage = 0; trendEnd = false
    const cached = trendCat === 'all' ? trendCacheGet() : null
    if (cached && cached.length) {
      // KESH DARHOL: skeleton o'rniga oxirgi kontent ko'rinadi, yangisi fon Keladi
      trendItems = cached.slice()
      trendPage = 1
      renderTrend()
      trendBusy = true
      try {
        const r = await api('/trend?page=1' + (catsParam() ? '&cats=' + encodeURIComponent(catsParam()) : ''))
        const list = r.items || []
        if (feedMode === 'trend' && list.length) { trendItems = list; renderTrend(); trendCacheSave(list) }
      } catch {} finally { trendBusy = false }
      return
    }
    $('feedlist').innerHTML = trendSkeleton()
  }
  if (trendEnd) return
  trendBusy = true
  try {
    trendPage++
    const q = `?page=${trendPage}` + (trendCat !== 'all' ? '&cat=' + trendCat : '') + (trendCat === 'all' && trendPage === 1 ? '&cats=' + encodeURIComponent(catsParam()) : '')
    const r = await api('/trend' + q)
    // ID NORMALIZATSIYA: kartalar data-tn/data-tv qiymati bilan qidiruv aynan mos bo'lishi uchun
    // (serverda id bo'lmasa — sintetik) + Shorts'larda Minecraft filtri (sarlavha + video-ID)
    const list = (r.items || []).filter((x) => (x.kind === 'short' || x.kind === 'video') ? (!shBadT(x.title) && !shBadV(x)) : true)
    for (const x of list) if (x && !x.id) x.id = shTrendId(x)
    if (!list.length && trendPage === 1 && !trendCat) {
      // Vaqtinchalik bo'sh — 1.5s dan keyin avtomatik qayta urinish
      trendPage = 0
      setTimeout(() => { if (feedMode === 'trend' && !trendItems.length) loadTrend() }, 1500)
      return
    }
    trendItems.push(...list)
    if (!list.length) trendEnd = true
    if (trendPage === 1 && trendCat === 'all') trendCacheSave(trendItems)
    renderTrend()
  } catch (e) { if (reset && !trendItems.length) $('feedlist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; trendPage-- } finally { trendBusy = false }
}
// TO'LIQ O'QISH (Task 47): yangilik ilova ICHIDA, to'liq matnda o'qiladi — tashqi saytga
// yo'naltirish YO'Q, manba nomi/havolasi HECH QANDAY SHAKLDA ko'rsatilmaydi (manba siri —
// URL faqat serverda qoladi, matn /trend/article?id= orqali olinadi). "To'liq o'qish"
// tugmasi tashqi havola EMAS — matn shu oynada to'liq chiziladi.
function openTrendNews(x) {
  tintAdd(x.cat)
  tev(x.cat || 'uz', 'clk')
  const artKey = 'g50_art_' + x.id
  let cached = null
  try { const d = JSON.parse(sessionStorage.getItem(artKey) || 'null'); if (d && d.paras) cached = d } catch {}
  const o = document.createElement('div')
  o.className = 'treader'
  o.innerHTML = `<div class="treader-in">
    <button class="xb" aria-label="Yopish">✕</button>
    <div class="tr-body">
      ${x.image ? `<img class="tr-img" src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : ''}
      <span class="tch">${TCATS[x.cat] ? TCATS[x.cat][0] + ' ' + TCATS[x.cat][1] : '📰 Yangilik'}</span>
      <h1>${esc(x.title)}</h1>
      <div class="tr-meta"><span>${fmtAgo(x.time)}</span><span id="tr-min">${cached ? '· ' + cached.mins + ' daqiqa o‘qish' : ''}</span></div>
      <div class="tr-text">${cached ? '' : '<div class="tr-skel"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>'}</div>
    </div>
  </div>`
  document.body.appendChild(o)
  requestAnimationFrame(() => o.classList.add('on'))
  const txt = qs('.tr-text', o)
  const draw = (a) => {
    txt.innerHTML = (a.paras || []).map((p) => `<p>${linkify(String(p || ''))}</p>`).join('') || '<div class="empty">Matn topilmadi</div>'
    const m = qs('#tr-min', o)
    if (m && a.mins) m.textContent = '· ' + a.mins + ' daqiqa o‘qish'
  }
  const load = async () => {
    if (cached) return draw(cached)
    try {
      const a = await api('/trend/article?id=' + encodeURIComponent(x.id))
      try { sessionStorage.setItem(artKey, JSON.stringify(a)) } catch {}
      draw(a)
    } catch (e) {
      txt.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}<br><button class="btn" data-rt style="margin-top:10px">Qayta urinish</button></div>`
      const rt = qs('[data-rt]', o)
      if (rt) rt.onclick = () => { txt.innerHTML = '<div class="tr-skel"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>'; load() }
    }
  }
  load()
  const close = () => { flushTev(); o.classList.remove('on'); setTimeout(() => o.remove(), 200) }
  qs('.xb', o).onclick = close
  o.onclick = (e) => { if (e.target === o) close() }
}
function openTrendVideo(x) {
  tev('video', 'clk')
  tintAdd('video')
  const o = document.createElement('div')
  o.className = 'tvo'
  // Pleyer formati: mp4 (to'g'ridan-to'g'ri, muqovasiz) > YouTube > Dailymotion — manba nomi ko'rsatilmaydi
  let pl = ''
  if (x.mp4) pl = `<video class="tvp" src="${esc(x.mp4)}" playsinline autoplay controls preload="metadata"></video><audio class="tva" preload="none"></audio>`
  else if (x.ig) pl = `<iframe class="tvp" src="https://www.instagram.com/reel/${esc(x.ig)}/embed/captioned/" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  else if (x.yt) pl = `<iframe class="tvp" src="https://www.youtube.com/embed/${esc(x.yt)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  else pl = `<iframe class="tvp" src="https://geo.dailymotion.com/player.html?video=${esc(x.embed)}&autoplay=1" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  o.innerHTML = `<button class="xb">✕</button><div class="tvb">${pl}<div class="tvi"><b>${esc(x.title)}</b><small>${fmtAgo(x.time)}${x.views ? ' · 👁 ' + fmtN(x.views) : ''}</small><button class="btn gh" data-vsh>↗️ Ulashish</button></div></div>`
  document.body.appendChild(o)
  requestAnimationFrame(() => o.classList.add('on'))
  // Ko'rish vaqti kuzatuvi (analiz tizimi) — har 5s beacon navbatiga qo'shiladi
  const wt = setInterval(() => { if (document.contains(o)) tev('video', 'wt', 5000) }, 5000)
  // mp4 + alohida audio sinxronizatsiyasi (Reddit/DASH mp4 audio treksi alohida faylda)
  const v = qs('video', o), a = qs('audio', o)
  if (v && a && x.audio) {
    let audioTry = 0
    const AURLS = [x.audio, x.audio.replace('AUDIO_128', 'AUDIO_64'), x.audio.replace(/DASH_AUDIO_\d+\.mp4/, 'DASH_audio.mp4')]
    const setA = () => { if (audioTry < AURLS.length) { a.src = AURLS[audioTry++]; return true } a.removeAttribute('src'); return false }
    setA()
    a.onerror = () => { if (setA()) a.load() }
    v.addEventListener('play', () => { if (a.src) { a.currentTime = v.currentTime; a.play().catch(() => {}) } })
    v.addEventListener('pause', () => { try { a.pause() } catch {} })
    v.addEventListener('seeked', () => { try { a.currentTime = v.currentTime } catch {} })
    v.addEventListener('volumechange', () => { a.volume = v.volume; a.muted = v.muted })
  }
  const close = () => {
    clearInterval(wt)
    try { v && v.pause(); a && a.pause() } catch {}
    flushTev()
    o.classList.remove('on'); setTimeout(() => o.remove(), 200)
  }
  qs('.xb', o).onclick = close
  qs('[data-vsh]', o).onclick = () => share((x.title || 'Video').slice(0, 80), x.url)
  o.onclick = (e) => { if (e.target === o) close() }
}
$('trendchips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tc]'); if (!c) return
  trendCat = c.dataset.tc
  loadTrend(true)
})

// ============ Umumiy lenta (postlar) + OFLAYN KESHI ============
// Kesh: oxirgi postlar localStorage'da — lenta HAR SAFAR darhol ko'rinadi (internet sekin/o'chiq bo'lsa ham),
// yangilari fonda tortilib birlashtiriladi — yuklash uzilishi foydalanuvchiga sezilmaydi.
const feedCacheKey = () => 'g50_feed_' + feedMode
function feedCacheSave() {
  try { localStorage.setItem(feedCacheKey(), JSON.stringify({ t: Date.now(), posts: feedPosts.slice(0, 30).map((p) => ({ ...p, meta: p.meta || null })) })) } catch {}
}
function feedCacheGet() {
  try {
    const d = JSON.parse(localStorage.getItem(feedCacheKey()) || '')
    if (d && Array.isArray(d.posts) && d.posts.length && Date.now() - d.t < 7 * 864e5) return d.posts
  } catch {}
  return null
}
async function loadFeed(reset) {
  if (feedBusy) return
  const fromCache = !!reset
  if (reset) {
    feedEnd = false
    if (!feedPosts.length) {
      const c = feedCacheGet()
      if (c) { feedPosts = c.slice(); renderFeed() }
    }
    if (!feedPosts.length) $('feedlist').innerHTML = '<div class="spin"></div>'
  }
  if (feedEnd) return
  feedBusy = true
  try {
    // reset'da doim eng YANGI sahifa tortiladi (kesh bo'lsa birlashtiriladi) — yangi postlar yo'qolmaydi
    const before = fromCache ? 0 : (feedPosts.length ? feedPosts[feedPosts.length - 1].id : 0)
    const r = await api(`/feed?mode=${feedMode}${before ? '&before=' + before : ''}`)
    const list = Array.isArray(r) ? r : r.posts || []
    for (const p of list) if (p.media_id && p.meta) P2P.note(String(p.media_id), { chat: 0, ...p.meta })
    if (fromCache) {
      const seen = new Set(list.map((x) => x.id))
      feedPosts = list.concat(feedPosts.filter((x) => !seen.has(x.id)))
    } else {
      const seen = new Set(feedPosts.map((x) => x.id))
      feedPosts.push(...list.filter((x) => !seen.has(x.id)))
    }
    if (list.length < 20) feedEnd = true
    renderFeed()
    feedCacheSave()
  } catch (e) {
    if (!feedPosts.length) $('feedlist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`
    // Keshdan ko'rsatilgan bo'lsa — xato jim o'tkaziladi (kontent turadi, uzilish sezilmaydi)
  } finally { feedBusy = false }
}
// ---------------- Reels: vertikal video lenta (alohida dock bo'limi) ----------------
function reelHTML(p) {
  const who = p.chat ? `<div class="rw" data-who="c${p.chat.id}">${avHTML(p.chat, 38, { chat: true })}<b>${esc(p.chat.title)}</b></div>`
    : `<div class="rw" data-who="u${p.author?.id || 0}">${avHTML(p.author, 38)}<b>${esc(uname(p.author))}</b></div>`
  return `<div class="reel" data-reel="${p.id}">
    <video data-media="${p.media_id}" loop playsinline preload="metadata" muted></video>
    <div class="rshade"></div>
    <div class="rbot">
      ${who}${p.views ? `<small class="rviews">👁 ${p.views}</small>` : ''}
      ${p.text_body ? `<div class="rtx">${linkify(p.text_body)}</div>` : ''}
    </div>
    <div class="racts">
      <button data-like class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'}<i>${p.like_count || 0}</i></button>
      <button data-cmt>💬<i data-scc="${p.id}">${p.comment_count || 0}</i></button>
      <button data-psh>↗️<i>Ulashish</i></button>
      ${p.can_delete ? '<button data-pdel>🗑<i>O‘chirish</i></button>' : ''}
    </div>
    <div class="rtap"></div>
  </div>`
}
// Reels holati (alohida bo'lim): reelPosts + kesh (oflaynda ham ochiladi)
let reelPosts = [], reelsEnd = false, reelsBusy = false
const RKEY = 'g50_reels_c4' // v4: eski keshdagi o'chirilgan test/Minecraft reel'lar QATIY bekor (shikoyat: "boshidagi 2 ta minecraft hech yo'qolmadi")
function reelsCacheSave() {
  try { localStorage.setItem(RKEY, JSON.stringify({ t: Date.now(), posts: reelPosts.slice(0, 30).map((p) => ({ ...p, meta: p.meta || null })) })) } catch {}
}
function reelsCacheGet() {
  try {
    const d = JSON.parse(localStorage.getItem(RKEY) || '')
    if (d && Array.isArray(d.posts) && d.posts.length && Date.now() - d.t < 7 * 864e5) return d.posts
  } catch {}
  return null
}
async function loadReels(reset) {
  if (reelsBusy) return
  const fromCache = !!reset
  if (reset) {
    reelsEnd = false
    if (!reelPosts.length) {
      const c = reelsCacheGet()
      if (c) { reelPosts = c.slice(); renderReels() }
    }
    if (!reelPosts.length) $('reelslist').innerHTML = '<div class="spin"></div>'
  }
  if (reelsEnd) return
  reelsBusy = true
  try {
    const before = fromCache ? 0 : (reelPosts.length ? reelPosts[reelPosts.length - 1].id : 0)
    const r = await api('/reels' + (before ? '?before=' + before : ''))
    // MINECRAFT FILTR: sarlavhasida/matinida Minecraft eslatuvchi postlar umuman olmaydi (ID-blok ham)
    const list = (Array.isArray(r) ? r : r.posts || []).filter((p) => !shBadT(p.text_body) && !shBadT(p.title))
    for (const p of list) if (p.media_id && p.meta) P2P.note(String(p.media_id), { chat: 0, ...p.meta })
    if (fromCache) {
      const seen = new Set(list.map((x) => x.id))
      reelPosts = list.concat(reelPosts.filter((x) => !seen.has(x.id)))
    } else {
      const seen = new Set(reelPosts.map((x) => x.id))
      reelPosts.push(...list.filter((x) => !seen.has(x.id)))
    }
    if (list.length < 10) reelsEnd = true
    // Pagination: yangi videolar faqat PASTGA qo'shiladi (inkremental) — butun ro'yxatni
    // qayta qurish barcha videolarni qayta yuklaydi = sakrash + qotish (shikoyat sababi)
    renderReels(!fromCache)
    reelsCacheSave()
  } catch (e) {
    if (!reelPosts.length) $('reelslist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`
  } finally { reelsBusy = false }
}
// TASODIFIY KARTALAR OLIB TASHLANDI (foydalanuvchi tanlovi: "olib tashla — 50 Gram logotipini
// qo'y, moslab to'liq ko'rinsin"): Reels bo'limida endi FAQAT platform videolari turadi.
// Platform Reels 10 tadan kam bo'lsa — bo'sh o'rnida 50 Gram logotipi to'liq ko'rinadi.
function logoSlide() {
  return `<div class="reel rlogo"><img src="logo.png" alt="50 Gram"><div class="rl-b"><b>50 Gram</b><span>${reelPosts.length ? '🎬 Reels — vertikal video lenta' : 'Hali Reels yo‘q — ➕ tugmasi bilan birinchi videoni joylang'}</span></div></div>`
}
function renderReels(inc) {
  const box = $('reelslist')
  if (!box) return
  const rd = qs('.reels', box)
  const exist = qsa('.reel[data-reel]', box)
  const have = new Set(exist.map((el) => +el.dataset.reel))
  const fresh = reelPosts.filter((p) => !have.has(p.id))
  // INKREMENTAL: pagination yangi videolarni ro'yxat OXIRIGA qo'shadi — mavjud video
  // tugunlarga tegmaydi (qayta yuklanish/sakrash bo'lmaydi)
  if (inc && rd && exist.length && fresh.length && fresh.length < reelPosts.length) {
    let tail = 0
    for (let i = reelPosts.length - 1; i >= 0 && !have.has(reelPosts[i].id); i--) tail++
    if (tail === fresh.length) {
      // LOGO SLAYD OLDIGA QO'SHILADI (oxiridan emas) — yangi videolar logotip ostida qolmaydi
      const tp = document.createElement('template')
      tp.innerHTML = reelPosts.slice(-tail).map(reelHTML).join('')
      const lg = qs('.reel.rlogo', rd)
      if (lg) { if (reelPosts.length >= 10) lg.remove(); else rd.insertBefore(tp.content, lg) }
      else rd.appendChild(tp.content)
      const added = qsa('.reel[data-reel]', rd).slice(-tail)
      // VIDEO o'zi kuzatiladi (div emas!) — avval .reel div kuzatilgandi: callback'da div.play()
      // xato berardi → inkremental yuklangan videolar ijro/pauza BUZILGAN edi
      added.forEach((el) => { const v = qs('video', el); if (v) { v.preload = 'none'; reelsObserver && reelsObserver.observe(v) } })
      hydrate(rd)
      reelsHint(box)
      return
    }
  }
  // LOGO: platform Reels kam bo'lsa — tasodifiy rasmlar o'rnida 50 Gram logotipi to'liq ko'rinadi
  const logoHTML = reelPosts.length < 10 ? logoSlide() : ''
  box.innerHTML = (reelPosts.length || logoHTML)
    ? `<div class="reels">${reelPosts.map(reelHTML).join('')}${logoHTML}</div><div class="hint" id="reelshint" style="text-align:center;padding:12px"></div>`
    : `<div class="empty"><span class="big">🎬</span>Hali Reels yo‘q — <b>➕</b> tugmasi bilan birinchi videoni joylang!</div>`
  hydrate(box)
  if (reelsObserver) reelsObserver.disconnect()
  const rd2 = qs('.reels', box)
  if (rd2) qsa('.reel video', rd2).forEach((v, i) => { if (i > 2) v.preload = 'none' }) // birinchi 3 tadan keyingi — play bosilgach yuklanadi (tezlik)
  if (rd2 && 'IntersectionObserver' in window) {
    reelsObserver = new IntersectionObserver((es) => {
      for (const en of es) {
        const v = en.target
        if (en.isIntersecting && en.intersectionRatio > 0.6) {
          // Ovozli ijro bloklansa — ovozsiz davom (video qotib qolmasin)
          if (S.prefs.shauto) v.play().then(() => { v.muted = false }).catch(() => { v.muted = true; v.play().catch(() => {}) })
          // Bir vaqtda 2-3 video ovoz chiqarib yuborsa — sekinlashadi: qolganlarini pauza
          qsa('.reel video', box).forEach((o) => { if (o !== v && !o.paused) { o.muted = true; o.pause() } })
        } else { v.pause(); v.muted = true }
      }
    }, { root: qs('#t-reels'), threshold: [0, 0.6, 1] })
    qsa('.reel video', box).forEach((v) => reelsObserver.observe(v))
  }
  reelsHint(box)
}
function reelsHint(box) {
  const h = qs('#reelshint', box)
  if (h && reelPosts.length) h.textContent = reelsEnd ? 'Hammasi ko‘rildi ✨' : 'Pastga suring — yana videolar 🎬'
}
function postHTML(p) {
  const who = p.chat ? `${avHTML(p.chat, 40, { chat: true })}<div><b>${p.chat.type === 'channel' ? '📢 ' : ''}${esc(p.chat.title)}</b><small>${fmtAgo(p.created_at)}</small></div>` : `${avHTML(p.author, 40)}<div><b>${esc(uname(p.author))}</b><small>${fmtAgo(p.created_at)}</small></div>`
  const media = p.media_id ? (p.media_kind === 'video' ? `<video class="pm" data-media="${p.media_id}" controls playsinline preload="metadata"></video>` : `<img class="pm" data-media="${p.media_id}" data-pv alt="">`) : ''
  return `<div class="post" data-post="${p.id}"><div class="ph" data-who="${p.chat ? 'c' + p.chat.id : 'u' + (p.author?.id || 0)}">${who}${p.can_delete ? '<button class="ic" data-pdel>🗑</button>' : ''}</div>${p.text_body ? `<div class="pt">${linkify(p.text_body)}</div>` : ''}${media}<div class="pa"><button data-like class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'} ${p.like_count || 0}</button><button data-cmt>💬 <i data-scc="${p.id}">${p.comment_count || 0}</i></button><button data-psh>↗️ Ulashish</button></div></div>`
}
function renderFeed() {
  const box = $('feedlist')
  box.innerHTML = feedPosts.length ? feedPosts.map(postHTML).join('') + (feedEnd ? '<div class="hint" style="text-align:center">Hammasi ko‘rildi ✨</div>' : '<button class="btn gh" data-more>Yana yuklash</button>')
    : `<div class="empty"><span class="big">📰</span>${feedMode === 'subs' ? 'Obuna bo‘lgan kanallaringizda hali post yo‘q' : 'Hali postlar yo‘q. Birinchi bo‘lib yangilik yoki e’lon joylang!'}</div>`
  hydrate(box)
}
$('feedseg').onclick = (e) => { const d = e.target.closest('[data-m]'); if (!d) return; feedMode = d.dataset.m; qsa('#feedseg div').forEach((x) => x.classList.toggle('on', x === d)); $('b-post').classList.toggle('hide', feedMode === 'trend'); $('trendchips').classList.toggle('hide', feedMode !== 'trend'); feedMode === 'trend' ? loadTrend(true) : loadFeed(true) }
// --- Reels bo'limi: kliklar (like/izoh/ulashish/o'chirish/shorts) ---
$('reelslist').addEventListener('click', async (e) => {
  const reel = e.target.closest('[data-reel]')
  if (!reel) return
  const p = reelPosts.find((x) => x.id === +reel.dataset.reel); if (!p) return
  if (e.target.closest('[data-like]')) {
    try {
      const r = await post(`/posts/${p.id}/like`); p.liked = r.liked; p.like_count = r.like_count
      const b = qs('[data-like]', reel); b.className = p.liked ? 'on' : ''; b.innerHTML = `${p.liked ? '❤️' : '🤍'}<i>${p.like_count || 0}</i>`
      if (p.liked) { const f = document.createElement('span'); f.className = 'fly'; f.textContent = '❤️'; reel.appendChild(f); setTimeout(() => f.remove(), 1200); vibrate(10) }
    } catch (er) { toast('⚠️ ' + er.message) }
    return
  }
  if (e.target.closest('[data-cmt]')) return commentsSheet(p, null)
  if (e.target.closest('[data-psh]')) return share((p.text_body || '50 Gram Reels').slice(0, 100), location.origin + location.pathname)
  if (e.target.closest('[data-pdel]')) {
    if (!(await confirmBox('Video o‘chirilsinmi?', 'O‘chirish'))) return
    try { await del('/posts/' + p.id); if (p.media_id) Store.remove([String(p.media_id)]); reelPosts = reelPosts.filter((x) => x !== p); renderReels(); reelsCacheSave() } catch (er) { toast('⚠️ ' + er.message) }
    return
  }
  const w = e.target.closest('[data-who]')
  if (w) { const v = w.dataset.who; if (v[0] === 'u') openUser(+v.slice(1)); else { const c = S.chats.get(+v.slice(1)); c && c.joined !== false ? openChat(c.id) : chatPreview(p.chat) } ; return }
  // To'liq ekran Reels rejimi (TikTok uslubi) — tomosha darhol boshlanadi
  return shortsStart({ post: p, reelsOnly: true })
})
$('feedlist').addEventListener('click', async (e) => {
  if (feedMode === 'trend') {
    const tn = e.target.closest('[data-tn]')
    if (tn) { const x = trendItems.find((v) => v.id === tn.dataset.tn); if (x) openTrendNews(x) }
    const tv = e.target.closest('[data-tv]')
    if (tv) { const x = trendItems.find((v) => v.id === tv.dataset.tv); if (x) { if (x.kind === 'short') return shortsStart({ trend: x }); openTrendVideo(x) } }
    return
  }
  if (e.target.closest('[data-more]')) return loadFeed()
  const el = e.target.closest('[data-post]'); if (!el) return
  const p = feedPosts.find((x) => x.id === +el.dataset.post); if (!p) return
  if (e.target.closest('[data-like]')) {
    try { const r = await post(`/posts/${p.id}/like`); p.liked = r.liked; p.like_count = r.like_count; el.outerHTML = postHTML(p); hydrate($('feedlist')); if (r.liked) { const f = document.createElement('span'); f.className = 'fly'; f.textContent = '❤️'; el.appendChild(f); setTimeout(() => f.remove(), 1200); vibrate(10) } } catch (er) { toast('⚠️ ' + er.message) }
    return
  }
  if (e.target.closest('[data-cmt]')) return commentsSheet(p, el)
  if (e.target.closest('[data-psh]')) return share((p.text_body || '50 Gram').slice(0, 100), location.origin + location.pathname)
  if (e.target.closest('[data-pdel]')) {
    if (!(await confirmBox('Post o‘chirilsinmi?', 'O‘chirish'))) return
    try { await del('/posts/' + p.id); if (p.media_id) Store.remove([String(p.media_id)]); feedPosts = feedPosts.filter((x) => x !== p); renderFeed() } catch (er) { toast('⚠️ ' + er.message) }
    return
  }
  const pv = e.target.closest('[data-pv]'); if (pv && pv.src) return viewImage(pv.src)
  const w = e.target.closest('[data-who]')
  if (w) { const v = w.dataset.who; if (v[0] === 'u') openUser(+v.slice(1)); else { const c = S.chats.get(+v.slice(1)); c && c.joined !== false ? openChat(c.id) : chatPreview(p.chat) } }
})
$('t-feed').addEventListener('scroll', (e) => { const t = e.target; if (t.scrollHeight - t.scrollTop - t.clientHeight < 600) { if (feedMode === 'trend') loadTrend(); else loadFeed() } }, { passive: true })
$('t-reels').addEventListener('scroll', (e) => { const t = e.target; if (t.scrollHeight - t.scrollTop - t.clientHeight < 900) loadReels() }, { passive: true })
// --- Task 39: Telegram-uslubidagi izohlar — javob-lar, emoji-reaksiyalar, stiker izohlar ---
const CM_REACTS = ['❤️', '👍', '🔥', '😮', '😂', '🥰', '👏', '😢']
let cmPress = null, cmPick = null
function cmStickerHTML(s) {
  if (!s) return ''
  return s.indexOf('/') >= 0
    ? `<img class="cm-stk" src="stickers/${esc(s)}" alt="" loading="lazy">`
    : `<span class="cm-stk e">${esc(s)}</span>`
}
function cmChipHTML(k) {
  const rc = k.reacts || []
  const chips = rc.slice(0, 3).map((r) => `<button class="cm-chip ${r.mine ? 'on' : ''}" data-crk="${esc(r.emoji)}" data-crkc="${r.n}">${r.emoji} ${r.n > 99 ? '99+' : r.n}</button>`).join('')
  const tot = rc.reduce((a, x) => a + x.n, 0)
  return chips + (rc.length > 3 ? `<span class="cm-more">+${tot > 99 ? '99+' : tot}</span>` : '')
}
function cmNodeHTML(k, isReply, rootId) {
  const t = k.text_body ? `<div class="cm-tx">${linkify(k.text_body)}</div>` : ''
  const st = cmStickerHTML(k.sticker)
  const pend = k.pending ? '<span class="cm-pend">⏳</span>' : k.failed ? '<span class="cm-fail" data-cretry>⚠️ Qayta</span>' : ''
  const acts = `<div class="cm-act"><b data-crply="${k.id}">Javob berish</b>${k.mine ? `<b data-cdel="${k.id}">O‘chirish</b>` : ''}</div>`
  const replies = !isReply && k.replies && k.replies.length
    ? `<div class="cm-sub">${k.replies.map((r) => cmNodeHTML(r, true, k.id)).join('')}</div>` : ''
  return `<div class="cmt2 ${isReply ? 'rep' : ''}" data-cid="${k.id}" data-root="${rootId || k.id}">
    ${avHTML(k.user, isReply ? 26 : 36, { noStory: true })}
    <div class="cm-bw">
      <div class="cm-bub">${k.failed ? '<span class="cm-failb"></span>' : ''}<b>${esc(uname(k.user))}</b> <small class="mut">${fmtAgo(k.created_at)} ${pend}</small>${t}${st}
        <div class="cm-chips">${cmChipHTML(k)}</div>
      </div>
      ${acts}
      ${replies}
    </div>
  </div>`
}
async function commentsSheet(p, el) {
  let data = { roots: [], total: 0, emojis: CM_REACTS }
  let replyTo = null, sort = 'new', stkTab = ''
  const sh = sheet(h3('Izohlar <i class="cm-total" id="cm-n"></i>') + `
    <div class="cm-sort"><button data-cs="new" class="on">🕐 Yangi</button><button data-cs="top">🔥 Top</button></div>
    <div id="cm-l" class="cm-list"><div class="cmskel"><i></i><i></i><i></i><i></i></div></div>
    <div id="cm-rv" class="cm-rv" hidden></div>
    <div id="cm-stkp" class="cm-stkp" hidden></div>
    <div class="inrow cm-in">${avHTML(S.me, 32, { noStory: true })}<input class="inp" id="cm-i" maxlength="1000" placeholder="Izoh yozing…"><button class="ic cm-emoji" id="cm-stk" aria-label="Stiker">😊</button><button class="btn" id="cm-s" style="width:auto">➤</button></div>`)
  const list = qs('#cm-l', sh), input = qs('#cm-i', sh)
  const rootOf = (id) => data.roots.find((r) => r.id === id)
  const draw = () => {
    let roots = [...data.roots]
    if (sort === 'top') roots.sort((a, b) => (b.reacts || []).reduce((s, x) => s + x.n, 0) + (b.reply_count || 0) * 2 - (a.reacts || []).reduce((s, x) => s + x.n, 0) - (a.reply_count || 0) * 2)
    list.innerHTML = roots.map((k) => cmNodeHTML(k, false, k.id)).join('') || '<div class="empty">Birinchi izohni yozing — javoblar va ❤️ reaksiyalar bilan qiziqarli bo‘ladi</div>'
    qs('#cm-n', sh).textContent = data.total ? `· ${data.total}` : ''
    p.comment_count = data.total
  }
  const refreshRow = () => {
    p.comment_count = data.total
    if (el && el.isConnected) { el.outerHTML = postHTML(p); hydrate($('feedlist')) }
    else { // reels: to'liq qayta render'siz — faqat hisoblagichlar yangilanadi (sakramaslik uchun)
      try { qsa('[data-scc="' + p.id + '"]').forEach((c) => { c.textContent = p.comment_count || 0 }) } catch {}
    }
  }
  const setReply = (k) => {
    replyTo = k || null
    const rv = qs('#cm-rv', sh)
    if (!k) { rv.hidden = true; input.placeholder = 'Izoh yozing…'; return }
    rv.hidden = false
    rv.innerHTML = `<span class="cm-rvi">↩</span><div class="cm-rvt"><b>${esc(uname(k.user))}</b> ga javob — ${esc((k.text_body || 'stiker').slice(0, 46))}</div><button class="ic" id="cm-rvx">✕</button>`
    qs('#cm-rvx', rv).onclick = () => setReply(null)
    input.placeholder = `${uname(k.user).split(' ')[0]} ga javob…`
    input.focus()
  }
  const scrollEnd = () => requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
  const send = async (text, sticker) => {
    text = (text || '').trim(); if (!text && !sticker) return
    const root = replyTo ? (replyTo.parent_id && rootOf(replyTo.parent_id) ? rootOf(replyTo.parent_id) : replyTo) : null
    const tmp = { id: -Date.now(), parent_id: root ? root.id : 0, text_body: text, sticker: sticker || '', created_at: Date.now(), user: S.me, mine: true, reacts: [], replies: [], reply_count: 0, pending: 1 }
    if (root) { root.replies.push(tmp); root.reply_count = root.replies.length } else data.roots.push(tmp)
    data.total++; setReply(null); draw(); scrollEnd(); refreshRow()
    try {
      const k = await post(`/posts/${p.id}/comments`, { text_body: text, parent_id: tmp.parent_id, sticker: sticker || '' })
      Object.assign(tmp, k, { pending: 0 })
      draw()
    } catch (er) { tmp.pending = 0; tmp.failed = 1; draw(); toast('⚠️ ' + er.message) }
  }
  const sendText = () => { const t = input.value.trim(); if (!t) return; input.value = ''; send(t) }
  qs('#cm-s', sh).onclick = sendText
  input.onkeydown = (e) => e.key === 'Enter' && sendText()
  // Reaksiya (optimistik toggle)
  const react = async (cid, emoji) => {
    const node = (function find(nodes) { for (const n of nodes) { if (n.id == cid) return n; const r = find(n.replies || []); if (r) return r } return null })(data.roots)
    if (!node) return
    node.reacts = node.reacts || []
    const cur = node.reacts.find((x) => x.emoji === emoji)
    if (cur) { cur.mine = !cur.mine; cur.n += cur.mine ? 1 : -1; if (cur.n <= 0) node.reacts = node.reacts.filter((x) => x !== cur) }
    else node.reacts.push({ emoji, n: 1, mine: true })
    draw()
    try { const r = await post(`/comments/${cid}/react`, { emoji }); const c2 = (node.reacts || []).find((x) => x.emoji === emoji); if (c2) { c2.n = r.n; if (!r.on) node.reacts = node.reacts.filter((x) => x !== c2) } draw() } catch {}
  }
  // O'chirish
  const removeNode = async (cid) => {
    try {
      await api(`/comments/${cid}`, { method: 'DELETE' })
      const root = rootOf(+cid)
      if (root) data.roots = data.roots.filter((x) => x.id !== +cid)
      else for (const r of data.roots) { const before = r.replies.length; r.replies = r.replies.filter((x) => x.id !== +cid); if (r.replies.length !== before) { r.reply_count = r.replies.length; data.total -= before - r.replies.length } }
      if (root) data.total -= 1 + (root.replies ? root.replies.length : 0)
      draw(); refreshRow(); toast('Izoh o‘chirildi')
    } catch (e) { toast('⚠️ ' + e.message) }
  }
  // YUKLASH — avval kesh (zudlik), so'ng tarmoq
  const cacheKey = 'g50_cmts_' + p.id
  try { const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); if (c && c.roots) { data = c; draw() } } catch {}
  try {
    const r = await api(`/posts/${p.id}/comments`)
    if (r && r.roots) { data = r; try { sessionStorage.setItem(cacheKey, JSON.stringify({ roots: data.roots, total: data.total })) } catch {} }
    draw(); scrollEnd()
  } catch (e) { if (!data.roots.length) list.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>` }
  // Saralash
  qsa('[data-cs]', sh).forEach((b) => b.onclick = () => { sort = b.dataset.cs; qsa('[data-cs]', sh).forEach((x) => x.classList.toggle('on', x === b)); draw(); scrollEnd() })
  // Ro'yxat hodisalari (delegatsiya)
  let lastTap = 0, lastTapId = 0
  list.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-crk]')
    if (chip) return react(+chip.closest('.cmt2').dataset.cid, chip.dataset.crk)
    const rp = e.target.closest('[data-crply]')
    if (rp) { const node = (function f(ns) { for (const n of ns) { if (n.id == rp.dataset.crply) return n; const r = f(n.replies || []); if (r) return r } return null })(data.roots); return setReply(node) }
    const dl = e.target.closest('[data-cdel]')
    if (dl) return removeNode(+dl.dataset.cdel)
    const retry = e.target.closest('[data-cretry]')
    if (retry) { const b = retry.closest('.cmt2'); return removeNode(+b.dataset.cid) }
    const bub = e.target.closest('.cm-bub')
    if (bub) {
      const cid = +bub.closest('.cmt2').dataset.cid, t = Date.now()
      if (t - lastTap < 350 && lastTapId === cid) { lastTap = 0; return react(cid, '❤️') } // ikki bosish = ❤️
      lastTap = t; lastTapId = cid
    }
  })
  // UZUN BOSISH — reaksiyalar tasmasi (stiker-smaylik baholash)
  const closePick = () => { if (cmPick) { cmPick.remove(); cmPick = null } if (cmPress) { clearTimeout(cmPress.t); cmPress = null } }
  const openPick = (cid) => {
    closePick()
    const bub = list.querySelector(`.cmt2[data-cid="${cid}"] .cm-bub`); if (!bub) return
    const r = bub.getBoundingClientRect()
    const pk = document.createElement('div'); pk.className = 'cm-pick'
    pk.innerHTML = CM_REACTS.map((x) => `<button data-pk="${x}">${x}</button>`).join('') + `<button data-pkdel class="del">🗑</button>`
    document.body.appendChild(pk)
    const pw = Math.min(320, innerWidth - 24)
    pk.style.left = Math.max(12, Math.min(innerWidth - pw - 12, r.left + r.width / 2 - pw / 2)) + 'px'
    pk.style.top = Math.max(70, r.top - 58) + 'px'
    cmPick = pk
    pk.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pk]')
      if (b) { react(cid, b.dataset.pk); closePick() } else if (ev.target.closest('[data-pkdel]')) { removeNode(cid); closePick() }
    })
    setTimeout(() => document.addEventListener('click', closePick, { once: true }), 50)
    list.addEventListener('scroll', closePick, { once: true, passive: true })
  }
  list.addEventListener('touchstart', (e) => {
    const bub = e.target.closest('.cmt2'); if (!bub || e.target.closest('button,img')) return
    const cid = +bub.dataset.cid
    cmPress = { t: setTimeout(() => { try { navigator.vibrate && navigator.vibrate(12) } catch {}; openPick(cid) }, 420) }
  }, { passive: true })
  ;['touchend', 'touchmove', 'touchcancel'].forEach((ev) => list.addEventListener(ev, () => { if (cmPress) { clearTimeout(cmPress.t); cmPress = null } }, { passive: true }))
  list.addEventListener('contextmenu', (e) => { const b = e.target.closest('.cmt2'); if (b) { e.preventDefault(); openPick(+b.dataset.cid) } })
  // STIKER IZOHLAR — paketlar tasmasi
  const stkp = qs('#cm-stkp', sh)
  qs('#cm-stk', sh).onclick = () => {
    stkp.hidden = !stkp.hidden
    if (stkp.hidden) return
    const rec = JSON.parse(localStorage.getItem(STICKER_RECENT_KEY) || '[]')
    const packs = STICKER_PACKS.map((pk) => ({ ...pk }))
    stkp.innerHTML = `<div class="pk-packs">${packs.map((x) => `<button data-pkp="${x.id}" class="${x.id === (stkTab || packs[0].id) ? 'on' : ''}" style="--pkc:${x.c}"><i>${x.icon}</i><span>${esc(x.name)}</span></button>`).join('')}</div>`
      + (rec.length ? `<div class="stkg imgs sm">${rec.map((s) => `<div data-sk="${esc(s)}"><img src="stickers/${esc(s)}" alt="" loading="lazy"></div>`).join('')}</div>` : '')
      + (() => { const pk = packs.find((x) => x.id === (stkTab || packs[0].id)) || packs[0]; return `<div class="stkg imgs sm">${pk.items.map((s) => `<div data-sk="${esc(s)}"><img src="stickers/${esc(s)}" alt="" loading="lazy"></div>`).join('')}</div>` })()
    qsa('[data-pkp]', stkp).forEach((b) => b.onclick = () => { stkTab = b.dataset.pkp; qs('#cm-stk', sh).click(); qs('#cm-stk', sh).click() })
    qsa('[data-sk]', stkp).forEach((d) => d.onclick = () => { stkp.hidden = true; send('', d.dataset.sk) })
  }
  sh.addEventListener('click', (e) => { if (e.target === sh) closePick() })
  setTimeout(() => input.focus(), 250)
}
// Yangi post / e'lon — kanal boshqaruvidan ham ochiladi (preChatId tanlangan bo'ladi)
function postSheet(preChatId = 0) {
  const mine = [...S.chats.values()].filter((c) => c.type === 'channel' && isAdmC(c))
  let file = null
  const sh = sheet(h3('Yangi post') + `<label class="mut">Qayerga</label><select class="inp" id="np-w"><option value="0">👤 Mening lentam (shaxsiy)</option>${mine.map((c) => `<option value="${c.id}" ${c.id === preChatId ? 'selected' : ''}>📢 ${esc(c.title)}</option>`).join('')}</select>
    <textarea class="inp" id="np-t" rows="5" maxlength="3000" placeholder="Yangilik, e’lon yoki reklama matni…"></textarea>
    <div id="np-pv"></div><button class="btn gh" id="np-m">🖼 Rasm yoki video qo‘shish</button><button class="btn big" id="np-s">Joylash</button>`)
  qs('#np-m', sh).onclick = async () => {
    file = await pickFile('image/*,video/*'); if (!file) return
    const u = URL.createObjectURL(file)
    qs('#np-pv', sh).innerHTML = file.type.startsWith('video/') ? `<video src="${u}" style="width:100%;border-radius:12px" controls></video>` : `<img src="${u}" style="width:100%;border-radius:12px">`
  }
  qs('#np-s', sh).onclick = async () => {
    const text = qs('#np-t', sh).value.trim()
    if (!text && !file) return toast('Matn yoki rasm qo‘shing')
    const btn = qs('#np-s', sh); btn.disabled = true; btn.textContent = '⏳ Joylanmoqda…'
    try {
      let media_id = null, media_kind = null, meta = null
      if (file) { const video = file.type.startsWith('video/'); const blob = video ? file : await resizeImage(file, 1600, 0.85); media_id = await upload(blob, file.name); media_kind = video ? 'video' : 'photo'; meta = mediaInfo(media_id) }
      const p = await post('/posts', { text_body: text, media_id, media_kind, meta, chat_id: +qs('#np-w', sh).value })
      closeSheet(sh)
      if (feedMode === 'all' || feedMode === 'subs') { feedPosts.unshift(p); renderFeed(); feedCacheSave() }
      toast('✅ Joylandi — video bo‘lsa Reels bo‘limida ko‘rinadi 🎬')
    } catch (e) { toast('⚠️ ' + e.message); btn.disabled = false; btn.textContent = 'Joylash' }
  }
}
$('b-post').onclick = () => postSheet(0)

// ---------------- 📹 REELS JOYLASH ----------------
function reelSheet() {
  let file = null
  const sh = sheet(h3('🎬 Reels joylash') + `
    <div id="rl-pv" class="rl-pv" data-rpick><span class="rl-ic">📹</span><b>Video tanlash</b><small>Vertikal video — maks 30 MB</small></div>
    <textarea class="inp" id="rl-t" rows="2" maxlength="1000" placeholder="Izoh… (ixtiyoriy)"></textarea>
    <button class="btn big" id="rl-s" disabled>⬆️ Joylash</button>`)
  const pick = qs('#rl-pv', sh)
  pick.onclick = async () => {
    file = await pickFile('video/*'); if (!file) return
    pick.innerHTML = `<video src="${URL.createObjectURL(file)}" style="width:100%;max-height:44vh;border-radius:14px;background:#000;display:block" muted playsinline loop autoplay></video>`
    qs('#rl-s', sh).disabled = false
  }
  qs('#rl-s', sh).onclick = async () => {
    if (!file) return
    const btn = qs('#rl-s', sh); btn.disabled = true
    try {
      const id = await upload(file, file.name || 'reels.mp4', (p) => { btn.textContent = '⏳ Yuklanmoqda ' + Math.round(p * 100) + '%' })
      btn.textContent = '⏳ Joylanmoqda…'
      const p = await post('/posts', { text_body: qs('#rl-t', sh).value.trim(), media_id: id, media_kind: 'video', meta: mediaInfo(id) })
      closeSheet(sh)
      const ex = reelPosts.findIndex((x) => x.id === p.id)
      if (ex < 0) reelPosts.unshift(p)
      reelsEnd = false
      renderReels(); reelsCacheSave()
      tabGo('t-reels')
      toast('✅ Reels joylandi 🎬')
    } catch (e) { toast('⚠️ ' + e.message); btn.disabled = false; btn.textContent = '⬆️ Joylash' }
  }
}
$('b-rupload').onclick = () => reelSheet()

// ---------------- Kontaktlar ----------------
async function loadContactsQuiet() {
  try { S.contacts = await api('/contacts'); for (const k of S.contacts) if (k.user) S.users.set(k.user.id, k.user) } catch {}
}
async function loadContacts() {
  if (!S.contacts.length) $('contactlist').innerHTML = '<div class="spin"></div>'
  await loadContactsQuiet()
  renderContacts()
}
function renderContacts() {
  const q = ($('cq').value || '').trim().toLowerCase()
  const list = S.contacts.filter((k) => !q || ((k.first_name || '') + ' ' + (k.last_name || '')).toLowerCase().includes(q) || (k.phone || '').includes(q.replace(/\D/g, '') || '~'))
  const on = list.filter((k) => k.user), off = list.filter((k) => !k.user)
  const liveMap = new Map((S.lives || []).map((l) => [l.user.id, l]))
  const it = (k) => { const lv = k.user ? liveMap.get(k.user.id) : null; return `<div class="item" data-k="${esc(k.phone)}">${avHTML(k.user || { id: 0, first_name: k.first_name, last_name: k.last_name }, 46, { dot: true, live: !!lv, liveId: lv?.id })}<div class="mid"><div class="t1"><b>${esc(((k.first_name || '') + ' ' + (k.last_name || '')).trim())}</b>${lv ? '<span class="lvt">🔴 Efir</span>' : ''}</div><div class="t2"><span>${k.user ? esc(lastSeen(k.user)) : esc(k.phone) + ' · 50 Gram’da emas'}</span></div></div></div>` }
  $('contactlist').innerHTML = (on.length ? `<div class="sec">50 Gram’dagilar (${on.length})</div>${on.map(it).join('')}` : '') + (off.length ? `<div class="sec">Taklif qiling</div>${off.map(it).join('')}` : '') +
    (!list.length ? `<div class="empty"><span class="big">👥</span>${q ? 'Topilmadi' : 'Kontaktlar yo‘q. ➕ tugmasi bilan raqam qo‘shing yoki telefon kontaktlarini import qiling.'}</div>` : '')
  hydrate($('contactlist'))
}
$('cq').oninput = renderContacts
$('contactlist').addEventListener('click', (e) => {
  if (e.target.closest('[data-story]')) return
  const it = e.target.closest('[data-k]'); if (!it) return
  const k = S.contacts.find((x) => x.phone === it.dataset.k); if (!k) return
  if (k.user) return openDirectWith(k.user.id)
  const sh = sheet(h3(((k.first_name || '') + ' ' + (k.last_name || '')).trim()) + `<div class="hint">${esc(k.phone)} hali 50 Gram’dan foydalanmaydi.</div><div class="rows"><div data-a="inv"><span class="ri">📨</span><div class="rt">Taklif yuborish</div></div><div data-a="edit"><span class="ri">✏️</span><div class="rt">Tahrirlash</div></div><div data-a="del"><span class="ri">🗑</span><div class="rt red">O‘chirish</div></div></div>`)
  sh.onclick = async (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return
    closeSheet(sh)
    if (a === 'inv') share('50 Gram — tezkor o‘zbek messenjeri. Qo‘shiling!', location.origin + location.pathname)
    if (a === 'edit') contactForm(k)
    if (a === 'del') tryDo(async () => { await del('/contacts/' + encodeURIComponent(k.phone)); S.contacts = S.contacts.filter((x) => x !== k); renderContacts() }, 'O‘chirildi')
  }
})
function contactForm(k = {}) {
  const sh = sheet(h3(k.phone ? 'Kontakt' : 'Yangi kontakt') + `<input class="inp" id="cf-p" type="tel" placeholder="+998 90 123 45 67" value="${esc(k.phone || '+998')}"><input class="inp" id="cf-f" maxlength="64" placeholder="Ism" value="${esc(k.first_name || '')}"><input class="inp" id="cf-l" maxlength="64" placeholder="Familiya (ixtiyoriy)" value="${esc(k.last_name || '')}"><button class="btn big" id="cf-s">Saqlash</button>`)
  qs('#cf-s', sh).onclick = async () => {
    try {
      const r = await post('/contacts', { phone: qs('#cf-p', sh).value, first_name: qs('#cf-f', sh).value.trim(), last_name: qs('#cf-l', sh).value.trim() })
      S.contacts = [...S.contacts.filter((x) => x.phone !== r.phone), r].sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''))
      if (r.user) S.users.set(r.user.id, r.user)
      closeSheet(sh)
      toast(r.user ? '✅ Saqlandi — endi xabar yozishingiz mumkin' : '✅ Saqlandi (u hali 50 Gram’da emas)')
      if (S.tab === 't-contacts') renderContacts()
      if (r.user && (await confirmBox(`${r.first_name} bilan suhbat ochilsinmi?`, 'Ochish', false))) openDirectWith(r.user.id)
    } catch (e) { toast('⚠️ ' + e.message) }
  }
}
$('b-cadd').onclick = () => contactForm({})
$('b-cimport').onclick = async () => {
  if (!('contacts' in navigator && 'select' in navigator.contacts)) return toast('Telefon kontaktlarini import qilish faqat Android Chrome’da ishlaydi. Raqamni ➕ orqali qo‘shing.', 4000)
  try {
    const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true })
    let n = 0
    for (const p of picked) {
      const tel = (p.tel || [])[0]; if (!tel) continue
      const [first, ...rest] = String((p.name || [])[0] || tel).trim().split(/\s+/)
      try { await post('/contacts', { phone: tel, first_name: first || tel, last_name: rest.join(' ') }); n++ } catch {}
    }
    toast(`✅ ${n} ta kontakt qo‘shildi`)
    loadContacts()
  } catch {}
}

// ============ SHORTS: TikTok-uslubida to'liq ekran vertikal rejim ============
// Platform Reels va trend Shorts vertikal ko'rish rejimida.
// BIRINCHI ochilish OVOZLI (foydalanuvchi: "mushuk ovozi yo'q reels juda ko'p" — jim ochilish
// asosiy shikoyat edi). Foydalanuvchi 🔊 bilan o'zi o'chirsa — tanlovi xotirada qoladi.
// Autoplay siyosati bloklasa — har video o'zi ovozsiz fallback qiladi (xavfsiz).
let shMuted = localStorage.getItem('g50_shmute') === '1'
let shMode = 'trend' // 'reels' — faqat platform Reels · 'trend' — internet Shorts
let shList = [], shWrap = null, shKeyH = null, shWtTimer = null
let shPostsEnd = false, shTrPage = 0, shBusyMore = false, shLastTap = 0, shTapTimer = null, shFailStreak = 0, shDry = 0

// NO-REPEAT ALGORITM (foydalanuvchi 5 marta yozgan shikoyat: "bir ko'rilgan reel qaytib keladi"):
// har ko'rilgan slayd 2.5s'dan keyin qurilmaga YOZILADI (g50_shseen_v1) va keyingi
// sessiyalarda QAYTA ko'rsatilmaydi. Hovuz batamom ko'rilgandagina yangi tsikl boshlanadi —
// lenta hech qachon bo'sh qolmaydi (TikTok ham shunday qiladi).
const SHSEEN_KEY = 'g50_shseen_v1'
let shSeen = new Map()
let shBad = new Set() // bu sessiyada ISHLAMAGAN videolar (qora ekran/ovozsiz) — lenta qaytib ko'rsatmasin (foydalanuvchi talabi)
try { const a = JSON.parse(localStorage.getItem(SHSEEN_KEY) || '[]'); if (Array.isArray(a)) for (const [k, t] of a) shSeen.set(k, t) } catch {}
let shSeenSaveT = 0
function shSeenSave() {
  try {
    clearTimeout(shSeenSaveT)
    shSeenSaveT = setTimeout(() => {
      const a = [...shSeen].sort((x, y) => y[1] - x[1]).slice(0, 600) // eng oxirgi 600 ta — xotira cheklangan
      shSeen = new Map(a)
      localStorage.setItem(SHSEEN_KEY, JSON.stringify(a))
    }, 400)
  } catch {}
}
// Yagona kalit: post id yoki trend id (shAppend dedupe bilan BIR XIL — ikki tizim bir-birini tushunadi)
const shKey = (it) => it.t === 'post' ? 'p' + it.p.id : 'x' + (it.x.id || it.x.yt || it.x.embed || it.x.mp4 || it.x.url || '')
const shMarkSeen = (it) => { try { shSeen.set(shKey(it), Date.now()); shSeenSave() } catch {} }

// Minecraft shikoyati + manba id'si yagona joyda hal qilinadi (har kirishda qayta tekshiriladi)
const shNormPosts = (list) => (Array.isArray(list) ? list : []).filter((p) => p && p.media_kind === 'video' && !shBadT(p.text_body)).map((p) => ({ t: 'post', p }))
// LIVE efirlar chiqariladi — ular qotib sekin ishlaydi (chet el jonli efirlari foydalanuvchi shikoyati)
// MINECRAFT QATIY FILTR: foydalanuvchi "tagi bilan o'chirib yo'q qilib tashla" — hech qanday yo'l bilan kirmasin
const shNormTrend = (list) => (Array.isArray(list) ? list : []).filter((x) => x && (x.kind === 'short' || x.kind === 'video') && !x.live && !shBadT(x.title) && !shBadV(x)).map((x) => { if (!x.id) x.id = shTrendId(x); return { t: 'trend', x } })

// YouTube player (nocookie — engilroq, O'zbekistonda ishonchli) + enablejsapi (postMessage boshqaruvi — reload'siz pauza/play)
// MUHIM: iframe HAR DOIM mute=1 bilan yuklanadi (preload qilingan keyingi video FONDA OVOZLI
// o'ynab begona ovoz berardi — shikoyat). Ovoz faqat FAOL slaydga postMessage'unMute bilan beriladi.
function shYTURL(id) {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&loop=1&playlist=${id}&mute=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
}
function shYTpost(f, func) { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*') } catch {} }

function shBindFrame(f) {
  const slide = f.closest('.sh-slide')
  if (!slide) return
  f.addEventListener('load', () => {
    slide.dataset.ok = '1'
    const l = qs('.sh-load', slide); if (l) l.style.display = 'none'
    // YT PLAYER HANDSHAKE: enablejsapi'li player ota-oynadan "listening" so'rovisiz HECH QANDAY
    // postMessage yubormaydi. Handshake yuborilmasa quyidagi kuzatuv O'YNAYOTGAN videoni ham
    // "o'ynamayapti" deb XATO topardi — har ~9 sekundda keyingi slaydga avto-sakrash (shikoyat).
    if (f.dataset.shyt) {
      const say = (m, ms) => setTimeout(() => { try { if (f.isConnected) f.contentWindow.postMessage(JSON.stringify(m), '*') } catch {} }, ms)
      say({ event: 'listening' }, 300)
      say({ event: 'listening' }, 2000) // sekin tarmoqda player kech tayyor bo'ladi — qayta yuboriladi
      say({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }, 700)
      // AKTIV SLAYD OVOZI: player mute=1 bilan ochiladi (autoplay siyosati) — faqat FAOL slayd
      // tayyor bo'lgach ovoz oladi. AVVAL bu FAQAT preload'li slaydlarga yuborilardi — birinchi/
      // jump qilingan yangi slayd JIM qolardi ("mushuk ovozi yo'q" shikoyatining ildizi).
      // YUBORISH PAYTIDA ham faollik tekshiriladi — fon slaydlari ovoz olmaydi (begona ovoz yo'q).
      if (!shMuted) setTimeout(() => {
        try {
          if (f.isConnected && slide.isConnected && slide.dataset.on === '1') {
            f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*')
            f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*')
          }
        } catch {}
      }, 1400)
    }
  }, { once: true })
}
// YT ijro kuzatuvi: player postMessage yubormasa (bot-devori/bloklangan video) — avto-keyingi slayd
// QATIY DETEKTOR: faqat HAQIQIY o'ynash holati hisoblanadi. Player 'listening'ga javoban yuboradigan
// boshlang'ich infoDelivery (playerState:0/-1) SOXTA 'playing' berib, qora ekran 10-15s qolibardi
// (shikoyat: "2 ta ko'rsatib 3 chisi qora ekran"). Endi playerState===1 yoki currentTime>0.5 bo'lsagina.
function shYTMsgBind(w) {
  if (w._shMsg) return
  w._shMsg = (e) => {
    try {
      let d = e.data
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
      if (!d || typeof d !== 'object') return
      const inf = d.info
      // YT XATO HODISASI: video o'chirilgan/maxfiy (100), embed taqiqlangan (101/150),
      // pleyer xatosi (2/5) — bunday video HECH QACHON o'ynamaydi. Kuta ko'rmay slayd BUTUNLAY
      // o'chiriiladi (qora ekran lentaDA QOLMAYDI — foydalanuvchi talabi). Avval bunday embedlar
      // 15-20s qora turib keyingina watchdog tomonidan o'chirilardi.
      if (d.event === 'onError') {
        const ec = typeof inf === 'number' ? inf : +((inf && (inf.data ?? inf.errorCode ?? inf.code)) || 0)
        if (ec === 2 || ec === 5 || ec === 100 || ec === 101 || ec === 150) {
          const fr = qsa('iframe[data-shyt]', w)
          for (const f of fr) { try { if (f.contentWindow === e.source) { shDropSlide(f.closest('.sh-slide'), 'err'); return } } catch {} }
        }
        return
      }
      const isPlay = (d.event === 'onStateChange' && (inf === 1 || inf?.state === 1 || inf?.playerState === 1))
        || (d.event === 'infoDelivery' && (inf?.playerState === 1 || +inf?.currentTime > 0.5))
        || (d.event === 'onVideoProgress' && +inf?.currentTime > 0.5)
      if (!isPlay) return
      const fr = qsa('iframe[data-shyt]', w)
      for (const f of fr) { try { if (f.contentWindow === e.source) { f.closest('.sh-slide').dataset.playing = '1'; return } } catch {} }
    } catch {}
  }
  window.addEventListener('message', w._shMsg)
}

function shSlideHTML(it, i) {
  if (it.t === 'post') {
    const p = it.p
    const who = p.chat ? `<div class="sh-who" data-shwho="c${p.chat.id}">${avHTML(p.chat, 38, { chat: true })}<b>${esc(p.chat.title)}</b></div>`
      : `<div class="sh-who" data-shwho="u${p.author?.id || 0}">${avHTML(p.author, 38)}<b>${esc(uname(p.author))}</b></div>`
    return `<div class="sh-slide paused" data-shi="${i}">
      <video data-media="${p.media_id}" loop playsinline preload="metadata"></video>
      <div class="sh-load"><i></i><i></i><i></i></div>
      <div class="sh-failbox">⏳ Video yuklanmadi — internet sekin bo'lishi mumkin<br><button data-shretry>↻ Qayta urinish</button> · Pastga suring — keyingi video</div>
      <div class="sh-shade"></div>
      <div class="sh-bot">${who}${p.views ? `<small class="sh-vw">👁 ${p.views}</small>` : ''}${p.text_body ? `<div class="sh-cap">${linkify(p.text_body)}</div>` : ''}</div>
      <div class="sh-acts">
        <button data-slike class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'}<i>${p.like_count || 0}</i></button>
        <button data-scmt>💬<i data-scc="${p.id}">${p.comment_count || 0}</i></button>
        <button data-ssh>↗️</button>
        ${p.can_delete ? '<button data-sdel>🗑</button>' : ''}
      </div>
      <div class="sh-prog"><i></i></div>
      <div class="sh-play">▶</div>
    </div>`
  }
  const x = it.x
  let pl = ''
  const bg = x.image ? ` style="background:#07070c url('${esc(x.image)}') center/cover no-repeat"` : ''
  // IFRAME'lar LAZY: src='about:blank', haqiqiy URL data-shsrc'da — faqat faol slayd yuklanadi.
  // Barchasi birdan yuklansa 40+ iframe tarmoqni bosib oladi = SEKINLIK (asosiy sabab shu edi).
  if (x.mp4) pl = `<video src="${esc(x.mp4)}" data-shsrc="${esc(x.mp4)}" loop playsinline preload="metadata" data-shaudio="${esc(x.audio || '')}" poster="${esc(x.image || '')}"></video>`
  else if (x.yt) pl = `<iframe data-shyt="1" src="about:blank" data-shsrc="${esc(shYTURL(x.yt))}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  else if (x.img) pl = `<img class="sh-img" src="${esc(x.img)}" alt="">`
  else if (x.ig) pl = `<iframe src="about:blank" data-shsrc="https://www.instagram.com/reel/${esc(x.ig)}/embed/captioned/" allow="autoplay; encrypted-media" allowfullscreen frameborder="0"></iframe>`
  else if (x.fb) pl = `<iframe src="about:blank" data-shsrc="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(x.fb)}&autoplay=1&show_text=false&mute=${shMuted ? 1 : 0}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  else pl = `<iframe src="about:blank" data-shsrc="https://geo.dailymotion.com/player.html?video=${esc(x.embed)}&autoplay=1&mute=${shMuted ? 1 : 0}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen frameborder="0"></iframe>`
  const ttl = x.live ? '🔴 Jonli efir — ' + (x.title || '') : x.title
  return `<div class="${x.mp4 ? 'sh-slide paused' : 'sh-slide'}" data-shi="${i}" data-ttrend="1"${bg}>
    ${pl}
    <div class="sh-load"><i></i><i></i><i></i></div>
    <div class="sh-failbox">⏳ Yuklanmadi — internet sekin bo'lishi mumkin<br>Pastga suring — keyingi ko'rinadi</div>
    <div class="sh-shade"></div>
    <div class="sh-bot">${ttl ? `<b>${esc(ttl)}</b>` : ''}<small>${x.views ? '👁 ' + fmtN(x.views) : ''}${x.duration ? ' · ' + fmtDur(x.duration) : ''}</small></div>
    <div class="sh-prog"><i></i></div>
    <div class="sh-play">▶</div>
  </div>`
}

function shBindVideo(v) {
  if (v._shBound) return // ikki marta bog'lanma yo'q — ikki Audio = begona/qo'shma ovoz
  v._shBound = 1
  v.muted = shMuted
  const slide = v.closest('.sh-slide')
  const prog = qs('.sh-prog i', slide)
  v.addEventListener('timeupdate', () => { if (prog && v.duration) prog.style.width = (v.currentTime / v.duration) * 100 + '%' })
  v.addEventListener('loadeddata', () => { shFailStreak = 0; slide.dataset.ok = '1'; const l = qs('.sh-load', slide); if (l) l.style.display = 'none' }, { once: true })
  // VIDEO XATOSI = SLAYD BUTUNLAY O'CHIRILADI: qora ekran lentaDA QOLMASIN (foydalanuvchi talabi).
  // (prune'dagi src'siz load()da error kelmaydi — src bor holatdagi haqiqiy xatolargina)
  v.addEventListener('error', () => { if (v.getAttribute('src')) shDropSlide(slide, 'err') })
  v.addEventListener('play', () => { slide.dataset.ok = '1'; slide.classList.remove('paused') })
  v.addEventListener('pause', () => slide.classList.add('paused'))
  v.addEventListener('canplay', () => { slide.dataset.ok = '1'; shFailStreak = 0; if (slide.dataset.on === '1' && S.prefs.shauto) v.play().catch(() => { v.muted = true; v.play().catch(() => {}) }) })
  if (v.readyState >= 2) slide.dataset.ok = '1' // allaqachon yuklangan video — watchdog soxta xato bermasin
  // Reddit mp4: audio treksi alohida faylda — TO'LIQ SINXRON oqim
  const aurl = v.dataset.shaudio
  if (aurl) {
    const a = new Audio()
    a.loop = true // video loop qilsa audio ham aylanadi — aks holda 1-aylanishdan keyin video JIM qoladi (shikoyat: "ovozi bo'lmay qolmoqda")
    const AURLS = [aurl, aurl.replace('AUDIO_128', 'AUDIO_64'), aurl.replace(/DASH_AUDIO_\d+\.mp4/, 'DASH_audio.mp4')]
    let tr = 0
    const setA = () => { if (tr < AURLS.length) { a.src = AURLS[tr++]; return true } return false }
    setA()
    a.onerror = () => { if (setA()) a.load() }
    a.addEventListener('playing', () => { a._shAok = 1; shFailStreak = 0 })
    v.addEventListener('play', () => { if (a.src) { try { a.currentTime = v.currentTime; if (!shMuted) a.play().catch(() => {}) } catch {} } })
    v.addEventListener('pause', () => { try { a.pause() } catch {} })
    v.addEventListener('seeked', () => { try { a.currentTime = v.currentTime } catch {} })
    const syncM = () => { a.muted = v.muted; if (!v.muted && !v.paused) a.play().catch(() => {}) }
    v.addEventListener('volumechange', syncM)
    v.addEventListener('play', syncM)
    // DRIFT-TUZATISH: audio videodan 0.35s'dan ko'p qo'zisa — qayta sinxron; to'xtab qolsa — yana o'yqotiladi
    v.addEventListener('timeupdate', () => {
      if (v.paused || !a.src || a.readyState < 2) return
      if (Math.abs(a.currentTime - v.currentTime) > 0.35) { try { a.currentTime = v.currentTime } catch {} }
      if (a.paused) a.play().catch(() => {})
    })
    // JIMLIK NAZORATI: video 5s o'ynaydi (ovoz yoniq), lekin alohida audio fayli o'lmagan bo'lsa —
    // bunday OVOZSIZ video lentaDA TURMAYDI: slayd o'chiriilib keyingisi ko'rsatiladi
    v.addEventListener('playing', () => {
      clearTimeout(slide._shauw)
      slide._shauw = setTimeout(() => {
        if (!slide.isConnected || slide.dataset.on !== '1' || v.paused || v.readyState < 2) return
        if (v.muted || shMuted) return // foydalanuvchi o'zi o'chirgan bo'lsa — bu jimlik emas
        if (a.error || a.networkState === 3 || (a.paused && !a._shAok)) shDropSlide(slide, 'mute')
      }, 5000)
    })
    v._shAudio = a
  } else {
    // JIM-VIDEO DETEKTORI (ovoz fayl ichida): video o'ynayapti (ovoz yoniq), lekin dekodlangan
    // AUDIO bayt YO'Q = ovozsiz video — lentaDA TURMAYDI (foydalanuvchi: "mushuk ovozi yo'q reels
    // juda ko'p ko'rsatmoqda"). Xususiyat mavjud emasligida tekshiruv o'tkazilmaydi (soxta xato yo'q).
    v.addEventListener('playing', () => {
      clearTimeout(slide._shsilw)
      slide._shsilw = setTimeout(() => {
        if (!slide.isConnected || slide.dataset.on !== '1' || v.paused || v.readyState < 2 || v.muted || shMuted) return
        const b = v.webkitAudioDecodedByteCount
        const moz = v.mozHasAudio
        if ((typeof b === 'number' && b < 800) || moz === false) shDropSlide(slide, 'mute')
      }, 3200)
    })
  }
  v.addEventListener('click', () => shTap(slide, v))
}
function shTap(slide, v) {
  const t = Date.now()
  if (t - shLastTap < 300) {
    clearTimeout(shTapTimer); shLastTap = 0
    const it = shList[+slide.dataset.shi]
    if (it && it.t === 'post' && S.prefs.shdbl) shLike(it.p, slide, true) // ikki marta bosish = like (sozlamadan o'chiriladi)
    return
  }
  shLastTap = t
  shTapTimer = setTimeout(() => {
    if (!v || !v.src) return
    v.paused ? v.play().catch(() => {}) : v.pause()
  }, 260)
}
// Tez trend Shorts: xotira-kesh → qurilma-kesh → tarmoq (zudlik uchun)
async function trendShortsFast() {
  let tr = shNormTrend(trendItems.filter((x) => x.kind === 'short'))
  if (!tr.length) { const c = trendCacheGet(); if (c) tr = shNormTrend(c.filter((x) => x.kind === 'short')) }
  if (!tr.length) {
    try { const r = await api('/trend?cat=video&page=1'); tr = shNormTrend((r && r.items) || r || []) } catch {}
  }
  return tr
}
// Ilova ochilishida trend videolari fonda tayyorlanadi — Reels/Shorts DARHOL qiziq kontent bilan ochiladi.
// Kesh eski bo'lsa (30 daqiqadan) FONDA yangilanadi — mavzular yangi bo'lib turadi, ochilish sekinlashmaydi.
window.warmTrend = () => {
  try {
    if (!trendItems.length) { const c = trendCacheGet(); if (c) trendItems = c.slice() }
    if (trendCacheAge() > 30 * 60e3) {
      // 2 sahifa PARALLEL: boyiroq hovuz (24 xil video) — har kirishda har hil ko'rinish
      Promise.all([
        api('/trend?cat=video&page=1').catch(() => null),
        api('/trend?cat=video&page=2').catch(() => null),
      ]).then(([a, b]) => {
        const la = (a && (a.items || a)) || [], lb = (b && (b.items || b)) || []
        const list = [...la, ...lb]
        if (Array.isArray(list) && list.length >= 6) { trendItems = shShuffle(list.slice()); trendCacheSave(trendItems) }
      })
    }
  } catch {}
}
async function shLike(p, slide, burst) {
  try {
    const r = await post(`/posts/${p.id}/like`)
    p.liked = r.liked; p.like_count = r.like_count
    const b = qs('[data-slike]', slide)
    if (b) { b.className = p.liked ? 'on' : ''; b.innerHTML = `${p.liked ? '❤️' : '🤍'}<i>${p.like_count || 0}</i>` }
    if (p.liked && burst !== false) { const f = document.createElement('span'); f.className = 'sh-heart'; f.textContent = '❤️'; slide.appendChild(f); setTimeout(() => f.remove(), 900); vibrate(10) }
  } catch (e) { toast('⚠️ ' + e.message) }
}
function shSetMuted(m) {
  shMuted = m
  localStorage.setItem('g50_shmute', m ? '1' : '0')
  if (!shWrap) return
  qs('#sh-m', shWrap).textContent = m ? '🔇' : '🔊'
  qsa('video', shWrap).forEach((v) => { v.muted = m; if (v._shAudio) { v._shAudio.muted = m; if (!m && !v.paused) v._shAudio.play().catch(() => {}) } })
  // YT iframe: faqat FAOL slaydga unmute+play qilinadi — preload'dagi keyingi video FONDA
  // ovozli o'ynashi mumkin emas (begona ovoz — shikoyat); yuklanmaganlari URL'i yangilanadi
  qsa('iframe[data-shyt]', shWrap).forEach((f) => {
    const ons = f.closest('.sh-slide')
    const act = ons && ons.dataset.on === '1'
    if (f.dataset.loaded === '1') { shYTpost(f, m ? 'mute' : 'unMute'); if (!m && act) shYTpost(f, 'playVideo') }
    else if (f.dataset.shsrc) { const id = (f.dataset.shsrc.match(/embed\/([^?&]+)/) || [])[1]; if (id) f.dataset.shsrc = shYTURL(id) }
  })
  // DM iframe mute param — URL yangilaymiz; faol bo'lsa reload
  qsa('iframe:not([data-shyt])', shWrap).forEach((f) => {
    if (f.dataset.shsrc && /mute=/.test(f.dataset.shsrc)) f.dataset.shsrc = f.dataset.shsrc.replace(/mute=[01]/, 'mute=' + (m ? 1 : 0))
  })
  const on = qs('.sh-slide[data-on="1"] iframe:not([data-shyt])', shWrap)
  if (on && on.dataset.shsrc && on.dataset.loaded === '1') { on.dataset.loaded = ''; on.src = on.dataset.shsrc; shBindFrame(on) }
}
function shActivate(w, slide) {
  slide.dataset.on = '1'
  // Scroll-settle rejimi: boshqa barcha slaydlar o'chiriladi (eski IO shDeactivate o'rniga).
  // Aks holda eski slaydlar "on" holatda qoladi — qaytib kirganda video tiklanmaydi.
  qsa('.sh-slide', w).forEach((s) => { if (s !== slide) { s.dataset.on = ''; clearTimeout(s._shseen) } })
  // NO-REPEAT: slayd 2.5s ko'rilsa (yuklangan/o'ynagan bo'lsa) — "ko'rildi" deb belgilanadi.
  // Yuklanmagan slayd belgilanmaydi — keyingi safar yana urinib ko'riladi.
  clearTimeout(slide._shseen)
  slide._shseen = setTimeout(() => {
    if (slide.dataset.on === '1' && slide.isConnected && (slide.dataset.ok === '1' || slide.dataset.playing === '1')) {
      const cur = shList[+slide.dataset.shi]
      if (cur) shMarkSeen(cur)
    }
  }, 2500)
  const i = +slide.dataset.shi
  const it = shList[i]
  if (it && it.t === 'trend') tev('video', 'imp') // analiz tizimiga ko'rish
  const v = qs('video', slide)
  if (v) {
    // shPrune tozalagan bo'lsa — manbani tiklaymiz: mp4'larda data-shsrc'dan (hydrate faqat
    // data-media'ni tiklaydi — trend mp4'larida src o'chsa ORQAGA QAYTISHDA QORA/QOTGAN slayd edi)
    if (!v.getAttribute('src') && v.dataset.shsrc) { v.src = v.dataset.shsrc; v.muted = shMuted; if (!S.prefs.shq) v.preload = 'auto' }
    else if (!v.getAttribute('src')) { v.removeAttribute('data-h'); hydrate(slide) }
    v.muted = shMuted
    if (!S.prefs.shq && v.preload !== 'auto') v.preload = 'auto'
    // AUTOPLAY bloklansa (ovozli ijro siyosati) — OVOZSIZ davom: qora pauza ekranda qotmaydi
    if (S.prefs.shauto) v.play().catch(() => { v.muted = true; v.play().catch(() => {}) })
  }
  const nx = qs(`.sh-slide[data-shi="${i + 1}"] video`, w)
  if (nx && !S.prefs.shq) nx.preload = 'auto'
  // Boshqa slaydlar: video pauza; YT iframe postMessage pauza (yuklangan holatda qoladi — orqaga qaytsa TEGISHLI tez);
  // boshqa iframelar (IG/DM og'ir) — src bo'shatiladi. Bu reload'siz pauza = scroll tezligi.
  qsa('.sh-slide', w).forEach((s) => {
    if (s === slide) return
    s.querySelectorAll('iframe[data-shyt]').forEach((f) => { if (f.dataset.loaded === '1') shYTpost(f, 'pauseVideo') })
    s.querySelectorAll('iframe:not([data-shyt])').forEach((f) => { if (f.src !== 'about:blank' && f.dataset.loaded === '1') { f.dataset.loaded = ''; f.src = 'about:blank' } })
    const vv = qs('video', s)
    if (vv) { vv.pause(); if (vv._shAudio) { try { vv._shAudio.pause() } catch {} } }
  })
  // Faol slayd iframe: lazy — hozir yuklaymiz; allaqachon yuklangan (preload) bo'lsa play
  const ifr = qs('iframe', slide)
  if (ifr) {
    if (ifr.dataset.shyt) {
      if (ifr.dataset.loaded === '1') { shYTpost(ifr, 'playVideo'); if (!shMuted) shYTpost(ifr, 'unMute') }
      else {
        ifr.dataset.loaded = '1'
        slide.dataset.ok = '' // qayta yuklanmoqda — eskirgan ok-belgi SOXTA pass bermasin (qora ekran himoyasi)
        ifr.src = ifr.dataset.shsrc || ''
        shBindFrame(ifr)
      }
    } else if (ifr.dataset.loaded !== '1' && ifr.dataset.shsrc) {
      ifr.dataset.loaded = '1'
      slide.dataset.ok = ''
      ifr.src = ifr.dataset.shsrc
      shBindFrame(ifr)
    }
  }
  // QORA EKRAN HIMOYASI (hamma slayd uchun — VIDEO HAM iframe): 10s ichida slayd "jonlanmasa"
  // — bunday video lentaDA TURMAYDI: slayd butunlay o'chirilib, keyingisi ko'rsatiladi
  // (foydalanuvchi talabi: qora ekran ko'rsatadigan video lentaGA UBORILMASIN).
  // AVVAL bu nazorat FAQAT iframe slaydlarda edi — video slaydlar (post/DASH mp4) umuman
  // nazoratsiz qora qolardi (shikoyat: "2 ta ko'rsatib bittasi qora ekran bo'lib qolmoqda").
  slide.classList.remove('sh-fail')
  const ld = qs('.sh-load', slide)
  const vidReady = v && v.readyState >= 2
  if (ld) ld.style.display = ((ifr && ifr.dataset.ok === '1') || vidReady) ? 'none' : ''
  clearTimeout(slide._shwd)
  clearTimeout(slide._shauto)
  slide._shwd = setTimeout(() => {
    // O'ynayotgan/yuklangan video hech qachon "yuklanmadi" deb sanalmasin (soxta-fail tarixi)
    const vv = qs('video', slide)
    if (vv && (vv.readyState >= 2 || !vv.paused)) { shFailStreak = 0; return }
    if (slide.dataset.ok === '1') { shFailStreak = 0; return }
    if (!shWrap || !slide.isConnected) return
    shFailStreak++
    if (shFailStreak <= 4) shDropSlide(slide, 'load')
    else {
      const l2 = qs('.sh-load', slide)
      if (l2) l2.style.display = 'none'
      slide.classList.add('sh-fail')
      toast('⚠️ Bir nechta video yuklanmadi — internetni tekshiring', 3000)
    }
  }, 8000) // 12→10→8s: qora ekran qisqa turadi; soxta-fail readyState nazorati bilan himoyalangan
  // YT IJRO KUZATUVI: iframe yuklandi lekin player 7s ichida O'YNAMASA — avval joyida 1 marta
  // yangi player qayta yuklanadi (sekin tarmoqda ko'p yordam beradi), yana o'ynamasa — o'chiriiladi.
  // AVVAL 15s edi + soxta 'playing' belgisi bilan deyarli ishlamasdi (qora ekran shikoyati).
  if (ifr && ifr.dataset.shyt) {
    clearTimeout(slide._shytw)
    const ytCheck = () => {
      if (!shWrap || !slide.isConnected || slide.dataset.on !== '1') return
      if (slide.dataset.playing === '1') { shFailStreak = 0; return }
      if (slide.dataset.ok !== '1') return // hali yuklanmadi — universal watchdog qaraydi
      if (!slide._shrt) {
        slide._shrt = 1 // faqat 1 marta joyida qayta yuklash
        slide.dataset.ok = ''; slide.dataset.playing = ''
        ifr.dataset.loaded = ''
        ifr.src = ifr.dataset.shsrc || ''
        shBindFrame(ifr)
        if (!shMuted) setTimeout(() => { try { if (slide.isConnected) { shYTpost(ifr, 'unMute'); shYTpost(ifr, 'playVideo') } } catch {} }, 1500) // yangi player mute=1 bilan ochiladi — ovozni tiklaymiz
        clearTimeout(slide._shytw)
        // 5s: qayta yuklangan player ham o'ynamasa — soxta emas (qora ekran qisqa tursin)
        slide._shytw = setTimeout(ytCheck, 5000)
        return
      }
      shFailStreak++
      if (shFailStreak <= 4) shDropSlide(slide, 'play')
      else toast('⚠️ Videolar ochilmayapti — internetni tekshiring', 3000)
    }
    // 4.5s: player yuklandi lekin o'ynamasa — tez aniqlansin (qora ekran shikoyati: "yana chiqyapti")
    slide._shytw = setTimeout(ytCheck, 4500)
  }
  // PRELOAD: keyingi slayd YT bo'lsa — 1.5s'dan keyin fonda (mute) yuklanadi → scroll qilsa DARHAL ijro
  // (Tejamkor rejim yoniq bo'lsa oldindan yuklanmaydi)
  clearTimeout(w._shpre)
  if (S.prefs.shq) return
  w._shpre = setTimeout(() => {
    const ns = qs(`.sh-slide[data-shi="${i + 1}"]`, w)
    const nf = ns && qs('iframe[data-shyt]', ns)
    if (nf && nf.dataset.loaded !== '1' && nf.dataset.shsrc) {
      nf.dataset.loaded = '1'
      nf.src = nf.dataset.shsrc
      shBindFrame(nf)
    }
  }, 600) // 1500→600ms: keyingi video ertaroq yuklanadi — suringanda DARHAL ijro
}
// ISHLAMAYDIGAN SLAYDNI O'CHIRISH (foydalanuvchi talabi: qora ekran / ovozsiz / ochiqsiz video
// lentaDA QOLMASIN — "faqat ko'rsatadigan, ovozi joyida videolarni uzat"): slayd DOMdan va
// shList'dan o'chiriilib, xato-belgi bilan "ko'rildi" qilinadi — bu sessiyada VA keyingi
// sessiyalarda qaytmaydi. Keyingi slayd darhol faollashadi. Internet butunlay uzilgan
// holatda lenta birdan o'chib ketmasin — 4 ketma-ket xatodan keyin eski failbox rejimi.
function shDropSlide(slide, why) {
  if (!shWrap || !slide || !slide.isConnected) return
  clearTimeout(slide._shwd); clearTimeout(slide._shauto); clearTimeout(slide._shytw); clearTimeout(slide._shseen); clearTimeout(slide._shauw); clearTimeout(slide._shsilw)
  const i = +slide.dataset.shi || 0
  const it = shList[i]
  if (it) { const k = shKey(it); shBad.add(k); try { shSeen.set(k, Date.now()); shSeenSave() } catch {} }
  const wasOn = slide.dataset.on === '1'
  try { const vv = qs('video', slide); if (vv) { vv.pause(); if (vv._shAudio) vv._shAudio.pause() } } catch {}
  slide.remove()
  shList.splice(i, 1)
  qsa('.sh-slide', shWrap).forEach((s, k) => { s.dataset.shi = k })
  if (wasOn) {
    toast('⏭ Video ishlamadi — keyingisi', 1400)
    const nx = qs(`.sh-slide[data-shi="${i}"]`, shWrap)
    if (nx) shActivate(shWrap, nx)
    else setTimeout(() => { if (shWrap && !qs('.sh-slide[data-on="1"]', shWrap)) { const f = qs('.sh-slide', shWrap); if (f) { f.scrollIntoView({ block: 'start' }); shActivate(shWrap, f) } } }, 900)
  }
  if (shList.length - i < 4) shMore() // lenta oxiri yaqinlashdi — oldindan to'ldiramiz
}
function shDeactivate(slide) {
  slide.dataset.on = ''
  const v = qs('video', slide)
  if (v) { v.pause(); if (v._shAudio) { try { v._shAudio.pause() } catch {} } }
}
// Xotira parvarishi: faol slayddan uzoq slaydlar bo'shatiladi. 30+ video/iframe xotirada
// yuklanib qolsa WebView sekinlashadi va QOTADI (shikoyat). Qayta kirganda shActivate/hydrate tiklaydi.
function shPrune(w, idx) {
  qsa('.sh-slide', w).forEach((s) => {
    const d = Math.abs((+s.dataset.shi || 0) - idx)
    if (d > 2) s.querySelectorAll('iframe').forEach((f) => { if (f.src !== 'about:blank') { f.dataset.loaded = ''; try { f.src = 'about:blank' } catch {} } })
    if (d > 3) {
      const vv = qs('video', s)
      if (vv && vv.getAttribute('src')) {
        try { vv.pause(); if (vv._shAudio) vv._shAudio.pause() } catch {}
        vv.removeAttribute('src'); vv.removeAttribute('data-h')
        try { vv.load() } catch {}
      }
    }
  })
}
// RASM slaydlari (foydalanuvchi akkauntidagi rasmlar — Reels'da to'liq ekran, sekin zum efekt bilan)
function shBindImg(s) {
  const im = qs('img.sh-img', s)
  if (!im || im._shBound) return
  im._shBound = 1
  const ok = () => { s.dataset.ok = '1'; const l = qs('.sh-load', s); if (l) l.style.display = 'none' }
  im.addEventListener('load', ok)
  im.addEventListener('error', () => shDropSlide(s, 'img'))
  if (im.complete && im.naturalWidth > 0) ok() // keshdan darhol — watchdog soxta xato bermasin
}
function shAppend(items, force) {
  if (!items.length || !shWrap) return 0
  // DEDUPE + NO-REPEAT: sessiya ichida ham, avvalgi sessiyalarda ko'rilgan bilan ham
  // takror YO'Q. Avval umuman ko'rilmaganlar; hovuz batamom ko'rilgandagina (force)
  // qayta aylanadi — lenta hech qachon to'xtamaydi.
  const seenD = new Set(shList.map(shKey))
  const pick = (arr) => arr.filter((it) => { const k = shKey(it); if (seenD.has(k) || shBad.has(k)) return false; seenD.add(k); return true })
  const unseen = pick(items.filter((it) => !shSeen.has(shKey(it))))
  const use = unseen.length ? unseen : (force ? pick(items).slice(0, 12) : [])
  if (!use.length) return 0
  const sc = qs('.sh-scroll', shWrap)
  const base = shList.length
  shList.push(...use)
  sc.insertAdjacentHTML('beforeend', use.map((it, k) => shSlideHTML(it, base + k)).join(''))
  const fresh = qsa('.sh-slide', sc).slice(base)
  fresh.forEach((s) => { qsa('video', s).forEach(shBindVideo); shBindImg(s) }) // iframe shBindFrame — faqat yuklanganda (about:blank load hodisasi aldamasligi uchun)
  hydrate(sc)
  return use.length
}
async function shMore() {
  if (shBusyMore) return
  shBusyMore = true
  try {
    // force = shDry>=1: bir marta bo'sh qaytgach hovuz QAYTA AYLANADI — lenta hech qachon
    // butunlay to'xtab qolmaydi (avval shDry=2'da butunlay o'chardi → "5-6 tadan keyin qotmoqda")
    const f = shDry >= 1
    if (shMode === 'reels') {
      if (shPostsEnd) return
      const posts = shList.filter((x) => x.t === 'post')
      const before = posts.length ? Math.min(...posts.map((x) => x.p.id)) : 0
      const r = await api('/reels' + (before ? '?before=' + before : ''))
      const items = shNormPosts(Array.isArray(r) ? r : (r && r.posts) || [])
      if (items.length < 10) shPostsEnd = true
      shDry = shAppend(items, f) ? 0 : shDry + 1
    } else if (shMode === 'mix') {
      // MIX: avval platform Reels tugaydi, keyin internet Shorts uzluksiz davom etadi
      if (!shPostsEnd) {
        const posts = shList.filter((x) => x.t === 'post')
        const before = posts.length ? Math.min(...posts.map((x) => x.p.id)) : 0
        const r = await api('/reels' + (before ? '?before=' + before : ''))
        const items = shNormPosts(Array.isArray(r) ? r : (r && r.posts) || [])
        if (items.length < 10) shPostsEnd = true
        shDry = shAppend(items, f) ? 0 : shDry + 1
      }
      if (shPostsEnd && shWrap && shDry < 2) {
        shTrPage++
        const r = await api('/trend?cat=video&page=' + shTrPage)
        const items = shNormTrend(Array.isArray(r) ? r : (r && r.items) || [])
        if (!items.length) shTrPage = 0 // cheksiz lenta
        shDry = shAppend(items, f) ? 0 : shDry + 1
      }
    } else {
      shTrPage++
      const r = await api('/trend?cat=video&page=' + shTrPage)
      const items = shNormTrend(Array.isArray(r) ? r : (r && r.items) || [])
      if (!items.length) shTrPage = 0 // cheksiz lenta: qaytadan boshlaydi
      shDry = shAppend(items, f) ? 0 : shDry + 1
    }
  } catch {} finally { shBusyMore = false }
}
function shGo(idx) {
  if (!shWrap) return
  const s = qs(`.sh-slide[data-shi="${idx}"]`, shWrap)
  if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function shClose() {
  if (!shWrap) return
  try {
    clearInterval(shWtTimer); shKeyH && document.removeEventListener('keydown', shKeyH)
    if (shWrap._shMsg) { window.removeEventListener('message', shWrap._shMsg); shWrap._shMsg = null }
    clearTimeout(shWrap._shst); clearTimeout(shWrap._shpre)
    qsa('video', shWrap).forEach((v) => { try { v.pause(); if (v._shAudio) v._shAudio.pause() } catch {} })
    qsa('.sh-slide', shWrap).forEach((s) => { clearTimeout(s._shwd); clearTimeout(s._shauto); clearTimeout(s._shytw); clearTimeout(s._shseen) })
  } catch {}
  const w = shWrap
  shWrap = null
  w.classList.remove('on')
  document.body.classList.remove('sh-lock')
  setTimeout(() => w.remove(), 220)
}
async function shortsStart(opt = {}) {
  try {
    if (opt.reelsOnly) {
      // REELS rejim — HAR SAFAR RANDOM: platform Reels ommabop Shorts ICHIDA tasodifiy
      // joyda ko'rinadi. Bir xillik umuman yo'q: har ochilishda boshqa tartib, boshqa slayd
      // birinchi bo'ladi, mavzular ham server tomonda doimiy yangilanib turadi.
      let posts = shNormPosts(reelPosts)
      if (!posts.length) { try { posts = shNormPosts(await api('/reels')) } catch {} }
      // NO-REPEAT: avvalgi sessiyada KO'RILGAN videolar chizib tashlanadi; hammasi
      // ko'rilgan bo'lsa hovuz yangi tsiklga qaytadi. Aniq bosilgan video (opt.post)
      // ko'rilgan bo'lsa ham HAR DOIM ko'rsatiladi — foydalanuvchi o'zi tanladi.
      const fp = posts.filter((x) => !shSeen.has(shKey(x)))
      if (fp.length) posts = fp
      if (opt.post && !posts.some((x) => x.p.id === opt.post.id)) posts.unshift({ t: 'post', p: opt.post })
      // Trendni KESHDAN olamiz (xotira → qurilma) — tarmoq kutmaymiz, viewer zudlik bilan ochiladi
      let tr = shNormTrend((trendItems.length ? trendItems : (trendCacheGet() || [])).filter((x) => x.kind === 'short'))
      const ft = tr.filter((x) => !shSeen.has(shKey(x)))
      tr = ft.length ? ft : tr
      shShuffle(posts) // HAR SAFAR RANDOM tartib — boshidagi bir xil slaydlar yo'q
      shShuffle(tr) // har ochilishda boshqa tartib — qayta-qayta bir xil reel ko'rinmaydi
      if (posts.length && tr.length) {
        // MIX: postlar Shorts orasiga TASODIFIY joyga qo'yiladi (birinchi ~6 slayd ichida)
        shMode = 'mix'
        shTrPage = 1
        const merged = tr.slice()
        for (const p of posts) merged.splice(Math.floor(Math.random() * Math.min(6, merged.length)), 0, p)
        const at = opt.post ? merged.findIndex((x) => x.t === 'post' && x.p.id === opt.post.id) : -1
        openShorts(merged, at >= 0 ? at : 0)
        return true
      }
      if (!posts.length) {
        // Platformada hali reel yo'q — ommabop Shorts DARHOL ochiladi (kutish yo'q)
        if (!tr.length) { try { tr = await trendShortsFast(); shShuffle(tr) } catch {} }
        if (!tr.length) return false
        shMode = 'trend'
        shTrPage = 1
        openShorts(tr, 0)
        if (tr.length < 4) { api('/trend?cat=video&page=2').then((r) => { const more = shNormTrend((r && r.items) || r || []); if (more.length && shWrap && shMode === 'trend') shAppend(more) }).catch(() => {}) }
        return true
      }
      // Trend hali keshlanmagan (birinchi ochilish): postlar DARHOL, Shorts fonda qo'shiladi
      shMode = 'mix'
      shTrPage = 1
      const idx = opt.post ? posts.findIndex((x) => x.p.id === opt.post.id) : 0
      openShorts(posts, Math.max(0, idx))
      trendShortsFast().then((t2) => { if (t2.length && shWrap && shMode === 'mix') shAppend(shShuffle(t2)) }).catch(() => {})
      return true
    }
    // SHORTS rejim: internetdan trend videolar — HAR SAFAR RANDOM tartibda (bir xillik yo'q)
    const tr0 = await trendShortsFast()
    const ft = tr0.filter((x) => !shSeen.has(shKey(x)))
    const tr = ft.length ? ft : tr0 // hammasi ko'rilgan bo'lsa — yangi tsikl
    shShuffle(tr)
    if (opt.trend && !tr.some((x) => x.x.id === opt.trend.id)) tr.unshift({ t: 'trend', x: opt.trend })
    if (!tr.length) return toast('🎬 Shorts hali tayyor emas — birozdan so‘ng urinib ko‘ring')
    shMode = 'trend'
    const idx = opt.trend ? tr.findIndex((x) => x.x.id === opt.trend.id) : 0
    openShorts(tr, Math.max(0, idx))
    // Yosh lenta: kam bo'lsa fonda yana bir sahifa tortamiz
    if (tr.length < 4) { api('/trend?cat=video&page=2').then((r) => { const more = shNormTrend((r && r.items) || r || []); if (more.length && shWrap && shMode === 'trend') shAppend(more) }).catch(() => {}) }
    return true
  } catch (e) { toast('⚠️ ' + e.message) }
}
function openShorts(list, startIdx = 0) {
  shClose()
  shList = list
  shPostsEnd = false; shTrPage = 1; shDry = 0
  const isReels = shMode !== 'trend'
  const w = document.createElement('div')
  w.id = 'shorts'
  w.innerHTML = `<div class="sh-top"><button class="sh-x" id="sh-x">✕</button><b>${isReels ? '🎬 Reels' : '🎬 Shorts'}</b><div class="sh-sp"></div><button class="sh-mute" id="sh-add" title="Reels joylash">➕</button><button class="sh-mute" id="sh-m">${shMuted ? '🔇' : '🔊'}</button></div>
  <div class="sh-scroll">${list.map(shSlideHTML).join('')}</div>`
  document.body.appendChild(w)
  document.body.classList.add('sh-lock')
  shWrap = w
  shYTMsgBind(w)
  requestAnimationFrame(() => {
    w.classList.add('on')
    const sc = qs('.sh-scroll', w)
    hydrate(sc)
    qsa('.sh-slide', sc).forEach((s, i) => { const v = qs('video', s); if (v) { if (i > 2) v.preload = 'none'; shBindVideo(v) } shBindImg(s) }) // iframe'lar lazy — faqat faol slayd yuklanadi; birinchi 3 tadan keyingi video play'da yuklanadi (tezlik)
    // Boshqaruv
    w.addEventListener('click', async (e) => {
      if (e.target.closest('#sh-x')) return shClose()
      if (e.target.closest('#sh-m')) return shSetMuted(!shMuted)
      if (e.target.closest('#sh-add')) return reelSheet()
      const slide = e.target.closest('.sh-slide')
      if (!slide) return
      const it = shList[+slide.dataset.shi]
      if (!it) return
      if (e.target.closest('[data-slike]')) return shLike(it.p, slide)
      if (e.target.closest('[data-scmt]')) return commentsSheet(it.p, null)
      // Ulashish FAQAT platform postlari uchun va FAQAT ilova havolasi bilan — trend/akkaunt
      // kontentidan manba URL'i UMUMAN chiqmaydi (manba SIR, yuklab olish/uzatish yo'q)
      if (e.target.closest('[data-ssh]')) return share((it.p.text_body || '50 Gram Shorts').slice(0, 100), location.origin + location.pathname)
      // YT slaydga bosish = PLAY + OVOZ: autoplay bloklansa (ba'zi WebView) — bosganda jonlanadi;
      // o'ynayotgan slaydga bosilsa ham ovoz QAYTA YUBORILADI (jim qolgan YT slaydni tuzatadi)
      const yf = slide.querySelector('iframe[data-shyt]')
      if (yf && yf.dataset.loaded === '1') { shYTpost(yf, 'playVideo'); if (!shMuted) shYTpost(yf, 'unMute'); return }
      if (e.target.closest('[data-sdel]')) {
        if (!(await confirmBox('Video o‘chirilsinmi?', 'O‘chirish'))) return
        try { await del('/posts/' + it.p.id); if (it.p.media_id) Store.remove([String(it.p.media_id)]); shList.splice(+slide.dataset.shi, 1); slide.remove(); qsa('.sh-slide', sc).forEach((s, i) => (s.dataset.shi = i)); toast('O‘chirildi') } catch (er) { toast('⚠️ ' + er.message) }
        return
      }
      // QAYTA URINISH: qora/qotgan slayd — manba qayta ulanadi va ijro qayta boshlanadi
      if (e.target.closest('[data-shretry]')) {
        slide.classList.remove('sh-fail')
        const l2 = qs('.sh-load', slide); if (l2) l2.style.display = ''
        const vv = qs('video', slide)
        if (vv) {
          if (!vv.getAttribute('src') && vv.dataset.shsrc) vv.src = vv.dataset.shsrc
          else if (!vv.getAttribute('src')) { vv.removeAttribute('data-h'); hydrate(slide) }
          try { vv.load() } catch {}
          // once-kuzatuvchi allaqachon ishlatilgan — qayta ulanadi (yuklangach loader yashiriladi)
          vv.addEventListener('loadeddata', () => { slide.dataset.ok = '1'; const l3 = qs('.sh-load', slide); if (l3) l3.style.display = 'none' }, { once: true })
          if (slide.dataset.on === '1') vv.play().catch(() => { vv.muted = true; vv.play().catch(() => {}) })
        }
        return
      }
      const who = e.target.closest('[data-shwho]')
      if (who) { const q = who.dataset.shwho; if (q[0] === 'u') openUser(+q.slice(1)); else { const ch = S.chats.get(+q.slice(1)); ch && ch.joined !== false ? openChat(ch.id) : chatPreview(it.p.chat) } }
    })
    // SCROLL-SETTLE: aktiv slayd faqat scroll TINCHAGANDA tanlanadi. IntersectionObserver
    // scroll davomida qo'shni slaydlarni bir necha marta yoqib-o'chirardi — play/pause
    // tebranishi "tepa-pastga siljish" va qotishga sabab bo'lardi (shikoyat).
    const settle = () => {
      clearTimeout(w._shst)
      w._shst = setTimeout(() => {
        if (shWrap !== w) return
        const fst = sc.firstElementChild
        const slideH = fst ? fst.offsetHeight : 0
        if (!slideH) return
        const idx = Math.max(0, Math.min(shList.length - 1, Math.round(sc.scrollTop / slideH)))
        const cur = qs(`.sh-slide[data-shi="${idx}"]`, w)
        if (cur && cur.dataset.on !== '1') shActivate(w, cur)
        shPrune(w, idx) // uzoq slaydlar xotiradan bo'shatiladi — qotishning oldi olinadi
      }, 130)
    }
    sc.addEventListener('scroll', () => { settle(); if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < innerHeight * 1.5) shMore() }, { passive: true })
    shKeyH = (e) => {
      if (e.key === 'Escape') shClose()
      if (e.key === 'ArrowDown') { e.preventDefault(); shGo(Math.min(shList.length - 1, +(qs('.sh-slide[data-on="1"]', w) || { dataset: { shi: 0 } }).dataset.shi + 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); shGo(Math.max(0, +(qs('.sh-slide[data-on="1"]', w) || { dataset: { shi: 0 } }).dataset.shi - 1)) }
    }
    document.addEventListener('keydown', shKeyH)
    // Analiz: ko'rish vaqti (har 5s)
    shWtTimer = setInterval(() => { if (shWrap && qs('.sh-slide[data-on="1"][data-ttrend]', w)) tev('video', 'wt', 5000) }, 5000)
    const first = qs(`.sh-slide[data-shi="${Math.max(0, startIdx)}"]`, w)
    if (first) { first.scrollIntoView({ block: 'start' }); shActivate(w, first) }
    settle()
  })
}
