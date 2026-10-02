import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { NationId, RegionId } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { politicalFeatures } from '@mandate/map';
import type { MapMode } from '@mandate/map';
import { mapModes } from '@mandate/map';

type Geography = FeatureCollection<
  Polygon | MultiPolygon,
  { regionId: string; name: string; label: [number, number] }
>;
interface Props {
  world: WorldState;
  selected: NationId;
  mode: MapMode;
  onSelect: (nation: NationId, region: RegionId) => void;
  onReady: () => void;
}
export function MapView({ world, selected, mode, onSelect, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<maplibregl.Map | null>(null);
  const labels = useRef<Geography['features']>([]);
  const current = useRef({ world, mode, onSelect, selected });
  current.current = { world, mode, onSelect, selected };
  const updateLabels = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [hover, setHover] = useState('Pan to explore · Select a country');
  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(workerUrl);
    const map = new maplibregl.Map({
      container: container.current,
      center: world.nations.length > 30 ? [12, 25] : [19, 58],
      zoom: world.nations.length > 30 ? 1.3 : 3.1,
      minZoom: 1.1,
      maxZoom: 8,
      attributionControl: false,
      renderWorldCopies: false,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'ocean',
            type: 'background',
            paint: { 'background-color': '#e6e9e5' },
          },
        ],
      },
    });
    instance.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    );
    const controller = new AbortController();
    const markers: maplibregl.Marker[] = [];
    const markerInfo: {
      marker: maplibregl.Marker;
      nationId: NationId;
      position: [number, number];
      width: number;
    }[] = [];
    map.on('error', (event) => setError(event.error.message));
    map.on('load', async () => {
      try {
        const response = await fetch('/api/geography', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Geography unavailable');
        const geography = (await response.json()) as Geography;
        labels.current = geography.features;
        if (controller.signal.aborted) return;
        map.addSource('regions', {
          type: 'geojson',
          data: geography,
          promoteId: 'regionId',
        });
        map.addLayer({
          id: 'political-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': ['coalesce', ['feature-state', 'color'], '#d3d4cd'],
            'fill-opacity': 0.84,
          },
        });
        map.addLayer({
          id: 'borders',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': '#666c65',
            'line-opacity': 0.45,
            'line-width': 0.7,
          },
        });
        map.addLayer({
          id: 'occupied',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': '#8a4d38',
            'line-width': 2,
            'line-dasharray': [2, 2],
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'occupied'], false],
              1,
              0,
            ],
          },
        });
        map.addLayer({
          id: 'selection',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': '#293f41',
            'line-width': 2.5,
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              1,
              0,
            ],
          },
        });
        for (const feature of geography.features) {
          const region = current.current.world.regions.find(
            (r) => r.id === feature.id,
          );
          if (!region) continue;
          const label = document.createElement('button');
          label.className = 'map-label';
          label.textContent = region.name;
          label.setAttribute('aria-label', `Select ${region.name} on map`);
          label.addEventListener('click', () => {
            const state = current.current;
            const live = state.world.regions.find((r) => r.id === feature.id)!;
            state.onSelect(
              state.mode === 'control'
                ? live.controllerNationId
                : live.ownerNationId,
              live.id,
            );
          });
          const marker = new maplibregl.Marker({ element: label })
            .setLngLat(feature.properties.label)
            .addTo(map);
          markers.push(marker);
          markerInfo.push({
            marker,
            nationId: region.ownerNationId,
            position: feature.properties.label,
            width: region.name.length * 6 + 10,
          });
        }
        updateLabels.current = () => {
          const state = current.current;
          const canvas = map.getCanvas();
          const boxes: { x: number; y: number; width: number }[] = [];
          const max =
            state.world.nations.length < 30
              ? 500
              : map.getZoom() < 2
                ? 22
                : map.getZoom() < 3
                  ? 45
                  : map.getZoom() < 4
                    ? 80
                    : 500;
          const priority = (id: NationId) =>
            id === state.selected
              ? 10000
              : id === state.world.playerNationId
                ? 9000
                : (state.world.nations.find((n) => n.id === id)?.stats
                    .economy ?? 0);
          for (const item of [...markerInfo].sort(
            (a, b) =>
              priority(b.nationId) - priority(a.nationId) ||
              a.nationId.localeCompare(b.nationId),
          )) {
            const point = map.project(item.position);
            const box = { x: point.x, y: point.y, width: item.width };
            const visible =
              point.x >= 0 &&
              point.x <= canvas.clientWidth &&
              point.y >= 0 &&
              point.y <= canvas.clientHeight &&
              boxes.length < max &&
              !boxes.some(
                (b) =>
                  Math.abs(b.y - box.y) < 19 &&
                  Math.abs(b.x - box.x) < (b.width + box.width) / 2 + 5,
              );
            item.marker.getElement().style.display = visible ? '' : 'none';
            if (visible) boxes.push(box);
          }
        };
        map.on('move', () => updateLabels.current());
        updateLabels.current();
        map.on('mousemove', 'political-fill', (event) => {
          const id = event.features?.[0]?.id;
          const region = current.current.world.regions.find(
            (r) => r.geometryId === id,
          );
          map.getCanvas().style.cursor = region ? 'pointer' : 'grab';
          setHover(
            region
              ? `${region.name} · Owner: ${region.ownerNationId.slice(7).toUpperCase()} · Control: ${region.controllerNationId.slice(7).toUpperCase()}`
              : 'Outside development scenario',
          );
        });
        map.on('mouseleave', 'political-fill', () =>
          setHover('Pan to explore · Select a country'),
        );
        map.on('click', 'political-fill', (event) => {
          const id = event.features?.[0]?.id;
          const state = current.current;
          const region = state.world.regions.find((r) => r.geometryId === id);
          if (region)
            state.onSelect(
              state.mode === 'control'
                ? region.controllerNationId
                : region.ownerNationId,
              RegionId.parse(id),
            );
        });
        map.once('idle', () => {
          setReady(true);
          onReady();
        });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Map failed');
      }
    });
    return () => {
      controller.abort();
      markers.forEach((m) => m.remove());
      map.remove();
      instance.current = null;
    };
  }, [onReady]);
  useEffect(() => {
    if (!ready || !instance.current) return;
    instance.current.removeFeatureState({ source: 'regions' });
    for (const { id, ...state } of politicalFeatures(world, mode, selected))
      instance.current.setFeatureState({ source: 'regions', id }, state);
    updateLabels.current();
  }, [ready, world, mode, selected]);
  useEffect(() => {
    if (!ready || !instance.current) return;
    const region = world.regions.find((r) => r.ownerNationId === selected);
    const feature = labels.current.find((f) => f.id === region?.geometryId);
    if (feature)
      instance.current.easeTo({
        center: feature.properties.label,
        duration: 650,
      });
  }, [ready, selected, world.scenario.id]);
  return (
    <section
      className="atlas"
      aria-label="Interactive political atlas"
      data-map-ready={ready}
    >
      <div ref={container} className="map-canvas" />
      <div className="map-heading">
        <span className="eyebrow">
          {world.nations.length > 30
            ? 'THE WORLD THEATER'
            : 'THE NORTHERN THEATER'}
        </span>
        <span>
          {world.nations.length} polities · {world.regions.length} regions
        </span>
      </div>
      <div className="map-key">
        <span>
          <i className="key-selected" /> Selected polity
        </span>
        <span>
          <i className="key-control" /> Occupied territory
        </span>
        <span>{mapModes.find((m) => m.value === mode)?.legend}</span>
      </div>
      <div className="map-status" aria-live="polite">
        {error || hover}
      </div>
      <a
        className="map-attribution"
        href="https://www.naturalearthdata.com/about/terms-of-use/"
        target="_blank"
        rel="noreferrer"
      >
        Natural Earth · public domain
      </a>
    </section>
  );
}
