import { updateContinuity } from './continuity.js';
import { EconomicLink } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { updateDepth, executionCapacity, relationshipEffect } from './depth.js';
import { requireDomain } from './errors.js';
import { resolveWarFronts } from './fronts.js';
import { recordInfluenceBreach } from './mechanics.js';
import type {
  ActionId,
  OrganizationDimension,
  NationId,
} from '@mandate/schemas';
const day = (date: string) => Date.parse(date) / 86400000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const economicOrganizationKinds = new Set([
  'economic',
  'economic-union',
  'trade-bloc',
  'customs-union',
]);
function organizationHistory(
  organization: WorldState['organizations'][number],
  date: string,
  actorNationId: WorldState['organizations'][number]['history'][number]['actorNationId'],
  kind: WorldState['organizations'][number]['history'][number]['kind'],
  description: string,
  provenance: {
    originatingActionId?: ActionId | null;
    organizationCommitmentId?: WorldState['organizations'][number]['commitments'][number]['id'];
    organizationProgramId?: WorldState['organizations'][number]['programs'][number]['id'];
    paymentMilestone?: number;
    programMilestone?: number;
    developmentDimension?: OrganizationDimension;
    developmentLevel?: number;
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
      ...(provenance.paymentMilestone
        ? { paymentMilestone: provenance.paymentMilestone }
        : {}),
      ...(provenance.programMilestone
        ? { programMilestone: provenance.programMilestone }
        : {}),
      ...(provenance.developmentDimension
        ? { developmentDimension: provenance.developmentDimension }
        : {}),
      ...(provenance.developmentLevel
        ? { developmentLevel: provenance.developmentLevel }
        : {}),
    },
  ].slice(-200);
}

const developmentMilestones: Record<OrganizationDimension, string[]> = {
  'economic-integration': [
    'establishes a regional economic consultation framework',
    'coordinates tariff policy among members',
    'removes major internal trade barriers',
    'adopts common market standards',
    'enters deeper regional market integration',
  ],
  'regional-infrastructure': [
    'coordinates regional infrastructure planning',
    'approves shared cross-border corridors',
    'begins construction on regional links',
    'connects major member infrastructure networks',
    'operates an integrated regional infrastructure network',
  ],
  'customs-cooperation': [
    'opens regular customs consultations',
    'coordinates customs procedures',
    'adopts shared customs documentation',
    'aligns external customs schedules',
    'operates a common customs framework',
  ],
  'common-standards': [
    'starts common standards consultations',
    'adopts shared technical standards',
    'mutually recognizes member standards',
    'extends common standards across key sectors',
    'operates a unified regional standards framework',
  ],
  'political-coordination': [
    'establishes regular political consultation',
    'agrees to coordinate selected external positions',
    'presents common positions abroad',
    'coordinates regional diplomatic priorities',
    'establishes a unified regional political front',
  ],
  'joint-diplomacy': [
    'opens a shared diplomatic consultation channel',
    'coordinates selected diplomatic initiatives',
    'presents joint positions at international forums',
    'maintains a common external agenda',
    'acts as a unified diplomatic bloc',
  ],
  'development-funding': [
    'establishes a common development-funding framework',
    'approves the first shared development allocations',
    'funds cross-border development projects',
    'coordinates regional investment priorities',
    'operates a standing regional development fund',
  ],
  'sanctions-coordination': [
    'opens sanctions-policy consultations',
    'agrees shared criteria for sanctions',
    'coordinates a first joint sanctions measure',
    'aligns enforcement across members',
    'maintains a common sanctions framework',
  ],
};

function deterministicJitter(seed: string) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 41) - 20;
}

