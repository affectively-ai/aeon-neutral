/**
 * Joint Void Surface -- the shared failure landscape of two walkers.
 *
 * Given walker A's void boundary and walker B's void boundary,
 * computes the joint complement surface: the product distribution
 * over both walkers' complement distributions. The nadir is the
 * mode of this joint surface -- the offer pair where both walkers'
 * complement weights are maximally aligned.
 */

import {
  type VoidBoundary,
  complementDistribution,
  shannonEntropy,
  excessKurtosis,
  giniCoefficient,
} from '../../gnosis/src/runtime/void-walker.js';

export interface JointState {
  /** Joint complement surface (A.length x B.length flattened) */
  surface: number[];
  /** Manhattan distance between marginal complement distributions */
  distance: number;
  /** Joint entropy H(A,B) */
  jointEntropy: number;
  /** Mutual information I(A;B) = H(A) + H(B) - H(A,B) */
  mutualInformation: number;
  /** Joint kurtosis (excess kurtosis of the joint surface) */
  jointKurtosis: number;
  /** Gini coefficient of joint surface (inequality of alignment) */
  gini: number;
  /** Argmax of joint surface: [offerA, offerB] */
  nadirPoint: [number, number];
}

export class JointVoidSurface {
  private numChoicesA: number;
  private numChoicesB: number;

  constructor(numChoicesA: number, numChoicesB: number) {
    this.numChoicesA = numChoicesA;
    this.numChoicesB = numChoicesB;
  }

  /**
   * Compute the joint state from two void boundaries.
   *
   * The joint complement surface is the outer product of the two
   * marginal complement distributions. The nadir is its argmax.
   */
  compute(
    boundaryA: VoidBoundary,
    boundaryB: VoidBoundary,
    etaA: number,
    etaB: number
  ): JointState {
    const distA = complementDistribution(boundaryA, etaA);
    const distB = complementDistribution(boundaryB, etaB);

    // Cannon rotation: outer product -- each cell (i,j) is independent.
    // Under gnode --strategy cannon, rows distribute across lanes.
    // For 11x11 choice space: 121 independent multiplications.
    const nB = this.numChoicesB;
    const surface: number[] = new Array(this.numChoicesA * nB);
    for (let i = 0; i < this.numChoicesA; i++) {
      const dA = distA[i];
      const rowBase = i * nB;
      for (let j = 0; j < nB; j++) {
        surface[rowBase + j] = dA * distB[j];
      }
    }

    // Manhattan distance between marginal distributions
    const minLen = Math.min(distA.length, distB.length);
    let distance = 0;
    for (let i = 0; i < minLen; i++) {
      distance += Math.abs(distA[i] - distB[i]);
    }
    // If different sizes, remaining mass adds to distance
    for (let i = minLen; i < distA.length; i++) distance += distA[i];
    for (let i = minLen; i < distB.length; i++) distance += distB[i];

    // Entropies
    const hA = shannonEntropy(distA);
    const hB = shannonEntropy(distB);
    const jointEntropy = shannonEntropy(surface);
    const mutualInformation = hA + hB - jointEntropy;

    // Joint kurtosis and Gini
    const jointKurtosis = excessKurtosis(surface);
    const gini = giniCoefficient(surface);

    // Nadir point: argmax of joint surface
    let maxVal = -1;
    let maxI = 0;
    let maxJ = 0;
    for (let i = 0; i < this.numChoicesA; i++) {
      for (let j = 0; j < this.numChoicesB; j++) {
        const val = surface[i * this.numChoicesB + j];
        if (val > maxVal) {
          maxVal = val;
          maxI = i;
          maxJ = j;
        }
      }
    }

    return {
      surface,
      distance,
      jointEntropy,
      mutualInformation,
      jointKurtosis,
      gini,
      nadirPoint: [maxI, maxJ],
    };
  }
}
