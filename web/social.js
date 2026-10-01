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
}
function trendSkeleton() {
  return `<div class="tgrid">${Array(6).fill('<div class="tcard sk"><div class="skimg"></div><div class="tcb"><b>‎</b><small>‎</small></div></div>').join('')}</div>`
}
async function loadTrend(reset) {
  if (trendBusy) return
  if (reset) { trendItems = []; trendPage = 0; trendEnd = false; $('feedlist').innerHTML = trendSkeleton() }
  if (trendEnd) return
  trendBusy = true
  try {
    trendPage++
    const q = `?page=${trendPage}` + (trendCat !== 'all' ? '&cat=' + trendCat : '') + (trendCat === 'all' && trendPage === 1 ? '&cats=' + encodeURIComponent(catsParam()) : '')
    const r = await api('/trend' + q)
    const list = r.items || []
    trendItems.push(...list)
    if (!list.length) trendEnd = true
    renderTrend()
  } catch (e) { if (reset) $('feedlist').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; trendPage-- } finally { trendBusy = false }
}
function openTrendNews(x) {
  tintAdd(x.cat)
  sheet(`<div class="tnews">${x.image ? `<img src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">` : ''}<span class="tch">${TCATS[x.cat] ? TCATS[x.cat][0] + ' ' + TCATS[x.cat][1] : '📰 Yangilik'}</span><h2>${esc(x.title)}</h2><small class="mut">${fmtAgo(x.time)}</small>${x.snippet ? `<p>${esc(x.snippet)}</p>` : ''}<a class="btn big" href="${esc(x.url)}" target="_blank" rel="noopener">🌐 To‘liq o‘qish</a></div>`)
}
function openTrendVideo(x) {
  tintAdd('video')
  const o = document.createElement('div')
  o.className = 'tvo'
  o.innerHTML = `<button class="xb">✕</button><div class="tvb"><iframe src="https://geo.dailymotion.com/player.html?video=${esc(x.embed)}&autoplay=1" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe><div class="tvi"><b>${esc(x.title)}</b><small>${fmtAgo(x.time)}${x.views ? ' · 👁 ' + fmtN(x.views) : ''}</small><button class="btn gh" data-vsh>↗️ Ulashish</button></div></div>`
  document.body.appendChild(o)
  requestAnimationFrame(() => o.classList.add('on'))
  qs('.xb', o).onclick = () => { o.classList.remove('on'); setTimeout(() => o.remove(), 200) }
  qs('[data-vsh]', o).onclick = () => share((x.title || 'Video').slice(0, 80), x.url)
  o.onclick = (e) => { if (e.target === o) qs('.xb', o).click() }
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
    if (tv) { const x = trendItems.find((v) => v.id === tv.dataset.tv); if (x) openTrendVideo(x) }
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
    const v = qs('video', reel)
    if (v) v.paused ? v.play().catch(() => {}) : v.pause()
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
