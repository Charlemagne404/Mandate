import { EventId } from '@mandate/schemas';
import type {
  CommandEnvelope,
  Event,
  TurnId,
  WorldState,
} from '@mandate/schemas';
import { commandReferences } from './references.js';
export function factualEvent(
  w: WorldState,
  envelope: CommandEnvelope,
  turnId: TurnId,
): Event {
  const c = envelope.command;
  const refs = commandReferences(c);
  const n = (id: string) => w.nations.find((n) => n.id === id)!.name;
  const r = (id: string) => w.regions.find((r) => r.id === id)!.name;
  const title = (): string => {
    switch (c.type) {
      case 'DISCLOSE_INFORMATION':
        return `${n(c.issuer)} shares ${c.confidence} ${c.subject.kind} information`;
      case 'THEATER_ACTION':
        return c.posture === 'major-offensive'
          ? `${n(c.nationId)} begins an invasion offensive in ${c.regionIds.map(r).join(', ')}`
          : `${n(c.nationId)} sets ${c.posture} at ${c.allocation}% force allocation`;
      case 'OPEN_CRISIS':
        return `Crisis emerges: ${c.crisis.title}`;
      case 'CRISIS_ACTION':
        return `${n(c.nationId)}: ${c.move} in ${w.crises.find((v) => v.id === c.crisisId)!.title}`;
      case 'SET_ECONOMIC_LINK':
        return `${n(c.link.dependentNationId)} updates economic dependence on ${n(c.link.partnerNationId)}`;
      case 'IMPOSE_SANCTION':
        return `${n(c.sanction.issuer)} imposes ${c.sanction.sector} sanctions on ${n(c.sanction.target)}`;
      case 'LIFT_SANCTION':
        return `${n(c.nationId)} lifts sanctions`;
      case 'OPEN_CONFERENCE':
        return `Multilateral talks open: ${c.conference.title}`;
      case 'RESPOND_CONFERENCE':
        return `${n(c.nationId)}: ${c.move} at ${w.conferences.find((v) => v.id === c.conferenceId)!.title}`;
      case 'SCHEDULE_ELECTION':
        return `${n(c.tenure.nationId)} schedules election for ${c.tenure.nextElectionDate}`;
      case 'REVISE_GOAL_EVALUATION':
        return `Goal success criteria revised: ${w.goals.find((g) => g.id === c.goalId)!.title}`;
      case 'SET_STRATEGY': {
        const old = w.nations.find((v) => v.id === c.nationId)!.strategy;
        if (c.strategy.militaryBudgetShare !== old.militaryBudgetShare)
          return `${n(c.nationId)} assigns ${c.strategy.militaryBudgetShare}% of fiscal capacity to defense`;
        if (c.strategy.taxRate !== old.taxRate)
          return `${n(c.nationId)} sets the tax burden to ${c.strategy.taxRate}%`;
        return `${n(c.nationId)} updates strategic directives`;
      }
      case 'START_INITIATIVE':
        return `${n(c.initiative.nationId)} begins ${c.initiative.name}`;
      case 'CANCEL_INITIATIVE':
        return `Initiative cancelled: ${w.initiatives.find((v) => v.id === c.initiativeId)!.name}`;
      case 'OPEN_NEGOTIATION':
        return `${n(c.negotiation.proposerNationId)} proposes ${c.negotiation.topic} to ${n(c.negotiation.recipientNationId)}`;
      case 'RESPOND_NEGOTIATION': {
        const offer = w.negotiations.find((v) => v.id === c.negotiationId)!;
        return c.move === 'accept' && offer.kind === 'peace'
          ? offer.peaceTerms.length
            ? `${n(c.nationId)} accepts peace with ${offer.peaceTerms.length} validated territorial terms`
            : `${n(c.nationId)} accepts peace; conflict ends with current control retained`
          : c.move === 'accept' && offer.kind === 'ceasefire'
            ? `${n(c.nationId)} accepts ceasefire; offensive operations halted`
            : `${n(c.nationId)}: ${c.move} diplomatic proposal`;
      }
      case 'CREATE_ORGANIZATION':
        return `Organization created: ${c.organization.name}`;
      case 'SET_ORGANIZATION_MEMBERSHIP':
        return `${n(c.nationId)} ${c.member ? 'joins' : 'leaves'} ${w.organizations.find((v) => v.id === c.organizationId)!.name}`;
      case 'APPLY_DOMESTIC_PRESSURE':
        return `${n(c.nationId)} faces domestic pressure: ${c.cause}`;
      case 'MOBILIZE_FORCE':
        return `${n(c.nationId)} orders ${c.level} military mobilization`;
      case 'STRATEGIC_ATTACK': {
        const conflict = w.conflicts.find((f) => f.id === c.conflictId)!;
        const invasion =
          conflict.theaters.some(
            (theater) =>
              theater.nationId === c.attackerNationId &&
              theater.posture === 'major-offensive',
          ) ||
          conflict.campaigns.some(
            (campaign) => campaign.nationId === c.attackerNationId,
          );
        return `${n(c.attackerNationId)} launches a ${c.scale} strategic attack abstraction against ${n(c.targetNationId)} (weapon-specific effects are not simulated)${invasion ? ' as an invasion offensive begins' : ''}`;
      }
      case 'CONFLICT_ACTION':
        return c.stance === 'offensive'
          ? `${n(c.nationId)} offensive: ${w.regions.find((v) => v.id === c.regionId)!.controllerNationId === c.nationId ? 'control secured' : (w.conflicts.find((f) => f.id === c.conflictId)!.campaigns.find((v) => v.regionId === c.regionId && v.nationId === c.nationId)?.progress ?? 0) > 0 ? 'campaign advances' : 'attack repelled'} in ${r(c.regionId!)}`
          : `${n(c.nationId)}: ${c.stance} in conflict`;
      case 'ADJUST_RELATION':
        return `${n(c.nationA)} / ${n(c.nationB)} relation adjusted by ${c.delta}${c.trustDelta ? `; trust ${c.trustDelta < 0 ? 'fell' : 'rose'} by ${Math.abs(c.trustDelta)}` : ''}`;
      case 'ADJUST_NATION_STAT':
        return `${n(c.nationId)}: ${c.stat} adjusted by ${c.delta}`;
      case 'TRANSFER_CONTROL':
        return `${n(c.nationId)} now controls ${r(c.regionId)}`;
      case 'TRANSFER_OWNERSHIP':
        return `${n(c.nationId)} now owns ${r(c.regionId)}`;
      case 'CREATE_POLITY':
        return `${c.polity.name} declares independence from ${n(c.parentNationId)}`;
      case 'ADD_CLAIM':
        return `${n(c.nationId)} claims ${r(c.regionId)}`;
      case 'REMOVE_CLAIM':
        return `${n(c.nationId)} withdraws claim on ${r(c.regionId)}`;
      case 'CREATE_TREATY':
        return `Treaty created: ${c.treaty.name}`;
      case 'UPDATE_TREATY':
        return `Treaty terms updated: ${w.treaties.find((t) => t.id === c.treatyId)!.name}`;
      case 'END_TREATY': {
        const treaty = w.treaties.find((t) => t.id === c.treatyId)!;
        return treaty.kind === 'ceasefire' &&
          w.conflicts.find((v) => v.id === treaty.conflictId)?.status ===
            'active'
          ? `Ceasefire ended: ${treaty.name}; fighting resumed`
          : `Treaty ended: ${treaty.name}`;
      }
      case 'START_CONFLICT':
        return `Conflict started: ${c.conflict.name}`;
      case 'UPDATE_CONFLICT':
        return `Conflict escalation set to ${c.escalation}`;
      case 'END_CONFLICT':
        return `Conflict ended: ${w.conflicts.find((v) => v.id === c.conflictId)!.name}`;
      case 'CREATE_EVENT':
        return c.event.title;
      case 'UPDATE_GOVERNMENT':
        return `${n(c.nationId)} government updated`;
      case 'UPDATE_LEADER':
        return `${n(c.nationId)} leader changed to ${c.leader}`;
      case 'CREATE_STRATEGIC_GOAL':
        return `Goal created: ${c.goal.title}`;
      case 'UPDATE_STRATEGIC_GOAL':
        return `Strategic goal updated: ${w.goals.find((g) => g.id === c.goalId)!.title}`;
      case 'SET_OBSERVER_MODE':
        return c.enabled
          ? 'Observer releases government control to autonomous simulation'
          : 'Observer resumes government control';
      case 'SWITCH_NATION':
        return `Player now controls ${n(c.nationId)}`;
      case 'ADVANCE_DATE':
        return `Simulation advanced to ${c.date}; ${w.initiatives.filter((i) => i.status === 'active').length} active initiatives, ${w.conflicts.filter((v) => v.status === 'active').length} conflicts`;
      default: {
        const exhaustive: never = c;
        return exhaustive;
      }
    }
  };
  const relatedNations = (): Event['nationIds'] => {
    if (c.type === 'OPEN_CRISIS') return c.crisis.participants;
    if (c.type === 'CRISIS_ACTION')
      return w.crises.find((v) => v.id === c.crisisId)!.participants;
    if (c.type === 'OPEN_CONFERENCE') return c.conference.parties;
    if (c.type === 'RESPOND_CONFERENCE')
      return w.conferences.find((v) => v.id === c.conferenceId)!.parties;
    if (c.type === 'REVISE_GOAL_EVALUATION')
      return [w.goals.find((g) => g.id === c.goalId)!.nationId];
    if (c.type === 'START_INITIATIVE' && c.initiative.visibility === 'private')
      return [c.initiative.nationId];
    if (c.type === 'CREATE_STRATEGIC_GOAL' && c.goal.visibility === 'private')
      return [c.goal.nationId];
    if (c.type === 'RESPOND_NEGOTIATION') {
      const negotiation = w.negotiations.find((v) => v.id === c.negotiationId)!;
      return [negotiation.proposerNationId, negotiation.recipientNationId];
    }
    if (c.type === 'CANCEL_INITIATIVE') {
      const initiative = w.initiatives.find((v) => v.id === c.initiativeId)!;
      return [
        initiative.nationId,
        ...(initiative.visibility === 'public' && initiative.targetNationId
          ? [initiative.targetNationId]
          : []),
      ];
    }
    if (c.type === 'UPDATE_TREATY' || c.type === 'END_TREATY')
      return w.treaties.find((v) => v.id === c.treatyId)!.parties;
    if (c.type === 'UPDATE_STRATEGIC_GOAL') {
      const goal = w.goals.find((v) => v.id === c.goalId)!;
      return [
        goal.nationId,
        ...(goal.visibility === 'public' ? goal.targetNationIds : []),
      ];
    }
    if (c.type === 'UPDATE_CONFLICT' || c.type === 'END_CONFLICT') {
      const conflict = w.conflicts.find((v) => v.id === c.conflictId)!;
      return [...conflict.attackers, ...conflict.defenders];
    }
    return refs.nationIds as Event['nationIds'];
  };
  const defaults = {
    id: EventId.parse(`event:${envelope.id.slice('command:'.length)}`),
    type: c.type,
    title: title().slice(0, 160),
    nationIds: [...new Set(relatedNations())],
    regionIds: refs.regionIds as Event['regionIds'],
    treatyIds: refs.treatyIds as Event['treatyIds'],
    conflictIds:
      c.type === 'RESPOND_NEGOTIATION' &&
      w.negotiations.find((v) => v.id === c.negotiationId)!.conflictId
        ? [w.negotiations.find((v) => v.id === c.negotiationId)!.conflictId!]
        : (refs.conflictIds as Event['conflictIds']),
    importance: [
      'OPEN_CRISIS',
      'IMPOSE_SANCTION',
      'OPEN_CONFERENCE',
      'MOBILIZE_FORCE',
      'STRATEGIC_ATTACK',
    ].includes(c.type)
      ? c.type === 'STRATEGIC_ATTACK'
        ? 100
        : 70
      : c.type === 'THEATER_ACTION' && c.posture === 'major-offensive'
        ? 90
        : c.type === 'START_CONFLICT'
          ? 80
          : c.type === 'END_CONFLICT'
            ? 75
            : c.type === 'RESPOND_NEGOTIATION' &&
                c.move === 'accept' &&
                w.negotiations.find((v) => v.id === c.negotiationId)!.kind ===
                  'peace'
              ? 75
              : c.type === 'RESPOND_NEGOTIATION' &&
                  c.move === 'accept' &&
                  w.negotiations.find((v) => v.id === c.negotiationId)!.kind ===
                    'ceasefire'
                ? 65
                : c.type === 'TRANSFER_CONTROL'
                  ? 60
                  : 30,
    topics: [c.type.toLowerCase()],
    visibility:
      c.type === 'DISCLOSE_INFORMATION'
        ? 'private'
        : c.type === 'OPEN_CRISIS'
          ? c.crisis.visibility
          : c.type === 'CRISIS_ACTION'
            ? w.crises.find((v) => v.id === c.crisisId)!.visibility
            : c.type === 'OPEN_CONFERENCE'
              ? c.conference.visibility
              : c.type === 'RESPOND_CONFERENCE'
                ? w.conferences.find((v) => v.id === c.conferenceId)!.visibility
                : c.type === 'REVISE_GOAL_EVALUATION'
                  ? w.goals.find((g) => g.id === c.goalId)!.visibility
                  : c.type === 'SET_STRATEGY'
                    ? 'private'
                    : c.type === 'CREATE_STRATEGIC_GOAL'
                      ? c.goal.visibility
                      : c.type === 'UPDATE_STRATEGIC_GOAL'
                        ? w.goals.find((v) => v.id === c.goalId)!.visibility
                        : c.type === 'CREATE_TREATY'
                          ? c.treaty.visibility
                          : c.type === 'UPDATE_TREATY' ||
                              c.type === 'END_TREATY'
                            ? w.treaties.find((v) => v.id === c.treatyId)!
                                .visibility
                            : c.type === 'START_INITIATIVE'
                              ? c.initiative.visibility
                              : c.type === 'OPEN_NEGOTIATION'
                                ? c.negotiation.visibility
                                : c.type === 'RESPOND_NEGOTIATION'
                                  ? w.negotiations.find(
                                      (v) => v.id === c.negotiationId,
                                    )!.visibility
                                  : c.type === 'CANCEL_INITIATIVE'
                                    ? w.initiatives.find(
                                        (v) => v.id === c.initiativeId,
                                      )!.visibility
                                    : ('public' as const),
    status: 'resolved' as const,
  };
  return {
    ...(c.type === 'CREATE_EVENT' ? c.event : defaults),
    effects: [],
    date: w.date,
    turnId,
    sourceCommandIds: [envelope.id],
  };
}
