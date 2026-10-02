import { writeFileSync } from 'node:fs';
import { loadScenario } from '@mandate/scenarios';
import { assertWorld } from '@mandate/core';
import {
  Goal,
  Initiative,
  Treaty,
  Organization,
  Crisis,
  EconomicLink,
  GovernmentTenure,
} from '@mandate/schemas';
const w = loadScenario('data/scenarios/northern-sandbox.json');
w.saveId = 'save:nordic-strategy' as typeof w.saveId;
w.scenario = {
  ...w.scenario,
  id: 'scenario:nordic-strategy' as typeof w.scenario.id,
  name: 'Nordic Crossroads · Strategic sandbox',
  description:
    'Original fictional gameplay scenario, not historical claims. Nordic cooperation, neutrality, energy dependence, domestic pressure and constrained rearmament create competing paths without scripted outcomes.',
};
for (const n of w.nations) {
  n.strategy.orientation =
    n.id === 'nation:nor'
      ? 'economic'
      : n.id === 'nation:fin'
        ? 'diplomatic'
        : n.id === 'nation:rus'
          ? 'security'
          : 'domestic';
  n.strategy.riskTolerance =
    n.id === 'nation:rus' ? 65 : n.id === 'nation:fin' ? 20 : 40;
}
const swe = w.nations.find((n) => n.id === 'nation:swe')!,
  fin = w.nations.find((n) => n.id === 'nation:fin')!,
  nor = w.nations.find((n) => n.id === 'nation:nor')!,
  rus = w.nations.find((n) => n.id === 'nation:rus')!;
fin.strategy.directives = [
  {
    id: 'neutrality',
    text: 'Avoid permanent foreign basing and binding alliances; remain open to intelligence cooperation and trade.',
    status: 'active',
    visibility: 'private',
    createdDate: w.date,
  },
];
fin.strategy.redLines = ['No surrender of Finnish legal territory'];
swe.stats.energyExposure = 75;
swe.stats.fiscal = 45;
swe.stats.treasury = 40;
nor.stats.energyExposure = 15;
nor.stats.industrial = 65;
nor.stats.fiscal = 70;
rus.stats.unrest = 45;
rus.stats.legitimacy = 45;
rus.stats.fiscal = 30;
rus.stats.treasury = 35;
const goal = (
  id: string,
  nation: typeof swe,
  title: string,
  kind: 'economic' | 'security' | 'domestic' | 'diplomatic',
  stat: keyof typeof swe.stats,
  target: number,
  parent: string | null = null,
) =>
  Goal.parse({
    id: `goal:${id}`,
    nationId: nation.id,
    title,
    kind,
    priority: 90,
    status: 'active',
    targetNationIds: kind === 'diplomatic' ? [swe.id] : [],
    progress: 0,
    reason: 'Persistent fictional government priority',
    createdDate: w.date,
    updatedDate: w.date,
    parentGoalId: parent,
    signals: [{ stat, baseline: nation.stats[stat], target, weight: 100 }],
  });
