# Saves and timelines

SQLite is runtime truth. Portable export uses `formatVersion: 3`, `kind: save`, and schema-version-3 `world`. Version 1 and 2 files migrate with neutral defaults and empty added collections, then pass the same domain/reference/invariant/geography checks. Unsupported versions fail explicitly.

Import performs schema/migration and complete validation before BEGIN IMMEDIATE. It rechecks the active world's expected revision/hash, replaces canonical state/history transactionally, validates readback and commits. Invalid imports or audit restores roll back everything. Files cannot supply database paths or executable scripts. canonicalHash normalizes keyed collections and object keys; a close/reopen must preserve it.

Portable JSON contains complete canonical state and action/command/event history. It omits supplemental model traces, provider configuration and downstream narration. Named snapshots in the archive preserve model audits along with canonical state; restored audits must reference known turns, be unique and obey bounds. Snapshot JSON is compressed inside SQLite. It is not a source of mechanics.

Every accepted turn persists automatically. The archive retains 25 pre-turn undo and 25 post-turn autosave checkpoints. Named snapshots are retained until separately managed. Loading a snapshot first preserves the current history. Branching gives the restored snapshot a new SaveId and records parentSaveId/parentRevision. Rollback imports the previous-turn checkpoint of the same timeline, restoring canonical state and history rather than reversing UI text. Independent branches can be resumed from their named checkpoints.

Only one timeline is active in the canonical database at a time; this is snapshot branching, not a copy-on-write multi-database timeline engine. Export a named branch to move it between machines; its canonical history survives, but model-call evidence is local to the snapshot archive. Save signatures, encryption and an ancestry graph UI are not implemented.

Migration 005 stores validated crisis, dependency, sanction, conference, tenure and knowledge rows keyed by collection and ID. Migration 006 upgrades the canonical version constraint. Existing migration checksums are preserved. Portable version 3 includes all continuity collections, declared goal criteria, theater state, scenario rules and observer control. Semantic comparison uses named snapshots with verified common ancestry; it does not replay arbitrary dates or raw SQL rows.
