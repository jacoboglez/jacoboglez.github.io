import { describe, expect, it } from 'vitest';
import { randomWalk } from '../randomWalk.ts';
import { bounds, contains, PAGES } from '../../core/page.ts';
import type { PageSpec } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

describe('randomWalk generator', () => {
  it('this module runs with no DOM/canvas globals available (Node environment)', () => {
    // Same architecture guard as flowField.test.ts: this only passes
    // because vitest.config runs generators under `environment: 'node'`.
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('is deterministic: same seed + params produce deeply equal output', () => {
    const a = randomWalk.generate(42, page, randomWalk.defaults);
    const b = randomWalk.generate(42, page, randomWalk.defaults);
    expect(a).toEqual(b);
  });

  it('produces different output for a different seed', () => {
    const a = randomWalk.generate(1, page, randomWalk.defaults);
    const b = randomWalk.generate(2, page, randomWalk.defaults);
    expect(a).not.toEqual(b);
  });

  it('keeps every point within the page margins', () => {
    const layers = randomWalk.generate(7, page, randomWalk.defaults);
    const b = bounds(page);
    for (const layer of layers) {
      for (const path of layer.paths) {
        for (const p of path) {
          expect(contains(b, p)).toBe(true);
        }
      }
    }
  });

  it('never emits a path with fewer than 2 points', () => {
    const layers = randomWalk.generate(7, page, randomWalk.defaults);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('produces at least some output for default params on A4', () => {
    const layers = randomWalk.generate(42, page, randomWalk.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBeGreaterThan(0);
  });

  it('emits at most nWalkers paths (a walker that instantly steps out of bounds is dropped)', () => {
    const layers = randomWalk.generate(42, page, randomWalk.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBeLessThanOrEqual(randomWalk.defaults.nWalkers);
  });

  it('a larger maxTurnDeg still keeps every point in bounds (no runaway steps)', () => {
    const layers = randomWalk.generate(7, page, { ...randomWalk.defaults, maxTurnDeg: 180 });
    const b = bounds(page);
    for (const layer of layers) {
      for (const path of layer.paths) {
        for (const p of path) {
          expect(contains(b, p)).toBe(true);
        }
      }
    }
  });

  it('generates the default A4 sketch in well under 200ms (target; informational)', () => {
    const start = performance.now();
    randomWalk.generate(42, page, randomWalk.defaults);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`randomWalk default A4 generation: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000); // generous CI-safe ceiling; see console for the real number
  });
});