function decideProgramResponse(
  w: WorldState,
  organization: WorldState['organizations'][number],
  program: WorldState['organizations'][number]['programs'][number],
  nationId: NationId,
): 'accept' | 'reject' | 'counter' | 'delay' {
  const nation = w.nations.find((entry) => entry.id === nationId)!;
  const pair = [program.issuerNationId, nationId].sort();
  const relation =
    w.relations.find(
      (entry) => entry.nationA === pair[0] && entry.nationB === pair[1],
    )?.score ?? 0;
  const economicInterest = [
    'economic-integration',
    'regional-infrastructure',
    'customs-cooperation',
    'development-funding',
  ].includes(program.dimension)
    ? Math.trunc((nation.stats.economy - 50) / 10)
    : 0;
  const politicalInterest = [
    'political-coordination',
    'joint-diplomacy',
    'sanctions-coordination',
  ].includes(program.dimension)
    ? Math.trunc((nation.stats.influence - 50) / 10)
    : 0;
  const score =
    24 +
    Math.trunc(relation / 4) +
    Math.trunc((nation.stats.stability - 50) / 12) +
    economicInterest +
    politicalInterest -
    (program.dimension === 'political-coordination' ? 8 : 0) +
    deterministicJitter(
      `${w.scenario.rules?.seed ?? w.scenario.id}:${organization.id}:${program.dimension}:${program.issuerNationId}:${program.createdDate}:${nationId}`,
    );
  if (score >= 12) return 'accept';
  if (score <= -8) return 'reject';
  if (score >= 0) return 'counter';
  return nation.stats.stability < 42 ? 'delay' : 'counter';
}

function ensureDevelopment(
  organization: WorldState['organizations'][number],
  dimension: OrganizationDimension,
  date: string,
) {
  let development = organization.development.find(
    (entry) => entry.dimension === dimension,
  );
  if (!development) {
    development = { dimension, level: 0, progress: 0, updatedDate: date };
    organization.development.push(development);
  }
  return development;
}

function advanceDevelopment(
  organization: WorldState['organizations'][number],
  dimension: OrganizationDimension,
  amount: number,
  date: string,
  actorNationId: NationId | null,
  programId?: WorldState['organizations'][number]['programs'][number]['id'],
) {
  const development = ensureDevelopment(organization, dimension, date);
  if (development.level >= 5) return;
  development.progress += amount;
  development.updatedDate = date;
  while (development.progress >= 100 && development.level < 5) {
    development.progress -= 100;
    development.level++;
    organizationHistory(
      organization,
      date,
      actorNationId,
      'development-milestone',
      `${organization.name} ${developmentMilestones[dimension][development.level - 1] ?? 'reaches a new development stage'}.`,
      {
        developmentDimension: dimension,
        developmentLevel: development.level,
        ...(programId
          ? {
              originatingActionId:
                organization.programs.find(
                  (program) => program.id === programId,
                )?.originatingActionId ?? null,
              organizationProgramId: programId,
            }
          : {}),
      },
    );
  }
}

function resolveOrganizationPrograms(
  w: WorldState,
  organization: WorldState['organizations'][number],
  date: string,
) {
  for (const program of organization.programs) {
    if (program.status !== 'proposed') continue;
    for (const response of program.responses) {
      if (response.move !== 'pending') continue;
      const move = decideProgramResponse(
        w,
        organization,
        program,
        response.nationId,
      );
      response.move = move;
      response.decidedDate = date;
      response.message =
        move === 'accept'
          ? 'The government supports the proposal.'
          : move === 'reject'
            ? 'The government declines the proposal.'
            : move === 'counter'
              ? 'The government requests revised terms.'
              : 'The government delays its decision.';
      response.counterTerms =
        move === 'counter'
          ? 'Limit initial participation to agreed priority areas.'
          : null;
      program.updatedDate = date;
      organizationHistory(
        organization,
        date,
        response.nationId,
        'program-response',
        `${w.nations.find((nation) => nation.id === response.nationId)!.name} ${move === 'accept' ? 'supports' : move === 'reject' ? 'rejects' : move === 'counter' ? 'counters' : 'delays'} ${program.title} in ${organization.acronym ?? organization.name}${response.counterTerms ? `: ${response.counterTerms.trim().replace(/[.!?]+$/, '')}` : ''}.`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
        },
      );
    }
    if (program.responses.some((response) => response.move === 'pending'))
      continue;
    const approvals =
      program.responses.filter((response) => response.move === 'accept')
        .length + 1;
    const memberCount = Math.max(1, organization.members.length);
    const threshold = ['political-coordination', 'joint-diplomacy'].includes(
      program.dimension,
    )
      ? Math.ceil((memberCount * 2) / 3)
      : Math.ceil(memberCount / 2);
    if (approvals >= threshold) {
      program.status = 'active';
      program.stage = 'planning';
      organizationHistory(
        organization,
        date,
        program.issuerNationId,
        'program-approved',
        `${organization.acronym ?? organization.name} members approve ${program.title}; ${approvals} of ${memberCount} members support the program.`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
        },
      );
    } else {
      program.status = 'rejected';
      const blocker = program.responses.find(
        (response) => response.move === 'reject' || response.move === 'counter',
      );
      const blockerName = blocker
        ? w.nations.find((nation) => nation.id === blocker.nationId)!.name
        : null;
      const description =
        blockerName && program.dimension === 'political-coordination'
          ? `${blockerName} blocks ${program.title} in ${organization.acronym ?? organization.name}; only ${approvals} of ${memberCount} members support the proposal.`
          : `${organization.acronym ?? organization.name} members do not approve ${program.title}; ${approvals} of ${memberCount} members support the proposal.`;
      organizationHistory(
        organization,
        date,
        blocker?.nationId ?? program.issuerNationId,
        'program-rejected',
        description,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
        },
      );
    }
  }
}

