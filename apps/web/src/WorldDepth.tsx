import { useEffect, useState } from 'react';
import type { WorldState, NationId } from '@mandate/schemas';
import { api } from './api.js';

type Briefing = Record<string, string[]>;
export function WorldDepth({
  world,
  onSelect,
  busy,
  operate,
}: {
  busy: boolean;
  operate: (endpoint: string, input?: object) => Promise<unknown>;
  world: WorldState;
  onSelect: (id: NationId) => void;
}) {
  const [terms, setTerms] = useState('');
  const [parties, setParties] = useState<string[]>([]);
  const [conferenceKind, setConferenceKind] = useState('security');
  const [sanctionTarget, setSanctionTarget] = useState('');
  const [sanctionSector, setSanctionSector] = useState('trade');
  const [sanctionIntensity, setSanctionIntensity] = useState(50);
  const [sanctionReason, setSanctionReason] = useState('');
  const [peaceConflict, setPeaceConflict] = useState('');
  const act = (command: object) =>
    void operate('/api/world-action', { command });
  const [briefing, setBriefing] = useState<Briefing>({});
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('commitments');
  const [answer, setAnswer] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void api<Briefing>('/api/briefing')
      .then((b) => {
        if (live) setBriefing(b);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [world.revision, world.saveId]);
  const known = (c: {
    visibility: string;
    participants?: NationId[];
    parties?: NationId[];
  }) =>
    c.visibility === 'public' ||
    [...(c.participants ?? []), ...(c.parties ?? [])].includes(
      world.playerNationId,
    );
  const name = (id: NationId) => world.nations.find((n) => n.id === id)?.name;
  const crises = world.crises
    .filter((c) => c.status !== 'resolved' && known(c))
    .sort((a, b) => b.severity - a.severity);
  return (
    <section className="depth-workspace" aria-label="World overview">
      <div className="section-head">
        <h2>World overview</h2>
        <span>{world.date}</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Ask your strategic advisor</summary>
        <label>
          Strategic question
          <select
            aria-label="Strategic question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          >
            {Object.entries({
              commitments: 'What have we promised?',
              threats: 'Who shows hostility toward us?',
              'stalled-goals': 'Which goals are stalled?',
              refusals: 'Why are partners refusing?',
              dependencies: 'Who depends on us?',
              escalation: 'Where is escalation most likely?',
              'project-load': 'Are projects overloading us?',
              'recent-world': 'What changed over five turns?',
            }).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            void api<{ facts: string[] }>(`/api/advisor/${question}`)
              .then((r) => setAnswer(r.facts))
              .catch((e) => setError(String(e)))
          }
        >
          Consult advisor
        </button>
        <div aria-label="Advisor answer">
          {answer.map((fact, i) => (
            <p key={i}>{fact}</p>
          ))}
        </div>
      </details>
      <details open>
        <summary>Government briefing</summary>
        {Object.entries(briefing).map(([section, facts]) => (
          <div className="briefing-section" key={section}>
            <h3>{section.toUpperCase()}</h3>
            {facts.length ? (
              facts.slice(0, 4).map((f, i) => <p key={i}>{f}</p>)
            ) : (
              <small>No immediate developments</small>
            )}
          </div>
        ))}
      </details>
      <h3>Persistent crises</h3>
      {!crises.length && <p className="muted">No active crises recorded</p>}
      {crises.slice(0, 8).map((c) => (
        <article className="crisis-card" key={c.id}>
          <h3>{c.title}</h3>
          <strong>
            {c.status} · severity {c.severity}/100
          </strong>
          <meter
            min={0}
            max={100}
            value={c.severity}
            aria-label={`${c.title} escalation`}
          />
          <div className="event-actors">
            {c.participants.map((id) => (
              <button key={id} onClick={() => onSelect(id)}>
                {name(id)}
              </button>
            ))}
          </div>
          <p>
            Military posture {c.militaryPosture} · rhetoric {c.rhetoric} ·
            diplomatic breakdown {c.diplomaticBreakdown}
          </p>
          {!world.observerMode &&
            c.participants.includes(world.playerNationId) && (
              <div className="inline-form">
                {['warn', 'mobilize', 'talk', 'stand-down'].map((move) => (
                  <button
                    key={move}
                    disabled={busy}
                    onClick={() =>
                      act({
                        type: 'CRISIS_ACTION',
                        crisisId: c.id,
                        nationId: world.playerNationId,
                        move,
                      })
                    }
                  >
                    {move}
                  </button>
                ))}
              </div>
            )}
          <details>
            <summary>Demands, red lines & history</summary>
            {c.issues.map((issue, i) => (
              <p key={i}>{issue}</p>
            ))}
            {c.demands.map((d, i) => (
              <p key={i}>
                {name(d.nationId)}: {d.text} ·{' '}
                {d.satisfied ? 'satisfied' : 'unresolved'}
                {d.condition.kind !== 'acknowledgment' && (
                  <small> · requires {d.condition.kind}</small>
                )}
                {!d.satisfied &&
                  d.condition.kind === 'acknowledgment' &&
                  d.nationId !== world.playerNationId &&
                  c.participants.includes(world.playerNationId) &&
                  !world.observerMode && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act({
                          type: 'CRISIS_ACTION',
                          crisisId: c.id,
                          nationId: world.playerNationId,
                          move: 'concede',
                          demandIndex: i,
                        })
                      }
                    >
                      Concede demand
                    </button>
                  )}
              </p>
            ))}
            {c.redLines.map((r, i) => (
              <p key={i}>
                <strong>Red line / {name(r.nationId)}</strong>: {r.text}
              </p>
            ))}
            {c.deadline && <p>Deadline {c.deadline}</p>}
            {c.negotiationIds.map((id) => (
              <p key={id}>
                Talks: {world.negotiations.find((n) => n.id === id)?.topic}
              </p>
            ))}
            {c.history.slice(-10).map((h, i) => (
              <p key={i}>
                {h.date}: {h.action} · severity {h.severity}
              </p>
            ))}
          </details>
        </article>
      ))}
      <h3>Multilateral bargaining</h3>
      {!world.observerMode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act({
              type: 'OPEN_CONFERENCE',
              conference: {
                id: `conference:${crypto.randomUUID()}`,
                title: 'Regional security conference',
                proposer: world.playerNationId,
                parties: [
                  ...new Set([
                    world.playerNationId,
                    ...parties,
                    ...(conferenceKind === 'peace'
                      ? world.conflicts
                          .filter((c) => c.id === peaceConflict)
                          .flatMap((c) => [...c.attackers, ...c.defenders])
                      : []),
                  ]),
                ],
                kind: conferenceKind,
                ...(conferenceKind === 'sanctions'
                  ? { sanctionTarget, sanctionSector, sanctionIntensity }
                  : {}),
                ...(conferenceKind === 'peace'
                  ? { conflictId: peaceConflict }
                  : {}),
                terms,
                createdDate: world.date,
                expiresDate: new Date(Date.parse(world.date) + 180 * 86400000)
                  .toISOString()
                  .slice(0, 10),
              },
            });
          }}
        >
          <label>
            Conference purpose
            <select
              aria-label="Conference purpose"
              value={conferenceKind}
              onChange={(e) => setConferenceKind(e.target.value)}
            >
              {['security', 'trade', 'mediation', 'sanctions', 'peace'].map(
                (kind) => (
                  <option key={kind}>{kind}</option>
                ),
              )}
            </select>
          </label>
          {conferenceKind === 'peace' && (
            <label>
              War to settle
              <select
                aria-label="War to settle"
                value={peaceConflict}
                onChange={(e) => setPeaceConflict(e.target.value)}
              >
                <option value="">Choose an active conflict</option>
                {world.conflicts
                  .filter((c) => c.status === 'active')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <small>
                All belligerents join alongside selected mediators. This
                conference offers peace without territorial transfers.
              </small>
            </label>
          )}
          {conferenceKind === 'sanctions' && (
            <label>
              Coalition sanctions target
              <select
                aria-label="Coalition sanctions target"
                value={sanctionTarget}
                onChange={(e) => setSanctionTarget(e.target.value)}
              >
                <option value="">Choose target</option>
                {world.nations
                  .filter(
                    (n) =>
                      n.id !== world.playerNationId && !parties.includes(n.id),
                  )
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Conference partners
            <select
              multiple
              aria-label="Conference partners"
              value={parties}
              onChange={(e) =>
                setParties(Array.from(e.target.selectedOptions, (o) => o.value))
              }
            >
              {world.nations
                .filter((n) => n.id !== world.playerNationId)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Conference terms
            <textarea
              aria-label="Conference terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={2}
            />
          </label>
          <button
            disabled={
              busy ||
              (conferenceKind !== 'peace' && parties.length < 2) ||
              parties.length > 19 ||
              !terms.trim() ||
              (conferenceKind === 'peace' && !peaceConflict) ||
              (conferenceKind === 'sanctions' && !sanctionTarget)
            }
          >
            {conferenceKind === 'security'
              ? 'Convene security talks'
              : 'Convene conference'}
          </button>
        </form>
      )}
      {world.conferences
        .filter((c) => known(c))
        .slice(-8)
        .reverse()
        .map((c) => (
          <article className="crisis-card" key={c.id}>
            <h3>{c.title}</h3>
            <strong>
              {c.status} · round {c.round + 1}
            </strong>
            <p>{c.terms}</p>
            <small>Expires {c.expiresDate}</small>
            {c.parties.map((id) => (
              <p key={id}>
                {name(id)}:{' '}
                {c.responses
                  .filter((r) => r.nationId === id && r.round === c.round)
                  .at(-1)?.move ?? 'pending'}
              </p>
            ))}
            {c.status === 'open' &&
              c.parties.includes(world.playerNationId) &&
              !world.observerMode && (
                <div className="inline-form">
                  {['accept', 'reject', 'delay', 'abstain', 'withdraw'].map(
                    (move) => (
                      <button
                        key={move}
                        disabled={busy}
                        onClick={() =>
                          act({
                            type: 'RESPOND_CONFERENCE',
                            conferenceId: c.id,
                            nationId: world.playerNationId,
                            move,
                            message: `Our government chooses ${move} for the current terms`,
                          })
                        }
                      >
                        {move}
                      </button>
                    ),
                  )}
                </div>
              )}
          </article>
        ))}
      <h3>Active wars</h3>
      {world.conflicts
        .filter((c) => c.status === 'active')
        .slice(0, 5)
        .map((c) => (
          <p key={c.id}>
            {c.name} · {c.settlementState} · exhaustion {c.exhaustion}
          </p>
        ))}
      <h3>Economic pressure</h3>
      {!world.observerMode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act({
              type: 'IMPOSE_SANCTION',
              sanction: {
                id: `sanction:${crypto.randomUUID()}`,
                issuer: world.playerNationId,
                target: sanctionTarget,
                sector: sanctionSector,
                intensity: sanctionIntensity,
                startDate: world.date,
                reason: sanctionReason,
              },
            });
          }}
        >
          <label>
            Sanctions target
            <select
              aria-label="Sanctions target"
              value={sanctionTarget}
              onChange={(e) => setSanctionTarget(e.target.value)}
            >
              <option value="">Choose target</option>
              {world.nations
                .filter((n) => n.id !== world.playerNationId)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sanctions sector
            <select
              aria-label="Sanctions sector"
              value={sanctionSector}
              onChange={(e) => setSanctionSector(e.target.value)}
            >
              {['trade', 'finance', 'energy', 'strategic', 'military'].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Sanctions intensity
            <input
              aria-label="Sanctions intensity"
              type="number"
              min={1}
              max={100}
              value={sanctionIntensity}
              onChange={(e) => setSanctionIntensity(Number(e.target.value))}
            />
          </label>
          <label>
            Sanctions purpose
            <input
              aria-label="Sanctions purpose"
              value={sanctionReason}
              onChange={(e) => setSanctionReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !sanctionTarget ||
              !sanctionReason.trim() ||
              sanctionIntensity < 1 ||
              sanctionIntensity > 100
            }
          >
            Apply sanctions
          </button>
          <small>
            Exposure and alternatives determine economic effects. Sanctioning
            states also pay a cost.
          </small>
        </form>
      )}
      {world.sanctions
        .filter(
          (s) =>
            s.status === 'active' &&
            (s.issuer === world.playerNationId ||
              s.target === world.playerNationId),
        )
        .map((s) => (
          <p key={s.id}>
            {name(s.issuer)} → {name(s.target)}: {s.sector}, {s.intensity}%
            {s.issuer === world.playerNationId && !world.observerMode && (
              <button
                disabled={busy}
                onClick={() =>
                  act({
                    type: 'LIFT_SANCTION',
                    sanctionId: s.id,
                    nationId: world.playerNationId,
                  })
                }
              >
                Lift sanctions
              </button>
            )}
          </p>
        ))}
    </section>
  );
}

