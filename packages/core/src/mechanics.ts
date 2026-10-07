import type {
  ConflictId,
  InfluencePressure,
  InfluenceTerm,
  NationId,
  WorldCommand,
  WorldState,
} from '@mandate/schemas';
import {
  Crisis,
  CrisisId,
  Negotiation,
  Sanction,
  TreatyBreach,
  TreatyEnforcement,
} from '@mandate/schemas';
import {
  relationshipEffect,
  validateInfluencePressure,
  validateObligations,
  validateInfluenceTerms,
} from './depth.js';
import { requireDomain } from './errors.js';

const clamp = (n: number) => Math.max(0, Math.min(100, n));
type CanonicalOrganization = WorldState['organizations'][number];
function requireForeignPolicyConsent(
  world: WorldState,
  subjectNationId: NationId,
  counterpartNationId: NationId,
  agreementKind: string,
  proposedInfluenceTerms: readonly InfluenceTerm[] = [],
) {
  const activeTerms = world.treaties
    .filter(
      (treaty) => treaty.status === 'active' && treaty.kind === 'influence',
    )
    .flatMap((treaty) => treaty.influenceTerms)
    .filter((term) => term.status === 'active');
  if (agreementKind !== 'consultation') {
    const veto = activeTerms.find(
      (term) =>
        term.kind === 'foreign-policy-veto' &&
        term.subjectNationId === subjectNationId,
    );
    if (veto && veto.patronNationId !== counterpartNationId)
      requireDomain(
        false,
        'A binding foreign-policy veto requires the patron to approve or join the agreement',
      );
  }
  const economicArrangement =
    agreementKind === 'trade' ||
    (agreementKind === 'influence' &&
      proposedInfluenceTerms.some((term) =>
        [
          'preferential-trade',
          'market-access-concession',
          'energy-supply',
          'exclusive-market-access',
          'customs-alignment',
          'common-economic-rules',
          'mandatory-procurement',
          'debt-repayment',
          'loan',
          'debt-relief',
          'subsidy',
          'infrastructure-investment',
          'tribute',
        ].includes(term.kind),
      ));
  if (!economicArrangement) return;
  const approval = activeTerms.find(
    (term) =>
      term.kind === 'economic-policy-approval' &&
      term.subjectNationId === subjectNationId,
  );
  if (approval && approval.patronNationId !== counterpartNationId)
    requireDomain(
      false,
      'A binding economic-policy approval term requires the patron to approve or join the agreement',
    );
}

