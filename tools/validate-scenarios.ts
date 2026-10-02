import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geographyValidatorByVersion, loadScenario } from '@mandate/scenarios';

const root = fileURLToPath(new URL('../', import.meta.url));
const regionSets = Object.fromEntries(
  [
    ['natural-earth-110m-v1', 'world.geojson'],
    ['natural-earth-50m-v1', 'world-global.geojson'],
  ].map(([version, name]) => {
    const geography = JSON.parse(
      readFileSync(resolve(root, 'data/geography', name!), 'utf8'),
    ) as { features: { id: string }[] };
    return [version, new Set(geography.features.map((f) => f.id))];
  }),
);
const validate = geographyValidatorByVersion(regionSets);
for (const name of readdirSync(resolve(root, 'data/scenarios'))
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const world = loadScenario(resolve(root, 'data/scenarios', name));
  validate(world);
  console.log(
    `${name}: ${world.nations.length} actors, ${world.regions.length} regions, ${world.goals.length} goals; validated`,
  );
}
