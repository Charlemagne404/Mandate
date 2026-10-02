import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { loadScenario } from '@mandate/scenarios';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { buildContext } from '@mandate/memory';
import { resolveTurn } from '@mandate/core';
import {
  NationId,
  WorldCommand,
  Conference,
  Conflict,
  Initiative,
  Negotiation,
  WorldState,
} from '@mandate/schemas';
import {
  createProvider,
  DiplomaticMove,
  roleSystem,
  repetitionIssue,
} from '../packages/ai/src/index.js';
import { inferenceOptions } from './inference-options.js';
import { decisionInputs } from '../packages/ai/src/decision.js';

// A bounded real-inference pilot, deliberately separate from the full gameplay orchestrator.
// The model chooses a prevalidated canonical option; no prose is executed as a command.
const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('Real inference unavailable');
const config = {
  ...options.selected,
  temperature: 0,
  retries: 0,
  timeoutMs: 30000,
  contextTokens: 4096,
};
const provider = createProvider(config);
const actors = ['nation:swe', 'nation:fin', 'nation:rus'].map((id) =>
  NationId.parse(id),
);
const output = '.runtime/evaluation';
mkdirSync(output, { recursive: true });
const selectedRun = process.argv
  .find((a) => a.startsWith('--run='))
  ?.slice(6)
  .toUpperCase();
if (selectedRun && !['A', 'B', 'C', 'D', 'E'].includes(selectedRun))
  throw new Error('Invalid pilot');
