import type { WorldState, NationId } from '@mandate/schemas';
import { requireDomain } from './errors.js';
import { knowsInformation } from './knowledge.js';

export const advisorQuestions = [
  'commitments',
  'threats',
  'stalled-goals',
  'refusals',
  'dependencies',
  'escalation',
  'project-load',
  'recent-world',
] as const;
export type AdvisorQuestion = (typeof advisorQuestions)[number];
/** Canonical answers only. A lack of evidence is explicit, never filled with invented motives. */
export function strategicAnswer(
  w: WorldState,
  perspective: NationId,
  question: AdvisorQuestion,
) {
  const name = (id: NationId) => w.nations.find((n) => n.id === id)!.name;
  const own = w.nations.find((n) => n.id === perspective)!;
  let facts: string[] = [];
  switch (question) {
    case 'commitments':
      facts = worldBriefing(w, perspective).commitments;
      break;
    case 'threats':
      facts = w.relations
        .filter(
          (r) =>
            [r.nationA, r.nationB].includes(perspective) &&
            (r.tension >= 60 || r.score <= -40),
        )
        .map(
          (r) =>
            `${name(r.nationA === perspective ? r.nationB : r.nationA)}: relations ${r.score}, tension ${r.tension}. These are hostility indicators; private intentions are not known.`,
        );
      break;
    case 'stalled-goals':
      facts = w.goals
        .filter(
          (g) =>
            g.nationId === perspective &&
            ['stalled', 'blocked', 'threatened'].includes(g.status),
        )
        .map(
          (g) =>
            `${g.title}: ${g.progress}%, pressure ${g.pressure}; ${g.blockers.join('; ') || 'No measurable progress'}; ${g.strategyReview ?? 'Consider a different approach'}`,
        );
      break;
    case 'refusals':
      facts = w.negotiations
        .filter((n) =>
          knowsInformation(w, perspective, { kind: 'negotiation', id: n.id }),
        )
        .flatMap((n) =>
          n.responses
            .filter((r) =>
              ['reject', 'counter', 'delay', 'ignore'].includes(r.move),
            )
            .slice(-2)
            .map(
              (r) =>
                `${name(r.nationId)} / ${n.topic}: ${r.move}; stated reason: ${r.message}`,
            ),
        )
        .slice(-12);
      break;
    case 'dependencies':
      facts = w.economicLinks
        .filter((l) => l.partnerNationId === perspective)
        .sort((a, b) => b.imports - a.imports)
        .slice(0, 12)
        .map(
          (l) =>
            `${name(l.dependentNationId)}: imports ${l.imports}, energy ${l.energy}, strategic exposure ${l.strategicGoods}, alternative partners ${l.alternatives}. These are scenario indices, not trade volumes.`,
        );
      break;
    case 'escalation':
      facts = w.crises
        .filter(
          (c) =>
            c.status !== 'resolved' &&
            knowsInformation(w, perspective, { kind: 'crisis', id: c.id }),
        )
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 8)
        .map(
          (c) =>
            `${c.title}: ${c.status}, severity ${c.severity}; military posture ${c.militaryPosture}, diplomatic breakdown ${c.diplomaticBreakdown}${c.deadline ? `, deadline ${c.deadline}` : ''}.`,
        );
      break;
    case 'project-load': {
      const capacity = Math.max(
        1,
        Math.floor(
          (own.stats.fiscal + own.stats.industrial + own.stats.stability) / 30,
        ),
      );
      const projects = w.initiatives.filter(
        (i) => i.nationId === perspective && i.status === 'active',
      );
      facts = [
        `Treasury ${own.stats.treasury}; execution capacity ${capacity}; active project effort ${projects.reduce((s, i) => s + i.effort, 0)}.`,
        ...projects.map(
          (i) =>
            `${i.name}: effort ${i.effort}, ${i.progress}% complete${i.blocker ? `; ${i.blocker}` : ''}`,
        ),
      ];
      break;
    }
    case 'recent-world': {
      const since = w.turns.at(-5)?.date ?? w.scenario.startDate;
      facts = w.events
        .filter(
          (e) =>
            e.date >= since &&
            e.importance >= 60 &&
            knowsInformation(w, perspective, { kind: 'event', id: e.id }),
        )
        .slice(-15)
        .map((e) => `${e.date}: ${e.title}`);
      break;
    }
  }
  return {
    question,
    date: w.date,
    source: 'canonical' as const,
    facts: facts.length
      ? facts
      : ['No supporting known facts are recorded for this question.'],
  };
}

