/* 50 Gram — suhbat oynasi: xabarlar, media, ovozli va dumaloq video xabarlar, emoji/stiker/GIF */
'use strict'
let replyTo = null, editId = 0, recMode = localStorage.getItem('g50_rec') || 'voice'

// ---------------- Stiker va GIF to'plamlari ----------------
const EMOJI = {
  'Yuzlar': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 🤗 🤔 🤭 🤫 😶 😐 🙄 😬 😴 🤤 😷 🤒 🤠 😈 👻 💀 🤖 💩',
  'Qo‘llar': '👋 🤚 ✋ 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 👏 🙌 🤲 🤝 🙏 💪 ✍️',
  'Yurak': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💞 💓 💗 💖 💘 💝 💯 🔥 ✨ ⭐ 🌟 💥 🎉 🎊',
  'Tabiat va taom': '🌹 🌷 🌸 🌻 🌲 🌴 🍁 ☀️ 🌙 ⛅ 🌧 ❄️ 🌊 🐱 🐶 🦁 🐼 🐎 🦋 🍉 🍇 🍎 🍑 🍒 🍞 🥭 🍔 🍕 🍰 ☕ 🍵 🫖',
  'Narsalar': '⚽ 🏀 🏆 🎵 🎧 🎮 📱 💻 📷 🎁 💰 💳 🚗 ✈️ 🏠 🕌 📚 ✏️ 📌 ⏰ 🔑 🇺🇿',
}
const STICKERS = [
  ['👋', 'a-wave'], ['😂', 'a-jump'], ['😍', 'a-pulse'], ['🥳', 'a-raqs'], ['😭', 'a-shake'], ['😎', 'a-float'], ['🔥', 'a-pulse'], ['❤️', 'a-pulse'],
  ['👍', 'a-pop'], ['😡', 'a-shake'], ['🤔', 'a-flip'], ['💃', 'a-raqs'], ['🎉', 'a-spin'], ['😴', 'a-float'], ['🙈', 'a-shake'], ['🤗', 'a-pop'],
  ['🐱', 'a-jump'], ['🐶', 'a-wave'], ['🌟', 'a-spin'], ['🚀', 'a-float'], ['🌹', 'a-pop'], ['🍉', 'a-spin'], ['☕', 'a-float'], ['💪', 'a-pulse'],
]
const GIFS = [
  { k: 'salom', bg: 'linear-gradient(135deg,#FFD86F,#FC6262)', e: '👋', a: 'a-wave', t: 'Salom!' },
  { k: 'kulgi', bg: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)', e: '🤣', a: 'a-jump', t: 'Ha-ha-ha!' },
  { k: 'raqs', bg: 'linear-gradient(135deg,#f093fb,#f5576c)', e: '🕺', a: 'a-raqs', e2: '🎵', a2: 'a-orbit', t: 'Raqs vaqti!' },
  { k: 'yugur', bg: 'linear-gradient(135deg,#43e97b,#38f9d7)', e: '🏃', a: 'a-run', t: 'Ketdik!' },
  { k: 'sevgi', bg: 'linear-gradient(135deg,#ff9a9e,#fecfef)', e: '💖', a: 'a-pulse', e2: '💕', a2: 'a-orbit', t: 'Yaxshi ko‘raman' },
  { k: 'tabrik', bg: 'linear-gradient(135deg,#667eea,#764ba2)', e: '🎂', a: 'a-pop', e2: '🎉', a2: 'a-rain', t: 'Tabriklayman!' },
  { k: 'rahmat', bg: 'linear-gradient(135deg,#fddb92,#d1fdff)', e: '🙏', a: 'a-pulse', t: 'Rahmat!' },
  { k: 'yomg', bg: 'linear-gradient(135deg,#89f7fe,#66a6ff)', e: '☂️', a: 'a-float', e2: '💧', a2: 'a-rain', t: 'Yomg‘ir yog‘yapti' },
  { k: 'mushuk', bg: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)', e: '🐈', a: 'a-run', t: 'Mushukcha sayri' },
  { k: 'raketa', bg: 'linear-gradient(135deg,#0f2027,#2c5364)', e: '🚀', a: 'a-float', e2: '⭐', a2: 'a-orbit', t: 'Uchdik!' },
  { k: 'ok', bg: 'linear-gradient(135deg,#84fab0,#8fd3f4)', e: '👌', a: 'a-flip', t: 'Kelishdik!' },
  { k: 'uyqu', bg: 'linear-gradient(135deg,#30cfd0,#330867)', e: '😴', a: 'a-float', e2: '🌙', a2: 'a-orbit', t: 'Xayrli tun' },
]
const REACTS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']
function gifHTML(k) {
  const g = GIFS.find((x) => x.k === k) || GIFS[0]
  return `<div class="gif" style="background:${g.bg}"><span class="gb">GIF</span><span class="g1 ${g.a}">${g.e}</span>${g.e2 ? `<span class="g2 ${g.a2}">${g.e2}</span>` : ''}<span class="gt">${esc(g.t)}</span></div>`
}

// ---------------- Chatni ochish ----------------
async function openChat(id) {
  id = +id
  closeAllSheets()
  S.cur = id
  replyTo = null; editId = 0; setReply()
  $('picker').classList.remove('on')
  $('dialog').classList.add('open')
  let c = S.chats.get(id)
  if (!c) {
    try { c = await api('/chats/' + id); S.chats.set(id, c) } catch (e) { toast('⚠️ ' + e.message); return closeChat() }
  }
  $('msgs').innerHTML = '<div class="spin"></div>'
  await loadChatLocal(id)
  if (S.cur !== id) return
  renderHeader(); renderMsgs(true); renderChats()
  await fetchMessages(id)
  markRead(id)
}
function closeChat() {
  S.cur = null
  $('dialog').classList.remove('open')
  $('picker').classList.remove('on')
  renderChats()
}
$('d-back').onclick = closeChat
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.cur && !qs('.shbg') && !qs('.over')) closeChat() })

function renderHeader() {
  const c = S.chats.get(S.cur)
  if (!c) return
  $('d-av').innerHTML = c.type === 'direct' ? avHTML(c.peer, 40, { saved: c.saved }) : avHTML(c, 40, { chat: true })
  $('d-title').textContent = chatName(c)
  const ty = typingText(c.id)
  const sub = ty || (c.type === 'direct' ? (c.saved ? 'o‘zingiz uchun' : lastSeen(c.peer)) : `${c.member_count || 0} ${c.type === 'channel' ? 'obunachi' : 'a‘zo'}`)
  $('d-sub').textContent = sub
  $('d-sub').classList.toggle('on', !!ty || (c.type === 'direct' && !!c.peer?.online))
  const direct = c.type === 'direct' && !c.saved
  $('d-call').classList.toggle('hide', !direct)
  $('d-video').classList.toggle('hide', !direct)
  const adm = c.role === 'owner' || c.role === 'admin'
  const joined = c.joined !== false
  let ro = ''
  if (joined && c.type === 'channel' && !adm) ro = `<button class="btn gh" id="ro-mute">${c.muted ? '🔔 Ovozni yoqish' : '🔕 Ovozsiz'}</button>`
  else if (joined && c.type === 'group' && !adm && c.permissions && !c.permissions.send) ro = '<span class="mut">🔒 Guruhda faqat adminlar yozadi</span>'
  $('d-joinbar').classList.toggle('hide', joined)
  if (!joined) {
    $('d-joinbar').innerHTML = c.banned ? '<span class="mut">Siz bu chatdan chetlatilgansiz</span>'
      : c.requested ? '<span class="mut">⏳ So‘rovingiz admin tasdig‘ini kutmoqda</span>'
        : `<button class="btn" id="jb-join">${c.join_approval ? 'Qo‘shilish so‘rovi' : c.type === 'channel' ? 'Obuna bo‘lish' : 'Guruhga qo‘shilish'}</button>`
    const jb = $('jb-join'); if (jb) jb.onclick = () => joinChat(c.id, c.invite_hash)
  }
  $('d-ro').classList.toggle('hide', !ro)
  $('d-ro').innerHTML = ro
  const rm = $('ro-mute'); if (rm) rm.onclick = () => toggleMute(c)
  $('d-comp').classList.toggle('hide', !joined || !!ro)
}
async function toggleMute(c) {
  try { await post(`/chats/${c.id}/mute`, { muted: c.muted ? 0 : 1 }); c.muted = c.muted ? 0 : 1; renderHeader(); renderChats() } catch (e) { toast('⚠️ ' + e.message) }
}
async function joinChat(id, hash) {
  try {
    const r = await post(`/chats/${id}/join`, { hash: hash || undefined })
    if (r.requested) { toast('✅ So‘rov yuborildi'); const c = S.chats.get(id); if (c) { c.requested = true; renderHeader() } return }
    if (r.chat) S.chats.set(id, { ...r.chat, joined: true })
    else { const c = await api('/chats/' + id); S.chats.set(id, c) }
    closeAllSheets()
    await openChat(id)
    loadChats().catch(() => {})
  } catch (e) { toast('⚠️ ' + e.message) }
}
$('d-info').onclick = () => {
  const c = S.chats.get(S.cur); if (!c) return
  if (c.type === 'direct') { if (!c.saved && c.peer) openUser(c.peer.id) } else openChatInfo(c.id)
}
$('d-av').onclick = (e) => { if (!e.target.closest('[data-story]')) $('d-info').onclick() }
$('d-more').onclick = () => $('d-info').onclick()
$('d-call').onclick = () => { const c = S.chats.get(S.cur); if (c?.peer) callUser(c.peer.id, false) }
$('d-video').onclick = () => { const c = S.chats.get(S.cur); if (c?.peer) callUser(c.peer.id, true) }

