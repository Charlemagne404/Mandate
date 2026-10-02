import { knowsInformation } from '@mandate/core';
import { TurnSummary } from './TurnSummary.js';
import type { WorldState } from '@mandate/schemas';
import { useState } from 'react';
import { api } from './api.js';
function Explanation({ turnId }: { turnId: string }) {
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
      <summary>Government plans, context & model records</summary>
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
      <details>
        <summary>Advanced developer evidence</summary>
        <small>
          All participating perspectives. Observable decisions only.
        </small>
        <pre>{JSON.stringify(data, null, 2) || 'Loading evidence…'}</pre>
      </details>
    </details>
  );
}
export function Timeline({
  world,
  onSelect,
  selected,
}: {
  world: WorldState;
  selected?: import('@mandate/schemas').NationId;
  onSelect?: (id: import('@mandate/schemas').NationId) => void;
}) {
  const [filter, setFilter] = useState('relevant');
  const known = world.events.filter((e) =>
    knowsInformation(world, world.playerNationId, { kind: 'event', id: e.id }),
  );
  return (
    <aside className="timeline" aria-label="Event timeline">
      <div className="section-head">
        <h2>World ledger</h2>
        <span>{known.length.toString().padStart(2, '0')}</span>
      </div>
      <TurnSummary world={world} />
      <p className="muted ledger-intro">
        Committed facts. Every entry has a source.
      </p>
      <select
        aria-label="Filter events"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="relevant">Major & relevant developments</option>
        <option value="all">All known events</option>
        <option value="major">Major events</option>
        <option value="country">Your country</option>
        <option value="diplomacy">Diplomacy</option>
        <option value="conflict">Conflicts</option>
        <option value="economy">Economy & projects</option>
      </select>
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
            (filter === 'major' && e.importance >= 60) ||
            (filter === 'country' &&
              e.nationIds.includes(world.playerNationId)) ||
            (filter === 'diplomacy' &&
              (e.treatyIds.length > 0 || /NEGOTIATION|TREATY/.test(e.type))) ||
            (filter === 'conflict' && e.conflictIds.length > 0) ||
            (filter === 'economy' && /INITIATIVE|STAT|DATE/.test(e.type)),
        )
        .reverse()
        .slice(0, 30)
        .map((event) => {
          const turn = world.turns.find((t) => t.id === event.turnId)!;
          const action = world.actions.find((a) => a.id === turn.actionId)!;
          const commands = world.commands.filter((c) =>
            event.sourceCommandIds.includes(c.id),
          );
          return (
            <article
              className={`event ${event.importance >= 60 ? 'major-event' : ''}`}
              key={event.id}
            >
              <div className="event-date">
                {event.date}{' '}
                <span>TURN {turn.revision.toString().padStart(3, '0')}</span>
              </div>
              <h3>{event.title}</h3>
              {!!event.effects.length && (
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
                            world.nations.find((n) => n.id === effect.nationId)
                              ?.name
                          }{' '}
                          / {effect.stat}
                        </dt>
                        <dd>
                          {effect.before} → {effect.after}
                        </dd>
                      </div>
                    ))}
                </dl>
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
                  <p>
                    <strong>Trigger:</strong> {action.text}
                  </p>
                  {commands.map((c) => (
                    <div key={c.id}>
                      <p>
                        <strong>Reason:</strong> {c.reason}
                      </p>
                      <small>
                        {c.validation} · {c.id}
                      </small>
                      <pre>{JSON.stringify(c.command, null, 2)}</pre>
                    </div>
                  ))}
                  <small>Committed {turn.recordedAt}</small>
                  <Explanation turnId={turn.id} />
                </div>
              </details>
            </article>
          );
        })}
    </aside>
  );
}
