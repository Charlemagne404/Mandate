# Mandate playability pass · 0.3.0-alpha.1

Local evidence collected October 2–3, 2026. This report supersedes the older two-turn gameplay result for the compact workflow. It does not turn deterministic tests into evidence of intelligence or enjoyment.

## Playability verdict: PARTIALLY

Mandate now supports a substantially longer personal campaign, an understandable first launch and a usable diplomacy/turn loop. A real 36-turn Swedish campaign committed successfully through the ordinary gameplay service. The last 22 committed turns followed the last diagnosed abort without another aborted turn. The world remained valid and persisted across development restarts. A follow-up player-agency pass, packaging run and fresh 1,000-turn soak completed on October 3. This is not a completed release certification.

The strongest moments were a Finnish refusal of permanent basing, a narrower compromise, reciprocal trade, unsolicited regional consultations and elections happening while the player pursued an energy policy. The weakest moments were repetitive investment, failure to complete national goals, overly accommodating later diplomatic replies and long waits. This is an improved playable alpha, not a consistently enjoyable strategic opponent. The acceptance gates for strong war reasoning, economic adaptation and varied autonomous history remain only partially met.

## Real model setup

The machine is Apple Silicon M2, eight CPU cores and 8 GiB unified memory. Initial free disk was about 83 GiB. Ollama 0.35.0 was reachable on the fixed local port; loaded-model reporting showed Metal/GPU execution. The existing Llama 3.2 3.2B Q4_K_M model was retained. Two reasonable candidates were explicitly downloaded; no existing model or user save was deleted.

| Candidate         | Artifact                                  | Six-decision calibration              | Median call | First/cold call | Observed use                                                                                         |
| ----------------- | ----------------------------------------- | ------------------------------------- | ----------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| Qwen3 4B Instruct | `qwen3:4b-instruct`, Q4_K_M, about 2.5 GB | 6/6 behavior, 6/6 structured; GOOD    | 5.07 s      | 18.30 s         | First three campaign turns; 84, 176 and 166 s, followed by a timeout. Final compact turn 36: 24.24 s |
| Qwen 2.5 3B       | `qwen2.5:3b`, Q4_K_M, about 1.9 GB        | 4/6 behavior, 6/6 structured; LIMITED | 3.64 s      | 13.21 s         | Campaign turns 4–35; practical local evaluation default                                              |

Qwen 2.5 passed beneficial-offer acceptance, sovereignty refusal, compromise and continuity. It selected an energy project in the exhausted-war probe and routine rearmament in the sanctions probe. Qwen3 passed all six short probes; those results did not predict its early full-turn performance under this desktop's memory pressure. The final compact workflow completed a later Qwen3 turn in 24.24 seconds, but it chose to wait despite a requested Danish trade approach. One successful late performance sample does not establish stronger campaign behavior. Calibration throughput, including loading and prompt processing, was approximately 16.4 and 11.5 generated tokens/second respectively, not a pure decoder-speed measurement. The six-case profiler currently reports the upper middle observation as its median.

The conservative profile is one request at a time, one background government, compact planning, Balanced quality, 4,096 configured context tokens, eight calls, a 45-second request timeout, no HTTP retries, one malformed-output repair and a 180-second turn deadline. Context capacity above the configured window and parallel throughput were not certified. The persisted profile explicitly labels this evidence boundary. A higher-capacity remote endpoint remains supported but was not available for comparative testing.

The Qwen 2.5 artifact's embedded license permits non-commercial research/evaluation; Qwen3 uses Apache-2.0. This recommendation is for local alpha evaluation. Weights are not bundled. See [sources and licenses](THIRD_PARTY.md), including the exact tested digest prefixes.

## What changed

Ollama auto mode now uses a compact physical call graph: classify exact source clauses, build deterministic relevant opportunities, ask independent governments to choose existing validated actions, resolve sequentially, commit atomically and summarize factual events without another model generation. Providers never acquire SQL, shell, filesystem, eval or arbitrary capabilities. The pure core and canonical command authority remain unchanged.

The HTTP provider has a bounded FIFO queue. Local requests default to serial execution; compatible endpoints default to two, with an explicit override. Turn deadlines and call limits prevent indefinite orchestration. Important diplomatic failures abort safely; a failed background government is visibly skipped. Narration failure preserves the committed facts. Transport cancellation and malformed-output repair have regression coverage. Repair attempts are now labeled correctly in the audit; older campaign records preceded that labeling correction and should not be used to infer a zero-repair campaign.

