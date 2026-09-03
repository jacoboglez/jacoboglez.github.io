/**
 * Curl-flow line generator.
 *
 * Same underlying idea as the level-set approach this replaces (see git
 * history / `streamContours` if you're looking for it): the noise is a
 * stream function psi(x, y), and velocity is its perpendicular gradient
 *
 *   vx =  d(psi)/dy
 *   vy = -d(psi)/dx
 *
 * which is divergence-free by construction, so its flow lines never cross
 * except at psi's critical points (|v| = 0). Lines are obtained by seeding
 * equispaced points along one or more of the page's edges and letting each
 * one evolve under the velocity field, integrated with RK4. (This is a
 * close cousin of literally extracting psi's level sets: d(psi)/dt along a
 * trajectory is v . grad(psi) = psi_y*psi_x - psi_x*psi_y = 0, so a
 * perfectly-integrated
 * line never leaves its starting level set. RK4 over a bilinearly
 * interpolated field is an excellent approximation of that, not an exact
 * one -- which is the tradeoff for getting an actual left-to-right "flow"
 * reading instead of a topographic-map reading.)
 *
 * A pure noise field has no preferred direction, so most of its level sets
 * are small loops or dead-end at a critical point near wherever they
 * started -- seeded from a single edge alone, lines mostly stay near that
 * margin instead of crossing the page. The fix is a directional bias: add the
 * stream function of a rightward "wind" (U * y, whose gradient is the
 * constant vector (U, 0)) on top of the noise before differencing. Since
 * the sum of two divergence-free fields is still divergence-free, this
 * costs nothing mathematically -- it's still one scalar field, differenced
 * once, never normalized. With the wind dominant, vx stays positive almost
 * everywhere, so lines drift rightward with the noise as a wiggle instead
 * of the whole show; only where the local noise gradient is unusually
 * strong does it locally overpower the wind and spin up a small eddy. The
 * wind's own direction also wanders slowly across the page (a second,
 * much-lower-frequency noise field biases its angle a little off dead
 * right) so the large-scale drift itself gently curves instead of pointing
 * the same way everywhere -- more gust than fan.
 *
 * Seeding is per-edge: any combination of the left/right/top/bottom margins
 * can be turned on independently, each contributing its own `nLines`
 * equispaced seeds. A wind-dominated field makes rightward flow the norm,
 * so a seed on the right edge (or the "wrong" side of top/bottom relative
 * to the wind) would mostly just step straight back out of the page on its
 * very first stride. Rather than special-casing that, each seed's trace is
 * run with the field's velocity flipped (multiplied by -1) whenever the
 * locally sampled velocity points outward through that edge's inward
 * normal -- i.e. whichever sign makes the very first step head into the
 * page is the sign used for the whole trace. Flipping the sign of a
 * divergence-free field keeps it divergence-free (differencing a scalar
 * times -1 is still linear), and it just re-traces the same streamline in
 * the opposite direction, so this is a direction choice, not a different
 * flow.
 *
 * Three decisions that must survive any future refactor of this file:
 *  - Velocity is precomputed once on a grid (central differences of a
 *    once-sampled psi grid) and sampled bilinearly during tracing, exactly
 *    like `flowField.ts`'s direction field -- one noise pass, not one
 *    noise call per RK4 stage per step.
 *  - The sampled velocity is never renormalized to unit length. That is
 *    the entire fix for the classic "Perlin-noise streamline" convergence
 *    artifact: normalizing throws away the divergence-free structure and
 *    turns the field into an angle field again, which is what produces
 *    attractors. Un-normalized, RK4 steps are made arc-length-adaptive
 *    instead (dt = stepSize / |v|), so line segments stay roughly
 *    `stepSize` mm long even where the field is fast or slow.
 *  - The wind is added as a stream-function term, not as a separate
 *    velocity added after the fact, and `windStrength` is calibrated
 *    relative to the noise field's own (measured, not guessed) mean
 *    gradient -- so "how dominant is the wind" reads the same regardless
 *    of `noiseScale`/`octaves`, instead of needing re-tuning every time
 *    those change.
 */
