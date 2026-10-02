import { describe, expect, it } from 'vitest';
import { Initiative, Negotiation, Organization } from '@mandate/schemas';
import { assertWorld, exportSave, parseSave, resolveTurn } from './index.js';
import {
  context,
  fixture,
  request,
  conflict,
} from '../../../tests/fixtures/world.js';
import type { WorldState } from '@mandate/schemas';
const run = (w: WorldState, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
const initiative = (w: WorldState, extra: object = {}) =>
  Initiative.parse({
    id: 'initiative:industry',
    nationId: 'nation:swe',
    name: 'Industrial investment',
    kind: 'industry',
    startDate: w.date,
    durationDays: 60,
    effort: 3,
    ...extra,
  });
const negotiation = (w: WorldState, extra: object = {}) =>
  Negotiation.parse({
    id: 'negotiation:cooperation',
    proposerNationId: 'nation:swe',
    recipientNationId: 'nation:fin',
    topic: 'Mutual assistance',
    kind: 'defense',
    terms: 'Defense cooperation',
    createdDate: w.date,
    expiresDate: '2027-01-01',
    ...extra,
  });
describe('deterministic alpha mechanics', () => {
  it('anchors accounting correctly across a leap-day calendar boundary', () => {
    const before = fixture();
    before.date = '2024-02-01';
    before.scenario.startDate = before.date;
    before.goals = [];
    const noTick = run(before, [{ type: 'ADVANCE_DATE', date: '2024-02-29' }]);
    expect(noTick.nations).toEqual(before.nations);
    const tick = run(noTick, [{ type: 'ADVANCE_DATE', date: '2024-03-02' }]);
    expect(
      tick.nations.find((n) => n.id === 'nation:swe')!.stats.treasury,
    ).toBeGreaterThan(
      before.nations.find((n) => n.id === 'nation:swe')!.stats.treasury,
    );
    expect(() =>
      run(tick, [{ type: 'ADVANCE_DATE', date: '2025-02-29' }]),
    ).toThrow('real ISO');
  });
  it('rejects forged recipient acceptance and responses after closure on import', () => {
    const before = fixture();
    const w = run(before, [
      {
        type: 'OPEN_NEGOTIATION',
        negotiation: negotiation(before, { kind: 'consultation' }),
      },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Accepted',
      },
    ]);
    const forged = structuredClone(w);
    forged.negotiations[0]!.responses[0]!.nationId = forged.playerNationId;
    expect(() => assertWorld(forged)).toThrow('unauthorized');
    const extra = structuredClone(w);
    extra.negotiations[0]!.responses.push({
      ...extra.negotiations[0]!.responses[0]!,
      move: 'delay',
    });
    expect(() => assertWorld(extra)).toThrow('Closed negotiation');
  });
  it.each([
    ['energy', 'energyExposure', -6],
    ['rearmament', 'readiness', 6],
    ['reform', 'legitimacy', 3],
    ['diplomacy', 'influence', 6],
  ] as const)(
    'completes %s with its distinct deterministic benefit',
    (kind, stat, delta) => {
      const before = fixture();
      const baseline = before.nations.find((n) => n.id === 'nation:swe')!.stats[
        stat
      ];
      const w = run(before, [
        {
          type: 'START_INITIATIVE',
          initiative: initiative(before, { kind, durationDays: 30 }),
        },
        { type: 'ADVANCE_DATE', date: '2025-01-31' },
      ]);
      expect(w.nations.find((n) => n.id === 'nation:swe')!.stats[stat]).toBe(
        baseline + delta,
      );
      expect(w.initiatives[0]!.status).toBe('completed');
    },
  );
  it('delivers funded aid to another nation and rejects self aid', () => {
    const before = fixture();
    const natural = run(before, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    const w = run(before, [
      {
        type: 'START_INITIATIVE',
        initiative: initiative(before, {
          kind: 'aid',
          durationDays: 30,
          targetNationId: 'nation:fin',
        }),
      },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    expect(w.nations.find((n) => n.id === 'nation:fin')!.stats.treasury).toBe(
      natural.nations.find((n) => n.id === 'nation:fin')!.stats.treasury + 3,
    );
    expect(() =>
      run(before, [
        {
          type: 'START_INITIATIVE',
          initiative: initiative(before, {
            kind: 'aid',
            targetNationId: 'nation:swe',
          }),
        },
      ]),
    ).toThrow('another nation');
  });
  it('mobilizes, reinforces, defends and de-escalates through bounded conflict actions', () => {
    const before = fixture();
    let w = run(before, [conflict]);
    for (const stance of ['mobilize', 'reinforce', 'defend', 'deescalate'])
      w = run(w, [
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:rus',
          stance,
        },
      ]);
    expect(w.nations.find((n) => n.id === 'nation:rus')!.stats.readiness).toBe(
      66,
    );
    expect(w.nations.find((n) => n.id === 'nation:rus')!.stats.treasury).toBe(
      before.nations.find((n) => n.id === 'nation:rus')!.stats.treasury - 10,
    );
    expect(w.conflicts[0]!).toMatchObject({ logistics: 58, escalation: 10 });
    expect(() =>
      run(w, [
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:rus',
          stance: 'defend',
          regionId: 'region:ne-fin',
        },
      ]),
    ).toThrow('Region');
  });
  it('does not complete a month-long project a day after late creation', () => {
    let w = run(fixture(), [{ type: 'ADVANCE_DATE', date: '2025-01-30' }]);
    w = run(w, [
      {
        type: 'START_INITIATIVE',
        initiative: initiative(w, { durationDays: 30 }),
      },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    expect(w.initiatives[0]!.progress).toBe(0);
    w = run(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    expect(w.initiatives[0]!.status).toBe('completed');
  });
  it('keeps private targeted initiatives and goals out of target event knowledge', () => {
    const before = fixture();
    const w = run(before, [
      {
        type: 'START_INITIATIVE',
        initiative: initiative(before, {
          visibility: 'private',
          targetNationId: 'nation:fin',
          kind: 'diplomacy',
        }),
      },
      {
        type: 'CREATE_STRATEGIC_GOAL',
        goal: {
          id: 'goal:secret',
          nationId: 'nation:swe',
          title: 'Quiet influence',
          priority: 50,
          status: 'active',
          targetNationIds: ['nation:fin'],
          progress: 0,
          reason: 'Quiet',
          createdDate: before.date,
          updatedDate: before.date,
          visibility: 'private',
        },
      },
    ]);
    expect(
      w.events.every(
        (e) =>
          e.visibility === 'private' &&
          !e.nationIds.includes('nation:fin' as typeof w.playerNationId),
      ),
    ).toBe(true);
  });
  it('withdraws offers and requires canonical acceptance fields', () => {
    let w = fixture();
    w = run(w, [{ type: 'OPEN_NEGOTIATION', negotiation: negotiation(w) }]);
    expect(() =>
      run(w, [
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:cooperation',
          nationId: 'nation:fin',
          move: 'accept',
          message: 'Accept',
        },
      ]),
    ).toThrow('requires treaty');
    expect(() =>
      run(w, [
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:cooperation',
          nationId: 'nation:fin',
          move: 'counter',
          message: 'Counter',
        },
      ]),
    ).toThrow('Counter');
    w = run(w, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:swe',
        move: 'withdraw',
        message: 'Withdrawn',
      },
    ]);
    expect(w.negotiations[0]!.status).toBe('withdrawn');
  });
  it('validates hostile initiative cycles and forged progress on save imports', () => {
    const w = fixture();
    w.initiatives = [
      initiative(w, { dependencies: ['initiative:energy'] }),
      initiative(w, {
        id: 'initiative:energy',
        kind: 'energy',
        dependencies: ['initiative:industry'],
      }),
    ];
    expect(() => assertWorld(w)).toThrow('cycle');
    w.initiatives = [initiative(w, { progress: 100, status: 'completed' })];
    expect(() => assertWorld(w)).toThrow('investment');
  });
  it('migrates legacy fixture to v2 and round trips new entities', () => {
    let w = fixture();
    expect(w.schemaVersion).toBe(3);
    expect(w.nations[0]!.stats.readiness).toBe(50);
    w = run(w, [
      { type: 'START_INITIATIVE', initiative: initiative(w) },
      { type: 'OPEN_NEGOTIATION', negotiation: negotiation(w) },
    ]);
    expect(parseSave(exportSave(w))).toEqual(w);
  });
  it('funds initiatives over time and applies benefits only on completion', () => {
    let w = fixture();
    const n = w.nations.find((v) => v.id === 'nation:swe')!;
    const industry = n.stats.industrial;
    w = run(w, [{ type: 'START_INITIATIVE', initiative: initiative(w) }]);
    expect(w.nations.find((v) => v.id === n.id)!.stats.industrial).toBe(
      industry,
    );
    w = run(w, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
    expect(w.initiatives[0]!.progress).toBe(50);
    w = run(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    expect(w.initiatives[0]!.status).toBe('completed');
    expect(w.nations.find((v) => v.id === n.id)!.stats.industrial).toBe(
      industry + 6,
    );
  });
  it('stalls unfunded projects and respects dependencies', () => {
    let w = fixture();
    w.nations.find((v) => v.id === 'nation:swe')!.stats.treasury = 0;
    w = run(w, [
      { type: 'START_INITIATIVE', initiative: initiative(w, { effort: 10 }) },
      {
        type: 'START_INITIATIVE',
        initiative: initiative(w, {
          id: 'initiative:energy',
          kind: 'energy',
          dependencies: ['initiative:industry'],
        }),
      },
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    expect(w.initiatives.every((i) => i.progress === 0)).toBe(true);
  });
  it('rejects invalid initiative imports, reuse and duplicate active work', () => {
    const w = fixture();
    expect(() =>
      run(w, [
        {
          type: 'START_INITIATIVE',
          initiative: initiative(w, { progress: 10 }),
        },
      ]),
    ).toThrow('no progress');
    expect(() =>
      run(w, [
        { type: 'START_INITIATIVE', initiative: initiative(w) },
        {
          type: 'START_INITIATIVE',
          initiative: initiative(w, { id: 'initiative:other' }),
        },
      ]),
    ).toThrow('Equivalent');
    expect(() =>
      run(w, [
        {
          type: 'START_INITIATIVE',
          initiative: initiative(w, { dependencies: ['initiative:ghost'] }),
        },
      ]),
    ).toThrow('dependencies');
  });
  it('supports cancellation without refund or completed benefits', () => {
    let w = fixture();
    w = run(w, [
      { type: 'START_INITIATIVE', initiative: initiative(w) },
      { type: 'CANCEL_INITIATIVE', initiativeId: 'initiative:industry' },
      { type: 'ADVANCE_DATE', date: '2025-03-02' },
    ]);
    expect(w.initiatives[0]!.status).toBe('cancelled');
    expect(w.initiatives[0]!.progress).toBe(0);
    expect(() =>
      run(w, [
        { type: 'CANCEL_INITIATIVE', initiativeId: 'initiative:industry' },
      ]),
    ).toThrow('active');
  });
  it('acceptance creates a canonical treaty atomically; speech and delay do not', () => {
    let w = fixture();
    w = run(w, [{ type: 'OPEN_NEGOTIATION', negotiation: negotiation(w) }]);
    w = run(w, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:fin',
        move: 'delay',
        message: 'More time',
      },
    ]);
    expect(w.treaties).toHaveLength(0);
    w = run(w, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Agreed',
        treatyId: 'treaty:agreed',
      },
    ]);
    expect(w.negotiations[0]!.status).toBe('accepted');
    expect(w.treaties[0]!.terms).toBe('Defense cooperation');
    expect(() =>
      run(w, [
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:cooperation',
          nationId: 'nation:fin',
          move: 'accept',
          message: 'Again',
          treatyId: 'treaty:again',
        },
      ]),
    ).toThrow('open');
  });
  it('consultations persist agreement without inventing binding treaties', () => {
    let w = fixture();
    w = run(w, [
      {
        type: 'OPEN_NEGOTIATION',
        negotiation: negotiation(w, {
          kind: 'consultation',
          visibility: 'private',
        }),
      },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:fin',
        move: 'accept',
        message: 'Quiet talks agreed',
      },
    ]);
    expect(w.treaties).toHaveLength(0);
    expect(w.negotiations[0]!.status).toBe('accepted');
    expect(w.events.every((v) => v.visibility === 'private')).toBe(true);
  });
  it('counterproposals change terms and recipient, rejection persists', () => {
    let w = fixture();
    w = run(w, [
      { type: 'OPEN_NEGOTIATION', negotiation: negotiation(w) },
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:fin',
        move: 'counter',
        message: 'Trade instead',
        counterTerms: 'Limited defensive consultation',
      },
    ]);
    expect(w.negotiations[0]!.recipientNationId).toBe('nation:swe');
    w = run(w, [
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:cooperation',
        nationId: 'nation:swe',
        move: 'reject',
        message: 'Declined',
      },
    ]);
    expect(w.negotiations[0]!.status).toBe('rejected');
    expect(w.treaties).toHaveLength(0);
  });
  it('requires genuine recipients and future expiry', () => {
    const w = fixture();
    expect(() =>
      run(w, [
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: negotiation(w, { recipientNationId: 'nation:swe' }),
        },
      ]),
    ).toThrow('self');
    expect(() =>
      run(w, [
        { type: 'OPEN_NEGOTIATION', negotiation: negotiation(w) },
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:cooperation',
          nationId: 'nation:rus',
          move: 'accept',
          message: 'Agreed',
          treatyId: 'treaty:invalid',
        },
      ]),
    ).toThrow('party');
    expect(() =>
      run(w, [
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: negotiation(w, { expiresDate: w.date }),
        },
      ]),
    ).toThrow('future');
  });
  it('expires negotiations and goals from simulation time', () => {
    let w = fixture();
    w = run(w, [
      {
        type: 'OPEN_NEGOTIATION',
        negotiation: negotiation(w, { expiresDate: '2025-02-01' }),
      },
      {
        type: 'CREATE_STRATEGIC_GOAL',
        goal: {
          id: 'goal:deadline',
          nationId: 'nation:swe',
          title: 'Deadline',
          priority: 50,
          status: 'active',
          targetNationIds: [],
          progress: 0,
          reason: 'Test',
          createdDate: w.date,
          updatedDate: w.date,
          deadline: '2025-02-01',
        },
      },
      { type: 'ADVANCE_DATE', date: '2025-02-01' },
    ]);
    expect(w.negotiations[0]!.status).toBe('expired');
    expect(w.goals.find((g) => g.id === 'goal:deadline')!.status).toBe(
      'failed',
    );
  });
  it('maintains organization membership and rejects duplicate/unknown members', () => {
    const o = Organization.parse({
      id: 'organization:nordic',
      name: 'Nordic cooperation',
      kind: 'regional',
      members: ['nation:swe'],
      charter: 'Consultation',
    });
    let w = fixture();
    w = run(w, [
      { type: 'CREATE_ORGANIZATION', organization: o },
      {
        type: 'SET_ORGANIZATION_MEMBERSHIP',
        organizationId: o.id,
        nationId: 'nation:fin',
        member: true,
      },
      {
        type: 'SET_ORGANIZATION_MEMBERSHIP',
        organizationId: o.id,
        nationId: 'nation:swe',
        member: false,
      },
    ]);
    expect(w.organizations[0]!.members).toEqual(['nation:fin']);
    expect(() =>
      run(w, [
        {
          type: 'SET_ORGANIZATION_MEMBERSHIP',
          organizationId: o.id,
          nationId: 'nation:fin',
          member: false,
        },
      ]),
    ).toThrow('retain');
  });
  it('strategic combat resolves from capacity/readiness/logistics, changes only control', () => {
    let w = fixture();
    const r = w.regions.find((v) => v.id === 'region:ne-fin')!;
    w.nations.find((v) => v.id === 'nation:rus')!.stats.military = 100;
    w.nations.find((v) => v.id === 'nation:fin')!.stats.military = 10;
    w = run(w, [
      conflict,
      {
        type: 'CONFLICT_ACTION',
        conflictId: 'conflict:crisis',
        nationId: 'nation:rus',
        stance: 'offensive',
        regionId: r.id,
      },
    ]);
    expect(w.regions.find((v) => v.id === r.id)?.controllerNationId).toBe(
      'nation:fin',
    );
    w = run(w, [
      {
        type: 'CONFLICT_ACTION',
        conflictId: 'conflict:crisis',
        nationId: 'nation:rus',
        stance: 'offensive',
        regionId: r.id,
      },
    ]);
    expect(w.regions.find((v) => v.id === r.id)).toMatchObject({
      ownerNationId: 'nation:fin',
      controllerNationId: 'nation:rus',
      geometryId: r.geometryId,
    });
    expect(w.events.at(-1)!.title).toContain('control secured');
  });
  it('records failed offensives and denies unrelated participants', () => {
    let w = fixture();
    w.nations.find((v) => v.id === 'nation:rus')!.stats.military = 1;
    w = run(w, [
      conflict,
      {
        type: 'CONFLICT_ACTION',
        conflictId: 'conflict:crisis',
        nationId: 'nation:rus',
        stance: 'offensive',
        regionId: 'region:ne-fin',
      },
    ]);
    expect(
      w.regions.find((v) => v.id === 'region:ne-fin')!.controllerNationId,
    ).toBe('nation:fin');
    expect(w.events.at(-1)!.title).toContain('repelled');
    expect(() =>
      run(w, [
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:swe',
          stance: 'defend',
        },
      ]),
    ).toThrow('participant');
  });
  it('war has fiscal, readiness, unrest and exhaustion consequences over time', () => {
    const initial = fixture();
    let w = run(initial, [
      conflict,
      { type: 'ADVANCE_DATE', date: '2025-03-02' },
    ]);
    expect(w.conflicts[0]!.exhaustion).toBe(2);
    expect(w.nations.find((v) => v.id === 'nation:fin')!.stats.readiness).toBe(
      48,
    );
    w = run(w, [
      {
        type: 'APPLY_DOMESTIC_PRESSURE',
        nationId: 'nation:fin',
        amount: 20,
        cause: 'War disruption',
      },
    ]);
    expect(
      w.nations.find((v) => v.id === 'nation:fin')!.stats.unrest,
    ).toBeGreaterThan(
      initial.nations.find((v) => v.id === 'nation:fin')!.stats.unrest,
    );
  });
  it('splitting date advancement produces identical mechanical state', () => {
    const base = fixture();
    const long = run(base, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    let split = run(base, [{ type: 'ADVANCE_DATE', date: '2025-01-15' }]);
    split = run(split, [{ type: 'ADVANCE_DATE', date: '2025-02-15' }]);
    split = run(split, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
    expect(split.nations).toEqual(long.nations);
    expect(split.conflicts).toEqual(long.conflicts);
    assertWorld(split);
  });
  it('invalid later commands leave original world and all mechanics untouched', () => {
    const w = fixture();
    const before = structuredClone(w);
    expect(() =>
      run(w, [
        { type: 'START_INITIATIVE', initiative: initiative(w) },
        { type: 'ADVANCE_DATE', date: '2025-03-02' },
        {
          type: 'ADJUST_NATION_STAT',
          nationId: 'nation:swe',
          stat: 'economy',
          delta: 1000,
        },
      ]),
    ).toThrow();
    expect(w).toEqual(before);
  });
});
