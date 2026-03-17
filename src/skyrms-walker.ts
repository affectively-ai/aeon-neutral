/**
 * Skyrms Walker -- the mediator as a third metacognitive walker.
 *
 * The first two walkers play the game. The third walker plays the *site*.
 * Its choice space is the set of possible proposals (pairs [offerA, offerB]).
 * Its payoff matrix is the Skyrms convergence surface:
 *
 *   payoff(proposal) = -distance(complementA, complementB) after proposal
 *
 * When the walkers converge, the Skyrms walker gets maximum payoff.
 * When they diverge, it gets penalized. Its void boundary accumulates
 * rejected proposals -- proposals that failed to move the walkers closer.
 *
 * This makes the mediator self-interested in alignment. It runs its own
 * c0-c3 loop: choosing proposals, observing whether they reduced distance,
 * updating its void boundary when they didn't, adapting its eta and
 * exploration to get better at proposing.
 *
 * Three walkers rolling around. Two on the game. One on the site.
 * The site walker's nadir IS the other two walkers' nadir.
 * When all three converge, that's the Skyrms fixed point.
 */

import {
  type VoidBoundary,
  type MetaCogState,
  type Gait,
  createVoidBoundary,
  createMetaCogState,
  complementDistribution,
  updateVoidBoundary,
  shannonEntropy,
  excessKurtosis,
  inverseBule,
  c1Measure,
  c2SelectGait,
  c3Adapt,
  GAIT_DEPTH,
} from '../../gnosis/src/runtime/void-walker.js';

import { JointVoidSurface, type JointState } from './joint-surface';

// ============================================================================
// Skyrms Payoff Matrix
// ============================================================================

/**
 * The Skyrms site: a payoff matrix where each cell is the negative distance
 * that would result from proposing that [offerA, offerB] pair.
 *
 * Higher values = proposals that bring walkers closer.
 * The argmax is the optimal proposal -- the Skyrms nadir.
 */
export interface SkyrmsPayoffMatrix {
  /** Flattened matrix: payoff[i * numB + j] = expected alignment gain */
  values: number[];
  numChoicesA: number;
  numChoicesB: number;
}

export function computeSkyrmsPayoff(
  boundaryA: VoidBoundary,
  boundaryB: VoidBoundary,
  etaA: number,
  etaB: number,
  numChoicesA: number,
  numChoicesB: number,
): SkyrmsPayoffMatrix {
  const distA = complementDistribution(boundaryA, etaA);
  const distB = complementDistribution(boundaryB, etaB);

  // For each possible proposal [i, j], compute how much it aligns with
  // both walkers' complement distributions. Payoff = distA[i] * distB[j]
  // (probability that both walkers would independently choose this pair)
  const values: number[] = new Array(numChoicesA * numChoicesB);
  for (let i = 0; i < numChoicesA; i++) {
    for (let j = 0; j < numChoicesB; j++) {
      values[i * numChoicesB + j] = distA[i] * distB[j];
    }
  }

  return { values, numChoicesA, numChoicesB };
}

// ============================================================================
// Skyrms Walker State
// ============================================================================

export interface SkyrmsWalkerState {
  /** Metacognitive state over the proposal space */
  meta: MetaCogState;
  /** Proposal space size (numChoicesA * numChoicesB) */
  proposalSpaceSize: number;
  /** Mapping from flat index to [offerA, offerB] */
  numChoicesA: number;
  numChoicesB: number;
  /** History of distances after each proposal */
  distanceHistory: number[];
  /** Previous distance (for computing payoff delta) */
  prevDistance: number;
  /** Total proposals accepted by both walkers */
  acceptedCount: number;
  /** Total proposals rejected */
  rejectedCount: number;
  /** Current gait -- controls proposal neighborhood radius */
  gait: Gait;
  /** Consecutive distance reductions (momentum tracker) */
  momentum: number;
}

export function createSkyrmsWalkerState(
  numChoicesA: number,
  numChoicesB: number,
): SkyrmsWalkerState {
  return {
    meta: createMetaCogState(numChoicesA * numChoicesB),
    proposalSpaceSize: numChoicesA * numChoicesB,
    numChoicesA,
    numChoicesB,
    distanceHistory: [],
    prevDistance: Infinity,
    acceptedCount: 0,
    rejectedCount: 0,
    gait: 'stand',
    momentum: 0,
  };
}

/**
 * Decode a flat proposal index into [offerA, offerB].
 */
export function decodeProposal(
  state: SkyrmsWalkerState,
  flatIdx: number,
): [number, number] {
  const i = Math.floor(flatIdx / state.numChoicesB);
  const j = flatIdx % state.numChoicesB;
  return [i, j];
}

