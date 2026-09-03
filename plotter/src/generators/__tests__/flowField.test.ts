import { describe, expect, it } from 'vitest';
import { flowField } from '../flowField.ts';
import { bounds, contains, PAGES } from '../../core/page.ts';
import type { PageSpec } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

describe('flowField generator', () => {
  it('this module runs with no DOM/canvas globals available (Node environment)', () => {
    // This test doubles as the architecture guard from spec §8: it only
    // passes because vitest.config runs generators under `environment:
    // 'node'`, with no jsdom shim installed. If flowField.ts (or anything
    // it imports) ever reached for `document`/`window`/canvas, this
    // assertion -- and the whole test file -- would fail to even load.
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('is deterministic: same seed + params produce deeply equal output', () => {
    const a = flowField.generate(42, page, flowField.defaults);
    const b = flowField.generate(42, page, flowField.defaults);
    expect(a).toEqual(b);
  });

  it('produces different output for a different seed', () => {
    const a = flowField.generate(1, page, flowField.defaults);
    const b = flowField.generate(2, page, flowField.defaults);
    expect(a).not.toEqual(b);
  });

  it('keeps every point within the page margins', () => {
    const layers = flowField.generate(7, page, flowField.defaults);
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
    const layers = flowField.generate(7, page, flowField.defaults);
    for (const layer of layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('never emits a path shorter than minLength', () => {
    const params = { ...flowField.defaults, minLength: 20 };
    const layers = flowField.generate(7, page, params);
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
    const layers = flowField.generate(42, page, flowField.defaults);
    const totalPaths = layers.reduce((sum, l) => sum + l.paths.length, 0);
    expect(totalPaths).toBeGreaterThan(0);
  });

  it('respects the occupancy grid: denser separation yields more paths than sparser separation', () => {
    const dense = flowField.generate(42, page, { ...flowField.defaults, separation: 1.0 });
    const sparse = flowField.generate(42, page, { ...flowField.defaults, separation: 6.0 });
    const count = (layers: typeof dense) => layers.reduce((s, l) => s + l.paths.length, 0);
    expect(count(dense)).toBeGreaterThan(count(sparse));
  });

  it('generates the default A4 sketch in well under 200ms (target; informational)', () => {
    const start = performance.now();
    flowField.generate(42, page, flowField.defaults);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`flowField default A4 generation: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000); // generous CI-safe ceiling; see console for the real number
  });
});
