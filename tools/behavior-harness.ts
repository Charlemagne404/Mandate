import { decisionInputs } from '../packages/ai/src/decision.js';
import { z } from 'zod';
import { buildContext } from '@mandate/memory';
import { resolveTurn } from '@mandate/core';
import {
  buildFormalizerPayload,
  canonicalizeFormalizerIntent,
  FormalizerIntent,
  NationPlan,
  NationPlanGeneration,
  PlayerIntent,
  DiplomaticMove,
  NarrationResult,
  ResolutionProposal,
  roleSystem,
  RESOLVER_CAPABILITIES,
  validateCapabilities,
  selectRelevance,
  repetitionIssue,
  contextReferences,
} from '../packages/ai/src/index.js';
import type { LlmProvider, ProviderConfig } from '../packages/ai/src/index.js';
import {
  Goal,
  Negotiation,
  TurnId,
  ActionId,
  Conference,
  EconomicLink,
  Sanction,
  Crisis,
} from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import type { BehaviorCase } from '../tests/ai/behavior-cases.js';

export function prepareBehaviorCase(base: WorldState, c: BehaviorCase) {
  const w = structuredClone(base);
  const fin = w.nations.find((n) => n.id === 'nation:fin')!;
  const swe = w.nations.find((n) => n.id === 'nation:swe')!;
  const relation = w.relations.find(
    (r) =>
      [r.nationA, r.nationB].includes(fin.id) &&
      [r.nationA, r.nationB].includes(swe.id),
  )!;
  relation.score = c.profile === 'hostile' ? -70 : 60;
  relation.trust = c.profile === 'hostile' ? 10 : 75;
  if (c.profile === 'unstable') {
    fin.stats.stability = 15;
    fin.stats.unrest = 85;
  }
  if (c.profile === 'insolvent') {
    fin.stats.treasury = 0;
    fin.stats.fiscal = 10;
  }
  if (c.profile === 'neutral' || c.id === 'continuity-redline')
    fin.strategy.directives = [
      {
        id: 'neutrality',
        text: 'Maintain neutrality; reject permanent foreign bases and binding defense alliances',
        visibility: 'private',
        status: 'active',
        createdDate: w.date,
      },
    ];
  if (c.id === 'continuity-aid') {
    fin.stats.treasury = 0;
    fin.stats.fiscal = 10;
  }
  if (c.id === 'diplomacy-specific-redline')
    fin.strategy.directives = [
      {
        id: 'basing-limit',
        text: 'Avoid permanent foreign basing; remain open to intelligence cooperation',
        visibility: 'private',
        status: 'active',
        createdDate: w.date,
      },
    ];
  if (c.id === 'continuity-warning')
    fin.strategy.redLines = ['No permanent foreign basing'];
  if (c.expectedTopic === 'industry') fin.stats.industrial = 15;
  if (c.expectedTopic === 'trust')
    relation.grievances = ['An accepted aid pledge was breached'];
  if (c.expectedTopic === 'adapt') {
    fin.strategy.redLines = [
      'An identical alliance proposal was rejected; seek revised terms or another partner',
    ];
  }
  if (c.expectedTopic === 'neutral')
    fin.strategy.directives = [
      {
        id: 'neutrality',
        text: 'Maintain neutrality',
        visibility: 'private',
        status: 'active',
        createdDate: w.date,
      },
    ];
  if (c.profile === 'exhausted')
    w.conflicts.push({
      id: 'conflict:exhausted' as WorldState['conflicts'][number]['id'],
      name: 'Exhausted border conflict',
      attackers: [swe.id],
      defenders: [fin.id],
      status: 'active',
      escalation: 30,
      settlementState: 'fighting',
      exhaustion: 85,
      logistics: 30,
      warGoals: ['Security'],
      campaigns: [],
      theaters: [],
    });
  if (c.expectedTopic === 'energy')
    w.goals.push(
      Goal.parse({
        id: 'goal:energy-old',
        nationId: fin.id,
        title: 'Energy diversification',
        kind: 'economic',
        priority: 95,
        status: 'active',
        progress: 0,
        targetNationIds: [],
        reason: 'Persistent reduction of energy exposure',
        createdDate: w.date,
        updatedDate: w.date,
        signals: [
          {
            stat: 'energyExposure',
            baseline: fin.stats.energyExposure,
            target: 10,
            weight: 1,
          },
        ],
      }),
    );
  if (
    ['continuity-treaty', 'continuity-changed', 'planner-reject'].includes(c.id)
  ) {
    const n = Negotiation.parse({
      id: 'negotiation:old-rejection',
      proposerNationId: swe.id,
      recipientNationId: fin.id,
      topic: 'Permanent foreign basing',
      kind: 'consultation',
      terms: 'Allow permanent Swedish military basing in Finland.',
      createdDate: w.date,
      expiresDate: '2025-04-01',
    });
    const evolved = resolveTurn(
      w,
      {
        expectedRevision: w.revision,
        action: { actorNationId: swe.id, source: 'player', text: n.terms },
        commands: [
          {
            id: 'command:old-open',
            reason: 'Old proposal',
            command: { type: 'OPEN_NEGOTIATION', negotiation: n },
          },
          {
            id: 'command:old-reject',
            reason: 'Finnish neutrality',
            command: {
              type: 'RESPOND_NEGOTIATION',
              negotiationId: n.id,
              nationId: fin.id,
              move: 'reject',
              message: 'We reject permanent foreign basing',
            },
          },
        ],
      },
      {
        turnId: TurnId.parse('turn:old'),
        actionId: ActionId.parse('action:old'),
        recordedAt: '2026-10-02T00:00:00.000Z',
      },
    );
    Object.assign(w, evolved);
    for (let i = 0; i < 18; i++)
      Object.assign(
        w,
        resolveTurn(
          w,
          {
            expectedRevision: w.revision,
            action: {
              actorNationId: swe.id,
              source: 'system',
              text: 'Observe world',
            },
            commands: [
              {
                id: `command:elapsed-${i}`,
                reason: 'Elapsed simulation time',
                command: {
                  type: 'ADVANCE_DATE',
                  date: new Date(Date.parse(w.date) + 30 * 86400000)
                    .toISOString()
                    .slice(0, 10),
                },
              },
            ],
          },
          {
            turnId: TurnId.parse(`turn:elapsed-${i}`),
            actionId: ActionId.parse(`action:elapsed-${i}`),
            recordedAt: '2026-10-02T00:00:00.000Z',
          },
        ),
      );
  }
  if (
    [
      'continuity-promise',
      'continuity-aid',
      'continuity-secret',
      'continuity-ceasefire',
      'continuity-peace',
      'continuity-owner-control',
    ].includes(c.id)
  ) {
    const execute = (commands: unknown[]) =>
      Object.assign(
        w,
        resolveTurn(
          w,
          {
            expectedRevision: w.revision,
            action: {
              actorNationId: swe.id,
              source: 'system',
              text: 'Recorded benchmark prehistory',
            },
            commands: commands.map((command, index) => ({
              id: `command:pre-${w.revision}-${index}`,
              reason: 'Canonical benchmark setup',
              command,
            })),
          },
          {
            turnId: TurnId.parse(`turn:pre-${w.revision}`),
            actionId: ActionId.parse(`action:pre-${w.revision}`),
            recordedAt: '2026-10-02T00:00:00.000Z',
          },
        ),
      );
    if (['continuity-promise', 'continuity-aid'].includes(c.id)) {
      const n = Negotiation.parse({
        id: 'negotiation:aid-history',
        proposerNationId: fin.id,
        recipientNationId: swe.id,
        topic: 'Aid pledge',
        kind: 'consultation',
        terms: 'Deliver funded aid after reform',
        createdDate: w.date,
        expiresDate: '2025-04-01',
        obligations: [
          {
            issuer: fin.id,
            recipients: [swe.id],
            type: 'aid',
            terms:
              'Deliver at least 4 investment units through completed aid projects',
            strength: 'binding',
            dueDate: '2028-01-01',
            expiry: '2030-01-01',
            condition: {
              kind: 'project',
              initiativeKind: 'aid',
              minimumInvestment: 4,
            },
          },
        ],
      });
      execute([
        { type: 'OPEN_NEGOTIATION', negotiation: n },
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: n.id,
          nationId: swe.id,
          move: 'accept',
          message: 'We agree to funded aid',
        },
      ]);
      for (let i = 0; i < 25; i++)
        execute([
          {
            type: 'ADVANCE_DATE',
            date: new Date(Date.parse(w.date) + 30 * 86400000)
              .toISOString()
              .slice(0, 10),
          },
        ]);
      if (c.id === 'continuity-aid') {
        w.nations.find((n) => n.id === fin.id)!.stats.treasury = 0;
        w.nations.find((n) => n.id === fin.id)!.stats.fiscal = 10;
      }
    } else if (c.id === 'continuity-secret')
      execute([
        {
          type: 'CREATE_EVENT',
          event: {
            id: 'event:unknown-secret',
            type: 'military',
            title: 'Russia secretly prepares northern offensive',
            nationIds: ['nation:rus'],
            regionIds: [],
            treatyIds: [],
            conflictIds: [],
            importance: 90,
            topics: ['military'],
            visibility: 'private',
            status: 'unresolved',
          },
        },
      ]);
    else {
      execute([
        {
          type: 'START_CONFLICT',
          conflict: {
            id: 'conflict:historical',
            name: 'Historical benchmark conflict',
            attackers: [swe.id],
            defenders: [fin.id],
            status: 'active',
            escalation: 30,
          },
        },
      ]);
      if (c.id === 'continuity-owner-control')
        execute([
          {
            type: 'TRANSFER_CONTROL',
            regionId: 'region:ne-fin',
            nationId: swe.id,
          },
        ]);
      else {
        const kind = c.id === 'continuity-peace' ? 'peace' : 'ceasefire';
        const n = Negotiation.parse({
          id: 'negotiation:settlement-history',
          proposerNationId: swe.id,
          recipientNationId: fin.id,
          topic: kind,
          kind,
          conflictId: 'conflict:historical',
          terms: 'End hostilities',
          createdDate: w.date,
          expiresDate: '2025-04-01',
        });
        execute([
          { type: 'OPEN_NEGOTIATION', negotiation: n },
          {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: n.id,
            nationId: fin.id,
            move: 'accept',
            message: 'Accepted',
            treatyId: 'treaty:historical',
          },
        ]);
      }
    }
  }
  if (c.conference) {
    if (c.conference === 'basing')
      fin.strategy.redLines = ['No permanent foreign basing'];
    const nor = w.nations.find((n) => n.id === 'nation:nor')!;
    w.conferences.push(
      Conference.parse({
        id: 'conference:benchmark',
        title: 'Regional interests conference',
        proposer: swe.id,
        parties:
          c.conference === 'secret'
            ? [swe.id, nor.id, 'nation:rus']
            : [swe.id, fin.id, nor.id],
        kind: c.conference === 'peace' ? 'peace' : 'security',
        terms:
          c.conference === 'basing'
            ? 'Permanent Swedish military basing in Finland'
            : c.conference === 'sovereignty'
              ? 'Unconditional surrender of Finnish sovereignty'
              : c.conference === 'secret'
                ? 'Confidential foreign coalition'
                : c.conference === 'peace'
                  ? 'End costly hostilities without territorial concessions'
                  : 'Reciprocal intelligence sharing without permanent foreign bases',
        createdDate: w.date,
        expiresDate: '2026-01-01',
        visibility: c.conference === 'secret' ? 'private' : 'public',
        ...(c.conference === 'peace'
          ? { conflictId: 'conflict:exhausted' }
          : {}),
      }),
    );
  }
  if (c.canonicalPressure === 'sanctions') {
    w.economicLinks.push(
      EconomicLink.parse({
        id: 'economic:benchmark',
        dependentNationId: fin.id,
        partnerNationId: 'nation:rus',
        imports: 70,
        exports: 20,
        energy: 90,
        strategicGoods: 60,
        finance: 30,
        alternatives: 10,
      }),
    );
    w.sanctions.push(
      Sanction.parse({
        id: 'sanction:benchmark',
        issuer: 'nation:rus',
        target: fin.id,
        sector: 'energy',
        intensity: 90,
        startDate: w.date,
        reason: 'Pressure over regional security policy',
      }),
    );
    w.goals.push(
      Goal.parse({
        id: 'goal:adaptation',
        nationId: fin.id,
        title: 'Diversify energy away from sanctions exposure',
        kind: 'economic',
        priority: 95,
        status: 'active',
        progress: 0,
        targetNationIds: [],
        reason: 'Maintain supply under economic coercion',
        createdDate: w.date,
        updatedDate: w.date,
        evaluation: {
          kind: 'dependence',
          partnerNationId: 'nation:rus',
          baseline: 90,
          target: 30,
        },
      }),
    );
  }
  if (c.canonicalPressure === 'crisis')
    w.crises.push(
      Crisis.parse({
        id: 'crisis:benchmark',
        title: 'Security confrontation',
        type: 'security',
        participants: [swe.id, fin.id],
        startDate: w.date,
        trigger: 'Rejected military access demand',
        issues: ['Sovereign access'],
        militaryPosture: 95,
        rhetoric: 95,
        diplomaticBreakdown: 95,
        severity: 95,
        status: 'escalating',
      }),
    );
  const context = buildContext(w, fin.id, [swe.id], { topics: [c.text] });
  const intent = PlayerIntent.parse({
    version: 1,
    actorNationId: swe.id,
    summary: c.text,
    targetNationIds: [fin.id],
    targetRegionIds: [],
    visibility: c.id === 'resolver-secret-disclosure' ? 'private' : 'public',
    intentions: [
      {
        kind: c.role === 'resolver' ? 'other' : 'diplomacy',
        description: c.text,
        sourceClauseIds: [0],
        visibility: 'public',
        targetNationIds: [fin.id],
      },
    ],
  });
  if (c.id === 'resolver-autonomous') intent.intentions[0]!.kind = 'wait';
  const plan = NationPlan.parse({
    version: 1,
    nationId: fin.id,
    stance: 'independent',
    priorities: [],
    intentions: [],
    publicStatement: 'No prior cabinet decision on this specific offer',
    explanation:
      'Evaluate the offer using supplied national interests and canonical facts',
  });
  const schema =
    c.role === 'formalizer'
      ? FormalizerIntent
      : c.role === 'planner'
        ? NationPlanGeneration
        : c.role === 'diplomat'
          ? DiplomaticMove
          : c.role === 'resolver'
            ? ResolutionProposal
            : NarrationResult;
  const payload =
    c.role === 'formalizer'
      ? buildFormalizerPayload(w, { actorNationId: swe.id, text: c.text })
      : c.role === 'planner'
        ? {
            context,
            intent: null,
            activation: { nationId: fin.id, background: true },
            situation: c.text,
            considerations: decisionInputs(context, null),
          }
        : c.role === 'diplomat'
          ? {
              context,
              plan,
              intent,
              negotiationId: null,
              situation: c.history ?? c.text,
              considerations: decisionInputs(context, intent),
            }
          : c.role === 'resolver'
            ? {
                world: w,
                action: {
                  actorNationId: swe.id,
                  source: c.id === 'resolver-autonomous' ? 'system' : 'player',
                  text: c.text,
                },
                intent: c.id === 'resolver-autonomous' ? null : intent,
                plans: [plan, { ...plan, nationId: swe.id }],
                moves: [],
                capabilities: RESOLVER_CAPABILITIES,
                runId: 'benchmark',
                allowedNationIds: w.nations.map((n) => n.id),
                allowedRegionIds: w.regions.map((r) => r.id),
                nextDate: '2025-01-31',
              }
            : {
                version: 1,
                date: w.date,
                eventIds: c.text === 'empty' ? [] : ['event:known'],
                facts:
                  c.text === 'empty'
                    ? []
                    : [
                        {
                          id: 'event:known',
                          title: 'Finland rejects permanent basing',
                        },
                      ],
              };
  return { w, context, intent, plan, schema, payload };
}
export async function evaluateBehavior(
  provider: LlmProvider,
  config: ProviderConfig,
  base: WorldState,
  c: BehaviorCase,
  options: { maxTokens?: number } = {},
) {
  const prepared = prepareBehaviorCase(base, c);
  const prompt = JSON.stringify(prepared.payload);
  const started = performance.now();
  let rawOutput = '',
    structured = false,
    retries = 0;
  let observed: unknown = null;
  let usage: { promptTokens?: number; completionTokens?: number } | undefined;
  const issues: string[] = [];
  try {
    const result = await provider.generateStructured({
      role: c.role,
      model: config.roleModels?.[c.role] ?? config.model,
      system: roleSystem(c.role),
      prompt,
      jsonSchema: z.toJSONSchema(prepared.schema, {
        io: 'input',
        unrepresentable: 'any',
      }),
      temperature: 0,
      maxTokens: options.maxTokens ?? 4000,
    });
    usage = result.usage;
    rawOutput = result.rawText;
    retries = result.retries ?? 0;
    const parsed = prepared.schema.parse(result.value);
    structured = true;
    observed = parsed;
    if (c.role === 'formalizer') {
      const i =
        c.role === 'formalizer'
          ? canonicalizeFormalizerIntent(
              base,
              { actorNationId: base.playerNationId, text: c.text },
              FormalizerIntent.parse(parsed),
            )
          : PlayerIntent.parse(parsed);
      if (i.actorNationId !== base.playerNationId)
        issues.push('Changed player actor');
      if (
        i.targetNationIds.some((id) => !base.nations.some((n) => n.id === id))
      )
        issues.push('Hallucinated entity');
      if (!i.intentions.some((i) => i.kind === c.kind))
        issues.push(`Missing ${c.kind} action`);
      if (i.intentions.length < (c.minimumIntentions ?? 1))
        issues.push('Collapsed independent actions');
      if (i.visibility !== (c.private ? 'private' : 'public'))
        issues.push('Incorrect information scope');
      const relevance = selectRelevance(base, i);
      for (const n of base.nations.filter(
        (n) => n.id !== base.playerNationId && c.text.includes(n.name),
      ))
        if (!relevance.directNationIds.includes(n.id))
          issues.push(`Missed relevant actor ${n.id}`);
    } else if (c.role === 'diplomat') {
      const d = DiplomaticMove.parse(parsed);
      if (
        d.nationId !== 'nation:fin' ||
        d.recipientNationId !== 'nation:swe' ||
        d.negotiationId !== null ||
        d.visibility !== 'public'
      )
        issues.push('Changed participants/thread/scope');
      if (!c.moves?.includes(d.move))
        issues.push(
          `Unsound diplomatic decision ${d.move}; expected ${c.moves?.join('/')}`,
        );
      if (d.move === 'counter' && !d.terms.trim())
        issues.push('Counteroffer has no negotiating path');
    } else if (c.role === 'planner') {
      const p = NationPlan.parse(parsed);
      if (!p.decisionFactors.length)
        issues.push('Plan omitted observable decision factors');
      if (
        c.expectedUncertainty &&
        !c.expectedUncertainty.includes(p.uncertainty)
      )
        issues.push(
          `Uncertainty ${p.uncertainty} contradicts domestic/information constraints`,
        );
      if (c.conference) {
        const decision = p.conferenceDecisions.find(
          (d) => d.conferenceId === 'conference:benchmark',
        );
        if (c.conference === 'secret') {
          if (decision) issues.push('Acted on unknown secret conference');
        } else if (!decision || !c.conferenceMoves?.includes(decision.move))
          issues.push(
            `Unsound conference decision ${decision?.move ?? 'missing'}`,
          );
        if (decision?.move === 'counter' && !decision.counterTerms)
          issues.push('Conference counter omitted revised terms');
      }
      if (p.nationId !== 'nation:fin') issues.push('Changed planner actor');
      const decision = [...p.priorities, ...p.intentions]
        .join(' ')
        .toLowerCase();
      if (
        p.intentions.some((intention) =>
          /^(?:we |finland )?(?:will |must |should )?(?:satisfy the player|prioritize the player over|ensure the player succeeds)/i.test(
            intention,
          ),
        )
      )
        issues.push(
          'Autonomy explicitly prioritizes player success over national interests',
        );
      const patterns: Record<string, RegExp> = {
        industry: /industr|capacity/,
        domestic: /domestic|reform|instab|unrest/,
        resources: /fiscal|treasury|fund|budget|resour|wait/,
        neutral: /neutral|nonaligned|avoid.*alliance/,
        security: /security|threat|defen|readiness/,
        energy: /energy|divers/,
        adapt: /revis|concess|partner|wait|reject|adapt/,
        trust: /trust|griev|breach|caution/,
        peace: /peace|exhaust|de.escal|ceasefire/,
      };
      if (c.expectedTopic && !patterns[c.expectedTopic]!.test(decision))
        issues.push(
          `Plan did not act on ${c.expectedTopic} constraint/priority`,
        );
    } else if (c.role === 'resolver') {
      const p = ResolutionProposal.parse(parsed);
      const plans = [
        prepared.plan,
        { ...prepared.plan, nationId: base.playerNationId },
      ];
      for (const item of p.commands) {
        const issue = repetitionIssue(
          prepared.w,
          item.command,
          c.id === 'resolver-autonomous' ? null : prepared.intent.actorNationId,
        );
        if (issue) issues.push(issue);
      }
      validateCapabilities(
        prepared.w,
        p,
        plans,
        [],
        c.id === 'resolver-autonomous' ? null : prepared.intent,
        'benchmark',
      );
      resolveTurn(
        prepared.w,
        {
          expectedRevision: prepared.w.revision,
          action: {
            actorNationId: base.playerNationId,
            source: 'player',
            text: c.text,
          },
          commands: [
            ...p.commands.map((v, index) => ({
              id: `command:bench-${index}`,
              reason: v.reason,
              command: v.command,
            })),
            {
              id: 'command:bench-time',
              reason: 'Fixed time',
              command: { type: 'ADVANCE_DATE', date: '2025-01-31' },
            },
          ],
        },
        {
          turnId: TurnId.parse('turn:bench'),
          actionId: ActionId.parse('action:bench'),
          recordedAt: '2026-10-02T00:00:00.000Z',
        },
      );
    } else {
      const n = NarrationResult.parse(parsed);
      if (
        n.headlineEventIds.some(
          (id) => c.text === 'empty' || id !== 'event:known',
        )
      )
        issues.push('Narrator invented a fact');
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'retries' in error &&
      typeof error.retries === 'number'
    )
      retries = error.retries;
    issues.push(error instanceof Error ? error.message : 'Generation failed');
  }
  return {
    provider: provider.id,
    model: config.roleModels?.[c.role] ?? config.model,
    configuration: {
      temperature: 0,
      timeoutMs: config.timeoutMs,
      contextTokens: config.contextTokens,
      maxOutputTokens: options.maxTokens ?? 4000,
      retries: config.retries,
      contextBudget: config.contextBudget,
    },
    promptVersion: `mandate-${c.role}-v4-context-v3`,
    contextVersion: prepared.context.templateVersion,
    benchmarkFixtureVersion: 'behavior-fixtures-v2-neutral-cabinet',
    gradingVersion: 'behavior-grading-v2-observable-autonomy',
    suppliedPlan: prepared.plan,
    retries,
    usage,
    repair: 0,
    relevantFacts: prepared.context.canonical,
    expectedBehavior: {
      allowedMoves: c.moves,
      expectedTopic: c.expectedTopic,
      minimumIntentions: c.minimumIntentions,
      conferenceMoves: c.conferenceMoves,
      expectedUncertainty: c.expectedUncertainty,
      requiresDecisionFactors: c.role === 'planner',
    },
    observedBehavior: observed,
    score: issues.length ? 0 : 1,
    failureCategory: !issues.length
      ? null
      : !structured
        ? issues.some((issue) => /timeout|timed out/i.test(issue))
          ? 'timeout'
          : rawOutput
            ? 'invalid-structured-output'
            : 'provider-failure'
        : 'behavioral-inconsistency',
    id: c.id,
    category: c.category,
    role: c.role,
    passed: !issues.length,
    structured,
    issues,
    latencyMs: performance.now() - started,
    contextCharacters: prompt.length,
    contextReferences: contextReferences(prepared.context),
    rawOutput,
  };
}
