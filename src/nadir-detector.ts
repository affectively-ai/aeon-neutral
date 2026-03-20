/**
 * Skyrms Nadir Detector
 *
 * Monitors the joint void surface over time and detects when both walkers
 * have converged to the nadir -- the fixed point where no unilateral
 * deviation improves either walker's complement distribution.
 *
 * Convergence is certified when:
 * 1. Inter-walker distance is below threshold for WindowSize consecutive rounds
 * 2. Joint kurtosis has stabilized (variance of recent values < epsilon)
 * 3. Mutual information is positive (walkers are correlated, not independent)
 */

import { type JointState } from './joint-surface';

export interface NadirCertificate {
  /** Round at which convergence was detected */
  round: number;
  /** Final inter-walker distance */
  finalDistance: number;
  /** Final joint kurtosis */
  finalKurtosis: number;
  /** Final mutual information */
  finalMutualInformation: number;
  /** Total failures that drove convergence */
  totalFailures: number;
  /** The nadir point [offerA, offerB] */
  nadirPoint: [number, number];
  /** Average inverse Bule across the convergence window */
  avgInverseBule: number;
}

export class SkyrmsNadirDetector {
  private distanceThreshold: number;
  private windowSize: number;
  private kurtosisEpsilon: number;

  private distanceHistory: number[] = [];
  private kurtosisHistory: number[] = [];
  private miHistory: number[] = [];
  private roundCount = 0;
  private failureCount = 0;

  constructor(
    distanceThreshold: number = 0.1,
    windowSize: number = 5,
    kurtosisEpsilon: number = 0.05
  ) {
    this.distanceThreshold = distanceThreshold;
    this.windowSize = windowSize;
    this.kurtosisEpsilon = kurtosisEpsilon;
  }

  /**
   * Record a round's joint state. Returns a NadirCertificate if
   * convergence is detected, null otherwise.
   */
  observe(state: JointState, wasFailure: boolean): NadirCertificate | null {
    this.roundCount++;
    if (wasFailure) this.failureCount++;

    this.distanceHistory.push(state.distance);
    this.kurtosisHistory.push(state.jointKurtosis);
    this.miHistory.push(state.mutualInformation);

    if (this.distanceHistory.length < this.windowSize) return null;

    // Check distance stability
    const recentDist = this.distanceHistory.slice(-this.windowSize);
    const allBelowThreshold = recentDist.every(
      (d) => d <= this.distanceThreshold
    );
    if (!allBelowThreshold) return null;

    // Check kurtosis stability
    const recentKurt = this.kurtosisHistory.slice(-this.windowSize);
    const kurtMean = recentKurt.reduce((a, b) => a + b, 0) / recentKurt.length;
    const kurtVar =
      recentKurt.reduce((s, k) => s + (k - kurtMean) ** 2, 0) /
      recentKurt.length;
    if (kurtVar > this.kurtosisEpsilon) return null;

    // Check mutual information is positive
    const recentMI = this.miHistory.slice(-this.windowSize);
    const allPositiveMI = recentMI.every((mi) => mi > 0);
    if (!allPositiveMI) return null;

    // Convergence certified
    const avgIB = recentDist.reduce((a, b) => a + b, 0) / recentDist.length;

    return {
      round: this.roundCount,
      finalDistance: recentDist[recentDist.length - 1],
      finalKurtosis: kurtMean,
      finalMutualInformation: recentMI[recentMI.length - 1],
      totalFailures: this.failureCount,
      nadirPoint: state.nadirPoint,
      avgInverseBule: avgIB,
    };
  }

  /** Reset detector state for a new mediation session */
  reset(): void {
    this.distanceHistory = [];
    this.kurtosisHistory = [];
    this.miHistory = [];
    this.roundCount = 0;
    this.failureCount = 0;
  }
}
