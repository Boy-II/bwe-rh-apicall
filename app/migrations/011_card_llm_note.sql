-- 卡片新增 llm_note：給 LLM 看的功能規格／欄位用途說明
-- 區分於 description（使用者可見）：llm_note 不在使用者 UI 顯示，只進 chat system prompt
-- 用法：admin 在卡片編輯 modal 填寫，AI 助手回答相關問題時優先參考此欄位

ALTER TABLE cards
    ADD COLUMN IF NOT EXISTS llm_note TEXT NOT NULL DEFAULT '';
