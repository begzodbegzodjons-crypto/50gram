/* 50 Gram — kanal/guruh boshqaruvi, yaratish, profil va sozlamalar */
'use strict'
const isAdmC = (c) => c && (c.role === 'owner' || c.role === 'admin')
const rowsHTML = (items) => `<div class="rows">${items.filter(Boolean).join('')}</div>`
const row = (a, icon, title, small = '', cls = '') => `<div data-a="${a}"><span class="ri">${icon}</span><div class="rt ${cls}">${title}${small ? `<small>${small}</small>` : ''}</div></div>`
const swRow = (k, title, on, small = '') => `<div data-sw="${k}"><div class="rt">${title}${small ? `<small>${small}</small>` : ''}</div>${swHTML(on)}</div>`
const inviteLink = (c) => location.origin + location.pathname + (c.username ? '#@' + c.username : '#join/' + c.invite_hash)

// ---------------- Kanal / guruh ma'lumoti ----------------
async function openChatInfo(id) {
  let c
  try { c = { ...S.chats.get(id), ...(await api('/chats/' + id)) } } catch (e) { return toast('⚠️ ' + e.message) }
  S.chats.set(id, { ...S.chats.get(id), ...c })
  const adm = isAdmC(c), owner = c.role === 'owner', ch = c.type === 'channel'
  const joined = c.joined !== false
  const sh = sheet(`<div class="prof">${bigAvatar(c, 110, { chat: true, cam: adm })}<h2>${ch ? '📢' : '👥'} ${esc(c.title)}</h2><div class="mut">${c.member_count || 0} ${ch ? 'obunachi' : 'a‘zo'} · ${c.is_public ? 'ochiq' : 'yopiq'}</div></div>
    ${c.description ? `<div class="hint">${linkify(c.description)}</div>` : ''}
    ${rowsHTML([
      c.username || c.invite_hash ? row('link', '🔗', esc(inviteLink(c)), 'Havola — bosib nusxa oling') : '',
      joined ? row('mute', c.muted ? '🔔' : '🔕', c.muted ? 'Bildirishnomani yoqish' : 'Ovozsiz qilish') : '',
      joined ? row('pinchat', '📌', c.pinned ? 'Chatni qadashdan olish' : 'Chatni ro‘yxat boshiga qadash') : '',
      (!ch || adm) && joined ? row('members', '👥', ch ? 'Obunachilar' : 'A‘zolar', String(c.member_count || 0)) : '',
      adm && c.join_approval ? row('requests', '📬', 'Qo‘shilish so‘rovlari', c.requests ? String(c.requests.length || c.requests) : '') : '',
      (adm || (!ch && c.permissions?.invite)) && joined ? row('add', '➕', 'A‘zo qo‘shish') : '',
    ])}
    ${adm ? rowsHTML([row('edit', '✏️', 'Tahrirlash', 'Nom, tavsif, rasm, username'), row('announce', '📣', ch ? 'E’lon yuborish' : 'Xabar yozish', ch ? 'Obunachilarga darhol yetkaziladi' : 'Guruhga yangilik joylash'), row('stats', '📊', 'Statistika', 'A’zolar, xabarlar, ko‘rishlar'), row('type', c.is_public ? '🌐' : '🔒', ch ? 'Kanal turi' : 'Guruh turi', c.is_public ? 'Ochiq — qidiruvda ko‘rinadi' : 'Yopiq — faqat havola orqali'), !ch ? row('perms', '🛡', 'Ruxsatlar', 'A‘zolar nima qila oladi') : '', row('settings', '⚙️', 'Sozlamalar', ch ? 'Imzo, reaksiyalar, himoya' : 'Sekin rejim, reaksiyalar, himoya'), row('revoke', '♻️', 'Havolani yangilash', 'Eski havola ishlamay qoladi')]) : ''}
    ${rowsHTML([joined ? row('export', '📥', 'Tarixni zaxiralash', 'Chat tarixini .txt faylga yuklab olish') : ''])}
    ${rowsHTML([
      !joined ? row('join', '✅', ch ? 'Obuna bo‘lish' : 'Qo‘shilish') : '',
      joined && !owner ? row('leave', '🚪', ch ? 'Obunani bekor qilish' : 'Guruhdan chiqish', '', 'red') : '',
      owner ? row('delete', '🗑', ch ? 'Kanalni o‘chirish' : 'Guruhni o‘chirish', 'Hamma uchun butunlay', 'red') : '',
    ])}`)
  const cam = qs('[data-cam]', sh)
  if (cam) cam.onclick = (e) => { e.stopPropagation(); setChatAvatar(c, sh) }
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    const a = it.dataset.a
    if (a === 'link') { copy(inviteLink(c)); share(c.title, inviteLink(c)) }
    if (a === 'mute') { closeSheet(sh); toggleMute(S.chats.get(id) || c) }
    if (a === 'pinchat') tryDo(async () => { const r2 = await post(`/chats/${id}/pin`, { on: !c.pinned }); S.chats.set(id, { ...S.chats.get(id), pinned: r2.pinned }); closeSheet(sh); renderChats(); toast(r2.pinned ? '📌 Qadaldi — endi ro‘yxat boshida' : 'Qadash olindi') })
    if (a === 'members') membersSheet(c)
    if (a === 'requests') requestsSheet(c)
    if (a === 'export') { closeSheet(sh); exportChat(id) }
    if (a === 'add') pickUsers('A‘zo qo‘shish', async (ids) => { await post(`/chats/${id}/members`, { user_ids: ids }); toast('✅ Qo‘shildi'); loadChats() })
    if (a === 'edit') editChatSheet(c)
    if (a === 'type') typeSheet(c)
    if (a === 'perms') permsSheet(c)
    if (a === 'settings') settingsSheet(c)
    if (a === 'announce') { closeSheet(sh); postSheet(c.id) }
    if (a === 'stats') statsSheet(c)
    if (a === 'revoke') { if (await confirmBox('Yangi havola yaratilsinmi? Eskisi ishlamaydi.', 'Yangilash')) tryDo(async () => { const r = await post(`/chats/${id}/invite`); c.invite_hash = r.invite_hash; copy(inviteLink(c)) }, '✅ Yangi havola nusxalandi') }
    if (a === 'join') { closeSheet(sh); joinChat(id) }
    if (a === 'leave') {
      if (!(await confirmBox(ch ? 'Kanaldan chiqasizmi?' : 'Guruhdan chiqasizmi?', 'Chiqish'))) return
      tryDo(async () => { await post(`/chats/${id}/leave`); S.chats.delete(id); closeSheet(sh); if (S.cur === id) closeChat(); renderChats(); renderChannels() }, 'Chiqdingiz')
    }
    if (a === 'delete') {
      if (!(await confirmBox(`«${c.title}» butunlay o‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.`, 'O‘chirish'))) return
      tryDo(async () => { await del('/chats/' + id); S.chats.delete(id); closeAllSheets(); if (S.cur === id) closeChat(); renderChats(); renderChannels() }, '🗑 O‘chirildi')
    }
  }
}
async function setChatAvatar(c, sh) {
  const f = await pickFile('image/*'); if (!f) return
  tryDo(async () => { const avatar = await avatarDataUrl(f); const r = await patch('/chats/' + c.id, { avatar }); S.chats.set(c.id, { ...S.chats.get(c.id), ...r }); closeSheet(sh); renderChats(); renderHeader(); openChatInfo(c.id) }, '✅ Rasm yangilandi')
}
async function patchChat(c, body, msg = '✅ Saqlandi') {
  try { const r = await patch('/chats/' + c.id, body); S.chats.set(c.id, { ...S.chats.get(c.id), ...r }); Object.assign(c, r); renderChats(); if (S.cur === c.id) renderHeader(); toast(msg); return true } catch (e) { toast('⚠️ ' + e.message); return false }
}
function editChatSheet(c) {
  let avNew = null
  const sh = sheet(h3('Tahrirlash') + `<label class="mut">Nom</label><input class="inp" id="ec-t" maxlength="128" value="${esc(c.title)}">
    ${logoPresets(-1)}
    <label class="mut">Tavsif</label><textarea class="inp" id="ec-d" maxlength="500" rows="3">${esc(c.description || '')}</textarea>
    <label class="mut">Username (ochiq havola uchun)</label><input class="inp" id="ec-u" maxlength="32" placeholder="masalan: mening_kanalim" value="${esc(c.username || '')}">
    <div class="hint">Username: lotin harfi bilan boshlanadi, 5–32 belgi (harf, raqam, _).</div>
    <button class="btn big" id="ec-s">Saqlash</button>${c.avatar_ver ? '<button class="btn gh big red" id="ec-av">Rasmni olib tashlash</button>' : ''}`)
  qs('#ec-s', sh).onclick = async () => { const body = { title: qs('#ec-t', sh).value, description: qs('#ec-d', sh).value, username: qs('#ec-u', sh).value.trim() }; if (avNew) body.avatar = avNew; if (await patchChat(c, body)) closeAllSheets() }
  sh.addEventListener('click', (e) => {
    const lg = e.target.closest('[data-logo]')
    if (lg) { const [em, c1, c2] = LOGOS[+lg.dataset.logo]; avNew = logoDataURL(em, c1, c2); qsa('[data-logo]', sh).forEach((x) => x.classList.toggle('on', x === lg)) }
  })
  const r = qs('#ec-av', sh); if (r) r.onclick = async () => { if (await patchChat(c, { avatar: null })) closeAllSheets() }
}
function typeSheet(c) {
  const sh = sheet(h3(c.type === 'channel' ? 'Kanal turi' : 'Guruh turi') + `<div class="rows">
    <div data-p="1"><span class="ri">🌐</span><div class="rt">Ochiq<small>Har kim qidiruvdan topib qo‘shila oladi</small></div><span class="chk ${c.is_public ? 'on' : ''}"></span></div>
    <div data-p="0"><span class="ri">🔒</span><div class="rt">Yopiq<small>Faqat taklif havolasi orqali</small></div><span class="chk ${!c.is_public ? 'on' : ''}"></span></div></div>
    <div class="rows">${swRow('ja', 'Qo‘shilishni tasdiqlash', !!c.join_approval, 'Yangi a‘zolarni admin tasdiqlaydi')}</div>`)
  sh.onclick = async (e) => {
    const p = e.target.closest('[data-p]')
    if (p) { if (await patchChat(c, { is_public: +p.dataset.p })) qsa('[data-p] .chk', sh).forEach((x) => x.classList.toggle('on', x.closest('[data-p]') === p)) }
    const s = e.target.closest('[data-sw]')
    if (s) { const on = !c.join_approval; if (await patchChat(c, { join_approval: on ? 1 : 0 })) qs('.sw', s).classList.toggle('on', on) }
  }
}
function permsSheet(c) {
  const p = c.permissions || {}
  const L = { send: 'Xabar yozish', media: 'Media yuborish', stickers: 'Stiker va GIF', links: 'Havolalar', polls: 'So‘rovnomalar', invite: 'A‘zo taklif qilish' }
  const sh = sheet(h3('A‘zolar ruxsatlari') + `<div class="rows">${Object.keys(L).map((k) => swRow(k, L[k], p[k] !== 0)).join('')}</div>`)
  sh.onclick = async (e) => {
    const s = e.target.closest('[data-sw]'); if (!s) return
    const k = s.dataset.sw, on = !((c.permissions || {})[k] !== 0)
    if (await patchChat(c, { permissions: { [k]: on ? 1 : 0 } })) qs('.sw', s).classList.toggle('on', on)
  }
}
async function statsSheet(c) {
  let s
  try { s = await api(`/chats/${c.id}/stats`) } catch (e) { return toast('⚠️ ' + e.message) }
  const ch = c.type === 'channel'
  sheet(h3('📊 Statistika — ' + esc(c.title)) + `<div class="statgrid">
    <div class="st"><b>${s.members}</b><small>${ch ? 'Obunachi' : 'A’zo'}</small></div>
    <div class="st"><b>${s.admins}</b><small>Adminlar</small></div>
    <div class="st"><b>${s.today}</b><small>Bugungi xabarlar</small></div>
    <div class="st"><b>${s.messages}</b><small>Umumiy xabarlar</small></div>
    <div class="st"><b>${s.posts}</b><small>Postlar</small></div>
    <div class="st"><b>${fmtN(s.views)}</b><small>Ko‘rishlar</small></div>
    <div class="st"><b>${s.likes}</b><small>Layklar</small></div>
    <div class="st"><b>${s.comments}</b><small>Izohlar</small></div>
    ${s.banned ? `<div class="st" style="grid-column:1/-1"><b>${s.banned}</b><small>Bloklangan — A’zolar bo‘limidan boshqariladi</small></div>` : ''}
  </div>`)
}
function settingsSheet(c) {
  const st = c.settings || {}, ch = c.type === 'channel'
  const sh = sheet(h3('Sozlamalar') + `<div class="rows">
    ${ch ? swRow('signatures', 'Muallif imzosi', !!st.signatures, 'Postlar ostida admin nomi') : ''}
    ${swRow('reactions', 'Reaksiyalar', st.reactions !== 0)}
    ${swRow('protect', 'Kontentni himoyalash', !!st.protect, 'Nusxa olish va uzatish taqiqlanadi')}
  </div>${!ch ? `<div class="rows"><div><div class="rt">Sekin rejim<small>A‘zo xabarlari orasidagi vaqt</small></div><select class="inp" id="st-slow" style="width:auto;margin:0">${[0, 10, 30, 60, 300, 900, 3600].map((s) => `<option value="${s}" ${+st.slow === s ? 'selected' : ''}>${s ? (s < 60 ? s + ' son' : s / 60 + ' daq') : 'O‘chiq'}</option>`).join('')}</select></div></div>` : ''}`)
  sh.onclick = async (e) => {
    const s = e.target.closest('[data-sw]'); if (!s) return
    const k = s.dataset.sw, cur = k === 'reactions' ? (c.settings || {})[k] !== 0 : !!(c.settings || {})[k]
    if (await patchChat(c, { settings: { [k]: cur ? 0 : 1 } })) qs('.sw', s).classList.toggle('on', !cur)
  }
  const sl = qs('#st-slow', sh); if (sl) sl.onchange = () => patchChat(c, { settings: { slow: +sl.value } })
}
async function membersSheet(c) {
  let list
  try { list = await api(`/chats/${c.id}/members`) } catch (e) { return toast('⚠️ ' + e.message) }
  const adm = isAdmC(c), owner = c.role === 'owner'
  const RL = { owner: '👑 egasi', admin: '⭐ admin' }
  const draw = (q = '') => list.filter((u) => !q || uname(u).toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)).map((u) => `<div class="item" data-m="${u.id}">${avHTML(u, 42, { dot: true, noStory: true })}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b><span class="tm">${RL[u.role] || (u.status === 'banned' ? '🚫' : '')}</span></div><div class="t2"><span>${esc(lastSeen(u))}</span></div></div></div>`).join('') || '<div class="empty">Topilmadi</div>'
  const sh = sheet(h3(`${c.type === 'channel' ? 'Obunachilar' : 'A‘zolar'} (${list.filter((u) => u.status !== 'banned').length})`) + `<input class="inp" id="mb-q" placeholder="Qidirish"><div class="list" id="mb-l" style="max-height:60vh;overflow:auto">${draw()}</div>`)
  qs('#mb-q', sh).oninput = (e) => (qs('#mb-l', sh).innerHTML = draw(e.target.value.trim().toLowerCase()))
  sh.onclick = (e) => {
    const it = e.target.closest('[data-m]'); if (!it) return
    const u = list.find((x) => x.id === +it.dataset.m)
    if (!u) return
    if (!adm || u.id === S.me.id || u.role === 'owner' || (u.role === 'admin' && !owner)) return openUser(u.id)
    const acts = [['profile', '👤 Profil']]
    if (owner && u.status === 'active') acts.push(u.role === 'admin' ? ['unadmin', '⬇️ Adminlikdan olish'] : ['admin', '⭐ Admin qilish'])
    if (u.status === 'banned') acts.push(['unban', '✅ Blokdan chiqarish'])
    else acts.push(['kick', '🚪 Chiqarib yuborish'], ['ban', '🚫 Bloklash (qaytib kira olmaydi)'])
    const s2 = sheet(h3(uname(u)) + `<div class="rows">${acts.map(([k, t]) => `<div data-x="${k}"><div class="rt ${k === 'ban' || k === 'kick' ? 'red' : ''}">${t}</div></div>`).join('')}</div>`)
    s2.onclick = async (ev) => {
      const x = ev.target.closest('[data-x]'); if (!x) return
      const k = x.dataset.x
      closeSheet(s2)
      if (k === 'profile') return openUser(u.id)
      if ((k === 'ban' || k === 'kick') && !(await confirmBox(`${uname(u)} ${k === 'ban' ? 'bloklansinmi' : 'chiqarilsinmi'}?`, 'Ha'))) return
      try {
        await post(`/chats/${c.id}/members/${u.id}/${k}`)
        if (k === 'admin') u.role = 'admin'
        if (k === 'unadmin') u.role = 'member'
        if (k === 'kick') list = list.filter((y) => y !== u)
        if (k === 'ban') u.status = 'banned'
        if (k === 'unban') list = list.filter((y) => y !== u)
        qs('#mb-l', sh).innerHTML = draw()
        toast('✅ Bajarildi')
      } catch (er) { toast('⚠️ ' + er.message) }
    }
  }
}
async function requestsSheet(c) {
  let list
  try { list = await api(`/chats/${c.id}/requests`) } catch (e) { return toast('⚠️ ' + e.message) }
  const draw = () => list.map((u) => `<div class="item" data-r="${u.id}">${avHTML(u, 42, { noStory: true })}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b></div></div><button class="btn" data-ok style="width:auto;padding:6px 12px">✓</button><button class="btn gh" data-no style="width:auto;padding:6px 12px">✕</button></div>`).join('') || '<div class="empty">So‘rovlar yo‘q</div>'
  const sh = sheet(h3('Qo‘shilish so‘rovlari') + `<div class="list" id="rq-l">${draw()}</div>`)
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-r]'); if (!it) return
    const uid = +it.dataset.r
    const act = e.target.closest('[data-ok]') ? 'approve' : e.target.closest('[data-no]') ? 'decline' : null
    if (!act) return openUser(uid)
    try { await post(`/chats/${c.id}/requests/${uid}/${act}`); list = list.filter((u) => u.id !== uid); qs('#rq-l', sh).innerHTML = draw(); toast(act === 'approve' ? '✅ Qabul qilindi' : 'Rad etildi') } catch (er) { toast('⚠️ ' + er.message) }
  }
}

