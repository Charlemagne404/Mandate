-- Additive entity metadata preserves existing normalized political/history rows.
ALTER TABLE events ADD COLUMN effects_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE treaties ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE nations ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE relations ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE conflicts ADD COLUMN strategy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE goals ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE initiatives (id TEXT PRIMARY KEY, nation_id TEXT NOT NULL REFERENCES nations(id), target_nation_id TEXT REFERENCES nations(id), state_json TEXT NOT NULL);
CREATE TABLE negotiations (id TEXT PRIMARY KEY, proposer_nation_id TEXT NOT NULL REFERENCES nations(id), recipient_nation_id TEXT NOT NULL REFERENCES nations(id), treaty_id TEXT REFERENCES treaties(id), state_json TEXT NOT NULL);
CREATE TABLE organizations (id TEXT PRIMARY KEY, state_json TEXT NOT NULL);
CREATE TABLE organization_members (organization_id TEXT NOT NULL REFERENCES organizations(id), nation_id TEXT NOT NULL REFERENCES nations(id), PRIMARY KEY(organization_id,nation_id));
CREATE TABLE turn_audits (turn_id TEXT PRIMARY KEY REFERENCES turns(id), revision INTEGER NOT NULL, trace_json TEXT NOT NULL);
CREATE TABLE world_meta_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  save_id TEXT NOT NULL, ancestry_json TEXT NOT NULL, scenario_json TEXT NOT NULL,
  simulation_date TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0),
  player_nation_id TEXT NOT NULL REFERENCES nations(id) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO world_meta_v2 SELECT singleton,2,save_id,ancestry_json,scenario_json,simulation_date,revision,player_nation_id FROM world_meta;
DROP TABLE world_meta;
ALTER TABLE world_meta_v2 RENAME TO world_meta;
