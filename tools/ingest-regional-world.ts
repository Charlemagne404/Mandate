import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from 'geojson';
import { assertWorld } from '@mandate/core';
import { NationId, RegionId, ScenarioFile } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import {
  format as formatJson,
  resolveConfig as resolvePrettierConfig,
} from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const source = {
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_10m_admin_1_states_provinces.geojson`,
  sha256: '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5',
};
const simplifyToleranceDegrees = 0.008;
const outputGeography = resolve(root, 'data/geography/world-admin1.geojson.gz');
const outputScenario = resolve(root, 'data/scenarios/global-regional.json');
const registryPath = resolve(root, 'data/geography/admin1-registry.json');
const manifestPath = resolve(root, 'data/geography/admin1-manifest.json');
async function formattedJson(filename: string, value: unknown) {
  const config = await resolvePrettierConfig(filename);
  return formatJson(JSON.stringify(value), { ...config, parser: 'json' });
}

interface Admin1Properties {
  adm1_code: string;
  adm0_a3: string;
  name: string | null;
  name_alt: string | null;
  longitude: number;
  latitude: number;
  min_zoom: number;
}

type Position = [number, number, ...number[]];

async function readSource(): Promise<
  FeatureCollection<Polygon | MultiPolygon, Admin1Properties>
> {
  const flag = process.argv.indexOf('--admin1');
  let bytes: Buffer;
  if (flag >= 0) {
    const filename = process.argv[flag + 1];
    if (!filename) throw new Error('--admin1 requires a source path');
    bytes = readFileSync(resolve(filename));
  } else {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Natural Earth download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== source.sha256)
    throw new Error(`Pinned Admin-1 SHA-256 mismatch: ${digest}`);
  return JSON.parse(bytes.toString('utf8')) as FeatureCollection<
    Polygon | MultiPolygon,
    Admin1Properties
  >;
}

function simplifyOpenLine(points: Position[], toleranceSq: number): Position[] {
  if (points.length <= 2) return points;
  const kept = new Uint8Array(points.length);
  kept[0] = 1;
  kept[points.length - 1] = 1;
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [startIndex, endIndex] = pending.pop()!;
    const start = points[startIndex]!;
    const end = points[endIndex]!;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSq = dx * dx + dy * dy;
    let maximum = toleranceSq;
    let split = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      const point = points[index]!;
      const projection = lengthSq
        ? Math.max(
            0,
            Math.min(
              1,
              ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
                lengthSq,
            ),
          )
        : 0;
      const offsetX = point[0] - (start[0] + projection * dx);
      const offsetY = point[1] - (start[1] + projection * dy);
      const distanceSq = offsetX * offsetX + offsetY * offsetY;
      if (distanceSq > maximum) {
        maximum = distanceSq;
        split = index;
      }
    }
    if (split >= 0) {
      kept[split] = 1;
      pending.push([startIndex, split], [split, endIndex]);
    }
  }
  return points.filter((_, index) => kept[index]);
}

function simplifyRing(ring: Position[], toleranceSq: number): Position[] {
  if (ring.length <= 5) return ring;
  let split = 1;
  let farthest = 0;
  for (let index = 1; index < ring.length - 1; index++) {
    const dx = ring[index]![0] - ring[0]![0];
    const dy = ring[index]![1] - ring[0]![1];
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > farthest) {
      farthest = distanceSq;
      split = index;
    }
  }
  const simplified = [
    ...simplifyOpenLine(ring.slice(0, split + 1), toleranceSq),
    ...simplifyOpenLine(ring.slice(split), toleranceSq).slice(1),
  ];
  return simplified.length >= 4 ? simplified : ring;
}

function simplifyGeometry(
  geometry: Polygon | MultiPolygon,
): Polygon | MultiPolygon {
  const simplifyPolygon = (rings: Position[][]) =>
    rings.map((ring) => simplifyRing(ring, simplifyToleranceDegrees ** 2));
  return geometry.type === 'Polygon'
    ? {
        type: 'Polygon',
        coordinates: simplifyPolygon(geometry.coordinates as Position[][]),
      }
    : {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          simplifyPolygon(polygon as Position[][]),
        ),
      };
}

const input = await readSource();
const sourceWorld = JSON.parse(
  readFileSync(resolve(root, 'data/scenarios/global-alpha.json'), 'utf8'),
).world as WorldState;
const countryGeography = JSON.parse(
  readFileSync(resolve(root, 'data/geography/world-global.geojson'), 'utf8'),
) as FeatureCollection<
  Polygon | MultiPolygon,
  { regionId: string; name: string; label: [number, number] }
>;
const sourceRegions = new Map(
  sourceWorld.regions.map((region) => [region.geometryId, region]),
);
const nationByAdmin0 = new Map<string, string>();
for (const feature of countryGeography.features) {
  const region = sourceRegions.get(RegionId.parse(String(feature.id)));
  if (region)
    nationByAdmin0.set(
      feature
        .id!.toString()
        .replace(/^region:ne-/, '')
        .toUpperCase(),
      region.ownerNationId,
    );
}

// Natural Earth labels these small administered areas with their own code.
// Preserve their source boundaries while assigning them to an existing actor.
const specialAssignments: Record<
  string,
  { owner: string; controller?: string }
> = {
  ESB: { owner: 'nation:gbr' },
  GIB: { owner: 'nation:gbr' },
  WSB: { owner: 'nation:gbr' },
  USG: { owner: 'nation:cub', controller: 'nation:usa' },
  KAB: { owner: 'nation:kaz', controller: 'nation:rus' },
  UMI: { owner: 'nation:usa' },
  CSI: { owner: 'nation:aus' },
  CLP: { owner: 'nation:fra' },
};
const excludedSourceCodes = new Set(['PGA']);
const registry = existsSync(registryPath)
  ? (JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, string>)
  : {};
const seenIds = new Set<string>();
const geographyFeatures: Feature<
  Polygon | MultiPolygon,
  {
    regionId: string;
    name: string;
    label: [number, number];
    minZoom: number;
  }
>[] = [];
const regions: WorldState['regions'] = [];
const representedNations = new Set<string>();
const sorted = [...input.features].sort((a, b) =>
  a.properties.adm1_code.localeCompare(b.properties.adm1_code),
);

for (const feature of sorted) {
  const code = feature.properties.adm0_a3;
  if (excludedSourceCodes.has(code)) continue;
  const assignment = specialAssignments[code];
  const owner = assignment?.owner ?? nationByAdmin0.get(code);
  if (!owner || !sourceWorld.nations.some((nation) => nation.id === owner))
    throw new Error(`Admin-1 feature has no scenario actor: ${code}`);
  const regionCode = feature.properties.adm1_code
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');
  const id = (registry[feature.properties.adm1_code] ??=
    `region:ne-admin1-${regionCode}`);
  const regionId = RegionId.parse(id);
  if (seenIds.has(regionId)) throw new Error(`Duplicate region ID ${regionId}`);
  seenIds.add(regionId);
  representedNations.add(owner);
  const label: [number, number] = [
    feature.properties.longitude,
    feature.properties.latitude,
  ];
  const name = (
    feature.properties.name ??
    feature.properties.name_alt ??
    feature.properties.adm1_code
  ).trim();
  const geometry = simplifyGeometry(feature.geometry);
  geographyFeatures.push({
    type: 'Feature',
    id: regionId,
    geometry,
    properties: {
      regionId,
      name,
      label,
      minZoom: Number.isFinite(feature.properties.min_zoom)
        ? feature.properties.min_zoom
        : 4,
    },
  });
  regions.push({
    id: regionId,
    name,
    geometryId: regionId,
    ownerNationId: NationId.parse(owner),
    controllerNationId: NationId.parse(assignment?.controller ?? owner),
    claims: [],
    recognizedClaims: [],
  });
}

const fallbackFeatures = countryGeography.features
  .filter((feature) => {
    const region = sourceRegions.get(RegionId.parse(String(feature.id)));
    return Boolean(region && !representedNations.has(region.ownerNationId));
  })
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
for (const feature of fallbackFeatures) {
  const sourceRegion = sourceRegions.get(RegionId.parse(String(feature.id)))!;
  if (seenIds.has(sourceRegion.geometryId))
    throw new Error(`Duplicate fallback geometry ${sourceRegion.geometryId}`);
  seenIds.add(sourceRegion.geometryId);
  geographyFeatures.push({
    type: 'Feature',
    id: sourceRegion.geometryId,
    geometry: feature.geometry,
    properties: {
      regionId: sourceRegion.geometryId,
      name: sourceRegion.name,
      label: feature.properties.label,
      minZoom: 2,
    },
  });
  regions.push(sourceRegion);
}

function boundaryPoints(geometry: Polygon | MultiPolygon) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const points = new Set<string>();
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const position of ring) {
        const longitude = position[0];
        const latitude = position[1];
        if (
          typeof longitude !== 'number' ||
          typeof latitude !== 'number' ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude)
        )
          continue;
        const normalizedLongitude =
          Math.abs(Math.abs(longitude) - 180) < 0.00001 ? 180 : longitude;
        points.add(
          `${Math.round(normalizedLongitude * 100000)},${Math.round(latitude * 100000)}`,
        );
      }
  return points;
}

// Build a stable land-front graph from the pinned Natural Earth shapes.
// Requiring two shared vertices excludes corner-only contacts.
const sharedVertices = new Map<string, Set<string>>();
for (const feature of geographyFeatures)
  for (const point of boundaryPoints(feature.geometry)) {
    const ids = sharedVertices.get(point) ?? new Set<string>();
    ids.add(String(feature.id));
    sharedVertices.set(point, ids);
  }
const sharedBoundaryCounts = new Map<string, number>();
for (const ids of sharedVertices.values()) {
  const uniqueIds = [...ids].sort();
  for (let left = 0; left < uniqueIds.length; left++)
    for (let right = left + 1; right < uniqueIds.length; right++) {
      const key = `${uniqueIds[left]}\u0000${uniqueIds[right]}`;
      sharedBoundaryCounts.set(key, (sharedBoundaryCounts.get(key) ?? 0) + 1);
    }
}
const adjacency = new Map<string, Set<string>>(
  regions.map((region) => [region.id, new Set<string>()]),
);
for (const [key, pointCount] of sharedBoundaryCounts) {
  if (pointCount < 2) continue;
  const [left, right] = key.split('\u0000') as [string, string];
  adjacency.get(left)?.add(right);
  adjacency.get(right)?.add(left);
}

const regionalWorld: WorldState = {
  ...sourceWorld,
  saveId: 'save:global-regional' as WorldState['saveId'],
  scenario: {
    ...sourceWorld.scenario,
    id: 'scenario:global-regional' as WorldState['scenario']['id'],
    name: 'A World in Balance · Regional 2028',
    description:
      'Fictional governments play across first-order regional boundaries derived from Natural Earth. Political data, leaders, claims, capacities, treaties and crises are synthetic. Countries without source subdivisions retain one national-scale region; some small administered areas share their administering government for playability.',
    geographyVersion: 'natural-earth-admin1-v1',
    rules: sourceWorld.scenario.rules
      ? {
          ...sourceWorld.scenario.rules,
          seed: 'global-regional-continuity-v1',
        }
      : undefined,
    regionAdjacency: regions.map((region) => ({
      regionId: region.id,
      neighbors: [...(adjacency.get(region.id) ?? [])]
        .map((id) => RegionId.parse(id))
        .sort(),
    })),
  },
  regions: regions.sort((a, b) => a.id.localeCompare(b.id)),
};
ScenarioFile.parse({
  formatVersion: 3,
  kind: 'scenario',
  world: regionalWorld,
});
assertWorld(regionalWorld);

const collection: FeatureCollection<
  Polygon | MultiPolygon,
  (typeof geographyFeatures)[number]['properties']
> = { type: 'FeatureCollection', features: geographyFeatures };
const geographyBytes = Buffer.from(JSON.stringify(collection) + '\n');
const compressedGeography = gzipSync(geographyBytes, { level: 9 });
const scenarioBytes = Buffer.from(
  await formattedJson(outputScenario, {
    formatVersion: 3,
    kind: 'scenario',
    world: regionalWorld,
  }),
);
const manifest = {
  version: 'natural-earth-admin1-v1',
  upstreamRevision: revision,
  source: { ...source },
  license: 'Public domain',
  licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  featureCount: geographyFeatures.length,
  polityCount: regionalWorld.nations.length,
  subdivisionFeatureCount: sorted.length - excludedSourceCodes.size,
  nationalFallbackCount: fallbackFeatures.length,
  excludedSourceCodes: [...excludedSourceCodes],
  simplification: {
    method: 'Douglas-Peucker with closed-ring split at its farthest vertex',
    toleranceDegrees: simplifyToleranceDegrees,
  },
  geographySha256: createHash('sha256').update(geographyBytes).digest('hex'),
  scenarioSha256: createHash('sha256').update(scenarioBytes).digest('hex'),
  scope:
    'Natural Earth first-order administrative subdivisions. This adds regional resolution only; governments and all political starting values are synthetic. Country-scale fallback regions remain for polities without source subdivisions. Special administered areas are assigned to existing actors, and the separately coded Spratly Islands feature is omitted because it does not map to one unambiguous scenario polity.',
};

function replaceAtomically(filename: string, contents: Buffer | string) {
  const temporary = `${filename}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, filename);
}

replaceAtomically(registryPath, await formattedJson(registryPath, registry));
replaceAtomically(outputGeography, compressedGeography);
replaceAtomically(outputScenario, scenarioBytes);
replaceAtomically(manifestPath, await formattedJson(manifestPath, manifest));
console.log(
  `Generated ${regions.length} regions for ${regionalWorld.nations.length} polities (${geographyBytes.length.toLocaleString()} B GeoJSON; ${compressedGeography.length.toLocaleString()} B gzip; ${fallbackFeatures.length} country-scale fallbacks).`,
);
