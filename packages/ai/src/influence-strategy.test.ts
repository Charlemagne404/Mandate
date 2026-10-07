import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  EconomicLink,
  InfluenceDecision,
  InfluenceTerm,
  Negotiation,
  Relation,
  Treaty,
  WorldState,
} from '@mandate/schemas';
import { loadScenario } from '@mandate/scenarios';
import { assessInfluenceOffer, influenceProfile } from '@mandate/core';
import {
  buildInfluenceCounterOffers,
  calibrateInfluenceResponse,
  influenceDecisionRecord,
  influencePartiesForNegotiation,
  preferredPersistentInfluenceChoice,
  repairOutOfScopeInfluenceRationale,
  shouldRevisitDeferredInfluence,
} from './influence-strategy.js';

const base = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
const nicaragua = base.nations.find(
  (nation) => nation.name === 'Nicaragua',
)!.id;
const honduras = base.nations.find((nation) => nation.name === 'Honduras')!.id;

function offerFixture(
  kinds: Array<
    | 'join-patron-wars'
    | 'join-defensive-wars'
    | 'foreign-policy-veto'
    | 'foreign-policy-consultation'
    | 'subsidy'
    | 'infrastructure-investment'
    | 'debt-relief'
    | 'energy-supply'
    | 'security-guarantee'
    | 'preferential-trade'
    | 'market-access-concession'
  >,
  options: { strong?: boolean; exactPriorRejection?: boolean } = {},
) {
  const world = structuredClone(base);
  const patron = world.nations.find((nation) => nation.id === nicaragua)!;
  const subject = world.nations.find((nation) => nation.id === honduras)!;
  patron.stats.treasury = 1500;
  subject.stats.debt = 150;
  subject.stats.energyExposure = 85;
  subject.stats.industrial = 40;
  subject.stats.fiscal = 35;
  if (options.strong) {
    subject.stats.stability = 75;
    subject.stats.legitimacy = 75;
    subject.stats.military = 25;
    subject.stats.unrest = 0;
    const pair = [nicaragua, honduras].sort() as [
      typeof nicaragua,
      typeof honduras,
    ];
    const relation = world.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    );
    if (relation) {
      relation.score = 92;
      relation.trust = 92;
    } else
      world.relations.push(
        Relation.parse({
          nationA: pair[0],
          nationB: pair[1],
          score: 92,
          trust: 92,
        }),
      );
    const link = EconomicLink.parse({
      id: 'economic:strategy-test',
      dependentNationId: honduras,
      partnerNationId: nicaragua,
      imports: 100,
      exports: 95,
      energy: 100,
      strategicGoods: 95,
      finance: 100,
      infrastructure: 100,
      alternatives: 0,
    });
    const existing = world.economicLinks.find(
      (entry) =>
        entry.dependentNationId === honduras &&
        entry.partnerNationId === nicaragua,
    );
    if (existing) Object.assign(existing, link);
    else world.economicLinks.push(link);
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:strategy-test',
        name: 'Delivered partnership',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        ratifiedDate: world.date,
        terms: 'A reliable partnership with delivered economic support.',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'subsidy',
            patronNationId: nicaragua,
            subjectNationId: honduras,
            amount: 1,
            paidAmount: 8,
            paymentsMade: 8,
            lastPaymentDate: world.date,
          }),
        ],
      }),
    );
  } else {
    const pair = [nicaragua, honduras].sort() as [
      typeof nicaragua,
      typeof honduras,
    ];
    const relation = world.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    );
    if (relation) {
      relation.score = -70;
      relation.trust = 20;
    }
  }
  const terms = kinds.map((kind) =>
    InfluenceTerm.parse({
      kind,
      patronNationId: nicaragua,
      subjectNationId: honduras,
      ...(['debt-relief', 'infrastructure-investment', 'subsidy'].includes(kind)
        ? { amount: kind === 'debt-relief' ? 100 : 12 }
        : {}),
    }),
  );
  const negotiation = Negotiation.parse({
    id: 'negotiation:strategy-test-current',
    proposerNationId: nicaragua,
    recipientNationId: honduras,
    topic: 'Strategic partnership',
    kind: 'influence',
    terms: 'A structured economic and security proposal.',
    createdDate: world.date,
    expiresDate: world.date,
    influenceTerms: terms,
  });
  world.negotiations.push(negotiation);
  if (options.exactPriorRejection) {
    const assessment = assessInfluenceOffer(world, nicaragua, honduras, terms);
    world.negotiations.push(
      Negotiation.parse({
        ...negotiation,
        id: 'negotiation:strategy-test-prior',
        status: 'rejected',
        responses: [
          {
            nationId: honduras,
            date: world.date,
            move: 'reject',
            message: 'The offensive obligation exceeds our military autonomy.',
            influenceDecision: InfluenceDecision.parse({
              reasonCode: 'sovereignty-cost',
              explanation:
                'The offensive obligation exceeds our military autonomy.',
              comparison: [],
              possibleLeverage: [],
              assessment: assessment.factors,
              disposition: 'reject',
              modelRationale:
                'The offensive obligation exceeds our military autonomy.',
            }),
          },
        ],
      }),
    );
  }
  return { world, negotiation };
}

