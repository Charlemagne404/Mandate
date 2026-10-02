# AI orchestration and trust boundary

Active providers are Ollama, generic OpenAI-compatible HTTP endpoints, and a deterministic demo/test provider. Provider configuration includes a default model, role-specific overrides, temperature, bounded transport retries, timeout and a character context budget. Endpoints are explicitly configured by the user; returned model content has no network, filesystem, SQL, shell, eval or tool authority. Redirects are rejected. HTTP response reading is size bounded. Model weights are external.

## Contracts and workflow

Version 1 schemas cover PlayerIntent, RelevanceSelection, NationPlan, DiplomaticMove, ResolutionProposal, CriticResult, NarrationInput and HistoricalSummary. Roles include formalizer, planner, diplomat, resolver, critic and narrator. Relevance and historian/summarizer behavior currently use deterministic code. Advisor is reserved and not a shipped player-facing analysis service.

PlayerIntent includes source-clause references and visibility/targets per intention. The formalizer does not own the acting nation: the orchestrator binds it to the canonical player nation. Nation and region references are recovered from explicit player text and canonical state, so model-supplied IDs cannot switch namespaces or introduce arbitrary entities. The orchestrator replaces model paraphrases with the referenced original source clauses before perspective disclosure. Private non-diplomatic clauses remain with the issuing country; targeted diplomacy is disclosed only to the recipient. Combined clauses fail closed for foreign disclosure when they contain private internal intentions.

Current live entities always outrank summaries. Contexts include relevant countries/regions, bilateral pairs, visible treaties/goals/projects/negotiations, conflicts, exact recent events and source-linked summaries. Calls have explicit allowed identifiers and a finite command capability list. Context budget excess aborts rather than silently truncating canonical facts.

Independent governments deliberate concurrently with Promise.allSettled so cancelled/failed calls are joined. A failed secondary/background actor can be omitted; a critical direct actor failure aborts. Open diplomatic recipients and crisis actors activate alongside salience-ranked actors and guaranteed rotating background slots. The scheduler uses canonical revision/history, not wall-clock timers or a global swarm of permanently running agents.

The resolver can propose ongoing initiatives, structured diplomatic offers/responses, limited relation effects, conflict actions and tightly constrained conflict initiation. It cannot transfer ownership/control arbitrarily, edit a nation's numeric stats directly, write prose events, switch player countries or create treaties directly. Acceptance must match an independently recorded recipient move. New entity IDs use a supplied allocation prefix; existing references must be known. Sequential domain validation and hard invariants preview the complete request before commit. A critic runs for deep mode and important conflict/acceptance decisions. Repair is bounded to one additional formalization/resolution attempt; unresolved failures abort mechanics.

The service rechecks revision/hash inside SQLite before committing. Traces commit with the mechanical turn. Every model call records provider/model/role, prompt version, context references, raw application output, parsed output, latency/retries, validation failures and repair attempt. Hidden reasoning channels are not requested or retained. Raw structured-output inspection is a developer tool, not mechanical authority.

Narration selects existing committed event IDs; headlines are their factual titles. Invalid narration falls back to deterministic facts. Historical summaries are source-linked retrieval hints and cannot overwrite treaties, conflicts, governments or goals. Narrator records and summaries are downstream presentation metadata.

## Evaluation limits

`pnpm test:ai` checks trust, repair, scope, cancellation, concurrency, continuity and deterministic activation. `pnpm ai:eval` exercises 60 curated actor/action formalization, relevance and visibility cases. These results evaluate the deterministic fake provider; they are not evidence of real-model language quality. `pnpm ai:eval:real` requires an explicitly configured running model and reports provider/model, raw outputs, failures and latency.

Fast/Balanced/Deep control background breadth, context retrieval and critic participation; they do not hardcode model brands. The demo provider uses bounded clause/keyword rules and condition-driven policy, diplomacy and strategic-war behavior. Unsupported nuanced language remains a limitation of demo mode.

The perspective system is an initial public/private boundary. It has no intelligence discovery mechanic, espionage network, uncertain estimates or secrecy tier beyond public/private. Foreign contexts expose only public proxy indices (economy, military, stability, legitimacy, industrial capacity, technology and influence). Treasury, readiness and other internal indices are omitted. These public measures remain scenario abstractions. Advanced debug traces intentionally expose all participating perspectives on the owner's machine.
