-- =====================================================================
-- 50 Gram — TiDB Cloud (MySQL mos) sxemasi
-- TiDB Cloud konsolida: SQL Editor -> shu faylni to'liq ishga tushiring
-- (Barcha vaqtlar millisekundlarda BIGINT, ID'lar ilova tomonidan yaratiladi)
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(64) NOT NULL DEFAULT '',
  last_name VARCHAR(64) NOT NULL DEFAULT '',
  username VARCHAR(32) NULL UNIQUE,
  bio VARCHAR(200) NOT NULL DEFAULT '',
  avatar MEDIUMTEXT NULL,
  avatar_ver BIGINT NOT NULL DEFAULT 0,
  privacy_phone TINYINT NOT NULL DEFAULT 1,
  privacy_last_seen TINYINT NOT NULL DEFAULT 0,
  last_seen BIGINT NOT NULL DEFAULT 0,
  prefs MEDIUMTEXT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp (
  phone VARCHAR(20) PRIMARY KEY,
  code_hash VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  sent_at BIGINT NOT NULL,
  tries INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  owner_id BIGINT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  first_name VARCHAR(64) NOT NULL DEFAULT '',
  last_name VARCHAR(64) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (owner_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone);

CREATE TABLE IF NOT EXISTS blocks (
  user_id BIGINT NOT NULL,
  blocked_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT PRIMARY KEY,
  type VARCHAR(10) NOT NULL,
  title VARCHAR(128) NOT NULL DEFAULT '',
  description VARCHAR(500) NOT NULL DEFAULT '',
  username VARCHAR(32) NULL UNIQUE,
  avatar MEDIUMTEXT NULL,
  avatar_ver BIGINT NOT NULL DEFAULT 0,
  owner_id BIGINT NOT NULL,
  is_public TINYINT NOT NULL DEFAULT 1,
  invite_hash VARCHAR(24) NOT NULL,
  join_approval TINYINT NOT NULL DEFAULT 0,
  permissions TEXT NULL,
  settings TEXT NULL,
  direct_key VARCHAR(50) NULL UNIQUE,
  member_count INT NOT NULL DEFAULT 0,
  last_msg_at BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_invite ON chats (invite_hash);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'member',
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  last_read BIGINT NOT NULL DEFAULT 0,
  muted TINYINT NOT NULL DEFAULT 0,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS join_requests (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

-- Xabarlar serverda faqat yetkazilguncha turadi (shaxsiy chatda o'qilgach 10 daqiqada o'chadi),
-- guruh/kanalda 30 kun. Tarix foydalanuvchi qurilmasida (IndexedDB) saqlanadi.
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'text',
  body TEXT NULL,
  meta TEXT NULL,
  edited TINYINT NOT NULL DEFAULT 0,
  deleted TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_upd ON messages (chat_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_exp ON messages (expires_at);

CREATE TABLE IF NOT EXISTS reactions (
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  opt INT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Fayllar bo'laklab (base64) saqlanadi — R2 shart emas. Muddat tugagach o'chiriladi.
CREATE TABLE IF NOT EXISTS media (
  id VARCHAR(32) PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  mime VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  name VARCHAR(200) NOT NULL DEFAULT 'fayl',
  size BIGINT NOT NULL DEFAULT 0,
  chunks INT NOT NULL DEFAULT 1,
  complete TINYINT NOT NULL DEFAULT 0,
  sha VARCHAR(64) NULL,
  chat_id BIGINT NOT NULL DEFAULT 0,
  keep TINYINT NOT NULL DEFAULT 0,     -- 1: xabar/postga biriktirilgan, tarmoqda saqlanadi
  gone TINYINT NOT NULL DEFAULT 0,     -- 1: serverdagi nusxa o'chgan, faqat qurilmalarda
  dropped TINYINT NOT NULL DEFAULT 0,  -- 1: egasi o'chirdi, hamma qurilmadan o'chiriladi
  next_check BIGINT NOT NULL DEFAULT 0,
  replicas INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_media_exp ON media (expires_at);
CREATE INDEX IF NOT EXISTS idx_media_check ON media (keep, dropped, next_check);
CREATE INDEX IF NOT EXISTS idx_media_chat ON media (chat_id);

CREATE TABLE IF NOT EXISTS media_chunks (
  media_id VARCHAR(32) NOT NULL,
  idx INT NOT NULL,
  data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (media_id, idx)
);

CREATE TABLE IF NOT EXISTS stories (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  kind VARCHAR(10) NOT NULL,
  media_id VARCHAR(32) NULL,
  text_body VARCHAR(500) NULL,
  bg VARCHAR(200) NULL,
  meta MEDIUMTEXT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories (user_id, expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id BIGINT NOT NULL,
  viewer_id BIGINT NOT NULL,
  reaction VARCHAR(16) NULL,
  viewed_at BIGINT NOT NULL,
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT PRIMARY KEY,
  author_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL DEFAULT 0,
  text_body TEXT NULL,
  media_id VARCHAR(32) NULL,
  media_kind VARCHAR(10) NULL,
  meta MEDIUMTEXT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts (created_at);

-- Trend pozitiv-qayta o'rganish statistikasi (trendWeights/trendEv/trendInsights ishlatadi)
CREATE TABLE IF NOT EXISTS trend_stats (
  cat VARCHAR(20) PRIMARY KEY,
  imp BIGINT NOT NULL DEFAULT 0,
  clk BIGINT NOT NULL DEFAULT 0,
  wt BIGINT NOT NULL DEFAULT 0,
  upd BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id BIGINT PRIMARY KEY,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  text_body VARCHAR(1000) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (post_id, id);

CREATE TABLE IF NOT EXISTS calls (
  id BIGINT PRIMARY KEY,
  caller_id BIGINT NOT NULL,
  callee_id BIGINT NOT NULL,
  video TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL DEFAULT 'ringing',
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lives (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL DEFAULT 0,
  title VARCHAR(200) NOT NULL DEFAULT '',
  viewers INT NOT NULL DEFAULT 0,
  host_kids INT NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL DEFAULT 0
);

-- Efir "daraxti": har tomoshabin efirni o'zidan keyingi 3 ta tomoshabinga uzatadi (cheksiz tomoshabin)
CREATE TABLE IF NOT EXISTS live_viewers (
  live_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  parent_id BIGINT NOT NULL DEFAULT 0,
  depth INT NOT NULL DEFAULT 1,
  kids INT NOT NULL DEFAULT 0,
  ready TINYINT NOT NULL DEFAULT 0,
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (live_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_live_tree ON live_viewers (live_id, ready, depth, kids);
CREATE INDEX IF NOT EXISTS idx_live_parent ON live_viewers (live_id, parent_id);

-- P2P "o'rgimchak to'ri": qaysi foydalanuvchi qurilmasida qaysi fayl bor (fayl o'zi emas, faqat yozuv)
CREATE TABLE IF NOT EXISTS peer_have (
  media_id VARCHAR(32) NOT NULL,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL DEFAULT 0,
  pinned TINYINT NOT NULL DEFAULT 0,
  size BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (media_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_peer_have_upd ON peer_have (updated_at);
CREATE INDEX IF NOT EXISTS idx_peer_have_user ON peer_have (user_id);

-- Saqlash tugunlari: har bir qurilma tarmoqqa bergan joy (ko'pi bilan 30 GB) va ishonchliligi
CREATE TABLE IF NOT EXISTS nodes (
  user_id BIGINT PRIMARY KEY,
  quota BIGINT NOT NULL DEFAULT 0,
  used BIGINT NOT NULL DEFAULT 0,
  online_ms BIGINT NOT NULL DEFAULT 0,
  score DOUBLE NOT NULL DEFAULT 0,      -- 0..1: qancha vaqt onlayn turadi
  first_beat BIGINT NOT NULL,
  last_beat BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_beat ON nodes (last_beat);

-- Server tuzgan vazifa: "shu faylning nusxasini saqla"
CREATE TABLE IF NOT EXISTS pin_jobs (
  media_id VARCHAR(32) NOT NULL,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (media_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pin_jobs_user ON pin_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_pin_jobs_time ON pin_jobs (created_at);

-- Web Push obunalari: brauzer/service worker push endpoint'lari.
-- Xabar ilova yopiq bo'lsa ham qurilmaga yetadi (Telegram-uslubidagi bildirishnoma).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint_hash CHAR(64) PRIMARY KEY,      -- sha256(endpoint): juda uzun URL'ni indekslamaymiz
  user_id BIGINT NOT NULL,
  endpoint VARCHAR(768) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(120) NOT NULL,
  ua VARCHAR(255) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_upd ON push_subs (updated_at);

-- ============================================================
-- Task 29: Coin/Martaba iqtisodiyoti + Kanal izohlari
-- ============================================================

-- Hamyon: coin (sarflanadigan) + earned (umumiy yig'ilgan ball — martaba, kamaymaydi)
CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT PRIMARY KEY,
  coins BIGINT NOT NULL DEFAULT 500,       -- boshlang'ich sovg'a: 500 coin
  earned BIGINT NOT NULL DEFAULT 0,
  spent BIGINT NOT NULL DEFAULT 0,
  gifts_sent INT NOT NULL DEFAULT 0,
  gifts_recv INT NOT NULL DEFAULT 0,
  last_daily BIGINT NOT NULL DEFAULT 0,    -- kunlik +100 bonus vaqti
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallets_earned ON wallets (earned);

-- Kanal postlarining izohlari (a'zolar admin postiga izoh yozadi)
CREATE TABLE IF NOT EXISTS msg_comments (
  id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  body VARCHAR(500) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_comments_mid ON msg_comments (message_id);
CREATE INDEX IF NOT EXISTS idx_msg_comments_chat ON msg_comments (chat_id, created_at);
