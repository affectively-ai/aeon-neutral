/**
 * aeon-neutral -- Neutral Mediation Engine
 *
 * Takes two negotiation topologies (two metacognitive walkers' void boundaries)
 * and mediates them toward the Skyrms nadir -- the basin of attraction where
 * accumulated failure information makes settlement the gradient descent direction.
 *
 * This is not the c0-c3 metacognitive approach (that's the walker itself).
 * This is the neutral third party: it reads both void boundaries, computes the
 * joint complement surface, and proposes offers that minimize inter-walker
 * distance. The walkers remain self-interested. The mediator is the void itself.
 *
 * Uses aeon-bazaar's void walker engine for complement distribution, kurtosis,
 * inverse Bule, and void boundary primitives.
 */

export { NeutralMediator, type MediationConfig, type MediationResult } from './mediator';
export { JointVoidSurface, type JointState } from './joint-surface';
export { SkyrmsNadirDetector, type NadirCertificate } from './nadir-detector';
