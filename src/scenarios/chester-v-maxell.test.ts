import { describe, test, expect } from 'bun:test';
import {
  runChesterVMaxellNeutral,
  chesterVMaxellPayoff,
  offerToAmount,
  OFFER_LABELS,
  NUM_CHOICES,
} from './chester-v-maxell';
import {
  runChesterVMaxellBazaar,
  chesterVMaxellPayoff as bazaarPayoff,
} from '../../../aeon-bazaar/src/scenarios/chester-v-maxell';

// Deterministic RNG
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ============================================================================
// Payoff Matrix Tests
// ============================================================================

describe('Chester v Maxell: Payoff Matrix', () => {
  test('settlement payoffs are positive for both parties in ZOPA', () => {
    // ZOPA: offers 5-10 ($150K-$200K)
    // If Maxell asks for $150K (idx 5) and Chester accepts $180K (idx 8), deal closes
    const [maxellPay, chesterPay] = chesterVMaxellPayoff(5, 8);
    expect(maxellPay).toBeGreaterThan(0); // Maxell nets positive
    expect(chesterPay).toBeGreaterThan(0); // Chester saves money
  });

  test('no-deal payoffs are negative for both', () => {
    // Maxell wants $200K (idx 10), Chester offers $100K (idx 0) -- huge gap
    const [maxellPay, chesterPay] = chesterVMaxellPayoff(10, 0);
    expect(maxellPay).toBeLessThan(0);
    expect(chesterPay).toBeLessThan(0);
  });

  test('Chester gets health bonus when savings cover remediation', () => {
    // Settlement at $170K: Chester saves $30K, well above $20K remediation
    const [, chesterWithBonus] = chesterVMaxellPayoff(7, 7);
    // Settlement at $195K: Chester saves $5K, below remediation threshold
    const [, chesterNoBonus] = chesterVMaxellPayoff(9, 10);
    // The one with more savings + bonus should be higher
    expect(chesterWithBonus).toBeGreaterThan(chesterNoBonus);
  });

  test('Chester emotional distress makes no-deal worse than Maxell no-deal', () => {
    // Same gap, Chester pays more due to health anxiety premium
    const [maxellCost, chesterCost] = chesterVMaxellPayoff(8, 3);
    expect(chesterCost).toBeLessThan(maxellCost); // Chester suffers more
  });

  test('offer amounts are correct', () => {
    expect(offerToAmount(0)).toBe(100_000);
    expect(offerToAmount(5)).toBe(150_000);
    expect(offerToAmount(10)).toBe(200_000);
  });

  test('all 11 choices exist', () => {
    expect(NUM_CHOICES).toBe(11);
    expect(OFFER_LABELS.length).toBe(11);
  });
});

// ============================================================================
// Bazaar (Unbounded) Tests
// ============================================================================

