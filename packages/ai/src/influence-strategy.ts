import { assessInfluenceOffer, influenceProfile } from '@mandate/core';
import {
  InfluenceDecision,
  InfluenceTerm as InfluenceTermSchema,
} from '@mandate/schemas';
import type {
  InfluenceDecision as InfluenceDecisionShape,
  InfluenceTerm as InfluenceTermShape,
  NationId,
  Negotiation,
  WorldState,
} from '@mandate/schemas';

export type InfluenceCounterOffer = {
  id: string;
  label: string;
  terms: InfluenceTermShape[];
  termsText: string;
};

export type InfluenceParties = {
  patronNationId: NationId;
  subjectNationId: NationId;
};

/** Counterproposals reverse the negotiator order while keeping canonical influence roles. */
export function influencePartiesForNegotiation(
  negotiation: Pick<
    Negotiation,
    'proposerNationId' | 'recipientNationId' | 'influenceTerms'
  >,
): InfluenceParties {
  const partyIds = [
    negotiation.proposerNationId,
    negotiation.recipientNationId,
  ];
  const orientations = new Map<
    string,
    { patronNationId: NationId; subjectNationId: NationId; count: number }
  >();
  for (const term of negotiation.influenceTerms) {
    if (
      term.patronNationId === term.subjectNationId ||
      !partyIds.includes(term.patronNationId) ||
      !partyIds.includes(term.subjectNationId)
    )
      continue;
    const key = `${term.patronNationId}:${term.subjectNationId}`;
    const orientation = orientations.get(key);
    orientations.set(key, {
      patronNationId: term.patronNationId,
      subjectNationId: term.subjectNationId,
      count: (orientation?.count ?? 0) + 1,
    });
  }
  const mostCommon = [...orientations.values()].sort(
    (a, b) => b.count - a.count,
  )[0];
  if (mostCommon)
    return {
      patronNationId: mostCommon.patronNationId,
      subjectNationId: mostCommon.subjectNationId,
    };
  return {
    patronNationId: negotiation.proposerNationId,
    subjectNationId: negotiation.recipientNationId,
  };
}

const materialBenefitKinds = new Set<InfluenceTermShape['kind']>([
  'subsidy',
  'infrastructure-investment',
  'loan',
  'debt-relief',
  'preferential-trade',
  'market-access-concession',
  'energy-supply',
  'security-guarantee',
]);
const authorityKinds = new Set<InfluenceTermShape['kind']>([
  'join-defensive-wars',
  'join-patron-wars',
  'war-declaration-approval',
  'no-war-against-patron',
  'foreign-policy-consultation',
  'foreign-policy-alignment',
  'no-rival-alliance',
  'support-diplomatic-initiatives',
  'foreign-policy-veto',
  'economic-policy-approval',
  'military-access',
  'host-bases',
  'military-planning',
  'tribute',
  'exclusive-market-access',
  'customs-alignment',
  'common-economic-rules',
  'mandatory-procurement',
  'debt-repayment',
  'government-security-arrangement',
]);

const privateStrategicContextPattern =
  /\b(?:target plan|national sphere strategy|sphere portfolio|internal plan|private strategy|our strategic plan|internal strategy)\b/i;
const influenceTermAliases: Partial<
  Record<InfluenceTermShape['kind'], string[]>
> = {
  'energy-supply': ['energy supply'],
  'join-patron-wars': ['patron wars', 'offensive wars'],
  'foreign-policy-consultation': ['consultation'],
  'foreign-policy-alignment': ['alignment'],
};

export function containsPrivateStrategicPlanningLanguage(value: string) {
  return privateStrategicContextPattern.test(value);
}

function framesCounterpartNeeds(text: string, counterpartName: string) {
  const escapedName = counterpartName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\b${escapedName}(?:['’]s|['’])\\s+(?:[a-z-]+\\s+){0,2}(?:needs?|goals?|priorities?|red lines?|sovereignty|autonomy|preferences?|objectives?)\\b`,
    'i',
  ).test(text);
}

function framesDecidingActorSovereignty(
  text: string,
  decidingActorName: string,
) {
  const escapedName = decidingActorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\b${escapedName}(?:['’]s|['’])\\s+(?:[a-z-]+\\s+){0,6}(?:sovereign(?:ty)?|autonomy|independence|constitutional(?:\\s+(?:rights|framework|rule))?|domestic|institutional|foreign policy|authority|capacity|ability)\\b`,
    'i',
  ).test(text);
}

function claimsMissingTypedTerm(
  text: string,
  kind: InfluenceTermShape['kind'],
) {
  const phrases = [
    kind.replaceAll('-', ' '),
    ...(influenceTermAliases[kind] ?? []),
  ];
  return text.split(/[.!?;]+/).some((sentence) => {
    const normalizedSentence = sentence.toLocaleLowerCase();
    const explicitlyMissing =
      /\b(?:no|without|lack(?:s|ing)?|do not include|don't include|does not include|doesn't include|do not contain|don't contain|does not contain|doesn't contain|missing|absent|absence of)\b/i.test(
        sentence,
      );
    const describesMissingScope =
      /\b(?:minimum|quantified|measurable|specified|specific|amount|volume|quantity|binding|concrete|deliverable|enough|sufficient)\b/i.test(
        sentence,
      );
    return (
      explicitlyMissing &&
      !describesMissingScope &&
      phrases.some((phrase) =>
        normalizedSentence.includes(phrase.toLocaleLowerCase()),
      )
    );
  });
}

function claimsCurrentOfferContainsTerm(
  text: string,
  kind: InfluenceTermShape['kind'],
) {
  const phrases = [
    kind.replaceAll('-', ' '),
    ...(influenceTermAliases[kind] ?? []),
  ];
  return text.split(/[.!?;]+/).some((sentence) => {
    const explicitlyCurrent =
      /\b(?:current|this|the)\s+(?:offer|proposal|request|package)\b[^.!?]{0,80}\b(?:asks?|requests?|demands?|requires?|includes?|contains?|proposes?|imposes?)\b/i.test(
        sentence,
      ) || /\b(?:request|demand|requirement)\s+(?:for|to)\b/i.test(sentence);
    const historical =
      /\b(?:previously|previous|prior|earlier|former|old|last\s+(?:offer|request|round|time)|already\s+rejected)\b/i.test(
        sentence,
      );
    const omission =
      /\b(?:no|without|lacks?|lacking|missing|absent|omits?|removed?|does\s+not|doesn't)\b/i.test(
        sentence,
      );
    return (
      explicitlyCurrent &&
      !historical &&
      !omission &&
      phrases.some((phrase) =>
        sentence.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()),
      )
    );
  });
}

