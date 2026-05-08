-- Phase 2：workflow 卡片型別
-- card_type: 'webapp' = 直接呼叫 AI 應用（既有）；'workflow' = 用 workflowId + editable_fields 白名單
-- editable_fields: [{nodeId, fieldName}, ...]，限制使用者只能修改清單裡的欄位

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS card_type        TEXT NOT NULL DEFAULT 'webapp'
        CHECK (card_type IN ('webapp', 'workflow'));

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS workflow_id      TEXT NOT NULL DEFAULT '';

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS editable_fields  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- tasks：workflow 任務也要記錄
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS workflow_id  TEXT NOT NULL DEFAULT '';

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS card_type    TEXT NOT NULL DEFAULT 'webapp';

-- 既有 webapp_id 改為允許空字串（workflow 任務不會有）
ALTER TABLE tasks
    ALTER COLUMN webapp_id SET DEFAULT '';
