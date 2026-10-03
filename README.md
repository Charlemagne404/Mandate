# Mandate · 0.3.0-alpha.1

Mandate is a local-first, single-player geopolitical alpha. Choose a country, issue a directive, negotiate, advance an autonomous world, fund ongoing projects, inspect committed consequences, and branch histories. SQLite is canonical; **LLMs propose, deterministic code validates and commits**. Branding lives in `packages/schemas/src/branding.ts`.

The default **A World in Balance** scenario simulates 242 Natural Earth administrative polities on an offline map. Its leaders, governments, capacities, goals, relationships and fictional crisis are synthetic. It is not a contemporary political forecast or 242-sovereign-country dataset. The original 13-country fixture remains available. **Nordic Crossroads** adds deliberately authored energy constraints, neutrality, regional interests, trade and measurable long-term goals.

## Open the desktop app

The local Apple Silicon build is `output/desktop/Mandate-darwin-arm64/Mandate.app`. Open it in Finder; it starts its own local service and production renderer. No separately started Node, Vite, browser or terminal is needed. It is unsigned and not notarized; Windows/Linux builds have not been exercised.

See [desktop architecture and local folders](docs/DESKTOP.md).

## Play

1. The first launch opens Welcome → AI setup and model test → Scenario → Country → Campaign settings → Cabinet briefing. **Menu** returns to Continue or New game later.
2. Start with **Nordic Crossroads**, Sweden or Finland, Balanced quality and 30-day turns. Read the country's priorities, relationships and constraints before entering.
3. Write a directive in the composer. Try: “Over the next five years, reduce our dependence on Russian energy without publicly framing the policy as anti-Russian. Start an energy diversification program.”
4. Propose reciprocal information sharing with Finland. Open **Diplomacy** to read the actual response, revise terms, counter, accept or refuse. Consultations are nonbinding; a treaty requires validated recipient acceptance. An AI response may arrive in the same turn or on a later advance.
5. Read the turn summary: your action, direct responses, consequences, world news, ongoing programs and remaining execution capacity. Projects consume funding over time; they do not award immediate bonuses. “Continue our existing energy policy” can be a quiet turn.
6. Follow countries from the inspector and filter the news by region. **Overview** contains government briefings, crises, sanctions, conferences and scoped advice. **Observe world** releases control, with play/pause and speed; selecting a country takes control.
7. Before a risky decision, use **Branch timeline**. **World & settings → Timelines** provides named checkpoints, rename, delete, restore and rollback; **Branches** compares their consequences. Use Overview to inspect or cancel standing directives and projects.

## AI setup and current recommendation

The wizard discovers Ollama and installed models, tests six Mandate decisions, and saves an evidence-based readiness profile. It can open an installed Ollama app and offer a fixed small-model download. An external OpenAI-compatible endpoint is also supported. No model weights are bundled; downloads are explicit. **Explore with demo rules** uses bounded deterministic keyword rules and is clearly labeled; it is not real AI.

On the tested **M2 / 8 GB Mac**, **Qwen 2.5 3B** is the practical starting choice for compact evaluation turns: one request at a time, one background government, 4,096-token window, eight-call ceiling, 45-second request timeout and three-minute turn deadline. It passed only **4/6** readiness decisions and remains **LIMITED**. **Qwen3 4B Instruct** passed **6/6** short calibration decisions, but full turns were substantially slower on this machine. A calibration rating does not guarantee campaign quality. Neither model is certified for strong war/economic reasoning. The tested Qwen 2.5 3B artifact has a research/evaluation-only license; see [model licenses](docs/THIRD_PARTY.md).

The 36-turn real campaign is materially more playable than the previous two-turn attempts, but the release verdict is **PARTIALLY**: diplomacy can be engaging, while autonomy remains project-heavy, goals can stagnate and the smaller model may misunderstand complex requests. Compact mode selects among existing validated actions; unsupported orders do not acquire new mechanics merely because they appear in prose. Final packaging is pending recovery from a host executable-validation hang. See [the playability report](docs/PLAYABILITY_PASS.md) for measured performance, failures and limitations.

All accepted changes persist automatically. Close and reopen to continue immediately. On macOS, saves are normally under `~/Library/Application Support/Mandate/saves`; **Open Save Folder** opens them. Named snapshots retain AI evidence; portable JSON exports retain canonical state and command history but omit supplemental model traces. Native import/export dialogs are available. **World & settings → enable developer mode** reveals raw traces, Debug, technical save IDs and diagnostic controls.

## Browser development

To build from source, use Node **24.14+ (24.x)** and pnpm **11.25.0**:

```sh
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm desktop:start
pnpm desktop:package
```

```sh
pnpm dev
# http://127.0.0.1:5173
pnpm build
pnpm start
# http://127.0.0.1:3001
```

Fastify binds only to loopback. The first run initializes the global scenario; existing `.runtime/world.sqlite` files are reused and migrated. `MANDATE_SCENARIO=northern-sandbox.json` selects the fixture only for a new world. Use the scenario UI to change an existing world. No map key, cloud account, telemetry or runtime map network access is required.

## Verify and evaluate

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:desktop
pnpm scenario:validate
pnpm ai:eval
pnpm ai:discover
pnpm ai:benchmark
pnpm autoplay 100 northern-sandbox
pnpm soak:world 1000 northern-sandbox
```

Normal CI uses deterministic fake providers and never requires a local LLM. Optional real evaluation: `MANDATE_AI_KIND=ollama MANDATE_AI_MODEL=<installed-model> pnpm ai:eval:real`. A compatible endpoint also accepts `MANDATE_AI_URL`; optional credentials use `MANDATE_AI_API_KEY`. Reports are written under `.runtime/evaluation`.

Read [the current world-continuity report](docs/WORLD_CONTINUITY_PASS.md), [the earlier gameplay-depth/calibration report](docs/INTELLIGENCE_PASS.md) and [real-model playtest](docs/REAL_MODEL_PLAYTEST.md) for current evidence and limitations.

Read [the implementation report](docs/IMPLEMENTATION.md), [architecture](docs/ARCHITECTURE.md), [AI contracts](docs/AI_PROTOCOL.md), [mechanics and their limits](docs/ALPHA_MECHANICS.md), [verification](docs/TESTING.md), and [sources/licenses](docs/THIRD_PARTY.md). Strategic warfare, diplomacy and domestic politics remain coarse alpha systems; see the report for the actual remaining milestone.
