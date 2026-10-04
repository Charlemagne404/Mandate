import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { FakeProvider } from '@mandate/ai';
import { buildServer } from './app.js';
import { createAlphaServices } from './alpha.js';
import { fixture, root } from '../../../tests/fixtures/world.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0)) await fn();
});
function setup(
  persistent = false,
  scenariosDirectory = root + 'data/scenarios',
) {
  const directory = persistent
    ? mkdtempSync(join(tmpdir(), 'mandate-alpha-api-'))
    : undefined;
  const store = openWorldStore({
    filename: ':memory:',
    migrationsDirectory: root + 'packages/persistence/migrations',
  });
  store.initialize(fixture());
  const services = createAlphaServices(store, {
    ...(directory ? { directory } : {}),
    scenariosDirectory,
  });
  const app = buildServer({ store, geography: '{}', services });
  cleanup.push(async () => {
    await app.close();
    store.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  const post = async (url: string, body: object = {}) => {
    const world = store.load();
    return app.inject({
      method: 'POST',
      url,
      payload: {
        expectedRevision: world.revision,
        expectedHash: canonicalHash(world),
        ...body,
      },
    });
  };
  return { app, store, post, services };
}
describe('integrated alpha service', () => {
  it('multi-country quiet consultation persists without creating an alliance and evolves next turn', async () => {
    const { post, store } = setup();
    const response = await post('/api/play', {
      text: 'Begin a quiet diplomatic initiative with Finland and Norway aimed at closer defense cooperation. Do not propose a formal alliance yet. Increase military readiness without publicly announcing it.',
      days: 7,
    });
    expect(response.statusCode, response.body).toBe(200);
    const first = store.load();
    expect(first.negotiations).toHaveLength(2);
    expect(
      first.negotiations.every(
        (n) => n.kind === 'consultation' && n.visibility === 'private',
      ),
    ).toBe(true);
    expect(first.treaties).toHaveLength(0);
    expect(
      first.initiatives.some(
        (i) => i.nationId === 'nation:swe' && i.kind === 'rearmament',
      ),
    ).toBe(true);
    expect(store.loadAudit(first.turns[0]!.id)).toMatchObject({
      status: 'prepared',
    });
    const next = await post('/api/play', { text: '', days: 7 });
    expect(next.statusCode, next.body).toBe(200);
    expect(
      store.load().negotiations.every((n) => n.status === 'accepted'),
    ).toBe(true);
    expect(store.load().treaties).toHaveLength(0);
  });
  it('canonical agreement requires independently planned recipient acceptance', async () => {
    const { post, store } = setup();
    expect(
      (
        await post('/api/play', {
          text: 'Propose a reciprocal trade agreement with Finland.',
          days: 7,
        })
      ).statusCode,
    ).toBe(200);
    expect(store.load().treaties).toHaveLength(0);
    const reply = await post('/api/play', { text: '', days: 7 });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(store.load().treaties).toHaveLength(1);
    expect(store.load().negotiations[0]?.status).toBe('accepted');
  });
  it('player diplomatic responses enforce government authority and retain player provenance', async () => {
    const { post, store } = setup();
    await post('/api/play', {
      text: 'Propose a reciprocal trade agreement with Finland.',
      days: 7,
    });
    const offer = store.load().negotiations[0]!;
    const before = canonicalHash(store.load());
    const unauthorized = await post('/api/diplomacy/respond', {
      negotiationId: offer.id,
      move: 'accept',
      message: 'Accept our own offer',
    });
    expect(unauthorized.statusCode).toBe(422);
    expect(canonicalHash(store.load())).toBe(before);
    await post('/api/turns', {
      action: {
        source: 'debug',
        actorNationId: 'nation:swe',
        text: 'Switch for response test',
      },
      commands: [
        {
          id: 'command:response-switch',
          reason: 'Test controlling the recipient',
          command: { type: 'SWITCH_NATION', nationId: 'nation:fin' },
        },
      ],
    });
    expect(store.load().playerNationId).toBe('nation:fin');
    const accepted = await post('/api/diplomacy/respond', {
      negotiationId: offer.id,
      move: 'accept',
      message: 'We accept reciprocal trade.',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(store.load().negotiations[0]?.status).toBe('accepted');
    const after = store.load();
    const lastTurn = after.turns.find((t) => t.revision === after.revision)!;
    expect(after.actions.find((a) => a.id === lastTurn.actionId)).toMatchObject(
      {
        source: 'player',
        actorNationId: 'nation:fin',
      },
    );
    expect(store.load().treaties).toHaveLength(1);
  });
  it('local discovery lists installed choices without forwarding credentials or changing provider settings', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: {
        kind: 'fake',
        model: 'existing',
        apiKey: 'test-sensitive-key',
      },
    });
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ name: 'fixture-model' }] })),
    );
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await app.inject('/api/provider/discovery');
      expect(result.statusCode).toBe(200);
      expect(result.json()).toHaveLength(3);
      expect(result.body).not.toContain('test-sensitive-key');
      for (const args of fetch.mock.calls as unknown as Array<
        [string, RequestInit]
      >)
        expect(args[1].headers).not.toHaveProperty('Authorization');
      expect((await app.inject('/api/settings')).json()).toMatchObject({
        kind: 'fake',
        model: 'existing',
        hasApiKey: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('stale player requests and unreachable providers leave the save intact', async () => {
    const { post, store, app } = setup();
    const before = canonicalHash(store.load());
    const stale = await post('/api/play', {
      expectedHash: 'a'.repeat(64),
      text: 'Invest in industry',
    });
    expect(stale.statusCode).toBe(409);
    expect(canonicalHash(store.load())).toBe(before);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/settings',
          payload: {
            kind: 'ollama',
            model: 'not-installed',
            contextTokens: 8192,
            baseUrl: 'http://127.0.0.1:1',
            retries: 0,
            timeoutMs: 1000,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject('/api/settings')).json().contextTokens).toBe(8192);
    const failed = await post('/api/play', { text: 'Invest in industry' });
    expect(failed.statusCode).toBe(422);
    expect(canonicalHash(store.load())).toBe(before);
    expect((await app.inject('/api/model-failures')).json()).toHaveLength(1);
  });
  it('a bounded autoplay produces independent actions and projects that progress', async () => {
    const { post, store } = setup();
    const reply = await post('/api/autoplay', { turns: 10, days: 30 });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().statistics.turns).toBe(10);
    expect(store.load().actions.every((a) => a.source === 'system')).toBe(true);
    expect(
      store
        .load()
        .initiatives.some((i) => i.nationId !== store.load().playerNationId),
    ).toBe(true);
    expect(store.load().initiatives.some((i) => i.progress > 0)).toBe(true);
    expect((await post('/api/autoplay', { turns: 101 })).statusCode).toBe(400);
  });
  it('creates a replayable scenario copy from the current world without touching source scenarios', async () => {
    const scenariosDirectory = mkdtempSync(
      join(tmpdir(), 'mandate-scenario-library-'),
    );
    copyFileSync(
      join(root, 'data/scenarios/northern-sandbox.json'),
      join(scenariosDirectory, 'northern-sandbox.json'),
    );
    cleanup.push(async () =>
      rmSync(scenariosDirectory, { recursive: true, force: true }),
    );
    const { post, store } = setup(false, scenariosDirectory);
    const response = await post('/api/scenarios/save', {
      filename: 'custom-independent-lapland.json',
      name: 'Lapland Rising',
      description:
        'A new branch of history begins with an independent Lapland.',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      filename: 'custom-independent-lapland.json',
      name: 'Lapland Rising',
    });
    const saved = JSON.parse(
      readFileSync(
        join(scenariosDirectory, 'custom-independent-lapland.json'),
        'utf8',
      ),
    );
    expect(saved).toMatchObject({
      kind: 'scenario',
      world: {
        date: store.load().date,
        revision: store.load().revision,
        ancestry: null,
        scenario: {
          name: 'Lapland Rising',
          description:
            'A new branch of history begins with an independent Lapland.',
          startDate: store.load().date,
        },
      },
    });
    expect(
      (
        await post('/api/scenarios/save', {
          filename: 'custom-independent-lapland.json',
          name: 'Duplicate',
          description: 'This name is already in use.',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      readFileSync(join(scenariosDirectory, 'northern-sandbox.json'), 'utf8'),
    ).toContain('northern-sandbox');
  });
  it('named branches preserve canonical history and AI explanation, rollback restores real state', async () => {
    const { post, store } = setup(true);
    await post('/api/play', {
      text: 'Invest in domestic political reform',
      days: 30,
    });
    const original = store.load();
    const saved = await post('/api/timelines', { name: 'Before divergence' });
    const id = saved.json().id as string;
    await post('/api/play', {
      text: 'Build nuclear energy for five years',
      days: 30,
    });
    const rollback = await post('/api/rollback');
    expect(rollback.statusCode, rollback.body).toBe(200);
    expect(canonicalHash(store.load())).toBe(canonicalHash(original));
    const branch = await post('/api/timelines/restore', { id, branch: true });
    expect(branch.statusCode, branch.body).toBe(200);
    const fork = store.load();
    expect(fork.saveId).not.toBe(original.saveId);
    expect(fork.ancestry).toEqual({
      parentSaveId: original.saveId,
      parentRevision: 1,
    });
    expect(store.loadAudit(original.turns[0]!.id)).toMatchObject({
      status: 'prepared',
    });
    await post('/api/play', { text: 'Increase military readiness', days: 30 });
    const restored = await post('/api/timelines/restore', { id });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(canonicalHash(store.load())).toBe(canonicalHash(original));
  });
  it('cancellation before commit joins pending inference and blocks concurrent editors', async () => {
    const original = FakeProvider.prototype.generateStructured;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(FakeProvider.prototype, 'generateStructured').mockImplementation(
      async function (this: FakeProvider, request) {
        if (request.role === 'formalizer') {
          started();
          await new Promise<void>((_, reject) =>
            request.signal?.addEventListener(
              'abort',
              () => reject(request.signal?.reason),
              { once: true },
            ),
          );
        }
        return original.call(this, request);
      },
    );
    const { app, store, post } = setup();
    const before = canonicalHash(store.load());
    const pending = post('/api/play', { text: 'Invest in industry' });
    await entered;
    expect((await post('/api/rollback')).statusCode).toBe(422);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/play/cancel',
          payload: {},
        })
      ).json().cancelling,
    ).toBe(true);
    expect((await pending).statusCode).toBe(422);
    expect(canonicalHash(store.load())).toBe(before);
    expect((await app.inject('/api/play/status')).json().running).toBe(false);
  });
  it('scenario filenames reject traversal and versions/references remain validated', async () => {
    const { app, post, store } = setup();
    const hash = canonicalHash(store.load());
    expect(
      (await post('/api/scenarios/load', { filename: '../../secrets.json' }))
        .statusCode,
    ).toBe(400);
    expect(canonicalHash(store.load())).toBe(hash);
    expect(
      (await app.inject('/api/scenarios'))
        .json()
        .some((s: { filename: string }) => s.filename === 'global-alpha.json'),
    ).toBe(true);
    const reply = await post('/api/scenarios/load', {
      filename: 'global-alpha.json',
    });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(store.load().nations).toHaveLength(242);
  });
  it('same-origin desktop opt-in accepts only exact loopback origin and never foreign hosts', async () => {
    const { store } = setup();
    const app: FastifyInstance = buildServer({
      store,
      geography: '{}',
      allowedOrigins: [],
      allowSameOrigin: true,
    });
    cleanup.push(() => app.close());
    expect(
      (
        await app.inject({
          url: '/api/world',
          headers: {
            host: '127.0.0.1:49832',
            origin: 'http://127.0.0.1:49832',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/world',
          headers: {
            host: '127.0.0.1:49832',
            origin: 'http://127.0.0.1:49833',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/world',
          headers: { host: 'attacker.test', origin: 'http://attacker.test' },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('persistent player strategy', () => {
  it('creates, reloads and cancels canonical directives without model authority', async () => {
    const { post, store } = setup();
    const reply = await post('/api/strategy', { text: 'Maintain neutrality' });
    expect(reply.statusCode, reply.body).toBe(200);
    const directive = store.load().nations.find((n) => n.id === 'nation:swe')!
      .strategy.directives[0]!;
    expect(directive.status).toBe('active');
    expect(directive.visibility).toBe('private');
    expect(
      (await post('/api/strategy', { cancelId: directive.id })).statusCode,
    ).toBe(200);
    expect(
      store.load().nations.find((n) => n.id === 'nation:swe')!.strategy
        .directives[0]!.status,
    ).toBe('cancelled');
  });
  it('rejects unknown cancellation and preserves exact save', async () => {
    const { post, store } = setup();
    const hash = canonicalHash(store.load());
    expect(
      (await post('/api/strategy', { cancelId: 'missing' })).statusCode,
    ).toBe(422);
    expect(canonicalHash(store.load())).toBe(hash);
  });
});

describe('intentional aid pledge gameplay', () => {
  it('creates an obligation only after consent and funds actual delivery', async () => {
    const { post, store } = setup();
    const terms = 'Deliver a funded assistance project to Finland';
    expect(
      (
        await post('/api/diplomacy/propose', {
          recipientNationId: 'nation:fin',
          message: terms,
          minimumInvestment: 4,
          dueDate: '2025-07-01',
        })
      ).statusCode,
    ).toBe(200);
    expect(store.load().commitments).toEqual([]);
    const response = await post('/api/play', { text: '', days: 7 });
    expect(response.statusCode, response.body).toBe(200);
    const c = store.load().commitments[0]!;
    expect(c.status).toBe('active');
    expect(
      (await post('/api/commitments/fund', { commitmentId: c.id })).statusCode,
    ).toBe(200);
    const advance = await post('/api/play', {
      text: '',
      days: 90,
      quality: 'fast',
    });
    expect(advance.statusCode, advance.body).toBe(200);
    expect(store.load().commitments[0]!.status).toBe('fulfilled');
    expect(store.load().commitments[0]!.deliveries[0]!.investment).toBe(4);
  });
  it('refuses expired deadlines and unknown funding without changing state', async () => {
    const { post, store } = setup();
    const hash = canonicalHash(store.load());
    expect(
      (
        await post('/api/diplomacy/propose', {
          recipientNationId: 'nation:fin',
          message: 'Invalid past pledge',
          minimumInvestment: 4,
          dueDate: '2024-12-31',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/api/commitments/fund', {
          commitmentId: 'commitment:missing',
        })
      ).statusCode,
    ).toBe(422);
    expect(canonicalHash(store.load())).toBe(hash);
  });
});

describe('direct diplomatic proposals', () => {
  it('opens the player written terms immediately and waits for recipient consent', async () => {
    const { post, store } = setup();
    const terms =
      'Sweden will guarantee Finland’s independence if Finland permits Swedish aircraft to use its bases.';
    const response = await post('/api/diplomacy/propose', {
      recipientNationId: 'nation:fin',
      message: terms,
    });

    expect(response.statusCode, response.body).toBe(200);
    const world = store.load();
    expect(world.negotiations).toHaveLength(1);
    expect(world.negotiations[0]).toMatchObject({
      proposerNationId: 'nation:swe',
      recipientNationId: 'nation:fin',
      kind: 'defense',
      status: 'open',
      terms,
    });
    expect(world.negotiations[0]!.obligations).toEqual([]);
    expect(world.treaties).toEqual([]);
    expect(world.commitments).toEqual([]);
    const turn = world.turns.find(
      (entry) => entry.revision === world.revision,
    )!;
    expect(
      world.actions.find((action) => action.id === turn.actionId),
    ).toMatchObject({
      source: 'player',
      actorNationId: 'nation:swe',
      text: terms,
    });
  });
});
