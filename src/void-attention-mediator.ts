/**
 * Void Attention Mediator -- gnosis core void-attention as mediation engine.
 *
 * Uses the handler-based forward pass from gnosis instead of the ad-hoc
 * three-walker loop. The structural identification:
 *   - Self-attention heads = game walkers
 *   - Cross-attention head = Skyrms mediator (gated by proposal void)
 *   - Residual = void boundaries persist across rounds
 *   - Layer norm = void decay
 *   - Feed-forward = c3 gait adaptation
 *
 * This should perform better than the raw three-walker because:
 *   1. Sampling with exploration (not argmax) gives more tombstones
 *   2. Neighborhood poisoning spreads signal through proposal space
 *   3. Gated cross-attention multiplicatively combines all three voids
 */

import {
  createVoidAttentionPayload,
  voidAttentionForward,
  type VoidAttentionPayload,
} from '../../gnosis/src/void-attention-handlers';

export interface AttentionMediatorConfig {
  numChoicesA: number;
  numChoicesB: number;
  maxRounds: number;
  nadirThreshold?: number;
  windowSize?: number;
  neighborhoodRadius?: number;
  decayRate?: number;
  payoff: (offerA: number, offerB: number) => [number, number];
  rng?: () => number;
}

export interface AttentionMediatorRound {
  round: number;
  offerA: number;
  offerB: number;
  payoffA: number;
  payoffB: number;
  proposalAccepted: boolean;
  distance: number;
  gaitA: string;
  gaitB: string;
  gaitS: string;
}

export interface AttentionMediatorResult {
  rounds: AttentionMediatorRound[];
  settled: boolean;
  convergenceRound: number | null;
  payload: VoidAttentionPayload;
}

/**
 * Run mediation using the gnosis void-attention transformer.
 *
 * Each round is one forward pass through the void transformer block:
 *   self-attend → cross-attend → decide → interact → residual → norm → adapt
 */
export async function mediateWithVoidAttention(
  config: AttentionMediatorConfig
): Promise<AttentionMediatorResult> {
  const rng = config.rng ?? Math.random;
  const threshold = config.nadirThreshold ?? 0.15;
  const windowSize = config.windowSize ?? 5;

  let payload = createVoidAttentionPayload(
    config.numChoicesA,
    config.numChoicesB,
    config.payoff,
    rng,
    config.neighborhoodRadius ?? 1,
    config.decayRate ?? 0
  );

  const rounds: AttentionMediatorRound[] = [];
  const distanceHistory: number[] = [];
  let settled = false;
  let convergenceRound: number | null = null;

  for (let round = 1; round <= config.maxRounds; round++) {
    payload = await voidAttentionForward(payload);

    // Compute distance between complement distributions
    const distA = payload.complementA ?? [];
    const distB = payload.complementB ?? [];
    const minLen = Math.min(distA.length, distB.length);
    let distance = 0;
    for (let i = 0; i < minLen; i++) distance += Math.abs(distA[i] - distB[i]);

    distanceHistory.push(distance);

    rounds.push({
      round,
      offerA: payload.offerA ?? 0,
      offerB: payload.offerB ?? 0,
      payoffA: payload.payoffA ?? 0,
      payoffB: payload.payoffB ?? 0,
      proposalAccepted: payload.proposalAccepted ?? false,
      distance,
      gaitA: payload.walkerA.gait,
      gaitB: payload.walkerB.gait,
      gaitS: payload.walkerCross.gait,
    });

    // Check convergence
    if (distanceHistory.length >= windowSize) {
      const recent = distanceHistory.slice(-windowSize);
      if (recent.every((d) => d <= threshold)) {
        settled = true;
        convergenceRound = round;
        break;
      }
    }
  }

  return { rounds, settled, convergenceRound, payload };
}
