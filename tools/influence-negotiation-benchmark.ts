import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  assessInfluenceOffer,
  buildInfluenceStrategyPlan,
  influenceProfile,
} from '@mandate/core';
import {
  Conflict,
  EconomicLink,
  InfluenceDecision,
  InfluenceTerm,
  NationId,
  Negotiation,
  Relation,
  Treaty,
  WorldState,
} from '@mandate/schemas';
import type { InfluenceTerm as InfluenceTermShape } from '@mandate/schemas';
import { loadScenario } from '@mandate/scenarios';
import { createProvider, ProviderConfig } from '../packages/ai/src/index.js';
import {
  buildInfluenceCounterOffers,
  calibrateInfluenceResponse,
  influenceDecisionRecord,
  influencePartiesForNegotiation,
} from '../packages/ai/src/influence-strategy.js';
import { influenceResponseDossier } from '../packages/ai/src/compact.js';
import { inferenceOptions } from './inference-options.js';

type Move = 'accept' | 'reject' | 'counter' | 'delay';
type HistoryMode = 'none' | 'identical-rejection' | 'improved-terms';
type CaseSpec = {
  id: string;
  situation: string;
  acceptableMoves: Move[];
  terms: InfluenceTermShape['kind'][];
  dependence?: number;
  alternatives?: number;
  trust?: number;
  lowReliability?: boolean;
  highResistance?: boolean;
  hostile?: boolean;
  severeThreat?: boolean;
  rival?: boolean;
  rivalOffer?: 'strong' | 'weak';
  history?: HistoryMode;
  activeTerms?: InfluenceTermShape['kind'][];
  stressedTreasury?: boolean;
  redLine?: string;
  counteroffer?: boolean;
};

