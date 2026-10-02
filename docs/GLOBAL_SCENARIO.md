# A World in Balance

The global alpha starts on January 1, 2028 with Sweden controlled. It is an original fictional setup on licensed Natural Earth geography. There are 242 playable administrative actors and 242 permanent country/territory regions. These include dependent territories and disputed areas; they are not 242 sovereign states. Geography is a pinned dated atlas, not a comprehensive recognition/current-political dataset.

The small 13-actor Northern Europe scenario remains the deterministic test fixture. The global scenario adds broader gameplay without changing fixture IDs or replacing its 110m geometry. The desktop ships both and defaults to the global scenario. Loading a scenario validates and transactionally replaces canonical state; the timeline service first preserves a checkpoint.

The service selects the exact geometry file for the saved scenario's geography version, and the map remounts when that version changes. Validation uses a separate allowed RegionId set for each version: a 110m save cannot acquire a 50m-only region simply because a newer atlas is installed. Ownership/control commands alter political state without rewriting either geometry file.

Starting content includes one persistent agenda per actor, synthetic differentiated economic/military/domestic proxies, fictional cabinet names/governments, regional cooperation and rivalries, two treaties, two organizations, an active fictional Brazil/Venezuela corridor emergency and a Finnish multi-year energy initiative. Sweden's agenda is quiet Nordic defense dialogue without an existing formal alliance. These are invented gameplay premises, not statements about real governments, conflicts or treaties. The engine's deterministic rules govern their subsequent effects.

## Reproduce and validate

```sh
pnpm world:ingest
pnpm scenario:validate
```

For offline reproduction download the two pinned source URLs in `data/geography/global-manifest.json` and use:

```sh
pnpm world:ingest --countries /path/to/ne_50m_admin_0_countries.geojson --places /path/to/ne_50m_populated_places.geojson
```

Both byte-level SHA-256 checksums must match before output is generated. The generator retains every existing 110m RegionId from the committed registry. New IDs follow the committed ADM0_A3 mapping; their geography cannot be renamed by runtime ownership/control changes. Synthetic indicators/colors/agenda selection derive from a fixed SHA-256 seed, so rerunning identical sources and code produces identical files. All generated scenario values pass current versioned schemas and hard invariants before files are replaced.

| Output                             | Meaning                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `world-global.geojson`             | Offline 50m polygons, permanent RegionIds and map labels                                   |
| `global-registry.json`             | Permanent source-code-to-RegionId mapping                                                  |
| `global-metadata.json`             | Source names/types/sovereign labels/continent/subregion, capitals and geographic adjacency |
| `global-manifest.json`             | Source URLs/checksums, license and measured coverage                                       |
| `data/scenarios/global-alpha.json` | Version 2 structured fictional gameplay state                                              |

Capital points are available for 196 source polities; missing capital data is left absent. Adjacency contains 327 undirected pairs derived from exact shared polygon edges. It excludes sea neighbors and point-only contact and is geographic metadata, not a complete military theater/logistics model. Country granularity cannot represent northern Sweden separately; a readiness directive affects the national abstraction until a future explicitly versioned regional partition is implemented. Natural Earth's terms place the data in the public domain; see THIRD_PARTY.md for provenance and licensing.
