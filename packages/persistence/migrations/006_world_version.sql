CREATE TABLE world_meta_v3 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  schema_version INTEGER NOT NULL CHECK(schema_version = 3),
  save_id TEXT NOT NULL, ancestry_json TEXT NOT NULL, scenario_json TEXT NOT NULL,
  simulation_date TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0),
  player_nation_id TEXT NOT NULL REFERENCES nations(id) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO world_meta_v3 SELECT singleton,3,save_id,ancestry_json,scenario_json,simulation_date,revision,player_nation_id FROM world_meta;
DROP TABLE world_meta;
ALTER TABLE world_meta_v3 RENAME TO world_meta;
