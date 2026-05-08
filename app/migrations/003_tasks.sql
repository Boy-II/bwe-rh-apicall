-- Phase 1.5b：使用者任務歷史表
-- 紀錄每次提交到 RunningHub 的任務、結果與耗時，供使用者歷史頁與管理員月度用量統計使用

CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    card_id       TEXT,
    card_title    TEXT NOT NULL DEFAULT '',
    webapp_id     TEXT NOT NULL,
    rh_task_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'QUEUED',
    cost_time     DOUBLE PRECISION,
    results       JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_rh ON tasks(rh_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at) WHERE completed_at IS NOT NULL;
