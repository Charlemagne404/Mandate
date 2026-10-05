import type { WorldCommand } from '@mandate/schemas';
export function commandReferences(c: WorldCommand) {
  const empty = {
    nationIds: [] as string[],
    regionIds: [] as string[],
    treatyIds: [] as string[],
    conflictIds: [] as string[],
    goalIds: [] as string[],
    initiativeIds: [] as string[],
    negotiationIds: [] as string[],
    organizationIds: [] as string[],
  };
  switch (c.type) {
    case 'DISCLOSE_INFORMATION':
      return { ...empty, nationIds: [c.issuer, ...c.recipients] };
    case 'THEATER_ACTION':
      return {
        ...empty,
        nationIds: [c.nationId],
        conflictIds: [c.conflictId],
        regionIds: c.regionIds,
      };
    case 'OPEN_CRISIS':
      return {
        ...empty,
        nationIds: [...c.crisis.participants, ...c.crisis.interestedActors],
        regionIds: c.crisis.regions,
        conflictIds: c.crisis.conflictId ? [c.crisis.conflictId] : [],
        negotiationIds: c.crisis.negotiationIds,
      };
    case 'CRISIS_ACTION':
      return {
        ...empty,
        nationIds: [c.nationId],
        negotiationIds: c.negotiationId ? [c.negotiationId] : [],
      };
    case 'SET_ECONOMIC_LINK':
      return {
        ...empty,
        nationIds: [c.link.dependentNationId, c.link.partnerNationId],
      };
    case 'IMPOSE_SANCTION':
      return { ...empty, nationIds: [c.sanction.issuer, c.sanction.target] };
    case 'LIFT_SANCTION':
      return { ...empty, nationIds: [c.nationId] };
    case 'OPEN_CONFERENCE':
      return {
        ...empty,
        nationIds: [
          ...c.conference.parties,
          ...(c.conference.sanctionTarget ? [c.conference.sanctionTarget] : []),
        ],
        conflictIds: c.conference.conflictId ? [c.conference.conflictId] : [],
        regionIds: c.conference.peaceTerms.map((t) => t.regionId),
      };
    case 'RESPOND_CONFERENCE':
      return {
        ...empty,
        nationIds: [c.nationId],
        regionIds: c.counterPeaceTerms?.map((t) => t.regionId) ?? [],
      };
    case 'SCHEDULE_ELECTION':
      return { ...empty, nationIds: [c.tenure.nationId] };
    case 'REVISE_GOAL_EVALUATION':
      return { ...empty, goalIds: [c.goalId] };
    case 'START_INITIATIVE':
      return {
        ...empty,
        initiativeIds: [c.initiative.id, ...c.initiative.dependencies],
        nationIds: [
          c.initiative.nationId,
          ...(c.initiative.targetNationId ? [c.initiative.targetNationId] : []),
        ],
      };
    case 'CANCEL_INITIATIVE':
      return { ...empty, initiativeIds: [c.initiativeId] };
    case 'OPEN_NEGOTIATION':
      return {
        ...empty,
        negotiationIds: [c.negotiation.id],
        conflictIds: c.negotiation.conflictId ? [c.negotiation.conflictId] : [],
        nationIds: [
          c.negotiation.proposerNationId,
          c.negotiation.recipientNationId,
        ],
      };
    case 'RESPOND_NEGOTIATION':
      return {
        ...empty,
        nationIds: [c.nationId],
        negotiationIds: [c.negotiationId],
        treatyIds: c.treatyId ? [c.treatyId] : [],
      };
    case 'ISSUE_PATRON_DIRECTIVE':
      return {
        ...empty,
        nationIds: [c.patronNationId, c.subjectNationId],
        treatyIds: [
          c.treatyId,
          ...(c.targetTreatyId ? [c.targetTreatyId] : []),
        ],
        conflictIds: c.conflictId ? [c.conflictId] : [],
        organizationIds: c.organizationId ? [c.organizationId] : [],
      };
    case 'CREATE_ORGANIZATION':
      return {
        ...empty,
        organizationIds: [c.organization.id],
        nationIds: [
          ...c.organization.founders,
          ...c.organization.members,
          ...c.organization.invitedStates,
          ...c.organization.commitments.flatMap((commitment) => [
            commitment.issuer,
            ...commitment.recipientNationIds,
          ]),
        ],
      };
    case 'SET_ORGANIZATION_MEMBERSHIP':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.nationId],
      };
    case 'INVITE_TO_ORGANIZATION':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.inviterNationId, c.nationId],
      };
    case 'RESPOND_ORGANIZATION_INVITATION':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.nationId],
      };
    case 'UPDATE_ORGANIZATION':
    case 'DISSOLVE_ORGANIZATION':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.issuerNationId],
      };
    case 'ADD_ORGANIZATION_COMMITMENT':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.commitment.issuer, ...c.commitment.recipientNationIds],
      };
    case 'START_ORGANIZATION_PROGRAM':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [
          c.program.issuerNationId,
          ...c.program.participantNationIds,
          ...c.program.responses.map((response) => response.nationId),
        ],
      };
    case 'REMOVE_ORGANIZATION_MEMBER':
      return {
        ...empty,
        organizationIds: [c.organizationId],
        nationIds: [c.issuerNationId, c.nationId],
      };
    case 'APPLY_DOMESTIC_PRESSURE':
      return { ...empty, nationIds: [c.nationId] };
    case 'MOBILIZE_FORCE':
      return { ...empty, nationIds: [c.nationId] };
    case 'CONFLICT_ACTION':
      return {
        ...empty,
        nationIds: [c.nationId],
        conflictIds: [c.conflictId],
        regionIds: c.regionId ? [c.regionId] : [],
      };
    case 'ADJUST_RELATION':
      return { ...empty, nationIds: [c.nationA, c.nationB] };
    case 'SET_STRATEGY':
    case 'ADJUST_NATION_STAT':
    case 'UPDATE_GOVERNMENT':
    case 'UPDATE_LEADER':
    case 'SWITCH_NATION':
      return { ...empty, nationIds: [c.nationId] };
    case 'TRANSFER_CONTROL':
    case 'TRANSFER_OWNERSHIP':
    case 'ADD_CLAIM':
    case 'REMOVE_CLAIM':
      return { ...empty, nationIds: [c.nationId], regionIds: [c.regionId] };
    case 'CREATE_POLITY':
      return {
        ...empty,
        nationIds: [c.parentNationId, c.polity.id],
        regionIds: c.regionIds,
      };
    case 'CREATE_TREATY':
      return {
        ...empty,
        nationIds: c.treaty.parties,
        treatyIds: [c.treaty.id],
        conflictIds: c.treaty.conflictId ? [c.treaty.conflictId] : [],
      };
    case 'UPDATE_TREATY':
    case 'END_TREATY':
      return {
        ...empty,
        ...(c.type === 'END_TREATY' && c.nationId
          ? { nationIds: [c.nationId] }
          : {}),
        treatyIds: [c.treatyId],
      };
    case 'ENFORCE_TREATY_BREACH':
      return {
        ...empty,
        nationIds: [c.patronNationId, c.subjectNationId],
        treatyIds: [c.treatyId],
      };
    case 'START_CONFLICT':
      return {
        ...empty,
        nationIds: [...c.conflict.attackers, ...c.conflict.defenders],
        conflictIds: [c.conflict.id],
      };
    case 'STRATEGIC_ATTACK':
      return {
        ...empty,
        nationIds: [c.attackerNationId, c.targetNationId],
        conflictIds: [c.conflictId],
      };
    case 'UPDATE_CONFLICT':
    case 'END_CONFLICT':
      return { ...empty, conflictIds: [c.conflictId] };
    case 'CREATE_EVENT':
      return { ...empty, ...c.event };
    case 'CREATE_STRATEGIC_GOAL':
      return {
        ...empty,
        nationIds: [c.goal.nationId, ...c.goal.targetNationIds],
        goalIds: [c.goal.id],
      };
    case 'UPDATE_STRATEGIC_GOAL':
      return { ...empty, goalIds: [c.goalId] };
    case 'SET_OBSERVER_MODE':
    case 'ADVANCE_DATE':
      return empty;
    default: {
      const exhaustive: never = c;
      return exhaustive;
    }
  }
}
