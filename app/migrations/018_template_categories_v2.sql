-- 分類調整：移除「設計情境」「寫實人像」（範本移到「商業攝影」）、「人像編輯」（範本移到「創意」）、「包裝設計・刀模」改名「包裝設計」，
-- 新增 二次元／風格轉換／商業攝影／換臉／換裝
INSERT INTO template_categories(id, name, sort_order) VALUES
    ('commercial-photo', '商業攝影', 3),
    ('anime', '二次元', 5),
    ('style-transfer', '風格轉換', 6),
    ('face-swap', '換臉', 8),
    ('outfit-swap', '換裝', 9)
ON CONFLICT (id) DO NOTHING;

UPDATE templates SET category_id = 'commercial-photo' WHERE category_id IN ('design-scene', 'portrait');
UPDATE templates SET category_id = 'creative' WHERE category_id = 'portrait-edit';
DELETE FROM template_categories WHERE id IN ('design-scene', 'portrait', 'portrait-edit');

UPDATE template_categories SET name = '包裝設計' WHERE id = 'packaging';
UPDATE template_categories SET sort_order = 0 WHERE id = 'ad-kv';
UPDATE template_categories SET sort_order = 1 WHERE id = 'poster-banner';
UPDATE template_categories SET sort_order = 2 WHERE id = 'office-slides';
UPDATE template_categories SET sort_order = 4 WHERE id = 'packaging';
UPDATE template_categories SET sort_order = 10 WHERE id = 'creative';
