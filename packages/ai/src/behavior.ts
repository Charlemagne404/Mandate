import type { WorldState, WorldCommand, NationId } from '@mandate/schemas';
const days = (a: string, b: string) =>
  (Date.parse(a) - Date.parse(b)) / 86400000;
export function repetitionIssue(
  w: WorldState,
  c: WorldCommand,
  playerActor: NationId | null,
): string | null {
  if (c.type === 'START_INITIATIVE' && c.initiative.nationId !== playerActor) {
    const i = c.initiative;
    const previous = w.initiatives.find(
      (v) =>
        v.nationId === i.nationId &&
        v.kind === i.kind &&
        v.targetNationId === i.targetNationId &&
        (v.status === 'active' ||
          days(w.date, v.completedDate ?? v.startDate) < 180),
    );
    if (previous)
      return `Equivalent ${i.kind} program active or cooling down: ${previous.id}`;
  }
  if (
    c.type === 'OPEN_NEGOTIATION' &&
    c.negotiation.proposerNationId !== playerActor
  ) {
    const n = c.negotiation;
    const previous = w.negotiations.find(
      (v) =>
        v.kind === n.kind &&
        [v.proposerNationId, v.recipientNationId].sort().join() ===
          [n.proposerNationId, n.recipientNationId].sort().join() &&
        (v.status === 'open' ||
          (['rejected', 'withdrawn', 'expired'].includes(v.status) &&
            days(w.date, v.responses.at(-1)?.date ?? v.expiresDate) < 180 &&
            v.terms.toLowerCase().replace(/[^a-z0-9]/g, '') ===
              n.terms.toLowerCase().replace(/[^a-z0-9]/g, ''))),
    );
    if (previous)
      return `Proposal repeats unresolved or recently failed terms: ${previous.id}; revise terms, seek a different partner, or wait`;
  }
  if (c.type === 'CONFLICT_ACTION') {
    const f = w.conflicts.find((f) => f.id === c.conflictId),
      n = w.nations.find((n) => n.id === c.nationId);
    if (
      f &&
      n &&
      ((c.stance === 'defend' && f.logistics >= 100) ||
        (c.stance === 'deescalate' && f.escalation === 0) ||
        (c.stance === 'mobilize' && n.stats.readiness >= 100) ||
        (c.stance === 'reinforce' &&
          f.logistics >= 100 &&
          n.stats.readiness >= 100))
    )
      return 'Strategic posture repeats a saturated indicator without a mechanical effect';
  }
  if (c.type === 'CRISIS_ACTION' && c.nationId !== playerActor) {
    const crisis = w.crises.find((v) => v.id === c.crisisId);
    const newTalk =
      c.move === 'talk' &&
      c.negotiationId &&
      !crisis?.negotiationIds.includes(c.negotiationId);
    if (
      crisis &&
      !newTalk &&
      ((c.move === 'talk' &&
        crisis.diplomaticBreakdown === 0 &&
        crisis.rhetoric === 0) ||
        (c.move === 'stand-down' && crisis.militaryPosture === 0) ||
        (c.move === 'warn' && crisis.rhetoric === 100) ||
        (c.move === 'freeze' && crisis.status === 'frozen'))
    )
      return 'Crisis posture repeats saturated pressure without new terms or a related negotiation; change approach or observe';
  }
  if (c.type === 'ADJUST_RELATION') {
    return 'Standalone relationship drift has no mechanical cooperation or hostility; use negotiation, obligation or conflict consequences';
  }
  return null;
}
export function classifyImportance(
  w: WorldState,
  text: string,
  targets: NationId[],
): 'low' | 'medium' | 'high' {
  if (
    /war|peace|ceasefire|alliance|basing|territor|ultimatum|attack|nuclear weapon/i.test(
      text,
    ) ||
    w.conflicts.some(
      (c) =>
        c.status === 'active' &&
        [...c.attackers, ...c.defenders].some((id) => targets.includes(id)),
    )
  )
    return 'high';
  return targets.length || /diplom|treaty|negotia/i.test(text)
    ? 'medium'
    : 'low';
}