const termSignature = (term: InfluenceTermShape) =>
  [
    term.kind,
    term.patronNationId,
    term.subjectNationId,
    term.amount,
    term.ratePercent,
  ].join(':');

function previouslyRemovedAuthorityTerms(
  negotiation: Negotiation,
  decidingActorNationId: NationId,
) {
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  if (decidingActorNationId !== patronNationId) return [];
  const priorCounter = [...negotiation.responses]
    .reverse()
    .find(
      (response) =>
        response.nationId === subjectNationId &&
        response.move === 'counter' &&
        response.counterInfluenceTerms !== undefined,
    );
  if (!priorCounter) return [];
  const priorOffer = priorCounter.influenceTerms ?? [];
  const counterTerms = priorCounter.counterInfluenceTerms ?? [];
  return priorOffer.filter(
    (term) =>
      authorityKinds.has(term.kind) &&
      !counterTerms.some(
        (counterTerm) => termSignature(counterTerm) === termSignature(term),
      ),
  );
}

function summarizeInfluenceTerms(terms: readonly InfluenceTermShape[]) {
  return terms.length
    ? terms.map((term) => term.kind.replaceAll('-', ' ')).join(', ')
    : 'no new binding authority';
}

function narrowedInfluenceKinds(
  kind: InfluenceTermShape['kind'],
): InfluenceTermShape['kind'][] {
  switch (kind) {
    case 'join-patron-wars':
      return ['join-defensive-wars'];
    case 'foreign-policy-veto':
      return ['foreign-policy-consultation', 'support-diplomatic-initiatives'];
    case 'foreign-policy-alignment':
      return ['support-diplomatic-initiatives', 'foreign-policy-consultation'];
    case 'no-rival-alliance':
      return ['foreign-policy-consultation'];
    case 'war-declaration-approval':
      return ['join-defensive-wars'];
    case 'exclusive-market-access':
      return ['preferential-trade'];
    case 'economic-policy-approval':
      return ['common-economic-rules'];
    case 'host-bases':
      return ['military-access'];
    default:
      return [];
  }
}

function needBasedCompensation(
  world: WorldState,
  negotiation: Negotiation,
): InfluenceTermShape | null {
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  if (!world.nations.some((nation) => nation.id === patronNationId) || !subject)
    return null;
  const active = influenceProfile(
    world,
    patronNationId,
    subjectNationId,
  ).activeTerms;
  const activeKinds = new Set(active.map((term) => term.kind));
  const offeredKinds = new Set(
    negotiation.influenceTerms.map((term) => term.kind),
  );
  const create = (kind: InfluenceTermShape['kind'], amount = 0) =>
    InfluenceTermSchema.parse({
      kind,
      patronNationId,
      subjectNationId,
      amount,
    });
  if (subject.stats.debt >= 20) {
    const amount = Math.min(
      subject.stats.debt,
      Math.max(10, Math.floor(subject.stats.debt * 0.2)),
    );
    const candidate = create('debt-relief', amount);
    if (
      amount > 0 &&
      !activeKinds.has(candidate.kind) &&
      !offeredKinds.has(candidate.kind)
    )
      return candidate;
  }
  if (subject.stats.energyExposure >= 58) {
    const amount = Math.min(
      12,
      Math.max(1, Math.ceil(subject.stats.energyExposure / 10)),
    );
    const candidate = create('energy-supply', amount);
    if (!activeKinds.has(candidate.kind) && !offeredKinds.has(candidate.kind))
      return candidate;
  }
  if (subject.stats.industrial < 75 || subject.stats.fiscal < 48) {
    const amount = Math.max(
      1,
      Math.min(
        12,
        Math.floor((subject.stats.economy + subject.stats.fiscal) / 10),
      ),
    );
    const candidate = create('infrastructure-investment', amount);
    if (!activeKinds.has(candidate.kind) && !offeredKinds.has(candidate.kind))
      return candidate;
  }
  if (subject.stats.unrest >= 20) {
    const candidate = create('subsidy', 5);
    if (!activeKinds.has(candidate.kind) && !offeredKinds.has(candidate.kind))
      return candidate;
  }
  return null;
}

function quantifyUnspecifiedTargetSupport(
  world: WorldState,
  negotiation: Negotiation,
  support: readonly InfluenceTermShape[],
) {
  const { subjectNationId } = influencePartiesForNegotiation(negotiation);
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  if (!subject) return { terms: [...support], changes: [] as string[] };
  const changes: string[] = [];
  const terms = support.map((term) => {
    if (term.amount > 0) return term;
    let amount = 0;
    if (term.kind === 'energy-supply' && subject.stats.energyExposure >= 58)
      amount = Math.min(
        12,
        Math.max(1, Math.ceil(subject.stats.energyExposure / 10)),
      );
    else if (
      term.kind === 'infrastructure-investment' &&
      (subject.stats.industrial < 75 || subject.stats.fiscal < 48)
    )
      amount = Math.max(
        1,
        Math.min(
          12,
          Math.floor((subject.stats.economy + subject.stats.fiscal) / 10),
        ),
      );
    else if (term.kind === 'debt-relief' && subject.stats.debt >= 20)
      amount = Math.min(
        subject.stats.debt,
        Math.max(10, Math.floor(subject.stats.debt * 0.2)),
      );
    if (!amount) return term;
    changes.push(`${amount} units of ${term.kind.replaceAll('-', ' ')}`);
    return InfluenceTermSchema.parse({ ...term, amount });
  });
  return { terms, changes };
}

