import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import { NationId } from '@mandate/schemas';
import { ProviderConfig } from '../packages/ai/src/index.js';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { inferenceOptions } from './inference-options.js';

const model =
  process.argv.find((argument) => argument.startsWith('--model='))?.slice(8) ??
  'qwen3:4b-instruct';
const options = await inferenceOptions();
if (!options.selected || options.selected.kind !== 'ollama')
  throw new Error('A reachable local Ollama provider is required.');
const config = ProviderConfig.parse({
  ...options.selected,
  model,
  temperature: 0,
  retries: 0,
  timeoutMs: 120000,
  contextTokens: 4096,
  contextBudget: 18000,
  workflow: 'compact',
  concurrency: 1,
  maxCalls: 12,
  maxBackgroundPlanners: 1,
  maxTurnMs: 600000,
  maxRepairs: 1,
});
const timestamp = new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14);
const directory = resolve(`.runtime/evaluation/war-control-real-${timestamp}`);
mkdirSync(directory, { recursive: true });
const store = openWorldStore({
  filename: resolve(directory, 'world.sqlite'),
  migrationsDirectory: resolve('packages/persistence/migrations'),
});
const initial = loadScenario(resolve('data/scenarios/global-regional.json'));
const sweden = NationId.parse('nation:swe');
const norway = NationId.parse('nation:nor');
initial.playerNationId = sweden;
initial.observerMode = false;
const original = store.initialize(initial);
const services = createAlphaServices(store, {
  directory,
  scenariosDirectory: resolve('data/scenarios'),
});
const app = buildServer({
  store,
  services,
  geography: '{"type":"FeatureCollection","features":[]}',
});
const settings = await app.inject({
  method: 'POST',
  url: '/api/settings',
  payload: config,
});
if (settings.statusCode !== 200)
  throw new Error(`Could not configure model: ${settings.body}`);
const providerHealth = await app.inject({
  method: 'POST',
  url: '/api/provider/health',
});
if (!providerHealth.json<{ ok: boolean }>().ok)
  throw new Error(`Model health check failed: ${providerHealth.body}`);

