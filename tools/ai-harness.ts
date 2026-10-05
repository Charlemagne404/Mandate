import { performance } from 'node:perf_hooks';
import { assertWorld } from '@mandate/core';
import type { WorldState } from '@mandate/schemas';
import {
  createOrchestrator,
  analyzeWorldBehavior,
} from '../packages/ai/src/index.js';
import type {
  LlmProvider,
  ProviderConfig,
  TurnTrace,
} from '../packages/ai/src/index.js';

export interface AutoplayMetrics {
  turns: number;
  commands: number;
  events: number;
  autonomousEvents: number;
  warsStarted: number;
  warsEnded: number;
  treatiesCreated: number;
  peaceAgreements: number;
  organizationsCreated: number;
  crisesStarted: number;
  crisesResolved: number;
  sanctionsCreated: number;
  actionFamilyDistribution: Record<string, number>;
  diplomaticActions: number;
  territorialChanges: number;
  governmentChanges: number;
  initiativesStarted: number;
  goalsPreserved: number;
  modelCalls: number;
  modelFailures: number;
  repairs: number;
  invariantFailures: number;
  maxContextCharacters: number;
  totalModelLatencyMs: number;
  wallTimeMs: number;
  averageTurnMs: number;
  maxTurnMs: number;
  turnLatenciesMs: number[];
  activatedActors: number;
  maxPlanningGap: number;
  unresolvedNegotiations: number;
  saturatedRelations: number;
  repeatedEventTitles: number;
  serializedSaveBytes: number;
}
export async function runAutoplay(options: {
  world: WorldState;
  provider: LlmProvider;
  config?: ProviderConfig;
  turns: number;
  commit: (request: unknown, trace: TurnTrace) => WorldState;
  hash: (world: WorldState) => string;
  quality?: 'fast' | 'balanced' | 'deep';
  onProgress?: (turn: number) => void;
}) {
  if (
    !Number.isInteger(options.turns) ||
    options.turns < 1 ||
    options.turns > 1000
  )
    throw new Error('Autoplay supports 1–1000 turns');
  const initial = options.world;
  let world = initial;
  const orchestrator = createOrchestrator(
    options.provider,
    options.config ?? {},
  );
  const started = performance.now();
  const traces: TurnTrace[] = [];
  const planned = new Map<string, number>();
  let maxGap = 0;
  const metrics: AutoplayMetrics = {
    turns: 0,
    commands: 0,
    events: 0,
    autonomousEvents: 0,
    warsStarted: 0,
    warsEnded: 0,
    treatiesCreated: 0,
    peaceAgreements: 0,
    organizationsCreated: 0,
    crisesStarted: 0,
    crisesResolved: 0,
    sanctionsCreated: 0,
    actionFamilyDistribution: {},
    diplomaticActions: 0,
    territorialChanges: 0,
    governmentChanges: 0,
    initiativesStarted: 0,
    goalsPreserved: 0,
    modelCalls: 0,
    modelFailures: 0,
    repairs: 0,
    invariantFailures: 0,
    maxContextCharacters: 0,
    totalModelLatencyMs: 0,
    wallTimeMs: 0,
    averageTurnMs: 0,
    maxTurnMs: 0,
    turnLatenciesMs: [],
    activatedActors: 0,
    maxPlanningGap: 0,
    unresolvedNegotiations: 0,
    saturatedRelations: 0,
    repeatedEventTitles: 0,
    serializedSaveBytes: 0,
  };
  for (let turn = 0; turn < options.turns; turn++) {
    const before = world;
    const turnStarted = performance.now();
    const prepared = await orchestrator.prepare({
      world,
      expectedHash: options.hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'system',
        text: 'Autonomous world observation; no player directive.',
      },
      days: world.scenario.rules?.turnDays ?? 30,
      quality: options.quality ?? 'fast',
      runId: `soak-${world.saveId.slice(5, 20)}-${world.revision}`,
    });
    for (const activation of prepared.trace.activations) {
      maxGap = Math.max(
        maxGap,
        turn - (planned.get(activation.nationId) ?? -1),
      );
      planned.set(activation.nationId, turn);
    }
    world = options.commit(prepared.request, prepared.trace);
    traces.push(prepared.trace);
    try {
      assertWorld(world);
    } catch (error) {
      metrics.invariantFailures++;
      throw error;
    }
    metrics.turns++;
    metrics.commands += prepared.request.commands.length;
    metrics.modelCalls += prepared.trace.modelCalls.length;
    metrics.modelFailures += prepared.trace.modelCalls.filter(
      (r) => r.status === 'failed',
    ).length;
    metrics.repairs += prepared.trace.modelCalls.filter(
      (r) => r.repairAttempt > 0,
    ).length;
    metrics.totalModelLatencyMs += prepared.trace.modelCalls.reduce(
      (s, r) => s + r.latencyMs,
      0,
    );
    metrics.maxContextCharacters = Math.max(
      metrics.maxContextCharacters,
      ...prepared.trace.modelCalls.map((r) => r.contextCharacters),
    );
    metrics.events += world.events.length - before.events.length;
    const actionsById = new Map(
      world.actions.map((action) => [action.id, action]),
    );
    const commandsById = new Map(
      world.commands.map((command) => [command.id, command]),
    );
    metrics.autonomousEvents += world.events
      .slice(before.events.length)
      .filter((event) =>
        event.sourceCommandIds.some((id) => {
          const command = commandsById.get(id);
          return (
            command && actionsById.get(command.actionId)?.source === 'system'
          );
        }),
      ).length;
    const beforeRegionsById = new Map(
      before.regions.map((region) => [region.id, region]),
    );
    metrics.territorialChanges += world.regions.filter((r) => {
      const old = beforeRegionsById.get(r.id)!;
      return (
        old.controllerNationId !== r.controllerNationId ||
        old.ownerNationId !== r.ownerNationId
      );
    }).length;
    metrics.governmentChanges += world.nations.filter((n) => {
      const old = before.nations.find((v) => v.id === n.id)!;
      return JSON.stringify(old.government) !== JSON.stringify(n.government);
    }).length;
    metrics.diplomaticActions += prepared.request.commands.filter((c) =>
      ['OPEN_NEGOTIATION', 'RESPOND_NEGOTIATION'].includes(c.command.type),
    ).length;
    const turnMs = performance.now() - turnStarted;
    metrics.turnLatenciesMs.push(Math.round(turnMs));
    metrics.maxTurnMs = Math.max(metrics.maxTurnMs, turnMs);
    options.onProgress?.(turn + 1);
  }
  for (const last of planned.values())
    maxGap = Math.max(maxGap, options.turns - last - 1);
  metrics.warsStarted = world.conflicts.length - initial.conflicts.length;
  metrics.warsEnded = world.conflicts.filter((conflict) => {
    const old = initial.conflicts.find((entry) => entry.id === conflict.id);
    return conflict.status === 'ended' && (!old || old.status === 'active');
  }).length;
  metrics.treatiesCreated = world.treaties.length - initial.treaties.length;
  metrics.peaceAgreements = world.treaties.filter(
    (treaty) =>
      treaty.kind === 'peace' &&
      !initial.treaties.some((old) => old.id === treaty.id),
  ).length;
  metrics.organizationsCreated = world.organizations.filter(
    (organization) =>
      !initial.organizations.some((old) => old.id === organization.id),
  ).length;
  metrics.crisesStarted = world.crises.filter(
    (crisis) => !initial.crises.some((old) => old.id === crisis.id),
  ).length;
  metrics.crisesResolved = world.crises.filter(
    (crisis) =>
      crisis.status === 'resolved' &&
      initial.crises.find((old) => old.id === crisis.id)?.status !== 'resolved',
  ).length;
  metrics.sanctionsCreated = world.sanctions.filter(
    (sanction) => !initial.sanctions.some((old) => old.id === sanction.id),
  ).length;
  const systemActions = new Set(
    world.actions
      .slice(initial.actions.length)
      .filter((action) => action.source === 'system')
      .map((action) => action.id),
  );
  const familyFor = (type: string) =>
    type.includes('INITIATIVE')
      ? 'project'
      : /CONFLICT|THEATER|MOBILIZE|STRATEGIC_ATTACK/.test(type)
        ? 'war'
        : /NEGOTIATION|TREATY|RELATION/.test(type)
          ? 'diplomacy'
          : /ORGANIZATION|CONFERENCE/.test(type)
            ? 'organization'
            : /CRISIS/.test(type)
              ? 'crisis'
              : /SANCTION/.test(type)
                ? 'sanctions'
                : /ECONOMIC_LINK|TRANSFER|CLAIM/.test(type)
                  ? 'economy'
                  : 'domestic';
  for (const record of world.commands.slice(initial.commands.length)) {
    if (!systemActions.has(record.actionId)) continue;
    if (record.command.type === 'ADVANCE_DATE') continue;
    const family = familyFor(record.command.type);
    metrics.actionFamilyDistribution[family] =
      (metrics.actionFamilyDistribution[family] ?? 0) + 1;
  }
  metrics.initiativesStarted =
    world.initiatives.length - initial.initiatives.length;
  metrics.goalsPreserved = initial.goals.filter((g) =>
    world.goals.some((v) => v.id === g.id),
  ).length;
  metrics.activatedActors = planned.size;
  metrics.maxPlanningGap = maxGap;
  metrics.unresolvedNegotiations = world.negotiations.filter(
    (n) => n.status === 'open',
  ).length;
  metrics.saturatedRelations = world.relations.filter(
    (r) => Math.abs(r.score) === 100,
  ).length;
  const titles = new Map<string, number>();
  world.events.forEach((e) =>
    titles.set(e.title, (titles.get(e.title) ?? 0) + 1),
  );
  metrics.repeatedEventTitles = [...titles.values()].reduce(
    (s, count) => s + Math.max(0, count - 1),
    0,
  );
  metrics.serializedSaveBytes = Buffer.byteLength(JSON.stringify(world));
  metrics.wallTimeMs = performance.now() - started;
  metrics.averageTurnMs = metrics.wallTimeMs / metrics.turns;
  return {
    world,
    metrics,
    behavior: analyzeWorldBehavior(initial, world),
    traces,
  };
}
