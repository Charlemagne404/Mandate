# Real-model calibration and manual playtest

These tests assess decisions and consequences, not prose. The deterministic demo is useful for mechanics and UI regression, but is not evidence of real-model intelligence.

## Connect a model

Run `rtk pnpm ai:discover`. Discovery probes existing Ollama (11434), LM Studio-compatible (1234/v1), compatible (8080/v1), environment-configured providers and existing game configuration without printing credentials. It does not install models, start servers, or send saves to discovered endpoints. If Ollama is available, the report lists installed model names.

Set `MANDATE_AI_KIND=ollama`, `MANDATE_AI_MODEL=<installed model>`, and optionally `MANDATE_AI_URL=http://127.0.0.1:11434`. For an OpenAI-compatible provider, use its configured `/v1` base URL and optional `MANDATE_AI_API_KEY`. CLI environment configuration can explicitly select a provider; discovery also inspects existing local game configuration. The game settings support default, role-specific, and high-importance models. A single model is valid.

Run `rtk pnpm ai:benchmark:real --limit=10 --role=diplomat`, inspect failures, then the complete benchmark. `MANDATE_AI_TIMEOUT` sets the benchmark timeout; `MANDATE_AI_ROLE_MODELS` is a JSON object mapping roles to installed models. Never treat unavailable or demo output as a real-model result. Real mode exits with code 2 and writes an unavailable report if discovery finds no server and no explicit provider is configured.

Reports under `.runtime/evaluation` record configuration (excluding API keys), discovered names, exact outputs, context references, prompt/context versions, per-role decisions, latency and failures. Record inference server/model version or model digest separately when reproducing a run; provider health currently enumerates names, not model digests. Keep reports from different models in separate copied directories: the default filenames are overwritten on rerun.

Use short runs first: `rtk pnpm autoplay 5 nordic-strategy`, then 10, 25 and 50. CLI autoplay honors the same provider environment. The report, exported save, and traces are separate local artifacts. A trace contains observable decisions and exact retrieved facts, never hidden reasoning. Inspect novelty vetoes as well as generation failures. CLI autoplay preserves a failure artifact, trace and retained save on fatal preparation failure; the desktop preserves already committed turns and records failed workflows.

## Nordic security: Sweden

Load **Nordic Crossroads**. This is a fictional authored scenario, not a historical claim about present governments.

1. Set a persistent private directive: “Prioritize Nordic cooperation, avoid war unless attacked, and reduce energy exposure.”
2. Begin limited intelligence cooperation with Finland. Advance a turn and inspect its interests, private neutrality constraint in developer evidence, and response.
3. Propose a defense agreement. Do not expect automatic acceptance: Finland should distinguish consultation from binding defense.
4. Ask for permanent bases. Expect rejection or narrower intelligence cooperation. Inspect the counteroffer and earlier terms. Revise rather than repeat the rejected clause.
5. In Diplomacy, select “Include a funded aid pledge,” enter investment and deadline, and propose it. Inspect structured obligations before acceptance. After acceptance, use the obligation’s funding control in the country inspector. Casual prose alone must not create a pledge.
6. Increase Swedish readiness through a funded project. Observe its duration and funding alongside energy investment.
7. Advance 20–30 monthly turns. Inspect goal evidence, project milestones, delayed installments, independent history and the aid obligation's fulfillment or breach. Repeat basing requests much later and check that the earlier rejection remains available to retrieval.

Pass indicators: no magically signed alliance; narrowed terms have a concrete path; private directives and Russian secrets do not appear in foreign context; project benefits require funding; obligations have consequences. Fail indicators: identical basing offers every turn, universally shared secrets, invented guarantees, a pledge forgotten when due, or relations changing without causes.

## Major-power coercion

