import type { ContextBundle } from '@mandate/memory';
import type { PlayerIntent } from './contracts.js';

/** An evidence dossier, not a decision score. No private foreign indicators inferred. */
export function decisionInputs(c: ContextBundle, intent: PlayerIntent | null) {
  const own = c.canonical.nations.find((n) => n.id === c.perspectiveNationId)!;
  const counterpart = intent?.actorNationId;
  const r = c.canonical.relations.find(
    (r) =>
      counterpart &&
      [r.nationA, r.nationB].includes(own.id) &&
      [r.nationA, r.nationB].includes(counterpart),
  );
  return {
    version: 'decision-inputs-v1',
    strategicBenefit: {
      proposal: intent?.summary ?? null,
      instruction:
        'Identify concrete gains and opportunity costs against goals; compatible low-cost cooperation can be worthwhile without a treaty',
    },
    strategicInterests: c.canonical.goals
      .filter((g) => g.nationId === own.id)
      .map((g) => ({
        id: g.id,
        title: g.title,
        priority: g.priority,
        status: g.status,
        pressure: g.pressure,
        evaluation: g.evaluation,
        blockers: g.blockers,
        deferredToGoalId: g.deferredToGoalId,
        strategyReview: g.strategyReview,
      })),
    strategicCost:
      'Compare proposed obligations with sovereign autonomy, active policy and scarce execution capacity; no automatic consent',
    domestic: {
      stability: own.stats.stability,
      legitimacy: own.stats.legitimacy,
      unrest: own.stats.unrest,
    },
    resources: {
      treasury: own.stats.treasury,
      fiscal: own.stats.fiscal,
      activeProjectCount: c.canonical.initiatives.filter(
        (i) => (i as { nationId?: string }).nationId === own.id,
      ).length,
    },
    trust: r
      ? {
          score: r.score,
          trust: r.trust,
          tension: r.tension,
          grievances: r.grievances,
          recentBehavior: r.factors.slice(-5),
        }
      : null,
    commitments: c.canonical.commitments
      .filter((k) => k.issuer === own.id || k.recipients.includes(own.id))
      .map((k) => ({
        id: k.id,
        type: k.type,
        status: k.status,
        dueDate: k.dueDate,
      })),
    redLines: own.strategy.redLines,
    policy: {
      orientation: own.strategy.orientation,
      riskTolerance: own.strategy.riskTolerance,
    },
    militaryRisk: c.canonical.conflicts.map((f) => ({
      id: f.id,
      status: f.status,
      exhaustion: f.exhaustion,
      escalation: f.escalation,
    })),
    crises: c.canonical.crises.map((c) => ({
      id: c.id,
      severity: c.severity,
      status: c.status,
    })),
    economicExposure: c.canonical.economicLinks.filter(
      (l) => l.dependentNationId === own.id,
    ),
    sanctions: c.canonical.sanctions,
    negotiations: c.canonical.conferences.map((c) => ({
      id: c.id,
      status: c.status,
      round: c.round,
    })),
    alternatives: [
      'Reject incompatible terms',
      'Counter with narrower reciprocal terms',
      'Delay for information or domestic consultation',
      'Ignore low value approaches',
      'Accept compatible beneficial terms',
    ],
    uncertainty:
      'Foreign private readiness, treasury, red lines and intent are unknown unless supplied; absence of evidence is not confirmation',
    instruction:
      'Identify only material decision factors. Distinguish observed facts from uncertainty. Compare alternatives; do not expose hidden reasoning. Consultation may also be rejected when it imposes cost or serves no national interest.',
  };
}