// ---------------- Xabarlarni olish ----------------
const fetching = new Set()
async function fetchMessages(id) {
  if (fetching.has(id)) return
  fetching.add(id)
  try {
    await loadChatLocal(id)
    for (let round = 0; round < 10; round++) {
      const list = S.msgs.get(id) || []
      const after = list.reduce((a, m) => (m.id > 0 && !m.p2p && m.id > a ? m.id : a), 0)
      const since = S.since.get(id) || 0
      const r = await api(`/chats/${id}/messages?after=${after}&since=${since}`)
      merge(id, r.messages, r.users)
      S.since.set(id, r.now)
      const c = S.chats.get(id)
      if (c && r.peer_last_read !== null && r.peer_last_read !== undefined) c.peer_last_read = r.peer_last_read
      if (!r.more) break
    }
    saveChatLocal(id)
    if (S.cur === id) renderMsgs()
  } catch (e) {
    if (S.cur === id && !(S.msgs.get(id) || []).length) $('msgs').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`
  } finally { fetching.delete(id) }
}
function noteMedia(m) {
  const mt = m.meta
  if (mt && mt.media_id) P2P.note(String(mt.media_id), { chat: m.chat_id, sha: mt.sha, size: mt.size, key: mt.key, iv: mt.iv, mime: mt.mime })
}
// Serverdan yoki tarmoqdan kelgan xabarlarni qurilmadagi ro'yxatga qo'shish
function merge(id, msgs, users) {
  if (users) for (const k in users) S.users.set(+k, users[k])
  let list = S.msgs.get(id) || []
  for (const m of msgs || []) {
    if (!m || m.chat_id !== id) continue
    if (m.client_id) list = list.filter((x) => !(x.pending && x.client_id === m.client_id))
    const i = list.findIndex((x) => x.id === m.id)
    if (i >= 0) {
      const old = list[i]
      if (m.deleted && old.meta?.media_id) Store.remove([String(old.meta.media_id)])
      if (old.p2p && !m.p2p) list[i] = m
      else if (!m.p2p) list[i] = m
    } else list.push(m)
    noteMedia(m)
  }
  list.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.created_at - b.created_at || a.id - b.id)
  S.msgs.set(id, list)
}
function markRead(id) {
  if (document.hidden) return
  const c = S.chats.get(id)
  if (!c || c.joined === false) return
  const last = (S.msgs.get(id) || []).reduce((a, m) => (m.id > 0 && !m.p2p && m.id > a ? m.id : a), 0)
  if (!last || (c.last_read >= last && !c.unread)) return
  c.last_read = last; c.unread = 0
  scheduleChats()
  post(`/chats/${id}/read`, { last_id: last }).catch(() => {})
}

// ---------------- Xabarlarni chizish ----------------
// OPTIMIZATSIYA: to'liq innerHTML o'rniga faqat o'zgargan qatorlar DOM'da almashtiriladi
function renderMsgs(force) {
  const box = $('msgs'), c = S.chats.get(S.cur)
  if (!c) return
  const list = S.msgs.get(S.cur) || []
  const atBottom = force || box.scrollHeight - box.scrollTop - box.clientHeight < 140
  const keys = [], rows = []
  if (c.joined !== false && P2P.enabled()) { keys.push('older'); rows.push('<div class="sys" data-older style="cursor:pointer">⬆️ Avvalgi xabarlarni a’zolar qurilmalaridan yuklash</div>') }
  let lastDay = '', prev = null
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const d = fmtDay(m.created_at)
    if (d !== lastDay) { keys.push('day:' + d); rows.push(`<div class="day">${esc(d)}</div>`); lastDay = d; prev = null }
    if (m.kind === 'system') {
      const who = m.body && !/yaratildi/.test(m.body) ? esc(uname(S.users.get(m.sender_id))) + ' ' : ''
      keys.push('s' + m.id); rows.push(`<div class="sys">${who}${esc(m.body || '')}</div>`); prev = null; continue
    }
    keys.push(m.id > 0 ? 'm' + m.id : 'p' + (m.client_id || m.id))
    rows.push(msgHTML(m, c, prev, list[i + 1]))
    prev = m
  }
  if (!list.length) { keys.push('empty'); rows.push(`<div class="empty"><span class="big">${c.type === 'channel' ? '📢' : '👋'}</span>${c.type === 'direct' ? 'Hali xabar yo‘q. Salom deb yozing!' : 'Hali xabarlar yo‘q'}</div>`) }
  diffInto(box, keys, rows)
  hydrate(box)
  if (atBottom) box.scrollTop = box.scrollHeight
}
const cap = (m) => (m.body ? `<div class="txt" style="margin-top:4px">${linkify(m.body)}</div>` : '')
function voiceHTML(m) {
  const mt = m.meta || {}
  const w = Array.isArray(mt.wave) && mt.wave.length ? mt.wave : Array.from({ length: 32 }, (_, i) => 6 + ((i * 7) % 18))
  return `<div class="voice" data-voice><button class="pb">▶</button><div class="wave">${w.map((h) => `<i style="height:${Math.max(3, Math.min(30, +h || 3))}px"></i>`).join('')}</div><small>${fmtDur(mt.dur || 0)}</small><audio ${mt.local ? `src="${mt.local}"` : `data-media="${mt.media_id}"`} preload="none"></audio></div>`
}
function pollHTML(m) {
  const mt = m.meta || {}, v = m.votes || {}, opts = mt.options || []
  const total = Object.values(v).reduce((a, b) => a + b, 0)
  const voted = m.my_vote >= 0
  return `<div class="poll"><div class="q">📊 ${esc(mt.q || '')}</div><small class="mut">${total} ovoz</small>${opts.map((o, i) => {
    const p = total ? Math.round(((v[i] || 0) * 100) / total) : 0
    return `<div class="o ${m.my_vote === i ? 'mine' : ''}" data-vote="${i}"><i style="width:${voted ? p : 0}%"></i><span>${esc(o)}</span>${voted ? `<em>${p}%</em>` : ''}</div>`
  }).join('')}</div>`
}
function msgHTML(m, c, prev, next) {
  const me = m.sender_id === S.me.id && c.type !== 'channel'
  const grp = c.type === 'group'
  const near = (a, b) => a && b && a.sender_id === b.sender_id && a.kind !== 'system' && b.kind !== 'system' && Math.abs(b.created_at - a.created_at) < 300000
  const samePrev = near(prev, m), sameNext = near(m, next)
  const u = S.users.get(m.sender_id)
  const mt = m.meta || {}
  const sender = grp && !me && !samePrev ? `<div class="snd" data-u="${m.sender_id}" style="color:${colorFor(m.sender_id)}">${esc(uname(u))}</div>` : ''
  const gav = grp && !me ? `<div class="gav">${sameNext ? '' : `<span data-u="${m.sender_id}">${avHTML(u, 32, { noStory: true })}</span>`}</div>` : ''
  let body = '', bare = false, emo = false
  const src = (cls, extra = '') => mt.local ? `src="${mt.local}" class="${cls}" ${extra}` : `data-media="${mt.media_id}" class="${cls}" ${extra}`
  if (m.deleted) body = '<span class="del">🚫 Xabar o‘chirildi</span>'
  else switch (m.kind) {
    case 'text': emo = isEmojiOnly(m.body); body = `<div class="txt">${linkify(m.body)}</div>`; break
    case 'photo': body = `<div style="position:relative"><img ${src('media', `data-view="${mt.media_id || ''}"`)} alt="">${m.pending ? '<div class="prog"><i></i></div>' : ''}</div>${cap(m)}`; break
    case 'video': body = `<div style="position:relative"><video ${src('media')} controls playsinline preload="metadata"></video>${m.pending ? '<div class="prog"><i></i></div>' : ''}</div>${cap(m)}`; break
    case 'voice': body = voiceHTML(m); break
    case 'round': bare = true; body = `<div class="round" data-round><video ${src('')} playsinline loop preload="metadata"></video><span class="rd">${m.pending ? '⏳' : fmtDur(mt.dur || 0)}</span></div>`; break
    case 'file': body = `<div class="file" data-file="${mt.media_id || ''}" data-name="${esc(mt.name || 'fayl')}"><div class="fi">${m.pending ? '⏳' : '📄'}</div><div><b>${esc(mt.name || 'Fayl')}</b><small class="mut">${fmtSize(mt.fsize || mt.size || 0)}</small></div></div>${cap(m)}`; break
    case 'sticker': bare = true; body = `<span class="stk ${esc(mt.a || '')}">${esc(mt.e || '🙂')}</span>`; break
    case 'gif': bare = true; body = gifHTML(mt.g); break
    case 'contact': body = `<div class="ccard">${avHTML({ id: mt.user_id || 0, first_name: mt.name }, 44, { noStory: true })}<div><b>${esc(mt.name || '')}</b><small class="mut" style="display:block">${esc(mt.phone || '')}</small></div></div>${mt.user_id ? `<div class="cbtns"><button data-u="${mt.user_id}">Profil</button><button data-dm="${mt.user_id}">Xabar yozish</button></div>` : ''}`; break
    case 'location': body = `<a class="loc" href="https://maps.google.com/?q=${+mt.lat},${+mt.lng}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;display:block"><div class="map"><span>📍</span></div><b>Joylashuv</b><small class="mut" style="display:block">${(+mt.lat).toFixed(5)}, ${(+mt.lng).toFixed(5)}</small></a>`; break
    case 'poll': body = pollHTML(m); break
    case 'call': {
      const miss = mt.status === 'missed' || mt.status === 'declined'
      body = `<div class="callm ${miss ? 'miss' : ''}" data-callback="${mt.video ? 1 : 0}"><div class="ci">${mt.video ? '📹' : '📞'}</div><div><b>${miss ? 'O‘tkazib yuborilgan' : me ? 'Chiquvchi' : 'Kiruvchi'} qo‘ng‘iroq</b><small class="mut" style="display:block">${mt.dur ? fmtDur(mt.dur) : ''}</small></div></div>`
      break
    }
    default: body = `<div class="txt">${esc(m.body || '')}</div>`
  }
  const fwd = mt.fwd ? `<div class="fwd">↪️ ${esc(mt.fwd)} dan uzatildi</div>` : ''
  const rp = mt.reply ? `<div class="rp" data-goto="${mt.reply.id}"><b>${esc(mt.reply.n || '')}</b>${esc(mt.reply.t || '')}</div>` : ''
  let tick = ''
  if (me) tick = m.pending ? '<span class="tick">🕓</span>' : `<span class="tick">${c.type === 'direct' && c.peer_last_read >= m.id ? '✓✓' : '✓'}</span>`
  const meta = `<span class="meta">${m.p2p ? '<span title="Qurilmalar tarmog‘idan tiklangan">🕸</span>' : ''}${m.edited ? 'tahrirlandi ' : ''}${fmtTime(m.created_at)}${tick}</span>`
  const rx = m.reactions && Object.keys(m.reactions).length
    ? `<div class="rx">${Object.entries(m.reactions).map(([e, us]) => `<span data-rx="${esc(e)}" class="${us.includes(S.me.id) ? 'mine' : ''}">${esc(e)} ${us.length}</span>`).join('')}</div>` : ''
  const sig = c.type === 'channel' && c.settings?.signatures && u ? `<small class="mut" style="display:block">— ${esc(uname(u))}</small>` : ''
  return `<div class="mrow ${me ? 'me' : ''}" data-mid="${m.id}" ${m.client_id ? `data-cid="${esc(m.client_id)}"` : ''}>${gav}<div class="m ${bare || emo ? 'bare' : ''} ${emo ? 'emo' : ''} ${sameNext ? '' : 'tail'}">${fwd}${sender}${rp}${body}${sig}${meta}${rx}</div></div>`
}
const findMsg = (id) => (S.msgs.get(S.cur) || []).find((m) => String(m.id) === String(id))

// ---------------- Xabarlardagi bosishlar ----------------
let curAudio = null
$('msgs').addEventListener('click', async (e) => {
  const t = e.target
  if (t.closest('[data-older]')) return loadOlder()
  const uEl = t.closest('[data-u]'); if (uEl) return openUser(+uEl.dataset.u)
  const dm = t.closest('[data-dm]'); if (dm) return openDirectWith(+dm.dataset.dm)
  const row = t.closest('.mrow')
  const m = row && findMsg(row.dataset.mid)
  const g = t.closest('[data-goto]')
  if (g) { const el = qs(`.mrow[data-mid="${g.dataset.goto}"]`, $('msgs')); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.style.transition = 'background .6s'; el.style.background = 'var(--asos-och)'; setTimeout(() => (el.style.background = ''), 900) } else toast('Xabar qurilmada topilmadi'); return }
  const v = t.closest('[data-view]'); if (v && v.src) return viewImage(v.src)
  const f = t.closest('[data-file]')
  if (f && f.dataset.file) { try { toast('⬇️ Yuklanmoqda…'); const u = await mediaUrl(f.dataset.file); const a = document.createElement('a'); a.href = u; a.download = f.dataset.name || 'fayl'; document.body.appendChild(a); a.click(); a.remove() } catch (er) { toast('⚠️ ' + er.message) } return }
  const rd = t.closest('[data-round]')
  if (rd) { const vd = qs('video', rd); if (vd.paused) { qsa('[data-round] video').forEach((x) => x !== vd && x.pause()); vd.muted = false; vd.play().catch(() => {}) } else vd.pause(); return }
  const vc = t.closest('[data-voice]')
  if (vc && t.closest('.pb')) return playVoice(vc)
  const rx = t.closest('[data-rx]'); if (rx && m) return reactTo(m, rx.dataset.rx)
  const vo = t.closest('[data-vote]')
  if (vo && m && m.id > 0) { try { merge(S.cur, [await post(`/messages/${m.id}/vote`, { opt: +vo.dataset.vote })]); renderMsgs(); saveChatLocal(S.cur) } catch (er) { toast('⚠️ ' + er.message) } return }
  const cb = t.closest('[data-callback]')
  if (cb) { const c = S.chats.get(S.cur); if (c?.peer) callUser(c.peer.id, cb.dataset.callback === '1') }
})
function playVoice(vc) {
  const au = qs('audio', vc), pb = qs('.pb', vc), bars = qsa('.wave i', vc), sm = qs('small', vc)
  if (curAudio && curAudio !== au) curAudio.pause()
  if (!au.src) { toast('⏳ Yuklanmoqda…'); return }
  if (au.paused) {
    curAudio = au
    au.play().catch(() => toast('Ijro qilib bo‘lmadi'))
    pb.textContent = '⏸'
    au.ontimeupdate = () => {
      const p = au.duration && isFinite(au.duration) ? au.currentTime / au.duration : 0
      bars.forEach((b, i) => b.classList.toggle('p', i / bars.length < p))
      sm.textContent = fmtDur(au.currentTime)
    }
    au.onended = () => { pb.textContent = '▶'; bars.forEach((b) => b.classList.remove('p')); const nx = vc.closest('.mrow')?.nextElementSibling; const nv = nx && qs('[data-voice]', nx); if (nv) playVoice(nv) }
    au.onpause = () => { pb.textContent = '▶' }
  } else au.pause()
}
function viewImage(src, isVideo) {
  const o = document.createElement('div')
  o.className = 'over imgview'
  o.innerHTML = `<button class="xb">✕</button><a class="dl" href="${src}" download="50gram" style="display:flex;align-items:center;justify-content:center;text-decoration:none">⬇️</a>${isVideo ? `<video src="${src}" controls autoplay playsinline></video>` : `<img src="${src}" alt="">`}`
  o.onclick = (e) => { if (!e.target.closest('.dl') && e.target.tagName !== 'VIDEO') o.remove() }
  document.body.appendChild(o)
}
async function loadOlder() {
  const id = S.cur, list = S.msgs.get(id) || []
  const first = list.find((m) => m.id > 0)
  const el = qs('[data-older]', $('msgs'))
  if (el) el.textContent = '⏳ A’zolar qurilmalaridan qidirilmoqda…'
  try {
    const got = await P2P.history(id, first ? first.id : 0)
    if (!got.length) { toast('Avvalgi xabarlar topilmadi'); if (el) el.textContent = '⬆️ Avvalgi xabarlarni a’zolar qurilmalaridan yuklash'; return }
    const box = $('msgs'), h = box.scrollHeight
    merge(id, got)
    saveChatLocal(id)
    if (S.cur === id) { renderMsgs(); box.scrollTop = box.scrollHeight - h }
    toast(`🕸 ${got.length} ta xabar tiklandi`)
  } catch (e) { toast('⚠️ ' + e.message); if (el) el.textContent = '⬆️ Avvalgi xabarlarni a’zolar qurilmalaridan yuklash' }
}

// ---------------- Kontekst menyu ----------------
let pressT = 0
function ctxMenu(m, x, y) {
  const c = S.chats.get(S.cur)
  if (!m || m.id <= 0 || m.p2p || !c) return
  vibrate(10)
  const mine = m.sender_id === S.me.id
  const adm = c.role === 'owner' || c.role === 'admin'
  const canReact = !m.deleted && (c.type === 'direct' || c.settings?.reactions !== 0)
  const protect = c.type !== 'direct' && c.settings?.protect && !adm
  const items = []
  if (!m.deleted && c.joined !== false && !$('d-comp').classList.contains('hide')) items.push(['reply', '↩️', 'Javob berish'])
  if (!m.deleted && m.body && !protect) items.push(['copy', '📋', 'Nusxa olish'])
  if (!m.deleted && mine && m.kind === 'text') items.push(['edit', '✏️', 'Tahrirlash'])
  if (!m.deleted && !protect && m.kind !== 'call' && m.kind !== 'poll') items.push(['fwd', '↪️', 'Uzatish'])
  if (!m.deleted && m.meta?.media_id && !protect && ['photo', 'video', 'file', 'voice', 'round'].includes(m.kind)) items.push(['save', '⬇️', 'Saqlab olish'])
  if (!m.deleted && (mine || (c.type !== 'direct' && adm))) items.push(['del', '🗑', 'O‘chirish', 'red'])
  const bg = document.createElement('div'); bg.className = 'ctxbg'
  const box = document.createElement('div'); box.className = 'ctx'
  box.innerHTML = (canReact ? `<div class="rxr">${REACTS.map((r) => `<span data-r="${r}">${r}</span>`).join('')}</div>` : '') +
    items.map(([k, i, t, cl]) => `<div class="it ${cl || ''}" data-k="${k}"><span>${i}</span>${t}</div>`).join('')
  document.body.append(bg, box)
  const W = innerWidth, H = innerHeight, r = box.getBoundingClientRect()
  box.style.left = Math.max(8, Math.min(x, W - r.width - 8)) + 'px'
  box.style.top = Math.max(8, Math.min(y, H - r.height - 8)) + 'px'
  const close = () => { bg.remove(); box.remove() }
  bg.onclick = close
  box.onclick = async (e) => {
    const rr = e.target.closest('[data-r]'); if (rr) { close(); return reactTo(m, rr.dataset.r) }
    const it = e.target.closest('[data-k]'); if (!it) return
    close()
    const k = it.dataset.k
    if (k === 'reply') { replyTo = m; editId = 0; setReply(); $('inp').focus() }
    if (k === 'copy') copy(m.body)
    if (k === 'edit') { editId = m.id; replyTo = null; $('inp').value = m.body; setReply(); autoGrow(); $('inp').focus() }
    if (k === 'fwd') forwardMsg(m)
    if (k === 'save') { try { const u = await mediaUrl(m.meta.media_id); const a = document.createElement('a'); a.href = u; a.download = m.meta.name || ('50gram-' + m.id); document.body.appendChild(a); a.click(); a.remove() } catch (er) { toast('⚠️ ' + er.message) } }
    if (k === 'del') {
      if (!(await confirmBox(c.type === 'direct' ? 'Xabar ikkala tomonda ham o‘chirilsinmi?' : 'Xabar hamma uchun o‘chirilsinmi?', 'O‘chirish'))) return
      try { const r2 = await del('/messages/' + m.id); if (m.meta?.media_id) Store.remove([String(m.meta.media_id)]); merge(S.cur, [r2]); renderMsgs(); saveChatLocal(S.cur) } catch (er) { toast('⚠️ ' + er.message) }
    }
  }
}
$('msgs').addEventListener('contextmenu', (e) => { const row = e.target.closest('.mrow'); if (!row) return; e.preventDefault(); ctxMenu(findMsg(row.dataset.mid), e.clientX, e.clientY) })
$('msgs').addEventListener('touchstart', (e) => {
  const row = e.target.closest('.mrow'); if (!row) return
  const t = e.touches[0]
  pressT = setTimeout(() => { pressT = -1; ctxMenu(findMsg(row.dataset.mid), t.clientX, t.clientY) }, 480)
}, { passive: true })
$('msgs').addEventListener('touchmove', () => { if (pressT > 0) clearTimeout(pressT) }, { passive: true })
$('msgs').addEventListener('touchend', (e) => { if (pressT === -1) e.preventDefault(); else clearTimeout(pressT); pressT = 0 })
// Ikki marta bosish — tezkor 👍
$('msgs').addEventListener('dblclick', (e) => { const row = e.target.closest('.mrow'); const m = row && findMsg(row.dataset.mid); if (m && m.id > 0 && !m.deleted) reactTo(m, '❤️') })
async function reactTo(m, emoji) {
  if (!m || m.id <= 0) return
  try { merge(S.cur, [await post(`/messages/${m.id}/react`, { emoji })]); renderMsgs(); saveChatLocal(S.cur) } catch (e) { toast('⚠️ ' + e.message) }
}
function forwardMsg(m) {
  const list = [...S.chats.values()].filter((c) => c.joined && (c.type !== 'channel' || c.role === 'owner' || c.role === 'admin'))
  const sh = sheet(h3('Kimga uzatamiz?') + `<div class="list" style="max-height:60vh;overflow:auto">${list.map((c) => `<div class="item" data-to="${c.id}">${c.type === 'direct' ? avHTML(c.peer, 42, { saved: c.saved, noStory: true }) : avHTML(c, 42, { chat: true })}<div class="mid"><div class="t1"><b>${esc(chatName(c))}</b></div></div></div>`).join('')}</div>`)
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-to]'); if (!it) return
    const to = +it.dataset.to
    closeSheet(sh)
    const from = uname(S.users.get(m.sender_id))
    const meta = { ...(m.meta || {}), fwd: from }
    delete meta.reply
    try {
      if (meta.media_id) {
        toast('⏳ Uzatilmoqda…')
        const blob = await (await fetch(await mediaUrl(meta.media_id))).blob()
        const nid = await upload(blob, meta.name || 'fayl')
        Object.assign(meta, mediaInfo(nid))
      }
      await sendRaw(to, { kind: m.kind, body: m.body || undefined, meta })
      toast('✅ Uzatildi')
    } catch (er) { toast('⚠️ ' + er.message) }
  }
}

// ---------------- Javob / tahrir paneli ----------------
function setReply() {
  const on = replyTo || editId
  $('d-reply').classList.toggle('hide', !on)
  if (replyTo) { $('rb-n').textContent = '↩️ ' + uname(S.users.get(replyTo.sender_id)); $('rb-x').textContent = msgPreview(replyTo).replace(/^Siz: /, '') }
  else if (editId) { $('rb-n').textContent = '✏️ Tahrirlash'; $('rb-x').textContent = findMsg(editId)?.body || '' }
  setSendIcon()
}
$('rb-close').onclick = () => { if (editId) $('inp').value = ''; replyTo = null; editId = 0; setReply(); autoGrow() }

// ---------------- Yuborish ----------------
const newCid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
let tempSeq = 0
function pushTemp(chatId, kind, body, meta) {
  const client_id = newCid()
  const t = { id: -(Date.now() * 10 + (tempSeq++ % 10)), client_id, pending: true, chat_id: chatId, sender_id: S.me.id, kind, body: body || null, meta: meta || {}, created_at: Date.now() }
  const list = S.msgs.get(chatId) || []
  list.push(t); S.msgs.set(chatId, list)
  if (S.cur === chatId) renderMsgs(true)
  return t
}
function dropTemp(chatId, t) {
  S.msgs.set(chatId, (S.msgs.get(chatId) || []).filter((x) => x !== t))
  if (S.cur === chatId) renderMsgs()
}
function withReply(meta) {
  if (replyTo) meta.reply = { id: replyTo.id, n: uname(S.users.get(replyTo.sender_id)), t: msgPreview(replyTo).replace(/^Siz: /, '').slice(0, 80) }
  replyTo = null; setReply()
  return meta
}
async function sendRaw(chatId, b, temp) {
  if (!temp) temp = pushTemp(chatId, b.kind, b.body, b.meta)
  try {
    const m = await post(`/chats/${chatId}/messages`, { ...b, client_id: temp.client_id })
    merge(chatId, [m])
    const c = S.chats.get(chatId)
    if (c) { c.last_message = m; c.last_msg_at = m.created_at; c.last_read = m.id }
    saveChatLocal(chatId)
    if (S.cur === chatId) renderMsgs(true)
    renderChats()
    return m
  } catch (e) { dropTemp(chatId, temp); toast('⚠️ ' + e.message); throw e }
}
async function sendText() {
  const inp = $('inp'), text = inp.value.trim()
  if (!text || !S.cur) return
  const chatId = S.cur
  if (editId) {
    const id = editId
    editId = 0; inp.value = ''; setReply(); autoGrow()
    try { merge(chatId, [await patch('/messages/' + id, { body: text })]); renderMsgs(); saveChatLocal(chatId) } catch (e) { toast('⚠️ ' + e.message) }
    return
  }
  inp.value = ''; autoGrow(); setSendIcon()
  localStorage.removeItem('g50_draft_' + chatId)
  for (let i = 0; i < text.length; i += 4000) await sendRaw(chatId, { kind: 'text', body: text.slice(i, i + 4000), meta: i === 0 ? withReply({}) : {} }).catch(() => {})
}
async function sendFile(file, kind, extra = {}, chatId0) {
  const chatId = chatId0 || S.cur
  if (!chatId || !file) return
  if (file.size > 30 * 1024 * 1024) return toast('⚠️ Fayl 30 MB dan katta bo‘lmasin')
  const local = ['photo', 'video', 'voice', 'round'].includes(kind) ? URL.createObjectURL(file) : null
  const baseMeta = withReply({ ...(extra.meta || {}), name: file.name || kind, fsize: file.size })
  const temp = pushTemp(chatId, kind, extra.body, { ...baseMeta, local })
  try {
    let blob = file
    if (kind === 'photo' && file.type !== 'image/gif') blob = await resizeImage(file, 1600, 0.85)
    const id = await upload(blob, file.name || kind, (p) => {
      const bar = qs(`[data-cid="${temp.client_id}"] .prog i`)
      if (bar) bar.style.width = Math.round(p * 100) + '%'
    })
    await sendRaw(chatId, { kind, body: extra.body || undefined, meta: { ...baseMeta, ...mediaInfo(id), fsize: blob.size } }, temp)
  } catch (e) { dropTemp(chatId, temp); toast('⚠️ ' + e.message) }
}
const sendSticker = (e, a) => S.cur && sendRaw(S.cur, { kind: 'sticker', meta: withReply({ e, a }) }).catch(() => {})
const sendGif = (g) => S.cur && sendRaw(S.cur, { kind: 'gif', meta: withReply({ g }) }).catch(() => {})

// Matn maydoni
function autoGrow() { const i = $('inp'); i.style.height = 'auto'; i.style.height = Math.min(140, i.scrollHeight) + 'px' }
function setSendIcon() { const has = $('inp').value.trim() || editId; $('b-send').textContent = has ? (editId ? '✔' : '➤') : recMode === 'round' ? '⭕' : '🎤' }
let typingSent = 0
$('inp').addEventListener('input', () => {
  autoGrow(); setSendIcon()
  if (S.cur) localStorage.setItem('g50_draft_' + S.cur, $('inp').value)
  if (S.cur && Date.now() - typingSent > 3500 && $('inp').value) { typingSent = Date.now(); post(`/chats/${S.cur}/typing`, { action: 'text' }).catch(() => {}) }
})
$('inp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendText() }
  if (e.key === 'ArrowUp' && !$('inp').value) { const mine = (S.msgs.get(S.cur) || []).filter((m) => m.sender_id === S.me.id && m.kind === 'text' && !m.deleted && m.id > 0).pop(); if (mine) { e.preventDefault(); editId = mine.id; $('inp').value = mine.body; setReply(); autoGrow() } }
})
$('inp').addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])][0]
  if (f) { e.preventDefault(); sendFile(f, f.type.startsWith('image/') ? 'photo' : f.type.startsWith('video/') ? 'video' : 'file') }
})
$('msgs').addEventListener('dragover', (e) => e.preventDefault())
$('msgs').addEventListener('drop', (e) => { e.preventDefault(); [...e.dataTransfer.files].forEach((f) => sendFile(f, f.type.startsWith('image/') ? 'photo' : f.type.startsWith('video/') ? 'video' : 'file')) })

// ---------------- Ovozli va dumaloq video xabar ----------------
let rec = null, holdT = 0, downX = 0, recPending = null
// MediaRecorder.isTypeSupported ba'zan yolg'aydi (WebView) — konstruktorda sinab ko'ramiz
function pickRecorder(stream, mimes, extra = {}) {
  if (!window.MediaRecorder) throw new Error('yozib olish qo‘llanmaydi')
  for (const t of mimes) {
    if (MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(t)) continue
    try { return new MediaRecorder(stream, { ...extra, mimeType: t }) } catch {}
  }
  try { return new MediaRecorder(stream, extra) } catch (e) { throw new Error('bu qurilma yozib ololmadi') }
}
$('b-send').addEventListener('mousedown', (e) => e.preventDefault())
$('b-send').addEventListener('pointerdown', (e) => {
  if ($('inp').value.trim() || editId) return
  downX = e.clientX
  try { $('b-send').setPointerCapture(e.pointerId) } catch {}
  recPending = { kind: recMode, stop: false }
  holdT = setTimeout(() => { holdT = 0; recMode === 'round' ? startRound() : startVoice() }, 230)
})
$('b-send').addEventListener('pointermove', (e) => { if (rec && rec.kind === 'voice' && e.clientX - downX < -90) stopRec(true) })
$('b-send').addEventListener('pointerup', () => {
  if ($('inp').value.trim() || editId) return sendText()
  if (holdT) { clearTimeout(holdT); holdT = 0; recPending = null; recMode = recMode === 'voice' ? 'round' : 'voice'; localStorage.setItem('g50_rec', recMode); setSendIcon(); toast(recMode === 'round' ? '⭕ Video xabar: bosib turing' : '🎤 Ovozli xabar: bosib turing', 1500); return }
  if (rec) stopRec(false)
  else if (recPending) recPending.stop = true // barmoq qo‘yib yubordi — mikrofon ochilishi tugagach darhol yuboriladi
})
$('b-send').addEventListener('pointercancel', () => { clearTimeout(holdT); holdT = 0; recPending = null; if (rec) stopRec(true) })

async function startVoice() {
  const chatId = S.cur, pend = recPending
  if (!chatId) { recPending = null; return }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { recPending = null; return toast('Bu brauzer ovoz yozishni qo‘llamaydi') }
  let stream = null
  try {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) } catch { recPending = null; return toast('🎤 Mikrofonga ruxsat bering') }
    const mr = pickRecorder(stream, ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'])
    const chunks = [], wave = []
    let an = null, ac = null, waveT = 0
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)()
      an = ac.createAnalyser(); an.fftSize = 256
      ac.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      waveT = setInterval(() => { an.getByteTimeDomainData(buf); let mx = 0; for (const v of buf) mx = Math.max(mx, Math.abs(v - 128)); wave.push(mx) }, 100)
    } catch {}
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const t0 = Date.now()
    rec = { kind: 'voice', chatId, mr, stream, chunks, t0, cancel: false, timer: setInterval(() => { $('rec-t').textContent = fmtDur((Date.now() - t0) / 1000); if (Date.now() - t0 > 300000) stopRec(false) }, 250) }
    mr.onstop = () => {
      clearInterval(waveT); try { ac && ac.close() } catch {}
      stream.getTracks().forEach((t) => t.stop())
      const dur = Math.round((Date.now() - t0) / 1000)
      const chat = rec ? rec.chatId : chatId
      if (rec?.cancel || dur < 1) { rec = null; return }
      rec = null
      if (!chunks.length) return toast('⚠️ Ovoz yozib olinmadi — qaytadan bosib turing')
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      const bars = 36, w = []
      for (let i = 0; i < bars; i++) { const s = wave.slice(Math.floor((i * wave.length) / bars), Math.floor(((i + 1) * wave.length) / bars) || 1); w.push(Math.round(3 + Math.min(27, (Math.max(0, ...s) / 64) * 27))) }
      sendFile(new File([blob], 'ovoz.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'), { type: blob.type }), 'voice', { meta: { dur, wave: w } }, chat)
    }
    mr.start(250)
    vibrate(20)
    $('recbar').classList.remove('hide'); $('b-send').classList.add('rec'); $('rec-t').textContent = '0:00'
    post(`/chats/${chatId}/typing`, { action: 'voice' }).catch(() => {})
    recPending = null
    if (pend && pend.stop) stopRec(false)
  } catch (e) {
    recPending = null; rec = null
    try { stream && stream.getTracks().forEach((t) => t.stop()) } catch {}
    toast('⚠️ Ovoz yozish ishlamadi: ' + (e.message || 'noma’lum xato'))
  }
}
function stopRec(cancel) {
  recPending = null
  if (!rec) return
  rec.cancel = cancel
  clearInterval(rec.timer)
  $('recbar').classList.add('hide'); $('b-send').classList.remove('rec')
  if (rec.over) rec.over.remove()
  try { rec.mr.state !== 'inactive' ? rec.mr.stop() : rec.mr.onstop() } catch { rec = null }
  if (cancel) toast('Bekor qilindi', 1200)
}
async function startRound() {
  const chatId = S.cur, pend = recPending
  if (!chatId) { recPending = null; return }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { recPending = null; return toast('Bu brauzer video yozishni qo‘llamaydi') }
  let stream = null, o = null
  try {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true }) } catch { recPending = null; return toast('📷 Kamera va mikrofonga ruxsat bering') }
    o = document.createElement('div')
    o.className = 'over roundrec'
    o.innerHTML = `<div class="rr"><video autoplay muted playsinline></video><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"/><circle id="rr-c" cx="50" cy="50" r="48" fill="none" stroke="#0A7CFF" stroke-width="2.5" stroke-dasharray="301.6" stroke-dashoffset="301.6" stroke-linecap="round"/></svg></div><div class="rt" id="rr-t">0:00</div><div class="rbar"><button class="cb end" data-x>✕</button><button class="cb ok" data-s>➤</button></div><p class="mut" style="color:#ccc">Qo‘yib yuborsangiz — yuboriladi (60 soniyagacha)</p>`
    document.body.appendChild(o)
    qs('video', o).srcObject = stream
    const mr = pickRecorder(stream, ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'], { videoBitsPerSecond: 900000 })
    const chunks = [], t0 = Date.now()
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec = {
      kind: 'round', chatId, mr, stream, chunks, t0, over: o, cancel: false,
      timer: setInterval(() => {
        const s = (Date.now() - t0) / 1000
        const t = qs('#rr-t', o); if (t) t.textContent = fmtDur(s)
        const cc = qs('#rr-c', o); if (cc) cc.setAttribute('stroke-dashoffset', String(301.6 * (1 - Math.min(1, s / 60))))
        if (s >= 60) stopRec(false)
      }, 200),
    }
    qs('[data-x]', o).onclick = () => stopRec(true)
    qs('[data-s]', o).onclick = () => stopRec(false)
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const dur = Math.round((Date.now() - t0) / 1000)
      const chat = rec ? rec.chatId : chatId
      const r = rec; rec = null
      if (!r || r.cancel || dur < 1) return
      if (!chunks.length) return toast('⚠️ Video yozib olinmadi — qaytadan bosib turing')
      const blob = new Blob(chunks, { type: mr.mimeType || 'video/webm' })
      sendFile(new File([blob], 'video.' + (blob.type.includes('mp4') ? 'mp4' : 'webm'), { type: blob.type }), 'round', { meta: { dur } }, chat)
    }
    mr.start(500)
    vibrate(20)
    post(`/chats/${chatId}/typing`, { action: 'round' }).catch(() => {})
    recPending = null
    if (pend && pend.stop) stopRec(false)
  } catch (e) {
    recPending = null; rec = null
    try { stream && stream.getTracks().forEach((t) => t.stop()) } catch {}
    if (o) o.remove()
    toast('⚠️ Video yozish ishlamadi: ' + (e.message || 'noma’lum xato'))
  }
}

