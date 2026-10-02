import { informationEntity, informationParticipants } from './knowledge.js';
import type { WorldState } from '@mandate/schemas';
import { crisisSeverity, demandFulfilled } from './continuity.js';

export function continuityProblems(w: WorldState): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  const nations = (ids: string[]) =>
    ids.every((id) => w.nations.some((n) => n.id === id));
  const chronology = (start: string, dates: string[]) =>
    start >= w.scenario.startDate &&
    start <= w.date &&
    dates.every(
      (d, i) => d >= start && d <= w.date && (i === 0 || d >= dates[i - 1]!),
    );
  check(unique(w.knowledge.map((k) => k.id)), 'Duplicate knowledge record');
  for (const k of w.knowledge)
    check(
      nations([k.issuer, k.recipient]) &&
        k.issuer !== k.recipient &&
        k.subject.id.startsWith(k.subject.kind + ':') &&
        !!informationEntity(w, k.subject) &&
        chronology(k.date, []),
      'Invalid information disclosure',
    );
  // Disclosures need a rooted, dated chain. Mutual fabricated records cannot create knowledge.
  const pending = [...w.knowledge];
  const available = new Map<string, string>();
  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const k = pending[index]!,
        e = informationEntity(w, k.subject);
      if (!e) continue;
      const key = k.issuer + '~' + k.subject.id,
        supplied = available.get(key);
      if (
        e.visibility !== 'private' ||
        informationParticipants(e).includes(k.issuer) ||
        (supplied && supplied <= k.date)
      ) {
        if (k.confidence === 'confirmed') {
          const recipientKey = k.recipient + '~' + k.subject.id;
          const prior = available.get(recipientKey);
          available.set(recipientKey, prior && prior < k.date ? prior : k.date);
        }
        pending.splice(index, 1);
        progressed = true;
      }
    }
  }
  check(!pending.length, 'Knowledge disclosure lacks authorized rooted source');
  const neighborhoods = w.scenario.neighborhoods ?? [];
  check(
    unique(w.scenario.strategicActors ?? []) &&
      nations(w.scenario.strategicActors ?? []),
    'Invalid scenario strategic actors',
  );
  check(
    unique(neighborhoods.map((n) => n.nationId)),
    'Duplicate strategic neighborhood',
  );
  for (const n of neighborhoods)
    check(
      nations([n.nationId, ...n.neighbors]) &&
        unique(n.neighbors) &&
        !n.neighbors.includes(n.nationId),
      'Invalid strategic neighborhood',
    );
  if (w.scenario.rules) {
    check(
      unique(w.scenario.rules.enabledMechanics),
      'Duplicate enabled mechanic',
    );
    for (const [mechanic, entities] of [
      ['crises', w.crises],
      ['economic-networks', [...w.economicLinks, ...w.sanctions]],
      ['elections', w.tenures],
      ['theaters', w.conflicts.flatMap((c) => c.theaters)],
    ] as const)
      check(
        w.scenario.rules.enabledMechanics.includes(mechanic) ||
          entities.length === 0,
        `Disabled mechanic ${mechanic} has canonical entities`,
      );
  }
  for (const collection of [
    w.crises,
    w.economicLinks,
    w.sanctions,
    w.conferences,
    w.tenures,
  ])
    check(
      unique(collection.map((c) => c.id)),
      'Duplicate continuity entity ID',
    );
  check(
    unique(
      w.economicLinks.map((l) => `${l.dependentNationId}~${l.partnerNationId}`),
    ),
    'Duplicate directional dependency',
  );
  for (const l of w.economicLinks)
    check(
      nations([l.dependentNationId, l.partnerNationId]) &&
        l.dependentNationId !== l.partnerNationId,
      'Invalid directional dependency',
    );
  check(
    unique(
      w.sanctions
        .filter((s) => s.status === 'active')
        .map((s) => `${s.issuer}~${s.target}~${s.sector}`),
    ),
    'Duplicate active sanction',
  );
  for (const s of w.sanctions) {
    check(
      nations([s.issuer, s.target]) && s.issuer !== s.target,
      'Invalid sanction parties',
    );
    check(
      chronology(s.startDate, []) && (!s.endDate || s.endDate >= s.startDate),
      'Invalid sanction chronology',
    );
    check(
      s.status !== 'active' || !s.endDate || s.endDate > w.date,
      'Active sanction expired',
    );
  }
  for (const f of w.conflicts) {
    check(unique(f.theaters.map((t) => t.id)), 'Duplicate theater identity');
    for (const t of f.theaters)
      check(
        [...f.attackers, ...f.defenders].includes(t.nationId) &&
          unique(t.regionIds) &&
          t.regionIds.every((id) =>
            w.regions.some(
              (r) =>
                r.id === id &&
                [...f.attackers, ...f.defenders].includes(r.ownerNationId),
            ),
          ),
        'Invalid theater geography/actor',
      );
    for (const id of [...f.attackers, ...f.defenders])
      check(
        f.theaters
          .filter((t) => t.nationId === id)
          .reduce((s, t) => s + t.allocation, 0) <= 100,
        'Theater allocation exceeds military capacity',
      );
  }
  for (const c of w.crises) {
    for (const demand of c.demands) {
      const condition = demand.condition;
      if (condition.kind === 'conflict-ended' || condition.kind === 'ceasefire')
        check(
          w.conflicts.some(
            (f) =>
              f.id === condition.conflictId &&
              [...f.attackers, ...f.defenders].every((id) =>
                c.participants.includes(id),
              ),
          ),
          'Crisis condition requires related conflict',
        );
      if (condition.kind === 'control')
        check(
          w.regions.some((r) => r.id === condition.regionId) &&
            c.participants.includes(condition.nationId),
          'Crisis condition requires known territory and participant',
        );
      if (condition.kind === 'agreement')
        check(
          w.negotiations.some(
            (n) =>
              n.id === condition.negotiationId &&
              [n.proposerNationId, n.recipientNationId].every((id) =>
                c.participants.includes(id),
              ),
          ),
          'Crisis condition requires related agreement',
        );
      if (condition.kind !== 'acknowledgment' && demand.satisfied)
        check(
          demandFulfilled(w, demand),
          'Crisis claims unfulfilled canonical demand',
        );
    }
    check(
      nations([...c.participants, ...c.interestedActors]) &&
        unique(c.participants) &&
        unique(c.interestedActors),
      'Invalid crisis actors',
    );
    check(
      c.regions.every((id) => w.regions.some((r) => r.id === id)) &&
        unique(c.regions),
      'Invalid crisis regions',
    );
    check(
      !c.conflictId ||
        w.conflicts.some(
          (f) =>
            f.id === c.conflictId &&
            [...f.attackers, ...f.defenders].every((id) =>
              c.participants.includes(id),
            ),
        ),
      'Invalid crisis conflict',
    );
    check(
      c.negotiationIds.every((id) =>
        w.negotiations.some(
          (n) =>
            n.id === id &&
            [n.proposerNationId, n.recipientNationId].every((id) =>
              c.participants.includes(id),
            ),
        ),
      ) && unique(c.negotiationIds),
      'Invalid crisis negotiation',
    );
    check(
      [...c.demands, ...c.redLines].every((d) =>
        c.participants.includes(d.nationId),
      ),
      'Invalid crisis demand/red line actor',
    );
    check(
      chronology(
        c.startDate,
        c.history.map((h) => h.date),
      ) &&
        c.history.every(
          (h) => !h.nationId || c.participants.includes(h.nationId),
        ),
      'Invalid crisis history',
    );
    check(
      c.severity === crisisSeverity(c),
      'Crisis severity must match dimensions',
    );
    check(
      c.status !== 'resolved' ||
        (c.demands.length > 0 &&
          c.demands.every((d) => d.satisfied) &&
          c.militaryPosture <= 10 &&
          c.diplomaticBreakdown <= 10),
      'Crisis resolution lacks fulfilled conditions',
    );
  }
  for (const c of w.conferences) {
    let round = 0;
    let closure: string | null = null;
    let counterTerms: string | undefined;
    const accepted = new Set<string>();
    for (const response of c.responses) {
      check(!closure, 'Conference history continues after closure');
      check(
        !accepted.has(response.nationId) || response.move === 'withdraw',
        'Conference accepted actor changed consent without withdrawal',
      );
      if (response.move === 'counter') {
        round++;
        accepted.clear();
        counterTerms = response.terms;
        check(!!counterTerms, 'Conference counter lacks revised terms');
      } else
        check(
          response.terms === undefined,
          'Only counter has revised conference terms',
        );
      check(
        response.round === round,
        'Conference history skips or reuses a round',
      );
      if (response.move === 'accept') accepted.add(response.nationId);
      if (response.move === 'reject') closure = 'rejected';
      if (response.move === 'withdraw') closure = 'withdrawn';
      if (c.parties.every((id) => accepted.has(id))) closure = 'agreed';
    }
    check(
      c.round === round && (!counterTerms || c.terms === counterTerms),
      'Conference current terms/round mismatch history',
    );
    check(
      closure ? c.status === closure : ['open', 'expired'].includes(c.status),
      'Conference status does not match consent history',
    );
    check(
      nations(c.parties) && unique(c.parties) && c.parties.includes(c.proposer),
      'Invalid conference parties',
    );
    check(
      chronology(
        c.createdDate,
        c.responses.map((r) => r.date),
      ) && c.expiresDate > c.createdDate,
      'Invalid conference chronology',
    );
    check(
      c.responses.every(
        (r) =>
          c.parties.includes(r.nationId) &&
          r.date < c.expiresDate &&
          r.round <= c.round,
      ),
      'Invalid conference response',
    );
    check(
      c.status !== 'open' || c.expiresDate > w.date,
      'Open conference expired',
    );
    check(
      c.status !== 'expired' || c.expiresDate <= w.date,
      'Premature conference expiry',
    );
    check(
      c.status !== 'agreed' ||
        c.parties.every((id) =>
          c.responses.some(
            (r) =>
              r.nationId === id && r.round === c.round && r.move === 'accept',
          ),
        ),
      'Conference needs unanimous current-round consent',
    );
    check(
      (c.kind === 'peace') === !!c.conflictId &&
        (!c.conflictId ||
          w.conflicts.some(
            (f) =>
              f.id === c.conflictId &&
              [...f.attackers, ...f.defenders].every((id) =>
                c.parties.includes(id),
              ),
          )),
      'Conference settlement needs belligerents',
    );
    check(
      c.status !== 'agreed' ||
        c.kind !== 'peace' ||
        w.conflicts.find((f) => f.id === c.conflictId)?.status === 'ended',
      'Agreed peace must end war',
    );
    check(
      (c.kind === 'sanctions') === !!c.sanctionTarget &&
        (!c.sanctionTarget ||
          (nations([c.sanctionTarget]) &&
            !c.parties.includes(c.sanctionTarget))),
      'Invalid sanctions coalition target',
    );
    check(
      unique(c.peaceTerms.map((t) => t.regionId)) &&
        (!c.peaceTerms.length || c.kind === 'peace'),
      'Invalid conference peace terms',
    );
    for (const t of c.peaceTerms)
      check(
        w.regions.some((r) => r.id === t.regionId) &&
          t.fromNationId !== t.toNationId &&
          c.parties.includes(t.fromNationId) &&
          c.parties.includes(t.toNationId),
        'Invalid settlement concession',
      );
  }
  check(
    unique(w.tenures.map((t) => t.nationId)),
    'Duplicate scheduled government',
  );
  for (const t of w.tenures) {
    check(
      nations([t.nationId]) &&
        chronology(t.startDate, []) &&
        t.nextElectionDate > w.date,
      'Invalid election schedule',
    );
    check(
      t.outcomes.every(
        (o, i) =>
          o.date <= w.date &&
          o.date >= w.scenario.startDate &&
          (!i || o.date >= t.outcomes[i - 1]!.date),
      ),
      'Invalid election history',
    );
    check(
      w.nations.find((n) => n.id === t.nationId)?.leader === t.incumbent,
      'Election incumbent must match leader',
    );
  }
  for (const g of w.goals) {
    const e = g.evaluation;
    if (e.kind === 'metrics')
      check(g.signals.length > 0, 'Metric goal requires signals');
    if (e.kind === 'relationship')
      check(
        nations([e.nationId]) &&
          e.nationId !== g.nationId &&
          e.baseline !== e.target,
        'Invalid relationship goal criterion',
      );
    if (e.kind === 'territory')
      check(
        w.regions.some((r) => r.id === e.regionId),
        'Unknown territorial goal region',
      );
    if (e.kind === 'organization')
      check(
        w.organizations.some((o) => o.id === e.organizationId),
        'Unknown goal organization',
      );
    if (e.kind === 'project')
      check(
        w.initiatives.some(
          (i) => i.id === e.initiativeId && i.nationId === g.nationId,
        ),
        'Unknown/foreign goal project',
      );
    if (e.kind === 'dependence')
      check(
        e.target < e.baseline &&
          w.economicLinks.some(
            (l) =>
              l.dependentNationId === g.nationId &&
              l.partnerNationId === e.partnerNationId,
          ),
        'Invalid dependence goal',
      );
    if (g.deferredToGoalId)
      check(
        w.goals.some(
          (other) =>
            other.id === g.deferredToGoalId &&
            other.nationId === g.nationId &&
            other.id !== g.id,
        ),
        'Invalid deferred goal',
      );
  }
  return errors;
}
