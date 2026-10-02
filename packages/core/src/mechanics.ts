import type {
  ConflictId,
  Negotiation,
  WorldCommand,
  WorldState,
} from '@mandate/schemas';
import { relationshipEffect, validateObligations } from './depth.js';
import { requireDomain } from './errors.js';

const clamp = (n: number) => Math.max(0, Math.min(100, n));
export function applyAlphaCommand(w: WorldState, c: WorldCommand): boolean {
  const nation = (id: string) => {
    const n = w.nations.find((n) => n.id === id);
    requireDomain(n, `Unknown nation: ${id}`);
    return n;
  };
  switch (c.type) {
    case 'START_INITIATIVE': {
      const i = c.initiative;
      nation(i.nationId);
      if (i.targetNationId) nation(i.targetNationId);
      requireDomain(
        !w.initiatives.some((v) => v.id === i.id),
        'Initiative ID reused',
      );
      requireDomain(
        i.startDate === w.date &&
          i.status === 'active' &&
          i.progress === 0 &&
          i.invested === 0,
        'Initiatives must start now with no progress or investment',
      );
      requireDomain(
        i.kind !== 'aid' ||
          (i.targetNationId !== null && i.targetNationId !== i.nationId),
        'Aid requires another nation',
      );
      requireDomain(
        new Set(i.dependencies).size === i.dependencies.length &&
          i.dependencies.every((id) =>
            w.initiatives.some((v) => v.id === id && v.nationId === i.nationId),
          ),
        'Invalid initiative dependencies',
      );
      requireDomain(
        !w.initiatives.some(
          (v) =>
            v.status === 'active' &&
            v.nationId === i.nationId &&
            v.kind === i.kind &&
            v.targetNationId === i.targetNationId,
        ),
        'Equivalent active initiative exists',
      );
      w.initiatives.push(structuredClone(i));
      return true;
    }
    case 'CANCEL_INITIATIVE': {
      const i = w.initiatives.find((v) => v.id === c.initiativeId);
      requireDomain(i?.status === 'active', 'No active initiative');
      i.status = 'cancelled';
      return true;
    }
    case 'OPEN_NEGOTIATION': {
      const n = c.negotiation;
      nation(n.proposerNationId);
      nation(n.recipientNationId);
      requireDomain(
        n.proposerNationId !== n.recipientNationId,
        'Cannot negotiate with self',
      );
      requireDomain(
        !w.negotiations.some((v) => v.id === n.id),
        'Negotiation ID reused',
      );
      requireDomain(
        n.createdDate === w.date &&
          n.expiresDate > w.date &&
          n.status === 'open' &&
          !n.responses.length &&
          n.treatyId === null,
        'New negotiation must be open, unresponded and future dated',
      );
      requireDomain(
        !w.negotiations.some(
          (v) =>
            v.status === 'open' &&
            v.kind === n.kind &&
            [v.proposerNationId, v.recipientNationId].sort().join() ===
              [n.proposerNationId, n.recipientNationId].sort().join(),
        ),
        'Equivalent open negotiation exists',
      );
      validateSettlementOffer(w, n);
      validateObligations(w, n);
      n.initialTerms ??= n.terms;
      w.negotiations.push(structuredClone(n));
      return true;
    }
    case 'RESPOND_NEGOTIATION': {
      const n = w.negotiations.find((v) => v.id === c.negotiationId);
      requireDomain(
        n?.status === 'open' && n.expiresDate > w.date,
        'No open unexpired negotiation',
      );
      nation(c.nationId);
      requireDomain(
        c.move === 'withdraw'
          ? c.nationId === n.proposerNationId
          : c.nationId === n.recipientNationId,
        'Only appropriate negotiation party can respond',
      );
      requireDomain(
        c.move === 'counter' ? !!c.counterTerms : c.counterTerms === undefined,
        'Counter terms only allowed and required for counter',
      );
      requireDomain(
        c.move === 'accept' && n.kind !== 'consultation'
          ? !!c.treatyId
          : c.treatyId === undefined,
        'Binding acceptance requires treaty ID; other moves forbid it',
      );
      requireDomain(
        c.counterObligations === undefined || c.move === 'counter',
        'Only counteroffers can revise obligations',
      );
      requireDomain(
        c.counterPeaceTerms === undefined || c.move === 'counter',
        'Only counters can revise peace terms',
      );
      if (c.move === 'accept') {
        validateSettlementOffer(w, n);
        validateObligations(w, n);
      }
      const oldTerms = n.terms;
      const oldObligations = structuredClone(n.obligations);
      n.responses.push({
        nationId: c.nationId,
        date: w.date,
        move: c.move,
        message: c.message,
        offeredTerms: oldTerms,
        obligations: oldObligations,
        peaceTerms: structuredClone(n.peaceTerms),
      });
      if (c.move === 'accept') {
        n.obligations.forEach((o, index) =>
          w.commitments.push({
            ...structuredClone(o),
            id: `commitment:${n.id.slice(12)}-${index}`,
            createdDate: w.date,
            sourceNegotiationId: n.id,
            visibility: n.visibility,
            status: 'active',
            deliveries: [],
            history: [
              {
                date: w.date,
                status: 'active',
                reason:
                  'Structured obligation accepted by negotiation participants',
              },
            ],
          }),
        );
        relationshipEffect(
          w,
          n.proposerNationId,
          n.recipientNationId,
          2,
          3,
          `Agreement reached: ${n.id}`,
          n.visibility,
        );
      }
      if (c.move === 'accept' && n.kind === 'consultation') {
        n.status = 'accepted';
      } else if (c.move === 'accept' && n.kind !== 'consultation') {
        requireDomain(
          !w.treaties.some((v) => v.id === c.treatyId),
          'Treaty ID reused',
        );
        w.treaties.push({
          id: c.treatyId!,
          name: n.topic,
          kind: n.kind,
          parties: [n.proposerNationId, n.recipientNationId],
          status: 'active',
          terms: n.terms,
          visibility: n.visibility,
          conflictId: n.conflictId,
        });
        n.treatyId = c.treatyId!;
        n.status = 'accepted';
        if (n.kind === 'ceasefire')
          w.conflicts.find((v) => v.id === n.conflictId)!.settlementState =
            'ceasefire';
        if (n.kind === 'peace') {
          for (const term of n.peaceTerms) {
            const r = w.regions.find((r) => r.id === term.regionId)!;
            if (term.kind === 'territorial-transfer')
              r.ownerNationId = term.toNationId;
            r.controllerNationId = term.toNationId;
          }
          w.treaties.find((t) => t.id === n.treatyId)!.terms = n.peaceTerms
            .length
            ? `Peace settlement: hostilities cease. Agreed concessions: ${n.peaceTerms.map((t) => `${t.kind} ${t.regionId} from ${t.fromNationId} to ${t.toNationId}`).join('; ')}`
            : 'Peace settlement: hostilities cease. Current military control is retained; legal ownership is unchanged.';
          endConflict(w, n.conflictId!, n.id);
        }
      } else if (c.move === 'reject') n.status = 'rejected';
      else if (c.move === 'withdraw') n.status = 'withdrawn';
      else if (c.move === 'counter') {
        n.initialTerms ??= oldTerms;
        n.terms = c.counterTerms!;
        n.obligations = c.counterObligations ?? [];
        n.peaceTerms = c.counterPeaceTerms ?? [];
        validateSettlementOffer(w, n);
        validateObligations(w, n);
        [n.proposerNationId, n.recipientNationId] = [
          n.recipientNationId,
          n.proposerNationId,
        ];
      }
      return true;
    }
    case 'CREATE_ORGANIZATION':
      requireDomain(
        !w.organizations.some((v) => v.id === c.organization.id),
        'Organization ID reused',
      );
      c.organization.members.forEach(nation);
      requireDomain(
        new Set(c.organization.members).size === c.organization.members.length,
        'Organization members must be unique',
      );
      w.organizations.push(structuredClone(c.organization));
      return true;
    case 'SET_ORGANIZATION_MEMBERSHIP': {
      nation(c.nationId);
      const o = w.organizations.find((v) => v.id === c.organizationId);
      requireDomain(o, 'Unknown organization');
      requireDomain(
        o.members.includes(c.nationId) !== c.member,
        'Membership unchanged',
      );
      if (c.member) o.members.push(c.nationId);
      else {
        requireDomain(
          o.members.length > 1,
          'Organization must retain a member',
        );
        o.members = o.members.filter((id) => id !== c.nationId);
      }
      return true;
    }
    case 'APPLY_DOMESTIC_PRESSURE': {
      const n = nation(c.nationId);
      n.stats.unrest = clamp(n.stats.unrest + c.amount);
      n.stats.stability = clamp(n.stats.stability - Math.ceil(c.amount / 2));
      return true;
    }
    case 'CONFLICT_ACTION': {
      const actor = nation(c.nationId);
      requireDomain(
        !w.commands.some(
          (record) =>
            record.actionId === w.actions.at(-1)?.id &&
            record.command.type === 'CONFLICT_ACTION' &&
            record.command.nationId === c.nationId &&
            record.command.conflictId === c.conflictId,
        ),
        'One strategic posture per actor/conflict per turn',
      );
      const f = w.conflicts.find((v) => v.id === c.conflictId);
      requireDomain(f?.status === 'active', 'No active conflict');
      requireDomain(
        !f.theaters.some((t) => t.nationId === c.nationId),
        'Actor with allocated theaters must use theater strategy',
      );
      const ownSide = f.attackers.includes(c.nationId)
        ? f.attackers
        : f.defenders;
      const enemySide = ownSide === f.attackers ? f.defenders : f.attackers;
      requireDomain(
        ownSide.includes(c.nationId),
        'Conflict action requires participant',
      );
      requireDomain(
        c.stance === 'offensive' ? !!c.regionId : c.regionId === undefined,
        'Region only allowed and required for offensive',
      );
      if (c.stance === 'mobilize' || c.stance === 'reinforce') {
        requireDomain(actor.stats.treasury >= 5, 'Insufficient treasury');
        actor.stats.treasury -= 5;
        actor.stats.readiness = clamp(actor.stats.readiness + 8);
        if (c.stance === 'reinforce') f.logistics = clamp(f.logistics + 5);
      } else if (c.stance === 'defend') f.logistics = clamp(f.logistics + 3);
      else if (c.stance === 'deescalate')
        f.escalation = clamp(f.escalation - 10);
      else {
        requireDomain(
          f.settlementState === 'fighting',
          'Offensives are prohibited during ceasefire',
        );
        const r = w.regions.find((v) => v.id === c.regionId);
        requireDomain(
          r && enemySide.includes(r.controllerNationId),
          'Offensive target must be enemy controlled',
        );
        requireDomain(
          actor.stats.readiness >= 20 &&
            actor.stats.treasury >= 10 &&
            actor.stats.stability >= 25,
          'Offensive requires readiness and treasury',
        );
        const defender = nation(r.controllerNationId);
        const strength =
          ((actor.stats.military *
            (50 + actor.stats.readiness) *
            (50 + f.logistics)) /
            10000) *
          (0.5 + actor.stats.stability / 200) *
          (1 - f.exhaustion / 200);
        const resistance =
          (defender.stats.military * (50 + defender.stats.readiness)) / 100;
        actor.stats.treasury -= 10;
        actor.stats.readiness = clamp(actor.stats.readiness - 12);
        actor.stats.unrest = clamp(actor.stats.unrest + 2);
        f.exhaustion = clamp(f.exhaustion + 5);
        f.escalation = clamp(f.escalation + 5);
        let campaign = f.campaigns.find(
          (v) => v.regionId === r.id && v.nationId === actor.id,
        );
        if (!campaign) {
          campaign = { regionId: r.id, nationId: actor.id, progress: 0 };
          f.campaigns.push(campaign);
        }
        const overwhelming = strength > Math.max(1, resistance) * 3;
        campaign.progress = clamp(
          campaign.progress +
            (overwhelming ? 50 : strength > resistance * 1.15 ? 35 : -10),
        );
        if (campaign.progress === 100) r.controllerNationId = actor.id;
      }
      return true;
    }
    default:
      return false;
  }
}