// ---------------- Biriktirish ----------------
$('b-attach').onclick = () => {
  const c = S.chats.get(S.cur)
  const sh = sheet(h3('Yuborish') + `<div class="rows">
    <div data-a="gal"><span class="ri">🖼</span><div class="rt">Rasm yoki video</div></div>
    <div data-a="cam"><span class="ri">📷</span><div class="rt">Kamera</div></div>
    <div data-a="file"><span class="ri">📄</span><div class="rt">Fayl<small>Istalgan turdagi, 30 MB gacha</small></div></div>
    <div data-a="contact"><span class="ri">👤</span><div class="rt">Kontakt</div></div>
    <div data-a="loc"><span class="ri">📍</span><div class="rt">Joylashuv</div></div>
    ${c && c.type !== 'direct' ? '<div data-a="poll"><span class="ri">📊</span><div class="rt">So‘rovnoma</div></div>' : ''}
  </div>`)
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    const a = it.dataset.a
    closeSheet(sh)
    if (a === 'gal' || a === 'cam') {
      const files = a === 'cam' ? [await pickFile('image/*,video/*', false, 'environment')].filter(Boolean) : await pickFile('image/*,video/*', true)
      if (!files.length) return
      const body = files.length === 1 ? await captionAsk(files[0]) : ''
      if (body === null) return
      files.slice(0, 10).forEach((f, i) => sendFile(f, f.type.startsWith('video/') ? 'video' : 'photo', { body: i === 0 ? body : '' }))
    }
    if (a === 'file') { const fs = await pickFile('', true); (fs || []).slice(0, 10).forEach((f) => sendFile(f, 'file')) }
    if (a === 'contact') shareContactSheet()
    if (a === 'loc') {
      if (!navigator.geolocation) return toast('Joylashuv aniqlanmaydi')
      toast('📍 Aniqlanmoqda…')
      navigator.geolocation.getCurrentPosition((p) => sendRaw(S.cur, { kind: 'location', meta: withReply({ lat: p.coords.latitude, lng: p.coords.longitude }) }).catch(() => {}), () => toast('⚠️ Joylashuvga ruxsat bering'), { enableHighAccuracy: true, timeout: 15000 })
    }
    if (a === 'poll') pollSheet()
  }
}
function captionAsk(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file)
    const sh = sheet(h3('Izoh qo‘shasizmi?') + `${file.type.startsWith('video/') ? `<video src="${url}" style="width:100%;max-height:45vh;border-radius:14px" controls></video>` : `<img src="${url}" style="width:100%;max-height:45vh;object-fit:contain;border-radius:14px">`}
      <input class="inp" id="cap-i" placeholder="Izoh (ixtiyoriy)" maxlength="1000"><button class="btn big" id="cap-s">Yuborish ➤</button>`, { onClose: () => res(null) })
    qs('#cap-s', sh).onclick = () => { const v = qs('#cap-i', sh).value.trim(); const b = sh.closest('.shbg'); b._onClose = null; b.remove(); URL.revokeObjectURL(url); res(v) }
  })
}
function shareContactSheet() {
  const list = (S.contacts || []).filter((k) => k.user)
  const sh = sheet(h3('Kontaktni ulashish') + `<div class="list" style="max-height:60vh;overflow:auto">${[{ phone: S.me.phone, first_name: uname(S.me) + ' (men)', user: S.me }, ...list].map((k, i) => `<div class="item" data-i="${i}">${avHTML(k.user, 42, { noStory: true })}<div class="mid"><div class="t1"><b>${esc(((k.first_name || '') + ' ' + (k.last_name || '')).trim())}</b></div><div class="t2"><span>${esc(k.phone || '')}</span></div></div></div>`).join('')}</div>`)
  const all = [{ phone: S.me.phone, first_name: uname(S.me), user: S.me }, ...list]
  sh.onclick = (e) => {
    const it = e.target.closest('[data-i]'); if (!it) return
    const k = all[+it.dataset.i]
    closeSheet(sh)
    sendRaw(S.cur, { kind: 'contact', meta: withReply({ name: ((k.first_name || '') + ' ' + (k.last_name || '')).trim(), phone: k.phone || '', user_id: k.user?.id || 0 }) }).catch(() => {})
  }
}
function pollSheet() {
  const sh = sheet(h3('So‘rovnoma') + `<input class="inp" id="pl-q" placeholder="Savol" maxlength="200"><div id="pl-o"><input class="inp" placeholder="1-variant" maxlength="100"><input class="inp" placeholder="2-variant" maxlength="100"></div><button class="lnk" id="pl-add">+ Variant qo‘shish</button><button class="btn big" id="pl-s">Yuborish</button>`)
  qs('#pl-add', sh).onclick = () => { const n = qsa('#pl-o input', sh).length; if (n >= 10) return; const i = document.createElement('input'); i.className = 'inp'; i.maxLength = 100; i.placeholder = (n + 1) + '-variant'; qs('#pl-o', sh).appendChild(i); i.focus() }
  qs('#pl-s', sh).onclick = () => {
    const q = qs('#pl-q', sh).value.trim(), options = qsa('#pl-o input', sh).map((i) => i.value.trim()).filter(Boolean)
    if (!q || options.length < 2) return toast('Savol va kamida 2 ta variant yozing')
    closeSheet(sh)
    sendRaw(S.cur, { kind: 'poll', body: q, meta: { q, options } }).catch(() => {})
  }
}

