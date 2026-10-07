import { describe, expect, it } from 'vitest';
import { NationId } from '@mandate/schemas';
import { PlayerIntent } from './contracts.js';
import { authorizedDiplomaticProposal, scopeIntent } from './perspective.js';

const nicaragua = NationId.parse('nation:nic');
const honduras = NationId.parse('nation:hnd');
const guatemala = NationId.parse('nation:gtm');

function compoundIntent() {
  return PlayerIntent.parse({
    version: 1,
    actorNationId: nicaragua,
    summary:
      'Privately consult Honduras on energy cooperation. Increase military readiness.',
    targetNationIds: [honduras],
    targetRegionIds: [],
    visibility: 'private',
    policyOrders: [
      {
        authority: 'player-policy-order',
        kind: 'diplomacy',
        text: 'Privately consult Honduras on energy cooperation.',
        sourceClauseIds: [0],
        targetNationIds: [honduras],
        targetRegionIds: [],
        intensity: 'low',
        persistent: false,
        visibility: 'private',
      },
      {
        authority: 'player-policy-order',
        kind: 'military',
        text: 'Increase military readiness.',
        sourceClauseIds: [1],
        targetNationIds: [honduras],
        targetRegionIds: [],
        intensity: 'medium',
        persistent: false,
        visibility: 'private',
      },
    ],
    desiredOutcomes: [],
    constraints: [],
    majorIntentClauses: [],
    intentions: [
      {
        kind: 'diplomacy',
        description: 'Privately consult Honduras on energy cooperation.',
        sourceClauseIds: [0],
        visibility: 'private',
        targetNationIds: [honduras],
      },
      {
        kind: 'military',
        description: 'Increase military readiness.',
        sourceClauseIds: [1],
        visibility: 'private',
        targetNationIds: [honduras],
      },
    ],
  });
}

describe('private diplomatic disclosure boundaries', () => {
  it('keeps a private domestic plan out of the communicated proposal', () => {
    const intent = compoundIntent();
    const proposal = authorizedDiplomaticProposal(intent, honduras);

    expect(proposal).toMatchObject({
      text: 'Privately consult Honduras on energy cooperation.',
      visibility: 'private',
      sourceClauseIds: [0],
    });
    expect(proposal?.text).not.toContain('Increase military readiness');
  });

  it('rejects a mixed diplomatic term that also contains a private internal clause', () => {
    const intent = compoundIntent();
    intent.policyOrders[0]!.sourceClauseIds = [0, 1];

    expect(authorizedDiplomaticProposal(intent, honduras)).toBeNull();
  });

  it('shares a private consultation only with its named recipient', () => {
    const intent = compoundIntent();
    const hondurasContext = scopeIntent(intent, honduras);
    const guatemalaContext = scopeIntent(intent, guatemala);

    expect(hondurasContext?.summary).toBe(
      'Privately consult Honduras on energy cooperation.',
    );
    expect(hondurasContext?.policyOrders.map((order) => order.text)).toEqual([
      'Privately consult Honduras on energy cooperation.',
    ]);
    expect(guatemalaContext).toBeNull();
  });
});
