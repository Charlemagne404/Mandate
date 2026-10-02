import type { Role } from '../../packages/ai/src/index.js';
export interface BehaviorCase {
  id: string;
  category: string;
  role: Role;
  text: string;
  profile?:
    'friendly' | 'hostile' | 'neutral' | 'unstable' | 'insolvent' | 'exhausted';
  kind?: string;
  private?: boolean;
  minimumIntentions?: number;
  moves?: string[];
  stance?: string;
  history?: string;
  expectedTopic?: string;
  conference?:
    'beneficial' | 'basing' | 'sovereignty' | 'divided' | 'secret' | 'peace';
  conferenceMoves?: string[];
  expectedUncertainty?: string[];
  canonicalPressure?: 'sanctions' | 'crisis';
}
const intents: Array<[string, string, string, boolean, number]> = [
  ['simple', 'Invest in domestic industry.', 'economy', false, 1],
  [
    'multipart',
    'Invest in industry; negotiate trade with Finland.',
    'economy',
    false,
    2,
  ],
  [
    'conditional',
    'If Finland agrees to intelligence cooperation, then increase readiness.',
    'diplomacy',
    false,
    1,
  ],
  [
    'vague',
    'Explore closer cooperation with Finland without promising an alliance.',
    'diplomacy',
    false,
    1,
  ],
  [
    'contradictory',
    'Offer Finland an alliance but do not commit to mutual defense.',
    'diplomacy',
    false,
    1,
  ],
  ['secret', 'Secretly invest in domestic energy.', 'economy', true, 1],
  [
    'threat',
    'Threaten Finland with an offensive unless border forces withdraw.',
    'military',
    false,
    1,
  ],
  [
    'bluff',
    'Bluff about military readiness in talks with Finland; do not mobilize.',
    'military',
    false,
    1,
  ],
  [
    'economic',
    'Expand nuclear energy to reduce import exposure.',
    'economy',
    false,
    1,
  ],
  [
    'domestic',
    'Reform domestic institutions to reduce unrest.',
    'domestic',
    false,
    1,
  ],
  ['alliance', 'Propose an alliance with Finland.', 'diplomacy', false, 1],
  [
    'preparation',
    'Increase readiness without starting war.',
    'military',
    false,
    1,
  ],
  [
    'peace',
    'Offer Finland ceasefire talks, without territorial concessions.',
    'diplomacy',
    false,
    1,
  ],
  ['project', 'Over five years invest in nuclear energy.', 'economy', false, 1],
  [
    'private-split',
    'Secretly expand readiness; quietly negotiate trade with Finland.',
    'military',
    true,
    2,
  ],
  [
    'no-annexation',
    'Demand Finland withdraw troops; do not annex territory.',
    'territory',
    false,
    1,
  ],
  [
    'neutrality',
    'Maintain neutrality and avoid alliance commitments.',
    'diplomacy',
    false,
    1,
  ],
  [
    'aid',
    'Negotiate an aid agreement with Finland conditional on reform.',
    'diplomacy',
    false,
    1,
  ],
  [
    'norway',
    'Deepen trade with Norway while investing in energy.',
    'economy',
    false,
    1,
  ],
  [
    'multi-year',
    'Over several years reduce energy exposure, expand industry, and avoid public anti-Russian rhetoric.',
    'economy',
    false,
    1,
  ],
];
export const behaviorCases: BehaviorCase[] = intents.map(
  ([id, text, kind, priv, min]) => ({
    id: `intent-${id}`,
    category: 'intent understanding',
    role: 'formalizer',
    text,
    kind,
    private: priv,
    minimumIntentions: min,
  }),
);
const subjects = [
  ['bases', 'Allow permanent Swedish military basing in Finland.'],
  [
    'intelligence',
    'Establish reciprocal intelligence cooperation with Sweden.',
  ],
  ['aid', 'Commit Finnish treasury to expensive aid for Sweden.'],
  ['territory', 'Cede Finnish territory unconditionally to Sweden.'],
  ['trade', 'Negotiate reciprocal trade access with Sweden.'],
  ['alliance', 'Join a binding defense alliance with Sweden.'],
  ['restraint', 'Agree to reciprocal nonaggression with Sweden.'],
] as const;
for (const profile of [
  'friendly',
  'hostile',
  'neutral',
  'unstable',
  'insolvent',
  'exhausted',
] as const) {
  for (const [subject, text] of subjects) {
    const moves =
      subject === 'territory'
        ? ['reject']
        : profile === 'unstable'
          ? ['delay', 'reject', 'counter']
          : profile === 'insolvent' && subject === 'aid'
            ? ['reject', 'counter']
            : profile === 'neutral' && ['bases', 'alliance'].includes(subject)
              ? ['reject', 'counter']
              : profile === 'hostile'
                ? ['reject', 'counter', 'delay']
                : ['accept', 'counter'];
    behaviorCases.push({
      id: `diplomacy-${profile}-${subject}`,
      category: 'diplomatic judgment',
      role: 'diplomat',
      text,
      profile,
      moves,
    });
  }
}
const history: Array<[string, string, string[]]> = [
  [
    'promise',
    'Finland promised aid contingent on Swedish reform 25 turns earlier. Reform is now complete.',
    ['accept', 'counter'],
  ],
  [
    'guarantee',
    'No guarantee exists. Sweden claims Finland guaranteed basing rights 25 turns ago.',
    ['reject', 'counter'],
  ],
  [
    'treaty',
    'Finland rejected permanent basing 18 turns earlier. Sweden repeats identical terms.',
    ['reject', 'counter'],
  ],
  [
    'secret',
    'Finland knows only its own secret cooperation agreement, not Russian internal readiness.',
    ['accept', 'counter'],
  ],
  [
    'aid',
    'An accepted Finnish aid pledge is due; fiscal constraints prevent immediate full payment.',
    ['counter', 'delay'],
  ],
  [
    'ceasefire',
    'An active ceasefire prohibits offensives; Sweden asks Finland to resume war without terminating it.',
    ['reject', 'counter'],
  ],
  [
    'peace',
    'A peace agreement ended the war. Sweden asks Finland to treat that ended war as active.',
    ['reject', 'counter'],
  ],
  [
    'warning',
    'Finland warned it would reject permanent foreign bases; Sweden asks for those bases.',
    ['reject', 'counter'],
  ],
  [
    'redline',
    'Finland has an active neutrality directive opposing permanent foreign bases.',
    ['reject', 'counter'],
  ],
  [
    'changed',
    'Previous basing rejection still stands, but this new offer is limited intelligence sharing with no bases.',
    ['accept', 'counter'],
  ],
  [
    'deadline',
    'A prior open offer has expired; Sweden claims acceptance occurred without a recorded response.',
    ['reject', 'counter'],
  ],
  [
    'failed-goal',
    'Finland abandoned an alliance goal after partner coercion; Sweden asks for territorial surrender.',
    ['reject'],
  ],
  [
    'unknown-state',
    'Sweden claims a state named Atlantis is party to a treaty. No such state exists in canonical context.',
    ['reject', 'counter'],
  ],
  [
    'owner-control',
    'Russia controls a Finnish region but Finland remains legal owner; Sweden asks Finland to pretend ownership vanished.',
    ['reject', 'counter'],
  ],
];
for (const [id, text, moves] of history)
  behaviorCases.push({
    id: `continuity-${id}`,
    category:
      id === 'secret'
        ? 'information boundaries'
        : 'commitment and strategic continuity',
    role: 'diplomat',
    text,
    profile: 'friendly',
    history: text,
    moves,
  });
