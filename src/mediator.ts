/**
 * Neutral Mediator -- the engine that runs two walkers toward the Skyrms nadir.
 *
 * The mediator is not a participant. It is the void surface itself, made legible.
 * It reads both walkers' void boundaries, computes the joint complement surface,
 * and proposes the nadir point -- the offer pair where both walkers' accumulated
 * failures point in the same direction.
 *
 * The walkers remain self-interested. They accept or reject the proposal based
 * on their own complement distributions. If they reject, the failure enriches
 * both void boundaries, making the next proposal more informed.
 *
 * This is Skyrms' "success using failure": the mediator doesn't persuade.
 * It just reads the tombstones and points at the convergence.
 */

import {
  type VoidBoundary,
  type MetaCogState,
  createMetaCogState,
  complementDistribution,
  c0Choose,
  c0Update,
  c1Measure,
  c3Adapt,
  updateVoidBoundary,
} from '../../gnosis/src/runtime/void-walker.js';

import { JointVoidSurface, type JointState } from './joint-surface';
import { SkyrmsNadirDetector, type NadirCertificate } from './nadir-detector';

export interface MediationConfig {
  /** Number of choices for walker A */
  numChoicesA: number;
  /** Number of choices for walker B */
  numChoicesB: number;
  /** Maximum mediation rounds */
  maxRounds: number;
  /** Distance threshold for nadir detection */
  nadirThreshold?: number;
  /** Window size for nadir stability check */
  windowSize?: number;
  /** Payoff function: (offerA, offerB) => [payoffA, payoffB] */
  payoff: (offerA: number, offerB: number) => [number, number];
  /** RNG for walker choices (default: Math.random) */
  rng?: () => number;
}

export interface RoundResult {
  round: number;
  offerA: number;
  offerB: number;
  proposalA: number;
  proposalB: number;
  payoffA: number;
  payoffB: number;
  accepted: boolean;
  distance: number;
  jointKurtosis: number;
  mutualInformation: number;
}

export interface MediationResult {
  /** All round results */
  rounds: RoundResult[];
  /** Nadir certificate if convergence was achieved, null if exhausted */
  certificate: NadirCertificate | null;
  /** Final state of walker A */
  walkerA: MetaCogState;
  /** Final state of walker B */
  walkerB: MetaCogState;
  /** Final joint state */
  jointState: JointState;
  /** Whether mediation succeeded */
  settled: boolean;
}

export class NeutralMediator {
  private config: MediationConfig;
  private surface: JointVoidSurface;
  private detector: SkyrmsNadirDetector;
  private walkerA: MetaCogState;
  private walkerB: MetaCogState;
  private rng: () => number;

  constructor(config: MediationConfig) {
    this.config = config;
    this.surface = new JointVoidSurface(config.numChoicesA, config.numChoicesB);
    this.detector = new SkyrmsNadirDetector(
      config.nadirThreshold ?? 0.1,
      config.windowSize ?? 5,
    );
    this.walkerA = createMetaCogState(config.numChoicesA);
    this.walkerB = createMetaCogState(config.numChoicesB);
    this.rng = config.rng ?? Math.random;
  }

  /**
   * Run the full mediation loop.
   *
   * Each round:
   * 1. Compute joint void surface
   * 2. Mediator proposes the nadir point
   * 3. Each walker independently decides: accept proposal or play own choice
   * 4. Interact (evaluate payoffs)
   * 5. Update void boundaries from failures
   * 6. c1 monitor, c3 adapt
   * 7. Check nadir convergence
   */
  mediate(): MediationResult {
    const rounds: RoundResult[] = [];
    let certificate: NadirCertificate | null = null;
    let jointState: JointState = this.surface.compute(
      this.walkerA.boundary,
      this.walkerB.boundary,
      this.walkerA.eta,
      this.walkerB.eta,
    );

    for (let round = 1; round <= this.config.maxRounds; round++) {
      // 1. Compute joint surface
      jointState = this.surface.compute(
        this.walkerA.boundary,
        this.walkerB.boundary,
        this.walkerA.eta,
        this.walkerB.eta,
      );

      // 2. Mediator proposes nadir point
      const [proposalA, proposalB] = jointState.nadirPoint;

      // 3. Each walker decides: accept proposal or play own complement
      // Accept if proposal's complement weight >= own choice's weight
      const distA = complementDistribution(this.walkerA.boundary, this.walkerA.eta);
      const distB = complementDistribution(this.walkerB.boundary, this.walkerB.eta);
      const ownChoiceA = c0Choose(this.walkerA, this.rng);
      const ownChoiceB = c0Choose(this.walkerB, this.rng);

      // Walker accepts proposal if mediator's suggestion has higher complement weight
      const offerA = distA[proposalA] >= distA[ownChoiceA] ? proposalA : ownChoiceA;
      const offerB = distB[proposalB] >= distB[ownChoiceB] ? proposalB : ownChoiceB;
      const accepted = offerA === proposalA && offerB === proposalB;

      // 4. Evaluate payoffs
      const [payoffA, payoffB] = this.config.payoff(offerA, offerB);

      // 5. Update void boundaries
      c0Update(this.walkerA, offerA, payoffA, payoffB);
      c0Update(this.walkerB, offerB, payoffB, payoffA);

      // If offers didn't match, both walkers learn from the other's choice
      const wasFailure = offerA !== offerB;
      if (wasFailure) {
        // A learns that B's choice exists in the landscape
        updateVoidBoundary(this.walkerA.boundary, Math.min(offerB, this.config.numChoicesA - 1));
        // B learns that A's choice exists in the landscape
        updateVoidBoundary(this.walkerB.boundary, Math.min(offerA, this.config.numChoicesB - 1));
      }

      // 6. c1 monitor, c3 adapt
      const measA = c1Measure(this.walkerA);
      const measB = c1Measure(this.walkerB);
      c3Adapt(this.walkerA, measA.kurtosis);
      c3Adapt(this.walkerB, measB.kurtosis);

      // Recompute joint state after updates
      jointState = this.surface.compute(
        this.walkerA.boundary,
        this.walkerB.boundary,
        this.walkerA.eta,
        this.walkerB.eta,
      );

      // Record round
      rounds.push({
        round,
        offerA,
        offerB,
        proposalA,
        proposalB,
        payoffA,
        payoffB,
        accepted,
        distance: jointState.distance,
        jointKurtosis: jointState.jointKurtosis,
        mutualInformation: jointState.mutualInformation,
      });

      // 7. Check nadir convergence
      certificate = this.detector.observe(jointState, wasFailure);
      if (certificate) break;
    }

    return {
      rounds,
      certificate,
      walkerA: this.walkerA,
      walkerB: this.walkerB,
      jointState,
      settled: certificate !== null,
    };
  }
}
