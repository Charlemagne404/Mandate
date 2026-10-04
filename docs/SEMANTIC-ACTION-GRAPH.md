# Semantic action interpretation

Player intent now includes a versioned action graph alongside compatibility policy orders and military clause audits. `packages/schemas/src/semantic.ts` owns its schema; `packages/ai/src/semantic.ts` owns deterministic interpretation and structural grounding. Core remains provider-free. The graph is interpretation metadata, while typed WorldCommands and sequential domain validation still own gameplay consequences.

Each node records actor, action, targets, sources, beneficiaries, participants, instruments, assets, territories, organizations, conditions, sequencing, dependencies, intensity, secrecy, desired outcome and unresolved issues. Mentions never populate all later targets. Acquisition owners and requested allies have separate roles. Stable target sets and reference edges bind pronouns once. Explicit map grounding is stored separately from textual and conversational references. Actions store their graph in canonical SQLite history through migrations 007 and 008, so follow-ups can use earlier resolved links ordered by turn revision.

The formalizer proposes clause classifications and semantic roles. Exact entity recognition, aliases, conjunction sets and known references bind IDs; targeted deterministic repairs record the conflicting roles. Semantic validation rejects role changes, unknown references, duplicate IDs, nonexistent/forward dependencies and invalid two-member groups. Resolver proposals and compact candidates cannot bypass grounded target roles or deferred conditions. Foreign planner context excludes the private interpretation graph.

The player executor retains annexation as an objective and external consent as an outcome. Explicitly required unavailable acquired forces block invasion rather than silently substituting normal forces. Unsupported military acquisition is reported as impossible in existing mechanics. Political influence uses a labeled diplomacy initiative. Cyber disruption is saved as an unimplemented objective without invented grid damage. Nuclear wording uses the existing strategic attack abstraction without weapon-specific effects.

Unknown conditions remain deferred as typed standing directives. Only acceptance/refusal tied to a specific canonical negotiation automatically activates a branch on a later turn. Other conditions, time windows and action-result plans remain deferred until their execution requirements are supported or clarified. Neither branch executes speculatively. Automatic activation retires the directive once and uses its stored targets. No new combat, espionage or economic subsystem was added.

The normal result shows the original order, a plain-language interpretation, attempts, audited results, foreign responses and world consequences. Developer workspace exposes the raw action graph, references, role repairs, audit, proposed commands and committed commands.

## Verification

- `pnpm verify`: lint, formatting, TypeScript, tests and production build.
- `pnpm exec vitest run tests/ai/semantic.test.ts`: 150 inputs from 30 independently specified cases with five phrasing/punctuation variants, 2,016 source/target fuzz permutations, and execution, dependency, condition, corruption and context regressions.
- `pnpm exec playwright test tests/e2e/semantic.spec.ts tests/e2e/alpha.spec.ts`: map grounding, deferred execution, save continuity and existing gameplay UI.
- `pnpm exec tsx tools/semantic-real.ts`: raw real-model interpretation against independent semantic expectations.
- `pnpm exec tsx tools/semantic-report.ts`: compare the captured real outputs with current hybrid repair and export exact graphs.
- `pnpm ai:playtest:intent:real`: full real-model nuclear replay. `MANDATE_PLAYER_ORDER` and `MANDATE_INTENT_SCENARIO` select another exact replay.
- `pnpm test:desktop -- --executable <packaged executable>`: native isolation, SQLite, restart, interruption rollback, graph/map persistence and conditional-plan continuity.

## Current boundaries

This is a bounded hybrid parser, not a general natural-language proof system. It handles common action families and canonical scenario entities. Deep nested clauses, ambiguous repeated actions, unresolved troop/asset references, multiple competing diplomatic antecedents and unsupported time/event triggers may be blocked or deferred. Detailed foreign-army acquisition and cyber damage remain unsupported. Territorial names absent from the scenario cannot create new geometry. More than 40 actions is rejected explicitly rather than truncated. A structurally valid model response is never evidence of semantic success.
