import { useEffect, useState } from 'react';
import { api } from './api.js';
import type { WorldState } from '@mandate/schemas';

type Operation = (endpoint: string, input?: object) => Promise<unknown>;
interface Snapshot {
  id: string;
  name: string;
  date: string;
  revision: number;
  kind: string;
  saveId: string;
}
interface Scenario {
  filename: string;
  name: string;
  description: string;
  nations: number;
}
interface Settings {
  kind: 'fake' | 'ollama' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  retries: number;
  temperature: number;
  contextBudget: number;
  contextTokens?: number;
  highImportanceModel?: string;
  roleModels?: Record<string, string>;
  hasApiKey?: boolean;
}
export function Operations({
  world,
  busy,
  operate,
  close,
}: {
  world: WorldState;
  busy: boolean;
  operate: Operation;
  close: () => void;
}) {
  const [tab, setTab] = useState('Timelines');
  const [saves, setSaves] = useState<Snapshot[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState('Timeline ' + world.date);
  const [status, setStatus] = useState('');
  const [key, setKey] = useState('');
  const [localModels, setLocalModels] = useState<
    Array<{
      kind: 'ollama' | 'openai-compatible';
      baseUrl: string;
      ok: boolean;
      models: string[];
    }>
  >([]);
  const [roles, setRoles] = useState('{}');
  const [failures, setFailures] = useState<unknown>([]);
  const [turns, setTurns] = useState(10);
  const reload = async () => {
    const [snapshots, config, scenarioList, errors] = await Promise.all([
      api<Snapshot[]>('/api/timelines'),
      api<Settings>('/api/settings'),
      api<Scenario[]>('/api/scenarios'),
      api<unknown>('/api/model-failures'),
    ]);
    setSaves(snapshots);
    setSettings(config);
    setRoles(JSON.stringify(config.roleModels ?? {}, null, 2));
    setScenarios(scenarioList);
    setFailures(errors);
  };
  useEffect(() => {
    void reload().catch((e) => setStatus(String(e)));
  }, []);
  const run = async (endpoint: string, input?: object) => {
    const result = await operate(endpoint, input);
    if (result) {
      setStatus('Completed.');
      await reload();
    }
  };
  return (
    <section
      className="operations-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operations-title"
    >
      <header>
        <div>
          <span className="eyebrow">LOCAL COMMAND CENTER</span>
          <h2 id="operations-title">World & settings</h2>
        </div>
        <button onClick={close} aria-label="Close world settings">
          Close
        </button>
      </header>
      <div className="drawer-tabs">
        {['Timelines', 'Scenario', 'Models', 'Autoplay', 'Diagnostics'].map(
          (t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ),
        )}
      </div>
      {status && (
        <p role="status" className="operations-status">
          {status}
        </p>
      )}
      {tab === 'Timelines' && (
        <>
          <p className="muted">
            Every turn persists automatically. Named snapshots preserve both
            branches; loading first saves your current history. Branching
            assigns a new timeline ID and records its parent.
          </p>
          <div className="inline-form">
            <input
              aria-label="Save name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              disabled={busy || !name.trim()}
              onClick={() => void run('/api/timelines', { name })}
            >
              Save timeline
            </button>
            <button disabled={busy} onClick={() => void run('/api/rollback')}>
              Rollback last turn
            </button>
          </div>
          <small>
            Active {world.saveId} ·{' '}
            {world.ancestry
              ? `branched from ${world.ancestry.parentSaveId} at turn ${world.ancestry.parentRevision}`
              : 'original timeline'}
          </small>
          <div className="snapshot-list">
            {saves.map((s) => (
              <article key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.date} · turn {s.revision} · {s.kind}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run('/api/timelines/restore', { id: s.id })
                  }
                >
                  Load
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run('/api/timelines/restore', {
                      id: s.id,
                      branch: true,
                    })
                  }
                >
                  Branch
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === 'Scenario' && (
        <>
          <p className="muted">
            A scenario starts a new validated world. Your current history is
            saved first. Political indicators in the alpha are synthetic.
          </p>
          {scenarios.map((s) => (
            <article className="scenario-card" key={s.filename}>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <small>{s.nations} simulated polities</small>
              <button
                disabled={busy}
                onClick={() =>
                  void run('/api/scenarios/load', { filename: s.filename })
                }
              >
                Start scenario
              </button>
            </article>
          ))}
        </>
      )}
      {tab === 'Models' && settings && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void api<typeof localModels>('/api/provider/discovery')
                .then((found) => {
                  setLocalModels(found);
                  setStatus(
                    found.some((p) => p.ok && p.models.length)
                      ? 'Select a detected model, then save configuration.'
                      : 'No local model server found. Existing configured endpoints remain available.',
                  );
                })
                .catch((error) => setStatus(String(error)))
            }
          >
            Find local models
          </button>
          {localModels
            .filter((p) => p.ok)
            .flatMap((p) =>
              p.models
                .filter(
                  (model) => !/embed|rerank|whisper|tts|clip/i.test(model),
                )
                .map((model) => (
                  <button
                    key={p.baseUrl + model}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        kind: p.kind,
                        baseUrl: p.baseUrl,
                        model,
                        ...(p.kind === 'ollama' ? { contextTokens: 8192 } : {}),
                      })
                    }
                  >
                    {p.kind} · {model}
                  </button>
                )),
            )}

          <p className="muted">
            Demo mode uses deterministic keyword rules. Configure a local model
            for broader free-form interpretation. Model output proposes
            commands; the engine validates every consequence. Optional remote
            endpoints receive the selected world context.
          </p>
          <label>
            Provider
            <select
              value={settings.kind}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  kind: e.target.value as Settings['kind'],
                })
              }
            >
              <option value="fake">Deterministic demo</option>
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">
                OpenAI-compatible endpoint
              </option>
            </select>
          </label>
          <div className="form-pair">
            <label>
              Default model
              <input
                value={settings.model}
                onChange={(e) =>
                  setSettings({ ...settings, model: e.target.value })
                }
              />
            </label>
            <label>
              Endpoint
              <input
                placeholder="http://127.0.0.1:11434"
                value={settings.baseUrl ?? ''}
                onChange={(e) =>
                  setSettings({ ...settings, baseUrl: e.target.value })
                }
              />
            </label>
          </div>
          <div className="form-pair">
            <label>
              Timeout in milliseconds
              <input
                type="number"
                min="1000"
                max="180000"
                value={settings.timeoutMs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    timeoutMs: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Context characters
              <input
                type="number"
                min="2000"
                max="200000"
                value={settings.contextBudget}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    contextBudget: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          {settings.kind === 'ollama' && (
            <label>
              Ollama context tokens
              <input
                type="number"
                min="1024"
                max="131072"
                placeholder="Server default"
                value={settings.contextTokens ?? ''}
                onChange={(e) => {
                  const next = { ...settings };
                  if (e.target.value)
                    next.contextTokens = Number(e.target.value);
                  else delete next.contextTokens;
                  setSettings(next);
                }}
              />
              <small>
                Set enough context for prompts and output; larger windows use
                more memory.
              </small>
            </label>
          )}
          <div className="form-pair">
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    temperature: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Transport retries
              <input
                type="number"
                min="0"
                max="2"
                value={settings.retries}
                onChange={(e) =>
                  setSettings({ ...settings, retries: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            High importance model (optional)
            <input
              value={settings.highImportanceModel ?? ''}
              onChange={(e) => {
                const { highImportanceModel: _previous, ...rest } = settings;
                void _previous;
                setSettings(
                  e.target.value
                    ? { ...rest, highImportanceModel: e.target.value }
                    : rest,
                );
              }}
            />
          </label>
          <label>
            Role-specific models (JSON)
            <textarea
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              rows={3}
            />
          </label>
          <label>
            Optional API key (stored on this computer)
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                settings.hasApiKey
                  ? 'A key is stored; enter it again when saving'
                  : 'For optional remote providers'
              }
            />
          </label>
          <div className="inline-form">
            <button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  try {
                    const { hasApiKey, ...config } = settings;
                    void hasApiKey;
                    await api('/api/settings', {
                      method: 'POST',
                      body: JSON.stringify({
                        ...config,
                        baseUrl: config.baseUrl || undefined,
                        roleModels: JSON.parse(roles) as unknown,
                        ...(key ? { apiKey: key } : {}),
                      }),
                    });
                    setStatus('Configuration saved.');
                    await reload();
                  } catch (e) {
                    setStatus(String(e));
                  }
                })();
              }}
            >
              Save model configuration
            </button>
            <button
              onClick={() =>
                void api('/api/provider/health', {
                  method: 'POST',
                  body: '{}',
                }).then((result) => setStatus(JSON.stringify(result)))
              }
            >
              Test provider
            </button>
          </div>
        </>
      )}
      {tab === 'Autoplay' && (
        <>
          <p className="muted">
            Governments pursue goals without a player directive. Every completed
            turn commits independently; cancellation preserves completed
            history.
          </p>
          <label>
            Turns
            <select
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
            >
              {[5, 10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            disabled={busy}
            onClick={() => {
              void operate('/api/autoplay', {
                turns,
                days: 30,
                quality: 'fast',
              }).then((result) =>
                setStatus(
                  JSON.stringify(
                    result &&
                      typeof result === 'object' &&
                      'statistics' in result
                      ? result.statistics
                      : result,
                  ),
                ),
              );
            }}
          >
            Autoplay world
          </button>
          {busy && (
            <button
              onClick={() =>
                void api('/api/play/cancel', { method: 'POST', body: '{}' })
              }
            >
              Stop after current decision
            </button>
          )}
        </>
      )}
      {tab === 'Diagnostics' && (
        <>
          <p className="muted">
            Observable model failures and validation results. Canonical command
            provenance is available from every ledger event.
          </p>
          <pre>{JSON.stringify(failures, null, 2)}</pre>
        </>
      )}
      {window.mandateDesktop && (
        <footer>
          <button
            onClick={() => void window.mandateDesktop?.openFolder('saves')}
          >
            Open Save Folder
          </button>
          <button
            onClick={() => void window.mandateDesktop?.openFolder('logs')}
          >
            Open logs
          </button>
        </footer>
      )}
    </section>
  );
}
