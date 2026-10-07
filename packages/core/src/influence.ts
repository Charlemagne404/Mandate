import type {
  InfluenceAssessment,
  InfluenceStrategyPlan,
  InfluenceTerm,
  NationId,
  WorldState,
} from '@mandate/schemas';

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
  reliability: number;
  defectionRisk: DefectionRisk;
  puppetRequirements: PuppetRequirement[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const influenceAuthorityKinds = new Set<InfluenceTerm['kind']>([
  'foreign-policy-consultation',
  'foreign-policy-alignment',
  'support-diplomatic-initiatives',
  'no-rival-alliance',
  'foreign-policy-veto',
  'economic-policy-approval',
  'join-defensive-wars',
  'join-patron-wars',
  'war-declaration-approval',
  'no-war-against-patron',
  'military-access',
  'host-bases',
  'military-planning',
]);
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
  const patronFailureEpisodes = matchingTreaties
    .flatMap((treaty) => treaty.breaches)
    .filter(
      (breach) =>
        breach.violatingNationId === patronNationId &&
        breach.injuredNationId === subjectNationId,
    );
  const promisedPayments = matchingTreaties
    .flatMap((treaty) => treaty.influenceTerms)
    .filter(
      (term) =>
        term.patronNationId === patronNationId &&
        term.subjectNationId === subjectNationId &&
        ['subsidy', 'infrastructure-investment', 'debt-repayment'].includes(
          term.kind,
        ),
    );
  const missedInstallments = promisedPayments.reduce(
    (sum, term) => sum + term.arrears,
    0,
  );
  const fulfilledPayments = promisedPayments.reduce(
    (sum, term) => sum + term.paymentsMade,
    0,
  );
  const reliability = clamp(
    70 +
      Math.min(15, fulfilledPayments * 2) -
      missedInstallments * 7 -
      patronFailureEpisodes.reduce(
        (sum, breach) =>
          sum + (breach.status === 'resolved' ? 3 : 8) + breach.severity * 0.05,
        0,
      ),
  );
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
      Math.max(0, 70 - reliability) * 0.25 +
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
    reliability,
    defectionRisk,
    puppetRequirements,
  };
}

