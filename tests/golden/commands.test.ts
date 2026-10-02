import { describe, expect, it } from 'vitest';
import { assertWorld, canonicalStringify, resolveTurn } from '@mandate/core';
import {
  conflict,
  context,
  control,
  fixture,
  request,
  treaty,
} from '../fixtures/world.js';

describe('deterministic commands', () => {
  it('runs all command variants as replayable audited transitions', () => {
    const genesis = fixture();
    const inputs = [
      control,
      {
        type: 'TRANSFER_OWNERSHIP',
        regionId: 'region:ne-fin',
        nationId: 'nation:swe',
      },
      {
        type: 'ADJUST_RELATION',
        nationA: 'nation:swe',
        nationB: 'nation:fin',
        delta: 10,
      },
      {
        type: 'ADJUST_NATION_STAT',
        nationId: 'nation:swe',
        stat: 'economy',
        delta: 5,
      },
      { type: 'ADD_CLAIM', regionId: 'region:ne-fin', nationId: 'nation:rus' },
      {
        type: 'REMOVE_CLAIM',
        regionId: 'region:ne-fin',
        nationId: 'nation:rus',
      },
      treaty,
      {
        type: 'UPDATE_TREATY',
        treatyId: 'treaty:nordic',
        terms: 'Revised terms',
      },
      { type: 'END_TREATY', treatyId: 'treaty:nordic' },
      conflict,
      {
        type: 'UPDATE_CONFLICT',
        conflictId: 'conflict:crisis',
        escalation: 50,
      },
      { type: 'END_CONFLICT', conflictId: 'conflict:crisis' },
      {
        type: 'UPDATE_GOVERNMENT',
        nationId: 'nation:swe',
        government: { type: 'Coalition', ideology: 'Synthetic' },
      },
      {
        type: 'UPDATE_LEADER',
        nationId: 'nation:swe',
        leader: 'Development caretaker',
      },
      {
        type: 'CREATE_STRATEGIC_GOAL',
        goal: {
          id: 'goal:industry',
          nationId: 'nation:swe',
          title: 'Industrial program',
          priority: 80,
          status: 'active',
          targetNationIds: ['nation:fin'],
          progress: 0,
          reason: 'Modernization',
          createdDate: genesis.date,
          updatedDate: genesis.date,
        },
      },
      {
        type: 'UPDATE_STRATEGIC_GOAL',
        goalId: 'goal:industry',
        status: 'achieved',
        priority: 80,
        progress: 100,
      },
      {
        type: 'CREATE_EVENT',
        event: {
          id: 'event:note',
          type: 'DEVELOPMENT',
          title: 'Test observation',
          nationIds: ['nation:swe'],
          regionIds: ['region:ne-fin'],
          treatyIds: ['treaty:nordic'],
          conflictIds: ['conflict:crisis'],
          importance: 40,
          topics: ['fixture'],
          visibility: 'private',
          status: 'resolved',
        },
      },
      { type: 'SWITCH_NATION', nationId: 'nation:fin' },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ];
    const input = request(genesis, inputs);
    const after = resolveTurn(genesis, input, context(1));
    expect(canonicalStringify(resolveTurn(genesis, input, context(1)))).toBe(
      canonicalStringify(after),
    );
    expect(after.regions.find((r) => r.id === 'region:ne-fin')).toMatchObject({
      ownerNationId: 'nation:swe',
      controllerNationId: 'nation:rus',
      geometryId: 'region:ne-fin',
      claims: [],
    });
    expect(after.treaties[0]?.status).toBe('ended');
    expect(after.conflicts[0]?.status).toBe('ended');
    expect(after.goals.find((g) => g.id === 'goal:industry')?.status).toBe(
      'achieved',
    );
    expect(after.playerNationId).toBe('nation:fin');
    expect(after.date).toBe('2025-02-01');
    expect(after.commands).toHaveLength(inputs.length);
    expect(after.events).toHaveLength(inputs.length + 1);
    expect(after.events.filter((e) => e.type === 'GOAL_ACHIEVED')).toHaveLength(
      1,
    );
    expect(
      after.commands.every(
        (c) =>
          c.validation === 'accepted' && c.actionId === after.actions[0]?.id,
      ),
    ).toBe(true);
    expect(genesis.revision).toBe(0);
    expect(genesis.treaties).toEqual([]);
    assertWorld(after);
  });
  it('ownership does not imply control and control never rewrites geography', () => {
    const before = fixture();
    const ids = before.regions.map((r) => r.geometryId);
    const after = resolveTurn(before, request(before, [control]), context(1));
    expect(after.regions.map((r) => r.geometryId)).toEqual(ids);
    expect(
      after.regions.find((r) => r.id === 'region:ne-fin')?.ownerNationId,
    ).toBe('nation:fin');
  });
  it('an invalid later command leaves the entire input world unchanged', () => {
    const before = fixture();
    const original = canonicalStringify(before);
    expect(() =>
      resolveTurn(
        before,
        request(before, [
          control,
          {
            type: 'ADJUST_NATION_STAT',
            nationId: 'nation:swe',
            stat: 'military',
            delta: 100,
          },
        ]),
        context(1),
      ),
    ).toThrow();
    expect(canonicalStringify(before)).toBe(original);
  });
  it('rejects transient invalid states, even if later commands would conceal them', () => {
    const before = fixture();
    expect(() =>
      resolveTurn(
        before,
        request(before, [
          {
            ...treaty,
            treaty: { ...treaty.treaty, parties: ['nation:swe', 'nation:swe'] },
          },
          { type: 'END_TREATY', treatyId: 'treaty:nordic' },
        ]),
        context(1),
      ),
    ).toThrow();
    expect(() =>
      resolveTurn(
        before,
        request(before, [
          {
            type: 'ADJUST_NATION_STAT',
            nationId: 'nation:swe',
            stat: 'economy',
            delta: 100,
          },
          {
            type: 'ADJUST_NATION_STAT',
            nationId: 'nation:swe',
            stat: 'economy',
            delta: -100,
          },
        ]),
        context(1),
      ),
    ).toThrow();
  });
  it('canonicalizes unordered bilateral pairs and refuses duplicate live agreements', () => {
    const before = fixture();
    const after = resolveTurn(
      before,
      request(before, [
        {
          type: 'ADJUST_RELATION',
          nationA: 'nation:swe',
          nationB: 'nation:fin',
          delta: 5,
        },
      ]),
      context(1),
    );
    expect(
      after.relations.filter(
        (r) =>
          (r.nationA === 'nation:fin' || r.nationB === 'nation:fin') &&
          (r.nationA === 'nation:swe' || r.nationB === 'nation:swe'),
      ),
    ).toHaveLength(1);
    expect(() =>
      resolveTurn(
        before,
        request(before, [
          treaty,
          {
            ...treaty,
            treaty: {
              ...treaty.treaty,
              id: 'treaty:duplicate',
              parties: [...treaty.treaty.parties].reverse(),
            },
          },
        ]),
        context(1),
      ),
    ).toThrow();
    expect(() =>
      resolveTurn(
        before,
        request(before, [
          conflict,
          {
            ...conflict,
            conflict: {
              ...conflict.conflict,
              id: 'conflict:duplicate',
              attackers: conflict.conflict.defenders,
              defenders: conflict.conflict.attackers,
            },
          },
        ]),
        context(1),
      ),
    ).toThrow();
  });
});
