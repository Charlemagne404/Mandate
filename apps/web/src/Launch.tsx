import { useEffect, useState } from 'react';
import { branding } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { api } from './api.js';
import type { CapabilityProfile, ProviderConfig } from '@mandate/ai';

type Operation = (endpoint: string, input?: object) => Promise<unknown>;
export function ModelSetup({ onReady }: { onReady?: () => void }) {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [models, setModels] = useState<
    Array<{ kind: string; baseUrl: string; models: string[]; ok: boolean }>
  >([]);
  const [profile, setProfile] = useState<CapabilityProfile | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('Looking for installed models…');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      void api<{ stage: string; running: boolean }>('/api/play/status')
        .then((p) => {
          if (p.running) setStatus(p.stage);
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [working]);
  const [key, setKey] = useState('');
  const discover = () =>
    api<typeof models>('/api/provider/discovery').then((found) => {
      setModels(found);
      setStatus(
        found.some((p) => p.ok && p.models.length)
          ? 'Choose an installed model, then test it.'
          : 'No local model detected. Open Ollama, or configure an external endpoint below.',
      );
    });
  useEffect(() => {
    void Promise.all([
      api<ProviderConfig>('/api/settings').then(setConfig),
      api<CapabilityProfile | null>('/api/provider/profile').then(setProfile),
      discover(),
    ]).catch((e) => setStatus(String(e)));
  }, []);
  if (!config) return <p role="status">{status}</p>;
  const save = async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        ...config,
        hasApiKey: undefined,
        apiKey: key || undefined,
      }),
    });
  };
  return (
    <div className="model-setup">
      <p>
        Local models keep the campaign on this Mac. An external endpoint
        receives the relevant campaign context.
      </p>
      <div className="model-list">
        {models
          .filter((p) => p.ok)
          .flatMap((p) =>
            p.models
              .filter((m) => !/embed|tts|whisper/i.test(m))
              .map((m) => (
                <button
                  key={p.baseUrl + m}
                  disabled={working}
                  aria-pressed={config.model === m && config.kind === p.kind}
                  onClick={() => {
                    setConfig({
                      ...config,
                      kind: p.kind as ProviderConfig['kind'],
                      baseUrl: p.baseUrl,
                      model: m,
                      contextTokens: 4096,
                      contextBudget: 14000,
                      workflow: 'compact',
                      concurrency: 1,
                      retries: 0,
                      timeoutMs: 45000,
                      maxCalls: 8,
                      maxBackgroundPlanners: 1,
                      maxTurnMs: 180000,
                    });
                    setProfile(null);
                  }}
                >
                  {m}
                  <small>{p.kind} · installed</small>
                </button>
              )),
          )}
      </div>
      {models.some((p) => p.kind === 'ollama' && p.ok) &&
        !models.some((p) => p.models.includes('qwen2.5:3b')) && (
          <button
            disabled={working}
            onClick={() => {
              setWorking(true);
              setStatus(
                'Downloading Qwen 2.5 3B · about 1.9 GB. Existing models are retained.',
              );
              void api('/api/provider/install', {
                method: 'POST',
                body: JSON.stringify({ model: 'qwen2.5:3b' }),
              })
                .then(discover)
                .catch((e) => setStatus(String(e)))
                .finally(() => setWorking(false));
            }}
          >
            Download Qwen 2.5 3B · 1.9 GB
          </button>
        )}
      <p className="muted">
        Qwen 2.5 3B uses the Qwen research license for evaluation; Qwen3 4B
        Instruct uses Apache 2.0. Model weights are separate from Mandate.
      </p>
      <div className="form-pair">
        <label>
          Provider
          <select
            value={config.kind}
            onChange={(e) =>
              setConfig({
                ...config,
                kind: e.target.value as ProviderConfig['kind'],
              })
            }
          >
            <option value="ollama">Ollama on this Mac</option>
            <option value="openai-compatible">
              External / compatible endpoint
            </option>
            <option value="fake">Try deterministic demo rules</option>
          </select>
        </label>
        <label>
          Model
          <input
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
        </label>
      </div>
      <label>
        Endpoint
        <input
          value={config.baseUrl ?? ''}
          placeholder="http://127.0.0.1:11434"
          onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
        />
      </label>
      {config.kind === 'openai-compatible' && (
        <label>
          API key
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      {profile && (
        <div className={`readiness ${profile.rating}`}>
          <strong>{profile.rating.toUpperCase()}</strong>
          <p>{profile.explanation}</p>
          <small>
            {profile.passed}/{profile.total} decisions ·{' '}
            {Math.round(profile.medianMs / 1000)}s median call · one request at
            a time · {profile.contextTokens.toLocaleString()} token window
          </small>
        </div>
      )}
      <p role="status">{status}</p>
      <div className="launch-actions">
        <button
          disabled={working}
          onClick={() => void discover().catch((e) => setStatus(String(e)))}
        >
          Detect again
        </button>
        {window.mandateDesktop?.startOllama && (
          <button
            disabled={working}
            onClick={() =>
              void window.mandateDesktop!.startOllama!()
                .then(() => {
                  setStatus('Ollama opened. Detect again when it is ready.');
                })
                .catch((e) => setStatus(String(e)))
            }
          >
            Open Ollama
          </button>
        )}
        <button
          disabled={working}
          onClick={() => {
            setWorking(true);
            setStatus(
              'Testing six Mandate decisions. This may take a few minutes.',
            );
            void save()
              .then(() =>
                config.kind === 'fake'
                  ? null
                  : api<CapabilityProfile>('/api/provider/profile', {
                      method: 'POST',
                      body: '{}',
                    }),
              )
              .then((p) => {
                setProfile(p);
                setStatus(
                  p
                    ? 'Calibration saved. Read the result before continuing.'
                    : 'Demo selected. Free-form interpretation is limited to its documented rules.',
                );
              })
              .catch((e) => setStatus(String(e)))
              .finally(() => setWorking(false));
          }}
        >
          Save & test model
        </button>
        <button
          className="primary"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void save()
              .then(() => {
                setStatus('Configuration saved.');
                onReady?.();
              })
              .catch((e) => setStatus(String(e)))
              .finally(() => setWorking(false));
          }}
        >
          {onReady ? 'Continue with selected model' : 'Save configuration'}
        </button>
        {working && (
          <button
            onClick={() =>
              void api('/api/play/cancel', { method: 'POST', body: '{}' })
            }
          >
            Cancel test
          </button>
        )}
      </div>
      <details>
        <summary>Setup help & advanced limits</summary>
        <p>
          Install Ollama from ollama.com if it is absent. On this 8 GB Mac,
          start with a 3–4B quantized model. Test it here: a model name alone
          does not establish readiness. No weights are bundled. Deep mode
          increases world attention and waiting time.
        </p>
        <div className="form-pair">
          <label>
            Concurrent requests
            <input
              type="number"
              min={1}
              max={8}
              value={config.concurrency ?? 1}
              onChange={(e) =>
                setConfig({ ...config, concurrency: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Turn time limit (seconds)
            <input
              type="number"
              min={10}
              max={600}
              value={config.maxTurnMs / 1000}
              onChange={(e) =>
                setConfig({
                  ...config,
                  maxTurnMs: Number(e.target.value) * 1000,
                })
              }
            />
          </label>
          <label>
            Maximum AI calls
            <input
              type="number"
              min={3}
              max={80}
              value={config.maxCalls ?? 8}
              onChange={(e) =>
                setConfig({ ...config, maxCalls: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Background governments
            <input
              type="number"
              min={0}
              max={8}
              value={config.maxBackgroundPlanners}
              onChange={(e) =>
                setConfig({
                  ...config,
                  maxBackgroundPlanners: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
      </details>
    </div>
  );
}
export function Launch({
  world,
  busy,
  operate,
  onClose,
  firstRun,
  onQuality,
}: {
  world: WorldState;
  busy: boolean;
  operate: Operation;
  onClose: () => void;
  firstRun: boolean;
  onQuality: (quality: string, days: number) => void;
}) {
  const [step, setStep] = useState(firstRun ? 'welcome' : 'menu');
  const [scenarios, setScenarios] = useState<
    Array<{
      filename: string;
      name: string;
      description: string;
      nations: number;
      startDate: string;
    }>
  >([]);
  const [preview, setPreview] = useState<WorldState | null>(null);
  const [filename, setFilename] = useState('');
  const [country, setCountry] = useState(world.playerNationId);
  const [search, setSearch] = useState('');
  const [quality, setQuality] = useState('balanced');
  const [days, setDays] = useState(30);
  const [observer, setObserver] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    void api<typeof scenarios>('/api/scenarios')
      .then(setScenarios)
      .catch((e) => setStatus(String(e)));
  }, []);
  const own = preview?.nations.find((n) => n.id === country);
  const finish = async () => {
    await api('/api/experience', {
      method: 'POST',
      body: JSON.stringify({ onboarded: true }),
    });
    onClose();
  };
  return (
    <section
      className="launch-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-title"
    >
      <header>
        <div>
          <span className="eyebrow">
            {branding.name} · {branding.version}
          </span>
          <h1 id="launch-title">
            {step === 'welcome'
              ? 'Welcome to Mandate'
              : step === 'model'
                ? 'Your intelligence service'
                : step === 'country'
                  ? 'Choose your government'
                  : step === 'settings'
                    ? 'Shape this campaign'
                    : step === 'briefing'
                      ? 'Your first cabinet briefing'
                      : step === 'scenario'
                        ? 'A world worth entering'
                        : 'Enter a timeline'}
          </h1>
        </div>
        {!firstRun && <button onClick={onClose}>Return to world</button>}
      </header>
      {step === 'welcome' && (
        <>
          <p className="launch-lead">
            Lead a government in a world that continues without you. Make
            proposals, keep promises, face constraints, and follow the history
            your decisions create.
          </p>
          <p>
            The scenarios use fictional governments and abstract capacities.
            They are sandboxes, not forecasts.
          </p>
          <button className="primary" onClick={() => setStep('model')}>
            Set up AI
          </button>
          <button onClick={() => setStep('scenario')}>
            Explore with demo rules
          </button>
        </>
      )}
      {step === 'model' && <ModelSetup onReady={() => setStep('scenario')} />}
      {step === 'menu' && (
        <>
          <article className="continue-card">
            <span className="eyebrow">CURRENT CAMPAIGN · SAVED LOCALLY</span>
            <h2>
              {world.nations.find((n) => n.id === world.playerNationId)?.name}
            </h2>
            <p>
              {world.scenario.name} · {world.date}
            </p>
            <small>
              Last played{' '}
              {world.turns.at(-1)
                ? new Date(world.turns.at(-1)!.recordedAt).toLocaleString()
                : 'Not yet started'}
            </small>
            <button className="primary" onClick={() => void finish()}>
              Continue
            </button>
          </article>
          <div className="launch-actions">
            <button onClick={() => setStep('scenario')}>New game</button>
            <button onClick={() => setStep('model')}>
              AI setup & calibration
            </button>
          </div>
        </>
      )}
      {step === 'scenario' && (
        <>
          <div className="launch-grid">
            {scenarios.map((s) => (
              <button
                className="launch-scenario"
                key={s.filename}
                onClick={() => {
                  setStatus('Opening scenario…');
                  void api<WorldState>(
                    '/api/scenarios/' + s.filename + '/preview',
                  )
                    .then((w) => {
                      setPreview(w);
                      setFilename(s.filename);
                      setCountry(w.playerNationId);
                      setStep('country');
                      setStatus('');
                    })
                    .catch((e) => setStatus(String(e)));
                }}
              >
                <span className="eyebrow">
                  {s.startDate} · {s.nations} POLITIES
                </span>
                <h2>{s.name.split(' · ')[0]}</h2>
                <p>{s.description}</p>
                <small>
                  {s.filename === 'nordic-strategy.json'
                    ? 'Recommended: Sweden, Finland, Norway · regional energy and security choices'
                    : s.nations > 100
                      ? 'Global scope · broad world attention'
                      : 'Compact scope · easier to follow'}
                </small>
              </button>
            ))}
          </div>
          <button onClick={() => setStep('model')}>AI setup</button>
        </>
      )}
      {step === 'country' && preview && (
        <>
          <div className="country-selection">
            <div>
              <label>
                Find a country
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search countries"
                />
              </label>
              <div className="country-list">
                {preview.nations
                  .filter((n) =>
                    n.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((n) => (
                    <button
                      key={n.id}
                      aria-pressed={country === n.id}
                      onClick={() => setCountry(n.id)}
                    >
                      {n.name}
                      <small>{n.government.type}</small>
                    </button>
                  ))}
              </div>
            </div>
            <div className="country-situation">
              {own && (
                <>
                  <span className="eyebrow">GOVERNMENT DOSSIER</span>
                  <h2>{own.name}</h2>
                  <p>
                    {own.government.type} · {own.leader}
                  </p>
                  <p>
                    Policy orientation: {own.strategy.orientation}. Risk
                    tolerance:{' '}
                    {own.strategy.riskTolerance < 35
                      ? 'cautious'
                      : own.strategy.riskTolerance > 65
                        ? 'assertive'
                        : 'measured'}
                    .
                  </p>
                  <h3>Starting priorities</h3>
                  <ul>
                    {preview.goals
                      .filter((g) => g.nationId === own.id)
                      .slice(0, 4)
                      .map((g) => (
                        <li key={g.id}>{g.title}</li>
                      ))}
                  </ul>
                  <h3>Constraints & relationships</h3>
                  <p>
                    Economic capacity{' '}
                    {own.stats.economy >= 65
                      ? 'strong'
                      : own.stats.economy >= 40
                        ? 'moderate'
                        : 'limited'}
                    ; military capacity{' '}
                    {own.stats.military >= 65
                      ? 'substantial'
                      : own.stats.military >= 40
                        ? 'moderate'
                        : 'limited'}
                    .
                  </p>
                  <ul>
                    {preview.relations
                      .filter((r) => [r.nationA, r.nationB].includes(own.id))
                      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
                      .slice(0, 4)
                      .map((r) => (
                        <li key={r.nationA + r.nationB}>
                          {
                            preview.nations.find(
                              (n) =>
                                n.id ===
                                (r.nationA === own.id ? r.nationB : r.nationA),
                            )?.name
                          }
                          :{' '}
                          {r.score > 30
                            ? 'close relationship'
                            : r.score < -30
                              ? 'strained relationship'
                              : 'room to negotiate'}
                        </li>
                      ))}
                  </ul>
                  {own.strategy.redLines.length > 0 && (
                    <p>Red lines: {own.strategy.redLines.join('; ')}</p>
                  )}
                  {preview.crises
                    .filter(
                      (c) =>
                        c.participants.includes(own.id) &&
                        c.status !== 'resolved',
                    )
                    .map((c) => (
                      <p key={c.id}>Active crisis: {c.title}</p>
                    ))}
                </>
              )}
            </div>
          </div>
          <div className="launch-actions">
            <button onClick={() => setStep('scenario')}>Back</button>
            <button
              className="primary"
              disabled={!own}
              onClick={() => setStep('settings')}
            >
              Continue with {own?.name}
            </button>
          </div>
        </>
      )}
      {step === 'settings' && (
        <>
          <label>
            AI quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="fast">Fast · fewer background governments</option>
              <option value="balanced">
                Balanced · recommended starting point
              </option>
              <option value="deep">Deep · more attention, longer waits</option>
            </select>
          </label>
          <label>
            Days per turn
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[7, 30, 90].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={observer}
              onChange={(e) => setObserver(e.target.checked)}
            />{' '}
            Watch history in observer mode
          </label>
          <p>
            All accepted turns save automatically. Branch the timeline before a
            risky choice. National goals are optional direction; you can choose
            a different course.
          </p>
          <button onClick={() => setStep('country')}>Back</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              void operate('/api/scenarios/load', {
                filename,
                nationId: country,
                observer,
              }).then((result) => {
                if (result) {
                  onQuality(quality, days);
                  setStep('briefing');
                } else
                  setStatus(
                    'Could not start this scenario. Your current campaign is preserved.',
                  );
              });
            }}
          >
            Start campaign
          </button>
        </>
      )}
      {step === 'briefing' && own && preview && (
        <>
          <p className="launch-lead">
            You lead {own.name}. Your cabinet favors {own.strategy.orientation}{' '}
            policy.
          </p>
          <h3>What matters now</h3>
          <ul>
            {preview.goals
              .filter((g) => g.nationId === own.id)
              .slice(0, 3)
              .map((g) => (
                <li key={g.id}>{g.title}</li>
              ))}
            {preview.commitments
              .filter((c) => c.issuer === own.id && c.status === 'active')
              .slice(0, 3)
              .map((c) => (
                <li key={c.id}>Promised: {c.terms}</li>
              ))}
          </ul>
          <h3>A possible first move</h3>
          <p>
            {own.strategy.orientation === 'economic'
              ? 'Identify a trade partner and ask for reciprocal market access, or fund one affordable national program.'
              : 'Propose voluntary security consultations with a neighbor. Find out what they will accept before making a binding offer.'}
          </p>
          <p>
            Write your action in the composer. Foreign governments can refuse or
            counter. An offer remains pending until its recipient responds; you
            may hear back in the same turn or after advancing the world.
          </p>
          <button className="primary" onClick={() => void finish()}>
            Enter the world
          </button>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