/** Code-authored counterpackages edit the actual offer and only add direct compensation for a known need. */
export function buildInfluenceCounterOffers(
  world: WorldState,
  negotiation: Negotiation,
): InfluenceCounterOffer[] {
  if (negotiation.kind !== 'influence') return [];
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  const activeSignatures = new Set(
    influenceProfile(world, patronNationId, subjectNationId).activeTerms.map(
      termSignature,
    ),
  );
  const usable = negotiation.influenceTerms.filter(
    (term) => !activeSignatures.has(termSignature(term)),
  );
  const support = usable.filter((term) => materialBenefitKinds.has(term.kind));
  const proposedAuthority = usable.filter((term) =>
    authorityKinds.has(term.kind),
  );
  const unclassified = usable.filter(
    (term) =>
      !materialBenefitKinds.has(term.kind) && !authorityKinds.has(term.kind),
  );
  const defaultCompensation =
    negotiation.recipientNationId === subjectNationId
      ? [needBasedCompensation(world, negotiation)].filter(
          (term): term is InfluenceTermShape => term !== null,
        )
      : [];
  const quantifiedSupport = quantifyUnspecifiedTargetSupport(
    world,
    negotiation,
    support,
  );
  const counterOffers: InfluenceCounterOffer[] = [];
  const add = (
    id: string,
    label: string,
    terms: InfluenceTermShape[],
    termsText: string,
  ) => {
    const unique = [
      ...new Map(terms.map((term) => [termSignature(term), term])).values(),
    ];
    if (!unique.length) return;
    const signature = unique.map(termSignature).sort().join('|');
    if (
      counterOffers.some(
        (offer) =>
          offer.terms.map(termSignature).sort().join('|') === signature,
      )
    )
      return;
    counterOffers.push({
      id,
      label,
      terms: unique,
      termsText: termsText.slice(0, 600),
    });
  };
  const lessRestrictiveBase = [
    ...support,
    ...unclassified,
    ...defaultCompensation,
  ];
  if (proposedAuthority.length) {
    add(
      'retain-material-terms',
      'Retain the offered benefits and remove new authority obligations',
      lessRestrictiveBase,
      `Retain ${summarizeInfluenceTerms(lessRestrictiveBase)} and omit the requested high-authority clauses.`,
    );
    if (quantifiedSupport.changes.length) {
      add(
        'quantify-targeted-support',
        'Specify a target-valued support commitment and omit excessive authority',
        [...quantifiedSupport.terms, ...unclassified, ...defaultCompensation],
        `Specify ${quantifiedSupport.changes.join(' and ')} while retaining the remaining offered support and omitting the requested high-authority clauses.`,
      );
    }
    for (const [index, requested] of proposedAuthority.slice(0, 2).entries()) {
      const narrowed = narrowedInfluenceKinds(requested.kind)
        .map((kind) =>
          InfluenceTermSchema.parse({
            kind,
            patronNationId: requested.patronNationId,
            subjectNationId: requested.subjectNationId,
          }),
        )
        .filter((term) => !activeSignatures.has(termSignature(term)))
        .slice(0, 1);
      add(
        `narrow-authority-${index + 1}`,
        `Narrow ${requested.kind.replaceAll('-', ' ')} to a limited commitment`,
        [
          ...support,
          ...unclassified,
          ...defaultCompensation,
          ...narrowed,
          ...proposedAuthority.filter((term) => term.kind !== requested.kind),
        ],
        `Replace ${requested.kind.replaceAll('-', ' ')} with ${narrowed.length ? summarizeInfluenceTerms(narrowed) : 'no new authority'}; retain ${summarizeInfluenceTerms([...support, ...defaultCompensation])}.`,
      );
    }
  } else if (support.length && defaultCompensation.length) {
    add(
      'add-targeted-compensation',
      'Increase the package with one benefit tied to a current target need',
      [...support, ...unclassified, ...defaultCompensation],
      `Keep the offered ${summarizeInfluenceTerms(support)} and add ${summarizeInfluenceTerms(defaultCompensation)} for a documented target need.`,
    );
  }
  if (!proposedAuthority.length && quantifiedSupport.changes.length) {
    add(
      'quantify-targeted-support',
      'Specify a target-valued support commitment',
      [...quantifiedSupport.terms, ...unclassified, ...defaultCompensation],
      `Specify ${quantifiedSupport.changes.join(' and ')} while retaining the rest of the package.`,
    );
  }
  const consultationAlreadyPresent = [
    ...negotiation.influenceTerms,
    ...influenceProfile(world, patronNationId, subjectNationId).activeTerms,
  ].some((term) => term.kind === 'foreign-policy-consultation');
  if (
    negotiation.recipientNationId === patronNationId &&
    support.length > 0 &&
    !proposedAuthority.length &&
    !consultationAlreadyPresent
  ) {
    const consultation = InfluenceTermSchema.parse({
      kind: 'foreign-policy-consultation',
      patronNationId,
      subjectNationId,
    });
    add(
      'add-reversible-consultation',
      'Keep material support and add reversible foreign-policy consultation',
      [...support, ...unclassified, ...defaultCompensation, consultation],
      `Keep the offered ${summarizeInfluenceTerms(support)} and add reversible foreign-policy consultation, with no veto or war obligation.`,
    );
  }
  return counterOffers.slice(0, 3);
}

export function preferredPersistentInfluenceChoice(
  proposedCandidateId: string,
  plannedCandidateId: string | undefined,
  planReviewDue: boolean,
  supersedingUrgentAction: boolean,
) {
  return planReviewDue && plannedCandidateId && !supersedingUrgentAction
    ? plannedCandidateId
    : proposedCandidateId;
}

function mentionsNation(text: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
    'iu',
  ).test(text);
}

/** Repair a planner rationale that names a country outside its selected target scope. */
export function repairOutOfScopeInfluenceRationale(
  reason: string,
  knownNationNames: readonly string[],
  allowedNationNames: readonly string[],
  fallback: string,
) {
  const allowed = new Set(
    allowedNationNames.map((name) => name.toLocaleLowerCase()),
  );
  const outOfScopeNames = knownNationNames.filter(
    (name) =>
      !allowed.has(name.toLocaleLowerCase()) && mentionsNation(reason, name),
  );
  return outOfScopeNames.length
    ? { reason: fallback, outOfScopeNames }
    : { reason, outOfScopeNames: [] as string[] };
}

const economicKinds = new Set([
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
  'mandatory-procurement',
]);
const securityKinds = new Set([
  'security-guarantee',
  'join-defensive-wars',
  'join-patron-wars',
  'military-access',
  'host-bases',
  'military-planning',
]);

