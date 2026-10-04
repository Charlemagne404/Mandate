import { ActionGrounding } from '@mandate/schemas';
import { installLocalModel } from './model-install.js';
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ProviderConfig,
  analyzeWorldBehavior,
  createProvider,
  createOrchestrator,
  discoverLocalProviders,
  profileProvider,
  profileKey,
} from '@mandate/ai';
import { loadScenario } from '@mandate/scenarios';
import {
  exportSave,
  WorldError,
  worldBriefing,
  strategicAnswer,
  advisorQuestions,
  compareWorlds,
  parseSave,
  assertWorld,
} from '@mandate/core';
import { canonicalHash } from '@mandate/persistence';
import type { WorldStore } from '@mandate/persistence';
import {
  StateHash,
  NegotiationId,
  CommandId,
  TreatyId,
  Strategy,
  NationId,
  SimulationDate,
  InitiativeId,
  Commitment,
  SaveId,
  ScenarioFile,
  ScenarioId,
  WorldCommand,
} from '@mandate/schemas';
import { openArchive } from './archive.js';

const expected = z.strictObject({
  expectedRevision: z.number().int().min(0),
  expectedHash: StateHash,
});
const playInput = expected.extend({
  text: z.string().trim().max(4000).default(''),
  grounding: ActionGrounding.optional(),
  days: z.number().int().min(1).max(365).default(7),
  quality: z.enum(['fast', 'balanced', 'deep']).default('balanced'),
});
export function createAlphaServices(
  store: WorldStore,
  options: { directory?: string; scenariosDirectory?: string } = {},
) {
  const archive = openArchive(options.directory);
  let config = ProviderConfig.parse(
    archive.getSetting('provider') ?? { kind: 'fake' },
  );
  let active: AbortController | null = null;
  let progress = {
    stage: 'ready',
    running: false,
    completed: 0,
    total: 0,
    error: '',
    actor: '',
    startedAt: '',
    warnings: [] as string[],
  };
  const unlocked = () => {
    if (active)
      throw new WorldError(
        'DOMAIN',
        'A world turn is in progress. Cancel it before editing or loading.',
      );
  };
  const check = (input: z.infer<typeof expected>) => {
    const world = store.load();
    if (
      world.revision !== input.expectedRevision ||
      canonicalHash(world) !== input.expectedHash
    )
      throw new WorldError(
        'STALE_REVISION',
        'World changed. Refresh before submitting.',
      );
    return world;
  };
  const response = () => {
    const world = store.load();
    return { world, hash: canonicalHash(world) };
  };
  const execute = async (
    text: string,
    days: number,
    quality: 'fast' | 'balanced' | 'deep',
    signal: AbortSignal,
    grounding?: z.infer<typeof ActionGrounding>,
  ) => {
    signal = AbortSignal.any([signal, AbortSignal.timeout(config.maxTurnMs)]);
    const before = store.load();
    if (before.observerMode && text)
      throw new WorldError(
        'DOMAIN',
        'Take control of a government before issuing a directive',
      );
    const provider = createProvider(config);
    if (config.kind !== 'fake') {
      const health = await provider.health(
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
      if (!health.ok)
        throw new WorldError(
          'DOMAIN',
          'AI is unavailable. Open World & settings → Models to reconnect, or retry after the model starts. Your saved world has not changed.',
        );
    }
    const orchestrator = createOrchestrator(provider, config);
    const prepared = await orchestrator.prepare({
      world: before,
      expectedHash: canonicalHash(before),
      action: {
        actorNationId: before.playerNationId,
        source: text ? 'player' : 'system',
        text: text || 'Advance the world without a player action',
        ...(grounding ? { grounding } : {}),
      },
      days,
      quality,
      signal,
      onProgress: (stage, actor) => {
        progress.stage = stage;
        progress.actor = actor ?? '';
      },
    });
    signal.throwIfAborted();
    progress.warnings = prepared.trace.failures;
    progress.stage = 'committing';
    archive.checkpoint(store, 'Before turn ' + (before.revision + 1), 'undo');
    const after = store.commit(prepared.request, prepared.trace);
    // No await between the final cancellation check and synchronous atomic commit.
    progress.stage = 'updating history';
    try {
      const narration = await orchestrator.narrate({
        before,
        after,
        trace: prepared.trace,
        signal,
      });
      archive.present(after.turns.at(-1)!.id, narration);
    } catch (error) {
      archive.present(after.turns.at(-1)!.id, {
        summary: after.events
          .filter((e) => e.turnId === after.turns.at(-1)!.id)
          .map((e) => e.title)
          .join('. '),
        fallback: true,
        error: error instanceof Error ? error.message : 'Narration unavailable',
      });
    }
    archive.checkpoint(store, 'Autosave ' + after.date, 'autosave');
    return after;
  };
  return {
    archive,
    cancel: () => active?.abort(new Error('Application is shutting down')),
    unlocked,
    response,
    register(app: FastifyInstance) {
      app.get('/api/play/status', () => progress);
      app.post('/api/play/cancel', () => {
        active?.abort(new Error('Cancelled by player before commit'));
        return { cancelling: Boolean(active) };
      });
      app.get('/api/settings', () => ({
        ...config,
        apiKey: undefined,
        hasApiKey: Boolean(config.apiKey),
      }));
      app.post('/api/settings', (request) => {
        unlocked();
        const incoming = ProviderConfig.parse(request.body);
        if (
          incoming.apiKey === undefined &&
          incoming.kind === config.kind &&
          incoming.baseUrl === config.baseUrl
        )
          incoming.apiKey = config.apiKey;
        createProvider(incoming); // Validate the endpoint boundary before persisting settings.
        config = incoming;
        archive.setSetting('provider', config);
        return {
          ...config,
          apiKey: undefined,
          hasApiKey: Boolean(config.apiKey),
        };
      });
      app.post('/api/provider/install', async (request) => {
        unlocked();
        const { model } = z
          .strictObject({ model: z.enum(['qwen2.5:3b', 'qwen3:4b-instruct']) })
          .parse(request.body);
        const controller = new AbortController();
        active = controller;
        progress = {
          stage: 'Downloading model',
          running: true,
          completed: 0,
          total: 1,
          error: '',
          actor: '',
          startedAt: new Date().toISOString(),
          warnings: [],
        };
        try {
          return await installLocalModel(
            model,
            AbortSignal.any([controller.signal, AbortSignal.timeout(1200000)]),
            (stage) => {
              progress.stage = stage;
            },
          );
        } finally {
          active = null;
          progress.running = false;
        }
      });
      app.get('/api/provider/profile', () => {
        const profile = archive.getSetting('capability-profile') as
          { key?: string } | undefined;
        return profile?.key === profileKey(config) ? profile : null;
      });
      app.post('/api/provider/profile', async () => {
        unlocked();
        const controller = new AbortController();
        active = controller;
        progress = {
          stage: 'Testing six Mandate decisions',
          running: true,
          completed: 0,
          total: 6,
          error: '',
          actor: '',
          startedAt: new Date().toISOString(),
          warnings: [],
        };
        try {
          const profile = await profileProvider(
            createProvider(config),
            config,
            AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(config.maxTurnMs),
            ]),
          );
          archive.setSetting('capability-profile', profile);
          return profile;
        } finally {
          active = null;
          progress.running = false;
          progress.stage = 'ready';
        }
      });
      app.get('/api/experience', () => {
        const w = store.load();
        return {
          onboarded: archive.getSetting('onboarded') === true,
          developerMode: archive.getSetting('developer-mode') === true,
          timelineName:
            archive.getSetting('timeline-name:' + w.saveId) ?? w.scenario.name,
          lastSavedAt: w.turns.at(-1)?.recordedAt ?? null,
        };
      });
      app.post('/api/experience', (request) => {
        const input = z
          .strictObject({
            onboarded: z.boolean().optional(),
            developerMode: z.boolean().optional(),
          })
          .parse(request.body);
        if (input.onboarded !== undefined)
          archive.setSetting('onboarded', input.onboarded);
        if (input.developerMode !== undefined)
          archive.setSetting('developer-mode', input.developerMode);
        return { ok: true };
      });
      app.post('/api/timelines/branch', (request) => {
        unlocked();
        const input = expected
          .extend({ name: z.string().trim().min(1).max(100) })
          .parse(request.body);
        check(input);
        const id = archive.checkpoint(store, input.name, 'branch');
        archive.restore(
          store,
          id,
          input.expectedRevision,
          input.expectedHash,
          true,
        );
        archive.setSetting('timeline-name:' + store.load().saveId, input.name);
        archive.checkpoint(store, input.name, 'branch');
        return response();
      });
      app.get('/api/scenarios/:filename/preview', (request) => {
        const { filename } = z
          .object({ filename: z.string().regex(/^[a-zA-Z0-9_-]+\.json$/) })
          .parse(request.params);
        if (!options.scenariosDirectory)
          throw new WorldError('DOMAIN', 'Scenarios unavailable');
        return loadScenario(join(options.scenariosDirectory, filename));
      });
      app.get('/api/provider/discovery', () => discoverLocalProviders());
      app.post('/api/provider/health', async () => {
        try {
          return await createProvider(config).health();
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : 'Provider unavailable',
          };
        }
      });
      app.post('/api/play', async (request) => {
        unlocked();
        const input = playInput.parse(request.body);
        check(input);
        const controller = new AbortController();
        active = controller;
        progress = {
          stage: 'interpreting',
          running: true,
          completed: 0,
          total: 1,
          error: '',
          actor: '',
          startedAt: new Date().toISOString(),
          warnings: [],
        };
        try {
          await execute(
            input.text,
            input.days,
            input.quality,
            controller.signal,
            input.grounding,
          );
          progress.completed = 1;
          return response();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Turn failed';
          progress.error = message;
          archive.failure({
            message,
            detail:
              error && typeof error === 'object' && 'trace' in error
                ? error.trace
                : null,
          });
          throw new WorldError('DOMAIN', message);
        } finally {
          active = null;
          progress.running = false;
          progress.stage = progress.error ? 'failed' : 'ready';
        }
      });
      app.post('/api/autoplay', async (request) => {
        unlocked();
        const input = expected
          .extend({
            turns: z.number().int().min(1).max(100),
            days: z.number().int().min(1).max(365).default(30),
            quality: z.enum(['fast', 'balanced', 'deep']).default('fast'),
          })
          .parse(request.body);
        const before = check(input);
        const controller = new AbortController();
        active = controller;
        progress = {
          stage: 'governments deliberating',
          running: true,
          completed: 0,
          total: input.turns,
          error: '',
          actor: '',
          startedAt: new Date().toISOString(),
          warnings: [],
        };
        const start = performance.now();
        try {
          for (let i = 0; i < input.turns; i++) {
            controller.signal.throwIfAborted();
            await execute('', input.days, input.quality, controller.signal);
            progress.completed++;
          }
        } catch (error) {
          progress.error =
            error instanceof Error ? error.message : 'Autoplay failed';
          archive.failure({
            autoplay: true,
            completed: progress.completed,
            error: progress.error,
          });
        } finally {
          active = null;
          progress.running = false;
          progress.stage = progress.error ? 'stopped' : 'ready';
        }
        const after = store.load();
        return {
          ...response(),
          statistics: {
            turns: progress.completed,
            elapsedMs: Math.round(performance.now() - start),
            events: after.events.length - before.events.length,
            treaties: after.treaties.length - before.treaties.length,
            conflicts: after.conflicts.length - before.conflicts.length,
            goals: after.goals.length - before.goals.length,
            negotiations:
              after.negotiations.length - before.negotiations.length,
            initiatives: after.initiatives.length - before.initiatives.length,
            behavior: analyzeWorldBehavior(before, after),
            error: progress.error,
          },
        };
      });
      app.post('/api/strategy', (request) => {
        unlocked();
        const input = expected
          .extend({
            text: z.string().trim().min(1).max(1000).optional(),
            cancelId: z.string().max(160).optional(),
            visibility: z.enum(['public', 'private']).default('private'),
            priority: z
              .enum(['critical', 'high', 'medium', 'low'])
              .default('medium'),
          })
          .parse(request.body);
        const w = check(input),
          owner = w.nations.find((n) => n.id === w.playerNationId)!;
        const strategy = structuredClone(owner.strategy);
        if (input.cancelId) {
          const d = strategy.directives.find(
            (d) => d.id === input.cancelId && d.status === 'active',
          );
          if (!d) throw new WorldError('DOMAIN', 'Unknown active directive');
          d.status = 'cancelled';
        } else if (input.text)
          strategy.directives.push({
            id: randomUUID(),
            text: input.text,
            priority: input.priority,
            visibility: input.visibility,
            status: 'active',
            createdDate: w.date,
          });
        else
          throw new WorldError(
            'DOMAIN',
            'A directive or cancellation is required',
          );
        Strategy.parse(strategy);
        archive.checkpoint(store, 'Before strategy update', 'undo');
        store.commit({
          expectedRevision: input.expectedRevision,
          expectedHash: input.expectedHash,
          action: {
            source: 'player',
            actorNationId: owner.id,
            text: input.text ?? 'Cancel strategic directive',
          },
          commands: [
            {
              id: CommandId.parse(`command:${randomUUID()}`),
              reason: 'Explicit persistent player strategic directive',
              command: { type: 'SET_STRATEGY', nationId: owner.id, strategy },
            },
          ],
        });
        return response();
      });
      app.get('/api/timelines', () => archive.list());
      app.post('/api/timelines/rename', (request) => {
        unlocked();
        const input = expected
          .extend({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(100),
          })
          .parse(request.body);
        archive.rename(input.id, input.name);
        return { ok: true };
      });
      app.post('/api/timelines/delete', (request) => {
        unlocked();
        const input = expected
          .extend({ id: z.string().uuid(), confirmed: z.literal(true) })
          .parse(request.body);
        archive.remove(input.id);
        return { ok: true };
      });
      app.post('/api/world-action', (request) => {
        unlocked();
        const input = expected
          .extend({ command: WorldCommand })
          .parse(request.body);
        const w = check(input),
          c = input.command;
        const actor =
          c.type === 'OPEN_CONFERENCE'
            ? c.conference.proposer
            : c.type === 'IMPOSE_SANCTION'
              ? c.sanction.issuer
              : c.type === 'CREATE_POLITY'
                ? c.parentNationId
                : [
                      'CRISIS_ACTION',
                      'RESPOND_CONFERENCE',
                      'LIFT_SANCTION',
                      'THEATER_ACTION',
                    ].includes(c.type) && 'nationId' in c
                  ? c.nationId
                  : null;
        if (actor !== w.playerNationId || w.observerMode)
          throw new WorldError(
            'DOMAIN',
            'Action requires explicit control of the initiating government',
          );
        archive.checkpoint(store, 'Before strategic action', 'undo');
        store.commit({
          expectedRevision: input.expectedRevision,
          expectedHash: input.expectedHash,
          action: {
            source: c.type === 'CREATE_POLITY' ? 'debug' : 'player',
            actorNationId: w.playerNationId,
            text:
              c.type === 'CREATE_POLITY'
                ? `Scenario editor creates ${c.polity.name}`
                : 'Government strategic action: ' + c.type,
          },
          commands: [
            {
              id: CommandId.parse(`command:${randomUUID()}`),
              reason:
                'Explicit player strategic decision; canonical domain constraints apply',
              command: c,
            },
          ],
        });
        return response();
      });
      app.get('/api/semantic-debug', () => {
        const w = store.load();
        const turn = w.turns.at(-1);
        const audit = turn ? store.loadAudit(turn.id) : null;
        return {
          audit,
          committedCommands: w.commands.filter((c) => c.turnId === turn?.id),
        };
      });
      app.get('/api/turn-report', () => {
        const w = store.load(),
          turn = w.turns.at(-1);
        const trace = turn
          ? (store.loadAudit(turn.id) as {
              plans?: { nationId: string; explanation: string }[];
              failures?: string[];
              moves?: {
                nationId: string;
                recipientNationId: string;
                message: string;
                move: string;
              }[];
              intent?: {
                actionGraph?: import('@mandate/schemas').SemanticGraph;
                majorIntentClauses?: {
                  id: string;
                  kind: string;
                  description: string;
                  sourceClauseIds: number[];
                  targetNationIds: string[];
                  targetRegionIds: string[];
                }[];
              } | null;
              playerExecution?: {
                semanticAudit?: import('@mandate/schemas').SemanticAudit[];
                orders: string[];
                desiredOutcomes: {
                  kind: string;
                  description: string;
                  targetNationIds: string[];
                  targetRegionIds: string[];
                }[];
                constraints: string[];
                implementation: string[];
                advisories: string[];
                warnings: string[];
                intentSatisfactionAudit: {
                  clauseId: string;
                  kind: string;
                  status: string;
                  evidence: string[];
                  explanation: string;
                }[];
              } | null;
            } | null)
          : null;
        return {
          playerDecision:
            trace?.plans?.find((p) => p.nationId === w.playerNationId)
              ?.explanation ?? null,
          backgroundFailures:
            trace?.failures?.filter((f) => f.startsWith('Background')).length ??
            0,
          responses:
            trace?.moves?.filter((m) =>
              [m.nationId, m.recipientNationId].includes(w.playerNationId),
            ) ?? [],
          playerExecution: trace?.playerExecution
            ? {
                understood:
                  trace.intent?.actionGraph?.actions.map((a) => {
                    const names = (ids: string[]) =>
                      ids
                        .map(
                          (id) =>
                            w.nations.find((n) => n.id === id)?.name ?? id,
                        )
                        .join(' + ');
                    const targets = names(a.targets);
                    const sources = names(a.sources);
                    const participants = names(a.participants);
                    const implementation =
                      a.action === 'acquire-forces'
                        ? `attempt to acquire ${a.assets.join(' / ') || 'forces'} from ${sources || 'an unresolved owner'}`
                        : a.action === 'annex'
                          ? `adopt annexation of ${targets} as an objective`
                          : a.action === 'request-participation'
                            ? `ask ${participants} to help against ${targets}`
                            : `${a.action.replaceAll('-', ' ')}${targets ? ` → ${targets}` : ''}${sources ? ` using forces owned by ${sources}` : ''}`;
                    return `${a.clauseId + 1}. ${names([a.actor])}: ${implementation}${a.instruments.some((i) => i.startsWith('result:')) ? '; requires forces requested by an earlier action' : ''}${a.conditions.length ? `; only when ${a.conditions.map((c) => `${c.negated ? 'not ' : ''}${c.text}`).join(' and ')}` : ''}`;
                  }) ?? [],
                semanticAudit: trace.playerExecution.semanticAudit ?? [],
                orders: trace.playerExecution.orders,
                desiredOutcomes: trace.playerExecution.desiredOutcomes,
                constraints: trace.playerExecution.constraints,
                implementation: trace.playerExecution.implementation,
                advisories: trace.playerExecution.advisories,
                warnings: trace.playerExecution.warnings,
                majorIntentClauses: trace.intent?.majorIntentClauses ?? [],
                intentSatisfactionAudit:
                  trace.playerExecution.intentSatisfactionAudit ?? [],
              }
            : null,
        };
      });
      app.get('/api/briefing', () => {
        const w = store.load();
        return worldBriefing(w, w.playerNationId);
      });
      app.get('/api/advisor/:question', (request) => {
        const { question } = z
          .object({ question: z.enum(advisorQuestions) })
          .parse(request.params);
        const w = store.load();
        return strategicAnswer(w, w.playerNationId, question);
      });
      app.post('/api/timelines/compare', (request) => {
        const input = z
          .strictObject({ a: z.string().max(160), b: z.string().max(160) })
          .parse(request.body);
        const a = parseSave(archive.snapshot(input.a)),
          b = parseSave(archive.snapshot(input.b));
        return {
          a: { date: a.date, revision: a.revision },
          b: { date: b.date, revision: b.revision },
          differences: compareWorlds(a, b, store.load().playerNationId),
        };
      });
      app.post('/api/diplomacy/propose', (request) => {
        unlocked();
        const input = expected
          .extend({
            recipientNationId: NationId,
            message: z.string().trim().min(1).max(4000),
            minimumInvestment: z.number().int().min(1).max(1000).optional(),
            dueDate: SimulationDate.optional(),
            visibility: z.enum(['public', 'private']).default('public'),
          })
          .parse(request.body);
        const w = check(input),
          id = NegotiationId.parse(`negotiation:${randomUUID()}`);
        const expiresDate =
          input.dueDate ??
          new Date(Date.parse(`${w.date}T00:00:00Z`) + 180 * 86400000)
            .toISOString()
            .slice(0, 10);
        const kind =
          /\b(defen[cs]e|military|security|guarantee|alliance|armed forces|basing)\b/i.test(
            input.message,
          )
            ? 'defense'
            : /\b(trade|tariff|market access|energy supply|economic)\b/i.test(
                  input.message,
                )
              ? 'trade'
              : /\b(non.?aggression|neutrality|mutual restraint)\b/i.test(
                    input.message,
                  )
                ? 'nonaggression'
                : 'consultation';
        archive.checkpoint(store, 'Before structured aid proposal', 'undo');
        store.commit({
          expectedRevision: input.expectedRevision,
          expectedHash: input.expectedHash,
          action: {
            source: 'player',
            actorNationId: w.playerNationId,
            text: input.message,
          },
          commands: [
            {
              id: CommandId.parse(`command:${randomUUID()}`),
              reason: input.minimumInvestment
                ? 'Player proposes a funded aid pledge; recipient consent remains pending'
                : 'Player sends written terms to the selected government; recipient consent remains pending',
              command: {
                type: 'OPEN_NEGOTIATION',
                negotiation: {
                  id,
                  proposerNationId: w.playerNationId,
                  recipientNationId: input.recipientNationId,
                  topic: input.minimumInvestment
                    ? 'Funded aid pledge'
                    : 'Direct diplomatic proposal',
                  kind,
                  terms: input.message,
                  visibility: input.visibility,
                  conflictId: null,
                  createdDate: w.date,
                  expiresDate,
                  obligations: input.minimumInvestment
                    ? [
                        {
                          issuer: w.playerNationId,
                          recipients: [input.recipientNationId],
                          type: 'aid',
                          terms: input.message,
                          strength: 'binding',
                          dueDate: expiresDate,
                          expiry: null,
                          condition: {
                            kind: 'project',
                            initiativeKind: 'aid',
                            minimumInvestment: input.minimumInvestment,
                          },
                        },
                      ]
                    : [],
                  status: 'open',
                  responses: [],
                  treatyId: null,
                },
              },
            },
          ],
        });
        return response();
      });
      app.post('/api/commitments/fund', (request) => {
        unlocked();
        const input = expected
          .extend({ commitmentId: Commitment.shape.id })
          .parse(request.body);
        const w = check(input),
          c = w.commitments.find((c) => c.id === input.commitmentId);
        if (
          !c ||
          c.issuer !== w.playerNationId ||
          c.status !== 'active' ||
          c.condition.kind !== 'project'
        )
          throw new WorldError(
            'DOMAIN',
            'Only your active funded obligation can start a delivery project',
          );
        const effort = Math.min(
          10,
          Math.ceil(c.condition.minimumInvestment / 3),
        );
        archive.checkpoint(store, 'Before funding obligation', 'undo');
        store.commit({
          expectedRevision: input.expectedRevision,
          expectedHash: input.expectedHash,
          action: {
            source: 'player',
            actorNationId: w.playerNationId,
            text: 'Fund obligation delivery: ' + c.terms,
          },
          commands: [
            {
              id: CommandId.parse(`command:${randomUUID()}`),
              reason:
                'Player allocates an ongoing funded project to accepted obligation delivery',
              command: {
                type: 'START_INITIATIVE',
                initiative: {
                  id: InitiativeId.parse(`initiative:${randomUUID()}`),
                  nationId: c.issuer,
                  name: 'Obligation delivery',
                  kind: c.condition.initiativeKind,
                  startDate: w.date,
                  durationDays: Math.min(
                    3650,
                    Math.max(
                      30,
                      30 * Math.ceil(c.condition.minimumInvestment / effort),
                    ),
                  ),
                  effort,
                  targetNationId: c.type === 'aid' ? c.recipients[0]! : null,
                  visibility: c.visibility,
                  status: 'active',
                  progress: 0,
                  invested: 0,
                  dependencies: [],
                },
              },
            },
          ],
        });
        return response();
      });
      app.post('/api/diplomacy/respond', (request) => {
        unlocked();
        const input = expected
          .extend({
            negotiationId: NegotiationId,
            move: z.enum(['accept', 'reject', 'counter', 'delay', 'withdraw']),
            message: z.string().trim().min(1).max(4000),
            counterTerms: z.string().trim().min(1).max(4000).optional(),
          })
          .parse(request.body);
        const before = check(input);
        const negotiation = before.negotiations.find(
          (n) => n.id === input.negotiationId,
        );
        if (!negotiation)
          throw new WorldError('DOMAIN', 'Unknown diplomatic offer');
        const command = {
          type: 'RESPOND_NEGOTIATION' as const,
          negotiationId: input.negotiationId,
          nationId: before.playerNationId,
          move: input.move,
          message: input.message,
          ...(input.counterTerms ? { counterTerms: input.counterTerms } : {}),
          ...(input.move === 'accept' && negotiation.kind !== 'consultation'
            ? { treatyId: TreatyId.parse(`treaty:${randomUUID()}`) }
            : {}),
        };
        archive.checkpoint(store, 'Before diplomatic response', 'undo');
        store.commit({
          expectedRevision: input.expectedRevision,
          expectedHash: input.expectedHash,
          action: {
            source: 'player',
            actorNationId: before.playerNationId,
            text: `Diplomatic ${input.move}: ${input.message}`,
          },
          commands: [
            {
              id: CommandId.parse(`command:${randomUUID()}`),
              reason:
                'Explicit response from the player-controlled government; domain authorization and consent rules apply.',
              command,
            },
          ],
        });
        return response();
      });
      app.post('/api/timelines', (request) => {
        unlocked();
        const input = expected
          .extend({ name: z.string().trim().min(1).max(100) })
          .parse(request.body);
        check(input);
        return { id: archive.checkpoint(store, input.name) };
      });
      app.post('/api/timelines/restore', (request) => {
        unlocked();
        const input = expected
          .extend({ id: z.string().uuid(), branch: z.boolean().default(false) })
          .parse(request.body);
        check(input);
        archive.checkpoint(store, 'Before loading timeline', 'named');
        archive.restore(
          store,
          input.id,
          input.expectedRevision,
          input.expectedHash,
          input.branch,
        );
        return response();
      });
      app.post('/api/rollback', (request) => {
        unlocked();
        const input = expected.parse(request.body);
        const world = check(input);
        const target = archive
          .list()
          .find(
            (row) =>
              row.kind === 'undo' &&
              row.saveId === world.saveId &&
              row.revision === world.revision - 1,
          );
        if (!target)
          throw new WorldError(
            'DOMAIN',
            'No previous-turn checkpoint exists for this timeline.',
          );
        archive.checkpoint(store, 'Before rollback', 'named');
        archive.restore(
          store,
          String(target.id),
          input.expectedRevision,
          input.expectedHash,
        );
        return response();
      });
      app.get('/api/scenarios', () =>
        options.scenariosDirectory
          ? readdirSync(options.scenariosDirectory)
              .filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name))
              .map((filename) => {
                const world = loadScenario(
                  join(options.scenariosDirectory!, filename),
                );
                const activeCrisis = world.crises.find(
                  (crisis) => crisis.status !== 'resolved',
                );
                const activeConflict = world.conflicts.find(
                  (conflict) => conflict.status === 'active',
                );
                const recommendations =
                  filename === 'nordic-strategy.json' ||
                  filename === 'northern-sandbox.json' ||
                  filename === 'global-regional.json'
                    ? ['nation:swe', 'nation:fin', 'nation:nor']
                    : ['nation:usa', 'nation:chn', 'nation:ind'];
                return {
                  filename,
                  ...world.scenario,
                  nations: world.nations.length,
                  regions: world.regions.length,
                  tags: [
                    world.nations.length > 100
                      ? 'World theater'
                      : 'Focused theater',
                    world.regions.length > 1000
                      ? 'Regional map'
                      : 'Country map',
                    world.scenario.synthetic
                      ? 'Fictional politics'
                      : 'Historic start',
                  ],
                  recommendedCountries: recommendations
                    .map(
                      (id) =>
                        world.nations.find((nation) => nation.id === id)?.name,
                    )
                    .filter((name): name is string => Boolean(name)),
                  majorSituation:
                    activeCrisis?.title ??
                    (activeConflict
                      ? `${activeConflict.name}: ${activeConflict.attackers.map((id) => world.nations.find((nation) => nation.id === id)?.name ?? id).join(', ')} and ${activeConflict.defenders.map((id) => world.nations.find((nation) => nation.id === id)?.name ?? id).join(', ')} are at war.`
                      : 'No major crisis is underway. Set the course of history yourself.'),
                };
              })
          : [],
      );
      app.post('/api/scenarios/save', (request) => {
        unlocked();
        const input = expected
          .extend({
            filename: z
              .string()
              .regex(/^custom-[a-z0-9][a-z0-9_-]{0,54}\.json$/),
            sourceFilename: z
              .string()
              .regex(/^[a-zA-Z0-9_-]+\.json$/)
              .optional(),
            name: z.string().trim().min(1).max(160),
            description: z.string().trim().min(1).max(4000),
          })
          .parse(request.body);
        const current = check(input);
        if (!options.scenariosDirectory)
          throw new WorldError('DOMAIN', 'Scenario directory is unavailable');
        if (!input.sourceFilename && !existsSync(options.scenariosDirectory))
          throw new WorldError('DOMAIN', 'Scenario directory is unavailable');
        const target = join(options.scenariosDirectory, input.filename);
        if (existsSync(target))
          throw new WorldError(
            'DOMAIN',
            'A scenario with this name already exists',
          );
        const source = input.sourceFilename
          ? loadScenario(join(options.scenariosDirectory, input.sourceFilename))
          : current;
        const slug = input.filename.slice('custom-'.length, -'.json'.length);
        const world = structuredClone(source);
        world.saveId = SaveId.parse(`save:scenario-${slug}`);
        world.ancestry = null;
        world.scenario = {
          ...world.scenario,
          id: ScenarioId.parse(`scenario:custom-${slug}`),
          name: input.name,
          description: input.description,
          ...(!input.sourceFilename ? { startDate: world.date } : {}),
        };
        const scenario = ScenarioFile.parse({
          formatVersion: 3,
          kind: 'scenario',
          world,
        });
        assertWorld(scenario.world);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, JSON.stringify(scenario, null, 2) + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
        renameSync(temporary, target);
        return { filename: input.filename, name: input.name };
      });
      app.post('/api/scenarios/load', (request) => {
        unlocked();
        const input = expected
          .extend({
            filename: z.string().regex(/^[a-zA-Z0-9_-]+\.json$/),
            nationId: NationId.optional(),
            observer: z.boolean().default(false),
          })
          .parse(request.body);
        check(input);
        if (!options.scenariosDirectory)
          throw new WorldError('DOMAIN', 'Scenario directory is unavailable');
        const world = loadScenario(
          join(options.scenariosDirectory, input.filename),
        );
        if (input.nationId) {
          if (!world.nations.some((n) => n.id === input.nationId))
            throw new WorldError(
              'DOMAIN',
              'Choose a country from this scenario',
            );
          world.playerNationId = input.nationId;
        }
        world.observerMode = input.observer;
        archive.checkpoint(store, 'Before scenario change', 'named');
        store.import(
          exportSave(world),
          input.expectedRevision,
          input.expectedHash,
        );
        return response();
      });
      app.get('/api/explain/:turnId', (request) => {
        const { turnId } = z
          .object({ turnId: z.string().max(200) })
          .parse(request.params);
        return {
          audit: store.loadAudit(turnId),
          presentation: archive.presentation(turnId),
        };
      });
      app.get('/api/model-failures', () => archive.failures());
      app.addHook('onClose', () => {
        active?.abort();
        archive.close();
      });
    },
  };
}
export type AlphaServices = ReturnType<typeof createAlphaServices>;
