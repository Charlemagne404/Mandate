import type { NationId, RegionId, WorldState } from '@mandate/schemas';
import { resolveCapitalOwnerIds } from '@mandate/scenarios';
import { PlayerIntent } from './contracts.js';
import { FormalizerIntent } from './contracts.js';
import type { FormalizerIntent as FormalizerIntentValue } from './contracts.js';

export interface FormalizerReferences {
  explicitNationIds: NationId[];
  explicitRegionIds: RegionId[];
  nations: Array<{ id: NationId; name: string }>;
  regions: Array<{
    id: RegionId;
    name: string;
    ownerNationId: NationId;
  }>;
}

/** Resolve only entity names/IDs explicitly present in player text. */
export function formalizerReferences(
  world: WorldState,
  actorNationId: NationId,
  text: string,
): FormalizerReferences {
  const lower = text.toLocaleLowerCase();
  const mentions = (value: string) => lower.includes(value.toLocaleLowerCase());
  const regionMention = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `\\b(?:in|within|at|across|throughout|inside|around|on)\\s+(?:[\\p{L}'’.-]+\\s+){0,3}${escaped}\\b`,
      'iu',
    ).test(text);
  };
  const mentionedNations = world.nations.filter(
    (nation) => mentions(nation.id) || mentions(nation.name),
  );
  const mentionedNationIds = mentionedNations
    .filter((nation) => nation.id !== actorNationId)
    .map((nation) => nation.id);
  const capitalNationIds = resolveCapitalOwnerIds(
    text,
    new Set(world.nations.map((nation) => nation.id)),
  ).filter((id) => id !== actorNationId) as NationId[];
  const foreignTargetNationIds = new Set<NationId>([
    ...mentionedNationIds,
    ...capitalNationIds,
  ]);
  const scopeOffensiveTerritoryToForeignTargets =
    isTerritorialPolicyOrder(text) && foreignTargetNationIds.size > 0;
  const explicitRegionIds = world.regions
    .filter(
      (region) =>
        mentions(region.id) ||
        (mentions(region.name) &&
          (isTerritorialPolicyOrder(text) || regionMention(region.name))),
    )
    .filter(
      (region) =>
        !scopeOffensiveTerritoryToForeignTargets ||
        foreignTargetNationIds.has(region.ownerNationId),
    )
    .map((region) => region.id);
  // A specifically named region is sufficient to ground its canonical owner,
  // even when the player used a city/theater name instead of the country name.
  const explicitNationIds = [
    ...new Set([
      ...mentionedNationIds,
      ...capitalNationIds,
      ...world.regions
        .filter((region) => explicitRegionIds.includes(region.id))
        .map((region) => region.ownerNationId)
        .filter((id) => id !== actorNationId),
    ]),
  ];
  const explicitNationSet = new Set(explicitNationIds);
  const explicitRegionSet = new Set(explicitRegionIds);

  return {
    explicitNationIds,
    explicitRegionIds,
    nations: world.nations
      .filter(
        (nation) =>
          nation.id === actorNationId ||
          mentionedNations.some((mentioned) => mentioned.id === nation.id) ||
          capitalNationIds.includes(nation.id),
      )
      .map((nation) => ({ id: nation.id, name: nation.name })),
    regions: world.regions
      .filter(
        (region) =>
          explicitRegionSet.has(region.id) ||
          explicitNationSet.has(region.ownerNationId),
      )
      .map((region) => ({
        id: region.id,
        name: region.name,
        ownerNationId: region.ownerNationId,
      })),
  };
}

/**
 * Build the small, namespaced entity catalogue used by the formalizer.
 * Sending every nation and every map region with the same `id` key makes
 * smaller models prone to copying a region ID into a nation field.
 */