export function influenceCompetition(
  world: WorldState,
  subjectNationId: NationId,
  chosenNegotiationId: string,
) {
  return world.negotiations
    .filter(
      (negotiation) =>
        negotiation.kind === 'influence' &&
        negotiation.status === 'open' &&
        influencePartiesForNegotiation(negotiation).subjectNationId ===
          subjectNationId,
    )
    .sort(
      (a, b) =>
        Number(b.id === chosenNegotiationId) -
          Number(a.id === chosenNegotiationId) ||
        a.createdDate.localeCompare(b.createdDate),
    )
    .slice(0, 5)
    .map((negotiation) => {
      const patronNationId =
        influencePartiesForNegotiation(negotiation).patronNationId;
      const profile = influenceProfile(world, patronNationId, subjectNationId);
      const assessment = assessInfluenceOffer(
        world,
        patronNationId,
        subjectNationId,
        negotiation.influenceTerms,
      );
      const economicValue = Math.min(
        100,
        Math.round(
          negotiation.influenceTerms.reduce(
            (sum, term) => sum + (economicKinds.has(term.kind) ? 15 : 0),
            0,
          ) +
            assessment.offeredBenefit * 0.25,
        ),
      );
      const securityValue = Math.min(
        100,
        negotiation.influenceTerms.reduce(
          (sum, term) => sum + (securityKinds.has(term.kind) ? 24 : 0),
          0,
        ),
      );
      const otherPatronCommitments = world.treaties
        .filter(
          (treaty) =>
            treaty.status === 'active' &&
            treaty.parties.includes(subjectNationId),
        )
        .flatMap((treaty) => treaty.influenceTerms)
        .filter(
          (term) =>
            term.status === 'active' &&
            term.subjectNationId === subjectNationId &&
            term.patronNationId !== patronNationId,
        ).length;
      return {
        negotiationId: negotiation.id,
        patronNationId,
        economicValue,
        securityValue,
        sovereigntyCost: Math.min(100, assessment.sovereigntyCost),
        reliability: profile.reliability,
        switchingCost: Math.min(100, otherPatronCommitments * 8),
        netScore: Math.max(-100, Math.min(100, assessment.score)),
        selected: negotiation.id === chosenNegotiationId,
      };
    });
}

const authoritySignature = (terms: readonly InfluenceTermShape[]) =>
  terms
    .filter((term) => authorityKinds.has(term.kind))
    .map(
      (term) => `${term.kind}:${term.patronNationId}:${term.subjectNationId}`,
    )
    .sort()
    .join('|');

const fullOfferSignature = (terms: readonly InfluenceTermShape[]) =>
  terms.map(termSignature).sort().join('|');

function latestPriorNegativeResponse(
  world: WorldState,
  negotiation: Negotiation,
  decidingActorNationId: NationId,
) {
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  return world.negotiations
    .filter(
      (candidate) =>
        candidate.id !== negotiation.id &&
        candidate.kind === 'influence' &&
        influencePartiesForNegotiation(candidate).patronNationId ===
          patronNationId &&
        influencePartiesForNegotiation(candidate).subjectNationId ===
          subjectNationId,
    )
    .flatMap((candidate) =>
      candidate.responses
        .filter(
          (response) =>
            response.nationId === decidingActorNationId &&
            ['reject', 'counter'].includes(response.move),
        )
        .map((response) => ({ candidate, response })),
    )
    .sort((a, b) => a.response.date.localeCompare(b.response.date))
    .at(-1);
}

function materiallyChangedSince(
  world: WorldState,
  negotiation: Negotiation,
  previous: ReturnType<typeof latestPriorNegativeResponse>,
) {
  const old = previous?.response.influenceDecision?.assessment;
  if (!old) return false;
  const current = assessInfluenceOffer(
    world,
    influencePartiesForNegotiation(negotiation).patronNationId,
    influencePartiesForNegotiation(negotiation).subjectNationId,
    negotiation.influenceTerms,
  ).factors;
  return (
    current.relationship.trust >= old.relationship.trust + 8 ||
    current.relationship.reliability >= old.relationship.reliability + 8 ||
    current.relationship.leverage >= old.relationship.leverage + 8 ||
    current.relationship.resistance <= old.relationship.resistance - 8 ||
    current.strategicFit.targetThreat >= old.strategicFit.targetThreat + 15 ||
    current.benefits.total >= old.benefits.total + 15 ||
    current.costs.sovereignty <= old.costs.sovereignty - 12 ||
    (current.alternatives.rivalOfferScore !== null &&
      old.alternatives.rivalOfferScore !== null &&
      current.alternatives.rivalOfferScore <=
        old.alternatives.rivalOfferScore - 15)
  );
}

/** A deferred negotiation is reconsidered only when its recorded conditions materially move. */
export function shouldRevisitDeferredInfluence(
  world: WorldState,
  negotiation: Negotiation,
) {
  const response = negotiation.responses.at(-1);
  if (response?.move !== 'delay' || !response.influenceDecision?.assessment)
    return true;
  return materiallyChangedSince(world, negotiation, {
    candidate: negotiation,
    response,
  });
}

function unauthorizedNationNames(
  world: WorldState,
  negotiation: Negotiation,
  text: string,
) {
  const allowed = new Set([
    negotiation.proposerNationId,
    negotiation.recipientNationId,
    assessInfluenceOffer(
      world,
      influencePartiesForNegotiation(negotiation).patronNationId,
      influencePartiesForNegotiation(negotiation).subjectNationId,
      negotiation.influenceTerms,
    ).factors.alternatives.rivalNationId,
  ]);
  return world.nations
    .filter(
      (nation) =>
        !allowed.has(nation.id) &&
        nation.name.length > 3 &&
        text.toLocaleLowerCase().includes(nation.name.toLocaleLowerCase()),
    )
    .map((nation) => nation.name);
}

export type HybridInfluenceResponse = {
  move: 'accept' | 'reject' | 'counter' | 'delay';
  rawMove: 'accept' | 'reject' | 'counter' | 'delay';
  message: string;
  modelRationale: string | null;
  displayRationale: string | null;
  counterOffer: InfluenceCounterOffer | null;
  reconsiderationConditions: string[];
  repairNotes: string[];
};

