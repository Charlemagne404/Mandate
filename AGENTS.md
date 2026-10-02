# Mandate engineering rules

Read @/Users/charliearnerstal/.codex/RTK.md when available; prefix shell commands with `rtk`.

- Core is pure deterministic TypeScript; it may not import AI/providers, persistence, or Node APIs.
- LLMs propose. Code validates. Code commits. Provider output cannot access SQL, shell, filesystem, eval, or arbitrary network capabilities.
- Canonical truth is structured SQLite state, never prose or model memory.
- Mutations use schema-validated typed WorldCommands, then sequential domain validation and hard invariants before commit. Scenario genesis/import are validated transactional boundaries.
- A turn commits atomically, including actions, command provenance, factual events, revision, and simulation time. Failures roll back everything.
- Every committed command has provenance; narration describes committed facts only.
- Region IDs and geometry are permanent; ownership/control changes never rewrite geometry.
- Save/scenario formats are versioned. Untrusted imports pass schemas, references, domain rules, and invariants before transactional replacement.
- Every new mechanic needs tests. Never hide failing tests or bypass invariants; fix the architecture.
- Keep modules cohesive, switches exhaustive, IDs typed, simulation time explicit, and randomness seeded/injected.
- Preserve unrelated changes. Inspect repository status before modifying existing work.
- Branding lives in packages/schemas/src/branding.ts.
- No proprietary Pax Historia code, prompts, artwork, branding, scenarios, or UI assets. Record external licenses in docs/THIRD_PARTY.md.
- AI integration follows the deterministic/map/debug foundation; do not add providers early.
- Run pnpm verify and relevant UI tests. Report local evidence and limitations precisely.
