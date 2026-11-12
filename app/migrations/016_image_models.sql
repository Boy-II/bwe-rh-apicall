-- 模型清單（取代模型卡片）、任務路由、卡片隱藏旗標
CREATE TABLE IF NOT EXISTS image_models (
    key          TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    mode         TEXT NOT NULL CHECK (mode IN ('text-to-image','image-to-image')),
    provider     TEXT NOT NULL CHECK (provider IN ('runninghub','openai')),
    upstream     TEXT NOT NULL,
    profile      TEXT NOT NULL DEFAULT 'generic',
    params       JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'runninghub';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- 模型卡片改由生成頁下拉選單取代；現有影片／音訊卡片先對使用者隱藏（資料保留）
UPDATE cards SET hidden = TRUE WHERE card_type = 'model' OR category IN ('video','audio');