// ---------------- Emoji / stiker / GIF paneli ----------------
let pkTab = 'emoji'
function renderPicker() {
  const p = $('picker')
  const recent = JSON.parse(localStorage.getItem('g50_recent_emoji') || '[]')
  let body = ''
  if (pkTab === 'emoji') body = (recent.length ? `<div class="pk-cat">So‘nggi</div><div class="emg">${recent.map((e) => `<span data-e="${e}">${e}</span>`).join('')}</div>` : '') + Object.entries(EMOJI).map(([k, v]) => `<div class="pk-cat">${k}</div><div class="emg">${v.split(' ').map((e) => `<span data-e="${e}">${e}</span>`).join('')}</div>`).join('')
  if (pkTab === 'stk') body = `<div class="stkg">${STICKERS.map(([e, a], i) => `<div data-s="${i}"><span class="${a}" style="display:inline-block">${e}</span></div>`).join('')}</div>`
  if (pkTab === 'gif') body = `<div class="gifg">${GIFS.map((g) => `<div data-g="${g.k}">${gifHTML(g.k)}</div>`).join('')}</div>`
  p.innerHTML = `<div class="pk-tabs"><div data-t="emoji" class="${pkTab === 'emoji' ? 'on' : ''}">😊 Emoji</div><div data-t="stk" class="${pkTab === 'stk' ? 'on' : ''}">🎈 Stiker</div><div data-t="gif" class="${pkTab === 'gif' ? 'on' : ''}">🎞 GIF</div></div><div class="pk-body">${body}</div>`
}
$('b-emoji').onclick = () => { const p = $('picker'); if (!p.classList.contains('on')) renderPicker(); p.classList.toggle('on') }
$('picker').addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]'); if (t) { pkTab = t.dataset.t; return renderPicker() }
  const em = e.target.closest('[data-e]')
  if (em) {
    const inp = $('inp'), s = inp.selectionStart ?? inp.value.length
    inp.value = inp.value.slice(0, s) + em.dataset.e + inp.value.slice(inp.selectionEnd ?? s)
    inp.selectionStart = inp.selectionEnd = s + em.dataset.e.length
    autoGrow(); setSendIcon()
    const r = [em.dataset.e, ...JSON.parse(localStorage.getItem('g50_recent_emoji') || '[]').filter((x) => x !== em.dataset.e)].slice(0, 16)
    localStorage.setItem('g50_recent_emoji', JSON.stringify(r))
    return
  }
  const st = e.target.closest('[data-s]'); if (st) { const [x, a] = STICKERS[+st.dataset.s]; $('picker').classList.remove('on'); return sendSticker(x, a) }
  const g = e.target.closest('[data-g]'); if (g) { $('picker').classList.remove('on'); return sendGif(g.dataset.g) }
})
$('msgs').addEventListener('pointerdown', () => $('picker').classList.remove('on'))

