/**
 * Flow-field line generator.
 *
 * Pure: `(seed, page, params) -> Layer[]`. No DOM, no canvas, no randomness
 * beyond the seeded RNG created from `seed`. See spec §5.5 for the full
 * algorithm description this is a direct implementation of.
 *
 * Two decisions that must survive any future refactor of this file:
 *  - The direction field is precomputed once on a grid and sampled
 *    bilinearly during tracing (one vectorised noise pass, not one noise
 *    call per traced point). This is what keeps sliders feeling live.
 *  - Lines are traced sequentially, one to completion at a time, in
 *    shuffled seed order -- not advanced in lockstep. Lockstep tracing was
 *    tried and measured 25mm median line length vs 70mm for sequential;
 *    do not re-derive it.
 */
import { createRng } from '../core/random.ts';
import { bounds, contains } from '../core/page.ts';
import { defaultsFromSchema } from '../core/types.ts';
import type { Bounds, Generator, Layer, ParamSchema, Path, PageSpec, Point } from '../core/types.ts';

export interface FlowFieldParams {
  nLines: number;
  maxSteps: number;
  stepSize: number;
  noiseScale: number;
  turns: number;
  octaves: number;
  separation: number;
  minLength: number;
  fieldResolution: number;
}

export const flowFieldSchema: ParamSchema<FlowFieldParams> = {
  nLines: { kind: 'int', label: 'Lines (attempts)', min: 50, max: 4000, default: 400 },
  maxSteps: { kind: 'int', label: 'Max steps', min: 20, max: 2000, default: 600 },
  stepSize: { kind: 'number', label: 'Step size', min: 0.2, max: 5.0, step: 0.1, unit: 'mm', default: 1.0 },
  noiseScale: { kind: 'number', label: 'Noise scale', min: 0.0005, max: 0.05, step: 0.0005, default: 0.01 },
  turns: { kind: 'number', label: 'Turns', min: 0.25, max: 8.0, step: 0.05, default: 1.0 },
  octaves: { kind: 'int', label: 'Octaves', min: 1, max: 6, default: 3 },
  separation: { kind: 'number', label: 'Separation', min: 0.3, max: 12.0, step: 0.1, unit: 'mm', default: 2.0 },
  minLength: { kind: 'number', label: 'Min length', min: 0, max: 60, step: 0.5, unit: 'mm', default: 10.0 },
  fieldResolution: { kind: 'number', label: 'Field resolution', min: 0.5, max: 4.0, step: 0.1, unit: 'mm', default: 1.0 },
};

// ---------------------------------------------------------------------------
// Direction field: precomputed grid of unit (cos, sin) pairs, sampled
// bilinearly. Interpolating the vector components (not the raw angle) is
// what avoids the field blowing up where the angle wraps past PI.
// ---------------------------------------------------------------------------

interface DirectionField {
  sample(p: Point): { cos: number; sin: number };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function buildDirectionField(seed: number, b: Bounds, params: FlowFieldParams): DirectionField {
  const rng = createRng(seed);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const cols = Math.max(2, Math.ceil(width / params.fieldResolution) + 1);
  const rows = Math.max(2, Math.ceil(height / params.fieldResolution) + 1);

  const cosGrid = new Float64Array(cols * rows);
  const sinGrid = new Float64Array(cols * rows);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = b.minX + i * params.fieldResolution;
      const y = b.minY + j * params.fieldResolution;
      const n = rng.fractalNoise2D(x * params.noiseScale, y * params.noiseScale, { octaves: params.octaves });
      const angle = n * Math.PI * params.turns;
      const idx = j * cols + i;
      cosGrid[idx] = Math.cos(angle);
      sinGrid[idx] = Math.sin(angle);
    }
  }

  function sample(p: Point): { cos: number; sin: number } {
    const gx = (p[0] - b.minX) / params.fieldResolution;
    const gy = (p[1] - b.minY) / params.fieldResolution;
    const i0 = clamp(Math.floor(gx), 0, cols - 2);
    const j0 = clamp(Math.floor(gy), 0, rows - 2);
    const tx = clamp(gx - i0, 0, 1);
    const ty = clamp(gy - j0, 0, 1);
    const i1 = i0 + 1;
    const j1 = j0 + 1;
    const idx00 = j0 * cols + i0;
    const idx10 = j0 * cols + i1;
    const idx01 = j1 * cols + i0;
    const idx11 = j1 * cols + i1;

    const cosTop = cosGrid[idx00]! + (cosGrid[idx10]! - cosGrid[idx00]!) * tx;
    const cosBot = cosGrid[idx01]! + (cosGrid[idx11]! - cosGrid[idx01]!) * tx;
    const cosV = cosTop + (cosBot - cosTop) * ty;

    const sinTop = sinGrid[idx00]! + (sinGrid[idx10]! - sinGrid[idx00]!) * tx;
    const sinBot = sinGrid[idx01]! + (sinGrid[idx11]! - sinGrid[idx01]!) * tx;
    const sinV = sinTop + (sinBot - sinTop) * ty;

    const mag = Math.hypot(cosV, sinV) || 1;
    return { cos: cosV / mag, sin: sinV / mag };
  }

  return { sample };
}