function progressOrganizationPrograms(
  w: WorldState,
  organization: WorldState['organizations'][number],
  date: string,
) {
  for (const program of organization.programs) {
    if (!['active', 'suspended'].includes(program.status)) continue;
    const issuer = w.nations.find(
      (nation) => nation.id === program.issuerNationId,
    )!;
    if (
      program.monthlyCost > 0 &&
      issuer.stats.treasury < program.monthlyCost
    ) {
      if (program.status !== 'suspended') {
        program.status = 'suspended';
        program.updatedDate = date;
        organizationHistory(
          organization,
          date,
          program.issuerNationId,
          'program-suspended',
          `${issuer.name} suspends ${program.title} in ${organization.acronym ?? organization.name} after its treasury cannot cover the monthly ${program.monthlyCost}-unit program cost.`,
          {
            originatingActionId: program.originatingActionId,
            organizationProgramId: program.id,
          },
        );
      }
      continue;
    }
    if (program.status === 'suspended') {
      program.status = 'active';
      organizationHistory(
        organization,
        date,
        program.issuerNationId,
        'program-resumed',
        `${issuer.name} resumes ${program.title} in ${organization.acronym ?? organization.name}.`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
        },
      );
    }
    if (program.monthlyCost > 0) {
      issuer.stats.treasury -= program.monthlyCost;
      program.totalInvested += program.monthlyCost;
      program.paymentCount++;
      program.lastPaymentDate = date;
    }
    const previousProgress = program.progress;
    program.progress = Math.min(100, program.progress + 10);
    program.updatedDate = date;
    advanceDevelopment(
      organization,
      program.dimension,
      10,
      date,
      program.issuerNationId,
      program.id,
    );
    if (
      program.dimension === 'regional-infrastructure' &&
      program.progress >= 25 &&
      previousProgress < 25
    ) {
      program.stage = 'construction';
      organizationHistory(
        organization,
        date,
        program.issuerNationId,
        'program-milestone',
        `Construction begins under ${program.title} across ${organization.acronym ?? organization.name}.`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
          programMilestone: 25,
        },
      );
      program.reportedMilestones.push(25);
    }
    for (const milestone of [50])
      if (program.progress >= milestone && previousProgress < milestone) {
        organizationHistory(
          organization,
          date,
          program.issuerNationId,
          'program-milestone',
          `${program.title} reaches ${milestone}% completion in ${organization.acronym ?? organization.name}.`,
          {
            originatingActionId: program.originatingActionId,
            organizationProgramId: program.id,
            programMilestone: milestone,
          },
        );
        program.reportedMilestones.push(milestone);
      }
    if (program.progress >= 100) {
      program.status = 'completed';
      program.stage = 'operational';
      program.completedDate = date;
      program.updatedDate = date;
      organizationHistory(
        organization,
        date,
        program.issuerNationId,
        'program-milestone',
        `${program.title} enters operation in ${organization.acronym ?? organization.name} after ${program.paymentCount} monthly program payments.`,
        {
          originatingActionId: program.originatingActionId,
          organizationProgramId: program.id,
          programMilestone: 100,
        },
      );
      program.reportedMilestones.push(100);
    }
  }
}