export function worldBriefing(w: WorldState, perspective: NationId) {
  const own = w.nations.find((n) => n.id === perspective)!;
  const visible = (v: {
    visibility?: string | undefined;
    parties?: NationId[];
    participants?: NationId[];
  }) =>
    v.visibility !== 'private' ||
    v.parties?.includes(perspective) ||
    v.participants?.includes(perspective);
  const goals = w.goals.filter(
    (g) =>
      g.nationId === perspective &&
      !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
  );
  const wars = w.conflicts.filter(
    (c) =>
      c.status === 'active' &&
      [...c.attackers, ...c.defenders].includes(perspective),
  );
  return {
    domestic: [
      `Legitimacy ${own.stats.legitimacy}; stability ${own.stats.stability}; unrest ${own.stats.unrest}`,
      ...w.tenures
        .filter((t) => t.nationId === perspective)
        .map(
          (t) =>
            `Election due ${t.nextElectionDate}; issues: ${t.issues.join(', ')}`,
        ),
    ],
    diplomacy: w.negotiations
      .filter(
        (n) =>
          n.status === 'open' &&
          [n.proposerNationId, n.recipientNationId].includes(perspective),
      )
      .map(
        (n) =>
          `${n.topic}: ${n.responses.at(-1)?.move ?? 'pending'}, expires ${n.expiresDate}`,
      ),
    security: [
      ...wars.map(
        (c) => `${c.name}: ${c.settlementState}, exhaustion ${c.exhaustion}`,
      ),
      ...w.crises
        .filter(
          (c) =>
            c.status !== 'resolved' &&
            visible(c) &&
            c.participants.includes(perspective),
        )
        .map((c) => `${c.title}: ${c.status}, severity ${c.severity}`),
    ],
    economy: [
      ...w.economicLinks
        .filter((l) => l.dependentNationId === perspective)
        .map(
          (l) =>
            `${l.partnerNationId}: imports ${l.imports}, energy ${l.energy}, adaptation ${l.adaptation}`,
        ),
      ...w.sanctions
        .filter((s) => s.status === 'active' && s.target === perspective)
        .map(
          (s) => `${s.issuer}: ${s.sector} sanctions intensity ${s.intensity}`,
        ),
    ],
    commitments: w.commitments
      .filter(
        (c) =>
          c.status === 'active' &&
          (c.issuer === perspective || c.recipients.includes(perspective)),
      )
      .map(
        (c) =>
          `${c.issuer} owes ${c.type}: ${c.terms}; due ${c.dueDate ?? 'ongoing'}`,
      ),
    opportunities: goals
      .filter((g) => g.status === 'advancing')
      .map((g) => `${g.title}: ${g.progress}%`),
    risks: [
      ...goals
        .filter((g) => g.pressure >= 20 || g.blockers.length)
        .map(
          (g) =>
            `${g.title}: pressure ${g.pressure}; ${g.blockers.join('; ')}; ${g.strategyReview ?? ''}`,
        ),
      ...w.initiatives
        .filter(
          (i) =>
            i.nationId === perspective && i.status === 'active' && i.blocker,
        )
        .map((i) => `${i.name}: ${i.blocker}`),
    ],
  };
}