import { createRng } from '../core/random.ts';
import { bounds, contains, clipToBounds } from '../core/page.ts';
import { defaultsFromSchema } from '../core/types.ts';
import type { Bounds, Generator, Layer, ParamSchema, Path, PageSpec, Point } from '../core/types.ts';

export interface CurlFlowParams {
  nLines: number;
  seedLeft: boolean;
  seedRight: boolean;
  seedTop: boolean;
  seedBottom: boolean;
  stepSize: number;
  maxSteps: number;
  noiseScale: number;
  octaves: number;
  fieldResolution: number;
  minSpeedFraction: number;
  minLength: number;
  windStrength: number;
  windWobbleDeg: number;
  windScale: number;
}

export const curlFlowSchema: ParamSchema<CurlFlowParams> = {
  nLines: { kind: 'int', label: 'Lines per edge', min: 5, max: 400, default: 120 },
  seedLeft: { kind: 'boolean', label: 'Seed left edge', default: true },
  seedRight: { kind: 'boolean', label: 'Seed right edge', default: false },
  seedTop: { kind: 'boolean', label: 'Seed top edge', default: false },
  seedBottom: { kind: 'boolean', label: 'Seed bottom edge', default: false },
  stepSize: { kind: 'number', label: 'Step size', min: 0.1, max: 5.0, step: 0.1, unit: 'mm', default: 1.0 },
  maxSteps: { kind: 'int', label: 'Max steps', min: 50, max: 5000, default: 800 },
  noiseScale: { kind: 'number', label: 'Noise scale', min: 0.0005, max: 0.05, step: 0.0005, default: 0.012 },
  octaves: { kind: 'int', label: 'Octaves', min: 1, max: 6, default: 3 },
  fieldResolution: {
    kind: 'number',
    label: 'Field resolution',
    min: 0.5,
    max: 4.0,
    step: 0.1,
    unit: 'mm',
    default: 1.0,
  },
  minSpeedFraction: {
    kind: 'number',
    label: 'Min speed (of mean)',
    min: 0.001,
    max: 0.5,
    step: 0.001,
    default: 0.05,
  },
  minLength: { kind: 'number', label: 'Min length', min: 0, max: 60, step: 0.5, unit: 'mm', default: 4.0 },
  windStrength: {
    kind: 'number',
    label: 'Wind strength (x noise)',
    min: 0,
    max: 20,
    step: 0.1,
    default: 1.5,
  },
  windWobbleDeg: {
    kind: 'number',
    label: 'Wind wobble',
    min: 0,
    max: 90,
    step: 1,
    unit: 'deg',
    default: 30,
  },
  windScale: {
    kind: 'number',
    label: 'Wind wander scale',
    min: 0.0002,
    max: 0.02,
    step: 0.0001,
    default: 0.005,
  },
};

// ---------------------------------------------------------------------------
// Velocity field: a stream function (noise + wind bias) sampled once on a
// grid, then differenced once into (vx, vy) on that same grid. Sampling
// during tracing is bilinear interpolation of (vx, vy) directly -- never of
// an angle, and never renormalized. The grid is *not* clamped to the page
// bounds (unlike `streamContours`'s grid) because there's no contour
// endpoint that needs to land exactly on the margin here; instead tracing
// stops as soon as a step leaves `b`, and `clipToBounds` trims that last
// segment to the exact crossing point afterward.
// ---------------------------------------------------------------------------