function organizationHistory(
  organization: CanonicalOrganization,
  date: string,
  actorNationId: NationId | null,
  kind: CanonicalOrganization['history'][number]['kind'],
  description: string,
  provenance: {
    originatingActionId?: CanonicalOrganization['programs'][number]['originatingActionId'];
    organizationCommitmentId?: CanonicalOrganization['commitments'][number]['id'];
    organizationProgramId?: CanonicalOrganization['programs'][number]['id'];
  } = {},
) {
  const previousSequence = Number(
    organization.history.at(-1)?.id.split('-').at(-1) ?? -1,
  );
  organization.history = [
    ...organization.history,
    {
      id: `${organization.id}-${date}-${previousSequence + 1}`,
      date,
      actorNationId,
      kind,
      description: description.slice(0, 4000),
      ...(provenance.originatingActionId
        ? { originatingActionId: provenance.originatingActionId }
        : {}),
      ...(provenance.organizationCommitmentId
        ? { organizationCommitmentId: provenance.organizationCommitmentId }
        : {}),
      ...(provenance.organizationProgramId
        ? { organizationProgramId: provenance.organizationProgramId }
        : {}),
    },
  ].slice(-200);
}
function organizationFoundingAuthority(
  organization: CanonicalOrganization,
  nationId: NationId,
) {
  return organization.founders.includes(nationId);
}
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
      requireForeignPolicyConsent(
        w,
        n.proposerNationId,
        n.recipientNationId,
        n.kind,
        n.influenceTerms,
      );
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
      validateInfluenceTerms(w, n);
      validateInfluencePressure(w, n);
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
      if (c.move === 'accept')
        requireForeignPolicyConsent(
          w,
          c.nationId,
          c.nationId === n.proposerNationId
            ? n.recipientNationId
            : n.proposerNationId,
          n.kind,
          n.influenceTerms,
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
        c.counterInfluenceTerms === undefined || c.move === 'counter',
        'Only counteroffers can revise influence terms',
      );
      requireDomain(
        c.counterPeaceTerms === undefined || c.move === 'counter',
        'Only counters can revise peace terms',
      );
      if (c.move === 'accept') {
        validateSettlementOffer(w, n);
        validateObligations(w, n);
        validateInfluenceTerms(w, n);
      }
      const oldTerms = n.terms;
      const oldObligations = structuredClone(n.obligations);
      n.responses.push({
        nationId: c.nationId,
        date: w.date,
        move: c.move,
        message: c.message,
        offeredTerms: oldTerms,
        ...(c.counterTerms ? { counterTerms: c.counterTerms } : {}),
        ...(c.influenceDecision
          ? { influenceDecision: structuredClone(c.influenceDecision) }
          : {}),
        obligations: oldObligations,
        influenceTerms: structuredClone(n.influenceTerms),
        ...(c.counterInfluenceTerms
          ? { counterInfluenceTerms: structuredClone(c.counterInfluenceTerms) }
          : {}),
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
        const existingInfluenceTreaty =
          n.kind === 'influence'
            ? w.treaties.find(
                (entry) =>
                  entry.status === 'active' &&
                  entry.kind === 'influence' &&
                  [entry.parties[0], entry.parties[1]].sort().join() ===
                    [n.proposerNationId, n.recipientNationId].sort().join(),
              )
            : undefined;
        requireDomain(
          existingInfluenceTreaty
            ? c.treatyId === existingInfluenceTreaty.id
            : !w.treaties.some((v) => v.id === c.treatyId),
          existingInfluenceTreaty
            ? 'Influence amendment must reference the active bilateral treaty'
            : 'Treaty ID reused',
        );
        if (existingInfluenceTreaty) {
          const signature = (term: (typeof n.influenceTerms)[number]) =>
            [
              term.kind,
              term.patronNationId,
              term.subjectNationId,
              term.amount,
              term.ratePercent,
            ].join(':');
          const existingSignatures = new Set(
            existingInfluenceTreaty.influenceTerms.map(signature),
          );
          requireDomain(
            n.influenceTerms.every(
              (term) => !existingSignatures.has(signature(term)),
            ),
            'Influence amendment repeats an existing obligation',
          );
          existingInfluenceTreaty.influenceTerms.push(
            ...structuredClone(n.influenceTerms),
          );
          existingInfluenceTreaty.terms =
            `${existingInfluenceTreaty.terms}; ${n.terms}`.slice(0, 4000);
          n.treatyId = existingInfluenceTreaty.id;
        } else {
          w.treaties.push({
            id: c.treatyId!,
            name: n.topic,
            ratifiedDate: w.date,
            kind: n.kind,
            parties: [n.proposerNationId, n.recipientNationId],
            status: 'active',
            terms: n.terms,
            visibility: n.visibility,
            conflictId: n.conflictId,
            influenceTerms: structuredClone(n.influenceTerms),
            directives: [],
            breaches: [],
            enforcements: [],
            ratificationGovernments:
              n.kind === 'influence'
                ? [n.proposerNationId, n.recipientNationId].map((nationId) => ({
                    nationId,
                    government: structuredClone(nation(nationId).government),
                  }))
                : [],
          });
          n.treatyId = c.treatyId!;
        }
        if (n.sourceBreachId) {
          const amendedTreaty = w.treaties.find(
            (candidate) => candidate.id === n.treatyId,
          );
          const breach = amendedTreaty?.breaches.find(
            (candidate) => candidate.id === n.sourceBreachId,
          );
          requireDomain(
            amendedTreaty?.kind === 'influence' && breach,
            'Breach renegotiation must refer to its active influence episode',
          );
          const obligationIndex = breach.obligationKey
            ? /-term-(\d+)$/.exec(breach.obligationKey)?.[1]
            : undefined;
          if (obligationIndex !== undefined) {
            const defaultedTerm =
              amendedTreaty.influenceTerms[Number(obligationIndex)];
            if (defaultedTerm) defaultedTerm.status = 'suspended';
          }
          resolveInfluenceBreach(
            w,
            amendedTreaty,
            breach,
            'Bilateral renegotiation amended the influence agreement.',
            'renegotiated',
          );
        }
        const backlashWeight: Partial<Record<InfluenceTerm['kind'], number>> = {
          'join-defensive-wars': 12,
          'join-patron-wars': 25,
          'war-declaration-approval': 22,
          'no-war-against-patron': 10,
          'military-access': 6,
          'host-bases': 16,
          'military-planning': 8,
          'foreign-policy-consultation': 8,
          'foreign-policy-alignment': 25,
          'no-rival-alliance': 20,
          'support-diplomatic-initiatives': 10,
          'foreign-policy-veto': 40,
          'economic-policy-approval': 18,
          tribute: 12,
          'exclusive-market-access': 18,
          'customs-alignment': 8,
          'mandatory-procurement': 10,
          'government-security-arrangement': 20,
        };
        const backlashBySubject = new Map<NationId, number>();
        for (const term of n.influenceTerms) {
          const weight = backlashWeight[term.kind] ?? 0;
          if (weight)
            backlashBySubject.set(
              term.subjectNationId,
              (backlashBySubject.get(term.subjectNationId) ?? 0) + weight,
            );
          if (term.kind !== 'loan' && term.kind !== 'debt-relief') continue;
          const patron = w.nations.find(
            (nation) => nation.id === term.patronNationId,
          )!;
          const subject = w.nations.find(
            (nation) => nation.id === term.subjectNationId,
          )!;
          const amount =
            term.kind === 'debt-relief'
              ? Math.min(term.amount, subject.stats.debt)
              : term.amount;
          requireDomain(
            patron.stats.treasury >= amount,
            'Patron cannot finance the agreed one-time transfer',
          );
          patron.stats.treasury -= amount;
          if (term.kind === 'loan') {
            subject.stats.treasury = Math.min(
              1_000_000_000,
              subject.stats.treasury + amount,
            );
            subject.stats.debt = Math.min(
              1_000_000_000,
              subject.stats.debt + amount,
            );
          } else {
            subject.stats.debt -= amount;
          }
        }
        for (const [subjectNationId, weight] of backlashBySubject) {
          const subject = w.nations.find(
            (nation) => nation.id === subjectNationId,
          )!;
          const domesticMultiplier =
            0.6 + (subject.stats.stability + subject.stats.legitimacy) / 200;
          subject.stats.unrest = clamp(
            subject.stats.unrest +
              Math.floor((weight * domesticMultiplier) / 40),
          );
          subject.stats.legitimacy = clamp(
            subject.stats.legitimacy -
              Math.floor((weight * domesticMultiplier) / 60),
          );
        }
        n.status = 'accepted';
        const acceptedTreaty = n.treatyId
          ? w.treaties.find((candidate) => candidate.id === n.treatyId)
          : undefined;
        const entersSecurityPact = Boolean(
          acceptedTreaty &&
          (acceptedTreaty.kind === 'defense' ||
            acceptedTreaty.influenceTerms.some((term) =>
              ['security-guarantee', 'join-defensive-wars'].includes(term.kind),
            )),
        );
        if (acceptedTreaty && entersSecurityPact)
          for (const priorTreaty of w.treaties) {
            if (
              priorTreaty.id === acceptedTreaty.id ||
              priorTreaty.status !== 'active' ||
              priorTreaty.kind !== 'influence'
            )
              continue;
            for (const term of priorTreaty.influenceTerms)
              if (
                term.status === 'active' &&
                term.kind === 'no-rival-alliance' &&
                acceptedTreaty.parties.includes(term.subjectNationId) &&
                !acceptedTreaty.parties.includes(term.patronNationId)
              )
                recordInfluenceBreach(
                  w,
                  term.patronNationId,
                  term.subjectNationId,
                  `Accepted rival security agreement ${acceptedTreaty.name} despite a binding alliance restriction`,
                  term.subjectNationId,
                  priorTreaty.id,
                );
          }
        if (
          n.conditionalPressure?.condition === 'rejection' &&
          n.conditionalPressure.status === 'pending'
        )
          n.conditionalPressure.status = 'satisfied';
        if (
          n.kind === 'defense' ||
          (n.kind === 'influence' &&
            n.influenceTerms.some((term) =>
              ['security-guarantee', 'join-defensive-wars'].includes(term.kind),
            ))
        )
          triggerConditionalInfluencePressure(
            w,
            c.nationId,
            'accepts-rival-security',
            n.proposerNationId,
          );
        if (n.kind === 'ceasefire')
          w.conflicts.find((v) => v.id === n.conflictId)!.settlementState =
            'ceasefire';
        if (n.kind === 'peace') {
          for (const term of n.peaceTerms) {
            const r = w.regions.find((r) => r.id === term.regionId)!;
            if (term.kind === 'territorial-transfer') {
              r.ownerNationId = term.toNationId;
              r.controllerNationId = term.toNationId;
            } else if (term.kind === 'withdrawal')
              r.controllerNationId = term.toNationId;
            else if (!r.recognizedClaims.includes(term.toNationId))
              r.recognizedClaims.push(term.toNationId);
          }
          w.treaties.find((t) => t.id === n.treatyId)!.terms = n.peaceTerms
            .length
            ? `Peace settlement: hostilities cease. Agreed terms: ${n.peaceTerms
                .map((t) => {
                  const regionName = w.regions.find(
                    (r) => r.id === t.regionId,
                  )!.name;
                  return t.kind === 'recognize-claim'
                    ? `${t.fromNationId} recognizes ${t.toNationId}'s claim to ${regionName}`
                    : `${t.kind} ${regionName} from ${t.fromNationId} to ${t.toNationId}`;
                })
                .join(
                  '; ',
                )}${n.obligations.length ? `; ${n.obligations.length} structured economic/security obligation(s)` : ''}`
            : 'Peace settlement: hostilities cease. Current military control is retained; legal ownership is unchanged.';
          endConflict(w, n.conflictId!, n.id);
        }
      } else if (c.move === 'reject') {
        n.status = 'rejected';
        if (
          n.conditionalPressure?.condition === 'rejection' &&
          n.conditionalPressure.status === 'pending'
        )
          applyConditionalPressure(w, n);
      } else if (c.move === 'withdraw') n.status = 'withdrawn';
      else if (c.move === 'counter') {
        n.initialTerms ??= oldTerms;
        n.terms = c.counterTerms!;
        n.obligations = c.counterObligations ?? [];
        n.influenceTerms = c.counterInfluenceTerms ?? [];
        n.conditionalPressure = null;
        n.peaceTerms = c.counterPeaceTerms ?? [];
        validateSettlementOffer(w, n);
        validateObligations(w, n);
        validateInfluenceTerms(w, n);
        n.expiresDate = new Date(Date.parse(w.date) + 180 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        [n.proposerNationId, n.recipientNationId] = [
          n.recipientNationId,
          n.proposerNationId,
        ];
      }
      return true;
    }
    case 'ISSUE_PATRON_DIRECTIVE': {
      const treaty = w.treaties.find(
        (candidate) => candidate.id === c.treatyId,
      );
      requireDomain(
        treaty?.status === 'active',
        'Directive requires an active treaty',
      );
      nation(c.patronNationId);
      nation(c.subjectNationId);
      requireDomain(
        c.patronNationId !== c.subjectNationId &&
          treaty.parties.includes(c.patronNationId) &&
          treaty.parties.includes(c.subjectNationId),
        'Directive parties must belong to the treaty',
      );
      requireDomain(
        !treaty.directives.some((directive) => directive.id === c.directiveId),
        'Directive ID reused',
      );
      const terms = treaty.influenceTerms.filter(
        (term) =>
          term.patronNationId === c.patronNationId &&
          term.subjectNationId === c.subjectNationId &&
          term.status === 'active',
      );
      let status: WorldState['treaties'][number]['directives'][number]['status'];
      let reason: string;
      if (c.kind === 'join-conflict') {
        const conflict = c.conflictId
          ? w.conflicts.find(
              (candidate) =>
                candidate.id === c.conflictId && candidate.status === 'active',
            )
          : undefined;
        const patronAttacking = Boolean(
          conflict?.attackers.includes(c.patronNationId),
        );
        const patronDefending = Boolean(
          conflict?.defenders.includes(c.patronNationId),
        );
        const authority = terms.some(
          (term) =>
            term.kind === 'join-patron-wars' ||
            (term.kind === 'join-defensive-wars' && patronDefending),
        );
        if (!conflict || (!patronAttacking && !patronDefending)) {
          status = 'failed';
          reason = 'The named active conflict does not include the patron.';
        } else if (!authority) {
          status = terms.some(
            (term) => term.kind === 'foreign-policy-consultation',
          )
            ? 'consultation-only'
            : 'unauthorized';
          reason =
            status === 'consultation-only'
              ? 'The treaty requires consultation but does not require joining this war.'
              : 'The treaty does not bind the subject to this war.';
        } else {
          const patronSide = patronAttacking
            ? conflict.attackers
            : conflict.defenders;
          const oppositeSide = patronAttacking
            ? conflict.defenders
            : conflict.attackers;
          if (oppositeSide.includes(c.subjectNationId)) {
            status = 'failed';
            reason = 'The subject is already fighting on the opposing side.';
          } else {
            if (!patronSide.includes(c.subjectNationId))
              patronSide.push(c.subjectNationId);
            status = 'complied';
            reason =
              'The subject joined the patron under a binding defense obligation.';
            const subject = nation(c.subjectNationId);
            subject.stats.unrest = clamp(subject.stats.unrest + 2);
            subject.stats.legitimacy = clamp(subject.stats.legitimacy - 1);
          }
        }
      } else if (c.kind === 'grant-military-access') {
        const authority = terms.some(
          (term) =>
            term.kind === 'military-access' || term.kind === 'host-bases',
        );
        status = authority
          ? 'complied'
          : terms.some((term) => term.kind === 'foreign-policy-consultation')
            ? 'consultation-only'
            : 'unauthorized';
        reason = authority
          ? 'The subject confirmed military access under its binding treaty obligation.'
          : status === 'consultation-only'
            ? 'Consultation rights do not grant military access.'
            : 'No active treaty term grants military access or basing rights.';
      } else if (c.kind === 'leave-organization') {
        const organization = c.organizationId
          ? w.organizations.find(
              (candidate) =>
                candidate.id === c.organizationId &&
                candidate.status === 'active',
            )
          : undefined;
        const authority = terms.some(
          (term) => term.kind === 'no-rival-alliance',
        );
        if (!organization?.members.includes(c.subjectNationId)) {
          status = 'failed';
          reason = 'The subject is not a member of the named organization.';
        } else if (organization.members.includes(c.patronNationId)) {
          status = 'failed';
          reason =
            'The named organization is not a rival bloc because the patron is also a member.';
        } else if (!authority) {
          status = terms.some(
            (term) => term.kind === 'foreign-policy-consultation',
          )
            ? 'consultation-only'
            : 'unauthorized';
          reason =
            status === 'consultation-only'
              ? 'Consultation rights do not grant a veto over alliance membership.'
              : 'The treaty does not restrict the subject’s alliance choice.';
        } else {
          organization.members = organization.members.filter(
            (id) => id !== c.subjectNationId,
          );
          organizationHistory(
            organization,
            w.date,
            c.subjectNationId,
            'member-left',
            `${nation(c.subjectNationId).name} left ${organization.acronym ?? organization.name} under a binding treaty directive.`,
          );
          status = 'complied';
          reason =
            'The subject left the rival organization under a binding treaty term.';
          const subject = nation(c.subjectNationId);
          subject.stats.unrest = clamp(subject.stats.unrest + 2);
          subject.stats.legitimacy = clamp(subject.stats.legitimacy - 1);
        }
      } else if (c.kind === 'end-rival-treaty') {
        const rivalTreaty = c.targetTreatyId
          ? w.treaties.find(
              (candidate) =>
                candidate.id === c.targetTreatyId &&
                candidate.status === 'active',
            )
          : undefined;
        const authority = terms.some(
          (term) => term.kind === 'no-rival-alliance',
        );
        if (
          !rivalTreaty ||
          rivalTreaty.kind !== 'defense' ||
          !rivalTreaty.parties.includes(c.subjectNationId)
        ) {
          status = 'failed';
          reason =
            'The named active defense treaty is not held by the subject.';
        } else if (rivalTreaty.parties.includes(c.patronNationId)) {
          status = 'failed';
          reason =
            'The patron cannot use this directive to end their own treaty with the subject.';
        } else if (!authority) {
          status = terms.some(
            (term) => term.kind === 'foreign-policy-consultation',
          )
            ? 'consultation-only'
            : 'unauthorized';
          reason =
            status === 'consultation-only'
              ? 'Consultation rights do not grant authority to end an alliance.'
              : 'The treaty does not restrict the subject’s alliance choice.';
        } else {
          rivalTreaty.status = 'ended';
          status = 'complied';
          reason =
            'The subject ended its rival defense treaty under a binding alliance restriction.';
          const subject = nation(c.subjectNationId);
          subject.stats.unrest = clamp(subject.stats.unrest + 2);
          subject.stats.legitimacy = clamp(subject.stats.legitimacy - 1);
        }
      } else if (c.kind === 'support-diplomatic-initiative') {
        const authority = terms.some(
          (term) =>
            term.kind === 'support-diplomatic-initiatives' ||
            term.kind === 'foreign-policy-alignment',
        );
        status = authority
          ? 'complied'
          : terms.some((term) => term.kind === 'foreign-policy-consultation')
            ? 'consultation-only'
            : 'unauthorized';
        reason = authority
          ? `The subject’s support was recorded under the agreed diplomatic support or foreign-policy alignment term${c.policyText ? `: ${c.policyText}` : '.'}`
          : status === 'consultation-only'
            ? 'The treaty provides consultation, not a binding vote or support obligation.'
            : 'No active treaty term requires diplomatic support.';
      } else {
        const binding = terms.some((term) =>
          ['foreign-policy-alignment', 'foreign-policy-veto'].includes(
            term.kind,
          ),
        );
        status =
          binding && c.policyText
            ? 'complied'
            : terms.some(
                  (term) => term.kind === 'foreign-policy-consultation',
                ) || binding
              ? 'consultation-only'
              : 'unauthorized';
        reason = binding
          ? c.policyText
            ? `The subject recorded compliance with the binding foreign-policy alignment term: ${c.policyText}`
            : 'Policy coordination authority exists, but no specific foreign-policy decision was attached to this directive.'
          : status === 'consultation-only'
            ? 'The subject must consult; this term does not transfer decision authority.'
            : 'No active treaty term grants foreign-policy direction authority.';
      }
      treaty.directives.push({
        id: c.directiveId,
        patronNationId: c.patronNationId,
        subjectNationId: c.subjectNationId,
        kind: c.kind,
        conflictId: c.conflictId ?? null,
        organizationId: c.organizationId ?? null,
        targetTreatyId: c.targetTreatyId ?? null,
        policyText: c.policyText ?? null,
        issuedDate: w.date,
        status,
        reason,
      });
      if (status === 'unauthorized' || status === 'failed')
        relationshipEffect(
          w,
          c.patronNationId,
          c.subjectNationId,
          -2,
          -3,
          `Unauthorized patron directive: ${reason}`,
        );
      return true;
    }
    case 'ENFORCE_TREATY_BREACH': {
      const treaty = w.treaties.find(
        (candidate) =>
          candidate.id === c.treatyId &&
          candidate.status === 'active' &&
          candidate.kind === 'influence',
      );
      requireDomain(treaty, 'Enforcement requires an active influence treaty');
      const breach = treaty.breaches.find(
        (candidate) =>
          candidate.id === c.breachId &&
          candidate.status !== 'resolved' &&
          [candidate.violatingNationId, candidate.injuredNationId].includes(
            c.patronNationId,
          ) &&
          [candidate.violatingNationId, candidate.injuredNationId].includes(
            c.subjectNationId,
          ),
      );
      requireDomain(
        breach,
        'Enforcement requires an active breach between these treaty parties',
      );
      requireDomain(
        treaty.parties.includes(c.patronNationId) &&
          treaty.parties.includes(c.subjectNationId),
        'Enforcement parties must belong to the treaty',
      );
      const actingNationId = c.actingNationId ?? c.patronNationId;
      requireDomain(
        actingNationId === breach.injuredNationId,
        'Only the government injured by this breach may enforce it',
      );
      const patron = nation(c.patronNationId);
      const subject = nation(c.subjectNationId);
      const terms = treaty.influenceTerms.filter(
        (term) =>
          term.status === 'active' &&
          term.patronNationId === c.patronNationId &&
          term.subjectNationId === c.subjectNationId,
      );
      const action = c.action;
      let result: string;
      if (action === 'diplomatic-demand') {
        const crisis = w.crises.find(
          (candidate) =>
            candidate.type === 'commitment' &&
            candidate.demands.some(
              (demand) =>
                demand.condition.kind === 'treaty-breach' &&
                demand.condition.treatyId === treaty.id &&
                demand.condition.breachId === breach.id,
            ),
        );
        if (crisis) {
          const demand = crisis.demands.find(
            (candidate) => candidate.nationId === breach.violatingNationId,
          );
          if (demand)
            demand.text = `Formal demand: cure this breach and comply with ${treaty.name}.`;
          crisis.status = 'active';
          crisis.rhetoric = clamp(crisis.rhetoric + 5);
          crisis.diplomaticBreakdown = clamp(crisis.diplomaticBreakdown + 2);
          crisis.severity = Math.round(
            crisis.militaryPosture * 0.5 +
              crisis.rhetoric * 0.2 +
              crisis.diplomaticBreakdown * 0.3,
          );
        }
        result =
          'Formal diplomatic demand issued; the breach remains active pending compliance.';
        breach.status = 'enforced';
        if (!breach.milestones.some((entry) => entry.key === 'demanded'))
          breach.milestones.push({ key: 'demanded', date: w.date });
      } else if (action === 'suspend-subsidy') {
        const support = terms.filter((term) => term.kind === 'subsidy');
        requireDomain(
          support.length > 0,
          'No active patron subsidy can be suspended',
        );
        for (const term of support) term.status = 'suspended';
        result =
          'Patron subsidies suspended as pressure; the patron promise is recorded as a new grievance.';
        breach.status = 'enforced';
        recordInfluenceBreach(
          w,
          c.patronNationId,
          c.subjectNationId,
          'Suspended promised subsidies as enforcement pressure',
          c.patronNationId,
          treaty.id,
        );
      } else if (action === 'cancel-market-access') {
        const access = terms.filter((term) =>
          [
            'preferential-trade',
            'market-access-concession',
            'exclusive-market-access',
            'customs-alignment',
            'common-economic-rules',
            'mandatory-procurement',
          ].includes(term.kind),
        );
        requireDomain(
          access.length > 0,
          'No active market-access term can be cancelled',
        );
        for (const term of access) term.status = 'withdrawn';
        const link = w.economicLinks.find(
          (entry) =>
            entry.dependentNationId === c.subjectNationId &&
            entry.partnerNationId === c.patronNationId,
        );
        if (link) {
          link.imports = clamp(link.imports - 10);
          link.exports = clamp(link.exports - 10);
          link.alternatives = clamp(link.alternatives + 5);
        }
        result =
          'Preferential market access withdrawn; the patron promise is recorded as a new grievance.';
        breach.status = 'enforced';
        recordInfluenceBreach(
          w,
          c.patronNationId,
          c.subjectNationId,
          'Cancelled promised market access as enforcement pressure',
          c.patronNationId,
          treaty.id,
        );
      } else if (action === 'demand-arrears') {
        let collected = 0;
        const patronDefault = breach.violatingNationId === c.patronNationId;
        const arrearTerms = treaty.influenceTerms.filter((term) =>
          patronDefault
            ? term.patronNationId === c.patronNationId &&
              term.subjectNationId === c.subjectNationId &&
              ['subsidy', 'infrastructure-investment'].includes(term.kind) &&
              term.arrears > 0
            : term.patronNationId === c.patronNationId &&
              term.subjectNationId === c.subjectNationId &&
              ['tribute', 'debt-repayment'].includes(term.kind) &&
              term.arrears > 0,
        );
        requireDomain(
          arrearTerms.length > 0,
          'No collectible missed treaty installments remain',
        );
        for (const term of arrearTerms) {
          const monthly = patronDefault
            ? term.amount
            : term.kind === 'tribute'
              ? Math.max(
                  0,
                  Math.floor(
                    (subject.stats.economy + subject.stats.fiscal) / 25,
                  ) *
                    (term.ratePercent / 100),
                )
              : term.amount;
          const payer = patronDefault ? patron : subject;
          const receiver = patronDefault ? subject : patron;
          while (
            term.arrears > 0 &&
            monthly > 0 &&
            payer.stats.treasury >= monthly &&
            (c.amount === undefined || c.amount === 0 || collected < c.amount)
          ) {
            const payment =
              c.amount && c.amount > 0
                ? Math.min(monthly, c.amount - collected)
                : monthly;
            if (payment < monthly) break;
            payer.stats.treasury -= payment;
            receiver.stats.treasury = Math.min(
              1_000_000_000,
              receiver.stats.treasury + payment,
            );
            term.arrears -= 1;
            term.paidAmount += payment;
            term.paymentsMade += 1;
            collected += payment;
            breach.arrearsAmount = Math.max(0, breach.arrearsAmount - payment);
          }
        }
        result = collected
          ? `Collected ${collected} treasury units against treaty arrears.`
          : `Arrears were formally demanded, but ${nation(breach.violatingNationId).name} could not pay a full installment.`;
        if (arrearTerms.every((term) => term.arrears === 0))
          resolveInfluenceBreach(
            w,
            treaty,
            breach,
            'All collected treaty arrears were paid.',
          );
      } else if (action === 'political-pressure') {
        const violator = nation(breach.violatingNationId);
        violator.stats.legitimacy = clamp(violator.stats.legitimacy - 2);
        violator.stats.unrest = clamp(violator.stats.unrest + 2);
        result =
          'Political pressure applied; domestic legitimacy and stability costs recorded.';
        breach.status = 'enforced';
      } else if (action === 'withdraw-guarantee') {
        const guarantees = terms.filter(
          (term) => term.kind === 'security-guarantee',
        );
        requireDomain(
          guarantees.length > 0,
          'No active patron guarantee can be withdrawn',
        );
        for (const term of guarantees) term.status = 'withdrawn';
        result =
          'Security guarantee withdrawn; the patron promise is recorded as a new grievance.';
        breach.status = 'enforced';
        recordInfluenceBreach(
          w,
          c.patronNationId,
          c.subjectNationId,
          'Withdrew a promised security guarantee as enforcement pressure',
          c.patronNationId,
          treaty.id,
        );
      } else if (action === 'sanction') {
        const injured = nation(actingNationId);
        const violator = nation(breach.violatingNationId);
        const existingSanction = w.sanctions.find(
          (sanction) =>
            sanction.issuer === actingNationId &&
            sanction.target === breach.violatingNationId &&
            sanction.sector === 'trade' &&
            sanction.status === 'active',
        );
        if (existingSanction)
          existingSanction.intensity = clamp(existingSanction.intensity + 10);
        else
          w.sanctions.push(
            Sanction.parse({
              id: `sanction:breach-${treaty.id.slice(7)}-${w.date}-${w.revision}`,
              issuer: actingNationId,
              target: breach.violatingNationId,
              sector: 'trade',
              intensity: 25,
              startDate: w.date,
              reason: `Enforcement for treaty breach: ${breach.reason}`,
            }),
          );
        violator.stats.economy = clamp(violator.stats.economy - 1);
        void injured;
        result = 'Trade sanctions imposed for the recorded treaty breach.';
        breach.status = 'enforced';
      } else if (action === 'renegotiate') {
        const existingRenegotiation = w.negotiations.find(
          (negotiation) =>
            negotiation.status === 'open' &&
            negotiation.sourceBreachId === breach.id,
        );
        if (!existingRenegotiation) {
          const negotiation = Negotiation.parse({
            id: `negotiation:breach-${breach.id.slice(7)}-${w.revision}-${w.negotiations.length}`,
            proposerNationId: actingNationId,
            recipientNationId: breach.violatingNationId,
            topic: `Breach settlement: ${treaty.name}`,
            kind: 'influence',
            terms:
              c.terms ??
              `Renegotiate ${treaty.name} to cure this breach, compensate the injured party, or suspend terms that have become unsustainable.`,
            createdDate: w.date,
            expiresDate: new Date(Date.parse(w.date) + 180 * 86_400_000)
              .toISOString()
              .slice(0, 10),
            sourceBreachId: breach.id,
            influenceTerms: c.influenceTerms ?? [],
          });
          validateInfluenceTerms(w, negotiation);
          w.negotiations.push(negotiation);
        }
        breach.status = 'enforced';
        result =
          'Bilateral renegotiation opened; the breach remains active until the injured party accepts and the terms are amended.';
      } else if (action === 'suspend-reciprocals') {
        const reciprocal = treaty.influenceTerms.filter(
          (term) =>
            term.status === 'active' &&
            term.patronNationId === c.subjectNationId &&
            term.subjectNationId === c.patronNationId,
        );
        requireDomain(
          reciprocal.length > 0,
          'No reciprocal subject obligations can be suspended',
        );
        for (const term of reciprocal) term.status = 'suspended';
        breach.status = 'enforced';
        if (!breach.milestones.some((entry) => entry.key === 'suspended'))
          breach.milestones.push({ key: 'suspended', date: w.date });
        result =
          'Reciprocal obligations suspended until the patron cures or renegotiates its breach.';
      } else if (action === 'waive') {
        resolveInfluenceBreach(
          w,
          treaty,
          breach,
          `${nation(actingNationId).name} waived the outstanding breach.`,
        );
        result =
          'The injured government waived this breach and closed its crisis demand.';
      } else {
        treaty.status = 'ended';
        for (const openBreach of treaty.breaches)
          if (openBreach.status !== 'resolved')
            resolveInfluenceBreach(
              w,
              treaty,
              openBreach,
              'The parties terminated the influence treaty; its active obligations no longer apply.',
            );
        result =
          'The influence treaty was terminated; its open breach crises were resolved by ending the obligations.';
      }
      if (
        ![
          'suspend-subsidy',
          'cancel-market-access',
          'withdraw-guarantee',
          'waive',
          'suspend-reciprocals',
        ].includes(action)
      )
        relationshipEffect(
          w,
          c.patronNationId,
          c.subjectNationId,
          -3,
          -5,
          `${nation(actingNationId).name} enforcement action: ${action}`,
          treaty.visibility,
        );
      treaty.enforcements = [
        ...treaty.enforcements,
        TreatyEnforcement.parse({
          id: c.enforcementId,
          date: w.date,
          breachId: c.breachId,
          patronNationId: c.patronNationId,
          subjectNationId: c.subjectNationId,
          actingNationId,
          action,
          amount: c.amount ?? 0,
          result,
        }),
      ].slice(-200);
      return true;
    }
    case 'CREATE_ORGANIZATION':
      requireDomain(
        !w.organizations.some((v) => v.id === c.organization.id),
        'Organization ID reused',
      );
      c.organization.members.forEach(nation);
      c.organization.founders.forEach(nation);
      requireDomain(
        new Set(c.organization.members).size === c.organization.members.length,
        'Organization members must be unique',
      );
      requireDomain(
        c.organization.foundingDate === w.date &&
          c.organization.status === 'active' &&
          c.organization.founders.length > 0 &&
          c.organization.founders.every((id) =>
            c.organization.members.includes(id),
          ),
        'A new organization requires current founding date and founder members',
      );
      requireDomain(
        new Set(c.organization.founders).size ===
          c.organization.founders.length,
        'Organization founders must be unique',
      );
      organizationHistory(
        c.organization,
        w.date,
        c.organization.founders[0]!,
        'founded',
        `${nation(c.organization.founders[0]!).name} founded ${c.organization.name}. ${c.organization.purpose}`,
      );
      w.organizations.push(structuredClone(c.organization));
      return true;
    case 'SET_ORGANIZATION_MEMBERSHIP': {
      nation(c.nationId);
      const o = w.organizations.find((v) => v.id === c.organizationId);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        o.members.includes(c.nationId) !== c.member,
        'Membership unchanged',
      );
      if (c.member) {
        requireDomain(
          o.invitations.some(
            (invitation) =>
              invitation.nationId === c.nationId &&
              invitation.status === 'accepted',
          ),
          'Organization membership requires an accepted invitation',
        );
        for (const treaty of w.treaties.filter(
          (entry) => entry.status === 'active',
        ))
          for (const term of treaty.influenceTerms)
            if (
              term.subjectNationId === c.nationId &&
              term.status === 'active' &&
              term.kind === 'no-rival-alliance' &&
              !o.members.includes(term.patronNationId)
            )
              recordInfluenceBreach(
                w,
                term.patronNationId,
                c.nationId,
                `Joined rival organization ${o.acronym ?? o.name} despite a binding alliance restriction`,
              );
        o.members.push(c.nationId);
        triggerConditionalInfluencePressure(
          w,
          c.nationId,
          'joins-rival-alliance',
          undefined,
          o,
        );
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'member-joined',
          `${nation(c.nationId).name} joined ${o.name}.`,
        );
      } else {
        o.members = o.members.filter((id) => id !== c.nationId);
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'member-left',
          `${nation(c.nationId).name} left ${o.name}.`,
        );
        if (!o.members.length) {
          o.status = 'dissolved';
          o.dissolvedDate = w.date;
          for (const commitment of o.commitments)
            if (commitment.status === 'active') commitment.status = 'withdrawn';
          organizationHistory(
            o,
            w.date,
            c.nationId,
            'dissolved',
            `${o.name} ceased to operate after its final member withdrew.`,
          );
        }
      }
      return true;
    }
    case 'INVITE_TO_ORGANIZATION': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      nation(c.inviterNationId);
      nation(c.nationId);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        organizationFoundingAuthority(o, c.inviterNationId) ||
          o.members.includes(c.inviterNationId),
        'Only a member government can issue an organization invitation',
      );
      requireDomain(
        c.nationId !== c.inviterNationId && !o.members.includes(c.nationId),
        'An organization cannot invite a current member or itself',
      );
      const existing = o.invitations.find(
        (invitation) => invitation.nationId === c.nationId,
      );
      requireDomain(
        !existing ||
          existing.status !== 'pending' ||
          existing.lastMove === 'counter',
        'An invitation is already pending or has been accepted',
      );
      if (existing) {
        existing.invitedDate = w.date;
        existing.updatedDate = w.date;
        existing.status = 'pending';
        existing.lastMove = null;
        existing.message = null;
        existing.counterTerms = null;
      } else
        o.invitations.push({
          nationId: c.nationId,
          invitedDate: w.date,
          updatedDate: w.date,
          status: 'pending',
          lastMove: null,
          message: null,
          counterTerms: null,
        });
      if (!o.invitedStates.includes(c.nationId))
        o.invitedStates.push(c.nationId);
      o.pendingApplications = o.pendingApplications.filter(
        (application) =>
          application.nationId !== c.nationId ||
          application.status !== 'pending',
      );
      organizationHistory(
        o,
        w.date,
        c.inviterNationId,
        'invited',
        `${nation(c.inviterNationId).name} invited ${nation(c.nationId).name} to ${o.name}.`,
      );
      return true;
    }
    case 'RESPOND_ORGANIZATION_INVITATION': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      const invitation = o?.invitations.find(
        (candidate) => candidate.nationId === c.nationId,
      );
      nation(c.nationId);
      requireDomain(
        o?.status === 'active' && invitation,
        'No organization invitation',
      );
      requireDomain(
        invitation.status === 'pending' && invitation.lastMove !== 'counter',
        'No pending organization invitation awaits this government',
      );
      requireDomain(
        c.move === 'counter' ? !!c.counterTerms : c.counterTerms === undefined,
        'Counter terms only allowed and required for a counteroffer',
      );
      invitation.updatedDate = w.date;
      invitation.lastMove = c.move;
      invitation.message = c.message;
      invitation.counterTerms = c.counterTerms ?? null;
      if (c.move === 'accept') {
        invitation.status = 'accepted';
        o.members.push(c.nationId);
        o.pendingApplications = o.pendingApplications.map((application) =>
          application.nationId === c.nationId &&
          application.status === 'pending'
            ? { ...application, status: 'accepted', updatedDate: w.date }
            : application,
        );
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'member-joined',
          `${nation(c.nationId).name} accepted its invitation and joined ${o.name}.`,
        );
      } else if (c.move === 'reject') {
        invitation.status = 'rejected';
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'invitation-response',
          `${nation(c.nationId).name} declined membership in ${o.name}: ${c.message}`,
        );
      } else if (c.move === 'counter') {
        const prior = o.pendingApplications.find(
          (application) =>
            application.nationId === c.nationId &&
            application.status === 'pending',
        );
        if (prior) {
          prior.terms = c.counterTerms!;
          prior.updatedDate = w.date;
        } else
          o.pendingApplications.push({
            nationId: c.nationId,
            appliedDate: w.date,
            updatedDate: w.date,
            status: 'pending',
            terms: c.counterTerms!,
          });
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'application',
          `${nation(c.nationId).name} requested revised terms for ${o.name}: ${c.counterTerms}`,
        );
      } else
        organizationHistory(
          o,
          w.date,
          c.nationId,
          'invitation-response',
          `${nation(c.nationId).name} delayed its decision on ${o.name}: ${c.message}`,
        );
      return true;
    }
    case 'UPDATE_ORGANIZATION': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      nation(c.issuerNationId);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        organizationFoundingAuthority(o, c.issuerNationId),
        'Only a founding government may amend the organization charter',
      );
      requireDomain(
        c.kind !== undefined ||
          c.purpose !== undefined ||
          c.charter !== undefined ||
          c.geographicScope !== undefined,
        'Organization amendment is empty',
      );
      if (c.kind !== undefined) o.kind = c.kind;
      if (c.purpose !== undefined) o.purpose = c.purpose;
      if (c.charter !== undefined) o.charter = c.charter;
      if (c.geographicScope !== undefined)
        o.geographicScope = c.geographicScope;
      organizationHistory(
        o,
        w.date,
        c.issuerNationId,
        'amended',
        `${nation(c.issuerNationId).name} amended ${o.name}'s charter${c.kind ? ` to ${c.kind}` : ''}${c.purpose ? `: ${c.purpose}` : ''}.`,
      );
      return true;
    }
    case 'ADD_ORGANIZATION_COMMITMENT': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      const commitment = c.commitment;
      nation(commitment.issuer);
      commitment.recipientNationIds.forEach(nation);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        organizationFoundingAuthority(o, commitment.issuer),
        'Only a founding government may offer organization-wide terms',
      );
      requireDomain(
        commitment.createdDate === w.date &&
          commitment.status === 'active' &&
          new Set(commitment.recipientNationIds).size ===
            commitment.recipientNationIds.length &&
          (commitment.appliesTo === 'specific-members'
            ? commitment.recipientNationIds.length > 0 &&
              commitment.recipientNationIds.every(
                (id) => o.members.includes(id) || o.invitedStates.includes(id),
              )
            : commitment.appliesTo === 'all-members'
              ? commitment.recipientNationIds.length === 0
              : true),
        'Organization terms require current date and valid invited recipients',
      );
      requireDomain(
        !o.commitments.some((existing) => existing.id === commitment.id),
        'Organization commitment ID reused',
      );
      commitment.originatingActionId = w.actions.at(-1)?.id ?? null;
      commitment.nextPaymentDate = new Date(
        Date.parse(commitment.createdDate) +
          commitment.frequencyDays * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      o.commitments.push(structuredClone(commitment));
      organizationHistory(
        o,
        w.date,
        commitment.issuer,
        'commitment-added',
        `${nation(commitment.issuer).name} offered ${commitment.terms}`,
        {
          originatingActionId: commitment.originatingActionId,
          organizationCommitmentId: commitment.id,
        },
      );
      return true;
    }
    case 'START_ORGANIZATION_PROGRAM': {
      const o = w.organizations.find((entry) => entry.id === c.organizationId);
      const program = c.program;
      nation(program.issuerNationId);
      program.participantNationIds.forEach(nation);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        o.members.includes(program.issuerNationId),
        'Only an organization member may propose a development program',
      );
      requireDomain(
        program.createdDate === w.date &&
          program.updatedDate === w.date &&
          program.status === 'proposed' &&
          program.stage === 'consultation' &&
          program.progress === 0 &&
          program.totalInvested === 0 &&
          program.paymentCount === 0 &&
          program.completedDate === null &&
          program.participantNationIds.every(
            (id) => id !== program.issuerNationId && o.members.includes(id),
          ) &&
          new Set(program.participantNationIds).size ===
            program.participantNationIds.length &&
          JSON.stringify([...program.participantNationIds].sort()) ===
            JSON.stringify(
              [...o.members]
                .filter((id) => id !== program.issuerNationId)
                .sort(),
            ) &&
          JSON.stringify(
            program.responses.map((response) => response.nationId).sort(),
          ) === JSON.stringify([...program.participantNationIds].sort()) &&
          program.responses.every(
            (response) =>
              response.move === 'pending' &&
              response.decidedDate === null &&
              response.message === null &&
              response.counterTerms === null,
          ),
        'Organization program proposals must start with current members awaiting independent responses',
      );
      const equivalent = o.programs.find(
        (existing) =>
          existing.id === program.id ||
          (existing.dimension === program.dimension &&
            ['proposed', 'active', 'suspended'].includes(existing.status)),
      );
      requireDomain(
        !equivalent,
        `Equivalent organization program already exists for ${program.dimension}`,
      );
      program.originatingActionId = w.actions.at(-1)?.id ?? null;
      o.programs.push(structuredClone(program));
      organizationHistory(
        o,
        w.date,
        program.issuerNationId,
        'program-proposed',
        `${nation(program.issuerNationId).name} proposes ${program.title}: ${program.terms}`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
        },
      );
      return true;
    }
    case 'REMOVE_ORGANIZATION_MEMBER': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      nation(c.issuerNationId);
      nation(c.nationId);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        organizationFoundingAuthority(o, c.issuerNationId),
        'Only a founding government may expel a member',
      );
      requireDomain(
        o.members.includes(c.nationId),
        'The named government is not an organization member',
      );
      o.members = o.members.filter((id) => id !== c.nationId);
      organizationHistory(
        o,
        w.date,
        c.issuerNationId,
        'member-removed',
        `${nation(c.issuerNationId).name} removed ${nation(c.nationId).name} from ${o.name}.`,
      );
      if (!o.members.length) {
        o.status = 'dissolved';
        o.dissolvedDate = w.date;
        for (const commitment of o.commitments)
          if (commitment.status === 'active') commitment.status = 'withdrawn';
        organizationHistory(
          o,
          w.date,
          c.issuerNationId,
          'dissolved',
          `${o.name} ceased to operate after its final member was removed.`,
        );
      }
      return true;
    }
    case 'DISSOLVE_ORGANIZATION': {
      const o = w.organizations.find((v) => v.id === c.organizationId);
      nation(c.issuerNationId);
      requireDomain(o?.status === 'active', 'Unknown active organization');
      requireDomain(
        organizationFoundingAuthority(o, c.issuerNationId),
        'Only a founding government may dissolve the organization',
      );
      o.status = 'dissolved';
      o.dissolvedDate = w.date;
      for (const commitment of o.commitments)
        if (commitment.status === 'active') commitment.status = 'withdrawn';
      organizationHistory(
        o,
        w.date,
        c.issuerNationId,
        'dissolved',
        `${nation(c.issuerNationId).name} dissolved ${o.name}.`,
      );
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

export function resolveInfluenceBreach(
  world: WorldState,
  treaty: WorldState['treaties'][number],
  breach: WorldState['treaties'][number]['breaches'][number],
  reason: string,
  milestone: 'resolved' | 'renegotiated' = 'resolved',
) {
  breach.status = 'resolved';
  if (!breach.milestones.some((entry) => entry.key === milestone))
    breach.milestones.push({ key: milestone, date: world.date });
  if (
    milestone !== 'resolved' &&
    !breach.milestones.some((entry) => entry.key === 'resolved')
  )
    breach.milestones.push({ key: 'resolved', date: world.date });
  const crisis = world.crises.find(
    (candidate) =>
      candidate.type === 'commitment' &&
      candidate.participants.includes(breach.violatingNationId) &&
      candidate.participants.includes(breach.injuredNationId) &&
      candidate.demands.some(
        (demand) =>
          demand.condition.kind === 'treaty-breach' &&
          demand.condition.treatyId === treaty.id &&
          demand.condition.breachId === breach.id,
      ),
  );
  if (!crisis) return;
  for (const demand of crisis.demands)
    if (
      demand.condition.kind === 'treaty-breach' &&
      demand.condition.treatyId === treaty.id &&
      demand.condition.breachId === breach.id
    )
      demand.satisfied = true;
  const outstanding = treaty.breaches.some(
    (candidate) => candidate.status !== 'resolved',
  );
  if (!outstanding && crisis.demands.every((demand) => demand.satisfied)) {
    crisis.status = 'resolved';
    crisis.diplomaticBreakdown = clamp(crisis.diplomaticBreakdown - 20);
    crisis.rhetoric = clamp(crisis.rhetoric - 15);
  } else {
    crisis.status = 'de-escalating';
    crisis.diplomaticBreakdown = clamp(crisis.diplomaticBreakdown - 8);
  }
  crisis.severity = Math.round(
    crisis.militaryPosture * 0.5 +
      crisis.rhetoric * 0.2 +
      crisis.diplomaticBreakdown * 0.3,
  );
  crisis.history.push({
    date: world.date,
    nationId: breach.injuredNationId,
    action: `${reason} ${milestone === 'renegotiated' ? 'Breach renegotiated.' : 'Breach resolved.'}`,
    severity: crisis.severity,
  });
  crisis.history = crisis.history.slice(-100);
}

function recordInfluenceCrisis(
  world: WorldState,
  treaty: WorldState['treaties'][number],
  patronNationId: NationId,
  subjectNationId: NationId,
  violatingNationId: NationId,
  reason: string,
  breachId: string,
  baseSeverity: number,
) {
  const sortedParties = [patronNationId, subjectNationId].sort();
  const firstParty = sortedParties[0]!;
  const secondParty = sortedParties[1]!;
  const crisisId = CrisisId.parse(
    `crisis:influence-${firstParty.slice(7)}-${secondParty.slice(7)}`,
  );
  const prior = world.crises.find((crisis) => crisis.id === crisisId);
  if (prior) {
    prior.diplomaticBreakdown = clamp(
      Math.max(prior.diplomaticBreakdown, 20 + Math.round(baseSeverity * 0.4)),
    );
    prior.rhetoric = clamp(
      Math.max(prior.rhetoric, 30 + Math.round(baseSeverity * 0.25)),
    );
    prior.severity = Math.round(
      prior.militaryPosture * 0.5 +
        prior.rhetoric * 0.2 +
        prior.diplomaticBreakdown * 0.3,
    );
    prior.status = prior.severity >= 60 ? 'escalating' : 'active';
    prior.issues = [...new Set([...prior.issues, reason])].slice(-12);
    const hasDemand = prior.demands.some(
      (demand) =>
        demand.condition.kind === 'treaty-breach' &&
        demand.condition.treatyId === treaty.id &&
        demand.condition.breachId === breachId,
    );
    if (!hasDemand && prior.demands.length < 20) {
      prior.demands.push({
        nationId: violatingNationId,
        text: `Address treaty breach ${breachId}: ${reason}`,
        condition: { kind: 'treaty-breach', treatyId: treaty.id, breachId },
        satisfied: false,
      });
      prior.history.push({
        date: world.date,
        nationId: violatingNationId,
        action: reason,
        severity: prior.severity,
      });
      prior.history = prior.history.slice(-100);
    }
    return;
  }

  const rhetoric = Math.max(
    20,
    Math.min(70, 18 + Math.round(baseSeverity * 0.35)),
  );
  const diplomaticBreakdown = Math.max(
    12,
    Math.min(65, 12 + Math.round(baseSeverity * 0.3)),
  );
  const severity = Math.round(rhetoric * 0.2 + diplomaticBreakdown * 0.3);
  world.crises.push(
    Crisis.parse({
      id: crisisId,
      title: `Treaty compliance crisis: ${world.nations.find((nation) => nation.id === patronNationId)!.name} / ${world.nations.find((nation) => nation.id === subjectNationId)!.name}`,
      type: 'commitment',
      status: 'emerging',
      participants: [patronNationId, subjectNationId],
      interestedActors: [],
      regions: [],
      startDate: world.date,
      visibility: treaty.visibility,
      trigger: `Treaty breach: ${reason}`,
      issues: ['A binding sphere agreement has been breached.', reason],
      demands: [
        {
          nationId: violatingNationId,
          text: `Address treaty breach ${breachId}: ${reason}`,
          condition: { kind: 'treaty-breach', treatyId: treaty.id, breachId },
        },
      ],
      redLines: [],
      militaryPosture: 0,
      rhetoric,
      diplomaticBreakdown,
      severity,
      deadline: null,
      conflictId: null,
      negotiationIds: [],
      history: [
        {
          date: world.date,
          nationId: violatingNationId,
          action: reason,
          severity,
        },
      ],
    }),
  );
}

export function recordInfluenceBreach(
  world: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  reason: string,
  violatingNationId: NationId = subjectNationId,
  treatyId?: string,
  obligationKey?: string,
  arrearsAmount = 0,
) {
  const treaty = world.treaties.find(
    (entry) =>
      entry.status === 'active' &&
      entry.kind === 'influence' &&
      (!treatyId || entry.id === treatyId) &&
      entry.parties.includes(patronNationId) &&
      entry.parties.includes(subjectNationId),
  );
  const injuredNationId =
    violatingNationId === patronNationId ? subjectNationId : patronNationId;
  let created = false;
  let milestoneReached = false;
  if (treaty) {
    const existing = obligationKey
      ? treaty.breaches.find(
          (breach) =>
            breach.obligationKey === obligationKey &&
            breach.violatingNationId === violatingNationId &&
            breach.injuredNationId === injuredNationId &&
            breach.status !== 'resolved',
        )
      : undefined;
    let breach = existing;
    if (breach) {
      if (breach.lastMissedDate !== world.date)
        breach.missedInstallments = Math.min(
          100_000,
          breach.missedInstallments + 1,
        );
      breach.lastMissedDate = world.date;
      breach.arrearsAmount = Math.max(breach.arrearsAmount, arrearsAmount);
      breach.durationMonths = Math.max(
        0,
        Math.floor(
          (Date.parse(world.date) -
            Date.parse(breach.firstMissedDate ?? breach.date)) /
            (30.4375 * 86_400_000),
        ),
      );
      breach.severity = clamp(
        25 +
          Math.min(55, breach.missedInstallments * 7) +
          Math.min(20, Math.floor(breach.arrearsAmount / 10)),
      );
      if (
        breach.severity >= 60 &&
        !breach.milestones.some((entry) => entry.key === 'arrears-severe')
      ) {
        breach.milestones.push({ key: 'arrears-severe', date: world.date });
        milestoneReached = true;
      }
    } else {
      const sequence =
        world.revision * 1000 +
        world.commands.length +
        treaty.breaches.length +
        1;
      breach = TreatyBreach.parse({
        id: `breach:${treaty.id.slice(7)}-${world.date}-${sequence}`,
        date: world.date,
        obligationKey: obligationKey ?? null,
        firstMissedDate: obligationKey ? world.date : null,
        lastMissedDate: obligationKey ? world.date : null,
        missedInstallments: obligationKey ? 1 : 0,
        arrearsAmount,
        severity: obligationKey ? 32 : 25,
        milestones: obligationKey
          ? [{ key: 'first-missed', date: world.date }]
          : [],
        violatingNationId,
        injuredNationId,
        reason,
        status: 'open',
      });
      treaty.breaches = [...treaty.breaches, breach].slice(-200);
      created = true;
    }
    if (created || milestoneReached)
      recordInfluenceCrisis(
        world,
        treaty,
        patronNationId,
        subjectNationId,
        violatingNationId,
        reason,
        breach.id,
        breach.severity,
      );
  }
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  if (created && violatingNationId === subjectNationId && subject) {
    subject.stats.legitimacy = clamp(subject.stats.legitimacy - 2);
    subject.stats.unrest = clamp(subject.stats.unrest + 5);
  } else if (created && violatingNationId === patronNationId && subject) {
    subject.stats.legitimacy = clamp(subject.stats.legitimacy - 1);
    subject.stats.unrest = clamp(subject.stats.unrest + 4);
  }
  if (created || milestoneReached)
    relationshipEffect(
      world,
      patronNationId,
      subjectNationId,
      created ? (violatingNationId === subjectNationId ? -8 : -6) : -2,
      created ? -12 : -3,
      `${created ? 'Treaty breach' : 'Treaty breach escalated'} by ${violatingNationId}: ${reason}`,
      treaty?.visibility ?? 'public',
    );
}

function applyConditionalPressure(
  world: WorldState,
  negotiation: WorldState['negotiations'][number],
) {
  const pressure = negotiation.conditionalPressure;
  if (!pressure || pressure.status !== 'pending') return;
  const subject = world.nations.find(
    (nation) => nation.id === pressure.subjectNationId,
  );
  if (!subject) return;

  const affectedKinds: Partial<
    Record<InfluencePressure['channel'], InfluenceTerm['kind'][]>
  > = {
    aid: ['subsidy'],
    infrastructure: ['infrastructure-investment'],
    energy: ['energy-supply'],
    'market-access': [
      'preferential-trade',
      'market-access-concession',
      'exclusive-market-access',
      'customs-alignment',
      'common-economic-rules',
      'mandatory-procurement',
    ],
    'security-guarantee': ['security-guarantee'],
  };
  let breachedTreatyId: string | undefined;
  let withdrewPromise = false;
  const kinds = affectedKinds[pressure.channel] ?? [];
  for (const treaty of world.treaties) {
    if (treaty.status !== 'active') continue;
    for (const term of treaty.influenceTerms) {
      if (
        term.status !== 'active' ||
        term.patronNationId !== pressure.patronNationId ||
        term.subjectNationId !== pressure.subjectNationId ||
        !kinds.includes(term.kind)
      )
        continue;
      if (
        pressure.action === 'reduce' &&
        (term.amount > 1 || term.ratePercent > 1)
      ) {
        if (term.amount > 1)
          term.amount = Math.max(1, Math.floor(term.amount / 2));
        if (term.ratePercent > 1)
          term.ratePercent = Math.max(1, Math.floor(term.ratePercent / 2));
      } else {
        term.status =
          pressure.action === 'withdraw' ? 'withdrawn' : 'suspended';
      }
      breachedTreatyId ??= treaty.id;
      withdrewPromise = true;
    }
  }

  if (pressure.channel === 'organization-support')
    for (const organization of world.organizations) {
      if (organization.status !== 'active') continue;
      for (const commitment of organization.commitments) {
        if (
          commitment.status !== 'active' ||
          commitment.issuer !== pressure.patronNationId ||
          commitment.costPerMember <= 0 ||
          !(
            commitment.appliesTo === 'all-members' ||
            commitment.appliesTo === 'new-members' ||
            commitment.recipientNationIds.includes(pressure.subjectNationId)
          )
        )
          continue;
        commitment.status = 'withdrawn';
        withdrewPromise = true;
        organizationHistory(
          organization,
          world.date,
          pressure.patronNationId,
          'commitment-breached',
          `${world.nations.find((nation) => nation.id === pressure.patronNationId)!.name} withdrew ${commitment.kind} support to ${subject.name} after a conditional influence threat was triggered.`,
          { organizationCommitmentId: commitment.id },
        );
      }
    }

  const link = world.economicLinks.find(
    (entry) =>
      entry.dependentNationId === pressure.subjectNationId &&
      entry.partnerNationId === pressure.patronNationId,
  );
  const cut = Math.max(5, Math.floor(pressure.severity / 2));
  if (link) {
    switch (pressure.channel) {
      case 'aid':
        link.finance = clamp(link.finance - cut);
        break;
      case 'infrastructure':
        link.infrastructure = clamp(link.infrastructure - cut);
        break;
      case 'energy':
        link.energy = clamp(link.energy - cut);
        break;
      case 'market-access':
        link.imports = clamp(link.imports - cut);
        link.exports = clamp(link.exports - cut);
        link.alternatives = clamp(link.alternatives + Math.ceil(cut / 2));
        break;
      case 'security-guarantee':
        break;
      case 'organization-support':
        break;
      default: {
        const exhaustive: never = pressure.channel;
        return exhaustive;
      }
    }
  }

  const economicDamage = Math.max(1, Math.ceil(pressure.severity / 25));
  subject.stats.economy = clamp(subject.stats.economy - economicDamage);
  subject.stats.unrest = clamp(
    subject.stats.unrest + Math.max(1, Math.ceil(pressure.severity / 20)),
  );
  subject.stats.legitimacy = clamp(
    subject.stats.legitimacy - Math.max(1, Math.floor(pressure.severity / 40)),
  );
  pressure.status = 'triggered';
  pressure.triggeredDate = world.date;

  const reason = `Conditional ${pressure.channel.replaceAll('-', ' ')} pressure was carried out after ${pressure.condition}`;
  if (withdrewPromise)
    recordInfluenceBreach(
      world,
      pressure.patronNationId,
      pressure.subjectNationId,
      reason,
      pressure.patronNationId,
      breachedTreatyId,
    );
  else
    relationshipEffect(
      world,
      pressure.patronNationId,
      pressure.subjectNationId,
      -3,
      -8,
      reason,
      negotiation.visibility,
    );
}

function triggerConditionalInfluencePressure(
  world: WorldState,
  subjectNationId: NationId,
  condition: Extract<
    InfluencePressure['condition'],
    'joins-rival-alliance' | 'accepts-rival-security'
  >,
  rivalPatronNationId?: NationId,
  rivalOrganization?: CanonicalOrganization,
) {
  for (const negotiation of world.negotiations) {
    const pressure = negotiation.conditionalPressure;
    if (
      negotiation.status !== 'accepted' ||
      !pressure ||
      pressure.status !== 'pending' ||
      pressure.condition !== condition ||
      pressure.subjectNationId !== subjectNationId
    )
      continue;
    if (
      condition === 'accepts-rival-security' &&
      pressure.patronNationId === rivalPatronNationId
    )
      continue;
    if (
      condition === 'joins-rival-alliance' &&
      rivalOrganization?.members.includes(pressure.patronNationId)
    )
      continue;
    applyConditionalPressure(world, negotiation);
  }
}

/** Enforce only accepted war-support terms; all other war orders remain possible and incur breach consequences. */
export function enforcePatronWarObligations(
  world: WorldState,
  conflict: WorldState['conflicts'][number],
) {
  for (const treaty of world.treaties.filter(
    (entry) => entry.status === 'active',
  )) {
    for (const term of treaty.influenceTerms) {
      if (term.status !== 'active') continue;
      if (
        term.kind === 'security-guarantee' &&
        conflict.defenders.includes(term.subjectNationId) &&
        conflict.attackers.some((id) => id !== term.subjectNationId) &&
        !conflict.defenders.includes(term.patronNationId)
      )
        recordInfluenceBreach(
          world,
          term.patronNationId,
          term.subjectNationId,
          'Failed to defend the subject under an active security guarantee',
          term.patronNationId,
          treaty.id,
        );
      if (
        term.kind === 'no-war-against-patron' &&
        conflict.attackers.includes(term.subjectNationId) &&
        conflict.defenders.includes(term.patronNationId)
      )
        recordInfluenceBreach(
          world,
          term.patronNationId,
          term.subjectNationId,
          'Declared war on the patron despite a binding non-aggression obligation',
        );
      if (
        term.kind === 'war-declaration-approval' &&
        conflict.attackers.includes(term.subjectNationId) &&
        !conflict.attackers.includes(term.patronNationId) &&
        !conflict.defenders.includes(term.patronNationId)
      )
        recordInfluenceBreach(
          world,
          term.patronNationId,
          term.subjectNationId,
          'Declared war without the required patron approval',
        );
      const patronAttacking = conflict.attackers.includes(term.patronNationId);
      const patronDefending = conflict.defenders.includes(term.patronNationId);
      const shouldJoin =
        term.kind === 'join-patron-wars'
          ? patronAttacking || patronDefending
          : term.kind === 'join-defensive-wars' && patronDefending;
      if (!shouldJoin) continue;
      const side = patronAttacking ? conflict.attackers : conflict.defenders;
      const opposing = patronAttacking
        ? conflict.defenders
        : conflict.attackers;
      const existing = treaty.directives.find(
        (directive) =>
          directive.conflictId === conflict.id &&
          directive.subjectNationId === term.subjectNationId &&
          directive.kind === 'join-conflict',
      );
      if (existing) continue;
      const directiveId =
        `directive:auto-${conflict.id.slice(9)}-${term.subjectNationId.slice(7)}`.slice(
          0,
          120,
        );
      const subject = world.nations.find(
        (nation) => nation.id === term.subjectNationId,
      );
      if (opposing.includes(term.subjectNationId)) {
        treaty.directives.push({
          id: directiveId,
          patronNationId: term.patronNationId,
          subjectNationId: term.subjectNationId,
          kind: 'join-conflict',
          conflictId: conflict.id,
          organizationId: null,
          targetTreatyId: null,
          policyText: null,
          issuedDate: world.date,
          status: 'failed',
          reason:
            'The subject already entered the opposing side before the patron called the treaty.',
        });
        recordInfluenceBreach(
          world,
          term.patronNationId,
          term.subjectNationId,
          'Did not join the patron under the defense obligation',
        );
      } else {
        if (!side.includes(term.subjectNationId))
          side.push(term.subjectNationId);
        treaty.directives.push({
          id: directiveId,
          patronNationId: term.patronNationId,
          subjectNationId: term.subjectNationId,
          kind: 'join-conflict',
          conflictId: conflict.id,
          organizationId: null,
          targetTreatyId: null,
          policyText: null,
          issuedDate: world.date,
          status: 'complied',
          reason:
            'The subject joined the patron under a binding defense obligation.',
        });
        if (subject) {
          subject.stats.unrest = clamp(subject.stats.unrest + 2);
          subject.stats.legitimacy = clamp(subject.stats.legitimacy - 1);
        }
      }
    }
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
        ? (r.controllerNationId === term.fromNationId ||
            r.controllerNationId === term.toNationId) &&
            r.ownerNationId === term.toNationId
        : term.kind === 'territorial-transfer'
          ? r.ownerNationId === term.fromNationId &&
            parties.includes(r.controllerNationId)
          : r.ownerNationId === term.fromNationId &&
            r.claims.includes(term.toNationId) &&
            !r.recognizedClaims.includes(term.toNationId),
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
