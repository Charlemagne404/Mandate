import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync, directory: string): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL)',
  );
  const files = readdirSync(directory)
    .filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name))
    .sort();
  if (!files.length) throw new Error('No database migrations found.');
  const applied = db
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all();
  for (const row of applied)
    if (!files.includes(String(row.version)))
      throw new Error('Database contains an unsupported migration.');
  for (const file of files) {
    const sql = readFileSync(join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db
        .prepare('SELECT checksum FROM schema_migrations WHERE version = ?')
        .get(file);
      if (existing && existing.checksum !== checksum)
        throw new Error(`Migration checksum mismatch: ${file}`);
      if (!existing) {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(
          file,
          checksum,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
