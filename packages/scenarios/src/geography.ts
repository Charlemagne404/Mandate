import globalMetadata from '../../../data/geography/global-metadata.json' with { type: 'json' };

interface CapitalMetadata {
  nationId: string;
  capitals: Array<{ name: string }>;
}

const capitals = globalMetadata as unknown as CapitalMetadata[];

/** Resolve sourced capital place names to their country-level canonical IDs. */
export function resolveCapitalOwnerIds(
  text: string,
  knownNationIds: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      capitals
        .filter((entry) =>
          entry.capitals.some((capital) => {
            const escaped = capital.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(
              `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
              'iu',
            ).test(text);
          }),
        )
        .map((entry) => entry.nationId)
        .filter((nationId) => knownNationIds.has(nationId)),
    ),
  ];
}
