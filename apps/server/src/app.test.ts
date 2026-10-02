import { afterEach, describe, expect, it } from 'vitest';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { buildServer } from './app.js';
import {
  context,
  control,
  fixture,
  commitRequest as request,
  root,
} from '../../../tests/fixtures/world.js';
import type { FastifyInstance } from 'fastify';
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function setup() {
  let revision = 0;
  const store = openWorldStore({
    filename: ':memory:',
    migrationsDirectory: root + 'packages/persistence/migrations',
    context: () => context(++revision),
  });
  const world = store.initialize(fixture());
  const app = buildServer({
    store,
    geography: '{"type":"FeatureCollection","features":[]}',
  });
  app.addHook('onClose', () => store.close());
  apps.push(app);
  return { app, world, store };
}
describe('localhost API', () => {
  it('health, committed world, provenance, and readable export', async () => {
    const { app, world } = setup();
    expect(
      (await app.inject({ method: 'GET', url: '/api/health' })).json(),
    ).toMatchObject({ status: 'ok', inference: 'disabled' });
    const before = await app.inject('/api/world');
    expect(before.headers['cache-control']).toBe('no-store');
    const committed = await app.inject({
      method: 'POST',
      url: '/api/turns',
      payload: request(world, [control]),
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().world.revision).toBe(1);
    const save = (await app.inject('/api/export')).json();
    expect(save.kind).toBe('save');
    expect(save.world.events[0].sourceCommandIds[0]).toBe(
      save.world.commands[0].id,
    );
  });
  it('rejects hostile hosts/origins, unknown commands, and malformed imports', async () => {
    const { app, world, store } = setup();
    const hash = canonicalHash(world);
    expect(
      (
        await app.inject({
          url: '/api/world',
          headers: { host: 'attacker.example:3001' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/turns',
          headers: { origin: 'https://attacker.example' },
          payload: request(world, [control]),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/world',
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(403);
    const input = request(world, [control]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/turns',
          payload: {
            ...input,
            commands: [
              {
                ...input.commands[0],
                command: { type: 'EXECUTE_SQL', sql: 'DROP TABLE nations' },
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/import',
          payload: {
            expectedRevision: 0,
            expectedHash: hash,
            save: { formatVersion: 99 },
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(canonicalHash(store.load())).toBe(hash);
  });
  it('returns 409 on a stale writer and rejects bounds without partial state', async () => {
    const { app, world } = setup();
    const input = request(world, [control]);
    expect(
      (await app.inject({ method: 'POST', url: '/api/turns', payload: input }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/turns', payload: input }))
        .statusCode,
    ).toBe(409);
    const current = (await app.inject('/api/world')).json().world;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/turns',
          payload: request(current, [
            {
              type: 'ADJUST_NATION_STAT',
              nationId: 'nation:swe',
              stat: 'military',
              delta: 100,
            },
          ]),
        })
      ).statusCode,
    ).toBe(422);
    expect((await app.inject('/api/world')).json().world.revision).toBe(1);
  });
});
