import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { SaveId } from '@mandate/schemas';
import type { WorldStore } from '@mandate/persistence';

// Presentation and named snapshots are separate from canonical mechanics. Restores
// still go through the same fully validated, stale-write-protected import boundary.
export function openArchive(directory?: string) {
  if (directory) mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(
    directory ? join(directory, 'archive.sqlite') : ':memory:',
  );
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,save_id TEXT NOT NULL,revision INTEGER NOT NULL,simulation_date TEXT NOT NULL,kind TEXT NOT NULL,parent_save_id TEXT,parent_revision INTEGER,save_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS presentation(turn_id TEXT PRIMARY KEY,value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS failures(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,value_json TEXT NOT NULL);`);
  const snapshotColumns = db
    .prepare('PRAGMA table_info(snapshots)')
    .all() as Array<{ name: string }>;
  if (!snapshotColumns.some((column) => column.name === 'parent_save_id'))
    db.exec('ALTER TABLE snapshots ADD COLUMN parent_save_id TEXT');
  if (!snapshotColumns.some((column) => column.name === 'parent_revision'))
    db.exec('ALTER TABLE snapshots ADD COLUMN parent_revision INTEGER');
  return {
    checkpoint(
      store: WorldStore,
      name: string,
      kind: 'named' | 'undo' | 'branch' | 'autosave' = 'named',
    ) {
      const save = store.export();
      const id = randomUUID();
      const audits = store
        .loadAudits()
        .map((a) => ({ turnId: a.turnId, value: a.trace }));
      db.prepare(
        'INSERT INTO snapshots (id,name,created_at,save_id,revision,simulation_date,kind,parent_save_id,parent_revision,save_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        name,
        new Date().toISOString(),
        save.world.saveId,
        save.world.revision,
        save.world.date,
        kind,
        save.world.ancestry?.parentSaveId ?? null,
        save.world.ancestry?.parentRevision ?? null,
        deflateSync(Buffer.from(JSON.stringify({ save, audits })), {
          level: 1,
        }),
      );
      if (kind === 'undo' || kind === 'autosave')
        db.prepare(
          'DELETE FROM snapshots WHERE id IN (SELECT id FROM snapshots WHERE kind=? ORDER BY created_at DESC LIMIT -1 OFFSET 25)',
        ).run(kind);
      return id;
    },
    snapshot(id: string) {
      const row = db
        .prepare('SELECT save_json FROM snapshots WHERE id=?')
        .get(id);
      if (!row) throw new Error('Saved timeline does not exist.');
      const encoded =
        row.save_json instanceof Uint8Array
          ? inflateSync(row.save_json, {
              maxOutputLength: 256 * 1024 * 1024,
            }).toString('utf8')
          : String(row.save_json);
      return (JSON.parse(encoded) as { save: ReturnType<WorldStore['export']> })
        .save;
    },
    list() {
      return db
        .prepare(
          'SELECT id,name,created_at AS createdAt,save_id AS saveId,revision,simulation_date AS date,kind,parent_save_id AS parentSaveId,parent_revision AS parentRevision FROM snapshots ORDER BY created_at DESC',
        )
        .all();
    },
    rename(id: string, name: string) {
      const result = db
        .prepare('UPDATE snapshots SET name=? WHERE id=?')
        .run(name, id);
      if (!result.changes) throw new Error('Saved timeline does not exist.');
    },
    remove(id: string) {
      const result = db.prepare('DELETE FROM snapshots WHERE id=?').run(id);
      if (!result.changes) throw new Error('Saved timeline does not exist.');
    },
    restore(
      store: WorldStore,
      id: string,
      revision: number,
      hash: string,
      branch = false,
    ) {
      const row = db
        .prepare('SELECT save_json FROM snapshots WHERE id=?')
        .get(id);
      if (!row) throw new Error('Saved timeline does not exist.');
      const encoded =
        row.save_json instanceof Uint8Array
          ? inflateSync(row.save_json, {
              maxOutputLength: 256 * 1024 * 1024,
            }).toString('utf8')
          : String(row.save_json);
      const snapshot = JSON.parse(encoded) as {
        save: ReturnType<WorldStore['export']>;
        audits: { turnId: string; value: unknown }[];
      };
      const { save, audits } = snapshot;
      if (branch) {
        save.world.ancestry = {
          parentSaveId: save.world.saveId,
          parentRevision: save.world.revision,
        };
        save.world.saveId = SaveId.parse(`save:${randomUUID()}`);
      }
      return store.import(save, revision, hash, audits);
    },
    getSetting(key: string): unknown {
      const row = db
        .prepare('SELECT value_json FROM settings WHERE key=?')
        .get(key);
      return row ? (JSON.parse(String(row.value_json)) as unknown) : undefined;
    },
    setSetting(key: string, value: unknown) {
      db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(
        key,
        JSON.stringify(value),
      );
    },
    present(turnId: string, value: unknown) {
      db.prepare('INSERT OR REPLACE INTO presentation VALUES(?,?)').run(
        turnId,
        JSON.stringify(value),
      );
    },
    presentation(turnId: string): unknown {
      const row = db
        .prepare('SELECT value_json FROM presentation WHERE turn_id=?')
        .get(turnId);
      return row ? (JSON.parse(String(row.value_json)) as unknown) : null;
    },
    failure(value: unknown) {
      db.prepare('INSERT INTO failures VALUES(?,?,?)').run(
        randomUUID(),
        new Date().toISOString(),
        JSON.stringify(value),
      );
      db.exec(
        'DELETE FROM failures WHERE id IN (SELECT id FROM failures ORDER BY created_at DESC LIMIT -1 OFFSET 100)',
      );
    },
    failures() {
      return db
        .prepare(
          'SELECT created_at AS createdAt,value_json FROM failures ORDER BY created_at DESC LIMIT 30',
        )
        .all()
        .map((row) => ({
          createdAt: row.createdAt,
          detail: JSON.parse(String(row.value_json)) as unknown,
        }));
    },
    close() {
      db.close();
    },
  };
}
export type Archive = ReturnType<typeof openArchive>;