Planners see named partners, outstanding commitments, exact negotiation terms, sanctioned economic links, project costs and war sustainability. Exhausted wars remove unrelated autonomous investment opportunities; they do not force peace. War review exposes homeland losses, exhaustion, treasury/fiscal pressure, unrest and settlement choices. Recent project counts and action-family share restrict routine investment. Waiting makes no policy event. Terminal goals can open a specific, private relationship objective with a real partner and measurable target; this is covered against the actual resolver, but was not observed emerging naturally in the main campaign.

Player continuation/review directives cannot create duplicate spending. A real UI turn exposed that “preserve our independence” had authorized an extra domestic program; project choices now require an affirmative project instruction, with regression coverage, a successful turn-33 replay and a final visible UI replay producing exactly one private energy program. Explicit energy investment no longer offers unrelated industry as an interchangeable interpretation. Selected command combinations deduplicate incompatible crisis and negotiation actions. Models choose substantive diplomacy moves separately from player wishes; code still requires explicit consent. Unsupported natural-language requests remain constrained by the game's existing command vocabulary and the smaller compact catalogue. The standard role workflow remains available for stronger providers.

## Real campaign

Country: **Sweden**. Scenario: **Nordic Crossroads**. Dates: **2025-01-01 → 2027-12-17**. **36 committed real-model turns**, normally 30 simulation days each. First three and turn 36 used Qwen3; turns 4–35 used Qwen 2.5. This was one continuing SQLite world, not 36 reset fixtures.

The harness called the same `/api/play` and ordinary diplomatic-response services as the app, with natural-language energy, diplomacy, trade, readiness, domestic-resilience and review directives. It did not use debug mutations or force war, peace, acceptance or elections. It resumed the same world after diagnosed failures. Separate UI tests exercise the presentation. This service campaign is not a claim of 36 manually clicked packaged-app turns.

Eight failed attempts are retained in the service archive, including one earliest attempt whose reporting code crashed before it wrote a row; the turn report contains seven failed rows. Failed attempts preserved the canonical world. These are development-inclusive counts: 36 committed and eight archived failed attempts, not a clean 100% success claim. Four of 118 unique audited calls failed their call-level contract/transport checks; downstream semantic/integration errors caused additional turn aborts. Accepted JSON is not the same as a strategically sound decision.

Notable sequence:

- A long-term energy directive persisted with its public-framing constraint, while actual funded programs took time and consumed capacity.
- Finland accepted modest reciprocal information sharing, refused exclusive permanent Swedish basing, and accepted a narrower offer.
- Norway countered an economic approach; subsequent Finnish/Norwegian/Russian trade and regional consultations created persistent threads. Duplicate binding treaty acceptance was exposed and is now excluded from the compact choices and disabled with an explanation in the ordinary controls.
- Elections retained a government without a forced player event. Other countries completed programs and opened consultations, including Finland approaching Russia and Norway approaching Sweden.
- Review directives initially caused duplicate investments; the final turn-31 regression in the real world preserved the existing policy and created no player project.

There were 105 meaningful events and 29 completed projects, but **zero completed strategic goals**, zero war starts/ends and no breached commitments. The main campaign therefore does not demonstrate real-model peace-making or betrayal. About 45% of meaningful events did not involve the player. Autonomous initiators remain dominated by projects (about two thirds of project/offer/crisis openings; diplomatic replies are excluded from that denominator). Recipient responses were 12 accept, one reject and one counter; the resulting 86% acceptance rate is a remaining warning, especially on later repetitions. Turns 34–35 quietly continued policy without new player projects; turn 36 ignored the requested Danish approach while Poland started an energy program.

### Authored stress situations

The final Qwen 2.5 run completed five ordinary observer turns in each of two deliberately stressed starting worlds. These are authored genesis fixtures, not natural campaign emergence. No debug commands or desired model choices were injected after genesis.

In the exhausted war (exhaustion 85, fiscal 20), Sweden offered settlement on turn one and Finland independently accepted on turn two. The resolver ended the war at current control lines. Earlier runs exposed that merely being mentioned in another actor's offer counted as activity and starved the recipient's response; scheduling now tracks the actual command actor and gives pressured pending recipients salience.

