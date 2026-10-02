import type { NationId, WorldState } from '@mandate/schemas';
import { WorldCommand } from '@mandate/schemas';
import type { ContextBundle } from '@mandate/memory';
import { scopeIntent, splitActionClauses } from './perspective.js';
import type {
  GenerationRequest,
  GenerationResult,
  LlmProvider,
  NationPlan,
  PlayerIntent,
  DiplomaticMove,
} from './contracts.js';

/** Explicit deterministic demo heuristics, not a substitute for natural-language inference. */
export class FakeProvider implements LlmProvider {
  readonly id = 'fake-demo';
  async health() {
    return {
      ok: true,
      message: 'Deterministic demo provider; bounded keyword interpretation',
      models: ['demo-rules-v1'],
    };
  }
  async generateStructured(
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    request.signal?.throwIfAborted();
    const p = JSON.parse(request.prompt) as {
      action: { actorNationId: NationId; text: string };
      nations?: WorldState['nations'];
      regions?: WorldState['regions'];
      nationCatalog?: Array<{ nationId: NationId; name: string }>;
      regionCatalog?: Array<{
        regionId: WorldState['regions'][number]['id'];
        name: string;
        ownerNationId: NationId;
      }>;
      context: ContextBundle;
      intent: PlayerIntent | null;
      plan: NationPlan;
      plans: NationPlan[];
      moves: DiplomaticMove[];
      world: WorldState;
      runId: string;
      nextDate: string;
      facts: Array<{ id: string }>;
      negotiationId?: string | null;
      situation?: string;
    };
    const nations =
      p.nations ??
      p.nationCatalog?.map((nation) => ({
        id: nation.nationId,
        name: nation.name,
      })) ??
      [];
    const regions =
      p.regions ??
      p.regionCatalog?.map((region) => ({
        id: region.regionId,
        name: region.name,
      })) ??
      [];
    let value: unknown;
    switch (request.role) {
      case 'formalizer': {
        const text = p.action.text.toLowerCase();
        const classify = (text: string) => [
          ...(/pact|diplom|cooperat|alliance|trade|negotia|agreement|peace|ceasefire/.test(
            text,
          )
            ? ['diplomacy']
            : []),
          ...(/invest|industr|energy|econom|nuclear|infrastructure/.test(text)
            ? ['economy']
            : []),
          ...(/mobiliz|readiness|reinforce|offensive|military buildup|rearm/.test(
            text,
          )
            ? ['military']
            : []),
          ...(/reform|domestic|legitimacy/.test(text) ? ['domestic'] : []),
          ...(/annex|conquer|transfer|claim|cede|territor/.test(text)
            ? ['territory']
            : []),
        ];
        const clauses = splitActionClauses(p.action.text);
        const intentions = clauses.flatMap((clause, index) => {
          const kinds = classify(clause.toLowerCase());
          return (kinds.length ? kinds : ['wait']).map((kind) => ({
            kind,
            description: clause.slice(0, 2000),
            sourceClauseIds: [index],
            visibility:
              /quiet|secret|privat|not publicly|without publicly/.test(text)
                ? 'private'
                : 'public',
            targetNationIds: nations
              .filter(
                (n) =>
                  n.id !== p.action.actorNationId &&
                  (clause.toLowerCase().includes(n.name.toLowerCase()) ||
                    clause.includes(n.id)),
              )
              .map((n) => n.id),
          }));
        });
        value = {
          version: 1,
          actorNationId: p.action.actorNationId,
          summary: p.action.text.slice(0, 2000),
          targetNationIds: nations
            .filter(
              (n) =>
                n.id !== p.action.actorNationId &&
                (text.includes(n.name.toLowerCase()) ||
                  text.includes(n.id.toLowerCase())),
            )
            .map((n) => n.id),
          targetRegionIds: regions
            .filter((r) => text.includes(r.id))
            .map((r) => r.id),
          visibility: /quiet|secret|privat|not publicly|without publicly/.test(
            text,
          )
            ? 'private'
            : 'public',
          intentions: intentions.slice(0, 12),
        };
        break;
      }
      case 'planner': {
        const own = p.context.canonical.nations.find(
          (n) => n.id === p.context.perspectiveNationId,
        )!;
        const opponent = p.intent?.actorNationId;
        const relation = p.context.canonical.relations.find(
          (r) =>
            [r.nationA, r.nationB].includes(own.id) &&
            opponent &&
            [r.nationA, r.nationB].includes(opponent),
        );
        const demanding =
          /cede|surrender|annex|unconditional|give.*territor/i.test(
            p.intent?.summary ?? '',
          );
        const directlyAddressed =
          p.intent &&
          [p.intent.actorNationId, ...p.intent.targetNationIds].includes(
            own.id,
          );
        const stance =
          demanding && directlyAddressed
            ? 'oppose'
            : directlyAddressed
              ? relation && relation.score < -20
                ? 'counter'
                : 'cooperate'
              : 'independent';
        value = {
          version: 1,
          nationId: own.id,
          stance,
          conferenceDecisions: p.context.canonical.conferences
            .filter(
              (c) =>
                c.status === 'open' &&
                c.visibility === 'public' &&
                c.parties.includes(own.id) &&
                !c.responses.some(
                  (r) =>
                    r.round === c.round &&
                    r.nationId === own.id &&
                    ['accept', 'delay', 'abstain'].includes(r.move),
                ),
            )
            .slice(0, 4)
            .map((c) => ({
              conferenceId: c.id,
              move: /surrender|unconditional|annex/i.test(c.terms)
                ? 'reject'
                : (own.stats.stability ?? 50) < 25
                  ? 'delay'
                  : own.strategy.redLines.some((l) =>
                        /bas(e|es|ing)/i.test(l),
                      ) && /permanent.*bas/i.test(c.terms)
                    ? 'counter'
                    : 'accept',
              message:
                'Current terms evaluated against sovereignty, domestic capacity and declared red lines',
              ...(own.strategy.redLines.some((l) => /bas(e|es|ing)/i.test(l)) &&
              /permanent.*bas/i.test(c.terms)
                ? {
                    counterTerms:
                      'Security consultation without permanent foreign bases',
                  }
                : {}),
            })),
          uncertainty:
            (own.stats.stability ?? 50) < 25 ? 'divided' : 'uncertain',
          decisionFactors: [
            {
              factor: 'domestic',
              assessment: `Stability ${own.stats.stability}; limits foreign commitments`,
              references: [own.id],
            },
            {
              factor: 'trust',
              assessment: `Relationship score ${relation?.score ?? 0}; consent must serve national interests`,
              references: [own.id],
            },
            ...(own.strategy.redLines.length
              ? [
                  {
                    factor: 'red-line',
                    assessment: own.strategy.redLines.join('; ').slice(0, 2000),
                    references: [own.id],
                  },
                ]
              : []),
          ],
          priorities: [
            ...own.strategy.directives
              .filter((d) => d.status === 'active')
              .map((d) => d.text),
            ...p.context.canonical.goals
              .filter(
                (g) =>
                  !['achieved', 'abandoned', 'failed', 'superseded'].includes(
                    g.status,
                  ) && g.nationId === own.id,
              )
              .map((g) => g.title)
              .map((g) => g),
          ].slice(0, 8),
          intentions: [
            ...(p.context.canonical.relations.some((r) => r.score < -50)
              ? [
                  'Maintain security and readiness against concrete foreign threats',
                ]
              : []),
            ...(p.context.canonical.goals.some(
              (g) =>
                g.nationId === own.id &&
                g.title.toLowerCase().includes('energy'),
            )
              ? ['Advance energy diversification through funded projects']
              : []),
            ...((own.stats.treasury ?? 50) < 5
              ? ['Wait for fiscal resources; avoid unfunded investment']
              : []),
            ...(p.context.canonical.negotiations.some(
              (n) => n.status === 'rejected',
            ) || own.strategy.redLines.some((l) => /reject/i.test(l))
              ? [
                  'Adapt rejected proposals with concessions or a different partner',
                ]
              : []),
            ...(p.context.canonical.relations.some((r) => r.grievances.length)
              ? ['Reassess trust after grievances and breached commitments']
              : []),
            ...(p.context.canonical.conflicts.some(
              (c) => c.status === 'active' && c.exhaustion >= 70,
            )
              ? ['Seek peace and de-escalation after war exhaustion']
              : []),
            (own.stats.stability ?? 50) < 45
              ? 'Address domestic instability through political reform'
              : (own.stats.industrial ?? 50) < 40 ||
                  (own.stats.economy ?? 50) < 60
                ? 'Expand industrial capacity with an ongoing initiative'
                : 'Maintain readiness and strategic autonomy',
          ].slice(0, 8),
          publicStatement:
            stance === 'oppose'
              ? 'We reject coercive demands.'
              : stance === 'counter'
                ? 'We require reciprocal terms and further consultation.'
                : 'We will consider cooperation consistent with our interests.',
          explanation:
            'Demo decision derived from canonical relations, goals and bounded national indicators.',
        };
        break;
      }
      case 'diplomat': {
        const own = p.context.canonical.nations.find(
          (n) => n.id === p.context.perspectiveNationId,
        )!;
        const text = p.intent?.summary ?? '';
        const directives = own.strategy.directives
          .filter((d) => d.status === 'active')
          .map((d) => d.text)
          .join(' ');
        const counterpart = p.intent?.actorNationId;
        const relation = p.context.canonical.relations.find(
          (r) =>
            [r.nationA, r.nationB].includes(own.id) &&
            counterpart &&
            [r.nationA, r.nationB].includes(counterpart),
        );
        const prior = p.context.canonical.negotiations.some(
          (n) =>
            n.status === 'rejected' &&
            (n.terms.toLowerCase() === text.toLowerCase() ||
              (/bas(e|es|ing)/i.test(n.terms) &&
                /bas(e|es|ing)/i.test(text) &&
                !/no bases|without.*bas/i.test(text))),
        );
        const impossible =
          /cede|surrender|annex|unconditional|already accepted|without.*consent|atlantis|pretend|ended war.*active|resume war without|claims.*guarantee|expired.*acceptance/i.test(
            text,
          );
        const constrained =
          (/neutral|avoid.*(?:bas|alliance)|reject.*(?:bas|alliance)/i.test(
            directives,
          ) &&
            /bas(e|es|ing)|alliance/i.test(text)) ||
          (own.strategy.redLines.some((l) => /bas(e|es|ing)/i.test(l)) &&
            /bas(e|es|ing)/i.test(text));
        const settlement = p.context.canonical.negotiations.find(
          (n) =>
            n.id === p.negotiationId && ['peace', 'ceasefire'].includes(n.kind),
        );
        const exhausted =
          settlement &&
          p.context.canonical.conflicts.some(
            (f) => f.id === settlement.conflictId && f.exhaustion >= 70,
          );
        const pendingOffer = p.context.canonical.negotiations.find(
          (n) => n.id === p.negotiationId,
        );
        const lowIncentive =
          pendingOffer?.kind === 'consultation' &&
          !pendingOffer.obligations.length &&
          !p.context.canonical.goals.some(
            (g) =>
              g.nationId === own.id &&
              g.kind === 'diplomatic' &&
              !['achieved', 'failed', 'abandoned', 'superseded'].includes(
                g.status,
              ) &&
              counterpart &&
              g.targetNationIds.includes(counterpart),
          ) &&
          !/reciprocal|intelligence|trade|security|energy|defen[sc]e|market|aid|assistance|peace/i.test(
            text,
          );
        const move = lowIncentive
          ? 'ignore'
          : /low.value|no.*(?:benefit|incentive)|unrelated ceremonial/i.test(
                text,
              )
            ? 'ignore'
            : /wait for|information incomplete|verify intelligence/i.test(text)
              ? 'delay'
              : impossible || prior
                ? 'reject'
                : exhausted
                  ? 'accept'
                  : (own.stats.stability ?? 50) < 25
                    ? 'delay'
                    : constrained ||
                        (!exhausted && (relation?.score ?? 0) < -20) ||
                        (/aid/i.test(text) && (own.stats.treasury ?? 0) < 20)
                      ? 'counter'
                      : p.plan.stance === 'oppose'
                        ? 'reject'
                        : p.plan.stance === 'counter'
                          ? 'counter'
                          : 'accept';
        value = {
          version: 1,
          nationId: own.id,
          recipientNationId: counterpart ?? own.id,
          negotiationId: p.negotiationId ?? null,
          move,
          message:
            move === 'reject'
              ? 'The requested terms conflict with our interests or recorded position.'
              : move === 'ignore'
                ? 'No material national interest warrants allocating diplomatic capacity.'
                : move === 'delay'
                  ? 'Domestic instability requires postponement.'
                  : move === 'counter'
                    ? 'We need narrower reciprocal terms consistent with resources and policy.'
                    : 'The reciprocal proposal is compatible with our present interests.',
          terms:
            move === 'counter'
              ? constrained
                ? 'Intelligence cooperation without permanent foreign basing or alliance membership.'
                : /aid/i.test(text)
                  ? 'A limited funded aid project subject to fiscal capacity and a delivery deadline.'
                  : 'Reciprocal cooperation with review after one year.'
              : text,
          visibility: p.intent?.visibility ?? 'public',
        };
        break;
      }
      case 'resolver': {
        const commands: Array<{ command: unknown; reason: string }> = [];
        const extended = p.world as WorldState & {
          initiatives?: Array<{ nationId: NationId; status: string }>;
          negotiations?: Array<{
            id: string;
            proposerNationId: NationId;
            recipientNationId: NationId;
            status: string;
            terms: string;
            kind: string;
          }>;
        };
        const add = (command: unknown, reason: string) =>
          commands.push({ command, reason });
        const text = p.intent?.summary.toLowerCase() ?? '';
        if (p.intent?.intentions.some((i) => i.kind === 'diplomacy')) {
          const kind = /ceasefire/.test(text)
            ? 'ceasefire'
            : /peace/.test(text)
              ? 'peace'
              : /no formal|not.*formal|do not propose|consult|initiative|closer/.test(
                    text,
                  )
                ? 'consultation'
                : /trade/.test(text)
                  ? 'trade'
                  : /pact|alliance|agreement/.test(text)
                    ? /defen|alliance/.test(text)
                      ? 'defense'
                      : 'nonaggression'
                    : 'consultation';
          for (const recipient of p.intent.targetNationIds.slice(0, 4)) {
            const settlement = kind === 'ceasefire' || kind === 'peace';
            const conflict = p.world.conflicts.find(
              (c) =>
                c.status === 'active' &&
                c.attackers.length === 1 &&
                c.defenders.length === 1 &&
                [...c.attackers, ...c.defenders].includes(
                  p.intent!.actorNationId,
                ) &&
                [...c.attackers, ...c.defenders].includes(recipient),
            );
            if (
              settlement &&
              (!conflict ||
                (kind === 'ceasefire' &&
                  conflict.settlementState === 'ceasefire'))
            )
              continue;
            const exists = extended.negotiations?.some(
              (n) =>
                n.status === 'open' &&
                [n.proposerNationId, n.recipientNationId].includes(recipient) &&
                [n.proposerNationId, n.recipientNationId].includes(
                  p.intent!.actorNationId,
                ),
            );
            const treaty = p.world.treaties.some(
              (t) =>
                t.status === 'active' &&
                t.kind === kind &&
                t.parties.includes(recipient) &&
                t.parties.includes(p.intent!.actorNationId),
            );
            if (!exists && !treaty)
              add(
                {
                  type: 'OPEN_NEGOTIATION',
                  negotiation: {
                    id: `negotiation:${p.runId}-${commands.length}`,
                    proposerNationId: p.intent.actorNationId,
                    recipientNationId: recipient,
                    topic: 'Diplomatic consultation',
                    kind,
                    conflictId: settlement ? conflict!.id : null,
                    terms:
                      scopeIntent(p.intent, recipient)?.summary ??
                      'Diplomatic consultation',
                    visibility: p.intent.visibility,
                    status: 'open',
                    createdDate: p.world.date,
                    expiresDate: dateAfter(p.world.date, 90),
                    responses: [],
                    treatyId: null,
                  },
                },
                'Begin a structured negotiation; consent is still pending.',
              );
          }
        }
        // Only one revision-producing counter per conference per turn; later rounds need fresh plans.
        for (const conference of p.world.conferences ?? []) {
          if (conference.status !== 'open') continue;
          const decisions = p.plans
            .flatMap((plan) =>
              plan.conferenceDecisions.map((d) => ({
                ...d,
                nationId: plan.nationId,
              })),
            )
            .filter((d) => d.conferenceId === conference.id);
          const counter = decisions.find((d) => d.move === 'counter');
          for (const d of counter ? [counter] : decisions)
            add(
              {
                type: 'RESPOND_CONFERENCE',
                conferenceId: d.conferenceId,
                nationId: d.nationId,
                move: d.move,
                message: d.message,
                ...(d.counterTerms
                  ? {
                      counterTerms: d.counterTerms,
                      counterPeaceTerms: d.counterPeaceTerms,
                    }
                  : {}),
              },
              'Independent government conference decision',
            );
        }
        for (const n of extended.negotiations ?? []) {
          if (n.status !== 'open') continue;
          const move = p.moves.find(
            (m) =>
              m.nationId === n.recipientNationId &&
              m.recipientNationId === n.proposerNationId &&
              m.negotiationId === n.id,
          );
          if (!move) continue;
          add(
            {
              type: 'RESPOND_NEGOTIATION',
              negotiationId: n.id,
              nationId: move.nationId,
              move: move.move,
              message: move.message,
              ...(move.move === 'counter'
                ? {
                    counterTerms: move.terms,
                    counterObligations: move.obligations,
                    counterPeaceTerms: move.peaceTerms,
                  }
                : {}),
              ...(move.move === 'accept' && n.kind !== 'consultation'
                ? { treatyId: `treaty:${p.runId}-${commands.length}` }
                : {}),
            },
            `Recipient independently chose ${move.move}.`,
          );
        }
        if (
          p.intent &&
          /over.*years|long.term|five years|several years/i.test(
            p.intent.summary,
          )
        ) {
          const owner = p.world.nations.find(
            (n) => n.id === p.intent!.actorNationId,
          )!;
          const energy = /energy|nuclear/i.test(p.intent.summary);
          if (
            !p.world.goals.some(
              (g) =>
                g.nationId === owner.id &&
                !['achieved', 'abandoned', 'failed', 'superseded'].includes(
                  g.status,
                ) &&
                g.title ===
                  (energy
                    ? 'Reduce energy dependence'
                    : 'Develop industrial capacity'),
            )
          ) {
            add(
              {
                type: 'CREATE_STRATEGIC_GOAL',
                goal: {
                  id: `goal:${p.runId}-strategy`,
                  nationId: owner.id,
                  title: energy
                    ? 'Reduce energy dependence'
                    : 'Develop industrial capacity',
                  priority: 80,
                  status: 'active',
                  targetNationIds: p.intent.targetNationIds,
                  progress: 0,
                  reason: p.intent.summary,
                  createdDate: p.world.date,
                  updatedDate: p.world.date,
                  kind: 'economic',
                  visibility: p.intent.visibility,
                  deadline: null,
                  blockers: [],
                  evidence: [],
                  parentGoalId: null,
                  signals: [
                    {
                      stat: energy ? 'energyExposure' : 'industrial',
                      baseline:
                        owner.stats[energy ? 'energyExposure' : 'industrial'],
                      target: energy
                        ? Math.max(0, owner.stats.energyExposure - 20)
                        : Math.min(100, owner.stats.industrial + 20),
                      weight: 100,
                    },
                  ],
                },
              },
              'Multi-year player policy establishes a persistent measurable goal',
            );
          }
        }
        for (const plan of p.plans) {
          const own = p.world.nations.find((n) => n.id === plan.nationId)!;
          for (const conflict of p.world.conflicts.filter(
            (c) =>
              c.status === 'active' &&
              c.settlementState !== 'ceasefire' &&
              [...c.attackers, ...c.defenders].includes(own.id),
          )) {
            const enemySide = conflict.attackers.includes(own.id)
              ? conflict.defenders
              : conflict.attackers;
            const target = p.world.regions.find((r) =>
              enemySide.includes(r.controllerNationId),
            );
            if (
              conflict.exhaustion >= 70 &&
              conflict.attackers.length === 1 &&
              conflict.defenders.length === 1
            ) {
              const counterpart = enemySide[0]!;
              const exists =
                (extended.negotiations ?? []).some(
                  (n) =>
                    n.status === 'open' &&
                    [n.proposerNationId, n.recipientNationId].includes(
                      own.id,
                    ) &&
                    [n.proposerNationId, n.recipientNationId].includes(
                      counterpart,
                    ),
                ) ||
                commands.some((item) => {
                  const c = item.command as {
                    type: string;
                    negotiation?: { conflictId: string };
                  };
                  return (
                    c.type === 'OPEN_NEGOTIATION' &&
                    c.negotiation?.conflictId === conflict.id
                  );
                });
              if (!exists)
                add(
                  {
                    type: 'OPEN_NEGOTIATION',
                    negotiation: {
                      id: `negotiation:${p.runId}-${commands.length}`,
                      proposerNationId: own.id,
                      recipientNationId: counterpart,
                      topic: 'Exhaustion-driven peace talks',
                      kind: 'peace',
                      conflictId: conflict.id,
                      terms:
                        'End hostilities with current control retained and legal ownership unchanged.',
                      visibility: 'public',
                      status: 'open',
                      createdDate: p.world.date,
                      expiresDate: dateAfter(p.world.date, 180),
                      responses: [],
                      treatyId: null,
                    },
                  },
                  'War exhaustion makes continued fighting costly; seek a reciprocal status quo settlement',
                );
            }
            let stance =
              conflict.exhaustion >= 70
                ? 'deescalate'
                : own.stats.readiness < 55 && own.stats.treasury >= 5
                  ? 'mobilize'
                  : own.stats.readiness >= 65 &&
                      own.stats.treasury >= 10 &&
                      target
                    ? 'offensive'
                    : conflict.logistics < 65 && own.stats.treasury >= 5
                      ? 'reinforce'
                      : 'defend';
            if (
              p.intent?.actorNationId === own.id &&
              p.intent.visibility === 'private' &&
              ['mobilize', 'reinforce'].includes(stance)
            )
              stance = 'defend';
            if (
              p.moves.some(
                (m) =>
                  m.move === 'accept' &&
                  m.negotiationId &&
                  extended.negotiations?.some(
                    (n) =>
                      n.id === m.negotiationId &&
                      n.conflictId === conflict.id &&
                      ['ceasefire', 'peace'].includes(n.kind),
                  ),
              )
            )
              continue;
            add(
              {
                type: 'CONFLICT_ACTION',
                conflictId: conflict.id,
                nationId: own.id,
                stance,
                ...(stance === 'offensive' ? { regionId: target!.id } : {}),
              },
              `Strategic posture follows readiness, logistics and war exhaustion for ${own.name}.`,
            );
          }
          for (const crisis of p.world.crises ?? []) {
            if (
              crisis.status === 'resolved' ||
              !crisis.participants.includes(own.id)
            )
              continue;
            const last = crisis.history.at(-1);
            if (
              last &&
              last.nationId === own.id &&
              dateAfter(last.date, 60) > p.world.date
            )
              continue;
            const move =
              crisis.severity >= 60 || own.stats.stability < 40
                ? 'stand-down'
                : crisis.rhetoric > 0 || crisis.diplomaticBreakdown > 0
                  ? 'talk'
                  : null;
            if (move)
              add(
                {
                  type: 'CRISIS_ACTION',
                  crisisId: crisis.id,
                  nationId: own.id,
                  move,
                },
                'Persistent crisis pressure constrains escalation; reduce military risk or restore talks',
              );
          }
          const diplomaticGoal = p.world.goals.find(
            (g) =>
              g.nationId === own.id &&
              !['achieved', 'abandoned', 'failed', 'superseded'].includes(
                g.status,
              ) &&
              g.kind === 'diplomatic' &&
              g.targetNationIds.length,
          );
          if (diplomaticGoal && plan.stance === 'independent') {
            const recipient = diplomaticGoal.targetNationIds[0]!;
            const existing =
              extended.negotiations?.some(
                (n) =>
                  [n.proposerNationId, n.recipientNationId].includes(own.id) &&
                  [n.proposerNationId, n.recipientNationId].includes(recipient),
              ) ||
              commands.some((item) => {
                const parsed = WorldCommand.safeParse(item.command);
                return (
                  parsed.success &&
                  parsed.data.type === 'OPEN_NEGOTIATION' &&
                  [
                    parsed.data.negotiation.proposerNationId,
                    parsed.data.negotiation.recipientNationId,
                  ].includes(own.id) &&
                  [
                    parsed.data.negotiation.proposerNationId,
                    parsed.data.negotiation.recipientNationId,
                  ].includes(recipient)
                );
              });
            if (!existing)
              add(
                {
                  type: 'OPEN_NEGOTIATION',
                  negotiation: {
                    id: `negotiation:${p.runId}-${commands.length}`,
                    proposerNationId: own.id,
                    recipientNationId: recipient,
                    topic: diplomaticGoal.title.slice(0, 160),
                    kind: 'consultation',
                    terms: diplomaticGoal.reason,
                    visibility: diplomaticGoal.visibility,
                    status: 'open',
                    createdDate: p.world.date,
                    expiresDate: dateAfter(p.world.date, 90),
                    responses: [],
                    treatyId: null,
                  },
                },
                'Persistent diplomatic goal activates autonomous consultation.',
              );
          }
          const player = p.intent?.actorNationId === own.id;
          if (!player && plan.stance !== 'independent') continue;
          if (
            !player &&
            extended.initiatives?.some(
              (i) => i.nationId === own.id && i.status === 'active',
            )
          )
            continue;
          const activeGoal = p.world.goals
            .filter(
              (g) =>
                g.nationId === own.id &&
                !['achieved', 'abandoned', 'failed', 'superseded'].includes(
                  g.status,
                ) &&
                !p.world.goals.some((child) => child.parentGoalId === g.id),
            )
            .sort(
              (a, b) =>
                b.priority - a.priority ||
                a.progress - b.progress ||
                a.id.localeCompare(b.id),
            )[0];
          const benefits: Record<string, boolean> = {
            industry:
              own.stats.industrial < 80 ||
              (own.stats.industrial < 100 && own.stats.economy < 80),
            energy: own.stats.energyExposure > 20,
            rearmament: own.stats.readiness < 80 || own.stats.military < 80,
            reform: own.stats.unrest > 10 || own.stats.legitimacy < 70,
            diplomacy: own.stats.influence < 80,
          };
          const effectiveKind =
            activeGoal?.signals.length ||
            activeGoal?.evaluation.kind !== 'capacity'
              ? activeGoal?.kind
              : own.strategy.orientation === 'security'
                ? 'security'
                : own.strategy.orientation === 'economic'
                  ? 'economic'
                  : own.strategy.orientation === 'diplomatic'
                    ? 'diplomatic'
                    : 'domestic';
          const preferred =
            effectiveKind === 'economic'
              ? activeGoal?.signals.some((s) => s.stat === 'energyExposure')
                ? 'energy'
                : 'industry'
              : effectiveKind === 'domestic'
                ? 'reform'
                : effectiveKind === 'diplomatic'
                  ? 'diplomacy'
                  : 'rearmament';
          // A declared criterion outranks generic "comfortable enough" thresholds.
          // Otherwise a stable government can never reach a higher authored stability goal.
          if (activeGoal?.signals.length) {
            const supported: Record<string, string[]> = {
              industry: ['industrial', 'economy'],
              energy: ['energyExposure', 'fiscal'],
              reform: ['stability', 'legitimacy', 'unrest'],
              rearmament: ['military', 'readiness'],
              diplomacy: ['influence'],
            };
            for (const [kind, stats] of Object.entries(supported))
              if (
                activeGoal.signals.some(
                  (s) =>
                    stats.includes(s.stat) &&
                    (s.target > s.baseline
                      ? own.stats[s.stat] < s.target
                      : own.stats[s.stat] > s.target),
                )
              )
                benefits[kind] = true;
          }
          const backgroundKind = [
            preferred,
            'reform',
            'industry',
            'energy',
            'rearmament',
            'diplomacy',
          ]
            .filter((kind) => benefits[kind])
            .sort((a, b) => {
              const recent = (kind: string) =>
                p.world.initiatives.filter(
                  (i) =>
                    i.nationId === own.id &&
                    i.kind === kind &&
                    dateAfter(i.completedDate ?? i.startDate, 360) >
                      p.world.date,
                ).length;
              const priority = (kind: string) =>
                kind === preferred && activeGoal
                  ? activeGoal.priority / 50 + activeGoal.pressure / 30
                  : 0;
              return (
                recent(a) * 2 - priority(a) - (recent(b) * 2 - priority(b))
              );
            })[0];
          const desired = player
            ? p.intent!.intentions.flatMap((i) =>
                i.kind === 'economy'
                  ? [
                      /nuclear|energy/i.test(i.description)
                        ? 'energy'
                        : 'industry',
                    ]
                  : i.kind === 'military'
                    ? ['rearmament']
                    : i.kind === 'domestic'
                      ? ['reform']
                      : [],
              )
            : backgroundKind
              ? [backgroundKind]
              : [];
          for (const kind of new Set(desired)) {
            if (
              extended.initiatives?.some(
                (i) =>
                  i.nationId === own.id &&
                  i.status === 'active' &&
                  'kind' in i &&
                  i.kind === kind,
              )
            )
              continue;
            if (own.stats.treasury < 5) continue;
            add(
              {
                type: 'START_INITIATIVE',
                initiative: {
                  id: `initiative:${p.runId}-${commands.length}`,
                  nationId: own.id,
                  name: `${kind[0]?.toUpperCase()}${kind.slice(1)} program`,
                  kind,
                  startDate: p.world.date,
                  durationDays: /five years/.test(text) ? 1825 : 180,
                  effort: 2,
                  targetNationId: null,
                  visibility: player ? p.intent!.visibility : 'public',
                  status: 'active',
                  progress: 0,
                  invested: 0,
                  dependencies: [],
                },
              },
              player
                ? 'Player policy begins as an ongoing project.'
                : `Autonomous ${own.name} policy responds to national conditions.`,
            );
          }
        }
        value = {
          version: 1,
          explanation:
            'Demo policy proposals and structured diplomacy; deterministic mechanics resolve all effects.',
          commands,
        };
        break;
      }
      case 'critic':
        value = { version: 1, accepted: true, issues: [] };
        break;
      case 'narrator':
        value = {
          version: 1,
          headlineEventIds: p.facts.slice(0, 6).map((f) => f.id),
        };
        break;
      case 'historian':
        value = {
          version: 1,
          perspectiveNationId: p.context.perspectiveNationId,
          sourceEventIds: p.context.exactEventIds,
          text: p.context.recentEvents.map((e) => e.title).join('; '),
        };
        break;
      case 'advisor':
        value = {
          version: 1,
          advice:
            'Review existing commitments and allow ongoing initiatives time to progress.',
        };
        break;
    }
    return { value, rawText: JSON.stringify(value), latencyMs: 0, retries: 0 };
  }
}
function dateAfter(date: string, days: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