interface VelocityField {
  sample(p: Point): { vx: number; vy: number };
  readonly meanSpeed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Central differences of a scalar field sampled on a uniform `cols` x
 * `rows` grid (spacing `res`), one-sided at the edges. Shared by the
 * noise-only calibration pass and the final (noise + wind) pass below --
 * same math either way, so it lives in one place.
 */
function differencePsiGrid(
  psi: Float64Array,
  cols: number,
  rows: number,
  res: number,
): { vx: Float64Array; vy: Float64Array; meanSpeed: number } {
  const vx = new Float64Array(cols * rows);
  const vy = new Float64Array(cols * rows);
  let speedSum = 0;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const here = j * cols + i;

      let dPsiDy: number;
      if (j === 0) {
        dPsiDy = (psi[cols + i]! - psi[i]!) / res;
      } else if (j === rows - 1) {
        dPsiDy = (psi[here]! - psi[here - cols]!) / res;
      } else {
        dPsiDy = (psi[here + cols]! - psi[here - cols]!) / (2 * res);
      }

      let dPsiDx: number;
      if (i === 0) {
        dPsiDx = (psi[here + 1]! - psi[here]!) / res;
      } else if (i === cols - 1) {
        dPsiDx = (psi[here]! - psi[here - 1]!) / res;
      } else {
        dPsiDx = (psi[here + 1]! - psi[here - 1]!) / (2 * res);
      }

      vx[here] = dPsiDy;
      vy[here] = -dPsiDx;
      speedSum += Math.hypot(dPsiDy, dPsiDx);
    }
  }

  return { vx, vy, meanSpeed: speedSum / (cols * rows) };
}

function buildVelocityField(seed: number, b: Bounds, params: CurlFlowParams): VelocityField {
  const rng = createRng(seed);
  const windRng = createRng(seed + 1); // independent stream, never correlated with the noise's own samples
  const res = params.fieldResolution;
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const cols = Math.max(2, Math.ceil(width / res) + 1);
  const rows = Math.max(2, Math.ceil(height / res) + 1);

  const psiNoise = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = b.minX + i * res;
      const y = b.minY + j * res;
      psiNoise[j * cols + i] = rng.fractalNoise2D(x * params.noiseScale, y * params.noiseScale, {
        octaves: params.octaves,
      });
    }
  }

  // Calibrate the wind's speed against the noise field's own measured mean
  // gradient (a quick differencing pass on the noise alone) rather than a
  // guessed physical constant, so `windStrength` means "N times as strong
  // as the noise" regardless of `noiseScale`/`octaves`.
  const windSpeed = params.windStrength * differencePsiGrid(psiNoise, cols, rows, res).meanSpeed;
  const windWobbleRad = (params.windWobbleDeg * Math.PI) / 180;

  // U*(y*cos(theta) - x*sin(theta)) is the stream function of a uniform
  // flow of speed U at angle theta (check: d/dy gives U*cos(theta), and
  // -d/dx gives U*sin(theta)). Substituting a slowly position-varying
  // theta(x, y) here isn't a mathematically exact "locally uniform wind at
  // that angle" -- differentiating a varying theta sheds extra terms -- but
  // those terms scale with theta's own spatial gradient, which a
  // low-frequency `windScale` keeps small, and whatever's left just reads
  // as more of the large-scale curve this is meant to add. Combining into
  // one psi grid and differencing *that* (rather than building a wind
  // velocity separately and adding it after) is what keeps the result
  // exactly divergence-free with zero extra care: differencing a sum is
  // the sum of the differences.
  const psi = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const here = j * cols + i;
      const x = b.minX + i * res;
      const y = b.minY + j * res;
      const theta = windWobbleRad * windRng.noise2D(x * params.windScale, y * params.windScale);
      const psiBias = windSpeed * (y * Math.cos(theta) - x * Math.sin(theta));
      psi[here] = psiNoise[here]! + psiBias;
    }
  }

  const { vx, vy, meanSpeed } = differencePsiGrid(psi, cols, rows, res);

  function sample(p: Point): { vx: number; vy: number } {
    const gx = (p[0] - b.minX) / res;
    const gy = (p[1] - b.minY) / res;
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

    const vxTop = vx[idx00]! + (vx[idx10]! - vx[idx00]!) * tx;
    const vxBot = vx[idx01]! + (vx[idx11]! - vx[idx01]!) * tx;
    const vyTop = vy[idx00]! + (vy[idx10]! - vy[idx00]!) * tx;
    const vyBot = vy[idx01]! + (vy[idx11]! - vy[idx01]!) * tx;

    return {
      vx: vxTop + (vxBot - vxTop) * ty,
      vy: vyTop + (vyBot - vyTop) * ty,
    };
  }

  return { sample, meanSpeed };
}

