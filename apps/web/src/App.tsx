import { Launch } from './Launch.js';
import { BranchComparison } from './WorldDepth.js';
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
import { api, parseResponse } from './api.js';
import type { WorldResponse } from './api.js';
import { eventHeadline } from './event-headline.js';
declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
    mandateDesktop?: {
      startOllama?: () => Promise<void>;
      openFolder: (
        kind: 'saves' | 'scenarios' | 'exports' | 'logs',
      ) => Promise<void>;
      importSave: () => Promise<WorldResponse | null>;
      exportSave: () => Promise<{ exported: true } | null>;
      configuration: () => Promise<{ version: 1; nativeDialogs: true }>;
    };
  }
}

function addCalendarMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const firstOfTarget = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth(),
      Math.min(day!, lastDay),
    ),
  )
    .toISOString()
    .slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

export function App() {
  const { state, error, busy, refresh, commit, importSave, operate } =
    useWorld();
  const [followed, setFollowed] = useState<string[]>([]);
  const [launch, setLaunch] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [observerPlaying, setObserverPlaying] = useState(false);
  const [observerSpeed, setObserverSpeed] = useState(3000);
  const [jumping, setJumping] = useState(false);
  const [jumpPreset, setJumpPreset] = useState('3');
  const [customJumpMonths, setCustomJumpMonths] = useState(12);
  const [operations, setOperations] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState('History');
  const [directive, setDirective] = useState('');
  const [quality, setQuality] = useState(() => {
    const saved = localStorage.getItem('mandate-quality');
    return saved && ['fast', 'balanced', 'deep'].includes(saved)
      ? saved
      : 'balanced';
  });
  const [days, setDays] = useState(() => {
    const saved = Number(localStorage.getItem('mandate-days'));
    return [7, 30, 90, 180, 365].includes(saved) ? saved : 30;
  });
  useEffect(() => {
    localStorage.setItem('mandate-quality', quality);
    localStorage.setItem('mandate-days', String(days));
  }, [quality, days]);
  const [progress, setProgress] = useState<{
    stage: string;
    completed: number;
    total: number;
    running: boolean;
    actor?: string;
    startedAt?: string;
    warnings?: string[];
  } | null>(null);
  const [references, setReferences] = useState<
    {
      nationId: string;
      continent: string;
      subregion: string;
      sourceType: string;
      capitals: { name: string; coordinates: [number, number] }[];
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
  const isBusy = busy || jumping;
  const nation =
    world?.nations.find((n) => n.id === selected) ?? world?.nations[0];
  useEffect(() => {
    if (world?.playerNationId) {
      setSelected(world.playerNationId);
      setRegionId(null);
    }
  }, [world?.playerNationId, world?.saveId]);
  useEffect(() => {
    if (!world?.observerMode) setObserverPlaying(false);
  }, [world?.observerMode]);
  useEffect(() => {
    void api<{ onboarded: boolean; developerMode: boolean }>(
      '/api/experience',
    ).then((e) => {
      setDeveloperMode(e.developerMode);
      if (!e.onboarded) {
        setFirstRun(true);
        setLaunch(true);
      }
    });
    document.title = `${branding.name} · ${branding.subtitle}`;
    void api<typeof references>('/api/geographic-reference')
      .then(setReferences)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isBusy) {
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
  }, [isBusy]);
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
  useEffect(() => {
    if (!observerPlaying || !world?.observerMode || isBusy) return;
    const timer = setTimeout(() => {
      void operate('/api/play', { text: '', days, quality }).then((r) => {
        if (!r) setObserverPlaying(false);
      });
    }, observerSpeed);
    return () => clearTimeout(timer);
  }, [
    observerPlaying,
    world?.revision,
    world?.observerMode,
    isBusy,
    days,
    quality,
    observerSpeed,
    operate,
  ]);
  useEffect(() => {
    if (world) {
      try {
        setFollowed(
          JSON.parse(
            localStorage.getItem('mandate-followed:' + world.saveId) ?? '[]',
          ) as string[],
        );
      } catch {
        setFollowed([]);
      }
    }
  }, [world?.saveId]);
  const selectNation = (id: NationId) => {
    setSelected(id);
    setRegionId(null);
  };
  const jumpForward = async () => {
    const months =
      jumpPreset === 'custom' ? customJumpMonths : Number(jumpPreset);
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      setNotice('Choose a jump between 1 and 60 months.');
      return;
    }
    if (isBusy) return;
    setJumping(true);
    setNotice('');
    setWorkspaceTab('History');
    let current = state;
    let completedDate = world?.date ?? '';
    let completedMonths = 0;
    const headlines: { title: string; importance: number }[] = [];
    let interrupted = false;
    try {
      current ??= await api<WorldResponse>('/api/world');
      for (let month = 0; month < months; month++) {
        const nextDate = addCalendarMonths(current.world.date, 1);
        const stepDays = daysBetween(current.world.date, nextDate);
        if (stepDays < 1) break;
        const result = await api<WorldResponse>('/api/play', {
          method: 'POST',
          body: JSON.stringify({
            expectedRevision: current.world.revision,
            expectedHash: current.hash,
            text: '',
            days: stepDays,
            quality,
          }),
        });
        current = parseResponse(result);
        completedDate = current.world.date;
        completedMonths++;
        await refresh();
        const latestTurn = current.world.turns.at(-1);
        const developments = current.world.events
          .filter((event) => event.turnId === latestTurn?.id)
          .sort((a, b) => b.importance - a.importance);
        for (const event of developments.slice(0, 3))
          headlines.push({
            title: eventHeadline(current.world, event),
            importance: event.importance,
          });
        const critical = developments.find(
          (event) =>
            event.importance >= 90 ||
            [
              'OPEN_CRISIS',
              'START_CONFLICT',
              'STRATEGIC_ATTACK',
              'TRANSFER_CONTROL',
            ].includes(event.type),
        );
        if (critical) {
          interrupted = true;
          break;
        }
      }
      const topHeadlines = [
        ...new Map(
          headlines
            .sort((a, b) => b.importance - a.importance)
            .map((event) => [event.title, event]),
        ).values(),
      ]
        .slice(0, 3)
        .map((event) => event.title);
      setNotice(
        `${interrupted ? `Jump paused for a major development · ${completedMonths} of ${months} months` : `Jump complete · ${completedMonths} ${completedMonths === 1 ? 'month' : 'months'}`} · ${completedDate}${topHeadlines.length ? ` · ${topHeadlines.join(' · ')}` : ''}`,
      );
    } catch (e) {
      await refresh();
      setNotice(
        `Jump stopped at ${completedDate || world?.date || 'the current date'}. ${e instanceof Error ? e.message : 'World could not advance.'}`,
      );
    } finally {
      setJumping(false);
    }
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
  const importFile = () => file.current?.click();
  if (!world || !nation)
    return (
      <main className="loading">
        <span className="eyebrow">{branding.name}</span>
        <h1>{error || 'Opening the world archive…'}</h1>
        <button onClick={() => void refresh()}>Retry connection</button>
      </main>
    );
  const player = world.nations.find((n) => n.id === world.playerNationId)!;
  const activeRegion =
    world.regions.find((r) => r.id === regionId)?.id ?? world.regions[0]!.id;
  const selectedRegion = world.regions.find((r) => r.id === regionId) ?? null;
  const regionOwner = selectedRegion
    ? world.nations.find((n) => n.id === selectedRegion.ownerNationId)
    : null;
  const regionController = selectedRegion
    ? world.nations.find((n) => n.id === selectedRegion.controllerNationId)
    : null;
  const branchTimeline = () => {
    const name = `Before ${directive.trim().slice(0, 45) || 'next decision'} — ${world.date}`;
    void operate('/api/timelines/branch', { name }).then((result) => {
      if (result) {
        setNotice('Timeline branched. The original decision point is saved.');
        setWorkspaceTab('Branches');
      }
    });
  };
  const advanceTurn = () => {
    void operate('/api/play', { text: '', days, quality });
  };
  return (
    <main className={`workstation${jumping ? ' is-jumping' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{branding.mark}</span>
          <div>
            <strong>{branding.name}</strong>
            <small>{branding.subtitle}</small>
          </div>
        </div>
        <div className="scenario">
          <span className="eyebrow">CURRENT WORLD</span>
          <strong>{world.scenario.name.split(' · ')[0]}</strong>
        </div>
        <div className="date">
          <time>{world.date}</time>
          <span>TURN {world.revision.toString().padStart(3, '0')}</span>
        </div>
        <label className="player">
          <small>{world.observerMode ? 'TAKE CONTROL' : 'PLAYING AS'}</small>
          <span className="status-dot" />
          <select
            aria-label={world.observerMode ? 'Take control as' : 'Playing as'}
            value={player.id}
            disabled={isBusy}
            onChange={(e) => {
              const nationId = NationId.parse(e.target.value);
              const commands = [
                { type: 'SWITCH_NATION' as const, nationId },
                ...(world.observerMode
                  ? [{ type: 'SET_OBSERVER_MODE' as const, enabled: false }]
                  : []),
              ];
              void commit(commands, 'Take control of a government');
            }}
          >
            {world.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="world-controls" aria-label="World controls">
          <button
            disabled={isBusy}
            onClick={() =>
              void commit(
                { type: 'SET_OBSERVER_MODE', enabled: !world.observerMode },
                'Explicit observer control change',
              )
            }
          >
            {world.observerMode ? 'Leave observer mode' : 'Observe'}
          </button>
          <button onClick={branchTimeline} disabled={isBusy}>
            Branch timeline
          </button>
          <button className="primary" disabled={isBusy} onClick={advanceTurn}>
            Advance turn
          </button>
          <button onClick={() => setLaunch(true)}>Menu</button>
          <button onClick={() => setOperations(true)}>Settings</button>
          {developerMode && (
            <button onClick={() => setDebug(true)}>Debug</button>
          )}
        </nav>
      </header>
      <div className="subbar">
        <div className="map-modes">
          <span className="eyebrow">MAP</span>
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
            Control
          </button>
          <select
            aria-label="More map modes"
            value={['ownership', 'control'].includes(mode) ? '' : mode}
            onChange={(e) => {
              if (e.target.value) setMode(e.target.value as MapMode);
            }}
          >
            <option value="">More layers</option>
            {mapModes.slice(2).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="map-selection" aria-live="polite">
          <strong>{selectedRegion?.name ?? nation.name}</strong>
          {selectedRegion && (
            <span>
              {regionOwner?.name ?? 'Unknown owner'}
              {regionController && regionController.id !== regionOwner?.id
                ? ` · controlled by ${regionController.name}`
                : ''}
              {selectedRegion.claims.length
                ? ` · ${selectedRegion.claims.length} claim${selectedRegion.claims.length === 1 ? '' : 's'}`
                : ''}
            </span>
          )}
        </div>
        <button
          aria-pressed={followed.includes(nation.id)}
          onClick={() => {
            const next = followed.includes(nation.id)
              ? followed.filter((id) => id !== nation.id)
              : [...followed, nation.id];
            setFollowed(next);
            localStorage.setItem(
              'mandate-followed:' + world.saveId,
              JSON.stringify(next),
            );
          }}
        >
          {followed.includes(nation.id) ? 'Following' : 'Follow country'}
        </button>
        <div className="jump-controls" aria-label="Timeline controls">
          <label htmlFor="jump-length">Jump forward</label>
          <select
            id="jump-length"
            aria-label="Jump forward length"
            value={jumpPreset}
            disabled={isBusy}
            onChange={(e) => setJumpPreset(e.target.value)}
          >
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">1 year</option>
            <option value="custom">Custom</option>
          </select>
          {jumpPreset === 'custom' && (
            <input
              aria-label="Custom jump months"
              type="number"
              min={1}
              max={60}
              value={customJumpMonths}
              disabled={isBusy}
              onChange={(e) => setCustomJumpMonths(Number(e.target.value))}
            />
          )}
          <button disabled={isBusy} onClick={() => void jumpForward()}>
            Jump
          </button>
        </div>
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
        <MapView
          key={world.scenario.geographyVersion}
          world={world}
          selected={nation.id}
          focusedRegion={regionId}
          focusCoordinates={
            references.find((r) => r.nationId === nation.id)?.capitals[0]
              ?.coordinates
          }
          mode={mode}
          onSelect={(id, region) => {
            setSelected(id);
            setRegionId(region);
            setWorkspaceTab('Country');
          }}
          onReady={ready}
        />
        <aside className="context-workspace">
          <div className="context-tabs">
            {['History', 'Country', 'Diplomacy', 'Conflicts', 'Branches'].map(
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
          {workspaceTab === 'History' && (
            <Timeline
              world={world}
              selected={nation.id}
              developerMode={developerMode}
              followed={followed}
              references={references}
              onSelect={selectNation}
            />
          )}
          {workspaceTab === 'Diplomacy' && (
            <Diplomacy
              world={world}
              selected={nation.id}
              busy={isBusy}
              operate={operate}
            />
          )}
          {workspaceTab === 'Country' && (
            <Inspector
              world={world}
              nation={nation}
              regionId={regionId}
              onSelect={selectNation}
              onDiplomacy={() => setWorkspaceTab('Diplomacy')}
              onTakeControl={() =>
                void commit(
                  [
                    { type: 'SWITCH_NATION', nationId: nation.id },
                    { type: 'SET_OBSERVER_MODE', enabled: false },
                  ],
                  'Take control from observer mode',
                )
              }
              busy={isBusy}
              operate={operate}
              {...(references.find((r) => r.nationId === nation.id)
                ? {
                    reference: references.find(
                      (r) => r.nationId === nation.id,
                    )!,
                  }
                : {})}
            />
          )}
          {workspaceTab === 'Branches' && <BranchComparison world={world} />}
          {workspaceTab === 'Conflicts' && <Conflicts world={world} />}
        </aside>
      </div>
      <footer className="composer">
        <form
          className="directive-form"
          onSubmit={(e) => {
            e.preventDefault();
            void operate('/api/play', {
              text: directive,
              days,
              quality,
              grounding: {
                selectedNationId: nation.id,
                ...(regionId ? { selectedRegionId: regionId } : {}),
              },
            }).then((result) => {
              if (result) {
                setDirective('');
                setWorkspaceTab('History');
              }
            });
          }}
        >
          <div className="directive-heading">
            <label htmlFor="directive" className="eyebrow">
              {world.observerMode
                ? 'OBSERVER'
                : `${player.name.toUpperCase()} · YOUR NEXT ORDER`}
            </label>
            <small className="action-grounding">
              {selectedRegion
                ? `Focus: ${selectedRegion.name} · ${regionOwner?.name ?? 'owner unknown'}${regionController && regionController.id !== regionOwner?.id ? ` · controlled by ${regionController.name}` : ''}`
                : `Focus: ${nation.name}. Click a country or region to ground your order.`}
            </small>
          </div>
          <div className="directive-input">
            <textarea
              id="directive"
              aria-label={`${player.name} action composer`}
              rows={2}
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              disabled={isBusy || world.observerMode}
              placeholder={`What should ${player.name} do? Give an order, make a demand, start a project, or talk to another government…`}
            />
            <div className="directive-actions">
              <button
                className="primary"
                disabled={isBusy || world.observerMode || !directive.trim()}
              >
                Issue order
              </button>
            </div>
          </div>
          <details className="order-options">
            <summary>Turn pace and model quality</summary>
            <div className="order-options-fields">
              <label>
                Time per order
                <select
                  aria-label="Turn duration"
                  value={days}
                  disabled={isBusy}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[
                    [7, '1 week'],
                    [30, '1 month'],
                    [90, '3 months'],
                    [180, '6 months'],
                    [365, '1 year'],
                  ].map(([n, label]) => (
                    <option key={n} value={n}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                World attention
                <select
                  aria-label="Turn quality"
                  value={quality}
                  disabled={isBusy}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="deep">Deep</option>
                </select>
              </label>
            </div>
          </details>
          {!isBusy && !world.observerMode && (
            <div className="action-suggestions">
              {[
                `Offer ${nation.name === player.name ? 'Finland' : nation.name} a security agreement`,
                selectedRegion
                  ? `Demand ${selectedRegion.name}`
                  : `Start a major public project in ${player.name}`,
                'Set a new course for our government',
              ].map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => setDirective(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          {world.observerMode && (
            <div className="observer-controls">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setObserverPlaying((v) => !v)}
              >
                {observerPlaying ? 'Pause' : 'Play'}
              </button>
              <button type="button" disabled={isBusy} onClick={advanceTurn}>
                Step
              </button>
              <select
                aria-label="Observer speed"
                value={observerSpeed}
                onChange={(e) => setObserverSpeed(Number(e.target.value))}
              >
                <option value={10000}>Slow · 10s between turns</option>
                <option value={3000}>Normal · 3s between turns</option>
                <option value={0}>Fast · as soon as ready</option>
              </select>
              <small>
                The world continues on its own. Choose any government above to
                take control without restarting this timeline.
              </small>
            </div>
          )}
          {isBusy && (
            <div className="turn-progress" role="status">
              <span className="status-dot" />
              {progress?.running
                ? `${progress.actor ? progress.actor + ' is considering its next move' : progress.stage.replaceAll('-', ' ')} · ${Math.floor((Date.now() - Date.parse(progress.startedAt ?? new Date().toISOString())) / 1000)}s`
                : 'Applying commands…'}
              <button
                type="button"
                onClick={() =>
                  void api('/api/play/cancel', { method: 'POST', body: '{}' })
                }
              >
                {jumping ? 'Stop jump here' : 'Cancel turn'}
              </button>
            </div>
          )}
        </form>
        <div className="save-status">
          <span className="status-dot" /> Persisted locally
          <small>
            {world.turns.at(-1)
              ? `Saved ${new Date(world.turns.at(-1)!.recordedAt).toLocaleTimeString()}`
              : 'Ready for your first decision'}
          </small>
        </div>
      </footer>
      {launch && (
        <Modal>
          <Launch
            world={world}
            hash={state.hash}
            busy={isBusy}
            operate={operate}
            firstRun={firstRun}
            onClose={() => {
              setLaunch(false);
              setFirstRun(false);
            }}
            onQuality={(q, d) => {
              setQuality(q);
              setDays(d);
            }}
          />
        </Modal>
      )}
      {operations && (
        <Modal>
          <Operations
            world={world}
            busy={isBusy}
            operate={operate}
            close={() => setOperations(false)}
            developerMode={developerMode}
            onDeveloperMode={setDeveloperMode}
            onImportSave={importFile}
            onExportSave={() => void exportFile()}
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
            busy={isBusy}
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
              <button disabled={isBusy} onClick={() => setSaveText(null)}>
                Cancel
              </button>
              <button
                disabled={isBusy}
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
