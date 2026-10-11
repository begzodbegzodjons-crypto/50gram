module.exports = [
"[project]/src/lib/realtime.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RealtimeSocket",
    ()=>RealtimeSocket
]);
'use client';
class RealtimeSocket {
    base;
    userId;
    getToken;
    connected;
    ws;
    handlers;
    attempts;
    manualClose;
    pingTimer;
    reconnectTimer;
    constructor(base, userId, getToken){
        this.base = base;
        this.userId = userId;
        this.getToken = getToken;
        this.connected = false;
        this.ws = null;
        this.handlers = new Map();
        this.attempts = 0;
        this.manualClose = false;
        this.pingTimer = null;
        this.reconnectTimer = null;
        this.open();
    }
    url() {
        let b = this.base;
        if (!/^wss?:\/\//.test(b)) {
            b = (("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : 'ws://') + b;
        }
        return /\/ws$/.test(b) ? b : b.replace(/\/$/, '') + '/ws';
    }
    open() {
        try {
            this.ws = new WebSocket(this.url());
        } catch  {
            this.scheduleReconnect();
            return;
        }
        this.ws.onopen = ()=>{
            this.connected = true;
            this.attempts = 0;
            this.fire('connect', {});
            // DO auth frame kutadi
            this.emit('auth', {
                userId: this.userId,
                token: this.getToken()
            });
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.pingTimer = setInterval(()=>{
                if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({
                    e: 'ping'
                }));
            }, 25_000);
        };
        this.ws.onclose = ()=>{
            const was = this.connected;
            this.connected = false;
            if (this.pingTimer) clearInterval(this.pingTimer);
            if (was) this.fire('disconnect', {});
            if (!this.manualClose) this.scheduleReconnect();
        };
        this.ws.onerror = ()=>{};
        this.ws.onmessage = (ev)=>{
            if (typeof ev.data !== 'string' || ev.data === 'pong') return;
            try {
                const frame = JSON.parse(ev.data);
                if (frame?.e) this.fire(frame.e, frame.d ?? {});
            } catch  {}
        };
    }
    scheduleReconnect() {
        if (this.attempts >= 10) return;
        this.attempts++;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(()=>this.open(), 1500);
    }
    fire(event, data) {
        const set = this.handlers.get(event);
        if (set) for (const fn of [
            ...set
        ])fn(data);
    }
    on(event, fn) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(fn);
    }
    off(event, fn) {
        this.handlers.get(event)?.delete(fn);
    }
    emit(event, data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                e: event,
                d: data ?? {}
            }));
        }
    }
    disconnect() {
        this.manualClose = true;
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.ws?.close();
        this.ws = null;
    }
}
}),
"[project]/src/lib/api.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "API_BASE",
    ()=>API_BASE,
    "api",
    ()=>api,
    "getToken",
    ()=>getToken,
    "setToken",
    ()=>setToken
]);
'use client';
// API klienti — token bilan ishlaydi
// Lokal dev: shu Next.js API route'lariga; Cloudflare: Worker manziliga
// (NEXT_PUBLIC_API_BASE orqali).
const TOKEN_KEY = 'uzbekgram_token';
const API_BASE = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE || '';
function getToken() {
    if ("TURBOPACK compile-time truthy", 1) return null;
    //TURBOPACK unreachable
    ;
}
function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
}
async function api(path, options = {}) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
        method: options.method || (options.body ? 'POST' : 'GET'),
        headers: {
            'Content-Type': 'application/json',
            ...token ? {
                Authorization: `Bearer ${token}`
            } : {}
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
        throw new Error(data.error || 'Xatolik yuz berdi');
    }
    return data;
}
}),
"[project]/src/lib/store.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useStore",
    ()=>useStore
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/zustand/esm/react.mjs [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$socket$2e$io$2d$client$2f$build$2f$esm$2d$debug$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/socket.io-client/build/esm-debug/index.js [app-ssr] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$realtime$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/realtime.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/api.ts [app-ssr] (ecmascript)");
'use client';
;
;
;
;
const useStore = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zustand$2f$esm$2f$react$2e$mjs__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["create"])((set, get)=>({
        me: null,
        authLoading: true,
        topics: [],
        onlineUserIds: new Set(),
        socket: null,
        socketConnected: false,
        screen: 'chats',
        activeChatId: null,
        init: async ()=>{
            try {
                const topics = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"])('/api/topics');
                set({
                    topics
                });
            } catch  {}
            if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["getToken"])()) {
                set({
                    authLoading: false
                });
                return;
            }
            try {
                const me = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"])('/api/me');
                set({
                    me,
                    authLoading: false
                });
                get().connectSocket();
            } catch  {
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["setToken"])(null);
                set({
                    authLoading: false
                });
            }
        },
        login: async (username, password)=>{
            const res = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"])('/api/auth/login', {
                body: {
                    username,
                    password
                }
            });
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["setToken"])(res.token);
            set({
                me: res.me
            });
            get().connectSocket();
        },
        register: async (data)=>{
            const res = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["api"])('/api/auth/register', {
                body: data
            });
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["setToken"])(res.token);
            set({
                me: res.me
            });
            get().connectSocket();
        },
        logout: ()=>{
            get().disconnectSocket();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["setToken"])(null);
            set({
                me: null,
                screen: 'chats',
                activeChatId: null,
                onlineUserIds: new Set()
            });
        },
        setScreen: (s)=>set({
                screen: s,
                activeChatId: null
            }),
        openChat: (chatId)=>set({
                activeChatId: chatId,
                screen: 'chats'
            }),
        setTopics: (t)=>set({
                topics: t
            }),
        connectSocket: ()=>{
            const { socket, me } = get();
            if (socket || !me) return;
            // Dev muhitda (port 3000) XTransform proxy yo'q → chat-service'ga
            // to'g'ridan-to'g'ri ulanamiz; production'da XTransform header ishlaydi.
            // Cloudflare rejimi: NEXT_PUBLIC_WS_BASE berilgan bo'lsa — Durable Object
            // WebSocket'ga ulanamiz (socket.io emas). Aks holda lokal dev — socket.io.
            const wsBase = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_WS_BASE : undefined;
            const s = wsBase ? new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$realtime$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["RealtimeSocket"](wsBase, me.id, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["getToken"]) : (()=>{
                const socketUrl = ("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : '/?XTransformPort=3003';
                return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$socket$2e$io$2d$client$2f$build$2f$esm$2d$debug$2f$index$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$locals$3e$__["io"])(socketUrl, {
                    transports: [
                        'websocket',
                        'polling'
                    ],
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: 1500
                });
            })();
            s.on('connect', ()=>{
                set({
                    socketConnected: true
                });
                s.emit('auth', {
                    userId: me.id,
                    token: (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["getToken"])()
                });
            });
            s.on('disconnect', ()=>set({
                    socketConnected: false
                }));
            s.on('presence:state', (data)=>{
                get().markOnline(data.online);
            });
            s.on('presence:update', (data)=>{
                const prev = new Set(get().onlineUserIds);
                if (data.online) prev.add(data.userId);
                else prev.delete(data.userId);
                set({
                    onlineUserIds: prev
                });
            });
            set({
                socket: s
            });
        },
        disconnectSocket: ()=>{
            get().socket?.disconnect();
            set({
                socket: null,
                socketConnected: false
            });
        },
        markOnline: (ids)=>set({
                onlineUserIds: new Set(ids)
            })
    }));
}),
"[project]/src/lib/local-store.ts [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "clearChatMessages",
    ()=>clearChatMessages,
    "compressImage",
    ()=>compressImage,
    "decryptForChat",
    ()=>decryptForChat,
    "deleteLocalMessage",
    ()=>deleteLocalMessage,
    "encryptForChat",
    ()=>encryptForChat,
    "estimateStorage",
    ()=>estimateStorage,
    "getChatMessages",
    ()=>getChatMessages,
    "getLocalStats",
    ()=>getLocalStats,
    "getMediaUrl",
    ()=>getMediaUrl,
    "rememberMediaUrl",
    ()=>rememberMediaUrl,
    "saveLocalMessage",
    ()=>saveLocalMessage,
    "saveMedia",
    ()=>saveMedia
]);
// ============================================================
// 50 Gram — qurilmadagi lokal ombor (IndexedDB)
//  - messages: har chatning xabar tarixi (chatId indeksi)
//  - media:    rasm/blob fayllar (xabar idsi bilan)
// Shifrlash: AES-GCM-256, kalit PBKDF2(chatId + qurilma salt, 120k iter)
// Format:    "enc:v1:<iv:b64>:<data:b64>"
// Serverda matnlar/purgelar qolmaydi — kontent faqat qurilmada.
// ============================================================
const DB_NAME = '50gram-local';
const DB_VERSION = 1;
const MESSAGES = 'messages';
const MEDIA = 'media';
// --- Qurilma salt (bir marta yaratiladi, localStorage'da turadi) ---
function deviceSalt() {
    if ("TURBOPACK compile-time truthy", 1) return 'server';
    //TURBOPACK unreachable
    ;
    let salt;
}
// --- Kalit derivatsiyasi: PBKDF2(chatId, qurilma salt, 120k, SHA-256) → AES-GCM 256 ---
async function deriveKey(chatId) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(chatId), 'PBKDF2', false, [
        'deriveKey'
    ]);
    return crypto.subtle.deriveKey({
        name: 'PBKDF2',
        salt: enc.encode(chatId + ':' + deviceSalt()),
        iterations: 120000,
        hash: 'SHA-256'
    }, keyMaterial, {
        name: 'AES-GCM',
        length: 256
    }, false, [
        'encrypt',
        'decrypt'
    ]);
}
// --- b64 yordamchilari (katta bufferlar bo'laklab o'tkaziladi) ---
function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for(let i = 0; i < bytes.length; i += chunk){
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++)out[i] = bin.charCodeAt(i);
    return out;
}
// ============================================================
// IndexedDB yadros
// ============================================================
let dbPromise = null;
function openDb() {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB mavjud emas (SSR)'));
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject)=>{
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = ()=>{
                const db = req.result;
                if (!db.objectStoreNames.contains(MESSAGES)) {
                    const s = db.createObjectStore(MESSAGES, {
                        keyPath: 'id'
                    });
                    s.createIndex('chatId', 'chatId', {
                        unique: false
                    });
                }
                if (!db.objectStoreNames.contains(MEDIA)) {
                    db.createObjectStore(MEDIA, {
                        keyPath: 'id'
                    });
                }
            };
            req.onsuccess = ()=>resolve(req.result);
            req.onerror = ()=>reject(req.error);
        });
    }
    return dbPromise;
}
function tx(store, mode, run) {
    return openDb().then((db)=>new Promise((resolve, reject)=>{
            const t = db.transaction(store, mode);
            const req = run(t.objectStore(store));
            req.onsuccess = ()=>resolve(req.result);
            req.onerror = ()=>reject(req.error);
        }));
}
async function saveLocalMessage(m) {
    await tx(MESSAGES, 'readwrite', (s)=>s.put(m));
}
async function getChatMessages(chatId) {
    const all = await tx(MESSAGES, 'readonly', (s)=>s.index('chatId').getAll(chatId));
    return (all || []).sort((a, b)=>a.createdAt - b.createdAt);
}
async function deleteLocalMessage(id) {
    // media ham birga o'chiriladi
    await deleteMedia(id);
    await tx(MESSAGES, 'readwrite', (s)=>s.delete(id));
}
async function clearChatMessages(chatId) {
    const all = await getChatMessages(chatId);
    for (const m of all){
        await deleteMedia(m.id);
        await tx(MESSAGES, 'readwrite', (s)=>s.delete(m.id));
    }
}
// ============================================================
// Media (media store)
// ============================================================
// Yaratilgan object URL'lar keshi — bir xil id uchun doim bir xil URL
const urlCache = new Map();
async function saveMedia(id, blob) {
    // eski url keshi tozalash (yangi blob qo'yildi)
    const old = urlCache.get(id);
    if (old) {
        try {
            URL.revokeObjectURL(old);
        } catch  {}
        urlCache.delete(id);
    }
    await tx(MEDIA, 'readwrite', (s)=>s.put({
            id,
            blob
        }));
}
async function getMediaUrl(id) {
    const cached = urlCache.get(id);
    if (cached) return cached;
    try {
        const rec = await tx(MEDIA, 'readonly', (s)=>s.get(id));
        if (!rec || !rec.blob) return null;
        const url = URL.createObjectURL(rec.blob);
        urlCache.set(id, url);
        return url;
    } catch  {
        return null;
    }
}
async function rememberMediaUrl(id, url) {
    // masalan yuborish paytida createObjectURL qilingan bo'lsa — eslab qolamiz
    urlCache.set(id, url);
}
async function deleteMedia(id) {
    const old = urlCache.get(id);
    if (old) {
        try {
            URL.revokeObjectURL(old);
        } catch  {}
        urlCache.delete(id);
    }
    try {
        await tx(MEDIA, 'readwrite', (s)=>s.delete(id));
    } catch  {}
}
async function encryptForChat(chatId, buf) {
    const key = await deriveKey(chatId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv
    }, key, buf);
    return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(data))}`;
}
async function decryptForChat(chatId, content) {
    const parts = content.split(':');
    if (parts.length !== 4 || parts[0] !== 'enc' || parts[1] !== 'v1') {
        throw new Error('Noma\u2019lum shifrlash formati');
    }
    const iv = b64ToBytes(parts[2]);
    const data = b64ToBytes(parts[3]);
    const key = await deriveKey(chatId);
    const plain = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: iv
    }, key, data);
    return plain;
}
// ============================================================
// Rasm siqish: max kenglik + sifat, jpeg chiqish
// ============================================================
function loadImageEl(file) {
    return new Promise((resolve, reject)=>{
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = ()=>{
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (e)=>{
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}
async function compressImage(file, maxW = 1280, quality = 0.82) {
    let source;
    try {
        source = await createImageBitmap(file);
    } catch  {
        source = await loadImageEl(file);
    }
    const w0 = 'width' in source ? source.width : source.naturalWidth;
    const h0 = 'height' in source ? source.height : source.naturalHeight;
    const scale = Math.min(1, maxW / Math.max(1, w0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2d mavjud emas');
    ctx.drawImage(source, 0, 0, w, h);
    if ('close' in source && typeof source.close === 'function') source.close();
    return new Promise((resolve, reject)=>{
        canvas.toBlob((blob)=>{
            if (blob) resolve(blob);
            else reject(new Error('Rasmlarni siqish amalga oshmadi'));
        }, 'image/jpeg', quality);
    });
}
async function getLocalStats() {
    try {
        const [msgCount, mediaCount, chats] = await Promise.all([
            tx(MESSAGES, 'readonly', (s)=>s.count()),
            tx(MEDIA, 'readonly', (s)=>s.count()),
            getChatKeys()
        ]);
        return {
            messages: msgCount,
            media: mediaCount,
            chats: chats.length
        };
    } catch  {
        return {
            messages: 0,
            media: 0,
            chats: 0
        };
    }
}
async function getChatKeys() {
    const all = await tx(MESSAGES, 'readonly', (s)=>s.getAll());
    return Array.from(new Set((all || []).map((m)=>m.chatId)));
}
async function estimateStorage() {
    try {
        const est = await navigator.storage?.estimate?.();
        return {
            usage: est?.usage ?? 0,
            quota: est?.quota ?? 0
        };
    } catch  {
        return {
            usage: 0,
            quota: 0
        };
    }
}
}),
"[project]/src/app/page.tsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/store.ts [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$auth$2d$screen$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/uzbekgram/auth-screen.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$app$2d$shell$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/uzbekgram/app-shell.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$media$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/components/uzbekgram/media.tsx [app-ssr] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__ = __turbopack_context__.i("[project]/node_modules/lucide-react/dist/esm/icons/loader-circle.js [app-ssr] (ecmascript) <export default as Loader2>");
'use client';
;
;
;
;
;
;
;
function Home() {
    const me = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useStore"])((s)=>s.me);
    const authLoading = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useStore"])((s)=>s.authLoading);
    const init = (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$store$2e$ts__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useStore"])((s)=>s.init);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        void init();
    }, [
        init
    ]);
    if (authLoading) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "h-dvh flex flex-col items-center justify-center bg-background",
            children: [
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "neu h-24 w-24 rounded-[1.8rem] flex items-center justify-center text-5xl mb-5 neu-float",
                    children: "✈️"
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 22,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                    className: "mb-3",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$media$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["Logo3D"], {
                        className: "text-5xl"
                    }, void 0, false, {
                        fileName: "[project]/src/app/page.tsx",
                        lineNumber: 26,
                        columnNumber: 11
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 25,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "groove w-56 my-3"
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 28,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                    className: "text-sm uppercase tracking-[0.2em] text-muted-foreground mb-6",
                    children: "Gibrid messenjer"
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 29,
                    columnNumber: 9
                }, this),
                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$lucide$2d$react$2f$dist$2f$esm$2f$icons$2f$loader$2d$circle$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__$3c$export__default__as__Loader2$3e$__["Loader2"], {
                    className: "h-5 w-5 animate-spin text-muted-foreground"
                }, void 0, false, {
                    fileName: "[project]/src/app/page.tsx",
                    lineNumber: 32,
                    columnNumber: 9
                }, this)
            ]
        }, void 0, true, {
            fileName: "[project]/src/app/page.tsx",
            lineNumber: 21,
            columnNumber: 7
        }, this);
    }
    return me ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$app$2d$shell$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
        fileName: "[project]/src/app/page.tsx",
        lineNumber: 37,
        columnNumber: 15
    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$components$2f$uzbekgram$2f$auth$2d$screen$2e$tsx__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
        fileName: "[project]/src/app/page.tsx",
        lineNumber: 37,
        columnNumber: 30
    }, this);
}
}),
];

//# sourceMappingURL=src_c53e72ed._.js.map