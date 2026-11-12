-- 提示詞範本庫：分類、範本、收藏
CREATE TABLE IF NOT EXISTS template_categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO template_categories(id, name, sort_order) VALUES
    ('ad-kv', '廣告主視覺', 0),
    ('poster-banner', '海報・Banner', 1),
    ('office-slides', '辦公簡報', 2),
    ('design-scene', '設計情境', 3),
    ('packaging', '包裝設計・刀模', 4),
    ('portrait', '寫實人像', 5),
    ('portrait-edit', '人像編輯', 6),
    ('creative', '創意', 7)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS templates (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    category_id     TEXT REFERENCES template_categories(id) ON DELETE SET NULL,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    mode            TEXT NOT NULL DEFAULT 't2i' CHECK (mode IN ('t2i','i2i','edit')),
    prompt_en       TEXT NOT NULL DEFAULT '',
    prompt_zh       TEXT NOT NULL DEFAULT '',
    image_url       TEXT NOT NULL,
    thumb_url       TEXT NOT NULL,
    suggested_model TEXT NOT NULL DEFAULT '',
    source_id       TEXT UNIQUE,
    created_by      TEXT,
    source_task_id  TEXT,
    favorite_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_category_created ON templates(category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_tags ON templates USING GIN (tags);

CREATE TABLE IF NOT EXISTS template_favorites (
    user_id     TEXT NOT NULL,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, template_id)
);