function applyOrganizationMonth(w: WorldState, date: string) {
  const affectedPairs = new Set<string>();
  for (const organization of w.organizations) {
    if (organization.status !== 'active') continue;
    if (economicOrganizationKinds.has(organization.kind)) {
      for (let i = 0; i < organization.members.length; i++)
        for (let j = i + 1; j < organization.members.length; j++) {
          const left = organization.members[i]!;
          const right = organization.members[j]!;
          const pair = [left, right].sort().join('~');
          if (affectedPairs.has(pair)) continue;
          affectedPairs.add(pair);
          const relation = w.relations.find(
            (item) =>
              item.nationA === [left, right].sort()[0] &&
              item.nationB === [left, right].sort()[1],
          );
          if ((relation?.score ?? 0) < 20)
            relationshipEffect(
              w,
              left,
              right,
              1,
              0,
              `Gradual economic cooperation through ${organization.name}`,
              'public',
              date,
            );
          const updated = w.relations.find(
            (item) =>
              item.nationA === [left, right].sort()[0] &&
              item.nationB === [left, right].sort()[1],
          );
          if (updated) {
            if (updated.tradeDependence < 60) {
              updated.tradeDependence = Math.min(
                60,
                updated.tradeDependence + 1,
              );
            }
          }
        }
      advanceDevelopment(organization, 'economic-integration', 2, date, null);
    }

    resolveOrganizationPrograms(w, organization, date);
    progressOrganizationPrograms(w, organization, date);

    for (const commitment of organization.commitments) {
      if (commitment.status !== 'active' || commitment.costPerMember <= 0)
        continue;
      const dueDate =
        commitment.nextPaymentDate ??
        addDays(
          commitment.lastPaymentDate ?? commitment.createdDate,
          commitment.frequencyDays,
        );
      if (date < dueDate) continue;
      const recipients = organization.members.filter((id) => {
        if (id === commitment.issuer) return false;
        if (commitment.appliesTo === 'specific-members')
          return commitment.recipientNationIds.includes(id);
        if (commitment.appliesTo === 'all-members') return true;
        if (
          commitment.appliesTo === 'new-members' &&
          commitment.recipientNationIds.length > 0 &&
          !commitment.recipientNationIds.includes(id)
        )
          return false;
        const invitation = organization.invitations.find(
          (candidate) => candidate.nationId === id,
        );
        return (
          !organization.founders.includes(id) &&
          invitation?.status === 'accepted' &&
          invitation.invitedDate >= commitment.createdDate
        );
      });
      if (!recipients.length) continue;
      const issuer = w.nations.find(
        (nation) => nation.id === commitment.issuer,
      )!;
      const totalCost = commitment.costPerMember * recipients.length;
      if (issuer.stats.treasury < totalCost) {
        commitment.status = 'breached';
        issuer.stats.fiscal = clamp(issuer.stats.fiscal - 1);
        issuer.stats.unrest = clamp(issuer.stats.unrest + 2);
        for (const recipient of recipients)
          relationshipEffect(
            w,
            commitment.issuer,
            recipient,
            -5,
            -10,
            `Breach of ${organization.name} commitment: ${commitment.terms}`,
            'public',
            date,
          );
        organizationHistory(
          organization,
          date,
          commitment.issuer,
          'commitment-breached',
          issuer.name +
            ' could not pay ' +
            totalCost +
            ' treasury units for ' +
            (organization.acronym ?? organization.name) +
            ' support to ' +
            recipients.length +
            ' members; fiscal pressure rose and their trust fell.' +
            (commitment.terms.trim()
              ? ` Originating commitment: ${commitment.terms.trim()}`
              : ''),
          {
            originatingActionId: commitment.originatingActionId,
            organizationCommitmentId: commitment.id,
          },
        );
        continue;
      }
      issuer.stats.treasury -= totalCost;
      for (const recipientId of recipients) {
        const recipient = w.nations.find(
          (nation) => nation.id === recipientId,
        )!;
        recipient.stats.treasury = Math.min(
          1_000_000_000,
          recipient.stats.treasury + commitment.costPerMember,
        );
      }
      commitment.lastPaymentDate = date;
      commitment.nextPaymentDate = addDays(date, commitment.frequencyDays);
      commitment.lastPaymentAmount = totalCost;
      commitment.totalPaid = Math.min(
        1_000_000_000,
        commitment.totalPaid + totalCost,
      );
      commitment.paymentsMade++;
      if (commitment.paymentsMade === 1)
        organizationHistory(
          organization,
          date,
          commitment.issuer,
          'commitment-payment-started',
          `${issuer.name} makes the first scheduled ${organization.acronym ?? organization.name} support payment: ${totalCost} treasury units for ${recipients.length} members.`,
          {
            originatingActionId: commitment.originatingActionId,
            organizationCommitmentId: commitment.id,
          },
        );
      const financialMilestones = [
        100, 500, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000,
      ];
      const crossed = financialMilestones.filter(
        (threshold) =>
          commitment.totalPaid >= threshold &&
          commitment.totalPaid - totalCost < threshold &&
          !commitment.reportedPaymentMilestones.includes(threshold),
      );
      for (const threshold of crossed) {
        commitment.reportedPaymentMilestones.push(threshold);
        organizationHistory(
          organization,
          date,
          commitment.issuer,
          'commitment-payment-milestone',
          `${issuer.name}'s ${organization.acronym ?? organization.name} support program passes ${threshold} cumulative treasury units across ${commitment.paymentsMade} scheduled payments.`,
          {
            originatingActionId: commitment.originatingActionId,
            organizationCommitmentId: commitment.id,
            paymentMilestone: threshold,
          },
        );
      }
    }
  }
}