export function buildFormalizerPayload(
  world: WorldState,
  action: { actorNationId: NationId; text: string },
) {
  const actor = world.nations.find((n) => n.id === action.actorNationId);
  if (!actor) throw new Error('Unknown player actor');
  const references = formalizerReferences(
    world,
    action.actorNationId,
    action.text,
  );

  return {
    task: 'Separate authoritative policy orders from desired external outcomes and explicit player constraints. The player decides policy for the controlled government.',
    action: {
      actorNationId: action.actorNationId,
      text: action.text,
    },
    player: {
      nationId: actor.id,
      name: actor.name,
    },
    clauses: splitActionClauses(action.text),
    nationCatalog: references.nations.map((nation) => ({
      nationId: nation.id,
      name: nation.name,
    })),
    regionCatalog: references.regions.map((region) => ({
      regionId: region.id,
      name: region.name,
      ownerNationId: region.ownerNationId,
    })),
    rules: [
      'The player field is authoritative; never change the acting nation.',
      'Never judge, soften, omit or replace a valid player policy order because it is risky, implausible, inconsistent with strategy, or likely to fail.',
      'A policy order is what the controlled government must attempt. A desired outcome is what other governments or world mechanics may prevent.',
      'Preserve explicit constraints such as “do not start a war” alongside the objective; do not silently choose one side of a contradiction.',
      'Classify intensity from the player wording. Intensity affects scale and consequences, not whether the order is allowed.',
      'Use nationId values only in actorNationId, targetNationIds and intention targetNationIds.',
      'Use regionId values only in targetRegionIds.',
      'Use only IDs from the supplied catalogues; if no target is named, return an empty target list.',
      'sourceClauseIds are zero-based indexes into clauses.',
    ],
  };
}

