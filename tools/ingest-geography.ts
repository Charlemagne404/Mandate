import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { RegionId } from '@mandate/schemas';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const source = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/ne_110m_admin_0_countries.geojson`;
const localIndex = process.argv.indexOf('--source');
const bytes =
  localIndex < 0
    ? Buffer.from(await (await fetch(source)).arrayBuffer())
    : readFileSync(resolve(process.argv[localIndex + 1]!));
const checksum = createHash('sha256').update(bytes).digest('hex');
const expected =
  '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f';
if (checksum !== expected)
  throw new Error('Pinned geography checksum mismatch');
type Properties = {
  ADM0_A3: string;
  ADMIN: string;
  LABEL_X: number;
  LABEL_Y: number;
};
const upstream = JSON.parse(bytes.toString()) as FeatureCollection<
  Polygon | MultiPolygon,
  Properties
>;
const registry = JSON.parse(
  readFileSync(resolve(root, 'data/geography/region-registry.json'), 'utf8'),
) as Record<string, string>;
const seen = new Set<string>();
const features = upstream.features
  .map((feature) => {
    const id = RegionId.parse(registry[feature.properties.ADM0_A3]);
    if (seen.has(id)) throw new Error('Duplicate geography region ID');
    seen.add(id);
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type))
      throw new Error('Invalid geometry');
    return {
      type: 'Feature' as const,
      id,
      geometry: feature.geometry,
      properties: {
        regionId: id,
        name: feature.properties.ADMIN,
        label: [feature.properties.LABEL_X, feature.properties.LABEL_Y],
      },
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(
  resolve(root, 'data/geography/world.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features }) + '\n',
);
writeFileSync(
  resolve(root, 'data/geography/manifest.json'),
  JSON.stringify(
    {
      version: 'natural-earth-110m-v1',
      source,
      upstreamRevision: revision,
      upstreamSha256: checksum,
      license: 'Public domain',
      licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
      regionCount: features.length,
      idPolicy:
        'Committed ADM0_A3 registry; IDs survive future geometry changes.',
    },
    null,
    2,
  ) + '\n',
);
