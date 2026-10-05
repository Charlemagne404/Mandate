import { continuityProblems } from './continuity-invariants.js';
import { WorldState } from '@mandate/schemas';
import type { WorldState as World } from '@mandate/schemas';
import { WorldError } from './errors.js';
import { commandReferences } from './references.js';

export const pairKey = (a: string, b: string) => [a, b].sort().join('~');
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;
const signature = (xs: readonly string[]) => [...xs].sort().join('~');

export function assertWorld(input: unknown): asserts input is World {
  const parsed = WorldState.safeParse(input);
  if (!parsed.success) throw new WorldError('INVARIANT', parsed.error.message);
  const w = parsed.data;
  const problems: string[] = continuityProblems(w);
  const check = (valid: boolean, message: string) => {
    if (!valid) problems.push(message);
  };
  const collections = {
    nations: w.nations,
    regions: w.regions,
    treaties: w.treaties,
    conflicts: w.conflicts,
    goals: w.goals,
    commitments: w.commitments,
    initiatives: w.initiatives,
    negotiations: w.negotiations,
    organizations: w.organizations,
    events: w.events,
    turns: w.turns,
    actions: w.actions,
    commands: w.commands,
  };
  for (const [name, values] of Object.entries(collections))
    check(unique(values.map((v) => v.id)), `Duplicate ${name} IDs`);
  const nations = new Set(w.nations.map((v) => v.id as string));
  const regions = new Set(w.regions.map((v) => v.id as string));
  const treaties = new Set(w.treaties.map((v) => v.id as string));
  const conflicts = new Set(w.conflicts.map((v) => v.id as string));
  const goals = new Set(w.goals.map((v) => v.id as string));
  const events = new Map(w.events.map((v) => [v.id, v]));
  const turns = new Map(w.turns.map((v) => [v.id, v]));
  const actions = new Map(w.actions.map((v) => [v.id, v]));
  const commands = new Map(w.commands.map((v) => [v.id, v]));
  const negotiationIds = new Set(w.negotiations.map((v) => v.id as string));
  const organizationIds = new Set(w.organizations.map((v) => v.id as string));
  const sourcedCommands = new Set(w.events.flatMap((e) => e.sourceCommandIds));
  const refs = (ids: readonly string[], set: Set<string>, label: string) =>
    ids.forEach((id) => check(set.has(id), `Unknown ${label}: ${id}`));
  refs([w.playerNationId], nations, 'player nation');
  check(w.date >= w.scenario.startDate, 'World precedes scenario start');
  check(w.ancestry?.parentSaveId !== w.saveId, 'Save cannot be its own parent');
  for (const r of w.regions) {
    refs(
      [r.ownerNationId, r.controllerNationId, ...r.claims],
      nations,
      'region nation',
    );
    check(unique(r.claims), 'Duplicate claims');
    check(unique(r.recognizedClaims), 'Duplicate recognized claims');
    check(
      r.recognizedClaims.every(
        (nationId) =>
          r.claims.includes(nationId) && nationId !== r.ownerNationId,
      ),
      'Recognized claims must refer to existing claims by another nation',
    );
    check(r.geometryId === r.id, 'Region geometry ID must be stable');
  }
  const adjacency = new Map(
    w.scenario.regionAdjacency.map((entry) => [
      entry.regionId,
      entry.neighbors,
    ]),
  );
  check(
    unique(w.scenario.regionAdjacency.map((entry) => entry.regionId)),
    'Duplicate regional adjacency entry',
  );
  for (const entry of w.scenario.regionAdjacency) {
    refs([entry.regionId, ...entry.neighbors], regions, 'adjacent region');
    check(unique(entry.neighbors), 'Duplicate adjacent region');
    check(
      !entry.neighbors.includes(entry.regionId),
      'Region cannot neighbor itself',
    );
    for (const neighbor of entry.neighbors)
      check(
        adjacency.get(neighbor)?.includes(entry.regionId) ?? false,
        'Regional adjacency must be symmetric',
      );
  }
  const relations = new Set<string>();
  for (const r of w.relations) {
    refs([r.nationA, r.nationB], nations, 'relation nation');
    check(r.nationA < r.nationB, 'Bilateral pairs must be sorted and distinct');
    const key = pairKey(r.nationA, r.nationB);
    check(!relations.has(key), 'Duplicate bilateral relation');
    relations.add(key);
  }
  const activeTreaties = new Set<string>();
  for (const t of w.treaties) {
    refs(t.parties, nations, 'treaty party');
    check(unique(t.parties), 'Treaty parties must be unique');
    check(
      unique(
        t.influenceTerms.map((term) =>
          [
            term.kind,
            term.patronNationId,
            term.subjectNationId,
            term.amount,
            term.ratePercent,
          ].join(':'),
        ),
      ),
      'Duplicate treaty influence term',
    );
    for (const term of t.influenceTerms) {
      refs(
        [term.patronNationId, term.subjectNationId],
        nations,
        'influence treaty party',
      );
      check(
        term.patronNationId !== term.subjectNationId &&
          t.parties.includes(term.patronNationId) &&
          t.parties.includes(term.subjectNationId),
        'Influence term parties must be treaty parties',
      );
      check(
        term.kind === 'tribute'
          ? term.amount > 0 !== term.ratePercent > 0
          : [
                'subsidy',
                'infrastructure-investment',
                'debt-repayment',
                'loan',
                'debt-relief',
              ].includes(term.kind)
            ? term.amount > 0 && term.ratePercent === 0
            : term.amount === 0 && term.ratePercent === 0,
        `Invalid influence payment fields for ${term.kind}`,
      );
      check(
        term.paidAmount >= 0 && term.arrears >= 0,
        'Invalid influence payment history',
      );
      check(
        !term.lastPaymentDate ||
          (term.lastPaymentDate >= w.scenario.startDate &&
            term.lastPaymentDate <= w.date),
        'Influence payment date outside world chronology',
      );
    }
    check(
      unique(t.breaches.map((breach) => breach.id)),
      'Duplicate treaty breach ID',
    );
    for (const breach of t.breaches) {
      refs(
        [breach.violatingNationId, breach.injuredNationId],
        nations,
        'treaty breach party',
      );
      check(
        breach.violatingNationId !== breach.injuredNationId &&
          t.parties.includes(breach.violatingNationId) &&
          t.parties.includes(breach.injuredNationId) &&
          breach.date >= w.scenario.startDate &&
          breach.date <= w.date,
        'Invalid treaty breach parties or date',
      );
    }
    check(
      unique(t.ratificationGovernments.map((entry) => entry.nationId)) &&
        t.ratificationGovernments.every((entry) =>
          t.parties.includes(entry.nationId),
        ),
      'Invalid ratification government record',
    );
    check(
      unique(t.directives.map((directive) => directive.id)),
      'Duplicate patron directive ID',
    );
    for (const directive of t.directives) {
      refs(
        [directive.patronNationId, directive.subjectNationId],
        nations,
        'patron directive party',
      );
      check(
        directive.patronNationId !== directive.subjectNationId &&
          t.parties.includes(directive.patronNationId) &&
          t.parties.includes(directive.subjectNationId) &&
          directive.issuedDate >= w.scenario.startDate &&
          directive.issuedDate <= w.date,
        'Patron directive parties or date invalid',
      );
      if (directive.conflictId)
        refs([directive.conflictId], conflicts, 'patron directive conflict');
      if (directive.organizationId)
        refs(
          [directive.organizationId],
          organizationIds,
          'patron directive organization',
        );
      if (directive.targetTreatyId)
        refs(
          [directive.targetTreatyId],
          treaties,
          'patron directive target treaty',
        );
    }
    const settlement = t.kind === 'ceasefire' || t.kind === 'peace';
    check(
      settlement === (t.conflictId !== null),
      'Settlement treaties require conflict linkage',
    );
    if (t.conflictId) {
      refs([t.conflictId], conflicts, 'treaty conflict');
      const c = w.conflicts.find((v) => v.id === t.conflictId);
      check(
        !!c &&
          c.attackers.length === 1 &&
          c.defenders.length === 1 &&
          signature(t.parties) === signature([...c.attackers, ...c.defenders]),
        'Settlement treaty parties must match bilateral conflict',
      );
      if (t.kind === 'ceasefire' && t.status === 'active')
        check(
          c?.status === 'active' && c.settlementState === 'ceasefire',
          'Active ceasefire must match conflict ceasefire',
        );
      if (t.kind === 'peace')
        check(c?.status === 'ended', 'Peace treaty must have ended conflict');
    }
    if (t.status === 'active') {
      const key = `${t.kind}:${signature(t.parties)}`;
      check(!activeTreaties.has(key), 'Duplicate equivalent active treaty');
      activeTreaties.add(key);
    }
  }
  const activeConflicts = new Set<string>();
  for (const c of w.conflicts) {
    check(
      unique(c.campaigns.map((v) => v.regionId + '~' + v.nationId)),
      'Duplicate campaign',
    );
    for (const campaign of c.campaigns) {
      refs([campaign.regionId], regions, 'campaign region');
      check(
        [...c.attackers, ...c.defenders].includes(campaign.nationId),
        'Campaign requires conflict participant',
      );
    }
    refs([...c.attackers, ...c.defenders], nations, 'conflict party');
    check(
      unique([...c.attackers, ...c.defenders]),
      'Conflict sides must be unique and disjoint',
    );
    if (c.status === 'active' && c.settlementState === 'ceasefire')
      check(
        w.treaties.some(
          (t) =>
            t.kind === 'ceasefire' &&
            t.conflictId === c.id &&
            t.status === 'active',
        ),
        'Ceasefire conflict needs active agreement',
      );
    if (c.status === 'active') {
      const key = [signature(c.attackers), signature(c.defenders)]
        .sort()
        .join('|');
      check(!activeConflicts.has(key), 'Duplicate equivalent active conflict');
      activeConflicts.add(key);
    }
  }
  for (const g of w.goals) {
    refs([g.nationId, ...g.targetNationIds], nations, 'goal nation');
    check(unique(g.targetNationIds), 'Duplicate goal targets');
    check(
      !g.deadline || g.deadline >= g.createdDate,
      'Goal deadline must not precede creation',
    );
    check(
      g.createdDate >= w.scenario.startDate &&
        g.createdDate <= g.updatedDate &&
        g.updatedDate <= w.date,
      'Invalid goal chronology',
    );
  }
  for (const action of w.actions) {
    const graph = action.semanticGraph;
    if (!graph) continue;
    check(
      graph.rawInput === action.text,
      'Action graph source differs from recorded order',
    );
    const ids = new Set(graph.actions.map((a) => a.id));
    check(ids.size === graph.actions.length, 'Duplicate semantic action IDs');
    for (const node of graph.actions) {
      check(
        node.actor === action.actorNationId,
        'Action graph swaps acting authority',
      );
      check(
        [
          ...node.targets,
          ...node.sources,
          ...node.participants,
          ...node.beneficiaries,
          ...node.conditions.flatMap((c) => c.subjects),
        ].every((id) => w.nations.some((n) => n.id === id)),
        'Action graph references unknown nation',
      );
      check(
        node.territories.every((id) => w.regions.some((r) => r.id === id)),
        'Action graph references unknown territory',
      );
      check(
        node.dependencies.every((d) => ids.has(d.actionId)),
        'Action graph dependency references missing action',
      );
    }
  }
  for (const n of w.nations) {
    check(
      unique(n.strategy.directives.map((d) => d.id)),
      'Duplicate directive IDs',
    );
    for (const directive of n.strategy.directives) {
      const plan = directive.semanticPlan;
      if (!plan) continue;
      check(
        plan.actor === n.id,
        'Standing plan actor differs from directive owner',
      );
      check(
        [
          ...plan.targets,
          ...plan.sources,
          ...plan.participants,
          ...plan.beneficiaries,
          ...plan.conditions.flatMap((c) => c.subjects),
        ].every((id) => w.nations.some((nation) => nation.id === id)),
        'Standing plan references unknown nation',
      );
      check(
        plan.territories.every((id) =>
          w.regions.some((region) => region.id === id),
        ),
        'Standing plan references unknown territory',
      );
    }
    check(
      n.strategy.directives.every(
        (d) => d.createdDate >= w.scenario.startDate && d.createdDate <= w.date,
      ),
      'Invalid directive chronology',
    );
  }
  for (const g of w.goals) {
    if (g.parentGoalId) {
      const parent = w.goals.find((p) => p.id === g.parentGoalId);
      check(
        !!parent &&
          parent.nationId === g.nationId &&
          parent.parentGoalId === null &&
          parent.id !== g.id,
        'Goal hierarchy must be same owner and depth at most one',
      );
    }
    check(
      g.signals.every(
        (signal) =>
          signal.baseline !== signal.target &&
          signal.baseline >= 0 &&
          signal.target >= 0 &&
          signal.baseline <= (signal.stat === 'treasury' ? 1000000000 : 100) &&
          signal.target <= (signal.stat === 'treasury' ? 1000000000 : 100),
      ),
      'Invalid deterministic goal signal',
    );
  }
  const deliveryAllocation = new Map<string, number>();
  for (const c of w.commitments) {
    check(
      unique(c.deliveries.map((d) => d.initiativeId)),
      'Duplicate commitment delivery project',
    );
    for (const d of c.deliveries) {
      const i = w.initiatives.find((i) => i.id === d.initiativeId);
      check(
        !!i &&
          i.status === 'completed' &&
          i.nationId === c.issuer &&
          i.startDate >= c.createdDate &&
          c.condition.kind === 'project' &&
          i.kind === c.condition.initiativeKind &&
          (c.type !== 'aid' ||
            (i.targetNationId !== null &&
              c.recipients.includes(i.targetNationId))),
        'Invalid commitment delivery',
      );
      deliveryAllocation.set(
        d.initiativeId,
        (deliveryAllocation.get(d.initiativeId) ?? 0) + d.investment,
      );
    }
    check(
      c.status !== 'fulfilled' ||
        c.condition.kind === 'restraint' ||
        c.deliveries.reduce((s, d) => s + d.investment, 0) >=
          c.condition.minimumInvestment,
      'Fulfillment must have funded delivery evidence',
    );
    refs([c.issuer, ...c.recipients], nations, 'commitment party');
    refs([c.sourceNegotiationId], negotiationIds, 'commitment negotiation');
    const source = w.negotiations.find((n) => n.id === c.sourceNegotiationId);
    check(
      source?.status === 'accepted' &&
        source.obligations.some(
          (o) =>
            JSON.stringify(o) ===
            JSON.stringify({
              issuer: c.issuer,
              recipients: c.recipients,
              type: c.type,
              terms: c.terms,
              strength: c.strength,
              dueDate: c.dueDate,
              expiry: c.expiry,
              condition: c.condition,
            }),
        ),
      'Commitment must originate from accepted structured terms',
    );
    check(
      c.createdDate >= w.scenario.startDate &&
        c.createdDate <= w.date &&
        c.history.every((h) => h.date >= c.createdDate && h.date <= w.date) &&
        c.history.at(-1)?.status === c.status,
      'Invalid commitment history',
    );
    check(
      !c.dueDate || c.dueDate > c.createdDate,
      'Invalid commitment delivery date',
    );
    check(!c.expiry || c.expiry > c.createdDate, 'Invalid commitment expiry');
    check(
      c.history.every((h, i) => i === 0 || h.date >= c.history[i - 1]!.date),
      'Commitment history must be chronological',
    );
    check(
      c.visibility === source?.visibility,
      'Commitment visibility must match source',
    );
    check(
      !c.recipients.includes(c.issuer) && unique(c.recipients),
      'Invalid commitment recipients',
    );
    check(
      c.condition.kind === 'restraint'
        ? c.type === 'nonaggression'
        : ['aid', 'project'].includes(c.type),
      'Unsupported commitment conditions',
    );
  }
  for (const [id, amount] of deliveryAllocation)
    check(
      amount <= (w.initiatives.find((i) => i.id === id)?.invested ?? 0),
      'Project investment cannot fulfill multiple obligations twice',
    );
  for (const o of w.organizations) {
    refs(
      [...o.founders, ...o.members, ...o.invitedStates],
      nations,
      'organization nation',
    );
    refs(
      o.invitations.map((invitation) => invitation.nationId),
      nations,
      'organization invitee',
    );
    refs(
      o.pendingApplications.map((application) => application.nationId),
      nations,
      'organization applicant',
    );
    refs(
      o.commitments.flatMap((commitment) => [
        commitment.issuer,
        ...commitment.recipientNationIds,
      ]),
      nations,
      'organization commitment party',
    );
    refs(
      o.programs.flatMap((program) => [
        program.issuerNationId,
        ...program.participantNationIds,
        ...program.responses.map((response) => response.nationId),
      ]),
      nations,
      'organization program party',
    );
    refs(
      o.history.flatMap((entry) =>
        entry.actorNationId ? [entry.actorNationId] : [],
      ),
      nations,
      'organization history actor',
    );
    check(unique(o.members), 'Duplicate organization members');
    check(unique(o.founders), 'Duplicate organization founders');
    check(unique(o.invitedStates), 'Duplicate invited states');
    check(
      unique(o.invitations.map((invitation) => invitation.nationId)),
      'Duplicate organization invitations',
    );
    check(
      unique(o.pendingApplications.map((application) => application.nationId)),
      'Duplicate organization applications',
    );
    check(
      unique(o.commitments.map((commitment) => commitment.id)),
      'Duplicate organization commitment IDs',
    );
    check(
      unique(o.programs.map((program) => program.id)),
      'Duplicate organization program IDs',
    );
    check(
      unique(o.development.map((entry) => entry.dimension)),
      'Duplicate organization development dimensions',
    );
    check(
      unique(
        o.programs
          .filter((program) =>
            ['proposed', 'active', 'suspended'].includes(program.status),
          )
          .map((program) => program.dimension),
      ),
      'Only one active organization program may target each development dimension',
    );
    check(
      o.programs.every((program) => {
        const responseIds = program.responses.map(
          (response) => response.nationId,
        );
        return (
          o.members.includes(program.issuerNationId) &&
          !program.participantNationIds.includes(program.issuerNationId) &&
          unique(program.participantNationIds) &&
          unique(responseIds) &&
          JSON.stringify([...responseIds].sort()) ===
            JSON.stringify([...program.participantNationIds].sort()) &&
          program.participantNationIds.every((id) => o.members.includes(id)) &&
          program.createdDate >= (o.foundingDate ?? w.scenario.startDate) &&
          program.createdDate <= program.updatedDate &&
          program.updatedDate <= w.date &&
          (program.status === 'completed'
            ? program.completedDate !== null &&
              program.completedDate >= program.createdDate &&
              program.completedDate <= w.date &&
              program.progress === 100
            : program.completedDate === null) &&
          program.responses.every((response) =>
            response.move === 'pending'
              ? response.decidedDate === null &&
                response.message === null &&
                response.counterTerms === null
              : response.decidedDate !== null &&
                response.decidedDate >= program.createdDate &&
                response.decidedDate <= w.date &&
                (response.move === 'counter'
                  ? !!response.counterTerms
                  : response.counterTerms === null),
          )
        );
      }),
      'Invalid organization program parties, dates, status, or responses',
    );
    check(
      unique(o.history.map((entry) => entry.id)),
      'Duplicate organization history IDs',
    );
    check(
      o.invitedStates.length === o.invitations.length &&
        o.invitedStates.every((id) =>
          o.invitations.some((invitation) => invitation.nationId === id),
        ),
      'Invited-state index must match invitation records',
    );
    check(
      o.invitations.every(
        (invitation) =>
          !o.members.includes(invitation.nationId) ||
          o.founders.includes(invitation.nationId) ||
          invitation.status === 'accepted',
      ),
      'Membership requires accepted invitation or founding status',
    );
    check(
      o.pendingApplications.every(
        (application) =>
          application.status !== 'pending' ||
          o.invitations.some(
            (invitation) =>
              invitation.nationId === application.nationId &&
              invitation.lastMove === 'counter',
          ),
      ),
      'Organization application requires a countered invitation',
    );
    check(
      o.commitments.every(
        (commitment) =>
          (commitment.appliesTo === 'specific-members'
            ? commitment.recipientNationIds.length > 0
            : commitment.appliesTo === 'all-members'
              ? commitment.recipientNationIds.length === 0
              : true) &&
          (commitment.status !== 'active' || o.status === 'active') &&
          commitment.createdDate >= (o.foundingDate ?? w.scenario.startDate) &&
          commitment.createdDate <= w.date,
      ),
      'Invalid organization commitment scope or chronology',
    );
    check(
      o.foundingDate === null ||
        (o.foundingDate >= w.scenario.startDate && o.foundingDate <= w.date),
      'Invalid organization founding date',
    );
    check(
      o.foundingDate === null || o.founders.length > 0,
      'A dated organization must record its founders',
    );
    check(
      (o.status === 'dissolved') === (o.dissolvedDate !== null) &&
        (!o.dissolvedDate ||
          (o.dissolvedDate >= (o.foundingDate ?? w.scenario.startDate) &&
            o.dissolvedDate <= w.date)),
      'Invalid organization dissolution history',
    );
    check(
      o.status !== 'active' || o.members.length > 0,
      'An active organization requires at least one member',
    );
    check(
      o.invitations.every(
        (invitation) =>
          invitation.invitedDate >= (o.foundingDate ?? w.scenario.startDate) &&
          invitation.invitedDate <= invitation.updatedDate &&
          invitation.updatedDate <= w.date,
      ),
      'Invalid organization invitation chronology',
    );
    check(
      o.pendingApplications.every(
        (application) =>
          application.appliedDate >= (o.foundingDate ?? w.scenario.startDate) &&
          application.appliedDate <= application.updatedDate &&
          application.updatedDate <= w.date,
      ),
      'Invalid organization application chronology',
    );
    check(
      o.history.every(
        (entry, index) =>
          entry.date >= (o.foundingDate ?? w.scenario.startDate) &&
          entry.date <= w.date &&
          (index === 0 || entry.date >= o.history[index - 1]!.date),
      ),
      'Organization history must be chronological',
    );
  }
  const initiativeIds = new Set(w.initiatives.map((v) => v.id as string));
  const activeInitiatives = new Set<string>();
  for (const i of w.initiatives) {
    refs(
      [i.nationId, ...(i.targetNationId ? [i.targetNationId] : [])],
      nations,
      'initiative nation',
    );
    refs(i.dependencies, initiativeIds, 'initiative dependency');
    check(
      unique(i.dependencies) && !i.dependencies.includes(i.id),
      'Invalid initiative dependencies',
    );
    check(
      i.dependencies.every((id) => {
        const dependency = w.initiatives.find((v) => v.id === id);
        return (
          dependency?.nationId === i.nationId &&
          dependency.startDate <= i.startDate
        );
      }),
      'Dependencies must have same owner and precede initiative',
    );
    check(
      i.startDate >= w.scenario.startDate && i.startDate <= w.date,
      'Invalid initiative chronology',
    );
    check(
      i.kind !== 'aid' ||
        (!!i.targetNationId && i.targetNationId !== i.nationId),
      'Aid requires another nation',
    );
    check(
      i.invested <= Math.ceil(i.durationDays / 30) * i.effort &&
        i.progress ===
          Math.floor(
            (i.invested * 100) / (Math.ceil(i.durationDays / 30) * i.effort),
          ),
      'Initiative progress must reflect investment',
    );
    check(
      (i.status === 'completed') === (i.progress === 100),
      'Completed initiative must have full progress',
    );
    if (i.status === 'active') {
      const key = [i.nationId, i.kind, i.targetNationId].join('|');
      check(!activeInitiatives.has(key), 'Duplicate active initiative');
      activeInitiatives.add(key);
    }
  }
  // Iterative topological validation avoids recursion limits for hostile imports.
  const dependencyCounts = new Map(
    w.initiatives.map((i) => [i.id as string, i.dependencies.length]),
  );
  const dependents = new Map<string, string[]>();
  for (const i of w.initiatives)
    for (const dependency of i.dependencies)
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), i.id]);
  const ready = w.initiatives
    .filter((i) => !i.dependencies.length)
    .map((i) => i.id as string);
  let processed = 0;
  for (let index = 0; index < ready.length; index++) {
    processed++;
    for (const id of dependents.get(ready[index]!) ?? []) {
      const count = dependencyCounts.get(id)! - 1;
      dependencyCounts.set(id, count);
      if (!count) ready.push(id);
    }
  }
  check(
    processed === w.initiatives.length,
    'Initiative dependency cycle or missing reference',
  );
  const openNegotiations = new Set<string>();
  for (const n of w.negotiations) {
    check(
      unique(n.obligations.map((o) => JSON.stringify(o))),
      'Duplicate structured obligations',
    );
    for (const o of n.obligations) {
      check(
        [n.proposerNationId, n.recipientNationId].includes(o.issuer) &&
          unique(o.recipients) &&
          o.recipients.every(
            (id) =>
              id !== o.issuer &&
              [n.proposerNationId, n.recipientNationId].includes(id),
          ),
        'Invalid obligation parties',
      );
      check(
        !o.dueDate || o.dueDate > n.createdDate,
        'Invalid obligation deadline',
      );
      check(!o.expiry || o.expiry > n.createdDate, 'Invalid obligation expiry');
      check(
        !o.expiry || !o.dueDate || o.expiry >= o.dueDate,
        'Obligation expiry precedes delivery',
      );
      check(
        o.condition.kind === 'restraint'
          ? o.type === 'nonaggression'
          : ['aid', 'project'].includes(o.type) &&
              (o.type === 'aid'
                ? o.condition.initiativeKind === 'aid'
                : o.condition.initiativeKind !== 'aid'),
        'Unsupported obligation condition',
      );
    }
    if (n.status === 'accepted')
      check(
        w.commitments.filter((c) => c.sourceNegotiationId === n.id).length ===
          n.obligations.length,
        'Accepted obligations must have canonical commitment records',
      );
    check(
      !n.peaceTerms.length || n.kind === 'peace',
      'Concessions require peace',
    );
    check(
      unique(n.peaceTerms.map((t) => t.regionId)),
      'Duplicate peace concession',
    );
    for (const term of n.peaceTerms) {
      refs([term.regionId], regions, 'peace region');
      check(
        term.fromNationId !== term.toNationId &&
          [n.proposerNationId, n.recipientNationId].includes(
            term.fromNationId,
          ) &&
          [n.proposerNationId, n.recipientNationId].includes(term.toNationId),
        'Invalid peace parties',
      );
    }
    const settlement = n.kind === 'ceasefire' || n.kind === 'peace';
    check(
      settlement === (n.conflictId !== null),
      'Settlement negotiations require conflict linkage',
    );
    if (n.conflictId) {
      refs([n.conflictId], conflicts, 'negotiation conflict');
      const c = w.conflicts.find((v) => v.id === n.conflictId);
      check(
        !!c &&
          c.attackers.length === 1 &&
          c.defenders.length === 1 &&
          signature([n.proposerNationId, n.recipientNationId]) ===
            signature([...c.attackers, ...c.defenders]),
        'Settlement offer parties must match bilateral conflict',
      );
      if (n.status === 'open')
        check(
          c?.status === 'active' &&
            (n.kind !== 'ceasefire' || c.settlementState === 'fighting'),
          'Open settlement requires eligible active conflict',
        );
    }
    refs(
      [
        n.proposerNationId,
        n.recipientNationId,
        ...n.responses.map((v) => v.nationId),
      ],
      nations,
      'negotiation party',
    );
    check(
      n.proposerNationId !== n.recipientNationId,
      'Cannot negotiate with self',
    );
    check(
      n.createdDate >= w.scenario.startDate &&
        n.createdDate <= w.date &&
        n.expiresDate > n.createdDate,
      'Invalid negotiation chronology',
    );
    if (n.conditionalPressure) {
      const pressure = n.conditionalPressure;
      check(
        pressure.patronNationId === n.proposerNationId &&
          pressure.subjectNationId === n.recipientNationId &&
          pressure.createdDate === n.createdDate,
        'Conditional pressure must match its negotiating parties and date',
      );
      check(
        pressure.status === 'triggered'
          ? !!pressure.triggeredDate &&
              pressure.triggeredDate >= pressure.createdDate &&
              pressure.triggeredDate <= w.date
          : pressure.triggeredDate === null,
        'Conditional pressure status and trigger date disagree',
      );
      check(
        pressure.status !== 'satisfied' ||
          (pressure.condition === 'rejection' && n.status === 'accepted'),
        'Only an accepted offer can satisfy rejection pressure',
      );
    }
    check(
      n.responses.every(
        (v) =>
          [n.proposerNationId, n.recipientNationId].includes(v.nationId) &&
          v.date >= n.createdDate &&
          v.date <= w.date &&
          v.date < n.expiresDate,
      ),
      'Invalid negotiation response',
    );
    check(
      n.responses.every(
        (v, index) => index === 0 || v.date >= n.responses[index - 1]!.date,
      ),
      'Response dates must be ordered',
    );
    const counters = n.responses.filter((r) => r.move === 'counter').length;
    let proposer = counters % 2 ? n.recipientNationId : n.proposerNationId;
    let recipient = counters % 2 ? n.proposerNationId : n.recipientNationId;
    let terminal: 'accepted' | 'rejected' | 'withdrawn' | null = null;
    for (const response of n.responses) {
      check(terminal === null, 'Closed negotiation cannot receive responses');
      check(
        response.nationId ===
          (response.move === 'withdraw' ? proposer : recipient),
        'Negotiation response actor unauthorized',
      );
      if (response.move === 'counter')
        [proposer, recipient] = [recipient, proposer];
      if (response.move === 'accept') terminal = 'accepted';
      if (response.move === 'reject') terminal = 'rejected';
      if (response.move === 'withdraw') terminal = 'withdrawn';
    }
    check(
      terminal
        ? n.status === terminal
        : n.status === 'open' || n.status === 'expired',
      'Negotiation status must match response history',
    );
    check(
      (n.status === 'accepted' && n.kind !== 'consultation') ===
        (n.treatyId !== null),
      'Only accepted binding negotiation has treaty',
    );
    if (n.status === 'accepted')
      check(
        n.responses.at(-1)?.move === 'accept',
        'Accepted negotiation needs acceptance',
      );
    if (n.treatyId) {
      refs([n.treatyId], treaties, 'negotiation treaty');
      const t = w.treaties.find((v) => v.id === n.treatyId);
      check(
        t?.kind === n.kind &&
          t.conflictId === n.conflictId &&
          signature(t.parties) ===
            signature([n.proposerNationId, n.recipientNationId]),
        'Accepted negotiation must match treaty',
      );
      check(
        n.responses.at(-1)?.move === 'accept',
        'Accepted negotiation needs acceptance',
      );
    }
    if (n.status === 'open') {
      check(n.expiresDate > w.date, 'Open negotiation cannot be expired');
      const key = n.kind + signature([n.proposerNationId, n.recipientNationId]);
      check(!openNegotiations.has(key), 'Duplicate open negotiation');
      openNegotiations.add(key);
    }
    if (n.status === 'expired')
      check(n.expiresDate <= w.date, 'Expired negotiation must have elapsed');
    if (n.status === 'rejected')
      check(
        n.responses.at(-1)?.move === 'reject',
        'Rejected negotiation needs rejection',
      );
    if (n.status === 'withdrawn')
      check(
        n.responses.at(-1)?.move === 'withdraw',
        'Withdrawn negotiation needs withdrawal',
      );
  }
  check(
    w.revision === w.turns.length,
    'Revision must equal committed turn count',
  );
  check(
    w.actions.length === w.turns.length,
    'Each turn needs exactly one action',
  );
  let previousDate = w.scenario.startDate;
  const commandMembership: string[] = [];
  const eventMembership: string[] = [];
  for (let i = 0; i < w.turns.length; i++) {
    const t = w.turns[i]!;
    check(t.revision === i + 1, 'Turn revisions must be consecutive');
    check(
      t.previousDate === previousDate && t.date >= previousDate,
      'Turn chronology cannot move backwards or skip ancestry',
    );
    previousDate = t.date;
    check(
      actions.get(t.actionId)?.turnId === t.id,
      'Turn action reference invalid',
    );
    check(
      unique(t.commandIds) && unique(t.eventIds),
      'Duplicate turn ledger references',
    );
    commandMembership.push(...t.commandIds);
    eventMembership.push(...t.eventIds);
    let commandDate = t.previousDate;
    for (const id of t.commandIds) {
      const c = commands.get(id);
      check(
        c?.turnId === t.id && c.actionId === t.actionId,
        'Turn command provenance invalid',
      );
      if (c) {
        check(
          c.recordedAt === t.recordedAt,
          'Command timestamp must match turn',
        );
        if (c.command.type === 'ADVANCE_DATE') {
          check(c.command.date > commandDate, 'Advance date must move forward');
          commandDate = c.command.date;
        }
        check(
          c.simulationDate === commandDate,
          'Command simulation date inconsistent',
        );
      }
    }
    check(commandDate === t.date, 'Turn date must be explained by commands');
    for (const id of t.eventIds)
      check(events.get(id)?.turnId === t.id, 'Turn event provenance invalid');
  }
  check(previousDate === w.date, 'World date must match last committed turn');
  check(
    commandMembership.length === w.commands.length && unique(commandMembership),
    'Every command must belong to exactly one turn',
  );
  check(
    eventMembership.length === w.events.length && unique(eventMembership),
    'Every event must belong to exactly one turn',
  );
  for (const a of w.actions) {
    refs([a.actorNationId], nations, 'action actor');
    check(turns.get(a.turnId)?.actionId === a.id, 'Action turn invalid');
  }
  for (const c of w.commands) {
    check(
      turns.has(c.turnId) && actions.has(c.actionId),
      'Command has missing provenance',
    );
    const r = commandReferences(c.command);
    refs(r.nationIds, nations, 'command nation');
    refs(r.regionIds, regions, 'command region');
    refs(r.treatyIds, treaties, 'command treaty');
    refs(r.conflictIds, conflicts, 'command conflict');
    refs(r.goalIds, goals, 'command goal');
    refs(r.initiativeIds, initiativeIds, 'command initiative');
    refs(r.negotiationIds, negotiationIds, 'command negotiation');
    refs(r.organizationIds, organizationIds, 'command organization');
    const commandTurn = turns.get(c.turnId);
    const reportedSuppression =
      commandTurn?.suppressedCommandIds?.includes(c.id) === true;
    check(
      sourcedCommands.has(c.id) || reportedSuppression,
      'An unsurfaced command event must be accounted for by novelty suppression',
    );
  }
  for (const e of w.events) {
    refs(e.nationIds, nations, 'event nation');
    refs(
      e.effects.map((v) => v.nationId),
      nations,
      'event effect nation',
    );
    check(
      e.effects.every(
        (v) =>
          v.before >= 0 &&
          v.after >= 0 &&
          v.before <=
            (v.stat === 'treasury' || v.stat === 'debt' ? 1000000000 : 100) &&
          v.after <=
            (v.stat === 'treasury' || v.stat === 'debt' ? 1000000000 : 100) &&
          v.before !== v.after,
      ),
      'Invalid factual event stat effect',
    );
    refs(e.regionIds, regions, 'event region');
    refs(e.treatyIds, treaties, 'event treaty');
    refs(e.conflictIds, conflicts, 'event conflict');
    check(unique(e.sourceCommandIds), 'Duplicate event command sources');
    for (const id of e.sourceCommandIds)
      check(
        commands.get(id)?.turnId === e.turnId &&
          commands.get(id)?.simulationDate === e.date,
        'Event provenance invalid',
      );
    check(
      e.date >= w.scenario.startDate && e.date <= w.date,
      'Event chronology invalid',
    );
  }
  if (problems.length)
    throw new WorldError('INVARIANT', [...new Set(problems)].join('; '));
}