export interface InfluenceOfferAssessment {
  score: number;
  move: 'accept' | 'counter' | 'reject';
  recommendationZone: InfluenceAssessment['recommendationZone'];
  factors: InfluenceAssessment;
  resistance: number;
  offeredBenefit: number;
  sovereigntyCost: number;
  competingPatronNationId: NationId | null;
  competingLeverage: number;
  reasons: string[];
  reliability: number;
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
  const patron = world.nations.find((nation) => nation.id === patronNationId);
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  const relation = world.relations.find(
    (candidate) =>
      [candidate.nationA, candidate.nationB].includes(patronNationId) &&
      [candidate.nationA, candidate.nationB].includes(subjectNationId),
  );
  const trust = relation?.trust ?? 50;
  const targetThreat = clamp(
    Math.max(
      ...world.crises
        .filter(
          (crisis) =>
            crisis.status !== 'resolved' &&
            crisis.participants.includes(subjectNationId),
        )
        .map((crisis) => crisis.severity),
      ...world.conflicts
        .filter(
          (conflict) =>
            conflict.status === 'active' &&
            [...conflict.attackers, ...conflict.defenders].includes(
              subjectNationId,
            ),
        )
        .map(() => 70),
      0,
    ),
  );
  const economicPressure = clamp(
    subject
      ? Math.round(
          (subject.stats.debt /
            Math.max(1, subject.stats.debt + subject.stats.treasury)) *
            38,
        ) +
          Math.round((100 - subject.stats.fiscal) * 0.24) +
          Math.round(subject.stats.energyExposure * 0.26)
      : 0,
  );
  let offeredBenefit = 0;
  let sovereigntyCost = 0;
  let economicBenefit = 0;
  let securityBenefit = 0;
  let debtAndAidBenefit = 0;
  let infrastructureBenefit = 0;
  let marketAccessBenefit = 0;
  let militaryObligation = 0;
  let diplomaticRestriction = 0;
  let subjectFiscalCost = 0;
  let patronFiscalCost = 0;
  const reasons: string[] = [];
  for (const term of offeredTerms) {
    const benefit = (() => {
      switch (term.kind) {
        case 'subsidy':
          return 14 + Math.min(24, term.amount * 0.5);
        case 'infrastructure-investment':
          return (
            16 +
            Math.min(22, term.amount * 0.4) +
            (subject &&
            (subject.stats.industrial < 75 || subject.stats.fiscal < 48)
              ? 6
              : 0)
          );
        case 'loan':
          return 8 + Math.min(25, term.amount * 0.25);
        case 'debt-relief':
          return (
            15 +
            Math.min(30, term.amount * 0.3) +
            (subject && subject.stats.debt >= 20 ? 8 : 0)
          );
        case 'security-guarantee':
          return 18 + Math.round(targetThreat * 0.18);
        case 'preferential-trade':
          return 14;
        case 'market-access-concession':
          return 8 + (subject && subject.stats.economy < 65 ? 5 : 0);
        case 'energy-supply':
          return (
            8 +
            (subject && subject.stats.energyExposure >= 55 ? 12 : 0) +
            Math.min(12, term.amount * 0.4)
          );
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
    if (
      [
        'subsidy',
        'infrastructure-investment',
        'loan',
        'debt-relief',
        'preferential-trade',
        'market-access-concession',
        'energy-supply',
        'exclusive-market-access',
        'customs-alignment',
        'common-economic-rules',
      ].includes(term.kind)
    )
      economicBenefit += benefit;
    if (term.kind === 'security-guarantee') securityBenefit += benefit;
    if (['subsidy', 'loan', 'debt-relief'].includes(term.kind))
      debtAndAidBenefit += benefit;
    if (term.kind === 'infrastructure-investment')
      infrastructureBenefit += benefit;
    if (
      [
        'preferential-trade',
        'market-access-concession',
        'exclusive-market-access',
      ].includes(term.kind)
    )
      marketAccessBenefit += benefit;
    if (
      [
        'join-defensive-wars',
        'join-patron-wars',
        'war-declaration-approval',
        'military-access',
        'host-bases',
        'military-planning',
      ].includes(term.kind)
    )
      militaryObligation += cost;
    if (
      [
        'foreign-policy-consultation',
        'foreign-policy-alignment',
        'no-rival-alliance',
        'support-diplomatic-initiatives',
        'foreign-policy-veto',
        'economic-policy-approval',
      ].includes(term.kind)
    )
      diplomaticRestriction += cost;
    if (term.kind === 'tribute')
      subjectFiscalCost += term.ratePercent
        ? Math.round((term.ratePercent / 100) * 24)
        : term.amount * 12;
    if (term.kind === 'debt-repayment') subjectFiscalCost += term.amount * 12;
    if (term.kind === 'energy-supply') patronFiscalCost += term.amount * 12;
    if (
      ['subsidy', 'infrastructure-investment', 'debt-relief', 'loan'].includes(
        term.kind,
      )
    )
      patronFiscalCost += ['debt-relief', 'loan'].includes(term.kind)
        ? term.amount
        : term.amount * 12;
  }
  const dependencyChannels = Object.values(current.dependency).sort(
    (a, b) => b - a,
  );
  const existingDependence = clamp(
    Math.round(
      dependencyChannels.slice(0, 3).reduce((sum, value) => sum + value, 0) /
        Math.min(3, dependencyChannels.length),
    ),
  );
  const activeObligationCount = current.activeTerms.filter(
    (term) => termEffect(term.kind, true) > 0,
  ).length;
  const grievance = clamp(
    Math.max(
      (relation?.grievances.length ?? 0) * 12,
      Math.max(0, 50 - trust) * 0.8,
    ),
  );
  const rivalOffers = world.negotiations
    .filter(
      (negotiation) =>
        negotiation.kind === 'influence' &&
        negotiation.status === 'open' &&
        negotiation.recipientNationId === subjectNationId &&
        negotiation.proposerNationId !== patronNationId,
    )
    .map((negotiation) => ({
      patronNationId: negotiation.proposerNationId,
      terms: negotiation.influenceTerms,
      profile: influenceProfile(
        world,
        negotiation.proposerNationId,
        subjectNationId,
      ),
    }))
    .map((offer) => {
      const offerBenefit = offer.terms.reduce((sum, term) => {
        switch (term.kind) {
          case 'subsidy':
            return sum + 14 + Math.min(24, term.amount * 0.5);
          case 'infrastructure-investment':
            return sum + 16 + Math.min(22, term.amount * 0.4);
          case 'debt-relief':
            return sum + 15 + Math.min(30, term.amount * 0.3);
          case 'loan':
            return sum + 8 + Math.min(25, term.amount * 0.25);
          case 'security-guarantee':
            return sum + 18 + Math.round(targetThreat * 0.18);
          case 'energy-supply':
            return (
              sum +
              (subject && subject.stats.energyExposure >= 55 ? 20 : 8) +
              Math.min(12, term.amount * 0.4)
            );
          case 'preferential-trade':
          case 'exclusive-market-access':
            return sum + 14;
          case 'market-access-concession':
            return sum + 8;
          default:
            return sum;
        }
      }, 0);
      const offerCost = offer.terms.reduce(
        (sum, term) => sum + Math.max(0, termEffect(term.kind, true)),
        0,
      );
      return {
        patronNationId: offer.patronNationId,
        leverage: offer.profile.leverage,
        score:
          clamp(
            50 +
              offerBenefit * 0.55 +
              offer.profile.leverage * 0.35 +
              trust * 0.12 -
              offerCost * 0.75 -
              offer.profile.resistance * 0.45 -
              Math.max(0, 70 - offer.profile.reliability) * 0.3,
          ) - 50,
      };
    })
    .sort((a, b) => b.score - a.score || b.leverage - a.leverage);
  const bestRivalOffer = rivalOffers[0];
  const targetGoals = world.goals.filter(
    (goal) =>
      goal.nationId === subjectNationId &&
      !['achieved', 'failed', 'abandoned', 'superseded'].includes(
        goal.status,
      ) &&
      (goal.targetNationIds.includes(patronNationId) ||
        (goal.evaluation.kind === 'influence' &&
          goal.evaluation.subjectNationIds.includes(patronNationId))),
  );
  const alignedGoals = clamp(
    targetGoals.reduce((sum, goal) => sum + Math.max(1, goal.priority), 0),
  );
  const preferenceFit = clamp(
    50 +
      (relation?.score ?? 0) * 0.35 +
      ((subject?.strategy.riskTolerance ?? 40) - 40) * 0.2,
  );
  const subjectOutflows = clamp(
    Math.round(
      (subjectFiscalCost /
        Math.max(
          1,
          (subject?.stats.treasury ?? 0) + (subject?.stats.debt ?? 0),
        )) *
        100,
    ),
  );
  const patronBudgetStress = clamp(
    Math.round(
      (patronFiscalCost / Math.max(1, patron?.stats.treasury ?? 0)) * 100,
    ),
  );
  const totalBenefit = clamp(
    Math.round(
      Math.min(
        100,
        economicBenefit * 0.38 +
          securityBenefit * 0.2 +
          debtAndAidBenefit * 0.16 +
          infrastructureBenefit * 0.14 +
          marketAccessBenefit * 0.08 +
          current.dependency.organization * 0.04,
      ),
    ),
  );
  const currentOfferScore =
    clamp(
      50 +
        offeredBenefit * 0.55 +
        current.leverage * 0.35 +
        trust * 0.12 -
        Math.max(0, sovereigntyCost - current.leverage * 0.28) * 0.75 -
        current.resistance * 0.45 -
        Math.max(0, 70 - current.reliability) * 0.3,
    ) - 50;
  const rivalAdvantage = Math.max(
    0,
    (bestRivalOffer?.score ?? -50) - currentOfferScore,
  );
  // Existing dependence narrows the cost of accepting a new clause, while the
  // resistance term keeps domestic opposition, instability, and alternatives
  // in the decision. A high-leverage partner can bargain toward tighter terms;
  // a cold full-puppet package still receives no such discount.
  const effectiveSovereigntyCost = Math.max(
    0,
    sovereigntyCost - current.leverage * 0.28,
  );
  const militaryCostOutsidePolicy = Math.max(
    0,
    effectiveSovereigntyCost - militaryObligation,
  );
  const diplomaticCostOutsidePolicy = Math.max(
    0,
    militaryCostOutsidePolicy - diplomaticRestriction,
  );
  const score = clamp(
    45 +
      totalBenefit * 0.34 +
      current.leverage * 0.16 +
      trust * 0.12 +
      targetThreat * 0.1 +
      alignedGoals * 0.04 +
      preferenceFit * 0.05 -
      diplomaticCostOutsidePolicy * 0.16 -
      subjectOutflows * 0.12 -
      militaryObligation * 0.12 -
      diplomaticRestriction * 0.1 -
      existingDependence * 0.035 -
      activeObligationCount * 0.8 -
      current.resistance * 0.12 -
      Math.max(0, 70 - current.reliability) * 0.12 -
      Math.max(0, competingLeverage - current.leverage) * 0.12 -
      rivalAdvantage * 0.12 -
      grievance * 0.06 -
      patronBudgetStress * 0.08,
  );
  const recommendationZone: InfluenceAssessment['recommendationZone'] =
    score >= 75
      ? 'strongly-favorable'
      : score >= 62
        ? 'favorable'
        : score >= 47
          ? 'negotiable'
          : score >= 32
            ? 'unfavorable'
            : 'strongly-unfavorable';
  const signed = score - 50;
  const factors: InfluenceAssessment = {
    recommendationZone,
    score: signed,
    benefits: {
      economic: clamp(Math.round(economicBenefit)),
      security: clamp(Math.round(securityBenefit)),
      debtAndAid: clamp(Math.round(debtAndAidBenefit)),
      infrastructure: clamp(Math.round(infrastructureBenefit)),
      marketAccess: clamp(Math.round(marketAccessBenefit)),
      organization: clamp(Math.round(current.dependency.organization)),
      total: totalBenefit,
    },
    costs: {
      sovereignty: clamp(Math.round(sovereigntyCost)),
      fiscal: subjectOutflows,
      militaryObligation: clamp(Math.round(militaryObligation)),
      diplomaticRestriction: clamp(Math.round(diplomaticRestriction)),
      patronBudget: patronBudgetStress,
    },
    relationship: {
      trust,
      reliability: current.reliability,
      leverage: current.leverage,
      resistance: current.resistance,
      existingDependence,
      obligations: clamp(activeObligationCount * 5),
      grievance,
    },
    alternatives: {
      rivalNationId:
        bestRivalOffer?.patronNationId ?? leadingCompetitor?.patron ?? null,
      rivalLeverage: bestRivalOffer?.leverage ?? competingLeverage,
      rivalOfferScore: bestRivalOffer?.score ?? null,
      outsideOption: clamp(
        100 - current.leverage + Math.min(20, otherPatrons.size * 5),
      ),
      switchingCost: clamp(
        Math.round(
          existingDependence * 0.55 +
            activeObligationCount * 2 +
            Math.max(0, 65 - (relation?.score ?? 0)) * 0.15,
        ),
      ),
    },
    strategicFit: {
      targetThreat,
      economicPressure,
      alignedGoals,
      preferenceFit,
    },
  };
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
  if (current.reliability < 50)
    reasons.push(
      `The patron's delivery record is weak (${current.reliability}/100); future promises are discounted.`,
    );
  return {
    score: signed,
    recommendationZone,
    factors,
    // This is a bounded recommendation for deliberation, not an automatic
    // decision. The autonomous government still applies its qualitative
    // priorities and may counter, defer, or reject for a grounded reason.
    move:
      recommendationZone === 'strongly-favorable' ||
      recommendationZone === 'favorable'
        ? 'accept'
        : recommendationZone === 'strongly-unfavorable'
          ? 'reject'
          : 'counter',
    resistance: current.resistance,
    offeredBenefit,
    sovereigntyCost,
    competingPatronNationId: leadingCompetitor?.patron ?? null,
    competingLeverage,
    reliability: current.reliability,
    reasons,
  };
}

const tierRank: InfluenceStrategyPlan['currentTier'][] = [
  'INDEPENDENT',
  'PARTNER',
  'DEPENDENT PARTNER',
  'CLIENT STATE',
  'PROTECTORATE',
  'SUBJECT STATE',
  'PUPPET STATE',
];

/** Refreshes a patron's durable strategic record from canonical relationships and negotiation outcomes. */
export function buildInfluenceStrategyPlan(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  desiredTier: InfluenceStrategyPlan['desiredTier'] = 'SUBJECT STATE',
  rationale = 'Build a durable negotiated sphere while preserving incentives and exit options.',
): InfluenceStrategyPlan {
  const profile = influenceProfile(world, patronNationId, subjectNationId);
  const rivalIds = new Set<NationId>();
  for (const link of world.economicLinks)
    if (
      link.dependentNationId === subjectNationId &&
      link.partnerNationId !== patronNationId
    )
      rivalIds.add(link.partnerNationId);
  for (const treaty of world.treaties)
    if (treaty.status === 'active')
      for (const term of treaty.influenceTerms)
        if (
          term.status === 'active' &&
          term.subjectNationId === subjectNationId &&
          term.patronNationId !== patronNationId
        )
          rivalIds.add(term.patronNationId);
  for (const organization of world.organizations)
    if (
      organization.status === 'active' &&
      organization.members.includes(subjectNationId)
    ) {
      for (const founder of organization.founders)
        if (founder !== patronNationId && founder !== subjectNationId)
          rivalIds.add(founder);
      for (const commitment of organization.commitments)
        if (
          commitment.status === 'active' &&
          commitment.issuer !== patronNationId &&
          commitment.issuer !== subjectNationId
        )
          rivalIds.add(commitment.issuer);
    }
  for (const negotiation of world.negotiations)
    if (
      negotiation.kind === 'influence' &&
      negotiation.status === 'open' &&
      negotiation.recipientNationId === subjectNationId &&
      negotiation.proposerNationId !== patronNationId
    )
      rivalIds.add(negotiation.proposerNationId);
  const rivals = [...rivalIds]
    .filter((id) => world.nations.some((nation) => nation.id === id))
    .map((id) => {
      const rival = influenceProfile(world, id, subjectNationId);
      return {
        patronNationId: id,
        tier: rival.tier,
        leverage: rival.leverage,
        reliability: rival.reliability,
      };
    })
    .sort(
      (a, b) =>
        b.leverage - a.leverage ||
        a.patronNationId.localeCompare(b.patronNationId),
    )
    .slice(0, 5);
  const channels = Object.entries(profile.dependency) as [
    keyof typeof profile.dependency,
    number,
  ][];
  const strongestChannels = [...channels]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([channel]) => channel);
  const weakestChannels = [...channels]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([channel]) => channel);
  const treaties = world.treaties.filter(
    (treaty) =>
      treaty.parties.includes(patronNationId) &&
      treaty.parties.includes(subjectNationId),
  );
  const acceptedObligations = treaties.flatMap((treaty) =>
    treaty.influenceTerms
      .filter(
        (term) =>
          term.patronNationId === patronNationId &&
          term.subjectNationId === subjectNationId,
      )
      .map((term) => ({
        kind: term.kind,
        treatyId: treaty.id,
        date: treaty.ratifiedDate ?? world.date,
      })),
  );
  const negotiations = world.negotiations
    .filter((negotiation) => {
      if (negotiation.kind !== 'influence') return false;
      const parties = [
        negotiation.proposerNationId,
        negotiation.recipientNationId,
      ];
      if (
        !parties.includes(patronNationId) ||
        !parties.includes(subjectNationId)
      )
        return false;

      // A counteroffer reverses proposer and recipient, while typed terms keep
      // the canonical patron/subject roles. Prefer those roles for strategy
      // memory so the target's objection is not lost after the counter.
      const terms = [
        ...negotiation.influenceTerms,
        ...negotiation.responses.flatMap((response) => [
          ...(response.influenceTerms ?? []),
          ...(response.counterInfluenceTerms ?? []),
        ]),
      ];
      if (terms.length)
        return terms.some(
          (term) =>
            term.patronNationId === patronNationId &&
            term.subjectNationId === subjectNationId,
        );

      const latestPerspectiveResponse = [...negotiation.responses]
        .reverse()
        .find((response) => response.influenceDecision?.decisionPerspective);
      if (latestPerspectiveResponse?.influenceDecision?.decisionPerspective)
        return latestPerspectiveResponse.influenceDecision
          .decisionPerspective === 'target'
          ? latestPerspectiveResponse.nationId === subjectNationId
          : latestPerspectiveResponse.nationId === patronNationId;

      return (
        negotiation.proposerNationId === patronNationId &&
        negotiation.recipientNationId === subjectNationId
      );
    })
    .sort((a, b) => a.createdDate.localeCompare(b.createdDate));
  const reasonCode = (
    text: string,
    code?: string,
  ): InfluenceStrategyPlan['rejectedObligations'][number]['reasonCode'] => {
    const allowed = [
      'sovereignty-cost',
      'insufficient-leverage',
      'rival-offer',
      'low-trust',
      'resistance',
      'inadequate-compensation',
      'incompatible-preferences',
      'patron-unreliable',
      'fiscal-risk',
      'uncertain-benefit',
      'acceptable-balanced-offer',
      'best-rival-offer',
      'autonomy-protected',
    ];
    if (code && allowed.includes(code))
      return code as InfluenceStrategyPlan['rejectedObligations'][number]['reasonCode'];
    if (/sovereign|veto|autonomy|authority|independent/i.test(text))
      return 'sovereignty-cost';
    if (/rival|alternative|mexico|outside option/i.test(text))
      return 'rival-offer';
    if (/compensat|investment|benefit|price/i.test(text))
      return 'inadequate-compensation';
    if (/trust|reliable|missed|arrears/i.test(text)) return 'patron-unreliable';
    if (/resistan|domestic|public|unrest/i.test(text)) return 'resistance';
    return 'uncertain-benefit';
  };
  const responseReasonCode = (
    response: WorldState['negotiations'][number]['responses'][number],
    negotiation: WorldState['negotiations'][number],
  ) => {
    const offered = response.influenceTerms ?? negotiation.influenceTerms;
    const counter = response.counterInfluenceTerms ?? [];
    const counteredAuthority =
      response.move === 'counter' &&
      response.counterInfluenceTerms !== undefined &&
      offered.some(
        (term) =>
          influenceAuthorityKinds.has(term.kind) &&
          !counter.some(
            (counterTerm) =>
              counterTerm.kind === term.kind &&
              counterTerm.patronNationId === term.patronNationId &&
              counterTerm.subjectNationId === term.subjectNationId,
          ),
      );
    return counteredAuthority
      ? 'sovereignty-cost'
      : reasonCode(
          response.influenceDecision?.explanation ?? response.message,
          response.influenceDecision?.reasonCode,
        );
  };
  const rejectedObligations = negotiations.flatMap((negotiation) =>
    negotiation.responses
      .filter(
        (response) =>
          response.nationId === subjectNationId &&
          ['reject', 'counter'].includes(response.move),
      )
      .map((response) => ({
        negotiationId: negotiation.id,
        date: response.date,
        reasonCode: responseReasonCode(response, negotiation),
        requestedKinds: (
          response.influenceTerms ?? negotiation.influenceTerms
        ).map((term) => term.kind),
        explanation:
          response.influenceDecision?.explanation ?? response.message,
      })),
  );
  const recentAuthorityRejection = [...rejectedObligations]
    .reverse()
    .find(
      (rejection) =>
        [
          'sovereignty-cost',
          'insufficient-leverage',
          'resistance',
          'inadequate-compensation',
          'rival-offer',
          'low-trust',
        ].includes(rejection.reasonCode) &&
        rejection.date >=
          new Date(Date.parse(world.date) - 365 * 86_400_000)
            .toISOString()
            .slice(0, 10),
    );
  const recentCounteroffers = negotiations.flatMap((negotiation) =>
    negotiation.responses
      .filter(
        (response) =>
          response.nationId === subjectNationId && response.move === 'counter',
      )
      .map((response) => ({
        negotiationId: negotiation.id,
        date: response.date,
        requestedKinds: (
          response.influenceTerms ?? negotiation.influenceTerms
        ).map((term) => term.kind),
        counterKinds: (response.counterInfluenceTerms ?? []).map(
          (term) => term.kind,
        ),
        explanation: response.message,
      })),
  );
  const acceptedCompensationAfterRejection = Boolean(
    recentAuthorityRejection &&
    negotiations.some((negotiation) =>
      negotiation.responses.some(
        (response) =>
          response.nationId === subjectNationId &&
          response.move === 'accept' &&
          response.date > recentAuthorityRejection.date &&
          (response.influenceTerms ?? negotiation.influenceTerms).some((term) =>
            [
              'subsidy',
              'infrastructure-investment',
              'debt-relief',
              'energy-supply',
              'market-access-concession',
            ].includes(term.kind),
          ),
      ),
    ),
  );
  const recentUncompensatedAuthorityKinds = new Set(
    recentAuthorityRejection && !acceptedCompensationAfterRejection
      ? recentAuthorityRejection.requestedKinds.filter((kind) =>
          influenceAuthorityKinds.has(kind),
        )
      : [],
  );
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  const relation = world.relations.find(
    (candidate) =>
      [candidate.nationA, candidate.nationB].includes(patronNationId) &&
      [candidate.nationA, candidate.nationB].includes(subjectNationId),
  );
  const strongestRival = rivals[0];
  const unresolvedBreach = treaties
    .flatMap((treaty) => treaty.breaches)
    .find((breach) => breach.status !== 'resolved');
  const missingConsultation = !profile.activeTerms.some(
    (term) => term.kind === 'foreign-policy-consultation',
  );
  const hasDiplomaticCoordination = profile.activeTerms.some(
    (term) => term.kind === 'support-diplomatic-initiatives',
  );
  const hasRivalAllianceRestriction = profile.activeTerms.some(
    (term) => term.kind === 'no-rival-alliance',
  );
  const missingSecurity =
    !profile.activeTerms.some((term) => term.kind === 'security-guarantee') ||
    !profile.activeTerms.some((term) => term.kind === 'military-access') ||
    !profile.activeTerms.some((term) => term.kind === 'join-defensive-wars');
  const missingSecurityStep = (
    ['security-guarantee', 'military-access', 'join-defensive-wars'] as const
  ).find(
    (kind) =>
      !profile.activeTerms.some((term) => term.kind === kind) &&
      !recentUncompensatedAuthorityKinds.has(kind),
  );
  const patronMilitary =
    world.nations.find((nation) => nation.id === patronNationId)?.stats
      .military ?? 50;
  const subjectMilitary = subject?.stats.military ?? 50;
  const acuteSecurityPressure = world.crises.some(
    (crisis) =>
      crisis.status !== 'resolved' &&
      crisis.severity >= 45 &&
      crisis.participants.includes(subjectNationId),
  );
  const prioritizeSecurity =
    missingSecurity &&
    ((relation?.trust ?? 50) < 55 ||
      acuteSecurityPressure ||
      subjectMilitary >= patronMilitary * 1.2);
  const hasMaterialEconomy = [
    profile.dependency.trade,
    profile.dependency.finance,
    profile.dependency.aid,
    profile.dependency.energy,
    profile.dependency.infrastructure,
    profile.dependency.marketAccess,
  ].some((value) => value >= 30);
  const blockers = [
    ...(profile.resistance >= 55
      ? [
          `Resistance ${profile.resistance}/100 makes new sovereignty costs harder to ratify.`,
        ]
      : []),
    ...(strongestRival && strongestRival.leverage >= profile.leverage + 8
      ? [
          `${world.nations.find((nation) => nation.id === strongestRival.patronNationId)?.name ?? 'A rival patron'} offers a stronger outside option.`,
        ]
      : []),
    ...(missingSecurity
      ? ['Security reliance is weak relative to the desired relationship.']
      : []),
    ...(!hasMaterialEconomy
      ? ['Economic dependence is too shallow to support durable authority.']
      : []),
    ...((relation?.trust ?? 50) < 45
      ? ['Trust remains too low for a broader legal commitment.']
      : []),
    ...(profile.reliability < 55
      ? ['The patron delivery record weakens the value of future promises.']
      : []),
    ...(unresolvedBreach
      ? [`An unresolved treaty breach remains: ${unresolvedBreach.reason}`]
      : []),
  ];
  const targetRank = tierRank.indexOf(desiredTier);
  let nextKind: InfluenceStrategyPlan['nextStep']['kind'] = 'wait';
  let nextRationale =
    'Consolidate current obligations and review the relationship after new evidence.';
  let requestedTerms: InfluenceTerm['kind'][] = [];
  let proposedBenefits: string | null = null;
  if (unresolvedBreach) {
    nextKind =
      unresolvedBreach.violatingNationId === patronNationId
        ? 'renegotiate'
        : 'enforce';
    nextRationale =
      unresolvedBreach.violatingNationId === patronNationId
        ? 'Repair the missed obligation before asking the partner for greater authority.'
        : 'Secure compliance or renegotiate the violated obligation before broadening the relationship.';
  } else if (
    strongestRival &&
    strongestRival.leverage >= profile.leverage + 8
  ) {
    nextKind = 'reduce-rival-options';
    nextRationale =
      'A rival has the stronger outside option; improve the value and reliability of this partnership before demanding more authority.';
  } else if (profile.resistance >= 58 || profile.reliability < 55) {
    nextKind = 'improve-trust';
    nextRationale =
      'Resistance or delivery failures make another sovereignty demand premature; fulfill promises and offer valuable, verifiable support.';
    proposedBenefits =
      subject && subject.stats.debt > 0
        ? 'Consider targeted debt relief or dependable infrastructure support.'
        : 'Consider dependable infrastructure, energy access, or a security guarantee matched to the target’s needs.';
  } else if (!hasMaterialEconomy || profile.leverage < 25) {
    nextKind = 'build-economic-dependence';
    nextRationale =
      'Build durable economic ties first; current leverage is too shallow for major restrictions.';
    proposedBenefits =
      subject && subject.stats.energyExposure >= 60
        ? 'Offer reliable energy supply and infrastructure that lowers the target’s exposure.'
        : subject && subject.stats.debt >= Math.max(30, subject.stats.treasury)
          ? 'Offer affordable debt relief paired with long-term infrastructure.'
          : 'Offer an affordable infrastructure or trade package that improves the target’s current needs.';
  } else if (
    missingConsultation &&
    !recentUncompensatedAuthorityKinds.has('foreign-policy-consultation') &&
    targetRank >= tierRank.indexOf('CLIENT STATE') &&
    !prioritizeSecurity
  ) {
    nextKind = 'seek-consultation';
    nextRationale =
      'Trust and the current security picture support a reversible first political step; establish consultation before adding security or approval obligations.';
    requestedTerms = ['foreign-policy-consultation'];
    proposedBenefits =
      'Additional market access or dependable infrastructure alongside consultation; the target retains final authority.';
  } else if (
    missingSecurity &&
    missingSecurityStep !== undefined &&
    targetRank >= tierRank.indexOf('PROTECTORATE')
  ) {
    nextKind = 'build-security-reliance';
    nextRationale =
      missingSecurityStep === 'security-guarantee'
        ? 'Economic ties exist, but the target has little security reliance on this patron; begin with a credible defensive guarantee.'
        : missingSecurityStep === 'military-access'
          ? 'Build practical security reliance through scoped access before asking the target to join conflicts.'
          : 'The target has a guarantee and practical access; negotiate a defensive-support commitment before any offensive obligation.';
    requestedTerms = [missingSecurityStep];
    proposedBenefits =
      'A credible security guarantee and practical cooperation matched to regional threats.';
  } else if (
    missingConsultation &&
    !recentUncompensatedAuthorityKinds.has('foreign-policy-consultation') &&
    targetRank >= tierRank.indexOf('CLIENT STATE')
  ) {
    nextKind = 'seek-consultation';
    nextRationale =
      'The relationship can support a reversible consultation commitment before approval rights.';
    requestedTerms = ['foreign-policy-consultation'];
    proposedBenefits =
      'Additional market access or dependable infrastructure alongside consultation; the target retains final authority.';
  } else if (
    !hasDiplomaticCoordination &&
    !recentUncompensatedAuthorityKinds.has('support-diplomatic-initiatives') &&
    targetRank >= tierRank.indexOf('CLIENT STATE')
  ) {
    nextKind = 'seek-coordination';
    nextRationale =
      'Build a record of coordinated diplomacy before asking the partner to restrict its outside options.';
    requestedTerms = ['support-diplomatic-initiatives'];
    proposedBenefits =
      'Coordinate on named diplomatic initiatives while preserving independent treaty and alliance choices.';
  } else if (
    !hasRivalAllianceRestriction &&
    !recentUncompensatedAuthorityKinds.has('no-rival-alliance') &&
    targetRank >= tierRank.indexOf('SUBJECT STATE')
  ) {
    nextKind = 'reduce-rival-options';
    nextRationale =
      'Seek a narrow restriction on rival alliances only after consultation and practical coordination are established.';
    requestedTerms = ['no-rival-alliance'];
    proposedBenefits =
      'Pair a narrowly scoped alliance restriction with dependable benefits and a review date.';
  } else if (
    !profile.activeTerms.some(
      (term) => term.kind === 'foreign-policy-alignment',
    ) &&
    !recentUncompensatedAuthorityKinds.has('foreign-policy-alignment') &&
    targetRank >= tierRank.indexOf('SUBJECT STATE')
  ) {
    nextKind = 'seek-policy-authority';
    nextRationale =
      'Broader alignment is now a plausible next negotiation after lower-cost consultation and coordination.';
    requestedTerms = ['foreign-policy-alignment'];
    proposedBenefits =
      'Offer additional, verifiable economic or security value with a regular review of the alignment terms.';
  } else if (
    desiredTier === 'PUPPET STATE' &&
    profile.tier === 'SUBJECT STATE' &&
    (profile.leverage < 60 ||
      profile.resistance > 40 ||
      profile.reliability < 65 ||
      (relation?.trust ?? 50) < 60)
  ) {
    nextKind = 'improve-trust';
    nextRationale =
      'The legal relationship is already a subject state, but trust, reliability, resistance, or leverage still makes a final authority package fragile.';
    proposedBenefits =
      'Deliver current obligations, preserve security guarantees, and allow the partner to review existing restrictions before seeking broader authority.';
  } else if (
    desiredTier === 'PUPPET STATE' &&
    profile.tier === 'SUBJECT STATE' &&
    profile.leverage >= 60 &&
    profile.resistance <= 40 &&
    profile.reliability >= 65 &&
    (relation?.trust ?? 50) >= 60
  ) {
    const finalAuthority: Partial<
      Record<InfluenceStrategyPlan['desiredTier'], InfluenceTerm['kind'][]>
    > = {
      'PUPPET STATE': [
        'foreign-policy-veto',
        'war-declaration-approval',
        'join-patron-wars',
        'no-war-against-patron',
        'military-access',
        'no-rival-alliance',
      ],
    };
    const missingAuthority = (finalAuthority[desiredTier] ?? []).filter(
      (kind) => !profile.activeTerms.some((term) => term.kind === kind),
    );
    if (missingAuthority.length) {
      const recentlyRejectedKinds = new Set(
        recentAuthorityRejection?.requestedKinds ?? [],
      );
      const nextAuthority =
        missingAuthority.find((kind) => !recentlyRejectedKinds.has(kind)) ??
        missingAuthority[0];
      const rejectedFinalAuthority =
        missingAuthority.length === 1 &&
        nextAuthority !== undefined &&
        recentAuthorityRejection?.requestedKinds.includes(nextAuthority) ===
          true;
      if (
        rejectedFinalAuthority &&
        !acceptedCompensationAfterRejection &&
        recentAuthorityRejection &&
        [
          'sovereignty-cost',
          'insufficient-leverage',
          'resistance',
          'inadequate-compensation',
          'rival-offer',
          'low-trust',
          'patron-unreliable',
        ].includes(recentAuthorityRejection.reasonCode)
      ) {
        nextKind = 'build-economic-dependence';
        nextRationale = `The partner rejected ${nextAuthority} for ${recentAuthorityRejection.reasonCode}; pause the sovereignty request and deliver a materially stronger, affordable benefit before asking again.`;
        requestedTerms = [];
        proposedBenefits =
          'Increase dependable investment or debt relief within the patron’s remaining budget, then reassess before renewing the authority request.';
      } else {
        nextKind = 'seek-policy-authority';
        nextRationale = recentAuthorityRejection
          ? `The partner is materially dependent, but its latest ${recentAuthorityRejection.reasonCode} response changed the terms: seek one remaining authority clause at a time, improve compensation, and avoid repeating the rejected bundle unchanged.`
          : 'The partner is already materially dependent and aligned; negotiate one remaining high-authority clause at a time with its government, then reassess before seeking the next.';
        requestedTerms = nextAuthority ? [nextAuthority] : [];
        proposedBenefits =
          'Pair this single authority clause with reliable, target-valued compensation and a review date; broaden obligations only after the partner accepts and the relationship is reassessed.';
      }
    }
  } else {
    nextKind = 'seek-coordination';
    nextRationale =
      'The relationship has enough accumulated benefits to discuss narrower coordination, while broad vetoes still carry a high political price.';
    requestedTerms = profile.activeTerms.some(
      (term) => term.kind === 'foreign-policy-alignment',
    )
      ? ['no-rival-alliance']
      : ['foreign-policy-alignment'];
    proposedBenefits =
      'Pair any additional coordination with a concrete, affordable benefit and preserve the target’s right to renegotiate.';
  }
  const currentRank = tierRank.indexOf(profile.tier);
  const existingPlan = world.nations
    .find((nation) => nation.id === patronNationId)
    ?.strategy.influencePlans.find(
      (plan) => plan.targetNationId === subjectNationId,
    );
  return {
    targetNationId: subjectNationId,
    desiredTier,
    currentTier: profile.tier,
    status:
      currentRank >= targetRank
        ? 'achieved'
        : existingPlan?.status === 'paused'
          ? 'paused'
          : 'active',
    priority: existingPlan?.priority ?? 3,
    createdDate: existingPlan?.createdDate ?? world.date,
    reviewedDate: world.date,
    rationale: existingPlan?.rationale ?? rationale,
    strongestChannels,
    weakestChannels,
    leverage: profile.leverage,
    resistance: profile.resistance,
    patronReliability: profile.reliability,
    rivalInfluence: rivals,
    blockers: blockers.slice(0, 8),
    acceptedObligations: acceptedObligations.slice(-40),
    rejectedObligations: rejectedObligations.slice(-20),
    recentCounteroffers: recentCounteroffers.slice(-10),
    nextStep: {
      kind: nextKind,
      rationale: nextRationale,
      proposedBenefits,
      requestedTerms,
    },
  };
}
