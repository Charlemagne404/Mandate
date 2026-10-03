import { mkdirSync, writeFileSync } from 'node:fs';
import { createProvider, ProviderConfig } from '@mandate/ai';
import { profileProvider } from '../packages/ai/src/profile.js';
const model = process.argv[2] ?? 'qwen3:4b-instruct';
const config = ProviderConfig.parse({
  kind: 'ollama',
  model,
  contextTokens: 4096,
  contextBudget: 14000,
  retries: 0,
  timeoutMs: 45000,
  temperature: 0,
});
const result = await profileProvider(createProvider(config), config);
mkdirSync('.runtime/evaluation', { recursive: true });
const path = `.runtime/evaluation/profile-${model.replace(/[^a-z0-9]/gi, '-')}.json`;
writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      path,
      rating: result.rating,
      passed: result.passed,
      medianMs: result.medianMs,
      records: result.records,
    },
    null,
    2,
  ),
);
