import { describe, expect, it } from 'vitest';
import { createRng } from '../random.ts';

describe('createRng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);

    const seqA = Array.from({ length: 50 }, () => a.float());
    const seqB = Array.from({ length: 50 }, () => b.float());
    expect(seqA).toEqual(seqB);

    const noiseA = Array.from({ length: 20 }, (_, i) => a.noise2D(i * 0.1, i * 0.2));
    const noiseB = Array.from({ length: 20 }, (_, i) => b.noise2D(i * 0.1, i * 0.2));
    expect(noiseA).toEqual(noiseB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.float());
    const seqB = Array.from({ length: 10 }, () => b.float());
    expect(seqA).not.toEqual(seqB);
  });

  it('gives two instances independent, non-interfering sequences', () => {
    // Interleave draws from two seeded instances in the same tick and
    // confirm each still matches a fresh, non-interleaved run of the same
    // seed -- i.e. neither instance mutates shared/global state.
    const a = createRng(7);
    const b = createRng(7);
    const interleaved: number[] = [];
    for (let i = 0; i < 10; i++) {
      interleaved.push(a.float());
      b.float(); // draw from b too, interleaved with a
    }

    const fresh = createRng(7);
    const freshSeq = Array.from({ length: 10 }, () => fresh.float());
    expect(interleaved).toEqual(freshSeq);
  });

  it('float(min, max) stays in range', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const v = rng.float(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it('int(min, max) is an integer inclusive of both bounds', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(0, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it('shuffle returns a permutation without mutating the input', () => {
    const rng = createRng(9);
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    const shuffled = rng.shuffle(input);
    expect(input).toEqual(copy); // not mutated
    expect(shuffled.slice().sort()).toEqual(copy.sort());
  });

  it('fractalNoise2D stays within roughly [-1, 1] and is deterministic', () => {
    const a = createRng(11);
    const b = createRng(11);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.53;
      const va = a.fractalNoise2D(x, y, { octaves: 4 });
      const vb = b.fractalNoise2D(x, y, { octaves: 4 });
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(-1.001);
      expect(va).toBeLessThanOrEqual(1.001);
    }
  });
});
