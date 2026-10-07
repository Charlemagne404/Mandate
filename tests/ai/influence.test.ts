import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  InfluenceDecision,
  EconomicLink,
  Conflict,
  InfluenceTerm,
  Negotiation,
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
import { buildInfluenceStrategyPlan, influenceProfile } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { deterministicPlayerIntent, executePlayerAction } from '@mandate/ai';
import {
  compactCandidates,
  influenceResponseDossier,
  playerInfluenceStrategyUpdate,
} from '../../packages/ai/src/compact.js';
import {
  buildInfluenceCounterOffers,
  influenceDecisionRecord,
} from '../../packages/ai/src/influence-strategy.js';

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

  it('bundles a following targetless economic offer into the negotiated package', () => {
    const world = regional();
    const result = execute(
      world,
      'Negotiate with Honduras and Guatemala to deepen CAEU trade and energy integration. Offer infrastructure investment and preferential access in return for durable cooperation.',
      'caeu-economic-offer-bundle',
    );
    for (const name of ['Honduras', 'Guatemala']) {
      const target = world.nations.find((nation) => nation.name === name)!.id;
      const negotiation = offers(
        result.commands.map((entry) => entry.command),
      ).find(
        (command) =>
          command.type === 'OPEN_NEGOTIATION' &&
          command.negotiation.recipientNationId === target,
      );
      expect(negotiation?.type).toBe('OPEN_NEGOTIATION');
      if (negotiation?.type !== 'OPEN_NEGOTIATION') continue;
      expect(negotiation.negotiation.kind).toBe('influence');
      expect(
        negotiation.negotiation.influenceTerms.map((term) => term.kind),
      ).toEqual(
        expect.arrayContaining([
          'common-economic-rules',
          'energy-supply',
          'infrastructure-investment',
          'preferential-trade',
        ]),
      );
      expect(negotiation.negotiation.terms).toContain(
        'infrastructure investment and preferential access',
      );
    }
  });

  it('carries an explicit target-only scope to the following influence offer', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const commands = execute(
      world,
      'With Honduras only, ask for foreign-policy consultation paired with security support. Preserve accepted economic terms and allow Honduras to counter any objectionable clause.',
      'honduras-scoped-consultation',
    ).commands.map((entry) => entry.command);
    const offersToHonduras = offers(commands).filter(
      (command) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === honduras,
    );

    expect(offersToHonduras).toHaveLength(1);
    expect(offersToHonduras[0]?.type).toBe('OPEN_NEGOTIATION');
    if (offersToHonduras[0]?.type !== 'OPEN_NEGOTIATION') return;
    expect(offersToHonduras[0].negotiation.kind).toBe('influence');
    expect(
      offersToHonduras[0].negotiation.influenceTerms.map((term) => term.kind),
    ).toEqual(
      expect.arrayContaining([
        'foreign-policy-consultation',
        'security-guarantee',
      ]),
    );
    expect(
      offers(commands).some(
        (command) =>
          command.type === 'OPEN_NEGOTIATION' &&
          command.negotiation.recipientNationId !== honduras,
      ),
    ).toBe(false);
  });

  it('does not turn a rival-offer comparison instruction into an empty negotiation', () => {
    const world = regional();
    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!;
    guatemala.stats.debt = 80;
    const commands = execute(
      world,
      'With Guatemala only, offer affordable debt relief in return for common economic rules. Compare any real rival offer for Guatemala if it has made one; do not invent a rival.',
      'guatemala-rival-comparison',
    ).commands.map((entry) => entry.command);
    const guatemalaOffers = offers(commands).filter(
      (command) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === guatemala.id,
    );

    expect(guatemalaOffers).toHaveLength(1);
    expect(guatemalaOffers[0]?.type).toBe('OPEN_NEGOTIATION');
    if (guatemalaOffers[0]?.type !== 'OPEN_NEGOTIATION') return;
    expect(guatemalaOffers[0].negotiation.kind).toBe('influence');
    expect(
      guatemalaOffers[0].negotiation.influenceTerms.map((term) => term.kind),
    ).toEqual(expect.arrayContaining(['debt-relief', 'common-economic-rules']));
    expect(guatemalaOffers[0].negotiation.topic).not.toBe(
      'consultation proposal',
    );
  });

  it('offers affordable typed support alongside voluntary organization invitations', () => {
    const world = regional();
    const result = execute(
      world,
      'Nicaragua forms the Central American Economic Union (CAEU) and invites Honduras, Guatemala, and nearby Central American governments to join voluntarily. Offer practical economic integration, energy cooperation, infrastructure links, and support that Nicaragua can afford; each government decides independently.',
      'caeu-voluntary-benefits',
    );
    const commands = result.commands.map((entry) => entry.command);
    const invitees = commands.flatMap((command) =>
      command.type === 'INVITE_TO_ORGANIZATION' ? [command.nationId] : [],
    );
    expect(invitees.length).toBeGreaterThanOrEqual(2);

    for (const name of ['Honduras', 'Guatemala']) {
      const target = world.nations.find((nation) => nation.name === name)!.id;
      expect(invitees).toContain(target);
      const terms = influenceOffer(commands, target);
      expect(terms.map((term) => term.kind)).toEqual(
        expect.arrayContaining([
          'common-economic-rules',
          'energy-supply',
          'infrastructure-investment',
          'subsidy',
        ]),
      );
      expect(
        terms.find((term) => term.kind === 'energy-supply')?.amount,
      ).toBeGreaterThan(0);
      expect(
        terms
          .filter((term) =>
            ['infrastructure-investment', 'subsidy'].includes(term.kind),
          )
          .reduce((sum, term) => sum + term.amount, 0),
      ).toBeLessThanOrEqual(
        Math.floor(
          world.nations.find((nation) => nation.id === nicaragua)!.stats
            .treasury / 36,
        ),
      );
    }
  });

  it('persists a player-directed long-term influence goal as strategy data', () => {
    const world = regional();
    const text =
      'Build a long-term sphere strategy for Honduras; make them a subject state over time.';
    const intent = deterministicPlayerIntent(world, {
      actorNationId: nicaragua,
      text,
    });
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    expect(intent.targetNationIds).toContain(honduras);
    const update = playerInfluenceStrategyUpdate(world, intent, text, []);
    expect(update?.command).toMatchObject({
      type: 'SET_STRATEGY',
      nationId: nicaragua,
      strategy: {
        influencePlans: [
          expect.objectContaining({
            targetNationId: honduras,
            desiredTier: 'SUBJECT STATE',
          }),
        ],
      },
    });
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
        candidate.id ===
        `sphere-step-${target.slice(7)}-build-economic-dependence`,
    );
    const economicCommand = economicOffer?.commands.find(
      (command) => command.type === 'OPEN_NEGOTIATION',
    );
    expect(economicCommand).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        proposerNationId: nicaragua,
        recipientNationId: target,
      },
    });
    if (economicCommand?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed voluntary foreign offer');
    expect(
      economicCommand.negotiation.influenceTerms.map((entry) => entry.kind),
    ).toEqual(
      expect.arrayContaining([
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
    targetRelation.trust = 40;
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
        candidate.id ===
        `sphere-step-${target.slice(7)}-build-security-reliance`,
    );
    const securityCommand = securityOffer?.commands.find(
      (command) => command.type === 'OPEN_NEGOTIATION',
    );
    expect(securityCommand).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        recipientNationId: target,
      },
    });
    if (securityCommand?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed autonomous security offer');
    expect(
      securityCommand.negotiation.influenceTerms.map((entry) => entry.kind),
    ).toContain('security-guarantee');
    expect(
      securityCommand.negotiation.influenceTerms.map((entry) => entry.kind),
    ).not.toContain('join-defensive-wars');

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
        candidate.id === `sphere-step-${target.slice(7)}-seek-consultation`,
    );
    const policyCommand = policyOffer?.commands.find(
      (command) => command.type === 'OPEN_NEGOTIATION',
    );
    expect(policyCommand).toMatchObject({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        kind: 'influence',
        recipientNationId: target,
      },
    });
    if (policyCommand?.type !== 'OPEN_NEGOTIATION')
      throw new Error('Expected a typed foreign-policy consultation offer');
    expect(
      policyCommand.negotiation.influenceTerms.map((entry) => entry.kind),
    ).toContain('foreign-policy-consultation');

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

  it('lets a regionally important outsider contest a neighbor-linked sphere autonomously', () => {
    const world = regional();
    const mexico = world.nations.find((nation) => nation.name === 'Mexico')!.id;
    const guatemala = world.nations.find(
      (nation) => nation.name === 'Guatemala',
    )!.id;
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    world.scenario.neighborhoods = world.scenario.neighborhoods!.map((entry) =>
      entry.nationId === mexico ? { ...entry, neighbors: [guatemala] } : entry,
    );
    world.economicLinks = [];
    world.organizations = [
      Organization.parse({
        id: 'organization:caeu-counter-influence',
        name: 'Central American Economic Union',
        acronym: 'CAEU',
        kind: 'economic-union',
        foundingDate: world.date,
        founders: [nicaragua],
        members: [nicaragua, guatemala, honduras],
        purpose: 'Voluntary Central American integration.',
        charter: 'Members retain sovereign independence.',
      }),
    ];
    for (const [nationId, score] of [
      [guatemala, 45],
      [honduras, 95],
      [nicaragua, 40],
    ] as const) {
      const pair = [mexico, nationId].sort() as [NationId, NationId];
      const relation = world.relations.find(
        (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
      );
      if (relation) {
        relation.score = score;
        relation.trust = 65;
      } else
        world.relations.push(
          Relation.parse({
            nationA: pair[0],
            nationB: pair[1],
            score,
            trust: 65,
          }),
        );
    }

    const candidates = compactCandidates(
      world,
      mexico,
      'mexico-counter-sphere',
      null,
    );
    expect(
      candidates.some((candidate) =>
        candidate.commands.some(
          (command) =>
            command.type === 'OPEN_NEGOTIATION' &&
            command.negotiation.proposerNationId === mexico &&
            command.negotiation.recipientNationId === honduras,
        ),
      ),
    ).toBe(true);
  });

  it('remembers a sovereignty rejection and returns to a lower-cost step', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const pair = [nicaragua, honduras].sort() as [NationId, NationId];
    const relation = world.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    );
    if (relation) {
      relation.score = 70;
      relation.trust = 70;
    }
    const veto = clause('foreign-policy-veto', honduras);
    world.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:rejected-veto-honduras',
        proposerNationId: nicaragua,
        recipientNationId: honduras,
        topic: 'Foreign-policy authority',
        kind: 'influence',
        terms: 'Grant Nicaragua veto power over foreign treaties.',
        status: 'rejected',
        createdDate: world.date,
        expiresDate: world.date,
        influenceTerms: [veto],
        responses: [
          {
            nationId: honduras,
            date: world.date,
            move: 'reject',
            message: 'The veto would surrender too much sovereignty.',
            influenceTerms: [veto],
            influenceDecision: {
              reasonCode: 'sovereignty-cost',
              explanation:
                'The requested veto costs too much sovereignty at the current level of dependence.',
              comparison: [],
              possibleLeverage: [
                'Deepen economic or security reliance before asking again.',
              ],
            },
          },
        ],
      }),
    );

    const candidates = compactCandidates(
      world,
      nicaragua,
      'learn-from-honduras-rejection',
      null,
    );
    const nextOffer = candidates.find((candidate) =>
      candidate.commands.some(
        (command) =>
          command.type === 'OPEN_NEGOTIATION' &&
          command.negotiation.recipientNationId === honduras,
      ),
    );
    expect(nextOffer?.id).toMatch(/sphere-step-hnd-build-economic-dependence/);
    const opening = nextOffer?.commands.find(
      (command) => command.type === 'OPEN_NEGOTIATION',
    );
    expect(opening?.type).toBe('OPEN_NEGOTIATION');
    if (opening?.type !== 'OPEN_NEGOTIATION') return;
    expect(
      opening.negotiation.influenceTerms.map((term) => term.kind),
    ).not.toContain('foreign-policy-veto');
    expect(opening.negotiation.influenceTerms.map((term) => term.kind)).toEqual(
      expect.arrayContaining(['preferential-trade']),
    );
    const storedPlan = nextOffer?.commands.find(
      (command) => command.type === 'SET_STRATEGY',
    );
    expect(storedPlan?.type).toBe('SET_STRATEGY');
    if (storedPlan?.type !== 'SET_STRATEGY') return;
    expect(
      storedPlan.strategy.influencePlans.find(
        (plan) => plan.targetNationId === honduras,
      )?.rejectedObligations,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'sovereignty-cost',
          requestedKinds: ['foreign-policy-veto'],
        }),
      ]),
    );
  });

  it('pauses a rejected final authority clause and increases affordable support', () => {
    const world = regional();
    const patron = world.nations.find((nation) => nation.id === nicaragua)!;
    const subject = world.nations.find((nation) => nation.name === 'Honduras')!;
    const honduras = subject.id;
    patron.stats.treasury = 500;
    subject.stats.stability = 75;
    subject.stats.legitimacy = 75;
    subject.stats.military = 25;
    subject.stats.unrest = 0;
    subject.stats.debt = 150;
    subject.stats.energyExposure = 85;
    subject.stats.industrial = 40;
    subject.stats.fiscal = 35;
    const pair = [nicaragua, honduras].sort() as [NationId, NationId];
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
    const favorableLink = EconomicLink.parse({
      id: 'economic:favorable-honduras-nicaragua',
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
    const existingLink = world.economicLinks.find(
      (link) =>
        link.dependentNationId === honduras &&
        link.partnerNationId === nicaragua,
    );
    if (existingLink) Object.assign(existingLink, favorableLink);
    else world.economicLinks.push(favorableLink);
    const establishedKinds: InfluenceTermShape['kind'][] = [
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
    ];
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:favorable-honduras-strategy',
        name: 'Existing strategic partnership',
        kind: 'influence',
        parties: [nicaragua, honduras],
        status: 'active',
        ratifiedDate: world.date,
        terms: 'A delivered and broadly aligned long-term partnership.',
        influenceTerms: establishedKinds.map((kind) =>
          InfluenceTerm.parse({
            kind,
            patronNationId: nicaragua,
            subjectNationId: honduras,
            ...(kind === 'subsidy'
              ? {
                  amount: 1,
                  paidAmount: 8,
                  paymentsMade: 8,
                  lastPaymentDate: world.date,
                }
              : {}),
          }),
        ),
      }),
    );
    const initialPlan = buildInfluenceStrategyPlan(
      world,
      nicaragua,
      honduras,
      'PUPPET STATE',
    );
    expect(initialPlan.leverage).toBeGreaterThanOrEqual(60);
    expect(initialPlan.resistance).toBeLessThanOrEqual(40);
    expect(initialPlan.patronReliability).toBeGreaterThanOrEqual(65);
    expect(influenceProfile(world, nicaragua, honduras).tier).toBe(
      'SUBJECT STATE',
    );
    expect(initialPlan.nextStep).toMatchObject({
      kind: 'seek-policy-authority',
      requestedTerms: ['join-patron-wars'],
    });
    patron.strategy.influencePlans = [initialPlan];

    const initialOffer = compactCandidates(
      world,
      nicaragua,
      'favorable-authority-first-offer',
      null,
    ).find((candidate) => candidate.id.startsWith('sphere-step-hnd-'));
    const initialNegotiation = initialOffer?.commands.find(
      (command) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === honduras,
    );
    expect(initialNegotiation?.type).toBe('OPEN_NEGOTIATION');
    if (initialNegotiation?.type !== 'OPEN_NEGOTIATION') return;

    const warObligation = clause('join-patron-wars', honduras);
    world.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:rejected-final-war-obligation',
        proposerNationId: nicaragua,
        recipientNationId: honduras,
        topic: 'Patron war obligation',
        kind: 'influence',
        terms: 'Infrastructure and debt relief in exchange for joining wars.',
        status: 'rejected',
        createdDate: world.date,
        expiresDate: world.date,
        influenceTerms: [
          ...initialNegotiation.negotiation.influenceTerms,
          warObligation,
        ],
        responses: [
          {
            nationId: honduras,
            date: world.date,
            move: 'reject',
            message: 'The authority exceeds the value of this support.',
            influenceTerms: [warObligation],
            influenceDecision: {
              reasonCode: 'sovereignty-cost',
              explanation:
                'The requested authority exceeds what this package compensates for.',
              comparison: [],
              possibleLeverage: [],
            },
          },
        ],
      }),
    );

    const adaptedOffer = compactCandidates(
      world,
      nicaragua,
      'favorable-authority-reassess',
      null,
    ).find((candidate) => candidate.id.startsWith('sphere-step-hnd-'));
    expect(adaptedOffer?.id).toBe('sphere-step-hnd-build-economic-dependence');
    const adaptedNegotiation = adaptedOffer?.commands.find(
      (command) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === honduras,
    );
    expect(adaptedNegotiation?.type).toBe('OPEN_NEGOTIATION');
    if (adaptedNegotiation?.type !== 'OPEN_NEGOTIATION') return;
    expect(
      adaptedNegotiation.negotiation.influenceTerms.map((term) => term.kind),
    ).not.toContain('join-patron-wars');
    const initialInfrastructure =
      initialNegotiation.negotiation.influenceTerms.find(
        (term) => term.kind === 'infrastructure-investment',
      )?.amount ?? 0;
    const adaptedInfrastructure =
      adaptedNegotiation.negotiation.influenceTerms.find(
        (term) => term.kind === 'infrastructure-investment',
      )?.amount ?? 0;
    expect(adaptedInfrastructure).toBeGreaterThan(initialInfrastructure);
    expect(adaptedNegotiation.negotiation.influenceTerms).toContainEqual(
      expect.objectContaining({ kind: 'debt-relief', amount: 150 }),
    );
    const existingRecurring = world.treaties
      .flatMap((treaty) => treaty.influenceTerms)
      .filter(
        (term) =>
          term.status === 'active' &&
          term.patronNationId === nicaragua &&
          ['subsidy', 'infrastructure-investment'].includes(term.kind),
      )
      .reduce((sum, term) => sum + term.amount, 0);
    const proposedRecurring = adaptedNegotiation.negotiation.influenceTerms
      .filter((term) =>
        ['subsidy', 'infrastructure-investment'].includes(term.kind),
      )
      .reduce((sum, term) => sum + term.amount, 0);
    const proposedOneTime = adaptedNegotiation.negotiation.influenceTerms
      .filter((term) => term.kind === 'debt-relief')
      .reduce((sum, term) => sum + term.amount, 0);
    expect(
      (existingRecurring + proposedRecurring) * 36 + proposedOneTime,
    ).toBeLessThanOrEqual(patron.stats.treasury);
    const storedPlan = adaptedOffer?.commands.find(
      (command) => command.type === 'SET_STRATEGY',
    );
    expect(storedPlan?.type).toBe('SET_STRATEGY');
    if (storedPlan?.type !== 'SET_STRATEGY') return;
    expect(
      storedPlan.strategy.influencePlans.find(
        (plan) => plan.targetNationId === honduras,
      )?.nextStep.rationale,
    ).toContain('pause the sovereignty request');

    world.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:rejected-support-only-package',
        proposerNationId: nicaragua,
        recipientNationId: honduras,
        topic: 'Expanded economic support',
        kind: 'influence',
        terms: 'A support-only package without the war obligation.',
        status: 'rejected',
        createdDate: world.date,
        expiresDate: world.date,
        influenceTerms: adaptedNegotiation.negotiation.influenceTerms,
        responses: [
          {
            nationId: honduras,
            date: world.date,
            move: 'reject',
            message:
              'The energy package deepens reliance without improving domestic autonomy.',
            influenceTerms: adaptedNegotiation.negotiation.influenceTerms,
            influenceDecision: {
              reasonCode: 'uncertain-benefit',
              explanation:
                'The support does not address the target’s priorities.',
              comparison: [],
              possibleLeverage: [],
            },
          },
        ],
      }),
    );
    const alternativeOffer = compactCandidates(
      world,
      nicaragua,
      'favorable-authority-alternative-support',
      null,
    ).find((candidate) => candidate.id.startsWith('sphere-step-hnd-'));
    const alternativeNegotiation = alternativeOffer?.commands.find(
      (command) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === honduras,
    );
    expect(alternativeNegotiation?.type).toBe('OPEN_NEGOTIATION');
    if (alternativeNegotiation?.type !== 'OPEN_NEGOTIATION') return;
    expect(
      alternativeNegotiation.negotiation.influenceTerms.map(
        (term) => term.kind,
      ),
    ).toContain('market-access-concession');
    expect(
      alternativeNegotiation.negotiation.influenceTerms.map(
        (term) => term.kind,
      ),
    ).not.toContain('energy-supply');
    expect(
      alternativeNegotiation.negotiation.influenceTerms.map(
        (term) => term.kind,
      ),
    ).not.toEqual(
      adaptedNegotiation.negotiation.influenceTerms.map((term) => term.kind),
    );
  });

  it('compares competing patron packages before rejecting a high-sovereignty offer', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const mexico = world.nations.find((nation) => nation.name === 'Mexico')!.id;
    world.nations.find((nation) => nation.id === nicaragua)!.stats.treasury =
      500;
    world.nations.find((nation) => nation.id === mexico)!.stats.treasury = 500;
    const rejected = Negotiation.parse({
      id: 'negotiation:nicaragua-veto-offer',
      proposerNationId: nicaragua,
      recipientNationId: honduras,
      topic: 'Foreign-policy authority',
      kind: 'influence',
      terms: 'Grant Nicaragua a veto over foreign treaties.',
      createdDate: world.date,
      expiresDate: world.date,
      influenceTerms: [clause('foreign-policy-veto', honduras)],
    });
    const rival = Negotiation.parse({
      id: 'negotiation:mexico-investment-offer',
      proposerNationId: mexico,
      recipientNationId: honduras,
      topic: 'Infrastructure investment',
      kind: 'influence',
      terms:
        'Mexico provides infrastructure investment and preferential trade.',
      createdDate: world.date,
      expiresDate: world.date,
      influenceTerms: [
        InfluenceTerm.parse({
          kind: 'infrastructure-investment',
          patronNationId: mexico,
          subjectNationId: honduras,
          amount: 10,
        }),
        InfluenceTerm.parse({
          kind: 'preferential-trade',
          patronNationId: mexico,
          subjectNationId: honduras,
        }),
      ],
    });
    world.negotiations.push(rejected, rival);

    const decision = influenceDecisionRecord(
      world,
      honduras,
      rejected.id,
      'reject',
      'Mexico offers investment without a veto.',
      {
        reasonCode: 'sovereignty-cost',
        explanation:
          'There is no rival offer, and our previous rejected terms were unchanged.',
        comparison: [],
        possibleLeverage: [],
      },
    );
    expect(decision.reasonCode).toBe('rival-offer');
    expect(decision.comparison).toHaveLength(2);
    expect(
      decision.comparison.find((entry) => entry.negotiationId === rival.id),
    ).toMatchObject({ selected: false });
    expect(decision.possibleLeverage).toContain(
      'Address the rival package’s stronger benefits or reliability.',
    );
    expect(decision.explanation).toContain(
      'Mexico has the strongest relevant rival offer',
    );
    expect(decision.explanation).toContain('versus this package’s net');
    expect(decision.explanation).not.toContain('There is no rival offer');
  });

  it('gives the injured government proportionate responses to a patron breach', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const treaty = Treaty.parse({
      id: 'treaty:nicaragua-honduras-breach',
      name: 'Nicaraguan infrastructure pact',
      kind: 'influence',
      parties: [nicaragua, honduras],
      status: 'active',
      terms: 'Recurring infrastructure installments.',
      influenceTerms: [
        InfluenceTerm.parse({
          kind: 'infrastructure-investment',
          patronNationId: nicaragua,
          subjectNationId: honduras,
          amount: 6,
          arrears: 7,
        }),
        InfluenceTerm.parse({
          kind: 'no-rival-alliance',
          patronNationId: honduras,
          subjectNationId: nicaragua,
        }),
      ],
      breaches: [
        {
          id: 'breach:nicaragua-honduras-infrastructure',
          date: world.date,
          obligationKey: 'obligation:nicaragua-honduras-breach-term-0',
          firstMissedDate: world.date,
          lastMissedDate: world.date,
          missedInstallments: 7,
          arrearsAmount: 42,
          durationMonths: 7,
          severity: 78,
          milestones: [
            { key: 'first-missed', date: world.date },
            { key: 'arrears-severe', date: world.date },
          ],
          violatingNationId: nicaragua,
          injuredNationId: honduras,
          reason: 'Missed infrastructure installments.',
          status: 'open',
        },
      ],
    });
    world.treaties.push(treaty);

    const responses = compactCandidates(
      world,
      honduras,
      'enforce-patron-breach',
      null,
    );
    const actions = responses.flatMap((candidate) =>
      candidate.commands.flatMap((command) =>
        command.type === 'ENFORCE_TREATY_BREACH' ? [command.action] : [],
      ),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'diplomatic-demand',
        'demand-arrears',
        'renegotiate',
        'suspend-reciprocals',
        'political-pressure',
        'sanction',
      ]),
    );
    expect(
      responses.some((candidate) =>
        candidate.commands.some((command) => command.type === 'START_CONFLICT'),
      ),
    ).toBe(false);

    const settlement = compactCandidates(
      world,
      nicaragua,
      'repair-own-breach',
      null,
    ).find((candidate) =>
      candidate.commands.some(
        (command) =>
          command.type === 'OPEN_NEGOTIATION' &&
          command.negotiation.sourceBreachId ===
            'breach:nicaragua-honduras-infrastructure',
      ),
    );
    expect(settlement).toBeDefined();
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

