-- 範本卡左上角的模型標籤（Gemini／GPT／Grok／ComfyUI；空字串＝不顯示）
ALTER TABLE templates ADD COLUMN IF NOT EXISTS model_label TEXT NOT NULL DEFAULT '';

-- 回填：GPT Image 2 案例集一律 GPT；使用者存回的依生成模型；其餘依提示詞內文提到的模型
UPDATE templates SET model_label = CASE
    WHEN source_id LIKE 'gpt-image-2:%' THEN 'GPT'
    WHEN suggested_model ILIKE '%comfy%' THEN 'ComfyUI'
    WHEN suggested_model ILIKE '%grok%' THEN 'Grok'
    WHEN suggested_model ILIKE '%gemini%' THEN 'Gemini'
    WHEN suggested_model ILIKE '%gpt%' THEN 'GPT'
    WHEN prompt_en || ' ' || prompt_zh ILIKE ANY (ARRAY['%nano banana%', '%nano-banana%', '%gemini%']) THEN 'Gemini'
    WHEN prompt_en || ' ' || prompt_zh ILIKE ANY (ARRAY['%gpt-4o%', '%gpt4o%', '%chatgpt%', '%gpt image%', '%gpt-image%']) THEN 'GPT'
    WHEN prompt_en || ' ' || prompt_zh ILIKE '%grok%' THEN 'Grok'
    ELSE ''
END
WHERE model_label = '';