// ============================================================================
// Skyrms Walker c0-c3 Loop
// ============================================================================

/**
 * c0: Choose a proposal from the Skyrms walker's complement distribution.
 *
 * The complement distribution over proposals is shaped by which proposals
 * have failed (been rejected or increased distance). High-complement proposals
 * are those that haven't been tried or that previously succeeded.
 */
export function skyrmsC0Choose(
  state: SkyrmsWalkerState,
  rng: () => number,
): [number, number] {
  const N = state.proposalSpaceSize;
  const dist = complementDistribution(state.meta.boundary, state.meta.eta);

  // Epsilon-greedy exploration
  if (rng() < state.meta.exploration) {
    const flatIdx = Math.floor(rng() * N);
    return decodeProposal(state, flatIdx);
  }

  // Sample from complement distribution
  const r = rng();
  let cum = 0;
  for (let idx = 0; idx < N; idx++) {
    cum += dist[idx];
    if (r < cum) return decodeProposal(state, idx);
  }
  return decodeProposal(state, N - 1);
}

/**
 * c0: Update void boundary after observing whether the proposal worked.
 *
 * The Skyrms walker's payoff is: did this proposal reduce inter-walker distance?
 * If distance increased or stayed the same, the proposal failed -- add to void.
 * If distance decreased, the proposal succeeded -- no void update.
 */
export function skyrmsC0Update(
  state: SkyrmsWalkerState,
  proposalFlat: number,
  newDistance: number,
  wasAccepted: boolean,
): void {
  const distanceDelta = newDistance - state.prevDistance;

  // Proposal failed if: rejected, or distance didn't decrease
  if (!wasAccepted || distanceDelta >= 0) {
    // Magnitude proportional to how bad it was
    const magnitude = wasAccepted ? 1 : 2;  // Rejection is worse than no improvement
    updateVoidBoundary(state.meta.boundary, proposalFlat, magnitude);

    // Neighborhood poisoning: adjacent proposals get lighter void update.
    // Radius scales with gait -- stand=0 (no spread), trot=1, canter=2, gallop=3.
    const radius = state.gait === 'stand' ? 0
      : state.gait === 'trot' ? 1
      : state.gait === 'canter' ? 2 : 3;

    if (radius > 0) {
      const [pA, pB] = decodeProposal(state, proposalFlat);
      for (let da = -radius; da <= radius; da++) {
        for (let db = -radius; db <= radius; db++) {
          if (da === 0 && db === 0) continue; // already updated center
          const nA = pA + da;
          const nB = pB + db;
          if (nA >= 0 && nA < state.numChoicesA && nB >= 0 && nB < state.numChoicesB) {
            const neighborFlat = nA * state.numChoicesB + nB;
            // Lighter poison: 1 unit regardless of magnitude, decays with distance
            const dist = Math.abs(da) + Math.abs(db);
            const neighborMag = Math.max(1, Math.round(magnitude / dist));
            updateVoidBoundary(state.meta.boundary, neighborFlat, neighborMag);
          }
        }
      }
    }

    state.rejectedCount++;
    state.momentum = 0;
  } else {
    state.acceptedCount++;
    state.momentum++;
  }

  // Update payoff tracking
  state.meta.totalPayoff += wasAccepted ? -distanceDelta : -1;
  state.meta.totalRounds++;
  state.prevDistance = newDistance;
  state.distanceHistory.push(newDistance);
}

/**
 * c1: Measure the Skyrms walker's complement distribution shape.
 */
export function skyrmsC1Measure(state: SkyrmsWalkerState): {
  kurtosis: number;
  entropy: number;
  inverseBule: number;
  acceptanceRate: number;
} {
  const meas = c1Measure(state.meta);
  const total = state.acceptedCount + state.rejectedCount;
  return {
    ...meas,
    acceptanceRate: total > 0 ? state.acceptedCount / total : 0,
  };
}

/**
 * c3: Adapt the Skyrms walker based on its own performance.
 *
 * Clip-clop: the Skyrms walker has its own gait cycle tuned for
 * high-dimensional proposal spaces. More aggressive than the game walkers:
 * - stand (round 0): explore uniformly
 * - trot (round 5+): start narrowing, neighborhood radius = 1
 * - canter (round 20+ or kurtosis > 0.3): sharpen eta, radius = 2
 * - gallop (round 50+ or momentum > 5): maximum exploitation, radius = 3
 *
 * Adaptation fires every 5 rounds (not 10 like game walkers) because the
 * Skyrms walker needs faster feedback in the larger space.
 */
