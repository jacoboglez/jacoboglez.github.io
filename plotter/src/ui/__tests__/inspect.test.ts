import { describe, expect, it } from 'vitest';
import { computeStats, formatStatsLine } from '../inspect.ts';
import type { Layer } from '../../core/types.ts';

describe('computeStats', () => {
  it('computes path/point counts and draw length', () => {
    const layers: Layer[] = [
      { name: '1', paths: [[[0, 0], [10, 0]], [[0, 0], [0, 5]]], color: '#000' },
    ];
    const stats = computeStats(layers);
    expect(stats.pathCount).toBe(2);
    expect(stats.pointCount).toBe(4);
    expect(stats.drawLengthMm).toBeCloseTo(15, 5);
    expect(stats.longestPathMm).toBeCloseTo(10, 5);
    expect(stats.medianPathMm).toBeCloseTo(10, 5); // sorted [5,10], index floor(2/2)=1 -> 10
  });

  it('handles an empty plot without dividing by zero', () => {
    const stats = computeStats([]);
    expect(stats.pathCount).toBe(0);
    expect(stats.longestPathMm).toBe(0);
    expect(stats.medianPathMm).toBe(0);
    expect(stats.histogram.every((b) => b.count === 0)).toBe(true);
  });

  it('histogram buckets sum to the total path count', () => {
    const layers: Layer[] = [
      { name: '1', paths: [[[0, 0], [1, 0]], [[0, 0], [50, 0]], [[0, 0], [100, 0]]], color: '#000' },
    ];
    const stats = computeStats(layers, 5);
    const total = stats.histogram.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(3);
    // A spike near the shortest-path bucket is the "dying young" signal --
    // just confirm short paths land in an early bucket, long ones in a late one.
    expect(stats.histogram[0]!.count).toBeGreaterThan(0);
    expect(stats.histogram[stats.histogram.length - 1]!.count).toBeGreaterThan(0);
  });
});

describe('formatStatsLine', () => {
  it('produces a compact, non-empty summary', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[0, 0], [10, 0]]], color: '#000' }];
    const line = formatStatsLine(computeStats(layers));
    expect(line).toContain('1 paths');
    expect(line).toContain('2 pts');
  });
});
