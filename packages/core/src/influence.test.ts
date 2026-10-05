import { describe, expect, it } from 'vitest';
import {
  EconomicLink,
  InfluencePressure,
  InfluenceTerm,
  NationId,
  Negotiation,
  Treaty,
} from '@mandate/schemas';
import type {
  InfluenceTerm as InfluenceTermShape,
  WorldState,
} from '@mandate/schemas';
import { assessInfluenceOffer, influenceProfile } from './influence.js';
import { resolveTurn } from './index.js';
import { context, fixture, request } from '../../../tests/fixtures/world.js';
const swe = NationId.parse('nation:swe');
const fin = NationId.parse('nation:fin');

const run = (world: WorldState, commands: unknown[]) =>
  resolveTurn(world, request(world, commands), context(world.revision + 1));
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const term = (
  kind: InfluenceTermShape['kind'],
  patronNationId = 'nation:swe',
  subjectNationId = 'nation:fin',
  options: { amount?: number; ratePercent?: number } = {},
) => InfluenceTerm.parse({ kind, patronNationId, subjectNationId, ...options });
const offer = (world: WorldState, terms: InfluenceTermShape[]) =>
  Negotiation.parse({
    id: `negotiation:influence-${world.revision + 1}`,
    proposerNationId: 'nation:swe',
    recipientNationId: 'nation:fin',
    topic: 'Economic and policy partnership',
    kind: 'influence',
    terms:
      'Structured support and policy obligations negotiated by both governments.',
    createdDate: world.date,
    expiresDate: addDays(world.date, 180),
    influenceTerms: terms,
  });