export function calibrateInfluenceResponse(
  world: WorldState,
  negotiation: Negotiation,
  rawMove: 'accept' | 'reject' | 'counter' | 'delay',
  rawMessage: string,
  modelDecision:
    | Pick<InfluenceDecisionShape, 'explanation' | 'reconsiderationConditions'>
    | undefined,
  counterOffers: readonly InfluenceCounterOffer[],
  requestedCounterOfferId?: string,
  rawCounterTerms: readonly InfluenceTermShape[] = [],
  decidingActorNationId: NationId = negotiation.recipientNationId,
): HybridInfluenceResponse {
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  const decisionSide =
    decidingActorNationId === subjectNationId
      ? 'target'
      : decidingActorNationId === patronNationId
        ? 'patron'
        : 'other';
  const previouslyRemovedAuthority = previouslyRemovedAuthorityTerms(
    negotiation,
    decidingActorNationId,
  );
  const assessment = assessInfluenceOffer(
    world,
    patronNationId,
    subjectNationId,
    negotiation.influenceTerms,
  );
  const previous = latestPriorNegativeResponse(
    world,
    negotiation,
    decidingActorNationId,
  );
  const previousTerms = previous?.candidate.influenceTerms ?? [];
  const repeatedPackage = Boolean(
    previous &&
    (fullOfferSignature(previousTerms) ===
      fullOfferSignature(negotiation.influenceTerms) ||
      (authoritySignature(previousTerms) !== '' &&
        authoritySignature(previousTerms) ===
          authoritySignature(negotiation.influenceTerms) &&
        previousTerms
          .filter((term) => materialBenefitKinds.has(term.kind))
          .map(termSignature)
          .sort()
          .join('|') ===
          negotiation.influenceTerms
            .filter((term) => materialBenefitKinds.has(term.kind))
            .map(termSignature)
            .sort()
            .join('|'))),
  );
  const changedSinceRejection = materiallyChangedSince(
    world,
    negotiation,
    previous,
  );
  const rawRationale = (modelDecision?.explanation || rawMessage || '')
    .trim()
    .slice(0, 2000);
  const unrelatedNames = unauthorizedNationNames(
    world,
    negotiation,
    `${rawRationale} ${rawMessage}`,
  );
  const repairNotes: string[] = [];
  let rationaleTrusted = true;
  if (unrelatedNames.length) {
    rationaleTrusted = false;
    repairNotes.push(
      `Removed references outside the locked decision scope: ${unrelatedNames.slice(0, 3).join(', ')}.`,
    );
  }
  if (
    containsPrivateStrategicPlanningLanguage(rawRationale) ||
    containsPrivateStrategicPlanningLanguage(rawMessage)
  ) {
    rationaleTrusted = false;
    repairNotes.push(
      'Private sphere-planning context was removed from the diplomatic explanation.',
    );
  }
  if (decisionSide === 'patron') {
    const counterpartName =
      world.nations.find((nation) => nation.id === subjectNationId)?.name ?? '';
    const decidingName =
      world.nations.find((nation) => nation.id === decidingActorNationId)
        ?.name ?? '';
    const combinedRationale = `${rawRationale} ${rawMessage}`;
    if (
      counterpartName &&
      decidingName &&
      framesCounterpartNeeds(combinedRationale, counterpartName) &&
      !combinedRationale
        .toLocaleLowerCase()
        .includes(decidingName.toLocaleLowerCase())
    ) {
      rationaleTrusted = false;
      repairNotes.push(
        'The rationale repeated the counterpart’s need as the patron’s own reason and was replaced with a term-grounded explanation.',
      );
    }
    if (
      decidingName &&
      framesDecidingActorSovereignty(combinedRationale, decidingName)
    ) {
      rationaleTrusted = false;
      repairNotes.push(
        'The rationale assigned the target-side sovereignty cost to the patron and was replaced with a term-grounded explanation.',
      );
    }
  }
  if (
    assessment.factors.benefits.total >= 12 &&
    /\b(?:no|without|lacks?|offers? no|does not provide)\b[^.!?;]{0,40}\b(?:benefits?|compensation|support|security|economic value)\b/i.test(
      rawRationale,
    )
  ) {
    rationaleTrusted = false;
    repairNotes.push(
      'The model said the offer had no benefit, but the structured package includes target-valued support.',
    );
  }
  const canonicalTerms = [
    ...negotiation.influenceTerms,
    ...influenceProfile(world, patronNationId, subjectNationId).activeTerms,
  ];
  const falselyMissingTerms = [
    ...new Map(canonicalTerms.map((term) => [term.kind, term])).values(),
  ].filter((term) =>
    claimsMissingTypedTerm(`${rawRationale} ${rawMessage}`, term.kind),
  );
  if (falselyMissingTerms.length) {
    rationaleTrusted = false;
    repairNotes.push(
      `The model called ${summarizeInfluenceTerms(falselyMissingTerms)} missing even though those typed terms are in the active relationship or proposal.`,
    );
  }
  const activeAuthorityKinds = new Set(
    influenceProfile(world, patronNationId, subjectNationId).activeTerms.map(
      (term) => term.kind,
    ),
  );
  const previouslyRemovedAuthorityKinds = new Set(
    previouslyRemovedAuthority.map((term) => term.kind),
  );
  const falselyCurrentAuthorityTerms = [...authorityKinds].filter(
    (kind) =>
      !negotiation.influenceTerms.some((term) => term.kind === kind) &&
      !activeAuthorityKinds.has(kind) &&
      !previouslyRemovedAuthorityKinds.has(kind) &&
      claimsCurrentOfferContainsTerm(`${rawRationale} ${rawMessage}`, kind),
  );
  if (falselyCurrentAuthorityTerms.length) {
    rationaleTrusted = false;
    repairNotes.push(
      `The model treated ${falselyCurrentAuthorityTerms.map((kind) => kind.replaceAll('-', ' ')).join(', ')} as part of the current offer even though those authority terms are absent.`,
    );
  }
  if (
    assessment.reliability >= 80 &&
    assessment.factors.relationship.trust >= 60 &&
    /\b(?:unreliable|missed payments?|failed to deliver|cannot be trusted|broken promise)\b/i.test(
      rawRationale,
    )
  ) {
    rationaleTrusted = false;
    repairNotes.push(
      'The model cited poor reliability despite strong recorded delivery and trust evidence.',
    );
  }
  let move = rawMove;
  const favorable =
    decisionSide === 'target' &&
    ['strongly-favorable', 'favorable'].includes(assessment.recommendationZone);
  const groundedQualitativeObjection =
    rationaleTrusted &&
    ((/sovereignty|autonomy|constitutional|independent policy/i.test(
      rawRationale,
    ) &&
      assessment.factors.costs.sovereignty >= 20) ||
      (/(?:offensive|patron|military) wars?|war obligation|military autonomy/i.test(
        rawRationale,
      ) &&
        assessment.factors.costs.militaryObligation >= 15) ||
      (/(?:domestic|public|parliament|legitimacy|resistance|opposition)/i.test(
        rawRationale,
      ) &&
        assessment.factors.relationship.resistance >= 25) ||
      (/(?:trust|reliable|delivery|promise|obligation)/i.test(rawRationale) &&
        (assessment.factors.relationship.trust < 50 ||
          assessment.factors.relationship.reliability < 65)) ||
      (/(?:rival|alternative|outside option)/i.test(rawRationale) &&
        assessment.factors.alternatives.rivalOfferScore !== null &&
        assessment.factors.alternatives.rivalOfferScore >= assessment.score));
  const explicitRedLineConflict =
    world.nations
      .find((nation) => nation.id === decidingActorNationId)
      ?.strategy.redLines.some((redLine) => {
        const normalizedRedLine = redLine
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        return negotiation.influenceTerms.some((term) =>
          normalizedRedLine.includes(
            term.kind
              .replaceAll('-', ' ')
              .toLocaleLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .trim(),
          ),
        );
      }) === true;
  const absolutePoliticalRedLine =
    /\b(?:non-negotiable|red line|will never|cannot under any circumstances|constitution prohibits)\b/i.test(
      rawRationale,
    ) || explicitRedLineConflict;
  const repeatedWithoutChange = repeatedPackage && !changedSinceRejection;
  const deferUnstructuredCounter =
    decisionSide === 'target' &&
    rawMove === 'counter' &&
    ['strongly-favorable', 'favorable', 'negotiable'].includes(
      assessment.recommendationZone,
    ) &&
    !absolutePoliticalRedLine &&
    !repeatedWithoutChange;
  let deferredUnstructuredCounter = false;
  if (repeatedWithoutChange && move === 'accept') {
    move = counterOffers.length ? 'counter' : 'delay';
    repairNotes.push(
      'The same structured political ask was previously rejected and the relevant circumstances have not materially changed.',
    );
  }
  if (explicitRedLineConflict && move === 'accept') {
    move = counterOffers.length ? 'counter' : 'reject';
    rationaleTrusted = false;
    repairNotes.push(
      'Acceptance conflicted with the deciding government’s explicit red line against a proposed clause.',
    );
  }
  if (
    favorable &&
    move === 'reject' &&
    counterOffers.length > 0 &&
    !repeatedWithoutChange &&
    !(groundedQualitativeObjection && absolutePoliticalRedLine)
  ) {
    move = 'counter';
    repairNotes.push(
      `A ${assessment.recommendationZone} proposal with a legal structured counter was converted from rejection to bargaining.`,
    );
  }
  if (
    decisionSide === 'target' &&
    favorable &&
    move === 'reject' &&
    !rationaleTrusted &&
    counterOffers.length === 0 &&
    !repeatedWithoutChange &&
    !explicitRedLineConflict
  ) {
    move = 'delay';
    repairNotes.push(
      'An unsupported rejection of a favorable offer was deferred because no relevant structured counterpackage or explicit red line was available.',
    );
  }
  if (
    decisionSide === 'target' &&
    assessment.recommendationZone === 'strongly-unfavorable' &&
    move === 'accept' &&
    assessment.factors.benefits.total < 12 &&
    assessment.factors.strategicFit.targetThreat < 45 &&
    assessment.factors.relationship.leverage < 25 &&
    assessment.factors.relationship.resistance >= 55
  ) {
    move = counterOffers.length ? 'counter' : 'reject';
    repairNotes.push(
      'Acceptance conflicted with a high-cost, low-benefit offer and weak leverage; the move was constrained to bargaining or rejection.',
    );
  }
  if (move === 'counter' && !counterOffers.length) {
    if (deferUnstructuredCounter) {
      move = 'delay';
      deferredUnstructuredCounter = true;
      repairNotes.push(
        'The target’s negotiable objection had no safe structured amendment, so it was deferred rather than converted into an outright rejection.',
      );
    } else {
      move = rawMove === 'delay' ? 'delay' : 'reject';
      repairNotes.push(
        'No valid structured counterpackage could be formed from the offer or a directly relevant target need.',
      );
    }
  }

  let counterOffer: InfluenceCounterOffer | null = null;
  if (move === 'counter') {
    const byId = counterOffers.find(
      (candidate) => candidate.id === requestedCounterOfferId,
    );
    const byTerms = counterOffers.find(
      (candidate) =>
        fullOfferSignature(candidate.terms) ===
        fullOfferSignature(rawCounterTerms),
    );
    const consultationMatchesConcern =
      decisionSide === 'target' &&
      /\b(?:sovereignty|autonomy|foreign[- ]policy independence|consultation|constitutional)\b/i.test(
        `${rawRationale} ${rawMessage}`,
      );
    const quantifiedSupportMatchesConcern =
      decisionSide === 'target' &&
      /\b(?:binding|specific|specified|amount|quantity|volume|enough|sufficient|delivery schedule)\b/i.test(
        `${rawRationale} ${rawMessage}`,
      ) &&
      /\b(?:energy|supply|infrastructure|investment|debt|aid|support)\b/i.test(
        `${rawRationale} ${rawMessage}`,
      );
    const quantifiedSupportCounter = quantifiedSupportMatchesConcern
      ? counterOffers.find(
          (candidate) => candidate.id === 'quantify-targeted-support',
        )
      : undefined;
    const consultationCounter = consultationMatchesConcern
      ? counterOffers.find(
          (candidate) => candidate.id === 'add-reversible-consultation',
        )
      : undefined;
    counterOffer =
      byId ??
      byTerms ??
      quantifiedSupportCounter ??
      consultationCounter ??
      counterOffers[0] ??
      null;
    if (!byId && !byTerms)
      repairNotes.push(
        'The model counter was replaced with a code-authored package that edits only offered authority and relevant compensation terms.',
      );
  }

  const safeModelConditions = (modelDecision?.reconsiderationConditions ?? [])
    .filter(
      (condition) =>
        unauthorizedNationNames(world, negotiation, condition).length === 0 &&
        !containsPrivateStrategicPlanningLanguage(condition),
    )
    .slice(0, 4);
  const reconsiderationConditions =
    move !== 'delay'
      ? []
      : safeModelConditions.length
        ? safeModelConditions
        : deferredUnstructuredCounter
          ? [
              'Reassess after the stated objection is addressed by a materially changed, affordable term or the target need changes.',
            ]
          : [
              ...(assessment.reliability < 65
                ? [
                    'Review after outstanding patron obligations are delivered and reliability improves.',
                  ]
                : []),
              ...(assessment.resistance >= 45 ||
              assessment.factors.costs.sovereignty >= 35
                ? [
                    'Reconsider a narrower authority clause after domestic resistance or sovereignty concerns ease.',
                  ]
                : []),
              ...(assessment.factors.strategicFit.targetThreat >= 60
                ? [
                    'Review the agreement again when the current security threat changes.',
                  ]
                : []),
              ...(assessment.reliability >= 65 &&
              assessment.resistance < 45 &&
              assessment.factors.costs.sovereignty < 35 &&
              assessment.factors.strategicFit.targetThreat < 60
                ? [
                    'Reassess if trust, dependence, target needs, or the available alternatives change materially.',
                  ]
                : []),
            ].slice(0, 4);

  const targetName =
    world.nations.find((nation) => nation.id === negotiation.recipientNationId)
      ?.name ?? 'The government';
  const authorityRequested = negotiation.influenceTerms
    .filter((term) => authorityKinds.has(term.kind))
    .map((term) => term.kind.replaceAll('-', ' '));
  const modelRationale = rawRationale || null;
  let message = rawMessage.trim().slice(0, 260);
  if (move === 'counter' && counterOffer) {
    const concern =
      rationaleTrusted && modelRationale
        ? modelRationale
        : authorityRequested.length
          ? `${authorityRequested[0]} goes beyond the authority this government is ready to grant`
          : 'the package needs terms that better match current national needs';
    message = `${concern}. Counteroffer: ${counterOffer.termsText}`.slice(
      0,
      260,
    );
  } else if (move === 'delay') {
    message =
      rationaleTrusted && modelRationale
        ? `Not now: ${modelRationale}`.slice(0, 260)
        : `${targetName} defers the proposal until its stated reconsideration conditions change.`;
  } else if (!rationaleTrusted) {
    const decidingName =
      world.nations.find((nation) => nation.id === decidingActorNationId)
        ?.name ?? 'The government';
    message =
      move === 'reject' &&
      decisionSide === 'patron' &&
      previouslyRemovedAuthority.length
        ? `${decidingName} rejects the counteroffer because it removes the previously requested ${summarizeInfluenceTerms(previouslyRemovedAuthority)} clause${previouslyRemovedAuthority.length === 1 ? '' : 's'}.`
        : move === 'reject'
          ? `${targetName} rejects the proposal based on its recorded sovereignty, resistance, and alternative-offer costs.`
          : `${targetName} accepts the package based on its recorded benefits and relationship conditions.`;
  }
  return {
    move,
    rawMove,
    message:
      message || `${targetName} records its decision on the proposed terms.`,
    modelRationale,
    displayRationale: rationaleTrusted ? modelRationale : null,
    counterOffer,
    reconsiderationConditions,
    repairNotes: repairNotes.slice(0, 4),
  };
}

