import { EventId } from '@mandate/schemas';
import type {
  WorldState,
  CommandEnvelope,
  TurnId,
  Event,
} from '@mandate/schemas';
export function changeEvents(
  before: Pick<
    WorldState,
    'initiatives' | 'goals' | 'commitments' | 'crises' | 'tenures' | 'date'
  >,
  after: WorldState,
  envelope: CommandEnvelope,
  turnId: TurnId,
): Event[] {
  const changes: Event[] = [];
  const add = (
    title: string,
    nationIds: Event['nationIds'],
    visibility: Event['visibility'],
    type: string,
  ) =>
    changes.push({
      id: EventId.parse(
        `event:${envelope.id.slice(8)}-change-${changes.length}`,
      ),
      title: title.slice(0, 160),
      nationIds,
      visibility,
      type,
      importance: 60,
      regionIds: [],
      treatyIds: [],
      conflictIds: [],
      topics: [type.toLowerCase()],
      status: 'resolved',
      effects: [],
      date: after.date,
      turnId,
      sourceCommandIds: [envelope.id],
    });
  const name = (id: string) => after.nations.find((n) => n.id === id)!.name;
  for (const c of after.crises) {
    const old = before.crises.find((v) => v.id === c.id);
    if (
      old &&
      ((c.status === 'resolved' && old.status !== 'resolved') ||
        Math.floor(c.severity / 20) !== Math.floor(old.severity / 20))
    )
      add(
        `${c.title}: ${c.status}, severity ${c.severity}`,
        c.participants,
        c.visibility,
        'CRISIS_DEVELOPMENT',
      );
  }
  for (const t of after.tenures) {
    const old = before.tenures.find((v) => v.id === t.id);
    if (old && t.outcomes.length !== old.outcomes.length)
      add(
        `${name(t.nationId)} election: ${t.incumbent} ${t.outcomes.at(-1)?.incumbentRetained ? 'retained' : 'takes office'}`,
        [t.nationId],
        'public',
        'ELECTION_OUTCOME',
      );
  }
  for (const i of after.initiatives)
    if (
      i.status === 'completed' &&
      before.initiatives.find((old) => old.id === i.id)?.status === 'active'
    )
      add(
        `${name(i.nationId)} completes ${i.name}`,
        [i.nationId],
        i.visibility,
        'PROJECT_COMPLETED',
      );
  for (const c of after.commitments) {
    const old = before.commitments.find((o) => o.id === c.id);
    if (old && old.status !== c.status)
      add(
        `${name(c.issuer)}: ${c.status} ${c.type} obligation`,
        [c.issuer, ...c.recipients],
        c.visibility,
        'COMMITMENT_' + c.status.toUpperCase(),
      );
    else if (
      c.status === 'active' &&
      c.dueDate &&
      Date.parse(before.date) < Date.parse(c.dueDate) - 30 * 86400000 &&
      Date.parse(after.date) >= Date.parse(c.dueDate) - 30 * 86400000
    )
      add(
        `${name(c.issuer)}: ${c.type} obligation due ${c.dueDate}`,
        [c.issuer, ...c.recipients],
        c.visibility,
        'COMMITMENT_DUE',
      );
  }
  for (const g of after.goals)
    if (
      ['achieved', 'failed'].includes(g.status) &&
      before.goals.find((old) => old.id === g.id)?.status !== g.status
    )
      add(
        `${name(g.nationId)}: ${g.status} goal ${g.title}`,
        [g.nationId],
        g.visibility,
        'GOAL_' + g.status.toUpperCase(),
      );
  return changes.sort(
    (a, b) =>
      Number(b.nationIds.includes(after.playerNationId)) -
      Number(a.nationIds.includes(after.playerNationId)),
  );
}