// ---------------------------------------------------------------------------
// Occupancy grid: boolean cells at `separation` resolution.
// ---------------------------------------------------------------------------

interface OccupancyGrid {
  isOccupiedAt(p: Point): boolean;
  markAt(p: Point): void;
}

function createOccupancyGrid(b: Bounds, cellSize: number): OccupancyGrid {
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const cells = new Uint8Array(cols * rows);

  function indexFor(p: Point): number | null {
    const col = Math.floor((p[0] - b.minX) / cellSize);
    const row = Math.floor((p[1] - b.minY) / cellSize);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
    return row * cols + col;
  }

  return {
    isOccupiedAt(p) {
      const idx = indexFor(p);
      return idx === null ? false : cells[idx] === 1;
    },
    markAt(p) {
      const idx = indexFor(p);
      if (idx !== null) cells[idx] = 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Seed points: a jittered grid sized to approximate `nLines` attempts,
// shuffled so processing order isn't a raster scan (uniform random
// sampling clumps, and clumped seeds are wasted).
// ---------------------------------------------------------------------------

function generateSeedPoints(rng: ReturnType<typeof createRng>, b: Bounds, nLines: number): Point[] {
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const aspect = width / height;
  const cols = Math.max(1, Math.round(Math.sqrt(nLines * aspect)));
  const rows = Math.max(1, Math.round(nLines / cols));
  const cellW = width / cols;
  const cellH = height / rows;

  const points: Point[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = b.minX + (i + rng.float(0.1, 0.9)) * cellW;
      const y = b.minY + (j + rng.float(0.1, 0.9)) * cellH;
      points.push([x, y]);
    }
  }
  return rng.shuffle(points);
}

// ---------------------------------------------------------------------------
// Tracing: midpoint (RK2) integration, one direction at a time. `sign` is
// +1 for the forward trace and -1 for the backward trace.
// ---------------------------------------------------------------------------

function traceDirection(
  seedPoint: Point,
  field: DirectionField,
  b: Bounds,
  occupancy: OccupancyGrid,
  stepSize: number,
  maxSteps: number,
  sign: 1 | -1,
): Point[] {
  const points: Point[] = [seedPoint];
  let current = seedPoint;

  for (let step = 0; step < maxSteps; step++) {
    const k1 = field.sample(current);
    const mid: Point = [current[0] + sign * k1.cos * stepSize * 0.5, current[1] + sign * k1.sin * stepSize * 0.5];
    const k2 = field.sample(mid);
    const next: Point = [current[0] + sign * k2.cos * stepSize, current[1] + sign * k2.sin * stepSize];

    if (!contains(b, next)) break;
    if (occupancy.isOccupiedAt(next)) break;

    points.push(next);
    current = next;
  }

  return points;
}

function pathLength(path: Path): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function generate(seed: number, page: PageSpec, params: FlowFieldParams): Layer[] {
  const b = bounds(page);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  if (width <= 0 || height <= 0) {
    return [{ name: '1', paths: [], color: '#000000' }];
  }

  // The direction field and the seed layout both derive from the same seed
  // but must not share RNG state (each call gets its own isolated
  // instance), so field construction and seed generation each get their own
  // deterministic sub-seed derived from the input seed.
  const field = buildDirectionField(seed, b, params);
  const seedRng = createRng(seed + 1);
  const occupancy = createOccupancyGrid(b, params.separation);
  const seeds = generateSeedPoints(seedRng, b, params.nLines);

  const paths: Path[] = [];

  for (const seedPoint of seeds) {
    if (occupancy.isOccupiedAt(seedPoint)) continue;

    const forward = traceDirection(seedPoint, field, b, occupancy, params.stepSize, params.maxSteps, 1);
    const backward = traceDirection(seedPoint, field, b, occupancy, params.stepSize, params.maxSteps, -1);

    // Stitch the reversed backward run onto the front of the forward run,
    // sharing the seed point exactly once.
    const stitched: Point[] = [...backward.slice(1).reverse(), seedPoint, ...forward.slice(1)];

    if (stitched.length < 2) continue;
    if (pathLength(stitched) < params.minLength) continue;

    paths.push(stitched);
    for (const p of stitched) occupancy.markAt(p);
  }

  return [{ name: '1', paths, color: '#000000' }];
}

export const flowField: Generator<FlowFieldParams> = {
  id: 'flowField',
  defaults: defaultsFromSchema(flowFieldSchema),
  schema: flowFieldSchema,
  generate,
};
