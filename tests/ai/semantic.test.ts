import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadScenario } from '@mandate/scenarios';
import {
  WorldState,
  WorldCommand,
  NationId,
  Negotiation,
  Treaty,
  Sanction,
  ActionId,
  CommandId,
  TurnId,
} from '@mandate/schemas';
import { resolveTurn } from '@mandate/core';
import {
  buildSemanticGraph,
  validateSemanticGraph,
  deterministicPlayerIntent,
  executePlayerAction,
  executeStandingPlayerPlans,
  canonicalizeFormalizerIntent,
  semanticCommandIssue,
  formalizerReferences,
  splitActionClauses,
} from '@mandate/ai';
import { resolveOrganizationGeographicSet } from '@mandate/scenarios';
import {
  chaosSemanticCases,
  difficultSemanticCases,
} from '../../tools/semantic-cases.js';
const world = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-alpha.json')),
);
world.playerNationId = world.nations.find((n) => n.name === 'Sweden')!.id;
const named = (ids: NationId[]) =>
  ids
    .map((id) =>
      world.nations
        .find((n) => n.id === id)!
        .name.replace('United States of America', 'United States'),
    )
    .sort();
const parse = (text: string) =>
  buildSemanticGraph(world, { actorNationId: world.playerNationId, text });
const regionalWorld = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
regionalWorld.playerNationId = regionalWorld.nations.find(
  (n) => n.name === 'Sweden',
)!.id;
it('does not classify conditional debt relief as a territorial objective', () => {
  const nicaragua = regionalWorld.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!;
  const nicaraguaWorld = WorldState.parse({
    ...regionalWorld,
    playerNationId: nicaragua.id,
  });
  const intent = deterministicPlayerIntent(nicaraguaWorld, {
    actorNationId: nicaragua.id,
    text: 'Make a conditional offer to Guatemala: relieve part of its debt and expand CAEU subsidies if it accepts agreed limits on rival security and economic treaties.',
  });
  expect(intent.policyOrders[0]?.kind).toBe('diplomacy');
  expect(intent.majorIntentClauses).toEqual([]);
});
it('keeps a split conditional subsidy offer grounded and emits typed terms', () => {
  const nicaragua = regionalWorld.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!;
  const worldWithNicaragua = WorldState.parse({
    ...regionalWorld,
    playerNationId: nicaragua.id,
  });
  worldWithNicaragua.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!.stats.treasury = 500;
  worldWithNicaragua.nations.find(
    (nation) => nation.name === 'Guatemala',
  )!.stats.debt = 20;
  const text =
    'Make a conditional offer to Guatemala: relieve part of its debt and expand CAEU subsidies if it accepts agreed limits on rival security and economic treaties.';
  const intent = deterministicPlayerIntent(worldWithNicaragua, {
    actorNationId: nicaragua.id,
    text,
  });
  const execution = executePlayerAction(
    worldWithNicaragua,
    intent,
    'conditional-influence-offer',
  );
  const offer = execution.commands.find(
    (entry) => entry.command.type === 'OPEN_NEGOTIATION',
  );
  expect(offer?.command.type).toBe('OPEN_NEGOTIATION');
  if (offer?.command.type !== 'OPEN_NEGOTIATION') return;
  expect(offer.command.negotiation.recipientNationId).toBe(
    worldWithNicaragua.nations.find((nation) => nation.name === 'Guatemala')!
      .id,
  );
  expect(offer.command.negotiation.kind).toBe('influence');
  expect(offer.command.negotiation.terms).toContain(
    'expand CAEU subsidies if it accepts',
  );
  expect(
    offer.command.negotiation.influenceTerms.map((term) => term.kind),
  ).toEqual(expect.arrayContaining(['debt-relief', 'subsidy']));
});
it('recognizes named state integration as a territorial objective', () => {
  const intent = deterministicPlayerIntent(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text: 'Make Finland join Sweden.',
  });
  expect(intent.majorIntentClauses.map((clause) => clause.kind)).toContain(
    'conquest-objective',
  );
});
it('keeps direct diplomacy conditions grounded to the named counterpart', () => {
  const finland = regionalWorld.nations.find((n) => n.name === 'Finland')!;
  const graph = buildSemanticGraph(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text: 'Begin diplomacy with Finland. Tell Finland we will guarantee their independence if they allow Swedish aircraft to use their bases.',
    grounding: { selectedNationId: finland.id },
  });
  expect(validateSemanticGraph(graph, regionalWorld)).toEqual([]);
});
it('turns a conditional security guarantee and basing offer into typed influence terms', () => {
  const finland = regionalWorld.nations.find((n) => n.name === 'Finland')!;
  const text =
    'Tell Finland we will guarantee their independence if they allow Swedish aircraft to use their bases.';
  const intent = deterministicPlayerIntent(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text,
    grounding: { selectedNationId: finland.id },
  });
  const execution = executePlayerAction(
    regionalWorld,
    intent,
    'conditional-offer',
  );
  const offer = execution.commands.find(
    (entry) => entry.command.type === 'OPEN_NEGOTIATION',
  );
  expect(offer?.command.type).toBe('OPEN_NEGOTIATION');
  if (offer?.command.type !== 'OPEN_NEGOTIATION') return;
  expect(offer.command.negotiation.recipientNationId).toBe(finland.id);
  expect(offer.command.negotiation.kind).toBe('influence');
  expect(
    offer.command.negotiation.influenceTerms.map((term) => term.kind),
  ).toEqual(expect.arrayContaining(['security-guarantee', 'host-bases']));
  expect(offer.command.negotiation.terms).toBe(text);
  expect(execution.semanticAudit?.[0]?.status).toBe('ATTEMPTED');
});
it('grounds a named subregion to its full name and target state', () => {
  const finland = regionalWorld.nations.find((n) => n.name === 'Finland')!;
  const region = regionalWorld.regions.find(
    (r) => r.name === 'Northern Ostrobothnia' && r.ownerNationId === finland.id,
  )!;
  const text = 'Demand Northern Ostrobothnia from Finland';
  const refs = formalizerReferences(
    regionalWorld,
    regionalWorld.playerNationId,
    text,
  );
  const graph = buildSemanticGraph(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text,
  });
  const intent = deterministicPlayerIntent(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text,
  });
  const execution = executePlayerAction(
    regionalWorld,
    intent,
    'regional-demand',
  );
  expect(refs.explicitRegionIds).toEqual([region.id]);
  expect(graph.actions[0]!.targets).toEqual([finland.id]);
  expect(graph.actions[0]!.territories).toEqual([region.id]);
  expect(execution.semanticAudit?.[0]?.status).toBe('ATTEMPTED');
  expect(
    execution.commands
      .filter((entry) => entry.command.type === 'ADD_CLAIM')
      .map((entry) =>
        entry.command.type === 'ADD_CLAIM' ? entry.command.regionId : null,
      ),
  ).toEqual([region.id]);
});
it('grounds Northern Finland to the three mapped northern regions', () => {
  const finland = regionalWorld.nations.find(
    (nation) => nation.name === 'Finland',
  )!;
  const expected = regionalWorld.regions
    .filter(
      (region) =>
        region.ownerNationId === finland.id &&
        ['Lapland', 'Northern Ostrobothnia', 'Kainuu'].includes(region.name),
    )
    .map((region) => region.id)
    .sort();
  const graph = buildSemanticGraph(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text: 'Demand Northern Finland from Finland.',
  });
  expect(graph.actions[0]?.targets).toEqual([finland.id]);
  expect(graph.actions[0]?.territories.sort()).toEqual(expected);
});
it('founds a stable polity only when its government releases owned territory', () => {
  const before = structuredClone(regionalWorld);
  const finland = before.nations.find((n) => n.name === 'Finland')!;
  before.playerNationId = finland.id;
  const lapland = before.regions.find(
    (region) =>
      region.name === 'Lapland' && region.ownerNationId === finland.id,
  )!;
  const text = 'Create an independent Lapland.';
  const intent = deterministicPlayerIntent(before, {
    actorNationId: finland.id,
    text,
  });
  expect(intent.actionGraph?.actions[0]?.action).toBe('form-polity');
  expect(intent.actionGraph?.actions[0]?.territories).toEqual([lapland.id]);
  const execution = executePlayerAction(before, intent, 'lapland-founding');
  const founding = execution.commands.find(
    (entry) => entry.command.type === 'CREATE_POLITY',
  );
  expect(founding?.command.type).toBe('CREATE_POLITY');
  if (!founding || founding.command.type !== 'CREATE_POLITY') return;
  const foundingCommand = founding.command;
  const after = resolveTurn(
    before,
    {
      expectedRevision: before.revision,
      action: {
        actorNationId: finland.id,
        source: 'player',
        text,
        semanticGraph: intent.actionGraph,
      },
      commands: execution.commands.map((entry, index) => ({
        id: CommandId.parse(`command:lapland-founding-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse('turn:lapland-founding'),
      actionId: ActionId.parse('action:lapland-founding'),
      recordedAt: '2026-10-04T00:00:00.000Z',
    },
  );
  expect(
    after.nations.some((nation) => nation.id === foundingCommand.polity.id),
  ).toBe(true);
  expect(
    after.regions.find((region) => region.id === lapland.id),
  ).toMatchObject({
    ownerNationId: foundingCommand.polity.id,
    controllerNationId: foundingCommand.polity.id,
  });
  expect(after.nations.find((nation) => nation.id === finland.id)?.name).toBe(
    'Finland',
  );
  expect(after.events.at(-1)?.title).toBe(
    'Lapland declares independence from Finland',
  );
});
it('turns a foreign independence order into political support, not invented sovereignty', () => {
  const finland = regionalWorld.nations.find((n) => n.name === 'Finland')!;
  const lapland = regionalWorld.regions.find(
    (region) =>
      region.name === 'Lapland' && region.ownerNationId === finland.id,
  )!;
  const intent = deterministicPlayerIntent(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text: 'Create an independent Lapland.',
  });
  const execution = executePlayerAction(
    regionalWorld,
    intent,
    'support-lapland',
  );
  expect(execution.commands.map((entry) => entry.command.type)).toEqual(
    expect.arrayContaining(['START_INITIATIVE', 'ADJUST_RELATION']),
  );
  expect(
    execution.commands.some((entry) => entry.command.type === 'CREATE_POLITY'),
  ).toBe(false);
  expect(
    regionalWorld.regions.find((region) => region.id === lapland.id)
      ?.ownerNationId,
  ).toBe(finland.id);
  expect(execution.semanticAudit?.[0]?.status).toBe('ABSTRACTED');
});
it('creates a voluntary political federation without merging sovereign states by fiat', () => {
  const intent = deterministicPlayerIntent(regionalWorld, {
    actorNationId: regionalWorld.playerNationId,
    text: 'Create a Nordic federation.',
  });
  const execution = executePlayerAction(
    regionalWorld,
    intent,
    'nordic-federation',
  );
  const creation = execution.commands.find(
    (entry) => entry.command.type === 'CREATE_ORGANIZATION',
  );
  expect(creation?.command.type).toBe('CREATE_ORGANIZATION');
  if (creation?.command.type === 'CREATE_ORGANIZATION')
    expect(creation.command.organization).toMatchObject({
      name: 'Nordic Federation',
      kind: 'political-organization',
      members: [world.playerNationId],
    });
  expect(
    execution.commands.some(
      (entry) => entry.command.type === 'TRANSFER_OWNERSHIP',
    ),
  ).toBe(false);
  expect(execution.semanticAudit?.[0]?.status).toBe('EXECUTED');
});
it('founds CAEU, resolves Central America without the United States, and waits for consent', () => {
  const before = structuredClone(regionalWorld);
  const nicaragua = before.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!;
  before.playerNationId = nicaragua.id;
  const text =
    'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.';
  const intent = deterministicPlayerIntent(before, {
    actorNationId: nicaragua.id,
    text,
  });
  const graph = intent.actionGraph!;
  expect(splitActionClauses(text)).toHaveLength(4);
  expect(validateSemanticGraph(graph, before)).toEqual([]);
  expect(
    graph.actions.flatMap((action) => [
      ...action.targets,
      ...action.sources,
      ...action.participants,
      ...action.beneficiaries,
    ]),
  ).not.toContain('nation:usa');
  expect(
    graph.references.filter((reference) => reference.role === 'target'),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        origin: 'geography',
        expression: 'central america',
      }),
    ]),
  );
  const geographic = resolveOrganizationGeographicSet(
    before,
    nicaragua.id,
    text,
  )!;
  const eligibleNames = [
    'Belize',
    'Costa Rica',
    'El Salvador',
    'Guatemala',
    'Honduras',
    'Panama',
  ];
  const eligible = before.nations
    .filter((nation) => eligibleNames.includes(nation.name))
    .map((nation) => nation.id)
    .sort();
  expect(geographic.nationIds).toEqual(eligible);

  const execution = executePlayerAction(before, intent, 'nicaragua-caeu');
  expect(execution.commands.map((entry) => entry.command.type)).toEqual(
    expect.arrayContaining([
      'CREATE_ORGANIZATION',
      'INVITE_TO_ORGANIZATION',
      'UPDATE_ORGANIZATION',
      'ADD_ORGANIZATION_COMMITMENT',
    ]),
  );
  expect(execution.semanticAudit).toHaveLength(graph.actions.length);
  expect(
    execution.semanticAudit?.every((entry) => entry.status === 'EXECUTED'),
  ).toBe(true);

  const after = resolveTurn(
    before,
    {
      expectedRevision: before.revision,
      action: {
        actorNationId: nicaragua.id,
        source: 'player',
        text,
        semanticGraph: graph,
      },
      commands: execution.commands.map((entry, index) => ({
        id: CommandId.parse(`command:nicaragua-caeu-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse('turn:nicaragua-caeu'),
      actionId: ActionId.parse('action:nicaragua-caeu'),
      recordedAt: '2026-10-04T00:00:00.000Z',
    },
  );
  const organization = after.organizations.find(
    (entry) => entry.acronym === 'CAEU',
  )!;
  expect(organization).toMatchObject({
    name: 'Central American Economic Union',
    kind: 'economic-union',
    foundingDate: before.date,
    founders: [nicaragua.id],
    members: [nicaragua.id],
    geographicScope: 'Central America',
    purpose:
      'increased economic integration between the central american countries',
  });
  expect(
    organization.invitations.map((invitation) => invitation.nationId).sort(),
  ).toEqual(eligible);
  expect(
    organization.invitations.every(
      (invitation) => invitation.status === 'pending',
    ),
  ).toBe(true);
  expect(organization.members).not.toEqual(expect.arrayContaining(eligible));
  expect(organization.invitedStates).not.toContain('nation:usa');
  expect(organization.commitments).toHaveLength(1);
  expect(organization.commitments[0]).toMatchObject({
    kind: 'economic-support',
    appliesTo: 'new-members',
    recipientNationIds: [],
    costPerMember: 2,
    createdDate: before.date,
  });
  expect(organization.commitments[0]!.terms).toContain('subsidize and support');
  expect(
    after.events.some(
      (event) =>
        event.title === 'Nicaragua establishes Central American Economic Union',
    ),
  ).toBe(true);
  expect(
    after.events.filter((event) => event.type === 'INVITE_TO_ORGANIZATION'),
  ).toHaveLength(eligible.length);
});

it('names and founds a region-wide union when the player gives no acronym', () => {
  const before = structuredClone(regionalWorld);
  const nicaragua = before.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!;
  before.playerNationId = nicaragua.id;
  const intent = deterministicPlayerIntent(before, {
    actorNationId: nicaragua.id,
    text: 'Create an economic union for Central America and invite everyone in the region.',
  });
  const execution = executePlayerAction(
    before,
    intent,
    'central-american-union',
  );
  const created = execution.commands.find(
    (entry) => entry.command.type === 'CREATE_ORGANIZATION',
  );
  expect(created?.command.type).toBe('CREATE_ORGANIZATION');
  if (created?.command.type === 'CREATE_ORGANIZATION')
    expect(created.command.organization.name).toBe(
      'Central American Economic Union',
    );
  expect(
    execution.commands.filter(
      (entry) => entry.command.type === 'INVITE_TO_ORGANIZATION',
    ),
  ).toHaveLength(6);
  expect(
    intent.actionGraph?.actions.some((action) =>
      [...action.targets, ...action.participants].includes(
        NationId.parse('nation:usa'),
      ),
    ),
  ).toBe(false);
});

it.each([
  {
    actor: 'Sweden',
    text: 'Sweden creates a Nordic defense alliance and invites Finland and Norway.',
    name: 'Nordic Defense Alliance',
    kind: 'military-alliance',
    invitees: ['Finland', 'Norway'],
    scope: 'the Nordic countries',
  },
  {
    actor: 'Germany',
    text: 'Germany creates a European trade bloc and invites its neighbors.',
    name: 'European Trade Bloc',
    kind: 'trade-bloc',
    invitees: null,
    scope: 'neighbours of Germany',
  },
  {
    actor: 'Brazil',
    text: 'Brazil creates a South American economic union.',
    name: 'South American Economic Union',
    kind: 'economic-union',
    invitees: [],
    scope: 'South America',
  },
])('creates $name with independently consented invitations', (testCase) => {
  const before = structuredClone(regionalWorld);
  const actor = before.nations.find(
    (nation) => nation.name === testCase.actor,
  )!;
  before.playerNationId = actor.id;
  const intent = deterministicPlayerIntent(before, {
    actorNationId: actor.id,
    text: testCase.text,
  });
  expect(validateSemanticGraph(intent.actionGraph!, before)).toEqual([]);
  const execution = executePlayerAction(
    before,
    intent,
    `organization-${testCase.actor.toLowerCase()}`,
  );
  const created = execution.commands.find(
    (entry) => entry.command.type === 'CREATE_ORGANIZATION',
  );
  expect(created?.command.type).toBe('CREATE_ORGANIZATION');
  const invitations = execution.commands.filter(
    (entry) => entry.command.type === 'INVITE_TO_ORGANIZATION',
  );
  const geographicNeighbors =
    before.scenario.neighborhoods?.find((entry) => entry.nationId === actor.id)
      ?.neighbors ?? [];
  const expectedInvitees =
    testCase.invitees ??
    geographicNeighbors.map(
      (id) => before.nations.find((nation) => nation.id === id)!.name,
    );
  expect(
    invitations
      .map((entry) => {
        if (entry.command.type !== 'INVITE_TO_ORGANIZATION') return '';
        const nationId = entry.command.nationId;
        return before.nations.find((nation) => nation.id === nationId)!.name;
      })
      .sort(),
  ).toEqual([...expectedInvitees].sort());
  if (created?.command.type === 'CREATE_ORGANIZATION')
    expect(created.command.organization).toMatchObject({
      name: testCase.name,
      kind: testCase.kind,
      founders: [actor.id],
      members: [actor.id],
      geographicScope: testCase.scope,
    });
});

it('supports later invitations, membership, charter, commitment and dissolution orders', () => {
  const before = structuredClone(regionalWorld);
  const nicaragua = before.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!;
  before.playerNationId = nicaragua.id;
  const seed = deterministicPlayerIntent(before, {
    actorNationId: nicaragua.id,
    text: 'Create the CAEU (Central American Economic Union).',
  });
  const seedExecution = executePlayerAction(before, seed, 'seed-caeu');
  const afterCreate = resolveTurn(
    before,
    {
      expectedRevision: before.revision,
      action: {
        actorNationId: nicaragua.id,
        source: 'player',
        text: seed.summary,
        semanticGraph: seed.actionGraph,
      },
      commands: seedExecution.commands.map((entry, index) => ({
        id: CommandId.parse(`command:seed-caeu-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse('turn:seed-caeu'),
      actionId: ActionId.parse('action:seed-caeu'),
      recordedAt: '2026-10-04T00:00:00.000Z',
    },
  );
  const mexico = afterCreate.nations.find(
    (nation) => nation.name === 'Mexico',
  )!;
  const inviteIntent = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Invite Mexico to the CAEU.',
  });
  expect(inviteIntent.actionGraph?.actions[0]?.participants).toEqual([
    mexico.id,
  ]);
  const invite = executePlayerAction(
    afterCreate,
    inviteIntent,
    'invite-mexico',
  );
  expect(invite.commands.map((entry) => entry.command.type)).toEqual([
    'INVITE_TO_ORGANIZATION',
  ]);

  const charterIntent = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Turn the CAEU into a customs union.',
  });
  expect(
    executePlayerAction(afterCreate, charterIntent, 'customs-union').commands[0]
      ?.command,
  ).toMatchObject({
    type: 'UPDATE_ORGANIZATION',
    kind: 'customs-union',
  });
  const aidIntent = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Offer every CAEU member financial aid.',
  });
  expect(
    executePlayerAction(afterCreate, aidIntent, 'member-aid').commands[0]
      ?.command,
  ).toMatchObject({
    type: 'ADD_ORGANIZATION_COMMITMENT',
    commitment: {
      kind: 'financial-aid',
      appliesTo: 'all-members',
      costPerMember: 1,
    },
  });
  const guatemala = afterCreate.nations.find(
    (nation) => nation.name === 'Guatemala',
  )!;
  const targetedTerms = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Offer Guatemala larger subsidies if it joins the CAEU.',
  });
  expect(
    executePlayerAction(afterCreate, targetedTerms, 'guatemala-support')
      .commands[0]?.command,
  ).toMatchObject({
    type: 'ADD_ORGANIZATION_COMMITMENT',
    commitment: {
      appliesTo: 'new-members',
      recipientNationIds: [guatemala.id],
      costPerMember: 4,
    },
  });

  const leaveIntent = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Leave the CAEU.',
  });
  expect(
    executePlayerAction(afterCreate, leaveIntent, 'leave-caeu').commands[0]
      ?.command,
  ).toMatchObject({
    type: 'SET_ORGANIZATION_MEMBERSHIP',
    nationId: nicaragua.id,
    member: false,
  });
  const dissolveIntent = deterministicPlayerIntent(afterCreate, {
    actorNationId: nicaragua.id,
    text: 'Dissolve the organization.',
  });
  expect(
    executePlayerAction(afterCreate, dissolveIntent, 'dissolve-caeu')
      .commands[0]?.command,
  ).toMatchObject({
    type: 'DISSOLVE_ORGANIZATION',
  });
});

it('a territorial transfer source is not a foreign-force acquisition dependency', () => {
  const graph = parse(
    'Give Åland to Finland and then demand Gotland from Denmark.',
  );
  expect(graph.actions[0]!.sources).toEqual([world.playerNationId]);
  expect(graph.actions[0]!.issues).toEqual([]);
  expect(graph.actions[0]!.instruments).toEqual([]);
});
describe('semantic chaos regressions (150 inputs)', () => {
  it.each(chaosSemanticCases)('$text', (test) => {
    const graph = parse(test.text);
    expect(validateSemanticGraph(graph, world)).toEqual([]);
    for (const check of test.checks) {
      const nodes = graph.actions.filter((a) => a.action === check.action);
      const matching = nodes.find(
        (a) =>
          (check.targets === undefined ||
            JSON.stringify(named(a.targets)) ===
              JSON.stringify([...check.targets].sort())) &&
          (check.sources === undefined ||
            JSON.stringify(named(a.sources)) ===
              JSON.stringify([...check.sources].sort())) &&
          (check.participants === undefined ||
            JSON.stringify(named(a.participants)) ===
              JSON.stringify([...check.participants].sort())) &&
          (!check.conditional || a.conditions.length > 0),
      );
      expect(matching, JSON.stringify({ check, graph }, null, 2)).toBeDefined();
    }
  });
});
describe('semantic source/target fuzz', () => {
  const names = [
    'United States',
    'Russia',
    'Germany',
    'France',
    'Norway',
    'Finland',
    'Poland',
    'China',
  ];
  const prefixes = ['Use', 'Secretly use', 'Please use'];
  const conjunctions = [' and ', ' & '];
  it('checks 2016 distinct role permutations', () => {
    let count = 0;
    for (const source of names)
      for (const t1 of names)
        for (const t2 of names) {
          if (new Set([source, t1, t2]).size !== 3) continue;
          for (const prefix of prefixes)
            for (const conjunction of conjunctions) {
              const graph = parse(
                `${prefix} ${source}'s forces to attack ${t1}${conjunction}${t2}, then annex both.`,
              );
              expect(named(graph.actions[0]!.sources)).toEqual([source]);
              expect(named(graph.actions[0]!.targets)).toEqual([t1, t2].sort());
              expect(named(graph.actions[1]!.targets)).toEqual([t1, t2].sort());
              expect(graph.actions[1]!.targets).not.toContain(
                graph.actions[0]!.sources[0],
              );
              count++;
            }
        }
    expect(count).toBe(2016);
  });
});
it('blocks required unavailable forces, retains only requested conquest objectives, commits atomically', () => {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: difficultSemanticCases[0]!.text,
  });
  expect(intent.actionGraph!.actions).toHaveLength(3);
  const execution = executePlayerAction(world, intent, 'semantic-exact');
  expect(execution.semanticAudit!.map((a) => a.status)).toEqual([
    'IMPOSSIBLE',
    'BLOCKED',
    'ATTEMPTED',
  ]);
  expect(
    execution.commands.some((c) => c.command.type === 'START_CONFLICT'),
  ).toBe(false);
  const after = resolveTurn(
    world,
    {
      expectedRevision: world.revision,
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: intent.summary,
      },
      commands: execution.commands.map((c, i) => ({
        ...c,
        id: `command:semantic-${i}` as never,
      })),
    },
    {
      turnId: TurnId.parse('turn:semantic-exact'),
      actionId: ActionId.parse('action:semantic-exact'),
      recordedAt: '2026-10-03T12:00:00.000Z',
    },
  );
  const goals = after.goals.filter(
    (g) => g.nationId === world.playerNationId && g.kind === 'territorial',
  );
  expect(goals.flatMap((g) => named(g.targetNationIds))).not.toContain(
    'Russia',
  );
  expect(goals.flatMap((g) => named(g.targetNationIds))).toContain('Finland');
  for (const c of execution.commands) WorldCommand.parse(c.command);
});
it('does not execute either unknown conditional branch; persists structured plans', () => {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: 'If Finland accepts the deal, guarantee their independence. Otherwise start mobilizing.',
  });
  const execution = executePlayerAction(world, intent, 'conditional');
  expect(execution.semanticAudit!.map((a) => a.status)).toEqual([
    'DEFERRED',
    'DEFERRED',
  ]);
  expect(execution.commands.map((c) => c.command.type)).toEqual([
    'SET_STRATEGY',
  ]);
  const strategy = execution.commands[0]!.command;
  expect(
    strategy.type === 'SET_STRATEGY' &&
      strategy.strategy.directives.filter((d) => d.semanticPlan).length,
  ).toBe(2);
});
it('uses map grounding separately from text and stable multi-turn targets', () => {
  const finland = world.nations.find((n) => n.name === 'Finland')!.id;
  const graph = buildSemanticGraph(world, {
    actorNationId: world.playerNationId,
    text: 'Invade them.',
    grounding: { selectedNationId: finland },
  });
  expect(graph.actions[0]!.targets).toEqual([finland]);
  expect(graph.references[0]!.origin).toBe('map');
  const next = structuredClone(world);
  next.actions.push({
    id: ActionId.parse('action:context'),
    turnId: TurnId.parse('turn:context'),
    source: 'player',
    actorNationId: world.playerNationId,
    text: 'Demand Åland from Finland.',
  });
  const followup = buildSemanticGraph(next, {
    actorNationId: next.playerNationId,
    text: 'Offer them one last chance, then invade if they refuse.',
  });
  expect(followup.actions[0]!.targets).toEqual([finland]);
  expect(followup.references[0]!.origin).toBe('conversation');
});
it('rejects graph corruption before commands are constructed', () => {
  const graph = parse(difficultSemanticCases[0]!.text);
  graph.actions[2]!.targets = [
    world.nations.find((n) => n.name === 'Russia')!.id,
  ];
  expect(validateSemanticGraph(graph, world).join(' ')).toMatch(
    /grounded source text/,
  );
  graph.actions[1]!.dependencies.push({
    actionId: 'missing',
    requirement: 'result',
    mandatory: true,
  });
  expect(validateSemanticGraph(graph, world).join(' ')).toMatch(/nonexistent/);
});
it('blocks unresolved and oversized references', () => {
  expect(parse('Invade them.').actions[0]!.issues.join(' ')).toMatch(
    /Unresolved/,
  );
  expect(
    parse(
      'Invade Norway, Finland and Poland. Annex both.',
    ).actions[1]!.issues.join(' '),
  ).toMatch(/exactly two/);
});

