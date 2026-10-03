import { updateContinuity } from './continuity.js';
import type { WorldState } from '@mandate/schemas';
import { updateDepth, executionCapacity } from './depth.js';
import { requireDomain } from './errors.js';
const day = (date: string) => Date.parse(date) / 86400000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

// Fixed 30-day accounting ticks anchored to genesis make passage of time
// independent of how a player splits advances. No wall clock or random source.
export function advanceSimulation(w: WorldState, nextDate: string): void {
  const start = day(w.scenario.startDate);
  const before = Math.floor((day(w.date) - start) / 30);
  const after = Math.floor((day(nextDate) - start) / 30);
  requireDomain(
    after - before <= 1200,
    'Advance at most 100 years per command',
  );
  for (let tick = before + 1; tick <= after; tick++) {
    const date = new Date((start + tick * 30) * 86400000)
      .toISOString()
      .slice(0, 10);
    updateContinuity(w, date, true);
    for (const n of w.nations) {
      const wars = w.conflicts.filter(
        (c) =>
          c.status === 'active' &&
          [...c.attackers, ...c.defenders].includes(n.id),
      );
      const fighting = wars.filter((c) => c.settlementState === 'fighting');
      const burden =
        fighting.length * (2 + Math.floor(n.stats.military / 25)) +
        wars.length -
        fighting.length;
      const trade = w.treaties.filter(
        (t) =>
          t.kind === 'trade' &&
          t.status === 'active' &&
          t.parties.includes(n.id),
      );
      const rivals = new Set(
        fighting.flatMap((c) =>
          c.attackers.includes(n.id) ? c.defenders : c.attackers,
        ),
      );
      const disruption = w.relations
        .filter(
          (r) =>
            [r.nationA, r.nationB].includes(n.id) &&
            rivals.has(r.nationA === n.id ? r.nationB : r.nationA),
        )
        .reduce((s, r) => s + Math.floor(r.tradeDependence / 20), 0);
      const income = Math.max(
        0,
        Math.floor((n.stats.economy + n.stats.fiscal) / 25) +
          Math.min(6, trade.length * 2) -
          disruption,
      );
      const defenseShare = n.strategy.militaryBudgetShare;
      const defenseCost = Math.max(0, Math.ceil((defenseShare - 35) / 13));
      const defenseSavings = defenseShare <= 10 ? 1 : 0;
      const taxAdjustment = Math.trunc((n.strategy.taxRate - 50) / 15);
      n.stats.treasury = Math.min(
        1000000000,
        Math.max(
          0,
          n.stats.treasury +
            income +
            taxAdjustment -
            defenseCost +
            defenseSavings -
            burden -
            (fighting.length ? Math.floor(n.stats.energyExposure / 25) : 0),
        ),
      );
      if (fighting.length) {
        n.stats.economy = clamp(n.stats.economy - 1);
        n.stats.readiness = clamp(n.stats.readiness - 1);
        n.stats.unrest = clamp(n.stats.unrest + fighting.length);
      } else if (n.stats.stability >= 60 && n.stats.industrial >= 40) {
        const potential = Math.min(
          95,
          Math.floor((n.stats.industrial + n.stats.fiscal) / 2),
        );
        n.stats.economy = clamp(
          n.stats.economy + Math.sign(potential - n.stats.economy),
        );
      }
      if (defenseShare >= 60)
        n.stats.readiness = clamp(
          n.stats.readiness + 1 + (defenseShare >= 90 ? 1 : 0),
        );
      else if (defenseShare <= 10)
        n.stats.readiness = clamp(n.stats.readiness - 1);
      if (defenseShare >= 85 && n.stats.treasury < 10) {
        n.stats.fiscal = clamp(n.stats.fiscal - 1);
        n.stats.unrest = clamp(n.stats.unrest + 1);
      } else if (defenseShare <= 10) {
        n.stats.fiscal = clamp(n.stats.fiscal + 1);
      }
      if (n.strategy.taxRate >= 85)
        n.stats.economy = clamp(n.stats.economy - 1);
      else if (n.strategy.taxRate <= 10 && n.stats.treasury < 10) {
        n.stats.fiscal = clamp(n.stats.fiscal - 1);
        n.stats.unrest = clamp(n.stats.unrest + 1);
      }
      if (n.stats.unrest >= 60) {
        n.stats.stability = clamp(n.stats.stability - 2);
        n.stats.legitimacy = clamp(n.stats.legitimacy - 1);
      } else if (n.stats.legitimacy >= 50 && !wars.length) {
        n.stats.unrest = clamp(n.stats.unrest - 1);
      }
    }
    for (const r of w.relations)
      if (
        w.treaties.some(
          (t) =>
            t.kind === 'trade' &&
            t.status === 'active' &&
            t.parties.includes(r.nationA) &&
            t.parties.includes(r.nationB),
        )
      )
        r.tradeDependence = Math.min(80, r.tradeDependence + 1);
    for (const c of w.conflicts)
      if (c.status === 'active')
        c.exhaustion = clamp(
          c.exhaustion + (c.settlementState === 'fighting' ? 1 : -1),
        );
    const remainingCapacity = new Map(
      w.nations.map((n) => [n.id, executionCapacity(w, n.id)]),
    );
    for (const i of [...w.initiatives].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )) {
      if (i.status !== 'active' || day(i.startDate) >= day(date)) continue;
      if (
        !i.dependencies.every(
          (id) =>
            w.initiatives.find((v) => v.id === id)?.status === 'completed',
        )
      )
        continue;
      const elapsedInstallments = Math.floor(
        (day(date) - day(i.startDate)) / 30,
      );
      if (elapsedInstallments <= Math.floor(i.invested / i.effort)) continue;
      const n = w.nations.find((v) => v.id === i.nationId)!;
      const blocker =
        n.stats.stability < 25
          ? 'Government instability prevents execution'
          : n.stats.treasury < i.effort
            ? 'Insufficient treasury'
            : (remainingCapacity.get(n.id) ?? 0) < i.effort
              ? 'Fiscal and industrial execution capacity committed elsewhere'
              : null;
      i.blocker = blocker;
      if (blocker) {
        i.delays++;
        continue;
      }
      remainingCapacity.set(n.id, remainingCapacity.get(n.id)! - i.effort);
      const ticksNeeded = Math.ceil(i.durationDays / 30);
      const invested = Math.min(i.effort, ticksNeeded * i.effort - i.invested);
      n.stats.treasury -= invested;
      i.invested += invested;
      i.progress = Math.min(
        100,
        Math.floor((i.invested * 100) / (ticksNeeded * i.effort)),
      );
      i.milestones = [25, 50, 75, 100].filter((m) => m <= i.progress);
      if (i.kind === 'rearmament' && n.stats.fiscal < 40)
        n.stats.unrest = clamp(n.stats.unrest + 1);
      if (i.progress !== 100) continue;
      i.status = 'completed';
      i.completedDate = date;
      const benefit = i.effort * 2;
      switch (i.kind) {
        case 'industry':
          n.stats.industrial = clamp(n.stats.industrial + benefit);
          n.stats.economy = clamp(n.stats.economy + i.effort);
          break;
        case 'energy':
          n.stats.energyExposure = clamp(n.stats.energyExposure - benefit);
          n.stats.fiscal = clamp(n.stats.fiscal + i.effort);
          break;
        case 'rearmament':
          n.stats.military = clamp(n.stats.military + i.effort);
          n.stats.readiness = clamp(n.stats.readiness + benefit);
          break;
        case 'reform':
          n.stats.stability = clamp(n.stats.stability + i.effort);
          n.stats.legitimacy = clamp(n.stats.legitimacy + i.effort);
          n.stats.unrest = clamp(n.stats.unrest - benefit);
          break;
        case 'diplomacy':
          n.stats.influence = clamp(n.stats.influence + benefit);
          break;
        case 'aid': {
          const target = w.nations.find((v) => v.id === i.targetNationId)!;
          target.stats.treasury = Math.min(
            1000000000,
            target.stats.treasury + i.invested,
          );
          target.stats.economy = clamp(target.stats.economy + i.effort);
          break;
        }
        default: {
          const exhaustive: never = i.kind;
          throw new Error(exhaustive);
        }
      }
    }
  }
  for (const n of w.negotiations)
    if (n.status === 'open' && n.expiresDate <= nextDate) n.status = 'expired';
  updateContinuity(w, nextDate, false);
  updateDepth(w, nextDate);
}
