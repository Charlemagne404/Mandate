import { describe, expect, it } from 'vitest';
import { loadScenario } from '@mandate/scenarios';
import { Conflict, NationId } from '@mandate/schemas';
import { resolveWarFronts } from './fronts.js';
import { assertWorld } from './index.js';

const scenarioPath = new URL(
  '../../../data/scenarios/global-regional.json',
  import.meta.url,
).pathname;
const sweden = NationId.parse('nation:swe');
const norway = NationId.parse('nation:nor');
function setup(
  posture: 'major-offensive' | 'naval-pressure' = 'major-offensive',
) {
  const world = loadScenario(scenarioPath);
  const adjacency = new Map(
    world.scenario.regionAdjacency.map((entry) => [
      entry.regionId,
      new Set(entry.neighbors),
    ]),
  );
  const swedishRegions = world.regions.filter(
    (region) => region.controllerNationId === sweden,
  );
  const target =
    posture === 'naval-pressure'
      ? world.regions.find(
          (region) =>
            region.ownerNationId === norway && region.name === 'Svalbard',
        )!
      : world.regions
          .filter(
            (region) =>
              region.ownerNationId === norway &&
              swedishRegions.some((friendly) =>
                adjacency.get(friendly.id)?.has(region.id),
              ),
          )
          .sort((left, right) => left.id.localeCompare(right.id))[0]!;
  const swedishForce = world.nations.find((nation) => nation.id === sweden)!;
  const norwegianForce = world.nations.find((nation) => nation.id === norway)!;
  swedishForce.stats.military = 100;
  swedishForce.stats.readiness = 100;
  swedishForce.stats.manpower = 100;
  swedishForce.stats.technology = 100;
  swedishForce.stats.treasury = 500;
  swedishForce.stats.unrest = 0;
  norwegianForce.stats.military = 25;
  norwegianForce.stats.readiness = 20;
  norwegianForce.stats.manpower = 30;
  norwegianForce.stats.technology = 35;
  const conflict = Conflict.parse({
    id: 'conflict:front-test',
    name: 'Sweden–Norway War',
    attackers: [sweden],
    defenders: [norway],
    status: 'active',
    escalation: 70,
    logistics: 95,
    warGoals: [`Secure ${target.name}.`],
    theaters: [
      {
        id: 'theater:front-test-sweden',
        nationId: sweden,
        regionIds: [target.id],
        posture,
        allocation: 100,
        logistics: 95,
        supplyPressure: 0,
        initiative: 95,
        momentum: 0,
        exhaustion: 0,
        progress: 0,
        recentOutcomes: [],
      },
    ],
  });
  world.conflicts.push(conflict);
  if (posture === 'naval-pressure')
    for (const region of world.regions)
      if (region.ownerNationId === norway && region.id !== target.id)
        region.controllerNationId = sweden;
  return { world, conflict, target, adjacency };
}

describe('strategic war fronts', () => {
  it('advances from an adjacent front, changes control only, and charges the attacker', () => {
    const { world, conflict, target, adjacency } = setup();
    const beforeTreasury = world.nations.find((nation) => nation.id === sweden)!
      .stats.treasury;
    const beforeReadiness = world.nations.find(
      (nation) => nation.id === sweden,
    )!.stats.readiness;
    resolveWarFronts(world, world.date);
    const occupied = world.regions.filter(
      (region) =>
        region.ownerNationId === norway && region.controllerNationId === sweden,
    );
    expect(occupied.some((region) => region.id === target.id)).toBe(true);
    expect(
      occupied.every((region) =>
        world.regions.some(
          (friendly) =>
            friendly.controllerNationId === sweden &&
            adjacency.get(friendly.id)?.has(region.id),
        ),
      ),
    ).toBe(true);
    expect(target.ownerNationId).toBe(norway);
    expect(target.controllerNationId).toBe(sweden);
    expect(conflict.theaters[0]!.recentOutcomes[0]!.outcome).toMatch(/advance/);
    expect(
      world.nations.find((nation) => nation.id === sweden)!.stats.treasury,
    ).toBeLessThan(beforeTreasury);
    expect(
      world.nations.find((nation) => nation.id === sweden)!.stats.readiness,
    ).toBeLessThan(beforeReadiness);
    assertWorld(world);
  });

  it('can enter a disconnected island objective only through explicit naval pressure', () => {
    const { world, conflict, target } = setup('naval-pressure');
    expect(
      world.scenario.regionAdjacency.find(
        (entry) => entry.regionId === target.id,
      )!.neighbors,
    ).toHaveLength(0);
    resolveWarFronts(world, world.date);
    expect(target.ownerNationId).toBe(norway);
    expect(target.controllerNationId).toBe(sweden);
    expect(conflict.theaters[0]!.recentOutcomes[0]!.outcome).toMatch(/advance/);
    assertWorld(world);
  });

  it('records a failed operation when commitment and capability cannot overcome defense', () => {
    const { world, conflict, target } = setup();
    const swedishForce = world.nations.find((nation) => nation.id === sweden)!;
    swedishForce.stats.military = 0;
    swedishForce.stats.readiness = 0;
    swedishForce.stats.manpower = 0;
    swedishForce.stats.technology = 0;
    const norwegianForce = world.nations.find(
      (nation) => nation.id === norway,
    )!;
    norwegianForce.stats.military = 100;
    norwegianForce.stats.readiness = 100;
    norwegianForce.stats.manpower = 100;
    norwegianForce.stats.technology = 100;
    resolveWarFronts(world, world.date);
    expect(target.controllerNationId).toBe(norway);
    expect(conflict.theaters[0]!.recentOutcomes[0]!.outcome).toBe(
      'failed-offensive',
    );
    assertWorld(world);
  });
});
