import { useState } from 'react';
import type { Nation, WorldState } from '@mandate/schemas';
export function StrategyDossier({
  nation,
  world,
  busy,
  operate,
  view = 'all',
}: {
  view?: 'all' | 'strategy' | 'commitments';
  nation: Nation;
  world: WorldState;
  busy: boolean;
  operate: (endpoint: string, input?: object) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('medium');
  const own = nation.id === world.playerNationId;
  const commitments = world.commitments.filter(
    (c) =>
      (c.issuer === nation.id || c.recipients.includes(nation.id)) &&
      (c.visibility === 'public' ||
        c.issuer === world.playerNationId ||
        c.recipients.includes(world.playerNationId)),
  );
  return (
    <>
      {view !== 'commitments' && (
        <section>
          <h2>Government strategy</h2>
          <p>
            {nation.strategy.orientation} priority · risk tolerance{' '}
            {own ? nation.strategy.riskTolerance : 'not disclosed'}
          </p>
          {nation.strategy.directives
            .filter((d) => own || d.visibility === 'public')
            .map((d) => (
              <div className="goal" key={d.id}>
                <p>{d.text}</p>
                <small>
                  {d.priority ?? 'medium'} · {d.status} · {d.visibility}
                </small>
                {own && d.status === 'active' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void operate('/api/strategy', { cancelId: d.id })
                    }
                  >
                    Cancel directive
                  </button>
                )}
              </div>
            ))}
          {own && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void operate('/api/strategy', {
                  text,
                  visibility: 'private',
                  priority,
                }).then((result) => {
                  if (result) setText('');
                });
              }}
            >
              <label htmlFor="persistent-directive">Persistent directive</label>
              <textarea
                id="persistent-directive"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Maintain neutrality; prioritize energy independence…"
                rows={2}
              />
              <select
                aria-label="Directive priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {['critical', 'high', 'medium', 'low'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <button disabled={busy || !text.trim()}>Set directive</button>
            </form>
          )}
        </section>
      )}
      {view !== 'strategy' && (
        <section>
          <h2>Promises & obligations</h2>
          {!commitments.length && <small>No structured obligations</small>}
          {commitments.map((c) => (
            <div className="goal" key={c.id}>
              <p>{c.terms}</p>
              <small>
                {c.type} · {c.strength} · {c.status} · {c.visibility}
              </small>
              <p className="muted">
                {world.nations.find((n) => n.id === c.issuer)?.name} →{' '}
                {c.recipients
                  .map((id) => world.nations.find((n) => n.id === id)?.name)
                  .join(', ')}
              </p>
              {c.dueDate && <small>Due {c.dueDate}</small>}
              {c.issuer === world.playerNationId &&
                c.status === 'active' &&
                c.condition.kind === 'project' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void operate('/api/commitments/fund', {
                        commitmentId: c.id,
                      })
                    }
                  >
                    Fund obligation delivery
                  </button>
                )}
              <details>
                <summary>Obligation evidence</summary>
                {c.history.map((h, i) => (
                  <p key={i}>
                    {h.date}: {h.reason}
                  </p>
                ))}
              </details>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
