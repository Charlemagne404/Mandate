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
import { influenceProfile } from './influence.js';

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
  w: WorldState,
  c: Crisis,
  date: string,
  nationId: NationId | null,
  action: string,
  aggressiveAction = false,
) {
  const old = c.severity;
  c.severity = crisisSeverity(c);
  const sameDateHistory = c.history.filter((entry) => entry.date === date);
  const turnBaseline =
    sameDateHistory[0]?.severity ?? c.history.at(-1)?.severity ?? old;
  const actionId = w.actions.at(-1)?.id;
  const escalatoryCommand = (command: WorldCommand) => {
    const participants = new Set(c.participants);
    switch (command.type) {
      case 'STRATEGIC_ATTACK':
        return (
          participants.has(command.attackerNationId) &&
          participants.has(command.targetNationId)
        );
      case 'CRISIS_ACTION':
        return (
          command.crisisId === c.id &&
          (command.move === 'mobilize' || command.move === 'warn')
        );
      case 'MOBILIZE_FORCE':
        return participants.has(command.nationId);
      case 'START_CONFLICT':
        return (
          [...command.conflict.attackers, ...command.conflict.defenders].filter(
            (id) => participants.has(id),
          ).length >= 2
        );
      case 'THEATER_ACTION':
        return (
          ['limited-offensive', 'major-offensive', 'air-pressure'].includes(
            command.posture,
          ) &&
          w.conflicts.some(
            (conflict) =>
              conflict.id === command.conflictId &&
              [...conflict.attackers, ...conflict.defenders].every((id) =>
                participants.has(id),
              ),
          )
        );
      case 'CONFLICT_ACTION':
        return (
          ['offensive', 'mobilize', 'reinforce'].includes(command.stance) &&
          w.conflicts.some(
            (conflict) =>
              conflict.id === command.conflictId &&
              [...conflict.attackers, ...conflict.defenders].every((id) =>
                participants.has(id),
              ),
          )
        );
      default:
        return false;
    }
  };
  const turnHadAggression =
    aggressiveAction ||
    w.commands.some(
      (record) =>
        record.actionId === actionId && escalatoryCommand(record.command),
    );
  c.status =
    c.demands.length > 0 &&
    c.demands.every((d) => d.satisfied) &&
    c.militaryPosture <= 10 &&
    c.diplomaticBreakdown <= 10
      ? 'resolved'
      : c.severity > turnBaseline
        ? 'escalating'
        : c.severity < turnBaseline
          ? turnHadAggression
            ? 'active'
            : 'de-escalating'
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
          : t.kind === 'territorial-transfer'
            ? r.ownerNationId === t.fromNationId
            : r.ownerNationId === t.fromNationId &&
              r.claims.includes(t.toNationId) &&
              !r.recognizedClaims.includes(t.toNationId),
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
          momentum: 0,
          exhaustion: 0,
          progress: 0,
          recentOutcomes: [],
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
      recordCrisis(
        w,
        v,
        w.date,
        c.nationId,
        c.move,
        c.move === 'mobilize' || c.move === 'warn',
      );
      return true;
    }
    case 'STRATEGIC_ATTACK': {
      const attacker = nation(c.attackerNationId);
      const target = nation(c.targetNationId);
      requireDomain(attacker.id !== target.id, 'A nation cannot attack itself');
      const conflict = w.conflicts.find((item) => item.id === c.conflictId);
      requireDomain(
        conflict?.status === 'active' &&
          conflict.settlementState === 'fighting' &&
          conflict.attackers.includes(attacker.id) &&
          conflict.defenders.includes(target.id),
        'Strategic attack abstraction requires an active offensive conflict',
      );
      const crisis = c.crisisId
        ? w.crises.find((item) => item.id === c.crisisId)
        : undefined;
      if (c.crisisId)
        requireDomain(
          crisis &&
            crisis.status !== 'resolved' &&
            crisis.participants.includes(attacker.id) &&
            crisis.participants.includes(target.id),
          'Strategic attack abstraction requires its recorded bilateral crisis',
        );
      requireDomain(
        !w.commands.some(
          (record) =>
            record.actionId === w.actions.at(-1)?.id &&
            record.command.type === 'STRATEGIC_ATTACK' &&
            record.command.attackerNationId === attacker.id &&
            record.command.targetNationId === target.id,
        ),
        'One strategic attack abstraction per target per turn',
      );
      const catastrophic = c.scale === 'catastrophic';
      const change = (
        n: typeof attacker,
        stat: keyof typeof n.stats,
        delta: number,
      ) => {
        if (stat === 'treasury')
          n.stats.treasury = Math.max(0, n.stats.treasury + delta);
        else n.stats[stat] = clamp(n.stats[stat] + delta);
      };
      change(target, 'economy', catastrophic ? -18 : -9);
      change(target, 'industrial', catastrophic ? -16 : -8);
      change(target, 'military', catastrophic ? -10 : -5);
      change(target, 'readiness', catastrophic ? -22 : -12);
      change(target, 'stability', catastrophic ? -22 : -12);
      change(target, 'legitimacy', catastrophic ? -18 : -9);
      change(target, 'fiscal', catastrophic ? -14 : -8);
      change(target, 'unrest', catastrophic ? 26 : 14);
      change(target, 'treasury', catastrophic ? -20 : -10);
      change(attacker, 'economy', catastrophic ? -8 : -4);
      change(attacker, 'fiscal', catastrophic ? -12 : -7);
      change(attacker, 'readiness', catastrophic ? -12 : -7);
      change(attacker, 'stability', catastrophic ? -12 : -7);
      change(attacker, 'legitimacy', catastrophic ? -16 : -9);
      change(attacker, 'unrest', catastrophic ? 20 : 11);
      change(attacker, 'treasury', catastrophic ? -25 : -14);
      conflict.escalation = clamp(
        conflict.escalation + (catastrophic ? 30 : 18),
      );
      conflict.exhaustion = clamp(
        conflict.exhaustion + (catastrophic ? 10 : 6),
      );
      if (crisis) {
        crisis.militaryPosture = clamp(
          crisis.militaryPosture + (catastrophic ? 70 : 20),
        );
        crisis.rhetoric = clamp(crisis.rhetoric + (catastrophic ? 75 : 14));
        crisis.diplomaticBreakdown = clamp(
          crisis.diplomaticBreakdown + (catastrophic ? 75 : 18),
        );
      }
      relationshipEffect(
        w,
        attacker.id,
        target.id,
        catastrophic ? -70 : -50,
        catastrophic ? -70 : -50,
        catastrophic
          ? 'Catastrophic strategic attack abstraction; weapon-specific effects are not simulated'
          : 'Major strategic attack abstraction; weapon-specific effects are not simulated',
      );
      if (crisis)
        recordCrisis(
          w,
          crisis,
          w.date,
          attacker.id,
          'abstracted strategic attack and military escalation',
          true,
        );
      return true;
    }
    case 'MOBILIZE_FORCE': {
      const n = nation(c.nationId);
      const required = c.level === 'full' ? 20 : 8;
      const readiness = c.level === 'full' ? 16 : 7;
      // The order is valid even when the treasury cannot fund it. Available
      // funds determine how much readiness actually materializes; the shortfall
      // damages fiscal capacity and public order instead of vetoing the order.
      const paid = Math.min(n.stats.treasury, required);
      n.stats.treasury -= paid;
      n.stats.readiness = clamp(
        n.stats.readiness + Math.floor((readiness * paid) / required),
      );
      if (paid < required) {
        const shortfall = required - paid;
        n.stats.fiscal = clamp(n.stats.fiscal - Math.ceil(shortfall / 5));
        n.stats.unrest = clamp(n.stats.unrest + Math.ceil(shortfall / 10));
      }
      for (const crisis of w.crises.filter(
        (item) =>
          item.status !== 'resolved' && item.participants.includes(n.id),
      )) {
        crisis.militaryPosture = clamp(crisis.militaryPosture + 10);
        recordCrisis(
          w,
          crisis,
          w.date,
          n.id,
          `${c.level} military mobilization ordered`,
          true,
        );
      }
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
            if (t.kind === 'territorial-transfer') {
              r.ownerNationId = t.toNationId;
              r.controllerNationId = t.toNationId;
            } else if (t.kind === 'withdrawal')
              r.controllerNationId = t.toNationId;
            else if (!r.recognizedClaims.includes(t.toNationId))
              r.recognizedClaims.push(t.toNationId);
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
            acronym: null,
            kind:
              v.kind === 'security'
                ? 'alliance'
                : v.kind === 'trade'
                  ? 'economic'
                  : 'regional',
            foundingDate: w.date,
            founders: [...v.parties],
            members: [...v.parties],
            invitedStates: [],
            invitations: [],
            pendingApplications: [],
            purpose: v.terms,
            charter: v.terms,
            commitments: [],
            development: [],
            programs: [],
            geographicScope: null,
            history: [],
            status: 'active',
            dissolvedDate: null,
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
  // Front geography and territorial movement are resolved once by the
  // strategic front engine. Continuity handles only non-operational postures.
  for (const conflict of w.conflicts.filter(
    (entry) => entry.status === 'active',
  ))
    for (const theater of [...conflict.theaters].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (theater.posture === 'prepare-ceasefire') {
        conflict.escalation = clamp(conflict.escalation - 3);
        continue;
      }
      if (conflict.settlementState === 'ceasefire') continue;
      if (theater.posture === 'hold') {
        theater.supplyPressure = clamp(theater.supplyPressure - 2);
        continue;
      }
      if (theater.posture === 'reinforce') {
        const nation = w.nations.find(
          (entry) => entry.id === theater.nationId,
        )!;
        if (nation.stats.treasury >= 3 && nation.stats.stability >= 25) {
          nation.stats.treasury -= 3;
          nation.stats.readiness = clamp(nation.stats.readiness + 3);
          theater.logistics = clamp(theater.logistics + 5);
          theater.supplyPressure = clamp(theater.supplyPressure - 5);
        } else theater.supplyPressure = clamp(theater.supplyPressure + 10);
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
        w,
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
    case 'influence': {
      const tierOrder = [
        'INDEPENDENT',
        'PARTNER',
        'DEPENDENT PARTNER',
        'CLIENT STATE',
        'PROTECTORATE',
        'SUBJECT STATE',
        'PUPPET STATE',
      ];
      const target = tierOrder.indexOf(e.tier);
      const achieved = e.subjectNationIds.filter((subjectNationId) => {
        const current = influenceProfile(w, n.id, subjectNationId);
        return tierOrder.indexOf(current.tier) >= target;
      });
      return {
        progress: Math.floor(
          (achieved.length * 100) / e.subjectNationIds.length,
        ),
        evidence: e.subjectNationIds.map((subjectNationId) => {
          const current = influenceProfile(w, n.id, subjectNationId);
          return `${subjectNationId}: ${current.tier}; target ${e.tier}; resistance ${current.resistance}/100`;
        }),
      };
    }
  }
}
