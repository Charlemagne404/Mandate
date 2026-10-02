# Canonical world

Version 3 includes Nation (government, leader, synthetic bounded stats), Region (geometry key, owner, controller, claims), canonical bilateral pairs, Treaty, Conflict, StrategicGoal, factual Event, Turn, PlayerAction, and WorldCommandRecord, Initiative, Negotiation, and Organization. Version 1 and 2 save/scenario imports migrate with validated additive defaults; database migration 002 upgrades existing canonical rows. IDs are prefix-validated Zod brands; providers/imports must never invent unknown references.

World arrays are a transport view of normalized SQLite rows. Nation stats use dimensionless proxies 0–100; treasury 0–1 billion; relation scores −100–100. No real GDP/readiness precision is implied. Fixture facts are synthetic, not historical claims.

RegionId is a permanent geography key, independent from nation ID. Legal owner and military controller can differ. Claims confer neither control nor ownership. Nations can exist without land. Geometry is not stored in saves.

Simulation date is validated ISO calendar date, separate from recordedAt wall time. ADVANCE_DATE changes it explicitly and drives accounting ticks, funded initiative progress, conflict exhaustion, diplomatic expiry, and goal deadlines. Turns and revisions are strictly sequential. Empty time progression requires an explicit command; no animation hook advances simulation time.

State and history are schema validated when loaded. Relations are sorted pairs, one record per pair. Active treaties deduplicate by kind and unordered party set. Active conflicts cannot duplicate opposing sides. Event prose is presentation of structured committed commands, never a source of truth.

The expanded indices, offer state machines, organization membership, strategic combat formulas, time accounting, secrecy rules and limitations are documented in [ALPHA_MECHANICS.md](ALPHA_MECHANICS.md). Nation stat effects are computed from actual transitions and retained on factual events. Supplemental model traces are persisted atomically alongside turns but remain outside canonical world/save truth.

Version 3 adds Crisis, EconomicLink, Sanction, Conference, GovernmentTenure and KnowledgeRecord. Goals declare finite evaluation criteria and pressure/reconciliation metadata; conflicts may own bounded strategic theaters. Nations retain synthetic leader names and government strategies; tenure models continuity and turnover without fabricated real biographies. Observer mode releases control while preserving an inspection perspective. Every runtime update remains a typed command or a deterministic consequence of one.
