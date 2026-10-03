import { z } from 'zod';
import { buildContext } from '@mandate/memory';
import { resolveTurn, executionCapacity } from '@mandate/core';
import {
  ActionId,
  CommandId,
  CommitRequest,
  Initiative,
  Goal,
  Negotiation,
  TurnId,
} from '@mandate/schemas';
import type { NationId, WorldState, WorldCommand } from '@mandate/schemas';
import { NationPlan, DiplomaticMove } from './contracts.js';
import type { ProviderConfig, Role, PlayerIntent } from './contracts.js';
import type { PrepareInput, TurnTrace } from './orchestrator.js';
import {
  canonicalizeFormalizerIntent,
  deterministicPlayerIntent,
  splitActionClauses,
  scopeIntent,
} from './perspective.js';
import { selectRelevance, scheduleActors } from './scheduler.js';
import { repetitionIssue } from './behavior.js';
import {
  auditMajorIntentClauses,
  executePlayerAction,
} from './player-executor.js';

// Local inference proposes choices; these recipes are code-owned commands, never model code.
// Consent is a separate government call. The sequential resolver remains authoritative.
export const CompactDecision = z.strictObject({
  choice: z.string().max(120),
  additionalChoices: z.array(z.string().max(120)).max(2),
  reason: z.string().min(1).max(180),
  message: z.string().max(260),
  counterTerms: z.string().max(300),
});
const ClauseClassification = z.strictObject({
  kind: z.enum([
    'diplomacy',
    'economy',
    'military',
    'domestic',
    'territory',
    'wait',
    'other',
  ]),
  visibility: z.enum(['public', 'private']),
});
export const CompactIntent = z.strictObject({
  classifications: z.array(ClauseClassification).min(1).max(20),
});
export type Candidate = {
  id: string;
  label: string;
  commands: WorldCommand[];
  family: string;
};
const later = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
function preview(w: WorldState, commands: WorldCommand[], run: string) {
  if (!commands.length) return w;
  run = `${run}-${w.revision}`;
  return resolveTurn(
    w,
    {
      expectedRevision: w.revision,
      action: {
        actorNationId: w.playerNationId,
        source: 'system',
        text: 'Validate government proposals',
      },
      commands: commands.map((command, i) => ({
        id: CommandId.parse(`command:${run}-preview-${i}`),
        reason: 'Validated proposal',
        command,
      })),
    },
    {
      turnId: TurnId.parse(`turn:${run}-preview`),
      actionId: ActionId.parse(`action:${run}-preview`),
      recordedAt: '2026-10-02T00:00:00.000Z',
    },
  );
}
function commandActor(c: WorldCommand): NationId | null {
  if (c.type === 'START_INITIATIVE') return c.initiative.nationId;
  if (c.type === 'OPEN_NEGOTIATION') return c.negotiation.proposerNationId;
  if (c.type === 'CREATE_STRATEGIC_GOAL') return c.goal.nationId;
  if (c.type === 'OPEN_CONFERENCE') return c.conference.proposer;
  if (c.type === 'IMPOSE_SANCTION') return c.sanction.issuer;
  return 'nationId' in c ? c.nationId : null;
}
function pressured(w: WorldState, actor: NationId) {
  return (
    urgentWar(w, actor) ||
    w.sanctions.some(
      (s) => s.status === 'active' && s.intensity >= 60 && s.target === actor,
    ) ||
    w.crises.some(
      (c) =>
        c.status !== 'resolved' &&
        c.severity >= 60 &&
        c.participants.includes(actor),
    )
  );
}
function urgentWar(w: WorldState, actor: NationId) {
  const own = w.nations.find((n) => n.id === actor)!;
  return w.conflicts.some((f) => {
    if (
      f.status !== 'active' ||
      ![...f.attackers, ...f.defenders].includes(actor)
    )
      return false;
    const opponents = f.attackers.includes(actor) ? f.defenders : f.attackers;
    return (
      f.exhaustion >= 55 ||
      own.stats.fiscal < 30 ||
      own.stats.unrest >= 70 ||
      w.regions.some(
        (r) =>
          r.ownerNationId === actor && opponents.includes(r.controllerNationId),
      )
    );
  });
}
export function compactCandidates(
  w: WorldState,
  actor: NationId,
  run: string,
  intent: PlayerIntent | null,
): Candidate[] {
  const own = w.nations.find((n) => n.id === actor)!;
  const player = intent?.actorNationId === actor;
  const candidates: Candidate[] = [
    {
      id: 'wait',
      label:
        'Monitor events; continue existing policies; preserve resources. No new announcement.',
      commands: [],
      family: 'wait',
    },
  ];
  if (
    player &&
    /continue|review|preserve|monitor|maintain/i.test(intent.summary) &&
    !/start|begin|fund a|launch|build|increase|expand|cancel|stop|suspend/i.test(
      intent.summary,
    )
  )
    return candidates;
  const add = (
    id: string,
    label: string,
    commands: WorldCommand[],
    family: string,
  ) => {
    if (commands.some((c) => repetitionIssue(w, c, player ? actor : null)))
      return;
    try {
      preview(w, commands, run);
      candidates.push({ id, label, commands, family });
    } catch {
      /* Invalid options never reach inference. */
    }
  };
  const persistent =
    player &&
    /over the next|long.term|five years|strategy|standing|directive/i.test(
      intent.summary,
    ) &&
    !own.strategy.directives.some(
      (d) => d.status === 'active' && d.text === intent.summary,
    );
  const directive: WorldCommand[] =
    persistent && own.strategy.directives.length < 20
      ? [
          {
            type: 'SET_STRATEGY',
            nationId: actor,
            strategy: {
              ...own.strategy,
              directives: [
                ...own.strategy.directives,
                {
                  id: `${run}-directive`,
                  text: intent.summary,
                  visibility: intent.intentions.some(
                    (i) => i.visibility === 'private',
                  )
                    ? 'private'
                    : 'public',
                  status: 'active',
                  createdDate: w.date,
                  priority: 'high',
                },
              ],
            },
          },
        ]
      : [];
  if (directive.length)
    add(
      'directive',
      'Record this long-term policy and its wording constraints; no immediate investment',
      directive,
      'strategy',
    );
  const active = w.initiatives.filter(
    (i) => i.nationId === actor && i.status === 'active',
  );
  const war = w.conflicts.filter(
    (f) =>
      f.status === 'active' && [...f.attackers, ...f.defenders].includes(actor),
  );
  const sanctions = w.sanctions.filter(
    (s) => s.status === 'active' && s.target === actor,
  );
  const urgent =
    urgentWar(w, actor) ||
    w.crises.some(
      (c) =>
        c.status !== 'resolved' &&
        c.severity >= 55 &&
        c.participants.includes(actor),
    );
  const recentProjects = w.commands
    .filter(
      (c) => Date.parse(w.date) - Date.parse(c.simulationDate) < 180 * 86400000,
    )
    .slice(-100)
    .filter(
      (c) =>
        c.command.type === 'START_INITIATIVE' &&
        c.command.initiative.nationId === actor,
    ).length;
  const recentPolicy = w.commands
    .filter(
      (c) => Date.parse(w.date) - Date.parse(c.simulationDate) < 180 * 86400000,
    )
    .filter((c) => {
      const v = c.command;
      return v.type === 'START_INITIATIVE'
        ? v.initiative.nationId !== w.playerNationId
        : v.type === 'OPEN_NEGOTIATION'
          ? v.negotiation.proposerNationId !== w.playerNationId
          : 'nationId' in v &&
            v.nationId !== w.playerNationId &&
            !['SWITCH_NATION'].includes(v.type);
    });
  const recentProjectShare = recentPolicy.length
    ? recentPolicy.filter((c) => c.command.type === 'START_INITIATIVE').length /
      recentPolicy.length
    : 0;
  const projectBudget =
    player ||
    (!urgent &&
      recentProjects < 2 &&
      (recentPolicy.length < 4 || recentProjectShare < 0.6));
  if (
    projectBudget &&
    active.reduce((s, i) => s + i.effort, 0) < executionCapacity(w, actor)
  ) {
    for (const kind of [
      'energy',
      'industry',
      'reform',
      'rearmament',
      'diplomacy',
    ] as const) {
      const projectIntents =
        intent?.intentions.filter(
          (i) =>
            /\b(start|begin|fund|launch|build|increase|expand|invest|develop|reform|improve|diversify|reduce|stabilize)\b/i.test(
              i.description,
            ) &&
            !/^(do not|don't|avoid|without)\b/i.test(i.description.trim()) &&
            (kind === 'energy' || kind === 'industry'
              ? i.kind === 'economy'
              : kind === 'rearmament'
                ? i.kind === 'military'
                : kind === 'reform'
                  ? i.kind === 'domestic'
                  : i.kind === 'diplomacy'),
        ) ?? [];
      if (player && !projectIntents.length) continue;
      if (
        player &&
        /energy|nuclear|imports|supply/i.test(intent.summary) &&
        !/industry|industrial|manufactur/i.test(intent.summary) &&
        kind === 'industry'
      )
        continue;
      if (
        !player &&
        sanctions.some((s) => s.intensity >= 60) &&
        ['rearmament', 'diplomacy'].includes(kind)
      )
        continue;
      const label = `${kind === 'energy' ? 'Energy diversification' : kind === 'reform' ? 'Domestic resilience' : kind === 'rearmament' ? 'Defense readiness' : kind === 'industry' ? 'Industrial capacity' : 'Diplomatic outreach'} program`;
      add(
        `project-${kind}`,
        `${label}; 180 days; effort 2, funded monthly. ${sanctions.length && kind === 'energy' ? 'Build substitution capacity under sanctions.' : ''}`,
        [
          ...directive,
          {
            type: 'START_INITIATIVE',
            initiative: Initiative.parse({
              id: `initiative:${run}-${actor.slice(7)}-${kind}`,
              nationId: actor,
              name: label,
              kind,
              effort: 2,
              startDate: w.date,
              durationDays: 180,
              visibility:
                player && projectIntents.some((i) => i.visibility === 'private')
                  ? 'private'
                  : 'public',
            }),
          },
        ],
        'project',
      );
    }
  }
  if (player && /cancel|stop|suspend/i.test(intent.summary))
    for (const i of active)
      add(
        `cancel-${i.id}`,
        `Cancel ${i.name}; retain prior sunk investment`,
        [{ type: 'CANCEL_INITIATIVE', initiativeId: i.id }],
        'domestic',
      );
  const linked = w.economicLinks.filter((l) => l.dependentNationId === actor);
  const partners = [
    ...new Set([
      ...war.flatMap((f) => [...f.attackers, ...f.defenders]),
      ...(player ? intent.targetNationIds : []),
      ...(w.scenario.neighborhoods?.find((n) => n.nationId === actor)
        ?.neighbors ?? []),
      ...linked.map((l) => l.partnerNationId),
      ...w.relations
        .filter((r) => [r.nationA, r.nationB].includes(actor) && r.score > 25)
        .flatMap((r) => [r.nationA, r.nationB]),
    ]),
  ]
    .filter((id) => id !== actor)
    .slice(0, 8);
  const terminalGoals = w.goals.filter(
    (g) =>
      g.nationId === actor &&
      ['achieved', 'failed', 'abandoned'].includes(g.status),
  );
  const activeGoals = w.goals.filter(
    (g) =>
      g.nationId === actor &&
      !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
  );
  if (!player && terminalGoals.length && !activeGoals.length) {
    for (const partner of partners.slice(0, 3)) {
      const relation = w.relations.find(
        (r) =>
          [r.nationA, r.nationB].includes(actor) &&
          [r.nationA, r.nationB].includes(partner),
      );
      if (!relation || relation.score >= 90) continue;
      const name = w.nations.find((n) => n.id === partner)!.name;
      add(
        `reassess-${partner.slice(7)}`,
        `Replace completed/failed strategy with a specific objective: rebuild relations with ${name}. Current relationship ${relation.score}; target ${Math.min(90, relation.score + 15)} over one year. Further talks and compromises are still needed.`,
        [
          {
            type: 'CREATE_STRATEGIC_GOAL',
            goal: Goal.parse({
              id: `goal:${run}-${actor.slice(7)}-review`,
              nationId: actor,
              title: `Build working relations with ${name}`,
              priority: 70,
              status: 'active',
              evaluation: {
                kind: 'relationship',
                nationId: partner,
                baseline: relation.score,
                target: Math.min(90, relation.score + 15),
              },
              targetNationIds: [partner],
              progress: 0,
              reason: `Reassess after ${terminalGoals
                .slice(-2)
                .map((g) => g.title + ' (' + g.status + ')')
                .join('; ')}`,
              createdDate: w.date,
              updatedDate: w.date,
              kind: 'diplomatic',
              visibility: 'private',
              deadline: later(w.date, 365),
            }),
          },
        ],
        'strategy',
      );
    }
  }
  for (const partner of partners) {
    if (player && !intent.targetNationIds.includes(partner)) continue;
    const name = w.nations.find((n) => n.id === partner)!.name;
    const isOpponent = war.find(
      (f) =>
        [...f.attackers, ...f.defenders].includes(partner) &&
        f.attackers.includes(actor) !== f.attackers.includes(partner),
    );
    const kinds = isOpponent
      ? (['peace', 'ceasefire'] as const)
      : (['consultation', 'trade', 'nonaggression', 'defense'] as const);
    const addressedIntents =
      intent?.intentions.filter(
        (i) => i.kind === 'diplomacy' && i.targetNationIds.includes(partner),
      ) ?? [];
    if (player && !addressedIntents.length) continue;
    for (const kind of kinds) {
      if (
        !player &&
        kind === 'consultation' &&
        w.negotiations.some(
          (n) =>
            n.status === 'accepted' &&
            n.kind === 'consultation' &&
            [n.proposerNationId, n.recipientNationId].includes(actor) &&
            [n.proposerNationId, n.recipientNationId].includes(partner) &&
            Date.parse(w.date) -
              Date.parse(n.responses.at(-1)?.date ?? n.createdDate) <
              180 * 86400000,
        )
      )
        continue;
      if (player) {
        const text = addressedIntents
          .map((i) => i.description)
          .join(' ')
          .toLowerCase();
        const requested = /ceasefire/.test(text)
          ? 'ceasefire'
          : /peace|settlement/.test(text)
            ? 'peace'
            : /trade|energy.*supply|imports/.test(text)
              ? 'trade'
              : /non.?aggression/.test(text)
                ? 'nonaggression'
                : /binding.*defen[sc]e|formal alliance/.test(text) &&
                    !/no (?:binding|formal)|not.*alliance|without.*binding|avoid.*alliance/.test(
                      text,
                    )
                  ? 'defense'
                  : 'consultation';
        if (kind !== requested) continue;
      }
      if (
        w.treaties.some(
          (t) =>
            t.status === 'active' &&
            t.kind === kind &&
            t.parties.length === 2 &&
            t.parties.includes(actor) &&
            t.parties.includes(partner),
        )
      )
        continue;
      if (!player && !isOpponent && kind !== 'trade' && kind !== 'consultation')
        continue;
      if (player && !intent.intentions.some((i) => i.kind === 'diplomacy'))
        continue;
      if (
        !player &&
        !isOpponent &&
        kind === 'trade' &&
        !sanctions.length &&
        !linked.some((l) => l.energy >= 50)
      )
        continue;
      const terms = player
        ? addressedIntents.map((i) => i.description).join('; ')
        : kind === 'peace'
          ? 'End the costly war at current control lines, without ownership transfers.'
          : kind === 'ceasefire'
            ? 'Suspend offensive operations and open settlement talks; no territorial transfer.'
            : kind === 'trade'
              ? sanctions.some((s) => s.issuer === partner)
                ? `Negotiate reciprocal market access and possible sanction relief with ${name}; sanctions remain until its government independently lifts them.`
                : linked.some(
                      (l) => l.partnerNationId === partner && l.energy >= 50,
                    )
                  ? `Revise existing energy supply and market access with ${name}; preserve political independence.`
                  : `Seek reciprocal market access and alternative energy supply with ${name}; preserve political independence.`
              : `Open voluntary regional security consultations with ${name}; no permanent basing or binding military alliance.`;
      add(
        `offer-${partner.slice(7)}-${kind}`,
        `Propose ${kind} to ${name}. Requires independent recipient consent. ${terms}`,
        [
          {
            type: 'OPEN_NEGOTIATION',
            negotiation: Negotiation.parse({
              id: `negotiation:${run}-${actor.slice(7)}-${partner.slice(7)}-${kind}`,
              proposerNationId: actor,
              recipientNationId: partner,
              kind,
              topic: `${kind === 'trade' ? 'Trade and supply talks' : kind === 'peace' ? 'War settlement' : kind === 'ceasefire' ? 'Ceasefire talks' : 'Regional ' + kind} with ${name}`,
              terms,
              conflictId: isOpponent?.id ?? null,
              createdDate: w.date,
              expiresDate: later(w.date, 180),
              visibility:
                player &&
                addressedIntents.some((i) => i.visibility === 'private')
                  ? 'private'
                  : 'public',
            }),
          },
        ],
        'diplomacy',
      );
    }
  }
  for (const f of war) {
    for (const stance of [
      'defend',
      'reinforce',
      'deescalate',
      'offensive',
    ] as const)
      add(
        `war-${f.id.slice(9)}-${stance}`,
        `${stance} in ${f.name}; exhaustion ${f.exhaustion}, logistics ${f.logistics}. ${stance === 'offensive' ? 'Costs resources; success is determined by the engine.' : ''}`,
        [
          {
            type: 'CONFLICT_ACTION',
            conflictId: f.id,
            nationId: actor,
            stance,
          },
        ],
        'war',
      );
  }
  for (const c of w.crises.filter(
    (c) =>
      c.status !== 'resolved' &&
      c.participants.includes(actor) &&
      (!player ||
        /crisis|dispute|de.escalat|stand.down|regional security|military signal/i.test(
          intent.summary,
        )),
  ))
    for (const move of [
      'talk',
      'stand-down',
      'warn',
      'mobilize',
      'concede',
      'freeze',
    ] as const)
      add(
        `crisis-${c.id.slice(7)}-${move}`,
        `${move} in ${c.title}; severity ${c.severity}; demands: ${c.demands.map((d) => d.text).join('; ')}`,
        [{ type: 'CRISIS_ACTION', crisisId: c.id, nationId: actor, move }],
        'crisis',
      );
  for (const s of w.sanctions.filter(
    (s) => s.issuer === actor && s.status === 'active',
  ))
    add(
      `relief-${s.id.slice(9)}`,
      `Lift ${s.sector} sanctions on ${w.nations.find((n) => n.id === s.target)!.name}; removes coercion but restores opportunity`,
      [{ type: 'LIFT_SANCTION', sanctionId: s.id, nationId: actor }],
      'economy',
    );
  for (const c of w.conferences.filter(
    (c) => c.status === 'open' && c.parties.includes(actor),
  ))
    for (const move of ['accept', 'reject', 'delay', 'abstain'] as const)
      add(
        `conference-${c.id.slice(11)}-${move}`,
        `${move} conference: ${c.title}. Current terms: ${c.terms}`,
        [
          {
            type: 'RESPOND_CONFERENCE',
            conferenceId: c.id,
            nationId: actor,
            move,
            message: 'Government decision on current terms',
          },
        ],
        'organization',
      );
  return candidates;
}
export function compactFacts(
  w: WorldState,
  actor: NationId,
  relevant: NationId[],
) {
  const context = buildContext(w, actor, relevant, {
    recentLimit: 6,
    eventBudget: 1800,
  });
  const own = context.canonical.nations.find((n) => n.id === actor)!;
  return {
    date: w.date,
    own,
    goals: context.canonical.goals
      .filter((g) => g.nationId === actor)
      .map((g) => ({
        id: g.id,
        title: g.title,
        priority: g.priority,
        progress: g.progress,
        pressure: g.pressure,
        review: g.strategyReview,
        blockers: g.blockers,
      })),
    partners: context.canonical.nations
      .filter((n) => n.id !== actor)
      .map((n) => ({
        id: n.id,
        name: n.name,
        economicCapacity: n.stats.economy,
        militaryCapacity: n.stats.military,
      })),
    relations: context.canonical.relations.map((r) => ({
      nationA: r.nationA,
      nationB: r.nationB,
      score: r.score,
      trust: r.trust,
      tension: r.tension,
      recent: r.factors.slice(-2),
    })),
    promises: context.canonical.commitments.map((c) => ({
      issuer: c.issuer,
      recipients: c.recipients,
      terms: c.terms,
      status: c.status,
      due: c.dueDate,
    })),
    wars: context.canonical.conflicts
      .filter((f) => f.status === 'active')
      .map((f) => ({
        id: f.id,
        name: f.name,
        attackers: f.attackers,
        defenders: f.defenders,
        exhaustion: f.exhaustion,
        escalation: f.escalation,
        logistics: f.logistics,
      })),
    warReview: {
      homelandLosses: context.canonical.regions
        .filter(
          (r) => r.ownerNationId === actor && r.controllerNationId !== actor,
        )
        .map((r) => r.name),
      treasury: own.stats.treasury,
      fiscal: own.stats.fiscal,
      unrest: own.stats.unrest,
      questions: [
        'Are current war goals achievable given control, logistics and exhaustion?',
        'Can we sustain military upkeep alongside promises and domestic stability?',
        'Would reduced goals, ceasefire or mediated settlement serve us better than escalation?',
      ],
      instruction:
        'State a concrete choice and material sustainability factor. Settlement is an offer, never an assumed outcome.',
    },
    sanctions: context.canonical.sanctions.filter((s) => s.status === 'active'),
    economicLinks: context.canonical.economicLinks.filter(
      (l) => l.dependentNationId === actor,
    ),
    crises: context.canonical.crises
      .filter((c) => c.status !== 'resolved')
      .map((c) => ({
        id: c.id,
        title: c.title,
        severity: c.severity,
        demands: c.demands,
        deadline: c.deadline,
      })),
    projects: (context.canonical.initiatives as Initiative[])
      .filter((i) => i.nationId === actor && i.status === 'active')
      .map((i) => ({
        name: i.name,
        progress: i.progress,
        effort: i.effort,
        blocker: i.blocker,
      })),
    recent: context.recentEvents
      .slice(-6)
      .map((e) => ({ date: e.date, title: e.title })),
    uncertainty:
      'Foreign private strategy, treasury and readiness are unknown. Proposals are wishes, not outcomes.',
  };
}
type Call = <T>(
  role: Role,
  schema: z.ZodType<T>,
  payload: object,
  references: string[],
  repairAttempt?: number,
) => Promise<T>;
export async function compactPrepare(
  input: PrepareInput,
  trace: TurnTrace,
  config: ProviderConfig,
  generate: Call,
) {
  const { world: w, signal } = input;
  let repairCalls = 0;
  const call: Call = async (role, schema, payload, refs, attempt = 0) => {
    try {
      return await generate(role, schema, payload, refs, attempt);
    } catch (error) {
      signal?.throwIfAborted();
      if (
        role === 'formalizer' ||
        repairCalls >= config.maxRepairs ||
        !(error instanceof Error) ||
        !error.message.startsWith('Invalid ')
      )
        throw error;
      repairCalls++;
      trace.failures.push('Malformed ' + role + ' response retried once.');
      return generate(
        role,
        schema,
        {
          ...payload,
          repair:
            'Previous generation was invalid. Emit the exact short JSON schema; no emoji, hashtags, repetition or extra fields.',
        },
        refs,
        repairCalls,
      );
    }
  };
  const stage = (
    s: Parameters<NonNullable<PrepareInput['onProgress']>>[0],
    actor?: NationId,
  ) => {
    signal?.throwIfAborted();
    input.onProgress?.(
      s,
      actor ? w.nations.find((n) => n.id === actor)!.name : undefined,
    );
  };
  if (input.action.source === 'player') {
    stage('interpreting');
    for (;;)
      try {
        const clauses = splitActionClauses(input.action.text);
        const draft = await call(
          'formalizer',
          CompactIntent.extend({
            classifications: z
              .array(ClauseClassification)
              .length(clauses.length),
          }),
          {
            clauses,
            task: 'Return exactly one classification per supplied clause, in the same order. Classify each exact player clause. Energy, industry, diversification, trade capacity and spending are economy; readiness and armed force are military; reforms are domestic; proposals or talks addressed to another government are diplomacy. A policy mentioning a foreign supplier is NOT automatically diplomacy. Preserve negations and conditionality. Public framing constraints are not secrecy; quiet, secret or unannounced actions are private. Do not add outcomes.',
          },
          [w.saveId],
          repairCalls,
        );
        trace.intent = canonicalizeFormalizerIntent(w, input.action, {
          version: 1,
          summary: input.action.text.slice(0, 2000),
          targetNationIds: [],
          targetRegionIds: [],
          visibility: draft.classifications.every(
            (i) => i.visibility === 'private',
          )
            ? 'private'
            : 'public',
          policyOrders: [],
          desiredOutcomes: [],
          constraints: [],
          majorIntentClauses: [],
          intentions: draft.classifications.map((i, index) => ({
            ...i,
            visibility:
              /\b(secret|secretly|quietly|private|privately|unannounced)\b|without publicly announcing/i.test(
                clauses[index]!,
              )
                ? 'private'
                : i.visibility,
            sourceClauseIds: [index],
            description: 'Source clause',
            targetNationIds: [],
          })),
        });
        break;
      } catch (error) {
        if (repairCalls >= config.maxRepairs) {
          trace.intent = deterministicPlayerIntent(w, input.action);
          trace.failures.push(
            'Formalizer unavailable; provider-independent player intent interpretation was used.',
          );
          trace.validatorResults.push(
            'Player Action Executor used exact player clauses and canonical world references without model approval.',
          );
          break;
        }
        repairCalls++;
        trace.failures.push('Intent repair: ' + String(error));
      }
  }
  trace.playerExecution =
    input.action.source === 'player'
      ? executePlayerAction(w, trace.intent, trace.id)
      : null;
  trace.relevance = selectRelevance(w, trace.intent);
  const required = [
    ...new Set([
      ...(trace.intent
        ? [trace.intent.actorNationId, ...trace.intent.targetNationIds]
        : []),
      ...w.negotiations
        .filter(
          (n) =>
            !w.observerMode &&
            n.status === 'open' &&
            [n.proposerNationId, n.recipientNationId].includes(
              w.playerNationId,
            ) &&
            n.recipientNationId !== w.playerNationId,
        )
        .map((n) => n.recipientNationId),
    ]),
  ];
  trace.relevance.secondaryNationIds = [
    ...new Set([
      ...w.negotiations
        .filter(
          (n) =>
            n.status === 'open' &&
            (w.observerMode || n.recipientNationId !== w.playerNationId) &&
            pressured(w, n.proposerNationId),
        )
        .map((n) => n.recipientNationId),
      ...w.sanctions
        .filter((s) => s.status === 'active' && s.intensity >= 60)
        .map((s) => s.target),
      ...trace.relevance.secondaryNationIds,
    ]),
  ].slice(0, 12);
  const scheduled = scheduleActors(
    w,
    trace.relevance,
    config.maxBackgroundPlanners,
  );
  const budget =
    config.maxCalls ??
    (input.quality === 'deep' ? 12 : input.quality === 'fast' ? 5 : 8);
  // Reserve one call per pending foreign response; newly opened offers can be answered later in this same actor pass.
  const responseCount = w.negotiations.filter(
    (n) =>
      n.status === 'open' &&
      n.recipientNationId !== w.playerNationId &&
      [n.proposerNationId, n.recipientNationId].some((id) =>
        required.includes(id),
      ),
  ).length;
  const requiredCallCount = required.filter(
    (id) => input.action.source !== 'player' || id !== w.playerNationId,
  ).length;
  if (requiredCallCount + responseCount + trace.modelCalls.length > budget)
    throw new Error(
      'Too many important governments for this turn budget. Increase the call limit in AI settings or split the directive. No changes committed.',
    );
  const capacity = Math.max(
    0,
    Math.min(
      config.maxBackgroundPlanners,
      input.quality === 'deep' ? 4 : input.quality === 'fast' ? 1 : 2,
      budget - requiredCallCount - responseCount - trace.modelCalls.length,
    ),
  );
  const actors = [
    ...required,
    ...scheduled
      .filter(
        (a) =>
          !required.includes(a.nationId) &&
          (w.observerMode || a.nationId !== w.playerNationId),
      )
      .sort((a, b) => {
        const urgent = (id: NationId) =>
          pressured(w, id) ||
          w.negotiations.some(
            (n) =>
              n.status === 'open' &&
              n.recipientNationId === id &&
              (w.observerMode || id !== w.playerNationId) &&
              pressured(w, n.proposerNationId),
          );
        if (urgent(a.nationId) !== urgent(b.nationId))
          return urgent(a.nationId) ? -1 : 1;
        const recent = (id: NationId) =>
          w.commands.findLastIndex((c) => commandActor(c.command) === id);
        return recent(a.nationId) - recent(b.nationId) || b.score - a.score;
      })
      .slice(0, capacity)
      .map((a) => a.nationId),
  ];
  trace.activations = actors.map((nationId) => ({
    nationId,
    score: 100,
    reasons: [
      required.includes(nationId)
        ? 'Player action or active negotiation'
        : 'Salient world opportunity',
    ],
    background: !required.includes(nationId),
  }));
  const commands: Array<{ command: WorldCommand; reason: string }> = [
    ...(trace.playerExecution?.commands ?? []),
  ];
  const reactionPreviewCommands = commands.filter(
    (entry) => entry.command.type !== 'OPEN_NEGOTIATION',
  );
  let working = reactionPreviewCommands.length
    ? preview(
        w,
        reactionPreviewCommands.map((c) => c.command),
        trace.id,
      )
    : w;
  for (const actor of actors) {
    if (input.action.source === 'player' && actor === w.playerNationId)
      continue;
    const pending = working.negotiations
      .filter(
        (n) =>
          n.status === 'open' &&
          n.recipientNationId === actor &&
          (w.observerMode || actor !== w.playerNationId),
      )
      .slice(0, 2);
    stage(
      pending.length ? 'diplomatic-responses' : 'governments-deliberating',
      actor,
    );
    try {
      const scoped = trace.intent ? scopeIntent(trace.intent, actor) : null;
      const candidates = compactCandidates(working, actor, trace.id, scoped);
      // A directly addressed foreign government first answers the persisted proposal.
      // It never independently adopts the player's domestic directive as its own.
      const isPlayer = scoped?.actorNationId === actor;
      let decision: z.infer<typeof CompactDecision>;
      if (pending.length) {
        const n = pending[0]!;
        const duplicate = working.treaties.some(
          (t) =>
            t.status === 'active' &&
            t.kind === n.kind &&
            t.parties.length === 2 &&
            t.parties.includes(n.proposerNationId) &&
            t.parties.includes(n.recipientNationId),
        );
        const options = duplicate
          ? ['reject', 'counter', 'delay', 'ignore']
          : ['accept', 'reject', 'counter', 'delay', 'ignore'];
        decision = await call(
          'diplomat',
          CompactDecision.extend({ choice: z.enum(options) }),
          {
            facts: compactFacts(working, actor, [n.proposerNationId, actor]),
            proposal: {
              id: n.id,
              kind: n.kind,
              terms: n.terms,
              obligations: n.obligations,
              history: n.responses.slice(-4),
            },
            options,
            mechanicalConstraint: duplicate
              ? 'An active equivalent treaty already covers these parties. A duplicate cannot create another agreement. Explain this if declining; consent to a replacement cannot be mechanically executed in this turn.'
              : null,
            responseStyle:
              'One sentence each for reason and message, at most 25 words.',
            task: 'Answer the ACTUAL terms as this government. Beneficial low-cost cooperation may be accepted; incompatible sovereignty demands rejected or narrowed. Counter needs specific revised terms. Do not invent agreement or new restrictions. Set choice to one supplied option, additionalChoices to []; message is the diplomatic response.',
          },
          [n.id],
        );
        if (
          !options.includes(decision.choice) ||
          (decision.choice === 'counter' && !decision.counterTerms.trim())
        )
          throw new Error(
            'Diplomatic move is invalid or counteroffer lacks terms',
          );
        const move = decision.choice as
          'accept' | 'reject' | 'counter' | 'delay' | 'ignore';
        trace.moves.push(
          DiplomaticMove.parse({
            version: 1,
            nationId: actor,
            recipientNationId: n.proposerNationId,
            negotiationId: n.id,
            move,
            message: decision.message || decision.reason,
            terms: move === 'counter' ? decision.counterTerms : n.terms,
            visibility: n.visibility,
            obligations: move === 'counter' ? [] : n.obligations,
            peaceTerms: move === 'counter' ? [] : n.peaceTerms,
          }),
        );
        if (move !== 'ignore') {
          const command = WorldCommandValue.parse({
            type: 'RESPOND_NEGOTIATION',
            negotiationId: n.id,
            nationId: actor,
            move,
            message: decision.message || decision.reason,
            ...(move === 'counter'
              ? {
                  counterTerms: decision.counterTerms,
                  counterObligations: [],
                  counterPeaceTerms: [],
                }
              : {}),
            ...(move === 'accept' && n.kind !== 'consultation'
              ? { treatyId: `treaty:${trace.id}-${actor.slice(7)}` }
              : {}),
          });
          working = preview(
            w,
            [...commands.map((c) => c.command), command],
            trace.id,
          );
          commands.push({ command, reason: decision.reason });
        }
      } else {
        const directlyCoerced =
          trace.intent?.policyOrders.some(
            (order) =>
              order.targetNationIds.includes(actor) &&
              /annex|invad|demand|ultimatum|threaten|claim|seize/i.test(
                order.text,
              ),
          ) ?? false;
        if (
          !isPlayer &&
          scoped &&
          required.includes(actor) &&
          !working.negotiations.some(
            (n) => n.status === 'open' && n.recipientNationId === actor,
          ) &&
          !directlyCoerced
        )
          continue;
        decision = await call(
          'planner',
          CompactDecision.extend({
            message: z.literal(''),
            counterTerms: z.literal(''),
            choice: z.enum(candidates.map((c) => c.id)),
            additionalChoices: z
              .array(z.enum(candidates.map((c) => c.id)))
              .max(2),
          }),
          {
            facts: compactFacts(working, actor, [
              actor,
              ...(scoped?.targetNationIds ?? []),
              ...(w.scenario.neighborhoods?.find((n) => n.nationId === actor)
                ?.neighbors ?? []),
            ]),
            intent: isPlayer ? scoped : null,
            candidates: candidates.map((c) => ({
              id: c.id,
              label: c.label,
              family: c.family,
            })),
            responseStyle:
              'Reason is one institutional sentence, at most 25 words. message and counterTerms must be empty. No emoji, hashtags or repetition.',
            task: isPlayer
              ? 'Choose supplied actions that implement the actual player request. Put the primary ID in choice, and up to two other needed actions in additionalChoices; otherwise emit an empty additionalChoices array. Every supplied candidate has already passed actual affordability and domain checks; do not invent a treasury threshold to reject an affordable player instruction. Respect negations, conditionality and private framing. If unsupported choose wait and explain the limitation; do not silently substitute a different policy. Long-term directives preserve the exact player wording.'
              : 'What problem deserves action now? War sustainability, homeland threat, exhaustion, sanctions, broken promises and crises outrank routine investment. Identify actual partners. Waiting or continuing policy is valid. A project is not a default. Choose ONE candidate ID, additionalChoices must be empty; explain the material tradeoff.',
          },
          [actor],
        );
        const selectedIds = [
          ...new Set([
            decision.choice,
            ...(isPlayer ? decision.additionalChoices : []),
          ]),
        ];
        const selected = selectedIds.map((id) =>
          candidates.find((c) => c.id === id),
        );
        if (selected.some((c) => !c))
          throw new Error('Government selected an unknown action');
        const seen = new Set<string>();
        const selectedCommands = selected
          .flatMap((c) => c!.commands)
          .filter((c) => {
            const key =
              c.type === 'CRISIS_ACTION'
                ? `crisis:${c.nationId}`
                : c.type === 'CONFLICT_ACTION'
                  ? `war:${c.nationId}:${c.conflictId}`
                  : c.type === 'OPEN_NEGOTIATION'
                    ? `offer:${c.negotiation.proposerNationId}:${c.negotiation.recipientNationId}`
                    : c.type === 'RESPOND_CONFERENCE'
                      ? `conference:${c.conferenceId}:${c.nationId}`
                      : JSON.stringify(c);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((c) =>
            c.type === 'RESPOND_CONFERENCE'
              ? { ...c, message: decision.message || decision.reason }
              : c,
          );
        working = preview(
          w,
          [...commands.map((c) => c.command), ...selectedCommands],
          trace.id,
        );
        commands.push(
          ...selectedCommands.map((command) => ({
            command,
            reason: decision.reason,
          })),
        );
      }
      trace.plans.push(
        NationPlan.parse({
          version: 1,
          nationId: actor,
          stance: 'independent',
          priorities: [decision.reason],
          intentions: [decision.choice],
          publicStatement: decision.message,
          explanation: decision.reason,
          decisionFactors: [
            {
              factor:
                decision.choice.includes('war') ||
                decision.choice.includes('peace')
                  ? 'military-risk'
                  : decision.choice.includes('project') ||
                      decision.choice.includes('trade') ||
                      decision.choice.includes('sanction')
                    ? 'economy'
                    : decision.choice.includes('consultation')
                      ? 'trust'
                      : 'urgency',
              assessment: decision.reason,
              references: [actor],
            },
          ],
        }),
      );
      input.fault?.('after-plan');
    } catch (error) {
      signal?.throwIfAborted();
      if (
        required.includes(actor) ||
        (!w.observerMode &&
          pending.some((n) => n.proposerNationId === w.playerNationId))
      )
        throw new Error(
          `${w.nations.find((n) => n.id === actor)!.name} could not complete an important decision. Retry this turn or test the model in settings. No outcome committed.`,
          { cause: error },
        );
      trace.failures.push(
        `Background government ${actor} skipped: ${error instanceof Error ? error.message : 'inference failed'}`,
      );
    }
  }
  stage('resolving');
  trace.proposal = {
    version: 1,
    explanation:
      'Independent government choices resolved sequentially against canonical domain constraints.',
    commands,
  };
  input.fault?.('after-proposal');
  stage('validating');
  input.fault?.('during-validation');
  const request = CommitRequest.parse({
    expectedRevision: w.revision,
    expectedHash: input.expectedHash,
    action: input.action,
    commands: [
      ...commands,
      {
        command: {
          type: 'ADVANCE_DATE',
          date: later(w.date, input.days ?? 30),
        },
        reason: 'Explicit simulation time advancement',
      },
    ].map((c, i) => ({ ...c, id: `command:${trace.id}-${i}` })),
  });
  preview(
    w,
    request.commands.map((c) => c.command),
    trace.id,
  );
  if (trace.intent && trace.playerExecution) {
    const audit = auditMajorIntentClauses(
      w,
      trace.intent,
      request.commands.map((entry) => entry.command),
    );
    trace.playerExecution.intentSatisfactionAudit = audit;
    const unsupported = audit.filter((entry) => entry.status === 'UNSUPPORTED');
    if (unsupported.length)
      throw new Error(
        `Major player intent satisfaction audit failed: ${unsupported.map((entry) => `${entry.clauseId} (${entry.explanation})`).join('; ')}`,
      );
    trace.validatorResults.push(
      `Major player-intent audit represented ${audit.filter((entry) => entry.status !== 'BLOCKED_BY_REAL_WORLD_CONSTRAINT').length}/${audit.length} clauses in validated mechanics; explicit world constraints are recorded separately.`,
    );
  }
  trace.validatorResults.push(
    'Compact choices validated against code-owned candidates, independent recipient consent, sequential domain checks and hard invariants.',
  );
  if (trace.playerExecution?.commands.length)
    trace.validatorResults.push(
      `Player Action Executor preserved ${trace.playerExecution.orders.length} authoritative order(s) through ${trace.playerExecution.commands.length} validated canonical command(s).`,
    );
  return request;
}
import { WorldCommand as WorldCommandValue } from '@mandate/schemas';
