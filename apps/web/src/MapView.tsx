import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { NationId, RegionId } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { politicalFeatures } from '@mandate/map';
import type { MapMode } from '@mandate/map';
import { mapModes } from '@mandate/map';
import { influenceProfile } from '@mandate/core';

type Geography = FeatureCollection<
  Polygon | MultiPolygon,
  {
    regionId: string;
    name: string;
    label: [number, number];
    minZoom?: number;
  }
>;
interface Props {
  world: WorldState;
  selected: NationId;
  focusedRegion?: RegionId | null;
  focusCoordinates?: [number, number] | undefined;
  mode: MapMode;
  onSelect: (nation: NationId, region: RegionId) => void;
  onReady: () => void;
}
export function MapView({
  world,
  selected,
  mode,
  focusedRegion = null,
  focusCoordinates,
  onSelect,
  onReady,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<maplibregl.Map | null>(null);
  const labels = useRef<Geography['features']>([]);
  const current = useRef({
    world,
    mode,
    onSelect,
    selected,
    focusedRegion,
  });
  current.current = { world, mode, onSelect, selected, focusedRegion };
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
      geometryId: RegionId;
      name: string;
      position: [number, number];
      minZoom: number;
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
        const activeGeometryIds = new Set(
          current.current.world.regions.map((region) =>
            String(region.geometryId),
          ),
        );
        const visibleGeography: Geography = {
          ...geography,
          features: geography.features.filter(
            (feature) =>
              activeGeometryIds.has(String(feature.id)) ||
              activeGeometryIds.has(String(feature.properties.regionId)),
          ),
        };
        labels.current = visibleGeography.features;
        if (controller.signal.aborted) return;
        map.addSource('regions', {
          type: 'geojson',
          data: visibleGeography,
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
          id: 'disputed',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': '#b37b31',
            'line-width': 1.5,
            'line-dasharray': [1, 2],
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'disputed'], false],
              0.95,
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
        const regionsByGeometry = new Map(
          current.current.world.regions.map((region) => [
            region.geometryId,
            region,
          ]),
        );
        for (const feature of geography.features) {
          const geometryId = RegionId.parse(String(feature.id));
          if (!regionsByGeometry.has(geometryId)) continue;
          markerInfo.push({
            geometryId,
            name: feature.properties.name,
            position: feature.properties.label,
            minZoom: feature.properties.minZoom ?? 0,
            width: Math.min(160, feature.properties.name.length * 6 + 10),
          });
        }
        const labelPoolSize = Math.min(
          current.current.world.regions.length,
          current.current.world.regions.length > 1000 ? 240 : 500,
        );
        for (let i = 0; i < labelPoolSize; i++) {
          const element = document.createElement('span');
          element.className = 'map-label';
          element.setAttribute('aria-hidden', 'true');
          element.style.display = 'none';
          element.style.pointerEvents = 'none';
          const marker = new maplibregl.Marker({
            element,
            anchor: 'center',
          })
            .setLngLat([0, 0])
            .addTo(map);
          markers.push(marker);
        }
        updateLabels.current = () => {
          const state = current.current;
          const canvas = map.getCanvas();
          const bounds = map.getBounds();
          const byGeometry = new Map(
            state.world.regions.map((region) => [region.geometryId, region]),
          );
          const boxes: { x: number; y: number; width: number }[] = [];
          const max =
            state.world.regions.length < 300
              ? state.world.regions.length
              : map.getZoom() < 2
                ? 22
                : map.getZoom() < 3
                  ? 45
                  : map.getZoom() < 4
                    ? 80
                    : markers.length;
          const zoom = map.getZoom();
          const candidates = markerInfo.flatMap((item) => {
            const region = byGeometry.get(item.geometryId);
            if (!region) return [];
            const isFocused = region.id === state.focusedRegion;
            const isSelected =
              region.ownerNationId === state.selected ||
              region.controllerNationId === state.selected;
            if (zoom + 0.5 < item.minZoom && !isFocused && !isSelected)
              return [];
            if (
              !bounds.contains({ lng: item.position[0], lat: item.position[1] })
            )
              return [];
            const nationId =
              state.mode === 'control'
                ? region.controllerNationId
                : region.ownerNationId;
            const score =
              (isFocused ? 20000 : 0) +
              (nationId === state.selected ? 10000 : 0) +
              (nationId === state.world.playerNationId ? 9000 : 0) +
              (state.world.nations.find((nation) => nation.id === nationId)
                ?.stats.economy ?? 0);
            return [{ item, score }];
          });
          candidates.sort(
            (a, b) =>
              b.score - a.score || a.item.name.localeCompare(b.item.name),
          );
          let markerIndex = 0;
          for (const { item } of candidates) {
            const point = map.project(item.position);
            const box = { x: point.x, y: point.y, width: item.width };
            const visible =
              point.x >= 0 &&
              point.x <= canvas.clientWidth &&
              point.y >= 0 &&
              point.y <= canvas.clientHeight &&
              boxes.length < max &&
              markerIndex < markers.length &&
              !boxes.some(
                (b) =>
                  Math.abs(b.y - box.y) < 19 &&
                  Math.abs(b.x - box.x) < (b.width + box.width) / 2 + 5,
              );
            if (!visible) continue;
            const marker = markers[markerIndex++];
            if (!marker) continue;
            marker.setLngLat(item.position);
            marker.getElement().textContent = item.name;
            marker.getElement().style.display = '';
            boxes.push(box);
          }
          for (const marker of markers.slice(markerIndex))
            marker.getElement().style.display = 'none';
        };
        map.on('moveend', () => updateLabels.current());
        map.on('zoomend', () => updateLabels.current());
        updateLabels.current();
        map.on('mousemove', 'political-fill', (event) => {
          const state = current.current;
          const id = event.features?.[0]?.id;
          const region = current.current.world.regions.find(
            (r) => r.geometryId === id,
          );
          map.getCanvas().style.cursor = region ? 'pointer' : 'grab';
          setHover(
            region
              ? state.mode === 'influence'
                ? (() => {
                    const patron =
                      state.world.nations.find(
                        (nation) => nation.id === state.selected,
                      )?.name ?? state.selected;
                    const subject = state.world.nations.find(
                      (nation) => nation.id === region.ownerNationId,
                    );
                    const profile = influenceProfile(
                      state.world,
                      state.selected,
                      region.ownerNationId,
                    );
                    return `${region.name} · ${subject?.name ?? region.ownerNationId} · ${profile.tier} · ${profile.leverage}/100 modeled leverage · foreign-policy autonomy ${profile.autonomyLevels.foreignPolicy.toLowerCase()} · ${profile.defectionRisk.toLowerCase()} defection risk under ${patron}`;
                  })()
                : `${region.name} · Owner: ${region.ownerNationId.slice(7).toUpperCase()} · Control: ${region.controllerNationId.slice(7).toUpperCase()}`
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
    const region =
      world.regions.find((r) => r.id === focusedRegion) ??
      world.regions.find((r) => r.ownerNationId === selected);
    const feature = labels.current.find((f) => f.id === region?.geometryId);
    const center = focusedRegion
      ? feature?.properties.label
      : (focusCoordinates ?? feature?.properties.label);
    if (center)
      instance.current.easeTo({
        center,
        zoom: Math.max(
          instance.current.getZoom(),
          focusedRegion ? 4 : world.nations.length > 30 ? 2.8 : 3.2,
        ),
        duration: 650,
      });
  }, [ready, selected, focusedRegion, focusCoordinates, world.scenario.id]);
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
        <span>
          <i className="key-disputed" /> Disputed claims
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
