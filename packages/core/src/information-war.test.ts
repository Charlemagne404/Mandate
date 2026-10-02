import { it, expect } from 'vitest';
import { resolveTurn, assertWorld, canonicalStringify } from './index.js';
import { buildContext } from '@mandate/memory';
import {
  fixture,
  request,
  context,
  conflict,
} from '../../../tests/fixtures/world.js';
const step = (w: ReturnType<typeof fixture>, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
const secret = (w: ReturnType<typeof fixture>) =>
  step(w, [
    {
      type: 'CREATE_EVENT',
      event: {
        id: 'event:secret',
        title: 'Russian internal military preparation',
        type: 'military',
        nationIds: ['nation:rus'],
        regionIds: [],
        treatyIds: [],
        conflictIds: [],
        importance: 80,
        topics: ['military'],
        visibility: 'private',
        status: 'unresolved',
      },
    },
  ]);
it('only authorized confirmed disclosure reveals secret canonical fact', () => {
  let w = secret(fixture());
  const fin = w.nations.find((n) => n.id === 'nation:fin')!.id,
    rus = w.nations.find((n) => n.id === 'nation:rus')!.id;
  expect(
    buildContext(w, fin, [rus]).recentEvents.some(
      (e) => e.id === 'event:secret',
    ),
  ).toBe(false);
  w = step(w, [
    {
      type: 'DISCLOSE_INFORMATION',
      issuer: rus,
      recipients: [fin],
      subject: { kind: 'event', id: 'event:secret' },
      source: 'disclosure',
      confidence: 'confirmed',
    },
  ]);
  expect(
    buildContext(w, fin, []).recentEvents.some((e) => e.id === 'event:secret'),
  ).toBe(true);
});
it('suspected reports do not expose exact contents or grant permission to disclose', () => {
  let w = secret(fixture());
  const fin = w.nations.find((n) => n.id === 'nation:fin')!.id,
    rus = w.nations.find((n) => n.id === 'nation:rus')!.id,
    swe = w.playerNationId;
  w = step(w, [
    {
      type: 'DISCLOSE_INFORMATION',
      issuer: rus,
      recipients: [fin],
      subject: { kind: 'event', id: 'event:secret' },
      source: 'ally-sharing',
      confidence: 'suspected',
    },
  ]);
  expect(
    buildContext(w, fin, [rus]).recentEvents.some(
      (e) => e.id === 'event:secret',
    ),
  ).toBe(false);
  expect(buildContext(w, fin, [rus]).canonical.knowledge[0]!.confidence).toBe(
    'suspected',
  );
  expect(() =>
    step(w, [
      {
        type: 'DISCLOSE_INFORMATION',
        issuer: fin,
        recipients: [swe],
        subject: { kind: 'event', id: 'event:secret' },
        source: 'disclosure',
        confidence: 'confirmed',
      },
    ]),
  ).toThrow('unknown');
});
it('mutually forged knowledge records cannot bootstrap secret access in imported state', () => {
  const w = secret(fixture());
  const fin = w.nations.find((n) => n.id === 'nation:fin')!.id,
    swe = w.playerNationId;
  w.knowledge = [
    {
      id: 'knowledge:forged-a',
      issuer: fin,
      recipient: swe,
      subject: { kind: 'event', id: 'event:secret' },
      source: 'disclosure',
      confidence: 'confirmed',
      date: w.date,
    },
    {
      id: 'knowledge:forged-b',
      issuer: swe,
      recipient: fin,
      subject: { kind: 'event', id: 'event:secret' },
      source: 'disclosure',
      confidence: 'confirmed',
      date: w.date,
    },
  ];
  expect(() => assertWorld(w)).toThrow('rooted');
});
const theater = {
  type: 'THEATER_ACTION',
  conflictId: 'conflict:crisis',
  theaterId: 'theater:north',
  nationId: 'nation:rus',
  regionIds: ['region:ne-fin'],
  posture: 'major-offensive',
  allocation: 100,
};
it('strategic theaters spend funds, accumulate supply pressure and cannot instantly paint territory', () => {
  let w = fixture();
  const a = w.nations.find((n) => n.id === 'nation:rus')!,
    d = w.nations.find((n) => n.id === 'nation:fin')!;
  a.stats.military = 100;
  a.stats.readiness = 100;
  a.stats.treasury = 100;
  d.stats.military = 10;
  w = step(w, [conflict, theater]);
  const treasury = w.nations.find((n) => n.id === 'nation:rus')!.stats.treasury;
  w = step(w, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]);
  expect(w.conflicts[0]!.theaters[0]!.progress).toBeLessThanOrEqual(20);
  expect(w.conflicts[0]!.theaters[0]!.supplyPressure).toBe(5);
  expect(
    w.regions.find((r) => r.id === 'region:ne-fin')!.controllerNationId,
  ).toBe('nation:fin');
  expect(
    w.nations.find((n) => n.id === 'nation:rus')!.stats.treasury,
  ).toBeLessThan(treasury);
});
it('theater resolution is deterministic across replays and allocation is bounded', () => {
  const w = step(fixture(), [conflict, theater]);
  const a = step(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]),
    b = step(w, [{ type: 'ADVANCE_DATE', date: '2025-03-02' }]);
  expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  expect(() =>
    step(w, [{ ...theater, theaterId: 'theater:second', allocation: 1 }]),
  ).toThrow('allocation');
});
it('observer mode releases control and choosing a government takes control without restarting', () => {
  let w = step(fixture(), [{ type: 'SET_OBSERVER_MODE', enabled: true }]);
  expect(w.observerMode).toBe(true);
  w = step(w, [
    { type: 'ADVANCE_DATE', date: '2025-02-01' },
    { type: 'SWITCH_NATION', nationId: 'nation:fin' },
  ]);
  expect(w.observerMode).toBe(false);
  expect(w.playerNationId).toBe('nation:fin');
  expect(w.date).toBe('2025-02-01');
  expect(w.turns).toHaveLength(2);
});

it('cannot spend the same forces through legacy and theater resolution', () => {
  const legacy = {
    type: 'CONFLICT_ACTION',
    conflictId: 'conflict:crisis',
    nationId: 'nation:rus',
    stance: 'defend',
  };
  expect(() => step(fixture(), [conflict, theater, legacy])).toThrow(
    'allocated theaters',
  );
  expect(() => step(fixture(), [conflict, legacy, theater])).toThrow(
    'combine legacy',
  );
});
