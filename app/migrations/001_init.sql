-- Phase 1 初始 schema：cards / users / settings
-- Phase 2 會新增 type/workflow_id/editable_fields；Phase 3 會新增 tasks 表

CREATE TABLE IF NOT EXISTS cards (
    id          TEXT PRIMARY KEY,
    webapp_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon        TEXT NOT NULL DEFAULT '🎨',
    color       TEXT NOT NULL DEFAULT '#6C5CE7',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_sort ON cards(sort_order, created_at);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
    role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