const cases: CaseSpec[] = [
  {
    id: '01-clear-favorable-economic-security',
    situation:
      'A dependable offer brings substantial investment, energy and defense support with no new authority restriction.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'infrastructure-investment',
      'energy-supply',
      'security-guarantee',
      'preferential-trade',
    ],
    dependence: 72,
    trust: 82,
  },
  {
    id: '02-clear-favorable-debt-relief',
    situation:
      'Debt is severe; the patron offers meaningful debt relief and infrastructure for a reversible consultation clause.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'debt-relief',
      'infrastructure-investment',
      'foreign-policy-consultation',
    ],
    dependence: 55,
    trust: 78,
  },
  {
    id: '03-clear-favorable-threatened-defense',
    situation:
      'A severe external threat makes the patron’s security guarantee and defensive-war clause valuable; no offensive support is required.',
    acceptableMoves: ['accept', 'counter'],
    terms: ['security-guarantee', 'join-defensive-wars', 'energy-supply'],
    dependence: 42,
    trust: 74,
    severeThreat: true,
  },
  {
    id: '04-clear-terrible-veto-no-benefits',
    situation:
      'The patron asks for a foreign-policy veto and exclusive access but offers no aid, trade, security or debt relief.',
    acceptableMoves: ['reject', 'counter'],
    terms: ['foreign-policy-veto', 'exclusive-market-access'],
    dependence: 5,
    trust: 28,
    hostile: true,
  },
  {
    id: '05-clear-terrible-tribute',
    situation:
      'A weak and distrusted patron demands large tribute and offensive-war participation without compensation.',
    acceptableMoves: ['reject', 'counter'],
    terms: ['tribute', 'join-patron-wars'],
    dependence: 0,
    trust: 18,
    hostile: true,
  },
  {
    id: '06-near-even-trade-alignment',
    situation:
      'Moderate trade benefits accompany broad foreign-policy alignment; the value and authority cost are close.',
    acceptableMoves: ['counter', 'accept'],
    terms: ['preferential-trade', 'foreign-policy-alignment'],
    dependence: 40,
    trust: 58,
  },
  {
    id: '07-high-dependence-high-sovereignty',
    situation:
      'The subject relies heavily on a reliable patron but the offer adds a veto over its foreign policy.',
    acceptableMoves: ['counter', 'reject'],
    terms: ['subsidy', 'energy-supply', 'foreign-policy-veto'],
    dependence: 88,
    trust: 80,
  },
  {
    id: '08-low-dependence-low-sovereignty',
    situation:
      'A low-dependence subject receives modest trade and a nonbinding consultation step with no veto.',
    acceptableMoves: ['accept', 'counter'],
    terms: ['preferential-trade', 'foreign-policy-consultation'],
    dependence: 12,
    trust: 66,
  },
  {
    id: '09-reliable-patron',
    situation:
      'A patron with a strong record of delivered support offers security and infrastructure with limited consultation.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'security-guarantee',
      'infrastructure-investment',
      'foreign-policy-consultation',
    ],
    dependence: 58,
    trust: 76,
  },
  {
    id: '10-unreliable-patron',
    situation:
      'The patron has missed several aid installments and now promises more support in return for military obligations.',
    acceptableMoves: ['counter', 'reject', 'delay'],
    terms: ['subsidy', 'join-defensive-wars'],
    dependence: 47,
    trust: 38,
    lowReliability: true,
  },
  {
    id: '11-rival-patron-better-offer',
    situation:
      'Mexico already offers more reliable infrastructure, energy and security than Nicaragua’s modest alignment package.',
    acceptableMoves: ['counter', 'reject'],
    terms: ['preferential-trade', 'foreign-policy-alignment'],
    dependence: 45,
    trust: 58,
    rival: true,
    rivalOffer: 'strong',
  },
  {
    id: '12-prior-rejection-improved-terms',
    situation:
      'The subject rejected an offensive-war clause before; the patron now adds debt relief, energy and defensive cooperation.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'join-patron-wars',
      'debt-relief',
      'energy-supply',
      'security-guarantee',
    ],
    dependence: 66,
    trust: 72,
    history: 'improved-terms',
  },
  {
    id: '13-prior-rejection-identical-terms',
    situation:
      'The same structured veto and support package was rejected last month for sovereignty cost; no circumstances changed.',
    acceptableMoves: ['counter', 'reject', 'delay'],
    terms: ['foreign-policy-veto', 'subsidy'],
    dependence: 48,
    trust: 54,
    history: 'identical-rejection',
  },
  {
    id: '14-existing-protectorate-extension',
    situation:
      'An existing protectorate already has consultation, defensive support and military access; the patron asks for a veto and offensive-war duty.',
    acceptableMoves: ['counter', 'reject'],
    terms: ['foreign-policy-veto', 'join-patron-wars', 'subsidy'],
    dependence: 76,
    trust: 68,
    activeTerms: [
      'foreign-policy-consultation',
      'join-defensive-wars',
      'military-access',
      'security-guarantee',
    ],
  },
  {
    id: '15-near-puppet-last-military-authority',
    situation:
      'Honduras is already a subject state with high leverage, trust, reliability and low resistance; only offensive patron-war participation remains.',
    acceptableMoves: ['accept', 'counter', 'delay'],
    terms: ['join-patron-wars', 'infrastructure-investment', 'debt-relief'],
    dependence: 90,
    trust: 92,
    activeTerms: [
      'foreign-policy-consultation',
      'foreign-policy-alignment',
      'foreign-policy-veto',
      'join-defensive-wars',
      'war-declaration-approval',
      'no-war-against-patron',
      'military-access',
      'no-rival-alliance',
      'security-guarantee',
      'preferential-trade',
    ],
  },
  {
    id: '16-hostile-government',
    situation:
      'The target government is hostile to Nicaragua and rejects political dependence, but would consider specific mutual trade.',
    acceptableMoves: ['reject', 'counter'],
    terms: ['foreign-policy-alignment', 'no-rival-alliance'],
    dependence: 8,
    trust: 12,
    hostile: true,
  },
  {
    id: '17-severe-threat-defensive-package',
    situation:
      'An active severe threat raises the value of an affordable defensive guarantee and joining defensive wars.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'security-guarantee',
      'join-defensive-wars',
      'infrastructure-investment',
    ],
    dependence: 30,
    trust: 60,
    severeThreat: true,
  },
  {
    id: '18-severe-threat-overbroad-war-duty',
    situation:
      'An external threat is serious, but Nicaragua asks the target to join all patron wars including offensive campaigns.',
    acceptableMoves: ['counter', 'accept'],
    terms: ['security-guarantee', 'join-patron-wars'],
    dependence: 45,
    trust: 67,
    severeThreat: true,
  },
  {
    id: '19-fiscal-stress-with-aid',
    situation:
      'The target faces fiscal pressure; affordable subsidies and infrastructure are offered for reversible diplomatic consultation.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'subsidy',
      'infrastructure-investment',
      'foreign-policy-consultation',
    ],
    dependence: 34,
    trust: 64,
    stressedTreasury: true,
  },
  {
    id: '20-authority-with-no-target-valued-support',
    situation:
      'A policy-approval clause is offered alone to a government with low dependence and high outside options.',
    acceptableMoves: ['counter', 'reject'],
    terms: ['economic-policy-approval'],
    dependence: 7,
    trust: 55,
  },
  {
    id: '21-debt-pressure-compensated',
    situation:
      'A highly indebted government gets debt relief and infrastructure in exchange for a scoped consultation agreement.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'debt-relief',
      'infrastructure-investment',
      'foreign-policy-consultation',
    ],
    dependence: 40,
    trust: 70,
  },
  {
    id: '22-energy-need-with-rival-restriction',
    situation:
      'The subject needs dependable energy; the package includes energy supply but also a restriction on rival alliances.',
    acceptableMoves: ['counter', 'accept'],
    terms: ['energy-supply', 'no-rival-alliance'],
    dependence: 38,
    trust: 68,
  },
  {
    id: '23-market-access-and-alignment',
    situation:
      'Preferential market access is valuable, while full foreign-policy alignment is a meaningful sovereignty cost.',
    acceptableMoves: ['counter', 'accept'],
    terms: [
      'preferential-trade',
      'market-access-concession',
      'foreign-policy-alignment',
    ],
    dependence: 50,
    trust: 64,
  },
  {
    id: '24-rival-offer-weaker',
    situation:
      'Mexico offers only a weak trade package while Nicaragua provides reliable energy, debt relief and a security guarantee.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'energy-supply',
      'debt-relief',
      'security-guarantee',
      'foreign-policy-consultation',
    ],
    dependence: 52,
    trust: 72,
    rival: true,
    rivalOffer: 'weak',
  },
  {
    id: '25-dependence-but-existing-obligations',
    situation:
      'The target already owes significant obligations to Nicaragua and is asked to accept another broad authority clause.',
    acceptableMoves: ['counter', 'reject', 'delay'],
    terms: ['foreign-policy-alignment', 'subsidy'],
    dependence: 84,
    trust: 66,
    activeTerms: [
      'join-defensive-wars',
      'military-access',
      'preferential-trade',
    ],
  },
  {
    id: '26-high-resistance-beneficial-aid',
    situation:
      'A resistant government receives very valuable debt relief, energy and defensive support, but is not ready for alignment.',
    acceptableMoves: ['counter', 'accept'],
    terms: [
      'debt-relief',
      'energy-supply',
      'security-guarantee',
      'foreign-policy-alignment',
    ],
    dependence: 35,
    trust: 70,
    highResistance: true,
  },
  {
    id: '27-low-trust-not-yet',
    situation:
      'A useful security package is offered, but the target distrusts the patron after a recent breach and may defer until delivery improves.',
    acceptableMoves: ['counter', 'delay', 'reject'],
    terms: ['security-guarantee', 'join-defensive-wars'],
    dependence: 42,
    trust: 25,
    lowReliability: true,
  },
  {
    id: '28-explicit-constitutional-redline',
    situation:
      'The target has a constitutional red line against foreign-policy vetoes; the offer includes useful economic benefits.',
    acceptableMoves: ['counter', 'reject'],
    terms: ['foreign-policy-veto', 'subsidy', 'infrastructure-investment'],
    dependence: 60,
    trust: 72,
    redLine: 'Constitutional red line: no foreign-policy veto.',
  },
  {
    id: '29-mutual-defensive-obligation',
    situation:
      'The package offers a credible guarantee and an obligation limited to defensive wars, with dependable economic support.',
    acceptableMoves: ['accept', 'counter'],
    terms: ['security-guarantee', 'join-defensive-wars', 'preferential-trade'],
    dependence: 48,
    trust: 75,
  },
  {
    id: '30-severe-tribute-request',
    situation:
      'A financially stressed subject with weak patron dependence is asked for large tribute and exclusive market access.',
    acceptableMoves: ['reject', 'counter'],
    terms: ['tribute', 'exclusive-market-access'],
    dependence: 4,
    trust: 38,
    stressedTreasury: true,
  },
  {
    id: '31-threat-improved-after-rejection',
    situation:
      'After a prior sovereignty objection, a new external threat makes a defensive guarantee and scoped war support newly valuable.',
    acceptableMoves: ['accept', 'counter'],
    terms: [
      'join-patron-wars',
      'security-guarantee',
      'join-defensive-wars',
      'debt-relief',
    ],
    dependence: 62,
    trust: 70,
    severeThreat: true,
    history: 'improved-terms',
  },
  {
    id: '32-economic-package-no-new-authority',
    situation:
      'A reliable existing partnership offers expanded trade and energy benefits with no new political or military control.',
    acceptableMoves: ['accept', 'counter'],
    terms: ['energy-supply', 'preferential-trade', 'infrastructure-investment'],
    dependence: 70,
    trust: 82,
    activeTerms: ['foreign-policy-consultation', 'security-guarantee'],
  },
  {
    id: '33-patron-reviews-target-counteroffer',
    situation:
      'Honduras counters Nicaragua’s influence plan by retaining the economic package and declining the requested final authority clause.',
    acceptableMoves: ['reject', 'counter', 'delay'],
    terms: ['subsidy', 'infrastructure-investment', 'debt-relief'],
    dependence: 90,
    trust: 92,
    activeTerms: [
      'foreign-policy-consultation',
      'foreign-policy-alignment',
      'support-diplomatic-initiatives',
      'no-rival-alliance',
      'foreign-policy-veto',
      'security-guarantee',
      'join-defensive-wars',
      'war-declaration-approval',
      'no-war-against-patron',
      'military-access',
      'preferential-trade',
      'exclusive-market-access',
      'subsidy',
    ],
    counteroffer: true,
  },
];

