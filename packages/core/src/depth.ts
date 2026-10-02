import { evaluateGoal } from './continuity.js';
import { Relation } from '@mandate/schemas';
import type {
  WorldState,
  NationId,
  Goal,
  Negotiation,
  Commitment,
} from '@mandate/schemas';
import { requireDomain } from './errors.js';

export const liveGoal = (g: Goal) =>
  !['achieved', 'abandoned', 'failed', 'superseded'].includes(g.status);
const clamp = (v: number) => Math.max(0, Math.min(100, v));
export function relationshipEffect(
  w: WorldState,
  a: NationId,
  b: NationId,
  delta: number,
  trust: number,
  cause: string,
  visibility: 'public' | 'private' = 'public',
  date = w.date,
) {
  const pair = [a, b].sort();
  let r = w.relations.find(
    (r) => r.nationA === pair[0] && r.nationB === pair[1],
  );
  if (!r) {
    r = Relation.parse({ nationA: pair[0], nationB: pair[1], score: 0 });
    w.relations.push(r);
  }
  const oldScore = r.score,
    oldTrust = r.trust;
  r.score = Math.max(-100, Math.min(100, r.score + delta));
  r.trust = clamp(r.trust + trust);
  r.tension = clamp(r.tension - Math.sign(delta));
  r.factors = [
    ...r.factors.slice(-39),
    {
      date,
      cause,
      scoreDelta: r.score - oldScore,
      trustDelta: r.trust - oldTrust,
      visibility,
    },
  ];
  if (trust < -5) r.grievances = [...r.grievances.slice(-19), cause];
}
export function validateObligations(w: WorldState, n: Negotiation) {
  const parties = [n.proposerNationId, n.recipientNationId];
  requireDomain(
    new Set(n.obligations.map((o) => JSON.stringify(o))).size ===
      n.obligations.length,
    'Duplicate structured obligations',
  );
  for (const o of n.obligations) {
    requireDomain(
      parties.includes(o.issuer) &&
        o.recipients.every((id) => parties.includes(id) && id !== o.issuer) &&
        new Set(o.recipients).size === o.recipients.length,
      'Obligation parties must be negotiation participants',
    );
    requireDomain(
      !o.dueDate || o.dueDate > w.date,
      'Obligation deadline must be future dated',
    );
    requireDomain(
      !o.expiry || o.expiry > w.date,
      'Obligation expiry must be future dated',
    );
    requireDomain(
      !o.expiry || !o.dueDate || o.expiry >= o.dueDate,
      'Obligation expires before due date',
    );
    requireDomain(
      o.condition.kind === 'restraint'
        ? o.type === 'nonaggression'
        : ['aid', 'project'].includes(o.type),
      'Only mechanically represented obligations can be agreed',
    );
    requireDomain(
      o.type !== 'aid' ||
        (o.condition.kind === 'project' &&
          o.condition.initiativeKind === 'aid'),
      'Aid requires an aid project condition',
    );
    requireDomain(
      o.type !== 'project' ||
        (o.condition.kind === 'project' &&
          o.condition.initiativeKind !== 'aid'),
      'Project pledge requires domestic project condition',
    );
  }
}
export function updateCommitments(w: WorldState, date: string) {
  const allocated = new Map<string, number>();
  for (const c of w.commitments)
    for (const d of c.deliveries)
      allocated.set(
        d.initiativeId,
        (allocated.get(d.initiativeId) ?? 0) + d.investment,
      );
  for (const c of [...w.commitments].sort(
    (a, b) =>
      a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id),
  )) {
    if (c.status !== 'active') continue;
    let status: Commitment['status'] = 'active';
    let reason = '';
    if (c.condition.kind === 'restraint') {
      const attack = w.conflicts.some(
        (f) =>
          f.status === 'active' &&
          f.attackers.includes(c.issuer) &&
          f.defenders.some((id) => c.recipients.includes(id)),
      );
      if (attack) {
        status = 'breached';
        reason = 'Issuer attacked a recipient contrary to agreed restraint';
      } else if (c.expiry && date >= c.expiry) {
        status = 'fulfilled';
        reason = 'Restraint maintained through agreed expiry';
      }
    } else {
      const condition = c.condition;
      const completed = w.initiatives.filter(
        (i) =>
          i.nationId === c.issuer &&
          i.startDate >= c.createdDate &&
          i.status === 'completed' &&
          i.kind === condition.initiativeKind &&
          (c.type !== 'aid' ||
            (i.targetNationId && c.recipients.includes(i.targetNationId))),
      );
      let supplied = c.deliveries.reduce((s, d) => s + d.investment, 0);
      for (const i of completed.sort((a, b) => a.id.localeCompare(b.id))) {
        const available = i.invested - (allocated.get(i.id) ?? 0);
        const investment = Math.min(
          available,
          condition.minimumInvestment - supplied,
        );
        if (investment > 0) {
          const existing = c.deliveries.find((d) => d.initiativeId === i.id);
          if (existing) existing.investment += investment;
          else c.deliveries.push({ initiativeId: i.id, investment });
          supplied += investment;
          allocated.set(i.id, (allocated.get(i.id) ?? 0) + investment);
        }
      }
      if (supplied >= condition.minimumInvestment) {
        status = 'fulfilled';
        reason = 'Completed funded projects meet the agreed investment';
      } else if (c.dueDate && date >= c.dueDate) {
        status = 'breached';
        reason =
          'Agreed delivery deadline elapsed without completed investment';
      } else if (c.expiry && date >= c.expiry) {
        status = 'expired';
        reason = 'Unfulfilled obligation expired';
      }
    }
    if (status !== 'active') {
      c.status = status;
      c.history.push({ date, status, reason });
      for (const recipient of c.recipients)
        relationshipEffect(
          w,
          c.issuer,
          recipient,
          status === 'fulfilled' ? 4 : status === 'breached' ? -8 : 0,
          status === 'fulfilled' ? 8 : status === 'breached' ? -15 : 0,
          `${c.id}: ${reason}`,
          c.visibility,
          date,
        );
      if (status === 'breached') {
        const n = w.nations.find((n) => n.id === c.issuer)!;
        n.stats.legitimacy = clamp(
          n.stats.legitimacy - (c.strength === 'binding' ? 3 : 1),
        );
      }
    }
  }
}
export function updateDepth(w: WorldState, date: string) {
  updateCommitments(w, date);
  for (const g of [...w.goals].sort(
    (a, b) => Number(b.parentGoalId !== null) - Number(a.parentGoalId !== null),
  )) {
    if (!liveGoal(g)) continue;
    const n = w.nations.find((n) => n.id === g.nationId)!;
    const evidence: string[] = [];
    const evaluated = evaluateGoal(w, g);
    let progress = evaluated.progress;
    evidence.push(...evaluated.evidence);
    if (g.signals.length) {
      let sum = 0,
        weights = 0;
      for (const signal of g.signals) {
        const current = n.stats[signal.stat];
        const fraction =
          (current - signal.baseline) / (signal.target - signal.baseline);
        sum += clamp(Math.floor(fraction * 100)) * signal.weight;
        weights += signal.weight;
        evidence.push(
          `${signal.stat}: ${signal.baseline} → ${current}; target ${signal.target}`,
        );
      }
      progress = Math.floor(sum / weights);
    }
    const children = w.goals.filter((child) => child.parentGoalId === g.id);
    if (children.length)
      progress = Math.floor(
        children.reduce((s, child) => s + child.progress, 0) / children.length,
      );
    const threats = w.conflicts.filter(
      (c) => c.status === 'active' && c.defenders.includes(n.id),
    );
    const blockers = [
      ...(n.stats.stability < 35
        ? ['Domestic instability limits execution']
        : []),
      ...(n.stats.treasury < 2 ? ['Insufficient treasury for investment'] : []),
    ];
    const old = g.progress;
    const elapsed = Math.max(
      0,
      (Date.parse(date) - Date.parse(g.updatedDate)) / 86400000,
    );
    g.stalledDays = progress > old ? 0 : g.stalledDays + elapsed;
    g.pressure = clamp(
      Math.floor(g.stalledDays / 30) * Math.ceil(g.priority / 20),
    );
    const competing = w.goals
      .filter(
        (other) =>
          other.nationId === n.id &&
          other.id !== g.id &&
          liveGoal(other) &&
          other.priority > g.priority &&
          other.kind !== g.kind,
      )
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
    g.deferredToGoalId =
      competing && (n.stats.treasury < 10 || n.stats.stability < 40)
        ? competing.id
        : null;
    if (g.deferredToGoalId)
      blockers.push(
        `Resources reserved for higher priority goal ${g.deferredToGoalId}`,
      );
    if (g.pressure >= 30)
      g.strategyReview =
        'Stalled priority requires changed means, partner, funded subgoal or explicit abandonment';
    g.progress = progress;
    g.evidence = [
      ...new Set([
        ...g.evidence.filter((e) => !/^.*: -?\d+ →/.test(e)),
        ...evidence,
      ]),
    ].slice(-20);
    g.blockers = blockers;
    const cancelledProject =
      g.evaluation.kind === 'project' &&
      w.initiatives.some(
        (i) =>
          i.id ===
            (g.evaluation.kind === 'project'
              ? g.evaluation.initiativeId
              : '') && i.status === 'cancelled',
      );
    g.status =
      progress === 100
        ? 'achieved'
        : cancelledProject || (g.deadline && date >= g.deadline)
          ? 'failed'
          : blockers.length
            ? 'blocked'
            : threats.length
              ? 'threatened'
              : progress > old
                ? 'advancing'
                : progress < old
                  ? 'stalled'
                  : g.signals.length || children.length
                    ? 'stalled'
                    : 'active';
    g.updatedDate = date;
    if (!liveGoal(g))
      g.strategyReview = `${g.status}: reassess related strategy and reconcile unfinished subgoals`;
  }
  for (const g of w.goals) {
    const parent = w.goals.find((p) => p.id === g.parentGoalId);
    if (parent && !liveGoal(parent) && liveGoal(g)) {
      g.status = 'superseded';
      g.updatedDate = date;
      g.strategyReview = `Parent ${parent.id} is ${parent.status}`;
    }
  }
}

export function executionCapacity(w: WorldState, nationId: NationId) {
  const n = w.nations.find((n) => n.id === nationId)!;
  return Math.max(
    1,
    Math.floor((n.stats.fiscal + n.stats.industrial + n.stats.stability) / 30),
  );
}
