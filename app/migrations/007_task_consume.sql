-- 任務真實成本記錄
-- 來源：RH /openapi/v2/query SUCCESS 時 data.usage 內：
--   consumeCoins  → 平台 RH coin（GPU 算力）
--   consumeMoney  → 真實金額（外部 API 串接如 gemini-nano-banana）
-- 兩者皆可能為 null（純內部 GPU 沒 money、純外部呼叫沒 coins）

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS consume_coins INTEGER;

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS consume_money NUMERIC(12, 4);
