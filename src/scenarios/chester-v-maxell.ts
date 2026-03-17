/**
 * Chester v Maxell -- Bounded Dispute Resolution (Neutral Mediation)
 *
 * Same facts as the bazaar version, but with a neutral mediator:
 * three walkers converging at the Skyrms nadir.
 *
 * Walker A = Maxell (wants higher payment)
 * Walker B = Chester (wants lower payment, health security)
 * Walker S = Skyrms mediator (void walks the joint failure surface)
 *
 * The mediator proposes settlement amounts. Both parties self-interestedly
 * accept or reject. Rejections enrich all three void boundaries.
 * Convergence is certified when distance stabilizes.
 *
 * Key parameters from teaching notes:
 * - ZOPA: $150K-$200K (indices 5-10)
 * - BATNA Maxell: trial (~$105K net if wins, -$95K if loses)
 * - BATNA Chester: refuse to pay ($200K saved but risk countersue)
 * - Remediation: $20K-$95K depending on scope
 */

import { mediateThreeWalker, type ThreeWalkerResult } from '../skyrms-walker';

// ============================================================================
// Shared choice space (same as bazaar)
// ============================================================================

export const OFFER_LABELS = [
  '$100K', '$110K', '$120K', '$130K', '$140K',
  '$150K', '$160K', '$170K', '$180K', '$190K', '$200K',
] as const;

export const NUM_CHOICES = OFFER_LABELS.length;

export function offerToAmount(idx: number): number {
  return 100_000 + idx * 10_000;
}

// ============================================================================
// Payoff Matrix (asymmetric, richer than bazaar)
// ============================================================================

/**
 * Three-dimensional payoff for mediated negotiation.
 *
 * Maxell proposes what he'd accept (minimum). Chester proposes what he'd pay
 * (maximum). The mediator's proposal is the [maxellIdx, chesterIdx] pair.
 *
 * Payoffs model:
 * - Maxell: net gain = amount - $95K costs. Bonus if settles quickly (avoids trial).
 * - Chester: savings = $200K - amount. Health bonus if enough budget for remediation.
 *   Emotional distress penalty if dispute drags on.
 *
 * The payoff is evaluated for the actual offers played, not the mediator's proposal.
 */
export function chesterVMaxellPayoff(
  maxellOffer: number,
  chesterOffer: number,
): [number, number] {
  const maxellAmount = offerToAmount(maxellOffer);
  const chesterAmount = offerToAmount(chesterOffer);

  if (maxellAmount <= chesterAmount) {
    // Settlement at midpoint of overlap
    const settlementAmount = (maxellAmount + chesterAmount) / 2;
    const maxellNet = (settlementAmount - 95_000) / 1000;
    const chesterSavings = (200_000 - settlementAmount) / 1000;
    // Health security bonus: Chester feels safe if savings cover remediation ($20K+)
    const healthBonus = chesterSavings >= 20 ? 15 : chesterSavings >= 10 ? 5 : 0;
    // Quick settlement bonus for Maxell (avoids trial costs)
    const trialAvoidance = 5;
    return [maxellNet + trialAvoidance, chesterSavings + healthBonus];
  } else {
    // No deal: escalation costs
    const gap = (maxellAmount - chesterAmount) / 1000;
    // Maxell: legal fees risk, reputation damage
    const maxellCost = -gap * 0.4 - 2;  // base frustration
    // Chester: emotional distress, living uncertainty, mold anxiety
    const chesterCost = -gap * 0.5 - 3;  // health anxiety premium
    return [maxellCost, chesterCost];
  }
}

// ============================================================================
// Scenario Runner (Bounded Neutral Mediation)
// ============================================================================

export interface NeutralMediationResult extends ThreeWalkerResult {
  /** Human-readable settlement amount if converged */
  settlementAmount: number | null;
  /** Human-readable label */
  settlementLabel: string | null;
  /** Summary stats */
  summary: {
    totalRounds: number;
    settled: boolean;
    avgMaxellPayoff: number;
    avgChesterPayoff: number;
    avgSkyrmsPayoff: number;
    proposalAcceptanceRate: number;
    maxellFinalVoidDensity: number[];
    chesterFinalVoidDensity: number[];
  };
}

export function runChesterVMaxellNeutral(
  maxRounds: number = 500,
  nadirThreshold: number = 0.15,
  rng: () => number = Math.random,
): NeutralMediationResult {
  const result = mediateThreeWalker({
    numChoicesA: NUM_CHOICES,
    numChoicesB: NUM_CHOICES,
    maxRounds,
    nadirThreshold,
    payoff: chesterVMaxellPayoff,
    rng,
  });

  // Compute settlement amount from final nadir point
  let settlementAmount: number | null = null;
  let settlementLabel: string | null = null;

  if (result.settled && result.convergenceRound !== null) {
    const lastRound = result.rounds[result.rounds.length - 1];
    // Midpoint of the final offers
    const midpoint = (offerToAmount(lastRound.offerA) + offerToAmount(lastRound.offerB)) / 2;
    settlementAmount = midpoint;
    settlementLabel = `$${(midpoint / 1000).toFixed(0)}K`;
  }

  // Summary stats
  const totalRounds = result.rounds.length;
  const avgMaxellPayoff = result.rounds.reduce((s, r) => s + r.payoffA, 0) / totalRounds;
  const avgChesterPayoff = result.rounds.reduce((s, r) => s + r.payoffB, 0) / totalRounds;
  const avgSkyrmsPayoff = result.rounds.reduce((s, r) => s + r.skyrmsPayoff, 0) / totalRounds;
  const accepted = result.rounds.filter((r) => r.proposalAccepted).length;

  return {
    ...result,
    settlementAmount,
    settlementLabel,
    summary: {
      totalRounds,
      settled: result.settled,
      avgMaxellPayoff,
      avgChesterPayoff,
      avgSkyrmsPayoff,
      proposalAcceptanceRate: accepted / totalRounds,
      maxellFinalVoidDensity: [...result.walkerA.boundary.counts],
      chesterFinalVoidDensity: [...result.walkerB.boundary.counts],
    },
  };
}
