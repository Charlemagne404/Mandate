# Executable invariants

Core assertWorld validates the schema then checks:

- entity IDs unique in each collection;
- all references exist, including ownership/control/claims, controlled nation, relations, treaty/conflict/goal participants, events, actions, commands, turns;
- finite statistics within explicit ranges;
- sorted unique bilateral pairs and no self relation;
- treaty parties unique, at least two, no equivalent active duplicates;
- opposing conflict sides nonempty, unique, disjoint; no duplicate active opposing sides;
- goal targets and event references valid;
- date validity and chronological turn chain, monotonic date, consecutive revisions;
- every command belongs to one turn/action and has accepted provenance;
- event source commands belong to its turn; all accepted commands have factual events;
- audit IDs cannot be reused;
- initiative owners/targets/dependencies exist, dependency graphs are acyclic, progress matches actual investment, completion is consistent and equivalent active projects cannot duplicate;
- negotiations have known distinct parties, ordered authorized responses and valid expiry, and accepted binding offers reference matching canonical treaty parties/kind;
- settlement offers/treaties reference matching bilateral conflicts; active ceasefire treaties agree with canonical conflict state and peace references an ended conflict;
- organizations retain unique known members;
- factual event stat effects use known nations and bounded actual before/after indices.

Schema rejects unknown command types and unknown fields. Persistence foreign keys/check constraints reinforce the boundary. Before commit, all invariants run; transaction rollback protects failures after validation too. Tests cover both core rejection and SQLite rollback/restart. Import trust ends only after all checks succeed.

Continuity invariants additionally check crisis severity against its dimensions, related typed resolution conditions, fulfilled canonical demands, participants and dated history; unique directional dependencies; authorized sanctions and expiry; complete conference parties, chronological rounds, invalidated prior consent, no responses after closure and unanimous current-round agreement; legal peace concessions; bounded theater allocation/geography; scheduled tenure and incumbent consistency; declared goal criterion references and deferred priorities; and rooted, dated authorized knowledge disclosure. Forged mutually supporting disclosure records cannot bootstrap secret knowledge.