const scenario = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
const baseWorld = structuredClone(scenario);
const nicaragua = NationId.parse(
  scenario.nations.find((nation) => nation.name === 'Nicaragua')!.id,
);
const honduras = NationId.parse(
  scenario.nations.find((nation) => nation.name === 'Honduras')!.id,
);
const mexico = NationId.parse(
  scenario.nations.find((nation) => nation.name === 'Mexico')!.id,
);
const materialKinds = new Set<InfluenceTermShape['kind']>([
  'subsidy',
  'infrastructure-investment',
  'loan',
  'debt-relief',
  'preferential-trade',
  'market-access-concession',
  'energy-supply',
  'security-guarantee',
]);

function makeTerms(
  kinds: InfluenceTermShape['kind'][],
  patronNationId = nicaragua,
  subjectNationId = honduras,
) {
  return kinds.map((kind) =>
    InfluenceTerm.parse({
      kind,
      patronNationId,
      subjectNationId,
      ...(['subsidy', 'infrastructure-investment'].includes(kind)
        ? { amount: 12 }
        : kind === 'debt-relief'
          ? { amount: 80 }
          : kind === 'tribute'
            ? { amount: 45 }
            : {}),
    }),
  );
}

function caseWorld(spec: CaseSpec, index: number) {
  const world = structuredClone(baseWorld);
  world.playerNationId = nicaragua;
  const patron = world.nations.find((nation) => nation.id === nicaragua)!;
  const subject = world.nations.find((nation) => nation.id === honduras)!;
  patron.stats.treasury = spec.stressedTreasury ? 80 : 1600;
  subject.stats.debt = spec.stressedTreasury ? 200 : 75;
  subject.stats.energyExposure = 85;
  subject.stats.industrial = 42;
  subject.stats.fiscal = spec.stressedTreasury ? 20 : 55;
  subject.stats.stability = spec.highResistance ? 22 : 70;
  subject.stats.legitimacy = spec.highResistance ? 25 : 68;
  subject.stats.military = spec.hostile || spec.highResistance ? 78 : 42;
  subject.stats.unrest = spec.highResistance ? 68 : 12;
  if (spec.counteroffer) {
    patron.stats.treasury = Math.max(patron.stats.treasury, 500);
    subject.stats.stability = 20;
    subject.stats.legitimacy = 20;
    subject.stats.military = 20;
    subject.stats.unrest = 0;
    subject.stats.debt = Math.max(subject.stats.debt, 150);
  }
  subject.strategy.redLines = spec.redLine ? [spec.redLine] : [];
  const trust = spec.hostile
    ? Math.min(18, spec.trust ?? 18)
    : (spec.trust ?? 60);
  const pair = [nicaragua, honduras].sort() as [NationId, NationId];
  const relation = world.relations.find(
    (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
  );
  if (relation) {
    relation.score = spec.hostile ? -70 : spec.counteroffer ? 92 : trust - 50;
    relation.trust = trust;
  } else
    world.relations.push(
      Relation.parse({
        nationA: pair[0],
        nationB: pair[1],
        score: spec.hostile ? -70 : spec.counteroffer ? 92 : trust - 50,
        trust,
      }),
    );
  const dependence = spec.dependence ?? 30;
  world.economicLinks = world.economicLinks.filter(
    (link) =>
      !(
        link.dependentNationId === honduras &&
        link.partnerNationId === nicaragua
      ),
  );
  if (dependence > 0)
    world.economicLinks.push(
      EconomicLink.parse({
        id: `economic:benchmark-${index}`,
        dependentNationId: honduras,
        partnerNationId: nicaragua,
        imports: spec.counteroffer ? 100 : dependence,
        exports: spec.counteroffer ? 95 : Math.round(dependence * 0.8),
        energy: spec.counteroffer ? 100 : Math.min(100, dependence + 8),
        strategicGoods: spec.counteroffer ? 95 : Math.round(dependence * 0.75),
        finance: spec.counteroffer ? 100 : Math.round(dependence * 0.75),
        infrastructure: spec.counteroffer ? 100 : Math.round(dependence * 0.8),
        alternatives: spec.counteroffer ? 0 : (spec.alternatives ?? 30),
      }),
    );
  if (spec.activeTerms?.length)
    world.treaties.push(
      Treaty.parse({
        id: `treaty:benchmark-${index}`,
        name: 'Existing bilateral agreement',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        ratifiedDate: world.date,
        terms: 'Previously negotiated and active terms.',
        influenceTerms: makeTerms(spec.activeTerms),
      }),
    );
  if (spec.counteroffer) {
    const treaty = world.treaties.find(
      (entry) => entry.id === `treaty:benchmark-${index}`,
    );
    const subsidy = treaty?.influenceTerms.find(
      (term) => term.kind === 'subsidy',
    );
    if (subsidy) {
      subsidy.amount = 1;
      subsidy.paidAmount = 8;
      subsidy.paymentsMade = 8;
      subsidy.lastPaymentDate = world.date;
    }
    patron.strategy.influencePlans = [
      buildInfluenceStrategyPlan(world, nicaragua, honduras, 'PUPPET STATE'),
    ];
    const profile = influenceProfile(world, nicaragua, honduras);
    if (
      profile.tier !== 'SUBJECT STATE' ||
      profile.puppetRequirements
        .filter((requirement) => !requirement.fulfilled)
        .map((requirement) => requirement.key)
        .join(',') !== 'join-patron-wars'
    )
      throw new Error(
        `Counteroffer benchmark is not a near-Puppet subject state: ${profile.tier}; ${profile.puppetRequirements
          .filter((requirement) => !requirement.fulfilled)
          .map((requirement) => requirement.key)
          .join(', ')}`,
      );
  }
  if (spec.lowReliability)
    world.treaties.push(
      Treaty.parse({
        id: `treaty:benchmark-breach-${index}`,
        name: 'Missed support installments',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        ratifiedDate: world.date,
        terms: 'The patron missed promised support payments.',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'subsidy',
            patronNationId: nicaragua,
            subjectNationId: honduras,
            amount: 20,
            arrears: 8,
          }),
        ],
      }),
    );
  if (spec.severeThreat)
    world.conflicts.push(
      Conflict.parse({
        id: `conflict:benchmark-${index}`,
        name: 'External security emergency',
        attackers: [mexico],
        defenders: [honduras],
        status: 'active',
        escalation: 80,
      }),
    );
  if (spec.rival)
    world.negotiations.push(
      Negotiation.parse({
        id: `negotiation:benchmark-rival-${index}`,
        proposerNationId: mexico,
        recipientNationId: honduras,
        topic: 'Mexican infrastructure and energy offer',
        kind: 'influence',
        terms:
          spec.rivalOffer === 'strong'
            ? 'Mexico offers dependable infrastructure, energy and security.'
            : 'Mexico offers only modest preferential trade.',
        createdDate: world.date,
        expiresDate: world.date,
        influenceTerms: makeTerms(
          spec.rivalOffer === 'strong'
            ? [
                'infrastructure-investment',
                'energy-supply',
                'security-guarantee',
              ]
            : ['preferential-trade'],
          mexico,
          honduras,
        ),
      }),
    );
  const negotiation = Negotiation.parse({
    id: `negotiation:benchmark-current-${index}`,
    proposerNationId: spec.counteroffer ? honduras : nicaragua,
    recipientNationId: spec.counteroffer ? nicaragua : honduras,
    topic: `${spec.id} influence proposal`,
    kind: 'influence',
    terms: spec.situation,
    createdDate: world.date,
    expiresDate: world.date,
    influenceTerms: makeTerms(spec.terms),
  });
  world.negotiations.push(negotiation);
  if (spec.history && spec.history !== 'none') {
    const oldTerms =
      spec.history === 'identical-rejection'
        ? negotiation.influenceTerms
        : negotiation.influenceTerms.filter(
            (term) =>
              !materialKinds.has(term.kind) ||
              term.kind === 'preferential-trade',
          );
    const oldAssessment = assessInfluenceOffer(
      world,
      nicaragua,
      honduras,
      oldTerms,
    );
    world.negotiations.push(
      Negotiation.parse({
        ...negotiation,
        id: `negotiation:benchmark-previous-${index}`,
        status: 'rejected',
        influenceTerms: oldTerms,
        responses: [
          {
            nationId: honduras,
            date: world.date,
            move: 'reject',
            message:
              'The previous terms surrendered too much policy autonomy for the support offered.',
            influenceDecision: InfluenceDecision.parse({
              reasonCode: 'sovereignty-cost',
              explanation:
                'The previous terms surrendered too much policy autonomy for the support offered.',
              comparison: [],
              possibleLeverage: [],
              assessment: oldAssessment.factors,
              disposition: 'reject',
              modelRationale:
                'The previous terms surrendered too much policy autonomy for the support offered.',
            }),
          },
        ],
      }),
    );
  }
  return { world, negotiation, subject, patron };
}

