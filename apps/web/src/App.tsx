import { WorldDepth, BranchComparison } from './WorldDepth.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NationId, RegionId, branding } from '@mandate/schemas';
import type { MapMode } from '@mandate/map';
import { mapModes } from '@mandate/map';
import { useWorld } from './useWorld.js';
import { MapView } from './MapView.js';
import { Inspector } from './Inspector.js';
import { Timeline } from './Timeline.js';
import { DebugDrawer } from './DebugDrawer.js';
import { Modal } from './Modal.js';
import { Operations } from './Operations.js';
import { Diplomacy, Conflicts } from './Diplomacy.js';
import { api } from './api.js';
import type { WorldResponse } from './api.js';
declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
    mandateDesktop?: {
      openFolder: (
        kind: 'saves' | 'scenarios' | 'exports' | 'logs',
      ) => Promise<void>;
      importSave: () => Promise<WorldResponse | null>;
      exportSave: () => Promise<{ exported: true } | null>;
      configuration: () => Promise<{ version: 1; nativeDialogs: true }>;
    };
  }
}
export function App() {
  const { state, error, busy, refresh, commit, importSave, operate } =
    useWorld();
  const [operations, setOperations] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState('Events');
  const [directive, setDirective] = useState('');
  const [quality, setQuality] = useState('balanced');
  const [days, setDays] = useState(7);
  const [progress, setProgress] = useState<{
    stage: string;
    completed: number;
    total: number;
    running: boolean;
  } | null>(null);
  const [provider, setProvider] = useState('fake');
  const [references, setReferences] = useState<
    {
      nationId: string;
      continent: string;
      subregion: string;
      sourceType: string;
      capitals: { name: string }[];
      adjacentRegionIds: string[];
    }[]
  >([]);
  const [selected, setSelected] = useState(NationId.parse('nation:swe'));
  const [regionId, setRegionId] = useState<RegionId | null>(
    RegionId.parse('region:ne-swe'),
  );
  const [mode, setMode] = useState<MapMode>('ownership');
  const [debug, setDebug] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [saveText, setSaveText] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const ready = useCallback(() => setMapReady(true), []);
  const world = state?.world;
  const nation =
    world?.nations.find((n) => n.id === selected) ?? world?.nations[0];
  useEffect(() => {
    document.title = `${branding.name} · ${branding.subtitle}`;
    void api<typeof references>('/api/geographic-reference')
      .then(setReferences)
      .catch(() => {});
  }, []);
  useEffect(() => {
    void api<{ kind: string }>('/api/settings')
      .then((config) => setProvider(config.kind))
      .catch(() => {});
  }, [operations]);
  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }
    const poll = () =>
      void api<typeof progress>('/api/play/status')
        .then(setProgress)
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 500);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!world || !nation) return;
    window.render_game_to_text = () =>
      JSON.stringify({
        mode,
        mapReady,
        revision: world.revision,
        date: world.date,
        playerNationId: world.playerNationId,
        selectedNationId: nation.id,
        selectedRegionId: regionId,
        regions: world.regions.map((r) => ({
          id: r.id,
          owner: r.ownerNationId,
          controller: r.controllerNationId,
        })),
        events: world.events
          .slice(-3)
          .map((e) => ({ id: e.id, title: e.title })),
        hash: state.hash,
        debug,
        error,
        coordinates:
          'Geographic longitude east / latitude north; screen x right, y down.',
      });
    window.advanceTime = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    };
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [world, nation, mode, mapReady, regionId, state, debug, error]);
  const selectNation = (id: NationId) => {
    setSelected(id);
    setRegionId(
      world?.regions.find(
        (r) =>
          (mode === 'control' ? r.controllerNationId : r.ownerNationId) === id,
      )?.id ?? null,
    );
  };
  const exportFile = async () => {
    try {
      if (window.mandateDesktop) {
        const result = await window.mandateDesktop.exportSave();
        if (result) setNotice('Save exported.');
        return;
      }
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${branding.name.toLowerCase()}-${world?.date}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Save exported. All changes are also persisted automatically.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Export failed');
    }
  };
  if (!world || !nation)
    return (
      <main className="loading">
        <span className="eyebrow">{branding.name}</span>
        <h1>{error || 'Opening the world archive…'}</h1>
        <button onClick={() => void refresh()}>Retry connection</button>
      </main>
    );
  const activeRegion =
    world.regions.find((r) => r.id === regionId)?.id ?? world.regions[0]!.id;
  const player = world.nations.find((n) => n.id === world.playerNationId)!;
  const advance = () => {
    const date = new Date(world.date);
    date.setUTCDate(date.getUTCDate() + 7);
    void commit(
      { type: 'ADVANCE_DATE', date: date.toISOString().slice(0, 10) },
      'Advance simulation by seven days',
    );
  };
  return (
    <main className="workstation">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{branding.mark}</span>
          <div>
            <strong>{branding.name}</strong>
            <small>{branding.subtitle}</small>
          </div>
        </div>
        <div className="scenario">
          <span className="eyebrow">
            {world.scenario.synthetic ? 'SYNTHETIC SCENARIO' : 'SCENARIO'}
          </span>
          <strong>{world.scenario.name.split(' · ')[0]}</strong>
        </div>
        <div className="date">
          <time>{world.date}</time>
          <span>TURN {world.revision.toString().padStart(3, '0')}</span>
        </div>
        <div className="player">
          <span className="status-dot" />
          <select
            aria-label="Controlled country"
            value={player.id}
            disabled={busy}
            onChange={(e) =>
              void commit(
                {
                  type: 'SWITCH_NATION',
                  nationId: NationId.parse(e.target.value),
                },
                'Choose controlled country',
              )
            }
          >
            {world.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="World controls">
          <button
            disabled={busy}
            onClick={() =>
              void commit(
                { type: 'SET_OBSERVER_MODE', enabled: !world.observerMode },
                'Explicit observer control change',
              )
            }
          >
            {world.observerMode ? 'Resume control' : 'Observe world'}
          </button>
          <button disabled={busy} onClick={advance}>
            + 7 days
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void operate('/api/play', { text: '', days, quality })
            }
          >
            Advance world
          </button>
          <button onClick={() => void exportFile()}>Export save</button>
          <button
            disabled={busy}
            onClick={() => {
              if (window.mandateDesktop)
                void window.mandateDesktop
                  .importSave()
                  .then((result) => {
                    if (result) void refresh();
                  })
                  .catch((e) => setNotice(String(e)));
              else file.current?.click();
            }}
          >
            Import
          </button>
          <button onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <button className="primary" onClick={() => setDebug(true)}>
            Debug
          </button>
          <button onClick={() => setOperations(true)}>World & settings</button>
        </nav>
      </header>
      <div className="subbar">
        <div>
          <span className="eyebrow">ATLAS VIEW</span>
          <button
            aria-pressed={mode === 'ownership'}
            onClick={() => setMode('ownership')}
          >
            Ownership
          </button>
          <button
            aria-pressed={mode === 'control'}
            onClick={() => setMode('control')}
          >
            Military control
          </button>
          <select
            aria-label="Additional map modes"
            value={['ownership', 'control'].includes(mode) ? '' : mode}
            onChange={(e) => {
              if (e.target.value) setMode(e.target.value as MapMode);
            }}
          >
            <option value="">More map modes</option>
            {mapModes.slice(2).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <label className="country-picker">
          Inspect nation
          <select
            aria-label="Inspect nation"
            value={nation.id}
            onChange={(e) => selectNation(NationId.parse(e.target.value))}
          >
            {world.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <span className="live-status">
          {provider === 'fake' ? 'DETERMINISTIC DEMO' : provider.toUpperCase()}{' '}
          <span className="status-dot" />
        </span>
      </div>
      {(error || notice) && !debug && saveText === null && (
        <div
          className={error ? 'banner error' : 'banner'}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
          <button
            onClick={() => {
              setNotice('');
              if (error) void refresh();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="workspace">
        <Inspector
          busy={busy}
          operate={operate}
          nation={nation}
          world={world}
          regionId={regionId}
          onSelect={selectNation}
          onDiplomacy={() => setWorkspaceTab('Diplomacy')}
          {...(references.find((r) => r.nationId === nation.id)
            ? { reference: references.find((r) => r.nationId === nation.id)! }
            : {})}
        />
        <MapView
          key={world.scenario.geographyVersion}
          world={world}
          selected={nation.id}
          mode={mode}
          onSelect={(id, region) => {
            setSelected(id);
            setRegionId(region);
          }}
          onReady={ready}
        />
        <aside className="context-workspace">
          <div className="context-tabs">
            {['Events', 'Diplomacy', 'Conflicts', 'Overview', 'Branches'].map(
              (tab) => (
                <button
                  key={tab}
                  aria-pressed={workspaceTab === tab}
                  onClick={() => setWorkspaceTab(tab)}
                >
                  {tab}
                </button>
              ),
            )}
          </div>
          {workspaceTab === 'Events' && (
            <Timeline
              world={world}
              selected={nation.id}
              onSelect={selectNation}
            />
          )}
          {workspaceTab === 'Diplomacy' && (
            <Diplomacy
              world={world}
              selected={nation.id}
              busy={busy}
              operate={operate}
            />
          )}
          {workspaceTab === 'Overview' && (
            <WorldDepth
              world={world}
              onSelect={selectNation}
              busy={busy}
              operate={operate}
            />
          )}
          {workspaceTab === 'Branches' && <BranchComparison />}
          {workspaceTab === 'Conflicts' && <Conflicts world={world} />}
        </aside>
      </div>
      <footer className="composer">
        <form
          className="directive-form"
          onSubmit={(e) => {
            e.preventDefault();
            void operate('/api/play', { text: directive, days, quality }).then(
              (result) => {
                if (result) {
                  setDirective('');
                  setWorkspaceTab('Events');
                }
              },
            );
          }}
        >
          <div className="directive-heading">
            <label htmlFor="directive" className="eyebrow">
              {world.observerMode ? 'OBSERVER / ' : 'DIRECTIVE / '}
              {player.name.toUpperCase()}
            </label>
            <small>
              {provider === 'fake'
                ? 'Demo rules: diplomacy, investment, readiness, reform, conflict. Configure a model for broader interpretation.'
                : 'Governments deliberate from their interests. Outcomes are validated before commit.'}
            </small>
          </div>
          <div className="directive-input">
            <textarea
              id="directive"
              rows={2}
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              disabled={busy}
              placeholder="Begin a quiet diplomatic initiative with Finland and Norway. Increase military readiness…"
            />
            <div className="directive-actions">
              <div>
                <select
                  aria-label="Turn quality"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="deep">Deep</option>
                </select>
                <select
                  aria-label="Turn duration"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[7, 30, 90, 365].map((n) => (
                    <option key={n} value={n}>
                      {n} days
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="primary"
                disabled={busy || world.observerMode || !directive.trim()}
              >
                Issue directive
              </button>
            </div>
          </div>
          {busy && (
            <div className="turn-progress" role="status">
              <span className="status-dot" />
              {progress?.running
                ? `${progress.stage} · ${progress.completed}/${progress.total}`
                : 'Applying commands…'}
              <button
                type="button"
                onClick={() =>
                  void api('/api/play/cancel', { method: 'POST', body: '{}' })
                }
              >
                Cancel before commit
              </button>
            </div>
          )}
        </form>
        <div className="save-status">
          <span className="status-dot" /> Persisted locally
          <small title={state.hash}>State {state.hash.slice(0, 12)}</small>
        </div>
      </footer>
      {operations && (
        <Modal>
          <Operations
            world={world}
            busy={busy}
            operate={operate}
            close={() => setOperations(false)}
          />
        </Modal>
      )}
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const selectedFile = e.target.files?.[0];
          e.target.value = '';
          if (selectedFile) {
            if (selectedFile.size > 32 * 1024 * 1024) {
              setNotice('Save exceeds the 32 MiB import limit.');
              return;
            }
            void selectedFile.text().then((text) => {
              setSaveText(text);
              setImportError('');
            });
          }
        }}
      />
      {debug && (
        <Modal>
          <DebugDrawer
            world={world}
            selected={nation.id}
            regionId={activeRegion}
            busy={busy}
            validationError={error}
            close={() => setDebug(false)}
            commit={commit}
          />
        </Modal>
      )}
      {saveText !== null && (
        <Modal>
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <span className="eyebrow">SAVE IMPORT</span>
            <h2 id="import-title">Replace the active sandbox?</h2>
            <p>
              The imported world and complete history will replace the current
              save. Export the current world first if you want to keep it.
            </p>
            <p>Invalid saves are rejected without changing the world.</p>
            {(importError || error) && (
              <p className="error" role="alert">
                {importError || error}
              </p>
            )}
            <div>
              <button disabled={busy} onClick={() => setSaveText(null)}>
                Cancel
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() => {
                  try {
                    const value: unknown = JSON.parse(saveText);
                    void importSave(value).then((ok) => {
                      if (ok) {
                        setSaveText(null);
                        setNotice('Imported save validated and persisted.');
                      }
                    });
                  } catch (e) {
                    setImportError(
                      e instanceof Error ? e.message : 'Invalid JSON',
                    );
                  }
                }}
              >
                Replace sandbox
              </button>
            </div>
          </section>
        </Modal>
      )}
    </main>
  );
}