In the global scenario, control a stronger state and demand concessions from a weaker neighbor. Try a threat, a narrower reciprocal offer, and a stand-down. Inspect rejection/counterproposal, resource and stability constraints, and known third-party relationships. The model must not turn military control into legal ownership or create wars outside its finite authority. Autonomous initiation of new wars remains deliberately limited in the present capability policy; record this as a limitation rather than a successful escalation simulation.

## Peace conference

Both bilateral settlements and multilateral peace conferences are available. Open a peace conference in Overview with all belligerents and optional mediators; consent is required from every party on the current terms. Start from the fictional Orinoco conflict, or use an explicitly created fixture conflict.

1. Propose ceasefire. Acceptance must halt offensives and create a conflict-linked treaty.
2. Offer status quo peace. Compare battlefield control, exhaustion and resources to each government's willingness.
3. Try incompatible territorial demands, then a validated withdrawal or transfer involving only property/armies the parties can concede.
4. Counter over several rounds. Earlier terms must remain inspectable; ended wars cannot be resurrected by a resolver.
5. Accept a settlement and inspect ownership, control, ended ceasefire, closed competing offers and relationship effects.

Pass indicators: consent is independent, territorial terms are validated again at acceptance, withdrawals do not silently transfer legal ownership, and an exhausted government can pursue a costly-war exit. Mediators can participate; reparations, binding guarantees, demilitarization, prisoners and monitoring are not implemented mechanical terms.

## Economic strategy

As Sweden in Nordic Crossroads, issue: “Over several years reduce energy exposure, expand domestic nuclear energy and industrial capacity; do not publicly frame this as anti-Russian.” Inspect the formalized clauses, private/public scope, proposed goals and funded projects. Run simultaneous projects above execution capacity; verify visible delays rather than free investment. Compare a trade partner's income contribution with confrontation and dependency disruption. Complete a project, then branch before completion and pursue a different investment. Save both branches at the points to compare, then use Branches to inspect semantic differences. Comparison uses saved snapshots; map A/B and arbitrary date replay are not implemented.

## Failure/recovery checks

Use a separate development save. Configure an unreachable endpoint; attempt a turn and compare the save hash. Cancel a pending generation; reload. Test invalid JSON and failed repair through deterministic injected providers. Close immediately after a successful commit and reopen; narration failure must not roll back facts. Chromium production tests terminate/restart the server; the Electron smoke verifies close/reopen persistence. The desktop smoke now SIGKILLs the app while an intentionally stalled fake-compatible HTTP request is pending, then verifies the exact pre-turn hash on restart. Child-process SIGKILL drills cover SQLite transaction boundaries. Every packaged workflow phase, power failure and disk corruption have not been comprehensively exercised.

For every session record model/provider/version, role assignment, temperature, context budget, scenario, turn length, quality mode, hashes, notable decisions and failures. Human review should check whether a counteroffer actually changes incentives; the benchmark's move whitelist and planner keyword checks cannot prove this by themselves.

## Current local evidence

Discovery was initially unavailable, then a later check found Ollama with `llama3.2:latest`; actual inference was executed. Two completed eight-case acceptance spectra expose over-refusal, counteroffers, thread errors and timeouts. The full bounded benchmark and the five finite-action pilots are documented in [WORLD_CONTINUITY_PASS.md](WORLD_CONTINUITY_PASS.md). These are distinct from fake-provider regression/autoplay and from full gameplay orchestration.

Run `rtk pnpm ai:playtests:real` for all five pilots, or append `--run=E` for the ten-turn observer pilot. Reports/saves stay under `.runtime/evaluation`. The pilots use seeded fictional situations, a finite prevalidated action catalogue, one scheduled actor per turn and actual configured provider calls; failed choices advance only explicit observer time. They do not certify a 242-actor real-model world. `MANDATE_AI_CONTEXT_TOKENS` sets the Ollama window explicitly; `--tokens=1200 --label=my-run` bounds benchmark output and preserves separate reports. Do not run memory-heavy local inference alongside broad aggregate gates; serialize them on constrained machines.