function metricAverage(metrics: Record<string, number | null>) {
  const available = Object.values(metrics).filter(
    (value): value is number => value !== null,
  );
  return available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : 0;
}

function isUsefulCounteroffer(
  candidate: ReturnType<typeof buildInfluenceCounterOffers>[number] | undefined,
  negotiation: Negotiation,
) {
  if (
    !candidate ||
    candidate.terms.length === 0 ||
    !candidate.terms.every(
      (term) =>
        term.patronNationId === negotiation.proposerNationId &&
        term.subjectNationId === negotiation.recipientNationId,
    )
  )
    return false;
  const signature = (terms: readonly InfluenceTermShape[]) =>
    terms
      .map((term) => `${term.kind}:${term.amount}:${term.ratePercent}`)
      .sort()
      .join('|');
  return signature(candidate.terms) !== signature(negotiation.influenceTerms);
}

function grade(
  spec: CaseSpec,
  rationale: string,
  move: Move,
  targetName: string,
  patronName: string,
  rivalName: string | null,
  benefitScore: number,
  sovereigntyScore: number,
  reliability: number,
  trust: number,
  counterQuality: number | null,
) {
  const text = rationale.toLocaleLowerCase();
  const extraCountryMention = [
    ...baseWorld.nations.map((nation) => nation.name),
  ].some(
    (name) =>
      name !== targetName &&
      name !== patronName &&
      name !== rivalName &&
      name.length > 3 &&
      text.includes(name.toLocaleLowerCase()),
  );
  const benefitRecognized =
    benefitScore < 18 ||
    /benefit|support|security|investment|energy|debt|trade|market|aid|guarantee|economic/i.test(
      rationale,
    );
  const sovereigntyRecognized =
    sovereigntyScore < 24 ||
    /sovereignty|autonomy|authority|veto|foreign.policy|offensive|war obligation/i.test(
      rationale,
    );
  const rivalRecognized =
    !spec.rival || /rival|alternative|outside option|mexico/i.test(rationale);
  const contradictsBenefits =
    benefitScore >= 18 &&
    /\b(?:no|without|lacks?)\s+(?:any\s+)?(?:economic\s+)?benefits?\b/i.test(
      rationale,
    );
  const contradictsReliability =
    reliability >= 80 &&
    /unreliable|missed payments|failed to deliver|broken promise/i.test(
      rationale,
    );
  const contradictsTrust =
    trust >= 75 && /cannot trust|no trust|untrusted/i.test(rationale);
  const canonicalConsistency =
    !contradictsBenefits && !contradictsReliability && !contradictsTrust;
  return {
    actorTargetFocus: extraCountryMention ? 0 : 1,
    benefitRecognition: benefitRecognized ? 1 : 0,
    sovereigntyReasoning: sovereigntyRecognized ? 1 : 0,
    rivalComparison: rivalRecognized ? 1 : 0,
    canonicalConsistency: canonicalConsistency ? 1 : 0,
    appropriateDecisionCategory: spec.acceptableMoves.includes(move) ? 1 : 0,
    counterofferQuality: counterQuality,
    explanationAccuracy: canonicalConsistency && !extraCountryMention ? 1 : 0,
  };
}

