/**
 * Random-walk line generator: the framework's second `Generator<P>`,
 * added specifically to prove the mini-app registry (see
 * `generators/registry.ts`) works for more than one generator. Deliberately
 * simple -- see spec §5.5's flow-field write-up for the more elaborate
 * pattern this deliberately does *not* follow.
 *
 * Pure: `(seed, page, params) -> Layer[]`. No DOM, no canvas, no randomness
 * beyond the seeded RNG created from `seed` (see core/random.ts).
 */
import { createRng } from '../core/random.ts';
import { bounds, contains } from '../core/page.ts';
import { defaultsFromSchema } from '../core/types.ts';
import type { Generator, Layer, ParamSchema, Path, PageSpec, Point } from '../core/types.ts';

export interface RandomWalkParams {
  nWalkers: number;
  nSteps: number;
  stepSize: number;
  maxTurnDeg: number;
}

export const randomWalkSchema: ParamSchema<RandomWalkParams> = {
  nWalkers: { kind: 'int', label: 'Walkers', min: 5, max: 500, default: 60 },
  nSteps: { kind: 'int', label: 'Max steps', min: 10, max: 2000, default: 300 },
  stepSize: { kind: 'number', label: 'Step size', min: 0.2, max: 5.0, step: 0.1, unit: 'mm', default: 1.5 },
  maxTurnDeg: { kind: 'number', label: 'Max turn per step', min: 0, max: 180, step: 1, unit: 'deg', default: 25 },
};

/**
 * Each walker starts at a uniformly random point inside the page margin,
 * facing a random direction, then takes `nSteps` steps of `stepSize`,
 * turning by a random amount up to `maxTurnDeg` (in either direction) each
 * step. A walker that steps outside the margin stops there rather than
 * wrapping or reflecting -- simple and predictable beats clever here.
 */
function generate(seed: number, page: PageSpec, params: RandomWalkParams): Layer[] {
  const b = bounds(page);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  if (width <= 0 || height <= 0) {
    return [{ name: '1', paths: [], color: '#000000' }];
  }

  const rng = createRng(seed);
  const maxTurnRad = (params.maxTurnDeg * Math.PI) / 180;
  const paths: Path[] = [];

  for (let w = 0; w < params.nWalkers; w++) {
    const start: Point = [rng.float(b.minX, b.maxX), rng.float(b.minY, b.maxY)];
    let angle = rng.float(0, Math.PI * 2);
    let current: Point = start;
    const path: Point[] = [current];

    for (let step = 0; step < params.nSteps; step++) {
      angle += rng.float(-maxTurnRad, maxTurnRad);
      const next: Point = [current[0] + Math.cos(angle) * params.stepSize, current[1] + Math.sin(angle) * params.stepSize];
      if (!contains(b, next)) break;
      path.push(next);
      current = next;
    }

    if (path.length >= 2) paths.push(path);
  }

  return [{ name: '1', paths, color: '#000000' }];
}

export const randomWalk: Generator<RandomWalkParams> = {
  id: 'randomWalk',
  defaults: defaultsFromSchema(randomWalkSchema),
  schema: randomWalkSchema,
  generate,
};