Under severe Russian energy sanctions, Sweden started energy substitution, then industrial capacity, opened voluntary talks with Russia, received acceptance, and opened trade/sanction-relief talks. An accepted-consultation cooldown prevented the immediate repeat seen in an earlier run. This is relevant but limited adaptation: no alternative supplier was secured and sanctions stayed active. The final source also corrects the misleading “Alternative supply” title when talks concern the existing coercive supplier; that copy change awaits the final build. Reports are preserved under `.runtime/evaluation/compact-situations-qwen25-final`.

### Repeated playability reviews

| Checkpoint  | What held attention                                                | What became annoying                                                     | Response                                                                                                 |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 3 turns     | A concrete Finnish refusal made narrower negotiation meaningful    | Qwen3 full turns approached three minutes                                | Switch the continuing world to the measured smaller candidate; keep serial inference                     |
| 6 turns     | A funded plan progressed while partner trade became possible       | Multiple offers could compete with one economic request                  | Restrict negotiation kind to the actual requested type and exclude existing treaties                     |
| 12 turns    | Independent consultations and completed programs added history     | “Continue policy” created more spending                                  | Add a quiet continuation boundary and preserve exact directive text                                      |
| 20 turns    | Finland/Russia diplomacy was unrelated to immediate player success | Goal stagnation and routine projects remained visible                    | Bound project opportunities, foreground war/economic pressure and add terminal-goal reassessment choices |
| 30–32 turns | History was coherent enough to keep reviewing old threads          | Acceptance bias and repeated national programs reduced strategic tension | Preserve this as a limitation; verify the last quiet continuation without resetting the campaign         |

The review does not claim a blind human fun test or hours of effortless enjoyment. The campaign was interrupted for debugging. It demonstrates materially longer coherence and exposes the remaining boredom instead of hiding it.

## UX and gameplay

First launch provides Welcome, discovered models, calibration, scenario cards, searchable countries, quality/duration and a canonical starting briefing. A player can explicitly explore the deterministic demo. Missing Ollama has setup guidance; installed Ollama can be opened with a narrow native action. The optional download uses only fixed small tags, checks disk/RAM, shows progress, supports cancellation and never reports an interrupted stream as successful installation.

The composer retains free text and offers situational prompts. Progress shows the government/stage and elapsed time; reviewing existing information remains possible while inference runs. No uncommitted diplomatic outcome is shown as fact. Post-turn summaries group direct responses, consequences, world news, projects and risks, with available execution capacity and fiscal pressure. Diplomacy highlights current terms and allows revised/counter terms while preserving old rounds.

Private mixed-clause programs retain their own visibility, and different diplomatic recipients receive only the clauses addressed to them. Observer mode releases the formerly controlled government to independent diplomatic responses. Normal mode hides Debug, raw command/state traces, developer diagnostics and technical save IDs. Following countries is browser-local presentation state; known-world and region filters reduce event noise. The existing map geometry is unchanged. The restrained light institutional interface remains, with readable launch cards and dossiers. Country government identities still include generic synthetic fixture labels; broader authored scenario characterization remains polish work.

Turns autosave. Menu exposes Continue; quality and duration now survive reload. Named timelines can be renamed/deleted, branching records ancestry, rollback retains checkpoints and semantic comparison remains available. The branch presentation is a named list with ancestry, not a full visual tree. Observer play/pause and speed operate actual successive turns, and take-control uses the existing canonical boundary. There is no victory screen; national goals provide direction.

## Player authority follow-up · October 3, 2026

The player-agency review found two concrete restrictions/failures: player intent could be paraphrased before resolution, and a player surrender order emitted duplicate peace offers that caused canonical validation to roll back the turn. Player orders now retain exact source clauses, execute through a dedicated deterministic `Player Action Executor`, bypass player-country strategic planning and model veto, and remain subject to canonical schemas, domain checks and world invariants. The duplicate peace offer was removed and covered with an active-war regression.

Local Ollama `qwen3:4b-instruct` ran the compact workflow at fast quality against fresh Nordic campaign databases. All 11 reckless orders and all 8 normal orders committed across 48 model calls. Eighteen turns scored 1.0 on all agency dimensions. The remaining order asked to break a Sweden-France treaty; the scenario has no active treaty with France, so the executor explicitly reported that mechanical limitation. No Finnish territory transferred from the annexation demand. The later invasion opened a war and ordered a major offensive; Finland rejected surrender, and Sweden's withdrawal order did not end the war without Finnish agreement. A separate two-call Qwen3 follow-up confirmed that reversing annexation withdraws the territorial claim, abandons its goal and cancels its standing directive.