const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error(
    'Negotiation benchmark requires a configured real model endpoint.',
  );
const available = new Set(
  options.report.configured
    .filter((entry) => entry.ok && entry.kind === options.selected!.kind)
    .flatMap((entry) => entry.models),
);
const model = available.has('qwen3:4b-instruct')
  ? 'qwen3:4b-instruct'
  : options.selected.model;
if (!available.has(model))
  throw new Error(`Configured model ${model} is not reachable.`);
const config = ProviderConfig.parse({
  ...options.selected,
  model,
  highImportanceModel: model,
  temperature: 0,
  retries: 0,
  timeoutMs: Math.max(options.selected.timeoutMs, 180_000),
});
const provider = createProvider(config);
const health = await provider.health(AbortSignal.timeout(5000));
if (!health.ok || !health.models.includes(model))
  throw new Error(
    `${model} failed its direct provider health check: ${health.message}`,
  );

const runId = new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14);
const directory = resolve('.runtime/evaluation');
mkdirSync(directory, { recursive: true });
const output = resolve(
  directory,
  `influence-negotiation-benchmark-${runId}.json`,
);
const records: Array<Record<string, unknown>> = [];
const requestedCaseId = process.env.MANDATE_INFLUENCE_BENCHMARK_CASE;
const benchmarkCases = requestedCaseId
  ? cases.filter((spec) => spec.id === requestedCaseId)
  : cases;