it('activates only the correct branch from a bound canonical response, exactly once', () => {
  const next = structuredClone(world);
  const finland = next.nations.find((n) => n.name === 'Finland')!.id;
  next.negotiations.push(
    Negotiation.parse({
      id: 'negotiation:bound-deal',
      proposerNationId: next.playerNationId,
      recipientNationId: finland,
      topic: 'Territorial demand',
      kind: 'consultation',
      terms: 'Discuss Åland',
      createdDate: next.date,
      expiresDate: '2027-01-01',
      status: 'open',
    }),
  );
  const intent = deterministicPlayerIntent(next, {
    actorNationId: next.playerNationId,
    text: 'If Finland rejects the deal, mobilize.',
  });
  const saved = executePlayerAction(
    next,
    intent,
    'save-conditional',
  ).commands.find((c) => c.command.type === 'SET_STRATEGY')!.command;
  if (saved.type !== 'SET_STRATEGY') throw new Error('Missing stored plan');
  next.nations.find((n) => n.id === next.playerNationId)!.strategy =
    saved.strategy;
  expect(executeStandingPlayerPlans(next, 'pending').commands).toHaveLength(0);
  next.negotiations[0]!.status = 'rejected';
  const activated = executeStandingPlayerPlans(next, 'activate');
  expect(
    activated.commands.some((c) => c.command.type === 'MOBILIZE_FORCE'),
  ).toBe(true);
  const retired = activated.commands.find(
    (c) => c.command.type === 'SET_STRATEGY',
  )!.command;
  if (retired.type !== 'SET_STRATEGY') throw new Error('Missing retired plan');
  next.nations.find((n) => n.id === next.playerNationId)!.strategy =
    retired.strategy;
  expect(executeStandingPlayerPlans(next, 'again').commands).toHaveLength(0);
});
it('asks allies for participation without declaring war on allies or the proposed target', () => {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: 'Ask Germany and France to invade Poland with us, but if France refuses do not start the war.',
  });
  const execution = executePlayerAction(world, intent, 'ask-allies');
  expect(
    execution.commands.some((c) =>
      [
        'START_CONFLICT',
        'ADD_CLAIM',
        'STRATEGIC_ATTACK',
        'OPEN_CRISIS',
        'CRISIS_ACTION',
      ].includes(c.command.type),
    ),
  ).toBe(false);
});
it('a singular request for German help cannot become a demand for German territory', () => {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: 'Ask Germany to help invade Poland.',
  });
  const execution = executePlayerAction(world, intent, 'ask-help');
  expect(
    execution.commands.filter((c) => c.command.type === 'OPEN_NEGOTIATION'),
  ).toHaveLength(1);
  expect(
    execution.commands.some((c) =>
      ['OPEN_CRISIS', 'CRISIS_ACTION', 'START_CONFLICT', 'ADD_CLAIM'].includes(
        c.command.type,
      ),
    ),
  ).toBe(false);
});
it('repairs malicious source-to-target proposals before the executor can use them', () => {
  const text = difficultSemanticCases[0]!.text;
  const draft = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text,
  });
  const russia = world.nations.find((n) => n.name === 'Russia')!.id;
  const repaired = canonicalizeFormalizerIntent(
    world,
    { actorNationId: world.playerNationId, text },
    {
      ...draft,
      semanticProposals: [
        {
          clauseId: 2,
          action: 'annex',
          targets: [russia],
          sources: [],
          participants: [],
        },
      ],
    },
  );
  expect(repaired.actionGraph!.repairs.join(' ')).toMatch(/targets/);
  expect(repaired.actionGraph!.actions[2]!.targets).not.toContain(russia);
  const graph = repaired.actionGraph!;
  expect(
    semanticCommandIssue(world, graph, {
      type: 'ADD_CLAIM',
      nationId: world.playerNationId,
      regionId: world.regions.find((r) => r.ownerNationId === russia)!.id,
    }),
  ).toMatch(/grounded role/);
});
it.each([
  'Mobilize before invading Finland.',
  'Before invading Finland, mobilize.',
  'After mobilizing, invade Finland.',
  'Invade Finland after mobilizing.',
])('preserves temporal ordering: %s', (text) => {
  const graph = parse(text);
  expect(graph.actions.map((a) => a.action)).toEqual(['mobilize', 'invade']);
  expect(graph.actions[1]!.dependencies).toContainEqual({
    actionId: graph.actions[0]!.id,
    requirement: 'ordered',
    mandatory: true,
  });
});
it('stores both an explicit group and an actor pronoun separately', () => {
  const graph = parse(
    'Invade both Norway and Finland. Then it annexes both countries.',
  );
  expect(graph.actions[0]!.issues).toEqual([]);
  expect(
    graph.references.some(
      (r) => r.role === 'actor' && r.expression.toLowerCase() === 'it',
    ),
  ).toBe(true);
  expect(named(graph.actions[1]!.targets)).toEqual(['Finland', 'Norway']);
});