function applyInfluenceTreatyMonth(w: WorldState, date: string) {
  const getLink = (subjectNationId: string, patronNationId: string) => {
    let link = w.economicLinks.find(
      (candidate) =>
        candidate.dependentNationId === subjectNationId &&
        candidate.partnerNationId === patronNationId,
    );
    if (!link) {
      link = EconomicLink.parse({
        id: `economic:${subjectNationId.slice(7)}-${patronNationId.slice(7)}`,
        dependentNationId: subjectNationId,
        partnerNationId: patronNationId,
        imports: 0,
        exports: 0,
        energy: 0,
        strategicGoods: 0,
        finance: 0,
        infrastructure: 0,
        alternatives: 20,
        adaptation: 0,
      });
      w.economicLinks.push(link);
    }
    return link;
  };
  for (const treaty of w.treaties) {
    if (treaty.status !== 'active') continue;
    for (const term of treaty.influenceTerms) {
      if (term.status !== 'active') continue;
      const patron = w.nations.find(
        (nation) => nation.id === term.patronNationId,
      );
      const subject = w.nations.find(
        (nation) => nation.id === term.subjectNationId,
      );
      if (!patron || !subject) continue;
      const capacity = Math.max(
        12,
        12 *
          Math.max(
            1,
            Math.floor((subject.stats.economy + subject.stats.fiscal) / 25),
          ),
      );
      const monthlyRevenue = Math.max(
        0,
        Math.floor((subject.stats.economy + subject.stats.fiscal) / 25) +
          Math.trunc((subject.strategy.taxRate - 50) / 15),
      );
      const transfer = (
        payer: typeof patron,
        receiver: typeof subject,
        amount: number,
      ) => {
        if (amount <= 0) return 0;
        if (payer.stats.treasury < amount) {
          term.arrears = Math.min(100_000, term.arrears + 1);
          payer.stats.fiscal = clamp(payer.stats.fiscal - 1);
          payer.stats.unrest = clamp(payer.stats.unrest + 1);
          recordInfluenceBreach(
            w,
            term.patronNationId,
            term.subjectNationId,
            `Missed ${term.kind} payment under ${treaty.name}`,
            payer.id,
            treaty.id,
          );
          return 0;
        }
        payer.stats.treasury -= amount;
        receiver.stats.treasury = Math.min(
          1_000_000_000,
          receiver.stats.treasury + amount,
        );
        term.paidAmount = Math.min(1_000_000_000, term.paidAmount + amount);
        term.paymentsMade = Math.min(100_000, term.paymentsMade + 1);
        term.lastPaymentDate = date;
        return amount;
      };
      if (
        term.kind === 'subsidy' ||
        term.kind === 'infrastructure-investment'
      ) {
        const paid = transfer(patron, subject, term.amount);
        if (paid) {
          const link = getLink(term.subjectNationId, term.patronNationId);
          if (term.kind === 'subsidy') {
            subject.stats.economy = clamp(
              subject.stats.economy + (term.paymentsMade % 3 === 0 ? 1 : 0),
            );
            link.finance = Math.max(
              link.finance,
              clamp(Math.round((term.paidAmount * 100) / (capacity * 5))),
            );
          } else {
            subject.stats.industrial = clamp(
              subject.stats.industrial + (term.paymentsMade % 3 === 0 ? 1 : 0),
            );
            link.infrastructure = Math.max(
              link.infrastructure,
              clamp(Math.round((term.paidAmount * 100) / (capacity * 5))),
            );
          }
        }
      } else if (term.kind === 'tribute') {
        if (term.amount > 0) {
          transfer(subject, patron, term.amount);
        } else if (term.ratePercent > 0) {
          const accrued =
            term.revenueRemainder + monthlyRevenue * term.ratePercent;
          const amount = Math.floor(accrued / 100);
          const remainder = accrued % 100;
          if (amount > 0) {
            if (transfer(subject, patron, amount)) {
              term.revenueRemainder = remainder;
            } else {
              // Preserve the unpaid amount so later revenue or treasury can
              // catch up; arrears still record each missed monthly payment.
              term.revenueRemainder = Math.min(
                1_000_000_000,
                remainder + amount * 100,
              );
            }
          } else {
            term.revenueRemainder = accrued;
          }
        }
      } else if (term.kind === 'debt-repayment') {
        const amount = Math.min(term.amount, subject.stats.debt);
        if (amount > 0 && transfer(subject, patron, amount))
          subject.stats.debt = Math.max(0, subject.stats.debt - amount);
      } else if (
        term.kind === 'preferential-trade' ||
        term.kind === 'market-access-concession' ||
        term.kind === 'exclusive-market-access' ||
        term.kind === 'customs-alignment' ||
        term.kind === 'common-economic-rules' ||
        term.kind === 'mandatory-procurement'
      ) {
        const link = getLink(term.subjectNationId, term.patronNationId);
        const monthlyGrowth =
          term.kind === 'exclusive-market-access' ||
          term.kind === 'mandatory-procurement'
            ? 2
            : 1;
        link.imports = Math.min(100, link.imports + monthlyGrowth);
        link.exports = Math.min(100, link.exports + 1);
        link.alternatives = Math.max(
          0,
          link.alternatives - (term.kind === 'exclusive-market-access' ? 1 : 0),
        );
      } else if (term.kind === 'energy-supply') {
        const link = getLink(term.subjectNationId, term.patronNationId);
        link.energy = Math.min(100, link.energy + 1);
        link.alternatives = Math.max(0, link.alternatives - 1);
      }
    }
  }
}

