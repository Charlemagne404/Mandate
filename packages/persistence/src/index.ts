import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  ActionId,
  CommitRequest,
  TurnId,
  WorldState as WorldSchema,
} from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import {
  assertWorld,
  canonicalStringify,
  exportSave,
  parseSave,
  resolveTurn,
  WorldError,
} from '@mandate/core';
import type { TurnContext } from '@mandate/core';
import { migrate } from './migrations.js';
import { appendHistory, readWorld, writeEntities } from './rows.js';

export const canonicalHash = (world: WorldState): string =>
  createHash('sha256').update(canonicalStringify(world)).digest('hex');
export interface StoreOptions {
  filename: string;
  migrationsDirectory: string;
  context?: () => TurnContext;
  validateGeography?: (world: WorldState) => void;
  fault?: (
    stage:
      | 'before-transaction'
      | 'after-proposal'
      | 'during-validation'
      | 'during-transaction'
      | 'after-entities'
      | 'before-commit'
      | 'after-commit',
  ) => void;
}
export function openWorldStore(options: StoreOptions) {
  const db = new DatabaseSync(options.filename);
  db.exec(
    'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL',
  );
  try {
    migrate(db, options.migrationsDirectory);
  } catch (error) {
    db.close();
    throw error;
  }
  const transaction = <T>(run: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('PRAGMA defer_foreign_keys = ON');
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const validate = (w: WorldState) => {
    assertWorld(w);
    options.validateGeography?.(w);
  };
  const load = (): WorldState => {
    const w = readWorld(db);
    if (!w) throw new WorldError('DOMAIN', 'No world initialized');
    validate(w);
    return w;
  };
  const replace = (w: WorldState) => {
    w = WorldSchema.parse(w);
    validate(w);
    for (const table of [
      'turn_audits',
      'event_sources',
      'events',
      'commands',
      'actions',
      'turns',
    ])
      db.exec(`DELETE FROM ${table}`);
    writeEntities(db, w);
    appendHistory(db, w, 0);
    const persisted = load();
    if (canonicalHash(persisted) !== canonicalHash(w))
      throw new Error('Persistence readback mismatch');
    return persisted;
  };
  return {
    initialize(world: WorldState) {
      return transaction(() => {
        if (readWorld(db)) return load();
        for (const table of [
          'nations',
          'regions',
          'turns',
          'commands',
          'events',
        ])
          if (
            db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
              ?.count !== 0
          )
            throw new WorldError(
              'INVARIANT',
              'Missing world metadata in a nonempty database. Refusing to reset it.',
            );
        if (world.revision !== 0)
          throw new WorldError(
            'DOMAIN',
            'Initialization requires a genesis scenario.',
          );
        return replace(world);
      });
    },
    load,
    commit(input: unknown, audit?: unknown) {
      options.fault?.('before-transaction');
      const committed = transaction(() => {
        const before = load();
        const { expectedHash, ...request } = CommitRequest.parse(input);
        if (canonicalHash(before) !== expectedHash)
          throw new WorldError(
            'STALE_REVISION',
            'World changed. Refresh before submitting.',
          );
        const context = options.context?.() ?? {
          turnId: TurnId.parse(`turn:${randomUUID()}`),
          actionId: ActionId.parse(`action:${randomUUID()}`),
          recordedAt: new Date().toISOString(),
        };
        const after = resolveTurn(before, request, context);
        options.fault?.('after-proposal');
        options.fault?.('during-validation');
        validate(after);
        options.fault?.('during-transaction');
        writeEntities(db, after);
        options.fault?.('after-entities');
        appendHistory(db, after, before.revision);
        if (audit !== undefined) {
          const encoded = JSON.stringify(audit);
          if (!encoded || encoded.length > 5000000)
            throw new WorldError('DOMAIN', 'Invalid or oversized turn audit');
          db.prepare('INSERT INTO turn_audits VALUES (?,?,?)').run(
            context.turnId,
            after.revision,
            encoded,
          );
        }
        const persisted = load();
        if (canonicalHash(persisted) !== canonicalHash(after))
          throw new Error('Persistence readback mismatch');
        options.fault?.('before-commit');
        return persisted;
      });
      options.fault?.('after-commit');
      return committed;
    },
    loadAudit(turnId: string): unknown {
      const row = db
        .prepare('SELECT trace_json FROM turn_audits WHERE turn_id = ?')
        .get(turnId);
      return row ? JSON.parse(String(row.trace_json)) : null;
    },
    loadAudits(): { turnId: string; revision: number; trace: unknown }[] {
      return db
        .prepare(
          'SELECT turn_id,revision,trace_json FROM turn_audits ORDER BY revision',
        )
        .all()
        .map((row) => ({
          turnId: String(row.turn_id),
          revision: Number(row.revision),
          trace: JSON.parse(String(row.trace_json)) as unknown,
        }));
    },
    export() {
      return exportSave(load());
    },
    import(
      input: unknown,
      expectedRevision: number,
      expectedHash: string,
      audits?: { turnId: string; value: unknown }[],
    ) {
      const world = parseSave(input);
      validate(world);
      return transaction(() => {
        const current = load();
        if (
          current.revision !== expectedRevision ||
          canonicalHash(current) !== expectedHash
        )
          throw new WorldError(
            'STALE_REVISION',
            'World changed before import. Refresh and try again.',
          );
        const replaced = replace(world);
        if (audits) {
          if (
            audits.length > world.turns.length ||
            new Set(audits.map((a) => a.turnId)).size !== audits.length
          )
            throw new WorldError('DOMAIN', 'Invalid audit collection');
          let totalSize = 0;
          for (const audit of audits) {
            const turn = world.turns.find((t) => t.id === audit.turnId);
            const encoded = JSON.stringify(audit.value);
            totalSize += encoded?.length ?? 0;
            if (
              !turn ||
              !encoded ||
              encoded.length > 5000000 ||
              totalSize > 50000000
            )
              throw new WorldError(
                'DOMAIN',
                'Invalid or oversized imported turn audit',
              );
            db.prepare('INSERT INTO turn_audits VALUES (?,?,?)').run(
              turn.id,
              turn.revision,
              encoded,
            );
          }
        }
        return replaced;
      });
    },
    close() {
      db.close();
    },
  };
}
export type WorldStore = ReturnType<typeof openWorldStore>;
