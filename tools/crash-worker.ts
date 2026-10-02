import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { fileURLToPath } from 'node:url';
const [filename, stage] = process.argv.slice(2);
if (!filename || !stage)
  throw new Error('Crash worker requires database and fault stage');
const store = openWorldStore({
  filename,
  migrationsDirectory: fileURLToPath(
    new URL('../packages/persistence/migrations', import.meta.url),
  ),
  fault: (current) => {
    if (current === stage) process.kill(process.pid, 'SIGKILL');
  },
});
const w = store.load();
store.commit({
  expectedRevision: w.revision,
  expectedHash: canonicalHash(w),
  action: {
    actorNationId: w.playerNationId,
    source: 'system',
    text: 'Process death atomicity test',
  },
  commands: [
    {
      id: 'command:kill-test',
      reason: 'Fault injection',
      command: { type: 'ADVANCE_DATE', date: '2025-02-01' },
    },
  ],
});
store.close();
