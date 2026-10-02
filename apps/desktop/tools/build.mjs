import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(directory, '../../packages/schemas/src/branding.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(directory, 'dist/branding.cjs'),
});
await build({
  entryPoints: [resolve(directory, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'fastify', '@fastify/static', 'zod'],
  outfile: resolve(directory, 'dist/main.cjs'),
  sourcemap: true,
});
await build({
  entryPoints: [resolve(directory, 'src/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: resolve(directory, 'dist/preload.cjs'),
});
writeFileSync(
  resolve(directory, 'dist/bootstrap.cjs'),
  `const { app, dialog } = require('electron');
const { branding } = require('./branding.cjs');
try { require('./main.cjs'); }
catch (error) {
  console.error(error && error.stack || error);
  if (process.env.MANDATE_DESKTOP_SMOKE) app.exit(1);
  else {
    dialog.showErrorBox(branding.name + ' could not start', String(error && error.message || error));
    app.quit();
  }
}
`,
);
