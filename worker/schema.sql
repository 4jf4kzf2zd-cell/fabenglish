-- FabEnglish 同步後端的 D1 schema（M7）
-- 建表：npx wrangler d1 execute fabenglish --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,        -- acc_xxxxxxxx
  google_sub TEXT UNIQUE,             -- Google 的使用者 id；還沒綁 Google 時是 NULL
  email      TEXT,
  blob       TEXT,                    -- 進度 JSON（整包，見 SPEC §4.12）
  rev        INTEGER NOT NULL DEFAULT 0,   -- 樂觀鎖版本號，每次寫入 +1
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

-- 配對碼：在 A 裝置產生、B 裝置輸入就綁到同一個帳號。用完即刪、15 分鐘過期。
CREATE TABLE IF NOT EXISTS link_codes (
  code       TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