// Fixed 30-day accounting ticks anchored to genesis make passage of time
// independent of how a player splits advances. No wall clock or random source.
export function advanceSimulation(w: WorldState, nextDate: string): void {
  const start = day(w.scenario.startDate);
  const before = Math.floor((day(w.date) - start) / 30);
  const after = Math.floor((day(nextDate) - start) / 30);
  requireDomain(
    after - before <= 1200,
    'Advance at most 100 years per command',
  );
  for (let tick = before + 1; tick <= after; tick++) {
    const date = new Date((start + tick * 30) * 86400000)
      .toISOString()
      .slice(0, 10);
    updateContinuity(w, date, true);
    for (const n of w.nations) {
      const wars = w.conflicts.filter(
        (c) =>
          c.status === 'active' &&
          [...c.attackers, ...c.defenders].includes(n.id),
      );
      const fighting = wars.filter((c) => c.settlementState === 'fighting');
      const burden =
        fighting.length * (2 + Math.floor(n.stats.military / 25)) +
        wars.length -
        fighting.length;
      const trade = w.treaties.filter(
        (t) =>
          t.kind === 'trade' &&
          t.status === 'active' &&
          t.parties.includes(n.id),
      );
      const rivals = new Set(
        fighting.flatMap((c) =>
          c.attackers.includes(n.id) ? c.defenders : c.attackers,
        ),
      );
      const disruption = w.relations
        .filter(
          (r) =>
            [r.nationA, r.nationB].includes(n.id) &&
            rivals.has(r.nationA === n.id ? r.nationB : r.nationA),
        )
        .reduce((s, r) => s + Math.floor(r.tradeDependence / 20), 0);
      const income = Math.max(
        0,
        Math.floor((n.stats.economy + n.stats.fiscal) / 25) +
          Math.min(6, trade.length * 2) -
          disruption,
      );
      const defenseShare = n.strategy.militaryBudgetShare;
      const defenseCost = Math.max(0, Math.ceil((defenseShare - 35) / 13));
      const defenseSavings = defenseShare <= 10 ? 1 : 0;
      const taxAdjustment = Math.trunc((n.strategy.taxRate - 50) / 15);
      n.stats.treasury = Math.min(
        1000000000,
        Math.max(
          0,
          n.stats.treasury +
            income +
            taxAdjustment -
            defenseCost +
            defenseSavings -
            burden -
            (fighting.length ? Math.floor(n.stats.energyExposure / 25) : 0),
        ),
      );
      if (fighting.length) {
        n.stats.economy = clamp(n.stats.economy - 1);
        n.stats.readiness = clamp(n.stats.readiness - 1);
        n.stats.unrest = clamp(n.stats.unrest + fighting.length);
      } else if (n.stats.stability >= 60 && n.stats.industrial >= 40) {
        const potential = Math.min(
          95,
          Math.floor((n.stats.industrial + n.stats.fiscal) / 2),
        );
        n.stats.economy = clamp(
          n.stats.economy + Math.sign(potential - n.stats.economy),
        );
      }
      if (defenseShare >= 60)
        n.stats.readiness = clamp(
          n.stats.readiness + 1 + (defenseShare >= 90 ? 1 : 0),
        );
      else if (defenseShare <= 10)
        n.stats.readiness = clamp(n.stats.readiness - 1);
      if (defenseShare >= 85 && n.stats.treasury < 10) {
        n.stats.fiscal = clamp(n.stats.fiscal - 1);
        n.stats.unrest = clamp(n.stats.unrest + 1);
      } else if (defenseShare <= 10) {
        n.stats.fiscal = clamp(n.stats.fiscal + 1);
      }
      if (n.strategy.taxRate >= 85)
        n.stats.economy = clamp(n.stats.economy - 1);
      else if (n.strategy.taxRate <= 10 && n.stats.treasury < 10) {
        n.stats.fiscal = clamp(n.stats.fiscal - 1);
        n.stats.unrest = clamp(n.stats.unrest + 1);
      }
      if (n.stats.unrest >= 60) {
        n.stats.stability = clamp(n.stats.stability - 2);
        n.stats.legitimacy = clamp(n.stats.legitimacy - 1);
      } else if (n.stats.legitimacy >= 50 && !wars.length) {
        n.stats.unrest = clamp(n.stats.unrest - 1);
      }
    }
    for (const r of w.relations)
      if (
        w.treaties.some(
          (t) =>
            t.kind === 'trade' &&
            t.status === 'active' &&
            t.parties.includes(r.nationA) &&
            t.parties.includes(r.nationB),
        )
      )
        r.tradeDependence = Math.min(80, r.tradeDependence + 1);
    for (const c of w.conflicts)
      if (c.status === 'active')
        c.exhaustion = clamp(
          c.exhaustion + (c.settlementState === 'fighting' ? 1 : -1),
        );
    resolveWarFronts(w, date);
    const remainingCapacity = new Map(
      w.nations.map((n) => [n.id, executionCapacity(w, n.id)]),
    );
    for (const i of [...w.initiatives].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )) {
      if (i.status !== 'active' || day(i.startDate) >= day(date)) continue;
      if (
        !i.dependencies.every(
          (id) =>
            w.initiatives.find((v) => v.id === id)?.status === 'completed',
        )
      )
        continue;
      const elapsedInstallments = Math.floor(
        (day(date) - day(i.startDate)) / 30,
      );
      if (elapsedInstallments <= Math.floor(i.invested / i.effort)) continue;
      const n = w.nations.find((v) => v.id === i.nationId)!;
      const blocker =
        n.stats.stability < 25
          ? 'Government instability prevents execution'
          : n.stats.treasury < i.effort
            ? 'Insufficient treasury'
            : (remainingCapacity.get(n.id) ?? 0) < i.effort
              ? 'Fiscal and industrial execution capacity committed elsewhere'
              : null;
      i.blocker = blocker;
      if (blocker) {
        i.delays++;
        continue;
      }
      remainingCapacity.set(n.id, remainingCapacity.get(n.id)! - i.effort);
      const ticksNeeded = Math.ceil(i.durationDays / 30);
      const invested = Math.min(i.effort, ticksNeeded * i.effort - i.invested);
      n.stats.treasury -= invested;
      i.invested += invested;
      i.progress = Math.min(
        100,
        Math.floor((i.invested * 100) / (ticksNeeded * i.effort)),
      );
      i.milestones = [25, 50, 75, 100].filter((m) => m <= i.progress);
      if (i.kind === 'rearmament' && n.stats.fiscal < 40)
        n.stats.unrest = clamp(n.stats.unrest + 1);
      if (i.progress !== 100) continue;
      i.status = 'completed';
      i.completedDate = date;
      const benefit = i.effort * 2;
      switch (i.kind) {
        case 'industry':
          n.stats.industrial = clamp(n.stats.industrial + benefit);
          n.stats.economy = clamp(n.stats.economy + i.effort);
          break;
        case 'energy':
          n.stats.energyExposure = clamp(n.stats.energyExposure - benefit);
          n.stats.fiscal = clamp(n.stats.fiscal + i.effort);
          break;
        case 'rearmament':
          n.stats.military = clamp(n.stats.military + i.effort);
          n.stats.readiness = clamp(n.stats.readiness + benefit);
          break;
        case 'reform':
          n.stats.stability = clamp(n.stats.stability + i.effort);
          n.stats.legitimacy = clamp(n.stats.legitimacy + i.effort);
          n.stats.unrest = clamp(n.stats.unrest - benefit);
          break;
        case 'diplomacy':
          n.stats.influence = clamp(n.stats.influence + benefit);
          break;
        case 'aid': {
          const target = w.nations.find((v) => v.id === i.targetNationId)!;
          target.stats.treasury = Math.min(
            1000000000,
            target.stats.treasury + i.invested,
          );
          target.stats.economy = clamp(target.stats.economy + i.effort);
          break;
        }
        default: {
          const exhaustive: never = i.kind;
          throw new Error(exhaustive);
        }
      }
    }
    applyOrganizationMonth(w, date);
    applyInfluenceTreatyMonth(w, date);
  }
  for (const n of w.negotiations)
    if (n.status === 'open' && n.expiresDate <= nextDate) n.status = 'expired';
  updateContinuity(w, nextDate, false);
  updateDepth(w, nextDate);
}