// ---------------------------------------------------------------------------
// Tracing: RK4 with an arc-length-adaptive step (dt = stepSize / |v|), so a
// step covers roughly `stepSize` mm regardless of local speed. A line ends
// when its speed drops below `minSpeedFraction * meanSpeed` (it has
// wandered into a near-critical point and further steps would be
// meaninglessly small or erratic), when it leaves the page (one point past
// the boundary is kept so `clipToBounds` can trim to the exact crossing),
// or at `maxSteps` (a safety cap, not expected to bind in practice).
// ---------------------------------------------------------------------------

function traceLine(
  seedPoint: Point,
  field: VelocityField,
  b: Bounds,
  params: CurlFlowParams,
  minSpeedAbs: number,
  sign: 1 | -1,
): Point[] {
  const points: Point[] = [seedPoint];
  let current = seedPoint;

  // Closed contours (loops entirely inside the page, e.g. a small eddy
  // where local noise locally overpowers the wind) never trip the speed or
  // bounds checks below -- left alone, tracing would just circle the same
  // loop until `maxSteps`, retracing it many times over. `seenCells` is a
  // spatial hash of cells the line has already visited, added with a delay
  // of `LOOP_GRACE_STEPS` steps so the curve's own immediately-preceding
  // stretch (which necessarily sits in a neighboring cell) never falsely
  // matches. Once a step lands back in an aged-in cell, the loop has
  // closed and tracing stops -- this is the same "stop near an
  // already-drawn point" idea Jobard-Lefebvre spacing uses between
  // *different* lines, applied here to a single line's own history
  // instead.
  const cellSize = Math.max(params.stepSize, 1e-6);
  const cellKey = (p: Point) => `${Math.round(p[0] / cellSize)}:${Math.round(p[1] / cellSize)}`;
  const LOOP_GRACE_STEPS = 8;
  const seenCells = new Set<string>();

  // `sign` flips the whole field (see the header comment): sampling once
  // and multiplying by it here is exactly equivalent to negating psi itself
  // before differencing, so the divergence-free guarantee is untouched --
  // this is a choice of which way to walk the same streamline.
  const sample = (p: Point): { vx: number; vy: number } => {
    const v = field.sample(p);
    return { vx: v.vx * sign, vy: v.vy * sign };
  };

  for (let step = 0; step < params.maxSteps; step++) {
    const k1 = sample(current);
    const speed1 = Math.hypot(k1.vx, k1.vy);
    if (speed1 < minSpeedAbs) break;
    const dt = params.stepSize / speed1;

    const p2: Point = [current[0] + (k1.vx * dt) / 2, current[1] + (k1.vy * dt) / 2];
    const k2 = sample(p2);
    const p3: Point = [current[0] + (k2.vx * dt) / 2, current[1] + (k2.vy * dt) / 2];
    const k3 = sample(p3);
    const p4: Point = [current[0] + k3.vx * dt, current[1] + k3.vy * dt];
    const k4 = sample(p4);

    const next: Point = [
      current[0] + (dt / 6) * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx),
      current[1] + (dt / 6) * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy),
    ];

    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) break;

    if (step >= LOOP_GRACE_STEPS && seenCells.has(cellKey(next))) {
      points.push(next); // close the loop visually, then stop
      break;
    }

    points.push(next);
    current = next;

    const aged = points[points.length - 1 - LOOP_GRACE_STEPS];
    if (aged) seenCells.add(cellKey(aged));

    if (!contains(b, next)) break; // one step past the edge; clipToBounds trims it
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
// Edge seeding: four independently toggleable edges, each contributing its
// own `nLines` equispaced seed points. `b.minY` is the page's visual top and
// `b.maxY` its bottom (page.ts's SVG y-down convention), so "top" seeds at
// minY and "bottom" at maxY.
// ---------------------------------------------------------------------------

