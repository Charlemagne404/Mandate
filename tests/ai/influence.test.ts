import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  EconomicLink,
  Conflict,
  InfluenceTerm,
  Organization,
  Relation,
  Treaty,
  WorldState,
} from '@mandate/schemas';
import type {
  InfluenceTerm as InfluenceTermShape,
  NationId,
  WorldCommand,
  WorldState as World,
} from '@mandate/schemas';
import { influenceProfile } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { deterministicPlayerIntent, executePlayerAction } from '@mandate/ai';
import { compactCandidates } from '../../packages/ai/src/compact.js';

const base = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
const nicaragua = base.nations.find(
  (nation) => nation.name === 'Nicaragua',
)!.id;
const regional = () => {
  const world = structuredClone(base);
  world.playerNationId = nicaragua;
  return world;
};
function execute(world: World, text: string, run: string) {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text,
  });
  return executePlayerAction(world, intent, run);
}
function offers(commands: WorldCommand[]) {
  return commands.filter((command) => command.type === 'OPEN_NEGOTIATION');
}
function influenceOffer(commands: WorldCommand[], recipient: string) {
  const result = offers(commands).find(
    (command) =>
      command.type === 'OPEN_NEGOTIATION' &&
      command.negotiation.recipientNationId === recipient,
  );
  expect(result?.type, `commands: ${JSON.stringify(commands)}`).toBe(
    'OPEN_NEGOTIATION',
  );
  if (result?.type !== 'OPEN_NEGOTIATION')
    throw new Error('Expected structured influence negotiation');
  expect(result.negotiation.kind).toBe('influence');
  return result.negotiation.influenceTerms;
}
const clause = (kind: InfluenceTermShape['kind'], subject: NationId) =>
  InfluenceTerm.parse({
    kind,
    patronNationId: nicaragua,
    subjectNationId: subject,
  });

