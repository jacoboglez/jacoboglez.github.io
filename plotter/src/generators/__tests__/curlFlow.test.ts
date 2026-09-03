import { describe, expect, it } from 'vitest';
import { curlFlow } from '../curlFlow.ts';
import { bounds, contains, PAGES } from '../../core/page.ts';
import type { PageSpec } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

describe('curlFlow generator', () => {
  it('this module runs with no DOM/canvas globals available (Node environment)', () => {
    // Same architecture guard as the other generator suites: this only
    // passes because vitest.config runs generators under `environment:
    // 'node'`.
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('is deterministic: same seed + params produce deeply equal output', () => {
    const a = curlFlow.generate(42, page, curlFlow.defaults);
    const b = curlFlow.generate(42, page, curlFlow.defaults);
    expect(a).toEqual(b);
  });

  it('produces different output for a different seed', () => {
    const a = curlFlow.generate(1, page, curlFlow.defaults);
    const b = curlFlow.generate(2, page, curlFlow.defaults);
    expect(a).not.toEqual(b);
  });

  it('keeps every point within the page margins', () => {
    const layers = curlFlow.generate(7, page, curlFlow.defaults);
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
    const layers = curlFlow.generate(7, page, curlFlow.defaults);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('never emits a path shorter than minLength', () => {
    const params = { ...curlFlow.defaults, minLength: 20 };
    const layers = curlFlow.generate(7, page, params);
    for (const layer of layers) {
      for (const path of layer.paths) {
        let len = 0;
        for (let i = 1; i < path.length; i++) {
          const [x0, y0] = path[i - 1]!;
          const [x1, y1] = path[i]!;
          len += Math.hypot(x1 - x0, y1 - y0);
        }
        expect(len).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('produces at least some output for default params on A4', () => {
    const layers = curlFlow.generate(42, page, curlFlow.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBeGreaterThan(0);
  });

  it('with only the default left edge enabled, every line starts exactly on it', () => {
    const layers = curlFlow.generate(42, page, curlFlow.defaults);
    const b = bounds(page);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path[0]![0]).toBeCloseTo(b.minX, 9);
      }
    }
  });

  it('emits at most nLines paths (a seed that starts below minSpeed or minLength is dropped)', () => {
    const layers = curlFlow.generate(42, page, curlFlow.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBeLessThanOrEqual(curlFlow.defaults.nLines as number);
  });

  it('more left-edge seeds yields more (or equal) total paths', () => {
    const few = curlFlow.generate(42, page, { ...curlFlow.defaults, nLines: 8, minLength: 0 });
    const many = curlFlow.generate(42, page, { ...curlFlow.defaults, nLines: 120, minLength: 0 });
    const count = (layers: typeof few) => layers.reduce((s, l) => s + l.paths.length, 0);
    expect(count(many)).toBeGreaterThan(count(few));
  });

  it('seeding only the right edge starts every line exactly on it', () => {
    const layers = curlFlow.generate(42, page, {
      ...curlFlow.defaults,
      seedLeft: false,
      seedRight: true,
      minLength: 0,
    });
    const b = bounds(page);
    const paths = layers.flatMap((l) => l.paths);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path[0]![0]).toBeCloseTo(b.maxX, 9);
    }
  });

  it('seeding only the top edge starts every line exactly on it', () => {
    const layers = curlFlow.generate(42, page, {
      ...curlFlow.defaults,
      seedLeft: false,
      seedTop: true,
      minLength: 0,
    });
    const b = bounds(page);
    const paths = layers.flatMap((l) => l.paths);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path[0]![1]).toBeCloseTo(b.minY, 9);
    }
  });

  it('seeding only the bottom edge starts every line exactly on it', () => {
    const layers = curlFlow.generate(42, page, {
      ...curlFlow.defaults,
      seedLeft: false,
      seedBottom: true,
      minLength: 0,
    });
    const b = bounds(page);
    const paths = layers.flatMap((l) => l.paths);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path[0]![1]).toBeCloseTo(b.maxY, 9);
    }
  });

  it('with several edges enabled, every line starts on one of them and the total is capped at nLines * enabledEdges', () => {
    const params = {
      ...curlFlow.defaults,
      seedLeft: true,
      seedRight: true,
      seedTop: true,
      seedBottom: false,
      nLines: 20,
    };
    const layers = curlFlow.generate(42, page, params);
    const b = bounds(page);
    const paths = layers.flatMap((l) => l.paths);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThanOrEqual(20 * 3);
    for (const path of paths) {
      const [x0, y0] = path[0]!;
      const onLeft = Math.abs(x0 - b.minX) < 1e-9;
      const onRight = Math.abs(x0 - b.maxX) < 1e-9;
      const onTop = Math.abs(y0 - b.minY) < 1e-9;
      expect(onLeft || onRight || onTop).toBe(true);
    }
  });

  it('with no edges enabled, produces no paths at all', () => {
    const layers = curlFlow.generate(42, page, {
      ...curlFlow.defaults,
      seedLeft: false,
      seedRight: false,
      seedTop: false,
      seedBottom: false,
    });
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBe(0);
  });

  it('velocity is never renormalized: line segment lengths vary with local field speed (not all equal to stepSize)', () => {
    // The whole point of not normalizing is that steps stay roughly
    // `stepSize` mm in *arc length* via the adaptive dt, but individual
    // (x, y) segment lengths still reflect how the RK4 stages curved
    // within that step -- they should not all collapse to one exact value
    // the way a fixed-length unit-vector walk would.
    const layers = curlFlow.generate(42, page, curlFlow.defaults);
    const lengths = new Set<number>();
    for (const layer of layers) {
      for (const path of layer.paths) {
        for (let i = 1; i < path.length; i++) {
          const [x0, y0] = path[i - 1]!;
          const [x1, y1] = path[i]!;
          lengths.add(Math.round(Math.hypot(x1 - x0, y1 - y0) * 1000));
        }
      }
    }
    expect(lengths.size).toBeGreaterThan(5);
  });

  it('the wind bias makes streams travel substantially further across the page than pure noise alone', () => {
    // This is the whole point of adding the directional bias: without it,
    // seeded-on-noise-alone streamlines mostly stay near the left margin
    // (see the generator's doc comment). Compare the median how-far-right
    // each path gets, with and without the bias, on the same field.
    const rightmostPerPath = (layers: ReturnType<typeof curlFlow.generate>): number[] => {
      const arr: number[] = [];
      for (const layer of layers) {
        for (const path of layer.paths) {
          arr.push(Math.max(...path.map((p) => p[0])));
        }
      }
      arr.sort((a, b) => a - b);
      return arr;
    };
    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)] ?? 0;

    const noWind = curlFlow.generate(42, page, { ...curlFlow.defaults, windStrength: 0 });
    const withWind = curlFlow.generate(42, page, curlFlow.defaults);
    expect(median(rightmostPerPath(withWind))).toBeGreaterThan(median(rightmostPerPath(noWind)));
  });

  it('with the default wind, most streams reach at least halfway across the page', () => {
    const b = bounds(page);
    const layers = curlFlow.generate(42, page, curlFlow.defaults);
    const halfway = b.minX + (b.maxX - b.minX) / 2;
    const paths = layers.flatMap((l) => l.paths);
    const reachingHalfway = paths.filter((path) => path.some((p) => p[0] >= halfway));
    expect(reachingHalfway.length / paths.length).toBeGreaterThan(0.5);
  });

  it('generates the default A4 sketch in well under 1s (target; informational)', () => {
    const start = performance.now();
    curlFlow.generate(42, page, curlFlow.defaults);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`curlFlow default A4 generation: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000); // generous CI-safe ceiling; see console for the real number
  });
});
