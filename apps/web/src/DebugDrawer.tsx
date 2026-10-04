import { api } from './api.js';
import { useEffect, useState } from 'react';
import { NationId, WorldCommand } from '@mandate/schemas';
import type { RegionId, WorldState } from '@mandate/schemas';
import { commandTypes, template } from './debug-templates.js';
interface Props {
  world: WorldState;
  selected: NationId;
  regionId: RegionId;
  busy: boolean;
  validationError: string;
  close: () => void;
  commit: (
    c: WorldCommand | WorldCommand[],
    reason: string,
  ) => Promise<boolean>;
}
export function DebugDrawer({
  world,
  selected,
  regionId,
  busy,
  validationError,
  close,
  commit,
}: Props) {
  const [target, setTarget] = useState(
    (world.nations.find((n) => n.id !== selected) ?? world.nations[0]!).id,
  );
  const [type, setType] = useState<WorldCommand['type']>('TRANSFER_CONTROL');
  const [text, setText] = useState(() =>
    JSON.stringify(
      template('TRANSFER_CONTROL', world, selected, regionId, target),
      null,
      2,
    ),
  );
  const [reason, setReason] = useState('Manual sandbox directive');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'commands' | 'state' | 'semantics'>(
    'commands',
  );
  const [semanticDebug, setSemanticDebug] = useState<unknown>(null);
  useEffect(() => {
    void api('/api/semantic-debug')
      .then(setSemanticDebug)
      .catch(() => setSemanticDebug({ error: 'Audit unavailable' }));
  }, [world.revision]);
  const update = (kind: WorldCommand['type'], nation: NationId) => {
    setType(kind);
    setTarget(nation);
    setText(
      JSON.stringify(
        template(kind, world, selected, regionId, nation),
        null,
        2,
      ),
    );
    setError('');
  };
  const submit = async () => {
    try {
      const command = WorldCommand.parse(JSON.parse(text));
      if (!reason.trim())
        throw new Error('A reason is required for provenance.');
      setError('');
      if (await commit(command, reason)) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid command');
    }
  };
  const forceTerritorialTransfer = async () => {
    const region = world.regions.find((r) => r.id === regionId);
    if (!region) {
      setError('Select a canonical map region first.');
      return;
    }
    const commands: WorldCommand[] = [];
    if (region.ownerNationId !== target)
      commands.push({ type: 'TRANSFER_OWNERSHIP', regionId, nationId: target });
    if (region.controllerNationId !== target)
      commands.push({ type: 'TRANSFER_CONTROL', regionId, nationId: target });
    if (!commands.length) {
      setError(
        `${region.name} already belongs to and is controlled by the selected country.`,
      );
      return;
    }
    const recipient =
      world.nations.find((n) => n.id === target)?.name ?? target;
    if (
      await commit(
        commands,
        `Developer outcome override: force ${region.name} under ${recipient} ownership and control`,
      )
    )
      close();
  };
  return (
    <section
      className="debug-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="debug-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">DEVELOPER WORKSPACE</span>
          <h2 id="debug-title">Command editor</h2>
        </div>
        <button onClick={close} aria-label="Close command editor">
          Close ×
        </button>
      </header>
      <div className="drawer-tabs">
        <button
          aria-pressed={tab === 'commands'}
          onClick={() => setTab('commands')}
        >
          Commands
        </button>
        <button aria-pressed={tab === 'state'} onClick={() => setTab('state')}>
          Canonical state
        </button>
        <button
          aria-pressed={tab === 'semantics'}
          onClick={() => setTab('semantics')}
        >
          Player semantics
        </button>
      </div>
      {tab === 'semantics' ? (
        <pre className="state-json">
          {JSON.stringify(semanticDebug, null, 2)}
        </pre>
      ) : tab === 'state' ? (
        <pre className="state-json">{JSON.stringify(world, null, 2)}</pre>
      ) : (
        <>
          <p className="muted">
            Explicit sandbox edits. Commands validate and commit as one audited
            turn. Developer outcome overrides directly change canonical state.
          </p>
          <div className="form-pair">
            <label>
              Command
              <select
                aria-label="Command"
                value={type}
                onChange={(e) =>
                  update(e.target.value as WorldCommand['type'], target)
                }
              >
                {commandTypes.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Target nation
              <select
                aria-label="Target nation"
                value={target}
                onChange={(e) => update(type, NationId.parse(e.target.value))}
              >
                {world.nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Structured command
            <textarea
              aria-label="Structured command"
              className="command-json"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={4000}
            />
          </label>
          {(error || validationError) && (
            <p className="error" role="alert">
              {error || validationError}
            </p>
          )}
          <footer>
            <small>
              Region: {regionId}
              <br />
              Expected revision: {world.revision}
            </small>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? 'Validating…' : 'Commit command'}
            </button>
          </footer>
          <section className="developer-override">
            <strong>Developer outcome override</strong>
            <p className="muted">
              Force the selected region into the target country immediately.
              This bypasses normal policy, diplomacy and conflict outcomes.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void forceTerritorialTransfer()}
            >
              Force territorial transfer
            </button>
          </section>
        </>
      )}
    </section>
  );
}
