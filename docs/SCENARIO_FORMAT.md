# Scenario authoring

A scenario has `formatVersion: 3`, `kind: scenario`, and a genesis schema-version-3 WorldState. Version 1 and 2 fixtures remain loadable through validated migration. Genesis has revision zero and no runtime actions, commands, turns or events. Metadata contains stable ScenarioId, name/description, synthetic flag, startDate and geographyVersion.

Author structured nations, regions, ownership/control/claims, governments/leaders/indices, canonical bilateral pairs, treaties, conflicts, organizations, goals, initiatives and negotiations. No scripts or prose patching. Existing IDs remain permanent. Geography keys must exist in the declared version's registry. Organization members, goal targets, proposal participants, project targets/dependencies and all references are validated; accepted diplomatic offers must match their canonical agreements. Scenario initial projects/goals carry authored scenario provenance.

The default `global-alpha.json` uses 242 country-level administrative polities over Natural Earth 50m. Politics are original and synthetic, with diverse capacities/goals, organizations, treaties, diplomatic opportunities and a fictional South American conflict. `northern-sandbox.json` retains 13 actors and the original 110m geography for deterministic fixtures. Global coverage includes territories and disputed administrative polygons, and does not assert they are independent sovereign states in contemporary reality.

```sh
pnpm scenario:validate
pnpm world:ingest
```

The global generator uses checksum-pinned public-domain inputs, a committed stable-ID registry, geographic capital/continent/subregion metadata and shared-edge adjacency. Identical pinned inputs regenerate identical outputs. See GLOBAL_SCENARIO and THIRD_PARTY for sources and limits.

Desktop copies built-ins into its local scenarios folder only when absent. Edit a new structured JSON file there, validate it before play, and select it under World & settings. Starting another scenario checkpoints the current history first and uses the same validated administrative import boundary. There is no graphical scenario editor or executable scenario rules language yet.

Version 3 also supports persistent crises with typed resolution conditions, multilateral conferences, directional economic links, sanctions, scheduled government tenure and disclosed knowledge. All references and consent/history conditions are validated before genesis/import replacement.

Optional `scenario.rules` declares default autoplay `turnDays`, `aiActivity` (quiet/balanced/active), economic severity, crisis sensitivity, seeded theater variation and enabled crises/economic-networks/elections/theaters. Disabled mechanics cannot have canonical entities. Accounting remains anchored in 30-day ticks, independent of how the player partitions elapsed time; elections and offer deadlines use exact dates. Player turn length remains an explicit UI choice. `scenario.neighborhoods` supplies bounded stable nation adjacency for planning attention.

Global economic indices and election calendars are authored synthetic gameplay inputs. They are not real trade data or actual election forecasts. See [the continuity report](WORLD_CONTINUITY_PASS.md) for mechanic depth and limitations.

An optional bounded `strategicActors` list gives authored actors regular long-horizon planning attention independently of changing capacity proxies. It uses known nation IDs, remains scenario data and does not hardcode particular countries in the engine.