export interface SemanticDifference {
  category: string;
  id: string;
  name: string;
  before: unknown;
  after: unknown;
}
/** Snapshot comparison. Callers choose the two dates; this does not invent missing history. */
export function compareWorlds(
  a: WorldState,
  b: WorldState,
  perspective: NationId,
): SemanticDifference[] {
  const common =
    a.saveId === b.saveId ||
    a.ancestry?.parentSaveId === b.saveId ||
    b.ancestry?.parentSaveId === a.saveId ||
    (!!a.ancestry && a.ancestry.parentSaveId === b.ancestry?.parentSaveId);
  requireDomain(
    common && a.scenario.id === b.scenario.id,
    'Timeline comparison requires common ancestry',
  );
  const changes: SemanticDifference[] = [];
  const push = (
    category: string,
    id: string,
    name: string,
    before: unknown,
    after: unknown,
  ) => {
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push({ category, id, name, before, after });
  };
  for (const r of a.regions) {
    const other = b.regions.find((v) => v.id === r.id);
    if (!other) continue;
    push(
      'territory',
      r.id,
      r.name,
      { owner: r.ownerNationId, control: r.controllerNationId },
      { owner: other.ownerNationId, control: other.controllerNationId },
    );
  }
  for (const n of a.nations) {
    const other = b.nations.find((v) => v.id === n.id);
    if (!other) continue;
    push(
      'government',
      n.id,
      n.name,
      { leader: n.leader, government: n.government },
      { leader: other.leader, government: other.government },
    );
    push(
      'capacity',
      n.id,
      n.name,
      {
        economy: n.stats.economy,
        military: n.stats.military,
        stability: n.stats.stability,
        ...(n.id === perspective
          ? { treasury: n.stats.treasury, readiness: n.stats.readiness }
          : {}),
      },
      {
        economy: other.stats.economy,
        military: other.stats.military,
        stability: other.stats.stability,
        ...(n.id === perspective
          ? { treasury: other.stats.treasury, readiness: other.stats.readiness }
          : {}),
      },
    );
  }
  const visible = (v: {
    id: string;
    visibility?: string | undefined;
    nationId?: NationId;
    parties?: NationId[];
    participants?: NationId[];
    issuer?: NationId;
    recipients?: NationId[];
  }) =>
    v.visibility !== 'private' ||
    v.nationId === perspective ||
    v.parties?.includes(perspective) ||
    v.participants?.includes(perspective) ||
    v.issuer === perspective ||
    v.recipients?.includes(perspective);
  for (const key of [
    'conflicts',
    'treaties',
    'crises',
    'goals',
    'commitments',
    'initiatives',
    'conferences',
    'sanctions',
  ] as const) {
    const left = a[key].filter(visible),
      right = b[key].filter(visible);
    for (const id of new Set([
      ...left.map((v) => v.id),
      ...right.map((v) => v.id),
    ])) {
      const old = left.find((v) => v.id === id),
        next = right.find((v) => v.id === id);
      const summary = (v: typeof old) => {
        if (!v) return null;
        if ('exhaustion' in v)
          return {
            status: v.status,
            exhaustion: v.exhaustion,
            escalation: v.escalation,
            settlement: v.settlementState,
            campaigns: v.campaigns,
          };
        if ('severity' in v)
          return { status: v.status, severity: v.severity, demands: v.demands };
        if ('evaluation' in v)
          return {
            status: v.status,
            progress: v.progress,
            priority: v.priority,
            evaluation: v.evaluation,
          };
        if ('invested' in v)
          return {
            status: v.status,
            progress: v.progress,
            invested: v.invested,
            blocker: v.blocker,
          };
        if ('round' in v)
          return {
            status: v.status,
            round: v.round,
            terms: v.terms,
            parties: v.parties,
          };
        if ('condition' in v)
          return {
            status: v.status,
            type: v.type,
            terms: v.terms,
            dueDate: v.dueDate,
          };
        if ('sector' in v)
          return {
            status: v.status,
            issuer: v.issuer,
            target: v.target,
            sector: v.sector,
            intensity: v.intensity,
          };
        return { status: v.status, terms: v.terms, parties: v.parties };
      };
      const entity = next ?? old!;
      push(
        key,
        id,
        'name' in entity ? entity.name : 'title' in entity ? entity.title : id,
        summary(old),
        summary(next),
      );
    }
  }
  for (const id of new Set(
    [...a.relations, ...b.relations].map((r) => `${r.nationA}~${r.nationB}`),
  )) {
    const r = a.relations.find((v) => `${v.nationA}~${v.nationB}` === id),
      other = b.relations.find((v) => `${v.nationA}~${v.nationB}` === id);
    push(
      'relations',
      id,
      id.replace('~', ' / '),
      r ? { score: r.score, trust: r.trust, tension: r.tension } : null,
      other
        ? { score: other.score, trust: other.trust, tension: other.tension }
        : null,
    );
  }
  for (const id of new Set(
    [...a.economicLinks, ...b.economicLinks].map((l) => l.id),
  )) {
    const summarize = (w: WorldState) => {
      const l = w.economicLinks.find((l) => l.id === id);
      return l
        ? {
            dependent: l.dependentNationId,
            partner: l.partnerNationId,
            imports: l.imports,
            exports: l.exports,
            energy: l.energy,
            strategicGoods: l.strategicGoods,
            finance: l.finance,
            alternatives: l.alternatives,
            adaptation: l.adaptation,
          }
        : null;
    };
    push('dependencies', id, id, summarize(a), summarize(b));
  }
  const eventSummary = (w: WorldState) =>
    w.events
      .filter(
        (e) =>
          e.importance >= 70 &&
          knowsInformation(w, perspective, { kind: 'event', id: e.id }),
      )
      .map((e) => ({ id: e.id, date: e.date, title: e.title }));
  push(
    'major-events',
    'world-history',
    'Major world developments',
    eventSummary(a),
    eventSummary(b),
  );
  return changes;
}
