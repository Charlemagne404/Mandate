CREATE TABLE continuity_entities (collection TEXT NOT NULL, id TEXT NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)), PRIMARY KEY(collection,id));