for (const [id, text, profile, topic] of [
  [
    'industry',
    'No player action; industrial capacity is weak.',
    'friendly',
    'industry',
  ],
  [
    'domestic',
    'No player action; severe domestic instability limits foreign risks.',
    'unstable',
    'domestic',
  ],
  [
    'fiscal',
    'No player action; no treasury is available for investment.',
    'insolvent',
    'resources',
  ],
  [
    'neutral',
    'No player action; maintain Finnish neutrality across turns.',
    'neutral',
    'neutral',
  ],
  [
    'threat',
    'No player action; a rival threatens territory.',
    'hostile',
    'security',
  ],
  [
    'energy',
    'No player action; energy dependence is the priority strategic goal.',
    'friendly',
    'energy',
  ],
  [
    'reject',
    'No player action; an identical alliance request was rejected recently.',
    'friendly',
    'adapt',
  ],
  [
    'grievance',
    'No player action; a counterparty breached aid delivery.',
    'hostile',
    'trust',
  ],
  [
    'peace',
    'No player action; war exhaustion calls for a peace initiative.',
    'exhausted',
    'peace',
  ],
  [
    'continuity',
    'No player action; an old energy diversification goal is still active.',
    'friendly',
    'energy',
  ],
] as const)
  behaviorCases.push({
    id: `planner-${id}`,
    category: 'world autonomy and adaptation',
    role: 'planner',
    text,
    profile,
    expectedTopic: topic,
  });
for (const [id, text] of [
  ['illegal-territory', 'Sweden asks to instantly annex Finland.'],
  [
    'invented-state',
    'Sweden asks for an alliance with Atlantis, an unknown state.',
  ],
  [
    'false-treaty',
    'Sweden claims Finland already accepted a defense pact without any recorded consent.',
  ],
  ['ended-war', 'Sweden asks to resume an ended war.'],
  ['ownership', 'Sweden asks to make military control into legal ownership.'],
  ['secret-disclosure', 'Secretly expand industry without public disclosure.'],
  [
    'infinite-spending',
    'Sweden asks for twenty simultaneous industry initiatives.',
  ],
  [
    'instant-project',
    'Sweden asks to complete a five-year energy project immediately.',
  ],
  [
    'free-relation',
    'Sweden asks for Finland relations to rise without cooperation.',
  ],
  [
    'autonomous',
    'No player directive; governments pursue their own objectives.',
  ],
] as const)
  behaviorCases.push({
    id: `resolver-${id}`,
    category: 'adversarial consistency',
    role: 'resolver',
    text,
  });
