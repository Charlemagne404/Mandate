import { continuityProblems } from './continuity-invariants.js';
import type { WorldCommand, WorldState } from '@mandate/schemas';
import { requireDomain } from './errors.js';
import { commandReferences } from './references.js';
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
const signature = (ids: readonly string[]) => [...ids].sort().join('~');
// Run after each tentative command, before it can be concealed by a subsequent command.
export function validateCommandDomain(
  w: WorldState,
  command: WorldCommand,
): void {
  requireDomain(
    !continuityProblems(w).length,
    continuityProblems(w).join('; '),
  );
  const refs = commandReferences(command);
  for (const id of refs.nationIds)
    requireDomain(
      w.nations.some((n) => n.id === id),
      `Unknown nation: ${id}`,
    );
  for (const id of refs.regionIds)
    requireDomain(
      w.regions.some((r) => r.id === id),
      `Unknown region: ${id}`,
    );
  for (const id of refs.treatyIds)
    requireDomain(
      w.treaties.some((t) => t.id === id),
      `Unknown treaty: ${id}`,
    );
  for (const id of refs.conflictIds)
    requireDomain(
      w.conflicts.some((c) => c.id === id),
      `Unknown conflict: ${id}`,
    );
  for (const id of refs.goalIds)
    requireDomain(
      w.goals.some((g) => g.id === id),
      `Unknown goal: ${id}`,
    );
  for (const id of refs.initiativeIds)
    requireDomain(
      w.initiatives.some((v) => v.id === id),
      `Unknown initiative: ${id}`,
    );
  for (const id of refs.negotiationIds)
    requireDomain(
      w.negotiations.some((v) => v.id === id),
      `Unknown negotiation: ${id}`,
    );
  for (const id of refs.organizationIds)
    requireDomain(
      w.organizations.some((v) => v.id === id),
      `Unknown organization: ${id}`,
    );
  const treaties = new Set<string>();
  for (const t of w.treaties) {
    requireDomain(unique(t.parties), 'Treaty parties must be unique');
    if (t.status === 'active') {
      const key = t.kind + signature(t.parties);
      requireDomain(!treaties.has(key), 'Equivalent active treaty exists');
      treaties.add(key);
    }
  }
  const conflicts = new Set<string>();
  for (const c of w.conflicts) {
    requireDomain(
      unique([...c.attackers, ...c.defenders]),
      'Conflict sides must be unique and disjoint',
    );
    if (c.status === 'active') {
      const key = [signature(c.attackers), signature(c.defenders)]
        .sort()
        .join('|');
      requireDomain(!conflicts.has(key), 'Equivalent active conflict exists');
      conflicts.add(key);
    }
  }
  for (const g of w.goals)
    requireDomain(unique(g.targetNationIds), 'Goal targets must be unique');
}