// ---------------- Foydalanuvchi profili ----------------
async function openDirectWith(uid) {
  try {
    const c = await post('/chats/direct', { user_id: uid })
    S.chats.set(c.id, { ...S.chats.get(c.id), ...c, joined: true })
    if (c.peer) S.users.set(c.peer.id, c.peer)
    openChat(c.id)
  } catch (e) { toast('⚠️ ' + e.message) }
}
async function openUser(uid) {
  if (!uid) return
  if (uid === S.me?.id) return tabGo('t-me')
  let u
  try { u = await api('/users/' + uid) } catch (e) { return toast('⚠️ ' + e.message) }
  S.users.set(u.id, u)
  const isC = (S.contacts || []).some((k) => k.user && k.user.id === u.id)
  const sh = sheet(`<div class="prof">${bigAvatar(u, 116, { live: !!u.live_id, liveId: u.live_id })}<h2>${esc(uname(u))}</h2><div class="mut">${esc(lastSeen(u))}${u.live_id ? ' · 🔴 hozir efirda' : ''}</div></div>
    <div class="pbtns" style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn" style="flex:1" data-a="msg">💬 Xabar</button>
      <button class="btn gh" style="flex:1" data-a="call">📞</button>
      <button class="btn gh" style="flex:1" data-a="video">📹</button>
      ${u.live_id ? '<button class="btn red" style="flex:1" data-a="live">🔴 Efir</button>' : ''}
    </div>
    <div class="rows">
      ${u.phone ? `<div data-a="phone"><span class="ri">📱</span><div class="rt">${esc(u.phone)}<small>Telefon</small></div></div>` : ''}
      ${u.username ? `<div data-a="un"><span class="ri">@</span><div class="rt">@${esc(u.username)}<small>Username — nusxa olish</small></div></div>` : ''}
      ${u.bio ? `<div><span class="ri">ℹ️</span><div class="rt">${esc(u.bio)}<small>Bio</small></div></div>` : ''}
    </div>
    <div class="rows">
      ${isC ? '' : '<div data-a="add"><span class="ri">➕</span><div class="rt">Kontaktlarga qo‘shish</div></div>'}
      ${u.username ? '<div data-a="share"><span class="ri">🔗</span><div class="rt">Profilni ulashish</div></div>' : ''}
      <div data-a="block"><span class="ri">🚫</span><div class="rt red">${u.i_blocked ? 'Blokdan chiqarish' : 'Bloklash'}</div></div>
    </div>`)
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    const a = it.dataset.a
    if (a === 'msg') { closeSheet(sh); openDirectWith(u.id) }
    if (a === 'call' || a === 'video') { closeSheet(sh); callUser(u.id, a === 'video') }
    if (a === 'live') { closeSheet(sh); watchLive(u.live_id) }
    if (a === 'phone') copy(u.phone)
    if (a === 'un') copy('@' + u.username)
    if (a === 'share') share('50 Gram: @' + u.username, location.origin + location.pathname + '#@' + u.username)
    if (a === 'add') { closeSheet(sh); contactForm({ phone: u.phone || '', first_name: u.first_name, last_name: u.last_name }) }
    if (a === 'block') {
      if (!u.i_blocked && !(await confirmBox(uname(u) + ' bloklansinmi? U sizga yoza olmaydi va qo‘ng‘iroq qila olmaydi.', 'Bloklash'))) return
      try { u.i_blocked ? await del('/blocks/' + u.id) : await post('/blocks/' + u.id); toast(u.i_blocked ? '✅ Blokdan chiqarildi' : '🚫 Bloklandi'); closeSheet(sh) } catch (er) { toast('⚠️ ' + er.message) }
    }
  }
}
// Ochiq kanal/guruhni ko'rib chiqish (qo'shilmasdan oldin)
function chatPreview(c, hash) {
  const sh = sheet(`<div class="prof">${avHTML(c, 100, { chat: true })}<h2>${c.type === 'channel' ? '📢' : '👥'} ${esc(c.title)}</h2><div class="mut">${c.username ? '@' + esc(c.username) + ' · ' : ''}${c.member_count || 0} ${c.type === 'channel' ? 'obunachi' : 'a‘zo'}</div></div>
    ${c.description ? `<div class="hint">${linkify(c.description)}</div>` : ''}
    <div style="display:flex;gap:8px">${c.is_public ? '<button class="btn gh big" data-a="look">Ko‘rish</button>' : ''}<button class="btn big" data-a="join">${c.join_approval ? 'So‘rov yuborish' : c.type === 'channel' ? 'Obuna bo‘lish' : 'Qo‘shilish'}</button></div>`)
  sh.onclick = (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    if (it.dataset.a === 'join') joinChat(c.id, hash)
    if (it.dataset.a === 'look') { closeSheet(sh); S.chats.set(c.id, { ...c, joined: false, invite_hash: hash }); openChat(c.id) }
  }
}

