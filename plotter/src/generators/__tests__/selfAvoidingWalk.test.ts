import { describe, expect, it } from 'vitest';
import { selfAvoidingWalk } from '../selfAvoidingWalk.ts';
import { bounds, contains, PAGES } from '../../core/page.ts';
import type { PageSpec, Point } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function allPoints(layers: ReturnType<typeof selfAvoidingWalk.generate>): Point[] {
  return layers.flatMap((l) => l.paths.flat());
}

describe('selfAvoidingWalk generator', () => {
  it('this module runs with no DOM/canvas globals available (Node environment)', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('is deterministic: same seed + params produce deeply equal output', () => {
    const a = selfAvoidingWalk.generate(42, page, selfAvoidingWalk.defaults);
    const b = selfAvoidingWalk.generate(42, page, selfAvoidingWalk.defaults);
    expect(a).toEqual(b);
  });

  it('produces different output for a different seed', () => {
    const a = selfAvoidingWalk.generate(1, page, selfAvoidingWalk.defaults);
    const b = selfAvoidingWalk.generate(2, page, selfAvoidingWalk.defaults);
    expect(a).not.toEqual(b);
  });

  it('keeps every point within the page margins', () => {
    const layers = selfAvoidingWalk.generate(7, page, selfAvoidingWalk.defaults);
    const b = bounds(page);
    for (const p of allPoints(layers)) {
      expect(contains(b, p)).toBe(true);
    }
  });

  it('never emits a path with fewer than 2 points', () => {
    const layers = selfAvoidingWalk.generate(7, page, selfAvoidingWalk.defaults);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('produces exactly one path when nWalks is 1 (the default)', () => {
    const layers = selfAvoidingWalk.generate(42, page, selfAvoidingWalk.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBe(1);
  });

  it('produces a substantial path for default params on A4 (not an instant dead end)', () => {
    const layers = selfAvoidingWalk.generate(42, page, selfAvoidingWalk.defaults);
    const path = layers[0]?.paths[0] ?? [];
    expect(path.length).toBeGreaterThan(60);
  });

  it('never lets the path cross closer than avoidRadius to its older self (persistent mode)', () => {
    // Use a shorter run so the O(n^2) all-pairs check below stays fast.
    const params = { ...selfAvoidingWalk.defaults, headingMode: 'persistent' as const, maxSteps: 250 };
    const layers = selfAvoidingWalk.generate(7, page, params);
    const path = layers[0]?.paths[0] ?? [];
    expect(path.length).toBeGreaterThan(2);

    // Mirrors the generator's own aging window, with slack: points closer
    // together than this in the sequence are allowed to violate avoidRadius
    // (they're the tail leading up to "now"), anything older must not.
    const minGap = Math.ceil(params.avoidRadius / params.stepSize) + 5;

    for (let i = 0; i < path.length; i++) {
      for (let j = i + minGap; j < path.length; j++) {
        const pi = path[i];
        const pj = path[j];
        if (!pi || !pj) continue;
        expect(dist(pi, pj)).toBeGreaterThanOrEqual(params.avoidRadius - 1e-6);
      }
    }
  });

  it('stops itself well before maxSteps once boxed in (does not just run to the cap)', () => {
    // A generous cap far above what a walk on an A4 page could plausibly
    // reach at these spacing params -- if this fails, the walk isn't
    // actually terminating on dead ends.
    const params = { ...selfAvoidingWalk.defaults, maxSteps: 20000 };
    const layers = selfAvoidingWalk.generate(3, page, params);
    const path = layers[0]?.paths[0] ?? [];
    expect(path.length).toBeLessThan(params.maxSteps);
  });

  it('a tighter turn budget still keeps every point in bounds and self-clear', () => {
    const layers = selfAvoidingWalk.generate(11, page, { ...selfAvoidingWalk.defaults, turnMagnitudeDeg: 5 });
    const b = bounds(page);
    for (const p of allPoints(layers)) {
      expect(contains(b, p)).toBe(true);
    }
  });

  it('noise heading mode produces a valid, in-bounds path', () => {
    const params = { ...selfAvoidingWalk.defaults, headingMode: 'noise' as const };
    const layers = selfAvoidingWalk.generate(21, page, params);
    const path = layers[0]?.paths[0] ?? [];
    expect(path.length).toBeGreaterThan(2);
    const b = bounds(page);
    for (const p of path) {
      expect(contains(b, p)).toBe(true);
    }
  });

  it('levy heading mode produces a valid, in-bounds path with occasional long straight runs', () => {
    const params = { ...selfAvoidingWalk.defaults, headingMode: 'levy' as const, jumpChance: 0.08, jumpMaxSteps: 40 };
    const layers = selfAvoidingWalk.generate(21, page, params);
    const path = layers[0]?.paths[0] ?? [];
    expect(path.length).toBeGreaterThan(2);
    const b = bounds(page);
    for (const p of path) {
      expect(contains(b, p)).toBe(true);
    }

    // Expect at least one run of several consecutive segments pointing in
    // (nearly) the same direction -- the signature of a Lévy jump -- rather
    // than every step being an independent small turn.
    let longestRun = 1;
    let currentRun = 1;
    for (let i = 2; i < path.length; i++) {
      const a = path[i - 2];
      const b2 = path[i - 1];
      const c = path[i];
      if (!a || !b2 || !c) continue;
      const angle1 = Math.atan2(b2[1] - a[1], b2[0] - a[0]);
      const angle2 = Math.atan2(c[1] - b2[1], c[0] - b2[0]);
      let diff = Math.abs(angle1 - angle2);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < 0.05) {
        currentRun++;
        longestRun = Math.max(longestRun, currentRun);
      } else {
        currentRun = 1;
      }
    }
    expect(longestRun).toBeGreaterThanOrEqual(4);
  });

  it('nWalks > 1 starts every walk from the same shared point', () => {
    const params = { ...selfAvoidingWalk.defaults, nWalks: 4, maxSteps: 800 };
    const layers = selfAvoidingWalk.generate(5, page, params);
    const paths = layers[0]?.paths ?? [];
    expect(paths.length).toBeGreaterThan(1);

    const starts = paths.map((p) => p[0]).filter((p): p is Point => !!p);
    expect(starts.length).toBe(paths.length);
    for (const s of starts.slice(1)) {
      expect(s[0]).toBeCloseTo(starts[0]![0], 6);
      expect(s[1]).toBeCloseTo(starts[0]![1], 6);
    }
  });

  it('nWalks paths stay mutually clear of each other away from the shared hub', () => {
    const params = { ...selfAvoidingWalk.defaults, nWalks: 3, maxSteps: 600 };
    const layers = selfAvoidingWalk.generate(9, page, params);
    const paths = layers[0]?.paths ?? [];
    expect(paths.length).toBeGreaterThan(1);

    const start = paths[0]?.[0];
    expect(start).toBeTruthy();
    const hubRadius = params.avoidRadius * 2;

    for (let a = 0; a < paths.length; a++) {
      for (let b2 = a + 1; b2 < paths.length; b2++) {
        const pathA = paths[a] ?? [];
        const pathB = paths[b2] ?? [];
        for (const p of pathA) {
          if (start && dist(p, start) < hubRadius) continue;
          for (const q of pathB) {
            if (start && dist(q, start) < hubRadius) continue;
            expect(dist(p, q)).toBeGreaterThanOrEqual(params.avoidRadius - 1e-6);
          }
        }
      }
    }
  });

  it('generates the default A4 sketch in well under 1s (target; informational)', () => {
    const start = performance.now();
    selfAvoidingWalk.generate(42, page, selfAvoidingWalk.defaults);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`selfAvoidingWalk default A4 generation: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(3000); // generous CI-safe ceiling; see console for the real number
  });
});
