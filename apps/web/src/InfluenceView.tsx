import { useMemo } from 'react';
import { influenceProfile } from '@mandate/core';
import type { InfluenceProfile } from '@mandate/core';
import type { NationId, WorldCommand, WorldState } from '@mandate/schemas';

type Commit = (
  command: WorldCommand | WorldCommand[],
  reason: string,
) => Promise<boolean>;
type EnforcementAction =
  WorldState['treaties'][number]['enforcements'][number]['action'];
const dimensions = [
  ['trade', 'Trade'],
  ['finance', 'Finance'],
  ['aid', 'Aid and subsidies'],
  ['debt', 'Debt'],
  ['energy', 'Energy'],
  ['infrastructure', 'Infrastructure'],
  ['security', 'Security'],
  ['marketAccess', 'Market access'],
  ['organization', 'Organizations'],
  ['diplomatic', 'Diplomatic'],
] as const;

function competingPatrons(
  world: WorldState,
  subject: NationId,
  selected: NationId,
) {
  const candidates = new Set<NationId>();
  for (const link of world.economicLinks)
    if (link.dependentNationId === subject)
      candidates.add(link.partnerNationId);
  for (const treaty of world.treaties)
    if (treaty.status === 'active')
      for (const term of treaty.influenceTerms)
        if (term.subjectNationId === subject)
          candidates.add(term.patronNationId);
  for (const organization of world.organizations) {
    if (
      !organization.members.includes(subject) ||
      organization.status !== 'active'
    )
      continue;
    for (const founder of organization.founders) candidates.add(founder);
    for (const commitment of organization.commitments)
      if (commitment.status === 'active') candidates.add(commitment.issuer);
    for (const program of organization.programs)
      if (program.status === 'active' || program.status === 'completed')
        candidates.add(program.issuerNationId);
  }
  return [...candidates]
    .filter((patron) => patron !== selected && patron !== subject)
    .map((patron) => ({
      patron,
      profile: influenceProfile(world, patron, subject),
    }))
    .sort((a, b) => b.profile.leverage - a.profile.leverage);
}

