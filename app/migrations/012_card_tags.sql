-- 卡片標籤：協助使用者搜尋／分類功能卡片
-- 用 JSONB 陣列存（已有 JSONB codec，不需另外設 array codec）

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
