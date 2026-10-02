import { expect, it } from 'vitest';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { assertWorld } from '@mandate/core';
import {
  context,
  fixture,
  commitRequest as request,
  root,
} from '../fixtures/world.js';

it('survives 250 deterministic turns with bounded stats, append-only history, and round-trip identity', () => {
  let revision = 0;
  const store = openWorldStore({
    filename: ':memory:',
    migrationsDirectory: root + 'packages/persistence/migrations',
    context: () => context(++revision),
  });
  try {
    let w = store.initialize(fixture());
    const initialStats = w.nations.map((n) => ({ id: n.id, stats: n.stats }));
    for (let i = 0; i < 250; i++) {
      const actor = w.nations[i % w.nations.length]!;
      const date = new Date(w.date);
      date.setUTCDate(date.getUTCDate() + 1);
      const delta = Math.floor(i / w.nations.length) % 2 === 0 ? 1 : -1;
      w = store.commit(
        request(w, [
          {
            type: 'ADJUST_NATION_STAT',
            nationId: actor.id,
            stat: 'economy',
            delta,
          },
          { type: 'ADVANCE_DATE', date: date.toISOString().slice(0, 10) },
        ]),
      );
      assertWorld(w);
    }
    expect(w.revision).toBe(250);
    expect(w.commands).toHaveLength(500);
    expect(w.events).toHaveLength(500);
    expect(
      w.nations.every(
        (n) =>
          Math.abs(
            n.stats.economy -
              initialStats.find((v) => v.id === n.id)!.stats.economy,
          ) <= 9,
      ),
    ).toBe(true);
    expect(
      new Set(
        w.commands
          .filter((c) => c.command.type === 'ADJUST_NATION_STAT')
          .map((c) =>
            c.command.type === 'ADJUST_NATION_STAT' ? c.command.nationId : '',
          ),
      ).size,
    ).toBe(w.nations.length);
    expect(
      canonicalHash(
        store.import(
          JSON.parse(JSON.stringify(store.export())),
          250,
          canonicalHash(w),
        ),
      ),
    ).toBe(canonicalHash(w));
  } finally {
    store.close();
  }
}, 60000);