export function skyrmsC3Adapt(state: SkyrmsWalkerState, kurtosis: number): void {
  const rounds = state.meta.totalRounds;

  // Faster adaptation cadence for the site walker
  if (rounds - state.meta.lastAdaptationRound < 5) return;

  // Gait transitions -- more aggressive thresholds than game walkers
  const prevGait = state.gait;
  if (rounds < 5) {
    state.gait = 'stand';
  } else if (rounds < 20 && kurtosis < 0.3) {
    state.gait = 'trot';
  } else if (rounds < 50 || kurtosis < 0.8) {
    state.gait = 'canter';
  } else {
    state.gait = 'gallop';
  }

  // Momentum can accelerate gait
  if (state.momentum >= 5 && state.gait !== 'gallop') {
    state.gait = state.gait === 'stand' ? 'trot'
      : state.gait === 'trot' ? 'canter' : 'gallop';
  }

  // Downshift if distance is increasing (regime change)
  if (state.distanceHistory.length >= 3) {
    const recent = state.distanceHistory.slice(-3);
    const increasing = recent[2] > recent[1] && recent[1] > recent[0];
    if (increasing && state.gait !== 'stand') {
      state.gait = state.gait === 'gallop' ? 'canter'
        : state.gait === 'canter' ? 'trot' : 'stand';
    }
  }

  // Adapt eta and exploration based on gait
  switch (state.gait) {
    case 'stand':
      state.meta.exploration = Math.min(0.5, state.meta.exploration + 0.02);
      state.meta.eta = Math.max(1.0, state.meta.eta - 0.1);
      break;
    case 'trot':
      state.meta.exploration = Math.min(0.35, state.meta.exploration + 0.01);
      state.meta.eta = Math.max(1.5, state.meta.eta - 0.05);
      break;
    case 'canter':
      state.meta.exploration = Math.max(0.05, state.meta.exploration - 0.02);
      state.meta.eta = Math.min(5.0, state.meta.eta + 0.1);
      break;
    case 'gallop':
      state.meta.exploration = Math.max(0.01, state.meta.exploration - 0.03);
      state.meta.eta = Math.min(8.0, state.meta.eta + 0.2);
      break;
  }

  // Also adapt the game walkers' gaits via the standard c3
  state.meta.gait = state.gait;
  state.meta.adaptationCount++;
  state.meta.lastAdaptationRound = rounds;
}

// ============================================================================
// Three-Walker Mediator
// ============================================================================

export interface ThreeWalkerConfig {
  numChoicesA: number;
  numChoicesB: number;
  maxRounds: number;
  nadirThreshold?: number;
  payoff: (offerA: number, offerB: number) => [number, number];
  rng?: () => number;
}

export interface ThreeWalkerRoundResult {
  round: number;
  /** What the Skyrms walker proposed */
  proposalA: number;
  proposalB: number;
  /** What the walkers actually played */
  offerA: number;
  offerB: number;
  /** Game payoffs for the two walkers */
  payoffA: number;
  payoffB: number;
  /** Skyrms walker's payoff (negative distance delta) */
  skyrmsPayoff: number;
  /** Whether both walkers accepted the Skyrms proposal */
  proposalAccepted: boolean;
  /** Inter-walker distance */
  distance: number;
  /** Skyrms walker's complement entropy (how uncertain it is) */
  skyrmsEntropy: number;
  /** All three walkers' kurtosis */
  kurtosisA: number;
  kurtosisB: number;
  kurtosisSite: number;
  /** Skyrms walker's current gait */
  skyrmsGait: Gait;
}

export interface ThreeWalkerResult {
  rounds: ThreeWalkerRoundResult[];
  settled: boolean;
  /** Round at which all three walkers converged */
  convergenceRound: number | null;
  /** Final Skyrms payoff matrix */
  finalPayoffMatrix: SkyrmsPayoffMatrix;
  walkerA: MetaCogState;
  walkerB: MetaCogState;
  skyrmsWalker: SkyrmsWalkerState;
}

/**
 * Run three-walker mediation.
 *
 * Walker A and Walker B play the game.
 * The Skyrms walker plays the site -- its payoff is convergence itself.
 * All three run c0-c3 metacognitive loops.
 * Settlement occurs when the Skyrms walker's distance history stabilizes
 * below threshold -- meaning its proposals are consistently accepted and
 * the game walkers are aligned.
 */
