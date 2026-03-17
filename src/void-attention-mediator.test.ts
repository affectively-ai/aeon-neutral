import { describe, test, expect } from 'bun:test';
import { mediateWithVoidAttention } from './void-attention-mediator';
import { mediateThreeWalker } from './skyrms-walker';
import { runChesterVMaxellBazaar } from '../../aeon-bazaar/src/scenarios/chester-v-maxell';
import {
  chesterVMaxellPayoff,
  offerToAmount,
  OFFER_LABELS,
  NUM_CHOICES,
} from './scenarios/chester-v-maxell';

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hawkDovePayoff(a: number, b: number): [number, number] {
  if (a === 0 && b === 0) return [-1, -1];
  if (a === 0 && b === 1) return [4, 0];
  if (a === 1 && b === 0) return [0, 4];
  return [2, 2];
}

function prisonerPayoff(a: number, b: number): [number, number] {
  if (a === 1 && b === 1) return [3, 3];
  if (a === 1 && b === 0) return [0, 5];
  if (a === 0 && b === 1) return [5, 0];
  return [1, 1];
}

function stagHuntPayoff(a: number, b: number): [number, number] {
  if (a === 1 && b === 1) return [4, 4];
  if (a === 0 && b === 0) return [2, 2];
  if (a === 1 && b === 0) return [0, 2];
  return [2, 0];
}

function coordination3(a: number, b: number): [number, number] {
  return a === b ? [3, 3] : [0, 0];
}

// ============================================================================
// Core Tests
// ============================================================================

describe('Void Attention Mediator', () => {
  test('runs one round', async () => {
    const result = await mediateWithVoidAttention({
      numChoicesA: 2, numChoicesB: 2, maxRounds: 1,
      payoff: hawkDovePayoff, rng: seededRng(42),
    });
    expect(result.rounds.length).toBe(1);
    expect(result.rounds[0].offerA).toBeGreaterThanOrEqual(0);
  });

  test('PD: 200 rounds', async () => {
    const result = await mediateWithVoidAttention({
      numChoicesA: 2, numChoicesB: 2, maxRounds: 200,
      nadirThreshold: 0.15,
      payoff: prisonerPayoff, rng: seededRng(42),
    });
    expect(result.rounds.length).toBeGreaterThan(0);
    const coopCount = result.rounds.filter((r) => r.offerA === 1 && r.offerB === 1).length;
    expect(coopCount).toBeGreaterThan(0);
  });

  test('void boundaries grow', async () => {
    const result = await mediateWithVoidAttention({
      numChoicesA: 2, numChoicesB: 2, maxRounds: 50,
      payoff: hawkDovePayoff, rng: seededRng(42),
    });
    expect(result.payload.boundaryA.totalEntries).toBeGreaterThan(0);
    expect(result.payload.boundaryB.totalEntries).toBeGreaterThan(0);
    expect(result.payload.boundaryCross.totalEntries).toBeGreaterThan(0);
  });
});

// ============================================================================
// Head-to-Head: Three-Walker vs Void Attention Transformer
// ============================================================================

describe('Head-to-Head: Three-Walker vs Void Attention', () => {
  const games: [string, (a: number, b: number) => [number, number], number][] = [
    ['Hawk-Dove (2x2)', hawkDovePayoff, 2],
    ['PD (2x2)', prisonerPayoff, 2],
    ['Stag Hunt (2x2)', stagHuntPayoff, 2],
    ['Coordination (3x3)', coordination3, 3],
  ];

  for (const [name, payoff, n] of games) {
    test(`${name}: 500 rounds, 5 seeds`, async () => {
      const seeds = [42, 123, 456, 789, 1337];
      const threeWalkerResults: { coordRate: number; avgPayA: number; avgPayB: number; settled: boolean }[] = [];
      const voidAttnResults: { coordRate: number; avgPayA: number; avgPayB: number; settled: boolean }[] = [];

      for (const seed of seeds) {
        // Three-Walker
        const tw = mediateThreeWalker({
          numChoicesA: n, numChoicesB: n, maxRounds: 500,
          nadirThreshold: 0.15, payoff, rng: seededRng(seed),
        });
        const twCoord = tw.rounds.filter((r) => r.offerA === r.offerB).length / tw.rounds.length;
        const twPayA = tw.rounds.reduce((s, r) => s + r.payoffA, 0) / tw.rounds.length;
        const twPayB = tw.rounds.reduce((s, r) => s + r.payoffB, 0) / tw.rounds.length;
        threeWalkerResults.push({ coordRate: twCoord, avgPayA: twPayA, avgPayB: twPayB, settled: tw.settled });

        // Void Attention
        const va = await mediateWithVoidAttention({
          numChoicesA: n, numChoicesB: n, maxRounds: 500,
          nadirThreshold: 0.15, neighborhoodRadius: Math.min(2, n - 1),
          payoff, rng: seededRng(seed),
        });
        const vaCoord = va.rounds.filter((r) => r.offerA === r.offerB).length / va.rounds.length;
        const vaPayA = va.rounds.reduce((s, r) => s + r.payoffA, 0) / va.rounds.length;
        const vaPayB = va.rounds.reduce((s, r) => s + r.payoffB, 0) / va.rounds.length;
        voidAttnResults.push({ coordRate: vaCoord, avgPayA: vaPayA, avgPayB: vaPayB, settled: va.settled });
      }

      const twAvgCoord = threeWalkerResults.reduce((s, r) => s + r.coordRate, 0) / seeds.length;
      const vaAvgCoord = voidAttnResults.reduce((s, r) => s + r.coordRate, 0) / seeds.length;
      const twAvgPay = threeWalkerResults.reduce((s, r) => s + r.avgPayA + r.avgPayB, 0) / (seeds.length * 2);
      const vaAvgPay = voidAttnResults.reduce((s, r) => s + r.avgPayA + r.avgPayB, 0) / (seeds.length * 2);
      const twSettled = threeWalkerResults.filter((r) => r.settled).length;
      const vaSettled = voidAttnResults.filter((r) => r.settled).length;

      console.log(`\n=== ${name}: Three-Walker vs Void Attention ===`);
      console.log(`  Three-Walker: coord=${(twAvgCoord * 100).toFixed(1)}%, avgPay=${twAvgPay.toFixed(2)}, settled=${twSettled}/5`);
      console.log(`  Void Attn:    coord=${(vaAvgCoord * 100).toFixed(1)}%, avgPay=${vaAvgPay.toFixed(2)}, settled=${vaSettled}/5`);
      console.log(`  Delta:        coord=${((vaAvgCoord - twAvgCoord) * 100).toFixed(1)}pp, pay=${(vaAvgPay - twAvgPay).toFixed(2)}`);

      expect(threeWalkerResults.length).toBe(seeds.length);
      expect(voidAttnResults.length).toBe(seeds.length);
    });
  }
});

