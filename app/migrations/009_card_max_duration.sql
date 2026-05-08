-- 卡片個別輪詢最長時長（秒）
-- 0 = 用全域預設（MAX_POLLING_RETRIES × POLLING_INTERVAL）
-- > 0 = 覆寫本地輪詢上限。RH 平台單任務上限 60 分鐘，這裡建議 60-3600 之間

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS max_duration_seconds INTEGER NOT NULL DEFAULT 0;
