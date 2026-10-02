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
  if (x.kind === 'short') return `<div class="tcard short vid" data-tv="${x.id}" style="${x.image ? `background-image:url('${esc(x.image)}')` : ''}"><span class="tch">⚡ Shorts</span><div class="pplay">▶</div><div class="tcb"><b>${esc(x.title)}</b><small>${x.views ? '👁 ' + fmtN(x.views) : ''}${x.duration ? ' · ' + fmtDur(x.duration) : ''}</small></div></div>`
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
// ZUDLIK keshi: oxirgi 1-sahifa sessionStorage'da — lenta HAR QAYTA OCHILGANDA darhol chiziladi (fon yangilanadi)
// Bu "lenta juda sekin ochmoqda" shikoyatining client-tarafi yechimi.
function trendCacheSave(items) {
  try { sessionStorage.setItem('g50_trend_p1', JSON.stringify({ t: Date.now(), items: items.slice(0, 24) })) } catch {}
}
function trendCacheGet() {
  try {
    const d = JSON.parse(sessionStorage.getItem('g50_trend_p1') || '')
    if (d && d.items && Date.now() - d.t < 5 * 60 * 1000) return d.items
  } catch {}
  return null
}
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
    const list = r.items || []
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
  } catch (e) { if (reset) $('feedlist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; trendPage-- } finally { trendBusy = false }
}
function openTrendNews(x) {
  tintAdd(x.cat)
  tev(x.cat || 'uz', 'clk')
  sheet(`<div class="tnews">${x.image ? `<img src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : ''}<span class="tch">${TCATS[x.cat] ? TCATS[x.cat][0] + ' ' + TCATS[x.cat][1] : '📰 Yangilik'}</span><h2>${esc(x.title)}</h2><small class="mut">${fmtAgo(x.time)}</small>${x.snippet ? `<p>${esc(x.snippet)}</p>` : ''}<a class="btn big" href="${esc(x.url)}" target="_blank" rel="noopener">🌐 To‘liq o‘qish</a></div>`)
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

// ============ Umumiy lenta (postlar/reels) ============
async function loadFeed(reset) {
  if (feedBusy) return
  if (reset) { feedPosts = []; feedEnd = false; $('feedlist').innerHTML = '<div class="spin"></div>' }
  if (feedEnd) return
  feedBusy = true
  try {
    const before = feedPosts.length ? feedPosts[feedPosts.length - 1].id : 0
    const r = feedMode === 'reels'
      ? await api('/reels' + (before ? '?before=' + before : ''))
      : await api(`/feed?mode=${feedMode}${before ? '&before=' + before : ''}`)
    const list = Array.isArray(r) ? r : r.posts || []
    for (const p of list) if (p.media_id && p.meta) P2P.note(String(p.media_id), { chat: 0, ...p.meta })
    feedPosts.push(...list)
    if (list.length < 20) feedEnd = true
    feedMode === 'reels' ? renderReels() : renderFeed()
  } catch (e) { $('feedlist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>` } finally { feedBusy = false }
}
// ---------------- Reels: vertikal video lenta ----------------
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
      <button data-cmt>💬<i>${p.comment_count || 0}</i></button>
      <button data-psh>↗️<i>Ulashish</i></button>
      ${p.can_delete ? '<button data-pdel>🗑<i>O‘chirish</i></button>' : ''}
    </div>
    <div class="rtap"></div>
  </div>`
}
function renderReels() {
  const box = $('feedlist')
  $('t-feed').classList.add('reelmode')
  box.innerHTML = feedPosts.length
    ? `<div class="reels">${feedPosts.map(reelHTML).join('')}</div>${feedEnd ? '' : '<div class="hint" style="text-align:center;padding:12px">Pastga suring — yana videolar 🎬</div>'}`
    : `<div class="empty"><span class="big">🎬</span>Hali video yo‘q. Lenta tabida 🎬 Reels ni tanlab video post joylang!</div>`
  hydrate(box)
  if (reelsObserver) reelsObserver.disconnect()
  const rd = qs('.reels', box)
  if (rd && 'IntersectionObserver' in window) {
    reelsObserver = new IntersectionObserver((es) => {
      for (const en of es) {
        const v = en.target
        if (en.isIntersecting && en.intersectionRatio > 0.6) { v.play().catch(() => {}); v.muted = false }
        else v.pause()
      }
    }, { root: qs('#t-feed'), threshold: [0, 0.6, 1] })
    qsa('.reel video', box).forEach((v) => reelsObserver.observe(v))
  }
}
function postHTML(p) {
  const who = p.chat ? `${avHTML(p.chat, 40, { chat: true })}<div><b>${p.chat.type === 'channel' ? '📢 ' : ''}${esc(p.chat.title)}</b><small>${fmtAgo(p.created_at)}</small></div>` : `${avHTML(p.author, 40)}<div><b>${esc(uname(p.author))}</b><small>${fmtAgo(p.created_at)}</small></div>`
  const media = p.media_id ? (p.media_kind === 'video' ? `<video class="pm" data-media="${p.media_id}" controls playsinline preload="metadata"></video>` : `<img class="pm" data-media="${p.media_id}" data-pv alt="">`) : ''
  return `<div class="post" data-post="${p.id}"><div class="ph" data-who="${p.chat ? 'c' + p.chat.id : 'u' + (p.author?.id || 0)}">${who}${p.can_delete ? '<button class="ic" data-pdel>🗑</button>' : ''}</div>${p.text_body ? `<div class="pt">${linkify(p.text_body)}</div>` : ''}${media}<div class="pa"><button data-like class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'} ${p.like_count || 0}</button><button data-cmt>💬 ${p.comment_count || 0}</button><button data-psh>↗️ Ulashish</button></div></div>`
}
function renderFeed() {
  const box = $('feedlist')
  box.innerHTML = feedPosts.length ? feedPosts.map(postHTML).join('') + (feedEnd ? '<div class="hint" style="text-align:center">Hammasi ko‘rildi ✨</div>' : '<button class="btn gh" data-more>Yana yuklash</button>')
    : `<div class="empty"><span class="big">📰</span>${feedMode === 'subs' ? 'Obuna bo‘lgan kanallaringizda hali post yo‘q' : 'Hali postlar yo‘q. Birinchi bo‘lib yangilik yoki e’lon joylang!'}</div>`
  hydrate(box)
}
$('feedseg').onclick = (e) => { const d = e.target.closest('[data-m]'); if (!d) return; feedMode = d.dataset.m; qsa('#feedseg div').forEach((x) => x.classList.toggle('on', x === d)); $('b-post').classList.toggle('hide', feedMode === 'reels' || feedMode === 'trend'); $('t-feed').classList.toggle('reelmode', feedMode === 'reels'); $('trendchips').classList.toggle('hide', feedMode !== 'trend'); feedMode === 'trend' ? loadTrend(true) : loadFeed(true) }
$('feedlist').addEventListener('click', async (e) => {
  if (feedMode === 'trend') {
    const tn = e.target.closest('[data-tn]')
    if (tn) { const x = trendItems.find((v) => v.id === tn.dataset.tn); if (x) openTrendNews(x) }
    const tv = e.target.closest('[data-tv]')
    if (tv) { const x = trendItems.find((v) => v.id === tv.dataset.tv); if (x) { if (x.kind === 'short') return shortsStart({ trend: x }); openTrendVideo(x) } }
    return
  }
  if (feedMode === 'reels') {
    const reel = e.target.closest('[data-reel]')
    if (!reel) return
    const p = feedPosts.find((x) => x.id === +reel.dataset.reel); if (!p) return
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
      try { await del('/posts/' + p.id); if (p.media_id) Store.remove([String(p.media_id)]); feedPosts = feedPosts.filter((x) => x !== p); renderReels() } catch (er) { toast('⚠️ ' + er.message) }
      return
    }
    const w = e.target.closest('[data-who]')
    if (w) { const v = w.dataset.who; if (v[0] === 'u') openUser(+v.slice(1)); else { const c = S.chats.get(+v.slice(1)); c && c.joined !== false ? openChat(c.id) : chatPreview(p.chat) } ; return }
    // To'liq ekran Shorts rejimi (TikTok uslubi)
    return shortsStart({ post: p })
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
async function commentsSheet(p, el) {
  let list = []
  try { list = await api(`/posts/${p.id}/comments`) } catch (e) { return toast('⚠️ ' + e.message) }
  const draw = () => list.map((k) => `<div class="cmt">${avHTML(k.user, 34, { noStory: true })}<div class="cb2"><b>${esc(uname(k.user))}</b> <small class="mut">${fmtAgo(k.created_at)}</small><div>${linkify(k.text_body)}</div></div></div>`).join('') || '<div class="empty">Birinchi izohni yozing</div>'
  const sh = sheet(h3('Izohlar') + `<div id="cm-l" style="max-height:55vh;overflow:auto">${draw()}</div><div class="inrow"><input class="inp" id="cm-i" maxlength="1000" placeholder="Izoh yozing…"><button class="btn" id="cm-s" style="width:auto">➤</button></div>`)
  const send = async () => {
    const i = qs('#cm-i', sh), t = i.value.trim(); if (!t) return
    try { const k = await post(`/posts/${p.id}/comments`, { text_body: t }); i.value = ''; list.push(k.user ? k : { ...k, user: S.me, text_body: t, created_at: Date.now() }); p.comment_count = (p.comment_count || 0) + 1; qs('#cm-l', sh).innerHTML = draw(); if (el && el.isConnected) { el.outerHTML = postHTML(p); hydrate($('feedlist')) } else if (feedMode === 'reels') renderReels() } catch (er) { toast('⚠️ ' + er.message) }
  }
  qs('#cm-s', sh).onclick = send
  qs('#cm-i', sh).onkeydown = (e) => e.key === 'Enter' && send()
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
      if (feedMode === 'all' || feedMode === 'subs') { feedPosts.unshift(p); renderFeed() }
      toast('✅ Joylandi — video bo‘lsa Reels’da ko‘rinadi 🎬')
    } catch (e) { toast('⚠️ ' + e.message); btn.disabled = false; btn.textContent = 'Joylash' }
  }
}
$('b-post').onclick = () => postSheet(0)

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