The normal sequence included a Norwegian nonaggression proposal, Finnish defense-cooperation talks, a five-year nuclear-energy program, gradual manufacturing investment, a 10% defense-budget reduction, a Finland trade proposal and Danish consultation. The foreign governments accepted the diplomatic offers in this replay. This is evidence that the same executor supports restrained policies; it is one locally bounded model run, not a claim of broad strategic quality.

## Performance

Mixed-model committed-turn median was **24.42 s**, p90 **81.09 s**, maximum **175.66 s**. Qwen 2.5 committed turns had median **20.92 s**, p90 **52.71 s**, maximum **81.09 s**. The last 12 had median **16.57 s** and maximum **47.16 s**. These campaign medians use the arithmetic midpoint for even-sized samples; p90 uses the sorted observation at index floor(0.9 × sample count).

Committed turns used 101 audited calls, at most five in a turn. Including archived failures, 118 unique call records were retained. Prompts ranged from 568 to 8,727 characters and observed successful input usage from 314 to 2,627 tokens. HTTP retries were zero. Models ran serially; no parallel planner throughput claim is made. Heavy compilation/browser work and inference were serialized after early memory pressure showed why that matters on an 8 GB desktop.

## QA evidence

The gate logs and machine-readable reports live under `.runtime` and `.runtime/evaluation`; they are local artifacts, not CI or production certification.

- `pnpm verify`: 468 tests across 23 files, lint, formatting, typecheck and all workspace builds passed on October 3.
- Chromium E2E: 21 flows passed, including first launch, country choice, branch/reload, unavailable AI, multi-turn diplomacy, observer/control, save/import, production restart, private-directive concealment, player-order outcome presentation and developer force transfer.
- Deterministic behavior benchmark: 123/123. Legacy deterministic formalization: 60/60. All three scenarios validated.
- `pnpm test:soak`: both the 100-turn fake-provider soak and 250-turn deterministic soak passed. An additional 1,000-turn Nordic fake-provider soak completed with 1,599 commands, 2,234 events, 8,004 model calls and zero model, repair or invariant failures. Repeated project titles remain a known fake-provider behavior signal; this does not establish real-model capacity.
- Development Electron smoke passed actual SQLite commit, stale/origin rejection, renderer sandboxing, restart hash preservation, scenario geography round trip and process-kill rollback during a stalled **fake transport**. The packaged Apple Silicon ARM64 app passed the same checks and verified Welcome, hidden developer controls and bundled Nordic scenario.
- This follow-up did not rerun the 123-case real-model benchmark. The real-model agency evaluation above is a separate 19-turn run; it does not certify broad model quality.

### Host recovery and package limits

An earlier executable-validation hang temporarily prevented packaging and soak work. On October 3, Node, the Electron packager, the 1,000-turn soak and both source and packaged Electron smoke tests completed successfully. No system security settings were changed. The packaged application remains unsigned and not notarized; Windows/Linux and commercial distribution were not certified.

## Remaining problems

**Playability blockers to an unconditional YES:** reliable small-model war/economic reasoning; consistently varied autonomous decisions; goal stagnation; later acceptance bias. The limited compact action catalogue can fail to express a sophisticated directive, and longer waiting is still noticeable. These are strategic-quality limitations, not canonical corruption.

**Important polish:** clearer explanation of an unsupported directive, more authored government personalities, richer goal-driven reassessment while old goals are stalled rather than terminal, a visual branch tree, stronger notification navigation, and more compact summaries on event-heavy turns. More human playtesting is needed.

**Nice-to-have:** optional sound, flags with recorded licenses, additional authored scenarios and broader platform verification. No new province, production-chain or character system is required for this verdict.

## Build

`/Users/charliearnerstal/Documents/GitHub/Mandate/output/desktop/Mandate-darwin-arm64/Mandate.app`

The rebuilt local Apple Silicon alpha passed packaged smoke testing. It is unsigned and not notarized. It starts its own production renderer and loopback service; no developer server is required. Existing saves and models remain intact. Windows/Linux, commercial distribution and remote-provider quality were not certified.

Reproduce model profiling with `pnpm exec tsx tools/profile-model.ts <installed-tag>`. Continue the preserved campaign with `pnpm exec tsx tools/playable-campaign.ts qwen2.5:3b 36` (larger counts explicitly advance it). The report, metrics, failed-attempt archive and canonical SQLite world are in `.runtime/evaluation/playable-campaign`. The portable `campaign-save.json` currently predates the final turns and must be refreshed through the normal store export before delivery.
