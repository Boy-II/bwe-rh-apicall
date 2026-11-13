-- 本地 ComfyUI：workflow 卡片可選擇在工作站的 ComfyUI 執行（instance_type='comfyui'）
-- comfy_workflow 存 ComfyUI「Export (API)」格式的 workflow JSON
ALTER TABLE cards ADD COLUMN IF NOT EXISTS comfy_workflow JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_instance_type_check;
ALTER TABLE cards ADD CONSTRAINT cards_instance_type_check
    CHECK (instance_type IN ('default', 'plus', 'comfyui'));