const runs = ['A', 'B', 'C', 'D', 'E'].filter(
  (run) => !selectedRun || run === selectedRun,
);
const reportPath = `${output}/real-playtests${selectedRun ? '-' + selectedRun.toLowerCase() : ''}.json`;
const records: object[] = [];
const report = {
  realModel: true,
  provider: provider.id,
  model: config.model,
  configuration: { ...config, apiKey: undefined },
  promptVersion: 'mandate-bounded-playtest-v1',
  methodology:
    'Real provider decisions over a finite prevalidated action catalogue; seeded fictional situations, one scheduled actor per turn. This is not full-orchestrator or global-autonomy evidence.',
  records,
};
const checkpoint = () =>
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
import {
  pilotRequest as request,
  pilotContext as turnContext,
} from './pilot-request.js';
const later = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
function facts(w: WorldState, actor: NationId) {
  const c = buildContext(w, actor, actors, {
    recentLimit: 6,
    eventBudget: 1500,
  });
  return {
    date: w.date,
    own: c.canonical.nations.find((n) => n.id === actor),
    counterparts: c.canonical.nations
      .filter((n) => n.id !== actor)
      .map((n) => ({ id: n.id, name: n.name, stats: n.stats })),
    goals: c.canonical.goals.filter((g) => g.nationId === actor),
    relations: c.canonical.relations,
    conflicts: c.canonical.conflicts,
    crises: c.canonical.crises,
    conferences: c.canonical.conferences,
    economicLinks: c.canonical.economicLinks,
    sanctions: c.canonical.sanctions,
    commitments: c.canonical.commitments,
    recent: c.recentEvents.slice(-6),
  };
}
async function generate<T extends z.ZodType>(
  schema: T,
  payload: object,
  role: 'planner' | 'diplomat',
) {
  const r = await provider.generateStructured({
    role,
    model: config.model,
    system:
      roleSystem(role) +
      ' Choose only a supplied candidate when candidates are present. Use concise material factors; no hidden reasoning.',
    prompt: JSON.stringify(payload),
    jsonSchema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
    temperature: 0,
    maxTokens: 700,
  });
  return {
    parsed: schema.parse(r.value) as z.infer<T>,
    raw: r.rawText,
    latencyMs: r.latencyMs,
    usage: r.usage,
  };
}
function catalogue(w: WorldState, actor: NationId, run: string) {
  const candidates: Array<{
    id: string;
    label: string;
    commands: WorldCommand[];
  }> = [
    { id: 'observe', label: 'Observe and preserve resources', commands: [] },
  ];
  for (const kind of [
    'energy',
    'industry',
    'reform',
    'rearmament',
    'diplomacy',
  ] as const)
    candidates.push({
      id: `project-${kind}`,
      label: `Fund a ${kind} project over 180 days; consumes resources and execution capacity`,
      commands: [
        {
          type: 'START_INITIATIVE',
          initiative: Initiative.parse({
            id: `initiative:${run.toLowerCase()}-${w.revision}-${kind}`,
            nationId: actor,
            name: `Strategic ${kind} investment`,
            kind,
            startDate: w.date,
            durationDays: 180,
            effort: 3,
          }),
        },
      ],
    });
  for (const c of w.crises.filter(
    (c) =>
      c.status !== 'resolved' &&
      c.status !== 'frozen' &&
      c.participants.includes(actor),
  ))
    for (const move of [
      'talk',
      'stand-down',
      'warn',
      'mobilize',
      'freeze',
    ] as const)
      candidates.push({
        id: `crisis-${move}`,
        label: `${move} in ${c.title}`,
        commands: [
          WorldCommand.parse({
            type: 'CRISIS_ACTION',
            crisisId: c.id,
            nationId: actor,
            move,
          }),
        ],
      });
  for (const c of w.conferences.filter(
    (c) =>
      c.status === 'open' &&
      c.parties.includes(actor) &&
      !c.responses.some(
        (r) =>
          r.round === c.round && r.nationId === actor && r.move === 'accept',
      ),
  ))
    for (const move of ['accept', 'reject', 'delay', 'counter'] as const)
      candidates.push({
        id: `conference-${move}`,
        label: `${move} current round of ${c.title}`,
        commands: [
          WorldCommand.parse({
            type: 'RESPOND_CONFERENCE',
            conferenceId: c.id,
            nationId: actor,
            move,
            message: `Government chooses ${move} based on supplied interests`,
            ...(move === 'counter'
              ? {
                  counterTerms:
                    'Voluntary reciprocal information exchange; no basing, binding defense or territorial concessions',
                }
              : {}),
          }),
        ],
      });
  for (const f of w.conflicts.filter(
    (f) =>
      f.status === 'active' && [...f.attackers, ...f.defenders].includes(actor),
  )) {
    for (const stance of ['defend', 'reinforce', 'deescalate'] as const)
      candidates.push({
        id: `war-${stance}`,
        label: `${stance} in exhausted war; inspect fiscal and domestic costs`,
        commands: [
          {
            type: 'CONFLICT_ACTION',
            conflictId: f.id,
            nationId: actor,
            stance,
          },
        ],
      });
    if (
      !w.conferences.some((c) => c.status === 'open' && c.conflictId === f.id)
    )
      candidates.push({
        id: 'peace-conference',
        label:
          'Seek a status quo peace conference with belligerents and mediator; requires independent consent',
        commands: [
          {
            type: 'OPEN_CONFERENCE',
            conference: Conference.parse({
              id: `conference:${run.toLowerCase()}-${w.revision}-peace`,
              title: 'Exhausted-war settlement',
              proposer: actor,
              parties: actors,
              kind: 'peace',
              conflictId: f.id,
              terms: 'End the costly war without territorial transfers',
              createdDate: w.date,
              expiresDate: later(w.date, 180),
            }),
          },
        ],
      });
  }
  if (
    run === 'C' &&
    actor === actors[0] &&
    !w.conferences.some((c) => c.kind === 'trade' && c.status === 'open')
  )
    candidates.push({
      id: 'seek-trade',
      label:
        'Seek alternative trade partners through a reciprocal economic conference',
      commands: [
        {
          type: 'OPEN_CONFERENCE',
          conference: Conference.parse({
            id: `conference:${run.toLowerCase()}-${w.revision}-trade`,
            title: 'Alternative market access',
            proposer: actor,
            parties: actors,
            kind: 'trade',
            terms:
              'Reciprocal market access and alternative supply; no political alignment',
            createdDate: w.date,
            expiresDate: later(w.date, 180),
          }),
        },
      ],
    });
  return candidates.filter((c) => {
    try {
      if (c.commands.some((command) => repetitionIssue(w, command, null)))
        return false;
      const { expectedHash: _hash, ...trial } = request(
        w,
        actor,
        run,
        c.commands,
      );
      void _hash;
      resolveTurn(w, trial, turnContext(run, w.revision));
      return true;
    } catch {
      return false;
    }
  });
}
for (const run of runs) {
  let w = loadScenario('data/scenarios/nordic-strategy.json');
  if (run === 'E') w.observerMode = true;
  if (run === 'B')
    w.conflicts.push(
      Conflict.parse({
        id: 'conflict:pilot-exhausted',
        name: 'Prolonged fictional border war',
        attackers: [actors[0]],
        defenders: [actors[1]],
        status: 'active',
        escalation: 35,
        exhaustion: 85,
        logistics: 30,
        warGoals: ['Security'],
        campaigns: [],
      }),
    );
  if (run === 'D')
    w.conferences.push(
      Conference.parse({
        id: 'conference:pilot-security',
        title: 'Three-party limited security consultation',
        proposer: actors[0],
        parties: actors,
        kind: 'security',
        terms:
          'Voluntary reciprocal intelligence consultation; no permanent basing or binding defense guarantee',
        createdDate: w.date,
        expiresDate: later(w.date, 180),
      }),
    );
  const store = openWorldStore({
    filename: ':memory:',
    migrationsDirectory: 'packages/persistence/migrations',
  });
  try {
    w = store.initialize(WorldState.parse(w));
    if (run === 'C')
      w = store.commit(
        request(
          w,
          actors[2]!,
          run,
          [
            WorldCommand.parse({
              type: 'IMPOSE_SANCTION',
              sanction: {
                id: 'sanction:pilot-energy',
                issuer: actors[2],
                target: actors[0],
                sector: 'energy',
                intensity: 90,
                startDate: w.date,
                reason: 'Authored economic coercion pilot',
              },
            }),
          ],
          1,
        ),
      );
    const turns = run === 'A' ? 3 : run === 'E' ? 10 : run === 'D' ? 3 : 5;
    for (let turn = 0; turn < turns; turn++) {
      const actor =
        run === 'A' ? actors[1]! : run === 'C' ? actors[0]! : actors[turn % 3]!;
      const beforeHash = canonicalHash(w),
        beforeDate = w.date;
      let attempted: unknown;
      try {
        if (run === 'A') {
          const terms = [
            'Explore reciprocal intelligence consultation without basing or a defense guarantee',
            'Permit permanent Swedish military bases in Finland',
            'Offer time-limited voluntary security consultation with parliamentary review and no permanent bases',
          ][turn]!;
          const n = Negotiation.parse({
            id: `negotiation:pilot-a-${turn}`,
            proposerNationId: actors[0],
            recipientNationId: actor,
            topic: 'Finnish security cooperation',
            kind: 'consultation',
            terms,
            createdDate: w.date,
            expiresDate: later(w.date, 180),
          });
          w = store.commit(
            request(
              w,
              actors[0]!,
              run,
              [
                ...w.negotiations
                  .filter(
                    (old) =>
                      old.status === 'open' &&
                      [old.proposerNationId, old.recipientNationId].includes(
                        actors[0]!,
                      ) &&
                      [old.proposerNationId, old.recipientNationId].includes(
                        actor,
                      ),
                  )
                  .map((old) =>
                    WorldCommand.parse({
                      type: 'RESPOND_NEGOTIATION',
                      negotiationId: old.id,
                      nationId: actors[0],
                      move:
                        old.proposerNationId === actors[0]
                          ? 'withdraw'
                          : 'reject',
                      message:
                        'Replace the prior proposal with explicitly revised terms',
                    }),
                  ),
                { type: 'OPEN_NEGOTIATION', negotiation: n },
              ],
              1,
            ),
          );
          const intent = {
            version: 1 as const,
            actorNationId: actors[0]!,
            summary: terms,
            targetNationIds: [actor],
            targetRegionIds: [],
            visibility: 'public' as const,
            intentions: [
              {
                kind: 'diplomacy' as const,
                description: terms,
                sourceClauseIds: [0],
                visibility: 'public' as const,
                targetNationIds: [actor],
              },
            ],
          };
          const c = buildContext(w, actor, actors, {
            recentLimit: 6,
            eventBudget: 1500,
          });
          const result = await generate(
            DiplomaticMove,
            {
              context: facts(w, actor),
              intent,
              negotiationId: n.id,
              considerations: decisionInputs(c, intent),
            },
            'diplomat',
          );
          attempted = result;
          const m = result.parsed;
          if (
            m.nationId !== actor ||
            m.recipientNationId !== actors[0] ||
            m.negotiationId !== n.id ||
            m.visibility !== 'public' ||
            m.move === 'propose'
          )
            throw new Error(
              'Diplomat changed thread/participants or emitted unsolicited proposal',
            );
          const command = WorldCommand.parse({
            type: 'RESPOND_NEGOTIATION',
            negotiationId: n.id,
            nationId: actor,
            move: m.move,
            message: m.message,
            ...(m.move === 'counter'
              ? { counterTerms: m.terms, counterObligations: m.obligations }
              : {}),
          });
          w = store.commit(request(w, actor, run, [command]));
          records.push({
            run,
            turn,
            actor,
            terms,
            ...result,
            beforeHash,
            afterHash: canonicalHash(w),
            committed: true,
          });
        } else {
          const candidates = catalogue(w, actor, run);
          const schema = z.strictObject({
            candidateId: z.enum(
              candidates.map((c) => c.id) as [string, ...string[]],
            ),
            uncertainty: z.enum([
              'confident',
              'uncertain',
              'divided',
              'lacking-information',
            ]),
            factors: z.array(z.string().min(1).max(240)).min(1).max(4),
          });
          const supplied = facts(w, actor);
          const result = await generate(
            schema,
            {
              actorNationId: actor,
              world: supplied,
              candidates: candidates.map(({ id, label }) => ({ id, label })),
              task: 'Choose one action that advances national interests through time. Costs, prior choices, red lines and promises matter. Observe if no useful affordable action is available.',
            },
            'planner',
          );
          attempted = result;
          const chosen = candidates.find(
            (c) => c.id === result.parsed.candidateId,
          )!;
          w = store.commit(request(w, actor, run, chosen.commands));
          records.push({
            run,
            turn,
            actor,
            date: beforeDate,
            ...result,
            selected: chosen,
            beforeHash,
            afterHash: canonicalHash(w),
            committed: true,
          });
        }
      } catch (error) {
        records.push({
          run,
          turn,
          actor,
          date: beforeDate,
          generation: attempted,
          error: error instanceof Error ? error.message : String(error),
          beforeHash,
          afterHash: canonicalHash(w),
          committed: false,
        });
        // A failed inference makes no strategic mutation. Explicit observer time still advances atomically.
        w = store.commit(request(w, actor, run, []));
      }
      checkpoint();
      process.stderr.write(`Real pilot ${run}: ${turn + 1}/${turns}\n`);
    }
    writeFileSync(
      `${output}/real-playtest-${run.toLowerCase()}-save.json`,
      JSON.stringify(store.export()),
    );
    records.push({
      run,
      summary: {
        revision: w.revision,
        date: w.date,
        crises: w.crises.map((c) => ({
          id: c.id,
          status: c.status,
          severity: c.severity,
        })),
        conferences: w.conferences.map((c) => ({
          id: c.id,
          status: c.status,
          round: c.round,
          responses: c.responses,
        })),
        conflicts: w.conflicts.map((c) => ({
          id: c.id,
          status: c.status,
          exhaustion: c.exhaustion,
        })),
        projects: w.initiatives.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          progress: i.progress,
        })),
        sanctions: w.sanctions,
        economy: w.nations
          .filter((n) => actors.includes(n.id))
          .map((n) => ({
            id: n.id,
            economy: n.stats.economy,
            treasury: n.stats.treasury,
            energyExposure: n.stats.energyExposure,
          })),
        economicLinks: w.economicLinks,
      },
    });
    checkpoint();
  } finally {
    store.close();
  }
}
console.log(
  JSON.stringify(
    {
      provider: provider.id,
      model: config.model,
      completedPilots: runs.length,
      successfulChoices: records.filter(
        (r) => (r as { committed?: boolean }).committed === true,
      ).length,
      failedChoices: records.filter(
        (r) => (r as { committed?: boolean }).committed === false,
      ).length,
      report: reportPath,
    },
    null,
    2,
  ),
);
