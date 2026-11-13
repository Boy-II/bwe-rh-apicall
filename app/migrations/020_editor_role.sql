-- 範本編輯者：可管理範本分類、編輯範本（不含刪除與其他管理功能）
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'editor', 'admin'));
