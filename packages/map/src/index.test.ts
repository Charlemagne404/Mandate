import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { EconomicLink, NationId, WorldState } from '@mandate/schemas';
import { loadScenario } from '@mandate/scenarios';
import { politicalFeatures } from './index.js';

describe('sphere map layer', () => {
  it('shows a competing patron when its real directional leverage leads', () => {
    const world = WorldState.parse(
      loadScenario(resolve('data/scenarios/global-regional.json')),
    );
    const nicaragua = NationId.parse('nation:nic');
    const honduras = NationId.parse('nation:hnd');
    const mexico = NationId.parse('nation:mex');
    const applyLink = (link: ReturnType<typeof EconomicLink.parse>) => {
      const existing = world.economicLinks.find(
        (candidate) =>
          candidate.dependentNationId === link.dependentNationId &&
          candidate.partnerNationId === link.partnerNationId,
      );
      if (existing) Object.assign(existing, link);
      else world.economicLinks.push(link);
    };
    applyLink(
      EconomicLink.parse({
        id: 'economic:honduras-nicaragua',
        dependentNationId: honduras,
        partnerNationId: nicaragua,
        imports: 10,
        exports: 0,
        energy: 0,
        strategicGoods: 0,
        finance: 0,
        infrastructure: 0,
        alternatives: 0,
      }),
    );
    applyLink(
      EconomicLink.parse({
        id: 'economic:honduras-mexico',
        dependentNationId: honduras,
        partnerNationId: mexico,
        imports: 100,
        exports: 0,
        energy: 0,
        strategicGoods: 0,
        finance: 0,
        infrastructure: 0,
        alternatives: 0,
      }),
    );

    const feature = politicalFeatures(world, 'influence', nicaragua).find(
      (entry) =>
        world.regions.find((region) => region.id === entry.id)
          ?.ownerNationId === honduras,
    );
    expect(feature?.color).toBe(
      world.nations.find((nation) => nation.id === mexico)!.color,
    );
  });
});
