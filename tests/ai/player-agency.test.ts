import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalStringify, resolveTurn } from '@mandate/core';
import { buildContext } from '@mandate/memory';
import {
  Conflict,
  Goal,
  NationId,
  Negotiation,
  Treaty,
  WorldCommand,
} from '@mandate/schemas';
import {
  createOrchestrator,
  deterministicPlayerIntent,
  executePlayerAction,
  formalizerReferences,
  FakeProvider,
  scorePlayerAgency,
} from '../../packages/ai/src/index.js';
import type {
  GenerationRequest,
  GenerationResult,
} from '../../packages/ai/src/index.js';
import { context, fixture, request } from '../fixtures/world.js';

const agencyCases = [
  ['reckless foreign policy', 'Annex Finland.'],
  ['reckless foreign policy', 'Take Finland.'],
  ['reckless foreign policy', 'Finland is ours.'],
  ['reckless foreign policy', 'Invade Finland.'],
  [
    'extreme multi-clause attack',
    'Sweden nukes Finland and sends in its armed forces to take the country',
  ],
  ['extreme military action', 'Invade Finland.'],
  ['extreme military action', 'Bomb Finland and invade.'],
  ['extreme military action', 'Take Finland by force.'],
  ['extreme military action', 'Launch a massive attack and occupy Helsinki.'],
  [
    'extreme military ultimatum',
    'Demand Finland surrender or invade immediately.',
  ],
  ['reckless foreign policy', 'fuck it invade Norway'],
  ['reckless foreign policy', 'Demand Denmark give us Copenhagen.'],
  [
    'reckless foreign policy',
    'Threaten military action unless Finland accepts.',
  ],
  ['reckless foreign policy', 'Break our treaty with France.'],
  ['reckless foreign policy', 'Leave every alliance.'],
  ['reckless foreign policy', 'Sanction Germany.'],
  ['reckless foreign policy', 'Recognize a breakaway state in Lithuania.'],
  ['reckless foreign policy', 'Offer Russia a military alliance.'],
  ['reckless foreign policy', 'Demand Finland surrender.'],
  ['reckless foreign policy', 'Mobilize the entire military.'],
  ['reckless foreign policy', 'Withdraw from the active war now.'],
  ['reckless foreign policy', 'Surrender to Russia.'],
  ['reckless foreign policy', 'Give Åland to Finland as a goodwill gesture.'],
  ['reckless foreign policy', 'Offer them literally whatever they want.'],
  ['reckless foreign policy', 'Make Finland join Sweden.'],
  ['reckless foreign policy', 'Threaten war unless Norway accepts.'],
  [
    'reckless foreign policy',
    "Demand Norway support Sweden's annexation policy.",
  ],
  ['reckless economic policy', 'Cut military spending by 90%.'],
  ['reckless economic policy', 'Triple military spending.'],
  ['reckless economic policy', 'Stop all foreign aid.'],
  ['reckless economic policy', 'Cut taxes by 90%.'],
  ['reckless economic policy', 'Double defense spending.'],
  [
    'reckless economic policy',
    'Spend nearly all available fiscal capacity on rearmament.',
  ],
  ['reckless economic policy', 'Cancel every active national project.'],
  ['reckless economic policy', 'Cancel the critical infrastructure project.'],
  ['reckless economic policy', 'Abandon our major strategic goal.'],
  ['reckless economic policy', 'Invest in nuclear energy over five years.'],
  ['reckless economic policy', 'Expand the energy grid for the next year.'],
  ['reckless economic policy', 'Spend everything we can on defense.'],
  ['reckless economic policy', 'Cut all foreign aid immediately.'],
  ['reckless economic policy', 'Fund a major energy program.'],
  ['reckless economic policy', 'Build industry no matter what.'],
  ['reckless economic policy', 'Impose energy sanctions on Germany.'],
  ['reckless economic policy', 'Cut taxes drastically.'],
  ['reckless domestic policy', 'Launch a radical domestic reform.'],
  ['reckless domestic policy', 'Reverse the government security priority.'],
  [
    'reckless domestic policy',
    'Cancel every national project, regardless of sunk cost.',
  ],
  ['reckless domestic policy', 'Abandon the popular infrastructure program.'],
  ['contradictory strategy', 'Invade Finland despite our neutrality policy.'],
  [
    'contradictory strategy',
    'Break the treaty even though we promised to preserve it.',
  ],
  [
    'contradictory strategy',
    'Leave NATO despite the active alliance directive.',
  ],
  ['contradictory strategy', 'Abandon our active goal of regional stability.'],
  [
    'contradictory strategy',
    'Replace economic priorities with military expansion.',
  ],
  [
    'contradictory strategy',
    'Recognize Finland’s claim after promising not to.',
  ],
  ['contradictory strategy', 'Threaten sanctions on Denmark.'],
  ['reasonable policy', 'Propose a defense pact with Finland.'],
  ['reasonable policy', 'Seek a ceasefire with Russia.'],
  ['reasonable policy', 'Negotiate peace with Russia.'],
  ['reasonable policy', 'Discuss closer defense cooperation with Norway.'],
  ['reasonable policy', 'Offer Finland market access.'],
  ['reasonable policy', 'Increase military readiness in northern Sweden.'],
  ['reasonable policy', 'Develop manufacturing capacity gradually.'],
  [
    'reasonable policy',
    'Continue the current energy program if it is progressing; avoid duplicate spending.',
  ],
  ['reasonable policy', 'Keep the current strategy and wait.'],
  ['reckless foreign policy', 'Annex Finland, but do not start a war.'],
  [
    'reckless foreign policy',
    'Tell Germany to go fuck themselves and cancel the treaty.',
  ],
  ['reckless foreign policy', 'Pull out of the war NOW.'],
  ['reckless foreign policy', 'Demand basing rights from Finland.'],
] as const;