/** Exact source clauses prevent a model's paraphrase from leaking another intention. */
export function splitActionClauses(text: string): string[] {
  return text
    .split(
      /(?:[.!?;]\s+|,?\s+but\s+(?=(?:don't|do not|never|avoid|without|no\b))|\n+|\bat the same time[,\s]+|\bsimultaneously[,\s]+|\s+to\s+(?=(?:take|seize|occupy|annex|conquer)\b)|\s+(?:and|or)\s+(?=(?:increase|raise|invest|mobiliz|reinforce|expand|reform|begin|launch|improve|reduce|build|spend|cut|deploy|invad|occupy|seize|conquer|annex|bomb|nuk|attack|strike|send|commit|move|take|declare war|go to war)))/i,
    )
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function orderIntensity(text: string): 'low' | 'medium' | 'high' | 'extreme' {
  if (
    /at any cost|no matter what|fuck it|nuk(?:e|es|ed|ing)|nuclear[- ]scale|catastrophic strike|strategic strike|massive (?:military )?attack|invade|attack now|unconditional surrender|spend everything|spend nearly all|all available fiscal capacity|entire military|all armed forces/i.test(
      text,
    )
  )
    return 'extreme';
  if (
    /\b(?:annex|conquer|seize|invade|attack|bomb|strike|threaten|ultimatum|alliance demand|armed forces)\b|full(?:y)? mobiliz|spend everything|triple|double (?:military|defen[sc]e) spending/i.test(
      text,
    )
  )
    return 'high';
  if (
    /demand|break|leave|withdraw|sanction|recognize|cut|double|cancel|surrender|give .* to|cede|stop all/i.test(
      text,
    )
  )
    return 'medium';
  if (
    /discuss|explore|consider|consult|propose|offer|gradual|closer cooperation/i.test(
      text,
    )
  )
    return 'low';
  return 'medium';
}

function constraintKind(text: string) {
  if (
    /\b(?:avoid|without|don't|do not|never|no)\b[^.!?;]*(?:war|invasi|military action)/i.test(
      text,
    )
  )
    return 'avoid-war' as const;
  if (/\b(?:avoid|without|don't|do not|never|no)\b[^.!?;]*mobiliz/i.test(text))
    return 'avoid-mobilization' as const;
  if (
    /\b(?:avoid|without|don't|do not|never|no)\b[^.!?;]*(?:public(?:ly)? announce|public framing)/i.test(
      text,
    )
  )
    return 'avoid-public-announcement' as const;
  if (
    /\b(?:avoid|without|don't|do not|never|no)\b[^.!?;]*(?:break|end|withdraw from) (?:the )?(?:treaty|agreement|alliance)/i.test(
      text,
    )
  )
    return 'avoid-treaty-break' as const;
  if (/\b(?:avoid|without|don't|do not|never|no)\b/i.test(text))
    return 'other' as const;
  return 'other' as const;
}

function isConstraintOnly(text: string) {
  return /^(?:but\s+)?(?:avoid|without|don't|do not|never|no\b)/i.test(
    text.trim(),
  );
}

function isInformationOnly(text: string) {
  return (
    /^(?:review|observe|monitor|check|inspect|assess|show|report|what is|how is|wait\b|stand by\b|do nothing\b|keep (?:the )?current strategy\b|continue (?:the |our )?(?:current|existing|ongoing)\b)/i.test(
      text.trim(),
    ) || /^continue it if\b/i.test(text.trim())
  );
}

function privateClause(text: string) {
  return /\b(?:quietly|secret(?:ly)?|privately|covertly|without (?:publicly|a public|publicly announcing)|do not publicly announce|don't publicly announce)\b/i.test(
    text,
  );
}

export function isTerritorialPolicyOrder(text: string) {
  return (
    /\b(?:annex|invade|conquer|claim|seize|occupy|incorporate|unify|cede|transfer|take over|take)\s+(?:the\s+)?[\p{L}\p{N}]/iu.test(
      text,
    ) ||
    /\b(?:union with|territorial objective|take .* territory|claim territory|seize territory|make\s+.+\s+(?:join|part of|into)|give\s+.+\s+to)\b/i.test(
      text,
    ) ||
    /\b[\p{L}][\p{L}\s’'-]+\s+is\s+(?:now\s+)?ours\b/iu.test(text) ||
    (/\bcopenhagen\b/i.test(text) &&
      /\b(?:demand|claim|take|annex|seize|control|transfer)\b/i.test(text))
  );
}

function fallbackClauseKind(
  text: string,
): PlayerIntent['intentions'][number]['kind'] {
  if (isConstraintOnly(text) || isInformationOnly(text)) return 'wait';
  if (isTerritorialPolicyOrder(text)) return 'territory';
  if (
    /treaty|alliance|recogniz|diplom|threaten|demand|withdraw|surrender|ceasefire|peace|negotiate|offer|propose|consult|trade/i.test(
      text,
    )
  )
    return 'diplomacy';
  if (
    /military|defen[sc]e|mobiliz|readiness|war|attack|bomb|nuk|strike|rearm|armed forces|send .*forces/i.test(
      text,
    )
  )
    return 'military';
  if (
    /tax|spend|budget|energy|industry|economic|aid|infrastructure|invest|fund|sanction/i.test(
      text,
    )
  )
    return 'economy';
  if (/reform|project|government|priority|stability|abandon|cancel/i.test(text))
    return 'domestic';
  return 'other';
}

/** Provider-independent interpretation used when a formalizer is unavailable. */
export function deterministicPlayerIntent(
  world: WorldState,
  action: { actorNationId: NationId; text: string },
): PlayerIntent {
  const clauses = splitActionClauses(action.text);
  const refs = formalizerReferences(world, action.actorNationId, action.text);
  const draft = FormalizerIntent.parse({
    version: 1,
    actorNationId: action.actorNationId,
    summary: action.text.slice(0, 2000),
    targetNationIds: refs.explicitNationIds,
    targetRegionIds: refs.explicitRegionIds,
    visibility: 'public',
    intentions: clauses.map((clause, sourceClauseId) => ({
      kind: fallbackClauseKind(clause),
      description: clause,
      sourceClauseIds: [sourceClauseId],
      targetNationIds: formalizerReferences(world, action.actorNationId, clause)
        .explicitNationIds,
      visibility: privateClause(clause) ? 'private' : 'public',
    })),
  });
  return canonicalizeFormalizerIntent(world, action, draft);
}

function outcomeKind(text: string) {
  if (
    /\binvad(?:e|ing)\b|\battack\b|\bbomb(?:s|ed|ing)?\b|\bnuk(?:e|es|ed|ing)\b|\bstrike\b|\b(?:start|declare|enter) (?:a )?(?:war|conflict)|go to war/i.test(
      text,
    )
  )
    return 'war' as const;
  if (isTerritorialPolicyOrder(text)) return 'territory' as const;
  if (/\b(?:military alliance|defense alliance|formal alliance)\b/i.test(text))
    return 'alliance' as const;
  if (
    /\b(?:break|leave|withdraw from) (?:the )?(?:treaty|agreement|alliance)|recogniz|sanction|offer .* treaty/i.test(
      text,
    )
  )
    return /recogniz/i.test(text)
      ? ('recognition' as const)
      : ('treaty' as const);
  if (
    /\b(?:surrender|withdraw from the war|peace|ceasefire|end the war)\b/i.test(
      text,
    )
  )
    return 'peace' as const;
  return 'other' as const;
}

/**
 * High-impact clauses are extracted from source text independently of the
 * provider's broad policy classification. One source clause may contain
 * several major intents, such as a strike, invasion, and conquest objective.
 */
function deriveMajorIntentClauses(
  world: WorldState,
  action: { actorNationId: NationId; text: string },
  clauses: string[],
): PlayerIntent['majorIntentClauses'] {
  const allReferences = formalizerReferences(
    world,
    action.actorNationId,
    action.text,
  );
  const result: PlayerIntent['majorIntentClauses'] = [];
  const add = (
    sourceClauseId: number,
    kind: PlayerIntent['majorIntentClauses'][number]['kind'],
    label: string,
  ) => {
    if (
      result.some(
        (entry) =>
          entry.sourceClauseIds.includes(sourceClauseId) && entry.kind === kind,
      )
    )
      return;
    const text = clauses[sourceClauseId]!;
    const local = formalizerReferences(world, action.actorNationId, text);
    result.push({
      id: `major:${sourceClauseId}:${kind}`,
      kind,
      description: `${label}: ${text}`.slice(0, 2000),
      sourceClauseIds: [sourceClauseId],
      targetNationIds: local.explicitNationIds.length
        ? local.explicitNationIds
        : allReferences.explicitNationIds,
      targetRegionIds: local.explicitRegionIds.length
        ? local.explicitRegionIds
        : allReferences.explicitRegionIds,
    });
  };

  clauses.forEach((text, sourceClauseId) => {
    const lower = text.toLowerCase();
    const negatedMajorAction =
      /\b(?:do not|don't|never|avoid|without)\b[^.!?;]{0,60}\b(?:attack|bomb|nuk\w*|strike|invad\w*|war|occup\w*|seiz\w*|conquer\w*|annex\w*|mobiliz\w*|deploy\w*|send\w*|commit\w*)\b/i.test(
        text,
      ) || /\bno\s+(?:war|attack|invasion|mobilization)\b/i.test(text);
    const strategicStrike =
      !negatedMajorAction &&
      /\bnuk(?:e|es|ed|ing)\b|\bnuclear(?:[- ]scale)? (?:attack|strike|weapons?)\b|\batomic (?:attack|strike|bomb)\b|\b(?:strategic|catastrophic) (?:attack|strike)\b|\bmassive (?:military )?attack\b|\bbomb(?:s|ed|ing)?\b|\bbombard(?:s|ed|ing)?\b/.test(
        lower,
      );
    const declaration =
      !negatedMajorAction &&
      /\b(?:declare|start|initiate|begin|enter) (?:a )?(?:war|armed conflict)\b|\bgo to war\b/.test(
        lower,
      );
    const forceDeployment =
      /\b(?:send(?:s|ing)?|commit(?:s|ted|ting)?|deploy(?:s|ed|ing)?|move(?:s|d|ing)?)\b[^.!?;]{0,100}\b(?:troops|forces|armed forces|military)\b/i.test(
        text,
      );
    const attack =
      !negatedMajorAction &&
      (declaration ||
        strategicStrike ||
        /\binvad(?:e|es|ed|ing)\b|\binvasion\b|\battack\b|\bstrike\b/.test(
          lower,
        ) ||
        forceDeployment);
    const invasion =
      (!negatedMajorAction &&
        /\binvad(?:e|es|ed|ing)\b|\binvasion\b|\boccup(?:y|ies|ied|ying)\b|\btake\b[^.!?;]{0,70}\b(?:by force|country|territory|capital|city)\b|\bseize\b[^.!?;]{0,70}\b(?:by force|territory|capital|city)\b/.test(
          lower,
        )) ||
      (!negatedMajorAction &&
        forceDeployment &&
        /\b(?:take|occupy|seize|capture|conquer)\b/i.test(text));
    const transferOrder =
      /\b(?:give|cede|transfer)\b/i.test(lower) && /\bto\b/i.test(lower);
    const conquest =
      !negatedMajorAction &&
      !transferOrder &&
      (/\b(?:annex|conquer|occup(?:y|ies|ied|ying)|seize|capture|take over)\b/.test(
        lower,
      ) ||
        /\btake\b[^.!?;]{0,70}\b(?:country|nation|territory|capital|city|it|them|theirs)\b/.test(
          lower,
        ) ||
        (isTerritorialPolicyOrder(text) &&
          allReferences.explicitNationIds.length > 0));
    const mobilization =
      !negatedMajorAction &&
      (/\bmobiliz(?:e|es|ed|ing|ation)\b/.test(lower) || forceDeployment);

    if (strategicStrike)
      add(
        sourceClauseId,
        'strategic-strike',
        'Strategic or catastrophic strike',
      );
    if (attack)
      add(
        sourceClauseId,
        declaration ? 'declaration-of-war' : 'armed-conflict-initiation',
        declaration
          ? 'War declaration or initiation'
          : 'Armed conflict initiation or escalation',
      );
    if (invasion)
      add(
        sourceClauseId,
        'invasion-offensive',
        'Invasion or offensive operation',
      );
    if (conquest)
      add(
        sourceClauseId,
        'conquest-objective',
        'Conquest or annexation objective',
      );
    if (mobilization)
      add(
        sourceClauseId,
        'military-mobilization',
        'Military mobilization or force commitment',
      );
  });
  return result.slice(0, 40);
}

/**
 * Rebind model output to canonical facts that are mechanically recoverable
 * from the player's text. The model still classifies clauses, but it cannot
 * invent the acting nation or smuggle arbitrary entity IDs into the intent.
 */
export function canonicalizeFormalizerIntent(
  world: WorldState,
  action: { actorNationId: NationId; text: string },
  draft: FormalizerIntentValue,
): PlayerIntent {
  const clauses = splitActionClauses(action.text);
  const intentions = draft.intentions.map((intention) => {
    if (intention.sourceClauseIds.some((id) => !clauses[id]))
      throw new Error('Formalizer invented a source clause');
    const clauseText = intention.sourceClauseIds
      .map((id) => clauses[id])
      .join('; ');
    const privateIntent = privateClause(clauseText);
    return {
      ...intention,
      description: clauseText.slice(0, 2000),
      targetNationIds: formalizerReferences(
        world,
        action.actorNationId,
        clauseText,
      ).explicitNationIds,
      visibility:
        privateIntent ||
        intention.visibility === 'private' ||
        draft.visibility === 'private'
          ? 'private'
          : 'public',
    };
  });
  const references = formalizerReferences(
    world,
    action.actorNationId,
    action.text,
  );
  const policyOrders: PlayerIntent['policyOrders'] = [];
  const desiredOutcomes: PlayerIntent['desiredOutcomes'] = [];
  const constraints: PlayerIntent['constraints'] = [];
  for (let index = 0; index < clauses.length; index++) {
    const clause = clauses[index]!;
    const matching = intentions.find((i) => i.sourceClauseIds.includes(index));
    const localRefs = formalizerReferences(world, action.actorNationId, clause);
    const refs = {
      ...localRefs,
      explicitNationIds: localRefs.explicitNationIds.length
        ? localRefs.explicitNationIds
        : references.explicitNationIds,
      explicitRegionIds: localRefs.explicitRegionIds.length
        ? localRefs.explicitRegionIds
        : references.explicitRegionIds,
    };
    const constraint = constraintKind(clause);
    const constraintOnly = isConstraintOnly(clause);
    if (constraint !== 'other' || constraintOnly) {
      constraints.push({
        kind: constraint,
        description: clause.slice(0, 2000),
        sourceClauseIds: [index],
      });
    }
    if (!constraintOnly && !isInformationOnly(clause)) {
      const classifiedKind = fallbackClauseKind(clause);
      const kind =
        classifiedKind === 'other'
          ? (matching?.kind ?? 'other')
          : classifiedKind;
      policyOrders.push({
        authority: 'player-policy-order',
        kind,
        text: clause.slice(0, 2000),
        sourceClauseIds: [index],
        targetNationIds: refs.explicitNationIds,
        targetRegionIds: refs.explicitRegionIds,
        intensity: orderIntensity(clause),
        persistent:
          /\b(?:over the next|over \w+ years?|for \w+ years?|long.?term|standing|until (?:we|it)|permanent(?:ly)?|from now on|at any cost)\b/i.test(
            clause,
          ) ||
          /\b(?:annex|invade|conquer|incorporat|unif(?:y|ication)|union with|leave (?:the |every )?alliance|break (?:the )?treaty|recogniz|surrender|(?:cut|triple|double|increase|raise) (?:military|defen[sc]e) spending|spend nearly all|all available fiscal capacity|stop all foreign aid|cut all foreign aid)\b/i.test(
            clause,
          ),
        visibility:
          privateClause(clause) ||
          matching?.visibility === 'private' ||
          draft.visibility === 'private'
            ? 'private'
            : 'public',
      });
    }
    const outcome = outcomeKind(clause);
    if (outcome !== 'other')
      desiredOutcomes.push({
        kind: outcome,
        description: clause.slice(0, 2000),
        sourceClauseIds: [index],
        targetNationIds: refs.explicitNationIds,
        targetRegionIds: refs.explicitRegionIds,
      });
  }
  return PlayerIntent.parse({
    ...draft,
    actorNationId: action.actorNationId,
    summary: action.text.slice(0, 2000),
    targetNationIds: references.explicitNationIds,
    targetRegionIds: references.explicitRegionIds,
    policyOrders,
    desiredOutcomes,
    constraints,
    majorIntentClauses: deriveMajorIntentClauses(world, action, clauses),
    intentions,
  });
}

export function scopeIntent(
  intent: PlayerIntent,
  nationId: NationId,
): PlayerIntent | null {
  if (nationId === intent.actorNationId) return intent;
  const internalClauses = new Set(
    intent.intentions
      .filter((i) => i.visibility === 'private' && i.kind !== 'diplomacy')
      .flatMap((i) => i.sourceClauseIds),
  );
  const intentions = intent.intentions.filter(
    (i) =>
      i.visibility === 'public' ||
      (i.kind === 'diplomacy' &&
        i.targetNationIds.includes(nationId) &&
        !i.sourceClauseIds.some((id) => internalClauses.has(id))),
  );
  if (!intentions.length) return null;
  const sourceClauseIds = new Set(intentions.flatMap((i) => i.sourceClauseIds));
  return {
    ...intent,
    summary: intentions
      .map((i) => i.description)
      .join('; ')
      .slice(0, 2000),
    intentions,
    targetNationIds: [...new Set(intentions.flatMap((i) => i.targetNationIds))],
    targetRegionIds: [],
    policyOrders: intent.policyOrders.filter((o) =>
      o.sourceClauseIds.some((id) => sourceClauseIds.has(id)),
    ),
    desiredOutcomes: intent.desiredOutcomes.filter((o) =>
      o.sourceClauseIds.some((id) => sourceClauseIds.has(id)),
    ),
    constraints: intent.constraints.filter((c) =>
      c.sourceClauseIds.some((id) => sourceClauseIds.has(id)),
    ),
    majorIntentClauses: intent.majorIntentClauses.filter((clause) =>
      clause.sourceClauseIds.some((id) => sourceClauseIds.has(id)),
    ),
    visibility: intentions.every((i) => i.visibility === 'public')
      ? 'public'
      : 'private',
  };
}
