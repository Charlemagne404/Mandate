import { seedGlobalContinuity } from './scenario-continuity.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import { assertWorld } from '@mandate/core';
import { ScenarioFile, RegionId } from '@mandate/schemas';
import { format, resolveConfig } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const sources = {
  countries: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_50m_admin_0_countries.geojson`,
    sha256: '3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb',
  },
  places: {
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_50m_populated_places.geojson`,
    sha256: 'da4662b7bbfeb897d02f228c5839131dce27acff5717630f91ccff4f67828ee7',
  },
};
async function source(name: keyof typeof sources, flag: string) {
  const index = process.argv.indexOf(flag);
  let bytes: Buffer;
  if (index >= 0) bytes = readFileSync(resolve(process.argv[index + 1]!));
  else {
    const response = await fetch(sources[name].url, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`Geography download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sources[name].sha256)
    throw new Error(`Pinned ${name} checksum mismatch`);
  return JSON.parse(bytes.toString()) as unknown;
}
interface CountryProperties {
  ADM0_A3: string;
  ADMIN: string;
  TYPE: string;
  SOVEREIGNT: string;
  ISO_A3: string;
  CONTINENT: string;
  SUBREGION: string;
  LABEL_X: number;
  LABEL_Y: number;
}
interface PlaceProperties {
  ADM0_A3: string;
  ADM0CAP: number;
  NAME: string;
}
const upstream = (await source(
  'countries',
  '--countries',
)) as FeatureCollection<Polygon | MultiPolygon, CountryProperties>;
const places = (await source('places', '--places')) as FeatureCollection<
  Point,
  PlaceProperties
>;
const originalRegistry = JSON.parse(
  readFileSync(resolve(root, 'data/geography/region-registry.json'), 'utf8'),
) as Record<string, string>;
const registryPath = resolve(root, 'data/geography/global-registry.json');
const registry = existsSync(registryPath)
  ? (JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, string>)
  : { ...originalRegistry };
const sorted = [...upstream.features].sort((a, b) =>
  a.properties.ADM0_A3.localeCompare(b.properties.ADM0_A3),
);
const seen = new Set<string>();
const features = sorted.map((feature) => {
  const code = feature.properties.ADM0_A3;
  registry[code] ??= `region:ne-${code.toLowerCase()}`;
  const id = RegionId.parse(registry[code]);
  if (seen.has(id)) throw new Error(`Duplicate geography ID ${id}`);
  if (originalRegistry[code] && originalRegistry[code] !== id)
    throw new Error(`Attempt to rewrite permanent ID ${code}`);
  seen.add(id);
  return {
    type: 'Feature' as const,
    id,
    geometry: feature.geometry,
    properties: {
      regionId: id,
      name: feature.properties.ADMIN,
      label: [feature.properties.LABEL_X, feature.properties.LABEL_Y],
      continent: feature.properties.CONTINENT,
      subregion: feature.properties.SUBREGION,
    },
  };
});
// Shared polygon edges define land neighbors; point-only contact does not.
const edges = new Map<string, Set<string>>();
for (const feature of features) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const key = [ring[i - 1]!.join(','), ring[i]!.join(',')]
          .sort()
          .join('|');
        const occupants = edges.get(key) ?? new Set<string>();
        occupants.add(feature.id);
        edges.set(key, occupants);
      }
}
const neighbors = new Map(
  features.map((feature) => [feature.id as string, new Set<string>()]),
);
for (const occupants of edges.values())
  if (occupants.size > 1)
    for (const left of occupants)
      for (const right of occupants)
        if (left !== right) neighbors.get(left)!.add(right);
const metadata = sorted.map((feature) => {
  const code = feature.properties.ADM0_A3;
  const capitals = places.features
    .filter(
      (place) =>
        place.properties.ADM0_A3 === code && place.properties.ADM0CAP === 1,
    )
    .map((place) => ({
      name: place.properties.NAME,
      coordinates: place.geometry.coordinates,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    nationId: `nation:${code.toLowerCase()}`,
    regionId: registry[code],
    name: feature.properties.ADMIN,
    sourceType: feature.properties.TYPE,
    sourceSovereign: feature.properties.SOVEREIGNT,
    isoA3:
      feature.properties.ISO_A3 === '-99' ? null : feature.properties.ISO_A3,
    continent: feature.properties.CONTINENT,
    subregion: feature.properties.SUBREGION,
    capitals,
    adjacentRegionIds: [...neighbors.get(registry[code]!)!].sort(),
  };
});
const hash = (id: string) =>
  createHash('sha256')
    .update(`mandate-global-alpha-v1:${id}`)
    .digest()
    .readUInt32BE();
const major = new Set([
  'usa',
  'chn',
  'rus',
  'ind',
  'deu',
  'fra',
  'gbr',
  'jpn',
  'bra',
]);
const startDate = '2028-01-01';
const nations = metadata.map((item) => {
  const code = item.nationId.slice(7),
    weight = major.has(code) ? 25 : 0,
    seed = hash(code);
  return {
    id: item.nationId,
    name: item.name,
    color: `#${[80 + (seed % 90), 95 + ((seed >>> 8) % 85), 105 + ((seed >>> 16) % 80)].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    government: {
      type: ['Parliamentary council', 'Federal assembly', 'Executive republic'][
        seed % 3
      ]!,
      ideology: [
        'Civic pluralism',
        'Social developmentalism',
        'Sovereign conservatism',
      ][seed % 3]!,
    },
    leader: `${item.name} scenario cabinet`,
    stats: {
      economy: 35 + (seed % 35) + weight,
      military: 25 + (seed % 40) + weight,
      stability: 55 + (seed % 30),
      legitimacy: 50 + (seed % 35),
      treasury: 400 + (seed % 500) + weight * 30,
      industrial: 30 + (seed % 40) + weight,
      fiscal: 45 + (seed % 35),
      readiness: 30 + (seed % 45),
      manpower: 25 + (seed % 40) + weight,
      technology: 35 + (seed % 35) + weight,
      influence: 20 + (seed % 45) + weight,
      energyExposure: 20 + (seed % 55),
      tradeDependence: 25 + (seed % 55),
      unrest: 5 + (seed % 15),
    },
  };
});
const regionToNation = new Map(
  metadata.map((item) => [item.regionId!, item.nationId]),
);
const relations = new Map<
  string,
  {
    nationA: string;
    nationB: string;
    score: number;
    trust: number;
    tension: number;
    tradeDependence: number;
    militaryAlignment: number;
    grievances: string[];
  }
