import type { NationId, WorldCommand, WorldState } from '@mandate/schemas';

type Commit = (
  command: WorldCommand | WorldCommand[],
  reason: string,
) => Promise<boolean>;

export function Organizations({
  world,
  selected,
  busy,
  commit,
  onSelect,
}: {
  world: WorldState;
  selected: NationId;
  busy: boolean;
  commit: Commit;
  onSelect: (id: NationId) => void;
}) {
  const name = (id: NationId) =>
    world.nations.find((nation) => nation.id === id)?.name ?? id;
  const organizations = world.organizations.filter(
    (organization) =>
      organization.visibility === 'public' ||
      organization.members.includes(world.playerNationId) ||
      organization.invitedStates.includes(world.playerNationId),
  );

  return (
    <section
      className="organization-view"
      aria-label="International organizations"
    >
      <div className="organization-view-heading">
        <div>
          <span className="eyebrow">MULTILATERAL DIPLOMACY</span>
          <h2>Organizations</h2>
        </div>
        <span className="muted">{organizations.length} in the world</span>
      </div>
      {!organizations.length ? (
        <p className="empty-note">
          No international organizations have been founded in this world yet.
        </p>
      ) : (
        organizations.map((organization) => {
          const pending = organization.invitations.filter(
            (invitation) => invitation.status === 'pending',
          );
          const applications = organization.pendingApplications.filter(
            (application) => application.status === 'pending',
          );
          const playerInvitation = organization.invitations.find(
            (invitation) =>
              invitation.nationId === world.playerNationId &&
              invitation.status === 'pending' &&
              invitation.lastMove !== 'counter',
          );
          return (
            <article className="organization-card" key={organization.id}>
              <header>
                <div>
                  <span className="eyebrow">
                    {organization.kind.replaceAll('-', ' ').toUpperCase()}
                    {organization.geographicScope
                      ? ` · ${organization.geographicScope.toUpperCase()}`
                      : ''}
                  </span>
                  <h3>
                    {organization.acronym
                      ? `${organization.acronym} · ${organization.name}`
                      : organization.name}
                  </h3>
                </div>
                <span className={`organization-status ${organization.status}`}>
                  {organization.status}
                </span>
              </header>

              <p className="organization-purpose">{organization.purpose}</p>
              <small className="muted">
                Founded {organization.foundingDate ?? 'date unavailable'} by{' '}
                {organization.founders.map(name).join(', ') || 'unknown'}
              </small>

              <div className="organization-section">
                <strong>Members · {organization.members.length}</strong>
                <div className="organization-nations">
                  {organization.members.map((id) => (
                    <button
                      key={id}
                      className={id === selected ? 'selected' : ''}
                      onClick={() => onSelect(id)}
                    >
                      {name(id)}
                    </button>
                  ))}
                  {!organization.members.length && (
                    <span className="muted">None</span>
                  )}
                </div>
              </div>

              {!!organization.development.length && (
                <div className="organization-section">
                  <strong>Institutional development</strong>
                  <ul className="organization-development">
                    {[...organization.development]
                      .sort((a, b) => a.dimension.localeCompare(b.dimension))
                      .map((development) => (
                        <li key={development.dimension}>
                          <span>
                            {development.dimension
                              .replaceAll('-', ' ')
                              .replace(/^./, (letter) => letter.toUpperCase())}
                          </span>
                          <strong>Stage {development.level}/5</strong>
                          <small>
                            {development.progress}% toward next stage
                          </small>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {!!organization.programs.length && (
                <div className="organization-section organization-programs">
                  <strong>Programs and proposals</strong>
                  {[...organization.programs]
                    .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
                    .map((program) => (
                      <article
                        className="organization-program"
                        key={program.id}
                      >
                        <header>
                          <b>{program.title}</b>
                          <span
                            className={`organization-status ${program.status}`}
                          >
                            {program.status}
                          </span>
                        </header>
                        <small>
                          {program.stage} · {program.progress}% ·{' '}
                          {program.dimension.replaceAll('-', ' ')}
                        </small>
                        <progress
                          max={100}
                          value={program.progress}
                          aria-label={`${program.title} progress`}
                        />
                        <p>{program.terms}</p>
                        <small>
                          Sponsor: {name(program.issuerNationId)} · Monthly
                          cost: {program.monthlyCost} treasury units · Invested:{' '}
                          {program.totalInvested}
                          {program.completedDate
                            ? ` · Operational since ${program.completedDate}`
                            : ''}
                        </small>
                        {!!program.responses.length && (
                          <details>
                            <summary>
                              Member decisions ·{' '}
                              {
                                program.responses.filter(
                                  (response) => response.move === 'accept',
                                ).length
                              }{' '}
                              accepted ·{' '}
                              {
                                program.responses.filter(
                                  (response) => response.move !== 'accept',
                                ).length
                              }{' '}
                              other
                            </summary>
                            <ul className="organization-program-responses">
                              {program.responses.map((response) => (
                                <li key={response.nationId}>
                                  <b>{name(response.nationId)}</b> ·{' '}
                                  {response.move}
                                  {response.counterTerms
                                    ? ` · ${response.counterTerms}`
                                    : ''}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </article>
                    ))}
                </div>
              )}

              <div className="organization-section">
                <strong>Pending invitations · {pending.length}</strong>
                <div className="organization-nations">
                  {pending.map((invitation) => (
                    <button
                      key={invitation.nationId}
                      className={
                        invitation.nationId === selected ? 'selected' : ''
                      }
                      onClick={() => onSelect(invitation.nationId)}
                    >
                      {name(invitation.nationId)}
                    </button>
                  ))}
                  {!pending.length && <span className="muted">None</span>}
                </div>
              </div>

              {!!applications.length && (
                <div className="organization-section">
                  <strong>Pending applications</strong>
                  {applications.map((application) => (
                    <button
                      className="organization-link"
                      key={application.nationId}
                      onClick={() => onSelect(application.nationId)}
                    >
                      {name(application.nationId)} · {application.terms}
                    </button>
                  ))}
                </div>
              )}

              {!!organization.commitments.length && (
                <div className="organization-section">
                  <strong>Terms and commitments</strong>
                  {organization.commitments.map((commitment) => (
                    <div className="organization-term" key={commitment.id}>
                      <span
                        className={`organization-status ${commitment.status}`}
                      >
                        {commitment.status}
                      </span>{' '}
                      {commitment.terms.trim()
                        ? `${name(commitment.issuer)}: ${commitment.terms.trim()}`
                        : `Commitment by ${name(commitment.issuer)}`}
                      {commitment.costPerMember > 0 && (
                        <div className="organization-payment-ledger">
                          <small>
                            {commitment.costPerMember} treasury units per
                            eligible member every {commitment.frequencyDays}{' '}
                            days
                          </small>
                          <small>
                            Paid this month:{' '}
                            {commitment.lastPaymentDate?.slice(0, 7) ===
                            world.date.slice(0, 7)
                              ? commitment.lastPaymentAmount
                              : 0}{' '}
                            treasury units · Total paid: {commitment.totalPaid}{' '}
                            across {commitment.paymentsMade} payments
                          </small>
                          <small>
                            Next payment:{' '}
                            {commitment.status === 'active'
                              ? (commitment.nextPaymentDate ??
                                'when recipients become eligible')
                              : 'suspended'}
                          </small>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {playerInvitation && (
                <div className="organization-response">
                  <strong>
                    {name(world.playerNationId)} has a pending invitation
                  </strong>
                  <div>
                    {(['accept', 'reject', 'delay'] as const).map((move) => (
                      <button
                        key={move}
                        disabled={busy}
                        onClick={() =>
                          void commit(
                            {
                              type: 'RESPOND_ORGANIZATION_INVITATION',
                              organizationId: organization.id,
                              nationId: world.playerNationId,
                              move,
                              message:
                                move === 'accept'
                                  ? 'The government accepts the invitation.'
                                  : move === 'reject'
                                    ? 'The government declines membership.'
                                    : 'The government will decide later.',
                            },
                            `Player government ${move}s the ${organization.name} invitation`,
                          )
                        }
                      >
                        {move}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!!organization.history.length && (
                <details className="organization-history">
                  <summary>Recent activity</summary>
                  {[...organization.history]
                    .reverse()
                    .slice(0, 5)
                    .map((entry) => (
                      <p key={entry.id}>
                        <small>{entry.date}</small> · {entry.description}
                      </p>
                    ))}
                </details>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
