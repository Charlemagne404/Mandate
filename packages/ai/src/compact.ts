import { semanticCommandIssue } from './semantic.js';
import { executePlayerTurn } from './player-executor.js';
import { SemanticProposal } from './contracts.js';
import { buildFormalizerPayload } from './perspective.js';
import { z } from 'zod';
import { buildContext } from '@mandate/memory';
import {
  influenceProfile,
  resolveTurn,
  executionCapacity,
} from '@mandate/core';
import {
  ActionId,
  CommandId,
  CommitRequest,
  Initiative,
  Crisis,
  Goal,
  Negotiation,
  Organization,
  OrganizationId,
  Conflict,
  Sanction,
  InfluenceTerm,
  TurnId,
  WorldCommand as WorldCommandSchema,
} from '@mandate/schemas';
import type {
  NationId,
  RegionId,
  WorldState,
  WorldCommand,
} from '@mandate/schemas';
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
import { auditMajorIntentClauses } from './player-executor.js';

// Local inference proposes choices; these recipes are code-owned commands, never model code.
// Consent is a separate government call. The sequential resolver remains authoritative.
export const CompactDecision = z.strictObject({
  choice: z.string().max(120),
  additionalChoices: z.array(z.string().max(120)).max(2),
  reason: z.string().min(1).max(180),
  message: z.string().max(260),
  counterTerms: z.string().max(300),
  counterInfluenceTerms: z.array(InfluenceTerm).max(32).default([]),
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
  classifications: z.array(ClauseClassification).min(1).max(40),
  semanticProposals: z.array(SemanticProposal).max(40).optional(),
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
function actionFamily(c: WorldCommand): string {
  if (['START_INITIATIVE', 'CANCEL_INITIATIVE'].includes(c.type))
    return 'project';
  if (
    [
      'START_CONFLICT',
      'END_CONFLICT',
      'UPDATE_CONFLICT',
      'CONFLICT_ACTION',
      'THEATER_ACTION',
      'MOBILIZE_FORCE',
      'STRATEGIC_ATTACK',
    ].includes(c.type)
  )
    return 'war';
  if (
    [
      'OPEN_NEGOTIATION',
      'RESPOND_NEGOTIATION',
      'CREATE_TREATY',
      'UPDATE_TREATY',
      'END_TREATY',
      'ADJUST_RELATION',
    ].includes(c.type)
  )
    return 'diplomacy';
  if (
    [
      'CREATE_ORGANIZATION',
      'INVITE_TO_ORGANIZATION',
      'RESPOND_ORGANIZATION_INVITATION',
      'SET_ORGANIZATION_MEMBERSHIP',
      'UPDATE_ORGANIZATION',
      'OPEN_CONFERENCE',
      'RESPOND_CONFERENCE',
    ].includes(c.type)
  )
    return 'organization';
  if (['OPEN_CRISIS', 'CRISIS_ACTION'].includes(c.type)) return 'crisis';
  if (['IMPOSE_SANCTION', 'LIFT_SANCTION'].includes(c.type)) return 'sanctions';
  if (
    [
      'SET_ECONOMIC_LINK',
      'TRANSFER_OWNERSHIP',
      'TRANSFER_CONTROL',
      'ADD_CLAIM',
      'REMOVE_CLAIM',
    ].includes(c.type)
  )
    return 'economy';
  return 'domestic';
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
function frontObjective(
  w: WorldState,
  conflict: WorldState['conflicts'][number],
  actor: NationId,
) {
  const own = conflict.attackers.includes(actor)
    ? conflict.attackers
    : conflict.defenders;
  const enemy =
    own === conflict.attackers ? conflict.defenders : conflict.attackers;
  const adjacency = new Map(
    w.scenario.regionAdjacency.map((entry) => [
      entry.regionId,
      entry.neighbors,
    ]),
  );
  const regionsById = new Map(w.regions.map((region) => [region.id, region]));
  const enemyRegionIds = new Set(
    w.regions
      .filter((region) => enemy.includes(region.controllerNationId))
      .map((region) => region.id),
  );
  const reachable = new Set<RegionId>();
  for (const region of w.regions) {
    if (!own.includes(region.controllerNationId)) continue;
    for (const neighborId of adjacency.get(region.id) ?? [])
      if (enemyRegionIds.has(neighborId)) reachable.add(neighborId);
  }
  const neighborNations = new Set(
    w.scenario.neighborhoods?.find((entry) => entry.nationId === actor)
      ?.neighbors ?? [],
  );
  const targets = [...reachable]
    .map((id) => regionsById.get(id)!)
    .concat(
      !w.scenario.regionAdjacency.some((entry) => entry.neighbors.length) &&
        w.regions.length <= 500
        ? w.regions.filter(
            (region) =>
              enemy.includes(region.controllerNationId) &&
              neighborNations.has(region.ownerNationId) &&
              w.regions.some((friendly) =>
                own.includes(friendly.controllerNationId),
              ),
          )
        : [],
    );
  return targets.sort((a, b) => a.id.localeCompare(b.id))[0];
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
    if (
      player &&
      commands.some((c) => semanticCommandIssue(w, intent?.actionGraph, c))
    )
      return;
    if (commands.some((c) => repetitionIssue(w, c, player ? actor : null)))
      return;
    try {
      if (w.regions.length > 1000) {
        // Candidate recipes are code-authored and later pass the complete
        // sequential resolver before commit. Avoid cloning, parsing and
        // asserting the entire regional world once for every option shown to
        // a planner; schema and intent checks still run for each recipe here.
        commands.forEach((command) => WorldCommandSchema.parse(command));
      } else {
        preview(w, commands, run);
      }
      candidates.push({ id, label, commands, family });
    } catch {
      /* Invalid options never reach inference. */
    }
  };
  if (!player) {
    for (const pact of w.treaties.filter(
      (treaty) =>
        treaty.kind === 'influence' &&
        treaty.status === 'active' &&
        treaty.parties.includes(actor),
    )) {
      const patrons = new Set(
        pact.influenceTerms
          .filter((term) => term.subjectNationId === actor)
          .map((term) => term.patronNationId),
      );
      for (const patron of patrons) {
        const profile = influenceProfile(w, patron, actor);
        const terms = pact.influenceTerms.filter(
          (term) =>
            term.subjectNationId === actor && term.patronNationId === patron,
        );
        const arrears = terms.reduce((sum, term) => sum + term.arrears, 0);
        // A government may tolerate a restrictive pact while its bills are
        // current, but sustained nonpayment can trigger an exit even when
        // dependence keeps ordinary sovereignty resistance below the usual
        // threshold.
        if (profile.resistance < 65 && arrears < 6) continue;
        add(
          `end-influence-agreement-${pact.id.slice(7)}-${actor.slice(7)}`,
          `End ${pact.name} with ${w.nations.find((nation) => nation.id === patron)!.name}. Sovereignty resistance ${profile.resistance}/100, leverage ${profile.leverage}/100 and payment arrears ${arrears}; ending it will strain relations and domestic stability but restore policy freedom.`,
          [{ type: 'END_TREATY', treatyId: pact.id, nationId: actor }],
          'diplomacy',
        );
      }
    }
  }
  const invitations = w.organizations.flatMap((organization) =>
    organization.status === 'active'
      ? organization.invitations
          .filter(
            (invitation) =>
              invitation.nationId === actor &&
              invitation.status === 'pending' &&
              invitation.lastMove !== 'counter',
          )
          .map(() => organization)
      : [],
  );
  for (const organization of invitations.slice(0, 2)) {
    const activeTerms = organization.commitments
      .filter((commitment) => commitment.status === 'active')
      .map(
        (commitment) =>
          `${commitment.terms}${commitment.costPerMember ? ` (cost ${commitment.costPerMember} per member every ${commitment.frequencyDays} days)` : ''}`,
      )
      .join('; ');
    for (const move of ['accept', 'reject', 'delay', 'counter'] as const) {
      const command: WorldCommand = {
        type: 'RESPOND_ORGANIZATION_INVITATION',
        organizationId: organization.id,
        nationId: actor,
        move,
        message:
          move === 'accept'
            ? 'The government accepts the invitation.'
            : move === 'reject'
              ? 'The government declines membership.'
              : move === 'counter'
                ? 'The government requests revised membership terms.'
                : 'The government will decide later.',
        ...(move === 'counter'
          ? {
              counterTerms:
                'Clarify the obligations and fiscal terms before membership.',
            }
          : {}),
      };
      add(
        `org-invitation-${organization.id.slice(13)}-${move}`,
        `${move} ${organization.acronym ?? organization.name} invitation. Purpose: ${organization.purpose} Current terms: ${activeTerms || organization.charter}. Consider national interests, cost, sovereignty, and domestic support.`,
        [command],
        'organization',
      );
    }
  }

  const neighbors =
    w.scenario.neighborhoods?.find((entry) => entry.nationId === actor)
      ?.neighbors ?? [];
  const establishedEconomicMembership = w.organizations.some(
    (organization) =>
      organization.status === 'active' &&
      ['economic', 'economic-union', 'trade-bloc', 'customs-union'].includes(
        organization.kind,
      ) &&
      organization.members.includes(actor),
  );
  const cooperativeNeighbors = neighbors
    .filter((id) => {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(id),
      );
      return relation?.score !== undefined && relation.score >= 25;
    })
    .sort((left, right) => {
      const score = (id: NationId) =>
        w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(id),
        )?.score ?? 0;
      return score(right) - score(left) || left.localeCompare(right);
    })
    .slice(0, 3);
  if (!player && !urgentWar(w, actor) && cooperativeNeighbors.length) {
    const target = cooperativeNeighbors.find((nationId) => {
      const open = w.negotiations.some(
        (negotiation) =>
          negotiation.kind === 'influence' &&
          negotiation.status === 'open' &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(actor) &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(nationId),
      );
      return !open;
    });
    if (target) {
      const existingTerms = w.treaties
        .filter(
          (treaty) => treaty.kind === 'influence' && treaty.status === 'active',
        )
        .flatMap((treaty) => treaty.influenceTerms)
        .filter(
          (term) =>
            term.patronNationId === actor && term.subjectNationId === target,
        );
      const missing = (kind: InfluenceTerm['kind']) =>
        !existingTerms.some((term) => term.kind === kind);
      const monthlySupport = Math.max(
        1,
        Math.min(5, Math.floor(own.stats.treasury * 0.01)),
      );
      const influenceTerms = [
        ...(missing('subsidy') && own.stats.treasury >= monthlySupport * 40
          ? [
              InfluenceTerm.parse({
                kind: 'subsidy',
                patronNationId: actor,
                subjectNationId: target,
                amount: monthlySupport,
              }),
            ]
          : []),
        ...(missing('infrastructure-investment') &&
        own.stats.treasury >= monthlySupport * 40
          ? [
              InfluenceTerm.parse({
                kind: 'infrastructure-investment',
                patronNationId: actor,
                subjectNationId: target,
                amount: monthlySupport,
              }),
            ]
          : []),
        ...(missing('preferential-trade')
          ? [
              InfluenceTerm.parse({
                kind: 'preferential-trade',
                patronNationId: actor,
                subjectNationId: target,
              }),
            ]
          : []),
      ];
      if (influenceTerms.length) {
        const targetName = w.nations.find(
          (nation) => nation.id === target,
        )!.name;
        const negotiation = Negotiation.parse({
          id: `negotiation:${run}-${actor.slice(7)}-${target.slice(7)}-economic-influence`,
          proposerNationId: actor,
          recipientNationId: target,
          kind: 'influence',
          topic: `Regional economic partnership with ${targetName}`,
          terms: `A voluntary trade and development package for ${targetName}: recurring support and preferential access are offered without transferring policy authority. Deeper coordination requires a separate accepted agreement.`,
          createdDate: w.date,
          expiresDate: later(w.date, 180),
          influenceTerms,
        });
        add(
          `offer-economic-influence-${target.slice(7)}`,
          `Offer ${targetName} a modest recurring development grant and preferential trade terms. ${influenceTerms.length} typed economic clauses; acceptance is optional and political authority is not included.`,
          [{ type: 'OPEN_NEGOTIATION', negotiation }],
          'diplomacy',
        );
      }
    }

    const openBilateralInfluence = (target: NationId) =>
      w.negotiations.some(
        (negotiation) =>
          negotiation.kind === 'influence' &&
          negotiation.status === 'open' &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(actor) &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(target),
      );
    const alreadyProposedBilateralInfluence = (target: NationId) =>
      candidates.some((candidate) =>
        candidate.commands.some(
          (command) =>
            command.type === 'OPEN_NEGOTIATION' &&
            command.negotiation.kind === 'influence' &&
            [
              command.negotiation.proposerNationId,
              command.negotiation.recipientNationId,
            ].includes(actor) &&
            [
              command.negotiation.proposerNationId,
              command.negotiation.recipientNationId,
            ].includes(target),
        ),
      );
    const activeBilateralTerms = (target: NationId) =>
      w.treaties
        .filter(
          (treaty) =>
            treaty.kind === 'influence' &&
            treaty.status === 'active' &&
            treaty.parties.includes(actor) &&
            treaty.parties.includes(target),
        )
        .flatMap((treaty) => treaty.influenceTerms)
        .filter(
          (term) =>
            term.patronNationId === actor && term.subjectNationId === target,
        );

    const securityTarget = cooperativeNeighbors.find((target) => {
      const targetNation = w.nations.find((nation) => nation.id === target)!;
      const terms = activeBilateralTerms(target);
      return (
        !openBilateralInfluence(target) &&
        !alreadyProposedBilateralInfluence(target) &&
        influenceProfile(w, actor, target).leverage >= 18 &&
        own.stats.military >= targetNation.stats.military * 0.8 &&
        !terms.some((term) => term.kind === 'security-guarantee')
      );
    });
    if (securityTarget) {
      const targetName = w.nations.find(
        (nation) => nation.id === securityTarget,
      )!.name;
      const securityTerms = [
        InfluenceTerm.parse({
          kind: 'security-guarantee',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
        InfluenceTerm.parse({
          kind: 'join-defensive-wars',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
        InfluenceTerm.parse({
          kind: 'military-access',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
      ];
      const negotiation = Negotiation.parse({
        id: `negotiation:${run}-${actor.slice(7)}-${securityTarget.slice(7)}-security-influence`,
        proposerNationId: actor,
        recipientNationId: securityTarget,
        kind: 'influence',
        topic: `Mutual security partnership with ${targetName}`,
        terms: `A defensive security guarantee and military access are offered to ${targetName}; the partner would join only defensive wars involving the patron.`,
        createdDate: w.date,
        expiresDate: later(w.date, 180),
        influenceTerms: securityTerms,
      });
      add(
        `offer-security-influence-${securityTarget.slice(7)}`,
        `Offer ${targetName} a security guarantee for a defensive pact and military access. The terms are optional and scoped to defensive wars.`,
        [{ type: 'OPEN_NEGOTIATION', negotiation }],
        'diplomacy',
      );
    }

    const coordinationTarget = cooperativeNeighbors.find((target) => {
      const terms = activeBilateralTerms(target);
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(target),
      );
      return (
        !openBilateralInfluence(target) &&
        !alreadyProposedBilateralInfluence(target) &&
        influenceProfile(w, actor, target).leverage >= 30 &&
        (relation?.score ?? 0) >= 45 &&
        terms.some((term) => term.kind === 'security-guarantee') &&
        !terms.some((term) =>
          [
            'foreign-policy-consultation',
            'foreign-policy-alignment',
            'foreign-policy-veto',
          ].includes(term.kind),
        )
      );
    });
    if (coordinationTarget) {
      const targetName = w.nations.find(
        (nation) => nation.id === coordinationTarget,
      )!.name;
      const coordinationTerms = [
        InfluenceTerm.parse({
          kind: 'foreign-policy-consultation',
          patronNationId: actor,
          subjectNationId: coordinationTarget,
        }),
        InfluenceTerm.parse({
          kind: 'market-access-concession',
          patronNationId: actor,
          subjectNationId: coordinationTarget,
        }),
      ];
      const negotiation = Negotiation.parse({
        id: `negotiation:${run}-${actor.slice(7)}-${coordinationTarget.slice(7)}-policy-influence`,
        proposerNationId: actor,
        recipientNationId: coordinationTarget,
        kind: 'influence',
        topic: `Foreign-policy consultation with ${targetName}`,
        terms: `Preferential access to the patron's market is offered in exchange for consultation before major foreign-policy decisions. The subject retains the final decision.`,
        createdDate: w.date,
        expiresDate: later(w.date, 180),
        influenceTerms: coordinationTerms,
      });
      add(
        `offer-policy-influence-${coordinationTarget.slice(7)}`,
        `Offer ${targetName} additional market access in exchange for consultation before major foreign-policy decisions. The subject retains the final decision.`,
        [{ type: 'OPEN_NEGOTIATION', negotiation }],
        'diplomacy',
      );
    }
  }
  const establishedSecurityMembership = w.organizations.some(
    (organization) =>
      organization.status === 'active' &&
      ['alliance', 'military-alliance', 'defensive-pact'].includes(
        organization.kind,
      ) &&
      organization.members.includes(actor),
  );
  if (
    !player &&
    !urgentWar(w, actor) &&
    !establishedEconomicMembership &&
    own.stats.economy >= 40 &&
    cooperativeNeighbors.length >= 2
  ) {
    const name = `Regional Economic Cooperation of ${own.name}`;
    const id = OrganizationId.parse(
      'organization:' +
        run +
        '-' +
        actor.slice('nation:'.length) +
        '-regional-economic-cooperation',
    );
    if (!w.organizations.some((organization) => organization.id === id)) {
      const organization = Organization.parse({
        id,
        name,
        acronym: null,
        kind: 'economic-union',
        foundingDate: w.date,
        founders: [actor],
        members: [actor],
        invitedStates: [],
        invitations: [],
        pendingApplications: [],
        purpose:
          'Support gradual trade and economic cooperation among neighboring governments.',
        charter:
          'Voluntary economic coordination; each government decides independently whether to join.',
        commitments: [],
        geographicScope: 'Scenario-defined neighboring countries',
        history: [],
        status: 'active',
        dissolvedDate: null,
        visibility: 'public',
      });
      add(
        `form-regional-economic-cooperation-${actor.slice(7)}`,
        `Create ${name} and invite cooperative neighboring governments; membership remains voluntary and requires each government's independent acceptance.`,
        [
          { type: 'CREATE_ORGANIZATION', organization },
          ...cooperativeNeighbors.map((nationId): WorldCommand => ({
            type: 'INVITE_TO_ORGANIZATION',
            organizationId: id,
            inviterNationId: actor,
            nationId,
          })),
        ],
        'organization',
      );
    }
  }
  const threatenedNeighbors = neighbors.filter((partner) => {
    const relation = w.relations.find(
      (entry) =>
        [entry.nationA, entry.nationB].includes(actor) &&
        [entry.nationA, entry.nationB].includes(partner),
    );
    return (
      (relation?.tension ?? 0) >= 50 ||
      w.conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          [...conflict.attackers, ...conflict.defenders].includes(partner),
      ) ||
      w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 55 &&
          crisis.participants.includes(partner),
      )
    );
  });
  if (
    !player &&
    !establishedSecurityMembership &&
    !urgentWar(w, actor) &&
    own.stats.military >= 40 &&
    threatenedNeighbors.length > 0 &&
    cooperativeNeighbors.length > 0
  ) {
    const organizationId = OrganizationId.parse(
      `organization:${run}-${actor.slice(7)}-regional-defense-compact`,
    );
    const organization = Organization.parse({
      id: organizationId,
      name: `Regional Defense Compact of ${own.name}`,
      acronym: null,
      kind: 'defensive-pact',
      foundingDate: w.date,
      founders: [actor],
      members: [actor],
      invitedStates: [],
      invitations: [],
      pendingApplications: [],
      purpose:
        'Coordinate voluntary consultation and support when members face a shared regional threat.',
      charter:
        'Membership and each security response remain subject to independent government consent.',
      commitments: [],
      geographicScope: 'Scenario-defined neighboring countries',
      history: [],
      status: 'active',
      dissolvedDate: null,
      visibility: 'public',
    });
    add(
      `form-regional-defense-compact-${actor.slice(7)}`,
      `Form a voluntary regional defense compact and invite cooperative neighbors. ${threatenedNeighbors.length} neighboring states face elevated tension or an active regional crisis; responses remain independently decided.`,
      [
        { type: 'CREATE_ORGANIZATION', organization },
        ...cooperativeNeighbors.slice(0, 2).map((nationId): WorldCommand => ({
          type: 'INVITE_TO_ORGANIZATION',
          organizationId,
          inviterNationId: actor,
          nationId,
        })),
      ],
      'organization',
    );
  }
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
    (!war.length &&
      !urgent &&
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
  if (!player && !war.length && own.stats.military >= 45) {
    const adjacency = new Map(
      w.scenario.regionAdjacency.map((entry) => [
        entry.regionId,
        new Set(entry.neighbors),
      ]),
    );
    const controlledByActor = new Set(
      w.regions
        .filter((region) => region.controllerNationId === actor)
        .map((region) => region.id),
    );
    for (const targetNationId of partners) {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(targetNationId),
      );
      const activeBorderCrisis = w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 60 &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(targetNationId),
      );
      const strategicClaimGoal = w.goals.some(
        (goal) =>
          goal.nationId === actor &&
          goal.status !== 'achieved' &&
          goal.status !== 'failed' &&
          goal.status !== 'abandoned' &&
          goal.priority >= 60 &&
          goal.targetNationIds.includes(targetNationId),
      );
      if (
        !activeBorderCrisis &&
        !(
          strategicClaimGoal &&
          (relation?.score ?? 0) <= -45 &&
          (relation?.tension ?? 0) >= 60
        )
      )
        continue;
      const claimedFront = w.regions
        .filter(
          (region) =>
            region.ownerNationId === targetNationId &&
            region.controllerNationId === targetNationId &&
            region.claims.includes(actor) &&
            (adjacency.get(region.id)?.size
              ? [...(adjacency.get(region.id) ?? [])].some((neighbor) =>
                  controlledByActor.has(neighbor),
                )
              : neighbors.includes(targetNationId) &&
                w.regions.some(
                  (neighbor) =>
                    neighbor.ownerNationId === actor &&
                    controlledByActor.has(neighbor.id),
                )),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const target = w.nations.find((nation) => nation.id === targetNationId)!;
      const protectedByTreaty = w.treaties.some(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'defense' &&
          treaty.parties.includes(targetNationId),
      );
      if (
        !claimedFront ||
        protectedByTreaty ||
        own.stats.readiness < 50 ||
        own.stats.treasury < 25 ||
        own.stats.unrest >= 70 ||
        own.stats.military < target.stats.military * 0.7
      )
        continue;
      const landApproach = [...(adjacency.get(claimedFront.id) ?? [])].some(
        (regionId) => controlledByActor.has(regionId),
      );
      const conflict = Conflict.parse({
        id: `conflict:${run}-${actor.slice(7)}-${targetNationId.slice(7)}-border-war`,
        name: `${own.name}–${target.name} Border War`,
        attackers: [actor],
        defenders: [targetNationId],
        status: 'active',
        escalation: 70,
        logistics: Math.max(25, Math.min(75, own.stats.readiness)),
        warGoals: [
          `Secure the claimed border region ${claimedFront.name} after a severe unresolved crisis.`,
        ],
      });
      add(
        `war-open-claimed-border-${targetNationId.slice(7)}`,
        `A severe unresolved border crisis or high-risk territorial objective with ${target.name} remains active. Declare war to pursue the existing claim at ${claimedFront.name}, with substantial exhaustion, fiscal, readiness, and diplomatic costs.`,
        [
          { type: 'START_CONFLICT', conflict },
          {
            type: 'THEATER_ACTION',
            conflictId: conflict.id,
            theaterId: `theater:${run}-${actor.slice(7)}-${targetNationId.slice(7)}-border-front`,
            nationId: actor,
            regionIds: [claimedFront.id],
            posture: landApproach ? 'limited-offensive' : 'naval-pressure',
            allocation: 65,
          },
        ],
        'war',
      );
    }
  }
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
      if (!player && !isOpponent && kind === 'defense') {
        const relation = w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(partner),
        );
        const sharedThreat =
          (relation?.tension ?? 0) >= 35 ||
          w.crises.some(
            (crisis) =>
              crisis.status !== 'resolved' &&
              crisis.severity >= 50 &&
              crisis.participants.includes(partner),
          ) ||
          w.conflicts.some(
            (conflict) =>
              conflict.status === 'active' &&
              [...conflict.attackers, ...conflict.defenders].includes(partner),
          );
        if ((relation?.score ?? 0) < 15 || !sharedThreat) continue;
      }
      if (!player && !isOpponent && kind === 'nonaggression') {
        const relation = w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(partner),
        );
        if (
          (relation?.tension ?? 0) < 45 &&
          !w.crises.some(
            (crisis) =>
              crisis.status !== 'resolved' &&
              crisis.participants.includes(actor) &&
              crisis.participants.includes(partner),
          )
        )
          continue;
      }
      if (
        !player &&
        !isOpponent &&
        kind !== 'trade' &&
        kind !== 'consultation' &&
        kind !== 'defense' &&
        kind !== 'nonaggression'
      )
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
      if (kind === 'peace' && isOpponent) {
        const ownedAndOccupied = w.regions.filter(
          (region) =>
            region.ownerNationId === actor &&
            region.controllerNationId === partner,
        );
        const enemyOccupiedByActor = w.regions.filter(
          (region) =>
            region.ownerNationId === partner &&
            region.controllerNationId === actor,
        );
        const sharedWithdrawalTerms = [
          ...ownedAndOccupied.map((region) => ({
            kind: 'withdrawal' as const,
            regionId: region.id,
            fromNationId: partner,
            toNationId: actor,
          })),
          ...enemyOccupiedByActor.map((region) => ({
            kind: 'withdrawal' as const,
            regionId: region.id,
            fromNationId: actor,
            toNationId: partner,
          })),
        ].slice(0, 8);
        const territorialTerms = enemyOccupiedByActor
          .slice(0, 8)
          .map((region) => ({
            kind: 'territorial-transfer' as const,
            regionId: region.id,
            fromNationId: partner,
            toNationId: actor,
          }));
        const recognitionTerms = w.regions
          .filter(
            (region) =>
              region.ownerNationId === actor && region.claims.includes(partner),
          )
          .slice(0, 8)
          .map((region) => ({
            kind: 'recognize-claim' as const,
            regionId: region.id,
            fromNationId: actor,
            toNationId: partner,
          }));
        const peaceOptions = [
          {
            suffix: 'status-quo',
            label:
              'End the war at current military control lines; preserve legal ownership and occupied control.',
            terms: [],
          },
          ...(sharedWithdrawalTerms.length
            ? [
                {
                  suffix: 'mutual-withdrawal',
                  label: `Return occupied regions to their legal owners in a reciprocal withdrawal (${sharedWithdrawalTerms.length} regions).`,
                  terms: sharedWithdrawalTerms,
                },
              ]
            : []),
          ...(territorialTerms.length
            ? [
                {
                  suffix: 'territorial-cession',
                  label: `Seek negotiated legal cession of up to ${territorialTerms.length} currently occupied regions; military occupation alone does not change ownership.`,
                  terms: territorialTerms,
                },
              ]
            : []),
          ...(recognitionTerms.length
            ? [
                {
                  suffix: 'recognize-claim',
                  label: `Offer recognition of the existing claim held by ${name} to up to ${recognitionTerms.length} regions while preserving current legal ownership.`,
                  terms: recognitionTerms,
                },
              ]
            : []),
        ];
        for (const option of peaceOptions) {
          const peaceDescription = `End the costly war with ${name}. ${option.label}`;
          add(
            `offer-${partner.slice(7)}-peace-${option.suffix}`,
            `Propose a peace settlement to ${name}. Requires independent consent. ${peaceDescription}`,
            [
              {
                type: 'OPEN_NEGOTIATION',
                negotiation: Negotiation.parse({
                  id: `negotiation:${run}-${actor.slice(7)}-${partner.slice(7)}-peace-${option.suffix}`,
                  proposerNationId: actor,
                  recipientNationId: partner,
                  kind: 'peace',
                  conflictId: isOpponent.id,
                  topic: `War settlement with ${name}`,
                  terms: peaceDescription,
                  peaceTerms: option.terms,
                  createdDate: w.date,
                  expiresDate: later(w.date, 180),
                  visibility: 'public',
                }),
              },
            ],
            'diplomacy',
          );
        }
        continue;
      }
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
              : kind === 'defense'
                ? `Propose a mutual defense treaty with ${name}, limited to protection and support if either party is attacked; each government's response remains subject to its legal process.`
                : kind === 'nonaggression'
                  ? `Propose a nonaggression treaty with ${name} while preserving each government's independent foreign policy.`
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
  if (!player) {
    const adjacency = new Map(
      w.scenario.regionAdjacency.map((entry) => [
        entry.regionId,
        new Set(entry.neighbors),
      ]),
    );
    for (const partner of partners) {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(partner),
      );
      const claimFront = w.regions
        .filter(
          (region) =>
            region.ownerNationId === partner &&
            region.claims.includes(actor) &&
            w.regions.some(
              (friendly) =>
                friendly.controllerNationId === actor &&
                (adjacency.get(friendly.id)?.has(region.id) ??
                  (!w.scenario.regionAdjacency.some(
                    (entry) => entry.neighbors.length,
                  ) &&
                    w.scenario.neighborhoods
                      ?.find((entry) => entry.nationId === actor)
                      ?.neighbors.includes(partner))),
            ),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const alreadyInCrisis = w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(partner),
      );
      if (
        claimFront &&
        !alreadyInCrisis &&
        (relation?.tension ?? 0) >= 40 &&
        (relation?.score ?? 0) <= 5
      ) {
        const crisis = Crisis.parse({
          id: `crisis:${run}-${actor.slice(7)}-${partner.slice(7)}-border-claim`,
          title: `Border claim dispute over ${claimFront.name}`,
          type: 'border',
          status: 'emerging',
          participants: [actor, partner],
          interestedActors: [],
          regions: [claimFront.id],
          startDate: w.date,
          visibility: 'public',
          trigger: `A territorial claim on ${claimFront.name} coincides with rising bilateral tension.`,
          issues: [
            `${own.name}'s claim to ${claimFront.name}`,
            'Whether both governments will use talks rather than force',
          ],
          demands: [
            {
              nationId: partner,
              text: `Address ${own.name}'s claim to ${claimFront.name} through talks.`,
              satisfied: false,
            },
          ],
          redLines: [],
          militaryPosture: 55,
          rhetoric: 52,
          diplomaticBreakdown: 48,
          severity: 0,
          deadline: later(w.date, 180),
          conflictId: null,
          negotiationIds: [],
          history: [],
        });
        add(
          `crisis-open-border-claim-${partner.slice(7)}`,
          `Open a public border crisis with ${w.nations.find((nation) => nation.id === partner)!.name} over the existing claim to ${claimFront.name}. This raises diplomatic and military pressure and creates a path for talks; it does not start a war.`,
          [{ type: 'OPEN_CRISIS', crisis }],
          'crisis',
        );
      }
      const pressure = w.crises.find(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 55 &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(partner),
      );
      const hasActiveSanction = w.sanctions.some(
        (sanction) =>
          sanction.status === 'active' &&
          sanction.issuer === actor &&
          sanction.target === partner,
      );
      if (
        pressure &&
        !hasActiveSanction &&
        own.stats.economy >= 30 &&
        (relation?.tension ?? 0) >= 40
      ) {
        const targetName = w.nations.find(
          (nation) => nation.id === partner,
        )!.name;
        const sanction = Sanction.parse({
          id: `sanction:${run}-${actor.slice(7)}-${partner.slice(7)}-trade`,
          issuer: actor,
          target: partner,
          sector: 'trade',
          intensity: 35,
          startDate: w.date,
          endDate: later(w.date, 180),
          status: 'active',
          reason: `Pressure ${targetName} to address the unresolved crisis: ${pressure.title}`,
        });
        add(
          `sanction-crisis-${partner.slice(7)}`,
          `Impose limited trade sanctions on ${targetName} in response to the unresolved crisis. This carries economic cost and may invite retaliation.`,
          [{ type: 'IMPOSE_SANCTION', sanction }],
          'sanctions',
        );
      }
    }
  }
  for (const f of war) {
    const theaters = f.theaters.filter((theater) => theater.nationId === actor);
    if (theaters.length) {
      for (const theater of theaters)
        for (const posture of [
          'hold',
          'reinforce',
          'limited-offensive',
          'major-offensive',
          'withdraw',
          'naval-pressure',
          'prepare-ceasefire',
        ] as const) {
          if (posture === theater.posture) continue;
          const allocation =
            posture === 'major-offensive'
              ? 100
              : posture === 'limited-offensive'
                ? Math.max(45, theater.allocation)
                : theater.allocation;
          add(
            `war-${f.id.slice(9)}-${posture}`,
            `Set ${f.name} theater to ${posture} at ${allocation}% commitment. Current momentum ${theater.momentum}, supply pressure ${theater.supplyPressure}, theater exhaustion ${theater.exhaustion}.`,
            [
              {
                type: 'THEATER_ACTION',
                conflictId: f.id,
                theaterId: theater.id,
                nationId: actor,
                regionIds: theater.regionIds,
                posture,
                allocation,
              },
            ],
            'war',
          );
        }
    } else {
      for (const stance of ['defend', 'reinforce', 'deescalate'] as const)
        add(
          `war-${f.id.slice(9)}-${stance}`,
          `${stance} in ${f.name}; exhaustion ${f.exhaustion}, logistics ${f.logistics}.`,
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
      const target = frontObjective(w, f, actor);
      if (target)
        add(
          `war-${f.id.slice(9)}-open-limited-front`,
          `Open a limited offensive toward the reachable front at ${target.name}. Force movement will be resolved over later months; ownership will not change through occupation.`,
          [
            {
              type: 'THEATER_ACTION',
              conflictId: f.id,
              theaterId: `theater:${run}-${f.id.slice(9)}-${actor.slice(7)}-front`,
              nationId: actor,
              regionIds: [target.id],
              posture: 'limited-offensive',
              allocation: 60,
            },
          ],
          'war',
        );
    }
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
  if (!player) {
    const actionById = new Map(w.actions.map((action) => [action.id, action]));
    const recentFamilies = new Map<string, number>();
    const cutoff = Date.parse(w.date) - 180 * 86400000;
    for (const record of w.commands.slice(-1500)) {
      const action = actionById.get(record.actionId);
      if (
        action?.source !== 'system' ||
        action.actorNationId !== actor ||
        Date.parse(record.simulationDate) < cutoff
      )
        continue;
      const family = actionFamily(record.command);
      recentFamilies.set(family, (recentFamilies.get(family) ?? 0) + 1);
    }
    for (const candidate of candidates) {
      const count = recentFamilies.get(candidate.family) ?? 0;
      if (candidate.family !== 'wait' && count >= 2)
        candidate.label += ` Recent history already contains ${count} ${candidate.family} actions; give a different useful family consideration unless current pressure directly calls for this.`;
    }
  }
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
    organizations: context.canonical.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      acronym: organization.acronym,
      kind: organization.kind,
      purpose: organization.purpose,
      geographicScope: organization.geographicScope,
      members: organization.members,
      invitations: organization.invitations.filter(
        (invitation) => invitation.status === 'pending',
      ),
      applications: organization.pendingApplications.filter(
        (application) => application.status === 'pending',
      ),
      commitments: organization.commitments.filter(
        (commitment) => commitment.status === 'active',
      ),
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
            ...buildFormalizerPayload(w, input.action),
            clauses,
            semanticTask:
              'Return semanticProposals for each clause: action, targets, sources and participants using canonical nation IDs. Asset owners are sources, allies are participants. Resolve target pronouns from the grounded graph; never annex an asset owner without an explicit targeting clause.',
            task: 'Return exactly one classification per supplied clause, in the same order. Classify each exact player clause. Energy, industry, diversification, trade capacity and spending are economy; readiness and armed force are military; reforms are domestic; proposals or talks addressed to another government are diplomacy. A policy mentioning a foreign supplier is NOT automatically diplomacy. Preserve negations and conditionality. Public framing constraints are not secrecy; quiet, secret or unannounced actions are private. Do not add outcomes.',
          },
          [w.saveId],
          repairCalls,
        );
        trace.intent = canonicalizeFormalizerIntent(w, input.action, {
          version: 1,
          ...(draft.semanticProposals
            ? { semanticProposals: draft.semanticProposals }
            : {}),
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
  trace.playerExecution = executePlayerTurn(
    w,
    input.action.source === 'player' ? trace.intent : null,
    trace.id,
  );
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
      ...w.organizations.flatMap((organization) =>
        organization.status === 'active'
          ? organization.invitations
              .filter(
                (invitation) =>
                  invitation.status === 'pending' &&
                  invitation.lastMove !== 'counter' &&
                  invitation.nationId !== w.playerNationId,
              )
              .map((invitation) => invitation.nationId)
          : [],
      ),
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
  const capabilityRanking = [...w.nations].sort(
    (a, b) =>
      b.stats.military +
        b.stats.economy -
        (a.stats.military + a.stats.economy) || a.id.localeCompare(b.id),
  );
  const strategicActors =
    w.scenario.strategicActors ??
    capabilityRanking.slice(0, 8).map((nation) => nation.id);
  const powerAttentionNationId =
    w.revision % 3 === 0 && strategicActors.length
      ? strategicActors[Math.floor(w.revision / 3) % strategicActors.length]!
      : null;
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
  const scheduledRank = new Map(
    scheduled.map((activation, index) => [activation.nationId, index]),
  );
  const actors = [
    ...required,
    ...[
      ...scheduled,
      ...(powerAttentionNationId &&
      !scheduled.some(
        (activation) => activation.nationId === powerAttentionNationId,
      )
        ? [
            {
              nationId: powerAttentionNationId,
              score:
                (w.nations.find(
                  (nation) => nation.id === powerAttentionNationId,
                )?.stats.military ?? 0) /
                  5 +
                (w.nations.find(
                  (nation) => nation.id === powerAttentionNationId,
                )?.stats.economy ?? 0) /
                  10,
              reasons: ['Capability-weighted world attention slot'],
              background: true,
            },
          ]
        : []),
    ]
      .filter(
        (a) =>
          !required.includes(a.nationId) &&
          (w.observerMode || a.nationId !== w.playerNationId),
      )
      .sort((a, b) => {
        const activation = (id: NationId) =>
          scheduled.find((entry) => entry.nationId === id);
        const urgent = (id: NationId) =>
          w.conflicts.some(
            (conflict) =>
              conflict.status === 'active' &&
              [...conflict.attackers, ...conflict.defenders].includes(id),
          ) ||
          pressured(w, id) ||
          w.negotiations.some(
            (n) =>
              n.status === 'open' &&
              n.recipientNationId === id &&
              (w.observerMode || id !== w.playerNationId) &&
              (pressured(w, n.proposerNationId) || w.observerMode),
          );
        if (urgent(a.nationId) !== urgent(b.nationId))
          return urgent(a.nationId) ? -1 : 1;
        if (
          (a.nationId === powerAttentionNationId) !==
          (b.nationId === powerAttentionNationId)
        )
          return a.nationId === powerAttentionNationId ? -1 : 1;
        const rotating = (id: NationId) =>
          activation(id)?.reasons.includes(
            'Guaranteed rotating planning slot',
          ) ?? false;
        if (rotating(a.nationId) !== rotating(b.nationId))
          return rotating(a.nationId) ? -1 : 1;
        // Keep the scheduler's deterministic rotation. WAIT is intentionally
        // commandless, so canonical command history cannot measure whether a
        // government was just given a planning slot.
        return (
          (scheduledRank.get(a.nationId) ?? Number.MAX_SAFE_INTEGER) -
            (scheduledRank.get(b.nationId) ?? Number.MAX_SAFE_INTEGER) ||
          b.score - a.score
        );
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
    (entry) =>
      entry.command.type !== 'OPEN_NEGOTIATION' &&
      !(
        entry.command.type === 'CRISIS_ACTION' &&
        entry.command.move === 'talk' &&
        commands.some(
          (c) =>
            c.command.type === 'OPEN_NEGOTIATION' &&
            c.command.negotiation.id ===
              (entry.command.type === 'CRISIS_ACTION'
                ? entry.command.negotiationId
                : undefined),
        )
      ),
  );
  let working = reactionPreviewCommands.length
    ? preview(
        w,
        reactionPreviewCommands.map((c) => c.command),
        trace.id,
      )
    : w;
  const playerCounteredNegotiationIds = new Set(
    (trace.playerExecution?.commands ?? []).flatMap(({ command }) =>
      command.type === 'RESPOND_NEGOTIATION' && command.move === 'counter'
        ? [command.negotiationId]
        : [],
    ),
  );
  for (const actor of actors) {
    if (input.action.source === 'player' && actor === w.playerNationId)
      continue;
    const pending = working.negotiations
      .filter(
        (n) =>
          n.status === 'open' &&
          n.recipientNationId === actor &&
          !playerCounteredNegotiationIds.has(n.id) &&
          (w.observerMode || actor !== w.playerNationId),
      )
      .slice(0, 2);
    const pendingOrganizationInvitation = working.organizations.some(
      (organization) =>
        organization.status === 'active' &&
        organization.invitations.some(
          (invitation) =>
            invitation.nationId === actor &&
            invitation.status === 'pending' &&
            invitation.lastMove !== 'counter',
        ),
    );
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
        const duplicate =
          n.kind !== 'influence' &&
          working.treaties.some(
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
              influenceTerms: n.influenceTerms,
              peaceTerms: n.peaceTerms,
              history: n.responses.slice(-4),
            },
            options,
            mechanicalConstraint: duplicate
              ? 'An active equivalent treaty already covers these parties. A duplicate cannot create another agreement. Explain this if declining; consent to a replacement cannot be mechanically executed in this turn.'
              : null,
            responseStyle:
              'One sentence each for reason and message, at most 25 words.',
            task: 'Answer the actual terms as this government. Weigh benefits against alternatives, domestic resistance and sovereignty cost. Beneficial low-cost cooperation may be accepted; sovereignty demands may be rejected or narrowed. A counteroffer for an influence agreement must provide typed counterInfluenceTerms. Consultation does not grant a veto. Do not invent agreement or restrictions outside the named scope.',
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
        const counterPeaceTerms =
          move === 'counter' && n.kind === 'peace'
            ? n.peaceTerms
                .flatMap((term) => {
                  if (term.kind !== 'territorial-transfer') return [];
                  const region = working.regions.find(
                    (entry) => entry.id === term.regionId,
                  );
                  return region &&
                    region.controllerNationId === actor &&
                    region.ownerNationId !== actor
                    ? [
                        {
                          kind: 'withdrawal' as const,
                          regionId: region.id,
                          fromNationId: actor,
                          toNationId: region.ownerNationId,
                        },
                      ]
                    : [];
                })
                .slice(0, 8)
            : [];
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
            influenceTerms:
              move === 'counter'
                ? decision.counterInfluenceTerms
                : n.influenceTerms,
            peaceTerms: move === 'counter' ? counterPeaceTerms : n.peaceTerms,
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
                  counterInfluenceTerms: decision.counterInfluenceTerms,
                  counterPeaceTerms,
                }
              : {}),
            ...(move === 'accept' && n.kind !== 'consultation'
              ? {
                  treatyId:
                    n.kind === 'influence'
                      ? (working.treaties.find(
                          (t) =>
                            t.status === 'active' &&
                            t.kind === 'influence' &&
                            t.parties.includes(n.proposerNationId) &&
                            t.parties.includes(n.recipientNationId),
                        )?.id ?? `treaty:${trace.id}-${actor.slice(7)}`)
                      : `treaty:${trace.id}-${actor.slice(7)}`,
                }
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
          !pending.length &&
          !pendingOrganizationInvitation &&
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
              ? 'Choose supplied code-authored actions that implement the actual player request. Put the primary ID in choice, and up to two other needed actions in additionalChoices; otherwise emit an empty additionalChoices array. The chosen command set will pass sequential domain validation before commit; do not invent a treasury threshold to reject an affordable player instruction. Respect negations, conditionality and private framing. If unsupported choose wait and explain the limitation; do not silently substitute a different policy. Long-term directives preserve the exact player wording.'
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
        !w.observerMode &&
        pending.some((n) => n.proposerNationId === w.playerNationId)
      )
        throw new Error(
          `${w.nations.find((n) => n.id === actor)!.name} could not complete an important decision. Retry this turn or test the model in settings. No outcome committed.`,
          { cause: error },
        );
      trace.failures.push(
        `${required.includes(actor) ? 'Required foreign decision deferred' : 'Background government skipped'} for ${actor}: ${error instanceof Error ? error.message : 'inference failed'}`,
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
    action: {
      ...input.action,
      ...(trace.intent?.actionGraph
        ? { semanticGraph: trace.intent.actionGraph }
        : {}),
    },
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
