/**
 * Seeded RNG + noise, behind a thin adapter over `canvas-sketch-util/random`.
 *
 * If `canvas-sketch-util` is ever swapped out, this is the one file that
 * changes. Generators must depend only on the `Rng` interface below and must
 * never call `Math.random()` directly — that is what makes them
 * deterministic and portable.
 */
import randomLib from 'canvas-sketch-util/random.js';

export interface FbmOptions {
  readonly octaves: number;
  readonly lacunarity?: number; // default 2
  readonly gain?: number; // default 0.5
  readonly frequency?: number; // default 1
  readonly amplitude?: number; // default 1
}

export interface Rng {
  readonly seed: number;
  /** Uniform float. Defaults to [0, 1). */
  float(min?: number, max?: number): number;
  /** Uniform integer, inclusive of both bounds. */
  int(min: number, max: number): number;
  /** Single-octave simplex noise. */
  noise2D(x: number, y: number, frequency?: number, amplitude?: number): number;
  /** Fractal (fbm) noise: sums octaves of simplex noise, normalised to ~[-1, 1]. */
  fractalNoise2D(x: number, y: number, opts: FbmOptions): number;
  /** Fisher-Yates shuffle. Does not mutate `items`. */
  shuffle<T>(items: T[]): T[];
}

/**
 * `canvas-sketch-util/random` exposes a mix of module-level functions and a
 * `.createRandom(seed)` factory. The factory is what gives us an isolated
 * instance: two `createRng` calls in the same tick must not share state or
 * advance each other's sequence.
 */
export function createRng(seed: number): Rng {
  // `createRandom` returns an object with the same API as the module,
  // scoped to its own seeded generator.
  const instance = randomLib.createRandom(seed);

  function noise2D(x: number, y: number, frequency = 1, amplitude = 1): number {
    return instance.noise2D(x * frequency, y * frequency) * amplitude;
  }

  function fractalNoise2D(x: number, y: number, opts: FbmOptions): number {
    const { octaves, lacunarity = 2, gain = 0.5 } = opts;
    let { frequency = 1, amplitude = 1 } = opts;
    let sum = 0;
    let maxAmplitude = 0;
    for (let o = 0; o < octaves; o++) {
      sum += instance.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    // Normalise by the maximum possible amplitude so the result stays in
    // roughly [-1, 1] regardless of octave count.
    return maxAmplitude > 0 ? sum / maxAmplitude : 0;
  }

  function shuffle<T>(items: T[]): T[] {
    const copy = items.slice();
    return instance.shuffle(copy) as T[];
  }

  return {
    seed,
    float: (min?: number, max?: number) => instance.range(min ?? 0, max ?? 1),
    int: (min: number, max: number) => Math.floor(instance.range(min, max + 1)),
    noise2D,
    fractalNoise2D,
    shuffle,
  };
}
