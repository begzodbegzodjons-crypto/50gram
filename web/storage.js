/* 50 Gram — Taqsimlangan xotira (har bir qurilma tarmoqqa ko'pi bilan 30 GB beradi)
   - Server har bir faylni 15–20 ta qurilmaga tarqatadi, kamida 2 tasi "doimiy onlayn" qurilma.
   - Qurilma hech qachon belgilangan chegaradan (standart 30 GB) va telefonning bo'sh joyidan oshmaydi:
     har doim kamida 3 GB bo'sh joy qoldiriladi, aks holda eng eski nusxalar o'chiriladi.
   - Bo'shatilgan nusxa haqida serverga xabar beriladi va server boshqa qurilmaga nusxa buyuradi.
   - Fayllar shifrlangan: begona qurilma o'zida saqlayotgan faylni o'qiy olmaydi. */
'use strict'
const Store = (() => {
  const GB = 1024 ** 3, MAX_GB = 30, RESERVE = 3 * GB
  let used = 0, loaded = false, eff = 0, stats = {}
  let chain = Promise.resolve()
  const jobs = []
  let busy = false
  const limitGB = () => Math.max(1, Math.min(MAX_GB, +localStorage.getItem('g50_store_gb') || MAX_GB))
  const q = (fn) => (chain = chain.then(fn).catch(() => {}))

  async function load() {
    const all = await IDB.entries('idx')
    used = all.reduce((a, [, v]) => a + ((v && v.size) || 0), 0)
    loaded = true
  }
  // Faylni hisobga olish (pinned=1: tarmoq uchun saqlanayotgan nusxa)
  function record(id, size, chat, pinned) {
    return q(async () => {
      const o = await IDB.get('idx', id)
      if (!o) used += size || 0
      await IDB.put('idx', id, { size: size || o?.size || 0, chat: chat ?? o?.chat ?? null, pinned: pinned || o?.pinned || 0, at: Date.now() })
      clearTimeout(record.t); record.t = setTimeout(checkSpace, 3000)
    })
  }
  const lastAcc = new Map()
  function access(id) {
    if (Date.now() - (lastAcc.get(id) || 0) < 3600e3) return
    lastAcc.set(id, Date.now())
    q(async () => { const o = await IDB.get('idx', id); if (o) await IDB.put('idx', id, { ...o, at: Date.now() }) })
  }
  // Ishlatsa bo'ladigan joy: foydalanuvchi chegarasi va telefon bo'sh joyi (3 GB zaxira bilan)
  async function quota() {
    let free = 2 * GB
    try { const e = await navigator.storage.estimate(); if (e && e.quota) free = Math.max(0, e.quota - (e.usage || 0)) } catch {}
    eff = Math.max(0, Math.min(limitGB() * GB, used + Math.max(0, free - RESERVE) * 0.9))
    return eff
  }
  async function checkSpace() {
    if (!loaded) await load()
    await quota()
    if (used > eff) await evict(used - eff * 0.9)
  }
  // Joy to'lsa: avval eskirgan tarmoq nusxalari, eng oxirida foydalanuvchining o'z yaqindagi fayllari
  async function evict(bytes) {
    return q(async () => {
      const now = Date.now()
      const all = (await IDB.entries('idx')).map(([id, v]) => ({ id, ...(v || {}) }))
      const own = (x) => (!x.pinned && now - (x.at || 0) < 30 * 86400e3 ? 1 : 0)
      all.sort((a, b) => own(a) - own(b) || (a.at || 0) - (b.at || 0))
      const gone = []
      let freed = 0
      for (const x of all) {
        if (freed >= bytes) break
        await IDB.del('media', x.id); await IDB.del('idx', x.id)
        freed += x.size || 0; used -= x.size || 0
        gone.push(x.id); mediaCache.delete(x.id)
      }
      if (gone.length) post('/storage/drop', { ids: gone }).catch(() => {})
    })
  }
  function remove(ids) {
    return q(async () => {
      for (const id of ids) {
        const o = await IDB.get('idx', id)
        if (o) used -= o.size || 0
        await IDB.del('media', id); await IDB.del('idx', id); mediaCache.delete(id)
      }
    })
  }
  const accepting = () => P2P.enabled() && navigator.onLine !== false
  // Har daqiqada serverga holat: onlaynman, shuncha joy bor — javobda yangi vazifalar
  async function beat() {
    if (!S.token || !S.me) return
    try {
      await checkSpace()
      const accept = accepting()
      const r = await post('/storage/beat', { quota: P2P.enabled() ? Math.floor(eff) : 0, used: Math.floor(used), accept })
      stats = r || {}
      if (r.drops && r.drops.length) await remove(r.drops)
      for (const j of r.jobs || []) if (!jobs.find((x) => x.media_id === j.media_id)) jobs.push(j)
      run()
    } catch {}
  }
  async function run() {
    if (busy) return
    busy = true
    try {
      while (jobs.length && accepting()) {
        const j = jobs.shift()
        if (used + (j.size || 0) > eff) break
        P2P.note(j.media_id, { chat: j.chat_id, sha: j.sha, size: j.size, mime: j.mime })
        try {
          const blob = await getCipher(j.media_id) // serverdan yoki boshqa qurilmadan
          if (j.sha && (await P2P.sha256Hex(blob)) !== j.sha) { await remove([j.media_id]); continue }
          await record(j.media_id, blob.size, j.chat_id, 1)
          await post('/p2p/have', { items: [{ m: j.media_id, c: j.chat_id, p: 1, s: blob.size }] })
        } catch {}
        await sleep(300)
      }
    } finally { busy = false }
  }
  function info() {
    return { used, quota: eff, limitGB: limitGB(), pinned: stats.pinned || 0, pinnedBytes: stats.pinned_bytes || 0, target: stats.target || [15, 20] }
  }
  function setLimit(gb) { localStorage.setItem('g50_store_gb', String(Math.max(1, Math.min(MAX_GB, Math.round(gb))))); checkSpace().then(beat) }
  async function clearAll() {
    const ids = (await IDB.entries('idx')).map(([id]) => id)
    await remove(ids)
    if (ids.length) post('/storage/drop', { ids }).catch(() => {})
  }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist() } catch {}
  setTimeout(beat, 5000)
  setInterval(beat, 60000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat() })
  return { record, access, remove, beat, info, setLimit, clearAll, checkSpace }
})()
