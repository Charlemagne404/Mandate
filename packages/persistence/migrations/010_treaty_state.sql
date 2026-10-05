ALTER TABLE treaties ADD COLUMN state_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_json));
