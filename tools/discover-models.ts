import { mkdirSync, writeFileSync } from 'node:fs';
import { inferenceOptions } from './inference-options.js';
const { report: discovery } = await inferenceOptions();
const report = {
  recordedAt: new Date().toISOString(),
  ...discovery,
};
mkdirSync('.runtime/evaluation', { recursive: true });
writeFileSync(
  '.runtime/evaluation/provider-discovery.json',
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
