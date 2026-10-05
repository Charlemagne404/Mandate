import {
  OrganizationCommitmentId,
  OrganizationId,
  OrganizationProgramId,
} from '@mandate/schemas';
import type {
  NationId,
  Organization as OrganizationValue,
  OrganizationKind,
  OrganizationProgram,
  WorldCommand,
  WorldState,
} from '@mandate/schemas';
import type { PlayerIntent } from './contracts.js';
import { resolveOrganizationGeographicSet } from '@mandate/scenarios';

export interface OrganizationExecution {
  commands: Array<{ command: WorldCommand; reason: string }>;
  handledClauseIds: Set<number>;
  audits: Array<{
    actionId: string;
    text: string;
    status: 'EXECUTED' | 'ATTEMPTED' | 'BLOCKED';
    explanation: string;
    commandTypes: string[];
  }>;
}

const slug = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 68) || 'new-organization';
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const titleCase = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(
      /\b\p{L}[\p{L}'’-]*/gu,
      (word) =>
        `${word[0]!.toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`,
    );

function organizationKind(text: string): OrganizationKind {
  if (/federation/i.test(text)) return 'political-organization';
  if (/customs union/i.test(text)) return 'customs-union';
  if (/economic union/i.test(text)) return 'economic-union';
  if (/trade bloc/i.test(text)) return 'trade-bloc';
  if (/defen[cs]e pact|mutual defen[cs]e/i.test(text)) return 'defensive-pact';
  if (/military alliance|defen[cs]e alliance/i.test(text))
    return 'military-alliance';
  if (/political organization|political organisation/i.test(text))
    return 'political-organization';
  if (/regional organization|regional organisation/i.test(text))
    return 'regional-organization';
  if (/regional/i.test(text)) return 'regional-organization';
  if (/economic|trade/i.test(text)) return 'economic';
  if (/alliance/i.test(text)) return 'alliance';
  if (/organization|organisation/i.test(text))
    return 'international-organization';
  return 'institution';
}

function descriptor(text: string) {
  const acronymMatch = text.match(
    /\b([A-Z][A-Z0-9]{1,9})\s*\(\s*([^)]{4,150})\s*\)/,
  );
  const create = text.match(
    /\b(?:creat\w*|form\w*|establish\w*|found\w*)\s+(?:the\s+|a\s+|an\s+)?(.+)$/i,
  );
  const sourceName = acronymMatch?.[2] ?? create?.[1] ?? text;
  const cleanedName = sourceName
    .replace(/^the\s+/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+(?:and\s+)?invites?\b.*$/i, '')
    .replace(/[.!?;].*$/s, '')
    .trim();
  const typeAndScope = cleanedName.match(
    /^(economic|trade|military|defen[cs]e|customs|political|regional|international)\s+(union|bloc|alliance|pact|federation|organization|organisation)\s+(?:for|in|among)\s+(.+)$/i,
  );
  const name = typeAndScope
    ? (() => {
        const scope = titleCase(
          typeAndScope[3]!
            .replace(/^all\s+(?:countries|states)\s+in\s+/i, '')
            .replace(/^the\s+/i, ''),
        );
        const regionalName = scope.endsWith(' America')
          ? scope.slice(0, -' America'.length) + ' American'
          : scope;
        return (
          regionalName +
          ' ' +
          titleCase(typeAndScope[1]! + ' ' + typeAndScope[2]!)
        );
      })()
    : titleCase(cleanedName);
  const acronym = acronymMatch?.[1] ?? null;
  return { name, acronym, kind: organizationKind(`${text} ${name}`) };
}

function purposeText(text: string) {
  const match = text.match(
    /\b(?:focus(?:es)? on|purpose is|aims? to|objective is)\s+([^.!?;]+)/i,
  );
  return match?.[1]?.trim().replace(/[.]+$/, '') ?? null;
}