type PlayRow = {
  date: string;
  directive: string;
  statusCode: number;
  latencyMs: number;
  events: Array<{ type: string; title: string; importance: number }>;
  controlChanges: Array<{
    region: string;
    owner: string;
    from: string;
    to: string;
  }>;
  commands: string[];
  modelCalls: Array<{
    status: string;
    latencyMs: number;
    contextCharacters: number;
    repairAttempt: number;
  }>;
  error?: string;
};
const rows: PlayRow[] = [];
const recordTurn = async (directive: string) => {
  const before = store.load();
  const started = performance.now();
  const response = await app.inject({
    method: 'POST',
    url: '/api/play',
    payload: {
      expectedRevision: before.revision,
      expectedHash: canonicalHash(before),
      text: directive,
      days: 30,
      quality: 'fast',
    },
  });
  const after = store.load();
  const turn = after.turns.at(-1);
  const audit =
    response.statusCode === 200 && turn
      ? (store.loadAudit(turn.id) as {
          modelCalls?: PlayRow['modelCalls'];
        } | null)
      : null;
  const oldRegions = new Map(
    before.regions.map((region) => [region.id, region]),
  );
  const controlChanges = after.regions.flatMap((region) => {
    const old = oldRegions.get(region.id);
    return old && old.controllerNationId !== region.controllerNationId
      ? [
          {
            region: region.name,
            owner: region.ownerNationId,
            from: old.controllerNationId,
            to: region.controllerNationId,
          },
        ]
      : [];
  });
  const row: PlayRow = {
    date: after.date,
    directive: directive || 'Advance one month',
    statusCode: response.statusCode,
    latencyMs: Math.round(performance.now() - started),
    events: after.events
      .slice(before.events.length)
      .filter((event) => event.type !== 'ADVANCE_DATE')
      .map(({ type, title, importance }) => ({ type, title, importance })),
    controlChanges,
    commands: after.commands
      .slice(before.commands.length)
      .map((command) => command.command.type),
    modelCalls: audit?.modelCalls ?? [],
    ...(response.statusCode !== 200 ? { error: response.body } : {}),
  };
  rows.push(row);
  const report = {
    realModel: true,
    method:
      'Real-model gameplay through Fastify POST /api/play with validated turn hashes.',
    scenario: 'global-regional',
    player: 'Sweden',
    opponent: 'Norway',
    model,
    configuration: { ...config, apiKey: undefined },
    initialDate: original.date,
    finalDate: after.date,
    monthlyTurns: rows.length,
    rows,
    wars: after.conflicts.filter(
      (conflict) =>
        [...conflict.attackers, ...conflict.defenders].includes(sweden) &&
        [...conflict.attackers, ...conflict.defenders].includes(norway),
    ),
    peaceAgreements: after.treaties.filter(
      (treaty) => treaty.kind === 'peace' && treaty.parties.includes(sweden),
    ),
    SwedishCosts: {
      treasuryDelta:
        after.nations.find((nation) => nation.id === sweden)!.stats.treasury -
        original.nations.find((nation) => nation.id === sweden)!.stats.treasury,
      readinessDelta:
        after.nations.find((nation) => nation.id === sweden)!.stats.readiness -
        original.nations.find((nation) => nation.id === sweden)!.stats
          .readiness,
      unrestDelta:
        after.nations.find((nation) => nation.id === sweden)!.stats.unrest -
        original.nations.find((nation) => nation.id === sweden)!.stats.unrest,
    },
    modelStatistics: {
      calls: rows.flatMap((row) => row.modelCalls).length,
      failures: rows
        .flatMap((row) => row.modelCalls)
        .filter((call) => call.status === 'failed').length,
      repairs: rows
        .flatMap((row) => row.modelCalls)
        .filter((call) => call.repairAttempt > 0).length,
      totalLatencyMs: rows
        .flatMap((row) => row.modelCalls)
        .reduce((sum, call) => sum + call.latencyMs, 0),
      maxContextCharacters: Math.max(
        0,
        ...rows.flatMap((row) =>
          row.modelCalls.map((call) => call.contextCharacters),
        ),
      ),
    },
    canonicalHash: canonicalHash(after),
  };
  writeFileSync(
    resolve(directory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  writeFileSync(
    resolve(directory, 'save.json'),
    JSON.stringify(store.export()),
  );
  process.stdout.write(
    JSON.stringify({
      date: row.date,
      directive: row.directive,
      statusCode: row.statusCode,
      seconds: Math.round(row.latencyMs / 1000),
      changes: row.controlChanges,
      events: row.events.map((event) => event.title),
      error: row.error,
    }) + '\n',
  );
  return row.statusCode === 200;
};

try {
  const plan = [
    'Invade Norway.',
    ...Array.from({ length: 6 }, () => ''),
    'Seek peace with Norway and withdraw Swedish forces from every Norwegian-owned region.',
  ];
  for (const directive of plan) {
    if (!(await recordTurn(directive))) break;
  }
  for (let responseTurn = 0; responseTurn < 2; responseTurn++) {
    const current = store.load();
    const norwegianCounter = current.negotiations.some(
      (negotiation) =>
        negotiation.status === 'open' &&
        negotiation.kind === 'peace' &&
        negotiation.conflictId ===
          current.conflicts.find(
            (conflict) =>
              conflict.status === 'active' &&
              conflict.attackers.includes(sweden) &&
              conflict.defenders.includes(norway),
          )?.id &&
        negotiation.proposerNationId === norway &&
        negotiation.recipientNationId === sweden,
    );
    const directive = norwegianCounter ? "Accept Norway's counteroffer." : '';
    if (!(await recordTurn(directive))) break;
  }
} finally {
  await app.close();
  store.close();
}
process.stdout.write(`Report: ${resolve(directory, 'report.json')}\n`);
