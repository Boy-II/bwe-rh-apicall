-- settings 表補上 updated_at 欄位（舊環境建表時可能缺此欄）
ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