>();
function relation(left: string, right: string, score: number) {
  const [nationA, nationB] = [left, right].sort() as [string, string];
  relations.set(`${nationA}~${nationB}`, {
    nationA,
    nationB,
    score,
    trust: Math.max(15, 50 + Math.floor(score / 2)),
    tension: Math.max(5, 20 - Math.floor(score / 2)),
    tradeDependence: 25,
    militaryAlignment: score,
    grievances:
      score < 0
        ? ['Fictional strategic competition in the alpha scenario']
        : [],
  });
}
for (const item of metadata)
  for (const neighbor of item.adjacentRegionIds)
    relation(item.nationId, regionToNation.get(neighbor)!, 10);
const groups = [
  ['swe', 'fin', 'nor', 'dnk', 'isl'],
  ['deu', 'fra', 'pol', 'cze', 'nld', 'bel'],
  ['usa', 'can', 'jpn', 'aus', 'nzl'],
  ['ind', 'idn', 'zaf', 'bra'],
];
for (const group of groups)
  for (const a of group)
    for (const b of group)
      if (a < b) relation(`nation:${a}`, `nation:${b}`, 60);
for (const [a, b] of [
  ['rus', 'est'],
  ['rus', 'pol'],
  ['usa', 'chn'],
  ['bra', 'ven'],
] as const)
  relation(`nation:${a}`, `nation:${b}`, -35);