// Foydalanuvchilarni tanlash (kontaktlar + qidiruv)
function pickUsers(title, onDone, btn = 'Qo‘shish') {
  const sel = new Map()
  let shown = (S.contacts || []).filter((k) => k.user).map((k) => k.user)
  const draw = () => shown.map((u) => `<div class="item" data-p="${u.id}">${avHTML(u, 42, { noStory: true })}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b></div><div class="t2"><span>${u.username ? '@' + esc(u.username) : esc(lastSeen(u))}</span></div></div><span class="chk ${sel.has(u.id) ? 'on' : ''}"></span></div>`).join('') || '<div class="empty">Ism, @username yoki telefon raqam bilan qidiring</div>'
  const sh = sheet(h3(title) + `<input class="inp" id="pu-q" placeholder="Ism, @username yoki +998…"><div class="list" id="pu-l" style="max-height:50vh;overflow:auto">${draw()}</div><button class="btn big" id="pu-s">${btn}</button>`)
  let qt = 0
  qs('#pu-q', sh).oninput = (e) => {
    clearTimeout(qt)
    const q = e.target.value.trim()
    qt = setTimeout(async () => {
      if (q.length < 2) shown = (S.contacts || []).filter((k) => k.user).map((k) => k.user)
      else { try { shown = (await api('/search?q=' + encodeURIComponent(q))).users } catch { shown = [] } }
      shown = [...sel.values(), ...shown.filter((u) => !sel.has(u.id))]
      qs('#pu-l', sh).innerHTML = draw()
    }, 300)
  }
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-p]')
    if (it) { const u = shown.find((x) => x.id === +it.dataset.p); sel.has(u.id) ? sel.delete(u.id) : sel.set(u.id, u); qs('.chk', it).classList.toggle('on', sel.has(u.id)); return }
    if (e.target.closest('#pu-s')) { try { await onDone([...sel.keys()]); closeSheet(sh) } catch (er) { toast('⚠️ ' + er.message) } }
  }
}

