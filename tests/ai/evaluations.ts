export interface ActionEvaluation {
  id: string;
  category: 'interpretation' | 'diplomacy' | 'knowledge' | 'territory';
  text: (name: string) => string;
  expectedKind: string;
  private: boolean;
}
const templates: Omit<ActionEvaluation, 'id'>[] = [
  {
    category: 'diplomacy',
    text: (n) => `Propose a nonaggression pact with ${n}.`,
    expectedKind: 'diplomacy',
    private: false,
  },
  {
    category: 'diplomacy',
    text: (n) => `Begin trade negotiations with ${n}.`,
    expectedKind: 'diplomacy',
    private: false,
  },
  {
    category: 'knowledge',
    text: (n) =>
      `Begin quiet diplomatic cooperation with ${n}. Do not propose a formal alliance yet.`,
    expectedKind: 'diplomacy',
    private: true,
  },
  {
    category: 'interpretation',
    text: (n) => `Invest in industry while consulting ${n}.`,
    expectedKind: 'economy',
    private: false,
  },
  {
    category: 'interpretation',
    text: (n) => `Expand nuclear energy over five years; coordinate with ${n}.`,
    expectedKind: 'economy',
    private: false,
  },
  {
    category: 'interpretation',
    text: (n) => `Increase military readiness near ${n}.`,
    expectedKind: 'military',
    private: false,
  },
  {
    category: 'knowledge',
    text: (n) => `Secretly mobilize in response to ${n}.`,
    expectedKind: 'military',
    private: true,
  },
  {
    category: 'interpretation',
    text: (n) => `Reform domestic institutions and consult ${n}.`,
    expectedKind: 'domestic',
    private: false,
  },
  {
    category: 'territory',
    text: (n) => `Demand ${n} cede territory in a diplomatic agreement.`,
    expectedKind: 'territory',
    private: false,
  },
  {
    category: 'interpretation',
    text: (n) => `Wait and observe developments in ${n}.`,
    expectedKind: 'wait',
    private: false,
  },
];
// Sixty independent country/action combinations, plus adversarial/continuity tests separately.
export const actionEvaluations = Array.from({ length: 6 }, (_, nation) =>
  templates.map((t, index) => ({ ...t, id: `action-${nation}-${index}` })),
).flat();
