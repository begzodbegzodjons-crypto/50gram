-- =====================================================================
-- 50 GRAM — TiDB Cloud Serverless sxemasi
-- Gibrid model: shaxsiy/guruh xabarlarining CONTENT'i serverda VAQTINCHA
-- turadi — hamma a'zoga yetkazilgach (message_delivery bo'shashi) NULL
-- qilinadi (purged). Kanal postlari doimiy (ommaviy kontent).
-- Idlar: CHAR(26) (client string kutadi). Vaqt: created_ms BIGINT (UTC ms).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS uzbekgram;
USE uzbekgram;

-- ---------- FOYDALANUVCHILAR ----------
CREATE TABLE IF NOT EXISTS users (
  id          CHAR(26)     PRIMARY KEY,
  username    VARCHAR(20)  NOT NULL UNIQUE,
  password    VARCHAR(200) NOT NULL,                 -- pbkdf2$120000$salt$hash
  name        VARCHAR(80)  NOT NULL,
  phone       VARCHAR(20)  UNIQUE NULL,
  balance     DOUBLE       DEFAULT 1000000,          -- demo hamyon (so'm)
  avatar      VARCHAR(8)   DEFAULT '🙂',
  bio         VARCHAR(200) NULL,
  is_admin    BOOLEAN      DEFAULT FALSE,
  is_banned   BOOLEAN      DEFAULT FALSE,
  ban_reason  VARCHAR(200) NULL,
  created_ms  BIGINT       NOT NULL,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ---------- MAVZULAR ----------
CREATE TABLE IF NOT EXISTS topics (
  id   CHAR(26)    PRIMARY KEY,
  slug VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  emoji VARCHAR(8) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id  CHAR(26) NOT NULL,
  topic_id CHAR(26) NOT NULL,
  weight   DOUBLE   DEFAULT 1,
  PRIMARY KEY (user_id, topic_id)
);

-- ---------- KONTAKTLAR (telefon daftari) ----------
CREATE TABLE IF NOT EXISTS contacts (
  id             CHAR(26)    PRIMARY KEY,
  owner_id       CHAR(26)    NOT NULL,
  name           VARCHAR(80) NOT NULL,
  phone          VARCHAR(20) NOT NULL,
  linked_user_id CHAR(26)    NULL,
  created_ms     BIGINT      NOT NULL,
  UNIQUE KEY uq_owner_phone (owner_id, phone),
  KEY idx_owner (owner_id)
);

-- ---------- SMS OTP (Eskiz uchun zaxira; DEV_MODE kodi javobda) ----------
CREATE TABLE IF NOT EXISTS otp_codes (
  phone     VARCHAR(20) PRIMARY KEY,
  code_hash CHAR(64)    NOT NULL,
  attempts  TINYINT     DEFAULT 0,
  created_ms BIGINT     NOT NULL
);

-- ---------- CHATLAR / GURUHLAR / KANALLAR ----------
CREATE TABLE IF NOT EXISTS chats (
  id          CHAR(26)     PRIMARY KEY,
  type        VARCHAR(10)  NOT NULL,                 -- direct | group | channel
  name        VARCHAR(120) NULL,
  description VARCHAR(300) NULL,
  avatar      VARCHAR(8)   NULL,
  owner_id    CHAR(26)     NULL,
  is_public   BOOLEAN      DEFAULT TRUE,
  is_paid     BOOLEAN      DEFAULT FALSE,
  price       DOUBLE       DEFAULT 0,
  invite_code VARCHAR(20)  UNIQUE NULL,
  created_ms  BIGINT       NOT NULL,
  KEY idx_type (type)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    CHAR(26) NOT NULL,
  user_id    CHAR(26) NOT NULL,
  role       VARCHAR(10) DEFAULT 'member',           -- owner | admin | member
  muted      BOOLEAN     DEFAULT FALSE,
  created_ms BIGINT      NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  KEY idx_member_user (user_id)
);

CREATE TABLE IF NOT EXISTS chat_bans (
  chat_id    CHAR(26) NOT NULL,
  user_id    CHAR(26) NOT NULL,
  reason     VARCHAR(200) NULL,
  created_ms BIGINT   NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id CHAR(26) NOT NULL,
  blocked_id CHAR(26) NOT NULL,
  created_ms BIGINT   NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id             CHAR(26) PRIMARY KEY,
  reporter_id    CHAR(26) NOT NULL,
  chat_id        CHAR(26) NULL,
  target_user_id CHAR(26) NULL,
  kind           VARCHAR(10) DEFAULT 'spam',
  created_ms     BIGINT      NOT NULL,
  KEY idx_reporter (reporter_id)
);

-- ---------- XABARLAR (gibrid) ----------
-- content: matn yoki shifrlangan rasm (enc:v1:...) — yetkazilgach NULL
CREATE TABLE IF NOT EXISTS messages (
  id         CHAR(26)      PRIMARY KEY,
  chat_id    CHAR(26)      NOT NULL,
  sender_id  CHAR(26)      NOT NULL,
  type       VARCHAR(10)   DEFAULT 'text',          -- text | image
  content    LONGTEXT      NULL,
  caption    TEXT          NULL,
  pinned     BOOLEAN       DEFAULT FALSE,
  media_name VARCHAR(255)  NULL,
  purged     BOOLEAN       DEFAULT FALSE,
  created_ms BIGINT        NOT NULL,
  KEY idx_msg_chat (chat_id, created_ms),
  KEY idx_msg_pinned (chat_id, pinned)
);

-- Har bir yetkazilmagan qabul qiluvchi uchun qator; ack → DELETE
CREATE TABLE IF NOT EXISTS message_delivery (
  message_id CHAR(26) NOT NULL,
  user_id    CHAR(26) NOT NULL,
  PRIMARY KEY (message_id, user_id),
  KEY idx_deliv_user (user_id)
);

-- ---------- LENTA ----------
CREATE TABLE IF NOT EXISTS feed_posts (
  id                CHAR(26)     PRIMARY KEY,
  author_id         CHAR(26)     NOT NULL,
  channel_id        CHAR(26)     NULL,
  channel_name      VARCHAR(120) NULL,
  content           TEXT         NOT NULL,
  image             LONGTEXT     NULL,               -- data:image/... (300KB siqilgan)
  gradient          VARCHAR(60)  NULL,
  emoji             VARCHAR(8)   NULL,
  like_count        INT          DEFAULT 0,
  comment_count     INT          DEFAULT 0,
  view_count        INT          DEFAULT 0,
  source_message_id CHAR(26)     UNIQUE NULL,        -- kanal posti mirrori
  created_ms        BIGINT       NOT NULL,
  KEY idx_feed_created (created_ms),
  KEY idx_feed_author (author_id)
);

CREATE TABLE IF NOT EXISTS post_topics (
  post_id  CHAR(26) NOT NULL,
  topic_id CHAR(26) NOT NULL,
  PRIMARY KEY (post_id, topic_id)
);

CREATE TABLE IF NOT EXISTS feed_likes (
  post_id    CHAR(26) NOT NULL,
  user_id    CHAR(26) NOT NULL,
  created_ms BIGINT   NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS feed_comments (
  id         CHAR(26)      PRIMARY KEY,
  post_id    CHAR(26)      NOT NULL,
  user_id    CHAR(26)      NOT NULL,
  content    VARCHAR(1000) NOT NULL,
  created_ms BIGINT        NOT NULL,
  KEY idx_comment_post (post_id)
);

-- ---------- HIKOYALAR (24 soat) ----------
CREATE TABLE IF NOT EXISTS stories (
  id          CHAR(26)     PRIMARY KEY,
  user_id     CHAR(26)     NOT NULL,
  image       LONGTEXT     NULL,
  gradient    VARCHAR(60)  NULL,
  caption     VARCHAR(200) NULL,
  created_ms  BIGINT       NOT NULL,
  expires_ms  BIGINT       NOT NULL,
  KEY idx_story_exp (expires_ms)
);

-- ---------- ELEKTRON GAZETA ----------
CREATE TABLE IF NOT EXISTS news_articles (
  id           CHAR(26)     PRIMARY KEY,
  source       VARCHAR(60)  NOT NULL,
  title        VARCHAR(200) NOT NULL,
  summary      VARCHAR(500) NOT NULL,
  content      TEXT         NOT NULL,
  image        LONGTEXT     NULL,
  gradient     VARCHAR(60)  NULL,
  emoji        VARCHAR(8)   NULL,
  topic_id     CHAR(26)     NOT NULL,
  view_count   INT          DEFAULT 0,
  published_ms BIGINT       NOT NULL,
  KEY idx_news_topic (topic_id)
);

-- ---------- KANAL OBUNALARI / TO'LOVLAR ----------
CREATE TABLE IF NOT EXISTS subscriptions (
  channel_id CHAR(26) NOT NULL,
  user_id    CHAR(26) NOT NULL,
  created_ms BIGINT   NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id           CHAR(26)     PRIMARY KEY,
  user_id      CHAR(26)     NOT NULL,
  owner_id     CHAR(26)     NOT NULL,
  channel_id   CHAR(26)     NOT NULL,
  channel_name VARCHAR(120) NOT NULL,
  amount       DOUBLE       NOT NULL,
  method       VARCHAR(20)  DEFAULT 'hamyon',
  created_ms   BIGINT       NOT NULL,
  KEY idx_pay_user (user_id),
  KEY idx_pay_owner (owner_id)
);

-- ---------- REKLAMA + ADMIN ----------
CREATE TABLE IF NOT EXISTS ads (
  id          CHAR(26)     PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  text        TEXT         NOT NULL,
  image       VARCHAR(255) NULL,                     -- emoji
  link        VARCHAR(255) NULL,
  target_kind VARCHAR(10)  DEFAULT 'groups',         -- groups | channels | all
  status      VARCHAR(12)  DEFAULT 'draft',          -- draft | completed
  sent_count  INT          DEFAULT 0,
  sent_ms     BIGINT       NULL,
  created_ms  BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id         CHAR(26)     PRIMARY KEY,
  action     VARCHAR(40)  NOT NULL,
  target     VARCHAR(40)  NULL,
  detail     VARCHAR(200) NULL,
  created_ms BIGINT       NOT NULL
);

-- ---------- PRESENCE (onlayn foydalanuvchilar) ----------
-- DO har heartbeat'da yangilaydi; 70s dan eskirganlari offline hisoblanadi
CREATE TABLE IF NOT EXISTS presence (
  user_id    CHAR(26) PRIMARY KEY,
  updated_ms BIGINT   NOT NULL
);
