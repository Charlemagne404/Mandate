-- Keep applied migration checksums stable. Existing treaty kinds are stored as
-- TEXT; runtime schemas constrain the newly authored alpha vocabulary.
ALTER TABLE treaties ADD COLUMN conflict_id TEXT REFERENCES conflicts(id);
ALTER TABLE negotiations ADD COLUMN conflict_id TEXT REFERENCES conflicts(id);
