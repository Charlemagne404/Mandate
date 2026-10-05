import type { Event } from '@mandate/schemas';

const duplicateWindowDays = 365 * 5;
const day = (date: string) => Date.parse(date) / 86400000;

function boundedSignature(value: string) {
  if (value.length <= 500) return value;
  let first = 2166136261;
  let second = 2246822519;
  for (const character of value) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  const digest = `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  return `${value.slice(0, 480)}#${digest}`;
}

function semanticText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\b(?:strengthen|deepen|expand|advance|promote|improve)\w*\b/g,
      'increase',
    )
    .replace(
      /\b(?:dialogue|talks|consultation|consultations)\b/g,
      'coordination',
    )
    .replace(
      /\b(?:among|between|with|for|the|a|an|of|its|their|current)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function semanticEventSignature(event: Event): string {
  if (event.semanticSignature) return boundedSignature(event.semanticSignature);
  const actors = [...event.nationIds].sort().join(',');
  const entities = [
    ...event.topics.filter((topic) =>
      /^(?:organization|program|commitment|initiative):/.test(topic),
    ),
    ...event.treatyIds,
    ...event.conflictIds,
    ...event.regionIds,
  ]
    .sort()
    .join(',');
  const phrase = semanticText(event.title);
  if (event.type === 'ADJUST_RELATION')
    return boundedSignature(
      `${event.type}|${actors}|${semanticText(event.title)}`,
    );
  return boundedSignature(`${event.type}|${actors}|${entities}|${phrase}`);
}

export interface EventNoveltyMetrics {
  candidateCount: number;
  surfacedCount: number;
  duplicateSuppressed: number;
  maintenanceSuppressed: number;
  progressSuppressed: number;
}

export function surfaceNovelEvents(
  history: readonly Event[],
  candidates: readonly Event[],
): {
  events: Event[];
  metrics: EventNoveltyMetrics;
  suppressedCommandIds: string[];
} {
  const events: Event[] = [];
  const suppressedCommandIds = new Set<string>();
  const recordSuppression = (candidate: Event) =>
    candidate.sourceCommandIds.forEach((id) => suppressedCommandIds.add(id));
  const metrics: EventNoveltyMetrics = {
    candidateCount: candidates.length,
    surfacedCount: 0,
    duplicateSuppressed: 0,
    maintenanceSuppressed: 0,
    progressSuppressed: 0,
  };
  const seen = [...history];
  for (const candidate of candidates) {
    if (candidate.novelty === 'maintenance') {
      metrics.maintenanceSuppressed++;
      recordSuppression(candidate);
      continue;
    }
    if (candidate.novelty === 'progress' && candidate.importance < 60) {
      metrics.progressSuppressed++;
      recordSuppression(candidate);
      continue;
    }
    const signature = semanticEventSignature(candidate);
    const automaticOrAutonomous =
      candidate.provenance?.kind === 'automatic-effect' ||
      candidate.provenance?.kind === 'independent-action';
    const duplicate = seen.some(
      (previous) =>
        day(candidate.date) - day(previous.date) <= duplicateWindowDays &&
        semanticEventSignature(previous) === signature,
    );
    if (
      duplicate &&
      (automaticOrAutonomous || candidate.novelty === 'milestone')
    ) {
      metrics.duplicateSuppressed++;
      recordSuppression(candidate);
      continue;
    }
    candidate.semanticSignature = signature;
    events.push(candidate);
    seen.push(candidate);
  }
  metrics.surfacedCount = events.length;
  return { events, metrics, suppressedCommandIds: [...suppressedCommandIds] };
}