describe('target-locked influence response dossiers', () => {
  it('includes the named decision scope and omits patron private budget and unrelated world clutter', () => {
    const world = regional();
    const honduras = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!.id;
    const nicaraguaStats = world.nations.find(
      (nation) => nation.id === nicaragua,
    )!.stats;
    nicaraguaStats.treasury = 987654321;
    const negotiation = Negotiation.parse({
      id: 'negotiation:locked-dossier',
      proposerNationId: nicaragua,
      recipientNationId: honduras,
      topic: 'Honduras partnership',
      kind: 'influence',
      terms: 'Infrastructure and security support for scoped consultation.',
      createdDate: world.date,
      expiresDate: world.date,
      influenceTerms: [
        clause('infrastructure-investment', honduras),
        clause('foreign-policy-consultation', honduras),
      ],
    });
    world.negotiations.push(negotiation);
    const dossier = influenceResponseDossier(world, negotiation, honduras);
    const serialized = JSON.stringify(dossier);

    expect(dossier).toMatchObject({
      decisionScope: {
        decidingActor: { id: honduras, name: 'Honduras' },
        counterpart: { id: nicaragua, name: 'Nicaragua' },
        decision: negotiation.id,
      },
    });
    expect(serialized).not.toContain('987654321');
    expect(serialized).not.toContain('patronResources');
    expect(serialized).not.toContain('Brazil');
  });

  it('keeps the target government private when the patron reviews its counteroffer', () => {
    const world = regional();
    const hondurasNation = world.nations.find(
      (nation) => nation.name === 'Honduras',
    )!;
    hondurasNation.stats.treasury = 654321987;
    hondurasNation.stats.debt = 500;
    hondurasNation.strategy.redLines = ['HONDURAS_PRIVATE_REDLINE_7f3a'];
    const privatePlan = buildInfluenceStrategyPlan(
      world,
      hondurasNation.id,
      nicaragua,
    );
    privatePlan.rationale = 'HONDURAS_SECRET_PLAN_91bc';
    privatePlan.nextStep.rationale = 'HONDURAS_SECRET_NEXT_STEP_91bc';
    hondurasNation.strategy.influencePlans = [privatePlan];
    const counteroffer = Negotiation.parse({
      id: 'negotiation:private-target-counteroffer',
      proposerNationId: hondurasNation.id,
      recipientNationId: nicaragua,
      topic: 'Honduras counterproposal',
      kind: 'influence',
      terms: 'Honduras proposes the communicated bilateral package.',
      createdDate: world.date,
      expiresDate: world.date,
      responses: [
        {
          nationId: hondurasNation.id,
          date: world.date,
          move: 'counter',
          message: 'Honduras proposes the communicated bilateral package.',
          influenceTerms: [
            clause('infrastructure-investment', hondurasNation.id),
            clause('foreign-policy-veto', hondurasNation.id),
          ],
          counterInfluenceTerms: [
            clause('infrastructure-investment', hondurasNation.id),
            clause('foreign-policy-consultation', hondurasNation.id),
          ],
          influenceDecision: InfluenceDecision.parse({
            reasonCode: 'sovereignty-cost',
            explanation: 'The public terms preserve economic support.',
            comparison: [],
            possibleLeverage: [],
            disposition: 'counter',
            modelRationale: 'HONDURAS_PRIVATE_REASONING_91bc',
          }),
        },
      ],
      influenceTerms: [
        clause('infrastructure-investment', hondurasNation.id),
        clause('foreign-policy-consultation', hondurasNation.id),
      ],
    });
    world.negotiations.push(counteroffer);

    const dossier = influenceResponseDossier(world, counteroffer, nicaragua);
    const counterOffers = buildInfluenceCounterOffers(world, counteroffer);
    const serialized = JSON.stringify(dossier);
    expect(dossier).toMatchObject({
      decisionScope: {
        decidingActor: { id: nicaragua, role: 'patron' },
        counterpart: { id: hondurasNation.id, role: 'target' },
        responseMode: 'patron-reviewing-target-counteroffer',
      },
      targetNeeds: null,
      decisionEnvelope: {
        targetPrivateFactors: 'withheld',
      },
    });
    expect(serialized).not.toContain('654321987');
    expect(serialized).not.toContain('HONDURAS_PRIVATE_REDLINE_7f3a');
    expect(serialized).not.toContain('HONDURAS_SECRET_PLAN_91bc');
    expect(serialized).not.toContain('HONDURAS_SECRET_NEXT_STEP_91bc');
    expect(serialized).not.toContain('HONDURAS_PRIVATE_REASONING_91bc');
    expect(dossier?.negotiationMemory).toMatchObject([
      {
        result: 'counter',
        communicatedTerms: [
          { kind: 'infrastructure-investment' },
          { kind: 'foreign-policy-veto' },
        ],
        counterTerms: [
          { kind: 'infrastructure-investment' },
          { kind: 'foreign-policy-consultation' },
        ],
        removedTerms: ['foreign-policy-veto'],
        addedTerms: ['foreign-policy-consultation'],
      },
    ]);
    expect(serialized).not.toContain('patron-unreliable');
    expect(
      counterOffers.flatMap((candidate) =>
        candidate.terms.map((term) => term.kind),
      ),
    ).not.toContain('debt-relief');
  });
});
