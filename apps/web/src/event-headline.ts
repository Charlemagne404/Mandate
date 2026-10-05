import type { WorldState } from '@mandate/schemas';

type WorldEvent = WorldState['events'][number];

export function eventHeadline(world: WorldState, event: WorldEvent): string {
  if (
    event.type.startsWith('WAR_') ||
    event.type === 'TERRITORY_CEDED' ||
    event.type === 'OCCUPIED_TERRITORY_RETURNED'
  )
    return event.title;
  const record = world.commands.find((command) =>
    event.sourceCommandIds.includes(command.id),
  );
  const command = record?.command;
  const nation = (id: string) =>
    world.nations.find((candidate) => candidate.id === id)?.name ?? id;
  const region = (id: string) =>
    world.regions.find((candidate) => candidate.id === id)?.name ?? id;
  if (!command) return event.title;

  switch (command.type) {
    case 'MOBILIZE_FORCE':
      return `${nation(command.nationId)} orders ${command.level} mobilization`;
    case 'THEATER_ACTION':
      if (command.posture !== 'major-offensive')
        return `${nation(command.nationId)} adopts a ${command.posture} military posture`;
      {
        const conflict = world.conflicts.find(
          (candidate) => candidate.id === command.conflictId,
        );
        const opponents = conflict
          ? conflict.attackers.includes(command.nationId)
            ? conflict.defenders
            : conflict.attackers
          : [];
        if (opponents.length)
          return `${nation(command.nationId)} launches an offensive against ${opponents.map(nation).join(' and ')}`;
        const locations = command.regionIds.slice(0, 2).map(region).join(', ');
        const otherCount = command.regionIds.length - 2;
        return `${nation(command.nationId)} launches an offensive in ${locations}${otherCount > 0 ? ` and ${otherCount} other regions` : ''}`;
      }
    case 'START_CONFLICT':
      return `${command.conflict.attackers.map(nation).join(' and ')} go to war with ${command.conflict.defenders.map(nation).join(' and ')}`;
    case 'STRATEGIC_ATTACK':
      return `${nation(command.attackerNationId)} attacks ${nation(command.targetNationId)}`;
    case 'CONFLICT_ACTION':
      return command.regionId
        ? `${nation(command.nationId)} ${command.stance === 'offensive' ? 'attacks' : 'fortifies'} ${region(command.regionId)}`
        : `${nation(command.nationId)} ${command.stance} in the conflict`;
    case 'TRANSFER_CONTROL':
      return `${nation(command.nationId)} takes military control of ${region(command.regionId)}`;
    case 'TRANSFER_OWNERSHIP':
      return `${region(command.regionId)} is transferred to ${nation(command.nationId)}`;
    case 'CREATE_POLITY':
      return `${command.polity.name} declares independence from ${nation(command.parentNationId)}`;
    case 'ADD_CLAIM':
      return `${nation(command.nationId)} asserts a claim to ${region(command.regionId)}`;
    case 'REMOVE_CLAIM':
      return `${nation(command.nationId)} withdraws its claim to ${region(command.regionId)}`;
    case 'OPEN_NEGOTIATION':
      return `${nation(command.negotiation.proposerNationId)} approaches ${nation(command.negotiation.recipientNationId)}: ${command.negotiation.topic}`;
    case 'RESPOND_NEGOTIATION': {
      const negotiation = world.negotiations.find(
        (item) => item.id === command.negotiationId,
      );
      const other = negotiation
        ? nation(
            negotiation.proposerNationId === command.nationId
              ? negotiation.recipientNationId
              : negotiation.proposerNationId,
          )
        : 'the proposal';
      if (command.move === 'accept' && negotiation?.kind === 'peace') {
        const conflict = world.conflicts.find(
          (item) => item.id === negotiation.conflictId,
        );
        const terms = negotiation.peaceTerms.length
          ? ` under ${negotiation.peaceTerms.length} territorial or claim term${negotiation.peaceTerms.length === 1 ? '' : 's'}`
          : ' along the current control lines';
        return `${nation(command.nationId)} and ${other} conclude peace${conflict ? ` in ${conflict.name}` : ''}${terms}`;
      }
      const response =
        command.move === 'accept'
          ? 'accepts'
          : command.move === 'reject'
            ? 'rejects'
            : command.move === 'counter'
              ? 'makes a counteroffer to'
              : 'delays a response to';
      return `${nation(command.nationId)} ${response} ${other}`;
    }
    case 'IMPOSE_SANCTION':
      return `${nation(command.sanction.issuer)} announces sanctions on ${nation(command.sanction.target)}`;
    case 'OPEN_CRISIS':
      return `A crisis erupts between ${command.crisis.participants.map(nation).join(' and ')}`;
    case 'CRISIS_ACTION':
      return `${nation(command.nationId)} orders ${command.move} in a crisis`;
    case 'CREATE_TREATY':
      return `${command.treaty.parties.map(nation).join(' and ')} sign ${command.treaty.name}`;
    case 'END_CONFLICT': {
      const conflict = world.conflicts.find(
        (item) => item.id === command.conflictId,
      );
      return conflict ? `The war ends: ${conflict.name}` : event.title;
    }
    case 'UPDATE_GOVERNMENT':
      return `${nation(command.nationId)} forms a new government`;
    case 'UPDATE_LEADER':
      return `${nation(command.nationId)} appoints ${command.leader}`;
    case 'START_INITIATIVE':
      return /support independence in/i.test(command.initiative.name)
        ? `${nation(command.initiative.nationId)} backs an independence movement in ${command.initiative.name.replace(/^support independence in\s*/i, '')}`
        : `${nation(command.initiative.nationId)} begins a ${command.initiative.kind} program`;
    case 'ADJUST_RELATION':
      return `${nation(command.nationA)}–${nation(command.nationB)} relations ${command.delta < 0 ? 'deteriorate' : command.delta > 0 ? 'warm' : 'are reaffirmed'}`;
    case 'ADJUST_NATION_STAT':
      return `${nation(command.nationId)} ${command.delta < 0 ? 'loses' : 'gains'} ${command.stat === 'readiness' ? 'military readiness' : command.stat === 'treasury' ? 'fiscal resources' : command.stat === 'industrial' ? 'industrial capacity' : command.stat}`;
    case 'CREATE_STRATEGIC_GOAL':
      return `${nation(command.goal.nationId)} sets a goal: ${command.goal.title}`;
    case 'SET_ORGANIZATION_MEMBERSHIP':
      return `${nation(command.nationId)} ${command.member ? 'joins' : 'leaves'} ${world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'}`;
    case 'CREATE_ORGANIZATION':
      return `${nation(command.organization.founders[0] ?? world.playerNationId)} establishes ${command.organization.name}`;
    case 'INVITE_TO_ORGANIZATION':
      return `${nation(command.nationId)} receives an invitation to ${world.organizations.find((item) => item.id === command.organizationId)?.acronym ?? world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'}`;
    case 'RESPOND_ORGANIZATION_INVITATION': {
      const organization = world.organizations.find(
        (item) => item.id === command.organizationId,
      );
      const action =
        command.move === 'accept'
          ? 'accepts'
          : command.move === 'reject'
            ? 'declines'
            : command.move === 'counter'
              ? 'seeks changes to'
              : 'delays a decision on';
      return `${nation(command.nationId)} ${action} ${organization?.acronym ?? organization?.name ?? 'an organization'} invitation`;
    }
    case 'UPDATE_ORGANIZATION':
      return `${nation(command.issuerNationId)} updates ${world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'} terms`;
    case 'ADD_ORGANIZATION_COMMITMENT':
      return `${nation(command.commitment.issuer)} offers support to ${world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'} members`;
    case 'REMOVE_ORGANIZATION_MEMBER':
      return `${nation(command.issuerNationId)} removes ${nation(command.nationId)} from ${world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'}`;
    case 'DISSOLVE_ORGANIZATION':
      return `${nation(command.issuerNationId)} dissolves ${world.organizations.find((item) => item.id === command.organizationId)?.name ?? 'an organization'}`;
    default:
      return event.title;
  }
}