describe('derived sphere-of-influence relationships', () => {
  it('keeps modeled economic dependence directional', () => {
    const world = fixture();
    world.economicLinks.push(
      EconomicLink.parse({
        id: 'economic:fin-swe',
        dependentNationId: 'nation:fin',
        partnerNationId: 'nation:swe',
        imports: 64,
        exports: 22,
        energy: 30,
        strategicGoods: 10,
        finance: 45,
        infrastructure: 18,
        alternatives: 0,
      }),
    );

    const FinlandOnSweden = influenceProfile(world, swe, fin);
    const SwedenOnFinland = influenceProfile(world, fin, swe);
    expect(FinlandOnSweden.dependency.trade).toBe(64);
    expect(FinlandOnSweden.dependency.finance).toBe(45);
    expect(FinlandOnSweden.dependency.energy).toBe(30);
    expect(FinlandOnSweden.tier).toBe('DEPENDENT PARTNER');
    expect(SwedenOnFinland.dependency.trade).toBe(0);
    expect(SwedenOnFinland.tier).toBe('INDEPENDENT');
    expect(SwedenOnFinland.leverage).toBeLessThan(FinlandOnSweden.leverage);
  });

  it('derives foreign-policy autonomy from directional treaty authority', () => {
    const world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:sweden-finland-alignment',
        name: 'Foreign-policy coordination',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Binding coordination.',
        visibility: 'public',
        conflictId: null,
        influenceTerms: [term('foreign-policy-alignment')],
        directives: [],
      }),
    );

    const FinlandOnSweden = influenceProfile(world, swe, fin);
    const SwedenOnFinland = influenceProfile(world, fin, swe);
    expect(FinlandOnSweden.dependency.diplomatic).toBe(30);
    expect(FinlandOnSweden.autonomy.foreignPolicy).toBeLessThanOrEqual(51);
    expect(SwedenOnFinland.dependency.diplomatic).toBe(0);
    expect(SwedenOnFinland.autonomy.foreignPolicy).toBe(100);
  });

  it('requires patron consent for independent third-party trade under an economic approval clause', () => {
    let world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:economic-approval',
        name: 'Economic approval compact',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Major economic agreements require Swedish approval.',
        influenceTerms: [term('economic-policy-approval')],
      }),
    );
    const thirdPartyTrade = Negotiation.parse({
      id: 'negotiation:finland-russia-trade',
      proposerNationId: fin,
      recipientNationId: 'nation:rus',
      topic: 'Finnish-Russian trade agreement',
      kind: 'trade',
      terms: 'Independent trade agreement.',
      createdDate: world.date,
      expiresDate: addDays(world.date, 180),
    });
    expect(() =>
      run(world, [{ type: 'OPEN_NEGOTIATION', negotiation: thirdPartyTrade }]),
    ).toThrow(/economic-policy approval term requires the patron/);

    const patronTrade = Negotiation.parse({
      ...thirdPartyTrade,
      id: 'negotiation:finland-sweden-trade',
      recipientNationId: swe,
      topic: 'Finnish-Swedish trade agreement',
    });
    world = run(world, [
      { type: 'OPEN_NEGOTIATION', negotiation: patronTrade },
    ]);
    expect(
      world.negotiations.find((entry) => entry.id === patronTrade.id)?.status,
    ).toBe('open');
    const directThirdPartyTrade = Treaty.parse({
      id: 'treaty:unauthorized-finland-russia-trade',
      name: 'Direct Finnish-Russian trade agreement',
      kind: 'trade',
      parties: [fin, 'nation:rus'],
      status: 'active',
      terms: 'Attempt to bypass bilateral patron approval.',
      conflictId: null,
    });
    expect(() =>
      run(world, [{ type: 'CREATE_TREATY', treaty: directThirdPartyTrade }]),
    ).toThrow(/economic-policy approval term requires the patron/);

    const vetoWorld = fixture();
    vetoWorld.treaties.push(
      Treaty.parse({
        id: 'treaty:foreign-veto',
        name: 'Foreign policy control',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Major foreign agreements require Swedish approval.',
        influenceTerms: [term('foreign-policy-veto')],
      }),
    );
    expect(() =>
      run(vetoWorld, [
        { type: 'OPEN_NEGOTIATION', negotiation: thirdPartyTrade },
      ]),
    ).toThrow(/foreign-policy veto requires the patron/);
  });

  it('derives puppet status from accepted cross-domain terms and drops it when the treaty ends', () => {
    let world = fixture();
    const initialFinland = structuredClone(
      world.nations.find((nation) => nation.id === 'nation:fin')!,
    );
    const initialFinlandRegions = world.regions
      .filter((region) => region.ownerNationId === 'nation:fin')
      .map((region) => region.id)
      .sort();
    const clauses = [
      'join-patron-wars',
      'war-declaration-approval',
      'no-war-against-patron',
      'military-access',
      'host-bases',
      'military-planning',
      'foreign-policy-veto',
      'foreign-policy-alignment',
      'no-rival-alliance',
      'exclusive-market-access',
      'customs-alignment',
      'tribute',
    ] as const;
    const influenceTerms = clauses.map((kind) =>
      term(
        kind,
        'nation:swe',
        'nation:fin',
        kind === 'tribute' ? { ratePercent: 5 } : {},
      ),
    );
    const negotiation = offer(world, influenceTerms);
    world = run(world, [{ type: 'OPEN_NEGOTIATION', negotiation }]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: negotiation.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted after an independent government decision.',
        treatyId: 'treaty:influence-puppet',
      },
    ]);

    const profile = influenceProfile(world, swe, fin);
    expect(profile.tier).toBe('PUPPET STATE');
    expect(profile.autonomyLevels.foreignPolicy).toBe('MINIMAL');
    expect(profile.autonomyLevels.military).toBe('MINIMAL');
    expect(profile.autonomyLevels.domestic).toBe('FULL');
    expect(
      profile.puppetRequirements.every((requirement) => requirement.fulfilled),
    ).toBe(true);
    expect(
      world.nations.find((nation) => nation.id === 'nation:fin')!.stats.unrest,
    ).toBeGreaterThan(initialFinland.stats.unrest);
    expect(
      world.regions
        .filter((region) => region.ownerNationId === 'nation:fin')
        .map((region) => region.id)
        .sort(),
    ).toEqual(initialFinlandRegions);

    const rivalDefenseOffer = Negotiation.parse({
      id: 'negotiation:independent-finnish-defense',
      proposerNationId: fin,
      recipientNationId: 'nation:rus',
      topic: 'Independent security treaty',
      kind: 'defense',
      terms: 'An independent bilateral defense agreement.',
      createdDate: world.date,
      expiresDate: addDays(world.date, 180),
    });
    expect(() =>
      run(world, [
        { type: 'OPEN_NEGOTIATION', negotiation: rivalDefenseOffer },
      ]),
    ).toThrow(/foreign-policy veto requires the patron/);

    world = run(world, [
      {
        type: 'ISSUE_PATRON_DIRECTIVE',
        treatyId: 'treaty:influence-puppet',
        patronNationId: 'nation:swe',
        subjectNationId: 'nation:fin',
        directiveId: 'directive:binding-policy',
        kind: 'coordinate-foreign-policy',
        policyText: 'Align with Sweden on the Baltic trade resolution.',
      },
    ]);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:influence-puppet')!
        .directives.at(-1),
    ).toMatchObject({
      status: 'complied',
      policyText: 'Align with Sweden on the Baltic trade resolution.',
    });

    world = run(world, [
      {
        type: 'ISSUE_PATRON_DIRECTIVE',
        treatyId: 'treaty:influence-puppet',
        patronNationId: swe,
        subjectNationId: fin,
        directiveId: 'directive:binding-military-access',
        kind: 'grant-military-access',
      },
    ]);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:influence-puppet')!
        .directives.at(-1),
    ).toMatchObject({
      status: 'complied',
      kind: 'grant-military-access',
      reason: expect.stringContaining('binding treaty obligation'),
    });

    world = run(world, [
      {
        type: 'ISSUE_PATRON_DIRECTIVE',
        treatyId: 'treaty:influence-puppet',
        patronNationId: swe,
        subjectNationId: fin,
        directiveId: 'directive:binding-diplomatic-vote',
        kind: 'support-diplomatic-initiative',
        policyText: 'Vote with Sweden on the Baltic trade resolution.',
      },
    ]);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:influence-puppet')!
        .directives.at(-1),
    ).toMatchObject({
      status: 'complied',
      kind: 'support-diplomatic-initiative',
      reason: expect.stringContaining('foreign-policy alignment term'),
    });

    const beforeGovernmentChange = influenceProfile(world, swe, fin).resistance;
    world = run(world, [
      {
        type: 'UPDATE_GOVERNMENT',
        nationId: fin,
        government: { type: 'Coalition government', ideology: 'Neutralist' },
      },
    ]);
    const reassessed = influenceProfile(world, swe, fin);
    expect(reassessed.sources).toContain(
      'Government changed since ratification; the new administration is reassessing the terms',
    );
    expect(reassessed.resistance).toBeGreaterThan(beforeGovernmentChange);
    expect(reassessed.tier).toBe('PUPPET STATE');

    world = run(world, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:patron-defense-call',
          name: 'Swedish defense call',
          attackers: ['nation:rus'],
          defenders: ['nation:swe'],
          status: 'active',
          escalation: 20,
        },
      },
    ]);
    expect(
      world.conflicts.find(
        (conflict) => conflict.id === 'conflict:patron-defense-call',
      )!.defenders,
    ).toEqual(['nation:swe', 'nation:fin']);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:influence-puppet')!
        .directives.at(-1),
    ).toMatchObject({ status: 'complied', kind: 'join-conflict' });
    expect(() =>
      run(world, [
        {
          type: 'START_CONFLICT',
          conflict: {
            id: 'conflict:independent-finnish-war',
            name: 'Independent Finnish offensive',
            attackers: ['nation:fin'],
            defenders: ['nation:rus'],
            status: 'active',
            escalation: 10,
          },
        },
      ]),
    ).toThrow(/Independent offensive war requires patron approval/);

    world = run(world, [
      {
        type: 'END_TREATY',
        treatyId: 'treaty:influence-puppet',
        nationId: 'nation:fin',
      },
    ]);
    expect(influenceProfile(world, swe, fin).tier).not.toBe('PUPPET STATE');
    expect(influenceProfile(world, swe, fin).autonomyLevels.foreignPolicy).toBe(
      'FULL',
    );
    expect(
      world.nations.find((nation) => nation.id === 'nation:fin')!.stats.unrest,
    ).toBeGreaterThan(initialFinland.stats.unrest);
    expect(
      world.treaties.find((treaty) => treaty.id === 'treaty:influence-puppet')!
        .breaches,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          violatingNationId: 'nation:fin',
          reason: 'Ended the influence agreement to regain policy autonomy',
        }),
      ]),
    );
  });

  it('does not award puppet status when a critical war constraint is absent', () => {
    const world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:almost-puppet',
        name: 'External control pact',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Strong but incomplete external control.',
        influenceTerms: [
          term('join-patron-wars'),
          term('war-declaration-approval'),
          term('military-access'),
          term('foreign-policy-veto'),
          term('no-rival-alliance'),
          term('exclusive-market-access'),
          term('tribute', swe, fin, { ratePercent: 5 }),
        ],
      }),
    );
    const profile = influenceProfile(world, swe, fin);
    expect(profile.tier).toBe('SUBJECT STATE');
    expect(profile.puppetRequirements).toContainEqual({
      key: 'no-war-against-patron',
      label: 'Non-aggression toward patron',
      fulfilled: false,
    });
  });

  it('executes a rejected conditional threat with economic damage, a breach, and a crisis', () => {
    let world = fixture();
    const subject = world.nations.find((nation) => nation.id === fin)!;
    const economyBefore = subject.stats.economy;
    const unrestBefore = subject.stats.unrest;
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:energy-supply',
        name: 'Energy support and policy pact',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Nicaragua-equivalent patron energy supply.',
        influenceTerms: [
          term('energy-supply'),
          term('foreign-policy-consultation'),
        ],
      }),
    );
    const negotiation = Negotiation.parse({
      ...offer(world, []),
      conditionalPressure: InfluencePressure.parse({
        patronNationId: swe,
        subjectNationId: fin,
        condition: 'rejection',
        channel: 'energy',
        action: 'withdraw',
        severity: 45,
        createdDate: world.date,
      }),
    });
    world = run(world, [{ type: 'OPEN_NEGOTIATION', negotiation }]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: negotiation.id,
        nationId: fin,
        move: 'reject',
        message: 'The government rejects coercive terms.',
      },
    ]);

    const pressure = world.negotiations.find(
      (entry) => entry.id === negotiation.id,
    )!.conditionalPressure!;
    const treaty = world.treaties.find(
      (entry) => entry.id === 'treaty:energy-supply',
    )!;
    expect(pressure).toMatchObject({
      status: 'triggered',
      triggeredDate: world.date,
    });
    expect(
      treaty.influenceTerms.find((entry) => entry.kind === 'energy-supply')
        ?.status,
    ).toBe('withdrawn');
    expect(treaty.breaches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          violatingNationId: swe,
          injuredNationId: fin,
          status: 'open',
        }),
      ]),
    );
    expect(world.crises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'commitment',
          participants: [swe, fin],
        }),
      ]),
    );
    expect(world.events.some((event) => event.type === 'TREATY_BREACH')).toBe(
      true,
    );
    expect(
      world.nations.find((nation) => nation.id === fin)!.stats.economy,
    ).toBeLessThan(economyBefore);
    expect(
      world.nations.find((nation) => nation.id === fin)!.stats.unrest,
    ).toBeGreaterThan(unrestBefore);
  });

  it('records an accepted rival defense pact as a breach of a no-rival clause', () => {
    let world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:no-rivals',
        name: 'Alliance restriction',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Finland will not join rival defense pacts.',
        influenceTerms: [term('no-rival-alliance')],
      }),
    );
    const rivalOffer = Negotiation.parse({
      id: 'negotiation:rival-defense',
      proposerNationId: fin,
      recipientNationId: 'nation:rus',
      topic: 'Russian defense treaty',
      kind: 'defense',
      terms: 'Mutual defense obligations.',
      createdDate: world.date,
      expiresDate: addDays(world.date, 180),
    });
    world = run(world, [{ type: 'OPEN_NEGOTIATION', negotiation: rivalOffer }]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: rivalOffer.id,
        nationId: 'nation:rus',
        move: 'accept',
        message: 'We accept the defense agreement.',
        treatyId: 'treaty:rival-defense',
      },
    ]);

    expect(
      world.treaties.find((entry) => entry.id === 'treaty:no-rivals')!.breaches,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          violatingNationId: fin,
          injuredNationId: swe,
          reason: expect.stringContaining('Accepted rival security agreement'),
          status: 'open',
        }),
      ]),
    );
    expect(world.crises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'commitment',
          participants: [swe, fin],
        }),
      ]),
    );
  });

  it('records patron failure to honor an active security guarantee', () => {
    let world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:security-guarantee',
        name: 'Security guarantee',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Sweden guarantees Finland against attack.',
        influenceTerms: [term('security-guarantee')],
      }),
    );
    world = run(world, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:attack-on-finland',
          name: 'Attack on Finland',
          attackers: ['nation:rus'],
          defenders: [fin],
          status: 'active',
          escalation: 10,
        },
      },
    ]);

    expect(
      world.treaties.find((entry) => entry.id === 'treaty:security-guarantee')!
        .breaches,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          violatingNationId: swe,
          injuredNationId: fin,
          reason:
            'Failed to defend the subject under an active security guarantee',
          status: 'open',
        }),
      ]),
    );
  });

  it('records a non-war enforcement action and lets the patron escalate a breach', () => {
    let world = fixture();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:enforcement',
        name: 'Tribute and subsidy pact',
        kind: 'influence',
        parties: [swe, fin],
        status: 'active',
        terms: 'Monthly tribute and support.',
        influenceTerms: [
          term('tribute', swe, fin, { ratePercent: 5 }),
          term('subsidy', swe, fin, { amount: 4 }),
        ],
        breaches: [
          {
            id: 'breach:enforcement-subject',
            date: world.date,
            violatingNationId: fin,
            injuredNationId: swe,
            reason: 'Stopped paying treaty tribute',
            status: 'open',
          },
        ],
      }),
    );
    const unrest = world.nations.find((nation) => nation.id === fin)!.stats
      .unrest;
    world = run(world, [
      {
        type: 'ENFORCE_TREATY_BREACH',
        treatyId: 'treaty:enforcement',
        breachId: 'breach:enforcement-subject',
        patronNationId: swe,
        subjectNationId: fin,
        enforcementId: 'enforcement:diplomatic-demand',
        action: 'diplomatic-demand',
      },
    ]);
    expect(
      world.treaties.find((entry) => entry.id === 'treaty:enforcement')!
        .enforcements,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'diplomatic-demand',
          result: expect.stringContaining('Formal diplomatic demand'),
        }),
      ]),
    );
    expect(
      world.treaties.find((entry) => entry.id === 'treaty:enforcement')!
        .breaches[0]!.status,
    ).toBe('enforced');

    world = run(world, [
      {
        type: 'ENFORCE_TREATY_BREACH',
        treatyId: 'treaty:enforcement',
        breachId: 'breach:enforcement-subject',
        patronNationId: swe,
        subjectNationId: fin,
        enforcementId: 'enforcement:suspend-subsidy',
        action: 'suspend-subsidy',
      },
    ]);
    const treaty = world.treaties.find(
      (entry) => entry.id === 'treaty:enforcement',
    )!;
    expect(
      treaty.influenceTerms.find((entry) => entry.kind === 'subsidy')?.status,
    ).toBe('suspended');
    expect(treaty.enforcements.at(-1)?.action).toBe('suspend-subsidy');
    expect(
      treaty.breaches.some(
        (breach) =>
          breach.violatingNationId === swe && breach.injuredNationId === fin,
      ),
    ).toBe(true);
    expect(
      world.nations.find((nation) => nation.id === fin)!.stats.unrest,
    ).toBeGreaterThan(unrest);
  });

  it('turns accepted loans, support, infrastructure, trade and energy terms into real state', () => {
    let world = fixture();
    world.nations.find((nation) => nation.id === 'nation:fin')!.stats.debt = 90;
    const patronBefore = world.nations.find(
      (nation) => nation.id === 'nation:swe',
    )!.stats.treasury;
    const debtBefore = world.nations.find(
      (nation) => nation.id === 'nation:fin',
    )!.stats.debt;
    const negotiation = offer(world, [
      term('loan', 'nation:swe', 'nation:fin', { amount: 30 }),
      term('subsidy', 'nation:swe', 'nation:fin', { amount: 5 }),
      term('infrastructure-investment', 'nation:swe', 'nation:fin', {
        amount: 3,
      }),
      term('preferential-trade'),
      term('energy-supply'),
    ]);
    world = run(world, [{ type: 'OPEN_NEGOTIATION', negotiation }]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: negotiation.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted after weighing the financing terms.',
        treatyId: 'treaty:influence-economic',
      },
    ]);
    expect(
      world.nations.find((nation) => nation.id === 'nation:swe')!.stats
        .treasury,
    ).toBe(patronBefore - 30);
    expect(
      world.nations.find((nation) => nation.id === 'nation:fin')!.stats.debt,
    ).toBe(debtBefore + 30);
    expect(
      world.nations.find((nation) => nation.id === 'nation:fin')!.stats.debt,
    ).toBeGreaterThan(100);

    world = run(world, [
      { type: 'ADVANCE_DATE', date: addDays(world.date, 30) },
    ]);
    const link = world.economicLinks.find(
      (entry) =>
        entry.dependentNationId === 'nation:fin' &&
        entry.partnerNationId === 'nation:swe',
    )!;
    expect(link.finance).toBeGreaterThan(0);
    expect(link.infrastructure).toBeGreaterThan(0);
    expect(link.imports).toBeGreaterThan(0);
    expect(link.energy).toBeGreaterThan(0);
    expect(influenceProfile(world, swe, fin).dependency.debt).toBeGreaterThan(
      0,
    );
    expect(influenceProfile(world, swe, fin).sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining('patron subsidy'),
        expect.stringContaining('patron infrastructure investment'),
        expect.stringContaining('patron energy-supply'),
      ]),
    );
  });

  it('accrues fractional revenue tribute until a real treasury payment is due', () => {
    let world = fixture();
    const patron = world.nations.find((nation) => nation.id === 'nation:swe')!;
    const subject = world.nations.find((nation) => nation.id === 'nation:fin')!;
    const patronBefore = patron.stats.treasury;
    subject.stats.economy = 50;
    subject.stats.fiscal = 50;
    subject.strategy.taxRate = 50;
    const negotiation = offer(world, [
      term('tribute', 'nation:swe', 'nation:fin', { ratePercent: 5 }),
    ]);
    world = run(world, [{ type: 'OPEN_NEGOTIATION', negotiation }]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: negotiation.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted a modest revenue contribution.',
        treatyId: 'treaty:influence-tribute',
      },
    ]);

    for (let month = 0; month < 4; month++)
      world = run(world, [
        {
          type: 'ADVANCE_DATE',
          date: addDays(world.date, 30),
        },
      ]);
    const tribute = world.treaties.find(
      (treaty) => treaty.id === 'treaty:influence-tribute',
    )!.influenceTerms[0]!;
    expect(tribute.paymentsMade).toBe(0);
    expect(tribute.revenueRemainder).toBeGreaterThan(0);

    world = run(world, [
      {
        type: 'ADVANCE_DATE',
        date: addDays(world.date, 30),
      },
    ]);
    const paidTribute = world.treaties.find(
      (treaty) => treaty.id === 'treaty:influence-tribute',
    )!.influenceTerms[0]!;
    expect(paidTribute.paymentsMade).toBe(1);
    expect(paidTribute.paidAmount).toBe(1);
    expect(paidTribute.revenueRemainder).toBe(0);
    expect(
      world.nations.find((nation) => nation.id === 'nation:swe')!.stats
        .treasury,
    ).toBeGreaterThan(patronBefore);
  });

  it('rejects a cold full-puppet offer while leaving room for a material counteroffer', () => {
    const world = fixture();
    const puppetTerms = [
      term('join-patron-wars'),
      term('war-declaration-approval'),
      term('foreign-policy-veto'),
      term('no-rival-alliance'),
      term('exclusive-market-access'),
      term('host-bases'),
    ];
    const direct = assessInfluenceOffer(world, swe, fin, puppetTerms);
    expect(direct.move).toBe('reject');

    const materialPackage = assessInfluenceOffer(world, swe, fin, [
      term('subsidy', 'nation:swe', 'nation:fin', { amount: 8 }),
      term('infrastructure-investment', 'nation:swe', 'nation:fin', {
        amount: 8,
      }),
      term('preferential-trade'),
    ]);
    expect(['accept', 'counter']).toContain(materialPackage.move);
    expect(materialPackage.move).not.toBe('reject');
  });

  it('makes accumulated dependence improve leverage without guaranteeing acceptance', () => {
    const independent = fixture();
    const dependent = structuredClone(independent);
    dependent.economicLinks.push(
      EconomicLink.parse({
        id: 'economic:fin-swe',
        dependentNationId: fin,
        partnerNationId: swe,
        imports: 80,
        exports: 45,
        energy: 60,
        strategicGoods: 0,
        finance: 75,
        infrastructure: 55,
        alternatives: 0,
      }),
    );
    const terms = [term('join-defensive-wars')];
    const independentAssessment = assessInfluenceOffer(
      independent,
      swe,
      fin,
      terms,
    );
    const dependentAssessment = assessInfluenceOffer(
      dependent,
      swe,
      fin,
      terms,
    );

    expect(dependentAssessment.score).toBeGreaterThan(
      independentAssessment.score,
    );
    expect(dependentAssessment.move).not.toBe('accept');
  });

  it('makes a stronger rival patron a real outside option in bargaining', () => {
    const world = fixture();
    world.economicLinks.push(
      EconomicLink.parse({
        id: 'economic:fin-russia',
        dependentNationId: fin,
        partnerNationId: 'nation:rus',
        imports: 100,
        exports: 80,
        energy: 95,
        strategicGoods: 90,
        finance: 100,
        infrastructure: 100,
        alternatives: 0,
      }),
    );
    const terms = [term('foreign-policy-alignment')];
    const withoutRival = assessInfluenceOffer(fixture(), swe, fin, terms);
    const withRival = assessInfluenceOffer(world, swe, fin, terms);

    expect(withRival.competingPatronNationId).toBe('nation:rus');
    expect(withRival.competingLeverage).toBeGreaterThan(
      influenceProfile(world, swe, fin).leverage,
    );
    expect(withRival.score).toBeLessThan(withoutRival.score);
    expect(withRival.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('outside option')]),
    );
  });

  it('records directive authority from clauses and gives consultation no veto', () => {
    let world = fixture();
    const consultation = offer(world, [term('foreign-policy-consultation')]);
    world = run(world, [
      { type: 'OPEN_NEGOTIATION', negotiation: consultation },
    ]);
    world = run(world, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: consultation.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted consultation.',
        treatyId: 'treaty:consultation',
      },
    ]);
    world = run(world, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:influence-call',
          name: 'Patron defense',
          attackers: ['nation:rus'],
          defenders: ['nation:swe'],
          status: 'active',
          escalation: 20,
        },
      },
    ]);
    world = run(world, [
      {
        type: 'ISSUE_PATRON_DIRECTIVE',
        treatyId: 'treaty:consultation',
        patronNationId: 'nation:swe',
        subjectNationId: 'nation:fin',
        directiveId: 'directive:consultation-war',
        kind: 'join-conflict',
        conflictId: 'conflict:influence-call',
      },
    ]);
    expect(
      world.conflicts.find(
        (conflict) => conflict.id === 'conflict:influence-call',
      )!.defenders,
    ).toEqual(['nation:swe']);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:consultation')!
        .directives.at(-1),
    ).toMatchObject({ status: 'consultation-only' });
    world = run(world, [
      {
        type: 'ISSUE_PATRON_DIRECTIVE',
        treatyId: 'treaty:consultation',
        patronNationId: 'nation:swe',
        subjectNationId: 'nation:fin',
        directiveId: 'directive:consultation-policy',
        kind: 'coordinate-foreign-policy',
        policyText: 'Support Sweden at the next regional summit.',
      },
    ]);
    expect(
      world.treaties
        .find((treaty) => treaty.id === 'treaty:consultation')!
        .directives.at(-1),
    ).toMatchObject({
      status: 'consultation-only',
      policyText: 'Support Sweden at the next regional summit.',
    });
  });
});
