ALTER TABLE users
    ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN employee_id TEXT UNIQUE,
    ADD COLUMN name TEXT NOT NULL DEFAULT '',
    ADD COLUMN email TEXT NOT NULL DEFAULT '',
    ADD COLUMN division TEXT NOT NULL DEFAULT '',
    ADD COLUMN department TEXT NOT NULL DEFAULT '',
    ADD COLUMN unit TEXT NOT NULL DEFAULT '',
    ADD COLUMN source_status TEXT NOT NULL DEFAULT '',
    ADD COLUMN synced_at TIMESTAMPTZ,
    ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

INSERT INTO settings (key, value) VALUES ('allowed_divisions', '["健康事業處"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_card_type_check;
ALTER TABLE cards ADD CONSTRAINT cards_card_type_check CHECK (card_type IN ('webapp','workflow','model'));
ALTER TABLE cards
    ADD COLUMN category TEXT NOT NULL DEFAULT 'image' CHECK (category IN ('image','video','audio')),
    ADD COLUMN image_mode TEXT NOT NULL DEFAULT '' CHECK (image_mode IN ('','text-to-image','image-to-image')),
    ADD COLUMN model_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN prompt_profile TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE tasks
    ADD COLUMN model_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN raw_response JSONB NOT NULL DEFAULT '{}'::jsonb;
