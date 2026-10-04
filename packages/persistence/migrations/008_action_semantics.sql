ALTER TABLE actions ADD COLUMN semantic_graph_json TEXT CHECK (semantic_graph_json IS NULL OR json_valid(semantic_graph_json));