// ---------------- Yaratish ----------------
function createSheet(type) {
  let av = null
  const ch = type === 'channel'
  const sh = sheet(h3(ch ? '📢 Yangi kanal' : '👥 Yangi guruh') + `<div class="prof"><div class="bigav" id="cr-av" style="width:90px;height:90px;cursor:pointer"><div class="av" style="width:90px;height:90px;font-size:32px;background:var(--sirt2)">📷</div></div></div>
    ${logoPresets(-1)}
    <input class="inp" id="cr-t" maxlength="128" placeholder="${ch ? 'Kanal nomi' : 'Guruh nomi'}">
    <textarea class="inp" id="cr-d" maxlength="500" rows="2" placeholder="Tavsif (ixtiyoriy)"></textarea>
    <div class="rows">
      <div data-p="1"><span class="ri">🌐</span><div class="rt">Ochiq<small>Qidiruvda ko‘rinadi</small></div><span class="chk on"></span></div>
      <div data-p="0"><span class="ri">🔒</span><div class="rt">Yopiq<small>Faqat havola orqali</small></div><span class="chk"></span></div>
      ${swRow('ja', 'Qo‘shilishni tasdiqlash', false)}
    </div>
    <input class="inp" id="cr-u" maxlength="32" placeholder="Username (ixtiyoriy): mening_${ch ? 'kanalim' : 'guruhim'}">
    <button class="btn big" id="cr-s">Davom etish</button>`)
  let pub = 1, ja = 0
  qs('#cr-av', sh).onclick = async () => { const f = await pickFile('image/*'); if (!f) return; av = await avatarDataUrl(f); qs('#cr-av', sh).innerHTML = `<img src="${av}" style="width:90px;height:90px;border-radius:50%;object-fit:cover">` }
  sh.addEventListener('click', (e) => {
    const lg = e.target.closest('[data-logo]')
    if (lg) { const [em, c1, c2] = LOGOS[+lg.dataset.logo]; av = logoDataURL(em, c1, c2); qs('#cr-av', sh).innerHTML = `<img src="${av}" style="width:90px;height:90px;border-radius:22%;object-fit:cover">`; qsa('[data-logo]', sh).forEach((x) => x.classList.toggle('on', x === lg)); return }
    const p = e.target.closest('[data-p]'); if (p) { pub = +p.dataset.p; qsa('[data-p] .chk', sh).forEach((x) => x.classList.toggle('on', x.closest('[data-p]') === p)) }
    const s = e.target.closest('[data-sw]'); if (s) { ja = ja ? 0 : 1; qs('.sw', s).classList.toggle('on', !!ja) }
  })
  qs('#cr-s', sh).onclick = () => {
    const title = qs('#cr-t', sh).value.trim()
    if (!title) return toast('Nom kiriting')
    const body = { type, title, description: qs('#cr-d', sh).value.trim(), username: qs('#cr-u', sh).value.trim(), is_public: pub, join_approval: ja, avatar: av }
    pickUsers(ch ? 'Obunachi qo‘shish (ixtiyoriy)' : 'A‘zolarni tanlang', async (members) => {
      const c = await post('/chats', { ...body, members })
      S.chats.set(c.id, { ...c, joined: true })
      closeAllSheets()
      toast(ch ? '✅ Kanal yaratildi' : '✅ Guruh yaratildi')
      renderChats(); renderChannels()
      openChat(c.id)
    }, 'Yaratish')
  }
}
function newSheet() {
  const sh = sheet(h3('Yangi') + rowsHTML([row('dm', '💬', 'Yangi suhbat', 'Ism, @username yoki raqam bilan topish'), row('group', '👥', 'Yangi guruh', '200 000 gacha a‘zo'), row('channel', '📢', 'Yangi kanal', 'Cheksiz obunachilarga e’lon'), row('contact', '👤', 'Kontakt qo‘shish'), row('saved', '🔖', 'Saqlangan xabarlar')]))
  sh.onclick = async (e) => {
    const it = e.target.closest('[data-a]'); if (!it) return
    const a = it.dataset.a
    closeSheet(sh)
    if (a === 'group' || a === 'channel') createSheet(a)
    if (a === 'contact') contactForm({})
    if (a === 'saved') openDirectWith(S.me.id)
    if (a === 'dm') findUserSheet()
  }
}
function findUserSheet() {
  const sh = sheet(h3('Kimga yozamiz?') + `<input class="inp" id="fu-q" placeholder="Ism, @username yoki +998 90 123 45 67" autofocus><div class="list" id="fu-l" style="max-height:55vh;overflow:auto"></div>`)
  const l = qs('#fu-l', sh)
  const draw = (us) => (l.innerHTML = us.map((u) => `<div class="item" data-u2="${u.id}">${avHTML(u, 42, { noStory: true, dot: true })}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b></div><div class="t2"><span>${u.username ? '@' + esc(u.username) : esc(lastSeen(u))}</span></div></div></div>`).join('') || '<div class="empty">Hech kim topilmadi</div>')
  draw((S.contacts || []).filter((k) => k.user).map((k) => k.user))
  let t = 0
  qs('#fu-q', sh).oninput = (e) => { clearTimeout(t); const q = e.target.value.trim(); t = setTimeout(async () => { if (q.length < 2) return; try { draw((await api('/search?q=' + encodeURIComponent(q))).users) } catch {} }, 300) }
  l.onclick = (e) => { const it = e.target.closest('[data-u2]'); if (it) { closeSheet(sh); openDirectWith(+it.dataset.u2) } }
}
$('b-new').onclick = newSheet
$('b-create').onclick = () => {
  const sh = sheet(h3('Yaratish') + rowsHTML([row('channel', '📢', 'Kanal'), row('group', '👥', 'Guruh')]))
  sh.onclick = (e) => { const it = e.target.closest('[data-a]'); if (it) { closeSheet(sh); createSheet(it.dataset.a) } }
}