describe('persistent influence plan selection', () => {
  it('repairs a sphere rationale that names a different target', () => {
    const repaired = repairOutOfScopeInfluenceRationale(
      'Tajikistan is the priority while advancing the Honduras sphere.',
      ['Nicaragua', 'Honduras', 'Guatemala', 'Tajikistan'],
      ['Nicaragua', 'Honduras', 'Guatemala'],
      "Nicaragua's Honduras target plan remains the selected priority.",
    );
    expect(repaired).toEqual({
      reason: "Nicaragua's Honduras target plan remains the selected priority.",
      outOfScopeNames: ['Tajikistan'],
    });
  });

  it('allows the deciding actor, selected target and a relevant rival in the rationale', () => {
    const repaired = repairOutOfScopeInfluenceRationale(
      'Nicaragua should improve the Honduras offer before Guatemala gains influence.',
      ['Nicaragua', 'Honduras', 'Guatemala', 'Tajikistan'],
      ['Nicaragua', 'Honduras', 'Guatemala'],
      'Fallback rationale.',
    );
    expect(repaired.outOfScopeNames).toEqual([]);
    expect(repaired.reason).toContain('Nicaragua');
  });

  it('keeps a due multi-year plan focused when the planner picks an unrelated candidate', () => {
    expect(
      preferredPersistentInfluenceChoice(
        'project-energy',
        'sphere-step-hnd-seek-policy-authority',
        true,
        false,
      ),
    ).toBe('sphere-step-hnd-seek-policy-authority');
  });

  it('lets an urgent war or breach response supersede a due plan', () => {
    expect(
      preferredPersistentInfluenceChoice(
        'resolve-breach',
        'sphere-step-hnd-seek-policy-authority',
        true,
        true,
      ),
    ).toBe('resolve-breach');
  });

  it('does not force a plan action before its scheduled review', () => {
    expect(
      preferredPersistentInfluenceChoice(
        'project-energy',
        'sphere-step-hnd-seek-policy-authority',
        false,
        false,
      ),
    ).toBe('project-energy');
  });
});

