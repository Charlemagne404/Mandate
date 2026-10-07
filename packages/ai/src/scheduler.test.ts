import { describe, expect, it } from 'vitest';
import { buildInfluenceStrategyPlan } from '@mandate/core';
import { NationId } from '@mandate/schemas';
import { loadScenario } from '@mandate/scenarios';
import { resolve } from 'node:path';
import { compactCandidates } from './compact.js';
import { scheduleActors, selectRelevance } from './scheduler.js';

describe('autonomous actor scheduling', () => {
  it('revisits due persistent sphere strategies instead of starving them in a large world', () => {
    const world = loadScenario(resolve('data/scenarios/global-regional.json'));
    const nicaragua = NationId.parse(
      world.nations.find((nation) => nation.name === 'Nicaragua')!.id,
    );
    const honduras = NationId.parse(
      world.nations.find((nation) => nation.name === 'Honduras')!.id,
    );
    const plan = buildInfluenceStrategyPlan(
      world,
      nicaragua,
      honduras,
      'SUBJECT STATE',
    );
    plan.reviewedDate = new Date(Date.parse(world.date) - 200 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    world.nations.find(
      (nation) => nation.id === nicaragua,
    )!.strategy.influencePlans = [plan];

    const scheduled = scheduleActors(world, selectRelevance(world, null), 1);
    const patron = scheduled.find((entry) => entry.nationId === nicaragua);
    expect(patron?.reasons).toContain(
      'Due review of a persistent influence strategy',
    );
    expect(patron?.background).toBe(false);
  });

  it('activates a capable border rival when a player-led sphere creates a local influence opportunity', () => {
    const world = loadScenario(resolve('data/scenarios/global-regional.json'));
    const nicaragua = NationId.parse(
      world.nations.find((nation) => nation.name === 'Nicaragua')!.id,
    );
    const guatemala = NationId.parse(
      world.nations.find((nation) => nation.name === 'Guatemala')!.id,
    );
    const mexico = NationId.parse(
      world.nations.find((nation) => nation.name === 'Mexico')!.id,
    );
    world.playerNationId = nicaragua;
    const plan = buildInfluenceStrategyPlan(
      world,
      nicaragua,
      guatemala,
      'SUBJECT STATE',
    );
    world.nations.find(
      (nation) => nation.id === nicaragua,
    )!.strategy.influencePlans = [plan];

    const scheduled = scheduleActors(world, selectRelevance(world, null), 1);
    const rival = scheduled.find((entry) => entry.nationId === mexico);
    expect(rival?.reasons).toContain('Strategic counter-influence opportunity');
    expect(rival?.influenceOpportunityTargetIds).toContain(guatemala);
    expect(rival?.background).toBe(false);
  });

  it('offers a tailored economic package when the scheduled rival reviews that opportunity', () => {
    const world = loadScenario(resolve('data/scenarios/global-regional.json'));
    const guatemala = NationId.parse(
      world.nations.find((nation) => nation.name === 'Guatemala')!.id,
    );
    const mexico = NationId.parse(
      world.nations.find((nation) => nation.name === 'Mexico')!.id,
    );
    const candidate = compactCandidates(
      world,
      mexico,
      'mexico-counter-influence',
      null,
      [guatemala],
    ).find((entry) => entry.id.startsWith('sphere-step-gtm-'));
    expect(candidate?.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'SET_STRATEGY', nationId: mexico }),
        expect.objectContaining({ type: 'OPEN_NEGOTIATION' }),
      ]),
    );
    const offer = candidate?.commands.find(
      (command) => command.type === 'OPEN_NEGOTIATION',
    );
    expect(offer?.type).toBe('OPEN_NEGOTIATION');
    if (offer?.type !== 'OPEN_NEGOTIATION') return;
    expect(offer.negotiation.recipientNationId).toBe(guatemala);
    expect(offer.negotiation.influenceTerms.map((term) => term.kind)).toEqual(
      expect.arrayContaining([
        'infrastructure-investment',
        'preferential-trade',
      ]),
    );
  });
});
