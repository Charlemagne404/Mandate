import { readFileSync, writeFileSync } from 'node:fs';
import { loadScenario } from '@mandate/scenarios';
import { assertWorld } from '@mandate/core';
import { NationId } from '@mandate/schemas';
import { seedGlobalContinuity } from './scenario-continuity.js';
const w = loadScenario('data/scenarios/global-alpha.json');
const metadata = JSON.parse(
  readFileSync('data/geography/global-metadata.json', 'utf8'),
) as Array<{ nationId: string; adjacentRegionIds: string[] }>;
const regionToNation = new Map(
  w.regions.map((r) => [r.id as string, r.ownerNationId]),
);
seedGlobalContinuity(
  w,
  metadata.map((m) => ({
    nationId: NationId.parse(m.nationId),
    neighbors: [
      ...new Set(
        m.adjacentRegionIds.flatMap((id) => {
          const n = regionToNation.get(id);
          return n && n !== m.nationId ? [n] : [];
        }),
      ),
    ].slice(0, 20),
  })),
);
assertWorld(w);
writeFileSync(
  'data/scenarios/global-alpha.json',
  JSON.stringify({ formatVersion: 3, kind: 'scenario', world: w }, null, 2) +
    '\n',
);
