import type {
  Event,
  EventId,
  NationId,
  RegionId,
  WorldState,
  Nation,
} from '@mandate/schemas';

export interface HistoricalSummary {
  version: 1;
  id: string;
  perspectiveNationId: NationId;
  fromRevision: number;
  toRevision: number;
  sourceEventIds: EventId[];
  text: string;
}
const publicStats = new Set([
  'economy',
  'military',
  'stability',
  'legitimacy',
  'industrial',
  'technology',
  'influence',
]);
export interface ContextBundle {
  templateVersion: string;
  simulationDate: WorldState['date'];
  revision: number;
  perspectiveNationId: NationId;
  nationIds: NationId[];
  regionIds: RegionId[];
  exactEventIds: EventId[];
  summaryIds: string[];
  canonical: {
    nations: Array<Omit<Nation, 'stats'> & { stats: Partial<Nation['stats']> }>;
    regions: WorldState['regions'];
    relations: WorldState['relations'];
    treaties: WorldState['treaties'];
    conflicts: WorldState['conflicts'];
    goals: WorldState['goals'];
    initiatives: unknown[];
    negotiations: WorldState['negotiations'];
    commitments: WorldState['commitments'];
    knowledge: WorldState['knowledge'];
    crises: WorldState['crises'];
    economicLinks: WorldState['economicLinks'];
    sanctions: WorldState['sanctions'];
    conferences: WorldState['conferences'];
    tenures: WorldState['tenures'];
    organizations: WorldState['organizations'];
  };
  retrieval: {
    recentEventIds: EventId[];
    historicalEventIds: EventId[];
    includedCommitmentIds: string[];
    includedGoalIds: string[];
    includedNegotiationIds: string[];
    excludedEventIds: EventId[];
    excludedEventCount: number;
    excludedBecauseOfBudget: EventId[];
    characters: number;
  };
  recentEvents: Event[];
  summaries: HistoricalSummary[];
}
/** Private knowledge follows participants, never the actor selected by the UI. */
export function visibleTo(
  entry: {
    visibility?: string | undefined;
    nationIds?: NationId[];
    nationId?: NationId;
    proposerNationId?: NationId;
    recipientNationId?: NationId;
    parties?: NationId[];
    issuer?: NationId;
    recipients?: NationId[];
    participants?: NationId[];
    members?: NationId[];
  },
  perspective: NationId,
): boolean {
  return (
    entry.visibility === undefined ||
    entry.visibility === 'public' ||
    entry.nationIds?.includes(perspective) === true ||
    entry.nationId === perspective ||
    entry.proposerNationId === perspective ||
    entry.recipientNationId === perspective ||
    entry.parties?.includes(perspective) === true ||
    entry.participants?.includes(perspective) === true ||
    entry.members?.includes(perspective) === true ||
    entry.issuer === perspective ||
    entry.recipients?.includes(perspective) === true
  );
}
export function buildContext(
  world: WorldState,
  perspective: NationId,
  relevant: NationId[],
  options: {
    recentLimit?: number;
    historicalLimit?: number;
    eventBudget?: number;
    summaries?: HistoricalSummary[];
    topics?: string[];
  } = {},
): ContextBundle {
  if (!world.nations.some((n) => n.id === perspective))
    throw new Error('Unknown context perspective');
  const knownTo = (
    entry: Parameters<typeof visibleTo>[0] & { id?: string },
    subject:
      | 'event'
      | 'negotiation'
      | 'treaty'
      | 'conference'
      | 'crisis'
      | 'organization',
  ) =>
    visibleTo(entry, perspective) ||
    world.knowledge.some(
      (k) =>
        k.recipient === perspective &&
        k.confidence === 'confirmed' &&
        k.subject.kind === subject &&
        k.subject.id === entry.id,
    );
  const ids = new Set([perspective, ...relevant]);
  (
    world.scenario.neighborhoods?.find((n) => n.nationId === perspective)
      ?.neighbors ?? []
  )
    .slice(0, 6)
    .forEach((id) => ids.add(id));
  world.conflicts
    .filter(
      (c) =>
        c.status === 'active' &&
        [...c.attackers, ...c.defenders].includes(perspective),
    )
    .forEach((c) =>
      [...c.attackers, ...c.defenders].forEach((id) => ids.add(id)),
    );
  world.goals
    .filter(
      (g) =>
        g.nationId === perspective &&
        !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
    )
    .forEach((g) => g.targetNationIds.forEach((id) => ids.add(id)));
  world.commitments
    .filter(
      (c) =>
        c.status === 'active' &&
        (c.issuer === perspective || c.recipients.includes(perspective)),
    )
    .forEach((c) => [c.issuer, ...c.recipients].forEach((id) => ids.add(id)));
  world.negotiations
    .filter(
      (n) =>
        n.status === 'open' &&
        [n.proposerNationId, n.recipientNationId].includes(perspective),
    )
    .forEach((n) =>
      [n.proposerNationId, n.recipientNationId].forEach((id) => ids.add(id)),
    );
  world.relations
    .filter((r) => [r.nationA, r.nationB].includes(perspective))
    .sort(
      (a, b) =>
        Math.abs(b.score) +
          b.tradeDependence -
          (Math.abs(a.score) + a.tradeDependence) ||
        a.nationA.localeCompare(b.nationA),
    )
    .slice(0, 4)
    .forEach((r) => {
      ids.add(r.nationA);
      ids.add(r.nationB);
    });
  world.crises
    .filter(
      (c) => c.status !== 'resolved' && c.participants.includes(perspective),
    )
    .forEach((c) => c.participants.forEach((id) => ids.add(id)));
  world.conferences
    .filter((c) => c.status === 'open' && c.parties.includes(perspective))
    .forEach((c) => c.parties.forEach((id) => ids.add(id)));
  world.economicLinks
    .filter((l) => l.dependentNationId === perspective)
    .sort((a, b) => b.imports + b.energy - a.imports - a.energy)
    .slice(0, 4)
    .forEach((l) => ids.add(l.partnerNationId));
  for (const k of world.knowledge.filter(
    (k) => k.recipient === perspective && k.confidence === 'confirmed',
  )) {
    if (k.subject.kind === 'event')
      world.events
        .find((e) => e.id === k.subject.id)
        ?.nationIds.forEach((id) => ids.add(id));
    if (k.subject.kind === 'negotiation') {
      const n = world.negotiations.find((n) => n.id === k.subject.id);
      if (n) {
        ids.add(n.proposerNationId);
        ids.add(n.recipientNationId);
      }
    }
    if (k.subject.kind === 'crisis')
      world.crises
        .find((c) => c.id === k.subject.id)
        ?.participants.forEach((id) => ids.add(id));
    if (k.subject.kind === 'conference')
      world.conferences
        .find((c) => c.id === k.subject.id)
        ?.parties.forEach((id) => ids.add(id));
  }
  const nations = world.nations
    .filter((n) => ids.has(n.id))
    .map((n) =>
      n.id === perspective
        ? n
        : {
            ...n,
            strategy: {
              ...n.strategy,
              directives: n.strategy.directives.filter(
                (d) => d.visibility === 'public',
              ),
              redLines: [],
            },
            stats: {
              economy: n.stats.economy,
              military: n.stats.military,
              stability: n.stats.stability,
              legitimacy: n.stats.legitimacy,
              industrial: n.stats.industrial,
              technology: n.stats.technology,
              influence: n.stats.influence,
            },
          },
    );
  const regions = world.regions.filter(
    (r) => ids.has(r.ownerNationId) || ids.has(r.controllerNationId),
  );
  const visible = world.events.filter(
    (e) => knownTo(e, 'event') && e.nationIds.some((id) => ids.has(id)),
  );
  const recent = visible.slice(
    -Math.max(1, Math.min(options.recentLimit ?? 24, 100)),
  );
  const topicWords = (options.topics ?? [])
    .join(' ')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3);
  const importance = (e: Event) =>
    e.importance +
    (e.type === 'RESPOND_NEGOTIATION' ? 60 : 0) +
    (e.status === 'unresolved' ? 50 : 0) +
    topicWords.filter((word) =>
      (e.title + e.topics.join(' ')).toLowerCase().includes(word),
    ).length *
      12;
  const historical = visible
    .filter((e) => !recent.includes(e) && importance(e) >= 60)
    .sort(
      (a, b) =>
        importance(b) - importance(a) ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, options.historicalLimit ?? 8);
  let characters = 0;
  const excludedBecauseOfBudget: EventId[] = [];
  const recentEvents = [...recent]
    .reverse()
    .concat(historical)
    .filter((e) => {
      const size = JSON.stringify(e).length;
      if (characters + size > (options.eventBudget ?? 16000)) {
        excludedBecauseOfBudget.push(e.id);
        return false;
      }
      characters += size;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((event) => ({
      ...event,
      effects: event.effects.filter(
        (effect) =>
          effect.nationId === perspective || publicStats.has(effect.stat),
      ),
    }));
  const extra = world as WorldState & {
    initiatives?: Array<{ nationId: NationId; visibility: string }>;
    negotiations?: Array<{
      proposerNationId: NationId;
      recipientNationId: NationId;
      visibility: string;
    }>;
  };
  const summaries = (options.summaries ?? [])
    .filter(
      (s) =>
        s.perspectiveNationId === perspective &&
        s.toRevision <= world.revision &&
        s.sourceEventIds.every((id) =>
          world.events.some((e) => e.id === id && knownTo(e, 'event')),
        ),
    )
    .slice(-6);
  return {
    templateVersion: 'context-v3',
    simulationDate: world.date,
    revision: world.revision,
    perspectiveNationId: perspective,
    nationIds: nations.map((n) => n.id),
    regionIds: regions.map((r) => r.id),
    exactEventIds: recentEvents.map((e) => e.id),
    summaryIds: summaries.map((s) => s.id),
    canonical: {
      knowledge: world.knowledge.filter(
        (k) => k.recipient === perspective || k.issuer === perspective,
      ),
      crises: world.crises.filter(
        (c) => knownTo(c, 'crisis') && c.participants.some((id) => ids.has(id)),
      ),
      economicLinks: world.economicLinks.filter(
        (l) => ids.has(l.dependentNationId) && ids.has(l.partnerNationId),
      ),
      sanctions: world.sanctions.filter(
        (s) => ids.has(s.issuer) || ids.has(s.target),
      ),
      conferences: world.conferences.filter(
        (c) => knownTo(c, 'conference') && c.parties.some((id) => ids.has(id)),
      ),
      tenures: world.tenures.filter((t) => t.nationId === perspective),
      organizations: world.organizations.filter(
        (o) =>
          knownTo(o, 'organization') && o.members.some((id) => ids.has(id)),
      ),
      commitments: world.commitments.filter(
        (c) =>
          visibleTo(c, perspective) &&
          (ids.has(c.issuer) || c.recipients.some((id) => ids.has(id))),
      ),
      nations,
      regions,
      relations: world.relations
        .filter((r) => ids.has(r.nationA) && ids.has(r.nationB))
        .map((r) => ({
          ...r,
          factors: r.factors.filter(
            (f) =>
              f.visibility === 'public' ||
              [r.nationA, r.nationB].includes(perspective),
          ),
          grievances: [r.nationA, r.nationB].includes(perspective)
            ? r.grievances
            : [],
        })),
      treaties: world.treaties.filter(
        (t) => t.parties.some((id) => ids.has(id)) && knownTo(t, 'treaty'),
      ),
      conflicts: world.conflicts.filter((c) =>
        [...c.attackers, ...c.defenders].some((id) => ids.has(id)),
      ),
      goals: world.goals.filter(
        (g) =>
          ids.has(g.nationId) &&
          (g.nationId === perspective || g.visibility === 'public'),
      ),
      initiatives: (extra.initiatives ?? [])
        .filter((i) => ids.has(i.nationId) && visibleTo(i, perspective))
        .filter((i) => !('status' in i) || i.status === 'active'),
      negotiations: world.negotiations.filter(
        (n) =>
          (ids.has(n.proposerNationId) || ids.has(n.recipientNationId)) &&
          knownTo(n, 'negotiation'),
      ),
    },
    retrieval: {
      recentEventIds: recent
        .filter((e) => recentEvents.some((r) => r.id === e.id))
        .map((e) => e.id),
      historicalEventIds: historical
        .filter((e) => recentEvents.some((r) => r.id === e.id))
        .map((e) => e.id),
      includedCommitmentIds: world.commitments
        .filter(
          (c) =>
            visibleTo(c, perspective) &&
            (ids.has(c.issuer) || c.recipients.some((id) => ids.has(id))),
        )
        .map((c) => c.id),
      includedGoalIds: world.goals
        .filter((g) => ids.has(g.nationId) && visibleTo(g, perspective))
        .map((g) => g.id),
      includedNegotiationIds: world.negotiations
        .filter(
          (n) =>
            knownTo(n, 'negotiation') &&
            (ids.has(n.proposerNationId) || ids.has(n.recipientNationId)),
        )
        .map((n) => n.id),
      excludedEventCount: visible.filter(
        (e) => !recentEvents.some((r) => r.id === e.id),
      ).length,
      excludedEventIds: visible
        .filter((e) => !recentEvents.some((r) => r.id === e.id))
        .slice(-100)
        .map((e) => e.id),
      excludedBecauseOfBudget,
      characters,
    },
    recentEvents,
    summaries,
  };
}
/** Summaries are factual retrieval hints; live structured state remains authoritative. */
export function summarizeHistory(
  world: WorldState,
  perspective: NationId,
  limit = 30,
): HistoricalSummary {
  const events = world.events
    .filter(
      (e) => visibleTo(e, perspective) && e.nationIds.includes(perspective),
    )
    .slice(-limit);
  return {
    version: 1,
    id: `summary:${perspective.slice(7)}-${world.revision}`,
    perspectiveNationId: perspective,
    fromRevision: events.length
      ? (world.turns.find((t) => t.id === events[0]?.turnId)?.revision ?? 0)
      : world.revision,
    toRevision: world.revision,
    sourceEventIds: events.map((e) => e.id),
    text:
      events.map((e) => `${e.date}: ${e.title} [${e.id}]`).join('\n') ||
      'No recorded developments in this perspective.',
  };
}
