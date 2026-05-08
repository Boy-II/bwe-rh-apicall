-- 卡片改用預覽圖（cover_url）取代 emoji 圖示
-- icon 欄位保留向後相容，但前端不再顯示

ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT '';
