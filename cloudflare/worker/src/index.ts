// ============================================================
// 50 Gram Worker — kirish nuqtasi: REST router + WS proxy + cron
// ============================================================
import type { Env } from './env'
import { openDb, one, exec, type Conn } from './db'
import { json, err, readJson, str } from './util'
import { verifyJwt } from './auth'
import { UserSocket } from './realtime'
export { UserSocket }

import {
  apiRegister,
  apiLogin,
  apiUsernameCheck,
  apiMeGet,
  apiMePatch,
  apiTopics,
  apiUsers,
  apiContactsGet,
  apiContactsPost,
  apiContactDelete,
  type Ctx,
} from './api-auth'
import {
  apiChatsGet,
  apiChatsPost,
  apiChatGet,
  apiChatPatch,
  apiChatDelete,
  apiMembersPost,
  apiMembersDelete,
  apiMembersPatch,
  apiChatMessages,
  apiMutePost,
  apiBansGet,
  apiBansPost,
  apiBansDelete,
  apiChatJoin,
  apiChatLeave,
  apiJoinGet,
  apiJoinPost,
  apiBlocksGet,
  apiBlocksPost,
  apiBlocksDelete,
  apiReportsPost,
  apiDiscover,
  apiSubscribePost,
} from './api-chats'
import {
  apiFeedGet,
  apiFeedPost,
  apiFeedLike,
  apiFeedCommentsGet,
  apiFeedCommentsPost,
  apiFeedView,
  apiStoriesGet,
  apiStoriesPost,
  apiNewsGet,
  apiPaymentsGet,
  apiStatsGet,
} from './api-content'
import {
  apiAdminStats,
  apiAdminUsersGet,
  apiAdminUsersPost,
  apiAdminChatsGet,
  apiAdminChatDelete,
  apiAdminAdsGet,
  apiAdminAdsPost,
  apiAdminAdPatch,
  apiAdminAdDelete,
  apiAdminAdSend,
} from './api-admin'
import { nowMs } from './util'