export function mediateThreeWalker(config: ThreeWalkerConfig): ThreeWalkerResult {
  const rng = config.rng ?? Math.random;
  const threshold = config.nadirThreshold ?? 0.1;
  const windowSize = 5;

  const walkerA = createMetaCogState(config.numChoicesA);
  const walkerB = createMetaCogState(config.numChoicesB);
  const skyrms = createSkyrmsWalkerState(config.numChoicesA, config.numChoicesB);
  const surface = new JointVoidSurface(config.numChoicesA, config.numChoicesB);

  const rounds: ThreeWalkerRoundResult[] = [];
  let settled = false;
  let convergenceRound: number | null = null;

  for (let round = 1; round <= config.maxRounds; round++) {
    // 1. Skyrms walker proposes (c0 choose over proposal space)
    const [proposalA, proposalB] = skyrmsC0Choose(skyrms, rng);
    const proposalFlat = proposalA * config.numChoicesB + proposalB;

    // 2. Game walkers decide: accept or play own choice
    const distA = complementDistribution(walkerA.boundary, walkerA.eta);
    const distB = complementDistribution(walkerB.boundary, walkerB.eta);

    // Own choices via exploration/exploitation
    const ownA = sampleFromDist(distA, walkerA.exploration, rng);
    const ownB = sampleFromDist(distB, walkerB.exploration, rng);

    // Accept proposal if its complement weight is higher
    const offerA = distA[proposalA] >= distA[ownA] ? proposalA : ownA;
    const offerB = distB[proposalB] >= distB[ownB] ? proposalB : ownB;
    const proposalAccepted = offerA === proposalA && offerB === proposalB;

    // 3. Evaluate game payoffs
    const [payoffA, payoffB] = config.payoff(offerA, offerB);

    // 4. Update game walkers' void boundaries
    if (payoffA < payoffB) updateVoidBoundary(walkerA.boundary, offerA);
    if (payoffA < 0) updateVoidBoundary(walkerA.boundary, offerA, Math.abs(payoffA));
    walkerA.totalPayoff += payoffA;
    walkerA.totalRounds++;

    if (payoffB < payoffA) updateVoidBoundary(walkerB.boundary, offerB);
    if (payoffB < 0) updateVoidBoundary(walkerB.boundary, offerB, Math.abs(payoffB));
    walkerB.totalPayoff += payoffB;
    walkerB.totalRounds++;

    // Cross-pollinate: each walker learns from the other's rejected choice
    if (offerA !== offerB) {
      updateVoidBoundary(walkerA.boundary, Math.min(offerB, config.numChoicesA - 1));
      updateVoidBoundary(walkerB.boundary, Math.min(offerA, config.numChoicesB - 1));
    }

    // 5. Recompute joint surface, get new distance
    const jointState = surface.compute(walkerA.boundary, walkerB.boundary, walkerA.eta, walkerB.eta);
    const newDistance = jointState.distance;

    // 6. Update Skyrms walker (c0 update)
    const skyrmsPayoffValue = skyrms.prevDistance === Infinity ? 0 : skyrms.prevDistance - newDistance;
    skyrmsC0Update(skyrms, proposalFlat, newDistance, proposalAccepted);

    // 7. All three walkers: c1 measure, c3 adapt
    const measA = c1Measure(walkerA);
    const measB = c1Measure(walkerB);
    const measS = skyrmsC1Measure(skyrms);
    c3Adapt(walkerA, measA.kurtosis);
    c3Adapt(walkerB, measB.kurtosis);
    skyrmsC3Adapt(skyrms, measS.kurtosis);

    // Record round
    rounds.push({
      round,
      proposalA,
      proposalB,
      offerA,
      offerB,
      payoffA,
      payoffB,
      skyrmsPayoff: skyrmsPayoffValue,
      proposalAccepted,
      distance: newDistance,
      skyrmsEntropy: measS.entropy,
      kurtosisA: measA.kurtosis,
      kurtosisB: measB.kurtosis,
      kurtosisSite: measS.kurtosis,
      skyrmsGait: skyrms.gait,
    });

    // 8. Check three-way convergence
    // All three walkers must be stable: distance below threshold for windowSize rounds
    if (skyrms.distanceHistory.length >= windowSize) {
      const recentDist = skyrms.distanceHistory.slice(-windowSize);
      const allBelow = recentDist.every((d) => d <= threshold);
      if (allBelow) {
        settled = true;
        convergenceRound = round;
        break;
      }
    }
  }

  const finalPayoffMatrix = computeSkyrmsPayoff(
    walkerA.boundary,
    walkerB.boundary,
    walkerA.eta,
    walkerB.eta,
    config.numChoicesA,
    config.numChoicesB,
  );

  return {
    rounds,
    settled,
    convergenceRound,
    finalPayoffMatrix,
    walkerA,
    walkerB,
    skyrmsWalker: skyrms,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function sampleFromDist(dist: number[], exploration: number, rng: () => number): number {
  if (rng() < exploration) return Math.floor(rng() * dist.length);
  const r = rng();
  let cum = 0;
  for (let i = 0; i < dist.length; i++) {
    cum += dist[i];
    if (r < cum) return i;
  }
  return dist.length - 1;
}