// ---------------- Real vaqt hodisalari ----------------
on('message', async (ev) => {
  const id = ev.chat_id, m = ev.message
  await loadChatLocal(id)
  merge(id, [m])
  saveChatLocal(id) // xabar qurilmada saqlanadi
  let c = S.chats.get(id)
  if (!c) { loadChats().catch(() => {}); c = null }
  else {
    c.last_message = m; c.last_msg_at = m.created_at
    S.typing.delete(id)
    if (m.sender_id !== S.me.id) {
      if (S.cur === id && !document.hidden) markRead(id)
      else {
        c.unread = (c.unread || 0) + 1
        if (!c.muted) { beep(); notifyLocal(chatName(c), msgPreview(m, c), id) }
      }
    }
  }
  if (S.cur === id) { scheduleMsgs(m.sender_id === S.me.id); renderHeader() }
  scheduleChats()
})
on('message_update', async (ev) => {
  await loadChatLocal(ev.chat_id)
  merge(ev.chat_id, [ev.message])
  saveChatLocal(ev.chat_id)
  if (S.cur === ev.chat_id) scheduleMsgs()
  const c = S.chats.get(ev.chat_id)
  if (c && c.last_message && c.last_message.id === ev.message.id) { c.last_message = ev.message; scheduleChats() }
})
on('read', (ev) => {
  const c = S.chats.get(ev.chat_id)
  if (!c || ev.user_id === S.me.id) return
  c.peer_last_read = Math.max(c.peer_last_read || 0, ev.last_id)
  if (S.cur === ev.chat_id) scheduleMsgs()
  scheduleChats()
})
on('typing', (ev) => {
  if (ev.user_id === S.me.id) return
  S.typing.set(ev.chat_id, { uid: ev.user_id, action: ev.action, until: Date.now() + 5000 })
  scheduleChats()
  if (S.cur === ev.chat_id) renderHeader()
})
on('chat_update', () => { loadChats().catch(() => {}) })
on('chat_deleted', async (ev) => {
  const id = ev.chat_id
  const ids = (S.msgs.get(id) || []).map((m) => m.meta?.media_id).filter(Boolean).map(String)
  if (ids.length) Store.remove(ids)
  S.chats.delete(id); S.msgs.delete(id)
  IDB.del('chats', S.me.id + ':' + id)
  if (S.cur === id) { closeChat(); toast('Bu chat o‘chirildi') }
  renderChats()
})
on('join_request', (ev) => { const c = S.chats.get(ev.chat_id); if (c) toast(`👋 «${c.title}» ga yangi qo‘shilish so‘rovi`) })

// Qoralama: chat ochilganda tiklanadi
const _openChat = openChat
openChat = async function (id) {
  const p = _openChat(id)
  $('inp').value = localStorage.getItem('g50_draft_' + id) || ''
  autoGrow(); setSendIcon()
  return p
}
setSendIcon()
