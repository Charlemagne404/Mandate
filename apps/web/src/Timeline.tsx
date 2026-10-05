import { knowsInformation } from '@mandate/core';
import { TurnSummary } from './TurnSummary.js';
import type { WorldState } from '@mandate/schemas';
import { useState } from 'react';
import { api } from './api.js';
import { eventHeadline } from './event-headline.js';
function Explanation({
  turnId,
  developerMode,
}: {
  turnId: string;
  developerMode: boolean;
}) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState('');
  const evidence =
    data && typeof data === 'object' && 'audit' in data
      ? (data.audit as {
          intent?: { summary: string };
          activations?: { nationId: string; reasons: string[] }[];
          plans?: {
            nationId: string;
            explanation: string;
            priorities: string[];
          }[];
          proposal?: { explanation: string };
          validatorResults?: string[];
          contexts?: { perspectiveNationId: string; retrieval?: unknown }[];
          latencyMs?: number;
          modelCalls?: {
            provider: string;
            model: string;
            role: string;
            status: string;
            latencyMs: number;
            validationFailures: string[];
          }[];
        } | null)
      : null;
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !data)
          void api('/api/explain/' + encodeURIComponent(turnId))
            .then(setData)
            .catch((e) => setError(String(e)));
      }}
    >
      <summary>
        {developerMode
          ? 'Government plans, context & model records'
          : 'Government response & reasons'}
      </summary>
      {error && <p className="error">{error}</p>}
      {evidence && (
        <div className="causal-chain">
          <p>
            <strong>Interpreted intent</strong>
            <br />
            {evidence.intent?.summary ?? 'Independent world turn'}
          </p>
          <p>
            <strong>Affected governments</strong>
            <br />
            {evidence.activations
              ?.map((a) => a.nationId.slice(7).toUpperCase())
              .join(', ')}
          </p>
          {evidence.plans?.map((p) => (
            <div key={p.nationId}>
              <strong>{p.nationId.slice(7).toUpperCase()} decision</strong>
              <p>{p.explanation}</p>
              <small>{p.priorities.join(' · ')}</small>
            </div>
          ))}
          <p>
            <strong>Resolution</strong>
            <br />
            {evidence.proposal?.explanation}
          </p>
          <p>
            <strong>Deterministic checks</strong>
            <br />
            {evidence.validatorResults?.join(' ')}
          </p>
          <details>
            <summary>Retrieved decision facts</summary>
            {evidence.contexts?.map((c) => (
              <div key={c.perspectiveNationId}>
                <strong>{c.perspectiveNationId}</strong>
                <pre>{JSON.stringify(c.retrieval, null, 2)}</pre>
              </div>
            ))}
          </details>
          <small>
            Prepared in {Math.round(evidence.latencyMs ?? 0)} ms ·{' '}
            {evidence.modelCalls?.length ?? 0} model calls
          </small>
        </div>
      )}
      {data !== null && !evidence && (
        <p className="muted">
          No model workflow was attached to this direct command.
        </p>
      )}
      {developerMode && (
        <details>
          <summary>Advanced developer evidence</summary>
          <small>
            All participating perspectives. Observable decisions only.
          </small>
          <pre>{JSON.stringify(data, null, 2) || 'Loading evidence…'}</pre>
        </details>
      )}
    </details>
  );
}
export function Timeline({
  world,
  onSelect,
  selected,
  developerMode = false,
  followed = [],
  references = [],
}: {
  world: WorldState;
  developerMode?: boolean;
  followed?: string[];
  references?: { nationId: string; subregion: string }[];
  selected?: import('@mandate/schemas').NationId;
  onSelect?: (id: import('@mandate/schemas').NationId) => void;
}) {
  const [region, setRegion] = useState('');
  const [filter, setFilter] = useState('relevant');
  const known = world.events.filter((e) =>
    knowsInformation(world, world.playerNationId, { kind: 'event', id: e.id }),
  );
  return (
    <aside className="timeline" aria-label="Event timeline">
      <div className="section-head">
        <h2>Recent history</h2>
        <span>{known.length.toString().padStart(2, '0')}</span>
      </div>
      <TurnSummary world={world} />
      <details className="timeline-filters">
        <summary>Filter history</summary>
        <label>
          Focus
          <select
            aria-label="Filter events"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="relevant">Major & relevant</option>
            <option value="all">All known events</option>
            <option value="major">Major world news</option>
            <option value="followed">Followed countries</option>
            <option value="country">Your country</option>
            <option value="diplomacy">Diplomacy</option>
            <option value="conflict">Conflicts</option>
            <option value="economy">Economy & projects</option>
          </select>
        </label>
        <label>
          Region
          <select
            aria-label="News region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">All regions</option>
            {[...new Set(references.map((r) => r.subregion))]
              .filter(Boolean)
              .sort()
              .map((r) => (
                <option key={r}>{r}</option>
              ))}
          </select>
        </label>
      </details>
      {!world.events.length && (
        <div className="empty-ledger">
          <span className="ledger-symbol">◎</span>
          <h3>A world awaiting decisions</h3>
          <p>
            Choose a country and issue a directive. Advance world lets other
            governments act while your initiatives develop.
          </p>
        </div>
      )}
      {[...known]
        .filter(
          (e) =>
            (filter === 'relevant' &&
              (e.importance >= 70 ||
                e.nationIds.some((id) => followed.includes(id)) ||
                e.nationIds.includes(world.playerNationId) ||
                (selected && e.nationIds.includes(selected)) ||
                e.regionIds.some((id) =>
                  world.regions.some(
                    (r) =>
                      r.id === id &&
                      [r.ownerNationId, r.controllerNationId].some(
                        (n) => n === selected || n === world.playerNationId,
                      ),
                  ),
                ) ||
                world.goals.some(
                  (g) =>
                    g.nationId === world.playerNationId &&
                    !['achieved', 'failed', 'abandoned', 'superseded'].includes(
                      g.status,
                    ) &&
                    g.targetNationIds.some((id) => e.nationIds.includes(id)),
                ))) ||
            filter === 'all' ||
            (filter === 'followed' &&
              e.nationIds.some((id) => followed.includes(id))) ||
            (filter === 'major' && e.importance >= 60) ||
            (filter === 'country' &&
              e.nationIds.includes(world.playerNationId)) ||
            (filter === 'diplomacy' &&
              (e.treatyIds.length > 0 || /NEGOTIATION|TREATY/.test(e.type))) ||
            (filter === 'conflict' && e.conflictIds.length > 0) ||
            (filter === 'economy' && /INITIATIVE|STAT|DATE/.test(e.type)),
        )
        .filter(
          (e) =>
            !region ||
            e.nationIds.some((id) =>
              references.some(
                (r) => r.nationId === id && r.subregion === region,
              ),
            ),
        )
        .filter((e) => developerMode || e.type !== 'ADVANCE_DATE')
        .reverse()
        .slice(0, 30)
        .map((event) => {
          const turn = world.turns.find((t) => t.id === event.turnId)!;
          const action = world.actions.find((a) => a.id === turn.actionId)!;
          const originatingAction = event.provenance?.originatingActionId
            ? world.actions.find(
                (candidate) =>
                  candidate.id === event.provenance?.originatingActionId,
              )
            : undefined;
          const commands = world.commands.filter((c) =>
            event.sourceCommandIds.includes(c.id),
          );
          const decisionReason = commands.find(
            (command) => command.command.type !== 'ADVANCE_DATE',
          )?.reason;
          const currentOrderReason = decisionReason?.replace(
            /^Player order:\s*/i,
            '',
          );
          const safeCurrentOrderReason =
            currentOrderReason &&
            action.semanticGraph?.actions.some(
              (entry) =>
                entry.secrecy === 'public' &&
                entry.text.toLocaleLowerCase() ===
                  currentOrderReason.toLocaleLowerCase(),
            )
              ? currentOrderReason
              : null;
          const automaticEffect =
            event.provenance?.kind === 'automatic-effect' ||
            (event.type !== 'ADVANCE_DATE' &&
              commands.some(
                (command) => command.command.type === 'ADVANCE_DATE',
              ));
          return (
            <article
              className={`event ${event.importance >= 60 ? 'major-event' : ''}`}
              key={event.id}
            >
              <div className="event-date">
                {event.date}{' '}
                <span>TURN {turn.revision.toString().padStart(3, '0')}</span>
              </div>
              <h3>{eventHeadline(world, event)}</h3>
              {!!event.effects.length && (
                <details className="event-outcome">
                  <summary>Outcome details</summary>
                  <dl className="event-effects">
                    {event.effects
                      .filter(
                        (effect) =>
                          effect.nationId === world.playerNationId ||
                          [
                            'economy',
                            'military',
                            'stability',
                            'legitimacy',
                            'industrial',
                            'technology',
                            'influence',
                          ].includes(effect.stat),
                      )
                      .slice(0, 10)
                      .map((effect, i) => (
                        <div key={i} className="dossier-pair">
                          <dt>
                            {
                              world.nations.find(
                                (n) => n.id === effect.nationId,
                              )?.name
                            }{' '}
                            / {effect.stat}
                          </dt>
                          <dd>
                            {effect.before} → {effect.after}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </details>
              )}
              <div className="event-actors">
                {event.nationIds.slice(0, 5).map((id) => (
                  <button key={id} onClick={() => onSelect?.(id)}>
                    {world.nations.find((n) => n.id === id)?.name}
                  </button>
                ))}
              </div>
              <details>
                <summary>Why did this happen?</summary>
                <div className="provenance">
                  {automaticEffect ? (
                    <>
                      {originatingAction && (
                        <p>
                          <strong>ORIGINATING DECISION</strong> An earlier
                          committed directive continues to shape this
                          development.
                        </p>
                      )}
                      <p>
                        <strong>AUTOMATIC EFFECT</strong> {event.title}
                      </p>
                      {action.source === 'player' && (
                        <p>
                          <strong>CURRENT PLAYER ORDER</strong>{' '}
                          <small>
                            This order advanced the simulation; it did not
                            create this recurring policy.
                          </small>{' '}
                          This directive advanced the simulation.
                        </p>
                      )}
                    </>
                  ) : event.provenance?.kind === 'current-player-order' ||
                    (!event.provenance &&
                      action.source === 'player' &&
                      action.actorNationId === world.playerNationId) ? (
                    <p>
                      <strong>CURRENT PLAYER ORDER</strong>{' '}
                      <small>Committed clause, not a guaranteed outcome.</small>{' '}
                      {safeCurrentOrderReason || event.title}
                    </p>
                  ) : (
                    <p>
                      <strong>INDEPENDENT GOVERNMENT DECISION</strong>{' '}
                      {decisionReason ||
                        'This government acted according to its own priorities.'}
                    </p>
                  )}
                  {!automaticEffect && (
                    <p>
                      <strong>SIMULATION RECORD</strong> {event.title}
                    </p>
                  )}
                  {commands
                    .filter((c) => {
                      if (developerMode) return true;
                      const command = c.command;
                      const actor =
                        'nationId' in command
                          ? command.nationId
                          : command.type === 'STRATEGIC_ATTACK'
                            ? command.attackerNationId
                            : command.type === 'START_CONFLICT'
                              ? command.conflict.attackers.includes(
                                  world.playerNationId,
                                )
                                ? world.playerNationId
                                : null
                              : command.type === 'OPEN_CRISIS'
                                ? command.crisis.participants[0]
                                : command.type === 'START_INITIATIVE'
                                  ? command.initiative.nationId
                                  : command.type === 'OPEN_NEGOTIATION'
                                    ? command.negotiation.proposerNationId
                                    : command.type === 'CREATE_STRATEGIC_GOAL'
                                      ? command.goal.nationId
                                      : null;
                      return actor === world.playerNationId;
                    })
                    .map((c) => (
                      <div key={c.id}>
                        <p>
                          <strong>Reason:</strong> {c.reason}
                        </p>
                        {developerMode && (
                          <>
                            <small>
                              {c.validation} · {c.id}
                            </small>
                            <pre>{JSON.stringify(c.command, null, 2)}</pre>
                          </>
                        )}
                      </div>
                    ))}
                  <small>Committed {turn.recordedAt}</small>
                  {developerMode && (
                    <Explanation
                      turnId={turn.id}
                      developerMode={developerMode}
                    />
                  )}
                </div>
              </details>
            </article>
          );
        })}
    </aside>
  );
}
