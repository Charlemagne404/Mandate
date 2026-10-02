# Desktop alpha

Mandate's Electron main process starts the existing local Fastify service on an automatically allocated loopback port, opens the production React bundle and closes services/SQLite on quit. There is no separately installed Node runtime, Vite server, browser navigation or terminal required when opening the packaged application. Built-in `node:sqlite` remains the canonical persistence driver.

Build and start from the repository:

```sh
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm desktop:start
```

Build a native application for the current operating system and architecture:

```sh
pnpm desktop:build
pnpm desktop:package
```

On the verified Apple Silicon development machine the result is `output/desktop/Mandate-darwin-arm64/Mandate.app`. Open it in Finder. This is a local unsigned alpha build, not a notarized installer or a claim of Windows/Linux verification. The packaging script deploys locked production dependencies, retains their relative pnpm links and copies offline geography, scenarios, migrations, the renderer and license notices. Electron and build dependencies may require network downloads during installation/packaging; ordinary gameplay needs no map network service. Model runtimes are configured separately.

## Local data

Electron's operating-system user-data location stores these folders:

| Path                 | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `saves/world.sqlite` | Active canonical world, transactional command/audit history and SQLite WAL files |
| `services/`          | Timeline checkpoints, presentation metadata and provider configuration           |
| `scenarios/`         | User scenario files; the two built-in scenarios are copied here only if absent   |
| `exports/`           | Default destination for native JSON save exports                                 |
| `logs/desktop.log`   | Startup/runtime version records and startup failures                             |
| `desktop.json`       | Versioned, schema-validated window size and maximization preferences             |

For macOS this is normally `~/Library/Application Support/Mandate`. The File menu and World & settings panel can open the save/scenario folders. Native import/export dialogs choose JSON files; imports use the same strict schemas, geography/reference/invariant checks and stale revision/hash protection as HTTP imports, with a prior timeline checkpoint. Imported files cannot choose database paths or execute scripts. Damaged configuration/database files cause a native startup error; the application does not delete or reset the save. `MANDATE_USER_DATA` is an explicit development/test override for isolating state.

## Renderer boundary

The renderer has `nodeIntegration: false`, `contextIsolation: true`, an OS sandbox, web security and a restrictive content security policy. New windows, webviews, external navigation/network requests and permission requests are denied. The preload exposes four fixed methods: open a named app folder, native import, native export and desktop capability metadata. Every IPC handler validates the main-frame sender and exact local service origin; no arbitrary filesystem path, shell, Electron module or IPC dispatcher is exposed.

The local service accepts only loopback hosts and the exact renderer origin. AI provider network access is main/service-side and remains separate from renderer privileges. Synchronous canonical transactions remain serialized; model generation occurs before commit.

## Verification

```sh
pnpm test:desktop
pnpm exec tsx tools/desktop-smoke.ts --executable output/desktop/Mandate-darwin-arm64/Mandate.app/Contents/MacOS/Mandate
```

The harness uses an isolated temporary user-data directory. It checks an actual Electron SQLite command commit, rejected stale writes, rejected foreign origins, a renderer without `require`, real preload sandbox/context-isolation flags, a validated 110m fixture/global 50m save round trip, clean shutdown and exact state-hash preservation after reopening. It captures `output/playwright/desktop-alpha.png`, with diagnostic errors and a failure screenshot when renderer readiness fails. Unit tests also check scoped directories and malformed configuration behavior. Runtime evidence and platform limits belong in the implementation report; packaging creation by itself is not launch evidence.