it('cancels sanctions without imposing new ones and preserves the explicitly retained trade agreement', () => {
  const next = structuredClone(world);
  const germany = next.nations.find((n) => n.name === 'Germany')!.id;
  next.sanctions.push(
    Sanction.parse({
      id: 'sanction:semantic-existing',
      issuer: next.playerNationId,
      target: germany,
      sector: 'trade',
      intensity: 50,
      startDate: next.date,
      reason: 'Earlier policy',
    }),
  );
  const cancel = executePlayerAction(
    next,
    deterministicPlayerIntent(next, {
      actorNationId: next.playerNationId,
      text: 'Cancel the sanctions on Germany.',
    }),
    'cancel-sanctions',
  );
  expect(
    cancel.commands.some((c) => c.command.type === 'IMPOSE_SANCTION'),
  ).toBe(false);
  expect(cancel.commands.some((c) => c.command.type === 'LIFT_SANCTION')).toBe(
    true,
  );
  next.treaties.push(
    Treaty.parse({
      id: 'treaty:semantic-trade',
      name: 'Trade agreement',
      kind: 'trade',
      parties: [next.playerNationId, germany],
      terms: 'Trade',
      status: 'active',
    }),
    Treaty.parse({
      id: 'treaty:semantic-defense',
      name: 'Defense treaty',
      kind: 'defense',
      parties: [next.playerNationId, germany],
      terms: 'Defense',
      status: 'active',
    }),
  );
  const execution = executePlayerAction(
    next,
    deterministicPlayerIntent(next, {
      actorNationId: next.playerNationId,
      text: 'Tell Germany to fuck off, cancel our treaty with them, but keep the trade agreement.',
    }),
    'keep-trade',
  );
  expect(
    execution.commands
      .filter((c) => c.command.type === 'END_TREATY')
      .map((c) => c.command.type === 'END_TREATY' && c.command.treatyId),
  ).toEqual(['treaty:semantic-defense']);
});
