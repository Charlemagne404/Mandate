import { applyContinuityCommand } from './continuity.js';
import { relationshipEffect, liveGoal } from './depth.js';
import type { WorldCommand, WorldState } from '@mandate/schemas';
import { requireDomain } from './errors.js';
import { advanceSimulation } from './simulation.js';
import { applyAlphaCommand, endConflict, isSettlement } from './mechanics.js';

export function applyCommand(
  w: WorldState,
  c: WorldCommand,
  reason = 'Canonical command',
): void {
  const nation = (id: string) => {
    const n = w.nations.find((n) => n.id === id);
    requireDomain(n, `Unknown nation: ${id}`);
    return n;
  };
  const region = (id: string) => {
    const r = w.regions.find((r) => r.id === id);
    requireDomain(r, `Unknown region: ${id}`);
    return r;
  };
  const treaty = (id: string) => {
    const t = w.treaties.find((t) => t.id === id);
    requireDomain(t?.status === 'active', `No active treaty: ${id}`);
    return t;
  };
  const conflict = (id: string) => {
    const v = w.conflicts.find((v) => v.id === id);
    requireDomain(v?.status === 'active', `No active conflict: ${id}`);
    return v;
  };
  if (applyContinuityCommand(w, c) || applyAlphaCommand(w, c)) return;
  switch (c.type) {
    case 'SET_STRATEGY':
      nation(c.nationId).strategy = structuredClone(c.strategy);
      return;
    case 'DISCLOSE_INFORMATION':
    case 'THEATER_ACTION':
    case 'OPEN_CRISIS':
    case 'CRISIS_ACTION':
    case 'SET_ECONOMIC_LINK':
    case 'IMPOSE_SANCTION':
    case 'LIFT_SANCTION':
    case 'OPEN_CONFERENCE':
    case 'RESPOND_CONFERENCE':
    case 'SCHEDULE_ELECTION':
    case 'REVISE_GOAL_EVALUATION':
    case 'START_INITIATIVE':
    case 'CANCEL_INITIATIVE':
    case 'OPEN_NEGOTIATION':
    case 'RESPOND_NEGOTIATION':
    case 'CREATE_ORGANIZATION':
    case 'SET_ORGANIZATION_MEMBERSHIP':
    case 'CONFLICT_ACTION':
    case 'APPLY_DOMESTIC_PRESSURE':
      return;
    case 'ADJUST_RELATION': {
      nation(c.nationA);
      nation(c.nationB);
      requireDomain(c.nationA !== c.nationB, 'Self relations are invalid');
      // Keep strict bounds for debug commands; gameplay effects use bounded deterministic causes.
      const current =
        w.relations.find(
          (r) =>
            [r.nationA, r.nationB].includes(c.nationA) &&
            [r.nationA, r.nationB].includes(c.nationB),
        )?.score ?? 0;
      requireDomain(
        current + c.delta >= -100 && current + c.delta <= 100,
        'Relation outside bounds',
      );
      relationshipEffect(w, c.nationA, c.nationB, c.delta, 0, reason);
      return;
    }
    case 'ADJUST_NATION_STAT':
      nation(c.nationId).stats[c.stat] += c.delta;
      return;
    case 'TRANSFER_CONTROL':
      nation(c.nationId);
      region(c.regionId).controllerNationId = c.nationId;
      return;
    case 'TRANSFER_OWNERSHIP':
      nation(c.nationId);
      region(c.regionId).ownerNationId = c.nationId;
      return;
    case 'ADD_CLAIM': {
      nation(c.nationId);
      const r = region(c.regionId);
      requireDomain(!r.claims.includes(c.nationId), 'Claim already exists');
      r.claims.push(c.nationId);
      return;
    }
    case 'REMOVE_CLAIM': {
      nation(c.nationId);
      const r = region(c.regionId);
      requireDomain(r.claims.includes(c.nationId), 'Claim does not exist');
      r.claims = r.claims.filter((id) => id !== c.nationId);
      return;
    }
    case 'CREATE_TREATY':
      requireDomain(c.treaty.status === 'active', 'New treaty must be active');
      requireDomain(
        !isSettlement(c.treaty.kind) && c.treaty.conflictId === null,
        'Settlement treaties require accepted negotiation',
      );
      requireDomain(
        !w.treaties.some((t) => t.id === c.treaty.id),
        'Treaty ID already exists',
      );
      c.treaty.parties.forEach(nation);
      w.treaties.push(structuredClone(c.treaty));
      return;
    case 'UPDATE_TREATY':
      requireDomain(
        !isSettlement(treaty(c.treatyId).kind),
        'Settlement terms are fixed by the mechanic',
      );
      treaty(c.treatyId).terms = c.terms;
      return;
    case 'END_TREATY': {
      const t = treaty(c.treatyId);
      t.status = 'ended';
      if (t.kind === 'ceasefire') {
        const conflict = w.conflicts.find((v) => v.id === t.conflictId)!;
        if (conflict.status === 'active') conflict.settlementState = 'fighting';
      }
      return;
    }
    case 'START_CONFLICT':
      requireDomain(
        c.conflict.settlementState === 'fighting',
        'New conflict must start fighting',
      );
      requireDomain(
        c.conflict.status === 'active',
        'New conflict must be active',
      );
      requireDomain(
        !w.conflicts.some((v) => v.id === c.conflict.id),
        'Conflict ID already exists',
      );
      [...c.conflict.attackers, ...c.conflict.defenders].forEach(nation);
      w.conflicts.push(structuredClone(c.conflict));
      return;
    case 'UPDATE_CONFLICT':
      conflict(c.conflictId).escalation = c.escalation;
      return;
    case 'END_CONFLICT':
      endConflict(w, c.conflictId);
      return;
    case 'CREATE_EVENT':
      requireDomain(
        !w.events.some((e) => e.id === c.event.id),
        'Event ID already exists',
      );
      return;
    case 'UPDATE_GOVERNMENT':
      nation(c.nationId).government = structuredClone(c.government);
      return;
    case 'UPDATE_LEADER':
      nation(c.nationId).leader = c.leader;
      return;
    case 'CREATE_STRATEGIC_GOAL':
      requireDomain(
        !w.goals.some((g) => g.id === c.goal.id),
        'Goal ID already exists',
      );
      requireDomain(
        c.goal.createdDate === w.date && c.goal.updatedDate === w.date,
        'New goal dates must equal simulation date',
      );
      nation(c.goal.nationId);
      if (c.goal.parentGoalId) {
        const parent = w.goals.find((g) => g.id === c.goal.parentGoalId);
        requireDomain(
          parent?.nationId === c.goal.nationId && parent.parentGoalId === null,
          'Goal hierarchy must have same owner and depth at most one',
        );
      }
      requireDomain(
        c.goal.signals.every(
          (s) =>
            s.baseline !== s.target &&
            s.baseline >= 0 &&
            s.target >= 0 &&
            s.baseline <= (s.stat === 'treasury' ? 1000000000 : 100) &&
            s.target <= (s.stat === 'treasury' ? 1000000000 : 100),
        ),
        'Invalid goal progress signals',
      );
      c.goal.targetNationIds.forEach(nation);
      w.goals.push(structuredClone(c.goal));
      return;
    case 'UPDATE_STRATEGIC_GOAL': {
      const g = w.goals.find((g) => g.id === c.goalId);
      requireDomain(g, 'Unknown goal');
      requireDomain(liveGoal(g), 'Only live goals can be updated');
      g.status = c.status;
      g.priority = c.priority;
      g.progress = c.progress;
      g.updatedDate = w.date;
      return;
    }
    case 'SET_OBSERVER_MODE':
      w.observerMode = c.enabled;
      return;
    case 'SWITCH_NATION':
      nation(c.nationId);
      w.playerNationId = c.nationId;
      w.observerMode = false;
      return;
    case 'ADVANCE_DATE':
      requireDomain(c.date > w.date, 'Date must move forward');
      advanceSimulation(w, c.date);
      w.date = c.date;
      return;
    default: {
      const exhaustive: never = c;
      return exhaustive;
    }
  }
}
