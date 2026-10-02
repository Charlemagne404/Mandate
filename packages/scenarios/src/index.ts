import { readFileSync } from 'node:fs';
import { parseScenario, WorldError } from '@mandate/core';
import type { WorldState } from '@mandate/schemas';
export function loadScenario(filename: string): WorldState {
  return parseScenario(JSON.parse(readFileSync(filename, 'utf8')));
}
export function geographyValidator(
  regionIds: ReadonlySet<string>,
  version: string | readonly string[],
) {
  const versions = new Set(typeof version === 'string' ? [version] : version);
  return (world: WorldState): void => {
    if (!versions.has(world.scenario.geographyVersion))
      throw new WorldError('GEOGRAPHY', 'Unsupported geography version.');
    for (const region of world.regions)
      if (!regionIds.has(region.geometryId))
        throw new WorldError(
          'GEOGRAPHY',
          `Unknown geometry: ${region.geometryId}`,
        );
  };
}

export function geographyValidatorByVersion(
  regionSets: Readonly<Record<string, ReadonlySet<string>>>,
) {
  return (world: WorldState): void => {
    const version = world.scenario.geographyVersion;
    const regionIds = Object.hasOwn(regionSets, version)
      ? regionSets[version]
      : undefined;
    if (!regionIds)
      throw new WorldError('GEOGRAPHY', 'Unsupported geography version.');
    geographyValidator(regionIds, world.scenario.geographyVersion)(world);
  };
}