describe('natural-language sphere-of-influence orders', () => {
  it('records a conditional energy threat without turning it into an energy offer', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const result = execute(
      world,
      'Tell Honduras we will cut energy supplies unless they accept the treaty.',
      'honduras-energy-threat',
    );
    const command = offers(result.commands.map((entry) => entry.command)).find(
      (entry) =>
        entry.type === 'OPEN_NEGOTIATION' &&
        entry.negotiation.recipientNationId === honduras,
    );
    expect(command?.type).toBe('OPEN_NEGOTIATION');
    if (command?.type !== 'OPEN_NEGOTIATION') return;
    expect(command.negotiation.conditionalPressure).toMatchObject({
      condition: 'rejection',
      channel: 'energy',
      action: 'withdraw',
      status: 'pending',
    });
    expect(command.negotiation.influenceTerms).not.toContainEqual(
      expect.objectContaining({ kind: 'energy-supply' }),
    );
  });

  it('turns a rival-bloc warning into a conditional organization-subsidy threat', () => {
    const world = regional();
    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!.id;
    const result = execute(
      world,
      'Threaten to withdraw CAEU subsidies if Guatemala joins Mexico’s bloc.',
      'guatemala-bloc-threat',
    );
    const command = offers(result.commands.map((entry) => entry.command)).find(
      (entry) =>
        entry.type === 'OPEN_NEGOTIATION' &&
        entry.negotiation.recipientNationId === guatemala,
    );
    expect(command?.type).toBe('OPEN_NEGOTIATION');
    if (command?.type !== 'OPEN_NEGOTIATION') return;
    expect(command.negotiation.conditionalPressure).toMatchObject({
      condition: 'joins-rival-alliance',
      channel: 'organization-support',
      action: 'withdraw',
      status: 'pending',
    });
  });

  it('formalizes approval rights over major economic agreements', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const terms = influenceOffer(
      execute(
        world,
        'Tell Honduras that major economic agreements require my approval.',
        'honduras-economic-veto',
      ).commands.map((entry) => entry.command),
      honduras,
    );
    expect(terms).toContainEqual(
      expect.objectContaining({ kind: 'economic-policy-approval' }),
    );
  });

  it('turns a decades-long regional sphere order into measurable goals and funded initiatives', () => {
    const world = regional();
    const result = execute(
      world,
      'Make Central America economically dependent on Nicaragua over the next decade.',
      'central-america-dependence',
    );
    const goal = result.commands.find(
      (entry) => entry.command.type === 'CREATE_STRATEGIC_GOAL',
    )?.command;
    const initiatives = result.commands
      .map((entry) => entry.command)
      .filter((command) => command.type === 'START_INITIATIVE');

    expect(goal?.type).toBe('CREATE_STRATEGIC_GOAL');
    if (goal?.type !== 'CREATE_STRATEGIC_GOAL') return;
    expect(goal.goal.evaluation).toMatchObject({
      kind: 'influence',
      tier: 'DEPENDENT PARTNER',
      subjectNationIds: expect.arrayContaining([
        ...world.nations
          .filter((nation) =>
            [
              'Honduras',
              'Guatemala',
              'El Salvador',
              'Costa Rica',
              'Panama',
              'Belize',
            ].includes(nation.name),
          )
          .map((nation) => nation.id),
      ]),
    });
    expect(initiatives).toHaveLength(6);
    expect(initiatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'START_INITIATIVE',
          initiative: expect.objectContaining({
            kind: 'aid',
            durationDays: 365,
          }),
        }),
      ]),
    );
    expect(offers(result.commands.map((entry) => entry.command))).toHaveLength(
      0,
    );
  });

  it('issues access and voting directives only when treaty terms grant the authority', () => {
    const honduras = regional().nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const withoutAccess = execute(
      regional(),
      'Order Honduras to give Nicaragua military access.',
      'honduras-access-request',
    );
    expect(
      offers(withoutAccess.commands.map((entry) => entry.command)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'OPEN_NEGOTIATION',
          negotiation: expect.objectContaining({
            recipientNationId: honduras,
            influenceTerms: expect.arrayContaining([
              expect.objectContaining({ kind: 'military-access' }),
            ]),
          }),
        }),
      ]),
    );
    expect(
      withoutAccess.commands.map((entry) => entry.command),
    ).not.toContainEqual(
      expect.objectContaining({
        type: 'ISSUE_PATRON_DIRECTIVE',
        kind: 'grant-military-access',
      }),
    );

    const world = regional();
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:nicaragua-honduras-control',
        name: 'Access and diplomatic alignment',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        terms: 'Honduras grants access and aligns on diplomatic positions.',
        influenceTerms: [
          clause('military-access', honduras),
          clause('foreign-policy-alignment', honduras),
          clause('support-diplomatic-initiatives', honduras),
        ],
      }),
    );
    const access = execute(
      world,
      'Order Honduras to give Nicaragua military access.',
      'honduras-access-directive',
    );
    expect(access.commands.map((entry) => entry.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ISSUE_PATRON_DIRECTIVE',
          kind: 'grant-military-access',
          treatyId: 'treaty:nicaragua-honduras-control',
        }),
      ]),
    );
    const vote = execute(
      world,
      'Tell Honduras to vote with us in CAEU.',
      'honduras-caeu-vote',
    );
    expect(vote.commands.map((entry) => entry.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ISSUE_PATRON_DIRECTIVE',
          kind: 'support-diplomatic-initiative',
          treatyId: 'treaty:nicaragua-honduras-control',
        }),
      ]),
    );
  });

  it('turns infrastructure investment for preferential market access into typed terms', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const result = execute(
      world,
      'Offer Honduras major infrastructure investment in exchange for preferential access to its market.',
      'honduras-investment',
    );
    expect(
      influenceOffer(
        result.commands.map((entry) => entry.command),
        honduras,
      ).map((term) => term.kind),
    ).toEqual(
      expect.arrayContaining([
        'infrastructure-investment',
        'market-access-concession',
      ]),
    );
  });

  it('negotiates debt relief with alliance consultation instead of assuming consent', () => {
    const world = regional();
    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!;
    guatemala.stats.debt = 80;
    const result = execute(
      world,
      "Pay Guatemala's debt if they agree not to join alliances without consulting us.",
      'guatemala-debt',
    );
    const terms = influenceOffer(
      result.commands.map((entry) => entry.command),
      guatemala.id,
    );
    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'debt-relief', amount: 80 }),
        expect.objectContaining({ kind: 'no-rival-alliance' }),
        expect.objectContaining({ kind: 'foreign-policy-consultation' }),
      ]),
    );
  });

  it('targets CAEU members and creates reciprocal common foreign-policy clauses', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!.id;
    world.organizations.push(
      Organization.parse({
        id: 'organization:caeu',
        name: 'Central American Economic Union',
        acronym: 'CAEU',
        kind: 'economic-union',
        foundingDate: world.date,
        founders: [nicaragua],
        members: [nicaragua, honduras, guatemala],
        purpose: 'Economic integration and shared regional diplomacy.',
        charter: 'Voluntary cooperation.',
      }),
    );

    const result = execute(
      world,
      'Create a common CAEU foreign policy.',
      'caeu-foreign-policy',
    );
    expect(
      influenceOffer(
        result.commands.map((entry) => entry.command),
        honduras,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'foreign-policy-alignment',
          patronNationId: nicaragua,
          subjectNationId: honduras,
        }),
      ]),
    );
    expect(
      influenceOffer(
        result.commands.map((entry) => entry.command),
        guatemala,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'foreign-policy-alignment',
          patronNationId: guatemala,
          subjectNationId: nicaragua,
        }),
      ]),
    );
  });

  it('makes mutual defensive-war obligations negotiable across CAEU members', () => {
    const world = regional();
    const costaRica = world.nations.find(
      (nation) => nation.name === 'Costa Rica',
    )!.id;
    world.organizations.push(
      Organization.parse({
        id: 'organization:caeu',
        name: 'Central American Economic Union',
        acronym: 'CAEU',
        kind: 'economic-union',
        foundingDate: world.date,
        founders: [nicaragua],
        members: [nicaragua, costaRica],
        purpose: 'Regional cooperation.',
        charter: 'Voluntary cooperation.',
      }),
    );
    const result = execute(
      world,
      'Require CAEU members to support each other in defensive wars.',
      'caeu-defense',
    );
    const terms = influenceOffer(
      result.commands.map((entry) => entry.command),
      costaRica,
    );
    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'join-defensive-wars',
          patronNationId: nicaragua,
          subjectNationId: costaRica,
        }),
        expect.objectContaining({
          kind: 'join-defensive-wars',
          patronNationId: costaRica,
          subjectNationId: nicaragua,
        }),
      ]),
    );
  });

  it('supports a guarantee for basing rights and concrete foreign-policy coordination', () => {
    const world = regional();
    const costaRica = world.nations.find(
      (nation) => nation.name === 'Costa Rica',
    )!.id;
    const costaRicaOffer = execute(
      world,
      'Offer Costa Rica a security guarantee in exchange for military basing rights.',
      'costa-rica-bases',
    );
    expect(
      influenceOffer(
        costaRicaOffer.commands.map((entry) => entry.command),
        costaRica,
      ).map((term) => term.kind),
    ).toEqual(expect.arrayContaining(['security-guarantee', 'host-bases']));

    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const coordination = execute(
      world,
      'Demand Honduras coordinate its foreign policy with Nicaragua.',
      'honduras-foreign-policy',
    );
    expect(
      influenceOffer(
        coordination.commands.map((entry) => entry.command),
        honduras,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'foreign-policy-alignment' }),
      ]),
    );

    const consultation = execute(
      world,
      'Offer Honduras a development loan and a security guarantee in exchange for foreign-policy consultation.',
      'honduras-foreign-policy-consultation',
    );
    expect(
      influenceOffer(
        consultation.commands.map((entry) => entry.command),
        honduras,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'foreign-policy-consultation' }),
      ]),
    );

    world.treaties.push(
      Treaty.parse({
        id: 'treaty:nicaragua-honduras-alignment',
        name: 'Honduras foreign-policy alignment',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        terms: 'Accepted binding coordination.',
        influenceTerms: [clause('foreign-policy-alignment', honduras)],
      }),
    );
    const alignmentOffer = execute(
      world,
      'Offer Honduras a development loan in exchange for aligning its foreign policy with Nicaragua.',
      'honduras-alignment-amendment',
    );
    expect(
      offers(alignmentOffer.commands.map((entry) => entry.command)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'OPEN_NEGOTIATION',
          negotiation: expect.objectContaining({ kind: 'influence' }),
        }),
      ]),
    );

    const directive = execute(
      world,
      'Demand Honduras coordinate its foreign policy with Nicaragua.',
      'honduras-alignment-directive',
    );
    expect(directive.commands.map((entry) => entry.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ISSUE_PATRON_DIRECTIVE',
          kind: 'coordinate-foreign-policy',
          treatyId: 'treaty:nicaragua-honduras-alignment',
          policyText:
            'Demand Honduras coordinate its foreign policy with Nicaragua.',
        }),
      ]),
    );

    const rivalRestriction = execute(
      world,
      'Offer Honduras a subsidy of 2 treasury units per month and a security guarantee in exchange for agreeing not to join rival alliances without consulting us.',
      'honduras-no-rivals',
    );
    expect(
      influenceOffer(
        rivalRestriction.commands.map((entry) => entry.command),
        honduras,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'subsidy', amount: 2 }),
        expect.objectContaining({ kind: 'no-rival-alliance' }),
      ]),
    );
  });

  it('proposes protectorate, client, and explicit alliance terms without changing status immediately', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const protectorate = execute(
      world,
      'Turn Honduras into a protectorate.',
      'honduras-protectorate',
    );
    expect(
      influenceOffer(
        protectorate.commands.map((entry) => entry.command),
        honduras,
      ).map((term) => term.kind),
    ).toEqual(
      expect.arrayContaining([
        'security-guarantee',
        'join-defensive-wars',
        'foreign-policy-consultation',
      ]),
    );
    expect(influenceProfile(world, nicaragua, honduras).tier).toBe(
      'INDEPENDENT',
    );

    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!.id;
    const client = execute(
      world,
      'Negotiate with Guatemala to become a Nicaraguan client state.',
      'guatemala-client',
    );
    expect(
      influenceOffer(
        client.commands.map((entry) => entry.command),
        guatemala,
      ).map((term) => term.kind),
    ).toEqual(
      expect.arrayContaining([
        'security-guarantee',
        'foreign-policy-consultation',
        'preferential-trade',
      ]),
    );
    const alliance = execute(
      world,
      'Make Guatemala leave its alliance with Mexico.',
      'guatemala-alliance',
    );
    expect(
      influenceOffer(
        alliance.commands.map((entry) => entry.command),
        guatemala,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'no-rival-alliance' }),
      ]),
    );
  });

  it('addresses derived clients and puppets with scoped terms and revenue obligations', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    world.economicLinks.push(
      EconomicLink.parse({
        id: 'economic:honduras-nicaragua',
        dependentNationId: honduras,
        partnerNationId: nicaragua,
        imports: 100,
        exports: 10,
        energy: 0,
        strategicGoods: 0,
        finance: 0,
        infrastructure: 0,
        alternatives: 0,
      }),
    );
    const puppetClauses = [
      'join-patron-wars',
      'war-declaration-approval',
      'no-war-against-patron',
      'foreign-policy-veto',
      'foreign-policy-alignment',
      'no-rival-alliance',
      'exclusive-market-access',
      'host-bases',
    ] as const;
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:nicaragua-honduras',
        name: 'Central American coordination',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        terms: 'Accepted binding coordination terms.',
        influenceTerms: puppetClauses.map((kind) => clause(kind, honduras)),
      }),
    );
    expect(influenceProfile(world, nicaragua, honduras).tier).toBe(
      'PUPPET STATE',
    );

    world.conflicts.push(
      Conflict.parse({
        id: 'conflict:client-war-directive',
        name: 'Patron defense',
        attackers: ['nation:mex'],
        defenders: [nicaragua],
        status: 'active',
        escalation: 20,
      }),
    );
    const join = execute(
      world,
      'Require our client states to join the war.',
      'client-war-order',
    );
    expect(join.commands.map((entry) => entry.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ISSUE_PATRON_DIRECTIVE',
          kind: 'join-conflict',
          subjectNationId: honduras,
          conflictId: 'conflict:client-war-directive',
        }),
      ]),
    );
    const tribute = execute(
      world,
      'Make all our puppets pay 5% of government revenue to Nicaragua.',
      'puppet-tribute',
    );
    expect(
      influenceOffer(
        tribute.commands.map((entry) => entry.command),
        honduras,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tribute', ratePercent: 5 }),
      ]),
    );
  });

  it('gives autonomous governments a bounded economic offer and a real exit option', () => {
    const world = regional();
    const nicaraguaNeighbors = world.scenario.neighborhoods!.find(
      (entry) => entry.nationId === nicaragua,
    )!.neighbors;
    const target = nicaraguaNeighbors[0]!;
    const pair = [nicaragua, target].sort() as [NationId, NationId];
    const relation = world.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    );
    if (relation) relation.score = 40;
    else
      world.relations.push(
        Relation.parse({ nationA: pair[0], nationB: pair[1], score: 40 }),
      );

    const candidates = compactCandidates(
      world,
      nicaragua,
      'autonomous-influence',
      null,
    );
    const economicOffer = candidates.find(
      (candidate) =>
        candidate.id === `offer-economic-influence-${target.slice(7)}`,
    );
    expect(economicOffer?.commands[0]).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        proposerNationId: nicaragua,
        recipientNationId: target,
      },
    });
    if (economicOffer?.commands[0]?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed voluntary foreign offer');
    expect(
      economicOffer.commands[0].negotiation.influenceTerms.map(
        (entry) => entry.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        'subsidy',
        'infrastructure-investment',
        'preferential-trade',
      ]),
    );

    const stagedSphere = structuredClone(world);
    stagedSphere.nations.find(
      (nation) => nation.id === nicaragua,
    )!.stats.military = 100;
    const targetLink = EconomicLink.parse({
      id: `economic:${target.slice(7)}-nicaragua`,
      dependentNationId: target,
      partnerNationId: nicaragua,
      imports: 80,
      exports: 70,
      energy: 60,
      strategicGoods: 0,
      finance: 80,
      infrastructure: 50,
      alternatives: 0,
    });
    const previousTargetLink = stagedSphere.economicLinks.find(
      (link) =>
        link.dependentNationId === target && link.partnerNationId === nicaragua,
    );
    if (previousTargetLink) Object.assign(previousTargetLink, targetLink);
    else stagedSphere.economicLinks.push(targetLink);
    const targetRelation = stagedSphere.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    )!;
    targetRelation.score = 90;
    stagedSphere.treaties.push(
      Treaty.parse({
        id: 'treaty:autonomous-economic-relationship',
        name: 'Regional economic partnership',
        kind: 'influence',
        parties: [nicaragua, target],
        status: 'active',
        terms: 'Accepted economic support and trade access.',
        influenceTerms: [
          clause('subsidy', target),
          clause('infrastructure-investment', target),
          clause('preferential-trade', target),
        ],
      }),
    );
    const securityCandidates = compactCandidates(
      stagedSphere,
      nicaragua,
      'autonomous-security-influence',
      null,
    );
    const securityOffer = securityCandidates.find(
      (candidate) =>
        candidate.id === `offer-security-influence-${target.slice(7)}`,
    );
    expect(securityOffer?.commands[0]).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        recipientNationId: target,
      },
    });
    if (securityOffer?.commands[0]?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed autonomous security offer');
    expect(
      securityOffer.commands[0].negotiation.influenceTerms.map(
        (entry) => entry.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        'security-guarantee',
        'join-defensive-wars',
        'military-access',
      ]),
    );

    const protectedSphere = structuredClone(stagedSphere);
    const relationshipTreaty = protectedSphere.treaties.find(
      (treaty) => treaty.id === 'treaty:autonomous-economic-relationship',
    )!;
    relationshipTreaty.influenceTerms.push(
      clause('security-guarantee', target),
      clause('join-defensive-wars', target),
      clause('military-access', target),
    );
    const policyCandidates = compactCandidates(
      protectedSphere,
      nicaragua,
      'autonomous-policy-influence',
      null,
    );
    const policyOffer = policyCandidates.find(
      (candidate) =>
        candidate.id === `offer-policy-influence-${target.slice(7)}`,
    );
    expect(policyOffer?.commands[0]).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        recipientNationId: target,
      },
    });
    if (policyOffer?.commands[0]?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed foreign-policy consultation offer');
    expect(
      policyOffer.commands[0].negotiation.influenceTerms.map(
        (entry) => entry.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        'foreign-policy-consultation',
        'market-access-concession',
      ]),
    );

    const subject = world.nations.find((nation) => nation.id === target)!;
    subject.stats.stability = 100;
    subject.stats.legitimacy = 100;
    subject.stats.military = 100;
    const highAlternativeLink = EconomicLink.parse({
      id: `economic:${target.slice(7)}-mex`,
      dependentNationId: target,
      partnerNationId: 'nation:mex',
      imports: 0,
      exports: 0,
      energy: 0,
      strategicGoods: 0,
      finance: 0,
      infrastructure: 0,
      alternatives: 100,
    });
    const existingAlternativeLink = world.economicLinks.find(
      (link) =>
        link.dependentNationId === target &&
        link.partnerNationId === 'nation:mex',
    );
    if (existingAlternativeLink)
      Object.assign(existingAlternativeLink, highAlternativeLink);
    else world.economicLinks.push(highAlternativeLink);
    for (let index = 0; index < 4; index++)
      world.organizations.push(
        Organization.parse({
          id: `organization:alternative-${index}`,
          name: `Alternative ${index}`,
          kind: 'regional',
          foundingDate: world.date,
          members: [target, 'nation:usa'],
          purpose: 'Alternative investment.',
          charter: 'Voluntary.',
        }),
      );
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:subject-dependence',
        name: 'Binding alignment',
        kind: 'influence',
        parties: ['nation:mex', target],
        status: 'active',
        terms: 'Binding foreign-policy alignment.',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'foreign-policy-veto',
            patronNationId: 'nation:mex',
            subjectNationId: target,
          }),
          InfluenceTerm.parse({
            kind: 'join-patron-wars',
            patronNationId: 'nation:mex',
            subjectNationId: target,
          }),
        ],
      }),
    );
    const dependentCandidates = compactCandidates(
      world,
      target,
      'autonomous-exit',
      null,
    );
    expect(
      dependentCandidates.some((candidate) =>
        candidate.commands.some(
          (command) =>
            command.type === 'END_TREATY' &&
            command.treatyId === 'treaty:subject-dependence' &&
            command.nationId === target,
        ),
      ),
    ).toBe(true);
  });

  it('lets a government exit after sustained patron payment arrears despite low sovereignty resistance', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:arrears-subject',
        name: 'Nicaraguan development support',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        terms: 'A modest recurring subsidy.',
        influenceTerms: [
          InfluenceTerm.parse({
            kind: 'subsidy',
            patronNationId: nicaragua,
            subjectNationId: honduras,
            amount: 2,
            arrears: 6,
          }),
        ],
      }),
    );

    expect(
      influenceProfile(world, nicaragua, honduras).resistance,
    ).toBeLessThan(65);
    const candidates = compactCandidates(
      world,
      honduras,
      'arrears-autonomy',
      null,
    );
    expect(
      candidates.some((candidate) =>
        candidate.commands.some(
          (command) =>
            command.type === 'END_TREATY' &&
            command.treatyId === 'treaty:arrears-subject' &&
            command.nationId === honduras,
        ),
      ),
    ).toBe(true);
  });
});
