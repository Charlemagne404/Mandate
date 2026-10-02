import { knowsInformation, informationEntity } from './knowledge.js';
import type {
  WorldState,
  WorldCommand,
  Crisis,
  Conference,
  NationId,
  Goal,
} from '@mandate/schemas';
import { Sanction, EconomicLink } from '@mandate/schemas';
import { requireDomain } from './errors.js';
import { relationshipEffect, liveGoal } from './depth.js';
import { endConflict } from './mechanics.js';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export function crisisSeverity(c: Crisis) {
  return clamp(
    c.militaryPosture * 0.5 + c.rhetoric * 0.2 + c.diplomaticBreakdown * 0.3,
  );
}
export function demandFulfilled(w: WorldState, d: Crisis['demands'][number]) {
  const condition = d.condition;
  switch (condition.kind) {
    case 'acknowledgment':
      return d.satisfied;
    case 'conflict-ended':
      return (
        w.conflicts.find((f) => f.id === condition.conflictId)?.status ===
        'ended'
      );
    case 'ceasefire':
      return (
        w.conflicts.find((f) => f.id === condition.conflictId)
          ?.settlementState === 'ceasefire' ||
        w.conflicts.find((f) => f.id === condition.conflictId)?.status ===
          'ended'
      );
    case 'control':
      return (
        w.regions.find((r) => r.id === condition.regionId)
          ?.controllerNationId === condition.nationId
      );
    case 'agreement':
      return (
        w.negotiations.find((n) => n.id === condition.negotiationId)?.status ===
        'accepted'
      );
  }
}
function recordCrisis(
  c: Crisis,
  date: string,
  nationId: NationId | null,
  action: string,
) {
  const old = c.severity;
  c.severity = crisisSeverity(c);
  c.status =
    c.demands.length > 0 &&
    c.demands.every((d) => d.satisfied) &&
    c.militaryPosture <= 10 &&
    c.diplomaticBreakdown <= 10
      ? 'resolved'
      : c.severity > old
        ? 'escalating'
        : c.severity < old
          ? 'de-escalating'
          : c.status === 'frozen'
            ? 'frozen'
            : 'active';
  c.history = [
    ...c.history.slice(-99),
    { date, nationId, action, severity: c.severity },
  ];
}
function validateConference(w: WorldState, c: Conference) {
  requireDomain(
    c.parties.includes(c.proposer) &&
      new Set(c.parties).size === c.parties.length,
    'Conference proposer must be a party; parties unique',
  );
  requireDomain(
    c.parties.every((id) => w.nations.some((n) => n.id === id)),
    'Unknown conference party',
  );
  requireDomain(
    (c.kind === 'peace') === (c.conflictId !== null),
    'Only peace conferences link a conflict',
  );
  requireDomain(
    (c.kind === 'sanctions') === (c.sanctionTarget !== null),
    'Sanctions conference requires target',
  );
  requireDomain(
    !c.peaceTerms.length || c.kind === 'peace',
    'Peace terms only at peace conference',
  );
  if (c.sanctionTarget)
    requireDomain(
      w.nations.some((n) => n.id === c.sanctionTarget) &&
        !c.parties.includes(c.sanctionTarget),
      'Invalid coalition target',
    );
  if (c.conflictId) {
    const f = w.conflicts.find((f) => f.id === c.conflictId);
    requireDomain(
      f?.status === 'active' &&
        [...f.attackers, ...f.defenders].every((id) => c.parties.includes(id)),
      'Peace requires all active belligerents',
    );
    requireDomain(
      new Set(c.peaceTerms.map((t) => t.regionId)).size === c.peaceTerms.length,
      'Duplicate peace region',
    );
    for (const t of c.peaceTerms) {
      const r = w.regions.find((r) => r.id === t.regionId);
      const belligerents = [...f.attackers, ...f.defenders];
      requireDomain(
        r &&
          t.fromNationId !== t.toNationId &&
          belligerents.includes(t.fromNationId) &&
          belligerents.includes(t.toNationId),
        'Concessions require belligerents and known region',
      );
      requireDomain(
        t.kind === 'withdrawal'
          ? r.controllerNationId === t.fromNationId &&
              r.ownerNationId === t.toNationId
          : r.ownerNationId === t.fromNationId,
        'Peace concession must match current ownership/control',
      );
    }
  }
}
export function applyContinuityCommand(
  w: WorldState,
  c: WorldCommand,
): boolean {
  const nation = (id: NationId) => {
    const n = w.nations.find((n) => n.id === id);
    requireDomain(n, 'Unknown nation');
    return n;
  };
  switch (c.type) {
    case 'DISCLOSE_INFORMATION': {
      nation(c.issuer);
      c.recipients.forEach(nation);
      requireDomain(
        knowsInformation(w, c.issuer, c.subject),
        'Cannot disclose unknown information',
      );
      requireDomain(
        c.recipients.every((id) => id !== c.issuer) &&
          new Set(c.recipients).size === c.recipients.length,
        'Disclosure recipients distinct from issuer',
      );
      requireDomain(
        c.subject.id.startsWith(c.subject.kind + ':'),
        'Information kind and ID must match',
      );
      for (const recipient of c.recipients) {
        requireDomain(
          !w.knowledge.some(
            (k) =>
              k.subject.id === c.subject.id &&
              k.recipient === recipient &&
              k.confidence === c.confidence,
          ),
          'Equivalent information already shared',
        );
        const record = {
          id: `knowledge:${c.subject.kind}-${c.subject.id.split(':')[1]}-${recipient.slice(7)}-${w.revision}-${c.confidence}`,
          issuer: c.issuer,
          recipient,
          subject: structuredClone(c.subject),
          date: w.date,
          source: c.source,
          confidence: c.confidence,
        };
        w.knowledge.push(record);
        if (c.subject.kind === 'negotiation' && c.confidence === 'confirmed') {
          const e = informationEntity(w, c.subject)!;
          if (
            'proposerNationId' in e &&
            e.visibility === 'private' &&
            ![e.proposerNationId, e.recipientNationId].includes(recipient)
          )
            relationshipEffect(
              w,
              c.issuer,
              c.issuer === e.proposerNationId
                ? e.recipientNationId
                : e.proposerNationId,
              -3,
              -8,
              'Secret diplomatic terms disclosed to an external government',
              'private',
            );
        }
      }
      return true;
    }
    case 'THEATER_ACTION': {
      const f = w.conflicts.find((f) => f.id === c.conflictId);
      requireDomain(
        f?.status === 'active' &&
          [...f.attackers, ...f.defenders].includes(c.nationId),
        'Theater strategy requires active belligerent',
      );
      requireDomain(
        !w.commands.some(
          (r) =>
            r.actionId === w.actions.at(-1)?.id &&
            r.command.type === 'CONFLICT_ACTION' &&
            r.command.nationId === c.nationId &&
            r.command.conflictId === c.conflictId,
        ),
        'Cannot combine legacy and theater strategy in one turn',
      );
      requireDomain(
        c.regionIds.every((id) =>
          w.regions.some(
            (r) =>
              r.id === id &&
              [...f.attackers, ...f.defenders].includes(r.ownerNationId),
          ),
        ),
        'Theater regions require belligerent territory',
      );
      requireDomain(
        new Set(c.regionIds).size === c.regionIds.length,
        'Duplicate theater regions',
      );
      requireDomain(
        f.settlementState !== 'ceasefire' ||
          ![
            'limited-offensive',
            'major-offensive',
            'air-pressure',
            'naval-pressure',
          ].includes(c.posture),
        'Offensive theater prohibited during ceasefire',
      );
      const old = f.theaters.find((t) => t.id === c.theaterId);
      requireDomain(
        !old ||
          (old.nationId === c.nationId &&
            old.regionIds.slice().sort().join() ===
              c.regionIds.slice().sort().join()),
        'Theater identity and geography are permanent',
      );
      const allocated = f.theaters
        .filter((t) => t.nationId === c.nationId && t.id !== c.theaterId)
        .reduce((s, t) => s + t.allocation, 0);
      requireDomain(
        allocated + c.allocation <= 100,
        'Theater allocations cannot exceed force capacity',
      );
      requireDomain(
        !w.commands.some(
          (r) =>
            r.actionId === w.actions.at(-1)?.id &&
            r.command.type === 'THEATER_ACTION' &&
            r.command.theaterId === c.theaterId,
        ),
        'One theater strategy per turn',
      );
      if (old) {
        old.posture = c.posture;
        old.allocation = c.allocation;
      } else
        f.theaters.push({
          id: c.theaterId,
          nationId: c.nationId,
          regionIds: [...c.regionIds],
          posture: c.posture,
          allocation: c.allocation,
          logistics: 50,
          supplyPressure: 0,
          initiative: 50,
          progress: 0,
        });
      return true;
    }
    case 'OPEN_CRISIS': {
      const v = structuredClone(c.crisis);
      requireDomain(!w.crises.some((k) => k.id === v.id), 'Crisis ID reused');
      requireDomain(
        v.startDate === w.date &&
          v.status === 'emerging' &&
          !v.history.length &&
          v.demands.every((d) => !d.satisfied),
        'Crisis must start now without fabricated history or resolution',
      );
      v.severity = crisisSeverity(v);
      v.history.push({
        date: w.date,
        nationId: null,
        action: v.trigger,
        severity: v.severity,
      });
      w.crises.push(v);
      return true;
    }
    case 'CRISIS_ACTION': {
      const v = w.crises.find((k) => k.id === c.crisisId);
      requireDomain(
        v && v.status !== 'resolved' && v.participants.includes(c.nationId),
        'Crisis action requires active participant',
      );
      nation(c.nationId);
      requireDomain(
        !w.commands.some(
          (r) =>
            r.actionId === w.actions.at(-1)?.id &&
            r.command.type === 'CRISIS_ACTION' &&
            r.command.crisisId === c.crisisId &&
            r.command.nationId === c.nationId,
        ),
        'One crisis action per participant per turn',
      );
      requireDomain(
        c.move === 'concede'
          ? c.demandIndex !== undefined
          : c.demandIndex === undefined,
        'Only concession needs demand',
      );
      requireDomain(
        c.negotiationId === undefined || c.move === 'talk',
        'Only talks link negotiations',
      );
      if (c.move === 'warn') v.rhetoric = clamp(v.rhetoric + 15);
      if (c.move === 'mobilize') {
        const n = nation(c.nationId);
        requireDomain(n.stats.treasury >= 5, 'Mobilization requires funds');
        n.stats.treasury -= 5;
        n.stats.readiness = clamp(n.stats.readiness + 5);
        v.militaryPosture = clamp(v.militaryPosture + 20);
      }
      if (c.move === 'talk') {
        if (c.negotiationId) {
          const n = w.negotiations.find((n) => n.id === c.negotiationId);
          requireDomain(
            n?.status === 'open' &&
              [n.proposerNationId, n.recipientNationId].every((id) =>
                v.participants.includes(id),
              ),
            'Talks require related open negotiation',
          );
          if (!v.negotiationIds.includes(c.negotiationId))
            v.negotiationIds.push(c.negotiationId);
        }
        v.diplomaticBreakdown = clamp(v.diplomaticBreakdown - 15);
        v.rhetoric = clamp(v.rhetoric - 10);
      }
      if (c.move === 'stand-down')
        v.militaryPosture = clamp(v.militaryPosture - 20);
      if (c.move === 'concede') {
        const d = v.demands[c.demandIndex!];
        requireDomain(
          d && d.nationId !== c.nationId && !d.satisfied,
          'Concede another participant unresolved demand',
        );
        requireDomain(
          d.condition.kind === 'acknowledgment' || demandFulfilled(w, d),
          'Mechanical demand requires its canonical condition; concession cannot invent fulfillment',
        );
        d.satisfied = true;
        v.diplomaticBreakdown = clamp(v.diplomaticBreakdown - 20);
      }
      if (c.move === 'freeze') v.status = 'frozen';
      recordCrisis(v, w.date, c.nationId, c.move);
      return true;
    }
    case 'SET_ECONOMIC_LINK': {
      const l = c.link;
      nation(l.dependentNationId);
      nation(l.partnerNationId);
      requireDomain(
        l.dependentNationId !== l.partnerNationId,
        'Economic links require distinct nations',
      );
      const old = w.economicLinks.find((l) => l.id === c.link.id);
      requireDomain(
        !old ||
          (old.dependentNationId === l.dependentNationId &&
            old.partnerNationId === l.partnerNationId),
        'Dependency identity is permanent',
      );
      if (old) Object.assign(old, structuredClone(l));
      else w.economicLinks.push(structuredClone(l));
      return true;
    }
    case 'IMPOSE_SANCTION': {
      const s = c.sanction;
      nation(s.issuer);
      nation(s.target);
      requireDomain(
        s.issuer !== s.target &&
          s.startDate === w.date &&
          s.status === 'active' &&
          (!s.endDate || s.endDate > w.date),
        'Sanctions must be new and future dated',
      );
      requireDomain(
        !w.sanctions.some(
          (v) =>
            v.id === s.id ||
            (v.status === 'active' &&
              v.issuer === s.issuer &&
              v.target === s.target &&
              v.sector === s.sector),
        ),
        'Duplicate sanction',
      );
      w.sanctions.push(structuredClone(s));
      relationshipEffect(w, s.issuer, s.target, -5, -3, s.reason);
      return true;
    }
    case 'LIFT_SANCTION': {
      const s = w.sanctions.find((s) => s.id === c.sanctionId);
      requireDomain(
        s?.status === 'active' && s.issuer === c.nationId,
        'Only issuer can lift active sanction',
      );
      s.status = 'lifted';
      s.endDate = w.date;
      relationshipEffect(w, s.issuer, s.target, 2, 1, 'Sanctions relief');
      return true;
    }
    case 'OPEN_CONFERENCE': {
      const v = c.conference;
      validateConference(w, v);
      requireDomain(
        !w.conferences.some((k) => k.id === v.id),
        'Conference ID reused',
      );
      requireDomain(
        v.createdDate === w.date &&
          v.expiresDate > w.date &&
          v.status === 'open' &&
          !v.responses.length &&
          v.round === 0,
        'Conference must start unresponded now',
      );
      w.conferences.push(structuredClone(v));
      return true;
    }
    case 'RESPOND_CONFERENCE': {
      const v = w.conferences.find((v) => v.id === c.conferenceId);
      requireDomain(
        v?.status === 'open' &&
          v.expiresDate > w.date &&
          v.parties.includes(c.nationId),
        'Only participant in open conference can respond',
      );
      requireDomain(
        !v.responses.some(
          (r) =>
            r.round === v.round &&
            r.nationId === c.nationId &&
            r.move === 'accept',
        ) || c.move === 'withdraw',
        'Already accepted current terms',
      );
      requireDomain(
        c.move === 'counter'
          ? !!c.counterTerms && v.round < 20
          : c.counterTerms === undefined && c.counterPeaceTerms === undefined,
        'Counter requires revised terms',
      );
      if (c.move === 'counter') {
        v.round++;
        v.terms = c.counterTerms!;
        v.peaceTerms = c.counterPeaceTerms ?? [];
        validateConference(w, v);
      }
      v.responses.push({
        nationId: c.nationId,
        round: v.round,
        date: w.date,
        move: c.move,
        message: c.message,
        ...(c.counterTerms ? { terms: c.counterTerms } : {}),
      });
      if (c.move === 'reject') v.status = 'rejected';
      if (c.move === 'withdraw') v.status = 'withdrawn';
      const accepted = v.parties.every((id) =>
        v.responses.some(
          (r) =>
            r.round === v.round && r.nationId === id && r.move === 'accept',
        ),
      );
      if (accepted) {
        validateConference(w, v);
        v.status = 'agreed';
        if (v.kind === 'peace') {
          for (const t of v.peaceTerms) {
            const r = w.regions.find((r) => r.id === t.regionId)!;
            if (t.kind === 'territorial-transfer')
              r.ownerNationId = t.toNationId;
            r.controllerNationId = t.toNationId;
          }
          endConflict(w, v.conflictId!);
        } else if (v.kind === 'sanctions') {
          for (const id of v.parties)
            applyContinuityCommand(w, {
              type: 'IMPOSE_SANCTION',
              sanction: Sanction.parse({
                id: `sanction:${v.id.slice(11)}-${id.slice(7)}`,
                issuer: id,
                target: v.sanctionTarget,
                sector: v.sanctionSector,
                intensity: v.sanctionIntensity,
                startDate: w.date,
                reason: v.terms,
              }),
            });
        } else {
          const id =
            `organization:${v.id.slice(11)}` as WorldState['organizations'][number]['id'];
          requireDomain(
            !w.organizations.some((o) => o.id === id),
            'Coalition ID reused',
          );
          w.organizations.push({
            id,
            name: v.title,
            kind:
              v.kind === 'security'
                ? 'alliance'
                : v.kind === 'trade'
                  ? 'economic'
                  : 'regional',
            members: [...v.parties],
            charter: v.terms,
            visibility: v.visibility,
          });
          if (v.kind === 'trade') {
            for (const dependent of v.parties)
              for (const partner of v.parties) {
                if (dependent === partner) continue;
                const existing = w.economicLinks.find(
                  (l) =>
                    l.dependentNationId === dependent &&
                    l.partnerNationId === partner,
                );
                if (!existing)
                  w.economicLinks.push(
                    EconomicLink.parse({
                      id: `economic:${v.id.slice(11)}-${dependent.slice(7)}-${partner.slice(7)}`,
                      dependentNationId: dependent,
                      partnerNationId: partner,
                      imports: 20,
                      exports: 20,
                      energy: 0,
                      strategicGoods: 0,
                      finance: 10,
                      alternatives: 30,
                    }),
                  );
              }
          }
        }
        for (let i = 0; i < v.parties.length; i++)
          for (const other of v.parties.slice(i + 1))
            relationshipEffect(
              w,
              v.parties[i]!,
              other,
              3,
              4,
              `Conference agreement: ${v.title}`,
              v.visibility,
            );
      }
      return true;
    }
    case 'SCHEDULE_ELECTION': {
      const t = c.tenure;
      const n = nation(t.nationId);
      requireDomain(
        !w.tenures.some((v) => v.nationId === t.nationId || v.id === t.id),
        'Election already scheduled',
      );
      requireDomain(
        t.startDate === w.date &&
          t.nextElectionDate > w.date &&
          !t.outcomes.length &&
          t.incumbent === n.leader,
        'Election must use current leadership and future date',
      );
      w.tenures.push(structuredClone(t));
      return true;
    }
    case 'REVISE_GOAL_EVALUATION': {
      const g = w.goals.find((g) => g.id === c.goalId);
      requireDomain(g && liveGoal(g), 'Only live goal can be recalibrated');
      g.evaluation = structuredClone(c.evaluation);
      g.updatedDate = w.date;
      g.stalledDays = 0;
      return true;
    }
    default:
      return false;
  }
}

