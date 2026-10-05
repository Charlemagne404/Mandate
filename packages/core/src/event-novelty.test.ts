import { describe, expect, it } from 'vitest';
import {
  ActionId,
  CommandId,
  Event,
  EventId,
  NationId,
  TurnId,
} from '@mandate/schemas';
import { semanticEventSignature, surfaceNovelEvents } from './event-novelty.js';

let nextEvent = 0;
function makeEvent(
  overrides: Partial<Event> & Pick<Event, 'title' | 'type' | 'date'>,
) {
  const sequence = ++nextEvent;
  const { id: idOverride, type, title, date, ...rest } = overrides;
  return Event.parse({
    id: idOverride ?? EventId.parse(`event:novelty-${sequence}`),
    type,
    title,
    nationIds: [
      NationId.parse('nation:belize'),
      NationId.parse('nation:france'),
    ],
    regionIds: [],
    treatyIds: [],
    conflictIds: [],
    importance: 65,
    novelty: 'consequence',
    topics: [],
    visibility: 'public',
    status: 'resolved',
    effects: [],
    date,
    turnId: TurnId.parse(`turn:novelty-${sequence}`),
    sourceCommandIds: [CommandId.parse(`command:novelty-${sequence}`)],
    ...rest,
  });
}

describe('event novelty', () => {
  it('keeps recurring maintenance and low-value progress out of surfaced history', () => {
    const maintenance = makeEvent({
      title: 'Monthly integration upkeep',
      type: 'ORGANIZATION_INTEGRATION_PROGRESS',
      date: '2028-01-01',
      novelty: 'maintenance',
    });
    const progress = makeEvent({
      title: 'Integration advances by one point',
      type: 'ORGANIZATION_INTEGRATION_PROGRESS',
      date: '2028-01-01',
      novelty: 'progress',
      importance: 35,
    });

    const result = surfaceNovelEvents([], [maintenance, progress]);

    expect(result.events).toEqual([]);
    expect(result.metrics).toMatchObject({
      candidateCount: 2,
      surfacedCount: 0,
      maintenanceSuppressed: 1,
      progressSuppressed: 1,
    });
    expect(result.suppressedCommandIds).toHaveLength(2);
  });

  it('suppresses semantically repeated autonomous events across wording changes', () => {
    const prior = makeEvent({
      title: 'Belgium strengthens dialogue with France',
      type: 'DIPLOMATIC_ACTIVITY',
      date: '2028-01-01',
      provenance: {
        kind: 'automatic-effect',
        originatingActionId: ActionId.parse('action:original'),
        triggeringActionId: null,
      },
    });
    const repeated = makeEvent({
      title: 'Belgium expands consultations with France',
      type: 'DIPLOMATIC_ACTIVITY',
      date: '2028-02-01',
      provenance: {
        kind: 'independent-action',
        originatingActionId: null,
        triggeringActionId: ActionId.parse('action:current'),
      },
    });

    expect(semanticEventSignature(prior)).toBe(
      semanticEventSignature(repeated),
    );
    const result = surfaceNovelEvents([prior], [repeated]);

    expect(result.events).toEqual([]);
    expect(result.metrics.duplicateSuppressed).toBe(1);
  });

  it('keeps a new milestone stage and an explicit player order visible', () => {
    const halfway = makeEvent({
      title: 'Regional infrastructure program reaches 50%',
      type: 'ORGANIZATION_PROGRAM_MILESTONE',
      date: '2028-06-01',
      novelty: 'milestone',
      semanticSignature: 'organization:caeu:program:infrastructure:stage:50',
      provenance: {
        kind: 'automatic-effect',
        originatingActionId: ActionId.parse('action:proposal'),
        triggeringActionId: null,
      },
    });
    const completed = makeEvent({
      title: 'Regional infrastructure program enters operation',
      type: 'ORGANIZATION_PROGRAM_MILESTONE',
      date: '2028-12-01',
      novelty: 'milestone',
      semanticSignature: 'organization:caeu:program:infrastructure:stage:100',
      provenance: {
        kind: 'automatic-effect',
        originatingActionId: ActionId.parse('action:proposal'),
        triggeringActionId: null,
      },
    });
    const repeatedOrder = makeEvent({
      title: 'Nicaragua proposes regional infrastructure',
      type: 'START_ORGANIZATION_PROGRAM',
      date: '2028-12-01',
      novelty: 'new-action',
      semanticSignature:
        'organization:caeu:program:infrastructure:issuer:nicaragua',
      provenance: {
        kind: 'current-player-order',
        originatingActionId: ActionId.parse('action:current'),
        triggeringActionId: ActionId.parse('action:current'),
      },
    });

    const result = surfaceNovelEvents([halfway], [completed, repeatedOrder]);

    expect(result.events).toEqual([completed, repeatedOrder]);
    expect(result.metrics.duplicateSuppressed).toBe(0);
  });
});
