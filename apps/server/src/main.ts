import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import staticPlugin from '@fastify/static';
import { openWorldStore } from '@mandate/persistence';
import { geographyValidatorByVersion, loadScenario } from '@mandate/scenarios';
import { buildServer } from './app.js';
import { createAlphaServices } from './alpha.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const filename = resolve(
  root,
  process.env.MANDATE_DB ?? '.runtime/world.sqlite',
);
mkdirSync(dirname(filename), { recursive: true });
const geography = readFileSync(
  resolve(root, 'data/geography/world-global.geojson'),
  'utf8',
);
const geographyByVersion = {
  'natural-earth-50m-v1': geography,
  'natural-earth-110m-v1': readFileSync(
    resolve(root, 'data/geography/world.geojson'),
    'utf8',
  ),
  'natural-earth-admin1-v1': readFileSync(
    resolve(root, 'data/geography/world-admin1.geojson.gz'),
  ),
};
const geometrySets = Object.fromEntries(
  Object.entries(geographyByVersion).map(([version, data]) => [
    version,
    new Set<string>(
      (
        JSON.parse(
          Buffer.isBuffer(data) ? gunzipSync(data).toString('utf8') : data,
        ) as { features: { id: string }[] }
      ).features.map((f) => f.id),
    ),
  ]),
);
const store = openWorldStore({
  filename,
  migrationsDirectory: resolve(root, 'packages/persistence/migrations'),
  validateGeography: geographyValidatorByVersion(geometrySets),
});
try {
  store.initialize(
    loadScenario(
      resolve(
        root,
        'data/scenarios',
        process.env.MANDATE_SCENARIO ?? 'global-regional.json',
      ),
    ),
  );
} catch (error) {
  store.close();
  throw error;
}
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be an integer between 1024 and 65535');
const webPort = Number(process.env.MANDATE_WEB_PORT ?? 5173);
const services = createAlphaServices(store, {
  directory: process.env.MANDATE_DB
    ? resolve(dirname(filename), basename(filename) + '-services')
    : resolve(dirname(filename), 'services'),
  scenariosDirectory: resolve(root, 'data/scenarios'),
});
const app = buildServer({
  store,
  geography,
  geographyByVersion,
  geographicReference: readFileSync(
    resolve(root, 'data/geography/global-metadata.json'),
    'utf8',
  ),
  logger: true,
  services,
  allowedOrigins: [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${webPort}`,
    `http://localhost:${webPort}`,
  ],
});
const web = resolve(root, 'apps/web/dist');
if (existsSync(web)) await app.register(staticPlugin, { root: web });
app.addHook('onClose', () => store.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    services.cancel();
    void app.close();
  });
await app.listen({ host: '127.0.0.1', port });