// ============================================================================
// Chester v Maxell: All Three Mediators
// ============================================================================

describe('Chester v Maxell: Bazaar vs Three-Walker vs Void Attention', () => {
  test('head-to-head across 5 seeds', async () => {
    const seeds = [42, 123, 456, 789, 1337];

    console.log('\n=== Chester v Maxell: THREE-WAY COMPARISON ===');
    console.log('  Seed  | Bazaar              | Three-Walker         | Void Attention');
    console.log('  ------|---------------------|----------------------|----------------------');

    const bzResults: { settled: boolean; avgPay: number }[] = [];
    const twResults: { settled: boolean; avgPay: number }[] = [];
    const vaResults: { settled: boolean; avgPay: number }[] = [];

    for (const seed of seeds) {
      // Bazaar
      const bz = runChesterVMaxellBazaar(500, seededRng(seed));
      const bzAvg = bz.rounds.reduce((s, r) => s + r.maxellPayoff + r.chesterPayoff, 0) / (bz.rounds.length * 2);
      bzResults.push({ settled: bz.settled, avgPay: bzAvg });

      // Three-Walker
      const tw = mediateThreeWalker({
        numChoicesA: NUM_CHOICES, numChoicesB: NUM_CHOICES, maxRounds: 500,
        nadirThreshold: 0.15, payoff: chesterVMaxellPayoff, rng: seededRng(seed),
      });
      const twAvg = tw.rounds.reduce((s, r) => s + r.payoffA + r.payoffB, 0) / (tw.rounds.length * 2);
      twResults.push({ settled: tw.settled, avgPay: twAvg });

      // Void Attention
      const va = await mediateWithVoidAttention({
        numChoicesA: NUM_CHOICES, numChoicesB: NUM_CHOICES, maxRounds: 500,
        nadirThreshold: 0.15, neighborhoodRadius: 2,
        payoff: chesterVMaxellPayoff, rng: seededRng(seed),
      });
      const vaAvg = va.rounds.reduce((s, r) => s + r.payoffA + r.payoffB, 0) / (va.rounds.length * 2);
      vaResults.push({ settled: va.settled, avgPay: vaAvg });

      const bzDesc = bz.settled ? `SETTLED r${bz.settlementRound}` : `NO DEAL`;
      const twDesc = tw.settled ? `CONV r${tw.convergenceRound}` : `EXHAUST`;
      const vaDesc = va.settled ? `CONV r${va.convergenceRound}` : `EXHAUST`;
      console.log(`  ${seed.toString().padEnd(5)} | ${(bzDesc + ` pay=${bzAvg.toFixed(1)}`).padEnd(19)} | ${(twDesc + ` pay=${twAvg.toFixed(1)}`).padEnd(20)} | ${vaDesc} pay=${vaAvg.toFixed(1)}`);
    }

    const bzAvgPay = bzResults.reduce((s, r) => s + r.avgPay, 0) / seeds.length;
    const twAvgPay = twResults.reduce((s, r) => s + r.avgPay, 0) / seeds.length;
    const vaAvgPay = vaResults.reduce((s, r) => s + r.avgPay, 0) / seeds.length;
    const bzSettled = bzResults.filter((r) => r.settled).length;
    const twSettled = twResults.filter((r) => r.settled).length;
    const vaSettled = vaResults.filter((r) => r.settled).length;

    console.log('  ------|---------------------|----------------------|----------------------');
    console.log(`  Avg   | settled=${bzSettled}/5 pay=${bzAvgPay.toFixed(1)} | settled=${twSettled}/5 pay=${twAvgPay.toFixed(1)}  | settled=${vaSettled}/5 pay=${vaAvgPay.toFixed(1)}`);
    console.log(`  Improvement over Three-Walker: ${((vaAvgPay - twAvgPay) / Math.abs(twAvgPay) * 100).toFixed(1)}% avg payoff`);

    expect(bzResults.length).toBe(seeds.length);
  });
});
