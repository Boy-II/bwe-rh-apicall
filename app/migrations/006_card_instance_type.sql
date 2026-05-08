-- Phase 2 補充：卡片可指定 GPU instance type
-- default = 24G（預設）；plus = 4090 48G
-- 提交時若為 plus，body 會加上 instanceType: 'plus'（依 RunningHub skill 慣例）
-- 如果實際 RH workflow API 走不同 URL 路徑，調整 proxy.submit_workflow_task 即可

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS instance_type TEXT NOT NULL DEFAULT 'default'
        CHECK (instance_type IN ('default', 'plus'));
