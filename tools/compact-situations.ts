import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario } from '@mandate/scenarios';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { Conflict, Sanction } from '@mandate/schemas';
import { buildServer } from '../apps/server/src/app.js';
import { createAlphaServices } from '../apps/server/src/alpha.js';

const model = process.argv[2] ?? 'qwen2.5:3b';
const output = resolve('.runtime/evaluation/compact-situations');
mkdirSync(output, { recursive: true });
for (const situation of ['exhausted-war', 'energy-coercion']) {
  const world = loadScenario('data/scenarios/nordic-strategy.json');
  world.observerMode = true;
  if (situation === 'exhausted-war') {
    world.conflicts.push(
      Conflict.parse({
        id: 'conflict:stress-war',
        name: 'Authored exhausted border war',
        status: 'active',
        attackers: ['nation:swe'],
        defenders: ['nation:fin'],
        exhaustion: 85,
        escalation: 30,
        logistics: 30,
        warGoals: ['Security'],
        campaigns: [],
      }),
    );
    for (const n of world.nations.filter((n) =>
      ['nation:swe', 'nation:fin'].includes(n.id),
    )) {
      n.stats.fiscal = 20;
      n.stats.unrest = 65;
    }
    const relationship = world.relations.find(
      (r) =>
        [r.nationA, r.nationB].includes('nation:swe' as typeof r.nationA) &&
        [r.nationA, r.nationB].includes('nation:fin' as typeof r.nationA),
    )!;
    relationship.score = -60;
    relationship.trust = 10;
    relationship.tension = 80;
  } else {
    world.sanctions.push(
      Sanction.parse({
        id: 'sanction:stress-energy',
        issuer: 'nation:rus',
        target: 'nation:swe',
        sector: 'energy',
        intensity: 90,
        startDate: world.date,
        reason: 'Authored coercion stress fixture',
      }),
    );
  }
  const directory = resolve(output, situation);
  mkdirSync(directory, { recursive: true });
  const store = openWorldStore({
    filename: ':memory:',
    migrationsDirectory: 'packages/persistence/migrations',
  });
  store.initialize(world);
  const services = createAlphaServices(store, {
    directory,
    scenariosDirectory: resolve('data/scenarios'),
  });
  const app = buildServer({
    store,
    services,
    geography: '{"type":"FeatureCollection","features":[]}',
  });
  await app.inject({
    method: 'POST',
    url: '/api/settings',
    payload: {
      kind: 'ollama',
      model,
      temperature: 0,
      retries: 0,
      timeoutMs: 45000,
      contextTokens: 4096,
      contextBudget: 18000,
      concurrency: 1,
      workflow: 'compact',
      maxCalls: 8,
      maxBackgroundPlanners: 1,
      maxRepairs: 1,
      maxTurnMs: 180000,
    },
  });
  const rows: object[] = [];
  try {
    for (let turn = 1; turn <= 5; turn++) {
      const before = store.load();
      const hash = canonicalHash(before);
      const started = performance.now();
      const result = await app.inject({
        method: 'POST',
        url: '/api/play',
        payload: {
          expectedRevision: before.revision,
          expectedHash: hash,
          text: '',
          days: 30,
          quality: 'balanced',
        },
      });
      const after = store.load();
      const committed = result.statusCode === 200;
      rows.push({
        turn,
        committed,
        seconds: (performance.now() - started) / 1000,
        beforeHash: hash,
        afterHash: canonicalHash(after),
        events: after.events
          .slice(before.events.length)
          .filter((e) => e.type !== 'ADVANCE_DATE')
          .map((e) => e.title),
        ...(committed
          ? { trace: store.loadAudit(after.turns.at(-1)!.id) }
          : { error: result.body }),
      });
      writeFileSync(
        resolve(directory, 'report.json'),
        JSON.stringify(
          {
            realModel: true,
            model,
            situation,
            methodology:
              'Authored stress genesis, not natural campaign emergence. Five ordinary compact observer gameplay turns; no debug commands or forced model choices.',
            rows,
            conflicts: after.conflicts,
            sanctions: after.sanctions,
            negotiations: after.negotiations,
            finalHash: canonicalHash(after),
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          situation,
          turn,
          committed,
          events: after.events.slice(before.events.length).map((e) => e.title),
        }),
      );
      if (!committed) {
        if (canonicalHash(after) !== hash)
          throw new Error('Failed turn changed canonical state');
        break;
      }
    }
    writeFileSync(
      resolve(directory, 'save.json'),
      JSON.stringify(store.export()),
    );
  } finally {
    await app.close();
    store.close();
  }
}
