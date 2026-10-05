ALTER TABLE turns ADD COLUMN event_metrics_json TEXT CHECK (event_metrics_json IS NULL OR json_valid(event_metrics_json));
ALTER TABLE turns ADD COLUMN suppressed_command_ids_json TEXT CHECK (suppressed_command_ids_json IS NULL OR json_valid(suppressed_command_ids_json));
ALTER TABLE events ADD COLUMN novelty TEXT CHECK (novelty IS NULL OR novelty IN ('maintenance','progress','milestone','new-action','consequence','major-development'));
ALTER TABLE events ADD COLUMN semantic_signature TEXT CHECK (semantic_signature IS NULL OR length(semantic_signature) BETWEEN 1 AND 500);
ALTER TABLE events ADD COLUMN provenance_json TEXT CHECK (provenance_json IS NULL OR json_valid(provenance_json));
ALTER TABLE regions ADD COLUMN recognized_claims_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recognized_claims_json));
