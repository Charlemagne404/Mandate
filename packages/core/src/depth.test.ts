import { describe, it, expect } from 'vitest';
import { Goal, Negotiation, Initiative } from '@mandate/schemas';
import { resolveTurn, assertWorld } from './index.js';
import { updateDepth, executionCapacity } from './depth.js';
import { buildContext } from '@mandate/memory';
import { fixture, context, request } from '../../../tests/fixtures/world.js';
const step = (w: ReturnType<typeof fixture>, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
const pledge = (
  w: ReturnType<typeof fixture>,
  type = 'aid',
  visibility = 'public',
) =>
  Negotiation.parse({
    id: 'negotiation:pledge',
    proposerNationId: 'nation:swe',
    recipientNationId: 'nation:fin',
    topic: 'Funded assistance',
    kind: 'consultation',
    terms: 'Provide funded aid',
    visibility,
    createdDate: w.date,
    expiresDate: '2027-01-01',
    obligations: [
      {
        issuer: 'nation:swe',
        recipients: ['nation:fin'],
        type,
        terms: 'Measurable obligation',
        strength: 'binding',
        dueDate: type === 'aid' ? '2025-03-02' : null,
        expiry: '2027-01-01',
        condition:
          type === 'aid'
            ? { kind: 'project', initiativeKind: 'aid', minimumInvestment: 2 }
            : { kind: 'restraint' },
      },
    ],
  });
const accept = (
  w: ReturnType<typeof fixture>,
  type = 'aid',
  visibility = 'public',
) =>
  step(w, [
    { type: 'OPEN_NEGOTIATION', negotiation: pledge(w, type, visibility) },
    {
      type: 'RESPOND_NEGOTIATION',
      negotiationId: 'negotiation:pledge',
      nationId: 'nation:fin',
      move: 'accept',
      message: 'We accept the structured terms',
    },
  ]);
const goal = (w: ReturnType<typeof fixture>) =>
  Goal.parse({
    id: 'goal:measured',
    nationId: 'nation:swe',
    title: 'Energy independence',
    priority: 80,
    status: 'active',
    targetNationIds: [],
    progress: 0,
    reason: 'Diversification',
    createdDate: w.date,
    updatedDate: w.date,
    signals: [
      {
        stat: 'energyExposure',
        baseline: w.nations.find((n) => n.id === 'nation:swe')!.stats
          .energyExposure,
        target: 0,
        weight: 1,
      },
    ],
  });
const project = (w: ReturnType<typeof fixture>, overrides = {}) =>
  Initiative.parse({
    id: 'initiative:fund',
    nationId: 'nation:swe',
    name: 'Aid delivery',
    kind: 'aid',
    targetNationId: 'nation:fin',
    startDate: w.date,
    durationDays: 30,
    effort: 2,
    ...overrides,
  });
describe('strategic depth contracts', () => {
  it('casual diplomatic prose creates no obligation', () => {
    const w = fixture();
    const n = pledge(w);
    n.obligations = [];
    const after = step(w, [
      { type: 'OPEN_NEGOTIATION', negotiation: n },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: n.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'We promise friendly relations',
      },
    ]);
    expect(after.commitments).toEqual([]);
  });
  it('acceptance records structured canonical obligation and source', () => {
    const w = accept(fixture());
    expect(w.commitments[0]).toMatchObject({
      status: 'active',
      sourceNegotiationId: 'negotiation:pledge',
    });
    assertWorld(w);
  });
  it('funded completed aid fulfills pledge and improves trust once', () => {
    let w = accept(fixture());
    w = step(w, [
      { type: 'START_INITIATIVE', initiative: project(w) },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.commitments[0]!.status).toBe('fulfilled');
    const trust = w.relations.find(
      (r) => r.nationA === 'nation:fin' && r.nationB === 'nation:swe',
    )!.trust;
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-03-01' }]);
    expect(
      w.relations.find(
        (r) => r.nationA === 'nation:fin' && r.nationB === 'nation:swe',
      )!.trust,
    ).toBe(trust);
  });
  it('missed pledge creates concrete grievance and legitimacy cost', () => {
    let w = accept(fixture());
    const legitimacy = w.nations.find((n) => n.id === 'nation:swe')!.stats
      .legitimacy;
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    expect(w.commitments[0]!.status).toBe('breached');
    expect(w.nations.find((n) => n.id === 'nation:swe')!.stats.legitimacy).toBe(
      legitimacy - 3,
    );
    expect(
      w.relations
        .find((r) => r.nationA === 'nation:fin' && r.nationB === 'nation:swe')!
        .grievances.join(),
    ).toContain('deadline');
  });
  it('private obligation and its cause remain hidden from outsiders', () => {
    let w = accept(fixture(), 'aid', 'private');
    w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    const c = buildContext(
      w,
      w.nations.find((n) => n.id === 'nation:rus')!.id,
      w.nations.map((n) => n.id),
    );
    expect(c.canonical.commitments).toEqual([]);
    expect(c.canonical.relations.flatMap((r) => r.factors)).not.toContainEqual(
      expect.objectContaining({ visibility: 'private' }),
    );
  });
  it('nonaggression breach responds to canonical attack', () => {
    let w = accept(fixture(), 'nonaggression');
    w = step(w, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:breach',
          name: 'Breach',
          attackers: ['nation:swe'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 10,
        },
      },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.commitments[0]!.status).toBe('breached');
  });
  it('refuses obligations involving third parties without their consent', () => {
    const w = fixture(),
      n = pledge(w);
    n.obligations[0]!.issuer = w.nations.find((n) => n.id === 'nation:rus')!.id;
    expect(() =>
      step(w, [{ type: 'OPEN_NEGOTIATION', negotiation: n }]),
    ).toThrow('participants');
  });
  it('refuses unsupported prose-only guarantees', () => {
    const w = fixture(),
      n = pledge(w);
    n.obligations[0]!.type = 'guarantee';
    expect(() =>
      step(w, [{ type: 'OPEN_NEGOTIATION', negotiation: n }]),
    ).toThrow('mechanically');
  });
  it('counteroffer preserves rejected terms and revises obligations intentionally', () => {
    const w = fixture();
    const after = step(w, [
      { type: 'OPEN_NEGOTIATION', negotiation: pledge(w) },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:pledge',
        nationId: 'nation:fin',
        move: 'counter',
        message: 'Trade instead',
        counterTerms: 'Reciprocal market access',
      },
    ]);
    expect(after.negotiations[0]!.responses[0]!.offeredTerms).toBe(
      'Provide funded aid',
    );
    expect(after.negotiations[0]!.responses[0]!.obligations).toHaveLength(1);
    expect(after.negotiations[0]!.obligations).toEqual([]);
    expect(after.commitments).toEqual([]);
  });
  it('goal progress derives from canonical stat and survives regression', () => {
    const w = fixture();
    w.goals.push(goal(w));
    const n = w.nations.find((n) => n.id === 'nation:swe')!;
    n.stats.energyExposure = 0;
    updateDepth(w, w.date);
    expect(w.goals.at(-1)).toMatchObject({ status: 'achieved', progress: 100 });
    expect(w.goals.at(-1)!.evidence.join()).toContain('target 0');
  });
  it('goal advancement, stall and blocker are deterministic', () => {
    const w = fixture();
    w.goals.push(goal(w));
    const n = w.nations.find((n) => n.id === 'nation:swe')!;
    n.stats.energyExposure = Math.floor(n.stats.energyExposure / 2);
    updateDepth(w, w.date);
    expect(w.goals.at(-1)!.status).toBe('advancing');
    updateDepth(w, w.date);
    expect(w.goals.at(-1)!.status).toBe('stalled');
    n.stats.stability = 20;
    updateDepth(w, w.date);
    expect(w.goals.at(-1)!.status).toBe('blocked');
  });
  it('bounded child goals contribute to parent progress', () => {
    const w = fixture();
    const parent = goal(w);
    parent.signals = [];
    w.goals.push(parent);
    const child = goal(w);
    child.id = Goal.shape.id.parse('goal:child');
    child.parentGoalId = parent.id;
    w.goals.push(child);
    w.nations.find((n) => n.id === 'nation:swe')!.stats.energyExposure = 0;
    updateDepth(w, w.date);
    expect(parent.progress).toBe(100);
  });
  it('rejects recursive or foreign-owned subgoals', () => {
    const w = fixture(),
      g = goal(w);
    g.parentGoalId = g.id;
    expect(() => step(w, [{ type: 'CREATE_STRATEGIC_GOAL', goal: g }])).toThrow(
      'hierarchy',
    );
  });
  it('rejects zero-denominator progress signal', () => {
    const w = fixture(),
      g = goal(w);
    g.signals[0]!.target = g.signals[0]!.baseline;
    expect(() => step(w, [{ type: 'CREATE_STRATEGIC_GOAL', goal: g }])).toThrow(
      'signals',
    );
  });
  it('fiscal execution capacity constrains simultaneous project effort', () => {
    let w = fixture();
    const n = w.nations.find((n) => n.id === 'nation:swe')!;
    n.stats.fiscal = 10;
    n.stats.industrial = 10;
    n.stats.stability = 30;
    n.stats.treasury = 100;
    expect(executionCapacity(w, n.id)).toBe(1);
    w = step(w, [
      { type: 'START_INITIATIVE', initiative: project(w, { effort: 2 }) },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.initiatives[0]).toMatchObject({ progress: 0, delays: 1 });
    expect(w.initiatives[0]!.blocker).toContain('capacity');
  });
  it('severe instability delays execution and milestones require funded progress', () => {
    let w = fixture();
    w.nations.find((n) => n.id === 'nation:swe')!.stats.stability = 20;
    w = step(w, [
      { type: 'START_INITIATIVE', initiative: project(w) },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.initiatives[0]!.milestones).toEqual([]);
    expect(w.initiatives[0]!.blocker).toContain('instability');
  });
  it('relationship inspector factors preserve command provenance', () => {
    const w = step(fixture(), [
      {
        type: 'ADJUST_RELATION',
        nationA: 'nation:swe',
        nationB: 'nation:fin',
        delta: 2,
      },
    ]);
    expect(
      w.relations
        .find((r) => r.nationA === 'nation:fin' && r.nationB === 'nation:swe')!
        .factors.at(-1)!.cause,
    ).toBe('Deterministic test');
  });
  it('one actor cannot stack several offensives in one turn', () => {
    const w = fixture();
    expect(() =>
      step(w, [
        {
          type: 'START_CONFLICT',
          conflict: {
            id: 'conflict:cap',
            name: 'Cap',
            attackers: ['nation:rus'],
            defenders: ['nation:fin'],
            status: 'active',
            escalation: 10,
          },
        },
        ...Array.from({ length: 2 }, () => ({
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:cap',
          nationId: 'nation:rus',
          stance: 'mobilize',
        })),
      ]),
    ).toThrow('One strategic posture');
  });
  it('peace withdrawal validates control and returns control without changing ownership', () => {
    let w = fixture();
    w = step(w, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:peace',
          name: 'Peace',
          attackers: ['nation:rus'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 30,
        },
      },
      {
        type: 'TRANSFER_CONTROL',
        regionId: 'region:ne-fin',
        nationId: 'nation:rus',
      },
    ]);
    const n = Negotiation.parse({
      id: 'negotiation:peace',
      proposerNationId: 'nation:rus',
      recipientNationId: 'nation:fin',
      topic: 'Withdrawal',
      kind: 'peace',
      conflictId: 'conflict:peace',
      terms: 'Return forces to original border',
      createdDate: w.date,
      expiresDate: '2025-04-01',
      peaceTerms: [
        {
          kind: 'withdrawal',
          regionId: 'region:ne-fin',
          fromNationId: 'nation:rus',
          toNationId: 'nation:fin',
        },
      ],
    });
    w = step(w, [
      { type: 'OPEN_NEGOTIATION', negotiation: n },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: n.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'We accept',
        treatyId: 'treaty:peace',
      },
    ]);
    expect(w.regions.find((r) => r.id === 'region:ne-fin')).toMatchObject({
      ownerNationId: 'nation:fin',
      controllerNationId: 'nation:fin',
    });
    expect(w.conflicts[0]!.status).toBe('ended');
  });
  it('peace cannot concede a third party region or withdraw another army', () => {
    const w = step(fixture(), [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:peace',
          name: 'Peace',
          attackers: ['nation:rus'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 30,
        },
      },
    ]);
    const n = Negotiation.parse({
      id: 'negotiation:illegal',
      proposerNationId: 'nation:rus',
      recipientNationId: 'nation:fin',
      topic: 'Illegal terms',
      kind: 'peace',
      conflictId: 'conflict:peace',
      terms: 'Give Sweden away',
      createdDate: w.date,
      expiresDate: '2025-04-01',
      peaceTerms: [
        {
          kind: 'territorial-transfer',
          regionId: 'region:ne-swe',
          fromNationId: 'nation:rus',
          toNationId: 'nation:fin',
        },
      ],
    });
    expect(() =>
      step(w, [{ type: 'OPEN_NEGOTIATION', negotiation: n }]),
    ).toThrow('cannot concede');
  });
  it('trade provides income and confrontation exposes dependency costs', () => {
    const before = fixture();
    const a = structuredClone(before),
      b = structuredClone(before);
    a.treaties.push({
      id: 'treaty:income' as never,
      name: 'Trade',
      kind: 'trade',
      parties: ['nation:swe', 'nation:nor'] as never,
      status: 'active',
      terms: 'Trade',
      visibility: 'public',
      conflictId: null,
      influenceTerms: [],
      breaches: [],
      enforcements: [],
      directives: [],
      ratificationGovernments: [],
    });
    const earned = step(a, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]),
      baseline = step(b, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    expect(
      earned.nations.find((n) => n.id === 'nation:swe')!.stats.treasury,
    ).toBe(
      baseline.nations.find((n) => n.id === 'nation:swe')!.stats.treasury + 2,
    );
  });

  it('moderate superiority advances a campaign over several turns instead of instant conquest', () => {
    let w = fixture();
    const actor = w.nations.find((n) => n.id === 'nation:rus')!,
      defender = w.nations.find((n) => n.id === 'nation:fin')!;
    actor.stats.military = 100;
    actor.stats.readiness = 80;
    defender.stats.military = 40;
    w = step(w, [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:campaign',
          name: 'Campaign',
          attackers: ['nation:rus'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 10,
        },
      },
    ]);
    const offensive = {
      type: 'CONFLICT_ACTION',
      conflictId: 'conflict:campaign',
      nationId: 'nation:rus',
      stance: 'offensive',
      regionId: 'region:ne-fin',
    };
    w = step(w, [offensive]);
    expect(w.conflicts[0]!.campaigns[0]!.progress).toBe(35);
    expect(
      w.regions.find((r) => r.id === 'region:ne-fin')!.controllerNationId,
    ).toBe('nation:fin');
    w = step(w, [offensive]);
    expect(w.conflicts[0]!.campaigns[0]!.progress).toBe(70);
    w = step(w, [offensive]);
    expect(w.regions.find((r) => r.id === 'region:ne-fin')!).toMatchObject({
      controllerNationId: 'nation:rus',
      ownerNationId: 'nation:fin',
    });
  });
  it('one funded project cannot fulfill two separate aid pledges twice', () => {
    let w = accept(fixture());
    const n = pledge(w);
    n.id = Negotiation.shape.id.parse('negotiation:second');
    w = step(w, [
      { type: 'OPEN_NEGOTIATION', negotiation: n },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: n.id,
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted additional aid',
      },
    ]);
    w = step(w, [
      { type: 'START_INITIATIVE', initiative: project(w) },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.commitments.filter((c) => c.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      w.commitments
        .flatMap((c) => c.deliveries)
        .reduce((s, d) => s + d.investment, 0),
    ).toBe(2);
  });
});