for (const g of w.goals) {
  g.kind = 'domestic';
  const n = w.nations.find((n) => n.id === g.nationId)!;
  g.signals = [
    {
      stat: 'stability',
      baseline: n.stats.stability,
      target: Math.min(100, n.stats.stability + 6),
      weight: 100,
    },
  ];
}
w.goals.push(
  goal(
    'swe-independence',
    swe,
    'Reduce energy vulnerability',
    'economic',
    'energyExposure',
    55,
  ),
  goal(
    'swe-energy',
    swe,
    'Diversify energy supply',
    'economic',
    'energyExposure',
    55,
    'goal:swe-independence',
  ),
  goal(
    'swe-industry',
    swe,
    'Develop domestic industrial capacity',
    'economic',
    'industrial',
    65,
    'goal:swe-independence',
  ),
  goal(
    'fin-cooperation',
    fin,
    'Develop limited Nordic cooperation',
    'diplomatic',
    'influence',
    65,
  ),
  goal(
    'nor-trade',
    nor,
    'Expand export capacity',
    'economic',
    'industrial',
    80,
  ),
  goal(
    'rus-legitimacy',
    rus,
    'Restore domestic legitimacy',
    'domestic',
    'legitimacy',
    60,
  ),
);
w.organizations.push(
  Organization.parse({
    id: 'organization:nordic-forum',
    name: 'Nordic Consultation Forum',
    kind: 'regional',
    members: [swe.id, fin.id, nor.id],
    charter: 'Consultation without mutual defense obligations',
  }),
);
w.treaties.push(
  Treaty.parse({
    id: 'treaty:nordic-market',
    name: 'Nordic Market Access',
    kind: 'trade',
    parties: [swe.id, nor.id],
    status: 'active',
    terms: 'Reciprocal market access; no security guarantee',
  }),
);
for (const r of w.relations) {
  if (
    [r.nationA, r.nationB].includes(swe.id) &&
    [r.nationA, r.nationB].includes(fin.id)
  ) {
    r.score = 55;
    r.trust = 68;
    r.militaryAlignment = 25;
  }
  if (
    [r.nationA, r.nationB].includes(swe.id) &&
    [r.nationA, r.nationB].includes(nor.id)
  ) {
    r.score = 60;
    r.trust = 70;
    r.tradeDependence = 65;
  }
  if (
    [r.nationA, r.nationB].includes(fin.id) &&
    [r.nationA, r.nationB].includes(rus.id)
  ) {
    r.score = -25;
    r.tension = 60;
    r.tradeDependence = 45;
    r.grievances = ['Unresolved border security disagreement'];
  }
  r.factors = [
    {
      date: w.date,
      cause: 'Authored fictional scenario starting position',
      scoreDelta: r.score,
      trustDelta: 0,
      visibility: 'public',
    },
  ];
}
w.initiatives.push(
  Initiative.parse({
    id: 'initiative:fin-industry',
    nationId: fin.id,
    name: 'Civil resilience industry',
    kind: 'industry',
    startDate: w.date,
    durationDays: 360,
    effort: 2,
  }),
);
w.crises.push(
  Crisis.parse({
    id: 'crisis:nordic-access',
    title: 'Nordic security access dispute',
    type: 'security',
    participants: [swe.id, fin.id, rus.id],
    interestedActors: [nor.id],
    startDate: w.date,
    trigger: 'Rising regional military access concerns',
    issues: ['Foreign basing limits', 'Border security transparency'],
    demands: [
      {
        nationId: fin.id,
        text: 'No permanent foreign basing without negotiated Finnish consent',
      },
      {
        nationId: rus.id,
        text: 'Advance notice of regional military deployments',
      },
    ],
    redLines: [
      { nationId: fin.id, text: 'Finnish legal sovereignty is non-negotiable' },
    ],
    militaryPosture: 20,
    rhetoric: 25,
    diplomaticBreakdown: 15,
    severity: 20,
    history: [],
  }),
);
for (const [dependent, partner, imports, exports, energy] of [
  [swe, rus, 45, 15, 70],
  [fin, rus, 55, 25, 65],
  [swe, nor, 35, 45, 30],
  [nor, swe, 20, 40, 10],
] as const)
  w.economicLinks.push(
    EconomicLink.parse({
      id: `economic:${dependent.id.slice(7)}-${partner.id.slice(7)}`,
      dependentNationId: dependent.id,
      partnerNationId: partner.id,
      imports,
      exports,
      energy,
      strategicGoods: 25,
      finance: 20,
      alternatives: 20,
    }),
  );
w.tenures.push(
  GovernmentTenure.parse({
    id: 'tenure:fin',
    nationId: fin.id,
    startDate: w.date,
    nextElectionDate: '2026-01-01',
    termDays: 1460,
    incumbent: fin.leader,
    challenger: {
      name: 'Fictional Finnish renewal cabinet',
      government: {
        type: 'Parliamentary coalition',
        ideology: 'Domestic renewal',
      },
      strategy: {
        riskTolerance: 30,
        orientation: 'economic',
        redLines: ['No surrender of Finnish legal territory'],
      },
    },
    issues: ['Civil resilience', 'Security autonomy', 'Fiscal capacity'],
  }),
);
for (const g of w.goals)
  if (g.signals.length) g.evaluation = { kind: 'metrics' };
assertWorld(w);
writeFileSync(
  'data/scenarios/nordic-strategy.json',
  JSON.stringify({ formatVersion: 3, kind: 'scenario', world: w }, null, 2) +
    '\n',
);