export function updateContinuity(
  w: WorldState,
  date: string,
  accountingTick: boolean,
) {
  for (const c of w.conferences)
    if (c.status === 'open' && c.expiresDate <= date) c.status = 'expired';
  for (const s of w.sanctions)
    if (s.status === 'active' && s.endDate && s.endDate <= date)
      s.status = 'lifted';
  for (const t of w.tenures) {
    while (date >= t.nextElectionDate) {
      const n = w.nations.find((n) => n.id === t.nationId)!;
      const support = clamp(
        (n.stats.legitimacy +
          n.stats.stability +
          n.stats.economy +
          100 -
          n.stats.unrest) /
          4,
      );
      const retained = support >= 50;
      if (!retained) {
        const former = {
          name: n.leader,
          government: structuredClone(n.government),
          strategy: structuredClone(n.strategy),
        };
        n.leader = t.challenger.name;
        n.government = structuredClone(t.challenger.government);
        n.strategy = {
          ...structuredClone(t.challenger.strategy),
          directives: n.strategy.directives,
        };
        t.challenger = former;
        for (const g of w.goals.filter(
          (g) => g.nationId === n.id && liveGoal(g),
        ))
          g.strategyReview =
            'Leadership changed; review priority and means while preserving treaty obligations';
      }
      t.incumbent = n.leader;
      t.startDate = t.nextElectionDate;
      t.outcomes = [
        ...t.outcomes.slice(-99),
        {
          date: t.nextElectionDate,
          winner: n.leader,
          incumbentRetained: retained,
          support,
        },
      ];
      t.nextElectionDate = new Date(
        Date.parse(t.nextElectionDate) + t.termDays * 86400000,
      )
        .toISOString()
        .slice(0, 10);
    }
  }
  if (!accountingTick) return;
  // Stable variation derives only from scenario identity, date, theater and actor.
  for (const f of w.conflicts.filter((f) => f.status === 'active'))
    for (const t of [...f.theaters].sort((a, b) => a.id.localeCompare(b.id))) {
      const n = w.nations.find((n) => n.id === t.nationId)!;
      const enemies = f.attackers.includes(n.id) ? f.defenders : f.attackers;
      if (t.posture === 'prepare-ceasefire') {
        f.escalation = clamp(f.escalation - 3);
        continue;
      }
      if (t.posture === 'withdraw') {
        const held = t.regionIds
          .map((id) => w.regions.find((r) => r.id === id)!)
          .find(
            (r) =>
              r.controllerNationId === n.id &&
              enemies.includes(r.ownerNationId),
          );
        if (held) held.controllerNationId = held.ownerNationId;
        t.progress = 0;
        t.supplyPressure = clamp(t.supplyPressure - 10);
        continue;
      }
      if (f.settlementState === 'ceasefire') continue;
      if (t.posture === 'hold') {
        t.supplyPressure = clamp(t.supplyPressure - 2);
        continue;
      }
      const cost =
        t.posture === 'major-offensive'
          ? 8
          : t.posture === 'limited-offensive'
            ? 4
            : 3;
      if (n.stats.treasury < cost || n.stats.stability < 25) {
        t.supplyPressure = clamp(t.supplyPressure + 10);
        continue;
      }
      n.stats.treasury -= cost;
      if (t.posture === 'reinforce') {
        t.logistics = clamp(t.logistics + 5);
        n.stats.readiness = clamp(n.stats.readiness + 3);
        t.supplyPressure = clamp(t.supplyPressure - 5);
        continue;
      }
      const target = t.regionIds
        .map((id) => w.regions.find((r) => r.id === id)!)
        .find((r) => enemies.includes(r.controllerNationId));
      if (!target) continue;
      const d = w.nations.find((n) => n.id === target.controllerNationId)!;
      let seed = 2166136261;
      for (const ch of `${w.scenario.rules?.seed ?? w.scenario.id}:${date}:${t.id}`)
        seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
      const variation = 0.9 + (seed % 21) / 100;
      const strength =
        n.stats.military *
        (0.5 + n.stats.readiness / 100) *
        (t.allocation / 100) *
        (0.5 + t.logistics / 100) *
        (1 - f.exhaustion / 150) *
        (1 - t.supplyPressure / 150) *
        variation;
      const defensive =
        d.stats.military *
        (0.5 + d.stats.readiness / 100) *
        (0.6 + d.stats.industrial / 200);
      t.initiative = clamp(50 + 20 * (strength / Math.max(1, defensive) - 1));
      const advance = Math.max(
        -8,
        Math.min(
          t.posture === 'major-offensive' ? 20 : 12,
          Math.round((strength / Math.max(1, defensive) - 0.6) * 12),
        ),
      );
      const pressureOnly = ['air-pressure', 'naval-pressure'].includes(
        t.posture,
      );
      if (!pressureOnly) t.progress = clamp(t.progress + advance);
      else
        d.stats.readiness = clamp(
          d.stats.readiness - (strength > defensive ? 2 : 0),
        );
      t.supplyPressure = clamp(t.supplyPressure + 5);
      n.stats.readiness = clamp(n.stats.readiness - 2);
      f.exhaustion = clamp(f.exhaustion + 2);
      if (t.progress === 100) {
        target.controllerNationId = n.id;
        t.progress = 0;
      }
    }
  for (const l of w.economicLinks) {
    const sanctions = w.sanctions.filter(
      (s) =>
        s.status === 'active' &&
        s.issuer === l.partnerNationId &&
        s.target === l.dependentNationId,
    );
    const war = w.conflicts.some(
      (f) =>
        f.status === 'active' &&
        f.settlementState === 'fighting' &&
        ((f.attackers.includes(l.dependentNationId) &&
          f.defenders.includes(l.partnerNationId)) ||
          (f.defenders.includes(l.dependentNationId) &&
            f.attackers.includes(l.partnerNationId))),
    );
    const exposure = (sector: string) =>
      sector === 'trade'
        ? (l.imports + l.exports) / 2
        : sector === 'energy'
          ? l.energy
          : sector === 'finance'
            ? l.finance
            : l.strategicGoods;
    const substitution = w.initiatives.filter(
      (i) =>
        i.nationId === l.dependentNationId &&
        i.status === 'completed' &&
        ['industry', 'energy'].includes(i.kind),
    ).length;
    const damage = clamp(
      sanctions.reduce(
        (sum, s) => sum + (exposure(s.sector) * s.intensity) / 100,
        0,
      ) + (war ? (l.imports + l.exports) / 2 : 0),
    );
    const net =
      (((damage * (100 - l.alternatives)) / 100) * (100 - l.adaptation)) / 100;
    const target = w.nations.find((n) => n.id === l.dependentNationId)!;
    const cost = Math.min(
      16,
      Math.floor(
        ((net / 15) * (w.scenario.rules?.economicSeverity ?? 100)) / 100,
      ),
    );
    target.stats.treasury = Math.max(0, target.stats.treasury - cost);
    target.stats.economy = clamp(target.stats.economy - Math.floor(cost / 2));
    target.stats.unrest = clamp(target.stats.unrest + Math.floor(cost / 3));
    if (damage) {
      const issuer = w.nations.find((n) => n.id === l.partnerNationId)!;
      issuer.stats.treasury = Math.max(
        0,
        issuer.stats.treasury -
          Math.min(3, Math.floor((l.exports * damage) / 3000)),
      );
      // Adaptation is slow and bounded; completed substitution investments accelerate it.
      l.adaptation = Math.min(80, l.adaptation + 1 + Math.min(3, substitution));
    }
    const economicCoalition = w.organizations.some(
      (o) =>
        o.kind === 'economic' &&
        o.members.includes(l.dependentNationId) &&
        o.members.includes(l.partnerNationId),
    );
    if (!damage && economicCoalition) {
      l.alternatives = clamp(l.alternatives + 1);
      target.stats.treasury = Math.min(1000000000, target.stats.treasury + 1);
    }
  }
  for (const c of w.crises) {
    if (c.status === 'resolved') continue;
    const previousDemands = c.demands.map((d) => d.satisfied);
    for (const demand of c.demands)
      if (demand.condition.kind !== 'acknowledgment')
        demand.satisfied = demandFulfilled(w, demand);
    const demandsChanged = c.demands.some(
      (d, index) => d.satisfied !== previousDemands[index],
    );
    if (c.conflictId) {
      const f = w.conflicts.find((f) => f.id === c.conflictId)!;
      c.militaryPosture =
        f.status === 'ended'
          ? 0
          : f.settlementState === 'ceasefire'
            ? Math.max(0, c.militaryPosture - 10)
            : Math.max(c.militaryPosture, f.escalation);
    }
    if (
      c.status !== 'frozen' &&
      c.deadline &&
      date >= c.deadline &&
      c.demands.some((d) => !d.satisfied)
    ) {
      c.diplomaticBreakdown = clamp(
        c.diplomaticBreakdown +
          Math.round((5 * (w.scenario.rules?.crisisSensitivity ?? 100)) / 100),
      );
    }
    const breached = w.commitments.some(
      (k) =>
        k.status === 'breached' &&
        c.participants.includes(k.issuer) &&
        k.recipients.some((id) => c.participants.includes(id)) &&
        k.history.at(-1)?.date === date,
    );
    if (breached) c.diplomaticBreakdown = clamp(c.diplomaticBreakdown + 15);
    if (crisisSeverity(c) !== c.severity || demandsChanged)
      recordCrisis(
        c,
        date,
        null,
        'Canonical demands, conflict posture, deadline or broken commitment changes pressure',
      );
  }
}