const hash = (world: ReturnType<typeof fixture>) =>
  createHash('sha256').update(canonicalStringify(world)).digest('hex');
const finland = NationId.parse('nation:fin');

describe('player authority evaluation suite', () => {
  it('grounds a named capital to its sourced country while preserving country-level geometry', () => {
    const world = fixture();
    const references = formalizerReferences(
      world,
      world.playerNationId,
      'Launch a massive attack and occupy Helsinki.',
    );
    expect(references.explicitNationIds).toContain(finland);
    expect(references.explicitRegionIds).toEqual([]);
    expect(
      references.regions.some((region) => region.ownerNationId === finland),
    ).toBe(true);
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: 'Launch a massive attack and occupy Helsinki.',
    });
    expect(
      intent.majorIntentClauses.every((clause) =>
        clause.targetNationIds.includes(finland),
      ),
    ).toBe(true);
  });

  it('includes at least 50 categorized actions', () => {
    expect(agencyCases.length).toBeGreaterThanOrEqual(50);
    expect(
      new Set(
        agencyCases
          .map(([category]) => category)
          .filter(
            (v) =>
              v !== 'reckless foreign policy' &&
              v !== 'reckless economic policy',
          ),
      ).size,
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(agencyCases)(
    '%s preserves the exact order: %s',
    (_category, text) => {
      const world = fixture();
      const intent = deterministicPlayerIntent(world, {
        actorNationId: world.playerNationId,
        text,
      });
      const execution = executePlayerAction(world, intent, 'agency-suite');
      expect(execution.orders).toEqual(
        intent.policyOrders.map((order) => order.text),
      );
      for (const entry of execution.commands) WorldCommand.parse(entry.command);
      for (const order of intent.policyOrders)
        expect(execution.orders).toContain(order.text);
    },
  );

  it('measures major-clause coverage across the player-agency evaluation suite', () => {
    const scores = agencyCases.map(([, text]) => {
      const world = fixture();
      const intent = deterministicPlayerIntent(world, {
        actorNationId: world.playerNationId,
        text,
      });
      const execution = executePlayerAction(world, intent, 'coverage-suite');
      return scorePlayerAgency(intent, execution, world);
    });
    const scoresWithMajorIntent = agencyCases.flatMap(([, text], index) => {
      const world = fixture();
      const intent = deterministicPlayerIntent(world, {
        actorNationId: world.playerNationId,
        text,
      });
      const execution = executePlayerAction(world, intent, 'coverage-suite');
      return intent.majorIntentClauses.length
        ? [{ text, score: scores[index]!, intent, execution }]
        : [];
    });
    expect(scoresWithMajorIntent.length).toBeGreaterThan(0);
    expect(
      scoresWithMajorIntent
        .filter(({ score }) => score.majorIntentCoveragePercent !== 100)
        .map(({ text, score, intent, execution }) => ({
          text,
          percent: score.majorIntentCoveragePercent,
          audit: intent.majorIntentClauses.map((clause) => ({
            kind: clause.kind,
            evidence: execution.intentSatisfactionAudit.find(
              (entry) => entry.clauseId === clause.id,
            ),
          })),
        })),
    ).toEqual([]);
  });

  it('keeps a demand for support distinct from annexing the named country', () => {
    const world = fixture();
    const norway = NationId.parse('nation:nor');
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: "Demand Norway support Sweden's annexation policy.",
    });
    const order = intent.policyOrders[0]!;
    const execution = executePlayerAction(
      world,
      intent,
      'norway-support-demand',
    );
    expect(order.kind).toBe('diplomacy');
    expect(order.intensity).toBe('medium');
    expect(order.targetNationIds).toEqual([norway]);
    expect(order.targetRegionIds).toEqual([]);
    expect(intent.desiredOutcomes).toEqual([]);
    const supportProposal = execution.commands.find(
      ({ command }) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.recipientNationId === norway,
    );
    expect(supportProposal?.command.type).toBe('OPEN_NEGOTIATION');
    if (supportProposal?.command.type === 'OPEN_NEGOTIATION')
      expect(supportProposal.command.negotiation.topic).toBe(
        "Support for Sweden's annexation policy",
      );
    expect(
      execution.commands.some(
        ({ command }) =>
          command.type === 'OPEN_CRISIS' &&
          command.crisis.participants.includes(norway) &&
          command.crisis.type === 'security',
      ),
    ).toBe(true);
    expect(
      execution.commands.some(({ command }) =>
        ['ADD_CLAIM', 'START_CONFLICT'].includes(command.type),
      ),
    ).toBe(false);
  });

  it('ends a represented French treaty when the player orders it broken', () => {
    const world = fixture();
    const france = NationId.parse('nation:fra');
    world.treaties.push(
      Treaty.parse({
        id: 'treaty:player-agency-france',
        name: 'Sweden-France Defense Treaty',
        kind: 'defense',
        parties: [world.playerNationId, france],
        status: 'active',
        terms: 'Mutual defense and consultation',
      }),
    );
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: 'Break our treaty with France.',
    });
    const execution = executePlayerAction(world, intent, 'break-france-treaty');
    expect(execution.orders).toEqual(['Break our treaty with France.']);
    expect(
      execution.commands.some(
        ({ command }) =>
          command.type === 'END_TREATY' &&
          command.treatyId === 'treaty:player-agency-france',
      ),
    ).toBe(true);
    expect(execution.implementation.join(' ')).toMatch(
      /Ended 1 active treaty commitment/,
    );
    expect(
      execution.commands.some(
        ({ command }) => command.type === 'ADJUST_RELATION',
      ),
    ).toBe(true);
  });

  it('preserves the exact Sweden annexation regression as an attempted policy and demand', async () => {
    const world = fixture();
    const finlandRegions = world.regions.filter(
      (r) => r.ownerNationId === 'nation:fin',
    );
    const result = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Annex Finland.',
      },
      runId: 'annex-finland-agency-regression',
    });
    const playerExecution = result.trace.playerExecution!;
    const commands = result.request.commands.map((entry) => entry.command);
    expect(playerExecution.orders).toContain('Annex Finland.');
    expect(playerExecution.implementation.join(' ')).toMatch(
      /annexation objective|demand/i,
    );
    expect(
      commands.some(
        (command) =>
          command.type === 'ADD_CLAIM' &&
          command.nationId === world.playerNationId,
      ),
    ).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.type === 'OPEN_CRISIS' &&
          command.crisis.participants.includes(finland),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (command) =>
          command.type === 'CRISIS_ACTION' &&
          command.nationId === world.playerNationId &&
          command.move === 'mobilize',
      ),
    ).toBe(true);
    expect(commands.some((command) => command.type === 'START_CONFLICT')).toBe(
      false,
    );
    expect(
      commands.some(
        (command) =>
          command.type === 'START_INITIATIVE' &&
          /energy|domestic/i.test(command.initiative.kind),
      ),
    ).toBe(false);

    const { expectedHash: ignored, ...request } = result.request;
    void ignored;
    const after = resolveTurn(world, request, context(1));
    expect(
      after.regions
        .filter((r) => finlandRegions.some((f) => f.id === r.id))
        .every((r) => r.ownerNationId === 'nation:fin'),
    ).toBe(true);
    expect(
      after.regions
        .filter((r) => finlandRegions.some((f) => f.id === r.id))
        .every((r) => r.claims.includes(world.playerNationId)),
    ).toBe(true);
    expect(
      after.crises.some(
        (c) =>
          c.participants.includes(world.playerNationId) &&
          c.participants.includes(finland) &&
          c.status !== 'resolved',
      ),
    ).toBe(true);
    const relation = after.relations.find(
      (r) =>
        [r.nationA, r.nationB].includes(world.playerNationId) &&
        [r.nationA, r.nationB].includes(finland),
    )!;
    expect(relation.trust).toBeLessThan(50);
    expect(relation.grievances.some((g) => g.includes('Annex Finland'))).toBe(
      true,
    );
    const finnishView = buildContext(after, finland, [world.playerNationId], {
      topics: ['Annex Finland'],
    });
    expect(
      finnishView.canonical.relations.some((r) =>
        r.grievances.some((g) => g.includes('Annex Finland')),
      ),
    ).toBe(true);
    expect(
      after.initiatives.some(
        (i) =>
          i.nationId === world.playerNationId &&
          /energy diversification|domestic stability/i.test(i.name),
      ),
    ).toBe(false);
    expect(
      scorePlayerAgency(result.trace.intent!, playerExecution, world, after),
    ).toEqual({
      semanticPreservation: 1,
      majorIntentCoveragePercent: 100,
      controllableAttempt: 1,
      externalOutcomeBoundary: 1,
      paternalisticSubstitutionFree: true,
      consequenceGeneration: 1,
      worldReaction: 1,
    });
  });

  it('preserves and commits every major clause in the extreme Sweden-Finland action', async () => {
    const world = fixture();
    const input =
      'Sweden nukes Finland and sends in its armed forces to take the country';
    const finland = NationId.parse('nation:fin');
    const beforeRelatedSeverity = Math.max(
      0,
      ...world.crises
        .filter((crisis) => crisis.participants.includes(finland))
        .map((crisis) => crisis.severity),
    );
    const result = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: input,
      },
      runId: 'sweden-finland-extreme-intent-regression',
    });
    const intent = result.trace.intent!;
    const execution = result.trace.playerExecution!;
    expect(intent.targetNationIds).toEqual([finland]);
    expect(
      intent.targetRegionIds.every(
        (regionId) =>
          world.regions.find((region) => region.id === regionId)
            ?.ownerNationId === finland,
      ),
    ).toBe(true);
    const kinds = new Set(
      intent.majorIntentClauses.map((clause) => clause.kind),
    );
    expect(kinds).toEqual(
      new Set([
        'strategic-strike',
        'armed-conflict-initiation',
        'military-mobilization',
        'invasion-offensive',
        'conquest-objective',
      ]),
    );
    expect(execution.intentSatisfactionAudit).toHaveLength(
      intent.majorIntentClauses.length,
    );
    expect(
      execution.intentSatisfactionAudit.every(
        (entry) => entry.status !== 'UNSUPPORTED',
      ),
    ).toBe(true);
    expect(
      scorePlayerAgency(intent, execution, world).majorIntentCoveragePercent,
    ).toBe(100);

    const commands = result.request.commands.map((entry) => entry.command);
    expect(
      commands.some((command) => command.type === 'STRATEGIC_ATTACK'),
    ).toBe(true);
    expect(commands.some((command) => command.type === 'START_CONFLICT')).toBe(
      true,
    );
    expect(
      commands.some(
        (command) =>
          command.type === 'THEATER_ACTION' &&
          command.posture === 'major-offensive',
      ),
    ).toBe(true);
    expect(commands.some((command) => command.type === 'MOBILIZE_FORCE')).toBe(
      true,
    );
    expect(commands.some((command) => command.type === 'ADD_CLAIM')).toBe(true);
    expect(
      result.trace.activations.some((entry) => entry.nationId === finland),
    ).toBe(true);
    const finnishContext = result.trace.contexts.find(
      (entry) => entry.perspectiveNationId === finland,
    );
    expect(finnishContext).toBeDefined();
    expect(
      finnishContext?.canonical.conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          conflict.attackers.includes(world.playerNationId) &&
          conflict.defenders.includes(finland),
      ),
    ).toBe(true);
    expect(
      finnishContext?.canonical.crises.some(
        (crisis) =>
          crisis.participants.includes(world.playerNationId) &&
          crisis.participants.includes(finland),
      ),
    ).toBe(true);

    const { expectedHash: ignored, ...requestBody } = result.request;
    void ignored;
    const after = resolveTurn(world, requestBody, context(1));
    const crisis = after.crises.find(
      (item) =>
        item.participants.includes(world.playerNationId) &&
        item.participants.includes(finland),
    )!;
    expect(crisis.severity).toBeGreaterThanOrEqual(90);
    expect(crisis.severity).toBeGreaterThan(beforeRelatedSeverity);
    expect(crisis.status).not.toBe('de-escalating');
    expect(
      after.conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          conflict.attackers.includes(world.playerNationId) &&
          conflict.defenders.includes(finland) &&
          conflict.theaters.some(
            (theater) => theater.posture === 'major-offensive',
          ),
      ),
    ).toBe(true);
    const strikeEvent = after.events.find(
      (event) => event.type === 'STRATEGIC_ATTACK',
    )!;
    expect(strikeEvent.title).toMatch(/strategic attack abstraction/i);
    expect(strikeEvent.title).toMatch(
      /weapon-specific effects are not simulated/i,
    );
    expect(strikeEvent.title).toMatch(/invasion offensive begins/i);
    expect(strikeEvent.title).not.toMatch(/nuked|nuclear detonation/i);
    expect(
      after.events
        .filter((event) => event.turnId === strikeEvent.turnId)
        .every(
          (event) =>
            !/Finland (?:was )?nuked|nuclear detonation/i.test(event.title),
        ),
    ).toBe(true);
    expect(
      after.regions
        .filter((region) => region.ownerNationId === finland)
        .every((region) => region.controllerNationId === finland),
    ).toBe(true);
    expect(
      after.goals.filter((goal) => {
        const evaluation = goal.evaluation;
        if (
          goal.nationId !== world.playerNationId ||
          evaluation.kind !== 'territory'
        )
          return false;
        return (
          after.regions.find((region) => region.id === evaluation.regionId)
            ?.ownerNationId === world.playerNationId
        );
      }),
    ).toHaveLength(0);
    expect(
      after.events.filter(
        (event) => event.type === 'GOAL_ACHIEVED' && /annex/i.test(event.title),
      ),
    ).toHaveLength(0);
    expect(strikeEvent.importance).toBeGreaterThan(
      Math.max(
        0,
        ...after.events
          .filter(
            (event) =>
              event.turnId === strikeEvent.turnId &&
              event.id !== strikeEvent.id,
          )
          .map((event) => event.importance),
      ),
    );
    expect(
      after.commands.some(
        (entry) =>
          entry.command.type === 'STRATEGIC_ATTACK' &&
          entry.command.abstraction ===
            'abstracted-effects-no-nuclear-weapons-model',
      ),
    ).toBe(true);
  });

  it('keeps an explicit no-war constraint binding while attempting annexation', () => {
    const world = fixture();
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: 'Annex Finland, but do not start a war.',
    });
    const execution = executePlayerAction(world, intent, 'annex-no-war');
    expect(execution.orders).toContain('Annex Finland');
    expect(execution.constraints).toContain('do not start a war.');
    expect(
      intent.majorIntentClauses.some(
        (clause) =>
          clause.kind === 'declaration-of-war' ||
          clause.kind === 'armed-conflict-initiation',
      ),
    ).toBe(false);
    expect(
      execution.commands.some(({ command }) => command.type === 'OPEN_CRISIS'),
    ).toBe(true);
    expect(
      execution.commands.some(
        ({ command }) => command.type === 'START_CONFLICT',
      ),
    ).toBe(false);
    expect(
      execution.commands.some(
        ({ command }) =>
          command.type === 'CRISIS_ACTION' && command.move === 'mobilize',
      ),
    ).toBe(false);
  });

  it('uses the existing offensive campaign command when a scenario disables theaters', async () => {
    const world = fixture();
    world.scenario.rules = {
      turnDays: 30,
      economicSeverity: 100,
      crisisSensitivity: 100,
      aiActivity: 'balanced',
      seed: 'player-intent-no-theaters',
      enabledMechanics: ['crises', 'economic-networks', 'elections'],
    };
    const result = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Sweden nukes Finland and sends in its armed forces to take the country',
      },
      runId: 'sweden-finland-no-theaters',
    });
    const playerCommands = result.trace.playerExecution!.commands.map(
      (entry) => entry.command,
    );
    expect(
      playerCommands.some((command) => command.type === 'THEATER_ACTION'),
    ).toBe(false);
    expect(
      playerCommands.some(
        (command) =>
          command.type === 'CONFLICT_ACTION' && command.stance === 'offensive',
      ),
    ).toBe(true);
    const { expectedHash: ignored, ...requestBody } = result.request;
    void ignored;
    const after = resolveTurn(world, requestBody, context(1));
    expect(
      after.conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          conflict.theaters.length === 0 &&
          conflict.campaigns.some(
            (campaign) => campaign.nationId === world.playerNationId,
          ),
      ),
    ).toBe(true);
    const attackEvent = after.events.find(
      (event) => event.type === 'STRATEGIC_ATTACK',
    );
    expect(attackEvent?.title).toMatch(/invasion offensive begins/i);
  });

  it('offers surrender once in an active war without also ordering an offensive', () => {
    const world = fixture();
    const finland = NationId.parse('nation:fin');
    world.conflicts.push(
      Conflict.parse({
        id: 'conflict:agency-surrender',
        name: 'Sweden–Finland War',
        attackers: [world.playerNationId],
        defenders: [finland],
        status: 'active',
        escalation: 70,
      }),
    );
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: "Attempt to negotiate Finland's surrender.",
    });
    const execution = executePlayerAction(world, intent, 'agency-surrender');
    const peaceOffers = execution.commands.filter(
      ({ command }) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.kind === 'peace',
    );
    expect(execution.orders).toEqual([
      "Attempt to negotiate Finland's surrender.",
    ]);
    expect(peaceOffers).toHaveLength(1);
    expect(peaceOffers[0]?.command.type).toBe('OPEN_NEGOTIATION');
    if (peaceOffers[0]?.command.type === 'OPEN_NEGOTIATION') {
      expect(peaceOffers[0].command.negotiation.recipientNationId).toBe(
        finland,
      );
      expect(peaceOffers[0].command.negotiation.terms).toContain(
        'unconditional surrender',
      );
    }
    expect(
      execution.commands.some(
        ({ command }) => command.type === 'START_CONFLICT',
      ),
    ).toBe(false);
    expect(execution.implementation.join(' ')).toMatch(/offered to Finland/);
  });

  it('turns a return-occupied-territory peace order into a structured withdrawal term', () => {
    const world = fixture();
    const finland = NationId.parse('nation:fin');
    world.conflicts.push(
      Conflict.parse({
        id: 'conflict:agency-peace-return',
        name: 'Sweden–Finland War',
        attackers: [world.playerNationId],
        defenders: [finland],
        status: 'active',
        escalation: 60,
      }),
    );
    world.regions.find(
      (region) => region.id === 'region:ne-fin',
    )!.controllerNationId = world.playerNationId;
    const text =
      'Negotiate peace with Finland and withdraw from occupied Finland.';
    const execution = executePlayerAction(
      world,
      deterministicPlayerIntent(world, {
        actorNationId: world.playerNationId,
        text,
      }),
      'agency-peace-return',
    );
    const offer = execution.commands.find(
      ({ command }) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.kind === 'peace',
    );
    expect(offer?.command.type).toBe('OPEN_NEGOTIATION');
    if (offer?.command.type === 'OPEN_NEGOTIATION')
      expect(offer.command.negotiation.peaceTerms).toEqual([
        {
          kind: 'withdrawal',
          regionId: 'region:ne-fin',
          fromNationId: world.playerNationId,
          toNationId: finland,
        },
      ]);
  });

  it('counters an existing incoming peace offer with the player settlement terms', () => {
    const world = fixture();
    const finland = NationId.parse('nation:fin');
    world.conflicts.push(
      Conflict.parse({
        id: 'conflict:agency-peace-counter',
        name: 'Sweden–Finland War',
        attackers: [world.playerNationId],
        defenders: [finland],
        status: 'active',
        escalation: 60,
      }),
    );
    world.regions.find(
      (region) => region.id === 'region:ne-fin',
    )!.controllerNationId = world.playerNationId;
    world.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:finland-peace-offer',
        proposerNationId: finland,
        recipientNationId: world.playerNationId,
        kind: 'peace',
        conflictId: 'conflict:agency-peace-counter',
        topic: 'Peace proposal',
        terms: 'Sweden and Finland end hostilities',
        peaceTerms: [],
        createdDate: world.date,
        expiresDate: '2026-12-31',
      }),
    );

    const execution = executePlayerAction(
      world,
      deterministicPlayerIntent(world, {
        actorNationId: world.playerNationId,
        text: 'Seek peace with Finland and withdraw from occupied Finland.',
      }),
      'agency-peace-counter',
    );
    const counter = execution.commands.find(
      ({ command }) =>
        command.type === 'RESPOND_NEGOTIATION' && command.move === 'counter',
    );

    expect(counter?.command.type).toBe('RESPOND_NEGOTIATION');
    if (counter?.command.type === 'RESPOND_NEGOTIATION') {
      expect(counter.command.negotiationId).toBe(
        'negotiation:finland-peace-offer',
      );
      expect(counter.command.counterPeaceTerms).toEqual([
        {
          kind: 'withdrawal',
          regionId: 'region:ne-fin',
          fromNationId: world.playerNationId,
          toNationId: finland,
        },
      ]);
    }
    expect(
      execution.commands.some(
        ({ command }) => command.type === 'OPEN_NEGOTIATION',
      ),
    ).toBe(false);
  });

  it('reversing annexation withdraws its claim, goal and standing directive', () => {
    const world = fixture();
    const finland = NationId.parse('nation:fin');
    const region = world.regions.find((r) => r.ownerNationId === finland)!;
    region.claims.push(world.playerNationId);
    world.goals.push(
      Goal.parse({
        id: 'goal:player-agency-annex-finland',
        nationId: world.playerNationId,
        title: 'Annex Finland',
        priority: 90,
        status: 'active',
        evaluation: {
          kind: 'territory',
          regionId: region.id,
          mode: 'ownership',
        },
        targetNationIds: [finland],
        progress: 0,
        reason: 'Annex Finland as standing policy.',
        createdDate: world.date,
        updatedDate: world.date,
        kind: 'territorial',
        visibility: 'public',
        deadline: null,
      }),
    );
    const actor = world.nations.find((n) => n.id === world.playerNationId)!;
    actor.strategy.directives.push({
      id: 'directive:annex-finland',
      text: 'Annex Finland.',
      priority: 'high',
      visibility: 'public',
      status: 'active',
      createdDate: world.date,
    });
    const intent = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: 'Reverse our annexation policy.',
    });
    const execution = executePlayerAction(
      world,
      intent,
      'reverse-annexation-policy',
    );
    const after = resolveTurn(
      world,
      request(
        world,
        execution.commands.map((entry) => entry.command),
      ),
      context(world.revision + 1),
    );
    expect(after.regions.find((r) => r.id === region.id)?.claims).not.toContain(
      world.playerNationId,
    );
    expect(
      after.goals.find((g) => g.id === 'goal:player-agency-annex-finland')
        ?.status,
    ).toBe('abandoned');
    expect(
      after.nations
        .find((n) => n.id === world.playerNationId)
        ?.strategy.directives.find((d) => d.id === 'directive:annex-finland')
        ?.status,
    ).toBe('cancelled');
    expect(execution.implementation.join(' ')).toMatch(
      /Withdrew 1 matching territorial claim/,
    );
  });

  it('uses deterministic player intent if every formalizer response is malformed', async () => {
    class BrokenFormalizer extends FakeProvider {
      override async generateStructured(
        request: GenerationRequest,
      ): Promise<GenerationResult> {
        if (request.role === 'formalizer')
          return { value: {}, rawText: '{}', latencyMs: 1 };
        return super.generateStructured(request);
      }
    }
    const world = fixture();
    const result = await createOrchestrator(new BrokenFormalizer()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Invade Finland.',
      },
      runId: 'broken-formalizer-agency-regression',
    });
    expect(result.trace.playerExecution?.orders).toContain('Invade Finland.');
    expect(
      result.request.commands.some(
        (entry) => entry.command.type === 'START_CONFLICT',
      ),
    ).toBe(true);
    expect(result.trace.validatorResults.join(' ')).toContain(
      'provider-independent',
    );
  });
});
