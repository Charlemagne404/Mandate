import type { WorldState } from '@mandate/schemas';
export function analyzeWorldBehavior(before: WorldState, after: WorldState) {
  const commands = after.commands.filter(
    (c) => !before.commands.some((old) => old.id === c.id),
  );
  const events = after.events
    .slice(before.events.length)
    .filter((e) => e.type !== 'ADVANCE_DATE');
  const activity: Record<string, number> = {};
  const signatures = new Map<string, number>();
  for (const { command: c } of commands) {
    const actor =
      c.type === 'START_INITIATIVE'
        ? c.initiative.nationId
        : c.type === 'OPEN_NEGOTIATION'
          ? c.negotiation.proposerNationId
          : 'nationId' in c
            ? c.nationId
            : null;
    if (actor) activity[actor] = (activity[actor] ?? 0) + 1;
    if (c.type === 'START_INITIATIVE') {
      const signature = [
        c.initiative.nationId,
        c.initiative.kind,
        c.initiative.targetNationId,
      ].join('|');
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }
  }
  const responses = commands
    .filter((c) => c.command.type === 'RESPOND_NEGOTIATION')
    .map((c) => c.command)
    .filter((c) => c.type === 'RESPOND_NEGOTIATION');
  const actors = Object.entries(activity).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const totalActions = actors.reduce((s, a) => s + a[1], 0);
  const playerInvolvementRatio = events.length
    ? events.filter((e) => e.nationIds.includes(after.playerNationId)).length /
      events.length
    : 0;
  const repeatedInitiatives = [...signatures].filter(([, count]) => count > 1);
  const completedGoals = after.goals.filter(
    (g) =>
      g.status === 'achieved' &&
      before.goals.find((old) => old.id === g.id)?.status !== 'achieved',
  ).length;
  const completedProjects = after.initiatives.filter(
    (i) =>
      i.status === 'completed' &&
      before.initiatives.find((old) => old.id === i.id)?.status !== 'completed',
  ).length;
  const breachedCommitments = after.commitments.filter(
    (c) =>
      c.status === 'breached' &&
      before.commitments.find((old) => old.id === c.id)?.status !== 'breached',
  ).length;
  const relationChanges = after.relations.map(
    (r) =>
      r.score -
      (before.relations.find(
        (old) => old.nationA === r.nationA && old.nationB === r.nationB,
      )?.score ?? 0),
  );
  const acceptanceRate = responses.length
    ? responses.filter((c) => c.move === 'accept').length / responses.length
    : null;
  const rejectionRate = responses.length
    ? responses.filter((c) => c.move === 'reject').length / responses.length
    : null;
  const suspicious: string[] = [];
  if (totalActions >= 10 && (actors[0]?.[1] ?? 0) / totalActions > 0.3)
    suspicious.push('One actor accounts for over 30% of committed actions');
  if (events.length >= 10 && playerInvolvementRatio > 0.8)
    suspicious.push('Over 80% of meaningful events involve the player');
  if (responses.length >= 5 && (acceptanceRate === 1 || rejectionRate === 1))
    suspicious.push(
      'Every negotiation is accepted or every negotiation is rejected',
    );
  const rapidRepeats = after.initiatives
    .filter(
      (i) =>
        i.startDate > before.date &&
        after.initiatives.some(
          (old) =>
            old.id !== i.id &&
            old.nationId === i.nationId &&
            old.kind === i.kind &&
            old.targetNationId === i.targetNationId &&
            old.startDate < i.startDate &&
            (Date.parse(i.startDate) -
              Date.parse(old.completedDate ?? old.startDate)) /
              86400000 <
              180,
        ),
    )
    .map((i) => i.id);
  if (rapidRepeats.length)
    suspicious.push('Equivalent initiatives restarted inside 180-day cooldown');
  if (
    after.revision - before.revision >= 25 &&
    after.goals.some(
      (g) =>
        !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
    ) &&
    !completedGoals
  )
    suspicious.push('No strategic goal completed in 25+ turns');
  if (
    relationChanges.filter((d) => d !== 0).length >= 5 &&
    relationChanges.every((d) => d <= 0)
  )
    suspicious.push('All changing relations deteriorated');
  return {
    meaningfulEvents: events.length,
    playerInvolvementRatio,
    actorActivity: activity,
    dominantActor: actors[0]?.[0] ?? null,
    dominantActorShare: totalActions ? (actors[0]?.[1] ?? 0) / totalActions : 0,
    repeatedInitiatives,
    rapidRepeats,
    completedGoals,
    completedProjects,
    breachedCommitments,
    acceptanceRate,
    rejectionRate,
    activeWars: after.conflicts.filter((c) => c.status === 'active').length,
    endedWars: after.conflicts.filter(
      (c) =>
        c.status === 'ended' &&
        before.conflicts.find((old) => old.id === c.id)?.status !== 'ended',
    ).length,
    relationDistribution: {
      negative: after.relations.filter((r) => r.score < 0).length,
      neutral: after.relations.filter((r) => r.score === 0).length,
      positive: after.relations.filter((r) => r.score > 0).length,
    },
    suspicious,
  };
}
