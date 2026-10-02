import type { NationId, WorldState } from '@mandate/schemas';
import type { PlayerIntent, RelevanceSelection } from './contracts.js';

export function selectRelevance(
  world: WorldState,
  intent: PlayerIntent | null,
): RelevanceSelection {
  const direct = new Set<NationId>(
    intent ? [intent.actorNationId, ...intent.targetNationIds] : [],
  );
  const secondary = new Set<NationId>();
  const reasons: string[] = [];
  for (const conflict of world.conflicts.filter((c) => c.status === 'active')) {
    const ids = [...conflict.attackers, ...conflict.defenders];
    if (ids.some((id) => direct.has(id))) {
      ids.forEach((id) => secondary.add(id));
      reasons.push(`Active conflict ${conflict.id}`);
    }
  }
  for (const treaty of world.treaties.filter((t) => t.status === 'active')) {
    if (treaty.parties.some((id) => direct.has(id))) {
      treaty.parties.forEach((id) => secondary.add(id));
      reasons.push(`Binding commitment ${treaty.id}`);
    }
  }
  const extra = world as WorldState & {
    negotiations?: Array<{
      status: string;
      proposerNationId: NationId;
      recipientNationId: NationId;
      id: string;
    }>;
  };
  for (const n of extra.negotiations ?? []) {
    if (
      n.status === 'open' &&
      (direct.has(n.proposerNationId) || direct.has(n.recipientNationId))
    ) {
      secondary.add(n.proposerNationId);
      secondary.add(n.recipientNationId);
      reasons.push(`Unresolved negotiation ${n.id}`);
    }
  }
  for (const n of world.scenario.neighborhoods ?? [])
    if (direct.has(n.nationId)) {
      for (const id of n.neighbors)
        if (
          world.goals.some(
            (g) =>
              g.nationId === id &&
              g.targetNationIds.some((target) => direct.has(target)),
          ) ||
          world.relations.some(
            (r) =>
              [r.nationA, r.nationB].includes(id) &&
              [r.nationA, r.nationB].some((target) => direct.has(target)) &&
              Math.abs(r.score) >= 30,
          )
        )
          secondary.add(id);
    }
  for (const l of world.economicLinks)
    if (direct.has(l.dependentNationId) && l.imports + l.energy >= 80)
      secondary.add(l.partnerNationId);
  direct.forEach((id) => secondary.delete(id));
  return {
    version: 1,
    directNationIds: [...direct].sort(),
    secondaryNationIds: [...secondary].sort().slice(0, 12),
    reasons,
  };
}

