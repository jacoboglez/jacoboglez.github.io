import { describe, expect, it } from 'vitest';
import { estimate, formatEstimate } from '../cost.ts';
import type { Layer } from '../types.ts';

describe('estimate', () => {
  it('sums draw length, path count, and point count across layers', () => {
    const layers: Layer[] = [
      { name: '1', paths: [[[0, 0], [10, 0]], [[0, 10], [0, 20], [0, 30]]], color: '#000' },
      { name: '2', paths: [[[100, 100], [110, 100]]], color: '#f00' },
    ];
    const e = estimate(layers);
    expect(e.pathCount).toBe(3);
    expect(e.pointCount).toBe(2 + 3 + 2);
    expect(e.drawLengthMm).toBeCloseTo(10 + 20 + 10, 5);
  });

  it('computes travel as the gaps between consecutive path endpoints, in order', () => {
    const layers: Layer[] = [
      { name: '1', paths: [[[0, 0], [10, 0]], [[20, 0], [30, 0]]], color: '#000' },
    ];
    const e = estimate(layers);
    // travel: from (10,0) end of first path to (20,0) start of second = 10
    expect(e.travelLengthMm).toBeCloseTo(10, 5);
  });

  it('has zero travel for a single path and efficiency of 1', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[0, 0], [10, 0]]], color: '#000' }];
    const e = estimate(layers);
    expect(e.travelLengthMm).toBe(0);
    expect(e.efficiency).toBe(1);
  });

  it('has efficiency 1 for an empty plot (no division by zero)', () => {
    const e = estimate([]);
    expect(e.efficiency).toBe(1);
    expect(e.seconds).toBe(0);
  });

  it('applies custom speeds and pen-cycle time to the seconds estimate', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[0, 0], [60, 0]]], color: '#000' }];
    const e = estimate(layers, { drawSpeedMmPerSec: 60, travelSpeedMmPerSec: 150, penCycleSeconds: 1 });
    // 60mm draw at 60mm/s = 1s, + 1 path * 1s pen cycle = 2s total, no travel
    expect(e.seconds).toBeCloseTo(2, 5);
  });

  it('respects the order paths appear in, not a shortest-path ordering', () => {
    // Two paths far apart followed by a return trip -- an optimiser would
    // reorder these, but cost.ts must not: it estimates in given order.
    const layers: Layer[] = [
      { name: '1', paths: [[[0, 0], [0, 1]], [[100, 100], [100, 101]], [[0, 0], [0, 1]]], color: '#000' },
    ];
    const e = estimate(layers);
    const dist = Math.hypot(100, 99); // (0,1) -> (100,100)
    const back = Math.hypot(100, 101); // (100,101) -> (0,0)
    expect(e.travelLengthMm).toBeCloseTo(dist + back, 5);
  });
});

describe('formatEstimate', () => {
  it('produces a readable, non-empty summary that flags the pessimism', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[0, 0], [1000, 0]]], color: '#000' }];
    const summary = formatEstimate(estimate(layers));
    expect(summary).toContain('pessimistic');
    expect(summary).toMatch(/\d+ paths/);
  });
});
