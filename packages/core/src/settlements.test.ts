import { describe, expect, it } from 'vitest';
import { Negotiation } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { assertWorld, exportSave, parseSave, resolveTurn } from './index.js';
import {
  conflict,
  context,
  fixture,
  request,
} from '../../../tests/fixtures/world.js';
const run = (w: WorldState, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
const offer = (
  w: WorldState,
  kind: 'ceasefire' | 'peace',
  extra: object = {},
) => ({
  type: 'OPEN_NEGOTIATION',
  negotiation: Negotiation.parse({
    id: `negotiation:${kind}`,
    proposerNationId: 'nation:rus',
    recipientNationId: 'nation:fin',
    topic: kind,
    kind,
    conflictId: 'conflict:crisis',
    terms: 'Stop hostilities',
    createdDate: w.date,
    expiresDate: '2026-01-01',
    ...extra,
  }),
});
const accept = (kind: 'ceasefire' | 'peace', extra: object = {}) => ({
  type: 'RESPOND_NEGOTIATION',
  negotiationId: `negotiation:${kind}`,
  nationId: 'nation:fin',
  move: 'accept',
  message: 'Accepted',
  treatyId: `treaty:${kind}`,
  ...extra,
});
describe('bilateral negotiated conflict settlement', () => {
  it('makes accepted ceasefire canonical and prohibits offensive operations', () => {
    const before = fixture();
    const w = run(before, [
      conflict,
      offer(before, 'ceasefire'),
      accept('ceasefire'),
    ]);
    expect(w.conflicts[0]).toMatchObject({
      status: 'active',
      settlementState: 'ceasefire',
    });
    expect(w.treaties[0]).toMatchObject({
      kind: 'ceasefire',
      conflictId: 'conflict:crisis',
      status: 'active',
    });
    expect(w.events.at(-1)!.title).toContain('offensive operations halted');
    expect(w.events.at(-1)!.conflictIds).toEqual(['conflict:crisis']);
    expect(() =>
      run(w, [
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:rus',
          stance: 'offensive',
          regionId: 'region:ne-fin',
        },
      ]),
    ).toThrow('ceasefire');
    expect(parseSave(exportSave(w))).toEqual(w);
  });
  it('ceasefire reduces disruption and permits exhaustion recovery', () => {
    const before = fixture();
    const war = {
      ...conflict,
      conflict: { ...conflict.conflict, exhaustion: 20 },
    };
    const fighting = run(before, [
      war,
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    const ceasefire = run(before, [
      war,
      offer(before, 'ceasefire'),
      accept('ceasefire'),
      { type: 'ADVANCE_DATE', date: '2025-01-31' },
    ]);
    const fin = (w: WorldState) =>
      w.nations.find((n) => n.id === 'nation:fin')!.stats;
    expect(ceasefire.conflicts[0]!.exhaustion).toBe(19);
    expect(fighting.conflicts[0]!.exhaustion).toBe(21);
    expect(fin(ceasefire).treasury).toBeGreaterThan(fin(fighting).treasury);
    expect(fin(ceasefire).readiness).toBeGreaterThan(fin(fighting).readiness);
    expect(fin(ceasefire).unrest).toBeLessThan(fin(fighting).unrest);
  });
  it('ending a ceasefire treaty explicitly resumes fighting', () => {
    const before = fixture();
    let w = run(before, [
      conflict,
      offer(before, 'ceasefire'),
      accept('ceasefire'),
    ]);
    w = run(w, [
      { type: 'END_TREATY', treatyId: 'treaty:ceasefire' },
      {
        type: 'CONFLICT_ACTION',
        conflictId: 'conflict:crisis',
        nationId: 'nation:rus',
        stance: 'offensive',
        regionId: 'region:ne-fin',
      },
    ]);
    expect(w.conflicts[0]!.settlementState).toBe('fighting');
    expect(w.treaties[0]!.status).toBe('ended');
  });
  it('peace ends conflict and supersedes ceasefire while retaining ownership and control', () => {
    const before = fixture();
    let w = run(before, [
      conflict,
      {
        type: 'TRANSFER_CONTROL',
        regionId: 'region:ne-fin',
        nationId: 'nation:rus',
      },
      offer(before, 'ceasefire'),
      accept('ceasefire'),
    ]);
    const regions = structuredClone(w.regions);
    w = run(w, [offer(w, 'peace'), accept('peace')]);
    expect(w.conflicts[0]!.status).toBe('ended');
    expect(w.regions).toEqual(regions);
    expect(w.treaties.find((t) => t.kind === 'ceasefire')!.status).toBe(
      'ended',
    );
    expect(w.treaties.find((t) => t.kind === 'peace')!.terms).toContain(
      'Current military control is retained; legal ownership is unchanged',
    );
    expect(() =>
      run(w, [
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:rus',
          stance: 'mobilize',
        },
      ]),
    ).toThrow('active conflict');
  });
  it('rejects direct settlement creation and edits that bypass agreed mechanics', () => {
    const before = fixture();
    expect(() =>
      run(before, [
        conflict,
        {
          type: 'CREATE_TREATY',
          treaty: {
            id: 'treaty:ceasefire',
            name: 'Invalid',
            kind: 'ceasefire',
            conflictId: 'conflict:crisis',
            parties: ['nation:rus', 'nation:fin'],
            status: 'active',
            terms: 'Ceasefire',
          },
        },
      ]),
    ).toThrow('accepted negotiation');
    const w = run(before, [conflict, offer(before, 'peace'), accept('peace')]);
    expect(() =>
      run(w, [
        {
          type: 'UPDATE_TREATY',
          treatyId: 'treaty:peace',
          terms: 'Annex Finland',
        },
      ]),
    ).toThrow('fixed');
  });
  it('refuses multilateral, mismatched and unknown conflict offers', () => {
    const before = fixture();
    expect(() => run(before, [offer(before, 'peace')])).toThrow(
      'active conflict',
    );
    expect(() =>
      run(before, [
        conflict,
        offer(before, 'peace', { recipientNationId: 'nation:swe' }),
      ]),
    ).toThrow('opposing sides');
    expect(() =>
      run(before, [
        {
          ...conflict,
          conflict: {
            ...conflict.conflict,
            attackers: ['nation:rus', 'nation:swe'],
          },
        },
        offer(before, 'peace'),
      ]),
    ).toThrow('bilateral');
    expect(() =>
      run(before, [conflict, offer(before, 'peace', { conflictId: null })]),
    ).toThrow('require a conflict');
    expect(() =>
      run(before, [conflict, offer(before, 'peace', { kind: 'trade' })]),
    ).toThrow('other offers');
  });
  it('closes obsolete outstanding settlement offers when a conflict ends', () => {
    const before = fixture();
    const w = run(before, [
      conflict,
      offer(before, 'peace'),
      { type: 'END_CONFLICT', conflictId: 'conflict:crisis' },
    ]);
    expect(w.negotiations[0]!.status).toBe('withdrawn');
    expect(w.negotiations[0]!.responses.at(-1)!.message).toContain(
      'conflict ended',
    );
    expect(() => run(w, [accept('peace')])).toThrow('open');
  });
  it('counterproposals retain conflict correspondence and recipient authorization', () => {
    const before = fixture();
    let w = run(before, [
      conflict,
      offer(before, 'peace'),
      {
        type: 'RESPOND_NEGOTIATION',
        negotiationId: 'negotiation:peace',
        nationId: 'nation:fin',
        move: 'counter',
        message: 'Counter',
        counterTerms: 'Cease hostilities with current control',
      },
    ]);
    expect(() => run(w, [accept('peace')])).toThrow('party');
    w = run(w, [accept('peace', { nationId: 'nation:rus' })]);
    expect(w.conflicts[0]!.status).toBe('ended');
  });
  it('rolls back ceasefire/peace and treaty creation if a later command fails', () => {
    const before = run(fixture(), [conflict]);
    const snapshot = structuredClone(before);
    expect(() =>
      run(before, [
        offer(before, 'ceasefire'),
        accept('ceasefire'),
        {
          type: 'CONFLICT_ACTION',
          conflictId: 'conflict:crisis',
          nationId: 'nation:rus',
          stance: 'offensive',
          regionId: 'region:ne-fin',
        },
      ]),
    ).toThrow('ceasefire');
    expect(before).toEqual(snapshot);
    expect(() =>
      run(before, [
        offer(before, 'peace'),
        accept('peace'),
        {
          type: 'ADJUST_NATION_STAT',
          nationId: 'nation:rus',
          stat: 'military',
          delta: 1000,
        },
      ]),
    ).toThrow();
    expect(before).toEqual(snapshot);
  });
  it('rejects imported settlement contradictions and broken links', () => {
    const before = fixture();
    const valid = run(before, [
      conflict,
      offer(before, 'ceasefire'),
      accept('ceasefire'),
    ]);
    const fighting = structuredClone(valid);
    fighting.conflicts[0]!.settlementState = 'fighting';
    expect(() => assertWorld(fighting)).toThrow('ceasefire');
    const missing = structuredClone(valid);
    missing.treaties[0]!.conflictId = null;
    expect(() => assertWorld(missing)).toThrow('linkage');
    const mismatch = structuredClone(valid);
    mismatch.treaties[0]!.parties[1] = mismatch.playerNationId;
    expect(() => assertWorld(mismatch)).toThrow('match');
  });
});
