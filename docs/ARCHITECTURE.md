# Architecture

Mandate has a pure deterministic simulation core, structured SQLite truth, a service-side proposal pipeline, and a React/MapLibre renderer. Electron composes the same services for desktop play.

```text
Electron main → loopback Fastify + canonical SQLite + snapshot archive
Electron sandboxed renderer → production React/MapLibre

Player directive → typed intent → deterministic relevance/activation
→ perspective contexts → concurrent nation planners → diplomatic moves
→ resolver proposal → capability/reference checks → pure sequential preview
→ selective critic → bounded repair or abort
→ stale-write recheck inside BEGIN IMMEDIATE
→ state + action + commands + factual events + time + turn audit → COMMIT
→ committed-fact narrator + scoped summary → presentation/UI
```

`packages/schemas` owns runtime contracts, branded IDs, branding and versioned formats. `packages/core` owns domain transitions, bounded time mechanics, factual events and executable invariants. It imports no providers, persistence, Node or Electron. `packages/persistence` owns checksummed migrations, SQL transactions, stale revision/hash checks and readback verification. Scenarios are validated genesis imports; geography remains immutable reference data outside saves.

`packages/ai` owns provider transport, role schemas, orchestration and a labeled deterministic fake provider. It gets a value snapshot, never a database handle. Resolver capabilities are narrower than debug capabilities. Arbitrary ownership transfers, direct stat patches, player switching, arbitrary events and direct treaty creation cannot be proposed by a model. Nation planning runs concurrently, but resolution and commit are serial. No transaction is held over a model/network call. Cancellation is checked immediately before synchronous commit; narration failure after commit uses factual fallback rather than undoing reality.

`packages/memory` constructs perspective contexts with exact visible recent events, current commitments/goals/conflicts, and source-linked deterministic historical summaries. Intent disclosure uses source clauses and per-intention audiences; a targeted diplomatic proposal does not disclose a separate private domestic or military intention. Summaries have no mechanical authority.

`apps/server` composes these boundaries and records turn progress. Its archive SQLite database holds provider settings, named/compressed snapshots, failure inspection and downstream presentation. Snapshots restore canonical state through the same validated import transaction, with bounded supplemental turn audits. A branch gets a fresh SaveId and parent SaveId/revision. Before loading or rolling back, the current history is checkpointed. Each autoplay turn commits independently.

`apps/web` renders canonical values and sends typed requests. It contains no adjudication mechanics. Debug editing remains explicit and separate from model authority. Its omniscient developer evidence view is labeled; ordinary events, goals, initiatives and treaty presentation filter private entries by controlled-country participation.

`apps/desktop` starts an ephemeral loopback service, owns native file dialogs, fixed local directories and lifecycle, and exposes a narrow sender-checked preload API. The renderer has no Node privileges. Startup failures preserve the save. The actual Electron 44.5.1 runtime successfully ran the existing node:sqlite driver (Node 24.21.0, SQLite 3.53.4), so no driver migration was needed.

Mutable canonical tables still rebuild under deferred foreign keys, and all historical rows append. This is reliable for a local alpha but produces growing whole-history validation/readback costs. Supplemental turn traces are separate from canonical hash and portable JSON export. Named snapshots preserve them; automatic undo/autosave retention is bounded to 25 each and compressed. Future performance work should measure incremental writes and indexed history retrieval rather than weaken invariant validation.

Source and desktop geography are selected by the saved geographyVersion. A 110m fixture loads its original 177-feature geometry; the 50m global scenario loads its 242-feature dataset. Reference validation uses exact version-specific ID sets. Ownership/control edits never alter either geometry file.
