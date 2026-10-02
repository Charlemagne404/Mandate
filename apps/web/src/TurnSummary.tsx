import type { WorldState } from '@mandate/schemas';
export function TurnSummary({ world }: { world: WorldState }) {
  const turn = world.turns.at(-1);
  if (!turn) return null;
  const events = world.events.filter(
    (e) =>
      e.turnId === turn.id &&
      (e.visibility === 'public' || e.nationIds.includes(world.playerNationId)),
  );
  const relevant = events.filter((e) => e.type !== 'ADVANCE_DATE');
  const groups = [
    [
      'Your actions',
      relevant.filter((e) =>
        world.commands.some(
          (c) =>
            e.sourceCommandIds.includes(c.id) &&
            (('nationId' in c.command &&
              c.command.nationId === world.playerNationId) ||
              (c.command.type === 'START_INITIATIVE' &&
                c.command.initiative.nationId === world.playerNationId) ||
              (c.command.type === 'OPEN_NEGOTIATION' &&
                c.command.negotiation.proposerNationId ===
                  world.playerNationId)),
        ),
      ),
    ],
    [
      'Reactions',
      relevant.filter(
        (e) =>
          e.type === 'RESPOND_NEGOTIATION' &&
          e.nationIds.includes(world.playerNationId),
      ),
    ],
    [
      'Other important world developments',
      relevant.filter((e) => !e.nationIds.includes(world.playerNationId)),
    ],
    [
      'Ongoing changes',
      events.filter((e) =>
        /PROJECT_COMPLETED|COMMITMENT_|GOAL_|ADVANCE_DATE/.test(e.type),
      ),
    ],
  ] as const;
  return (
    <details className="turn-summary" open>
      <summary>
        Turn {turn.revision} · {turn.date}
      </summary>
      {groups.map(([label, entries]) => (
        <div key={label}>
          <strong>{label}</strong>
          {entries.length ? (
            <ul>
              {entries.slice(0, 4).map((e) => (
                <li key={e.id}>{e.title}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No new developments</p>
          )}
        </div>
      ))}
    </details>
  );
}
