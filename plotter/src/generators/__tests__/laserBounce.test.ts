import { describe, expect, it } from 'vitest';
import { laserBounce } from '../laserBounce.ts';
import { bounds, contains, PAGES } from '../../core/page.ts';
import type { PageSpec } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

function allPoints(layers: ReturnType<typeof laserBounce.generate>) {
  return layers.flatMap((l) => l.paths.flatMap((p) => p));
}

describe('laserBounce generator', () => {
  it('this module runs with no DOM/canvas globals available (Node environment)', () => {
    // Same architecture guard as the other generators' tests: this only
    // passes because vitest.config runs generators under `environment: 'node'`.
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('is deterministic: same params produce deeply equal output', () => {
    const a = laserBounce.generate(1, page, laserBounce.defaults);
    const b = laserBounce.generate(1, page, laserBounce.defaults);
    expect(a).toEqual(b);
  });

  it('is a pure function of params, not seed -- a deliberate design choice: the initial angle is already an explicit parameter, so seed is left with nothing meaningful to vary', () => {
    const a = laserBounce.generate(1, page, laserBounce.defaults);
    const b = laserBounce.generate(999, page, laserBounce.defaults);
    expect(a).toEqual(b);
  });

  it('keeps the triangle, the center dot, and every laser bounce point within the page margins', () => {
    const layers = laserBounce.generate(1, page, laserBounce.defaults);
    const b = bounds(page);
    for (const p of allPoints(layers)) {
      expect(contains(b, p)).toBe(true);
    }
  });

  it('emits the triangle as a single closed 4-point path (3 vertices + back to the start)', () => {
    const layers = laserBounce.generate(1, page, laserBounce.defaults);
    const triangleLayer = layers[0]!;
    expect(triangleLayer.paths).toHaveLength(1);
    const trianglePath = triangleLayer.paths[0]!;
    expect(trianglePath).toHaveLength(4);
    expect(trianglePath[3]).toEqual(trianglePath[0]);
  });

  it('never emits a path with fewer than 2 points', () => {
    const layers = laserBounce.generate(1, page, laserBounce.defaults);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('traces exactly one point per bounce, starting from the center', () => {
    const params = { ...laserBounce.defaults, maxBounces: 1 };
    const layers = laserBounce.generate(1, page, params);
    const laserPath = layers[1]!.paths[layers[1]!.paths.length - 1]!;
    expect(laserPath).toHaveLength(2); // center + one bounce
  });

  it('a larger max-bounces budget produces a longer (or equal) laser path', () => {
    const short = laserBounce.generate(1, page, { ...laserBounce.defaults, maxBounces: 5 });
    const long = laserBounce.generate(1, page, { ...laserBounce.defaults, maxBounces: 200 });
    const laserLength = (layers: typeof short) => layers[1]!.paths[layers[1]!.paths.length - 1]!.length;
    expect(laserLength(long)).toBeGreaterThan(laserLength(short));
  });

  it('clamps an oversized triangle to fit the page instead of drawing off the edge', () => {
    const layers = laserBounce.generate(1, page, { ...laserBounce.defaults, sizeMm: 100000 });
    const b = bounds(page);
    for (const p of allPoints(layers)) {
      expect(contains(b, p)).toBe(true);
    }
  });

  it('changing the initial angle changes the laser path', () => {
    const a = laserBounce.generate(1, page, { ...laserBounce.defaults, initialAngleDeg: 10 });
    const c = laserBounce.generate(1, page, { ...laserBounce.defaults, initialAngleDeg: 200 });
    expect(a).not.toEqual(c);
  });

  it('generates the default A4 sketch in well under 200ms (target; informational)', () => {
    const start = performance.now();
    laserBounce.generate(1, page, laserBounce.defaults);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`laserBounce default A4 generation: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000); // generous CI-safe ceiling; see console for the real number
  });
});