export interface ActorActivation {
  nationId: NationId;
  score: number;
  reasons: string[];
  background: boolean;
}
/** A deterministic rotating slot prevents even low-salience countries from starving. */
export function scheduleActors(
  world: WorldState,
  relevance: RelevanceSelection,
  backgroundCount = 3,
): ActorActivation[] {
  const sorted = [...world.nations].sort((a, b) => a.id.localeCompare(b.id));
  const direct = new Set([
    ...relevance.directNationIds,
    ...relevance.secondaryNationIds,
  ]);
  const ranked = sorted.map((n): ActorActivation => {
    const goals = world.goals.filter(
      (g) =>
        g.nationId === n.id &&
        !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
    );
    const wars = world.conflicts.filter(
      (c) =>
        c.status === 'active' &&
        [...c.attackers, ...c.defenders].includes(n.id),
    );
    const recent = world.commands
      .slice(-500)
      .some((c) => JSON.stringify(c.command).includes(`"${n.id}"`));
    return {
      nationId: n.id,
      background: !direct.has(n.id),
      score:
        n.stats.military / 5 +
        n.stats.economy / 10 +
        goals.reduce((s, g) => s + g.priority / 10, 0) +
        wars.length * 25 +
        (100 - n.stats.stability) / 5 +
        (recent ? 0 : 10),
      reasons: [
        ...(goals.length ? ['Unresolved strategic goals'] : []),
        ...(wars.length ? ['Active conflict'] : []),
        ...(n.stats.stability < 40 ? ['Domestic pressure'] : []),
        ...(recent ? [] : ['No recent canonical action']),
      ],
    };
  });
  const selected = ranked.filter((n) => direct.has(n.nationId));
  const crisis = new Set([
    ...world.crises
      .filter((c) => c.status !== 'resolved')
      .flatMap((c) => c.participants),
    ...world.conflicts
      .filter((c) => c.status === 'active')
      .flatMap((c) => [...c.attackers, ...c.defenders]),
  ]);
  for (const actor of [...ranked]
    .filter((a) => crisis.has(a.nationId))
    .sort((a, b) => b.score - a.score || a.nationId.localeCompare(b.nationId))
    .slice(0, 4)) {
    if (!selected.some((a) => a.nationId === actor.nationId))
      selected.push({
        ...actor,
        background: false,
        reasons: [...actor.reasons, 'Active crisis planning priority'],
      });
  }
  const slots = Math.max(
    1,
    Math.min(
      world.scenario.rules?.aiActivity === 'quiet'
        ? 1
        : world.scenario.rules?.aiActivity === 'active'
          ? backgroundCount + 2
          : backgroundCount,
      8,
    ),
  );
  for (
    let offset = 0;
    offset < sorted.length &&
    selected.filter((s) => s.background).length < Math.min(2, slots);
    offset++
  ) {
    const candidate =
      ranked[(world.revision * Math.min(2, slots) + offset) % sorted.length];
    if (
      candidate &&
      !direct.has(candidate.nationId) &&
      !selected.some((s) => s.nationId === candidate.nationId)
    )
      selected.push({
        ...candidate,
        reasons: [...candidate.reasons, 'Guaranteed rotating planning slot'],
      });
  }
  // Regional continuity and major-power activity get dedicated rotating attention,
  // alongside the global fairness rotation. A big world must not dilute them to one visit/year.
  const attention = new Set([
    world.playerNationId,
    ...(world.scenario.neighborhoods?.find(
      (n) => n.nationId === world.playerNationId,
    )?.neighbors ?? []),
    ...(world.scenario.strategicActors ??
      [...world.nations]
        .sort(
          (a, b) =>
            b.stats.military +
              b.stats.economy -
              (a.stats.military + a.stats.economy) || a.id.localeCompare(b.id),
        )
        .slice(0, 6)
        .map((n) => n.id)),
    ...world.relations
      .filter(
        (r) =>
          [r.nationA, r.nationB].includes(world.playerNationId) &&
          Math.abs(r.score) >= 30,
      )
      .flatMap((r) => [r.nationA, r.nationB]),
    ...world.goals
      .filter(
        (g) =>
          g.nationId === world.playerNationId &&
          !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
      )
      .flatMap((g) => g.targetNationIds),
    ...world.economicLinks
      .filter(
        (l) =>
          l.dependentNationId === world.playerNationId &&
          l.imports + l.energy >= 80,
      )
      .map((l) => l.partnerNationId),
  ]);
  const continuity = ranked.filter((a) => attention.has(a.nationId));
  for (
    let offset = 0;
    offset < continuity.length &&
    selected.filter((s) => s.background).length < slots;
    offset++
  ) {
    const candidate =
      continuity[(world.revision * 2 + offset) % continuity.length]!;
    if (!selected.some((s) => s.nationId === candidate.nationId))
      selected.push({
        ...candidate,
        reasons: [
          ...candidate.reasons,
          'Regional/major-power continuity planning slot',
        ],
      });
  }
  for (const candidate of [...ranked].sort(
    (a, b) => b.score - a.score || a.nationId.localeCompare(b.nationId),
  )) {
    if (selected.filter((s) => s.background).length >= slots) break;
    if (!selected.some((s) => s.nationId === candidate.nationId))
      selected.push(candidate);
  }
  return selected;
}