export function influenceDecisionRecord(
  world: WorldState,
  subjectNationId: NationId,
  negotiationId: string,
  move: string,
  message: string,
  modelDecision?: InfluenceDecisionShape,
  details: {
    modelRationale?: string | null;
    displayRationale?: string | null;
    reconsiderationConditions?: string[];
    repairNotes?: string[];
    counterOfferId?: string;
    rawDisposition?: InfluenceDecisionShape['rawDisposition'];
    counterOfferAvailable?: boolean;
    counterOfferIds?: string[];
    counterOfferCandidates?: readonly InfluenceCounterOffer[];
  } = {},
): InfluenceDecisionShape {
  const negotiation = world.negotiations.find(
    (candidate) => candidate.id === negotiationId,
  );
  const sides = negotiation
    ? influencePartiesForNegotiation(negotiation)
    : null;
  const assessment = negotiation
    ? assessInfluenceOffer(
        world,
        sides!.patronNationId,
        sides!.subjectNationId,
        negotiation.influenceTerms,
      )
    : null;
  const previouslyRemovedAuthority = negotiation
    ? previouslyRemovedAuthorityTerms(negotiation, subjectNationId)
    : [];
  const targetNationId = sides?.subjectNationId ?? subjectNationId;
  const patronNationId = sides?.patronNationId;
  const comparisons = influenceCompetition(
    world,
    targetNationId,
    negotiationId,
  );
  const selectedComparison = comparisons.find(
    (entry) => entry.negotiationId === negotiationId,
  );
  const strongestAlternative = comparisons
    .filter((entry) => entry.negotiationId !== negotiationId)
    .sort((a, b) => b.netScore - a.netScore)[0];
  const hasBetterAlternative = Boolean(
    assessment &&
    strongestAlternative &&
    strongestAlternative.netScore >= assessment.score + 8,
  );
  let reasonCode: InfluenceDecisionShape['reasonCode'] =
    move === 'accept'
      ? 'acceptable-balanced-offer'
      : move === 'delay'
        ? 'timing-not-ready'
        : 'uncertain-benefit';
  if (hasBetterAlternative) reasonCode = 'rival-offer';
  else if (assessment && move !== 'accept') {
    const profile = negotiation
      ? influenceProfile(world, patronNationId!, targetNationId)
      : null;
    const relation = world.relations.find(
      (candidate) =>
        negotiation &&
        [candidate.nationA, candidate.nationB].includes(patronNationId!) &&
        [candidate.nationA, candidate.nationB].includes(targetNationId),
    );
    if (assessment.reliability < 55) reasonCode = 'patron-unreliable';
    else if (assessment.resistance >= 55) reasonCode = 'resistance';
    else if ((relation?.trust ?? 50) < 40) reasonCode = 'low-trust';
    else if ((profile?.leverage ?? 50) < 25 && assessment.sovereigntyCost >= 25)
      reasonCode = 'insufficient-leverage';
    else if (assessment.sovereigntyCost >= 35) reasonCode = 'sovereignty-cost';
    else if (assessment.offeredBenefit < 20)
      reasonCode = 'inadequate-compensation';
  }
  if (
    !hasBetterAlternative &&
    move === 'reject' &&
    sides &&
    subjectNationId === sides.patronNationId &&
    previouslyRemovedAuthority.length
  )
    reasonCode = 'incompatible-preferences';
  const patronName = negotiation
    ? (world.nations.find((nation) => nation.id === patronNationId)?.name ??
      'The patron')
    : 'The patron';
  const targetName =
    world.nations.find((nation) => nation.id === targetNationId)?.name ??
    'the target government';
  const actorName =
    world.nations.find((nation) => nation.id === subjectNationId)?.name ??
    subjectNationId;
  const reviewingCounteroffer = Boolean(
    negotiation &&
    subjectNationId === patronNationId &&
    negotiation.proposerNationId === targetNationId,
  );
  const economicValue = selectedComparison?.economicValue ?? 0;
  const securityValue = selectedComparison?.securityValue ?? 0;
  const sovereigntyCost =
    selectedComparison?.sovereigntyCost ?? assessment?.sovereigntyCost ?? 0;
  const reliability =
    selectedComparison?.reliability ?? assessment?.reliability ?? 0;
  const actionLabel =
    move === 'accept'
      ? 'Accepted'
      : move === 'counter'
        ? 'Countered'
        : move === 'delay'
          ? 'Deferred'
          : 'Rejected';
  if (
    move !== 'accept' &&
    details.displayRationale &&
    modelDecision?.reasonCode &&
    modelDecision.reasonCode !== 'acceptable-balanced-offer' &&
    modelDecision.reasonCode !== 'best-rival-offer'
  )
    reasonCode = modelDecision.reasonCode;
  const decisionLabel = reviewingCounteroffer
    ? `${actionLabel} ${targetName}’s counteroffer to ${patronName}`
    : `${actionLabel} ${patronName}’s offer to ${targetName}`;
  const rivalNetScore = selectedComparison?.netScore ?? assessment?.score ?? 0;
  const rivalComparison = strongestAlternative
    ? `${world.nations.find((nation) => nation.id === strongestAlternative.patronNationId)?.name ?? 'The strongest rival patron'} has the strongest relevant rival offer (net ${strongestAlternative.netScore} versus this package’s net ${rivalNetScore}); it is ${strongestAlternative.netScore > rivalNetScore ? 'stronger' : strongestAlternative.netScore === rivalNetScore ? 'comparable' : 'weaker'} on the modeled factors.`
    : '';
  const explanation = assessment
    ? `${decisionLabel}: benefits to ${targetName} are modeled at ${assessment.factors.benefits.total}/100 (economic ${economicValue}, security ${securityValue}); sovereignty cost to ${targetName} is ${sovereigntyCost}. The relationship records leverage ${assessment.factors.relationship.leverage}, resistance ${assessment.factors.relationship.resistance}, trust ${assessment.factors.relationship.trust}, and delivery reliability ${reliability}/100.${
        rivalComparison ? ` ${rivalComparison}` : ''
      }${
        reasonCode === 'sovereignty-cost'
          ? ' The requested authority exceeds what this package compensates for.'
          : reasonCode === 'patron-unreliable'
            ? ' Missed obligations reduce the value of future promises.'
            : reasonCode === 'resistance'
              ? ' Domestic resistance makes a broader commitment harder to sustain.'
              : reasonCode === 'low-trust'
                ? ' Low trust makes additional obligations difficult to rely on.'
                : reasonCode === 'inadequate-compensation'
                  ? ' The offered benefits do not sufficiently offset the requested obligations.'
                  : reasonCode === 'insufficient-leverage'
                    ? ' Current dependence is too limited to support this authority.'
                    : ''
      }${
        reviewingCounteroffer && previouslyRemovedAuthority.length
          ? ` ${actorName}'s prior offer requested ${summarizeInfluenceTerms(previouslyRemovedAuthority)}; the counteroffer removes that communicated clause.`
          : ''
      }${
        details.displayRationale
          ? ` ${actorName}’s judgment: ${details.displayRationale}`
          : ''
      }${
        move === 'counter' && message.trim()
          ? ` Counteroffer: ${message.trim()}`
          : move === 'delay' && (details.reconsiderationConditions?.length ?? 0)
            ? ` Reconsider when: ${details.reconsiderationConditions!.join('; ')}`
            : ''
      }`
    : message.trim() ||
      'The proposal was reviewed against current alternatives.';
  const profile = negotiation
    ? influenceProfile(world, patronNationId!, targetNationId)
    : null;
  const subject = world.nations.find((nation) => nation.id === targetNationId);
  const hasConsultation = profile?.activeTerms.some(
    (term) => term.kind === 'foreign-policy-consultation',
  );
  const possibleLeverage = assessment
    ? [
        ...(hasBetterAlternative
          ? ['Address the rival package’s stronger benefits or reliability.']
          : []),
        ...(assessment.sovereigntyCost >= 25
          ? [
              hasConsultation
                ? 'Request one authority clause at a time and set a review date.'
                : 'Offer reversible consultation before requesting approval rights.',
            ]
          : []),
        ...(assessment.reliability < 65
          ? ['Deliver existing payments or guarantees on time.']
          : []),
        ...(assessment.resistance >= 50
          ? [
              'Improve trust and reduce domestic resistance before widening obligations.',
            ]
          : []),
        ...(assessment.offeredBenefit < 30
          ? [
              subject?.stats.debt && subject.stats.debt >= 20
                ? 'Offer affordable debt relief with a clear amount and schedule.'
                : subject && subject.stats.energyExposure >= 58
                  ? 'Offer dependable, affordable energy supply.'
                  : subject &&
                      (subject.stats.industrial < 75 ||
                        subject.stats.fiscal < 48)
                    ? 'Offer infrastructure investment matched to the target’s capacity.'
                    : 'Pair the requested clause with a benefit the target values.',
            ]
          : []),
      ].slice(0, 4)
    : [];
  const persistedAssessment = assessment
    ? {
        ...assessment.factors,
        costs: {
          sovereignty: assessment.factors.costs.sovereignty,
          fiscal: assessment.factors.costs.fiscal,
          militaryObligation: assessment.factors.costs.militaryObligation,
          diplomaticRestriction: assessment.factors.costs.diplomaticRestriction,
        },
      }
    : undefined;
  return InfluenceDecision.parse({
    reasonCode,
    explanation: explanation.slice(0, 4000),
    comparison: comparisons,
    possibleLeverage,
    ...(persistedAssessment ? { assessment: persistedAssessment } : {}),
    ...(sides && subjectNationId === sides.subjectNationId
      ? { decisionPerspective: 'target' }
      : sides && subjectNationId === sides.patronNationId
        ? { decisionPerspective: 'patron' }
        : {}),
    disposition:
      move === 'delay'
        ? 'defer'
        : ['accept', 'counter', 'reject'].includes(move)
          ? move
          : 'reject',
    ...(details.rawDisposition
      ? { rawDisposition: details.rawDisposition }
      : {}),
    ...(details.modelRationale
      ? { modelRationale: details.modelRationale }
      : {}),
    reconsiderationConditions: details.reconsiderationConditions ?? [],
    repairNotes: details.repairNotes ?? [],
    ...(details.counterOfferAvailable !== undefined
      ? { counterOfferAvailable: details.counterOfferAvailable }
      : {}),
    ...(details.counterOfferIds
      ? { counterOfferIds: details.counterOfferIds.slice(0, 3) }
      : {}),
    ...(details.counterOfferCandidates
      ? {
          counterOfferCandidates: details.counterOfferCandidates
            .slice(0, 3)
            .map(({ id, label, terms, termsText }) => ({
              id,
              label,
              terms,
              termsText,
            })),
        }
      : {}),
    ...(details.counterOfferId
      ? { counterOfferId: details.counterOfferId }
      : {}),
  });
}