export function isSettlement(kind: string): boolean {
  return kind === 'ceasefire' || kind === 'peace';
}
export function validateSettlementOffer(w: WorldState, n: Negotiation): void {
  requireDomain(
    isSettlement(n.kind) === (n.conflictId !== null),
    'Settlement offers require a conflict; other offers cannot link one',
  );
  requireDomain(
    !n.peaceTerms.length || n.kind === 'peace',
    'Territorial settlement terms require peace negotiation',
  );
  requireDomain(
    new Set(n.peaceTerms.map((t) => t.regionId)).size === n.peaceTerms.length,
    'A region cannot be conceded twice',
  );
  for (const term of n.peaceTerms) {
    const r = w.regions.find((r) => r.id === term.regionId);
    const parties = [n.proposerNationId, n.recipientNationId];
    requireDomain(
      r &&
        term.fromNationId !== term.toNationId &&
        parties.includes(term.fromNationId) &&
        parties.includes(term.toNationId),
      'Peace term requires known region and participating parties',
    );
    requireDomain(
      term.kind === 'withdrawal'
        ? r.controllerNationId === term.fromNationId &&
            r.ownerNationId === term.toNationId
        : r.ownerNationId === term.fromNationId &&
            parties.includes(r.controllerNationId),
      'Party cannot concede unowned territory or withdraw another army',
    );
  }
  if (!isSettlement(n.kind)) return;
  const conflict = w.conflicts.find((v) => v.id === n.conflictId);
  requireDomain(
    conflict?.status === 'active',
    'Settlement requires an active conflict',
  );
  requireDomain(
    conflict.attackers.length === 1 && conflict.defenders.length === 1,
    'Settlement supports bilateral conflicts only',
  );
  requireDomain(
    [n.proposerNationId, n.recipientNationId].sort().join() ===
      [...conflict.attackers, ...conflict.defenders].sort().join(),
    'Settlement parties must match opposing sides',
  );
  requireDomain(
    n.kind !== 'ceasefire' || conflict.settlementState === 'fighting',
    'Conflict already has ceasefire',
  );
}
export function endConflict(
  w: WorldState,
  conflictId: ConflictId,
  exceptNegotiationId?: string,
): void {
  const conflict = w.conflicts.find((v) => v.id === conflictId);
  requireDomain(conflict?.status === 'active', 'No active conflict');
  conflict.status = 'ended';
  for (const treaty of w.treaties)
    if (
      treaty.kind === 'ceasefire' &&
      treaty.conflictId === conflictId &&
      treaty.status === 'active'
    )
      treaty.status = 'ended';
  for (const offer of w.negotiations)
    if (
      offer.conflictId === conflictId &&
      offer.status === 'open' &&
      offer.id !== exceptNegotiationId
    ) {
      offer.status = 'withdrawn';
      offer.responses.push({
        nationId: offer.proposerNationId,
        date: w.date,
        move: 'withdraw',
        message: 'The conflict ended; this settlement offer is closed.',
      });
    }
}