// ---------- auth middleware ----------
async function auth(req: Request, env: Env, db: Conn): Promise<Ctx | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const payload = await verifyJwt(token, env.JWT_SECRET)
  if (!payload) return null
  // bloklangan foydalanuvchi — ruxsat yo'q
  const user = await one<{ is_banned: number }>(db, 'SELECT is_banned FROM users WHERE id=?', [payload.sub])
  if (!user) return null
  return { env, uid: payload.sub, db }
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const db = openDb(env.DATABASE_URL)

    try {
      // ---------- ochiq endpointlar ----------
      if (req.method === 'POST' && path === '/api/auth/register') return await apiRegister(req, env, db)
      if (req.method === 'POST' && path === '/api/auth/login') return await apiLogin(req, env, db)

      // ---------- token ----------
      const c = await auth(req, env, db)
      if (!c) return err('Avtorizatsiya kerak', 401)

      const seg = path.split('/').filter(Boolean) // ['api', ...]

      // ---------- WebSocket → DO ----------
      if (path === '/ws') {
        const stub = env.USER_SOCKET.get(env.USER_SOCKET.idFromName(c.uid))
        return stub.fetch(req)
      }

      // ---------- mavjudlik uchun 404 uslubi ----------
      const r = seg[1] || ''
      const p1 = seg[2] // :id ko'pincha
      const p2 = seg[3]
      const p3 = seg[4]

      // ----- AUTH/ME/TOPICS/USERS/CONTACTS -----
      if (r === 'auth' && p1 === 'username-check') return apiUsernameCheck(c, url)
      if (r === 'me' && !p1 && req.method === 'GET') return apiMeGet(c)
      if (r === 'me' && !p1 && req.method === 'PATCH') return apiMePatch(req, c)
      if (r === 'topics' && !p1) return apiTopics(c)
      if (r === 'users' && p1 === 'search') return apiUsers(c, url)
      if (r === 'contacts' && !p1 && req.method === 'GET') return apiContactsGet(c)
      if (r === 'contacts' && !p1 && req.method === 'POST') return apiContactsPost(req, c)
      if (r === 'contacts' && p1 && req.method === 'DELETE') return apiContactDelete(c, p1)

      // ----- CHATS -----
      if (r === 'chats' && !p1 && req.method === 'GET') return apiChatsGet(c)
      if (r === 'chats' && !p1 && req.method === 'POST') return apiChatsPost(req, c)
      if (r === 'chats' && p1) {
        const chatId = p1
        if (!p2 && req.method === 'GET') return apiChatGet(c, chatId)
        if (!p2 && req.method === 'PATCH') return apiChatPatch(req, c, chatId)
        if (!p2 && req.method === 'DELETE') return apiChatDelete(c, chatId)
        if (p2 === 'members' && !p3 && req.method === 'POST') return apiMembersPost(req, c, chatId)
        if (p2 === 'members' && !p3 && req.method === 'DELETE') return apiMembersDelete(req, c, chatId)
        if (p2 === 'members' && !p3 && req.method === 'PATCH') return apiMembersPatch(req, c, chatId)
        if (p2 === 'messages' && !p3) return apiChatMessages(c, chatId)
        if (p2 === 'mute' && !p3) return apiMutePost(req, c, chatId)
        if (p2 === 'ban' && !p3 && req.method === 'GET') return apiBansGet(c, chatId)
        if (p2 === 'ban' && !p3 && req.method === 'POST') return apiBansPost(req, c, chatId)
        if (p2 === 'ban' && !p3 && req.method === 'DELETE') return apiBansDelete(req, c, chatId)
        if (p2 === 'join' && !p3) return apiChatJoin(c, chatId)
        if (p2 === 'leave' && !p3) return apiChatLeave(c, chatId)
      }

      // ----- TAKLIFNOMA / BLOK / SHIKOYAT -----
      if (r === 'join' && !p1 && req.method === 'GET') return apiJoinGet(c, url)
      if (r === 'join' && !p1 && req.method === 'POST') return apiJoinPost(req, c)
      if (r === 'blocks' && !p1 && req.method === 'GET') return apiBlocksGet(c)
      if (r === 'blocks' && !p1 && req.method === 'POST') return apiBlocksPost(req, c)
      if (r === 'blocks' && !p1 && req.method === 'DELETE') return apiBlocksDelete(req, c)
      if (r === 'reports' && !p1 && req.method === 'POST') return apiReportsPost(req, c)

      // ----- KANALLAR -----
      if (r === 'channels' && p1 === 'discover') return apiDiscover(c)
      if (r === 'channels' && p1 && p2 === 'subscribe') return apiSubscribePost(c, p1)

      // ----- LENTA -----
      if (r === 'feed' && !p1 && req.method === 'GET') return apiFeedGet(c, url)
      if (r === 'feed' && !p1 && req.method === 'POST') return apiFeedPost(req, c)
      if (r === 'feed' && p1 && p2 === 'like') return apiFeedLike(c, p1)
      if (r === 'feed' && p1 && p2 === 'comments' && req.method === 'GET') return apiFeedCommentsGet(c, p1)
      if (r === 'feed' && p1 && p2 === 'comments' && req.method === 'POST') return apiFeedCommentsPost(req, c, p1)
      if (r === 'feed' && p1 && p2 === 'view') return apiFeedView(c, p1)

      // ----- HIKOYALAR / GAZETA / TO'LOVLAR / STAT -----
      if (r === 'stories' && !p1 && req.method === 'GET') return apiStoriesGet(c)
      if (r === 'stories' && !p1 && req.method === 'POST') return apiStoriesPost(req, c)
      if (r === 'news' && !p1) return apiNewsGet(c, url)
      if (r === 'payments' && !p1) return apiPaymentsGet(c)
      if (r === 'stats' && !p1) return apiStatsGet(c)

      // ----- ADMIN -----
      if (r === 'admin') {
        if (p1 === 'stats') return apiAdminStats(c)
        if (p1 === 'users' && !p2 && req.method === 'GET') return apiAdminUsersGet(c, url)
        if (p1 === 'users' && !p2 && req.method === 'POST') return apiAdminUsersPost(req, c)
        if (p1 === 'chats' && !p2 && req.method === 'GET') return apiAdminChatsGet(c, url)
        if (p1 === 'chats' && p2 && req.method === 'DELETE') return apiAdminChatDelete(c, p2)
        if (p1 === 'ads' && !p2 && req.method === 'GET') return apiAdminAdsGet(c)
        if (p1 === 'ads' && !p2 && req.method === 'POST') return apiAdminAdsPost(req, c)
        if (p1 === 'ads' && p2 && p3 === 'send' && req.method === 'POST') return apiAdminAdSend(req, c, p2)
        if (p1 === 'ads' && p2 && !p3 && req.method === 'PATCH') return apiAdminAdPatch(req, c, p2)
        if (p1 === 'ads' && p2 && !p3 && req.method === 'DELETE') return apiAdminAdDelete(c, p2)
      }

      return err('Topilmadi', 404)
    } catch (e: any) {
      console.error('worker error:', e?.message || e)
      return err(e?.message || 'Server xatosi', 500)
    }
  },

  // ---------- Cron: eski kontentlarni tozalash (har kuni 03:00 UTC) ----------
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const db = openDb(env.DATABASE_URL)
    const weekAgo = nowMs() - 7 * 24 * 3600 * 1000
    // 7 kundan oshgan yetkazilmagan kontent — maxfiylik uchun purge
    await exec(
      db,
      'UPDATE messages SET content=NULL, purged=1 WHERE purged=0 AND created_ms < ? AND id IN (SELECT message_id FROM message_delivery)',
      [weekAgo]
    )
    // muddati tugagan hikoyalar + eski OTP kodlar
    await exec(db, 'DELETE FROM stories WHERE expires_ms < ?', [nowMs()])
    await exec(db, 'DELETE FROM otp_codes WHERE created_ms < ?', [nowMs() - 10 * 60 * 1000])
    // eskirgan presence yozuvlari
    await exec(db, 'DELETE FROM presence WHERE updated_ms < ?', [nowMs() - 7 * 24 * 3600 * 1000])
    console.log('[cron] tozalash yakunlandi')
  },
}

