import { describe, expect, it } from 'vitest';
import { bounds, clipToBounds, contains, PAGES } from '../page.ts';
import type { Path, PageSpec } from '../types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 10 };

describe('bounds / contains', () => {
  it('computes the margin-inset drawable region', () => {
    const b = bounds(page);
    expect(b).toEqual({ minX: 10, minY: 10, maxX: 287, maxY: 200 });
  });

  it('contains points inside and rejects points outside', () => {
    const b = bounds(page);
    expect(contains(b, [150, 100])).toBe(true);
    expect(contains(b, [10, 10])).toBe(true); // boundary is inclusive
    expect(contains(b, [287, 200])).toBe(true);
    expect(contains(b, [5, 100])).toBe(false);
    expect(contains(b, [150, 205])).toBe(false);
  });
});

describe('clipToBounds', () => {
  const b = bounds(page);

  it('leaves an entirely-inside path untouched', () => {
    const path: Path = [
      [50, 50],
      [60, 60],
      [70, 50],
    ];
    const clipped = clipToBounds([path], b);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]).toEqual(path);
  });

  it('drops an entirely-outside path', () => {
    const path: Path = [
      [0, 0],
      [5, 5],
    ];
    expect(clipToBounds([path], b)).toHaveLength(0);
  });

  it('splits a path that leaves and re-enters the region into two paths', () => {
    // Travels inside -> outside (past the right edge) -> inside again.
    const path: Path = [
      [280, 100], // inside
      [300, 100], // outside (past maxX=287)
      [280, 120], // inside again
    ];
    const clipped = clipToBounds([path], b);
    expect(clipped).toHaveLength(2);
    for (const seg of clipped) {
      for (const p of seg) {
        expect(contains(b, p)).toBe(true);
      }
    }
    // First segment starts at the original inside point.
    expect(clipped[0]![0]).toEqual([280, 100]);
    // Second segment ends at the original inside point.
    expect(clipped[1]!.at(-1)).toEqual([280, 120]);
  });

  it('clips instead of clamping: no output point sits exactly on repeated margin runs', () => {
    // A path that grazes just past the boundary and back should not produce
    // a long run of points pinned to the boundary line.
    const path: Path = [
      [150, 50],
      [150, 5], // outside, above the top margin
      [155, 5],
      [160, 50],
    ];
    const clipped = clipToBounds([path], b);
    // Should split into two short inside segments, not one long clamped one.
    expect(clipped.length).toBeGreaterThanOrEqual(1);
    for (const seg of clipped) {
      expect(seg.length).toBeLessThan(path.length);
    }
  });
});