type Edge = 'left' | 'right' | 'top' | 'bottom';

const EDGE_ORDER: readonly Edge[] = ['left', 'right', 'top', 'bottom'];

const EDGE_ENABLED_KEY: Record<Edge, keyof CurlFlowParams> = {
  left: 'seedLeft',
  right: 'seedRight',
  top: 'seedTop',
  bottom: 'seedBottom',
};

// Outward-facing coordinate and unit inward normal for each edge, used to
// place seeds on the margin and to decide which way a seed should initially
// head (see `traceLine`'s `sign`).
const EDGE_INWARD_NORMAL: Record<Edge, Point> = {
  left: [1, 0],
  right: [-1, 0],
  top: [0, 1],
  bottom: [0, -1],
};

function edgeSeedPoint(edge: Edge, b: Bounds, width: number, height: number, i: number, n: number): Point {
  const t = (i + 0.5) / n;
  switch (edge) {
    case 'left':
      return [b.minX, b.minY + t * height];
    case 'right':
      return [b.maxX, b.minY + t * height];
    case 'top':
      return [b.minX + t * width, b.minY];
    case 'bottom':
      return [b.minX + t * width, b.maxY];
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function generate(seed: number, page: PageSpec, params: CurlFlowParams): Layer[] {
  const b = bounds(page);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  if (width <= 0 || height <= 0) {
    return [{ name: '1', paths: [], color: '#000000' }];
  }

  const edges = EDGE_ORDER.filter((edge) => params[EDGE_ENABLED_KEY[edge]] as boolean);
  if (edges.length === 0) {
    return [{ name: '1', paths: [], color: '#000000' }];
  }

  const field = buildVelocityField(seed, b, params);
  const minSpeedAbs = Math.max(field.meanSpeed * params.minSpeedFraction, 1e-12);
  const nLines = Math.max(1, Math.floor(params.nLines));

  const rawPaths: Path[] = [];
  for (const edge of edges) {
    const normal = EDGE_INWARD_NORMAL[edge];
    for (let i = 0; i < nLines; i++) {
      const seedPoint = edgeSeedPoint(edge, b, width, height, i, nLines);
      // Pick whichever sign makes the very first step head into the page
      // rather than immediately back out of it (see the header comment).
      const v0 = field.sample(seedPoint);
      const inward = v0.vx * normal[0] + v0.vy * normal[1];
      const sign: 1 | -1 = inward < 0 ? -1 : 1;
      const line = traceLine(seedPoint, field, b, params, minSpeedAbs, sign);
      if (line.length >= 2) rawPaths.push(line);
    }
  }

  // `clipToBounds`'s boundary-crossing interpolation is a 40-iteration
  // binary search, not an exact solve, so a trimmed endpoint can land a
  // few ULPs outside `b`. Clamp explicitly rather than loosening every
  // caller's notion of "in bounds" to match one generator's float noise.
  const clampPoint = (p: Point): Point => [clamp(p[0], b.minX, b.maxX), clamp(p[1], b.minY, b.maxY)];
  const paths = clipToBounds(rawPaths, b)
    .filter((path) => pathLength(path) >= params.minLength)
    .map((path) => path.map(clampPoint));

  return [{ name: '1', paths, color: '#000000' }];
}

export const curlFlow: Generator<CurlFlowParams> = {
  id: 'curlFlow',
  defaults: defaultsFromSchema(curlFlowSchema),
  schema: curlFlowSchema,
  generate,
};