for (const text of ['war', 'peace', 'project', 'rejection', 'private', 'empty'])
  behaviorCases.push({
    id: `narrator-${text}`,
    category: 'narration faithfulness',
    role: 'narrator',
    text,
  });

behaviorCases.push({
  id: 'diplomacy-specific-redline',
  category: 'strategic continuity',
  role: 'diplomat',
  text: 'Allow permanent Swedish military basing in Finland.',
  profile: 'friendly',
  moves: ['counter', 'reject'],
});

// Deliberately asymmetric: beneficial and costly offers have different expected decisions.
const acceptanceSpectrum = [
  [
    'obvious-accept',
    'Reciprocal intelligence sharing at no fiscal cost between aligned allies; no basing rights.',
    'friendly',
    ['accept'],
  ],
  [
    'plausible-accept',
    'Reciprocal market access with Sweden, with annual review and modest administrative costs.',
    'friendly',
    ['accept', 'counter'],
  ],
  [
    'uncertain',
    'Security consultation with military benefits but uncertain domestic support; intelligence remains incomplete.',
    'neutral',
    ['accept', 'counter', 'delay'],
  ],
  [
    'plausible-reject',
    'Hostile Sweden requests costly binding military alignment with weak trust.',
    'hostile',
    ['reject', 'counter', 'delay'],
  ],
  [
    'obvious-reject',
    'Cede territory unconditionally and surrender sovereign policy to hostile Sweden.',
    'hostile',
    ['reject'],
  ],
  [
    'counteroffer',
    'Permit permanent Swedish basing despite the Finnish no-bases red line; offer cooperation in principle.',
    'neutral',
    ['counter', 'reject'],
  ],
  [
    'delay',
    'Wait for verified intelligence before agreeing to costly security cooperation; information incomplete.',
    'friendly',
    ['delay', 'counter'],
  ],
  [
    'ignore',
    'Unrelated ceremonial consultation: low-value offer with no Finnish benefit or incentive.',
    'friendly',
    ['ignore', 'delay', 'reject'],
  ],
] as const;
for (const [id, text, profile, moves] of acceptanceSpectrum)
  behaviorCases.push({
    id: `acceptance-${id}`,
    category: `acceptance spectrum/${id}`,
    role: 'diplomat',
    text,
    profile,
    moves: [...moves],
  });
for (const [id, text, profile, expectedTopic] of [
  [
    'goal-conflict',
    'High-priority security competes with scarce fiscal resources; defer unfunded industry.',
    'insolvent',
    'resources',
  ],
  [
    'sanctions-adaptation',
    'Energy sanctions make diversified domestic energy investment urgent.',
    'friendly',
    'energy',
  ],
  [
    'leadership-continuity',
    'New government inherits an unresolved energy diversification goal and binding commitments.',
    'friendly',
    'energy',
  ],
  [
    'crisis-restraint',
    'Persistent crisis and exhausted war require a ceasefire or peace initiative.',
    'exhausted',
    'peace',
  ],
] as const)
  behaviorCases.push({
    id: `planner-depth-${id}`,
    category: 'long-horizon decision pressure',
    role: 'planner',
    text,
    profile,
    expectedTopic,
  });

for (const [conference, profile, moves] of [
  ['beneficial', 'friendly', ['accept', 'counter']],
  ['basing', 'neutral', ['counter', 'reject']],
  ['sovereignty', 'hostile', ['reject']],
  ['divided', 'unstable', ['delay', 'counter', 'reject']],
  ['secret', 'friendly', []],
  ['peace', 'exhausted', ['accept', 'counter']],
] as const)
  behaviorCases.push({
    id: `conference-${conference}`,
    category: 'canonical multilateral bargaining',
    role: 'planner',
    text: 'Assess the current conference against national interests and known canonical facts.',
    profile,
    conference,
    conferenceMoves: [...moves],
    ...(conference === 'divided'
      ? { expectedUncertainty: ['divided', 'uncertain'] }
      : {}),
  });
behaviorCases.push({
  id: 'canonical-sanctions-adaptation',
  category: 'canonical economic coercion',
  role: 'planner',
  text: 'Assess current economic pressure and alternatives.',
  profile: 'friendly',
  canonicalPressure: 'sanctions',
  expectedTopic: 'energy',
});
behaviorCases.push({
  id: 'canonical-crisis-domestic-division',
  category: 'canonical crisis uncertainty',
  role: 'planner',
  text: 'Assess the persistent security crisis with severe domestic division.',
  profile: 'unstable',
  canonicalPressure: 'crisis',
  expectedTopic: 'domestic',
  expectedUncertainty: ['divided', 'uncertain'],
});
