-- 卡片啟用遮罩編輯器
-- 約定：啟用後，第一個 IMAGE 欄位為來源圖，第二個 IMAGE 欄位為 mask（user 端不顯示 mask 欄位，由前端 mask 編輯器自動填入）

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS enable_mask_editor BOOLEAN NOT NULL DEFAULT FALSE;
