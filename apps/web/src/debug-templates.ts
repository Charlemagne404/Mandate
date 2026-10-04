import type {
  NationId,
  RegionId,
  WorldCommand,
  WorldState,
} from '@mandate/schemas';
export const commandTypes: WorldCommand['type'][] = [
  'THEATER_ACTION',
  'STRATEGIC_ATTACK',
  'OPEN_CRISIS',
  'CRISIS_ACTION',
  'SET_ECONOMIC_LINK',
  'IMPOSE_SANCTION',
  'LIFT_SANCTION',
  'OPEN_CONFERENCE',
  'RESPOND_CONFERENCE',
  'SCHEDULE_ELECTION',
  'REVISE_GOAL_EVALUATION',
  'TRANSFER_CONTROL',
  'TRANSFER_OWNERSHIP',
  'CREATE_POLITY',
  'ADJUST_RELATION',
  'ADJUST_NATION_STAT',
  'ADD_CLAIM',
  'REMOVE_CLAIM',
  'CREATE_TREATY',
  'UPDATE_TREATY',
  'END_TREATY',
  'START_CONFLICT',
  'UPDATE_CONFLICT',
  'END_CONFLICT',
  'UPDATE_GOVERNMENT',
  'UPDATE_LEADER',
  'CREATE_STRATEGIC_GOAL',
  'UPDATE_STRATEGIC_GOAL',
  'CREATE_EVENT',
  'SWITCH_NATION',
  'ADVANCE_DATE',
  'START_INITIATIVE',
  'CANCEL_INITIATIVE',
  'OPEN_NEGOTIATION',
  'RESPOND_NEGOTIATION',
  'CREATE_ORGANIZATION',
  'SET_ORGANIZATION_MEMBERSHIP',
  'CONFLICT_ACTION',
  'APPLY_DOMESTIC_PRESSURE',
];
export function template(
  type: WorldCommand['type'],
  w: WorldState,
  selected: NationId,
  region: RegionId,
  target: NationId,
): unknown {
  const id = crypto.randomUUID();
  switch (type) {
    case 'DISCLOSE_INFORMATION':
      return {
        type,
        issuer: selected,
        recipients: [target],
        subject: {
          kind: 'event',
          id: w.events[0]?.id ?? 'event:select-existing',
        },
        confidence: 'confirmed',
        source: 'ally-sharing',
      };
    case 'THEATER_ACTION':
      return {
        type,
        conflictId:
          w.conflicts.find((c) => c.status === 'active')?.id ??
          'conflict:select-existing',
        theaterId: `theater:${id}`,
        nationId: selected,
        regionIds: [region],
        posture: 'hold',
        allocation: 50,
      };
    case 'STRATEGIC_ATTACK': {
      const conflict = w.conflicts.find(
        (item) =>
          item.status === 'active' &&
          [...item.attackers, ...item.defenders].includes(selected) &&
          [...item.attackers, ...item.defenders].includes(target),
      );
      return {
        type,
        attackerNationId: selected,
        targetNationId: target,
        conflictId: conflict?.id ?? 'conflict:select-existing',
        scale: 'major',
        abstraction: 'abstracted-effects-no-nuclear-weapons-model',
      };
    }
    case 'OPEN_CRISIS':
      return {
        type,
        crisis: {
          id: `crisis:${id}`,
          title: 'Regional security confrontation',
          type: 'security',
          participants: [selected, target],
          startDate: w.date,
          trigger: 'Contested security demand',
          issues: ['Military access'],
          demands: [{ nationId: target, text: 'No permanent foreign bases' }],
          militaryPosture: 20,
        },
      };
    case 'CRISIS_ACTION':
      return {
        type,
        crisisId:
          w.crises.find(
            (c) => c.status !== 'resolved' && c.participants.includes(selected),
          )?.id ?? 'crisis:select-existing',
        nationId: selected,
        move: 'talk',
      };
    case 'SET_ECONOMIC_LINK':
      return {
        type,
        link: {
          id: `economic:${id}`,
          dependentNationId: selected,
          partnerNationId: target,
          imports: 40,
          exports: 20,
          energy: 60,
          strategicGoods: 30,
          finance: 20,
        },
      };
    case 'IMPOSE_SANCTION':
      return {
        type,
        sanction: {
          id: `sanction:${id}`,
          issuer: selected,
          target,
          sector: 'energy',
          intensity: 50,
          startDate: w.date,
          reason: 'Pressure for negotiated security concessions',
        },
      };
    case 'LIFT_SANCTION':
      return {
        type,
        sanctionId:
          w.sanctions.find(
            (s) => s.issuer === selected && s.status === 'active',
          )?.id ?? 'sanction:select-existing',
        nationId: selected,
      };
    case 'OPEN_CONFERENCE':
      return {
        type,
        conference: {
          id: `conference:${id}`,
          title: 'Regional security talks',
          proposer: selected,
          parties: [
            ...new Set([selected, target, ...w.nations.map((n) => n.id)]),
          ].slice(0, 3),
          kind: 'security',
          terms: 'Joint consultation without basing rights',
          createdDate: w.date,
          expiresDate: new Date(Date.parse(w.date) + 90 * 86400000)
            .toISOString()
            .slice(0, 10),
        },
      };
    case 'RESPOND_CONFERENCE':
      return {
        type,
        conferenceId:
          w.conferences.find((c) => c.status === 'open')?.id ??
          'conference:select-existing',
        nationId: selected,
        move: 'accept',
        message: 'We agree to the current round terms',
      };
    case 'SCHEDULE_ELECTION':
      return {
        type,
        tenure: {
          id: `tenure:${id}`,
          nationId: selected,
          startDate: w.date,
          nextElectionDate: new Date(Date.parse(w.date) + 180 * 86400000)
            .toISOString()
            .slice(0, 10),
          termDays: 1460,
          incumbent: w.nations.find((n) => n.id === selected)!.leader,
          challenger: {
            name: 'Reform coalition cabinet',
            government: {
              type: 'Parliamentary coalition',
              ideology: 'Economic reform',
            },
            strategy: {
              ...w.nations.find((n) => n.id === selected)!.strategy,
              orientation: 'economic',
            },
          },
          issues: ['Economic capacity', 'Government legitimacy'],
        },
      };
    case 'REVISE_GOAL_EVALUATION':
      return {
        type,
        goalId:
          w.goals.find((g) => g.nationId === selected)?.id ??
          'goal:select-existing',
        evaluation: {
          kind: 'relationship',
          nationId: target,
          baseline: 0,
          target: 50,
        },
      };
    case 'SET_STRATEGY':
      return {
        type,
        nationId: selected,
        strategy: w.nations.find((n) => n.id === selected)!.strategy,
      };
    case 'START_INITIATIVE':
      return {
        type,
        initiative: {
          id: `initiative:${id}`,
          nationId: selected,
          name: 'Development investment',
          kind: 'industry',
          startDate: w.date,
          durationDays: 180,
          effort: 2,
          targetNationId: null,
          visibility: 'public',
          status: 'active',
          progress: 0,
          invested: 0,
          dependencies: [],
        },
      };
    case 'CANCEL_INITIATIVE':
      return {
        type,
        initiativeId:
          w.initiatives.find(
            (i) => i.nationId === selected && i.status === 'active',
          )?.id ?? 'initiative:select-existing',
      };
    case 'OPEN_NEGOTIATION': {
      const expiry = new Date(w.date + 'T00:00:00Z');
      expiry.setUTCDate(expiry.getUTCDate() + 90);
      return {
        type,
        negotiation: {
          id: `negotiation:${id}`,
          proposerNationId: selected,
          recipientNationId: target,
          topic: 'Development proposal',
          kind: 'trade',
          terms: 'Reciprocal commercial cooperation.',
          visibility: 'public',
          status: 'open',
          createdDate: w.date,
          expiresDate: expiry.toISOString().slice(0, 10),
          responses: [],
          treatyId: null,
        },
      };
    }
    case 'RESPOND_NEGOTIATION': {
      const n = w.negotiations.find((n) => n.status === 'open');
      return {
        type,
        negotiationId: n?.id ?? 'negotiation:select-existing',
        nationId: n?.recipientNationId ?? selected,
        move: 'accept',
        message: 'We accept the reciprocal terms.',
        ...(n?.kind === 'consultation' ? {} : { treatyId: `treaty:${id}` }),
      };
    }
    case 'CREATE_ORGANIZATION':
      return {
        type,
        organization: {
          id: `organization:${id}`,
          name: 'Development council',
          kind: 'regional',
          members: [selected, target],
          charter: 'Voluntary consultation on shared regional interests.',
        },
      };
    case 'SET_ORGANIZATION_MEMBERSHIP':
      return {
        type,
        organizationId:
          w.organizations[0]?.id ?? 'organization:select-existing',
        nationId: target,
        member: true,
      };
    case 'CONFLICT_ACTION': {
      const c = w.conflicts.find(
        (c) =>
          c.status === 'active' &&
          [...c.attackers, ...c.defenders].includes(selected),
      );
      return {
        type,
        conflictId: c?.id ?? 'conflict:select-existing',
        nationId: selected,
        stance: 'mobilize',
      };
    }
    case 'APPLY_DOMESTIC_PRESSURE':
      return {
        type,
        nationId: selected,
        amount: 5,
        cause: 'Development stress test: rising fiscal pressure.',
      };
    case 'MOBILIZE_FORCE':
      return { type, nationId: selected, level: 'full' };
    case 'CREATE_POLITY': {
      const selectedRegion = w.regions.find((entry) => entry.id === region)!;
      const parent = w.nations.find(
        (entry) => entry.id === selectedRegion.ownerNationId,
      )!;
      return {
        type,
        parentNationId: parent.id,
        polity: {
          id: `nation:dev-${id}` as NationId,
          name: `Independent ${selectedRegion.name}`,
          color: '#52766D',
          government: {
            type: 'Provisional council',
            ideology: 'regional autonomy',
          },
          leader: 'Interim council',
          stats: parent.stats,
        },
        regionIds: [selectedRegion.id],
      };
    }
    case 'TRANSFER_CONTROL':
    case 'TRANSFER_OWNERSHIP':
    case 'ADD_CLAIM':
    case 'REMOVE_CLAIM':
      return { type, regionId: region, nationId: target };
    case 'ADJUST_RELATION':
      return { type, nationA: selected, nationB: target, delta: 5 };
    case 'ADJUST_NATION_STAT':
      return { type, nationId: selected, stat: 'economy', delta: 5 };
    case 'CREATE_TREATY':
      return {
        type,
        treaty: {
          id: `treaty:${id}`,
          name: 'Development agreement',
          kind: 'defense',
          parties: [selected, target],
          status: 'active',
          terms: 'Synthetic mutual assistance commitment.',
        },
      };
    case 'UPDATE_TREATY':
      return {
        type,
        treatyId:
          w.treaties.find((t) => t.status === 'active')?.id ??
          'treaty:select-existing',
        terms: 'Revised synthetic terms.',
      };
    case 'END_TREATY':
      return {
        type,
        treatyId:
          w.treaties.find((t) => t.status === 'active')?.id ??
          'treaty:select-existing',
      };
    case 'START_CONFLICT':
      return {
        type,
        conflict: {
          id: `conflict:${id}`,
          name: 'Development crisis',
          attackers: [selected],
          defenders: [target],
          status: 'active',
          escalation: 20,
        },
      };
    case 'UPDATE_CONFLICT':
      return {
        type,
        conflictId:
          w.conflicts.find((c) => c.status === 'active')?.id ??
          'conflict:select-existing',
        escalation: 30,
      };
    case 'END_CONFLICT':
      return {
        type,
        conflictId:
          w.conflicts.find((c) => c.status === 'active')?.id ??
          'conflict:select-existing',
      };
    case 'UPDATE_GOVERNMENT':
      return {
        type,
        nationId: selected,
        government: {
          type: 'Development coalition',
          ideology: 'Synthetic pluralism',
        },
      };
    case 'UPDATE_LEADER':
      return { type, nationId: selected, leader: 'Development caretaker' };
    case 'CREATE_STRATEGIC_GOAL':
      return {
        type,
        goal: {
          id: `goal:${id}`,
          nationId: selected,
          title: 'Improve fiscal capacity',
          priority: 60,
          status: 'active',
          targetNationIds: [],
          progress: 0,
          reason: 'Sandbox directive',
          createdDate: w.date,
          updatedDate: w.date,
        },
      };
    case 'UPDATE_STRATEGIC_GOAL':
      return {
        type,
        goalId:
          w.goals.find((g) => g.nationId === selected && g.status === 'active')
            ?.id ?? 'goal:select-existing',
        status: 'active',
        priority: 80,
        progress: 25,
      };
    case 'CREATE_EVENT':
      return {
        type,
        event: {
          id: `event:${id}`,
          type: 'SANDBOX_NOTE',
          title: 'Development observation',
          nationIds: [selected],
          regionIds: [],
          treatyIds: [],
          conflictIds: [],
          importance: 30,
          topics: ['development'],
          visibility: 'public',
          status: 'resolved',
        },
      };
    case 'SET_OBSERVER_MODE':
      return { type, enabled: !w.observerMode };
    case 'SWITCH_NATION':
      return { type, nationId: target };
    case 'ADVANCE_DATE': {
      const date = new Date(w.date);
      date.setUTCDate(date.getUTCDate() + 7);
      return { type, date: date.toISOString().slice(0, 10) };
    }
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}