if (requestedCaseId && benchmarkCases.length === 0)
  throw new Error(`Unknown influence benchmark case: ${requestedCaseId}`);

for (const [index, spec] of benchmarkCases.entries()) {
  const { world, negotiation, subject } = caseWorld(spec, index);
  const decisionActorNationId = spec.counteroffer ? nicaragua : honduras;
  const counterpartNationId = spec.counteroffer ? honduras : nicaragua;
  const decisionActorName = world.nations.find(
    (nation) => nation.id === decisionActorNationId,
  )!.name;
  const counterpartName = world.nations.find(
    (nation) => nation.id === counterpartNationId,
  )!.name;
  const influenceSides = influencePartiesForNegotiation(negotiation);
  const assessment = assessInfluenceOffer(
    world,
    influenceSides.patronNationId,
    influenceSides.subjectNationId,
    negotiation.influenceTerms,
  );
  const counterOffers = buildInfluenceCounterOffers(world, negotiation);
  const ids = counterOffers.map((candidate) => candidate.id);
  const counterOfferIdSchema = ids.length
    ? z
        .enum(ids as [string, ...string[]])
        .nullable()
        .default(null)
    : z.null().default(null);
  const responseSchema = z.strictObject({
    decisionActorId: z.literal(decisionActorNationId),
    counterpartNationId: z.literal(counterpartNationId),
    choice: z.enum(['accept', 'reject', 'counter', 'delay']),
    reason: z.string().min(1).max(180),
    message: z.string().max(260),
    counterOfferId: counterOfferIdSchema,
    reconsiderationConditions: z
      .array(z.string().min(1).max(240))
      .max(4)
      .default([]),
  });
  const dossier = influenceResponseDossier(
    world,
    negotiation,
    decisionActorNationId,
  );
  const started = performance.now();
  try {
    const result = await provider.generateStructured({
      role: 'diplomat',
      model,
      system:
        'You are a government deciding one diplomatic proposal. Echo the locked decision actor and counterpart IDs exactly. Use the compact decision dossier, recognize its recorded benefits and costs, and make a political judgment. Counters must select one exact structured package. Return only the requested JSON.',
      prompt: JSON.stringify({
        task: `DECIDING ACTOR: ${decisionActorName} (${decisionActorNationId}). COUNTERPART: ${counterpartName} (${counterpartNationId}). DECISION: this proposal only. Echo decisionActorId=${decisionActorNationId} and counterpartNationId=${counterpartNationId}. Situation: ${spec.situation} Choose accept, reject, counter, or delay. The code-calculated recommendation zone is evidence, not a forced answer. If only some clauses are excessive, choose a listed counteroffer. Delay must name a real condition that could change. Do not reason about other countries except a relevant rival in the dossier.`,
        dossier,
        structuredCounteroffers: counterOffers.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          terms: candidate.terms.map((term) => ({
            kind: term.kind,
            amount: term.amount,
            ratePercent: term.ratePercent,
          })),
          termsText: candidate.termsText,
        })),
        responseContract: {
          choice: 'One political willingness judgment.',
          reason:
            'A short explanation of benefits, costs, relationship, alternatives or target goals.',
          message:
            'A diplomatic public message, including a concrete objection or accepted package.',
          counterOfferId:
            'Select only one listed ID if choosing counter; otherwise null.',
          reconsiderationConditions:
            'For delay only, name up to four material conditions that may change the position.',
        },
      }),
      jsonSchema: z.toJSONSchema(responseSchema, {
        unrepresentable: 'any',
        io: 'input',
      }),
      temperature: 0,
      maxTokens: 350,
    });
    const raw = responseSchema.parse(result.value);
    const rawMove = raw.choice as Move;
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      rawMove,
      `${raw.reason} ${raw.message}`,
      {
        explanation: raw.reason,
        reconsiderationConditions: raw.reconsiderationConditions,
      },
      counterOffers,
      raw.counterOfferId ?? undefined,
      [],
      decisionActorNationId,
    );
    const decision = influenceDecisionRecord(
      world,
      decisionActorNationId,
      negotiation.id,
      calibrated.move,
      calibrated.message,
      undefined,
      {
        modelRationale: calibrated.modelRationale,
        displayRationale: calibrated.displayRationale,
        reconsiderationConditions: calibrated.reconsiderationConditions,
        repairNotes: calibrated.repairNotes,
        rawDisposition:
          calibrated.rawMove === 'delay' ? 'defer' : calibrated.rawMove,
        counterOfferAvailable: counterOffers.length > 0,
        counterOfferIds: counterOffers.map((candidate) => candidate.id),
        counterOfferCandidates: counterOffers,
        ...(calibrated.counterOffer
          ? { counterOfferId: calibrated.counterOffer.id }
          : {}),
      },
    );
    const targetName = subject.name;
    const rivalName = spec.rival ? 'Mexico' : null;
    const rawQuality =
      rawMove === 'counter'
        ? raw.counterOfferId &&
          isUsefulCounteroffer(
            counterOffers.find(
              (candidate) => candidate.id === raw.counterOfferId,
            ),
            negotiation,
          )
          ? 1
          : 0
        : null;
    const hybridQuality =
      calibrated.move === 'counter'
        ? isUsefulCounteroffer(
            calibrated.counterOffer ?? undefined,
            negotiation,
          )
          ? 1
          : 0
        : null;
    const rawMetrics = grade(
      spec,
      `${raw.reason} ${raw.message}`,
      rawMove,
      targetName,
      'Nicaragua',
      rivalName,
      assessment.factors.benefits.total,
      assessment.factors.costs.sovereignty,
      influenceProfile(world, nicaragua, honduras).reliability,
      assessment.factors.relationship.trust,
      rawQuality,
    );
    const hybridText = [
      calibrated.message,
      calibrated.displayRationale ?? '',
      decision.explanation,
    ].join(' ');
    const hybridMetrics = grade(
      spec,
      hybridText,
      calibrated.move,
      targetName,
      'Nicaragua',
      rivalName,
      assessment.factors.benefits.total,
      assessment.factors.costs.sovereignty,
      influenceProfile(world, nicaragua, honduras).reliability,
      assessment.factors.relationship.trust,
      hybridQuality,
    );
    records.push({
      id: spec.id,
      situation: spec.situation,
      acceptableMoves: spec.acceptableMoves,
      raw: {
        move: rawMove,
        reason: raw.reason,
        message: raw.message,
        counterOfferId: raw.counterOfferId,
        metrics: rawMetrics,
        score: metricAverage(rawMetrics),
      },
      hybrid: {
        move: calibrated.move,
        disposition: decision.disposition,
        message: calibrated.message,
        modelRationale: calibrated.modelRationale,
        counterOfferId: calibrated.counterOffer?.id ?? null,
        counterTerms: calibrated.counterOffer?.terms ?? [],
        repairNotes: calibrated.repairNotes,
        reconsiderationConditions: calibrated.reconsiderationConditions,
        factors: decision.assessment,
        counterOfferAvailable: decision.counterOfferAvailable,
        counterOfferCandidates: counterOffers.map((candidate) => ({
          id: candidate.id,
          terms: candidate.terms,
        })),
        metrics: hybridMetrics,
        score: metricAverage(hybridMetrics),
      },
      latencyMs: Math.round(performance.now() - started),
    });
    process.stdout.write(
      `${JSON.stringify({
        case: spec.id,
        raw: rawMove,
        hybrid: calibrated.move,
        accepted: spec.acceptableMoves.includes(calibrated.move),
        zone: assessment.recommendationZone,
        score: Math.round(metricAverage(hybridMetrics) * 100) / 100,
        latencyMs: Math.round(performance.now() - started),
      })}\n`,
    );
  } catch (error) {
    records.push({
      id: spec.id,
      situation: spec.situation,
      acceptableMoves: spec.acceptableMoves,
      error: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(
      `${JSON.stringify({ case: spec.id, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
  }
}

const successful = records.filter((record) => 'hybrid' in record);
const moveCount = (key: 'raw' | 'hybrid') =>
  successful.reduce<Record<Move, number>>(
    (counts, record) => {
      const move = (record[key] as { move: Move }).move;
      counts[move]++;
      return counts;
    },
    { accept: 0, reject: 0, counter: 0, delay: 0 },
  );
const averageScore = (key: 'raw' | 'hybrid') =>
  successful.length
    ? successful.reduce(
        (sum, record) => sum + (record[key] as { score: number }).score,
        0,
      ) / successful.length
    : 0;
const acceptedCount = successful.filter((record) =>
  (record.acceptableMoves as Move[]).includes(
    (record.hybrid as { move: Move }).move,
  ),
).length;
const hybridDecisionDistribution = moveCount('hybrid');
const report = {
  recordedAt: new Date().toISOString(),
  provider: { kind: config.kind, model, source: 'configured real provider' },
  methodology: `${benchmarkCases.length} target-locked real-model judgments over canonical modified scenario worlds, each scored before and after the deterministic hybrid validator. Final moves are never selected to meet a distribution target. Each case defines an acceptable move set; counterpackages are generated from the actual typed offer and, when the deciding actor is the target, its directly relevant needs.${requestedCaseId ? ` Focus case: ${requestedCaseId}.` : ''}`,
  dimensions: [
    'actorTargetFocus',
    'benefitRecognition',
    'sovereigntyReasoning',
    'rivalComparison',
    'canonicalConsistency',
    'appropriateDecisionCategory',
    'counterofferQuality',
    'explanationAccuracy',
  ],
  caseCount: benchmarkCases.length,
  successCount: successful.length,
  rawAverageScore: averageScore('raw'),
  hybridAverageScore: averageScore('hybrid'),
  hybridAcceptableDecisionCount: acceptedCount,
  hybridAcceptableDecisionRate: successful.length
    ? acceptedCount / successful.length
    : 0,
  rawDistribution: moveCount('raw'),
  hybridDistribution: moveCount('hybrid'),
  suspiciousUniformDistribution:
    successful.length > 0 &&
    (hybridDecisionDistribution.accept === successful.length ||
      hybridDecisionDistribution.reject === successful.length),
  cases: records,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      output,
      provider: report.provider,
      caseCount: report.caseCount,
      successCount: report.successCount,
      rawAverageScore: report.rawAverageScore,
      hybridAverageScore: report.hybridAverageScore,
      hybridAcceptableDecisionCount: report.hybridAcceptableDecisionCount,
      rawDistribution: report.rawDistribution,
      hybridDistribution: report.hybridDistribution,
      suspiciousUniformDistribution: report.suspiciousUniformDistribution,
    },
    null,
    2,
  )}\n`,
);