// ============ ⚡ SHORTS: TikTok-uslubida to'liq ekran vertikal rejim ============
// Platform Reels (shifrlangan media) + dunyo trend Shorts'lari bitta cheksiz vertikal lentada.
let shMuted = localStorage.getItem('g50_shmute') !== '0'
let shList = [], shWrap = null, shObs = null, shKeyH = null, shWtTimer = null
let shPostsEnd = false, shTrPage = 0, shBusyMore = false, shLastTap = 0, shTapTimer = null, shFailStreak = 0

const shNormPosts = (list) => (Array.isArray(list) ? list : []).filter((p) => p.media_kind === 'video').map((p) => ({ t: 'post', p }))
// LIVE efirlar chiqariladi — ular qotib sekin ishlaydi (chet el jonli efirlari foydalanuvchi shikoyati)
const shNormTrend = (list) => (Array.isArray(list) ? list : []).filter((x) => x && (x.kind === 'short' || x.kind === 'video') && !x.live).map((x) => ({ t: 'trend', x }))

// YouTube player (nocookie — engilroq, O'zbekistonda ishonchli) + enablejsapi (postMessage boshqaruvi — reload'siz pauza/play)
function shYTURL(id) {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&loop=1&playlist=${id}&mute=${shMuted ? 1 : 0}&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
}
function shYTpost(f, func) { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*') } catch {} }

function shBindFrame(f) {
  const slide = f.closest('.sh-slide')
  if (!slide) return
  f.addEventListener('load', () => { slide.dataset.ok = '1'; const l = qs('.sh-load', slide); if (l) l.style.display = 'none' }, { once: true })
}
// YT ijro kuzatuvi: player postMessage yubormasa (bot-devori/bloklangan video) — avto-keyingi slayd
function shYTMsgBind(w) {
  if (w._shMsg) return
  w._shMsg = (e) => {
    try {
      const d = typeof e.data === 'string' ? e.data : ''
      if (!d || (d.indexOf('info_delivery') < 0 && d.indexOf('onStateChange') < 0 && d.indexOf('video:data') < 0)) return
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
    return `<div class="sh-slide" data-shi="${i}">
      <video data-media="${p.media_id}" loop playsinline preload="metadata"></video>
      <div class="sh-shade"></div>
      <div class="sh-bot">${who}${p.views ? `<small class="sh-vw">👁 ${p.views}</small>` : ''}${p.text_body ? `<div class="sh-cap">${linkify(p.text_body)}</div>` : ''}</div>
      <div class="sh-acts">
        <button data-slike class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'}<i>${p.like_count || 0}</i></button>
        <button data-scmt>💬<i>${p.comment_count || 0}</i></button>
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
  if (x.mp4) pl = `<video src="${esc(x.mp4)}" loop playsinline preload="metadata" data-shaudio="${esc(x.audio || '')}" poster="${esc(x.image || '')}"></video>`
  else if (x.yt) pl = `<iframe data-shyt="1" src="about:blank" data-shsrc="${esc(shYTURL(x.yt))}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`
  else if (x.ig) pl = `<iframe src="about:blank" data-shsrc="https://www.instagram.com/reel/${esc(x.ig)}/embed/captioned/" allow="autoplay; encrypted-media" allowfullscreen frameborder="0"></iframe>`
  else pl = `<iframe src="about:blank" data-shsrc="https://geo.dailymotion.com/player.html?video=${esc(x.embed)}&autoplay=1&mute=${shMuted ? 1 : 0}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen frameborder="0"></iframe>`
  const ttl = x.live ? '🔴 Jonli efir — ' + (x.title || '') : x.title
  return `<div class="sh-slide" data-shi="${i}" data-ttrend="1"${bg}>
    ${pl}
    <div class="sh-load"><i></i><i></i><i></i></div>
    <div class="sh-failbox">⏳ Video yuklanmadi — internet sekin bo'lishi mumkin<br><a href="${esc(x.url || '#')}" target="_blank" rel="noopener">Boshqa oynada ochish ↗</a> · Pastga suring — keyingi video</div>
    <div class="sh-shade"></div>
    <div class="sh-bot"><b>${esc(ttl)}</b><small>${x.views ? '👁 ' + fmtN(x.views) : ''}${x.duration ? ' · ' + fmtDur(x.duration) : ''}</small></div>
    <div class="sh-acts"><button data-ssh>↗️</button></div>
    <div class="sh-prog"><i></i></div>
    <div class="sh-play">▶</div>
  </div>`
}

function shBindVideo(v) {
  v.muted = shMuted
  const slide = v.closest('.sh-slide')
  const prog = qs('.sh-prog i', slide)
  v.addEventListener('timeupdate', () => { if (prog && v.duration) prog.style.width = (v.currentTime / v.duration) * 100 + '%' })
  v.addEventListener('loadeddata', () => { const l = qs('.sh-load', slide); if (l) l.style.display = 'none' }, { once: true })
  v.addEventListener('error', () => { const l = qs('.sh-load', slide); if (l) l.style.display = 'none'; slide.classList.add('sh-fail') }, { once: true })
  v.addEventListener('play', () => slide.classList.remove('paused'))
  v.addEventListener('pause', () => slide.classList.add('paused'))
  v.addEventListener('canplay', () => { if (slide.dataset.on === '1') v.play().catch(() => {}) })
  // Reddit mp4: audio treksi alohida faylda — sinxron oqim
  const aurl = v.dataset.shaudio
  if (aurl) {
    const a = new Audio()
    const AURLS = [aurl, aurl.replace('AUDIO_128', 'AUDIO_64'), aurl.replace(/DASH_AUDIO_\d+\.mp4/, 'DASH_audio.mp4')]
    let tr = 0
    const setA = () => { if (tr < AURLS.length) { a.src = AURLS[tr++]; return true } return false }
    setA()
    a.onerror = () => { if (setA()) a.load() }
    v.addEventListener('play', () => { if (a.src) { try { a.currentTime = v.currentTime; if (!shMuted) a.play().catch(() => {}) } catch {} } })
    v.addEventListener('pause', () => { try { a.pause() } catch {} })
    v.addEventListener('seeked', () => { try { a.currentTime = v.currentTime } catch {} })
    const syncM = () => { a.muted = v.muted; if (!v.muted && !v.paused) a.play().catch(() => {}) }
    v.addEventListener('volumechange', syncM)
    v.addEventListener('play', syncM)
    v._shAudio = a
  }
  v.addEventListener('click', () => shTap(slide, v))
}
function shTap(slide, v) {
  const t = Date.now()
  if (t - shLastTap < 300) {
    clearTimeout(shTapTimer); shLastTap = 0
    const it = shList[+slide.dataset.shi]
    if (it && it.t === 'post') shLike(it.p, slide, true) // ikki marta bosish = like
    return
  }
  shLastTap = t
  shTapTimer = setTimeout(() => {
    if (!v || !v.src) return
    v.paused ? v.play().catch(() => {}) : v.pause()
  }, 260)
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
  // YT iframe: postMessage bilan (reload'siz — tez); yuklanmaganlari URL'i yangilanadi
  qsa('iframe[data-shyt]', shWrap).forEach((f) => {
    if (f.dataset.loaded === '1') { shYTpost(f, m ? 'mute' : 'unMute'); if (!m) shYTpost(f, 'playVideo') }
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
  const i = +slide.dataset.shi
  const it = shList[i]
  if (it && it.t === 'trend') tev('video', 'imp') // analiz tizimiga ko'rish
  const v = qs('video', slide)
  if (v) {
    v.muted = shMuted
    if (v.preload !== 'auto') v.preload = 'auto'
    v.play().catch(() => {})
  }
  const nx = qs(`.sh-slide[data-shi="${i + 1}"] video`, w)
  if (nx) nx.preload = 'auto'
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
        ifr.src = ifr.dataset.shsrc || ''
        shBindFrame(ifr)
      }
    } else if (ifr.dataset.loaded !== '1' && ifr.dataset.shsrc) {
      ifr.dataset.loaded = '1'
      ifr.src = ifr.dataset.shsrc
      shBindFrame(ifr)
    }
    // Qora ekran himoyasi: 5s ichida yuklanmasa — xabar + 2.5s'dan keyin avto-keyingi slayd
    slide.classList.remove('sh-fail')
    const ld = qs('.sh-load', slide)
    if (ld) ld.style.display = ifr.dataset.ok === '1' ? 'none' : ''
    clearTimeout(slide._shwd)
    clearTimeout(slide._shauto)
    slide._shwd = setTimeout(() => {
      if (!slide.dataset.ok && shWrap && slide.isConnected) {
        slide.classList.add('sh-fail')
        const l2 = qs('.sh-load', slide)
        if (l2) l2.style.display = 'none'
        // Avto-o'tish: 3 ketma-ket muvaffaqiyatsizlikdan keyin to'xtaydi
        shFailStreak++
        if (shFailStreak < 3 && slide.dataset.on === '1') {
          slide._shauto = setTimeout(() => { if (shWrap && slide.dataset.on === '1' && slide.dataset.ok !== '1') { shGo(+slide.dataset.shi + 1); toast('⏭ Video yuklanmadi — keyingi', 1500) } }, 2500)
        } else if (shFailStreak >= 3) toast('⚠️ Bir nechta video yuklanmadi — internetni tekshiring', 3000)
      } else shFailStreak = 0
    }, 5000)
    // YT IJRO KUZATUVI: iframe yuklandi lekin player 9s ichida o'ynamasa (bloklangan/bot-devor) — avto-keyingi
    if (ifr.dataset.shyt) {
      clearTimeout(slide._shytw)
      slide._shytw = setTimeout(() => {
        if (shWrap && slide.isConnected && slide.dataset.on === '1' && slide.dataset.ok === '1' && slide.dataset.playing !== '1') {
          shFailStreak++
          if (shFailStreak < 3) {
            slide.classList.add('sh-fail')
            slide._shauto = setTimeout(() => { if (shWrap && slide.dataset.on === '1' && slide.dataset.playing !== '1') { shGo(+slide.dataset.shi + 1); toast('⏭ Video ochilmadi — keyingi', 1500) } }, 1800)
          } else toast('⚠️ Videolar ochilmayapti — internetni tekshiring', 3000)
        } else if (slide.dataset.playing === '1') shFailStreak = 0
      }, 9000)
    }
  }
  // PRELOAD: keyingi slayd YT bo'lsa — 1.5s'dan keyin fonda (mute) yuklanadi → scroll qilsa DARHAL ijro
  clearTimeout(w._shpre)
  w._shpre = setTimeout(() => {
    const ns = qs(`.sh-slide[data-shi="${i + 1}"]`, w)
    const nf = ns && qs('iframe[data-shyt]', ns)
    if (nf && nf.dataset.loaded !== '1' && nf.dataset.shsrc) {
      nf.dataset.loaded = '1'
      nf.src = nf.dataset.shsrc
      shBindFrame(nf)
    }
  }, 1500)
}
function shDeactivate(slide) {
  slide.dataset.on = ''
  const v = qs('video', slide)
  if (v) { v.pause(); if (v._shAudio) { try { v._shAudio.pause() } catch {} } }
}
function shAppend(items) {
  if (!items.length || !shWrap) return
  const sc = qs('.sh-scroll', shWrap)
  const base = shList.length
  shList.push(...items)
  sc.insertAdjacentHTML('beforeend', items.map((it, k) => shSlideHTML(it, base + k)).join(''))
  const fresh = qsa('.sh-slide', sc).slice(base)
  fresh.forEach((s) => { shObs && shObs.observe(s); qsa('video', s).forEach(shBindVideo) }) // iframe shBindFrame — faqat yuklanganda (about:blank load hodisasi aldamasligi uchun)
  hydrate(sc)
}
async function shMore() {
  if (shBusyMore) return
  shBusyMore = true
  try {
    const posts = shList.filter((x) => x.t === 'post')
    if (!shPostsEnd) {
      const before = posts.length ? Math.min(...posts.map((x) => x.p.id)) : 0
      const r = await api('/reels' + (before ? '?before=' + before : ''))
      const items = shNormPosts(r)
      if (items.length < 10) shPostsEnd = true
      shAppend(items)
    } else {
      shTrPage++
      const r = await api('/trend?cat=video&page=' + shTrPage)
      const items = shNormTrend(r)
      if (!items.length) { shPostsEnd = false; shTrPage = 0 } // cheksiz lenta: qaytadan boshlaydi
      shAppend(items)
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
    clearInterval(shWtTimer); shObs && shObs.disconnect(); shKeyH && document.removeEventListener('keydown', shKeyH)
    if (shWrap._shMsg) { window.removeEventListener('message', shWrap._shMsg); shWrap._shMsg = null }
    clearTimeout(shWrap._shpre)
    qsa('video', shWrap).forEach((v) => { try { v.pause(); if (v._shAudio) v._shAudio.pause() } catch {} })
    qsa('.sh-slide', shWrap).forEach((s) => { clearTimeout(s._shwd); clearTimeout(s._shauto); clearTimeout(s._shytw) })
  } catch {}
  const w = shWrap
  shWrap = null
  w.classList.remove('on')
  document.body.classList.remove('sh-lock')
  setTimeout(() => w.remove(), 220)
}
async function shortsStart(opt = {}) {
  try {
    let posts = shNormPosts(feedPosts)
    if (opt.post && !posts.some((x) => x.p.id === opt.post.id)) posts.unshift({ t: 'post', p: opt.post })
    // TREND SHORTS TO'SIQ QILMAYDI: keshda bo'lsa darhol qo'shamiz, yo'q bo'lsa ilova OCHILGACH fonda yuklanadi.
    // Avval: shortsStart ikkala API'ni ketma-ket kutardi — sekin API butun Shorts'ni bloklaydi (asosiy sekinlik sababi).
    let tr = shNormTrend(trendItems.filter((x) => x.kind === 'short'))
    if (!tr.length && opt.trend) { try { tr = shNormTrend(await api('/trend?cat=video&page=1')) } catch {} }
    if (opt.trend && !tr.some((x) => x.x.id === opt.trend.id)) tr.unshift({ t: 'trend', x: opt.trend })
    if (!posts.length && !tr.length && !opt.trend) {
      // Hech narsa yo'q — ikkala manba PARALLEL kutiladi (ketma-ket emas!)
      const [rp, rt] = await Promise.allSettled([api('/reels'), api('/trend?cat=video&page=1')])
      if (rp.status === 'fulfilled') posts = shNormPosts(rp.value)
      if (rt.status === 'fulfilled') tr = shNormTrend(rt.value)
    }
    if (!posts.length && !tr.length) return toast('Hali video yo‘q — Lenta’da 🎬 Reels’dan video post joylang!')
    const list = []
    let pi = 0, ti = 0
    while (pi < posts.length || ti < tr.length) {
      if (ti < tr.length) list.push(tr[ti++])
      if (ti < tr.length) list.push(tr[ti++])
      if (pi < posts.length) list.push(posts[pi++])
    }
    let idx = 0
    if (opt.post) idx = list.findIndex((x) => x.t === 'post' && x.p.id === opt.post.id)
    else if (opt.trend) idx = list.findIndex((x) => x.t === 'trend' && x.x.id === opt.trend.id)
    openShorts(list, Math.max(0, idx))
    // FONDA: trend shorts hali qo'shilmagan bo'lsa — yuklab slaydlar oxiriga qo'shiladi (cheksiz lenta)
    if (!opt.trend && tr.length < 6) {
      api('/trend?cat=video&page=1').then((r) => {
        const more = shNormTrend(r).filter((x) => !list.some((y) => y.t === 'trend' && y.x.id === x.x.id))
        if (more.length && shWrap) shAppend(more)
      }).catch(() => {})
    }
  } catch (e) { toast('⚠️ ' + e.message) }
}
function openShorts(list, startIdx = 0) {
  shClose()
  shList = list
  shPostsEnd = false; shTrPage = 1
  const w = document.createElement('div')
  w.id = 'shorts'
  w.innerHTML = `<div class="sh-top"><button class="sh-x" id="sh-x">✕</button><b>⚡ Shorts</b><div class="sh-sp"></div><button class="sh-mute" id="sh-m">${shMuted ? '🔇' : '🔊'}</button></div>
  <div class="sh-scroll">${list.map(shSlideHTML).join('')}</div>`
  document.body.appendChild(w)
  document.body.classList.add('sh-lock')
  shWrap = w
  shYTMsgBind(w)
  requestAnimationFrame(() => {
    w.classList.add('on')
    const sc = qs('.sh-scroll', w)
    hydrate(sc)
    qsa('video', sc).forEach(shBindVideo) // iframe'lar lazy — faqat faol slayd yuklanadi (shActivate ichida bind)
    // Boshqaruv
    w.addEventListener('click', async (e) => {
      if (e.target.closest('#sh-x')) return shClose()
      if (e.target.closest('#sh-m')) return shSetMuted(!shMuted)
      const slide = e.target.closest('.sh-slide')
      if (!slide) return
      const it = shList[+slide.dataset.shi]
      if (!it) return
      if (e.target.closest('[data-slike]')) return shLike(it.p, slide)
      if (e.target.closest('[data-scmt]')) return commentsSheet(it.p, null)
      if (e.target.closest('[data-ssh]')) return it.t === 'post' ? share((it.p.text_body || '50 Gram Shorts').slice(0, 100), location.origin + location.pathname) : share((it.x.title || 'Shorts').slice(0, 80), it.x.url || location.origin)
      if (e.target.closest('[data-sdel]')) {
        if (!(await confirmBox('Video o‘chirilsinmi?', 'O‘chirish'))) return
        try { await del('/posts/' + it.p.id); if (it.p.media_id) Store.remove([String(it.p.media_id)]); shList.splice(+slide.dataset.shi, 1); slide.remove(); qsa('.sh-slide', sc).forEach((s, i) => (s.dataset.shi = i)); toast('O‘chirildi') } catch (er) { toast('⚠️ ' + er.message) }
        return
      }
      const who = e.target.closest('[data-shwho]')
      if (who) { const q = who.dataset.shwho; if (q[0] === 'u') openUser(+q.slice(1)); else { const ch = S.chats.get(+q.slice(1)); ch && ch.joined !== false ? openChat(ch.id) : chatPreview(it.p.chat) } }
    })
    if ('IntersectionObserver' in window) {
      shObs = new IntersectionObserver((es) => {
        for (const en of es) {
          if (en.isIntersecting && en.intersectionRatio > 0.6) shActivate(w, en.target)
          else shDeactivate(en.target)
        }
      }, { root: sc, threshold: [0, 0.6, 1] })
      qsa('.sh-slide', sc).forEach((s) => shObs.observe(s))
    }
    sc.addEventListener('scroll', () => { if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < innerHeight * 1.5) shMore() }, { passive: true })
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
  })
}
$('b-shorts').onclick = () => shortsStart({})