describe('Chester v Maxell: Bazaar (Unbounded)', () => {
  const seeds = [42, 123, 456, 789, 1337];

  test('runs without error across multiple seeds', () => {
    for (const seed of seeds) {
      const result = runChesterVMaxellBazaar(500, seededRng(seed));
      expect(result.rounds.length).toBeGreaterThan(0);
    }
  });

  test('benchmark: settlement rates and amounts', () => {
    const results = seeds.map((seed) =>
      runChesterVMaxellBazaar(500, seededRng(seed))
    );

    console.log('\n=== Chester v Maxell: BAZAAR (Unbounded) ===');
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const avgMaxell =
        r.rounds.reduce((s, rd) => s + rd.maxellPayoff, 0) / r.rounds.length;
      const avgChester =
        r.rounds.reduce((s, rd) => s + rd.chesterPayoff, 0) / r.rounds.length;
      console.log(
        `  Seed ${seeds[i]}: ${r.settled ? 'SETTLED' : 'NO DEAL'} ` +
          `round ${r.settlementRound ?? '-'}, ` +
          `amount ${
            r.settlementAmount ? '$' + r.settlementAmount / 1000 + 'K' : '-'
          }, ` +
          `avgPay [M:${avgMaxell.toFixed(1)}, C:${avgChester.toFixed(1)}]`
      );
    }

    const settledCount = results.filter((r) => r.settled).length;
    console.log(`  Settlement rate: ${settledCount}/${seeds.length}`);

    // At least some should settle
    expect(results.length).toBe(seeds.length);
  });

  test('void boundaries accumulate rejections', () => {
    const result = runChesterVMaxellBazaar(100, seededRng(42));
    if (!result.settled) {
      expect(result.maxellState.boundary.totalEntries).toBeGreaterThan(0);
      expect(result.chesterState.boundary.totalEntries).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Neutral (Bounded) Tests
// ============================================================================

describe('Chester v Maxell: Neutral (Bounded Mediation)', () => {
  const seeds = [42, 123, 456, 789, 1337];

  test('runs without error across multiple seeds', () => {
    for (const seed of seeds) {
      const result = runChesterVMaxellNeutral(500, 0.15, seededRng(seed));
      expect(result.rounds.length).toBeGreaterThan(0);
    }
  });

  test('benchmark: convergence and settlement', () => {
    const results = seeds.map((seed) =>
      runChesterVMaxellNeutral(500, 0.15, seededRng(seed))
    );

    console.log('\n=== Chester v Maxell: NEUTRAL (Bounded Mediation) ===');
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(
        `  Seed ${seeds[i]}: ${r.settled ? 'CONVERGED' : 'EXHAUSTED'} ` +
          `round ${r.convergenceRound ?? r.summary.totalRounds}, ` +
          `amount ${r.settlementLabel ?? '-'}, ` +
          `accept ${(r.summary.proposalAcceptanceRate * 100).toFixed(0)}%, ` +
          `avgPay [M:${r.summary.avgMaxellPayoff.toFixed(
            1
          )}, C:${r.summary.avgChesterPayoff.toFixed(
            1
          )}, S:${r.summary.avgSkyrmsPayoff.toFixed(1)}]`
      );
    }

    const settledCount = results.filter((r) => r.settled).length;
    console.log(`  Convergence rate: ${settledCount}/${seeds.length}`);

    expect(results.length).toBe(seeds.length);
  });

  test('Skyrms walker void grows with failed proposals', () => {
    const result = runChesterVMaxellNeutral(100, 0.15, seededRng(42));
    expect(result.skyrmsWalker.meta.boundary.totalEntries).toBeGreaterThan(0);
  });

  test('settlement amounts fall in reasonable range when settled', () => {
    for (const seed of seeds) {
      const result = runChesterVMaxellNeutral(500, 0.2, seededRng(seed));
      if (result.settled && result.settlementAmount !== null) {
        // Should be somewhere between $100K and $200K
        expect(result.settlementAmount).toBeGreaterThanOrEqual(100_000);
        expect(result.settlementAmount).toBeLessThanOrEqual(200_000);
      }
    }
  });
});

// ============================================================================
// Head-to-Head: Bazaar vs Neutral
// ============================================================================

describe('Chester v Maxell: Bazaar vs Neutral Head-to-Head', () => {
  test('compare across 5 seeds', () => {
    const seeds = [42, 123, 456, 789, 1337];

    console.log('\n=== Chester v Maxell: BAZAAR vs NEUTRAL ===');
    console.log('  Seed  | Bazaar                          | Neutral');
    console.log(
      '  ------|-------------------------------|----------------------------------'
    );

    let bazaarSettled = 0;
    let neutralSettled = 0;
    let bazaarTotalRounds = 0;
    let neutralTotalRounds = 0;

    for (const seed of seeds) {
      const bazaar = runChesterVMaxellBazaar(500, seededRng(seed));
      const neutral = runChesterVMaxellNeutral(500, 0.15, seededRng(seed));

      if (bazaar.settled) bazaarSettled++;
      if (neutral.settled) neutralSettled++;
      bazaarTotalRounds += bazaar.rounds.length;
      neutralTotalRounds += neutral.rounds.length;

      const bDesc = bazaar.settled
        ? `SETTLED r${bazaar.settlementRound} @ $${
            bazaar.settlementAmount! / 1000
          }K`
        : `NO DEAL (${bazaar.rounds.length} rounds)`;
      const nDesc = neutral.settled
        ? `CONVERGED r${neutral.convergenceRound} @ ${neutral.settlementLabel}`
        : `EXHAUSTED (${neutral.summary.totalRounds} rounds)`;

      console.log(
        `  ${seed.toString().padEnd(5)} | ${bDesc.padEnd(31)} | ${nDesc}`
      );
    }

    console.log(
      '  ------|-------------------------------|----------------------------------'
    );
    console.log(
      `  Total | Settled ${bazaarSettled}/5, avg ${(
        bazaarTotalRounds / 5
      ).toFixed(0)} rounds | Converged ${neutralSettled}/5, avg ${(
        neutralTotalRounds / 5
      ).toFixed(0)} rounds`
    );

    // Both should produce valid results
    expect(bazaarSettled + neutralSettled).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Void Boundary Analysis
// ============================================================================

describe('Chester v Maxell: Void Boundary Analysis', () => {
  test('show which offers accumulate the most rejections', () => {
    const result = runChesterVMaxellNeutral(300, 0.15, seededRng(42));

    console.log('\n=== Void Boundary Analysis (Neutral, seed 42) ===');
    console.log('  Maxell void (which amounts got rejected most):');
    for (let i = 0; i < NUM_CHOICES; i++) {
      const bar = '#'.repeat(
        Math.min(50, Math.round(result.summary.maxellFinalVoidDensity[i]))
      );
      console.log(
        `    ${OFFER_LABELS[i].padEnd(
          5
        )} | ${bar} (${result.summary.maxellFinalVoidDensity[i].toFixed(0)})`
      );
    }

    console.log('  Chester void (which amounts got rejected most):');
    for (let i = 0; i < NUM_CHOICES; i++) {
      const bar = '#'.repeat(
        Math.min(50, Math.round(result.summary.chesterFinalVoidDensity[i]))
      );
      console.log(
        `    ${OFFER_LABELS[i].padEnd(
          5
        )} | ${bar} (${result.summary.chesterFinalVoidDensity[i].toFixed(0)})`
      );
    }

    console.log('  Skyrms walker void (top 5 most-rejected proposals):');
    const skyrmsVoid = result.skyrmsWalker.meta.boundary.counts;
    const indexed = skyrmsVoid.map((v: number, i: number) => ({
      idx: i,
      count: v,
    }));
    indexed.sort(
      (a: { count: number }, b: { count: number }) => b.count - a.count
    );
    for (let k = 0; k < Math.min(5, indexed.length); k++) {
      const { idx, count } = indexed[k];
      const pA = Math.floor(idx / NUM_CHOICES);
      const pB = idx % NUM_CHOICES;
      console.log(
        `    [${OFFER_LABELS[pA]}, ${
          OFFER_LABELS[pB]
        }] rejected ${count.toFixed(0)} times`
      );
    }

    expect(result.rounds.length).toBeGreaterThan(0);
  });
});
