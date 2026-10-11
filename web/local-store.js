// =====================================================================
// UZBEKGRAM klient: GIBRID SAQLASH
// Xabarlar qurilmada (IndexedDB) saqlanadi. Serverdan olingach -> ack -> server o'chiradi.
// =====================================================================
const API = localStorage.getItem("api") || "https://uzbekgram-api.<sizning-subdomen>.workers.dev"
const DB_NAME = "uzbekgram", DB_VER = 1

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER)
    r.onupgradeneeded = () => {
      const db = r.result
      const m = db.createObjectStore("messages", { keyPath: "client_id" })
      m.createIndex("chat", ["chat_id", "created_at"])
      db.createObjectStore("chats", { keyPath: "id" })
      db.createObjectStore("media", { keyPath: "key" })   // fayllar Blob ko'rinishida
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
const tx = async (store, mode, fn) => {
  const db = await openDb()
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store)
    const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error)
  })
}

export const store = {
  put: (m) => tx("messages", "readwrite", (s) => s.put(m)),
  del: (id) => tx("messages", "readwrite", (s) => s.delete(id)),
  byChat: (chatId) => tx("messages", "readonly", (s) => s.index("chat").getAll(IDBKeyRange.bound([chatId, ""], [chatId, "\uffff"]))),
  putMedia: (key, blob) => tx("media", "readwrite", (s) => s.put({ key, blob })),
  getMedia: (key) => tx("media", "readonly", (s) => s.get(key)),
}

const token = () => localStorage.getItem("token")
const call = (path, opt = {}) =>
  fetch(API + path, { ...opt, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", ...(opt.headers || {}) } })
    .then((r) => r.json())

// ULID-ga o'xshash vaqt bo'yicha tartiblanadigan ID
export const newId = () => (Date.now().toString(36) + crypto.randomUUID().replace(/-/g, "")).slice(0, 26)

// ---- Yuborish: avval qurilmaga yozamiz (tezkor UI), keyin serverga ----
export async function send(chatId, text, extra = {}) {
  const m = { client_id: newId(), chat_id: chatId, payload: text, kind: "text", mine: true, status: "sending", created_at: new Date().toISOString(), ...extra }
  await store.put(m)
  const r = await call("/messages", { method: "POST", body: JSON.stringify(m) })
  m.status = r.ok ? "sent" : "error"
  await store.put(m)
  return m
}

// ---- Qabul qilish: pull -> IndexedDB -> ack (server o'chiradi) ----
export async function sync(onMessage) {
  const rows = await call("/messages/pull")
  if (!Array.isArray(rows) || !rows.length) return 0
  for (const r of rows) {
    if (r.kind === "delete") { await store.del(JSON.parse(r.payload).target); onMessage?.({ deleted: JSON.parse(r.payload).target }); continue }
    if (r.media_key) {
      // Faylni yuklab qurilmaga saqlaymiz — serverdagi nusxa ack dan keyin o'chadi
      const blob = await fetch(`${API}/media/${encodeURIComponent(r.media_key)}`, { headers: { authorization: `Bearer ${token()}` } }).then((x) => x.blob())
      await store.putMedia(r.media_key, blob)
    }
    const m = { ...r, mine: false, status: "received" }
    await store.put(m); onMessage?.(m)
  }
  await call("/messages/ack", { method: "POST", body: JSON.stringify({ ids: rows.map((r) => r.id) }) })
  return rows.length
}

// ---- Real-time: WebSocket signal kelganda sync ----
export function connectRealtime(onMessage) {
  const ws = new WebSocket(API.replace("http", "ws") + "/ws?token=" + token())
  ws.onmessage = (e) => { try { if (JSON.parse(e.data).t === "new") sync(onMessage) } catch {} }
  ws.onopen = () => sync(onMessage)
  ws.onclose = () => setTimeout(() => connectRealtime(onMessage), 3000)
  setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000)
  return ws
}

// ---- O'chirish ----
export async function deleteMessage(chatId, clientId, forEveryone) {
  await store.del(clientId)
  await call("/messages/delete", { method: "POST", body: JSON.stringify({ chat_id: chatId, client_id: clientId, for_everyone: forEveryone }) })
}
