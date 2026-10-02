# Mandate inference boundary

The orchestrator proposes a `CommitRequest` and an observable `TurnTrace`. It has no database, filesystem, SQL, shell, or model tool handles. The application rechecks revision/hash and commits through the existing persistence transaction. Provider output never becomes canonical state by itself.

`createProvider(ProviderConfig.parse(config))` supports:

- `fake`: deterministic demo rules; recognizes a bounded vocabulary and named countries. This is suitable for CI, autoplay, and exploring mechanics. It is not general natural-language understanding.
- `ollama`: local `/api/chat` structured JSON-schema generation and `/api/tags` health.
- `openai-compatible`: `/chat/completions` with strict JSON-schema response format and `/models` health. Compatibility depends on the endpoint implementing that format.

Configuration accepts one model, partial role-specific model overrides, timeout, bounded retries, temperature, and a context budget in **characters**. HTTP inference redirects are rejected, response bodies are streamed with a 1 MB limit, and API keys are not placed in prompts or call records. Cancellation is propagated through inference and checked again before returning a commit request.

## Turn workflow

1. Formalize player text into versioned structured intentions referencing exact source clauses. An observer turn skips formalization.
2. Select affected actors and commitments deterministically. Prioritize active crisis actors and reserve rotating background slots so small countries are not permanently ignored.
3. Build each government's scoped canonical context, visible recent history, and exact factual summary. Government planners run concurrently. Required actor failure aborts; an unrelated background failure can be omitted.
4. Run diplomatic speakers where an addressed offer exists. Consent identifies the exact pending negotiation, participants, visibility, move, and counter terms.
5. Resolve intentions through finite permitted commands. Repair is limited to one additional attempt. Debug stat/territory/government mutation and direct treaty creation are forbidden resolver capabilities.
6. Validate schemas, known references, actor capabilities, secrecy, and consent; preview sequential domain rules and all invariants through the pure core. Important conflict/negotiation resolutions and deep mode receive a semantic critic pass.
7. Return the request and trace to the application for atomic commit. Narration runs afterward and selects only committed visible event IDs. Text falls back to canonical event titles. Historical summaries cite exact event IDs and remain subordinate to live state.

Model records capture provider/model, role, prompt version, context references, raw structured output, parsed output, latency, transport retries, repair attempt, and validation failures. These are observable decisions and application-facing explanations; hidden chain-of-thought is neither requested nor required.

## Perspective and secrecy

Each intention has source clause IDs, affected nation IDs, and visibility. Foreign recipients of a private compound action receive authorized diplomatic clauses; internal military/economic clauses remain with their owner. Transmitted canonical player offers are reconstructed from authorized clauses, so a resolver paraphrase cannot insert an unrelated internal instruction into later diplomatic history.

Foreign government context includes public capability proxies, while exact treasury, fiscal capacity, military readiness/manpower, unrest, energy exposure and trade dependence are omitted. Private goals, initiatives, negotiations, treaties, and event effects are filtered by perspective. The resolver is a trusted adjudicator and sees the true relevant structured state. Owner debug traces retain all perspectives intentionally.

This alpha implements public/participant-only knowledge. It does not implement intelligence discovery, uncertain intelligence estimates, or an espionage model.

## Evaluation

`pnpm test:ai` runs provider, interpretation, trust, secrecy, consent and continuity tests without requiring a model runtime. `pnpm ai:eval` runs 60 explicit interpretation/relevance/visibility combinations; `pnpm ai:eval:real` uses configured inference. Real model results must be reported separately from demo-provider results.

Set `MANDATE_AI_KIND=ollama` (or `openai-compatible`), `MANDATE_AI_MODEL`, and optionally `MANDATE_AI_URL`, `MANDATE_AI_API_KEY`, and `MANDATE_AI_CONTEXT` for CLI evaluation/autoplay. Never put a real key in a tracked scenario or source file.

`pnpm autoplay 1000 northern-sandbox` runs a SQLite-backed observer campaign in an isolated in-memory database and writes metrics plus an exported save under `.runtime/evaluation`. Modes support 1–1000 turns and the northern or global alpha scenarios. Normal tests include a 100-turn fake-provider campaign. Metrics include actor coverage, planning gaps, invariant/model failures, repairs, context size, event distribution, negotiation backlog, repeated titles, save growth and time.

The deterministic demo chooses useful ongoing policies from its own goals and conditions, consults on diplomatic goals, and operates active wars from readiness/logistics/exhaustion. Once useful thresholds are met, it avoids repeatedly starting capped projects. Its plans and negotiation heuristics remain shallow; convincing strategic judgment requires separately evaluated real models and further domain mechanics. Historian summaries use deterministic exact-fact compression. An advisor role and historian model contract are reserved, but are not separate player-facing model workflows yet.
