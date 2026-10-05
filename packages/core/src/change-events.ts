import { EventId } from '@mandate/schemas';
import type {
  WorldState,
  CommandEnvelope,
  TurnId,
  Event,
  ConflictId,
  NationId,
  RegionId,
  ActionId,
} from '@mandate/schemas';
export function changeEvents(
  before: Pick<
    WorldState,
    | 'initiatives'
    | 'goals'
    | 'commitments'
    | 'crises'
    | 'treaties'
    | 'tenures'
    | 'organizations'
    | 'conflicts'
    | 'regions'
    | 'date'
  >,
  after: WorldState,
  envelope: CommandEnvelope,
  turnId: TurnId,
): Event[] {
  const changes: Event[] = [];
  const beforeRegionsById = new Map(
    before.regions.map((region) => [region.id, region]),
  );
  const add = (
    title: string,
    nationIds: Event['nationIds'],
    visibility: Event['visibility'],
    type: string,
    importance = 60,
    regionIds: Event['regionIds'] = [],
    conflictIds: Event['conflictIds'] = [],
    novelty: Event['novelty'] = 'consequence',
    semanticSignature?: string,
    originatingActionId: ActionId | null = null,
    treatyIds: Event['treatyIds'] = [],
  ) =>
    changes.push({
      id: EventId.parse(
        `event:${envelope.id.slice(8)}-change-${changes.length}`,
      ),
      title: title.slice(0, 160),
      nationIds,
      visibility,
      type,
      importance,
      novelty,
      ...(semanticSignature ? { semanticSignature } : {}),
      provenance: {
        kind: 'automatic-effect',
        originatingActionId,
        triggeringActionId: null,
      },
      regionIds,
      treatyIds,
      conflictIds,
      topics: [type.toLowerCase()],
      status: 'resolved',
      effects: [],
      date: after.date,
      turnId,
      sourceCommandIds: [envelope.id],
    });
  const name = (id: string) => after.nations.find((n) => n.id === id)!.name;
  const salientImportance = (nationIds: NationId[], base: number) => {
    if (nationIds.includes(after.playerNationId)) return Math.max(base, 94);
    const strategic = new Set(after.scenario.strategicActors ?? []);
    return nationIds.some((id) => {
      const nation = after.nations.find((entry) => entry.id === id);
      return (
        strategic.has(id) ||
        Boolean(nation && nation.stats.military + nation.stats.economy >= 140)
      );
    })
      ? Math.max(base, 82)
      : base;
  };
  for (const c of after.crises) {
    const old = before.crises.find((v) => v.id === c.id);
    if (
      old &&
      ((c.status === 'resolved' && old.status !== 'resolved') ||
        Math.floor(c.severity / 20) !== Math.floor(old.severity / 20))
    )
      add(
        `${c.title}: ${c.status}, severity ${c.severity}`,
        c.participants,
        c.visibility,
        'CRISIS_DEVELOPMENT',
        c.severity >= 75 ? 82 : 65,
      );
  }
  for (const treaty of after.treaties) {
    const oldIds = new Set(
      before.treaties
        .find((entry) => entry.id === treaty.id)
        ?.breaches.map((breach) => breach.id) ?? [],
    );
    for (const breach of treaty.breaches) {
      if (oldIds.has(breach.id)) continue;
      add(
        `Treaty breach by ${name(breach.violatingNationId)}: ${breach.reason}`,
        [breach.violatingNationId, breach.injuredNationId],
        treaty.visibility,
        'TREATY_BREACH',
        82,
        [],
        [],
        'consequence',
        `treaty-breach:${breach.id}`,
        null,
        [treaty.id],
      );
    }
  }
  for (const t of after.tenures) {
    const old = before.tenures.find((v) => v.id === t.id);
    if (old && t.outcomes.length !== old.outcomes.length)
      add(
        `${name(t.nationId)} election: ${t.incumbent} ${t.outcomes.at(-1)?.incumbentRetained ? 'retained' : 'takes office'}`,
        [t.nationId],
        'public',
        'ELECTION_OUTCOME',
      );
  }
  for (const i of after.initiatives)
    if (
      i.status === 'completed' &&
      before.initiatives.find((old) => old.id === i.id)?.status === 'active'
    )
      add(
        `${name(i.nationId)} completes ${i.name}`,
        [i.nationId],
        i.visibility,
        'PROJECT_COMPLETED',
      );
  for (const c of after.commitments) {
    const old = before.commitments.find((o) => o.id === c.id);
    if (old && old.status !== c.status)
      add(
        `${name(c.issuer)}: ${c.status} ${c.type} obligation`,
        [c.issuer, ...c.recipients],
        c.visibility,
        'COMMITMENT_' + c.status.toUpperCase(),
      );
    else if (
      c.status === 'active' &&
      c.dueDate &&
      Date.parse(before.date) < Date.parse(c.dueDate) - 30 * 86400000 &&
      Date.parse(after.date) >= Date.parse(c.dueDate) - 30 * 86400000
    )
      add(
        `${name(c.issuer)}: ${c.type} obligation due ${c.dueDate}`,
        [c.issuer, ...c.recipients],
        c.visibility,
        'COMMITMENT_DUE',
      );
  }
  for (const g of after.goals)
    if (
      ['achieved', 'failed'].includes(g.status) &&
      before.goals.find((old) => old.id === g.id)?.status !== g.status
    )
      add(
        `${name(g.nationId)}: ${g.status} goal ${g.title}`,
        [g.nationId],
        g.visibility,
        'GOAL_' + g.status.toUpperCase(),
      );
  for (const organization of after.organizations) {
    const oldIds = new Set(
      before.organizations
        .find((entry) => entry.id === organization.id)
        ?.history.map((entry) => entry.id) ?? [],
    );
    for (const entry of organization.history) {
      if (
        oldIds.has(entry.id) ||
        ![
          'commitment-payment-started',
          'commitment-payment-milestone',
          'commitment-breached',
          'development-milestone',
          'program-approved',
          'program-response',
          'program-rejected',
          'program-milestone',
          'program-suspended',
          'program-resumed',
        ].includes(entry.kind)
      )
        continue;
      const milestone =
        entry.kind === 'development-milestone' ||
        entry.kind === 'program-milestone' ||
        entry.kind === 'program-approved' ||
        entry.kind === 'commitment-payment-started' ||
        entry.kind === 'commitment-payment-milestone';
      const milestoneState =
        entry.kind === 'commitment-payment-milestone'
          ? `payment-${entry.paymentMilestone ?? /passes\s+(\d+)/i.exec(entry.description)?.[1] ?? 'unknown'}`
          : entry.kind === 'program-milestone'
            ? `program-${entry.programMilestone ?? /reaches\s+(\d+)%/i.exec(entry.description)?.[1] ?? (/construction begins/i.test(entry.description) ? 'construction' : /enters operation/i.test(entry.description) ? 'operational' : 'unknown')}`
            : entry.kind === 'development-milestone'
              ? `development-${entry.developmentDimension ?? 'unknown'}-${entry.developmentLevel ?? 'unknown'}`
              : '';
      const organizationSignature = [
        'organization',
        organization.id,
        entry.kind,
        entry.organizationCommitmentId ?? '',
        entry.organizationProgramId ?? '',
        entry.actorNationId ?? 'system',
        milestoneState,
        [...organization.members].sort().join(','),
      ].join(':');
      add(
        entry.description,
        [
          ...new Set([
            ...(entry.actorNationId ? [entry.actorNationId] : []),
            ...organization.members,
          ]),
        ],
        organization.visibility,
        entry.kind === 'commitment-breached'
          ? 'ORGANIZATION_COMMITMENT_BREACHED'
          : entry.kind.startsWith('commitment-')
            ? 'ORGANIZATION_COMMITMENT_MILESTONE'
            : entry.kind.startsWith('development-')
              ? 'ORGANIZATION_DEVELOPMENT_MILESTONE'
              : entry.kind === 'program-response'
                ? 'ORGANIZATION_PROGRAM_RESPONSE'
                : entry.kind === 'program-approved'
                  ? 'ORGANIZATION_PROGRAM_APPROVED'
                  : entry.kind === 'program-rejected'
                    ? 'ORGANIZATION_PROGRAM_REJECTED'
                    : entry.kind === 'program-milestone'
                      ? 'ORGANIZATION_PROGRAM_MILESTONE'
                      : 'ORGANIZATION_PROGRAM_STATUS',
        entry.kind === 'commitment-breached'
          ? 76
          : entry.kind === 'program-response'
            ? / rejects | counters /.test(entry.description)
              ? 66
              : 44
            : entry.kind === 'program-rejected'
              ? 68
              : milestone
                ? 72
                : 55,
        [],
        [],
        milestone ? 'milestone' : 'consequence',
        organizationSignature,
        entry.originatingActionId ?? null,
      );
    }
  }

  if (envelope.command.type === 'ADVANCE_DATE') {
    const outcomes: Array<{
      date: string;
      conflictId: ConflictId;
      theaterId: string;
      actor: NationId;
      outcome: string;
      regionId: RegionId | null;
      note: string;
    }> = [];
    for (const conflict of after.conflicts) {
      const oldConflict = before.conflicts.find(
        (entry) => entry.id === conflict.id,
      );
      for (const theater of conflict.theaters) {
        const oldTheater = oldConflict?.theaters.find(
          (entry) => entry.id === theater.id,
        );
        const oldOutcomes = oldTheater?.recentOutcomes ?? [];
        const oldSignatures = new Set(
          oldOutcomes.map((entry) =>
            [entry.date, entry.outcome, entry.regionId, entry.note].join('|'),
          ),
        );
        for (const outcome of theater.recentOutcomes)
          if (
            outcome.date > before.date &&
            !oldSignatures.has(
              [
                outcome.date,
                outcome.outcome,
                outcome.regionId,
                outcome.note,
              ].join('|'),
            )
          )
            outcomes.push({
              date: outcome.date,
              conflictId: conflict.id,
              theaterId: theater.id,
              actor: theater.nationId,
              outcome: outcome.outcome,
              regionId: outcome.regionId,
              note: outcome.note,
            });
      }
    }
    const groups = new Map<string, typeof outcomes>();
    for (const outcome of outcomes) {
      const key = `${outcome.date}|${outcome.conflictId}|${outcome.outcome}|${outcome.actor}`;
      groups.set(key, [...(groups.get(key) ?? []), outcome]);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      const conflict = after.conflicts.find(
        (entry) => entry.id === first.conflictId,
      )!;
      const regions = group
        .flatMap((entry) => (entry.regionId ? [entry.regionId] : []))
        .map((id) => after.regions.find((entry) => entry.id === id)!)
        .filter(Boolean);
      const actorId = first.actor;
      const actorName = name(actorId);
      const opponentIds = conflict.attackers.includes(actorId)
        ? conflict.defenders
        : conflict.attackers;
      const opponent = opponentIds.map(name).join(' and ');
      const place = regions.length
        ? regions
            .slice(0, 2)
            .map((region) => region.name)
            .join(' and ') +
          (regions.length > 2 ? ` and ${regions.length - 2} other regions` : '')
        : conflict.name;
      const isWithdrawal = first.outcome === 'strategic-withdrawal';
      const newControllerIds = [
        ...new Set(
          regions.map((region) =>
            isWithdrawal ? region.ownerNationId : region.controllerNationId,
          ),
        ),
      ];
      const nationIds = [
        ...new Set([actorId, ...opponentIds, ...newControllerIds]),
      ];
      const title =
        first.outcome === 'major-advance'
          ? `${actorName} makes a major advance into ${place}`
          : first.outcome === 'limited-advance'
            ? `${actorName} forces occupy ${place}`
            : first.outcome === 'counterattack'
              ? `${actorName} counterattacks and retakes ${place}`
              : first.outcome === 'strategic-withdrawal'
                ? `${newControllerIds.map(name).join(' and ')} regain control of ${place} after ${actorName}'s withdrawal`
                : first.outcome === 'failed-offensive'
                  ? `${actorName} offensive is repelled by ${opponent}`
                  : `${actorName} offensive stalls against ${opponent}`;
      const baseImportance =
        first.outcome === 'major-advance' ||
        first.outcome === 'counterattack' ||
        first.outcome === 'strategic-withdrawal'
          ? 78
          : first.outcome === 'limited-advance'
            ? 72
            : 42;
      add(
        title,
        [
          ...new Set(
            first.outcome === 'strategic-withdrawal'
              ? [...newControllerIds, actorId, ...opponentIds]
              : [actorId, ...opponentIds],
          ),
        ],
        'public',
        `WAR_${first.outcome.replaceAll('-', '_').toUpperCase()}`,
        salientImportance(nationIds, baseImportance),
        regions.map((region) => region.id),
        [conflict.id],
      );
    }
  }

  const changedControl = after.regions.filter((region) => {
    const old = beforeRegionsById.get(region.id);
    return old && old.controllerNationId !== region.controllerNationId;
  });
  const newlyRecognizedClaims = after.regions.flatMap((region) => {
    const previous = beforeRegionsById.get(region.id);
    return region.recognizedClaims
      .filter((claim) => !previous?.recognizedClaims.includes(claim))
      .map((claim) => ({ region, claim }));
  });
  for (const { region, claim } of newlyRecognizedClaims)
    add(
      `${name(region.ownerNationId)} recognizes ${name(claim)}'s claim to ${region.name}`,
      [region.ownerNationId, claim],
      'public',
      'CLAIM_RECOGNIZED',
      salientImportance([region.ownerNationId, claim], 76),
      [region.id],
    );
  const acceptedPeaceNegotiationId =
    envelope.command.type === 'RESPOND_NEGOTIATION' &&
    envelope.command.move === 'accept'
      ? envelope.command.negotiationId
      : null;
  if (
    after.negotiations.find((entry) => entry.id === acceptedPeaceNegotiationId)
      ?.kind === 'peace' &&
    acceptedPeaceNegotiationId !== null &&
    changedControl.length
  ) {
    const negotiation = after.negotiations.find(
      (entry) => entry.id === acceptedPeaceNegotiationId,
    )!;
    const conflictId = negotiation.conflictId;
    const groups = new Map<string, typeof changedControl>();
    for (const region of changedControl) {
      const ownerChanged =
        beforeRegionsById.get(region.id)?.ownerNationId !==
        region.ownerNationId;
      const key = `${ownerChanged ? 'ownership' : 'control'}|${region.ownerNationId}`;
      groups.set(key, [...(groups.get(key) ?? []), region]);
    }
    for (const [key, regions] of groups) {
      const [kind] = key.split('|');
      const recipient = regions[0]!.ownerNationId;
      const names = regions
        .slice(0, 3)
        .map((region) => region.name)
        .join(', ');
      add(
        kind === 'ownership'
          ? `${name(recipient!)} receives legal ownership of ${names}${regions.length > 3 ? ` and ${regions.length - 3} other regions` : ''} under peace terms`
          : `${name(recipient!)} regains military control of ${names}${regions.length > 3 ? ` and ${regions.length - 3} other regions` : ''} under peace terms`,
        [
          ...new Set([
            recipient,
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ]),
        ],
        'public',
        kind === 'ownership'
          ? 'TERRITORY_CEDED'
          : 'OCCUPIED_TERRITORY_RETURNED',
        salientImportance(
          [
            recipient,
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ],
          82,
        ),
        regions.map((region) => region.id),
        conflictId ? [conflictId] : [],
      );
    }
  }

  return changes.sort(
    (a, b) =>
      Number(b.nationIds.includes(after.playerNationId)) -
        Number(a.nationIds.includes(after.playerNationId)) ||
      b.importance - a.importance,
  );
}
