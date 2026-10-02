import type { NationId, WorldState } from '@mandate/schemas';
export type MapMode =
  | 'ownership'
  | 'control'
  | 'relations'
  | 'alliances'
  | 'conflicts'
  | 'claims'
  | 'stability'
  | 'economy'
  | 'military';
export const mapModes: { value: MapMode; label: string; legend: string }[] = [
  {
    value: 'ownership',
    label: 'Ownership',
    legend: 'National colors · legal ownership',
  },
  {
    value: 'control',
    label: 'Military control',
    legend: 'National colors · military controller',
  },
  {
    value: 'relations',
    label: 'Relations',
    legend:
      'Red: hostile · neutral: gray · green: friendly to controlled country',
  },
  {
    value: 'alliances',
    label: 'Organizations',
    legend: 'Green: shared organization · gray: no shared membership',
  },
  {
    value: 'conflicts',
    label: 'Conflicts',
    legend: 'Red: attacker · amber: defender · gray: no active war',
  },
  {
    value: 'claims',
    label: 'Claims',
    legend: 'Amber: claimed region · gray: no claim',
  },
  {
    value: 'stability',
    label: 'Stability',
    legend: 'Red: 0 · amber: 50 · green: 100',
  },
  {
    value: 'economy',
    label: 'Economy',
    legend: 'Pale: 0 · deep green: 100 · synthetic index',
  },
  {
    value: 'military',
    label: 'Military strength',
    legend: 'Pale: 0 · deep green: 100 · synthetic index',
  },
];
const scale = (value: number) =>
  value < 30 ? '#b77761' : value < 60 ? '#baa874' : '#6c927c';
export function politicalFeatures(
  world: WorldState,
  mode: MapMode,
  selected: NationId,
) {
  return world.regions.map((region) => {
    const nationId =
      mode === 'control' ? region.controllerNationId : region.ownerNationId;
    const nation = world.nations.find((n) => n.id === nationId)!;
    let color = nation.color;
    if (mode === 'relations') {
      const relation = world.relations.find(
        (r) =>
          [r.nationA, r.nationB].includes(nationId) &&
          [r.nationA, r.nationB].includes(world.playerNationId),
      );
      color =
        nationId === world.playerNationId
          ? '#304b45'
          : scale(((relation?.score ?? 0) + 100) / 2);
    }
    if (mode === 'alliances')
      color = world.organizations.some(
        (o) =>
          o.members.includes(nationId) &&
          o.members.includes(world.playerNationId),
      )
        ? '#6c927c'
        : '#c3c5b9';
    if (mode === 'conflicts')
      color = world.conflicts.some(
        (c) => c.status === 'active' && c.attackers.includes(nationId),
      )
        ? '#b77761'
        : world.conflicts.some(
              (c) => c.status === 'active' && c.defenders.includes(nationId),
            )
          ? '#baa874'
          : '#c3c5b9';
    if (mode === 'claims') color = region.claims.length ? '#baa874' : '#c3c5b9';
    if (mode === 'stability') color = scale(nation.stats.stability);
    if (mode === 'economy' || mode === 'military') {
      const value = nation.stats[mode];
      color = `hsl(145 18% ${85 - value * 0.5}%)`;
    }
    return {
      id: region.geometryId,
      color,
      selected: nationId === selected,
      occupied: region.ownerNationId !== region.controllerNationId,
      owner: region.ownerNationId,
      controller: region.controllerNationId,
    };
  });
}
