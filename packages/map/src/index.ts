import type { NationId, WorldState } from '@mandate/schemas';
import { influenceProfile } from '@mandate/core';
import type { SubjectTier } from '@mandate/core';
export type MapMode =
  | 'ownership'
  | 'control'
  | 'relations'
  | 'alliances'
  | 'conflicts'
  | 'claims'
  | 'stability'
  | 'economy'
  | 'military'
  | 'influence';
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
  {
    value: 'influence',
    label: 'Sphere of influence',
    legend:
      'Green: partner · olive: dependent partner · gold: client · mauve: protectorate · violet: subject · deep violet: puppet · stone: contested · rival color: rival leads',
  },
];
const scale = (value: number) =>
  value < 30 ? '#b77761' : value < 60 ? '#baa874' : '#6c927c';
const subjectColor = (tier: SubjectTier) => {
  switch (tier) {
    case 'INDEPENDENT':
      return '#c3c5b9';
    case 'PARTNER':
      return '#91ad9c';
    case 'DEPENDENT PARTNER':
      return '#a6b57d';
    case 'CLIENT STATE':
      return '#b7a363';
    case 'PROTECTORATE':
      return '#bd896f';
    case 'SUBJECT STATE':
      return '#9a7390';
    case 'PUPPET STATE':
      return '#654e78';
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
};
function patronsForSubject(world: WorldState, subject: NationId) {
  const patrons = new Set<NationId>();
  world.economicLinks
    .filter((link) => link.dependentNationId === subject)
    .forEach((link) => patrons.add(link.partnerNationId));
  for (const treaty of world.treaties)
    if (treaty.status === 'active')
      for (const term of treaty.influenceTerms)
        if (term.subjectNationId === subject) patrons.add(term.patronNationId);
  for (const initiative of world.initiatives)
    if (initiative.kind === 'aid' && initiative.targetNationId === subject)
      patrons.add(initiative.nationId);
  for (const organization of world.organizations) {
    if (
      organization.status !== 'active' ||
      !organization.members.includes(subject)
    )
      continue;
    for (const founder of organization.founders)
      if (founder !== subject) patrons.add(founder);
    for (const commitment of organization.commitments)
      if (commitment.issuer !== subject && commitment.status === 'active')
        patrons.add(commitment.issuer);
    for (const program of organization.programs)
      if (
        program.issuerNationId !== subject &&
        program.participantNationIds.includes(subject)
      )
        patrons.add(program.issuerNationId);
  }
  return [...patrons].filter((id) => id !== subject);
}
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
  const influenceColors = new Map<NationId, string>();
  if (mode === 'influence')
    for (const counterpart of world.nations) {
      if (counterpart.id === selected) {
        influenceColors.set(counterpart.id, '#304b45');
        continue;
      }
      const selectedSphere = influenceProfile(world, selected, counterpart.id);
      const rival = patronsForSubject(world, counterpart.id)
        .filter((patron) => patron !== selected)
        .map((patron) => ({
          patron,
          profile: influenceProfile(world, patron, counterpart.id),
        }))
        .sort(
          (left, right) => right.profile.leverage - left.profile.leverage,
        )[0];
      const contested = Boolean(
        rival &&
        selectedSphere.leverage >= 20 &&
        rival.profile.leverage >= 20 &&
        Math.abs(rival.profile.leverage - selectedSphere.leverage) < 12,
      );
      influenceColors.set(
        counterpart.id,
        contested
          ? '#827d71'
          : rival && rival.profile.leverage >= selectedSphere.leverage + 12
            ? (nationById.get(rival.patron)?.color ?? '#7c8284')
            : subjectColor(selectedSphere.tier),
      );
    }
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
    if (mode === 'influence')
      color = influenceColors.get(nationId) ?? '#c3c5b9';
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
