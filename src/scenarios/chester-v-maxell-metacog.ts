/**
 * Chester v Maxell -- METACOG Variant
 *
 * Same dispute. Same payoff matrix. But now Chester and Maxell are
 * VoidAgents with full personality stacks. Their histories, attachment
 * styles, traits, and mental health shape how they negotiate.
 *
 * Chester: health-anxious tenant. Avoidant attachment. High neuroticism.
 *   Mold exposure amplifies rejection of low offers that don't cover
 *   remediation. Avoidance bias makes him slower to confront but
 *   more rigid once committed.
 *
 * Maxell: financially stressed plaintiff. Conscientious, moderate anxiety.
 *   Legal costs create urgency. Trait-level conscientiousness pushes
 *   toward settlement. Secure attachment means he can compromise.
 *
 * The personality stacks constrain perception. Chester literally cannot
 * see low offers the same way Maxell does -- his health anxiety amplifies
 * the rejection signal at those dimensions. Maxell's financial stress
 * amplifies rejection of drawn-out negotiations.
 *
 * This is the before/after: same payoff matrix, personality-as-void
 * produces measurably different dynamics than flat walkers.
 */

import {
  type VoidAgent,
  type VoidAgentConfig,
  type PersonalityLayerConfig,
  type AgentTick,
  createVoidAgent,
  bond,
  perceive,
  perceiveOther,
  decide,
  observe,
  reflect,
  adapt,
  tick,
  completeTick,
  metacogState,
  personalityVector,
  actionPreferences,
  rejectionProfile,
} from '../../../gnosis/src/void-agent.js';

import type { Gait, Measurement } from '../../../gnosis/src/void.js';

import {
  chesterVMaxellPayoff,
  offerToAmount,
  OFFER_LABELS,
  NUM_CHOICES,
} from './chester-v-maxell';

// ============================================================================
// Personality profiles
// ============================================================================

/**
 * Chester's personality: health-anxious, avoidant, high neuroticism.
 *
 * Layer mapping to the 7-layer model:
 *   1. Temperament: high neuroticism, high sensitivity
 *   2. Attachment: avoidant (slow to engage, rigid once committed)
 *   3. Traits: conscientiousness moderate, agreeableness low
 *   4. Behaviors: avoidance, rumination
 *   5. Mental Health: elevated anxiety, physical symptoms from mold
 *   6. History: mold exposure trauma, landlord disputes
 *   7. Culture: tenant norms (expect habitability)
 */
export const CHESTER_PERSONALITY: PersonalityLayerConfig[] = [
  {
    name: 'temperament',
    timescale: 'lifetime',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // High neuroticism: void pre-accumulated at extreme offers (risk aversion)
    initialCounts: [3, 2, 1, 0.5, 0, 0, 0, 0, 0.5, 1, 2],
  },
  {
    name: 'attachment',
    timescale: 'lifetime',
    dimensions: 5,
    labels: ['secure', 'anxious', 'avoidant', 'disorganized', 'trust'],
    // Avoidant: high void at secure/trust (he doesn't trust easily)
    initialCounts: [2, 0.5, 0, 0.5, 3],
  },
  {
    name: 'traits',
    timescale: 'years',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Conscientiousness pushes toward fair (middle) offers
    initialCounts: [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 1],
  },
  {
    name: 'behaviors',
    timescale: 'months',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Avoidance: void at confrontational extremes
    initialCounts: [2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2],
  },
  {
    name: 'mental-health',
    timescale: 'weeks',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Health anxiety: low offers don't cover remediation ($20K+)
    // Offers below $150K (idx 0-4) leave Chester unable to remediate
    // This void is AMPLIFIED because mental health layer gets 1.5x rejection
    initialCounts: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0],
  },
  {
    name: 'history',
    timescale: 'years',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Mold trauma: previous landlord disputes taught him low offers are insults
    initialCounts: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: 'culture',
    timescale: 'generational',
    dimensions: 6,
    labels: [
      'collectivismIndividualism',
      'emotionalExpressiveness',
      'hierarchyEgalitarianism',
      'uncertaintyTolerance',
      'generationalTrauma',
      'generationalResilience',
    ],
    // Low uncertainty tolerance (wants resolution), some generational housing trauma
    initialCounts: [0, 0.5, 0, 2, 1, 0],
  },
];

/**
 * Maxell's personality: financially stressed, conscientious, secure attachment.
 *
 *   1. Temperament: moderate anxiety, moderate sensitivity
 *   2. Attachment: secure (can compromise, trusts process)
 *   3. Traits: high conscientiousness, moderate agreeableness
 *   4. Behaviors: methodical, cost-conscious
 *   5. Mental Health: financial stress, deadline pressure
 *   6. History: legal experience (knows costs of litigation)
 *   7. Culture: professional norms (expects reasonable resolution)
 */