const goals = metadata.map((item, index) => ({
  id: `goal:global-${item.nationId.slice(7)}`,
  nationId: item.nationId,
  title: [
    'Diversify energy supply',
    'Strengthen regional dialogue',
    'Improve industrial resilience',
    'Stabilize domestic institutions',
  ][index % 4]!,
  priority: 35 + (hash(item.nationId) % 50),
  status: 'active',
  targetNationIds: item.adjacentRegionIds
    .slice(0, 2)
    .map((id) => regionToNation.get(id)!),
  progress: 0,
  reason:
    'Original synthetic starting agenda; pursue gradual improvements without automatic success.',
  createdDate: startDate,
  updatedDate: startDate,
  kind: ['economic', 'diplomatic', 'economic', 'domestic'][index % 4]!,
  visibility: 'public',
  deadline: null,
  blockers: [],
  evidence: [],
}));
const sweden = goals.find((goal) => goal.nationId === 'nation:swe')!;
Object.assign(sweden, {
  title: 'Explore Nordic defense cooperation without a formal alliance',
  kind: 'diplomatic',
  priority: 85,
  targetNationIds: ['nation:fin', 'nation:nor'],
});
const world = ScenarioFile.parse({
  formatVersion: 3,
  kind: 'scenario',
  world: {
    schemaVersion: 3,
    saveId: 'save:global-alpha',
    ancestry: null,
    scenario: {
      id: 'scenario:global-alpha',
      name: 'A World in Balance · 2028',
      description:
        'Original fictional political setup on Natural Earth geography. All governments, leaders, indices, alliances, rivalries, goals and crises are invented. The 242 country and territory polygons are independently simulated administrative actors for playability; this is not a sovereignty or contemporary factual dataset.',
      synthetic: true,
      startDate,
      geographyVersion: 'natural-earth-50m-v1',
    },
    date: startDate,
    revision: 0,
    playerNationId: 'nation:swe',
    nations,
    regions: metadata.map((item) => ({
      id: item.regionId,
      name: item.name,
      geometryId: item.regionId,
      ownerNationId: item.nationId,
      controllerNationId: item.nationId,
      claims: [],
    })),
    relations: [...relations.values()].sort((a, b) =>
      (a.nationA + a.nationB).localeCompare(b.nationA + b.nationB),
    ),
    treaties: [
      {
        id: 'treaty:global-pacific-insurance',
        name: 'Pacific Mutual Security Arrangement',
        kind: 'defense',
        parties: ['nation:usa', 'nation:can', 'nation:jpn', 'nation:aus'],
        status: 'active',
        terms: 'Fictional mutual consultation and defensive assistance.',
      },
      {
        id: 'treaty:global-european-trade',
        name: 'Continental Resilience Trade Accord',
        kind: 'trade',
        parties: ['nation:deu', 'nation:fra', 'nation:pol'],
        status: 'active',
        terms: 'Fictional open trade and coordinated industrial resilience.',
      },
    ],
    conflicts: [
      {
        id: 'conflict:global-orinoco',
        name: 'Orinoco Corridor Emergency · fictional',
        attackers: ['nation:ven'],
        defenders: ['nation:bra'],
        status: 'active',
        escalation: 25,
        exhaustion: 5,
        logistics: 45,
        warGoals: ['Reopen a fictional contested transport corridor'],
      },
    ],
    goals,
    organizations: [
      {
        id: 'organization:nordic-dialogue',
        name: 'Nordic Dialogue Council',
        kind: 'regional',
        members: groups[0]!.map((code) => `nation:${code}`),
        charter:
          'Fictional consultation forum without a mutual-defense obligation.',
      },
      {
        id: 'organization:resilience-forum',
        name: 'Global Resilience Forum',
        kind: 'institution',
        members: ['nation:ind', 'nation:idn', 'nation:zaf', 'nation:bra'],
        charter: 'Fictional economic dialogue among independent states.',
      },
    ],
    initiatives: [
      {
        id: 'initiative:global-fin-energy',
        nationId: 'nation:fin',
        name: 'Energy resilience program',
        kind: 'energy',
        startDate,
        durationDays: 720,
        effort: 2,
        targetNationId: null,
        visibility: 'public',
        status: 'active',
        progress: 0,
        invested: 0,
        dependencies: [],
      },
    ],
    negotiations: [],
    events: [],
    turns: [],
    actions: [],
    commands: [],
  },
});
seedGlobalContinuity(
  world.world,
  metadata.map((m) => ({
    nationId: m.nationId,
    neighbors: [
      ...new Set(
        m.adjacentRegionIds
          .map((id) => regionToNation.get(id)!)
          .filter((id) => id && id !== m.nationId),
      ),
    ].slice(0, 20),
  })),
);
assertWorld(world.world);
const manifest = {
  version: 'natural-earth-50m-v1',
  upstreamRevision: revision,
  sources,
  license: 'Public domain',
  licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  regionCount: features.length,
  nationCount: nations.length,
  capitalCoverage: metadata.filter((item) => item.capitals.length > 0).length,
  adjacentPairs:
    [...neighbors.values()].reduce((sum, set) => sum + set.size, 0) / 2,
  idPolicy:
    'Existing committed 110m ADM0_A3 region IDs retained; new 50m IDs added in global-registry.json. Scenario NationIds are committed ADM0_A3 codes, independent from geometry.',
  scope:
    '242 pinned Natural Earth administrative polygons including sovereign countries, territories, disputed areas and Antarctica. Not 242 sovereign states or a comprehensive current recognition dataset. Small states including Monaco, San Marino and Vatican City are represented; upstream dated names and classifications are retained as source metadata.',
  adjacency:
    'Exact shared land-boundary edges; no sea neighbors or point-only contacts. Geographic metadata is separate from political ownership.',
};
const outputs: [string, unknown][] = [
  [
    'data/geography/world-global.geojson',
    { type: 'FeatureCollection', features },
  ],
  ['data/geography/global-metadata.json', metadata],
  ['data/geography/global-manifest.json', manifest],
  [
    'data/geography/global-registry.json',
    Object.fromEntries(
      Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)),
    ),
  ],
  ['data/scenarios/global-alpha.json', world],
];
const formatting =
  (await resolveConfig(resolve(root, '.prettierrc.json'))) ?? {};
for (const [name, value] of outputs) {
  const content =
    JSON.stringify(value, null, name.endsWith('.geojson') ? 0 : 2) + '\n';
  writeFileSync(
    resolve(root, name) + '.tmp',
    name.endsWith('.geojson')
      ? content
      : await format(content, { ...formatting, parser: 'json' }),
  );
}
for (const [name] of outputs)
  renameSync(resolve(root, name) + '.tmp', resolve(root, name));
console.log(
  JSON.stringify({
    regions: features.length,
    nations: nations.length,
    capitals: manifest.capitalCoverage,
    adjacentPairs: manifest.adjacentPairs,
    goals: goals.length,
  }),
);
