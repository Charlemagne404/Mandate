ALTER TABLE actions ADD COLUMN grounding_json TEXT CHECK (grounding_json IS NULL OR json_valid(grounding_json));
