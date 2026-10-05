import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ActionId,
  CommandId,
  InfluenceTerm,
  TreatyId,
  TurnId,
  WorldState,
} from '@mandate/schemas';
import type {
  InfluenceTerm as InfluenceTermShape,
  NationId,
  WorldCommand,
  WorldState as World,
} from '@mandate/schemas';
import {
  assessInfluenceOffer,
  influenceProfile,
  resolveTurn,
} from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { deterministicPlayerIntent, executePlayerAction } from '@mandate/ai';
import { compactCandidates } from '../packages/ai/src/compact.js';

const dateAfterDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const commandEvents: Array<{
  date: string;
  text: string;
  move: string;
  details: string[];
}> = [];
let negotiationSequence = 0;
let world = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
const nicaragua = world.nations.find(
  (nation) => nation.name === 'Nicaragua',
)!.id;
const honduras = world.nations.find((nation) => nation.name === 'Honduras')!.id;
world.playerNationId = nicaragua;
const name = (id: string) =>
  world.nations.find((nation) => nation.id === id)?.name ?? id;
const initialOwners = new Map(
  world.regions.map((region) => [region.id, region.ownerNationId]),
);
const startDate = world.date;
const startHonduras = world.nations.find((nation) => nation.id === honduras)!;
const startingStats = structuredClone(startHonduras.stats);
const startingPatronStats = structuredClone(
  world.nations.find((nation) => nation.id === nicaragua)!.stats,
);
const bilateralTreatyId = () => {
  const current = world.treaties.find(
    (treaty) =>
      treaty.kind === 'influence' &&
      treaty.status === 'active' &&
      treaty.parties.includes(nicaragua) &&
      treaty.parties.includes(honduras),
  );
  return (
    current?.id ?? TreatyId.parse(`treaty:puppetmaster-${negotiationSequence}`)
  );
};

