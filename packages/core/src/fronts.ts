import type { NationId, RegionId, WorldState } from '@mandate/schemas';

type ConflictState = WorldState['conflicts'][number];
type Theater = ConflictState['theaters'][number];
type Outcome = Theater['recentOutcomes'][number]['outcome'];
type Region = WorldState['regions'][number];

const clamp = (value: number) => Math.max(0, Math.min(100, value));

function stableRoll(seed: string, key: string): number {
  let hash = 2166136261;
  for (const character of `${seed}|${key}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function adjacencyFor(world: WorldState): Map<RegionId, Set<RegionId>> {
  const adjacency = new Map<RegionId, Set<RegionId>>();
  for (const entry of world.scenario.regionAdjacency)
    adjacency.set(entry.regionId, new Set(entry.neighbors));
  if (world.scenario.regionAdjacency.some((entry) => entry.neighbors.length))
    return adjacency;

  // Small legacy scenarios have one region per polity and no polygon graph.
  // Keep those playable using their authored country-neighbor list. Large
  // regional maps never fall back to country-wide connections.
  if (world.regions.length <= 500) {
    const neighbors = new Map(
      world.scenario.neighborhoods?.map((entry) => [
        entry.nationId,
        entry.neighbors,
      ]) ?? [],
    );
    for (const left of world.regions)
      for (const right of world.regions) {
        if (left.id === right.id) continue;
        if (
          left.ownerNationId === right.ownerNationId ||
          neighbors.get(left.ownerNationId)?.includes(right.ownerNationId)
        ) {
          const set = adjacency.get(left.id) ?? new Set<RegionId>();
          set.add(right.id);
          adjacency.set(left.id, set);
        }
      }
  }
  return adjacency;
}

function addOutcome(
  theater: Theater,
  date: string,
  outcome: Outcome,
  regionId: RegionId | null,
  note: string,
) {
  theater.recentOutcomes = [
    ...theater.recentOutcomes,
    { date, outcome, regionId, note },
  ].slice(-12);
  theater.progress = clamp(
    theater.progress +
      (outcome === 'major-advance'
        ? 18
        : outcome === 'limited-advance'
          ? 10
          : outcome === 'counterattack'
            ? 12
            : outcome === 'strategic-withdrawal'
              ? -4
              : -6),
  );
  theater.momentum = Math.max(
    -100,
    Math.min(
      100,
      theater.momentum +
        (outcome === 'major-advance'
          ? 14
          : outcome === 'limited-advance'
            ? 8
            : outcome === 'counterattack'
              ? 10
              : outcome === 'strategic-withdrawal'
                ? -3
                : outcome === 'stalemate'
                  ? -2
                  : -9),
    ),
  );
  if (
    outcome === 'major-advance' ||
    outcome === 'limited-advance' ||
    outcome === 'failed-offensive' ||
    outcome === 'counterattack'
  )
    theater.exhaustion = clamp(theater.exhaustion + 2);
}

function sideFor(conflict: ConflictState, nationId: NationId) {
  if (conflict.attackers.includes(nationId))
    return { own: conflict.attackers, enemy: conflict.defenders };
  if (conflict.defenders.includes(nationId))
    return { own: conflict.defenders, enemy: conflict.attackers };
  return null;
}

function strategicTargets(
  world: WorldState,
  conflict: ConflictState,
  theater: Theater,
  enemy: NationId[],
) {
  const text = conflict.warGoals.join(' ').toLocaleLowerCase();
  const named = world.regions
    .filter(
      (region) =>
        enemy.includes(region.ownerNationId) &&
        (text.includes(region.name.toLocaleLowerCase()) ||
          text.includes(
            region.id.slice('region:'.length).replaceAll('-', ' '),
          )),
    )
    .map((region) => region.id);
  return [...new Set([...theater.regionIds, ...named])];
}

function targetIsRestricted(
  conflict: ConflictState,
  theater: Theater,
  objectives: RegionId[],
) {
  return (
    objectives.length > 0 &&
    objectives.length <= 3 &&
    /\b(?:only|but\s+(?:do not|don't)|without)\b/i.test(
      conflict.warGoals.join(' '),
    ) &&
    theater.regionIds.some((id) => objectives.includes(id))
  );
}

function supportStrength(
  world: WorldState,
  conflict: ConflictState,
  defender: NationId,
) {
  const enemies = new Set([...conflict.attackers, ...conflict.defenders]);
  return Math.min(
    12,
    world.treaties
      .filter(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'defense' &&
          treaty.parties.includes(defender),
      )
      .flatMap((treaty) => treaty.parties)
      .filter((id) => id !== defender && !enemies.has(id))
      .reduce(
        (sum, id) =>
          sum +
          (world.nations.find((nation) => nation.id === id)?.stats.military ??
            0) *
            0.06,
        0,
      ),
  );
}

function adjacentToControllers(
  world: WorldState,
  controllers: NationId[],
  adjacency: Map<RegionId, Set<RegionId>>,
) {
  const reachable = new Set<RegionId>();
  for (const region of world.regions) {
    if (!controllers.includes(region.controllerNationId)) continue;
    for (const neighbor of adjacency.get(region.id) ?? [])
      reachable.add(neighbor);
  }
  return reachable;
}

function combatMargin(
  world: WorldState,
  conflict: ConflictState,
  theater: Theater,
  attackerId: NationId,
  defenderId: NationId,
  target: Region,
  date: string,
  naval: boolean,
): number {
  const attacker = world.nations.find((nation) => nation.id === attackerId)!;
  const defender = world.nations.find((nation) => nation.id === defenderId)!;
  const attackPower =
    attacker.stats.military * 0.46 +
    attacker.stats.readiness * 0.22 +
    attacker.stats.manpower * 0.08 +
    attacker.stats.technology * 0.06 +
    theater.allocation * 0.15 +
    (theater.logistics - 50) * 0.13 +
    (conflict.logistics - 50) * 0.08 +
    theater.initiative * 0.06 +
    theater.momentum * 0.1 -
    theater.supplyPressure * 0.22 -
    theater.exhaustion * 0.08 -
    conflict.exhaustion * 0.07 -
    (naval ? 17 : 0);
  const defenseAllocation =
    conflict.theaters.find((entry) => entry.nationId === defenderId)
      ?.allocation ?? 35;
  const defensePower =
    defender.stats.military * 0.46 +
    defender.stats.readiness * 0.22 +
    defender.stats.manpower * 0.08 +
    defender.stats.technology * 0.06 +
    defenseAllocation * 0.1 +
    (target.ownerNationId === defenderId ? 8 : 0) +
    supportStrength(world, conflict, defenderId);
  const uncertainty =
    (stableRoll(
      world.scenario.rules?.seed ?? world.scenario.id,
      `${date}:${conflict.id}:${theater.id}:${target.id}`,
    ) %
      19) -
    9;
  return attackPower - defensePower + uncertainty;
}

function connectedTargets(
  world: WorldState,
  conflict: ConflictState,
  theater: Theater,
  own: NationId[],
  enemy: NationId[],
  adjacency: Map<RegionId, Set<RegionId>>,
) {
  const reachable = adjacentToControllers(world, own, adjacency);
  const objectives = strategicTargets(world, conflict, theater, enemy);
  const restricted = targetIsRestricted(conflict, theater, objectives);
  const landTargets = world.regions
    .filter(
      (region) =>
        enemy.includes(region.controllerNationId) &&
        reachable.has(region.id) &&
        (!restricted || objectives.includes(region.id)),
    )
    .sort((a, b) => {
      const targetScore = (region: Region) =>
        (objectives.includes(region.id) ? 30 : 0) +
        (region.ownerNationId !== region.controllerNationId ? 8 : 0) +
        (adjacency.get(region.id)?.size ?? 0) * 0.1;
      return targetScore(b) - targetScore(a) || a.id.localeCompare(b.id);
    });
  if (theater.posture !== 'naval-pressure') return landTargets;
  const amphibiousTargets = theater.regionIds
    .map((id) => world.regions.find((region) => region.id === id))
    .filter(
      (region): region is Region =>
        region !== undefined &&
        enemy.includes(region.controllerNationId) &&
        enemy.includes(region.ownerNationId) &&
        (!restricted || objectives.includes(region.id)),
    );
  return [
    ...landTargets,
    ...amphibiousTargets.filter(
      (region) => !landTargets.some((target) => target.id === region.id),
    ),
  ];
}

function capture(
  world: WorldState,
  conflict: ConflictState,
  theater: Theater,
  attacker: NationId,
  target: Region,
  date: string,
  outcome: Outcome,
  note: string,
) {
  target.controllerNationId = attacker;
  const force = world.nations.find((nation) => nation.id === attacker)!;
  force.stats.treasury = Math.max(
    0,
    force.stats.treasury - Math.max(1, Math.ceil(theater.allocation / 45)),
  );
  force.stats.readiness = clamp(force.stats.readiness - 2);
  force.stats.unrest = clamp(force.stats.unrest + 1);
  conflict.exhaustion = clamp(conflict.exhaustion + 1);
  addOutcome(theater, date, outcome, target.id, note);
}

function makeDefenseTheater(
  conflict: ConflictState,
  actor: NationId,
  target: RegionId,
  allocation: number,
): Theater {
  const id = `theater:auto-${conflict.id.slice(9)}-${actor.slice(7)}`;
  const existing = conflict.theaters.find((entry) => entry.id === id);
  if (existing) return existing;
  const theater: Theater = {
    id,
    nationId: actor,
    regionIds: [target],
    posture: 'hold',
    allocation: Math.max(1, Math.min(100, allocation)),
    logistics: conflict.logistics,
    supplyPressure: 0,
    initiative: 50,
    momentum: 0,
    exhaustion: 0,
    progress: 0,
    recentOutcomes: [],
  };
  conflict.theaters.push(theater);
  return theater;
}

/** Resolve bounded, deterministic strategic front operations for one monthly tick. */
export function resolveWarFronts(world: WorldState, date: string): void {
  const adjacency = adjacencyFor(world);
  for (const conflict of world.conflicts) {
    if (conflict.status !== 'active' || conflict.settlementState !== 'fighting')
      continue;
    const changedThisMonth = new Set<RegionId>();
    const activeOffensives = conflict.theaters
      .filter((theater) =>
        ['limited-offensive', 'major-offensive', 'naval-pressure'].includes(
          theater.posture,
        ),
      )
      .sort(
        (a, b) =>
          a.nationId.localeCompare(b.nationId) || a.id.localeCompare(b.id),
      );

    for (const theater of activeOffensives) {
      const side = sideFor(conflict, theater.nationId);
      if (!side) continue;
      const force = world.nations.find(
        (nation) => nation.id === theater.nationId,
      )!;
      const supplyLoad = Math.max(1, Math.ceil(theater.allocation / 55));
      const operationalCost =
        theater.posture === 'major-offensive'
          ? 8
          : theater.posture === 'limited-offensive'
            ? 4
            : 3;
      if (
        force.stats.treasury < operationalCost ||
        force.stats.stability < 25
      ) {
        theater.supplyPressure = clamp(theater.supplyPressure + 10);
        theater.exhaustion = clamp(theater.exhaustion + 1);
        addOutcome(
          theater,
          date,
          'failed-offensive',
          null,
          'Treasury or domestic stability could not sustain the operation; the front made no progress.',
        );
        continue;
      }
      force.stats.treasury -= operationalCost;
      force.stats.readiness = clamp(force.stats.readiness - 1);
      force.stats.unrest = clamp(force.stats.unrest + 1);
      conflict.exhaustion = clamp(conflict.exhaustion + 1);
      conflict.logistics = clamp(
        conflict.logistics - (theater.allocation >= 70 ? 2 : 1),
      );
      theater.logistics = clamp(
        theater.logistics - (theater.allocation >= 70 ? 2 : 1),
      );
      theater.supplyPressure = clamp(
        theater.supplyPressure + supplyLoad - (theater.logistics >= 65 ? 1 : 0),
      );
      theater.exhaustion = clamp(theater.exhaustion + 1);

      const candidates = connectedTargets(
        world,
        conflict,
        theater,
        side.own,
        side.enemy,
        adjacency,
      );
      const target = candidates.find(
        (region) => !changedThisMonth.has(region.id),
      );
      if (!target) {
        addOutcome(
          theater,
          date,
          'stalemate',
          null,
          'No reachable objective opened along the current front; both sides remain in contact.',
        );
        continue;
      }
      const margin = combatMargin(
        world,
        conflict,
        theater,
        theater.nationId,
        target.controllerNationId,
        target,
        date,
        theater.posture === 'naval-pressure',
      );
      if (margin >= 32) {
        capture(
          world,
          conflict,
          theater,
          theater.nationId,
          target,
          date,
          'major-advance',
          'Superior commitment and initiative broke part of the defensive line.',
        );
        changedThisMonth.add(target.id);
        if (margin >= 48) {
          const next = connectedTargets(
            world,
            conflict,
            theater,
            side.own,
            side.enemy,
            adjacency,
          ).find(
            (region) =>
              region.id !== target.id && !changedThisMonth.has(region.id),
          );
          if (
            next &&
            combatMargin(
              world,
              conflict,
              theater,
              theater.nationId,
              next.controllerNationId,
              next,
              date,
              false,
            ) >= 32
          ) {
            capture(
              world,
              conflict,
              theater,
              theater.nationId,
              next,
              date,
              'major-advance',
              'The advance continued into a connected neighboring region.',
            );
            changedThisMonth.add(next.id);
          }
        }
      } else if (margin >= 8) {
        capture(
          world,
          conflict,
          theater,
          theater.nationId,
          target,
          date,
          'limited-advance',
          'The offensive gained ground against organized resistance.',
        );
        changedThisMonth.add(target.id);
      } else {
        addOutcome(
          theater,
          date,
          margin >= -9 ? 'stalemate' : 'failed-offensive',
          null,
          margin >= -9
            ? 'The front held after a costly month of fighting.'
            : 'Defenders repelled the offensive; losses and exhaustion increased.',
        );
        if (margin < -9) {
          force.stats.readiness = clamp(force.stats.readiness - 2);
          force.stats.unrest = clamp(force.stats.unrest + 1);
          theater.exhaustion = clamp(theater.exhaustion + 2);
        }
      }
    }

    for (const theater of conflict.theaters.filter(
      (entry) => entry.posture === 'withdraw',
    )) {
      const side = sideFor(conflict, theater.nationId);
      if (!side) continue;
      const reachable = adjacentToControllers(world, side.own, adjacency);
      const occupied = world.regions
        .filter(
          (region) =>
            side.enemy.includes(region.ownerNationId) &&
            region.controllerNationId === theater.nationId &&
            !changedThisMonth.has(region.id) &&
            reachable.has(region.id),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const region = occupied[0];
      if (!region) continue;
      region.controllerNationId = region.ownerNationId;
      changedThisMonth.add(region.id);
      addOutcome(
        theater,
        date,
        'strategic-withdrawal',
        region.id,
        'Forces withdrew to the recognized legal border and returned military control.',
      );
    }

    // An invaded government can recover a previously lost border region even
    // when it has not issued a separate tactical order. This is one bounded
    // counter-operation per conflict and cannot reverse a capture in the same tick.
    const defenders = conflict.defenders
      .map((id) => world.nations.find((nation) => nation.id === id)!)
      .sort(
        (a, b) =>
          b.stats.military +
            b.stats.readiness -
            (a.stats.military + a.stats.readiness) || a.id.localeCompare(b.id),
      );
    const defender = defenders[0];
    if (defender) {
      const reachable = adjacentToControllers(world, [defender.id], adjacency);
      const occupied = world.regions
        .filter(
          (region) =>
            region.ownerNationId === defender.id &&
            conflict.attackers.includes(region.controllerNationId) &&
            !changedThisMonth.has(region.id) &&
            reachable.has(region.id),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const target = occupied[0];
      if (target) {
        const attacker = world.nations.find(
          (nation) => nation.id === target.controllerNationId,
        )!;
        const theater =
          conflict.theaters.find((entry) => entry.nationId === defender.id) ??
          makeDefenseTheater(
            conflict,
            defender.id,
            target.id,
            Math.max(20, defender.strategy.militaryBudgetShare),
          );
        const margin = combatMargin(
          world,
          conflict,
          theater,
          defender.id,
          attacker.id,
          target,
          date,
          false,
        );
        const roll =
          stableRoll(
            world.scenario.rules?.seed ?? world.scenario.id,
            `${date}:${conflict.id}:counter:${target.id}`,
          ) % 100;
        if (margin >= 14 && roll < Math.min(85, 42 + margin)) {
          target.controllerNationId = defender.id;
          defender.stats.treasury = Math.max(0, defender.stats.treasury - 2);
          defender.stats.readiness = clamp(defender.stats.readiness - 2);
          defender.stats.unrest = clamp(defender.stats.unrest + 1);
          conflict.exhaustion = clamp(conflict.exhaustion + 1);
          addOutcome(
            theater,
            date,
            'counterattack',
            target.id,
            `${defender.name} counterattacked and retook the region from ${attacker.name}.`,
          );
          changedThisMonth.add(target.id);
        }
      }
    }
  }
}