function termLabel(kind: string) {
  return kind
    .replaceAll('-', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function dependenceBand(value: number) {
  if (value >= 75) return 'EXTREME';
  if (value >= 55) return 'HIGH';
  if (value >= 30) return 'MODERATE';
  return 'LOW';
}

function pressureLabel(
  pressure: NonNullable<
    WorldState['negotiations'][number]['conditionalPressure']
  >,
) {
  const condition = {
    rejection: 'if the offer is rejected',
    'joins-rival-alliance': 'if the subject joins a rival alliance',
    'accepts-rival-security': 'if the subject accepts a rival security pact',
  }[pressure.condition];
  const action = {
    suspend: 'suspend',
    withdraw: 'withdraw',
    reduce: 'reduce',
  }[pressure.action];
  return `${condition}, ${action} ${pressure.channel.replaceAll('-', ' ')} support`;
}

function ProfileCard({
  world,
  profile,
  selected,
  onSelect,
  commit,
  busy,
}: {
  world: WorldState;
  profile: InfluenceProfile;
  selected: NationId;
  onSelect: (id: NationId) => void;
  commit: Commit;
  busy: boolean;
}) {
  const subject = world.nations.find(
    (nation) => nation.id === profile.subjectNationId,
  )!;
  const name = (id: NationId) =>
    world.nations.find((nation) => nation.id === id)?.name ?? id;
  const agreements = world.treaties.filter(
    (treaty) =>
      treaty.status === 'active' &&
      treaty.parties.includes(selected) &&
      treaty.parties.includes(subject.id),
  );
  const directives = agreements.flatMap((treaty) =>
    treaty.directives
      .filter(
        (directive) =>
          directive.patronNationId === selected &&
          directive.subjectNationId === subject.id,
      )
      .map((directive) => ({ directive, treaty })),
  );
  const negotiations = world.negotiations
    .filter(
      (negotiation) =>
        negotiation.kind === 'influence' &&
        [negotiation.proposerNationId, negotiation.recipientNationId].includes(
          selected,
        ) &&
        [negotiation.proposerNationId, negotiation.recipientNationId].includes(
          subject.id,
        ),
    )
    .sort((left, right) => right.createdDate.localeCompare(left.createdDate))
    .slice(0, 4);
  const rivals = competingPatrons(world, subject.id, selected);
  const strategyPlan = world.nations
    .find((nation) => nation.id === selected)
    ?.strategy.influencePlans.find(
      (plan) => plan.targetNationId === subject.id,
    );
  const nationalSpherePortfolio = world.nations.find(
    (nation) => nation.id === selected,
  )?.strategy.influencePortfolio;
  const leadingRival = rivals[0];
  const rivalLeads = Boolean(
    leadingRival && leadingRival.profile.leverage >= profile.leverage + 8,
  );
  const displayedDefectionRisk =
    rivalLeads && profile.defectionRisk === 'LOW'
      ? 'MODERATE'
      : rivalLeads && profile.defectionRisk === 'MODERATE'
        ? 'HIGH'
        : profile.defectionRisk;
  const restrictions = profile.activeTerms;
  const allianceAuthority = restrictions.some(
    (term) => term.kind === 'no-rival-alliance',
  );
  const rivalDefensePacts = allianceAuthority
    ? world.treaties.filter(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'defense' &&
          treaty.parties.includes(subject.id) &&
          !treaty.parties.includes(selected),
      )
    : [];
  const treatyBreaches = agreements.flatMap((treaty) =>
    treaty.breaches
      .filter(
        (breach) =>
          breach.status !== 'resolved' &&
          [breach.violatingNationId, breach.injuredNationId].includes(
            selected,
          ) &&
          [breach.violatingNationId, breach.injuredNationId].includes(
            subject.id,
          ),
      )
      .map((breach) => {
        const termIndex = breach.obligationKey
          ? Number(/-term-(\d+)$/.exec(breach.obligationKey)?.[1])
          : Number.NaN;
        const term = Number.isFinite(termIndex)
          ? treaty.influenceTerms[termIndex]
          : treaty.influenceTerms.find(
              (candidate) =>
                [candidate.patronNationId, candidate.subjectNationId].includes(
                  breach.injuredNationId,
                ) &&
                [candidate.patronNationId, candidate.subjectNationId].includes(
                  breach.violatingNationId,
                ),
            );
        return {
          treaty,
          breach,
          patronNationId: term?.patronNationId ?? treaty.parties[0]!,
          subjectNationId: term?.subjectNationId ?? treaty.parties[1]!,
        };
      }),
  );
  const breachActions = (
    treaty: WorldState['treaties'][number],
    breach: WorldState['treaties'][number]['breaches'][number],
    patronNationId: NationId,
    subjectNationId: NationId,
  ): [EnforcementAction, string][] => {
    if (breach.injuredNationId !== selected) return [];
    const actions: [EnforcementAction, string][] = [];
    const recorded = treaty.enforcements.filter(
      (entry) => entry.breachId === breach.id,
    );
    const terms = treaty.influenceTerms.filter(
      (term) =>
        term.status === 'active' &&
        term.patronNationId === patronNationId &&
        term.subjectNationId === subjectNationId,
    );
    const owesSupport = breach.violatingNationId === patronNationId;
    const arrears = terms.some(
      (term) =>
        term.arrears > 0 &&
        (owesSupport
          ? ['subsidy', 'infrastructure-investment'].includes(term.kind)
          : ['tribute', 'debt-repayment'].includes(term.kind)),
    );
    if (!breach.milestones.some((entry) => entry.key === 'demanded'))
      actions.push(['diplomatic-demand', 'Issue a compliance demand']);
    if (arrears) actions.push(['demand-arrears', 'Collect overdue payments']);
    if (
      !treaty.enforcements.some(
        (entry) =>
          entry.breachId === breach.id && entry.action === 'renegotiate',
      ) &&
      !world.negotiations.some(
        (negotiation) =>
          negotiation.status === 'open' &&
          negotiation.sourceBreachId === breach.id,
      )
    )
      actions.push(['renegotiate', 'Negotiate an amendment']);
    if (
      !breach.milestones.some((entry) => entry.key === 'suspended') &&
      treaty.influenceTerms.some(
        (term) =>
          term.status === 'active' &&
          term.patronNationId === subjectNationId &&
          term.subjectNationId === patronNationId,
      )
    )
      actions.push(['suspend-reciprocals', 'Suspend reciprocal obligations']);
    if (
      breach.severity >= 60 &&
      !recorded.some((entry) => entry.action === 'political-pressure')
    )
      actions.push(['political-pressure', 'Apply political pressure']);
    if (
      breach.severity >= 75 &&
      !recorded.some((entry) => entry.action === 'sanction')
    )
      actions.push(['sanction', 'Impose targeted trade sanctions']);
    if (breach.severity <= 40) actions.push(['waive', 'Waive this breach']);
    if (breach.severity >= 85 && breach.durationMonths >= 12)
      actions.push(['terminate', 'Terminate the treaty']);
    return actions;
  };

  return (
    <article
      className="influence-card"
      data-influence-tier={profile.tier.toLowerCase().replaceAll(' ', '-')}
    >
      <header className="influence-card-heading">
        <div>
          <button
            className="influence-country"
            onClick={() => onSelect(subject.id)}
          >
            <span
              className="nation-swatch"
              style={{ background: subject.color }}
            />
            <strong>{subject.name}</strong>
          </button>
          <span className="influence-tier">{profile.tier}</span>
        </div>
        <div className="influence-leverage">
          <strong>{profile.leverage}</strong>
          <small>/100 leverage</small>
        </div>
        <span
          className={`influence-risk risk-${displayedDefectionRisk.toLowerCase()}`}
        >
          Defection risk: {displayedDefectionRisk}
        </span>
      </header>

      {leadingRival && leadingRival.profile.leverage > 0 && (
        <p className="influence-contest">
          {rivalLeads ? 'Rival patron leads:' : 'Other patron:'}{' '}
          <button onClick={() => onSelect(leadingRival.patron)}>
            {name(leadingRival.patron)}
          </button>{' '}
          · {leadingRival.profile.leverage} leverage
        </p>
      )}

      <div className="influence-autonomy">
        {(
          [
            [
              'Foreign policy',
              profile.autonomyLevels.foreignPolicy,
              profile.autonomy.foreignPolicy,
            ],
            [
              'Military',
              profile.autonomyLevels.military,
              profile.autonomy.military,
            ],
            [
              'Economic',
              profile.autonomyLevels.economic,
              profile.autonomy.economic,
            ],
            [
              'Domestic',
              profile.autonomyLevels.domestic,
              profile.autonomy.domestic,
            ],
          ] as const
        ).map(([label, level, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{level}</b>
            <meter
              min="0"
              max="100"
              value={value}
              aria-label={`${subject.name} ${label} autonomy`}
            />
          </div>
        ))}
      </div>

      <details className="influence-dependencies" open={profile.leverage > 20}>
        <summary>Why this relationship exists</summary>
        {profile.sources.length ? (
          <ul>
            {profile.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No material dependency source is recorded.</p>
        )}
        <div className="influence-dependency-grid">
          {dimensions
            .filter(([dimension]) => profile.dependency[dimension] > 0)
            .map(([dimension, label]) => (
              <div key={dimension}>
                <span>{label}</span>
                <strong>
                  {dependenceBand(profile.dependency[dimension])}
                  <small>
                    modeled index {profile.dependency[dimension]}/100
                  </small>
                </strong>
              </div>
            ))}
        </div>
      </details>

      {strategyPlan && (
        <section className="influence-section influence-strategy-plan">
          <h3>Sphere strategy</h3>
          {nationalSpherePortfolio && (
            <p>
              National portfolio priority:{' '}
              {nationalSpherePortfolio.priorityTargetNationId
                ? name(nationalSpherePortfolio.priorityTargetNationId)
                : 'unassigned'}
              {' · '}available treasury{' '}
              {nationalSpherePortfolio.availableTreasury}
              {' · '}annual commitments{' '}
              {nationalSpherePortfolio.committedAnnualCost}
              {nationalSpherePortfolio.priorityTargetNationId !== subject.id
                ? ' · this target plan remains separate and can be resumed'
                : ''}
            </p>
          )}
          <p>
            Target: {strategyPlan.desiredTier} · Current:{' '}
            {strategyPlan.currentTier}
            {' · '}Leverage {strategyPlan.leverage}/100 · Resistance{' '}
            {strategyPlan.resistance}/100 · Patron reliability{' '}
            {strategyPlan.patronReliability}/100
          </p>
          <p>
            Main dependence:{' '}
            {strategyPlan.strongestChannels.length
              ? strategyPlan.strongestChannels.join(' / ')
              : 'no strong channel'}
            {' · '}Weakest:{' '}
            {strategyPlan.weakestChannels.join(' / ') || 'unmeasured'}
          </p>
          <p>
            Next realistic step: {strategyPlan.nextStep.rationale}
            {strategyPlan.nextStep.proposedBenefits
              ? ` ${strategyPlan.nextStep.proposedBenefits}`
              : ''}
          </p>
          {!!strategyPlan.rivalInfluence.length && (
            <p>
              Rival alternatives:{' '}
              {strategyPlan.rivalInfluence
                .slice(0, 3)
                .map(
                  (rival) =>
                    `${name(rival.patronNationId)} (${rival.leverage} leverage, ${rival.reliability} reliability)`,
                )
                .join(' · ')}
            </p>
          )}
          {!!strategyPlan.blockers.length && (
            <p>
              Main blockers: {strategyPlan.blockers.slice(0, 3).join(' · ')}
            </p>
          )}
          {!!strategyPlan.rejectedObligations.length && (
            <p>
              Most recent rejection:{' '}
              {strategyPlan.rejectedObligations.at(-1)!.explanation}
            </p>
          )}
          {!!strategyPlan.recentCounteroffers.length && (
            <p>
              Most recent counteroffer:{' '}
              {strategyPlan.recentCounteroffers.at(-1)!.explanation}
            </p>
          )}
        </section>
      )}

      {profile.activeTerms.length > 0 && (
        <section className="influence-section puppet-requirements">
          <h3>
            Puppet authority ·{' '}
            {
              profile.puppetRequirements.filter(
                (requirement) => requirement.fulfilled,
              ).length
            }
            /{profile.puppetRequirements.length} controls
          </h3>
          <ul>
            {profile.puppetRequirements.map((requirement) => (
              <li
                key={requirement.key}
                data-fulfilled={requirement.fulfilled ? 'true' : 'false'}
              >
                <span aria-hidden="true">
                  {requirement.fulfilled ? '✓' : '○'}
                </span>{' '}
                {requirement.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="influence-section">
        <h3>Binding terms</h3>
        {restrictions.length ? (
          <ul className="influence-terms">
            {restrictions.map((term, index) => (
              <li key={`${term.kind}-${index}`}>
                <span>{termLabel(term.kind)}</span>
                <small>
                  {term.amount
                    ? `${term.amount}/month`
                    : term.ratePercent
                      ? `${term.ratePercent}% of monthly revenue`
                      : ''}
                </small>
                {term.paymentsMade > 0 && (
                  <small>
                    Paid {term.paidAmount} · {term.paymentsMade} payments
                    {term.arrears ? ` · ${term.arrears} missed` : ''}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No binding autonomy limits.</p>
        )}
        {!!rivalDefensePacts.length && (
          <div className="influence-directive-actions">
            {rivalDefensePacts.map((rivalTreaty) => {
              const otherParty = rivalTreaty.parties.find(
                (id) => id !== subject.id,
              )!;
              return (
                <button
                  key={rivalTreaty.id}
                  disabled={busy}
                  onClick={() =>
                    void commit(
                      {
                        type: 'ISSUE_PATRON_DIRECTIVE',
                        treatyId: agreements.find(
                          (treaty) => treaty.kind === 'influence',
                        )!.id,
                        patronNationId: selected,
                        subjectNationId: subject.id,
                        directiveId: `directive:${globalThis.crypto.randomUUID()}`,
                        kind: 'end-rival-treaty',
                        targetTreatyId: rivalTreaty.id,
                      },
                      `Enforce accepted no-rival-alliance clause for ${subject.name}`,
                    )
                  }
                >
                  Direct {subject.name} to end {name(otherParty)} defense pact
                </button>
              );
            })}
          </div>
        )}
      </section>

      {!!directives.length && (
        <section className="influence-section">
          <h3>Patron directives</h3>
          <ul className="influence-directives">
            {directives
              .slice(-5)
              .reverse()
              .map(({ directive }) => (
                <li key={directive.id}>
                  <span>
                    {termLabel(directive.kind)} · {directive.status}
                  </span>
                  <small>
                    {directive.issuedDate} ·{' '}
                    {directive.policyText ? `${directive.policyText} · ` : ''}
                    {directive.reason}
                  </small>
                </li>
              ))}
          </ul>
        </section>
      )}

      {!!treatyBreaches.length && (
        <section className="influence-section influence-enforcement">
          <h3>Treaty breach episodes</h3>
          {treatyBreaches.map(
            ({ treaty, breach, patronNationId, subjectNationId }) => (
              <div className="influence-breach" key={breach.id}>
                <p>
                  <b>{breach.status}</b> ·{' '}
                  {breach.firstMissedDate ?? breach.date}
                  {' · '}last missed {breach.lastMissedDate ?? breach.date}
                  {' · '}
                  {breach.missedInstallments} missed installments
                  {' · '}
                  {breach.arrearsAmount} arrears
                  {' · '}
                  {breach.durationMonths} months
                  {' · severity '}
                  {breach.severity}/100 · {breach.reason}
                </p>
                {breach.injuredNationId === selected ? (
                  <div className="influence-directive-actions">
                    {breachActions(
                      treaty,
                      breach,
                      patronNationId,
                      subjectNationId,
                    ).map(([action, label]) => (
                      <button
                        key={action}
                        disabled={busy}
                        onClick={() =>
                          void commit(
                            {
                              type: 'ENFORCE_TREATY_BREACH',
                              treatyId: treaty.id,
                              breachId: breach.id,
                              patronNationId,
                              subjectNationId,
                              actingNationId: selected,
                              enforcementId: `enforcement:${globalThis.crypto.randomUUID()}`,
                              action,
                            },
                            `${label} against ${subject.name} for treaty breach`,
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <small>
                    {name(breach.violatingNationId)} has an outstanding
                    obligation to {name(breach.injuredNationId)}.
                  </small>
                )}
              </div>
            ),
          )}
          {!!agreements.flatMap((treaty) => treaty.enforcements).length && (
            <ul className="influence-directives">
              {agreements
                .flatMap((treaty) => treaty.enforcements)
                .slice(-5)
                .reverse()
                .map((enforcement) => (
                  <li key={enforcement.id}>
                    <span>
                      {enforcement.date} · {termLabel(enforcement.action)}
                    </span>
                    <small>{enforcement.result}</small>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {!!negotiations.length && (
        <section className="influence-section">
          <h3>Requests and negotiation history</h3>
          <ul className="influence-directives">
            {negotiations.map((negotiation) => {
              const latest = negotiation.responses.at(-1);
              const proposer = name(negotiation.proposerNationId);
              return (
                <li key={negotiation.id}>
                  <span>
                    {negotiation.status} · proposed by {proposer}
                  </span>
                  <small>
                    {negotiation.createdDate} · {negotiation.terms}
                  </small>
                  {latest && (
                    <small>
                      {name(latest.nationId)} {latest.move}: {latest.message}
                    </small>
                  )}
                  {latest?.influenceDecision && (
                    <>
                      {latest.influenceDecision.assessment && (
                        <small>
                          Decision perspective:{' '}
                          {latest.influenceDecision.decisionPerspective ??
                            'unrecorded'}{' '}
                          · hybrid{' '}
                          {latest.influenceDecision.rawDisposition ??
                            'unrecorded'}{' '}
                          →{' '}
                          {latest.influenceDecision.disposition ?? latest.move}{' '}
                          ·{' '}
                          {
                            latest.influenceDecision.assessment
                              .recommendationZone
                          }{' '}
                          (
                          {latest.influenceDecision.assessment.score >= 0
                            ? '+'
                            : ''}
                          {latest.influenceDecision.assessment.score}). Benefits{' '}
                          {latest.influenceDecision.assessment.benefits.total}
                          /100; sovereignty cost{' '}
                          {
                            latest.influenceDecision.assessment.costs
                              .sovereignty
                          }
                          ; leverage{' '}
                          {
                            latest.influenceDecision.assessment.relationship
                              .leverage
                          }
                          ; resistance{' '}
                          {
                            latest.influenceDecision.assessment.relationship
                              .resistance
                          }
                          ; reliability{' '}
                          {
                            latest.influenceDecision.assessment.relationship
                              .reliability
                          }
                          /100.
                        </small>
                      )}
                      <small>
                        Strategic assessment (
                        {latest.influenceDecision.reasonCode}):{' '}
                        {latest.influenceDecision.explanation}
                      </small>
                      {latest.influenceDecision.counterOfferAvailable && (
                        <small>
                          A structured counter was available
                          {latest.influenceDecision.counterOfferId
                            ? ` · selected ${latest.influenceDecision.counterOfferId}`
                            : ` · options: ${latest.influenceDecision.counterOfferIds?.join(', ') ?? 'recorded'}`}
                          .
                        </small>
                      )}
                      {latest.influenceDecision.counterOfferCandidates?.map(
                        (candidate) => (
                          <small key={candidate.id}>
                            Available {candidate.label.toLowerCase()}:{' '}
                            {candidate.termsText}
                          </small>
                        ),
                      )}
                      {!!latest.influenceDecision.reconsiderationConditions
                        ?.length && (
                        <small>
                          Reconsider when:{' '}
                          {latest.influenceDecision.reconsiderationConditions.join(
                            ' · ',
                          )}
                        </small>
                      )}
                      {!!latest.influenceDecision.repairNotes?.length && (
                        <small>
                          Model reasoning checked:{' '}
                          {latest.influenceDecision.repairNotes.join(' · ')}
                        </small>
                      )}
                      {!!latest.influenceDecision.comparison.length && (
                        <small>
                          Compared offers:{' '}
                          {latest.influenceDecision.comparison
                            .map((offer) => {
                              const patron = name(offer.patronNationId);
                              return `${offer.selected ? 'selected ' : ''}${patron}: net ${offer.netScore}, economic ${offer.economicValue}, security ${offer.securityValue}, sovereignty cost ${offer.sovereigntyCost}, reliability ${offer.reliability}`;
                            })
                            .join(' · ')}
                        </small>
                      )}
                      {!!latest.influenceDecision.possibleLeverage.length && (
                        <small>
                          Political factors to weigh:{' '}
                          {latest.influenceDecision.possibleLeverage.join(
                            ' · ',
                          )}
                        </small>
                      )}
                    </>
                  )}
                  {negotiation.conditionalPressure && (
                    <small>
                      Conditional pressure:{' '}
                      {pressureLabel(negotiation.conditionalPressure)} ·{' '}
                      {negotiation.conditionalPressure.status}
                      {negotiation.conditionalPressure.triggeredDate
                        ? ` ${negotiation.conditionalPressure.triggeredDate}`
                        : ''}
                    </small>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="influence-resistance">
        Political resistance: {profile.resistance}/100 · Government instability{' '}
        {subject.stats.unrest}/100 unrest
      </p>
    </article>
  );
}

export function InfluenceView({
  world,
  selected,
  onSelect,
  commit,
  busy,
}: {
  world: WorldState;
  selected: NationId;
  onSelect: (id: NationId) => void;
  commit: Commit;
  busy: boolean;
}) {
  const profiles = useMemo(
    () =>
      world.nations
        .filter((nation) => nation.id !== selected)
        .map((nation) => influenceProfile(world, selected, nation.id))
        .sort(
          (a, b) =>
            [
              'PUPPET STATE',
              'SUBJECT STATE',
              'PROTECTORATE',
              'CLIENT STATE',
              'DEPENDENT PARTNER',
              'PARTNER',
              'INDEPENDENT',
            ].indexOf(a.tier) -
              [
                'PUPPET STATE',
                'SUBJECT STATE',
                'PROTECTORATE',
                'CLIENT STATE',
                'DEPENDENT PARTNER',
                'PARTNER',
                'INDEPENDENT',
              ].indexOf(b.tier) || b.leverage - a.leverage,
        ),
    [world, selected],
  );
  const subjectCount = profiles.filter((profile) =>
    ['CLIENT STATE', 'PROTECTORATE', 'SUBJECT STATE', 'PUPPET STATE'].includes(
      profile.tier,
    ),
  ).length;
  const materialCount = profiles.filter(
    (profile) => profile.leverage >= 25,
  ).length;
  const patron = world.nations.find((nation) => nation.id === selected)!;
  const name = (id: NationId) =>
    world.nations.find((nation) => nation.id === id)?.name ?? id;
  const network = profiles.map((profile) => {
    const rivals = competingPatrons(world, profile.subjectNationId, selected);
    const leader = rivals[0];
    const contested = Boolean(
      leader &&
      profile.leverage >= 20 &&
      leader.profile.leverage >= 20 &&
      Math.abs(leader.profile.leverage - profile.leverage) < 12,
    );
    const rivalLeads = Boolean(
      leader && leader.profile.leverage >= profile.leverage + 12,
    );
    const risk =
      rivalLeads && profile.defectionRisk === 'LOW'
        ? 'MODERATE'
        : rivalLeads && profile.defectionRisk === 'MODERATE'
          ? 'HIGH'
          : profile.defectionRisk;
    const terms = profile.activeTerms;
    const paymentTerms = terms.filter((term) =>
      ['tribute', 'debt-repayment'].includes(term.kind),
    );
    return {
      profile,
      subject: world.nations.find(
        (nation) => nation.id === profile.subjectNationId,
      )!,
      leader,
      contested,
      rivalLeads,
      risk,
      status: contested
        ? 'CONTESTED'
        : rivalLeads
          ? 'RIVAL LEADS'
          : profile.leverage > 0
            ? profile.tier
            : 'OUTSIDE SPHERE',
      dependence: Math.max(...Object.values(profile.dependency)),
      terms,
      paymentSummary: paymentTerms.length
        ? `${paymentTerms.reduce((sum, term) => sum + term.paidAmount, 0)} paid · ${paymentTerms.reduce((sum, term) => sum + term.arrears, 0)} arrears`
        : '—',
      obligations: terms.length
        ? `${terms
            .slice(0, 3)
            .map((term) => termLabel(term.kind))
            .join(', ')}${terms.length > 3 ? ` +${terms.length - 3}` : ''}`
        : '—',
    };
  });

  return (
    <section className="influence-view" aria-label="Sphere of influence">
      <header className="influence-view-heading">
        <div>
          <span className="eyebrow">
            DEPENDENCE · AUTONOMY · LEGAL AUTHORITY
          </span>
          <h2>{patron.name} sphere</h2>
        </div>
        <div className="influence-summary">
          <span>
            <b>{materialCount}</b> relationships with material leverage
          </span>
          <span>
            <b>{subjectCount}</b> clients, protectorates, or subjects
          </span>
        </div>
      </header>
      <p className="muted influence-explainer">
        Each relationship is derived from recorded trade, payments, investment,
        organizations, security and accepted treaty terms. Status changes as
        those sources change; borders and governments remain distinct.
      </p>
      <div className="sphere-network-scroll">
        <table
          className="sphere-network"
          aria-label={`${patron.name} sphere network`}
        >
          <thead>
            <tr>
              <th>Country</th>
              <th>Status</th>
              <th>Leverage</th>
              <th>Dependence</th>
              <th>Autonomy</th>
              <th>Resistance</th>
              <th>Payments / arrears</th>
              <th>Obligations</th>
              <th>Rival patron</th>
              <th>Defection risk</th>
            </tr>
          </thead>
          <tbody>
            {network.map((entry) => (
              <tr
                key={entry.subject.id}
                data-contested={entry.contested ? 'true' : 'false'}
                data-defection-risk={entry.risk.toLowerCase()}
              >
                <th scope="row">
                  <button onClick={() => onSelect(entry.subject.id)}>
                    <span
                      className="nation-swatch"
                      style={{ background: entry.subject.color }}
                    />
                    {entry.subject.name}
                  </button>
                </th>
                <td>{entry.status}</td>
                <td>{entry.profile.leverage}/100</td>
                <td>{dependenceBand(entry.dependence)}</td>
                <td>
                  <span
                    title={`Foreign policy ${entry.profile.autonomyLevels.foreignPolicy}; military ${entry.profile.autonomyLevels.military}; economic ${entry.profile.autonomyLevels.economic}; domestic ${entry.profile.autonomyLevels.domestic}`}
                  >
                    FP {entry.profile.autonomyLevels.foreignPolicy} · MIL{' '}
                    {entry.profile.autonomyLevels.military} · ECO{' '}
                    {entry.profile.autonomyLevels.economic} · DOM{' '}
                    {entry.profile.autonomyLevels.domestic}
                  </span>
                </td>
                <td>{entry.profile.resistance}/100</td>
                <td>{entry.paymentSummary}</td>
                <td>{entry.obligations}</td>
                <td>
                  {entry.leader && entry.leader.profile.leverage > 0 ? (
                    <button onClick={() => onSelect(entry.leader!.patron)}>
                      {name(entry.leader.patron)} ·{' '}
                      {entry.leader.profile.leverage}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{entry.risk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.subjectNationId}
          world={world}
          profile={profile}
          selected={selected}
          onSelect={onSelect}
          commit={commit}
          busy={busy}
        />
      ))}
    </section>
  );
}
