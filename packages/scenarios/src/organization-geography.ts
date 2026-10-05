import globalMetadata from '../../../data/geography/global-metadata.json' with { type: 'json' };
import organizationGroups from '../../../data/geography/organization-groups.json' with { type: 'json' };
import type { NationId, WorldState } from '@mandate/schemas';

interface GeographicMetadata {
  nationId: string;
  name: string;
  sourceType: string;
  isoA3: string;
  continent: string;
  subregion: string;
}

interface GroupDefinition {
  id: string;
  name: string;
  aliases: string[];
  isoA3?: string[];
  names?: string[];
  continent?: string;
  subregion?: string;
  sourceType?: string;
}

const metadata = globalMetadata as unknown as GeographicMetadata[];
const groups = organizationGroups.groups as GroupDefinition[];
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface GeographicNationSet {
  groupId: string;
  label: string;
  expression: string;
  nationIds: NationId[];
}

/** Resolve named regions from the versioned, data-driven geography catalogue. */
export function resolveOrganizationGeographicSet(
  world: WorldState,
  actorNationId: NationId,
  text: string,
): GeographicNationSet | null {
  if (/\bneighbou?rs?\b/i.test(text)) {
    const neighbours =
      world.scenario.neighborhoods?.find(
        (entry) => entry.nationId === actorNationId,
      )?.neighbors ?? [];
    return {
      groupId: 'scenario-neighbors',
      label: `neighbours of ${world.nations.find((n) => n.id === actorNationId)?.name ?? actorNationId}`,
      expression:
        text.match(/\b(?:its|their|the)?\s*neighbou?rs?\b/i)?.[0] ??
        'neighbours',
      nationIds: [...new Set(neighbours)].filter(
        (id) => id !== actorNationId && world.nations.some((n) => n.id === id),
      ),
    };
  }

  const match = groups
    .flatMap((group) =>
      group.aliases.flatMap((alias) => {
        const re = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`,
          'iu',
        );
        const found = re.exec(text);
        return found
          ? [{ group, alias, start: found.index, length: found[0].length }]
          : [];
      }),
    )
    .sort((a, b) => b.length - a.length || a.start - b.start)[0];
  if (!match) return null;

  const isoA3 = new Set(match.group.isoA3 ?? []);
  const ids = new Set(
    metadata
      .filter(
        (entry) =>
          (!match.group.isoA3 ||
            isoA3.has(entry.isoA3) ||
            (match.group.names ?? []).includes(entry.name)) &&
          (!match.group.continent ||
            entry.continent === match.group.continent) &&
          (!match.group.subregion ||
            entry.subregion === match.group.subregion) &&
          (!match.group.sourceType ||
            entry.sourceType === match.group.sourceType),
      )
      .map((entry) => entry.nationId),
  );
  return {
    groupId: match.group.id,
    label: match.group.name,
    expression: text.slice(match.start, match.start + match.length),
    nationIds: world.nations
      .filter((nation) => ids.has(nation.id) && nation.id !== actorNationId)
      .map((nation) => nation.id)
      .sort(),
  };
}