// ---------------- Kanallar bo'limi ----------------
let discoverCache = null
async function renderChannels() {
  const box = $('chanlist')
  const mine = [...S.chats.values()].filter((c) => c.type !== 'direct' && c.joined !== false).sort((a, b) => (b.last_msg_at || 0) - (a.last_msg_at || 0))
  const item = (c) => `<div class="item" data-ch="${c.id}">${avHTML(c, 50, { chat: true })}<div class="mid"><div class="t1"><b>${c.type === 'channel' ? '📢' : '👥'} ${esc(c.title)}</b>${c.role === 'owner' ? '<span class="tagc">egasi</span>' : c.role === 'admin' ? '<span class="tagc">admin</span>' : ''}</div><div class="t2"><span>${c.member_count || 0} ${c.type === 'channel' ? 'obunachi' : 'a‘zo'}${c.username ? ' · @' + esc(c.username) : ''}</span>${c.unread ? `<span class="cnt">${c.unread}</span>` : ''}</div></div></div>`
  const draw = () => {
    const disc = (discoverCache || []).filter((c) => !S.chats.get(c.id) || S.chats.get(c.id).joined === false)
    box.innerHTML = (mine.length ? `<div class="sec">Mening kanal va guruhlarim</div>${mine.map(item).join('')}` : `<div class="empty"><span class="big">📢</span>Kanal yoki guruh yarating — yuqoridagi ➕ tugmasi</div>`) +
      (disc.length ? `<div class="sec">Ommabop ochiq kanallar</div>${disc.map(item).join('')}` : discoverCache ? '' : '<div class="spin"></div>')
  }
  draw()
  try { discoverCache = await api('/discover') } catch { discoverCache = [] }
  draw()
}
$('chanlist').addEventListener('click', (e) => {
  const it = e.target.closest('[data-ch]'); if (!it) return
  const id = +it.dataset.ch
  const c = S.chats.get(id)
  if (c && c.joined !== false) return openChat(id)
  const d = (discoverCache || []).find((x) => x.id === id)
  if (d) chatPreview(d)
})

