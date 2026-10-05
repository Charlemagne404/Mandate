import { describe, it, expect } from 'vitest';
import {
  Crisis,
  Conference,
  EconomicLink,
  Organization,
  Sanction,
  GovernmentTenure,
  Goal,
  NationId,
  Initiative,
} from '@mandate/schemas';
import {
  resolveTurn,
  assertWorld,
  compareWorlds,
  worldBriefing,
  strategicAnswer,
} from './index.js';
import {
  fixture,
  request,
  context,
  conflict,
} from '../../../tests/fixtures/world.js';
import { buildContext } from '@mandate/memory';
import { updateDepth } from './depth.js';
const step = (w: ReturnType<typeof fixture>, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
const swe = NationId.parse('nation:swe'),
  fin = NationId.parse('nation:fin'),
  rus = NationId.parse('nation:rus');
const crisis = (w: ReturnType<typeof fixture>, extra = {}) =>
  Crisis.parse({
    id: 'crisis:border',
    title: 'Border access confrontation',
    type: 'security',
    participants: [swe, fin],
    startDate: w.date,
    trigger: 'Basing demand contested',
    issues: ['Sovereign military access'],
    demands: [{ nationId: fin, text: 'Withdraw basing demand' }],
    militaryPosture: 20,
    rhetoric: 30,
    diplomaticBreakdown: 30,
    ...extra,
  });
const conference = (w: ReturnType<typeof fixture>, extra = {}) =>
  Conference.parse({
    id: 'conference:nordic',
    title: 'Joint security talks',
    proposer: swe,
    parties: [swe, fin, rus],
    kind: 'security',
    terms: 'Consultation without permanent bases',
    createdDate: w.date,
    expiresDate: '2026-01-01',
    ...extra,
  });
const response = (nationId: string, move = 'accept', extra = {}) => ({
  type: 'RESPOND_CONFERENCE',
  conferenceId: 'conference:nordic',
  nationId,
  move,
  message: 'National interests assessed',
  ...extra,
});
const link = (extra = {}) =>
  EconomicLink.parse({
    id: 'economic:energy',
    dependentNationId: fin,
    partnerNationId: rus,
    imports: 80,
    exports: 40,
    energy: 90,
    strategicGoods: 80,
    finance: 60,
    alternatives: 0,
    ...extra,
  });
const sanction = (w: ReturnType<typeof fixture>, extra = {}) =>
  Sanction.parse({
    id: 'sanction:pressure',
    issuer: rus,
    target: fin,
    sector: 'energy',
    intensity: 100,
    startDate: w.date,
    reason: 'Coercive leverage',
    ...extra,
  });
const goal = (w: ReturnType<typeof fixture>, extra = {}) =>
  Goal.parse({
    id: 'goal:measurable',
    nationId: swe,
    title: 'Improve Finnish relationship',
    priority: 80,
    status: 'active',
    targetNationIds: [fin],
    progress: 0,
    reason: 'Regional integration',
    createdDate: w.date,
    updatedDate: w.date,
    evaluation: {
      kind: 'relationship',
      nationId: fin,
      baseline: 0,
      target: 80,
    },
    ...extra,
  });

describe('persistent crises', () => {
  it('retains underlying issues and posture over quiet turns', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CRISIS', crisis: crisis(fixture()) },
    ]);
    const before = structuredClone(w.crises[0]);
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-04-01' }]);
    expect(w.crises[0]).toEqual(before);
  });
  it('mobilization consumes funds, raises severity and records actor', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CRISIS', crisis: crisis(fixture()) },
    ]);
    const severity = w.crises[0]!.severity,
      treasury = w.nations.find((n) => n.id === swe)!.stats.treasury;
    w = step(w, [
      {
        type: 'CRISIS_ACTION',
        crisisId: 'crisis:border',
        nationId: swe,
        move: 'mobilize',
      },
    ]);
    expect(w.crises[0]!.severity).toBeGreaterThan(severity);
    expect(w.nations.find((n) => n.id === swe)!.stats.treasury).toBe(
      treasury - 5,
    );
    expect(w.crises[0]!.history.at(-1)!.nationId).toBe(swe);
  });
  it('resolution requires concession and reduced posture/breakdown', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CRISIS', crisis: crisis(fixture()) },
    ]);
    w = step(w, [
      {
        type: 'CRISIS_ACTION',
        crisisId: 'crisis:border',
        nationId: swe,
        move: 'concede',
        demandIndex: 0,
      },
    ]);
    expect(w.crises[0]!.status).not.toBe('resolved');
    w = step(w, [
      {
        type: 'CRISIS_ACTION',
        crisisId: 'crisis:border',
        nationId: swe,
        move: 'stand-down',
      },
    ]);
    expect(w.crises[0]!.status).toBe('resolved');
    expect(w.events.some((e) => e.type === 'CRISIS_DEVELOPMENT')).toBe(true);
  });
  it('outsiders cannot modify or see a private crisis', () => {
    const w = step(fixture(), [
      {
        type: 'OPEN_CRISIS',
        crisis: crisis(fixture(), { visibility: 'private' }),
      },
    ]);
    expect(() =>
      step(w, [
        {
          type: 'CRISIS_ACTION',
          crisisId: 'crisis:border',
          nationId: rus,
          move: 'warn',
        },
      ]),
    ).toThrow('participant');
    expect(buildContext(w, rus, [swe, fin]).canonical.crises).toEqual([]);
    expect(buildContext(w, fin, [swe]).canonical.crises).toHaveLength(1);
  });
  it('missed unresolved deadline raises pressure without automatic war', () => {
    let w = step(fixture(), [
      {
        type: 'OPEN_CRISIS',
        crisis: crisis(fixture(), { deadline: '2025-01-15' }),
      },
    ]);
    const before = w.crises[0]!.severity;
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-04-01' }]);
    expect(w.crises[0]!.severity).toBeGreaterThan(before);
    expect(w.conflicts).toEqual([]);
  });
  it('rejects forged severity and unknown references on import', () => {
    const w = fixture();
    w.crises.push(crisis(w));
    expect(() => assertWorld(w)).toThrow('severity');
    w.crises[0]!.severity = 25;
    w.crises[0]!.regions = ['region:unknown' as never];
    expect(() => assertWorld(w)).toThrow('regions');
  });
});
describe('multilateral bargaining and peace', () => {
  it('requires affirmative consent from every participant', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CONFERENCE', conference: conference(fixture()) },
    ]);
    w = step(w, [response(swe), response(fin)]);
    expect(w.conferences[0]!.status).toBe('open');
    expect(w.organizations).toHaveLength(0);
    w = step(w, [response(rus)]);
    expect(w.conferences[0]!.status).toBe('agreed');
    expect(w.organizations[0]!.members).toHaveLength(3);
  });
  it('counteroffer invalidates all prior consent', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CONFERENCE', conference: conference(fixture()) },
      response(swe),
      response(rus),
    ]);
    w = step(w, [
      response(fin, 'counter', { counterTerms: 'Exploratory talks only' }),
    ]);
    expect(w.conferences[0]!.round).toBe(1);
    w = step(w, [response(fin)]);
    expect(w.conferences[0]!.status).toBe('open');
    w = step(w, [response(swe), response(rus)]);
    expect(w.conferences[0]!.status).toBe('agreed');
  });
  it.each(['abstain', 'delay'])('%s is not consent', (move) => {
    const w = step(fixture(), [
      { type: 'OPEN_CONFERENCE', conference: conference(fixture()) },
      response(swe),
      response(fin),
      response(rus, move),
    ]);
    expect(w.conferences[0]!.status).toBe('open');
  });
  it.each(['reject', 'withdraw'])('%s prevents coalition formation', (move) => {
    const w = step(fixture(), [
      { type: 'OPEN_CONFERENCE', conference: conference(fixture()) },
      response(fin, move),
    ]);
    expect(w.conferences[0]!.status).toBe(
      move === 'reject' ? 'rejected' : 'withdrawn',
    );
    expect(w.organizations).toEqual([]);
  });
  it('expires a stalled conference by simulation date', () => {
    let w = step(fixture(), [
      { type: 'OPEN_CONFERENCE', conference: conference(fixture()) },
    ]);
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2026-01-01' }]);
    expect(w.conferences[0]!.status).toBe('expired');
  });
  it('secret coalition remains hidden after agreement', () => {
    const w = fixture();
    const outsider = w.nations.find((n) => ![swe, fin, rus].includes(n.id))!.id;
    const after = step(w, [
      {
        type: 'OPEN_CONFERENCE',
        conference: conference(w, { visibility: 'private' }),
      },
      response(swe),
      response(fin),
      response(rus),
    ]);
    expect(
      buildContext(after, outsider, [swe, fin, rus]).canonical.conferences,
    ).toEqual([]);
    expect(
      buildContext(after, outsider, [swe, fin, rus]).canonical.organizations,
    ).toEqual([]);
  });
  it('peace conference includes mediator but cannot settle before all belligerents consent', () => {
    let w = step(fixture(), [
      conflict,
      { type: 'TRANSFER_CONTROL', regionId: 'region:ne-fin', nationId: rus },
    ]);
    const c = conference(w, {
      kind: 'peace',
      conflictId: 'conflict:crisis',
      peaceTerms: [
        {
          kind: 'withdrawal',
          regionId: 'region:ne-fin',
          fromNationId: rus,
          toNationId: fin,
        },
      ],
    });
    w = step(w, [
      { type: 'OPEN_CONFERENCE', conference: c },
      response(swe),
      response(fin),
    ]);
    expect(w.conflicts[0]!.status).toBe('active');
    w = step(w, [response(rus)]);
    expect(w.conflicts[0]!.status).toBe('ended');
    expect(w.regions.find((r) => r.id === 'region:ne-fin')).toMatchObject({
      ownerNationId: fin,
      controllerNationId: fin,
    });
  });
  it('cannot offer third-party territory', () => {
    const w = step(fixture(), [conflict]);
    const c = conference(w, {
      kind: 'peace',
      conflictId: 'conflict:crisis',
      peaceTerms: [
        {
          kind: 'territorial-transfer',
          regionId: 'region:ne-swe',
          fromNationId: rus,
          toNationId: fin,
        },
      ],
    });
    expect(() => step(w, [{ type: 'OPEN_CONFERENCE', conference: c }])).toThrow(
      'ownership',
    );
  });
});
describe('economic networks and adaptation', () => {
  it('sanctions cost exposed target and issuer, without reciprocal dependence', () => {
    const base = fixture();
    let w = step(base, [
      { type: 'SET_ECONOMIC_LINK', link: link() },
      { type: 'IMPOSE_SANCTION', sanction: sanction(base) },
    ]);
    const baseline = step(base, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    expect(w.nations.find((n) => n.id === fin)!.stats.economy).toBeLessThan(
      baseline.nations.find((n) => n.id === fin)!.stats.economy,
    );
    expect(w.economicLinks).toHaveLength(1);
    expect(w.economicLinks[0]!.adaptation).toBe(1);
  });
  it('alternative partners attenuate damage', () => {
    const run = (alternatives: number) => {
      let w = fixture();
      w = step(w, [
        { type: 'SET_ECONOMIC_LINK', link: link({ alternatives }) },
        { type: 'IMPOSE_SANCTION', sanction: sanction(w) },
      ]);
      return step(w, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    };
    expect(
      run(90).nations.find((n) => n.id === fin)!.stats.treasury,
    ).toBeGreaterThan(run(0).nations.find((n) => n.id === fin)!.stats.treasury);
  });
  it('relief and scheduled expiration stop penalties', () => {
    let w = fixture();
    w = step(w, [
      { type: 'SET_ECONOMIC_LINK', link: link() },
      {
        type: 'IMPOSE_SANCTION',
        sanction: sanction(w, { endDate: '2025-01-20' }),
      },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    expect(w.sanctions[0]!.status).toBe('lifted');
    expect(w.economicLinks[0]!.adaptation).toBe(0);
  });
  it('cannot stack equivalent sanctions or let target lift them', () => {
    const base = fixture();
    const w = step(base, [
      { type: 'IMPOSE_SANCTION', sanction: sanction(base) },
    ]);
    expect(() =>
      step(w, [
        {
          type: 'IMPOSE_SANCTION',
          sanction: sanction(w, { id: 'sanction:duplicate' }),
        },
      ]),
    ).toThrow('Duplicate');
    expect(() =>
      step(w, [
        {
          type: 'LIFT_SANCTION',
          sanctionId: 'sanction:pressure',
          nationId: fin,
        },
      ]),
    ).toThrow('issuer');
  });
  it('completed substitution investment speeds adaptation', () => {
    let w = fixture();
    w.nations.find((n) => n.id === fin)!.stats.treasury = 100;
    w = step(w, [
      { type: 'SET_ECONOMIC_LINK', link: link() },
      {
        type: 'START_INITIATIVE',
        initiative: Initiative.parse({
          id: 'initiative:substitution',
          nationId: fin,
          name: 'Energy substitution',
          kind: 'energy',
          startDate: w.date,
          durationDays: 30,
          effort: 1,
        }),
      },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    w = step(w, [
      { type: 'IMPOSE_SANCTION', sanction: sanction(w) },
      { type: 'ADVANCE_DATE', date: '2025-03-02' },
    ]);
    expect(w.economicLinks[0]!.adaptation).toBe(2);
  });
});
describe('goals and government continuity', () => {
  it('relationship criteria measure canonical progress', () => {
    const w = fixture();
    w.goals = [goal(w)];
    w.relations.find(
      (r) =>
        [r.nationA, r.nationB].includes(swe) &&
        [r.nationA, r.nationB].includes(fin),
    )!.score = 40;
    updateDepth(w, w.date);
    expect(w.goals[0]!.progress).toBe(50);
  });
  it('stalled priorities accumulate pressure and scarce resources defer lower priorities', () => {
    let w = fixture();
    w.goals = [
      goal(w, {
        kind: 'security',
        evaluation: {
          kind: 'relationship',
          nationId: fin,
          baseline: 55,
          target: 80,
        },
      }),
      goal(w, {
        id: 'goal:competing',
        kind: 'economic',
        priority: 30,
        evaluation: {
          kind: 'relationship',
          nationId: fin,
          baseline: 55,
          target: 80,
        },
      }),
    ];
    w.nations.find((n) => n.id === swe)!.stats.treasury = 0;
    w.nations.find((n) => n.id === swe)!.stats.fiscal = 0;
    w.nations.find((n) => n.id === swe)!.stats.stability = 30;
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-06-01' }]);
    expect(w.goals[0]!.pressure).toBeGreaterThan(0);
    expect(w.goals[1]!.deferredToGoalId).toBe('goal:measurable');
  });
  it('deadline failure cleans up subordinate goals', () => {
    let w = fixture();
    w.goals = [
      goal(w, { deadline: '2025-02-01' }),
      goal(w, { id: 'goal:child', parentGoalId: 'goal:measurable' }),
    ];
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-02-01' }]);
    expect(w.goals.map((g) => g.status)).toEqual(['failed', 'superseded']);
  });
  it('unknown measurable references cannot pass imports', () => {
    const w = fixture();
    w.goals = [
      goal(w, {
        evaluation: { kind: 'project', initiativeId: 'initiative:missing' },
      }),
    ];
    expect(() => assertWorld(w)).toThrow('project');
  });
  it('scheduled election turns over failed government, reviews goals, and preserves treaties', () => {
    let w = fixture();
    const n = w.nations.find((n) => n.id === swe)!;
    n.stats.legitimacy = 10;
    n.stats.stability = 10;
    n.stats.unrest = 90;
    n.stats.economy = 10;
    const t = GovernmentTenure.parse({
      id: 'tenure:swe',
      nationId: swe,
      startDate: w.date,
      nextElectionDate: '2025-01-15',
      termDays: 365,
      incumbent: n.leader,
      challenger: {
        name: 'Reform cabinet',
        government: { type: 'Parliamentary', ideology: 'Reform' },
        strategy: { orientation: 'economic', riskTolerance: 20 },
      },
      issues: ['Domestic recovery'],
    });
    w = step(w, [
      { type: 'SCHEDULE_ELECTION', tenure: t },
      { type: 'ADVANCE_DATE', date: '2025-01-15' },
    ]);
    expect(w.nations.find((n) => n.id === swe)!.leader).toBe('Reform cabinet');
    expect(w.tenures[0]!.outcomes[0]!.incumbentRetained).toBe(false);
    expect(
      w.goals.filter((g) => g.nationId === swe).every((g) => g.strategyReview),
    ).toBe(true);
    expect(w.treaties).toEqual(fixture().treaties);
  });
  it('strong incumbent survives election with deterministic support', () => {
    let w = fixture();
    const n = w.nations.find((n) => n.id === swe)!;
    const t = GovernmentTenure.parse({
      id: 'tenure:swe',
      nationId: swe,
      startDate: w.date,
      nextElectionDate: '2025-02-01',
      termDays: 365,
      incumbent: n.leader,
      challenger: {
        name: 'Opposition cabinet',
        government: n.government,
        strategy: n.strategy,
      },
      issues: ['Capacity'],
    });
    w = step(w, [
      { type: 'SCHEDULE_ELECTION', tenure: t },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.tenures[0]!.outcomes[0]!.incumbentRetained).toBe(true);
  });
});
describe('semantic alternate history and scoped briefing', () => {
  it('compares ownership separately from control and rejects unrelated histories', () => {
    const a = fixture();
    const b = step(a, [
      { type: 'TRANSFER_CONTROL', regionId: 'region:ne-fin', nationId: rus },
    ]);
    expect(compareWorlds(a, b, swe)).toContainEqual(
      expect.objectContaining({
        category: 'territory',
        before: { owner: fin, control: fin },
        after: { owner: fin, control: rus },
      }),
    );
    b.saveId = 'save:unrelated' as never;
    expect(() => compareWorlds(a, b, swe)).toThrow('ancestry');
  });
  it('hides private foreign goals in comparison and briefing', () => {
    const a = fixture(),
      b = structuredClone(a);
    b.goals.push(
      goal(b, {
        nationId: fin,
        visibility: 'private',
        title: 'Unknown secret',
      }),
    );
    expect(JSON.stringify(compareWorlds(a, b, swe))).not.toContain(
      'Unknown secret',
    );
    expect(JSON.stringify(worldBriefing(b, swe))).not.toContain(
      'Unknown secret',
    );
  });
  it('compares dynamic organization membership and terms across branches', () => {
    const a = fixture();
    const b = structuredClone(a);
    b.organizations.push(
      Organization.parse({
        id: 'organization:nordic-economic-cooperation',
        name: 'Nordic Economic Cooperation',
        acronym: 'NEC',
        kind: 'economic-union',
        foundingDate: b.date,
        founders: [swe],
        members: [swe, fin],
        invitedStates: [rus],
        invitations: [
          {
            nationId: rus,
            invitedDate: b.date,
            updatedDate: b.date,
            status: 'pending',
            lastMove: null,
            message: null,
            counterTerms: null,
          },
        ],
        purpose: 'Gradual economic integration.',
        charter: 'Voluntary economic cooperation.',
      }),
    );
    expect(compareWorlds(a, b, swe)).toContainEqual(
      expect.objectContaining({
        category: 'organizations',
        id: 'organization:nordic-economic-cooperation',
        name: 'NEC · Nordic Economic Cooperation',
        before: null,
        after: expect.objectContaining({
          members: [swe, fin],
          purpose: 'Gradual economic integration.',
        }),
      }),
    );
  });
});

describe('continuity import and advisor boundaries', () => {
  it('rejects forged multilateral rounds and status', () => {
    const initial = fixture();
    const w = step(initial, [
      { type: 'OPEN_CONFERENCE', conference: conference(initial) },
      response(swe),
    ]);
    const forged = structuredClone(w);
    forged.conferences[0]!.round = 2;
    expect(() => assertWorld(forged)).toThrow('round');
    forged.conferences[0]!.round = 0;
    forged.conferences[0]!.status = 'rejected';
    expect(() => assertWorld(forged)).toThrow('consent history');
  });
  it('answers from known facts without disclosing foreign refusals', () => {
    const w = fixture();
    w.negotiations.push({
      id: 'negotiation:secret' as never,
      proposerNationId: fin,
      recipientNationId: rus,
      topic: 'Secret access',
      kind: 'consultation',
      terms: 'Unknown',
      visibility: 'private',
      createdDate: w.date,
      expiresDate: '2026-01-01',
      status: 'rejected',
      obligations: [],
      influenceTerms: [],
      peaceTerms: [],
      conflictId: null,
      treatyId: null,
      conditionalPressure: null,
      responses: [
        {
          nationId: rus,
          date: w.date,
          move: 'reject',
          message: 'Private refusal reason',
        },
      ],
    });
    expect(JSON.stringify(strategicAnswer(w, swe, 'refusals'))).not.toContain(
      'Private refusal reason',
    );
    expect(JSON.stringify(strategicAnswer(w, fin, 'refusals'))).toContain(
      'Private refusal reason',
    );
    expect(strategicAnswer(w, swe, 'project-load').source).toBe('canonical');
    expect(strategicAnswer(w, swe, 'threats').facts).not.toHaveLength(0);
  });
  it('compares newly formed relationships and economic adaptation semantically', () => {
    const a = fixture(),
      b = structuredClone(a);
    b.relations = [];
    b.economicLinks.push(link());
    const differences = compareWorlds(a, b, swe);
    expect(
      differences.some((d) => d.category === 'relations' && d.after === null),
    ).toBe(true);
    expect(differences.some((d) => d.category === 'dependencies')).toBe(true);
  });
});

it('cancelled project makes its measurable goal fail and reconciles children', () => {
  let w = fixture();
  const project = Initiative.parse({
    id: 'initiative:linked',
    nationId: swe,
    name: 'Energy programme',
    kind: 'energy',
    startDate: w.date,
    durationDays: 365,
    effort: 2,
  });
  w = step(w, [
    { type: 'START_INITIATIVE', initiative: project },
    {
      type: 'CREATE_STRATEGIC_GOAL',
      goal: goal(w, {
        evaluation: { kind: 'project', initiativeId: project.id },
      }),
    },
  ]);
  w = step(w, [
    { type: 'CANCEL_INITIATIVE', initiativeId: project.id },
    { type: 'ADVANCE_DATE', date: '2025-01-31' },
  ]);
  expect(w.goals.find((g) => g.id === 'goal:measurable')!.status).toBe(
    'failed',
  );
  expect(
    w.goals.find((g) => g.id === 'goal:measurable')!.strategyReview,
  ).toContain('reassess');
});

it('ratified trade conference opens directional links that adapt and yield ongoing access benefits', () => {
  let w = fixture();
  w = step(w, [
    {
      type: 'OPEN_CONFERENCE',
      conference: conference(w, {
        kind: 'trade',
        terms: 'Reciprocal market access',
      }),
    },
    response(swe),
    response(fin),
    response(rus),
  ]);
  expect(w.economicLinks).toHaveLength(6);
  expect(
    w.economicLinks.some(
      (l) => l.dependentNationId === swe && l.partnerNationId === fin,
    ),
  ).toBe(true);
  w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
  expect(w.economicLinks.every((l) => l.alternatives === 31)).toBe(true);
});

it.each([false, true])(
  'crisis military demands resolve from actual peace, never a claimed concession (frozen=%s)',
  (frozen) => {
    let w = fixture();
    w = step(w, [
      conflict,
      {
        type: 'OPEN_CRISIS',
        crisis: crisis(w, {
          participants: [fin, rus],
          militaryPosture: 0,
          rhetoric: 0,
          diplomaticBreakdown: 0,
          demands: [
            {
              nationId: fin,
              text: 'End war',
              condition: {
                kind: 'conflict-ended',
                conflictId: 'conflict:crisis',
              },
            },
          ],
        }),
      },
    ]);
    if (frozen)
      w = step(w, [
        {
          type: 'CRISIS_ACTION',
          crisisId: 'crisis:border',
          nationId: fin,
          move: 'freeze',
        },
      ]);
    expect(() =>
      step(w, [
        {
          type: 'CRISIS_ACTION',
          crisisId: 'crisis:border',
          nationId: rus,
          move: 'concede',
          demandIndex: 0,
        },
      ]),
    ).toThrow('canonical condition');
    w = step(w, [
      { type: 'END_CONFLICT', conflictId: 'conflict:crisis' },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    expect(w.crises[0]!.demands[0]!.satisfied).toBe(true);
    expect(w.crises[0]!.status).toBe('resolved');
  },
);

it('commits a full mobilization order under treasury shortfall and applies the shortfall as consequences', () => {
  const w = fixture();
  const sweden = w.nations.find((n) => n.id === swe)!;
  sweden.stats.treasury = 5;
  sweden.stats.readiness = 40;
  const after = step(w, [
    { type: 'MOBILIZE_FORCE', nationId: swe, level: 'full' },
  ]);
  const mobilized = after.nations.find((n) => n.id === swe)!;
  expect(mobilized.stats.treasury).toBe(0);
  expect(mobilized.stats.readiness).toBe(44);
  expect(mobilized.stats.fiscal).toBe(sweden.stats.fiscal - 3);
  expect(mobilized.stats.unrest).toBe(sweden.stats.unrest + 2);
  expect(
    after.commands.some((record) => record.command.type === 'MOBILIZE_FORCE'),
  ).toBe(true);
});

it('applies recurring defense and tax policy through deterministic budget consequences', () => {
  let baseline = fixture();
  const unmodifiedTreasury = baseline.nations.find((n) => n.id === swe)!.stats
    .treasury;
  const date = '2025-01-31';
  baseline = step(baseline, [{ type: 'ADVANCE_DATE', date }]);
  let reckless = fixture();
  const sweden = reckless.nations.find((n) => n.id === swe)!;
  sweden.stats.treasury = 5;
  const strategy = structuredClone(sweden.strategy);
  strategy.militaryBudgetShare = 100;
  strategy.taxRate = 0;
  reckless = step(reckless, [
    { type: 'SET_STRATEGY', nationId: swe, strategy },
    { type: 'ADVANCE_DATE', date },
  ]);
  const cautiousState = baseline.nations.find((n) => n.id === swe)!;
  const recklessState = reckless.nations.find((n) => n.id === swe)!;
  expect(cautiousState.stats.treasury).toBeGreaterThan(unmodifiedTreasury);
  expect(recklessState.stats.readiness).toBeGreaterThan(
    cautiousState.stats.readiness,
  );
  expect(recklessState.stats.treasury).toBeLessThan(
    cautiousState.stats.treasury,
  );
  expect(recklessState.stats.fiscal).toBeLessThan(sweden.stats.fiscal);
  expect(recklessState.stats.unrest).toBeGreaterThan(sweden.stats.unrest);
});
