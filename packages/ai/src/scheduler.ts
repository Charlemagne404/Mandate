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
      for (const party of ids) {
        const neighbors =
          world.scenario.neighborhoods?.find(
            (entry) => entry.nationId === party,
          )?.neighbors ?? [];
        for (const neighbor of neighbors) {
          const relation = world.relations.find(
            (entry) =>
              [entry.nationA, entry.nationB].includes(party) &&
              [entry.nationA, entry.nationB].includes(neighbor),
          );
          const defenseAlly = world.treaties.some(
            (treaty) =>
              treaty.status === 'active' &&
              treaty.kind === 'defense' &&
              treaty.parties.includes(party) &&
              treaty.parties.includes(neighbor),
          );
          if (defenseAlly || (relation?.tension ?? 0) >= 45)
            secondary.add(neighbor);
        }
      }
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
  backgroundCount = 4,
): ActorActivation[] {
  const sorted = [...world.nations].sort((a, b) => a.id.localeCompare(b.id));
  const direct = new Set([
    ...relevance.directNationIds,
    ...relevance.secondaryNationIds,
  ]);
  const pendingDiplomacy = new Set(
    world.negotiations
      .filter((entry) => entry.status === 'open')
      .map((entry) => entry.recipientNationId),
  );
  const pendingInvitation = new Set(
    world.organizations.flatMap((organization) =>
      organization.status === 'active'
        ? organization.invitations
            .filter(
              (invitation) =>
                invitation.status === 'pending' &&
                invitation.lastMove !== 'counter',
            )
            .map((invitation) => invitation.nationId)
        : [],
    ),
  );
  const severeSanctions = new Set(
    world.sanctions
      .filter((entry) => entry.status === 'active' && entry.intensity >= 60)
      .flatMap((entry) => [entry.issuer, entry.target]),
  );
  const brokenPromises = new Set(
    world.commitments
      .filter(
        (entry) =>
          entry.status === 'breached' &&
          Date.parse(world.date) -
            Date.parse(entry.history.at(-1)?.date ?? world.date) <
            180 * 86400000,
      )
      .flatMap((entry) => [entry.issuer, ...entry.recipients]),
  );
  const stalledGoals = new Set(
    world.goals
      .filter(
        (entry) =>
          ['stalled', 'threatened', 'blocked'].includes(entry.status) &&
          entry.priority >= 55,
      )
      .map((entry) => entry.nationId),
  );
  const recentGovernmentChanges = new Set(
    world.events
      .filter(
        (event) =>
          ['UPDATE_GOVERNMENT', 'UPDATE_LEADER', 'ELECTION_OUTCOME'].includes(
            event.type,
          ) && Date.parse(world.date) - Date.parse(event.date) < 180 * 86400000,
      )
      .flatMap((event) => event.nationIds),
  );
  const recentWarDevelopments = new Set(
    world.events
      .filter(
        (event) =>
          (event.type.startsWith('WAR_') ||
            event.type === 'TERRITORY_CEDED' ||
            event.type === 'OCCUPIED_TERRITORY_RETURNED') &&
          Date.parse(world.date) - Date.parse(event.date) < 180 * 86400000,
      )
      .flatMap((event) => event.nationIds),
  );
  const recentSalientActors = new Set(
    world.events
      .filter(
        (event) =>
          event.importance >= 75 &&
          Date.parse(world.date) - Date.parse(event.date) < 120 * 86400000,
      )
      .flatMap((event) => event.nationIds),
  );
  const secondOrderReactions = new Set<NationId>();
  for (const actor of recentSalientActors) {
    const neighbors =
      world.scenario.neighborhoods?.find((entry) => entry.nationId === actor)
        ?.neighbors ?? [];
    for (const neighbor of neighbors) {
      const relation = world.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(neighbor),
      );
      const defenseAlly = world.treaties.some(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'defense' &&
          treaty.parties.includes(actor) &&
          treaty.parties.includes(neighbor),
      );
      if (
        defenseAlly ||
        (relation?.tension ?? 0) >= 35 ||
        (relation?.score ?? 0) <= -35
      )
        secondOrderReactions.add(neighbor);
    }
    for (const organization of world.organizations)
      if (
        organization.status === 'active' &&
        organization.members.includes(actor)
      )
        organization.members
          .filter((member) => member !== actor)
          .slice(0, 6)
          .forEach((member) => secondOrderReactions.add(member));
  }
  const importantPowers = new Set(
    world.scenario.strategicActors ??
      [...world.nations]
        .sort(
          (a, b) =>
            b.stats.military +
              b.stats.economy -
              (a.stats.military + a.stats.economy) || a.id.localeCompare(b.id),
        )
        .slice(0, 8)
        .map((entry) => entry.id),
  );
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
        wars.length * 50 +
        (pendingDiplomacy.has(n.id) ? 125 : 0) +
        (pendingInvitation.has(n.id) ? 105 : 0) +
        (severeSanctions.has(n.id) ? 90 : 0) +
        (brokenPromises.has(n.id) ? 85 : 0) +
        (stalledGoals.has(n.id) ? 60 : 0) +
        (recentGovernmentChanges.has(n.id) ? 70 : 0) +
        (recentWarDevelopments.has(n.id) ? 45 : 0) +
        (secondOrderReactions.has(n.id) ? 40 : 0) +
        (recentSalientActors.has(n.id) ? 35 : 0) +
        (importantPowers.has(n.id) ? 25 : 0) +
        (100 - n.stats.stability) / 5 +
        (recent ? 0 : 10),
      reasons: [
        ...(goals.length ? ['Unresolved strategic goals'] : []),
        ...(wars.length ? ['Active conflict'] : []),
        ...(pendingDiplomacy.has(n.id) ? ['Pending diplomatic proposal'] : []),
        ...(pendingInvitation.has(n.id)
          ? ['Organization membership decision']
          : []),
        ...(severeSanctions.has(n.id) ? ['Severe sanction pressure'] : []),
        ...(brokenPromises.has(n.id)
          ? ['Broken commitment needs a response']
          : []),
        ...(stalledGoals.has(n.id) ? ['Stalled strategic goal'] : []),
        ...(recentGovernmentChanges.has(n.id)
          ? ['Recent government change']
          : []),
        ...(recentWarDevelopments.has(n.id)
          ? ['Recent territorial or war development']
          : []),
        ...(secondOrderReactions.has(n.id)
          ? ['Relevant second-order reaction']
          : []),
        ...(recentSalientActors.has(n.id)
          ? ['Recent high-salience action']
          : []),
        ...(importantPowers.has(n.id)
          ? ['High capability and global reach']
          : []),
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
    ...pendingDiplomacy,
    ...pendingInvitation,
    ...severeSanctions,
    ...brokenPromises,
    ...stalledGoals,
    ...recentGovernmentChanges,
    ...secondOrderReactions,
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
    selected.filter((s) => s.background).length <
      Math.min(backgroundCount, slots);
    offset++
  ) {
    const candidate =
      ranked[
        (world.revision * Math.min(backgroundCount, slots) + offset) %
          sorted.length
      ];
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