export const MAXELL_PERSONALITY: PersonalityLayerConfig[] = [
  {
    name: 'temperament',
    timescale: 'lifetime',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Moderate anxiety: mild void at extremes, less than Chester
    initialCounts: [1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 1],
  },
  {
    name: 'attachment',
    timescale: 'lifetime',
    dimensions: 5,
    labels: ['secure', 'anxious', 'avoidant', 'disorganized', 'trust'],
    // Secure: low void at secure/trust (he trusts the process)
    initialCounts: [0, 1, 2, 2, 0],
  },
  {
    name: 'traits',
    timescale: 'years',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // High conscientiousness: void at extreme demands (too greedy = unprofessional)
    initialCounts: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3],
  },
  {
    name: 'behaviors',
    timescale: 'months',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Methodical: slight preference for middle range
    initialCounts: [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
  },
  {
    name: 'mental-health',
    timescale: 'weeks',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Financial stress: high offers (paying too much) cause anxiety
    // But also: drawn-out process is stressful (can't penalize length directly,
    // but high offers mean less money for legal fees → stress)
    initialCounts: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5],
  },
  {
    name: 'history',
    timescale: 'years',
    dimensions: NUM_CHOICES,
    labels: OFFER_LABELS,
    // Legal experience: knows $95K in costs, so offers below $100K net nothing
    // Void at very low offers (waste of time) and very high (unreasonable)
    initialCounts: [2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2],
  },
  {
    name: 'culture',
    timescale: 'generational',
    dimensions: 6,
    labels: [
      'collectivismIndividualism',
      'emotionalExpressiveness',
      'hierarchyEgalitarianism',
      'uncertaintyTolerance',
      'generationalTrauma',
      'generationalResilience',
    ],
    // Professional: moderate hierarchy acceptance, higher uncertainty tolerance
    initialCounts: [0, 1, 0, 0.5, 0, 0.5],
  },
];

// ============================================================================
// METACOG Mediation Loop
// ============================================================================

export interface MetacogRoundResult {
  round: number;
  /** Maxell's chosen offer index */
  maxellOffer: number;
  /** Chester's chosen offer index */
  chesterOffer: number;
  /** Payoffs */
  payoffMaxell: number;
  payoffChester: number;
  /** Whether offers overlapped (deal possible) */
  dealPossible: boolean;
  /** Metacognitive state */
  maxellGait: Gait;
  chesterGait: Gait;
  maxellEta: number;
  chesterEta: number;
  maxellEntropy: number;
  chesterEntropy: number;
  maxellKurtosis: number;
  chesterKurtosis: number;
  /** Social attention active */
  socialActive: boolean;
}

export interface MetacogMediationResult {
  rounds: MetacogRoundResult[];
  settled: boolean;
  convergenceRound: number | null;
  settlementAmount: number | null;
  settlementLabel: string | null;
  /** Final personality vectors (complement distributions over flattened stack) */
  maxellPersonalityVector: number[];
  chesterPersonalityVector: number[];
  /** Final action preferences (ranked by complement weight) */
  maxellPreferences: { action: number; weight: number }[];
  chesterPreferences: { action: number; weight: number }[];
  /** Final rejection profiles */
  maxellRejections: { action: number; voidCount: number }[];
  chesterRejections: { action: number; voidCount: number }[];
  /** Summary */
  summary: {
    totalRounds: number;
    settled: boolean;
    avgMaxellPayoff: number;
    avgChesterPayoff: number;
    dealRate: number;
    maxellGaitHistory: Gait[];
    chesterGaitHistory: Gait[];
    /** How many rounds each agent spent at each gait */
    maxellGaitDistribution: Record<Gait, number>;
    chesterGaitDistribution: Record<Gait, number>;
  };
}

/**
 * Run Chester v Maxell with METACOG agents.
 *
 * No external mediator. The agents negotiate directly, each constrained
 * by their personality stack. Social bonding (cross-attention) lets each
 * agent perceive the other's complement distribution and be influenced
 * by it -- but only if the other's suggestion has higher complement weight
 * than their own choice.
 *
 * Convergence: when both agents offer the same index for windowSize
 * consecutive rounds, that's settlement.
 */
