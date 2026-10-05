import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { ActionId, CommandId, TurnId, WorldState } from '@mandate/schemas';
import { resolveTurn, semanticEventSignature } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { deterministicPlayerIntent, executePlayerAction } from '@mandate/ai';

const orderOne =
  'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.';
const orderTwo =
  'Nicaragua deepens economic integration with CAEU members and also starts building infrastructure connecting the countries.';
const orderThree =
  'Nicaragua proposes further political collaboration between central american countries to have a larger impact on the world stage. Nicaragua wishes to create a unified central american front.';

function campaignWorld() {
  const world = WorldState.parse(
    loadScenario(resolve('data/scenarios/global-regional.json')),
  );
  world.playerNationId = world.nations.find(
    (nation) => nation.name === 'Nicaragua',
  )!.id;
  return world;
}

function commit(
  world: WorldState,
  text: string,
  commands: Array<{ command: unknown; reason: string }>,
  source: 'player' | 'system' = 'player',
  actorNationId = world.playerNationId,
) {
  const sequence = world.revision + 1;
  const slug = `caeu-campaign-${sequence}`;
  return resolveTurn(
    world,
    {
      expectedRevision: world.revision,
      action: {
        actorNationId,
        source,
        text,
      },
      commands: commands.map((entry, index) => ({
        id: CommandId.parse(`command:${slug}-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse(`turn:${slug}`),
      actionId: ActionId.parse(`action:${slug}`),
      recordedAt: '2026-10-04T00:00:00.000Z',
    },
  );
}

function playerOrder(world: WorldState, text: string) {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text,
  });
  const execution = executePlayerAction(
    world,
    intent,
    `caeu-${world.revision + 1}`,
  );
  return {
    intent,
    execution,
    world: commit(
      world,
      text,
      execution.commands,
      'player',
      world.playerNationId,
    ),
  };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

describe('organization development campaign', () => {
  it('attributes a foreign member response independently during a player turn', () => {
    const base = campaignWorld();
    const created = playerOrder(base, orderOne).world;
    const organization = created.organizations.find(
      (entry) => entry.acronym === 'CAEU',
    )!;
    const belize = organization.invitations.find(
      (entry) =>
        created.nations.find((nation) => nation.id === entry.nationId)?.name ===
        'Belize',
    )!;
    const afterResponse = commit(
      created,
      'Nicaragua reviews the regional invitation responses.',
      [
        {
          command: {
            type: 'RESPOND_ORGANIZATION_INVITATION',
            organizationId: organization.id,
            nationId: belize.nationId,
            move: 'accept',
            message: 'The government independently accepts membership.',
          },
          reason: 'Belize independently accepts CAEU membership',
        },
      ],
      'player',
      base.playerNationId,
    );
    const response = afterResponse.events.find(
      (event) => event.type === 'RESPOND_ORGANIZATION_INVITATION',
    );

    expect(response?.provenance?.kind).toBe('independent-action');
    expect(response?.provenance?.triggeringActionId).toBe(
      afterResponse.turns.at(-1)?.actionId,
    );
  });

  it('turns the exact Nicaragua orders into programs and an evolving 24-month CAEU history', () => {
    let world = campaignWorld();
    const nicaragua = world.playerNationId;

    const first = playerOrder(world, orderOne);
    world = first.world;
    expect(first.execution.commands.map((entry) => entry.command.type)).toEqual(
      expect.arrayContaining([
        'CREATE_ORGANIZATION',
        'INVITE_TO_ORGANIZATION',
        'ADD_ORGANIZATION_COMMITMENT',
      ]),
    );
    let organization = world.organizations.find(
      (entry) => entry.acronym === 'CAEU',
    )!;
    expect(organization.invitations).toHaveLength(6);

    const acceptances = organization.invitations.map((invitation) => ({
      command: {
        type: 'RESPOND_ORGANIZATION_INVITATION',
        organizationId: organization.id,
        nationId: invitation.nationId,
        move: 'accept',
        message: 'The government independently accepts membership.',
      },
      reason: `${invitation.nationId} accepts the invitation independently`,
    }));
    world = commit(
      world,
      'Independent Central American governments decide on CAEU invitations.',
      acceptances,
      'system',
      organization.invitations[0]!.nationId,
    );
    organization = world.organizations.find(
      (entry) => entry.acronym === 'CAEU',
    )!;
    expect(organization.members).toHaveLength(7);

    const second = playerOrder(world, orderTwo);
    world = second.world;
    expect(second.intent.actionGraph?.actions).toHaveLength(2);
    expect(
      second.intent.actionGraph?.actions.map((action) => action.action),
    ).toEqual(expect.arrayContaining(['organization-program']));
    expect(
      second.execution.commands.filter(
        (entry) => entry.command.type === 'START_ORGANIZATION_PROGRAM',
      ),
    ).toHaveLength(2);
    expect(
      second.execution.semanticAudit
        ?.filter((entry) => /integrat|infrastructure/i.test(entry.text))
        .every((entry) => entry.status === 'EXECUTED'),
    ).toBe(true);

    const third = playerOrder(world, orderThree);
    world = third.world;
    expect(
      third.execution.commands.some(
        (entry) =>
          entry.command.type === 'START_ORGANIZATION_PROGRAM' &&
          entry.command.program.dimension === 'political-coordination',
      ),
    ).toBe(true);
    expect(
      third.execution.semanticAudit?.some(
        (entry) =>
          /political collaboration|unified central american front/i.test(
            entry.text,
          ) && entry.status === 'EXECUTED',
      ),
    ).toBe(true);

    for (let month = 0; month < 24; month++) {
      const nextDate = addDays(world.date, 30);
      world = commit(
        world,
        `Advance one month to ${nextDate}.`,
        [
          {
            command: { type: 'ADVANCE_DATE', date: nextDate },
            reason: 'Advance the monthly simulation clock.',
          },
        ],
        'system',
        nicaragua,
      );
    }

    organization = world.organizations.find(
      (entry) => entry.acronym === 'CAEU',
    )!;
    const support = organization.commitments[0]!;
    expect(support.paymentsMade).toBe(24);
    expect(support.totalPaid).toBeGreaterThan(100);
    expect(support.nextPaymentDate).toBeTruthy();
    const firstPayment = world.events.find((event) =>
      event.title.includes('makes the first scheduled CAEU support payment'),
    );
    const originatingOrder = world.actions.find(
      (action) => action.text === orderOne,
    );
    const paymentTrigger = world.actions.find(
      (action) => action.id === firstPayment?.provenance?.triggeringActionId,
    );
    expect(firstPayment?.provenance).toMatchObject({
      kind: 'automatic-effect',
      originatingActionId: originatingOrder?.id,
    });
    expect(paymentTrigger).toMatchObject({ source: 'system' });
    expect(paymentTrigger?.text).toMatch(/^Advance one month/);
    expect(
      world.events.filter(
        (event) => event.type === 'ORGANIZATION_COMMITMENT_PAID',
      ),
    ).toHaveLength(0);
    expect(
      organization.history.filter((entry) => entry.kind === 'commitment-paid'),
    ).toHaveLength(0);
    expect(
      world.events.filter(
        (event) => event.type === 'ORGANIZATION_COMMITMENT_MILESTONE',
      ),
    ).toHaveLength(2);
    expect(organization.programs).toHaveLength(3);
    expect(
      organization.programs.every((program) => program.status === 'completed'),
    ).toBe(true);
    expect(
      world.events.filter(
        (event) =>
          event.type === 'ORGANIZATION_PROGRAM_MILESTONE' &&
          /enters operation in CAEU/.test(event.title),
      ),
    ).toHaveLength(3);
    expect(
      organization.programs.every((program) =>
        program.responses.every((response) => response.move !== 'pending'),
      ),
    ).toBe(true);
    expect(
      organization.programs.some(
        (program) =>
          program.dimension === 'regional-infrastructure' &&
          (program.progress > 0 || program.status === 'completed'),
      ),
    ).toBe(true);
    expect(
      organization.development.some(
        (entry) =>
          entry.dimension === 'economic-integration' && entry.level > 0,
      ),
    ).toBe(true);
    expect(
      organization.history.some(
        (entry) => entry.kind === 'development-milestone',
      ),
    ).toBe(true);
    expect(
      organization.programs
        .find((program) => program.dimension === 'political-coordination')!
        .responses.some((response) => response.move !== 'accept'),
    ).toBe(true);

    const automaticEvents = world.events.filter(
      (event) => event.provenance?.kind === 'automatic-effect',
    );
    const signatures = automaticEvents.map(semanticEventSignature);
    expect(new Set(signatures).size).toBe(signatures.length);
    const monthMetrics = world.turns
      .slice(-24)
      .map((turn) => turn.eventMetrics!);
    expect(
      monthMetrics.reduce((sum, entry) => sum + entry.candidateCount, 0),
    ).toBeGreaterThan(24);
    expect(
      world.events.filter((event) => event.novelty === 'maintenance'),
    ).toHaveLength(0);
    expect(
      world.events.filter((event) =>
        event.title.startsWith('Nicaragua updates strategic directives'),
      ),
    ).toHaveLength(0);
  }, 120_000);
});
