-- 補上 thirdPartyConsumeMoney 欄位
-- RH /v2/query SUCCESS 回應 data.usage 三個成本指標：
--   consumeCoins              → 平台 RH coin（GPU 算力）
--   consumeMoney              → 平台扣除金額（已存於 tasks.consume_money）
--   thirdPartyConsumeMoney    → 第三方 API 真實成本（外部呼叫如 gemini-nano-banana）

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS third_party_consume_money NUMERIC(12, 4);
