import {
  resolveCapitalOwnerIds,
  resolveOrganizationGeographicSet,
} from '@mandate/scenarios';
import { SemanticGraph } from '@mandate/schemas';
import { isInfluenceProposal } from './influence-intent.js';
import type {
  NationId,
  RegionId,
  WorldState,
  WorldCommand,
  SemanticAction,
  SemanticGraph as Graph,
  ActionGrounding,
} from '@mandate/schemas';
import type { z } from 'zod';

type Input = {
  actorNationId: NationId;
  text: string;
  grounding?: z.infer<typeof ActionGrounding> | undefined;
};
const verb =
  "(?:do not|don't|never|avoid|mobiliz\\w*|demand\\w*|offer\\w*|ask|tell|sanction\\w*|cancel\\w*|keep|guarantee\\w*|invad\\w*|annex\\w*|attack\\w*|nuk\\w*|bomb\\w*|take|steal\\w*|seize\\w*|give|cede|transfer\\w*|launch\\w*|start\\w*|send\\w*|deploy\\w*|make|use\\w*|negotia\\w*|threaten\\w*|declare|increase|raise|invest|reinforce|expand|reform|begin\\w*|improve|reduce|build\\w*|deepen\\w*|integrat\\w*|coordinate\\w*|propos\\w*|spend|cut|move|commit|withdraw|recogniz\\w*|invit\\w*|dissolv\\w*|disband\\w*|join|quit|expel|found\\w*|creat\\w*)";
