import { useState } from 'react';
import { knowsInformation, executionCapacity } from '@mandate/core';
import { StrategyDossier } from './Strategy.js';
import type { Nation, RegionId, WorldState } from '@mandate/schemas';
export function Inspector({
  nation,
  world,
  regionId,
  onSelect,
  onDiplomacy,
  reference,
  busy = false,
  operate,
}: {
  nation: Nation;
  busy?: boolean;
  operate?: (endpoint: string, input?: object) => Promise<unknown>;
  world: WorldState;
  regionId: RegionId | null;
  onSelect?: (id: import('@mandate/schemas').NationId) => void;
  onDiplomacy?: () => void;
  reference?: {
    continent: string;
    subregion: string;
    sourceType: string;
    capitals: { name: string }[];
    adjacentRegionIds: string[];
  };
}) {
  const tabs = [
    'Overview',
    'Diplomacy',
    'Strategy',
    'Economy',
    'Military',
    'Domestic',
    'Projects',
    'History',
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview');
  const shown = (...sections: Array<(typeof tabs)[number]>) =>
    sections.includes(tab);
  const region = world.regions.find((r) => r.id === regionId);
  const relation = world.relations.find(
    (r) =>
      [r.nationA, r.nationB].includes(nation.id) &&
      [r.nationA, r.nationB].includes(world.playerNationId),
  );
  const name = (id: string) => world.nations.find((n) => n.id === id)!.name;
  return (
    <aside className="inspector" aria-label="Nation inspector">
      <div className="eyebrow">NATION DOSSIER</div>
      <div className="nation-title">
        <span className="nation-swatch" style={{ background: nation.color }} />
        <h1>{nation.name}</h1>
      </div>
      <div className="code-line">
        {nation.id.slice(7).toUpperCase()}{' '}
        <span>
          {nation.id === world.playerNationId
            ? world.observerMode
              ? 'INSPECTION PERSPECTIVE'
              : 'PLAYER CONTROLLED'
            : 'SCENARIO ACTOR'}
        </span>
      </div>
      <nav className="country-tabs" aria-label="Country sections">
        {tabs.map((section) => (
          <button
            key={section}
            aria-label={`Country ${section}`}
            aria-pressed={section === tab}
            onClick={() => setTab(section)}
          >
            {section}
          </button>
        ))}
      </nav>
      <section hidden={!shown('Overview', 'Domestic')}>
        <h2>Administration</h2>
        <p>{nation.government.type}</p>
        <p className="muted">{nation.leader}</p>
        <small>{nation.government.ideology}</small>
        {reference && (
          <div className="reference-info">
            <small>
              {reference.subregion} · {reference.continent}
              <br />
              {reference.sourceType} · geographic classification
              <br />
              Capital:{' '}
              {reference.capitals.map((c) => c.name).join(', ') ||
                'Not provided'}
            </small>
          </div>
        )}
      </section>
      <section hidden={!shown('Overview', 'Economy', 'Military', 'Domestic')}>
        <h2>
          Strategic indicators <span>PROXY / 100</span>
        </h2>
        {(['economy', 'military', 'stability', 'legitimacy'] as const)
          .filter(
            (key) =>
              tab === 'Overview' ||
              (tab === 'Economy' && key === 'economy') ||
              (tab === 'Military' && key === 'military') ||
              (tab === 'Domestic' && ['stability', 'legitimacy'].includes(key)),
          )
          .map((key) => (
            <div className="stat" key={key}>
              <div>
                <span>{key}</span>
                <strong>{nation.stats[key]}</strong>
              </div>
              <meter
                min="0"
                max="100"
                value={nation.stats[key]}
                aria-label={key}
              />
            </div>
          ))}
        {nation.id === world.playerNationId && (
          <div className="line-item">
            <span>Available treasury</span>
            <strong>{nation.stats.treasury}</strong>
          </div>
        )}
      </section>
      {operate && shown('Strategy', 'Diplomacy') && (
        <StrategyDossier
          nation={nation}
          world={world}
          busy={busy}
          operate={operate}
          view={tab === 'Strategy' ? 'strategy' : 'commitments'}
        />
      )}
      <section hidden={!shown('Overview', 'Military')}>
        <h2>Territorial status</h2>
        {region ? (
          <dl>
            <dt>Region</dt>
            <dd>{region.name}</dd>
            <dt>Legal owner</dt>
            <dd data-testid="owner">{name(region.ownerNationId)}</dd>
            <dt>Military control</dt>
            <dd data-testid="controller">{name(region.controllerNationId)}</dd>
            <dt>Claims</dt>
            <dd>{region.claims.map(name).join(', ') || 'None'}</dd>
          </dl>
        ) : (
          <p className="muted">Select a region on the map.</p>
        )}
      </section>
      <section hidden={!shown('Diplomacy')}>
        <h2>Diplomatic position</h2>
        {nation.id !== world.playerNationId && (
          <button onClick={onDiplomacy}>Open diplomacy</button>
        )}
        <p>
          {nation.id === world.playerNationId
            ? 'Your controlled nation'
            : `Relation with ${name(world.playerNationId)}: ${relation?.score ?? 0}`}
        </p>
        {world.treaties
          .filter(
            (t) =>
              t.status === 'active' &&
              t.parties.includes(nation.id) &&
              (t.visibility === 'public' ||
                t.parties.includes(world.playerNationId)),
          )
          .map((t) => (
            <p key={t.id} className="agreement">
              {t.name} · {t.kind}
            </p>
          ))}
        {!world.treaties.some(
          (t) => t.status === 'active' && t.parties.includes(nation.id),
        ) && <small>No active treaty commitments</small>}
      </section>
      <section hidden={!shown('Strategy')}>
        <h2>Strategic goals</h2>
        {world.goals
          .filter(
            (g) =>
              g.nationId === nation.id &&
              (g.visibility === 'public' || nation.id === world.playerNationId),
          )
          .map((g) => (
            <div className="goal" key={g.id}>
              <p>{g.title}</p>
              <small>
                {g.status} · priority {g.priority} · progress {g.progress}% ·
                pressure {g.pressure}
              </small>
              <progress value={g.progress} max={100} />
              <small>
                Evaluation: {g.signals.length ? 'metrics' : g.evaluation.kind}
              </small>
              {g.strategyReview && <p>{g.strategyReview}</p>}
              {!!g.blockers.length && <p>{g.blockers.join(' · ')}</p>}
              {!!g.evidence.length && (
                <details>
                  <summary>Progress evidence</summary>
                  {g.evidence.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </details>
              )}
            </div>
          ))}
      </section>
      <section hidden={!shown('Economy', 'Military', 'Domestic')}>
        <h2>Economic & military capacity</h2>
        <dl>
          {(
            [
              'industrial',
              'fiscal',
              'readiness',
              'manpower',
              'technology',
              'influence',
              'energyExposure',
              'tradeDependence',
              'unrest',
            ] as const
          )
            .filter(
              (key) =>
                (nation.id === world.playerNationId ||
                  ['industrial', 'technology', 'influence'].includes(key)) &&
                (tab === 'Domestic'
                  ? key === 'unrest'
                  : tab === 'Military'
                    ? ['readiness', 'manpower', 'technology'].includes(key)
                    : [
                        'industrial',
                        'fiscal',
                        'influence',
                        'energyExposure',
                        'tradeDependence',
                      ].includes(key)),
            )
            .map((key) => (
              <div className="dossier-pair" key={key}>
                <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                <dd>{nation.stats[key]}</dd>
              </div>
            ))}
        </dl>
      </section>
      <section hidden={!shown('Diplomacy')}>
        <h2>Organizations</h2>
        {world.organizations
          .filter(
            (o) =>
              o.members.includes(nation.id) &&
              (o.visibility !== 'private' ||
                o.members.includes(world.playerNationId)),
          )
          .map((o) => (
            <p key={o.id}>
              {o.name} <small>{o.kind}</small>
            </p>
          ))}
      </section>
      <section hidden={!shown('Diplomacy')}>
        <h2>Bilateral relations</h2>
        {world.relations
          .filter((r) => [r.nationA, r.nationB].includes(nation.id))
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map((r) => {
            const other = r.nationA === nation.id ? r.nationB : r.nationA;
            return (
              <div className="relation-row" key={other}>
                <button onClick={() => onSelect?.(other)}>{name(other)}</button>
                <strong>{r.score}</strong>
                <small>
                  trust {r.trust} · tension {r.tension}
                </small>
                <details>
                  <summary>Relationship details</summary>
                  <p>
                    <strong>Economic links</strong>
                  </p>
                  {world.economicLinks
                    .filter(
                      (l) =>
                        [nation.id, other].includes(l.dependentNationId) &&
                        [nation.id, other].includes(l.partnerNationId),
                    )
                    .map((l) => (
                      <p key={l.id}>
                        {name(l.dependentNationId)} → {name(l.partnerNationId)}{' '}
                        · imports {l.imports} · energy {l.energy} · alternatives{' '}
                        {l.alternatives}
                      </p>
                    ))}
                  <p>
                    <strong>Commitments and agreements</strong>
                  </p>
                  {world.commitments
                    .filter(
                      (c) =>
                        [nation.id, other].includes(c.issuer) &&
                        c.recipients.some(
                          (id) =>
                            [nation.id, other].includes(id) && id !== c.issuer,
                        ) &&
                        (c.visibility === 'public' ||
                          c.issuer === world.playerNationId ||
                          c.recipients.includes(world.playerNationId)),
                    )
                    .map((c) => (
                      <p key={c.id}>
                        {c.terms} · {c.status}
                      </p>
                    ))}
                  {world.treaties
                    .filter(
                      (t) =>
                        t.parties.includes(nation.id) &&
                        t.parties.includes(other) &&
                        knowsInformation(world, world.playerNationId, {
                          kind: 'treaty',
                          id: t.id,
                        }),
                    )
                    .map((t) => (
                      <p key={t.id}>
                        {t.name} · {t.status}
                      </p>
                    ))}
                  {[r.nationA, r.nationB].includes(world.playerNationId) &&
                    r.grievances.length > 0 && (
                      <p>Grievances: {r.grievances.join(' · ')}</p>
                    )}
                  <p>
                    <strong>Visible relationship changes</strong>
                  </p>
                  {r.factors
                    .filter(
                      (f) =>
                        f.visibility === 'public' ||
                        [r.nationA, r.nationB].includes(world.playerNationId),
                    )
                    .slice(-6)
                    .reverse()
                    .map((f, i) => (
                      <p key={i}>
                        {f.date} · {f.scoreDelta >= 0 ? '+' : ''}
                        {f.scoreDelta} relation / {f.trustDelta >= 0 ? '+' : ''}
                        {f.trustDelta} trust · {f.cause}
                      </p>
                    ))}
                  <p>
                    <strong>Important interactions</strong>
                  </p>
                  {world.events
                    .filter(
                      (e) =>
                        e.nationIds.includes(nation.id) &&
                        e.nationIds.includes(other) &&
                        knowsInformation(world, world.playerNationId, {
                          kind: 'event',
                          id: e.id,
                        }),
                    )
                    .slice(-5)
                    .reverse()
                    .map((e) => (
                      <p key={e.id}>
                        {e.date} · {e.title}
                      </p>
                    ))}
                </details>
              </div>
            );
          })}
      </section>
      <section hidden={!shown('Projects')}>
        <h2>National initiatives</h2>
        {nation.id === world.playerNationId && (
          <p className="muted">
            Monthly project effort{' '}
            {world.initiatives
              .filter((i) => i.nationId === nation.id && i.status === 'active')
              .reduce((sum, i) => sum + i.effort, 0)}{' '}
            / execution capacity {executionCapacity(world, nation.id)}
          </p>
        )}
        {world.initiatives
          .filter(
            (i) =>
              i.nationId === nation.id &&
              (i.visibility === 'public' ||
                i.nationId === world.playerNationId),
          )
          .map((i) => (
            <div className="goal" key={i.id}>
              <p>{i.name}</p>
              <small>
                {i.status} · {i.progress}% · {i.durationDays} days · effort{' '}
                {i.effort}/month
              </small>
              {i.blocker && (
                <p>
                  {i.blocker} · {i.delays} delayed installments
                </p>
              )}
              <progress value={i.progress} max={100} />
            </div>
          ))}
      </section>
      {tab === 'Overview' && (
        <section>
          <h2>Current priorities</h2>
          {world.goals
            .filter(
              (g) =>
                g.nationId === nation.id &&
                !['achieved', 'failed', 'abandoned', 'superseded'].includes(
                  g.status,
                ) &&
                (g.visibility === 'public' ||
                  nation.id === world.playerNationId),
            )
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 3)
            .map((g) => (
              <p key={g.id}>
                {g.title}
                <small>
                  {' '}
                  · {g.progress}% · pressure {g.pressure}
                </small>
              </p>
            ))}
          <button onClick={() => setTab('Strategy')}>Inspect strategy</button>
        </section>
      )}
      {tab === 'Economy' && (
        <section>
          <h2>Economic dependencies</h2>
          {world.economicLinks
            .filter(
              (l) =>
                l.dependentNationId === nation.id ||
                l.partnerNationId === nation.id,
            )
            .map((l) => (
              <div key={l.id} className="goal">
                <p>
                  {name(l.dependentNationId)} → {name(l.partnerNationId)}
                </p>
                <small>
                  Imports {l.imports} · exports {l.exports} · energy {l.energy}{' '}
                  · strategic {l.strategicGoods} · finance {l.finance}
                </small>
                <p>
                  Alternatives {l.alternatives} · adaptation {l.adaptation}
                </p>
              </div>
            ))}
        </section>
      )}
      {tab === 'Military' && (
        <section>
          <h2>Current conflicts</h2>
          {world.conflicts
            .filter(
              (f) =>
                f.status === 'active' &&
                [...f.attackers, ...f.defenders].includes(nation.id),
            )
            .map((f) => (
              <div key={f.id} className="goal">
                <p>{f.name}</p>
                <small>
                  {f.settlementState} · exhaustion {f.exhaustion} · logistics{' '}
                  {f.logistics}
                </small>
                <div>
                  <strong>STATED WAR GOALS</strong>
                  <p>
                    Strategic objectives only; they are not confirmed world
                    outcomes. {f.warGoals.join(' · ')}
                  </p>
                </div>
                {f.theaters.map((t) => (
                  <p key={t.id}>
                    {t.regionIds
                      .map((id) => world.regions.find((r) => r.id === id)?.name)
                      .join(', ')}{' '}
                    · {t.posture} · progress {t.progress}%
                  </p>
                ))}
              </div>
            ))}
          {!world.conflicts.some(
            (f) =>
              f.status === 'active' &&
              [...f.attackers, ...f.defenders].includes(nation.id),
          ) && <p>No active war</p>}
        </section>
      )}
      {tab === 'Domestic' && (
        <section>
          <h2>Government tenure</h2>
          {world.tenures
            .filter((t) => t.nationId === nation.id)
            .map((t) => (
              <div key={t.id}>
                <p>
                  {t.incumbent} · next election {t.nextElectionDate}
                </p>
                <p>{t.issues.join(' · ')}</p>
                {t.outcomes.slice(-3).map((o, i) => (
                  <small key={i}>
                    {o.date} · {o.winner} · support {o.support}
                  </small>
                ))}
              </div>
            ))}
          {!world.tenures.some((t) => t.nationId === nation.id) && (
            <p>No scheduled succession in this scenario</p>
          )}
        </section>
      )}
      {tab === 'History' && (
        <section>
          <h2>National history</h2>
          {world.events
            .filter(
              (e) =>
                e.nationIds.includes(nation.id) &&
                knowsInformation(world, world.playerNationId, {
                  kind: 'event',
                  id: e.id,
                }),
            )
            .slice(-20)
            .reverse()
            .map((e) => (
              <div key={e.id} className="goal">
                <small>{e.date}</small>
                <p>{e.title}</p>
                <p className="muted">
                  {e.effects
                    .filter(
                      (effect) =>
                        effect.nationId === world.playerNationId ||
                        [
                          'economy',
                          'military',
                          'stability',
                          'legitimacy',
                          'industrial',
                          'technology',
                          'influence',
                        ].includes(effect.stat),
                    )
                    .map(
                      (effect) =>
                        `${name(effect.nationId)} ${effect.stat}: ${effect.before} → ${effect.after}`,
                    )
                    .join(' · ') || `Canonical ${e.type}`}
                </p>
              </div>
            ))}
        </section>
      )}
    </aside>
  );
}
