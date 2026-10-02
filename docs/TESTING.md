# Verification and evidence

Use Node 24.14+ (24.x) and pnpm 11.25.0. Install from the frozen lockfile.

| Command                                 | Purpose                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                           | Lint, formatting, strict TypeScript, unit/integration/golden/soak tests and server/web/desktop builds                                                               |
| `pnpm test:e2e`                         | Sixteen Chromium flows, including crisis/conference consent, sanctions/adaptation, observer/advisor and semantic comparison                                         |
| `pnpm test:desktop`                     | Actual Electron SQLite, sandbox/preload, loopback origin, geography-version roundtrip, close/reopen hash plus actual SIGKILL during an unfinished inference request |
| `pnpm scenario:validate`                | All three scenario formats, references, invariants and exact geography compatibility                                                                                |
| `pnpm test:ai`                          | Fake-provider contracts, ID/capability denial, bounded repair, knowledge, continuity, cancellation and concurrent planning                                          |
| `pnpm ai:eval`                          | 60 curated fake-provider interpretation/relevance/visibility cases, with JSON report                                                                                |
| `pnpm ai:eval:real`                     | Explicit optional real endpoint/model evaluation; never required in ordinary CI                                                                                     |
| `pnpm test:soak`                        | Original 250-turn/500-command deterministic persistence campaign plus 100 autonomous turns                                                                          |
| `pnpm soak:world 1000 northern-sandbox` | Long-horizon SQLite fake-provider run and metrics; accepts 100/250/500/1000, up to 1000                                                                             |
| `pnpm autoplay 100 global-alpha`        | Global fake/real world observer harness; environment selects provider                                                                                               |

Browser suites serialize storage/servers, use isolated databases and wait for explicit map-ready. Production tests terminate/restart the actual built server, block external requests and verify exact hashes. User actions advance simulation time; render hooks never do.

Core mechanics tests cover every new command and invalid transition, partition-independent time, funding/project completion, diplomatic consent, private visibility, combat/control outcomes and v1 migration. Persistence tests inject failures into canonical/audit writes and verify rollback and restart. Archive tests exercise real branch restoration and retained model evidence.

Normal CI does not call a local model. Fake evaluations are executable behavioral tests, not real-model benchmarking. Soak reports include commands/events, independent activity, goal continuity, negotiation expiry, relation saturation, repeated titles, model calls/failures/repairs, context size, planning gaps, serialized size and wall time. Their mechanics and fixture scope are stated in each report. Whole-history persistence costs increase with horizon; results are not web-scale performance claims.

`pnpm exec tsx tools/desktop-smoke.ts --executable output/desktop/Mandate-darwin-arm64/Mandate.app/Contents/MacOS/Mandate` exercises the native artifact separately from source desktop launch. Local macOS/Chromium/Electron success is not proof of remote CI, signed/notarized distribution, Windows/Linux execution or real-model quality. Check WORLD_CONTINUITY_PASS for current completed measurements and limitations.

Current measurements and interruptions encountered during development are recorded in [WORLD_CONTINUITY_PASS.md](WORLD_CONTINUITY_PASS.md). Fault tests include exceptions at seven persistence stages, four actual child-process SIGKILL stages, four planning/proposal stages, and postcommit narration/memory failure. Desktop source and packaged smoke test actual application process death independently. This is bounded stage coverage, not exhaustive power-loss or disk-failure certification.

`pnpm ai:playtests:real` runs five bounded inference pilots; `--run=E` selects the ten-turn observer sequence. They use a finite prevalidated action catalogue and one actor per turn, separate from the full gameplay orchestrator. `pnpm ai:benchmark:real --tokens=1200 --label=my-run` writes separate, checkpointed case records. The suite bounds workers to four to avoid competing with local inference memory; serialize broad verification and inference on constrained hardware.
