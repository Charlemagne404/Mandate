import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  geographyValidator,
  geographyValidatorByVersion,
  loadScenario,
} from './index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
describe('global gameplay scenario', () => {
  it('validates all actors and permanent geometry while retaining the small fixture', () => {
    const world = loadScenario(root + 'data/scenarios/global-alpha.json');
    const fixture = loadScenario(root + 'data/scenarios/northern-sandbox.json');
    const geography = JSON.parse(
      readFileSync(root + 'data/geography/world-global.geojson', 'utf8'),
    ) as { features: { id: string }[] };
    const validate = geographyValidator(
      new Set(geography.features.map((f) => f.id)),
      ['natural-earth-110m-v1', 'natural-earth-50m-v1'],
    );
    expect(world.nations).toHaveLength(242);
    expect(world.regions).toHaveLength(242);
    expect(world.goals).toHaveLength(242);
    expect(world.scenario.synthetic).toBe(true);
    validate(world);
    validate(fixture);
    for (const region of fixture.regions)
      expect(world.regions.find((r) => r.id === region.id)?.geometryId).toBe(
        region.geometryId,
      );
    expect(world.nations.some((n) => n.id === 'nation:swe')).toBe(true);
    expect(fixture.nations).toHaveLength(13);
  });
  it('has symmetric land adjacency and sourced capitals separate from political state', () => {
    const items = JSON.parse(
      readFileSync(root + 'data/geography/global-metadata.json', 'utf8'),
    ) as {
      nationId: string;
      regionId: string;
      adjacentRegionIds: string[];
      capitals: { name: string }[];
    }[];
    const byId = new Map(items.map((item) => [item.regionId, item]));
    for (const item of items)
      for (const neighbor of item.adjacentRegionIds)
        expect(byId.get(neighbor)?.adjacentRegionIds).toContain(item.regionId);
    expect(
      items.find((item) => item.nationId === 'nation:swe')?.capitals,
    ).toEqual([{ name: 'Stockholm', coordinates: [18.0663, 59.324127] }]);
    expect(
      items.find((item) => item.nationId === 'nation:swe')?.adjacentRegionIds,
    ).toEqual(expect.arrayContaining(['region:ne-fin', 'region:ne-nor']));
  });
  it('rejects a mismatched version and unknown geography', () => {
    const world = loadScenario(root + 'data/scenarios/global-alpha.json');
    expect(() =>
      geographyValidator(
        new Set(world.regions.map((r) => r.id)),
        'natural-earth-110m-v1',
      )(world),
    ).toThrow('Unsupported geography');
    expect(() =>
      geographyValidator(new Set(), 'natural-earth-50m-v1')(world),
    ).toThrow('Unknown geometry');
  });
  it('does not allow newer geometry keys into a saved older geography version', () => {
    const world = loadScenario(root + 'data/scenarios/global-alpha.json');
    const fixture = loadScenario(root + 'data/scenarios/northern-sandbox.json');
    const original = JSON.parse(
      readFileSync(root + 'data/geography/world.geojson', 'utf8'),
    ) as { features: { id: string }[] };
    const validate = geographyValidatorByVersion({
      'natural-earth-110m-v1': new Set(original.features.map((f) => f.id)),
      'natural-earth-50m-v1': new Set(world.regions.map((r) => r.id)),
    });
    validate(world);
    validate(fixture);
    world.scenario.geographyVersion = 'natural-earth-110m-v1';
    expect(() => validate(world)).toThrow('Unknown geometry');
    world.scenario.geographyVersion = 'constructor';
    expect(() => validate(world)).toThrow('Unsupported geography');
  });
});

it('Nordic Crossroads has bounded goals, neutrality, dependencies and funded projects without a scripted war', () => {
  const w = loadScenario(root + 'data/scenarios/nordic-strategy.json');
  expect(w.goals.some((g) => g.parentGoalId)).toBe(true);
  expect(w.goals.some((g) => g.signals.length)).toBe(true);
  expect(
    w.nations.find((n) => n.id === 'nation:fin')!.strategy.directives[0]!.text,
  ).toContain('basing');
  expect(w.treaties.some((t) => t.kind === 'trade')).toBe(true);
  expect(w.initiatives.length).toBeGreaterThan(0);
  expect(w.conflicts).toEqual([]);
});
