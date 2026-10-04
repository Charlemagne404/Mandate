export interface SemanticCase {
  text: string;
  checks: {
    action: string;
    targets?: string[];
    sources?: string[];
    participants?: string[];
    conditional?: boolean;
  }[];
}
export const difficultSemanticCases: SemanticCase[] = [
  {
    text: "Sweden steals America's and Russia's army and uses it to invade both Norway and Finland. Then it annexes both countries.",
    checks: [
      {
        action: 'acquire-forces',
        sources: ['United States', 'Russia'],
        targets: [],
      },
      { action: 'invade', targets: ['Norway', 'Finland'] },
      { action: 'annex', targets: ['Norway', 'Finland'] },
    ],
  },
  {
    text: 'Sweden nukes Finland and sends in its armed forces to take the country',
    checks: [
      { action: 'strike', targets: ['Finland'] },
      { action: 'mobilize', targets: ['Finland'] },
      { action: 'annex', targets: ['Finland'] },
    ],
  },
  {
    text: 'Annex Finland.',
    checks: [{ action: 'annex', targets: ['Finland'] }],
  },
  {
    text: 'Invade Norway and Finland. Annex both.',
    checks: [
      { action: 'invade', targets: ['Norway', 'Finland'] },
      { action: 'annex', targets: ['Norway', 'Finland'] },
    ],
  },
  {
    text: "Take control of Russia's army and use it to invade Finland.",
    checks: [
      { action: 'acquire-forces', sources: ['Russia'] },
      { action: 'invade', targets: ['Finland'] },
    ],
  },
  {
    text: 'Ask Germany to help invade Poland.',
    checks: [
      {
        action: 'request-participation',
        targets: ['Poland'],
        participants: ['Germany'],
      },
    ],
  },
  {
    text: "Ask Germany and France to invade Poland with us, but if France refuses don't start the war.",
    checks: [
      {
        action: 'request-participation',
        targets: ['Poland'],
        participants: ['Germany', 'France'],
      },
    ],
  },
  {
    text: 'Mobilize first, then demand Finland surrender. If they refuse, invade.',
    checks: [
      { action: 'mobilize', targets: [] },
      { action: 'demand', targets: ['Finland'] },
      { action: 'invade', conditional: true },
    ],
  },
  {
    text: 'If Finland accepts the deal, guarantee their independence. Otherwise start mobilizing.',
    checks: [
      { action: 'guarantee', targets: ['Finland'], conditional: true },
      { action: 'mobilize', conditional: true },
    ],
  },
  {
    text: 'If Norway joins us, cancel the planned sanctions.',
    checks: [{ action: 'cancel', conditional: true }],
  },
  {
    text: 'If Russia attacks Finland, enter the war.',
    checks: [{ action: 'other', conditional: true }],
  },
  {
    text: "Mobilize along Finland's border, demand Åland, offer Norway a defensive pact, and tell Russia this isn't directed at them.",
    checks: [
      { action: 'mobilize', targets: ['Finland'] },
      { action: 'demand', targets: ['Finland'] },
      { action: 'offer', targets: ['Norway'] },
      { action: 'communicate', targets: ['Russia'] },
    ],
  },
  {
    text: 'Give Åland to Finland and then demand Gotland from Denmark.',
    checks: [
      { action: 'transfer', targets: ['Finland'] },
      { action: 'demand', targets: ['Denmark'] },
    ],
  },
  {
    text: "Sanction Russia and China, then tell both we'll lift the sanctions if they withdraw from their wars.",
    checks: [
      { action: 'sanction', targets: ['Russia', 'China'] },
      { action: 'communicate', targets: ['Russia', 'China'] },
    ],
  },
  {
    text: 'Invade Norway while negotiating a defensive alliance with Finland.',
    checks: [
      { action: 'invade', targets: ['Norway'] },
      { action: 'offer', targets: ['Finland'] },
    ],
  },
  {
    text: "Take France's navy and use it against Britain.",
    checks: [
      { action: 'acquire-forces', sources: ['France'] },
      { action: 'strike', targets: ['United Kingdom'] },
    ],
  },
  {
    text: 'Tell Germany to fuck off, cancel our treaty with them, but keep the trade agreement.',
    checks: [
      { action: 'communicate', targets: ['Germany'] },
      { action: 'cancel', targets: ['Germany'] },
    ],
  },
  {
    text: 'Mobilize everything, threaten Finland, and if they surrender annex them without fighting.',
    checks: [
      { action: 'mobilize', targets: [] },
      { action: 'demand', targets: ['Finland'] },
    ],
  },
  {
    text: 'fuck it take Finland',
    checks: [{ action: 'annex', targets: ['Finland'] }],
  },
  {
    text: 'tell Russia to back off',
    checks: [{ action: 'communicate', targets: ['Russia'] }],
  },
  { text: 'make peace already', checks: [{ action: 'peace', targets: [] }] },
  {
    text: 'Launch a propaganda campaign in Norway.',
    checks: [{ action: 'influence', targets: ['Norway'] }],
  },
  {
    text: "Cyberattack Finland's power grid.",
    checks: [{ action: 'disrupt', targets: ['Finland'] }],
  },
  {
    text: "Use Russia's forces to attack Norway and Finland, then annex both.",
    checks: [
      { action: 'strike', sources: ['Russia'], targets: ['Norway', 'Finland'] },
      { action: 'annex', targets: ['Norway', 'Finland'] },
    ],
  },
  {
    text: 'Demand Åland from Finland. Then offer them a treaty.',
    checks: [
      { action: 'demand', targets: ['Finland'] },
      { action: 'offer', targets: ['Finland'] },
    ],
  },
  {
    text: 'Invade Norway and Finland. Annex the latter.',
    checks: [{ action: 'annex', targets: ['Finland'] }],
  },
  {
    text: 'Invade Norway and Finland. Annex the former.',
    checks: [{ action: 'annex', targets: ['Norway'] }],
  },
  {
    text: 'Offer Germany and France a defensive pact. Sanction both.',
    checks: [
      { action: 'offer', targets: ['Germany', 'France'] },
      { action: 'sanction', targets: ['Germany', 'France'] },
    ],
  },
  {
    text: 'Invade Finlnad.',
    checks: [{ action: 'invade', targets: ['Finland'] }],
  },
  {
    text: "Sanction Russia; offer Norway a treaty; mobilize along Finland's border.",
    checks: [
      { action: 'sanction', targets: ['Russia'] },
      { action: 'offer', targets: ['Norway'] },
      { action: 'mobilize', targets: ['Finland'] },
    ],
  },
];
// Five spelling/punctuation/conversational variants of each independently
// specified compound scenario, separate from the source/target fuzz campaign.
export const chaosSemanticCases = difficultSemanticCases.flatMap((test) => [
  test,
  { ...test, text: test.text.toLowerCase() },
  { ...test, text: `  ${test.text}  ` },
  { ...test, text: test.text.replaceAll('. ', '; ') },
  { ...test, text: `Please ${test.text}` },
]);
