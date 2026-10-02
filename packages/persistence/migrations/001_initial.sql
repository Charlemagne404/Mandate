CREATE TABLE world_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  save_id TEXT NOT NULL,
  ancestry_json TEXT NOT NULL,
  scenario_json TEXT NOT NULL,
  simulation_date TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  player_nation_id TEXT NOT NULL REFERENCES nations(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE nations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  government_type TEXT NOT NULL, ideology TEXT NOT NULL, leader TEXT NOT NULL,
  economy INTEGER NOT NULL CHECK(economy BETWEEN 0 AND 100),
  military INTEGER NOT NULL CHECK(military BETWEEN 0 AND 100),
  stability INTEGER NOT NULL CHECK(stability BETWEEN 0 AND 100),
  legitimacy INTEGER NOT NULL CHECK(legitimacy BETWEEN 0 AND 100),
  treasury INTEGER NOT NULL CHECK(treasury BETWEEN 0 AND 1000000000)
);
CREATE TABLE regions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, geometry_id TEXT NOT NULL UNIQUE,
  owner_nation_id TEXT NOT NULL REFERENCES nations(id),
  controller_nation_id TEXT NOT NULL REFERENCES nations(id)
);
CREATE TABLE claims (region_id TEXT NOT NULL REFERENCES regions(id), nation_id TEXT NOT NULL REFERENCES nations(id), PRIMARY KEY(region_id,nation_id));
CREATE TABLE relations (
  nation_a TEXT NOT NULL REFERENCES nations(id), nation_b TEXT NOT NULL REFERENCES nations(id),
  score INTEGER NOT NULL CHECK(score BETWEEN -100 AND 100),
  CHECK(nation_a < nation_b), PRIMARY KEY(nation_a,nation_b)
);
CREATE TABLE treaties (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','ended')), terms TEXT NOT NULL);
CREATE TABLE treaty_parties (treaty_id TEXT NOT NULL REFERENCES treaties(id), nation_id TEXT NOT NULL REFERENCES nations(id), PRIMARY KEY(treaty_id,nation_id));
CREATE TABLE conflicts (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','ended')), escalation INTEGER NOT NULL CHECK(escalation BETWEEN 0 AND 100));
CREATE TABLE conflict_participants (conflict_id TEXT NOT NULL REFERENCES conflicts(id), nation_id TEXT NOT NULL REFERENCES nations(id), side TEXT NOT NULL CHECK(side IN ('attacker','defender')), PRIMARY KEY(conflict_id,nation_id));
CREATE TABLE goals (id TEXT PRIMARY KEY, nation_id TEXT NOT NULL REFERENCES nations(id), title TEXT NOT NULL, priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100), status TEXT NOT NULL, progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100), reason TEXT NOT NULL, created_date TEXT NOT NULL, updated_date TEXT NOT NULL);
CREATE TABLE goal_targets (goal_id TEXT NOT NULL REFERENCES goals(id), nation_id TEXT NOT NULL REFERENCES nations(id), PRIMARY KEY(goal_id,nation_id));
CREATE TABLE turns (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, previous_date TEXT NOT NULL,
  simulation_date TEXT NOT NULL, recorded_at TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE REFERENCES actions(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE actions (
  id TEXT PRIMARY KEY, turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) DEFERRABLE INITIALLY DEFERRED,
  actor_nation_id TEXT NOT NULL REFERENCES nations(id),
  source TEXT NOT NULL CHECK(source IN ('debug','player','system')), text TEXT NOT NULL
);
CREATE TABLE commands (
  id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id),
  action_id TEXT NOT NULL REFERENCES actions(id), ordinal INTEGER NOT NULL,
  simulation_date TEXT NOT NULL, recorded_at TEXT NOT NULL, reason TEXT NOT NULL,
  validation TEXT NOT NULL CHECK(validation = 'accepted'), type TEXT NOT NULL, command_json TEXT NOT NULL,
  UNIQUE(turn_id,ordinal)
);
CREATE TABLE events (
  id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id), ordinal INTEGER NOT NULL,
  simulation_date TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  nation_ids_json TEXT NOT NULL, region_ids_json TEXT NOT NULL, treaty_ids_json TEXT NOT NULL, conflict_ids_json TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK(importance BETWEEN 0 AND 100), topics_json TEXT NOT NULL,
  visibility TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(turn_id,ordinal)
);
CREATE TABLE event_sources (event_id TEXT NOT NULL REFERENCES events(id), command_id TEXT NOT NULL REFERENCES commands(id), PRIMARY KEY(event_id,command_id));
CREATE INDEX events_date ON events(simulation_date);
CREATE INDEX events_type ON events(type);
CREATE INDEX commands_turn ON commands(turn_id);
CREATE INDEX regions_owner ON regions(owner_nation_id);
CREATE INDEX regions_controller ON regions(controller_nation_id);
