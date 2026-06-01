ALTER TABLE content_items ADD COLUMN title_key TEXT NOT NULL DEFAULT '';
ALTER TABLE content_items ADD COLUMN duplicate_of TEXT;
ALTER TABLE content_items ADD COLUMN review_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN review_flags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE content_items ADD COLUMN review_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE content_items ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_content_title_key ON content_items(type, title_key);
CREATE INDEX IF NOT EXISTS idx_content_duplicate_of ON content_items(duplicate_of);
CREATE INDEX IF NOT EXISTS idx_content_review ON content_items(status, review_score);
