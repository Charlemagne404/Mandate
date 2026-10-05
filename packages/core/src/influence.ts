import type { InfluenceTerm, NationId, WorldState } from '@mandate/schemas';

export const dependencyDimensions = [
  'trade',
  'finance',
  'aid',
  'debt',
  'energy',
  'infrastructure',
  'security',
  'marketAccess',
  'organization',
  'diplomatic',
] as const;
export type DependencyDimension = (typeof dependencyDimensions)[number];
export type AutonomyLevel = 'MINIMAL' | 'LIMITED' | 'HIGH' | 'FULL';
export type SubjectTier =
  | 'INDEPENDENT'
  | 'PARTNER'
  | 'DEPENDENT PARTNER'
  | 'CLIENT STATE'
  | 'PROTECTORATE'
  | 'SUBJECT STATE'
  | 'PUPPET STATE';
export type DefectionRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export interface PuppetRequirement {
  key: string;
  label: string;
  fulfilled: boolean;
}

export interface InfluenceProfile {
  patronNationId: NationId;
  subjectNationId: NationId;
  dependency: Record<DependencyDimension, number>;
  leverage: number;
  autonomy: {
    foreignPolicy: number;
    military: number;
    economic: number;
    domestic: number;
  };
  autonomyLevels: {
    foreignPolicy: AutonomyLevel;
    military: AutonomyLevel;
    economic: AutonomyLevel;
    domestic: AutonomyLevel;
  };
  tier: SubjectTier;
  activeTerms: InfluenceTerm[];
  sources: string[];
  resistance: number;
  defectionRisk: DefectionRisk;
  puppetRequirements: PuppetRequirement[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const annualCapacity = (world: WorldState, nationId: NationId) => {
  const nation = world.nations.find((candidate) => candidate.id === nationId);
  if (!nation) return 1;
  return Math.max(
    12,
    12 *
      Math.max(
        1,
        Math.floor((nation.stats.economy + nation.stats.fiscal) / 25),
      ),
  );
};
const level = (value: number): AutonomyLevel =>
  value <= 25
    ? 'MINIMAL'
    : value <= 55
      ? 'LIMITED'
      : value <= 80
        ? 'HIGH'
        : 'FULL';

function termEffect(kind: InfluenceTerm['kind'], subject: boolean) {
  if (!subject) return 0;
  switch (kind) {
    case 'join-defensive-wars':
      return 30;
    case 'join-patron-wars':
      return 45;
    case 'war-declaration-approval':
      return 35;
    case 'no-war-against-patron':
      return 20;
    case 'military-access':
      return 10;
    case 'host-bases':
      return 20;
    case 'military-planning':
      return 18;
    case 'foreign-policy-consultation':
      return 18;
    case 'foreign-policy-alignment':
      return 42;
    case 'no-rival-alliance':
      return 30;
    case 'support-diplomatic-initiatives':
      return 20;
    case 'foreign-policy-veto':
      return 65;
    case 'economic-policy-approval':
      return 42;
    case 'tribute':
      return 14;
    case 'preferential-trade':
      return 10;
    case 'market-access-concession':
      return 18;
    case 'energy-supply':
      return 5;
    case 'exclusive-market-access':
      return 28;
    case 'customs-alignment':
      return 20;
    case 'common-economic-rules':
      return 14;
    case 'mandatory-procurement':
      return 18;
    case 'debt-repayment':
      return 15;
    case 'loan':
      return 0;
    case 'debt-relief':
      return 0;
    case 'subsidy':
      return -8;
    case 'infrastructure-investment':
      return -4;
    case 'security-guarantee':
      return -5;
    case 'government-security-arrangement':
      return 42;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function activeInfluenceTerms(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
) {
  return world.treaties
    .filter((treaty) => treaty.status === 'active')
    .flatMap((treaty) =>
      treaty.influenceTerms.filter(
        (term) =>
          term.patronNationId === patronNationId &&
          term.subjectNationId === subjectNationId &&
          term.status === 'active',
      ),
    );
}

/**
 * Derive asymmetric dependence from the canonical economic links, paid flows,
 * organization programs, and active legal agreements in a save.
 */
export function influenceProfile(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
): InfluenceProfile {
  const dependency: Record<DependencyDimension, number> = {
    trade: 0,
    finance: 0,
    aid: 0,
    debt: 0,
    energy: 0,
    infrastructure: 0,
    security: 0,
    marketAccess: 0,
    organization: 0,
    diplomatic: 0,
  };
  const sources: string[] = [];
  const link = world.economicLinks.find(
    (candidate) =>
      candidate.dependentNationId === subjectNationId &&
      candidate.partnerNationId === patronNationId,
  );
  if (link) {
    dependency.trade = Math.max(
      link.imports,
      link.exports,
      link.strategicGoods,
    );
    dependency.energy = link.energy;
    dependency.finance = link.finance;
    dependency.infrastructure = link.infrastructure;
    if (dependency.trade)
      sources.push(
        `Modeled trade dependence index: ${dependency.trade}/100 before alternatives adjustment`,
      );
    if (link.finance)
      sources.push(
        `Modeled financial dependence index: ${link.finance}/100 before alternatives adjustment`,
      );
    if (link.energy)
      sources.push(
        `Modeled energy dependence index: ${link.energy}/100 before alternatives adjustment`,
      );
    if (link.infrastructure)
      sources.push(
        `Modeled infrastructure dependence index: ${link.infrastructure}/100 before alternatives adjustment`,
      );
    const alternatives = clamp(link.alternatives + link.adaptation / 2);
    for (const dimension of [
      'trade',
      'finance',
      'energy',
      'infrastructure',
    ] as const)
      dependency[dimension] = clamp(
        (dependency[dimension] * (100 - alternatives * 0.55)) / 100,
      );
  }

  const relation = world.relations.find(
    (candidate) =>
      [candidate.nationA, candidate.nationB].includes(patronNationId) &&
      [candidate.nationA, candidate.nationB].includes(subjectNationId),
  );
  const hasDirectionalLink = world.economicLinks.some(
    (candidate) =>
      [candidate.dependentNationId, candidate.partnerNationId].includes(
        patronNationId,
      ) &&
      [candidate.dependentNationId, candidate.partnerNationId].includes(
        subjectNationId,
      ),
  );
  if (relation?.tradeDependence) {
    // Fall back to the symmetric legacy indicator only where no directed
    // economic exposure has been modeled for the pair.
    if (!hasDirectionalLink)
      dependency.trade = Math.max(
        dependency.trade,
        Math.floor(relation.tradeDependence * 0.45),
      );
    if (!hasDirectionalLink && relation.tradeDependence >= 25)
      sources.push(
        'Integrated trade relationship recorded by the bilateral trade model',
      );
  }

  const capacity = annualCapacity(world, subjectNationId);
  const aidInvested = world.initiatives
    .filter(
      (initiative) =>
        initiative.nationId === patronNationId &&
        initiative.targetNationId === subjectNationId &&
        initiative.kind === 'aid' &&
        initiative.status === 'completed',
    )
    .reduce((sum, initiative) => sum + initiative.invested, 0);
  if (aidInvested) {
    dependency.aid = clamp((aidInvested * 100) / (capacity * 4));
    sources.push(
      `Completed patron aid projects: ${aidInvested} treasury units`,
    );
  }

  let recurringSupport = 0;
  let infrastructureInvestment = 0;
  for (const organization of world.organizations) {
    if (!organization.members.includes(subjectNationId)) continue;
    const sponsored = organization.commitments.filter(
      (commitment) =>
        commitment.status === 'active' &&
        commitment.issuer === patronNationId &&
        commitment.costPerMember > 0 &&
        commitment.paymentsMade > 0 &&
        (commitment.appliesTo === 'all-members' ||
          commitment.recipientNationIds.includes(subjectNationId) ||
          commitment.appliesTo === 'new-members'),
    );
    recurringSupport += sponsored.reduce(
      (sum, commitment) => sum + commitment.costPerMember,
      0,
    );
    for (const program of organization.programs)
      if (
        program.issuerNationId === patronNationId &&
        program.dimension === 'regional-infrastructure' &&
        ['active', 'completed'].includes(program.status) &&
        program.participantNationIds.includes(subjectNationId)
      )
        infrastructureInvestment += program.totalInvested;

    const economicStage =
      organization.development.find(
        (entry) => entry.dimension === 'economic-integration',
      )?.level ?? 0;
    const isEconomic = [
      'economic',
      'economic-union',
      'trade-bloc',
      'customs-union',
    ].includes(organization.kind);
    if (isEconomic && economicStage) {
      const patron = world.nations.find(
        (nation) => nation.id === patronNationId,
      );
      const subject = world.nations.find(
        (nation) => nation.id === subjectNationId,
      );
      const patronCapacity = patron
        ? patron.stats.economy + patron.stats.industrial + patron.stats.fiscal
        : 1;
      const subjectCapacity = subject
        ? subject.stats.economy +
          subject.stats.industrial +
          subject.stats.fiscal
        : 1;
      const sponsorship = organization.founders.includes(patronNationId)
        ? 1
        : 0.55;
      dependency.organization = Math.max(
        dependency.organization,
        clamp(
          economicStage *
            9 *
            sponsorship *
            (0.6 +
              patronCapacity / Math.max(1, patronCapacity + subjectCapacity)),
        ),
      );
      dependency.marketAccess = Math.max(
        dependency.marketAccess,
        clamp(economicStage * 7 * sponsorship),
      );
      sources.push(
        `${organization.acronym ?? organization.name} economic integration: stage ${economicStage}/5`,
      );
    }
  }
  if (recurringSupport) {
    dependency.aid = Math.max(
      dependency.aid,
      clamp((recurringSupport * 12 * 100) / (capacity * 5)),
    );
    sources.push(
      `Recurring patron subsidies: ${recurringSupport} treasury units per month`,
    );
  }
  if (infrastructureInvestment) {
    const score = clamp((infrastructureInvestment * 100) / (capacity * 5));
    dependency.infrastructure = Math.max(dependency.infrastructure, score);
    sources.push(
      `Patron-funded regional infrastructure: ${infrastructureInvestment} treasury units invested`,
    );
  }

  const activeTerms = activeInfluenceTerms(
    world,
    patronNationId,
    subjectNationId,
  );
  const count = (kind: InfluenceTerm['kind']) =>
    activeTerms.filter((term) => term.kind === kind).length;
  const recurringTerm = (kind: InfluenceTerm['kind']) =>
    activeTerms
      .filter((term) => term.kind === kind)
      .reduce((sum, term) => sum + term.amount, 0);
  const annualFlows = ['subsidy', 'infrastructure-investment'].reduce(
    (sum, kind) => sum + recurringTerm(kind as InfluenceTerm['kind']) * 12,
    0,
  );
  if (count('subsidy')) {
    dependency.aid = Math.max(
      dependency.aid,
      clamp((annualFlows * 100) / (capacity * 5)),
    );
    sources.push('Binding patron subsidy agreement');
  }
  if (count('infrastructure-investment')) {
    dependency.infrastructure = Math.max(
      dependency.infrastructure,
      clamp((annualFlows * 100) / (capacity * 6)),
    );
    sources.push('Binding patron infrastructure investment agreement');
  }
  if (
    world.nations.find((nation) => nation.id === subjectNationId)?.stats.debt
  ) {
    const debtTerms = activeTerms.filter(
      (term) => term.kind === 'debt-repayment' || term.kind === 'loan',
    );
    if (debtTerms.length) {
      dependency.debt = clamp(
        25 + debtTerms.reduce((sum, term) => sum + term.amount, 0) * 2,
      );
      sources.push('Outstanding sovereign debt owed under a patron agreement');
    }
  }

  const marketTerms: InfluenceTerm['kind'][] = [
    'preferential-trade',
    'market-access-concession',
    'exclusive-market-access',
    'customs-alignment',
    'common-economic-rules',
    'mandatory-procurement',
  ];
  dependency.marketAccess = Math.max(
    dependency.marketAccess,
    clamp(
      marketTerms.reduce(
        (sum, kind) =>
          sum +
          count(kind) *
            (kind === 'exclusive-market-access'
              ? 32
              : kind === 'market-access-concession'
                ? 12
                : 16),
        0,
      ),
    ),
  );
  if (count('energy-supply')) {
    dependency.energy = Math.max(
      dependency.energy,
      clamp(count('energy-supply') * 24),
    );
    sources.push('Binding patron energy-supply agreement');
  }
  const securityTerms: InfluenceTerm['kind'][] = [
    'join-defensive-wars',
    'join-patron-wars',
    'military-access',
    'host-bases',
    'military-planning',
    'security-guarantee',
  ];
  dependency.security = clamp(
    securityTerms.reduce(
      (sum, kind) =>
        sum + count(kind) * (kind === 'join-patron-wars' ? 35 : 20),
      0,
    ),
  );
  const diplomaticTerms: InfluenceTerm['kind'][] = [
    'foreign-policy-consultation',
    'foreign-policy-alignment',
    'no-rival-alliance',
    'support-diplomatic-initiatives',
    'foreign-policy-veto',
  ];
  dependency.diplomatic = clamp(
    diplomaticTerms.reduce(
      (sum, kind) =>
        sum +
        count(kind) *
          (kind === 'foreign-policy-veto'
            ? 45
            : kind === 'foreign-policy-alignment'
              ? 30
              : 14),
      0,
    ),
  );
  const diplomacyInvested = world.initiatives
    .filter(
      (initiative) =>
        initiative.nationId === patronNationId &&
        initiative.targetNationId === subjectNationId &&
        initiative.kind === 'diplomacy' &&
        initiative.status === 'completed',
    )
    .reduce((sum, initiative) => sum + initiative.invested, 0);
  if (diplomacyInvested) {
    dependency.diplomatic = Math.max(
      dependency.diplomatic,
      clamp((diplomacyInvested * 100) / (capacity * 5)),
    );
    sources.push(
      `Completed patron diplomatic outreach: ${diplomacyInvested} treasury units invested`,
    );
  }
  if (dependency.marketAccess && marketTerms.some((kind) => count(kind)))
    sources.push('Binding preferential-market, procurement, or customs terms');
  if (dependency.security && securityTerms.some((kind) => count(kind)))
    sources.push('Binding security guarantee, access, or defense obligations');
  if (dependency.diplomatic && diplomaticTerms.some((kind) => count(kind)))
    sources.push('Binding foreign-policy coordination or consultation');

  const weighted = [
    dependency.trade * 0.14,
    dependency.finance * 0.1,
    dependency.aid * 0.12,
    dependency.debt * 0.08,
    dependency.energy * 0.1,
    dependency.infrastructure * 0.1,
    dependency.security * 0.12,
    dependency.marketAccess * 0.08,
    dependency.organization * 0.08,
    dependency.diplomatic * 0.08,
  ];
  const leverage = clamp(weighted.reduce((sum, value) => sum + value, 0));
  const legalForeign = activeTerms.reduce(
    (sum, term) =>
      sum +
      (term.kind === 'economic-policy-approval'
        ? 0
        : termEffect(term.kind, true)),
    0,
  );
  const legalMilitary = activeTerms.reduce((sum, term) => {
    if (
      [
        'join-defensive-wars',
        'join-patron-wars',
        'war-declaration-approval',
        'no-war-against-patron',
        'military-access',
        'host-bases',
        'military-planning',
      ].includes(term.kind)
    )
      return sum + termEffect(term.kind, true);
    return sum;
  }, 0);
  const legalEconomic = activeTerms.reduce((sum, term) => {
    if (
      [
        'tribute',
        'preferential-trade',
        'exclusive-market-access',
        'customs-alignment',
        'market-access-concession',
        'common-economic-rules',
        'mandatory-procurement',
        'debt-repayment',
        'economic-policy-approval',
      ].includes(term.kind)
    )
      return sum + termEffect(term.kind, true);
    return sum;
  }, 0);
  if (count('economic-policy-approval'))
    sources.push(
      'Binding patron approval over independent economic agreements',
    );
  const domesticTerm = activeTerms.some(
    (term) => term.kind === 'government-security-arrangement',
  );
  const autonomy = {
    foreignPolicy: clamp(
      100 -
        legalForeign -
        dependency.diplomatic * 0.25 -
        dependency.organization * 0.08,
    ),
    military: clamp(100 - legalMilitary - dependency.security * 0.22),
    economic: clamp(
      100 -
        legalEconomic -
        (dependency.trade * 0.16 +
          dependency.finance * 0.12 +
          dependency.aid * 0.1 +
          dependency.debt * 0.16 +
          dependency.energy * 0.12 +
          dependency.infrastructure * 0.12 +
          dependency.marketAccess * 0.16 +
          dependency.organization * 0.06),
    ),
    domestic: domesticTerm ? 58 : 100,
  };
  const has = (...kinds: InfluenceTerm['kind'][]) =>
    activeTerms.some((term) => kinds.includes(term.kind));
  const hasEconomicObligation = activeTerms.some(
    (term) =>
      (term.kind === 'tribute' && (term.amount > 0 || term.ratePercent > 0)) ||
      (term.kind === 'debt-repayment' && term.amount > 0) ||
      ['exclusive-market-access', 'mandatory-procurement'].includes(term.kind),
  );
  const puppetRequirements: PuppetRequirement[] = [
    {
      key: 'foreign-policy-veto',
      label: 'Patron approval over major foreign-policy agreements',
      fulfilled: has('foreign-policy-veto'),
    },
    {
      key: 'foreign-policy-alignment',
      label: 'Binding alignment on major patron foreign-policy decisions',
      fulfilled: has('foreign-policy-alignment'),
    },
    {
      key: 'war-declaration-approval',
      label: 'Independent war declarations require patron approval',
      fulfilled: has('war-declaration-approval'),
    },
    {
      key: 'join-patron-wars',
      label: 'Binding support for patron wars',
      fulfilled: has('join-patron-wars'),
    },
    {
      key: 'no-war-against-patron',
      label: 'Non-aggression toward patron',
      fulfilled: has('no-war-against-patron'),
    },
    {
      key: 'military-access',
      label: 'Military access or basing rights',
      fulfilled: has('military-access', 'host-bases'),
    },
    {
      key: 'no-rival-alliance',
      label: 'Restriction on rival alliances',
      fulfilled: has('no-rival-alliance'),
    },
    {
      key: 'economic-obligation',
      label: 'Binding economic obligation',
      fulfilled: hasEconomicObligation,
    },
  ];
  const hasSecurityPact = activeTerms.some(
    (term) => term.kind === 'security-guarantee',
  );
  const hasProtectorateTerms =
    hasSecurityPact &&
    has('join-defensive-wars') &&
    has('military-access', 'host-bases');
  const foreignAuthority = has(
    'foreign-policy-consultation',
    'foreign-policy-alignment',
    'foreign-policy-veto',
    'no-rival-alliance',
    'support-diplomatic-initiatives',
  );
  const militaryAuthority = has(
    'join-defensive-wars',
    'join-patron-wars',
    'war-declaration-approval',
    'no-war-against-patron',
    'military-access',
    'host-bases',
  );
  const economicAuthority = activeTerms.some((term) =>
    [
      'tribute',
      'preferential-trade',
      'market-access-concession',
      'energy-supply',
      'exclusive-market-access',
      'customs-alignment',
      'common-economic-rules',
      'mandatory-procurement',
      'debt-repayment',
      'economic-policy-approval',
    ].includes(term.kind),
  );
  const materialEconomicDependencies = [
    dependency.trade,
    dependency.finance,
    dependency.aid,
    dependency.debt,
    dependency.energy,
    dependency.infrastructure,
    dependency.marketAccess,
    dependency.organization,
  ];
  // Reuse the UI's modeled dependence bands: one high channel or two
  // moderate channels indicate material dependence without treating total
  // leverage as an arbitrary tier XP score.
  const materiallyDependent =
    materialEconomicDependencies.some((value) => value >= 55) ||
    materialEconomicDependencies.filter((value) => value >= 30).length >= 2;
  const fullPuppetAuthority =
    puppetRequirements.every((requirement) => requirement.fulfilled) &&
    autonomy.foreignPolicy <= 25 &&
    autonomy.military <= 25;
  let tier: SubjectTier = 'INDEPENDENT';
  if (fullPuppetAuthority) tier = 'PUPPET STATE';
  else if (
    foreignAuthority &&
    militaryAuthority &&
    economicAuthority &&
    autonomy.foreignPolicy <= 45 &&
    autonomy.military <= 50
  )
    tier = 'SUBJECT STATE';
  else if (hasProtectorateTerms && autonomy.military <= 65)
    tier = 'PROTECTORATE';
  else if (
    (foreignAuthority && economicAuthority) ||
    (militaryAuthority && economicAuthority)
  )
    tier = 'CLIENT STATE';
  else if (materiallyDependent) tier = 'DEPENDENT PARTNER';
  else if (
    world.treaties.some(
      (treaty) =>
        treaty.status === 'active' &&
        treaty.parties.includes(patronNationId) &&
        treaty.parties.includes(subjectNationId),
    ) ||
    world.organizations.some(
      (organization) =>
        organization.status === 'active' &&
        organization.members.includes(patronNationId) &&
        organization.members.includes(subjectNationId),
    )
  )
    tier = 'PARTNER';

  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  const directedAlternatives = world.economicLinks
    .filter(
      (candidate) =>
        candidate.dependentNationId === subjectNationId &&
        candidate.partnerNationId !== patronNationId,
    )
    .reduce((sum, candidate) => sum + candidate.alternatives, 0);
  const alternativeCount = world.organizations.filter(
    (organization) =>
      organization.status === 'active' &&
      organization.members.includes(subjectNationId) &&
      !organization.members.includes(patronNationId),
  ).length;
  const sovereigntyCost = activeTerms.reduce(
    (sum, term) => sum + Math.max(0, termEffect(term.kind, true)),
    0,
  );
  const matchingTreaties = world.treaties.filter(
    (treaty) =>
      treaty.status === 'active' &&
      treaty.kind === 'influence' &&
      treaty.parties.includes(patronNationId) &&
      treaty.parties.includes(subjectNationId),
  );
  const governmentReview = matchingTreaties.some((treaty) => {
    const ratified = treaty.ratificationGovernments.find(
      (entry) => entry.nationId === subjectNationId,
    )?.government;
    return Boolean(
      ratified &&
      (ratified.type !== subject?.government.type ||
        ratified.ideology !== subject?.government.ideology),
    );
  });
  if (governmentReview)
    sources.push(
      'Government changed since ratification; the new administration is reassessing the terms',
    );
  const patronPromiseBreaches = matchingTreaties
    .flatMap((treaty) => treaty.breaches)
    .filter(
      (breach) =>
        breach.violatingNationId === patronNationId &&
        breach.injuredNationId === subjectNationId &&
        breach.status === 'open',
    ).length;
  const coercionCount = world.negotiations.filter(
    (negotiation) =>
      negotiation.proposerNationId === patronNationId &&
      negotiation.recipientNationId === subjectNationId &&
      negotiation.conditionalPressure?.status === 'triggered',
  ).length;
  const yearsUnderUnequalTerms = matchingTreaties
    .filter((treaty) =>
      treaty.influenceTerms.some(
        (term) =>
          term.status === 'active' &&
          term.subjectNationId === subjectNationId &&
          termEffect(term.kind, true) >= 20,
      ),
    )
    .reduce(
      (maximum, treaty) =>
        Math.max(
          maximum,
          Math.max(
            0,
            Math.floor(
              (Date.parse(world.date) -
                Date.parse(treaty.ratifiedDate ?? world.date)) /
                (365 * 86_400_000),
            ),
          ),
        ),
      0,
    );
  const relationTrust = relation?.trust ?? 50;
  if (patronPromiseBreaches)
    sources.push(
      `Open patron grievance: ${patronPromiseBreaches} unaddressed promise breach${patronPromiseBreaches === 1 ? '' : 'es'}`,
    );
  const resistance = clamp(
    (subject?.stats.stability ?? 50) * 0.12 +
      (subject?.stats.legitimacy ?? 50) * 0.1 +
      (subject?.stats.military ?? 50) * 0.12 +
      (subject?.stats.unrest ?? 10) * 0.12 +
      Math.min(24, directedAlternatives * 0.08 + alternativeCount * 5) +
      Math.min(24, sovereigntyCost * 0.18) +
      (governmentReview ? 12 : 0) +
      patronPromiseBreaches * 6 +
      Math.min(21, coercionCount * 7) +
      Math.min(15, Math.max(0, yearsUnderUnequalTerms - 1) * 2) +
      Math.max(0, Math.floor((45 - relationTrust) * 0.35)) -
      leverage * 0.24 -
      dependency.aid * 0.08 -
      dependency.security * 0.08,
  );
  const defectionRisk: DefectionRisk =
    resistance >= 70
      ? 'CRITICAL'
      : resistance >= 55
        ? 'HIGH'
        : resistance >= 38
          ? 'MODERATE'
          : 'LOW';

  return {
    patronNationId,
    subjectNationId,
    dependency,
    leverage,
    autonomy,
    autonomyLevels: {
      foreignPolicy: level(autonomy.foreignPolicy),
      military: level(autonomy.military),
      economic: level(autonomy.economic),
      domestic: level(autonomy.domestic),
    },
    tier,
    activeTerms,
    sources: [...new Set(sources)],
    resistance,
    defectionRisk,
    puppetRequirements,
  };
}

export interface InfluenceOfferAssessment {
  score: number;
  move: 'accept' | 'counter' | 'reject';
  resistance: number;
  offeredBenefit: number;
  sovereigntyCost: number;
  competingPatronNationId: NationId | null;
  competingLeverage: number;
  reasons: string[];
}

/** A deterministic national-interest signal for autonomous diplomats and playtests. */
export function assessInfluenceOffer(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  offeredTerms: readonly InfluenceTerm[],
): InfluenceOfferAssessment {
  const current = influenceProfile(world, patronNationId, subjectNationId);
  const otherPatrons = new Set<NationId>();
  for (const link of world.economicLinks)
    if (
      link.dependentNationId === subjectNationId &&
      link.partnerNationId !== patronNationId
    )
      otherPatrons.add(link.partnerNationId);
  for (const treaty of world.treaties)
    if (treaty.status === 'active')
      for (const term of treaty.influenceTerms)
        if (
          term.status === 'active' &&
          term.subjectNationId === subjectNationId &&
          term.patronNationId !== patronNationId
        )
          otherPatrons.add(term.patronNationId);
  for (const initiative of world.initiatives)
    if (
      initiative.status === 'completed' &&
      initiative.targetNationId === subjectNationId &&
      initiative.nationId !== patronNationId
    )
      otherPatrons.add(initiative.nationId);
  for (const organization of world.organizations) {
    if (
      organization.status !== 'active' ||
      !organization.members.includes(subjectNationId)
    )
      continue;
    for (const commitment of organization.commitments)
      if (
        commitment.status === 'active' &&
        commitment.issuer !== patronNationId &&
        (commitment.appliesTo !== 'specific-members' ||
          commitment.recipientNationIds.includes(subjectNationId))
      )
        otherPatrons.add(commitment.issuer);
  }
  const leadingCompetitor = [...otherPatrons]
    .map((otherPatron) => ({
      patron: otherPatron,
      leverage: influenceProfile(world, otherPatron, subjectNationId).leverage,
    }))
    .sort((left, right) => right.leverage - left.leverage)[0];
  const competingLeverage = leadingCompetitor?.leverage ?? 0;
  let offeredBenefit = 0;
  let sovereigntyCost = 0;
  const reasons: string[] = [];
  for (const term of offeredTerms) {
    const benefit = (() => {
      switch (term.kind) {
        case 'subsidy':
          return 14 + Math.min(24, term.amount * 0.5);
        case 'infrastructure-investment':
          return 16 + Math.min(22, term.amount * 0.4);
        case 'loan':
          return 8 + Math.min(25, term.amount * 0.25);
        case 'debt-relief':
          return 15 + Math.min(30, term.amount * 0.3);
        case 'security-guarantee':
          return 22;
        case 'preferential-trade':
          return 14;
        case 'market-access-concession':
          return 5;
        case 'energy-supply':
          return 12;
        case 'exclusive-market-access':
          return 17;
        default:
          return 0;
      }
    })();
    const cost =
      Math.max(0, termEffect(term.kind, true)) +
      (term.kind === 'no-rival-alliance' || term.kind === 'foreign-policy-veto'
        ? 12
        : 0);
    offeredBenefit += benefit;
    sovereigntyCost += cost;
  }
  const relation = world.relations.find(
    (candidate) =>
      [candidate.nationA, candidate.nationB].includes(patronNationId) &&
      [candidate.nationA, candidate.nationB].includes(subjectNationId),
  );
  const trust = relation?.trust ?? 50;
  // Existing dependence narrows the cost of accepting a new clause, while the
  // resistance term keeps domestic opposition, instability, and alternatives
  // in the decision. A high-leverage partner can bargain toward tighter terms;
  // a cold full-puppet package still receives no such discount.
  const effectiveSovereigntyCost = Math.max(
    0,
    sovereigntyCost - current.leverage * 0.28,
  );
  const score = clamp(
    50 +
      offeredBenefit * 0.55 +
      current.leverage * 0.35 +
      trust * 0.12 -
      effectiveSovereigntyCost * 0.75 -
      current.resistance * 0.45 -
      Math.max(0, competingLeverage - current.leverage) * 0.32,
  );
  const signed = score - 50;
  if (signed >= 12)
    reasons.push(
      'The package offers measurable economic or security benefits.',
    );
  if (sovereigntyCost >= 30)
    reasons.push('The proposal transfers substantial policy authority.');
  if (current.leverage >= 45)
    reasons.push('Existing dependence narrows the government’s alternatives.');
  if (current.resistance >= 55)
    reasons.push('Domestic and sovereignty resistance remains high.');
  if (competingLeverage >= current.leverage + 12)
    reasons.push(
      `A rival patron already offers a stronger outside option (${competingLeverage} leverage).`,
    );
  return {
    score: signed,
    // A government with a real benefit at stake should be able to bargain
    // over a costly first offer. Reserve outright rejection for packages that
    // remain far outside its interests, such as a cold full-puppet demand.
    move: signed >= 18 ? 'accept' : signed >= -30 ? 'counter' : 'reject',
    resistance: current.resistance,
    offeredBenefit,
    sovereigntyCost,
    competingPatronNationId: leadingCompetitor?.patron ?? null,
    competingLeverage,
    reasons,
  };
}