export function evaluateGoal(
  w: WorldState,
  g: Goal,
): { progress: number; evidence: string[] } {
  const e = g.evaluation;
  const n = w.nations.find((n) => n.id === g.nationId)!;
  const fraction = (value: number, baseline: number, target: number) =>
    clamp((100 * (value - baseline)) / (target - baseline));
  switch (e.kind) {
    case 'metrics':
      return {
        progress: g.progress,
        evidence: ['Metric signals determine progress'],
      };
    case 'capacity': {
      // Version-2 goals without supplied criteria use explicit, inspectable capacity proxies.
      const stats =
        g.kind === 'economic'
          ? (['economy', 'industrial', 'fiscal'] as const)
          : g.kind === 'domestic'
            ? (['stability', 'legitimacy'] as const)
            : g.kind === 'diplomatic'
              ? (['influence'] as const)
              : (['military', 'readiness'] as const);
      return {
        progress: clamp(
          stats.reduce(
            (sum, stat) => sum + Math.min(100, (n.stats[stat] * 100) / 75),
            0,
          ) / stats.length,
        ),
        evidence: stats.map(
          (stat) =>
            `Capacity proxy ${stat}: ${n.stats[stat]}; success threshold 75`,
        ),
      };
    }
    case 'relationship': {
      const r = w.relations.find(
        (r) =>
          [r.nationA, r.nationB].includes(n.id) &&
          [r.nationA, r.nationB].includes(e.nationId),
      );
      return {
        progress: fraction(r?.score ?? 0, e.baseline, e.target),
        evidence: [
          `Relation ${e.nationId}: ${r?.score ?? 0}; target ${e.target}`,
        ],
      };
    }
    case 'territory': {
      const r = w.regions.find((r) => r.id === e.regionId)!;
      return {
        progress:
          (e.mode === 'control' ? r.controllerNationId : r.ownerNationId) ===
          n.id
            ? 100
            : 0,
        evidence: [`${e.mode} of ${e.regionId}`],
      };
    }
    case 'organization':
      return {
        progress: w.organizations
          .find((o) => o.id === e.organizationId)!
          .members.includes(n.id)
          ? 100
          : 0,
        evidence: [`Membership ${e.organizationId}`],
      };
    case 'project': {
      const p = w.initiatives.find((i) => i.id === e.initiativeId)!;
      return {
        progress: p.progress,
        evidence: [`Project ${p.id}: ${p.status}, ${p.invested} funded`],
      };
    }
    case 'dependence': {
      const l = w.economicLinks.find(
        (l) =>
          l.dependentNationId === n.id &&
          l.partnerNationId === e.partnerNationId,
      )!;
      const effective = Math.round(
        (((l.imports + l.energy + l.strategicGoods + l.finance) / 4) *
          (100 - l.adaptation)) /
          100,
      );
      return {
        progress: fraction(effective, e.baseline, e.target),
        evidence: [
          `Composite dependence on ${e.partnerNationId}: ${effective}; target ${e.target}`,
        ],
      };
    }
  }
}