export function BranchComparison({ world }: { world: WorldState }) {
  const [snapshots, setSnapshots] = useState<
    Array<{
      id: string;
      name: string;
      date: string;
      revision: number;
      saveId: string;
      kind: string;
      parentSaveId: string | null;
      parentRevision: number | null;
    }>
  >([]);
  const [a, setA] = useState(''),
    [b, setB] = useState('');
  const [changes, setChanges] = useState<
    Array<{
      category: string;
      id: string;
      name: string;
      before: unknown;
      after: unknown;
    }>
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<typeof snapshots>('/api/timelines')
      .then(setSnapshots)
      .catch((e) => setError(String(e)));
  }, []);
  const treeSnapshots = snapshots.filter(
    (snapshot) => !['autosave', 'undo'].includes(snapshot.kind),
  );
  const depth = (snapshot: (typeof snapshots)[number]) => {
    let level = 0;
    let current = snapshot;
    const seen = new Set<string>();
    while (current.parentSaveId && current.parentRevision !== null) {
      const key = `${current.parentSaveId}:${current.parentRevision}`;
      if (seen.has(key)) break;
      seen.add(key);
      const parent = snapshots.find(
        (candidate) =>
          candidate.saveId === current.parentSaveId &&
          candidate.revision === current.parentRevision,
      );
      if (!parent) break;
      level++;
      current = parent;
    }
    return level;
  };
  const labelFor = (category: string) =>
    ({
      territory: 'Borders and control',
      polities: 'Independent states',
      conflicts: 'Wars',
      treaties: 'Treaties',
      government: 'Governments',
      'major-events': 'Major events',
      capacity: 'National capacity',
      crises: 'Crises',
      relations: 'Diplomatic relations',
      initiatives: 'National projects',
    })[category] ?? category;
  const summary = (category: string, value: unknown): string => {
    if (value === null) return 'Not present on this branch';
    if (category === 'major-events') {
      const events = value as Array<{ date: string; title: string }>;
      return events.length
        ? events
            .slice(-5)
            .map((event) => `${event.date} · ${event.title}`)
            .join(' / ')
        : 'No major events recorded';
    }
    const item = value as Record<string, unknown>;
    const name = (id: unknown) =>
      typeof id === 'string' && id.startsWith('nation:')
        ? (world.nations.find((nation) => nation.id === id)?.name ?? id)
        : String(id ?? 'unknown');
    if (category === 'territory')
      return `${name(item.owner)} owns it · ${name(item.control)} controls it`;
    if (category === 'polities')
      return item.status === 'present'
        ? `Exists · ${JSON.stringify(item.government)}`
        : 'Absent';
    if (category === 'government') {
      const government = item.government as
        { type?: string; ideology?: string } | undefined;
      return [
        item.leader ? `Leader: ${item.leader}` : '',
        government ? `${government.type} · ${government.ideology}` : '',
      ]
        .filter(Boolean)
        .join(' / ');
    }
    if (category === 'conflicts')
      return `${item.status ?? 'absent'}${item.escalation === undefined ? '' : ` · escalation ${item.escalation}`}${item.settlement ? ` · ${item.settlement}` : ''}`;
    if (category === 'treaties')
      return `${item.status ?? 'absent'}${item.terms ? ` · ${item.terms}` : ''}`;
    return Object.entries(item)
      .map(
        ([key, entry]) =>
          `${key}: ${typeof entry === 'object' ? JSON.stringify(entry) : entry}`,
      )
      .join(' · ');
  };
  return (
    <section className="depth-workspace">
      <h2>Compare timelines</h2>
      <p>Branch before a major choice, then compare how history diverged.</p>
      <div className="timeline-tree" aria-label="Timeline tree">
        {treeSnapshots.length ? (
          treeSnapshots.map((snapshot) => (
            <div
              className="timeline-tree-row"
              key={snapshot.id}
              style={{
                marginInlineStart: `${Math.min(8, depth(snapshot)) * 14}px`,
              }}
            >
              <span aria-hidden="true">{depth(snapshot) ? '└' : '●'}</span>
              <strong>{snapshot.name}</strong>
              <small>
                {snapshot.date} · turn {snapshot.revision}
              </small>
            </div>
          ))
        ) : (
          <p className="muted">
            Save a point or branch this timeline to begin.
          </p>
        )}
      </div>
      {[
        ['A', a, setA],
        ['B', b, setB],
      ].map(([label, value, setter]) => (
        <label key={String(label)}>
          Timeline {String(label)}
          <select
            aria-label={`Timeline ${label}`}
            value={String(value)}
            onChange={(e) => (setter as typeof setA)(e.target.value)}
          >
            <option value="">Choose snapshot</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.date} · turn {s.revision}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        disabled={!a || !b}
        onClick={() => {
          setError('');
          void api<{ differences: typeof changes }>('/api/timelines/compare', {
            method: 'POST',
            body: JSON.stringify({ a, b }),
          })
            .then((r) => setChanges(r.differences))
            .catch((e) => setError(String(e)));
        }}
      >
        Compare branches
      </button>
      {error && <p role="alert">{error}</p>}
      {changes.map((c) => (
        <article className="crisis-card" key={c.category + c.id}>
          <h3>{c.name}</h3>
          <small>{labelFor(c.category)}</small>
          <p>
            <strong>Timeline A · </strong>
            {summary(c.category, c.before)}
          </p>
          <p>
            <strong>Timeline B · </strong>
            {summary(c.category, c.after)}
          </p>
        </article>
      ))}
    </section>
  );
}