export function runChesterVMaxellMetacog(
  maxRounds: number = 500,
  windowSize: number = 5,
  rng: () => number = Math.random
): MetacogMediationResult {
  // Create agents with personality stacks
  const maxell = createVoidAgent(
    {
      name: 'Maxell',
      actionDimensions: NUM_CHOICES,
      numHeads: 2,
      eta: 2.0,
      neighborhoodRadius: 1,
      decayRate: 0.01,
      personalityLayers: MAXELL_PERSONALITY,
    },
    rng
  );

  const chester = createVoidAgent(
    {
      name: 'Chester',
      actionDimensions: NUM_CHOICES,
      numHeads: 2,
      eta: 2.0,
      neighborhoodRadius: 1,
      decayRate: 0.01,
      personalityLayers: CHESTER_PERSONALITY,
    },
    rng
  );

  // Bond: they can perceive each other's complement distributions
  bond(maxell, chester);

  const rounds: MetacogRoundResult[] = [];
  let settled = false;
  let convergenceRound: number | null = null;
  const matchHistory: boolean[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    // Each agent: perceive → decide (influenced by social attention to other)
    const maxellTick = tick(maxell, chester);
    const chesterTick = tick(chester, maxell);

    const maxellOffer = maxellTick.action;
    const chesterOffer = chesterTick.action;

    // Evaluate payoffs
    const [payoffMaxell, payoffChester] = chesterVMaxellPayoff(
      maxellOffer,
      chesterOffer
    );
    const dealPossible =
      offerToAmount(maxellOffer) <= offerToAmount(chesterOffer);

    // Observe outcomes
    // Maxell: rejected if payoff is negative or worse than Chester's
    const maxellRejected = payoffMaxell < 0 || payoffMaxell < payoffChester;
    const maxellMag = maxellRejected
      ? payoffMaxell < 0
        ? Math.abs(payoffMaxell)
        : payoffChester - payoffMaxell
      : 0;

    // Chester: rejected if payoff is negative or worse than Maxell's
    const chesterRejected = payoffChester < 0 || payoffChester < payoffMaxell;
    const chesterMag = chesterRejected
      ? payoffChester < 0
        ? Math.abs(payoffChester)
        : payoffMaxell - payoffChester
      : 0;

    // Complete ticks with environment feedback
    completeTick(
      maxell,
      maxellOffer,
      maxellTick.perception,
      maxellRejected,
      maxellMag,
      payoffMaxell
    );
    completeTick(
      chester,
      chesterOffer,
      chesterTick.perception,
      chesterRejected,
      chesterMag,
      payoffChester
    );

    // Cross-pollination: each learns from the other's choice
    if (maxellOffer !== chesterOffer) {
      observe(maxell, Math.min(chesterOffer, NUM_CHOICES - 1), true, 0.5);
      observe(chester, Math.min(maxellOffer, NUM_CHOICES - 1), true, 0.5);
    }

    // Record metacognitive state
    const maxellMeta = metacogState(maxell);
    const chesterMeta = metacogState(chester);

    rounds.push({
      round,
      maxellOffer,
      chesterOffer,
      payoffMaxell,
      payoffChester,
      dealPossible,
      maxellGait: maxellMeta.gait,
      chesterGait: chesterMeta.gait,
      maxellEta: maxellMeta.eta,
      chesterEta: chesterMeta.eta,
      maxellEntropy: maxellMeta.entropy,
      chesterEntropy: chesterMeta.entropy,
      maxellKurtosis: maxellMeta.kurtosis,
      chesterKurtosis: chesterMeta.kurtosis,
      socialActive: maxell.social !== null,
    });

    // Convergence check: same offer for windowSize consecutive rounds
    matchHistory.push(maxellOffer === chesterOffer && dealPossible);
    if (matchHistory.length >= windowSize) {
      const recent = matchHistory.slice(-windowSize);
      if (recent.every(Boolean)) {
        settled = true;
        convergenceRound = round;
        break;
      }
    }
  }

  // Compute settlement
  let settlementAmount: number | null = null;
  let settlementLabel: string | null = null;
  if (settled) {
    const last = rounds[rounds.length - 1];
    const midpoint =
      (offerToAmount(last.maxellOffer) + offerToAmount(last.chesterOffer)) / 2;
    settlementAmount = midpoint;
    settlementLabel = `$${(midpoint / 1000).toFixed(0)}K`;
  }

  // Gait distribution
  const maxellGaitDist: Record<Gait, number> = {
    stand: 0,
    trot: 0,
    canter: 0,
    gallop: 0,
  };
  const chesterGaitDist: Record<Gait, number> = {
    stand: 0,
    trot: 0,
    canter: 0,
    gallop: 0,
  };
  for (const r of rounds) {
    maxellGaitDist[r.maxellGait]++;
    chesterGaitDist[r.chesterGait]++;
  }

  const totalRounds = rounds.length;
  const dealRounds = rounds.filter((r) => r.dealPossible).length;

  return {
    rounds,
    settled,
    convergenceRound,
    settlementAmount,
    settlementLabel,
    maxellPersonalityVector: personalityVector(maxell),
    chesterPersonalityVector: personalityVector(chester),
    maxellPreferences: actionPreferences(maxell),
    chesterPreferences: actionPreferences(chester),
    maxellRejections: rejectionProfile(maxell),
    chesterRejections: rejectionProfile(chester),
    summary: {
      totalRounds,
      settled,
      avgMaxellPayoff:
        rounds.reduce((s, r) => s + r.payoffMaxell, 0) / totalRounds,
      avgChesterPayoff:
        rounds.reduce((s, r) => s + r.payoffChester, 0) / totalRounds,
      dealRate: dealRounds / totalRounds,
      maxellGaitHistory: rounds.map((r) => r.maxellGait),
      chesterGaitHistory: rounds.map((r) => r.chesterGait),
      maxellGaitDistribution: maxellGaitDist,
      chesterGaitDistribution: chesterGaitDist,
    },
  };
}