function commit(
  text: string,
  commands: Array<{ command: WorldCommand; reason: string }>,
  actorNationId: NationId,
  source: 'player' | 'system' = 'system',
  semanticGraph?: World['actions'][number]['semanticGraph'],
) {
  const turnNumber = world.revision + 1;
  const run = `puppetmaster-${turnNumber}`;
  world = resolveTurn(
    world,
    {
      expectedRevision: world.revision,
      action: {
        actorNationId,
        source,
        text,
        ...(semanticGraph ? { semanticGraph } : {}),
      },
      commands: commands.map((entry, index) => ({
        id: CommandId.parse(`command:${run}-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse(`turn:${run}`),
      actionId: ActionId.parse(`action:${run}`),
      recordedAt: '2026-10-05T00:00:00.000Z',
    },
  );
  return world;
}

function playerOrder(text: string) {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: nicaragua,
    text,
  });
  const execution = executePlayerAction(
    world,
    intent,
    `puppetmaster-player-${world.revision + 1}`,
  );
  if (!execution.commands.length) return [];
  world = commit(
    text,
    execution.commands,
    nicaragua,
    'player',
    intent.actionGraph,
  );
  return execution.commands.map((entry) => entry.command);
}

function influenceOffer(text: string) {
  const commands = playerOrder(text);
  const negotiation = commands.find(
    (command) =>
      command.type === 'OPEN_NEGOTIATION' &&
      command.negotiation.recipientNationId === honduras,
  );
  if (
    negotiation?.type !== 'OPEN_NEGOTIATION' ||
    negotiation.negotiation.kind !== 'influence'
  ) {
    commandEvents.push({
      date: world.date,
      text,
      move: 'unparsed',
      details: ['No structured influence negotiation was produced.'],
    });
    return;
  }
  const sourceTerms = negotiation.negotiation.influenceTerms;
  const assessment = assessInfluenceOffer(
    world,
    nicaragua,
    honduras,
    sourceTerms,
  );
  negotiationSequence++;
  const stored = world.negotiations.find(
    (entry) => entry.id === negotiation.negotiation.id,
  )!;
  const messages = [
    `Initial national-interest assessment ${assessment.score}: ${assessment.move}.`,
    `Proposed clauses: ${sourceTerms.map((term) => `${term.kind}${term.amount ? ` (${term.amount})` : ''}${term.ratePercent ? ` (${term.ratePercent}%)` : ''}`).join(', ') || 'none'}.`,
    ...assessment.reasons,
  ];
  let targetMove: 'accept' | 'counter' | 'reject' = assessment.move;
  let counterTerms: InfluenceTermShape[] | undefined;

  if (targetMove === 'counter') {
    const existingSignatures = new Set(
      world.treaties
        .filter(
          (treaty) =>
            treaty.status === 'active' &&
            treaty.kind === 'influence' &&
            treaty.parties.includes(nicaragua) &&
            treaty.parties.includes(honduras),
        )
        .flatMap((treaty) => treaty.influenceTerms)
        .map((term) =>
          [
            term.kind,
            term.patronNationId,
            term.subjectNationId,
            term.amount,
            term.ratePercent,
          ].join(':'),
        ),
    );
    const profile = influenceProfile(world, nicaragua, honduras);
    const canSoften = profile.leverage < 65;
    const nicaraguaCash = world.nations.find(
      (nation) => nation.id === nicaragua,
    )!.stats.treasury;
    const existingLoans = world.treaties
      .filter((treaty) => treaty.status === 'active')
      .flatMap((treaty) => treaty.influenceTerms)
      .filter(
        (term) =>
          term.kind === 'loan' &&
          term.patronNationId === nicaragua &&
          term.subjectNationId === honduras,
      )
      .map((term) => term.amount);
    counterTerms = sourceTerms
      .map((term) => {
        const replacement: Partial<
          Record<InfluenceTermShape['kind'], InfluenceTermShape['kind']>
        > = {
          'market-access-concession': 'preferential-trade',
          'foreign-policy-veto': 'foreign-policy-alignment',
          'foreign-policy-alignment': 'foreign-policy-consultation',
          'no-rival-alliance': 'foreign-policy-consultation',
          'join-patron-wars': 'join-defensive-wars',
          'host-bases': 'military-access',
          'war-declaration-approval': 'no-war-against-patron',
        };
        const kind = canSoften
          ? (replacement[term.kind] ?? term.kind)
          : term.kind;
        const amount =
          kind === 'loan' && nicaraguaCash >= 60
            ? Math.max(term.amount + 10, Math.max(0, ...existingLoans) + 10)
            : term.amount;
        return InfluenceTerm.parse({ ...term, kind, amount });
      })
      .filter(
        (term, index, terms) =>
          terms.findIndex(
            (other) =>
              other.kind === term.kind &&
              other.patronNationId === term.patronNationId &&
              other.subjectNationId === term.subjectNationId &&
              other.amount === term.amount &&
              other.ratePercent === term.ratePercent,
          ) === index,
      )
      .filter(
        (term) =>
          !existingSignatures.has(
            [
              term.kind,
              term.patronNationId,
              term.subjectNationId,
              term.amount,
              term.ratePercent,
            ].join(':'),
          ),
      );
    if (
      profile.leverage < 65 &&
      nicaraguaCash >= 100 &&
      !counterTerms.some((term) =>
        [
          'loan',
          'debt-relief',
          'subsidy',
          'infrastructure-investment',
        ].includes(term.kind),
      )
    ) {
      const nextLoan = Math.max(20, Math.max(0, ...existingLoans) + 10);
      counterTerms.push(
        InfluenceTerm.parse({
          kind: 'loan',
          patronNationId: nicaragua,
          subjectNationId: honduras,
          amount: nextLoan,
        }),
      );
    }
    messages.push(
      `Counter clauses: ${counterTerms.map((term) => `${term.kind}${term.amount ? ` (${term.amount})` : ''}${term.ratePercent ? ` (${term.ratePercent}%)` : ''}`).join(', ') || 'none'}.`,
    );
    if (!counterTerms.length) {
      targetMove = 'reject';
      messages.push(
        'The only counteroffer repeated terms already active in the bilateral treaty, so Honduras declined to reopen the agreement.',
      );
    }
    const counterAssessment = assessInfluenceOffer(
      world,
      nicaragua,
      honduras,
      counterTerms,
    );
    if (counterAssessment.score <= assessment.score) {
      targetMove = 'reject';
      messages.push(
        `The government found no material improvement in its softened counteroffer (${counterAssessment.score}) and rejected the proposal.`,
      );
    } else {
      messages.push(
        `Counteroffer replaces or narrows sovereignty clauses; revised assessment ${counterAssessment.score}.`,
      );
    }
  }

  let patronAcceptedCounter = false;
  if (targetMove === 'accept') {
    const treatyId = bilateralTreatyId();
    world = commit(
      'Honduras independently accepts the evaluated influence agreement.',
      [
        {
          command: {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: stored.id,
            nationId: honduras,
            move: 'accept',
            treatyId,
            message: messages.join(' '),
          },
          reason:
            'Honduras accepts the terms under its national-interest assessment.',
        },
      ],
      honduras,
    );
  } else if (targetMove === 'counter' && counterTerms) {
    const monthlyCost = counterTerms
      .filter((term) =>
        ['subsidy', 'infrastructure-investment'].includes(term.kind),
      )
      .reduce((sum, term) => sum + term.amount, 0);
    const existingMonthlyCost =
      world.treaties
        .filter((treaty) => treaty.status === 'active')
        .flatMap((treaty) => treaty.influenceTerms)
        .filter(
          (term) =>
            term.patronNationId === nicaragua &&
            ['subsidy', 'infrastructure-investment'].includes(term.kind),
        )
        .reduce((sum, term) => sum + term.amount, 0) +
      world.organizations.reduce(
        (sum, organization) =>
          sum +
          organization.commitments
            .filter(
              (commitment) =>
                commitment.status === 'active' &&
                commitment.issuer === nicaragua,
            )
            .reduce(
              (organizationSum, commitment) =>
                organizationSum +
                commitment.costPerMember *
                  (commitment.appliesTo === 'all-members'
                    ? Math.max(1, organization.members.length - 1)
                    : Math.max(1, commitment.recipientNationIds.length)),
              0,
            ),
        0,
      );
    const oneTimeCost = counterTerms
      .filter((term) => ['loan', 'debt-relief'].includes(term.kind))
      .reduce((sum, term) => sum + term.amount, 0);
    const patron = world.nations.find((nation) => nation.id === nicaragua)!;
    const canFund =
      existingMonthlyCost + monthlyCost <=
        Math.floor(patron.stats.treasury * 0.1) &&
      oneTimeCost <= Math.floor(patron.stats.treasury * 0.3);
    world = commit(
      'Honduras counters the influence offer with a narrower set of obligations.',
      [
        {
          command: {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: stored.id,
            nationId: honduras,
            move: 'counter',
            counterTerms:
              'Retain the economic and security benefits while narrowing the sovereignty obligations.',
            counterInfluenceTerms: counterTerms,
            message: messages.join(' '),
          },
          reason:
            'Honduras issues a counteroffer reflecting its sovereignty concerns.',
        },
      ],
      honduras,
    );
    const flipped = world.negotiations.find((entry) => entry.id === stored.id)!;
    if (canFund) {
      world = commit(
        'Nicaragua accepts Honduras’s materially improved counteroffer.',
        [
          {
            command: {
              type: 'RESPOND_NEGOTIATION',
              negotiationId: flipped.id,
              nationId: nicaragua,
              move: 'accept',
              treatyId: bilateralTreatyId(),
              message:
                'The revised obligations are affordable and preserve a durable partnership.',
            },
            reason: 'Nicaragua accepts the affordable counteroffer.',
          },
        ],
        nicaragua,
        'player',
      );
      patronAcceptedCounter = true;
    } else {
      world = commit(
        'Nicaragua declines the counteroffer because the requested support is not sustainable.',
        [
          {
            command: {
              type: 'RESPOND_NEGOTIATION',
              negotiationId: flipped.id,
              nationId: nicaragua,
              move: 'reject',
              message:
                'The recurring and one-time costs exceed Nicaragua’s sustainable offer budget.',
            },
            reason: 'The patron rejects an unaffordable counteroffer.',
          },
        ],
        nicaragua,
        'player',
      );
    }
  } else {
    world = commit(
      'Honduras rejects the influence offer after weighing its alternatives and sovereignty costs.',
      [
        {
          command: {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: stored.id,
            nationId: honduras,
            move: 'reject',
            message: `The terms exceed the government's current willingness to surrender autonomy (assessment ${assessment.score}).`,
          },
          reason:
            'Honduras rejects an offer that does not clear its national-interest threshold.',
        },
      ],
      honduras,
    );
  }
  const finalNegotiation = world.negotiations.find(
    (entry) => entry.id === stored.id,
  )!;
  const finalProfile = influenceProfile(world, nicaragua, honduras);
  commandEvents.push({
    date: world.date,
    text,
    move:
      targetMove === 'counter' && patronAcceptedCounter
        ? 'counter/accepted'
        : targetMove,
    details: [
      ...messages,
      ...(patronAcceptedCounter
        ? [
            'Nicaragua accepts the counteroffer after checking recurring affordability.',
          ]
        : []),
      `Result: ${finalNegotiation.status}; derived relationship ${finalProfile.tier}; leverage ${finalProfile.leverage}; resistance ${finalProfile.resistance}.`,
    ],
  });
}

const foundingOrder =
  'Nicaragua forms the CAEU (Central American Economic Union) and invites all countries in Central America. The economic union focuses on voluntary regional trade, shared economic rules, and infrastructure investment.';
playerOrder(foundingOrder);
const caeu = world.organizations.find(
  (organization) => organization.acronym === 'CAEU',
);
if (!caeu) throw new Error('CAEU was not created from the player order.');

// Each invitation is evaluated separately from the named government's current
// relationship and the invitation's lack of mandatory fiscal or security costs.
for (const invitation of [...caeu.invitations]) {
  const target = world.nations.find(
    (nation) => nation.id === invitation.nationId,
  )!;
  const pair = [nicaragua, target.id].sort();
  const relation = world.relations.find(
    (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
  );
  const interest =
    (relation?.trust ?? 50) +
    (relation?.score ?? 0) * 0.35 +
    target.stats.stability * 0.12 -
    target.stats.unrest * 0.2;
  const move = interest >= 44 ? 'accept' : interest >= 30 ? 'delay' : 'reject';
  world = commit(
    `${target.name} independently evaluates its CAEU invitation.`,
    [
      {
        command: {
          type: 'RESPOND_ORGANIZATION_INVITATION',
          organizationId: caeu.id,
          nationId: target.id,
          move,
          message:
            move === 'accept'
              ? 'Regional market access and voluntary economic cooperation benefit the country.'
              : 'The government wants to retain more options before joining.',
        },
        reason: `Invitation decision based on ${target.name}'s bilateral ties, stability, and invitation terms.`,
      },
    ],
    target.id,
  );
}

// Use the same typed negotiation path for the initial demand. Honduras is
// still a voluntary partner here, so an immediate puppet offer should fail on
// its merits rather than toggling status.
influenceOffer('Turn Honduras into a puppet state.');

playerOrder(
  'Nicaragua deepens economic integration with CAEU members and starts building infrastructure connecting the countries.',
);

const campaignMonths = 120;
const annualSnapshots: Array<Record<string, unknown>> = [];
let firstPuppetDate: string | null = null;
let puppetMonthsInCampaign = 0;
for (let month = 1; month <= campaignMonths; month++) {
  if (month === 3) {
    influenceOffer(
      'Offer Honduras 1 treasury unit per month in infrastructure investment in exchange for preferential access to its market.',
    );
  }
  if (month === 18) {
    influenceOffer(
      'Offer Honduras a security guarantee and reliable energy supply in exchange for military access and basing rights.',
    );
  }
  if (month === 30) {
    influenceOffer(
      'Offer Honduras a 20 treasury unit development loan and a security guarantee in exchange for foreign-policy consultation.',
    );
  }
  if (month === 42) {
    influenceOffer(
      'Offer Honduras a 20 treasury unit development loan, a security guarantee, reliable energy supply, and preferential trade access in exchange for aligning its foreign policy with Nicaragua.',
    );
  }
  if (month === 54) {
    influenceOffer(
      'Offer Honduras 1 treasury unit per month as a subsidy and a security guarantee in exchange for joining all our wars.',
    );
  }
  if (month === 66) {
    influenceOffer(
      'Offer Honduras debt relief, reliable energy supply, preferential trade access, and a security guarantee in exchange for a foreign-policy veto over its major decisions.',
    );
  }
  if (month === 78) {
    influenceOffer(
      'Offer Honduras a subsidy of 1 treasury unit per month and a security guarantee in exchange for agreeing not to join rival alliances without consulting us.',
    );
  }
  if (month === 90) {
    influenceOffer(
      'Offer Honduras a security guarantee and 1 treasury unit per month in infrastructure investment in exchange for Honduras not declaring wars without our approval.',
    );
  }
  if (month === 102) {
    influenceOffer(
      'Offer Honduras debt relief in exchange for a 5% government revenue share paid to Nicaragua.',
    );
  }
  if (
    month === 114 &&
    influenceProfile(world, nicaragua, honduras).tier !== 'PUPPET STATE'
  ) {
    influenceOffer('Turn Honduras into a puppet state.');
  }
  const date = dateAfterDays(world.date, 30);
  world = commit(
    `Advance the regional campaign one month to ${date}.`,
    [
      {
        command: { type: 'ADVANCE_DATE', date },
        reason:
          'Advance the deterministic simulation by one 30-day accounting step.',
      },
    ],
    nicaragua,
  );

  // Foreign cabinets can choose the modeled exit path when the same threshold
  // used by their ordinary diplomacy candidate engine is reached.
  const currentProfile = influenceProfile(world, nicaragua, honduras);
  if (currentProfile.tier === 'PUPPET STATE') {
    firstPuppetDate ??= world.date;
    puppetMonthsInCampaign++;
  }
  const currentArrears = currentProfile.activeTerms.reduce(
    (sum, term) => sum + term.arrears,
    0,
  );
  const shouldReviewExit =
    month % 6 === 0 &&
    (currentProfile.resistance >= 65 || currentArrears >= 6) &&
    world.treaties.some(
      (treaty) =>
        treaty.kind === 'influence' &&
        treaty.status === 'active' &&
        treaty.parties.includes(honduras),
    );
  const exit = shouldReviewExit
    ? compactCandidates(
        world,
        honduras,
        `honduras-autonomy-${month}`,
        null,
      ).find((candidate) =>
        candidate.commands.some((command) => command.type === 'END_TREATY'),
      )
    : undefined;
  if (exit && month % 6 === 0) {
    const command = exit.commands.find(
      (candidate) => candidate.type === 'END_TREATY',
    )!;
    world = commit(
      'Honduras cabinet seeks to restore policy autonomy after reassessing the pact.',
      [
        {
          command,
          reason:
            'A high-resistance dependent government exercises its modeled treaty exit option.',
        },
      ],
      honduras,
    );
    commandEvents.push({
      date: world.date,
      text: exit.label,
      move: 'exit',
      details: [
        'The subject government independently terminates an influence treaty.',
      ],
    });
  }
  if (month % 12 === 0) {
    const profile = influenceProfile(world, nicaragua, honduras);
    const target = world.nations.find((nation) => nation.id === honduras)!;
    annualSnapshots.push({
      date: world.date,
      tier: profile.tier,
      leverage: profile.leverage,
      resistance: profile.resistance,
      autonomy: profile.autonomy,
      dependency: profile.dependency,
      treasury: target.stats.treasury,
      debt: target.stats.debt,
      patronTreasury: world.nations.find((nation) => nation.id === nicaragua)!
        .stats.treasury,
      unrest: target.stats.unrest,
      legitimacy: target.stats.legitimacy,
      obligations: profile.activeTerms.map((term) => ({
        kind: term.kind,
        amount: term.amount,
        ratePercent: term.ratePercent,
        paymentsMade: term.paymentsMade,
        arrears: term.arrears,
      })),
    });
  }
}

// A last explicit demand is attempted only if the accumulated relationship has
// not already reached the derived puppet tier.
if (
  influenceProfile(world, nicaragua, honduras).tier !== 'PUPPET STATE' &&
  !commandEvents.some(
    (entry) => entry.text === 'Turn Honduras into a puppet state.',
  )
) {
  influenceOffer('Turn Honduras into a puppet state.');
}

const preDirectiveProfile = influenceProfile(world, nicaragua, honduras);
const preDirectiveTreaty = world.treaties.find(
  (treaty) =>
    treaty.kind === 'influence' &&
    treaty.status === 'active' &&
    treaty.parties.includes(nicaragua) &&
    treaty.parties.includes(honduras),
);
if (
  preDirectiveTreaty &&
  preDirectiveProfile.activeTerms.some((term) =>
    [
      'foreign-policy-consultation',
      'foreign-policy-alignment',
      'foreign-policy-veto',
    ].includes(term.kind),
  )
) {
  playerOrder('Demand Honduras coordinate its foreign policy with Nicaragua.');
}

const finalProfile = influenceProfile(world, nicaragua, honduras);
const hondurasFinal = world.nations.find((nation) => nation.id === honduras)!;
const activeTreaty = world.treaties.find(
  (treaty) =>
    treaty.kind === 'influence' &&
    treaty.status === 'active' &&
    treaty.parties.includes(nicaragua) &&
    treaty.parties.includes(honduras),
);
const bordersChanged = world.regions
  .filter((region) => initialOwners.get(region.id) !== region.ownerNationId)
  .map((region) => ({
    region: region.name,
    from: initialOwners.get(region.id),
    to: region.ownerNationId,
  }));
const report = {
  campaign: {
    scenario: world.scenario.name,
    patron: name(nicaragua),
    target: name(honduras),
    organization: caeu.acronym,
    startDate,
    endDate: world.date,
    elapsedMonths: campaignMonths,
    elapsedYears: Number((campaignMonths / 12).toFixed(1)),
    firstPuppetDate,
    puppetMonthsInCampaign,
    cAeuInvitationDecisions: world.organizations
      .find((organization) => organization.acronym === 'CAEU')
      ?.invitations.map((invitation) => ({
        nation: name(invitation.nationId),
        move: invitation.lastMove,
        status: invitation.status,
      })),
    bordersChanged,
  },
  progression: commandEvents,
  annualSnapshots,
  startingTarget: {
    stats: startingStats,
    profile: influenceProfile(
      WorldState.parse(
        loadScenario(resolve('data/scenarios/global-regional.json')),
      ),
      nicaragua,
      honduras,
    ),
  },
  finalTarget: {
    tier: finalProfile.tier,
    leverage: finalProfile.leverage,
    resistance: finalProfile.resistance,
    autonomy: finalProfile.autonomy,
    autonomyLevels: finalProfile.autonomyLevels,
    dependency: finalProfile.dependency,
    sources: finalProfile.sources,
    obligations: finalProfile.activeTerms.map((term) => ({
      kind: term.kind,
      patronNationId: term.patronNationId,
      subjectNationId: term.subjectNationId,
      amount: term.amount,
      ratePercent: term.ratePercent,
      paidAmount: term.paidAmount,
      paymentsMade: term.paymentsMade,
      arrears: term.arrears,
    })),
    directives: activeTreaty?.directives ?? [],
    treasury: hondurasFinal.stats.treasury,
    debt: hondurasFinal.stats.debt,
    unrest: hondurasFinal.stats.unrest,
    legitimacy: hondurasFinal.stats.legitimacy,
    stability: hondurasFinal.stats.stability,
    military: hondurasFinal.stats.military,
    startingTreasury: startingStats.treasury,
    patronStartingTreasury: startingPatronStats.treasury,
    patronFinalTreasury: world.nations.find(
      (nation) => nation.id === nicaragua,
    )!.stats.treasury,
  },
  campaignSuccess:
    finalProfile.tier === 'PUPPET STATE' &&
    finalProfile.autonomy.foreignPolicy <= 25 &&
    finalProfile.autonomy.military <= 55 &&
    finalProfile.activeTerms.some(
      (term) => term.kind === 'join-defensive-wars',
    ) &&
    finalProfile.activeTerms.some(
      (term) => term.kind === 'no-war-against-patron',
    ) &&
    finalProfile.activeTerms.some((term) =>
      ['foreign-policy-alignment', 'foreign-policy-veto'].includes(term.kind),
    ) &&
    finalProfile.activeTerms.every((term) => term.arrears === 0) &&
    activeTreaty?.directives.at(-1)?.status === 'complied' &&
    bordersChanged.length === 0,
};

const outputDirectory = resolve('.runtime/evaluation');
mkdirSync(outputDirectory, { recursive: true });
const output = resolve(
  outputDirectory,
  `puppetmaster-campaign-${Date.now()}.json`,
);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output,
      campaign: report.campaign,
      finalTarget: report.finalTarget,
      campaignSuccess: report.campaignSuccess,
      progression: commandEvents.map((entry) => ({
        date: entry.date,
        move: entry.move,
        text: entry.text,
        finalDetail: entry.details.at(-1),
      })),
    },
    null,
    2,
  ),
);