describe('hybrid influence negotiation decisions', () => {
  it('keeps a patron review of a target counteroffer on the canonical influence roles', () => {
    const { world, negotiation } = offerFixture(
      ['subsidy', 'foreign-policy-consultation'],
      { strong: true },
    );
    const term = (
      kind: 'subsidy' | 'foreign-policy-veto' | 'foreign-policy-consultation',
    ) =>
      InfluenceTerm.parse({
        kind,
        patronNationId: nicaragua,
        subjectNationId: honduras,
        amount: kind === 'subsidy' ? 12 : 0,
      });
    const priorOffer = [term('subsidy'), term('foreign-policy-veto')];
    const targetCounter = [
      term('subsidy'),
      term('foreign-policy-consultation'),
    ];
    const counteroffer = Negotiation.parse({
      ...negotiation,
      id: 'negotiation:strategy-test-counteroffer',
      proposerNationId: honduras,
      recipientNationId: nicaragua,
      terms:
        'Honduras counters with delivered economic benefits and no new authority.',
      influenceTerms: targetCounter,
      responses: [
        {
          nationId: honduras,
          date: world.date,
          move: 'counter',
          message:
            'Honduras retains support and declines a foreign-policy veto.',
          influenceTerms: priorOffer,
          counterInfluenceTerms: targetCounter,
        },
      ],
    });
    world.negotiations.push(counteroffer);
    expect(influencePartiesForNegotiation(counteroffer)).toEqual({
      patronNationId: nicaragua,
      subjectNationId: honduras,
    });
    const counters = buildInfluenceCounterOffers(world, counteroffer);
    const calibrated = calibrateInfluenceResponse(
      world,
      counteroffer,
      'reject',
      'This does not advance Nicaragua’s target plan.',
      {
        explanation: 'This does not advance Nicaragua’s target plan.',
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      nicaragua,
    );
    expect(calibrated.move).toBe('reject');
    expect(calibrated.displayRationale).toBeNull();
    expect(calibrated.message).not.toMatch(/target plan/i);
    expect(calibrated.message).toContain(
      'previously requested foreign policy veto',
    );
    expect(calibrated.repairNotes.join(' ')).toContain(
      'Private sphere-planning context was removed',
    );

    const profile = influenceProfile(world, nicaragua, honduras);
    const decision = influenceDecisionRecord(
      world,
      nicaragua,
      counteroffer.id,
      calibrated.move,
      calibrated.message,
      undefined,
      {
        modelRationale: calibrated.modelRationale,
        displayRationale: calibrated.displayRationale,
      },
    );
    expect(decision.decisionPerspective).toBe('patron');
    expect(decision.assessment?.relationship.leverage).toBe(profile.leverage);
    expect(decision.explanation).toContain(
      'Honduras’s counteroffer to Nicaragua',
    );
    expect(decision.explanation).toContain('benefits to Honduras');
    expect(decision.reasonCode).toBe('incompatible-preferences');
    expect(decision.explanation).toContain(
      'the counteroffer removes that communicated clause',
    );
    expect(decision.explanation).not.toMatch(/target plan/i);

    const misframed = calibrateInfluenceResponse(
      world,
      counteroffer,
      'reject',
      "Honduras' critical need for reliable energy remains unmet.",
      {
        explanation:
          "Honduras' critical need for reliable energy remains unmet.",
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      nicaragua,
    );
    expect(misframed.displayRationale).toBeNull();
    expect(misframed.message).toContain(
      'previously requested foreign policy veto',
    );
    expect(misframed.repairNotes.join(' ')).toContain(
      'counterpart’s need as the patron’s own reason',
    );

    const wrongSovereignty = calibrateInfluenceResponse(
      world,
      counteroffer,
      'reject',
      "The clause exceeds Nicaragua's sovereign authority and domestic institutional integrity.",
      {
        explanation:
          "The clause exceeds Nicaragua's sovereign authority and domestic institutional integrity.",
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      nicaragua,
    );
    expect(wrongSovereignty.displayRationale).toBeNull();
    expect(wrongSovereignty.message).toContain(
      'previously requested foreign policy veto',
    );
    expect(wrongSovereignty.repairNotes.join(' ')).toContain(
      'assigned the target-side sovereignty cost to the patron',
    );

    const wrongLimitFrame = calibrateInfluenceResponse(
      world,
      counteroffer,
      'reject',
      "The clause 'foreign-policy-veto' exceeds Nicaragua's current capacity to authorize such a binding commitment.",
      {
        explanation:
          "The clause 'foreign-policy-veto' exceeds Nicaragua's current capacity to authorize such a binding commitment.",
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      nicaragua,
    );
    expect(wrongLimitFrame.displayRationale).toBeNull();
    expect(wrongLimitFrame.message).toContain(
      'previously requested foreign policy veto',
    );
    expect(wrongLimitFrame.repairNotes.join(' ')).toContain(
      'assigned the target-side sovereignty cost to the patron',
    );
  });

  it('records a weaker relevant rival offer in the decision explanation', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'debt-relief', 'security-guarantee'],
      { strong: true },
    );
    const mexico = world.nations.find((nation) => nation.name === 'Mexico')!;
    world.negotiations.push(
      negotiation,
      Negotiation.parse({
        id: 'negotiation:weak-mexico-rival',
        proposerNationId: mexico.id,
        recipientNationId: honduras,
        topic: 'Limited trade offer',
        kind: 'influence',
        terms: 'A limited preferential-trade offer.',
        status: 'open',
        createdDate: world.date,
        expiresDate: '2028-06-30',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'preferential-trade',
            patronNationId: mexico.id,
            subjectNationId: honduras,
          }),
        ],
      }),
    );

    const decision = influenceDecisionRecord(
      world,
      honduras,
      negotiation.id,
      'accept',
      'Honduras accepts the package.',
    );
    expect(decision.explanation).toContain('Mexico');
    expect(decision.explanation).toContain('weaker on the modeled factors');
  });

  it('offers a structured middle ground by narrowing offensive war participation', () => {
    const { world, negotiation } = offerFixture(
      [
        'subsidy',
        'infrastructure-investment',
        'debt-relief',
        'join-patron-wars',
      ],
      { strong: true },
    );
    const counters = buildInfluenceCounterOffers(world, negotiation);
    const narrowed = counters.find((candidate) =>
      candidate.terms.some((term) => term.kind === 'join-defensive-wars'),
    );
    expect(narrowed).toBeDefined();
    expect(narrowed?.terms.map((term) => term.kind)).not.toContain(
      'join-patron-wars',
    );
    expect(narrowed?.terms.map((term) => term.kind)).toContain('subsidy');
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'reject',
      'We reject an automatic obligation to join offensive wars.',
      {
        explanation:
          'We reject an automatic obligation to join offensive wars.',
        reconsiderationConditions: [],
      },
      counters,
      narrowed?.id,
    );
    expect(calibrated.move).toBe('counter');
    expect(calibrated.counterOffer?.id).toBe(narrowed?.id);
  });

  it('offers reversible consultation only to a patron countering a target response', () => {
    const { world, negotiation } = offerFixture([
      'subsidy',
      'preferential-trade',
    ]);
    const targetResponse = buildInfluenceCounterOffers(world, negotiation);
    expect(
      targetResponse.some((candidate) =>
        candidate.terms.some(
          (term) => term.kind === 'foreign-policy-consultation',
        ),
      ),
    ).toBe(false);

    const patronReview = Negotiation.parse({
      ...negotiation,
      proposerNationId: honduras,
      recipientNationId: nicaragua,
    });
    const patronResponse = buildInfluenceCounterOffers(world, patronReview);
    expect(
      patronResponse.some((candidate) =>
        candidate.terms.some(
          (term) => term.kind === 'foreign-policy-consultation',
        ),
      ),
    ).toBe(true);
  });

  it('quantifies an unspecified target-valued term when a counter asks for a binding amount', () => {
    const { world, negotiation } = offerFixture(
      [
        'energy-supply',
        'infrastructure-investment',
        'debt-relief',
        'join-patron-wars',
      ],
      { strong: true },
    );
    const counters = buildInfluenceCounterOffers(world, negotiation);
    const quantified = counters.find(
      (candidate) => candidate.id === 'quantify-targeted-support',
    );
    expect(
      quantified?.terms.find((term) => term.kind === 'energy-supply')?.amount,
    ).toBe(9);
    expect(quantified?.terms.map((term) => term.kind)).not.toContain(
      'join-patron-wars',
    );

    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'counter',
      'The offer needs a binding commitment to energy supply before Honduras can accept.',
      {
        explanation:
          'The offer needs a binding commitment to energy supply before Honduras can accept.',
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      honduras,
    );
    expect(calibrated.move).toBe('counter');
    expect(calibrated.counterOffer?.id).toBe('quantify-targeted-support');
    expect(
      calibrated.counterOffer?.terms.find(
        (term) => term.kind === 'energy-supply',
      )?.amount,
    ).toBe(9);
  });

  it('repairs a stale war-clause objection without inventing a consultation concession', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'infrastructure-investment', 'debt-relief'],
      { strong: true },
    );
    const counters = buildInfluenceCounterOffers(world, negotiation);
    expect(
      counters.some((candidate) =>
        candidate.terms.some(
          (term) => term.kind === 'foreign-policy-consultation',
        ),
      ),
    ).toBe(false);

    const staleReason =
      'The current request for joining patron wars exceeds Honduras sovereignty limits.';
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'reject',
      staleReason,
      { explanation: staleReason, reconsiderationConditions: [] },
      counters,
      undefined,
      [],
      honduras,
    );
    expect(calibrated.move).toBe('counter');
    expect(calibrated.displayRationale).toBeNull();
    expect(calibrated.counterOffer?.id).toBe('quantify-targeted-support');
    expect(
      calibrated.counterOffer?.terms.find(
        (term) => term.kind === 'energy-supply',
      )?.amount,
    ).toBeGreaterThan(0);
    expect(calibrated.repairNotes.join(' ')).toContain(
      'treated join patron wars as part of the current offer',
    );
  });

  it('records raw and hybrid choices and repairs a false no-benefit claim', () => {
    const { world, negotiation } = offerFixture(
      [
        'subsidy',
        'infrastructure-investment',
        'debt-relief',
        'energy-supply',
        'security-guarantee',
        'join-patron-wars',
      ],
      { strong: true },
    );
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'reject',
      'There are no benefits in Nicaragua’s proposal.',
      {
        explanation: 'There are no benefits in Nicaragua’s proposal.',
        reconsiderationConditions: [],
      },
      buildInfluenceCounterOffers(world, negotiation),
    );
    expect(calibrated.rawMove).toBe('reject');
    expect(calibrated.repairNotes.join(' ')).toContain(
      'structured package includes target-valued support',
    );
    expect(calibrated.modelRationale).toContain('no benefits');
    expect(calibrated.displayRationale).toBeNull();
  });

  it('repairs a claim that a typed proposal clause is missing', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'join-patron-wars'],
      { strong: true },
    );
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'reject',
      'The offer lacks a structured energy supply term.',
      {
        explanation: 'The offer lacks a structured energy supply term.',
        reconsiderationConditions: [],
      },
      buildInfluenceCounterOffers(world, negotiation),
    );
    expect(calibrated.rawMove).toBe('reject');
    expect(calibrated.move).toBe('counter');
    expect(calibrated.displayRationale).toBeNull();
    expect(calibrated.message).toContain(
      'join patron wars goes beyond the authority',
    );
    expect(calibrated.repairNotes.join(' ')).toContain(
      'typed terms are in the active relationship or proposal',
    );
  });

  it('will not accept a typed clause that conflicts with the deciding government’s constitutional red line', () => {
    const { world, negotiation } = offerFixture(
      ['subsidy', 'infrastructure-investment', 'foreign-policy-veto'],
      { strong: true },
    );
    world.nations.find((nation) => nation.id === honduras)!.strategy.redLines =
      ['Constitutional red line: no foreign-policy veto.'];
    const counters = buildInfluenceCounterOffers(world, negotiation);
    expect(counters.length).toBeGreaterThan(0);
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'accept',
      'The economic support makes acceptance worthwhile.',
      {
        explanation: 'The economic support makes acceptance worthwhile.',
        reconsiderationConditions: [],
      },
      counters,
    );
    expect(calibrated.rawMove).toBe('accept');
    expect(calibrated.move).toBe('counter');
    expect(calibrated.repairNotes.join(' ')).toContain('explicit red line');
    expect(calibrated.displayRationale).toBeNull();
  });

  it('repairs claims that omit an authority term already active in the relationship', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'join-patron-wars'],
      { strong: true },
    );
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:active-policy-veto',
        name: 'Existing policy consultation and veto',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        ratifiedDate: world.date,
        terms: 'Honduras retains a previously accepted foreign-policy veto.',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'foreign-policy-veto',
            patronNationId: nicaragua,
            subjectNationId: honduras,
          }),
        ],
      }),
    );
    const rationale = 'The offer lacks a foreign policy veto.';
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'reject',
      rationale,
      { explanation: rationale, reconsiderationConditions: [] },
      buildInfluenceCounterOffers(world, negotiation),
    );

    expect(calibrated.repairNotes.join(' ')).toContain(
      'foreign policy veto missing',
    );
    expect(calibrated.displayRationale).toBeNull();
  });

  it('does not disclose the counterpart treasury through a persisted assessment', () => {
    const { world, negotiation } = offerFixture(
      ['subsidy', 'foreign-policy-consultation'],
      { strong: true },
    );
    const decision = influenceDecisionRecord(
      world,
      honduras,
      negotiation.id,
      'counter',
      'Counter with a narrower agreement.',
    );
    expect(decision.assessment?.costs).not.toHaveProperty('patronBudget');
  });

  it('does not accept the same rejected political ask without material change', () => {
    const { world, negotiation } = offerFixture(
      ['subsidy', 'join-patron-wars'],
      { strong: true, exactPriorRejection: true },
    );
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'accept',
      'We accept.',
      { explanation: 'We accept.', reconsiderationConditions: [] },
      buildInfluenceCounterOffers(world, negotiation),
    );
    expect(calibrated.rawMove).toBe('accept');
    expect(['counter', 'delay']).toContain(calibrated.move);
    expect(calibrated.repairNotes.join(' ')).toContain('previously rejected');
  });

  it('defers until a recorded condition changes and then reopens deliberation', () => {
    const { world, negotiation } = offerFixture(
      ['foreign-policy-consultation'],
      { strong: true },
    );
    const assessment = assessInfluenceOffer(
      world,
      nicaragua,
      honduras,
      negotiation.influenceTerms,
    );
    negotiation.responses.push({
      nationId: honduras,
      date: world.date,
      move: 'delay',
      message: 'Not yet; review after trust improves.',
      influenceDecision: InfluenceDecision.parse({
        reasonCode: 'timing-not-ready',
        explanation: 'Not yet; review after trust improves.',
        comparison: [],
        possibleLeverage: [],
        assessment: assessment.factors,
        disposition: 'defer',
        reconsiderationConditions: ['Review after trust improves.'],
      }),
    });
    expect(shouldRevisitDeferredInfluence(world, negotiation)).toBe(false);
    const relation = world.relations.find(
      (entry) =>
        [entry.nationA, entry.nationB].includes(nicaragua) &&
        [entry.nationA, entry.nationB].includes(honduras),
    );
    if (relation) relation.trust = Math.min(100, relation.trust + 20);
    expect(shouldRevisitDeferredInfluence(world, negotiation)).toBe(true);
  });

  it('records not-yet when a negotiable target objection has no safe typed counter', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'infrastructure-investment'],
      { strong: true },
    );
    const target = world.nations.find((nation) => nation.id === honduras)!;
    target.stats.debt = 0;
    target.stats.energyExposure = 0;
    target.stats.industrial = 90;
    target.stats.fiscal = 90;
    target.stats.unrest = 0;
    negotiation.influenceTerms.forEach((term) => {
      term.amount = 14;
    });
    const counters = buildInfluenceCounterOffers(world, negotiation);
    expect(counters).toEqual([]);

    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'counter',
      'The package has value, but the government needs further investment before it can take the next step.',
      {
        explanation:
          'The package has value, but the government needs further investment before it can take the next step.',
        reconsiderationConditions: [],
      },
      counters,
      undefined,
      [],
      honduras,
    );

    expect(calibrated.move).toBe('delay');
    expect(calibrated.message).toContain('Not now:');
    expect(calibrated.reconsiderationConditions).toEqual([
      'Reassess after the stated objection is addressed by a materially changed, affordable term or the target need changes.',
    ]);
    expect(calibrated.repairNotes.join(' ')).toContain(
      'deferred rather than converted into an outright rejection',
    );
    const decision = influenceDecisionRecord(
      world,
      honduras,
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
      },
    );
    expect(decision.disposition).toBe('defer');
    expect(decision.reconsiderationConditions).toEqual(
      calibrated.reconsiderationConditions,
    );
  });

  it('defers an ungrounded counter instead of publishing a false rejection reason', () => {
    const { world, negotiation } = offerFixture(
      ['energy-supply', 'infrastructure-investment'],
      { strong: true },
    );
    const target = world.nations.find((nation) => nation.id === honduras)!;
    target.stats.debt = 0;
    target.stats.energyExposure = 0;
    target.stats.industrial = 90;
    target.stats.fiscal = 90;
    target.stats.unrest = 0;
    negotiation.influenceTerms.forEach((term) => {
      term.amount = 14;
    });
    const rationale = 'The offer lacks infrastructure investment.';
    const calibrated = calibrateInfluenceResponse(
      world,
      negotiation,
      'counter',
      rationale,
      { explanation: rationale, reconsiderationConditions: [] },
      buildInfluenceCounterOffers(world, negotiation),
      undefined,
      [],
      honduras,
    );

    expect(calibrated.move).toBe('delay');
    expect(calibrated.displayRationale).toBeNull();
    expect(calibrated.message).not.toContain('lacks infrastructure');
    expect(calibrated.reconsiderationConditions).toHaveLength(1);
  });
});
