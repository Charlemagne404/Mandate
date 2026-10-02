import type { NationId, RegionId, WorldState } from '@mandate/schemas';
import { PlayerIntent } from './contracts.js';
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
  const mentionedNations = world.nations.filter(
    (nation) => mentions(nation.id) || mentions(nation.name),
  );
  const explicitNationIds = mentionedNations
    .filter((nation) => nation.id !== actorNationId)
    .map((nation) => nation.id);
  const explicitNationSet = new Set(explicitNationIds);
  const explicitRegionIds = world.regions
    .filter((region) => mentions(region.id) || mentions(region.name))
    .map((region) => region.id);
  const explicitRegionSet = new Set(explicitRegionIds);

  return {
    explicitNationIds,
    explicitRegionIds,
    nations: world.nations
      .filter(
        (nation) =>
          nation.id === actorNationId ||
          mentionedNations.some((mentioned) => mentioned.id === nation.id),
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
    task: 'Formalize only the player action text into structured intent.',
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
      /(?:[.!?;]\s+|\n+|\bat the same time[,\s]+|\bsimultaneously[,\s]+|\band\s+(?=increase|raise|invest|mobiliz|reinforce|expand|reform|begin|launch|improve|reduce|build|spend|cut|deploy))/i,
    )
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
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
    return {
      ...intention,
      description: clauseText.slice(0, 2000),
      targetNationIds: formalizerReferences(
        world,
        action.actorNationId,
        clauseText,
      ).explicitNationIds,
      ...(draft.visibility === 'private' ? { visibility: 'private' } : {}),
    };
  });
  const references = formalizerReferences(
    world,
    action.actorNationId,
    action.text,
  );
  return PlayerIntent.parse({
    ...draft,
    actorNationId: action.actorNationId,
    summary: action.text.slice(0, 2000),
    targetNationIds: references.explicitNationIds,
    targetRegionIds: references.explicitRegionIds,
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
  return {
    ...intent,
    summary: intentions
      .map((i) => i.description)
      .join('; ')
      .slice(0, 2000),
    intentions,
    targetNationIds: [...new Set(intentions.flatMap((i) => i.targetNationIds))],
    targetRegionIds: [],
    visibility: intentions.every((i) => i.visibility === 'public')
      ? 'public'
      : 'private',
  };
}
