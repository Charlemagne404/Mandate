import type { WorldState } from '@mandate/schemas';
import {
  Crisis,
  EconomicLink,
  GovernmentTenure,
  NationId,
} from '@mandate/schemas';

/** Authored fictional scenario initialization, never live runtime title inference. */
export function seedGlobalContinuity(
  w: WorldState,
  neighborhoods: Array<{ nationId: string; neighbors: string[] }>,
) {
  w.scenario.neighborhoods = neighborhoods.map((n) => ({
    nationId: NationId.parse(n.nationId),
    neighbors: n.neighbors.map((id) => NationId.parse(id)),
  }));
  w.scenario.rules = {
    turnDays: 30,
    economicSeverity: 100,
    crisisSensitivity: 100,
    aiActivity: 'balanced',
    seed: 'global-continuity-v1',
    enabledMechanics: ['crises', 'economic-networks', 'elections', 'theaters'],
  };
  w.scenario.strategicActors = [
    'nation:usa',
    'nation:chn',
    'nation:rus',
    'nation:fra',
    'nation:gbr',
    'nation:ind',
    'nation:bra',
    'nation:deu',
    'nation:jpn',
  ].map((id) => NationId.parse(id));
  for (const g of w.goals) {
    const n = w.nations.find((n) => n.id === g.nationId)!;
    const stat =
      g.title === 'Diversify energy supply'
        ? 'energyExposure'
        : g.title === 'Improve industrial resilience'
          ? 'industrial'
          : g.kind === 'domestic'
            ? 'stability'
            : 'influence';
    const baseline = n.stats[stat],
      target =
        stat === 'energyExposure'
          ? Math.max(0, baseline - 20)
          : Math.min(100, baseline + 12);
    g.signals =
      baseline === target ? [] : [{ stat, baseline, target, weight: 100 }];
    g.evaluation = { kind: g.signals.length ? 'metrics' : 'capacity' };
  }
  w.economicLinks = [];
  for (const neighborhood of neighborhoods) {
    const n = w.nations.find((n) => n.id === neighborhood.nationId)!;
    for (const partner of neighborhood.neighbors.slice(0, 2))
      w.economicLinks.push(
        EconomicLink.parse({
          id: `economic:${n.id.slice(7)}-${partner.slice(7)}`,
          dependentNationId: n.id,
          partnerNationId: partner,
          imports: Math.ceil(n.stats.tradeDependence / 2),
          exports: Math.ceil(n.stats.industrial / 3),
          energy: Math.ceil(n.stats.energyExposure / 2),
          strategicGoods: Math.ceil(n.stats.technology / 3),
          finance: Math.ceil(n.stats.fiscal / 3),
          alternatives: Math.min(70, neighborhood.neighbors.length * 10),
        }),
      );
  }
  const f = w.conflicts[0];
  if (f && !w.crises.length)
    w.crises.push(
      Crisis.parse({
        id: 'crisis:orinoco',
        title: 'Orinoco transport corridor crisis',
        type: 'border',
        participants: [...f.attackers, ...f.defenders],
        interestedActors: w.nations
          .filter((n) => ['nation:col', 'nation:usa'].includes(n.id))
          .map((n) => n.id),
        startDate: w.date,
        trigger: 'Disputed corridor access escalated to armed conflict',
        issues: ['Transport corridor access', 'Withdrawal and monitoring'],
        demands: [
          {
            nationId: f.defenders[0],
            text: 'End offensive military operations',
            condition: { kind: 'conflict-ended', conflictId: f.id },
          },
          {
            nationId: f.attackers[0],
            text: 'Adopt an end to the corridor conflict',
            condition: { kind: 'conflict-ended', conflictId: f.id },
          },
        ],
        militaryPosture: 30,
        rhetoric: 25,
        diplomaticBreakdown: 25,
        severity: 28,
        conflictId: f.id,
      }),
    );
  const corridor = w.crises.find((c) => c.id === 'crisis:orinoco');
  if (corridor && f)
    for (const demand of corridor.demands) {
      demand.condition = { kind: 'conflict-ended', conflictId: f.id };
      if (demand.nationId === f.attackers[0])
        demand.text = 'Adopt an end to the corridor conflict';
    }
  const selected = [
    'nation:swe',
    'nation:fin',
    'nation:fra',
    'nation:bra',
    'nation:usa',
  ];
  if (!w.tenures.length)
    for (const n of w.nations.filter((n) => selected.includes(n.id)))
      w.tenures.push(
        GovernmentTenure.parse({
          id: `tenure:${n.id.slice(7)}`,
          nationId: n.id,
          startDate: w.date,
          nextElectionDate: new Date(Date.parse(w.date) + 720 * 86400000)
            .toISOString()
            .slice(0, 10),
          termDays: 1460,
          incumbent: n.leader,
          challenger: {
            name: `Fictional ${n.name} renewal cabinet`,
            government: {
              type: 'Scenario electoral coalition',
              ideology: 'Domestic renewal',
            },
            strategy: { orientation: 'domestic', riskTolerance: 30 },
          },
          issues: [
            'Living standards',
            'Government legitimacy',
            'Security burden',
          ],
        }),
      );
  return w;
}
