-- 任務送出時的使用者輸入（nodeInfoList），供「歷史一鍵重跑」使用
-- 提交時序列化整份 nodeInfoList 進去；重跑時前端讀回 pre-fill TaskView 欄位

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS node_input JSONB NOT NULL DEFAULT '[]'::jsonb;
