import type { WorldState, NationId } from '@mandate/schemas';

export type InformationSubject = {
  kind:
    | 'event'
    | 'negotiation'
    | 'treaty'
    | 'conference'
    | 'crisis'
    | 'organization';
  id: string;
};
export function informationEntity(w: WorldState, s: InformationSubject) {
  switch (s.kind) {
    case 'event':
      return w.events.find((e) => e.id === s.id);
    case 'negotiation':
      return w.negotiations.find((e) => e.id === s.id);
    case 'treaty':
      return w.treaties.find((e) => e.id === s.id);
    case 'conference':
      return w.conferences.find((e) => e.id === s.id);
    case 'crisis':
      return w.crises.find((e) => e.id === s.id);
    case 'organization':
      return w.organizations.find((e) => e.id === s.id);
  }
}
export function informationParticipants(
  e: NonNullable<ReturnType<typeof informationEntity>>,
): NationId[] {
  if ('nationIds' in e) return e.nationIds;
  if ('proposerNationId' in e) return [e.proposerNationId, e.recipientNationId];
  if ('parties' in e) return e.parties;
  if ('participants' in e) return e.participants;
  return e.members;
}
export function knowsInformation(
  w: WorldState,
  nationId: NationId,
  subject: InformationSubject,
) {
  const e = informationEntity(w, subject);
  return (
    !!e &&
    (e.visibility !== 'private' ||
      informationParticipants(e).includes(nationId) ||
      w.knowledge.some(
        (k) =>
          k.subject.kind === subject.kind &&
          k.subject.id === subject.id &&
          k.recipient === nationId &&
          k.confidence === 'confirmed',
      ))
  );
}