// ---------------- Men (profil va sozlamalar) ----------------
async function renderMe() {
  const u = S.me
  if (!u) return
  const PR = ['Hamma', 'Kontaktlarim', 'Hech kim']
  let st = null
  try { st = Store.info ? await Promise.resolve(Store.info()) : null } catch {}
  const gb = +(localStorage.getItem('g50_store_gb') || 5)
  $('melist').innerHTML = `<div class="prof">${bigAvatar(u, 112, { cam: true })}<h2>${esc(uname(u))}</h2><div class="mut">${esc(u.phone || '')}${u.username ? ' · @' + esc(u.username) : ''}</div>${u.premium ? '<span class="tagc">⭐ Premium</span>' : ''}</div>
  ${rowsHTML([row('edit', '✏️', 'Profilni tahrirlash', 'Ism, familiya, bio, username'), row('story', '➕', 'Istoriya joylash', '24 soatda o‘chadi; profil rasmingiz atrofida ko‘rinadi'), row('live', '🔴', 'Jonli efir boshlash'), row('saved', '🔖', 'Saqlangan xabarlar'), row('share', '🔗', 'Profilni ulashish')])}
  <div class="sec">Maxfiylik</div>
  ${rowsHTML([row('pphone', '📱', 'Telefon raqamim', PR[u.privacy_phone ?? 1]), row('pseen', '🕒', 'Oxirgi faollik', PR[u.privacy_last_seen ?? 0]), row('blocks', '🚫', 'Bloklanganlar')])}
  <div class="sec">⚙️ Ilova sozlamalari</div>
  <div class="rows">
    ${swRow('p-sounds', '🔊 Ovozli signallar', !!S.prefs.sounds, 'Xabar va qo‘ng‘iroq tovushlari')}
    ${swRow('p-vibrate', '📳 Tebranish', !!S.prefs.vibrate, 'Bosishlarda va yangi xabarda')}
    ${swRow('p-preview', '👀 Xabar matni bildirishnomada', !!S.prefs.preview, 'O‘chiq bo‘lsa faqat «Yangi xabar» ko‘rinadi')}
    ${swRow('p-autoload', '⬇️ Medianini avtomatik yuklash', !!S.prefs.autoload, 'Rasm/video oldindan yuklanadi')}
  </div>
  ${rowsHTML([row('chatview', '🎨', 'Chat ko‘rinishi', 'Shrift hajmi va suhbat foni'), row('trendset', '🔥', 'Trend qiziqishlarim', 'Lentada nima ko‘p chiqishini tanlang')])}
  <div class="sec">🕸 Qurilmalar tarmog‘i (P2P)</div>
  <div class="rows">
    ${swRow('share', 'Tarmoqqa hissa qo‘shish', localStorage.getItem('g50_share') !== '0', 'Ma’lumotlaringiz shifrlangan holda boshqa a’zolarga yetkaziladi')}
    <div style="display:block"><div class="rt">Qurilmada ajratilgan joy: <b id="gb-v">${gb} GB</b><small>Maksimum 30 GB. Joy tugasa eski fayllar avtomatik bo‘shatiladi.</small></div><input type="range" id="gb-r" min="1" max="30" value="${gb}" style="width:100%"></div>
    <div><div class="rt">Hozir band<small>${st ? `${fmtSize(st.used || 0)} / ${st.limitGB} GB · boshqalar uchun ${st.pinned || 0} ta nusxa (${fmtSize(st.pinnedBytes || 0)})` : '—'}</small></div><div class="rt" id="net-st"><small>Tarmoq tekshirilmoqda…</small></div></div>
  </div>
  ${rowsHTML([row('backup', '🗜', 'Butun tarixni zaxiralash', 'Barcha chatlar bitta faylga saqlanadi'), row('clear', '🧹', 'Keshni tozalash', 'Qurilmadagi media fayllar o‘chiriladi', 'red')])}
  <div class="sec">Ilova</div>
  <div class="rows">${swRow('dark', 'Tungi rejim', document.documentElement.classList.contains('dark'))}${swRow('notif', 'Push bildirishnomalar', typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem('g50_push') === '1', 'Ilova yopiq bo‘lsa ham xabar va qo‘ng‘iroqlar yetadi')}</div>
  ${rowsHTML([row('about', 'ℹ️', '50 Gram haqida', 'Versiya 1.1'), row('logout', '🚪', 'Chiqish', '', 'red')])}`
  const r = $('gb-r')
  r.oninput = () => ($('gb-v').textContent = r.value + ' GB')
  r.onchange = () => { Store.setLimit(+r.value); toast('✅ ' + r.value + ' GB ajratildi') }
  api('/storage/stats').then((s2) => { const el = $('net-st'); if (el) el.innerHTML = `<small>Tarmoqda <b>${s2.nodes || 0}</b> qurilma · ${s2.files || 0} fayl · sog‘lom: ${s2.healthy || 0}</small>` }).catch(() => {})
}
$('melist').addEventListener('click', async (e) => {
  if (e.target.closest('[data-cam]')) { e.stopPropagation(); return changeMyAvatar() }
  const s = e.target.closest('[data-sw]')
  if (s) {
    const k = s.dataset.sw, w = qs('.sw', s)
    if (k === 'share') { const on = localStorage.getItem('g50_share') === '0'; localStorage.setItem('g50_share', on ? '1' : '0'); w.classList.toggle('on', on) }
    if (k === 'dark') { const on = !document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', on); localStorage.setItem('g50_dark', on ? '1' : '0'); w.classList.toggle('on', on) }
    if (k === 'notif') {
      if (typeof Notification === 'undefined' || !(await pushCapable())) { w.classList.remove('on'); return toast('Brauzer push‘ni qo‘llamaydi') }
      const wasOn = Notification.permission === 'granted' && localStorage.getItem('g50_push') === '1'
      if (!wasOn) {
        const p = await Notification.requestPermission()
        if (p !== 'granted') { w.classList.remove('on'); return toast('Brauzer sozlamalaridan ruxsat bering') }
        const ok = await pushSubscribeNow().catch(() => false)
        w.classList.toggle('on', !!ok)
        toast(ok ? '✅ Push yoqildi — qurilma yopiq bo‘lsa ham xabar yetadi' : '⚠️ Push ishlamadi (brauzer qo‘llab-quvvatlamasligi mumkin)')
      } else {
        await pushOff()
        w.classList.remove('on')
        toast('Push bildirishnomalar o‘chirildi')
      }
    }
    if (k.startsWith('p-')) { const key = k.slice(2); savePrefs({ [key]: S.prefs[key] ? 0 : 1 }); w.classList.toggle('on', !!S.prefs[key]); if (key === 'autoload') document.body.classList.toggle('noauto', !S.prefs.autoload) }
    return
  }
  const it = e.target.closest('[data-a]'); if (!it) return
  const a = it.dataset.a
  if (a === 'edit') editMeSheet()
  if (a === 'chatview') chatViewSheet()
  if (a === 'trendset') trendInterestsSheet()
  if (a === 'story') createStory()
  if (a === 'live') startLive()
  if (a === 'saved') openDirectWith(S.me.id)
  if (a === 'share') S.me.username ? share('50 Gram: @' + S.me.username, location.origin + location.pathname + '#@' + S.me.username) : toast('Avval username o‘rnating')
  if (a === 'pphone' || a === 'pseen') privacySheet(a === 'pphone' ? 'privacy_phone' : 'privacy_last_seen')
  if (a === 'blocks') blocksSheet()
  if (a === 'clear') { if (await confirmBox('Qurilmadagi barcha media fayllar o‘chirilsinmi? Xabarlar matni saqlanib qoladi.', 'Tozalash')) tryDo(async () => { await Store.clearAll(); mediaCache.clear(); renderMe() }, '🧹 Tozalandi') }
  if (a === 'backup') {
    if (!(await confirmBox('Barcha chatlar tarixi bitta faylga yuklab olinadi. Davom etamizmi?', 'Zaxiralash', false))) return
    toast('⏳ Zaxira tayyorlanmoqda…')
    try {
      await loadChats()
      const out = { app: '50 Gram', exported_at: new Date().toISOString(), me: S.me.username || S.me.phone, chats: [] }
      for (const c of S.chats.values()) {
        if (c.joined === false) continue
        await loadChatLocal(c.id)
        const list = (S.msgs.get(c.id) || []).filter((m) => !m.pending).map((m) => ({ t: m.created_at, who: m.sender_id === S.me.id ? 'siz' : uname(S.users.get(m.sender_id)), kind: m.kind, body: m.body }))
        out.chats.push({ name: chatName(c), type: c.type, messages: list })
      }
      download('50gram-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(out), 'application/json')
      toast('✅ Zaxira tayyor (' + out.chats.length + ' chat)')
    } catch (er) { toast('⚠️ ' + er.message) }
  }
  if (a === 'about') sheet(`<div class="prof"><img src="logo.png" style="width:160px" alt="50 Gram"><h2>50 Gram</h2><div class="mut">Versiya 1.1</div></div><div class="hint">Xabarlar qurilmangizda saqlanadi. Server faqat yetkazib berish uchun vaqtincha ishlatiladi. Media fayllar shifrlangan holda a’zolar qurilmalari orqali tarqatiladi.</div>`)
  if (a === 'logout') { if (await confirmBox('Hisobdan chiqasizmi?', 'Chiqish')) logout() }
})
async function changeMyAvatar() {
  const f = await pickFile('image/*'); if (!f) return
  tryDo(async () => { const avatar = await avatarDataUrl(f); setMe(await patch('/me', { avatar })); renderMe(); renderChats(); loadStories().catch(() => {}) }, '✅ Profil rasmi yangilandi')
}
function editMeSheet() {
  const u = S.me
  const sh = sheet(h3('Profilni tahrirlash') + `<div class="prof">${bigAvatar(u, 96, { cam: true, noStory: true })}</div>
    <input class="inp" id="em-f" maxlength="64" placeholder="Ism" value="${esc(u.first_name || '')}">
    <input class="inp" id="em-l" maxlength="64" placeholder="Familiya" value="${esc(u.last_name || '')}">
    <textarea class="inp" id="em-b" maxlength="200" rows="2" placeholder="Bio — o‘zingiz haqingizda">${esc(u.bio || '')}</textarea>
    <input class="inp" id="em-u" maxlength="32" placeholder="Username (5–32 belgi)" value="${esc(u.username || '')}">
    <div class="hint">Username orqali sizni raqamsiz topishadi: 50gram…/#@username</div>
    <button class="btn big" id="em-s">Saqlash</button>${u.avatar_ver ? '<button class="btn gh big" id="em-x">Profil rasmini o‘chirish</button>' : ''}`)
  const cam = qs('[data-cam]', sh); if (cam) cam.onclick = (e) => { e.stopPropagation(); closeSheet(sh); changeMyAvatar() }
  qs('#em-s', sh).onclick = () => tryDo(async () => { setMe(await patch('/me', { first_name: qs('#em-f', sh).value, last_name: qs('#em-l', sh).value, bio: qs('#em-b', sh).value, username: qs('#em-u', sh).value.trim() })); closeSheet(sh); renderMe() }, '✅ Saqlandi')
  const x = qs('#em-x', sh); if (x) x.onclick = () => tryDo(async () => { setMe(await patch('/me', { avatar: null })); closeSheet(sh); renderMe(); renderChats() }, 'Rasm o‘chirildi')
}
function privacySheet(key) {
  const PR = ['Hamma', 'Kontaktlarim', 'Hech kim']
  const sh = sheet(h3(key === 'privacy_phone' ? 'Telefon raqamimni kim ko‘radi' : 'Oxirgi faolligimni kim ko‘radi') + `<div class="rows">${PR.map((t, i) => `<div data-v="${i}"><div class="rt">${t}</div><span class="chk ${(S.me[key] ?? (key === 'privacy_phone' ? 1 : 0)) === i ? 'on' : ''}"></span></div>`).join('')}</div>`)
  sh.onclick = (e) => { const it = e.target.closest('[data-v]'); if (it) tryDo(async () => { setMe(await patch('/me', { [key]: +it.dataset.v })); closeSheet(sh); renderMe() }, '✅ Saqlandi') }
}
async function blocksSheet() {
  let list
  try { list = await api('/blocks') } catch (e) { return toast('⚠️ ' + e.message) }
  const draw = () => list.map((u) => `<div class="item" data-b="${u.id}">${avHTML(u, 42, { noStory: true })}<div class="mid"><div class="t1"><b>${esc(uname(u))}</b></div></div><button class="btn gh" style="width:auto;padding:6px 12px">Chiqarish</button></div>`).join('') || '<div class="empty">Bloklanganlar yo‘q</div>'
  const sh = sheet(h3('Bloklanganlar') + `<div class="list" id="bl-l">${draw()}</div>`)
  sh.onclick = async (e) => { const it = e.target.closest('[data-b]'); if (!it || !e.target.closest('button')) return; try { await del('/blocks/' + it.dataset.b); list = list.filter((u) => u.id !== +it.dataset.b); qs('#bl-l', sh).innerHTML = draw(); toast('✅ Blokdan chiqarildi') } catch (er) { toast('⚠️ ' + er.message) } }
}

// ---------------- Chat ko'rinishi: shrift va fon ----------------
const WALLS = [
  '', // standart
  'linear-gradient(160deg,#0A7CFF22,#7B2FF733),var(--fon)',
  'linear-gradient(160deg,#FF6A5C22,#B3123A22),var(--fon)',
  'linear-gradient(160deg,#11998e22,#38ef7d22),var(--fon)',
  'linear-gradient(160deg,#f7971e22,#ffd20022),var(--fon)',
  'linear-gradient(160deg,#23252644,#41434544),var(--fon)',
]
function applyWall(i) {
  const m = $('msgs')
  if (m) m.style.background = WALLS[i] || ''
}
function applyFont(px) {
  if (px && px >= 13) document.documentElement.style.setProperty('--msgfs', px + 'px')
  else document.documentElement.style.removeProperty('--msgfs')
}
function initChatView() {
  applyFont(+localStorage.getItem('g50_font') || 0)
  applyWall(+localStorage.getItem('g50_wall') || 0)
}
function chatViewSheet() {
  const cur = +localStorage.getItem('g50_font') || 15
  const curW = +localStorage.getItem('g50_wall') || 0
  const sh = sheet(h3('🎨 Chat ko‘rinishi') + `
    <label class="mut">Shrift hajmi: <b id="cv-fv">${cur}px</b></label>
    <input type="range" id="cv-f" min="13" max="20" value="${cur}" style="width:100%">
    <div class="pv" style="margin:10px 0"><div class="mrow me"><div class="m">Salom! Qanday ahvolda?</div></div><div class="mrow"><div class="m">Yaxshi, rahmat! 😊</div></div></div>
    <label class="mut">Suhbat foni</label>
    <div id="cv-w" style="display:flex;gap:10px;flex-wrap:wrap;padding:6px 0">
      ${WALLS.map((w, i) => `<span data-w="${i}" style="width:44px;height:44px;border-radius:12px;cursor:pointer;border:2.5px solid ${curW === i ? 'var(--asos)' : 'var(--chiziq)'};background:${w || 'var(--fon)'};display:inline-block"></span>`).join('')}
    </div>
    <div class="hint">Shrift va fon darhol qo‘llanadi va qurilmangizda saqlanadi.</div>`)
  const prev = (px) => { qs('.pv', sh).style.fontSize = px + 'px' }
  qs('#cv-f', sh).oninput = (e) => { $('cv-fv').textContent = e.target.value + 'px'; applyFont(+e.target.value); prev(+e.target.value) }
  qs('#cv-f', sh).onchange = (e) => { localStorage.setItem('g50_font', e.target.value); toast('✅ Saqlandi') }
  qs('#cv-w', sh).onclick = (e) => {
    const s = e.target.closest('[data-w]'); if (!s) return
    localStorage.setItem('g50_wall', s.dataset.w)
    applyWall(+s.dataset.w)
    qsa('#cv-w [data-w]', sh).forEach((x) => (x.style.borderColor = x === s ? 'var(--asos)' : 'var(--chiziq)'))
  }
}
// Trend qiziqishlarini qo'lda sozlash (o'zi ochgani hisoblanadi ham)
function trendInterestsSheet() {
  const t = tintGet()
  const sh = sheet(h3('🔥 Trend qiziqishlarim') + `<div class="hint">Ko‘proq qiziqtirgan mavzularingiz lentada ko‘proq chiqadi. Omadi qancha ko‘p bo‘lsa — shunchalik ko‘p chiqadi.</div>` +
    Object.entries(TCATS).filter(([k]) => k !== 'all').map(([k, [e, l]]) => `<div class="rows"><div><div class="rt">${e} ${l}</div><input type="range" data-ti="${k}" min="0" max="10" value="${t[k] || 0}" style="width:110px"></div></div>`).join('') +
    `<div class="tins" id="tins"><div class="rt">🧠 Analiz tizimi yuklanmoqda...</div></div>` +
    `<button class="btn gh big" id="ti-r">Qiziqishlarni tozalash</button>`)
  qs('#ti-r', sh).onclick = () => { try { localStorage.setItem('g50_tint', '{}') } catch {}; toast('Tozalandi'); closeSheet(sh) }
  sh.onchange = (e) => {
    const r = e.target.closest('[data-ti]'); if (!r) return
    const t2 = tintGet()
    if (+r.value > 0) t2[r.dataset.ti] = +r.value; else delete t2[r.dataset.ti]
    try { localStorage.setItem('g50_tint', JSON.stringify(t2)) } catch {}
    toast('✅ Qiziqishlar saqlandi — Trend yangilanadi')
  }
  // 🧠 Analiz tizimi: tizimning joriy qarorlari (faqat agregat statistika ko'rsatiladi)
  api('/trend/insights').then((d) => {
    const el = qs('#tins', sh); if (!el || !d?.ok) return
    if (!d.cats?.length) { el.innerHTML = `<div class="rt">🧠 Analiz tizimi ma'lumot to'playapti — bir necha ko'rishdan keyin qarorlar shakllanadi.</div>`; return }
    const top = d.cats[0]
    const topL = TCATS[top.cat] ? TCATS[top.cat][0] + ' ' + TCATS[top.cat][1] : top.cat
    el.innerHTML = `<div class="rt"><b>🧠 Analiz tizimi qarorlari</b></div>` +
      d.cats.slice(0, 6).map((s) => {
        const L = TCATS[s.cat] ? TCATS[s.cat][0] + ' ' + TCATS[s.cat][1] : s.cat
        return `<div class="trow"><span class="tl">${L}</span><div class="tbar"><i style="width:${s.bar}%"></i></div><small>${s.ctr}% CTR</small></div>`
      }).join('') +
      `<small class="mut">Jami ${fmtN(d.total_imp)} ko‘rish · ${fmtN(d.total_clk)} bosish · Umumiy CTR ${d.ctr}%<br>Tizim qarori: «${topL}» eng katta qiziqish uyg‘otmoqda — lenta shu mavzuga ko‘proq joy beradi.</small>`
  }).catch(() => {})
}
initChatView()