export function semanticClauses(text: string): string[] {
  const clauses = text
    .replace(
      /before invading ([^,.!?;]+),\s*mobiliz(?:e|ing)/gi,
      'mobilize; then invade $1',
    )
    .replace(
      /after mobilizing,\s*invade ([^.!?;]+)/gi,
      'mobilize; then invade $1',
    )
    .replace(
      /mobilize before invading ([^.!?;]+)/gi,
      'mobilize; then invade $1',
    )
    .replace(/invade ([^.!?;]+) after mobilizing/gi, 'mobilize; then invade $1')
    .replace(/\bat the same time[,\s]+/gi, 'simultaneously ')
    .replace(/\b((?:if|unless|once|after|until)\b[^.!?;,]+),\s*/gi, '$1 § ')
    .replace(
      /\band uses?\s+(.{0,60}?)\s+to\s+(?=invad|attack|strike)/gi,
      '; use $1 to ',
    )
    .split(
      new RegExp(
        `(?:[.!?;]\\s+|\\n+|,?\\s+(?:and|but|then|while|simultaneously|otherwise)\\s+(?=(?:(?:it|they|we)\\s+)?(?:(?:also|further|additionally)\\s+)?(?:if\\b|${verb}))|,\\s+(?=${verb})|\\s+to\\s+(?=(?:take|seize|occupy|annex|conquer)\\b))`,
        'i',
      ),
    )
    .map((s) => s.replaceAll('§', ',').trim())
    .filter(Boolean);
  if (clauses.length > 40)
    throw new Error(
      'The order exceeds the 40-action interpretation limit; no clauses were discarded.',
    );
  return clauses;
}
const unique = <T>(values: T[]) => [...new Set(values)];
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
interface Mention {
  id: NationId;
  start: number;
  end: number;
}
export function nationMentions(world: WorldState, text: string): Mention[] {
  const aliases: Record<string, string[]> = {
    'United States of America': [
      'United States',
      'USA',
      'U.S.',
      'US',
      'America',
    ],
    'United Kingdom': ['Britain', 'UK', 'British'],
    Finland: ['Finnish', 'Finlnad', 'Finand'],
    Sweden: ['Swedish'],
    Russia: ['Russian'],
    Norway: ['Norwegian'],
    Germany: ['German'],
    France: ['French'],
    China: ['Chinese'],
  };
  const found: Mention[] = [];
  for (const n of world.nations)
    for (const name of [n.name, n.id, ...(aliases[n.name] ?? [])]) {
      const re = new RegExp(
        `(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`,
        'giu',
      );
      for (const m of text.matchAll(re)) {
        if (name === 'US' && m[0] !== 'US') continue;
        if (
          name === 'America' &&
          /\b(?:central|north|south|latin)\s+$/i.test(text.slice(0, m.index))
        )
          continue;
        found.push({ id: n.id, start: m.index!, end: m.index! + m[0].length });
      }
    }
  return found
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter(
      (m, i, all) =>
        !all.slice(0, i).some((x) => x.start === m.start && x.id === m.id),
    );
}
/** Match complete regional names and discard shorter names inside a longer match. */
export function regionMentions(world: WorldState, text: string) {
  const lower = text.toLocaleLowerCase();
  const candidates = world.regions.flatMap((region) => {
    const escaped = region.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!lower.includes(region.name.toLocaleLowerCase())) return [];
    const matches = [
      ...text.matchAll(
        new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      ),
    ];
    return matches.map((match) => ({
      region,
      start: match.index!,
      end: match.index! + match[0].length,
    }));
  });
  const longest = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.end - other.start > candidate.end - candidate.start &&
          other.start <= candidate.start &&
          other.end >= candidate.end,
      ),
  );
  const named = longest.map(({ region }) => region);
  const ids = world.regions.filter((region) => {
    const escaped = region.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text);
  });
  if (
    /\b(?:take|annex|conquer|claim|demand|seize|occupy|invad\w*|give|cede|transfer)\b[^.!?;]{0,80}\b(?:northern|north)\s+finland\b/i.test(
      text,
    )
  ) {
    const finland = world.nations.find((nation) => nation.name === 'Finland');
    if (finland)
      ids.push(
        ...world.regions.filter(
          (region) =>
            region.ownerNationId === finland.id &&
            ['Lapland', 'Northern Ostrobothnia', 'Kainuu'].includes(
              region.name,
            ),
        ),
      );
  }
  return [
    ...new Map(
      [...ids, ...named].map((region) => [region.id, region]),
    ).values(),
  ];
}
function classify(
  text: string,
  organizations: WorldState['organizations'] = [],
): SemanticAction['action'] {
  text = text.replace(/^please\s+/i, '');
  if (
    /\b(?:creat\w*|form\w*|establish\w*|found\w*)\b[^.!?;]{0,180}\b(?:economic|trade|military|defen[cs]e|customs|political|regional|international)?\s*(?:union|bloc|alliance|pact|federation|organization|organisation)\b/i.test(
      text,
    )
  )
    return 'create-organization';
  if (/\b(?:invit\w*|invitation|invitees)\b/i.test(text))
    return 'invite-organization';
  if (/\b(?:dissolve|disband)\b/i.test(text)) return 'dissolve-organization';
  if (
    /\b(?:leave|quit|withdraw from|kick|expel|remove)\b/i.test(text) &&
    (/\b(?:organization|organisation|union|bloc|alliance|pact|member)\b/i.test(
      text,
    ) ||
      organizations.some((organization) =>
        [organization.acronym, organization.name, organization.id].some(
          (reference) =>
            !!reference &&
            new RegExp(
              `(?<![\\p{L}\\p{N}])${escaped(reference)}(?![\\p{L}\\p{N}])`,
              'iu',
            ).test(text),
        ),
      ) ||
      (organizations.filter((organization) => organization.status === 'active')
        .length === 1 &&
        /\b(?:kick|expel|remove)\b/i.test(text)))
  )
    return 'organization-membership';
  if (
    /\b(?:focus(?:es)? on|purpose is|aims? to|objective is|turn .+ into)\b/i.test(
      text,
    ) &&
    /\b(?:economic|trade|integration|customs|union|organization|organisation|alliance|bloc|pact|federation)\b/i.test(
      text,
    )
  )
    return 'organization-purpose';
  if (
    isInfluenceProposal(text) &&
    /\b(?:security guarantee|foreign[- ]policy|rival alliances?|debt relief|market access|puppet|protectorate|client state|subject state|patron)\b/i.test(
      text,
    )
  )
    return 'offer';
  if (
    /\b(?:subsid\w*|financial aid|economic support|support any country|support member|coordinate sanctions|sanctions coordination)\b/i.test(
      text,
    ) &&
    /\b(?:join|member|organization|organisation|union|bloc)\w*\b/i.test(text)
  )
    return 'organization-commitment';
  const organizationReferenced = organizations.some((organization) =>
    [organization.acronym, organization.name, organization.id].some(
      (reference) =>
        !!reference &&
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escaped(reference)}(?![\\p{L}\\p{N}])`,
          'iu',
        ).test(text),
    ),
  );
  const unambiguousOrganization =
    organizations.filter((organization) => organization.status === 'active')
      .length === 1;
  if (
    /\b(?:integrat\w*|free trade|tariff coordination|customs union|common standards|infrastructure|connect(?:ing)? (?:the )?(?:countries|members)|political (?:coordination|collaboration)|coordinate foreign policy|coordinate diplomatic positions|unified (?:regional |central american )?front|common development fund|coordinate sanctions)\b/i.test(
      text,
    ) &&
    (organizationReferenced ||
      unambiguousOrganization ||
      /\b(?:regional|cross[- ]border|central american|between (?:the )?countries|between (?:the )?members|connect(?:ing)? (?:the )?(?:countries|members))\b/i.test(
        text,
      ))
  )
    return 'organization-program';
  if (
    /\b(?:create|form|declare|establish|found|make)\b[^.!?;]{0,100}\b(?:independent|independence|breakaway|new state|polity|federation|union)\b|\bsecede\b/i.test(
      text,
    )
  )
    return 'form-polity';
  if (
    /\b(?:diplomatic initiative|diplomacy|closer.*cooperation|talks|propos\w*)\b/i.test(
      text,
    )
  )
    return 'offer';
  if (/^demand\b/i.test(text)) return 'demand';
  if (/^(?:then\s+)?tell\b/i.test(text)) return 'communicate';
  if (
    /\b(?:take|steal\w*|seize\w*|control)\b.*\b(?:army|armies|forces|navy|troops|military)\b/i.test(
      text,
    )
  )
    return 'acquire-forces';
  if (/\b(?:cyberattack|disrupt\w*)\b/i.test(text)) return 'disrupt';
  if (/\b(?:propaganda|influence)\b/i.test(text)) return 'influence';
  if (
    /\b(?:annex\w*|conquer\w*|take over)\b/i.test(text) ||
    /\btake\b.*\b(?:country|nation|territory)\b/i.test(text) ||
    /^\s*(?:fuck it[, ]+)?take\s+/i.test(text)
  )
    return 'annex';
  if (/\bask\b.*\b(?:invad|attack)/i.test(text)) return 'request-participation';
  if (/\b(?:invad\w*|invasion)\b/i.test(text)) return 'invade';
  if (/\buse\w*\b.*\bagainst\b/i.test(text)) return 'strike';
  if (
    /\b(?:nuk\w*|nuclear(?:[- ]scale)? (?:attack|strike|weapons?)|bomb\w*|strike|attack\w*)\b/i.test(
      text,
    )
  )
    return 'strike';
  if (/\b(?:mobiliz\w*|deploy\w*|send\w*|move)\b/i.test(text))
    return 'mobilize';
  if (/\b(?:demand\w*|threaten\w*)\b/i.test(text)) return 'demand';
  if (/\b(?:give|cede|transfer)\b/i.test(text)) return 'transfer';
  if (/\b(?:cancel\w*|break|leave|withdraw)\b/i.test(text)) return 'cancel';
  if (/\bsanction\w*\b/i.test(text)) return 'sanction';
  if (/\b(?:guarantee\w*)\b/i.test(text)) return 'guarantee';
  if (/\b(?:make peace|peace|ceasefire)\b/i.test(text)) return 'peace';
  if (/\b(?:demand\w*|threaten\w*)\b/i.test(text)) return 'demand';
  if (/\b(?:offer\w*|ask|negotia\w*|join)\b/i.test(text)) return 'offer';
  if (/\b(?:tell|reassure|warn)\b/i.test(text)) return 'communicate';
  return 'other';
}
function conditionPredicate(
  text: string,
): SemanticAction['conditions'][number]['predicate'] {
  if (/refus|reject|said no|say no/i.test(text)) return 'refused';
  if (/accept|surrender|agree/i.test(text)) return 'accepted';
  if (/attack|invad/i.test(text)) return 'attack';
  if (/join/i.test(text)) return 'joined';
  if (/withdraw/i.test(text)) return 'withdrawn';
  return 'unknown';
}
/** Code-owned roles and stable references. Unresolved references block execution. */
export function buildSemanticGraph(
  world: WorldState,
  input: Input,
  withContext = true,
): Graph {
  const graph: Graph = {
    version: 1,
    rawInput: input.text,
    grounding: input.grounding ?? {},
    actions: [],
    targetSets: [],
    references: [],
    repairs: [],
  };
  const clauses = semanticClauses(input.text);
  let lastTargets: NationId[] = [];
  let lastRegions: RegionId[] = [];
  let lastSet = '';
  let acquired: SemanticAction | undefined;
  let lastCondition: SemanticAction['conditions'][number] | undefined;
  const revisions = new Map(world.turns.map((t) => [t.actionId, t.revision]));
  const priorAction = withContext
    ? world.actions
        .filter(
          (a) =>
            a.source === 'player' && a.actorNationId === input.actorNationId,
        )
        .sort((a, b) => (revisions.get(a.id) ?? 0) - (revisions.get(b.id) ?? 0))
        .at(-1)
    : undefined;
  const priorGraph =
    priorAction?.semanticGraph ??
    (priorAction ? buildSemanticGraph(world, priorAction, false) : undefined);
  const priorNode = priorGraph?.actions.filter((a) => a.targets.length).at(-1);
  const negotiations = world.negotiations.filter((n) =>
    [n.proposerNationId, n.recipientNationId].includes(input.actorNationId),
  );
  const recentNegotiation = negotiations
    .sort(
      (a, b) =>
        a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id),
    )
    .at(-1);
  const contextTargets =
    priorNode?.targets ??
    (recentNegotiation
      ? [
          recentNegotiation.proposerNationId === input.actorNationId
            ? recentNegotiation.recipientNationId
            : recentNegotiation.proposerNationId,
        ]
      : []);
  for (const [clauseId, raw] of clauses.entries()) {
    const id = `semantic:${clauseId}`;
    const conditions: SemanticAction['conditions'] = [];
    const suffixCondition = raw.match(
      /^(.+?)\s+(if|unless|once|until)\s+(.+)$/i,
    );
    const conditionalRaw = (
      suffixCondition
        ? `${suffixCondition[2]} ${suffixCondition[3]}, ${suffixCondition[1]}`
        : raw
    ).replace(
      /^(?:please\s+)?((?:if|unless|once)\s+.+?\b(?:refuse\w*|reject\w*|surrender\w*|accept\w*|join\w*))\s+(?=do not|don't|annex|invad|mobiliz|cancel|guarantee|enter|start)/i,
      '$1, ',
    );
    const conditional = conditionalRaw
      .replace(/^please\s+/i, '')
      .match(/^(?:then\s+)?(if|unless|once|after|until)\s+(.+?)[,:]\s*(.+)$/i);
    const text = conditional?.[3] ?? raw;
    const conditionMentions = conditional
      ? unique(nationMentions(world, conditional[2]!).map((m) => m.id))
      : [];
    let kind = classify(text, world.organizations);
    const conditionalPressureText =
      /\b(?:threaten|warn|cut|withdraw|suspend|cancel)\b/i.test(raw) &&
      /\b(?:if|unless)\b/i.test(raw);
    if (
      classify(raw, world.organizations) === 'organization-commitment' &&
      !conditionalPressureText
    )
      kind = 'organization-commitment';
    const mentions = nationMentions(world, text).filter(
      (m) => m.id !== input.actorNationId,
    );
    const capitals = resolveCapitalOwnerIds(
      text,
      new Set(world.nations.map((n) => n.id)),
    ).filter((n) => n !== input.actorNationId) as NationId[];
    const regions = regionMentions(world, text).filter(
      (r) =>
        !world.nations.some(
          (n) => n.name.toLowerCase() === r.name.toLowerCase(),
        ),
    );
    let targets = unique([...mentions.map((m) => m.id), ...capitals]);
    const sources: NationId[] = [];
    const participants: NationId[] = [];
    const beneficiaries: NationId[] = [];
    let territories = unique(regions.map((r) => r.id));
    if (
      [
        'create-organization',
        'invite-organization',
        'organization-purpose',
        'organization-commitment',
        'organization-program',
        'dissolve-organization',
      ].includes(kind)
    )
      territories = [];
    if (
      kind !== 'transfer' &&
      /\b(?:annex|invad\w*|conquer\w*|claim\w*|seize\w*|occupy|take|demand\w*|territorial objective)\b/i.test(
        text,
      ) &&
      targets.length
    ) {
      const targetSet = new Set(targets);
      territories = territories.filter((id) =>
        targetSet.has(
          world.regions.find((region) => region.id === id)!.ownerNationId,
        ),
      );
    }
    const issues: string[] = [];
    const dependencies: SemanticAction['dependencies'] = [];
    const instruments: string[] = [];
    const assets = unique(
      [
        ...text.matchAll(
          /\b(?:army|armies|forces|navy|troops|military|power grid|energy grid|tanks|missiles|basing rights)\b/gi,
        ),
      ].map((m) => m[0].toLowerCase()),
    );
    if (kind === 'invite-organization') {
      const geographicSet =
        resolveOrganizationGeographicSet(world, input.actorNationId, text) ??
        (/\bregion\b/i.test(text)
          ? resolveOrganizationGeographicSet(
              world,
              input.actorNationId,
              input.text,
            )
          : null);
      if (geographicSet) {
        participants.push(...geographicSet.nationIds);
        graph.references.push({
          actionId: id,
          expression: /\bregion\b/i.test(text)
            ? 'the region'
            : geographicSet.expression,
          role: 'target',
          origin: 'geography',
          antecedentId: `geography:${geographicSet.groupId}`,
          nationIds: geographicSet.nationIds,
          regionIds: [],
        });
      }
      participants.push(...mentions.map((mention) => mention.id));
      participants.splice(
        0,
        participants.length,
        ...unique(participants).filter(
          (nationId) => nationId !== input.actorNationId,
        ),
      );
      if (!participants.length)
        issues.push(
          'Invitation recipients are neither named nor resolved from scenario geography',
        );
      targets = [];
    }
    if (kind === 'acquire-forces') {
      sources.push(...targets);
      targets = [];
    }
    const attackPos = text.search(/\b(?:invad\w*|attack\w*|against)\b/i);
    if (attackPos >= 0 && kind !== 'acquire-forces') {
      const prefixMentions = mentions.filter((m) => m.end <= attackPos);
      if (/\b(?:use|using)\b/i.test(text.slice(0, attackPos)))
        sources.push(...prefixMentions.map((m) => m.id));
      else if (/\b(?:ask|help|with us)\b/i.test(text))
        participants.push(...prefixMentions.map((m) => m.id));
      if (sources.length || participants.length)
        targets = unique(
          mentions.filter((m) => m.start > attackPos).map((m) => m.id),
        );
    }
    if (kind === 'transfer') {
      beneficiaries.push(...targets);
      sources.push(input.actorNationId);
    }
    if (
      territories.length &&
      !targets.length &&
      kind !== 'transfer' &&
      ![
        'create-organization',
        'invite-organization',
        'organization-purpose',
        'organization-commitment',
        'dissolve-organization',
      ].includes(kind)
    )
      targets = unique(
        regions
          .map((r) => r.ownerNationId)
          .filter((n) => n !== input.actorNationId),
      );
    const actorReference = text.match(
      /^(?:then\s+)?(it|they)\s+(?=annex|invad|attack|demand|offer|mobiliz)/i,
    );
    if (actorReference)
      graph.references.push({
        actionId: id,
        expression: actorReference[1]!,
        role: 'actor',
        origin: 'text',
        antecedentId: 'player',
        nationIds: [input.actorNationId],
        regionIds: [],
      });
    const referenceText = text.replace(
      /^(?:then\s+)?(?:it|they)\s+(?=annex|invad|attack|demand|offer|mobiliz)/i,
      '',
    );
    const ref = referenceText.match(
      /\b(both countries|both states|both|those countries|those states|them|they|their|the former|the latter|that country|this region|this|it|these forces|those troops|the agreement|the proposal|the country|the nation)\b/i,
    );
    if (ref) {
      const expression = ref[0].toLowerCase();
      if (
        /these forces|those troops/.test(expression) ||
        (expression === 'it' && /\buse\w*\b/i.test(text) && acquired)
      ) {
        if (acquired) {
          instruments.push(`result:${acquired.id}`);
          dependencies.push({
            actionId: acquired.id,
            requirement: 'result',
            mandatory: !/otherwise|other means|our own|if possible/i.test(text),
          });
          graph.references.push({
            actionId: id,
            expression,
            role: 'instrument',
            origin: 'text',
            antecedentId: acquired.id,
            nationIds: acquired.sources,
            regionIds: [],
          });
        } else issues.push(`Unresolved force reference: ${expression}`);
      } else if (
        /^(?:it|they)$/.test(expression) &&
        new RegExp(`^(?:then\\s+)?${expression}\\s+${verb}`, 'i').test(text)
      ) {
        graph.references.push({
          actionId: id,
          expression,
          role: 'actor',
          origin: 'text',
          antecedentId: 'player',
          nationIds: [input.actorNationId],
          regionIds: [],
        });
      } else if (
        /both/.test(expression) &&
        targets.length === 2 &&
        mentions.filter((m) => m.start > text.toLowerCase().indexOf(expression))
          .length >= 2
      ) {
        graph.references.push({
          actionId: id,
          expression,
          role: 'target',
          origin: 'text',
          antecedentId: `set:${id}`,
          nationIds: targets,
          regionIds: territories,
        });
      } else if (
        !targets.length ||
        /both|former|latter|this region/.test(expression)
      ) {
        let resolved = conditionMentions.length
          ? conditionMentions
          : lastTargets;
        let resolvedRegions = lastRegions;
        let origin: 'text' | 'map' | 'conversation' = 'text';
        let antecedent = conditionMentions.length ? `condition:${id}` : lastSet;
        if (
          !resolved.length &&
          !resolvedRegions.length &&
          input.grounding?.selectedRegionId &&
          /this|region/i.test(expression)
        ) {
          const r = world.regions.find(
            (r) => r.id === input.grounding?.selectedRegionId,
          );
          if (r) {
            resolvedRegions = [r.id];
            resolved =
              r.ownerNationId === input.actorNationId ? [] : [r.ownerNationId];
            origin = 'map';
            antecedent = r.id;
          }
        } else if (!resolved.length && input.grounding?.selectedNationId) {
          resolved = [input.grounding.selectedNationId];
          origin = 'map';
          antecedent = input.grounding.selectedNationId;
        } else if (!resolved.length && contextTargets.length) {
          resolved = contextTargets;
          resolvedRegions = priorNode?.territories ?? [];
          origin = 'conversation';
          antecedent = priorAction?.id ?? recentNegotiation!.id;
        }
        if (/former|latter/.test(expression))
          resolved =
            resolved.length === 2
              ? [resolved[/former/.test(expression) ? 0 : 1]!]
              : [];
        if (/both/.test(expression) && resolved.length !== 2)
          issues.push(
            `“${expression}” requires exactly two antecedents, found ${resolved.length}`,
          );
        if (!resolved.length && !resolvedRegions.length)
          issues.push(`Unresolved reference: ${expression}`);
        else {
          targets = resolved;
          territories = resolvedRegions;
          graph.references.push({
            actionId: id,
            expression,
            role: territories.length ? 'territory' : 'target',
            origin,
            antecedentId: antecedent,
            nationIds: resolved,
            regionIds: resolvedRegions,
          });
        }
      }
    }
    if (
      !targets.length &&
      !sources.length &&
      !conditions.length &&
      (['invade', 'annex', 'cancel', 'demand'].includes(kind) ||
        (kind === 'mobilize' &&
          /\b(?:send\w*|commit\w*|deploy\w*)\b/i.test(text))) &&
      lastTargets.length &&
      !ref
    ) {
      targets = lastTargets;
      territories = lastRegions;
      graph.references.push({
        actionId: id,
        expression: 'implicit continuation',
        role: 'target',
        origin: 'text',
        antecedentId: lastSet,
        nationIds: targets,
        regionIds: territories,
      });
    }
    if (/do the same thing/i.test(text)) {
      if (priorNode && priorGraph?.actions.length === 1) {
        kind = priorNode.action;
        instruments.push(`repeat:${priorAction?.id}:${priorNode.id}`);
        graph.references.push({
          actionId: id,
          expression: 'the same thing',
          role: 'instrument',
          origin: 'conversation',
          antecedentId: `${priorAction?.id}:${priorNode.id}`,
          nationIds: priorNode.targets,
          regionIds: priorNode.territories,
        });
      } else issues.push('No preceding action to repeat');
    }
    if (conditional) {
      const conditionText = conditional[2]!;
      const pronounSubject =
        /\b(?:they|them|their)\b/i.test(conditionText) ||
        (/\bit\b/i.test(conditionText) &&
          /\b(?:accept|reject|refuse|sign|agree|join|approve)\w*\b/i.test(
            conditionText,
          ));
      let subjects = pronounSubject
        ? lastTargets.length
          ? lastTargets
          : targets.length
            ? targets
            : contextTargets
        : unique(nationMentions(world, conditionText).map((m) => m.id));
      if (!subjects.length && pronounSubject)
        subjects = unique(
          nationMentions(world, conditionText)
            .map((m) => m.id)
            .filter((id) => id !== input.actorNationId),
        );
      if (
        !targets.length &&
        subjects.length &&
        (!pronounSubject || lastTargets.length > 0)
      )
        targets = [subjects[0]!];
      const c = {
        text: conditionText,
        predicate: conditionPredicate(conditionText),
        subjects,
        negated: /unless/i.test(conditional[1]!),
        actionId: graph.actions.at(-1)?.id ?? null,
      };
      const pronoun = conditionText.match(/\b(?:they|them|their|it)\b/i)?.[0];
      if (pronounSubject) {
        if (!subjects.length) issues.push('Unresolved condition subject');
        else
          graph.references.push({
            actionId: id,
            expression: pronoun ?? conditionText,
            role: 'condition',
            origin: lastTargets.length ? 'text' : 'conversation',
            antecedentId: lastSet || priorAction?.id || 'negotiation',
            nationIds: subjects,
            regionIds: [],
          });
      }
      conditions.push(c);
      lastCondition = c;
    } else if (
      /^otherwise\b/i.test(raw) ||
      /otherwise/i.test(
        input.text.slice(
          Math.max(0, input.text.indexOf(raw) - 20),
          input.text.indexOf(raw),
        ),
      )
    ) {
      if (lastCondition)
        conditions.push({ ...lastCondition, negated: !lastCondition.negated });
      else issues.push('Otherwise has no preceding condition');
    } else if (/^(?:if|unless|once|until)\b/i.test(raw)) {
      issues.push('Conditional clause has no separable consequent');
      conditions.push({
        text: raw,
        predicate: 'unknown',
        subjects: targets,
        negated: /^unless/i.test(raw),
        actionId: graph.actions.at(-1)?.id ?? null,
      });
    }
    const previous = graph.actions.at(-1);
    const location = input.text.indexOf(raw);
    const connective =
      input.text.slice(Math.max(0, location - 25), location) +
      ' ' +
      raw.slice(0, 15);
    let sequence: SemanticAction['sequence'] = conditions.length
      ? 'conditional'
      : /while|simultaneously/i.test(connective)
        ? 'simultaneous'
        : /then|after/i.test(connective)
          ? 'then'
          : /before/i.test(connective)
            ? 'before'
            : 'independent';
    if (/until/i.test(conditional?.[1] ?? '')) sequence = 'until';
    if (previous && sequence === 'then')
      dependencies.push({
        actionId: previous.id,
        requirement: 'ordered',
        mandatory: true,
      });
    const foreignForceSources = sources.filter(
      (s) => s !== input.actorNationId,
    );
    if (
      foreignForceSources.length &&
      (kind === 'invade' || kind === 'strike') &&
      !instruments.length
    ) {
      instruments.push(
        ...foreignForceSources.map((s) => `foreign-forces:${s}`),
      );
      issues.push(
        'Foreign forces are not under player control; acquisition is required',
      );
    }
    const foreignSubject = nationMentions(world, text).find(
      (m) => m.start < 3 && m.id !== input.actorNationId,
    );
    if (
      foreignSubject &&
      /^\S+(?:\s+\S+)?\s+(?:invades|annexes|attacks|steals)\b/i.test(text)
    )
      issues.push(
        'Player cannot order a foreign government as the acting authority',
      );
    if (
      /\b(?:do not|don't|never|keep)\b/i.test(text) &&
      !/if|unless/i.test(raw)
    )
      issues.push(
        'Constraint or preservation clause; no affirmative execution',
      );
    const node: SemanticAction = {
      id,
      clauseId,
      text: raw,
      actor: input.actorNationId,
      action: kind,
      targets,
      sources: unique(sources),
      beneficiaries,
      participants: unique(participants),
      territories,
      assets,
      organizations: world.organizations
        .filter((organization) =>
          [organization.name, organization.acronym, organization.id].some(
            (reference) =>
              !!reference &&
              new RegExp(
                `(?<![\\p{L}\\p{N}])${escaped(reference)}(?![\\p{L}\\p{N}])`,
                'iu',
              ).test(text),
          ),
        )
        .map((o) => o.id),
      instruments,
      conditions,
      dependencies,
      sequence,
      intensity: /nuk|nuclear|fuck it|everything|entire/i.test(text)
        ? 'extreme'
        : /invad|annex|attack/i.test(text)
          ? 'high'
          : 'medium',
      secrecy: /secret|covert|quiet|cyber|without publicly announcing/i.test(
        text,
      )
        ? 'private'
        : 'public',
      desiredOutcome:
        /annex|invad|join|surrender|acquire|steal|take|guarantee/i.test(text)
          ? text
          : null,
      issues,
    };
    if (
      node.conditions.length &&
      /do not|don't|never/i.test(text) &&
      previous &&
      /start.*war/i.test(text)
    ) {
      if (previous.action !== 'request-participation')
        previous.conditions.push({
          ...node.conditions[0]!,
          negated: !node.conditions[0]!.negated,
          actionId: null,
        });
    }
    graph.actions.push(node);
    if (kind === 'acquire-forces') acquired = node;
    if (targets.length || territories.length || participants.length) {
      lastTargets = targets;
      lastRegions = territories;
      lastSet = `set:${id}`;
      graph.targetSets.push({
        id: lastSet,
        actionId: id,
        nationIds: targets.length ? targets : participants,
        regionIds: territories,
      });
    }
  }
  return SemanticGraph.parse(graph);
}

/** Reject structural corruption, including model-provided source -> target leakage. */
export function validateSemanticGraph(
  graph: Graph,
  world: WorldState,
): string[] {
  const errors: string[] = [];
  const ids = new Set(graph.actions.map((a) => a.id));
  if (ids.size !== graph.actions.length) errors.push('Duplicate action IDs');
  const canonical = buildSemanticGraph(world, {
    actorNationId: world.playerNationId,
    text: graph.rawInput,
    grounding: graph.grounding,
  });
  for (const a of graph.actions) {
    const expected = canonical.actions.find((x) => x.id === a.id);
    if (
      expected &&
      (JSON.stringify(a.targets) !== JSON.stringify(expected.targets) ||
        JSON.stringify(a.sources) !== JSON.stringify(expected.sources) ||
        JSON.stringify(a.participants) !==
          JSON.stringify(expected.participants) ||
        JSON.stringify(a.beneficiaries) !==
          JSON.stringify(expected.beneficiaries) ||
        JSON.stringify(a.territories) !== JSON.stringify(expected.territories))
    )
      errors.push(`${a.id}: semantic roles differ from grounded source text`);
  }
  if (JSON.stringify(graph.references) !== JSON.stringify(canonical.references))
    errors.push(
      'Semantic references differ from grounded text, map or geography',
    );
  const sourceOnly = new Set(
    graph.actions
      .flatMap((a) => a.sources)
      .filter((id) => !graph.actions.some((a) => a.targets.includes(id))),
  );
  for (const [i, a] of graph.actions.entries()) {
    if (a.actor !== world.playerNationId)
      errors.push(`${a.id}: actor is not controlled player`);
    for (const n of [
      ...a.targets,
      ...a.sources,
      ...a.participants,
      ...a.beneficiaries,
    ])
      if (!world.nations.some((x) => x.id === n))
        errors.push(`${a.id}: nonexistent nation ${n}`);
    for (const r of a.territories)
      if (!world.regions.some((x) => x.id === r))
        errors.push(`${a.id}: nonexistent territory ${r}`);
    for (const d of a.dependencies)
      if (
        !ids.has(d.actionId) ||
        graph.actions.findIndex((x) => x.id === d.actionId) >= i
      )
        errors.push(`${a.id}: nonexistent or forward dependency ${d.actionId}`);
    if (a.action === 'annex' && a.targets.some((t) => sourceOnly.has(t)))
      errors.push(`${a.id}: asset owner became annexation target`);
    for (const c of a.conditions)
      if (c.actionId && !ids.has(c.actionId))
        errors.push(`${a.id}: nonexistent condition action`);
  }
  for (const r of graph.references) {
    if (!ids.has(r.actionId))
      errors.push('Reference belongs to nonexistent action');
    if (/both/.test(r.expression) && r.nationIds.length !== 2)
      errors.push('Both does not resolve to two nations');
    if (
      r.origin === 'text' &&
      r.antecedentId.startsWith('set:') &&
      !/former|latter/.test(r.expression) &&
      !graph.targetSets.some(
        (s) =>
          s.id === r.antecedentId &&
          JSON.stringify(s.nationIds) === JSON.stringify(r.nationIds),
      )
    )
      errors.push('Reference set was changed');
  }
  return errors;
}

/** The model/world proposal cannot bypass deferred or asset-dependent orders. */
export function semanticCommandIssue(
  world: WorldState,
  graph: Graph | undefined,
  command: WorldCommand,
): string | null {
  if (!graph) return null;
  let targets: NationId[] = [];
  let actor: NationId | undefined;
  let actions: SemanticAction['action'][] = [];
  switch (command.type) {
    case 'START_CONFLICT':
      actor = command.conflict.attackers.includes(world.playerNationId)
        ? world.playerNationId
        : undefined;
      targets = command.conflict.defenders;
      actions = ['invade', 'strike'];
      break;
    case 'STRATEGIC_ATTACK':
      actor = command.attackerNationId;
      targets = [command.targetNationId];
      actions = ['strike'];
      break;
    case 'OPEN_NEGOTIATION':
      actor = command.negotiation.proposerNationId;
      targets = [command.negotiation.recipientNationId];
      actions = [
        'offer',
        'demand',
        'communicate',
        'peace',
        'request-participation',
        'guarantee',
      ];
      break;
    case 'ADD_CLAIM':
      actor = command.nationId;
      targets = world.regions
        .filter((r) => r.id === command.regionId)
        .map((r) => r.ownerNationId);
      actions = ['annex', 'demand', 'invade'];
      break;
    case 'CREATE_STRATEGIC_GOAL':
      if (command.goal.kind === 'territorial') {
        actor = command.goal.nationId;
        targets = command.goal.targetNationIds;
        actions = ['annex', 'demand', 'invade'];
      }
      break;
    default:
      return null;
  }
  if (actor !== world.playerNationId || !actions.length) return null;
  const eligible = graph.actions.filter(
    (a) =>
      actions.includes(a.action) &&
      !a.issues.length &&
      !a.conditions.length &&
      !a.dependencies.some(
        (d) =>
          d.mandatory &&
          d.requirement !== 'ordered' &&
          graph.actions.find((p) => p.id === d.actionId)?.action ===
            'acquire-forces',
      ),
  );
  if (
    targets.some(
      (t) =>
        !eligible.some((a) =>
          (a.action === 'request-participation'
            ? a.participants
            : a.targets
          ).includes(t),
        ),
    )
  )
    return 'Player command targets an entity without an executable grounded role, or bypasses an unresolved condition/dependency';
  return null;
}
