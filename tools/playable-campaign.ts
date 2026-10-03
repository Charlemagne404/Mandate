import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { analyzeWorldBehavior } from '@mandate/ai';
const model = process.argv[2] ?? 'qwen3:4b-instruct';
const count = Number(process.argv[3] ?? 20);
const directory = resolve('.runtime/evaluation/playable-campaign');
mkdirSync(directory, { recursive: true });
const store = openWorldStore({
  filename: resolve(directory, 'world.sqlite'),
  migrationsDirectory: resolve('packages/persistence/migrations'),
});
store.initialize(loadScenario(resolve('data/scenarios/nordic-strategy.json')));
const services = createAlphaServices(store, {
  directory,
  scenariosDirectory: resolve('data/scenarios'),
});
const app = buildServer({
  store,
  services,
  geography: '{"type":"FeatureCollection","features":[]}',
});
const settings = {
  kind: 'ollama',
  model,
  contextTokens: 4096,
  contextBudget: 18000,
  temperature: 0,
  retries: 0,
  timeoutMs: 45000,
  workflow: 'compact',
  concurrency: 1,
  maxCalls: 8,
  maxBackgroundPlanners: 1,
  maxTurnMs: 180000,
  maxRepairs: 1,
};
await app.inject({ method: 'POST', url: '/api/settings', payload: settings });
const actions = [
  'Over the next five years, reduce our dependence on Russian energy without publicly framing the policy as anti-Russian. Start an energy diversification program.',
  'Propose reciprocal emergency information sharing with Finland, with no permanent basing or binding alliance.',
  'Propose permanent Swedish air bases in Finland under exclusive Swedish command.',
  'Offer Finland a narrower compromise: reciprocal intelligence exchanges and temporary joint exercises, no permanent foreign basing.',
  'Seek a reciprocal trade agreement with Norway to improve energy resilience without political alignment.',
  '',
  'Increase military readiness quietly while preserving the existing energy program.',
  '',
  'Open regional security consultations with Denmark, without a binding defense commitment.',
  '',
  'Review our current priorities. Preserve resources and continue our funded policies.',
  '',
  'Seek reciprocal trade cooperation with Finland. Keep our independence and avoid exclusive supply obligations.',
  '',
  'Invest in domestic resilience and reduce unrest without starting military escalation.',
  '',
  'Propose voluntary crisis communication with Russia, without military alignment or concessions of sovereignty.',
  '',
  'Review the current energy program. Continue it if it is progressing; avoid duplicate spending.',
  '',
];
type Row = {
  turn: number;
  action: string;
  date: string;
  latencyMs: number;
  committed: boolean;
  model?: string;
  events: string[];
  calls: unknown[];
  failures: unknown;
  review: string;
  error?: string;
};
const path = resolve(directory, 'report.json');
const rows: Row[] = existsSync(path)
  ? (JSON.parse(readFileSync(path, 'utf8')) as { records: Row[] }).records
  : [];
const checkpoint = () =>
  writeFileSync(
    path,
    JSON.stringify(
      {
        realModel: true,
        methodology:
          'Normal gameplay service, natural-language directives and ordinary diplomatic responses. Nordic scenario genesis; no debug mutations or forced outcomes.',
        model,
        settings,
        country: 'Sweden',
        scenario: 'Nordic Crossroads',
        records: rows,
        behavior: analyzeWorldBehavior(
          loadScenario(resolve('data/scenarios/nordic-strategy.json')),
          store.load(),
        ),
        finalHash: canonicalHash(store.load()),
      },
      null,
      2,
    ) + '\n',
  );
for (let i = rows.filter((r) => r.committed).length; i < count; i++) {
  const before = store.load();
  const pending = before.negotiations.find(
    (n) =>
      n.status === 'open' &&
      n.recipientNationId === before.playerNationId &&
      n.responses.at(-1)?.move === 'counter',
  );
  if (pending) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/diplomacy/respond',
      payload: {
        expectedRevision: before.revision,
        expectedHash: canonicalHash(before),
        negotiationId: pending.id,
        move: before.treaties.some(
          (t) =>
            t.status === 'active' &&
            t.kind === pending.kind &&
            t.parties.length === 2 &&
            t.parties.includes(pending.proposerNationId) &&
            t.parties.includes(pending.recipientNationId),
        )
          ? 'reject'
          : 'accept',
        message: before.treaties.some(
          (t) =>
            t.status === 'active' &&
            t.kind === pending.kind &&
            t.parties.length === 2 &&
            t.parties.includes(pending.proposerNationId) &&
            t.parties.includes(pending.recipientNationId),
        )
          ? 'We cannot accept permanent basing.'
          : 'We accept these narrower reciprocal terms.',
      },
    });
    console.log(
      'Player response',
      response.statusCode,
      response.statusCode === 200 ? 'committed' : response.body,
    );
  }
  const current = store.load();
  const text =
    process.argv.find((a) => a.startsWith('--directive='))?.slice(12) ??
    actions[i % actions.length] ??
    '';
  const started = performance.now();
  const result = await app.inject({
    method: 'POST',
    url: '/api/play',
    payload: {
      expectedRevision: current.revision,
      expectedHash: canonicalHash(current),
      text,
      days: 30,
      quality: 'balanced',
    },
  });
  const after = store.load();
  const audit = (
    after.turns.at(-1) ? store.loadAudit(after.turns.at(-1)!.id) : null
  ) as {
    modelCalls?: unknown[];
    failures?: unknown;
    plans?: unknown[];
  } | null;
  const events = after.events
    .slice(current.events.length)
    .filter((e) => e.type !== 'ADVANCE_DATE')
    .map((e) => e.title);
  const row: Row = {
    turn: i + 1,
    action: text || 'Advance world',
    date: after.date,
    latencyMs: performance.now() - started,
    committed: result.statusCode === 200,
    model,
    events,
    calls:
      result.statusCode === 200
        ? (audit?.modelCalls ?? [])
        : ((
            services.archive.failures()[0]?.detail as
              { detail?: { modelCalls?: unknown[] } } | undefined
          )?.detail?.modelCalls ?? []),
    failures:
      result.statusCode === 200
        ? (audit?.failures ?? [])
        : [(result.json() as { message?: string }).message ?? result.body],
    review: events.length
      ? 'Review the distinct government decisions and their costs.'
      : 'Quiet turn: existing policies continue; check whether waiting has a purpose.',
    ...(result.statusCode !== 200 ? { error: result.body } : {}),
  };
  rows.push(row);
  checkpoint();
  console.log(
    JSON.stringify({
      turn: row.turn,
      date: row.date,
      committed: row.committed,
      seconds: Math.round(row.latencyMs / 1000),
      events,
      error: row.error,
    }),
  );
  if (!row.committed) {
    console.log('Stopping for diagnosis; continue after correcting the issue.');
    break;
  }
}
await app.close();
store.close();
