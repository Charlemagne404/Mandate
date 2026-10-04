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
  const nationById = new Map(
    world.nations.map((nation) => [nation.id, nation]),
  );
  const relationByNation = new Map<string, number>();
  for (const relation of world.relations) {
    if (relation.nationA === world.playerNationId)
      relationByNation.set(relation.nationB, relation.score);
    if (relation.nationB === world.playerNationId)
      relationByNation.set(relation.nationA, relation.score);
  }
  const sharedOrganizationMembers = new Set(
    world.organizations
      .filter((organization) =>
        organization.members.includes(world.playerNationId),
      )
      .flatMap((organization) => organization.members),
  );
  const attackers = new Set(
    world.conflicts
      .filter((conflict) => conflict.status === 'active')
      .flatMap((conflict) => conflict.attackers),
  );
  const defenders = new Set(
    world.conflicts
      .filter((conflict) => conflict.status === 'active')
      .flatMap((conflict) => conflict.defenders),
  );
  return world.regions.map((region) => {
    const nationId =
      mode === 'control' ? region.controllerNationId : region.ownerNationId;
    const nation = nationById.get(nationId)!;
    let color = nation.color;
    if (mode === 'relations') {
      color =
        nationId === world.playerNationId
          ? '#304b45'
          : scale(((relationByNation.get(nationId) ?? 0) + 100) / 2);
    }
    if (mode === 'alliances')
      color = sharedOrganizationMembers.has(nationId) ? '#6c927c' : '#c3c5b9';
    if (mode === 'conflicts')
      color = attackers.has(nationId)
        ? '#b77761'
        : defenders.has(nationId)
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
      disputed: region.claims.length > 0,
    };
  });
}
