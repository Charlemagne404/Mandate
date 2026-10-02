# Mandate

Mandate is a local-first, single-player geopolitical alpha. Choose a country, issue a directive, negotiate, advance an autonomous world, fund ongoing projects, inspect committed consequences, and branch histories. SQLite is canonical; **LLMs propose, deterministic code validates and commits**. Branding lives in `packages/schemas/src/branding.ts`.

The default **A World in Balance** scenario simulates 242 Natural Earth administrative polities on an offline map. Its leaders, governments, capacities, goals, relationships and fictional crisis are synthetic. It is not a contemporary political forecast or 242-sovereign-country dataset. The original 13-country fixture remains available. **Nordic Crossroads** adds deliberately authored energy constraints, neutrality, regional interests, trade and measurable long-term goals.

## Open the desktop app

The local Apple Silicon build is `output/desktop/Mandate-darwin-arm64/Mandate.app`. Open it in Finder; it starts its own local service and production renderer. No separately started Node, Vite, browser or terminal is needed. It is unsigned and not notarized; Windows/Linux builds have not been exercised.

To build from source, use Node **24.14+ (24.x)** and pnpm **11.25.0**:

```sh
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm desktop:start
pnpm desktop:package
```

See [desktop architecture and local folders](docs/DESKTOP.md).

## Play

1. Select the controlled country in the top bar. Inspect other countries with the map or nation selector.
2. Try: “Begin a quiet diplomatic initiative with Finland and Norway. Do not propose a formal alliance yet. Increase military readiness without publicly announcing it.”
3. Advance world again to continue the diplomatic conversation. Consultation does not create an alliance. A binding offer needs a validated recipient acceptance before it creates a treaty.
4. Try an investment, reform or rearmament directive. Projects consume funding over simulation time; they do not award immediate bonuses.
5. Inspect Diplomacy and Conflicts. Open an event's **Why did this happen?** for intents, government decisions, validation, commands and factual effects.
6. Open **Overview** for persistent crises, conferences, sanctions, government briefings and eight scoped strategic advisor questions. **Observe world** releases control; choosing a country resumes it. **Branches** compares named points semantically.
7. Use **World & settings** for named saves, branch/load, rollback, scenario selection, models and 5/10/25/50/100-turn autoplay.

The application starts in **Deterministic demo** mode. This mode uses bounded keyword rules, not a language model. Its supported directives exercise the whole game loop and are deliberately labeled. For broader free-form interpretation configure Ollama or a generic OpenAI-compatible endpoint under Models, select your installed model, and test the provider. Role-specific model overrides are optional. No model weights are bundled or downloaded automatically. Real-model quality requires separate evaluation.

All accepted changes persist automatically. Named snapshots retain AI evidence; portable JSON exports retain canonical state and command history but omit supplemental model traces. Native save dialogs and Open Save Folder are available in the desktop app. Debug retains typed command templates and raw state inspection.

## Browser development

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
