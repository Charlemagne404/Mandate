import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { CommitRequest, StateHash } from '@mandate/schemas';
import { WorldError } from '@mandate/core';
import { canonicalHash } from '@mandate/persistence';
import type { WorldStore } from '@mandate/persistence';
import { createAlphaServices } from './alpha.js';
import type { AlphaServices } from './alpha.js';

export interface AppOptions {
  store: WorldStore;
  geography: string;
  geographicReference?: string;
  geographyByVersion?: Readonly<Record<string, string>>;
  logger?: boolean;
  allowedOrigins?: string[];
  services?: AlphaServices;
  allowSameOrigin?: boolean;
}
export function buildServer(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024 * 1024,
  });
  const origins = new Set(
    options.allowedOrigins ?? [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:3001',
      'http://localhost:3001',
    ],
  );
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
      await reply
        .code(403)
        .send({ error: 'Only localhost hosts are allowed.' });
      return;
    }
    if (
      request.headers.origin &&
      !origins.has(request.headers.origin) &&
      !(options.allowSameOrigin && request.headers.origin === `http://${host}`)
    ) {
      await reply.code(403).send({ error: 'Origin is not allowed.' });
      return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      await reply
        .code(403)
        .send({ error: 'Cross-site requests are not allowed.' });
      return;
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Schema validation failed',
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    if (error instanceof WorldError)
      return reply
        .code(error.code === 'STALE_REVISION' ? 409 : 422)
        .send({ error: error.message, code: error.code });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ error: error.message });
    request.log.error({ err: error }, 'Request failed');
    return reply
      .code(500)
      .send({ error: 'Internal failure. The operation was rolled back.' });
  });
  const response = () => {
    const world = options.store.load();
    return { world, hash: canonicalHash(world) };
  };
  const services = options.services ?? createAlphaServices(options.store);
  services.register(app);
  app.get('/api/health', () => ({
    status: 'ok',
    storage: 'sqlite',
    inference: 'disabled',
  }));
  app.get('/api/world', response);
  app.get('/api/geography', (_, reply) =>
    reply
      .type('application/geo+json')
      .send(
        options.geographyByVersion?.[
          options.store.load().scenario.geographyVersion
        ] ?? options.geography,
      ),
  );
  app.get('/api/geographic-reference', (_, reply) =>
    reply.type('application/json').send(options.geographicReference ?? '[]'),
  );
  app.post('/api/turns', (request) => {
    services.unlocked();
    const input = CommitRequest.parse(request.body);
    if (input.action.source !== 'debug')
      throw new WorldError(
        'DOMAIN',
        'Only explicit debug commands are supported in this milestone.',
      );
    services.archive.checkpoint(options.store, 'Before debug turn', 'undo');
    const world = options.store.commit(input);
    return { world, hash: canonicalHash(world) };
  });
  app.get('/api/export', (_, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="mandate-save.json"')
      .send(options.store.export()),
  );
  app.post('/api/import', (request) => {
    services.unlocked();
    const input = z
      .strictObject({
        expectedRevision: z.number().int().min(0),
        expectedHash: StateHash,
        save: z.unknown(),
      })
      .parse(request.body);
    services.archive.checkpoint(options.store, 'Before imported save');
    const world = options.store.import(
      input.save,
      input.expectedRevision,
      input.expectedHash,
    );
    return { world, hash: canonicalHash(world) };
  });
  return app;
}