function referencedOrganization(
  world: WorldState,
  actorNationId: NationId,
  text: string,
  created: OrganizationValue | null,
) {
  if (created) return created;
  const found = world.organizations.find((organization) =>
    [organization.acronym, organization.name, organization.id].some(
      (reference) =>
        !!reference &&
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`,
          'iu',
        ).test(text),
    ),
  );
  if (found) return found;
  const actorOrganizations = world.organizations.filter(
    (organization) =>
      organization.status === 'active' &&
      (organization.members.includes(actorNationId) ||
        organization.founders.includes(actorNationId)),
  );
  if (actorOrganizations.length === 1) return actorOrganizations[0]!;
  const unambiguous = world.organizations.filter(
    (organization) => organization.status === 'active',
  );
  return unambiguous.length === 1 ? unambiguous[0]! : null;
}

function commitmentKind(text: string) {
  if (/subsid|economic support/i.test(text)) return 'economic-support' as const;
  if (/financial aid|aid/i.test(text)) return 'financial-aid' as const;
  if (/trade/i.test(text)) return 'trade-cooperation' as const;
  if (/sanctions?/i.test(text)) return 'sanctions-coordination' as const;
  if (/defen[cs]e|security|military/i.test(text))
    return 'security-cooperation' as const;
  return 'other' as const;
}

function organizationDimension(text: string): OrganizationProgram['dimension'] {
  if (
    /infrastructure|cross[- ]border|connect(?:ing)? (?:the )?(?:countries|members)/i.test(
      text,
    )
  )
    return 'regional-infrastructure';
  if (/customs union|customs cooperation/i.test(text))
    return 'customs-cooperation';
  if (/common standards|shared standards/i.test(text))
    return 'common-standards';
  if (/sanctions?/i.test(text)) return 'sanctions-coordination';
  if (/development fund|common fund/i.test(text)) return 'development-funding';
  if (/politic|unified .*front|common front/i.test(text))
    return 'political-coordination';
  if (/foreign policy|diplomatic position|world stage/i.test(text))
    return 'joint-diplomacy';
  return 'economic-integration';
}

function programTitle(dimension: OrganizationProgram['dimension']) {
  const titles: Record<OrganizationProgram['dimension'], string> = {
    'economic-integration': 'Regional Economic Integration Program',
    'regional-infrastructure': 'Regional Infrastructure Program',
    'customs-cooperation': 'Customs Cooperation Program',
    'common-standards': 'Common Standards Program',
    'political-coordination': 'Political Coordination Proposal',
    'joint-diplomacy': 'Joint Diplomatic Coordination Program',
    'development-funding': 'Common Development Fund',
    'sanctions-coordination': 'Coordinated Sanctions Program',
  };
  return titles[dimension];
}

function programMonthlyCost(dimension: OrganizationProgram['dimension']) {
  if (dimension === 'regional-infrastructure') return 3;
  if (dimension === 'development-funding') return 4;
  if (dimension === 'political-coordination' || dimension === 'joint-diplomacy')
    return 0;
  return 1;
}

function createOrganization(
  world: WorldState,
  actorNationId: NationId,
  text: string,
  fullText: string,
) {
  const parsed = descriptor(text);
  const id = OrganizationId.parse(
    `organization:${slug(parsed.acronym ?? parsed.name)}`,
  );
  const existing = world.organizations.find(
    (organization) => organization.id === id,
  );
  if (existing) return { organization: existing, command: null };
  const geographicSet = resolveOrganizationGeographicSet(
    world,
    actorNationId,
    fullText,
  );
  const purpose =
    purposeText(fullText) ??
    (parsed.kind === 'economic-union' || parsed.kind === 'trade-bloc'
      ? 'Support gradual economic integration among participating governments.'
      : `Cooperation among participating governments under the ${parsed.name} charter.`);
  const organization: OrganizationValue = {
    id,
    name: parsed.name,
    acronym: parsed.acronym,
    kind: parsed.kind,
    foundingDate: world.date,
    founders: [actorNationId],
    members: [actorNationId],
    invitedStates: [],
    invitations: [],
    pendingApplications: [],
    purpose,
    charter: purpose,
    commitments: [],
    development: [],
    programs: [],
    geographicScope: geographicSet?.label ?? null,
    history: [],
    status: 'active',
    dissolvedDate: null,
    visibility: 'public',
  };
  return {
    organization,
    command: {
      type: 'CREATE_ORGANIZATION',
      organization,
    } satisfies WorldCommand,
  };
}

/** Translate grounded organization clauses into typed, consent-preserving commands. */
export function executeOrganizationIntent(
  world: WorldState,
  intent: PlayerIntent,
  run: string,
): OrganizationExecution {
  const result: OrganizationExecution = {
    commands: [],
    handledClauseIds: new Set(),
    audits: [],
  };
  const nodes = intent.actionGraph?.actions ?? [];
  let created: OrganizationValue | null = null;
  const fullText = intent.actionGraph?.rawInput ?? intent.summary;
  const add = (command: WorldCommand, reason: string) =>
    result.commands.push({ command, reason });

  for (const node of nodes) {
    if (
      ![
        'create-organization',
        'invite-organization',
        'organization-purpose',
        'organization-commitment',
        'organization-program',
        'organization-membership',
        'dissolve-organization',
      ].includes(node.action)
    )
      continue;
    if (
      node.action === 'organization-membership' &&
      /\b(?:make|tell|require|demand|ask|order)\s+(?:the\s+)?(.+?)\s+(?:to\s+)?(?:leave|exit|withdraw from|break)\b/i.test(
        node.text,
      ) &&
      node.targets.some((nationId) => nationId !== intent.actorNationId)
    )
      continue;
    result.handledClauseIds.add(node.clauseId);
    const before = result.commands.length;
    let explanation: string;
    let materiallyRepresented = false;
    if (node.issues.length) {
      result.audits.push({
        actionId: node.id,
        text: node.text,
        status: 'BLOCKED',
        explanation: node.issues.join('; '),
        commandTypes: [],
      });
      continue;
    }

    if (node.action === 'create-organization') {
      const built = createOrganization(
        world,
        intent.actorNationId,
        node.text,
        fullText,
      );
      created = built.organization;
      if (built.command)
        add(
          built.command,
          `Found ${built.organization.name} as ordered by the player in: ${node.text}`,
        );
      explanation = built.command
        ? `${built.organization.name} was created with ${world.nations.find((nation) => nation.id === intent.actorNationId)!.name} as its founding member.`
        : `${built.organization.name} already exists; its canonical record was retained.`;
    } else if (node.action === 'invite-organization') {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      if (!organization) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'No existing or newly created organization is explicitly referenced by this invitation.',
          commandTypes: [],
        });
        continue;
      }
      const recipients = [...new Set(node.participants)].filter(
        (id) =>
          id !== intent.actorNationId &&
          !organization.members.includes(id) &&
          world.nations.some((nation) => nation.id === id),
      );
      for (const nationId of recipients)
        add(
          {
            type: 'INVITE_TO_ORGANIZATION',
            organizationId: organization.id,
            inviterNationId: intent.actorNationId,
            nationId,
          },
          `${node.text} Resolved recipient from grounded text, scenario geography, or an established organization reference.`,
        );
      explanation = `Issued ${recipients.length} invitation${recipients.length === 1 ? '' : 's'} to ${organization.name}; recipients must decide independently.`;
    } else if (node.action === 'organization-purpose') {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      const purpose = purposeText(node.text);
      const kind = /turn .+ into/i.test(node.text)
        ? organizationKind(node.text)
        : undefined;
      if (!organization || (!purpose && !kind)) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'A purpose clause needs a referenced active organization and explicit purpose wording.',
          commandTypes: [],
        });
        continue;
      }
      add(
        {
          type: 'UPDATE_ORGANIZATION',
          organizationId: organization.id,
          issuerNationId: intent.actorNationId,
          ...(purpose ? { purpose } : {}),
          charter: purpose ?? `${node.text.trim()} ${organization.purpose}`,
          ...(kind ? { kind } : {}),
        },
        `Record the player's stated purpose for ${organization.name}: ${purpose}`,
      );
      explanation = `${organization.name}'s stated purpose and charter were updated.`;
    } else if (node.action === 'organization-commitment') {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      if (!organization) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'No referenced organization can own this membership commitment.',
          commandTypes: [],
        });
        continue;
      }
      const targets = [...new Set(node.targets)].filter(
        (id) => id !== intent.actorNationId,
      );
      const joiningTerms =
        /any country that joins|new members|if (?:it|they|that country) joins|that joins/i.test(
          node.text,
        );
      const appliesTo: 'all-members' | 'new-members' | 'specific-members' =
        /every|all (?:the )?(?:current )?members/i.test(node.text)
          ? 'all-members'
          : joiningTerms
            ? 'new-members'
            : targets.length
              ? 'specific-members'
              : 'all-members';
      const recipients =
        appliesTo === 'specific-members' || joiningTerms ? targets : [];
      const text = node.text.trim();
      const costPerMember =
        /subsid|financial aid|economic support|support/i.test(text)
          ? /larger|double|triple/i.test(text)
            ? 4
            : /financial aid|aid/i.test(text) && !/subsid/i.test(text)
              ? 1
              : 2
          : 0;
      const commitment = {
        id: OrganizationCommitmentId.parse(
          `orgcommitment:${slug(`${organization.id}-${run}-${node.clauseId}`)}`,
        ),
        issuer: intent.actorNationId,
        kind: commitmentKind(text),
        terms: text,
        appliesTo,
        recipientNationIds: recipients,
        costPerMember,
        frequencyDays: 30,
        status: 'active' as const,
        createdDate: world.date,
        lastPaymentDate: null,
        nextPaymentDate: new Date(Date.parse(world.date) + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        lastPaymentAmount: 0,
        totalPaid: 0,
        paymentsMade: 0,
        reportedPaymentMilestones: [],
        originatingActionId: null,
      };
      add(
        {
          type: 'ADD_ORGANIZATION_COMMITMENT',
          organizationId: organization.id,
          commitment,
        },
        `Record ${world.nations.find((nation) => nation.id === intent.actorNationId)!.name}'s commitment to ${organization.name}; the offer costs ${costPerMember} treasury units per participating member each month when exercised.`,
      );
      explanation = `The offer was recorded as a ${commitment.kind} commitment with a recurring cost of ${costPerMember} treasury units per participating member.`;
    } else if (node.action === 'organization-program') {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      if (!organization) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'No active organization can own this regional program proposal.',
          commandTypes: [],
        });
        continue;
      }
      if (!organization.members.includes(intent.actorNationId)) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'The proposing government must be a current organization member.',
          commandTypes: [],
        });
        continue;
      }
      const dimension = organizationDimension(node.text);
      const plannedProgram = result.commands.find(
        (entry) =>
          entry.command.type === 'START_ORGANIZATION_PROGRAM' &&
          entry.command.organizationId === organization.id &&
          entry.command.program.dimension === dimension,
      );
      if (plannedProgram?.command.type === 'START_ORGANIZATION_PROGRAM') {
        plannedProgram.command.program.terms =
          `${plannedProgram.command.program.terms} ${node.text}`.slice(0, 4000);
        plannedProgram.reason += ` This same-turn clause is included in the proposal: ${node.text}`;
        materiallyRepresented = true;
        explanation = `This clause is included in the ${plannedProgram.command.program.title} proposal already created for ${organization.name}.`;
      } else {
        const existing = organization.programs.find(
          (program) =>
            program.dimension === dimension &&
            ['proposed', 'active', 'suspended'].includes(program.status),
        );
        if (existing) {
          explanation = `${organization.name} already has a ${existing.status} ${programTitle(dimension).toLocaleLowerCase()}; the existing program remains canonical.`;
        } else {
          const participants = organization.members.filter(
            (member) => member !== intent.actorNationId,
          );
          const program = {
            id: OrganizationProgramId.parse(
              `orgprogram:${slug(`${organization.id}-${run}-${node.clauseId}-${dimension}`)}`,
            ),
            dimension,
            title: programTitle(dimension),
            terms: node.text.trim(),
            issuerNationId: intent.actorNationId,
            participantNationIds: participants,
            responses: participants.map((nationId) => ({
              nationId,
              move: 'pending' as const,
              decidedDate: null,
              message: null,
              counterTerms: null,
            })),
            status: 'proposed' as const,
            stage: 'consultation' as const,
            progress: 0,
            monthlyCost: programMonthlyCost(dimension),
            totalInvested: 0,
            paymentCount: 0,
            lastPaymentDate: null,
            createdDate: world.date,
            updatedDate: world.date,
            completedDate: null,
            reportedMilestones: [],
            originatingActionId: null,
          } satisfies OrganizationProgram;
          add(
            {
              type: 'START_ORGANIZATION_PROGRAM',
              organizationId: organization.id,
              program,
            },
            `Create a stateful ${dimension} program in ${organization.name} from the player's order: ${node.text}`,
          );
          explanation = `${program.title} was created as a multilateral proposal. Each current member will respond independently; approval starts a funded program with dated stages and milestones.`;
        }
      }
    } else if (node.action === 'organization-membership') {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      if (!organization) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation:
            'The organization to amend membership in is ambiguous or absent.',
          commandTypes: [],
        });
        continue;
      }
      const removed = node.targets.find((id) => id !== intent.actorNationId);
      if (/\b(?:kick|expel|remove)\b/i.test(node.text) && removed) {
        add(
          {
            type: 'REMOVE_ORGANIZATION_MEMBER',
            organizationId: organization.id,
            issuerNationId: intent.actorNationId,
            nationId: removed,
          },
          node.text,
        );
        explanation = `Requested removal of ${world.nations.find((nation) => nation.id === removed)!.name}; founding authority and membership are validated before commit.`;
      } else {
        add(
          {
            type: 'SET_ORGANIZATION_MEMBERSHIP',
            organizationId: organization.id,
            nationId: intent.actorNationId,
            member: false,
          },
          node.text,
        );
        explanation = `${world.nations.find((nation) => nation.id === intent.actorNationId)!.name} ordered its own withdrawal from ${organization.name}.`;
      }
    } else {
      const organization = referencedOrganization(
        world,
        intent.actorNationId,
        node.text,
        created,
      );
      if (!organization) {
        result.audits.push({
          actionId: node.id,
          text: node.text,
          status: 'BLOCKED',
          explanation: 'The organization to dissolve is ambiguous or absent.',
          commandTypes: [],
        });
        continue;
      }
      add(
        {
          type: 'DISSOLVE_ORGANIZATION',
          organizationId: organization.id,
          issuerNationId: intent.actorNationId,
        },
        node.text,
      );
      explanation = `${organization.name} dissolution was ordered; founding authority is validated before commit.`;
    }

    const commands = result.commands
      .slice(before)
      .map((entry) => entry.command.type);
    result.audits.push({
      actionId: node.id,
      text: node.text,
      status:
        commands.length || materiallyRepresented ? 'EXECUTED' : 'ATTEMPTED',
      explanation,
      commandTypes: commands.length
        ? commands
        : materiallyRepresented
          ? ['START_ORGANIZATION_PROGRAM']
          : [],
    });
  }

  return result;
}
