# aeon-neutral

Neutral mediation engine -- bounded dispute resolution via void walking.

Two metacognitive walkers roll around on a shared void surface. A third walker -- the Skyrms walker -- plays the *convergence site itself*, void walking the joint failure surface. Failed interactions enrich all three void boundaries, driving complement distributions toward alignment at the Skyrms nadir.

The mediator doesn't persuade. It reads the tombstones and points at the convergence.

## Architecture

```
aeon-bazaar (unbounded)  → open negotiation, market dynamics, no termination guarantee
aeon-neutral (bounded)   → dispute resolution, convergence certificate, guaranteed termination
```

### Two Modes

**Passive Mediator** -- reads both walkers' void boundaries, computes the joint complement surface, proposes the nadir point. The walkers remain self-interested. The mediator is the void itself, made legible.

**Three-Walker** -- the mediator IS a third metacognitive walker. Its choice space is all possible proposals `[offerA, offerB]`. Its payoff matrix is the inter-walker distance surface: it gets paid when the walkers converge, penalized when they diverge. It runs its own c0-c3 loop over the proposal space.

```
Walker A ──── game choices ────┐
                               ├── joint void surface ──→ Skyrms Walker (site)
Walker B ──── game choices ────┘
```

### Components

| Module | Purpose |
|--------|---------|
| `JointVoidSurface` | Outer product of two complement distributions, Manhattan distance, mutual information |
| `SkyrmsNadirDetector` | Convergence certificate: distance + kurtosis stability + positive MI for WindowSize rounds |
| `NeutralMediator` | Passive mediation loop with c0-c3 adaptation on both walkers |
| `SkyrmsWalker` | Third walker: void walks the joint failure surface |
| `mediateThreeWalker()` | Full three-walker loop: propose, decide, interact, update, adapt, check |

### Depends On

- **aeon-bazaar** -- void walker engine (`VoidBoundary`, `complementDistribution`, `c0Choose`, `c1Measure`, `c3Adapt`)

## Benchmark Results

31 tests, 290 assertions, 180ms. Five classic games, five seeds each, 500 max rounds:

| Game | Settled | Avg Rounds | Final Distance | Acceptance Rate |
|------|---------|-----------|----------------|-----------------|
| Prisoner's Dilemma | 5/5 | 22 | 0.0000 | 64% |
| Stag Hunt | 5/5 | 22 | 0.0000 | 64% |
| Hawk-Dove | 1/5 | 401 | 0.7394 | 50% |
| Battle of Sexes | 0/5 | 500 | 0.9242 | 52% |
| Coordination (3x3) | 0/5 | 500 | 0.5579 | 76% |

**Pattern:** symmetric games (PD, Stag Hunt) converge fast -- both walkers' voids grow in the same shape. Asymmetric games (Battle of Sexes, Hawk-Dove) are harder -- the walkers' complement distributions want to go to different places. That's where the Skyrms walker earns its keep.

## The Skyrms Nadir

Named for Brian Skyrms (*Evolution of the Social Contract*, 1996). The nadir is the basin of attraction where accumulated failure information makes settlement the gradient descent direction for all walkers.

**Success using failure:** the map of what did not work IS the territory of what will.

Three invariants certify convergence:
1. Inter-walker distance below threshold for WindowSize consecutive rounds
2. Joint kurtosis has stabilized (variance < epsilon)
3. Mutual information is positive (walkers are correlated, not independent)

## Formal Verification

TLA+ specifications in [aeon/companion-tests/formal/](https://github.com/affectively-ai/aeon):

- **SkyrmsNadir.tla** -- two walkers, 10 invariants, settlement/exhaustion liveness
- **SkyrmsThreeWalker.tla** -- three walkers, 7 invariants, three-way convergence liveness

## Usage

```ts
import { mediateThreeWalker } from '@affectively/aeon-neutral';

const result = mediateThreeWalker({
  numChoicesA: 2,
  numChoicesB: 2,
  maxRounds: 200,
  nadirThreshold: 0.15,
  payoff: (a, b) => {
    // Hawk-Dove: V=4, C=6
    if (a === 0 && b === 0) return [-1, -1];
    if (a === 0 && b === 1) return [4, 0];
    if (a === 1 && b === 0) return [0, 4];
    return [2, 2];
  },
});

if (result.settled) {
  console.log(`Converged in ${result.convergenceRound} rounds`);
  console.log(`Nadir:`, result.finalPayoffMatrix);
}
```

## Run Tests

```bash
bun test
```

## License

MIT
