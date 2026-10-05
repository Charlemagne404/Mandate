import { buildSemanticGraph } from '@mandate/ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openWorldStore, canonicalHash } from './index.js';
import type { WorldStore } from './index.js';
import { migrate } from './migrations.js';
import { geographyValidator } from '@mandate/scenarios';
import { parseSave } from '@mandate/core';
import { Treaty } from '@mandate/schemas';
import {
  context,
  control,
  fixture,
  commitRequest as request,
  root,
  treaty,
  conflict,
} from '../../../tests/fixtures/world.js';

const directories: string[] = [];
const stores: WorldStore[] = [];
const directory = () => {
  const d = mkdtempSync(join(tmpdir(), 'mandate-store-'));
  directories.push(d);
  return d;
};
const open = (
  filename: string,
  migrationsDirectory = root + 'packages/persistence/migrations',
  startingRevision = 0,
) => {
  let revision = startingRevision;
  const store = openWorldStore({
    filename,
    migrationsDirectory,
    context: () => context(++revision),
    validateGeography: geographyValidator(
      new Set(fixture().regions.map((r) => r.id)),
      fixture().scenario.geographyVersion,
    ),
  });
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed in restart tests */
    }
  }
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});

describe('SQLite canonical persistence', () => {
  it('round trips complete influence treaty authority, breaches, enforcement and directives across restart', () => {
    const filename = join(directory(), 'influence-treaty.sqlite');
    const store = open(filename);
    const initial = fixture();
    initial.treaties.push(
      Treaty.parse({
        id: 'treaty:influence-persistence',
        name: 'Influence persistence compact',
        kind: 'influence',
        parties: ['nation:swe', 'nation:fin'],
        status: 'active',
        ratifiedDate: initial.date,
        terms: 'Binding security and foreign-policy control.',
        influenceTerms: [
          {
            kind: 'join-patron-wars',
            patronNationId: 'nation:swe',
            subjectNationId: 'nation:fin',
          },
          {
            kind: 'foreign-policy-alignment',
            patronNationId: 'nation:swe',
            subjectNationId: 'nation:fin',
          },
          {
            kind: 'tribute',
            patronNationId: 'nation:swe',
            subjectNationId: 'nation:fin',
            ratePercent: 5,
            paidAmount: 15,
            paymentsMade: 3,
            arrears: 1,
          },
        ],
        breaches: [
          {
            id: 'breach:persistence-test',
            date: initial.date,
            violatingNationId: 'nation:fin',
            injuredNationId: 'nation:swe',
            reason: 'Missed a tribute payment',
            status: 'enforced',
          },
        ],
        enforcements: [
          {
            id: 'enforcement:persistence-test',
            date: initial.date,
            breachId: 'breach:persistence-test',
            patronNationId: 'nation:swe',
            subjectNationId: 'nation:fin',
            action: 'diplomatic-demand',
            result: 'Formal demand issued.',
          },
        ],
        ratificationGovernments: [
          {
            nationId: 'nation:fin',
            government: { type: 'Coalition', ideology: 'Neutralist' },
          },
        ],
      }),
    );
    let world = store.initialize(initial);
    world = store.commit(
      request(world, [
        {
          type: 'ISSUE_PATRON_DIRECTIVE',
          treatyId: 'treaty:influence-persistence',
          patronNationId: 'nation:swe',
          subjectNationId: 'nation:fin',
          directiveId: 'directive:persistence-test',
          kind: 'support-diplomatic-initiative',
          policyText: 'Support the Nordic trade proposal.',
        },
      ]),
    );
    const expectedHash = canonicalHash(world);
    const expectedTreaty = world.treaties[0]!;
    store.close();

    const restored = open(filename).load();
    expect(canonicalHash(restored)).toBe(expectedHash);
    expect(restored.treaties[0]).toEqual(expectedTreaty);
    expect(restored.treaties[0]!.influenceTerms).toHaveLength(3);
    expect(restored.treaties[0]!.breaches).toHaveLength(1);
    expect(restored.treaties[0]!.enforcements).toHaveLength(1);
    expect(restored.treaties[0]!.directives).toHaveLength(1);
    expect(restored.treaties[0]!.ratificationGovernments).toHaveLength(1);
  });
  it('round trips version-three crises, economic dependencies, elections and disclosure after restart', () => {
    const filename = join(directory(), 'continuity.sqlite'),
      store = open(filename);
    const scenario = JSON.parse(
      readFileSync(root + 'data/scenarios/nordic-strategy.json', 'utf8'),
    ) as object;
    const initial = parseSave({ ...scenario, kind: 'save' });
    let w = store.initialize(initial);
    w = store.commit(
      request(w, [
        { type: 'SET_OBSERVER_MODE', enabled: true },
        {
          type: 'DISCLOSE_INFORMATION',
          issuer: 'nation:swe',
          recipients: ['nation:nor'],
          subject: { kind: 'crisis', id: w.crises[0]!.id },
          source: 'ally-sharing',
          confidence: 'confirmed',
        },
      ]),
    );
    const hash = canonicalHash(w);
    store.close();
    const restored = open(filename).load();
    expect(canonicalHash(restored)).toBe(hash);
    expect(restored.crises).toEqual(w.crises);
    expect(restored.economicLinks).toEqual(w.economicLinks);
    expect(restored.tenures).toEqual(w.tenures);
    expect(restored.knowledge).toEqual(w.knowledge);
    expect(restored.observerMode).toBe(true);
  });
  it('persists strategic signals, private directives, relationship factors and obligation breach across restart', () => {
    const filename = join(directory(), 'depth.sqlite'),
      store = open(filename);
    let w = store.initialize(fixture());
    const n = w.nations.find((n) => n.id === 'nation:swe')!;
    w = store.commit(
      request(w, [
        {
          type: 'SET_STRATEGY',
          nationId: n.id,
          strategy: {
            ...n.strategy,
            directives: [
              {
                id: 'neutrality',
                text: 'Maintain neutrality',
                visibility: 'private',
                status: 'active',
                createdDate: w.date,
              },
            ],
          },
        },
        {
          type: 'CREATE_STRATEGIC_GOAL',
          goal: {
            id: 'goal:energy-depth',
            nationId: n.id,
            title: 'Diversify energy',
            priority: 90,
            status: 'active',
            targetNationIds: [],
            progress: 0,
            reason: 'Reduce dependence',
            createdDate: w.date,
            updatedDate: w.date,
            signals: [
              {
                stat: 'energyExposure',
                baseline: n.stats.energyExposure,
                target: 0,
                weight: 1,
              },
            ],
          },
        },
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: {
            id: 'negotiation:aid-depth',
            proposerNationId: n.id,
            recipientNationId: 'nation:fin',
            topic: 'Aid',
            kind: 'consultation',
            terms: 'Funded aid pledge',
            createdDate: w.date,
            expiresDate: '2025-04-01',
            visibility: 'private',
            obligations: [
              {
                issuer: n.id,
                recipients: ['nation:fin'],
                type: 'aid',
                terms: 'Deliver funded aid',
                strength: 'binding',
                dueDate: '2025-02-01',
                expiry: '2025-04-01',
                condition: {
                  kind: 'project',
                  initiativeKind: 'aid',
                  minimumInvestment: 4,
                },
              },
            ],
          },
        },
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:aid-depth',
          nationId: 'nation:fin',
          move: 'accept',
          message: 'We accept',
        },
        { type: 'ADVANCE_DATE', date: '2025-02-01' },
      ]),
    );
    expect(w.commitments[0]!.status).toBe('breached');
    store.close();
    const restarted = open(filename);
    expect(canonicalHash(restarted.load())).toBe(canonicalHash(w));
    expect(
      restarted.load().nations.find((n) => n.id === 'nation:swe')!.strategy
        .directives[0]!.text,
    ).toBe('Maintain neutrality');
    expect(
      restarted.load().goals.find((g) => g.id === 'goal:energy-depth')!.signals,
    ).toHaveLength(1);
    const bad = structuredClone(restarted.export());
    bad.world.commitments = [];
    const hash = canonicalHash(restarted.load());
    expect(() => restarted.import(bad, w.revision, hash)).toThrow('commitment');
    expect(canonicalHash(restarted.load())).toBe(hash);
  });
  it('persists negotiated ceasefire/peace links and settlement state across restart', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const offer = (kind: 'ceasefire' | 'peace') => ({
      type: 'OPEN_NEGOTIATION',
      negotiation: {
        id: `negotiation:${kind}`,
        proposerNationId: 'nation:rus',
        recipientNationId: 'nation:fin',
        topic: kind,
        kind,
        conflictId: 'conflict:crisis',
        terms: 'Stop hostilities',
        createdDate: before.date,
        expiresDate: '2026-01-01',
      },
    });
    const accept = (kind: 'ceasefire' | 'peace') => ({
      type: 'RESPOND_NEGOTIATION',
      negotiationId: `negotiation:${kind}`,
      nationId: 'nation:fin',
      move: 'accept',
      message: 'Accepted',
      treatyId: `treaty:${kind}`,
    });
    const ceased = store.commit(
      request(before, [conflict, offer('ceasefire'), accept('ceasefire')]),
    );
    store.close();
    const reopened = open(filename, undefined, ceased.revision);
    expect(canonicalHash(reopened.load())).toBe(canonicalHash(ceased));
    const peaceful = reopened.commit(
      request(reopened.load(), [offer('peace'), accept('peace')]),
    );
    expect(peaceful.conflicts[0]!.status).toBe('ended');
    expect(peaceful.treaties.find((t) => t.kind === 'ceasefire')!.status).toBe(
      'ended',
    );
    reopened.close();
    const final = open(filename);
    expect(canonicalHash(final.load())).toBe(canonicalHash(peaceful));
    const db = new DatabaseSync(filename);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
  it('rolls back settlement acceptance and conflict state on ledger failure', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const negotiating = store.commit(
      request(before, [
        conflict,
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: {
            id: 'negotiation:peace',
            proposerNationId: 'nation:rus',
            recipientNationId: 'nation:fin',
            topic: 'Peace',
            kind: 'peace',
            conflictId: 'conflict:crisis',
            terms: 'Stop hostilities',
            createdDate: before.date,
            expiresDate: '2026-01-01',
          },
        },
      ]),
    );
    const db = new DatabaseSync(filename);
    db.exec(
      "CREATE TRIGGER fail_settlement BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END",
    );
    expect(() =>
      store.commit(
        request(negotiating, [
          {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: 'negotiation:peace',
            nationId: 'nation:fin',
            move: 'accept',
            message: 'Accepted',
            treatyId: 'treaty:peace',
          },
        ]),
      ),
    ).toThrow('settlement failure');
    expect(canonicalHash(store.load())).toBe(canonicalHash(negotiating));
    expect(store.load().treaties).toHaveLength(0);
    db.close();
  });
  it('persists expanded mechanics and factual effects across restart', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const after = store.commit(
      request(before, [
        {
          type: 'START_INITIATIVE',
          initiative: {
            id: 'initiative:energy',
            nationId: 'nation:swe',
            name: 'Energy investment',
            kind: 'energy',
            startDate: before.date,
            durationDays: 30,
            effort: 2,
          },
        },
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: {
            id: 'negotiation:talks',
            proposerNationId: 'nation:swe',
            recipientNationId: 'nation:fin',
            topic: 'Quiet talks',
            kind: 'consultation',
            terms: 'Consultation',
            visibility: 'private',
            createdDate: before.date,
            expiresDate: '2025-03-01',
          },
        },
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: 'negotiation:talks',
          nationId: 'nation:fin',
          move: 'accept',
          message: 'Accepted',
        },
        {
          type: 'CREATE_ORGANIZATION',
          organization: {
            id: 'organization:nordic',
            name: 'Nordic forum',
            acronym: 'NF',
            kind: 'regional',
            foundingDate: before.date,
            founders: ['nation:swe'],
            members: ['nation:swe'],
            invitedStates: ['nation:fin'],
            invitations: [
              {
                nationId: 'nation:fin',
                invitedDate: before.date,
                updatedDate: before.date,
                status: 'pending',
                lastMove: null,
                message: null,
                counterTerms: null,
              },
            ],
            pendingApplications: [],
            purpose: 'Consultation',
            charter: 'Consultation',
            commitments: [],
            geographicScope: 'Northern Europe',
            history: [],
            status: 'active',
            dissolvedDate: null,
            visibility: 'public',
          },
        },
        { type: 'ADVANCE_DATE', date: '2025-01-31' },
      ]),
      { explanation: 'Observable structured decisions' },
    );
    expect(after.initiatives[0]!.status).toBe('completed');
    expect(after.negotiations[0]!.status).toBe('accepted');
    expect(after.organizations[0]).toMatchObject({
      acronym: 'NF',
      founders: ['nation:swe'],
      members: ['nation:swe'],
      invitedStates: ['nation:fin'],
      geographicScope: 'Northern Europe',
    });
    expect(
      after.events.find((e) => e.type === 'ADVANCE_DATE')!.effects.length,
    ).toBeGreaterThan(0);
    expect(after.events.some((e) => e.type === 'PROJECT_COMPLETED')).toBe(true);
    store.close();
    const reopened = open(filename);
    expect(canonicalHash(reopened.load())).toBe(canonicalHash(after));
    expect(reopened.loadAudit(after.turns[0]!.id)).toEqual({
      explanation: 'Observable structured decisions',
    });
  });
  it('restores timeline audit traces atomically and rejects forged references', () => {
    const store = open(join(directory(), 'world.sqlite'));
    const before = store.initialize(fixture());
    const after = store.commit(request(before, [control]), {
      role: 'resolver',
      accepted: true,
    });
    const save = store.export();
    const audits = store
      .loadAudits()
      .map((a) => ({ turnId: a.turnId, value: a.trace }));
    store.import(save, after.revision, canonicalHash(after), audits);
    expect(store.loadAudits()[0]!.trace).toEqual({
      role: 'resolver',
      accepted: true,
    });
    expect(() =>
      store.import(save, after.revision, canonicalHash(after), [
        { turnId: 'turn:ghost', value: {} },
      ]),
    ).toThrow('audit');
    expect(canonicalHash(store.load())).toBe(canonicalHash(after));
    expect(store.loadAudits()[0]!.trace).toEqual({
      role: 'resolver',
      accepted: true,
    });
    expect(() =>
      store.import(save, after.revision, canonicalHash(after), [
        ...audits,
        ...audits,
      ]),
    ).toThrow('audit');
  });
  it('rolls back commands, facts and time if supplemental trace persistence fails', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const db = new DatabaseSync(filename);
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON turn_audits BEGIN SELECT RAISE(ABORT, 'injected trace failure'); END",
    );
    expect(() =>
      store.commit(
        request(before, [{ type: 'ADVANCE_DATE', date: '2025-01-31' }]),
        {},
      ),
    ).toThrow('trace failure');
    expect(canonicalHash(store.load())).toBe(canonicalHash(before));
    expect(store.loadAudits()).toHaveLength(0);
    db.close();
  });
  it('upgrades an existing v1 database without resetting canonical political state', () => {
    const d = directory();
    const oldMigrations = join(d, 'old-migrations');
    mkdirSync(oldMigrations);
    writeFileSync(
      join(oldMigrations, '001_initial.sql'),
      readFileSync(
        root + 'packages/persistence/migrations/001_initial.sql',
        'utf8',
      ),
    );
    const filename = join(d, 'world.sqlite');
    const db = new DatabaseSync(filename);
    migrate(db, oldMigrations);
    const expected = fixture();
    expected.nations = expected.nations.filter((n) => n.id === 'nation:swe');
    expected.regions = expected.regions.filter(
      (r) => r.ownerNationId === 'nation:swe',
    );
    expected.relations = [];
    expected.goals = [];
    const n = expected.nations[0]!;
    db.prepare('INSERT INTO nations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      n.id,
      n.name,
      n.color,
      n.government.type,
      n.government.ideology,
      n.leader,
      n.stats.economy,
      n.stats.military,
      n.stats.stability,
      n.stats.legitimacy,
      n.stats.treasury,
    );
    for (const r of expected.regions) {
      db.prepare('INSERT INTO regions VALUES (?,?,?,?,?)').run(
        r.id,
        r.name,
        r.geometryId,
        r.ownerNationId,
        r.controllerNationId,
      );
      for (const id of r.claims)
        db.prepare('INSERT INTO claims VALUES (?,?)').run(r.id, id);
    }
    db.prepare('INSERT INTO world_meta VALUES (1,?,?,?,?,?,?,?)').run(
      1,
      expected.saveId,
      JSON.stringify(expected.ancestry),
      JSON.stringify(expected.scenario),
      expected.date,
      0,
      expected.playerNationId,
    );
    db.close();
    const store = open(filename);
    expect(canonicalHash(store.load())).toBe(canonicalHash(expected));
    expect(store.load().schemaVersion).toBe(3);
    expect(store.load().nations[0]!.stats.readiness).toBe(50);
  });
  it('rejects stale writes after an import replaces state at the same revision', () => {
    const store = open(join(directory(), 'world.sqlite'));
    const before = store.initialize(fixture());
    const oldHash = canonicalHash(before);
    const edited = store.export();
    edited.world.nations[0]!.leader = 'Edited scenario cabinet';
    const after = store.import(edited, 0, oldHash);
    expect(after.revision).toBe(before.revision);
    expect(canonicalHash(after)).not.toBe(oldHash);
    expect(() => store.commit(request(before, [control]))).toThrow('Refresh');
    expect(() =>
      store.import({ ...edited, world: before }, 0, oldHash),
    ).toThrow('Refresh');
    expect(canonicalHash(store.load())).toBe(canonicalHash(after));
  });
  it('creates normalized state, mutates, closes, restarts, and matches the exact expected hash', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const after = store.commit(request(before, [control, treaty]));
    const expected = canonicalHash(after);
    store.close();
    const reopened = open(filename);
    expect(canonicalHash(reopened.load())).toBe(expected);
    expect(reopened.load().commands).toHaveLength(2);
    const db = new DatabaseSync(filename);
    expect(
      db
        .prepare(
          'SELECT owner_nation_id,controller_nation_id FROM regions WHERE id = ?',
        )
        .get('region:ne-fin'),
    ).toMatchObject({
      owner_nation_id: 'nation:fin',
      controller_nation_id: 'nation:rus',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
        ?.count,
    ).toBe(10);
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
    db.close();
  });
  it('rolls back both invalid batches and database failures after entities have been written', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const hash = canonicalHash(before);
    expect(() =>
      store.commit(
        request(before, [
          control,
          {
            type: 'ADJUST_NATION_STAT',
            nationId: 'nation:swe',
            stat: 'stability',
            delta: 100,
          },
        ]),
      ),
    ).toThrow();
    expect(canonicalHash(store.load())).toBe(hash);
    const db = new DatabaseSync(filename);
    db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END",
    );
    expect(() => store.commit(request(before, [control]))).toThrow(
      'injected ledger failure',
    );
    expect(canonicalHash(store.load())).toBe(hash);
    for (const table of ['actions', 'turns', 'commands', 'events'])
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,
      ).toBe(0);
    db.close();
  });
  it('round trips readable saves and rejects invalid import without touching existing state', () => {
    const store = open(join(directory(), 'world.sqlite'));
    const before = store.initialize(fixture());
    const after = store.commit(request(before, [control, treaty]));
    const exported = JSON.parse(JSON.stringify(store.export())) as ReturnType<
      WorldStore['export']
    >;
    expect(canonicalHash(store.import(exported, 1, canonicalHash(after)))).toBe(
      canonicalHash(after),
    );
    exported.world.regions[0]!.controllerNationId =
      'nation:ghost' as typeof exported.world.playerNationId;
    expect(() => store.import(exported, 1, canonicalHash(after))).toThrow();
    expect(canonicalHash(store.load())).toBe(canonicalHash(after));
    expect(() =>
      store.import({ formatVersion: 999 }, 1, canonicalHash(after)),
    ).toThrow('version');
    expect(() => store.import(store.export(), 0, canonicalHash(after))).toThrow(
      'Refresh',
    );
    const wrongGeometry = store.export();
    wrongGeometry.world.scenario.geographyVersion = 'future';
    expect(() => store.import(wrongGeometry, 1, canonicalHash(after))).toThrow(
      'geography',
    );
  });
  it('rolls back failed import after replacement writes, preserving the previous state and audit ledger', () => {
    const filename = join(directory(), 'world.sqlite');
    const store = open(filename);
    const before = store.initialize(fixture());
    const after = store.commit(request(before, [control, treaty]));
    const edited = store.export();
    edited.world.nations[0]!.leader = 'Imported cabinet';
    const db = new DatabaseSync(filename);
    db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected import failure'); END",
    );
    expect(() =>
      store.import(edited, after.revision, canonicalHash(after)),
    ).toThrow('injected import failure');
    expect(canonicalHash(store.load())).toBe(canonicalHash(after));
    expect(store.load().commands).toHaveLength(2);
    expect(store.load().events).toHaveLength(2);
    db.close();
  });
  it('serialized writers reject stale revisions, including a second connection', () => {
    const filename = join(directory(), 'world.sqlite');
    const a = open(filename);
    const before = a.initialize(fixture());
    const b = open(filename);
    a.commit(request(before, [control]));
    expect(() => b.commit(request(before, [control]))).toThrow('Refresh');
    expect(a.load().revision).toBe(1);
    expect(b.load().revision).toBe(1);
  });
  it('migrations are repeatable and detect changed already-applied SQL', () => {
    const d = directory();
    const migrations = join(d, 'migrations');
    mkdirSync(migrations);
    for (const file of readdirSync(root + 'packages/persistence/migrations'))
      writeFileSync(
        join(migrations, file),
        readFileSync(root + 'packages/persistence/migrations/' + file, 'utf8'),
      );
    const sql = readFileSync(join(migrations, '001_initial.sql'), 'utf8');
    const filename = join(d, 'world.sqlite');
    const a = open(filename, migrations);
    a.initialize(fixture());
    a.close();
    const b = open(filename, migrations);
    expect(b.load().revision).toBe(0);
    b.close();
    writeFileSync(join(migrations, '001_initial.sql'), sql + '\n-- changed');
    expect(() =>
      openWorldStore({ filename, migrationsDirectory: migrations }),
    ).toThrow('checksum');
  });
  it('refuses to silently reset a corrupted database with missing world metadata', () => {
    const filename = join(directory(), 'world.sqlite');
    const a = open(filename);
    a.initialize(fixture());
    a.close();
    const db = new DatabaseSync(filename);
    db.exec('DELETE FROM world_meta');
    db.close();
    const b = open(filename);
    expect(() => b.initialize(fixture())).toThrow('Refusing to reset');
  });
});

it('persists explicit map grounding through commit, restart and export', () => {
  const filename = join(directory(), 'grounding.sqlite');
  const store = open(filename);
  store.initialize(fixture());
  const input = request(store.load(), [control]);
  input.action.grounding = {
    selectedNationId: fixture().nations[1]!.id,
    selectedRegionId: fixture().regions[1]!.id,
  };
  input.action.text = 'Invade them.';
  input.action.semanticGraph = buildSemanticGraph(store.load(), input.action);
  store.commit(input);
  const expectedGraph = input.action.semanticGraph;
  expect(store.load().actions.at(-1)!.semanticGraph).toEqual(expectedGraph);
  const grounded = store.load().actions.at(-1)!.grounding;
  expect(grounded).toEqual(input.action.grounding);
  store.close();
  stores.splice(stores.indexOf(store), 1);
  const reopened = open(filename, undefined, 1).load().actions.at(-1)!;
  expect(reopened.grounding).toEqual(grounded);
  expect(reopened.semanticGraph).toEqual(expectedGraph);
});
