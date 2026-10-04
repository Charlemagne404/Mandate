import { useState } from 'react';
import type { NationId, WorldState } from '@mandate/schemas';
import type { WorldResponse } from './api.js';
type Operation = (endpoint: string, input?: object) => Promise<unknown>;
export function Diplomacy({
  world,
  selected,
  busy,
  operate,
}: {
  world: WorldState;
  selected: NationId;
  busy: boolean;
  operate: Operation;
}) {
  const [counterId, setCounterId] = useState<string | null>(null);
  const [counter, setCounter] = useState('');
  const [message, setMessage] = useState('');
  const [pledge, setPledge] = useState(false);
  const [investment, setInvestment] = useState(4);
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.parse(world.date) + 180 * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const name = (id: string) =>
    world.nations.find((n) => n.id === id)?.name ?? id;
  const threads = world.negotiations.filter(
    (n) =>
      (n.visibility === 'public' ||
        [n.proposerNationId, n.recipientNationId].includes(
          world.playerNationId,
        )) &&
      [n.proposerNationId, n.recipientNationId].includes(selected),
  );
  return (
    <div className="context-panel">
      <span className="eyebrow">DIPLOMATIC CHANNEL</span>
      <h2>{name(selected)}</h2>
      <p className="muted">
        Proposals remain open until the other government accepts. Counteroffers
        keep the conversation going.
      </p>
      {selected !== world.playerNationId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void operate('/api/diplomacy/propose', {
              recipientNationId: selected,
              message,
              ...(pledge ? { minimumInvestment: investment, dueDate } : {}),
              visibility: 'public',
            }).then((result) => {
              if ((result as WorldResponse | null)?.world) setMessage('');
            });
          }}
        >
          <label htmlFor="diplomatic-message">Your proposal</label>
          <textarea
            id="diplomatic-message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Propose a trade arrangement, discuss defense, seek peace…"
          />
          <label>
            <input
              type="checkbox"
              checked={pledge}
              onChange={(e) => setPledge(e.target.checked)}
            />{' '}
            Include a funded aid pledge
          </label>
          {pledge && (
            <div className="form-pair">
              <label>
                Promised investment
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={investment}
                  onChange={(e) => setInvestment(Number(e.target.value))}
                />
              </label>
              <label>
                Delivery deadline
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </label>
            </div>
          )}
          <button className="primary" disabled={busy || !message.trim()}>
            Send diplomatic initiative
          </button>
        </form>
      )}
      {!threads.length && (
        <p className="empty-note">
          No diplomatic exchanges in this channel yet.
        </p>
      )}
      {[...threads].reverse().map((n) => (
        <article className="diplomatic-thread" key={n.id}>
          <div className="event-date">
            <span>{n.createdDate}</span>
            <span>
              {n.visibility.toUpperCase()} · {n.status.toUpperCase()}
            </span>
          </div>
          <h3>{n.topic}</h3>
          <small>
            {name(n.proposerNationId)} → {name(n.recipientNationId)} · expires{' '}
            {n.expiresDate}
          </small>
          <div className="current-terms">
            <span className="eyebrow">
              {n.status === 'open' ? 'OUTSTANDING TERMS' : 'FINAL TERMS'}
            </span>
            <p>{n.terms}</p>
          </div>
          {n.initialTerms && n.initialTerms !== n.terms && (
            <details>
              <summary>Original proposal</summary>
              <p>{n.initialTerms}</p>
            </details>
          )}
          {n.obligations.map((o, index) => (
            <p key={index}>
              {o.type}: {o.terms} · due {o.dueDate ?? 'ongoing'}
            </p>
          ))}
          {n.responses.map((r, i) => (
            <blockquote key={i}>
              <strong>
                {name(r.nationId)} · {r.move}
              </strong>
              <p>{r.message}</p>
              {r.offeredTerms && (
                <small>Terms in this round: {r.offeredTerms}</small>
              )}
              {r.obligations?.map((o, index) => (
                <p key={index}>
                  {o.type}: {o.terms}
                </p>
              ))}
              <small>{r.date}</small>
            </blockquote>
          ))}
          {n.status === 'open' &&
            world.treaties.some(
              (t) =>
                t.status === 'active' &&
                t.kind === n.kind &&
                t.parties.length === 2 &&
                t.parties.includes(n.proposerNationId) &&
                t.parties.includes(n.recipientNationId),
            ) && (
              <p className="muted">
                An equivalent agreement is already active. This offer cannot
                create a duplicate treaty; reject it or revise the discussion.
              </p>
            )}
          {n.status === 'open' &&
            n.recipientNationId === world.playerNationId && (
              <div className="inline-form">
                <button
                  disabled={busy}
                  onClick={() => {
                    setCounterId(n.id);
                    setCounter(n.terms);
                  }}
                >
                  Revise terms
                </button>
                {counterId === n.id && (
                  <div>
                    <label>
                      Revised proposal
                      <textarea
                        value={counter}
                        onChange={(e) => setCounter(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy || !counter.trim()}
                      onClick={() =>
                        void operate('/api/diplomacy/respond', {
                          negotiationId: n.id,
                          move: 'counter',
                          message: 'We propose these revised terms.',
                          counterTerms: counter,
                        }).then((r) => {
                          if (r) setCounterId(null);
                        })
                      }
                    >
                      Send counteroffer
                    </button>
                  </div>
                )}
                {(['accept', 'reject', 'delay'] as const).map((move) => (
                  <button
                    key={move}
                    disabled={
                      busy ||
                      (move === 'accept' &&
                        world.treaties.some(
                          (t) =>
                            t.status === 'active' &&
                            t.kind === n.kind &&
                            t.parties.length === 2 &&
                            t.parties.includes(n.proposerNationId) &&
                            t.parties.includes(n.recipientNationId),
                        ))
                    }
                    onClick={() =>
                      void operate('/api/diplomacy/respond', {
                        negotiationId: n.id,
                        move,
                        message: `Our government has chosen to ${move} this offer.`,
                      })
                    }
                  >
                    {move}
                  </button>
                ))}
              </div>
            )}
        </article>
      ))}
    </div>
  );
}
export function Conflicts({ world }: { world: WorldState }) {
  const name = (id: string) =>
    world.nations.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="context-panel">
      <span className="eyebrow">STRATEGIC SITUATION</span>
      <h2>Conflicts & projects</h2>
      {!world.conflicts.some((c) => c.status === 'active') && (
        <p className="empty-note">No active conflicts.</p>
      )}
      {world.conflicts
        .filter((c) => c.status === 'active')
        .map((c) => (
          <article className="conflict-card" key={c.id}>
            <h3>{c.name}</h3>
            <p>
              {c.attackers.map(name).join(', ')} vs{' '}
              {c.defenders.map(name).join(', ')}
            </p>
            <dl>
              <dt>Escalation</dt>
              <dd>{c.escalation}</dd>
              <dt>Settlement</dt>
              <dd>{c.settlementState}</dd>
              <dt>Exhaustion</dt>
              <dd>{c.exhaustion}</dd>
              <dt>Logistics</dt>
              <dd>{c.logistics}</dd>
            </dl>
            <small>
              STATED WAR GOALS · Strategic objectives, not confirmed world
              outcomes: {c.warGoals.join(' · ')}
            </small>
            {c.theaters.map((t) => (
              <p key={t.id}>
                {name(t.nationId)}: {t.posture} · allocation {t.allocation}% ·
                logistics {t.logistics} · supply pressure {t.supplyPressure} ·
                initiative {t.initiative} · advance {t.progress}%
              </p>
            ))}
            {c.campaigns.map((v) => (
              <p key={v.nationId + v.regionId}>
                {name(v.nationId)} campaign ·{' '}
                {world.regions.find((r) => r.id === v.regionId)?.name}:{' '}
                {v.progress}%
              </p>
            ))}
          </article>
        ))}
      <h3 className="panel-subtitle">Ongoing initiatives</h3>
      {world.initiatives
        .filter(
          (i) =>
            i.status === 'active' &&
            (i.visibility === 'public' || i.nationId === world.playerNationId),
        )
        .map((i) => (
          <article className="initiative-card" key={i.id}>
            <strong>{i.name}</strong>
            <small>
              {name(i.nationId)} · {i.kind}
            </small>
            <progress value={i.progress} max={100} />
            <small>
              {i.progress}% · {i.durationDays} days · effort {i.effort}/month ·
              invested {i.invested}
            </small>
            {i.blocker && (
              <p>
                {i.blocker} · {i.delays} delayed installments
              </p>
            )}
          </article>
        ))}
    </div>
  );
}
