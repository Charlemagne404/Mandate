-- Additive canonical gameplay state; legacy saves receive explicit schema defaults.
ALTER TABLE nations ADD COLUMN strategy_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE commitments (id TEXT PRIMARY KEY, issuer TEXT NOT NULL REFERENCES nations(id), source_negotiation_id TEXT NOT NULL REFERENCES negotiations(id), state_json TEXT NOT NULL);
