import { useEffect, useState } from 'react';
import { api } from './api.js';
import { knowsInformation, executionCapacity } from '@mandate/core';
import type { WorldState } from '@mandate/schemas';
export function TurnSummary({ world }: { world: WorldState }) {
  const [report, setReport] = useState<{
    playerDecision: string | null;
    backgroundFailures: number;
    playerExecution: {
      understood?: string[];
      semanticAudit?: import('@mandate/schemas').SemanticAudit[];
      orders: string[];
      majorIntentClauses: {
        id: string;
        kind: string;
        description: string;
        sourceClauseIds: number[];
        targetNationIds: string[];
        targetRegionIds: string[];
      }[];
      intentSatisfactionAudit: {
        clauseId: string;
        kind: string;
        status: string;
        evidence: string[];
        explanation: string;
      }[];
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
    } | null;
    responses: {
      nationId: string;
      recipientNationId: string;
      message: string;
      move: string;
    }[];
  } | null>(null);
  useEffect(() => {
    void api<typeof report>('/api/turn-report')
      .then(setReport)
      .catch(() => setReport(null));
  }, [world.revision]);
  const turn = world.turns.at(-1);
  if (!turn) return null;
  const action = world.actions.find((a) => a.id === turn.actionId);
  const own = world.nations.find((n) => n.id === world.playerNationId)!;
  const playerExecution = report?.playerExecution;
  const events = world.events.filter(
    (e) =>
      e.turnId === turn.id &&
      e.type !== 'ADVANCE_DATE' &&
      knowsInformation(world, own.id, { kind: 'event', id: e.id }),
  );
  const isPlayerCommand = (record: (typeof world.commands)[number]) => {
    const command = record.command;
    if ('nationId' in command) return command.nationId === own.id;
    if (command.type === 'STRATEGIC_ATTACK')
      return command.attackerNationId === own.id;
    if (command.type === 'START_CONFLICT')
      return command.conflict.attackers.includes(own.id);
    if (command.type === 'OPEN_CRISIS')
      return command.crisis.participants[0] === own.id;
    if (command.type === 'START_INITIATIVE')
      return command.initiative.nationId === own.id;
    if (command.type === 'OPEN_NEGOTIATION')
      return command.negotiation.proposerNationId === own.id;
    if (command.type === 'CREATE_STRATEGIC_GOAL')
      return command.goal.nationId === own.id;
    if (command.type === 'ADJUST_RELATION')
      return [command.nationA, command.nationB].includes(own.id);
    return false;
  };
  const playerCommandIds = new Set(
    world.commands
      .filter(
        (record) =>
          record.actionId === turn.actionId && isPlayerCommand(record),
      )
      .map((record) => record.id),
  );
  const committedPlayerEvents = events
    .filter((event) =>
      event.sourceCommandIds.some((id) => playerCommandIds.has(id)),
    )
    .sort((a, b) => b.importance - a.importance);
  const responses = events.filter(
    (e) => e.type === 'RESPOND_NEGOTIATION' && e.nationIds.includes(own.id),
  );
  const consequences = events.filter(
    (e) => e.nationIds.includes(own.id) && !responses.includes(e),
  );
  const news = events.filter(
    (e) => !e.nationIds.includes(own.id) && e.importance >= 50,
  );
  const projects = world.initiatives.filter(
    (i) => i.nationId === own.id && i.status === 'active',
  );
  const used = projects.reduce((s, i) => s + i.effort, 0),
    capacity = executionCapacity(world, own.id);
  const risks = world.crises.filter(
    (c) =>
      c.status !== 'resolved' &&
      c.participants.includes(own.id) &&
      knowsInformation(world, own.id, { kind: 'crisis', id: c.id }),
  );
  const outcomeDescriptions = (playerExecution?.desiredOutcomes ?? []).map(
    (outcome) => {
      const regions = outcome.targetRegionIds.length
        ? world.regions.filter((r) => outcome.targetRegionIds.includes(r.id))
        : outcome.targetNationIds.flatMap((id) =>
            world.regions.filter((r) => r.ownerNationId === id),
          );
      const targets = outcome.targetNationIds
        .map((id) => world.nations.find((n) => n.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      if (outcome.kind === 'territory' && regions.length) {
        const transferred = regions.every((r) => r.ownerNationId === own.id);
        return transferred
          ? `Territorial outcome achieved: the targeted territory is now under ${own.name}'s ownership.`
          : `No territorial transfer occurred. ${regions.filter((r) => r.ownerNationId === own.id).length} of ${regions.length} targeted region(s) are owned by ${own.name}; ${targets.join(', ') || 'the current owner'} retains the rest.`;
      }
      if (outcome.kind === 'war' && targets.length) {
        const active = world.conflicts.some(
          (conflict) =>
            conflict.status === 'active' &&
            [...conflict.attackers, ...conflict.defenders].includes(own.id) &&
            outcome.targetNationIds.some((id) =>
              [...conflict.attackers, ...conflict.defenders].includes(
                id as never,
              ),
            ),
        );
        return active
          ? `An active conflict with ${targets.join(', ')} is recorded; combat outcomes remain subject to simulation mechanics.`
          : `No active conflict with ${targets.join(', ')} is currently recorded.`;
      }
      if (outcome.kind === 'peace') {
        const active = world.conflicts.some(
          (conflict) =>
            conflict.status === 'active' &&
            [...conflict.attackers, ...conflict.defenders].includes(own.id),
        );
        return active
          ? 'The conflict remains active while the other government considers the peace offer.'
          : 'No active conflict remains.';
      }
      if (outcome.kind === 'alliance' && targets.length) {
        const joined = world.organizations.some(
          (organization) =>
            organization.kind === 'alliance' &&
            organization.members.includes(own.id) &&
            outcome.targetNationIds.some((id) =>
              organization.members.includes(id as never),
            ),
        );
        return joined
          ? `An alliance with ${targets.join(', ')} is active.`
          : `No alliance with ${targets.join(', ')} has been accepted.`;
      }
      return `No canonical external outcome is recorded for ${targets.join(', ') || 'the requested target'}; simulation mechanics and other governments determine the result.`;
    },
  );
  const outcomeEffects = committedPlayerEvents.flatMap((event) =>
    event.effects.map((effect) => {
      const nationName =
        world.nations.find((nation) => nation.id === effect.nationId)?.name ??
        effect.nationId;
      const delta = effect.after - effect.before;
      return `${nationName}: ${effect.stat} ${delta > 0 ? '+' : ''}${delta} (${effect.before} → ${effect.after})`;
    }),
  );
  return (
    <details className="turn-summary">
      <summary>
        Last turn · {events.length} developments · {turn.date}
      </summary>
      {action?.source === 'player' && (
        <div>
          <strong>YOUR ORDER</strong>
          <p>{action.text}</p>
          {!!playerExecution?.understood?.length && (
            <div>
              <strong>WHAT MANDATE UNDERSTOOD</strong>
              <ul>
                {playerExecution.understood.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          {!playerExecution?.understood?.length &&
            !!playerExecution?.majorIntentClauses.length && (
              <div>
                <strong>WHAT MANDATE UNDERSTOOD</strong>
                <ul>
                  {playerExecution.majorIntentClauses.map((clause) => (
                    <li key={clause.id}>{clause.description}</li>
                  ))}
                </ul>
              </div>
            )}
          <div>
            <strong>ATTEMPTS</strong>
            {committedPlayerEvents.length ? (
              <ul>
                {committedPlayerEvents.slice(0, 8).map((event) => (
                  <li key={event.id}>{event.title}</li>
                ))}
              </ul>
            ) : (
              <p>No player-controlled action was committed this turn.</p>
            )}
          </div>
          {!!playerExecution?.constraints.length && (
            <p>
              <strong>Constraint:</strong>{' '}
              {playerExecution.constraints.join('; ')}
            </p>
          )}
          {(outcomeDescriptions.length > 0 || outcomeEffects.length > 0) && (
            <div>
              <strong>WORLD CONSEQUENCES</strong>
              <ul>
                {outcomeDescriptions.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
                {outcomeEffects.slice(0, 8).map((item, index) => (
                  <li key={`effect-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {!!playerExecution?.semanticAudit?.length && (
            <div>
              <strong>ORDER RESULTS</strong>
              <ul>
                {playerExecution.semanticAudit.map((entry) => (
                  <li key={entry.actionId}>
                    <strong>{entry.status}</strong> · {entry.text}
                    <br />
                    {entry.explanation}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!playerExecution?.intentSatisfactionAudit.length && (
            <div>
              <strong>MAJOR INTENT SATISFACTION AUDIT</strong>
              <ul>
                {playerExecution.intentSatisfactionAudit.map((entry) => (
                  <li key={entry.clauseId}>
                    {entry.status.replaceAll('_', ' ')} · {entry.explanation}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!playerExecution?.warnings.length && (
            <div>
              <strong>Execution notes</strong>
              <ul>
                {playerExecution.warnings.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {!!playerExecution?.advisories.length && (
            <div>
              <strong>Cabinet advisory</strong>
              <ul>
                {playerExecution.advisories.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {report?.playerDecision && (
            <p className="muted">Cabinet assessment: {report.playerDecision}</p>
          )}
        </div>
      )}
      {(
        [
          ['Foreign responses', responses],
          ['Consequences', consequences],
          ['World developments', news],
        ] as const
      )
        .filter(([, entries]) => entries.length > 0)
        .map(([label, entries]) => (
          <div key={label}>
            <strong>{label}</strong>
            <ul>
              {entries.slice(0, 4).map((e) => (
                <li key={e.id}>{e.title}</li>
              ))}
            </ul>
          </div>
        ))}
      {events.length === 0 && !playerExecution?.implementation.length && (
        <p>Existing policies continue. No major new developments this turn.</p>
      )}
      {report?.responses
        .filter((r) => r.move === 'ignore')
        .map((r, i) => (
          <p key={i}>
            {world.nations.find((n) => n.id === r.nationId)?.name} did not
            engage: {r.message}
          </p>
        ))}
      {!!report?.backgroundFailures && (
        <p className="muted">
          {report.backgroundFailures} background government decisions were
          skipped after inference failure. No policy was invented.
        </p>
      )}
      {projects.length > 0 && (
        <div>
          <strong>Ongoing programs</strong>
          <ul>
            {projects.slice(0, 3).map((i) => (
              <li key={i.id}>
                {i.name} · {i.progress}%{i.blocker ? ` · ${i.blocker}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="capacity-note">
        Fiscal pressure:{' '}
        {own.stats.fiscal < 30
          ? 'HIGH'
          : own.stats.fiscal < 55
            ? 'MODERATE'
            : 'LOW'}{' '}
        · Available execution: {Math.max(0, capacity - used)} / {capacity}
      </p>
      {used > 0 && (
        <small>
          Committed to {projects.map((i) => i.name).join(', ')}. Projects draw
          from treasury over time.
        </small>
      )}
      {risks.length > 0 && (
        <div>
          <strong>Active risks</strong>
          <ul>
            {risks.slice(0, 2).map((c) => (
              <li key={c.id}>
                {c.title} ·{' '}
                {c.severity >= 60 ? 'high pressure' : 'watch closely'}
                {c.deadline ? ` · deadline ${c.deadline}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {turn.revision % 12 === 0 && (
        <details>
          <summary>Your timeline so far</summary>
          <ul>
            {world.events
              .filter(
                (e) =>
                  e.importance >= 60 &&
                  e.type !== 'ADVANCE_DATE' &&
                  knowsInformation(world, own.id, { kind: 'event', id: e.id }),
              )
              .slice(-8)
              .map((e) => (
                <li key={e.id}>
                  {e.date} · {e.title}
                </li>
              ))}
          </ul>
        </details>
      )}
    </details>
  );
}
