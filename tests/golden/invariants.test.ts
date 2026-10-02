import { describe, expect, it } from 'vitest';
import { assertWorld, parseSave, resolveTurn } from '@mandate/core';
import { NationId, SimulationDate, WorldCommand } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import {
  conflict,
  context,
  control,
  fixture,
  request,
  treaty,
} from '../fixtures/world.js';

const ghost = NationId.parse('nation:ghost');
describe('world invariants and untrusted schemas', () => {
  const mutations: [string, (w: WorldState) => void][] = [
    [
      'missing owner',
      (w) => {
        w.regions[0]!.ownerNationId = ghost;
      },
    ],
    [
      'missing controller',
      (w) => {
        w.regions[0]!.controllerNationId = ghost;
      },
    ],
    [
      'missing player',
      (w) => {
        w.playerNationId = ghost;
      },
    ],
    [
      'missing claim',
      (w) => {
        w.regions[0]!.claims.push(ghost);
      },
    ],
    [
      'duplicate claims',
      (w) => {
        w.regions[0]!.claims.push(w.playerNationId, w.playerNationId);
      },
    ],
    [
      'duplicate nation',
      (w) => {
        w.nations.push(w.nations[0]!);
      },
    ],
    [
      'duplicate region',
      (w) => {
        w.regions.push(w.regions[0]!);
      },
    ],
    [
      'invalid bounded stat',
      (w) => {
        w.nations[0]!.stats.stability = 101;
      },
    ],
    [
      'NaN',
      (w) => {
        w.nations[0]!.stats.economy = NaN;
      },
    ],
    [
      'Infinity',
      (w) => {
        w.nations[0]!.stats.treasury = Infinity;
      },
    ],
    [
      'negative resources',
      (w) => {
        w.nations[0]!.stats.treasury = -1;
      },
    ],
    [
      'duplicate relations',
      (w) => {
        w.relations.push(w.relations[0]!);
      },
    ],
    [
      'self relations',
      (w) => {
        w.relations[0]!.nationB = w.relations[0]!.nationA;
      },
    ],
    [
      'unsorted relations',
      (w) => {
        const r = w.relations[0]!;
        [r.nationA, r.nationB] = [r.nationB, r.nationA];
      },
    ],
    [
      'unknown relation',
      (w) => {
        w.relations[0]!.nationA = ghost;
      },
    ],
    [
      'backward date',
      (w) => {
        w.date = '2024-12-01';
      },
    ],
    [
      'invalid calendar date',
      (w) => {
        w.date = '2025-02-30';
      },
    ],
    [
      'missing goal actor',
      (w) => {
        w.goals[0]!.nationId = ghost;
      },
    ],
    [
      'missing goal target',
      (w) => {
        w.goals[0]!.targetNationIds.push(ghost);
      },
    ],
    [
      'goal chronology',
      (w) => {
        w.goals[0]!.updatedDate = '2024-01-01';
      },
    ],
    [
      'self ancestry',
      (w) => {
        w.ancestry = { parentSaveId: w.saveId, parentRevision: 0 };
      },
    ],
    [
      'revision without turn',
      (w) => {
        w.revision = 1;
      },
    ],
  ];
  it.each(mutations)('rejects %s', (_, mutate) => {
    const w = fixture();
    mutate(w);
    expect(() => assertWorld(w)).toThrow();
  });
  const auditMutations: [string, (w: WorldState) => void][] = [
    [
      'missing action',
      (w) => {
        w.actions = [];
      },
    ],
    [
      'missing command',
      (w) => {
        w.commands = [];
      },
    ],
    [
      'missing event',
      (w) => {
        w.events = [];
      },
    ],
    [
      'missing turn',
      (w) => {
        w.turns = [];
      },
    ],
    [
      'wrong command date',
      (w) => {
        w.commands[0]!.simulationDate = '2025-01-02';
      },
    ],
    [
      'wrong event date',
      (w) => {
        w.events[0]!.date = '2025-01-02';
      },
    ],
    [
      'wrong timestamp',
      (w) => {
        w.commands[0]!.recordedAt = '2026-10-02T00:00:00.000Z';
      },
    ],
    [
      'duplicate turn command',
      (w) => {
        w.turns[0]!.commandIds.push(w.commands[0]!.id);
      },
    ],
    [
      'orphan event',
      (w) => {
        w.turns[0]!.eventIds = [];
      },
    ],
    [
      'nonconsecutive revision',
      (w) => {
        w.turns[0]!.revision = 2;
      },
    ],
    [
      'date without command',
      (w) => {
        w.turns[0]!.date = '2025-01-02';
        w.date = '2025-01-02';
      },
    ],
    [
      'missing treaty party',
      (w) => {
        w.treaties[0]!.parties.push(ghost);
      },
    ],
    [
      'self treaty',
      (w) => {
        w.treaties[0]!.parties = [w.playerNationId, w.playerNationId];
      },
    ],
    [
      'duplicate treaty',
      (w) => {
        w.treaties.push({
          ...w.treaties[0]!,
          id: 'treaty:duplicate' as WorldState['treaties'][number]['id'],
        });
      },
    ],
    [
      'empty conflict side',
      (w) => {
        w.conflicts[0]!.attackers = [];
      },
    ],
    [
      'overlapping conflict sides',
      (w) => {
        w.conflicts[0]!.attackers = w.conflicts[0]!.defenders;
      },
    ],
    [
      'unknown conflict party',
      (w) => {
        w.conflicts[0]!.attackers = [ghost];
      },
    ],
  ];
  it.each(auditMutations)(
    'rejects audit/domain corruption: %s',
    (_, mutate) => {
      const w = fixture();
      const after = resolveTurn(
        w,
        request(w, [control, treaty, conflict]),
        context(1),
      );
      mutate(after);
      expect(() => assertWorld(after)).toThrow();
    },
  );
  it('whitelists commands and rejects executable or extra fields', () => {
    expect(
      WorldCommand.safeParse({ type: 'EXECUTE_SQL', sql: 'DROP TABLE nations' })
        .success,
    ).toBe(false);
    expect(
      WorldCommand.safeParse({ ...control, sql: 'SELECT 1' }).success,
    ).toBe(false);
    expect(NationId.safeParse('__proto__').success).toBe(false);
    expect(SimulationDate.safeParse('2025-02-29').success).toBe(false);
    expect(SimulationDate.safeParse('2024-02-29').success).toBe(true);
    expect(() =>
      parseSave({ formatVersion: 999, kind: 'save', world: fixture() }),
    ).toThrow('version');
  });
  it.each([
    { ...control, nationId: 'nation:ghost' },
    {
      type: 'ADJUST_RELATION',
      nationA: 'nation:swe',
      nationB: 'nation:swe',
      delta: 1,
    },
    { type: 'ADVANCE_DATE', date: '2024-12-01' },
    { type: 'END_TREATY', treatyId: 'treaty:missing' },
    { type: 'REMOVE_CLAIM', regionId: 'region:ne-fin', nationId: 'nation:swe' },
  ])('rejects invalid domain command $type', (c) => {
    const w = fixture();
    expect(() => resolveTurn(w, request(w, [c]), context(1))).toThrow();
  });
  it('rejects stale revisions and reused command provenance', () => {
    const w = fixture();
    const input = request(w, [control]);
    const after = resolveTurn(w, input, context(1));
    expect(() => resolveTurn(after, input, context(2))).toThrow('Refresh');
    expect(() =>
      resolveTurn(after, { ...input, expectedRevision: 1 }, context(2)),
    ).toThrow('reused');
  });
});
