/**
 * Self-avoiding walk: one or more seeded walks that share a start point and
 * steer away from the page margin and from every walk's own (and, when
 * there is more than one, every *other* walk's) trail.
 *
 * Three interchangeable heading models decide which way a walk turns each
 * step (`headingMode`), all sharing the same border/self-avoidance
 * machinery below:
 *
 *  - 'persistent': the walk's heading integrates a small random turn each
 *    step (heading[n+1] = heading[n] + U(-turnMagnitudeDeg, turnMagnitudeDeg)),
 *    so it's a genuine persistent random walk -- smooth, meandering curves
 *    rather than a fresh random direction every step. `turnMagnitudeDeg` is
 *    the whole character of the piece: a few degrees reads as a gentle,
 *    almost-straight stroke; much past ~20-30 deg reads as a tight
 *    scribble. The "good" zone is narrow, which is exactly why it's
 *    exposed as its own parameter rather than folded into a preset.
 *  - 'noise': heading is a smooth function of the walk's own arc length --
 *    `baseAngle + noiseAmplitudeDeg * simplexNoise(arcLength / noiseScale)`
 *    -- so curvature is correlated at the scale `noiseScale` (mm per
 *    wiggle) instead of accumulating step by step. Because the function is
 *    of *position along the curve*, not history, a one-off detour around
 *    an obstacle never compounds into a different long-run shape the way
 *    a persistent-mode nudge would.
 *  - 'levy': identical to 'persistent' between jumps, but each "free" step
 *    has a `jumpChance` probability of instead freezing the heading for a
 *    run of consecutive steps (length drawn from a power-law distribution,
 *    capped at `jumpMaxSteps`) -- so short wandering bursts are punctuated
 *    by occasional long straight dashes, which read as intentional
 *    structure rather than noise.
 *
 * `nWalks` starts more than one walk from the *same* random point (each
 * with its own random initial heading), all avoiding each other as well as
 * themselves -- a "starburst" of tentacles fanning from one hub. Getting
 * this right needs one extra idea: a disk of radius `2 * avoidRadius`
 * around the shared hub is exempt from *cross-walk* avoidance, so a new
 * walk can always launch outward through ground already crowded by its
 * siblings (without it, two or three curly walks reliably encircle the
 * hub completely within a couple of avoidRadius, and every walk after
 * that dead-ends on step one -- verified empirically while building this).
 * That exemption only ever applies to *other* walks' points -- each walk
 * still avoids its own entire trail everywhere, hub included, because a
 * heading model that can loop back through a permanently "free" patch of
 * ground would otherwise cycle through it forever and never terminate.
 *
 * See `randomWalk.ts` for the deliberately simpler multi-walker sibling
 * this replaces conceptually (many walkers, no mutual avoidance, dropped
 * the instant any one steps out of bounds).
 */
import { createRng } from '../core/random.ts';
import { bounds, contains } from '../core/page.ts';
import { defaultsFromSchema } from '../core/types.ts';
import type { Bounds, Generator, Layer, ParamSchema, Path, PageSpec, Point } from '../core/types.ts';
import type { Rng } from '../core/random.ts';

export interface SelfAvoidingWalkParams {
  headingMode: 'persistent' | 'noise' | 'levy';
  stepSize: number;
  avoidRadius: number;
  turnMagnitudeDeg: number;
  noiseAmplitudeDeg: number;
  noiseScale: number;
  jumpChance: number;
  jumpMaxSteps: number;
  maxSteps: number;
  nWalks: number;
}

export const selfAvoidingWalkSchema: ParamSchema<SelfAvoidingWalkParams> = {
  headingMode: {
    kind: 'select',
    label: 'Heading model',
    options: ['persistent', 'noise', 'levy'],
    default: 'persistent',
  },
  stepSize: { kind: 'number', label: 'Step size', min: 0.3, max: 6.0, step: 0.1, unit: 'mm', default: 2.0 },
  avoidRadius: {
    kind: 'number',
    label: 'Self-avoid radius',
    min: 0.5,
    max: 20.0,
    step: 0.1,
    unit: 'mm',
    default: 3.5,
  },
  turnMagnitudeDeg: {
    kind: 'number',
    label: 'Turn per step (persistent/levy)',
    min: 0.5,
    max: 60,
    step: 0.5,
    unit: 'deg',
    default: 14,
  },
  noiseAmplitudeDeg: {
    kind: 'number',
    label: 'Heading swing (noise)',
    min: 10,
    max: 180,
    step: 1,
    unit: 'deg',
    default: 130,
  },
  noiseScale: {
    kind: 'number',
    label: 'Meander wavelength (noise)',
    min: 5,
    max: 150,
    step: 1,
    unit: 'mm',
    default: 30,
  },
  jumpChance: {
    kind: 'number',
    label: 'Jump chance per step (levy)',
    min: 0,
    max: 0.3,
    step: 0.005,
    default: 0.05,
  },
  jumpMaxSteps: { kind: 'int', label: 'Max jump length, steps (levy)', min: 2, max: 100, default: 35 },
  maxSteps: { kind: 'int', label: 'Max steps per walk (safety cap)', min: 50, max: 20000, default: 4000 },
  nWalks: { kind: 'int', label: 'Walks from one point', min: 1, max: 8, default: 1 },
};

// Random attempts tried per step before falling back to an exhaustive
// sweep. Most steps succeed here, which is what keeps 'persistent' and
// 'levy' looking like a random walk rather than a deterministic tracer.
const RANDOM_ATTEMPTS = 24;
// Angular resolution of every fallback sweep (the step-0 full-circle
// search, the noise-mode reactive search, and the persistent/levy escape
// search). Fine enough to find a legal sliver of a turn near a tight
// corner, coarse enough to stay cheap even swept across a full circle.
const SWEEP_STEP_RAD = (1.5 * Math.PI) / 180;
// Exponent of the power-law run-length draw for 'levy' mode. ~2-2.5 is the
// standard range for a Levy-walk-style heavy tail: mostly short runs, with
// a long tail of much longer ones (see `sampleLevyRunLength`).
const LEVY_ALPHA = 2.5;
// How many fresh attempts to try per walk (a fresh random start point for
// a lone walk, or a fresh random heading from the shared hub for one slot
// of a multi-walk starburst) before settling for the longest one found.
// Guards against an unlucky attempt (e.g. a start point right in a
// corner) producing a near-blank result when a better one was one retry
// away.
const START_ATTEMPTS = 8;
// Multiple of avoidRadius around a shared multi-walk hub within which
// *other* walks' points are never recorded as obstacles -- see the module
// doc comment for why this is necessary.
const HUB_RADIUS_FACTOR = 2;

/** Uniform spatial hash over trail points, cell size = `avoidRadius`. */
type CollisionGrid = Map<string, Point[]>;

function cellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function insertPoint(grid: CollisionGrid, cellSize: number, p: Point): void {
  const key = cellKey(p[0], p[1], cellSize);
  const bucket = grid.get(key);
  if (bucket) bucket.push(p);
  else grid.set(key, [p]);
}

/** True if `p` is at least `minDist` from every point currently in the grid. */
function isClearOfTrail(grid: CollisionGrid, cellSize: number, p: Point, minDist: number): boolean {
  const cx = Math.floor(p[0] / cellSize);
  const cy = Math.floor(p[1] / cellSize);
  const minDistSq = minDist * minDist;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx}:${cy + dy}`);
      if (!bucket) continue;
      for (const q of bucket) {
        const ddx = p[0] - q[0];
        const ddy = p[1] - q[1];
        if (ddx * ddx + ddy * ddy < minDistSq) return false;
      }
    }
  }
  return true;
}

function cloneGrid(grid: CollisionGrid): CollisionGrid {
  const copy: CollisionGrid = new Map();
  for (const [key, points] of grid) copy.set(key, points.slice());
  return copy;
}

/**
 * Inverse-CDF sample from a power-law distribution with minimum value 1,
 * capped at `maxSteps`: mostly short runs, occasionally a much longer one.
 * This is what turns 'levy' mode's occasional straight dash into a dash
 * rather than a barely-noticeable two-step wiggle.
 */
function sampleLevyRunLength(rng: Rng, maxSteps: number): number {
  const u = rng.float(1e-6, 1);
  const raw = Math.pow(u, -1 / (LEVY_ALPHA - 1));
  return Math.min(maxSteps, Math.max(1, Math.round(raw)));
}

/**
 * One walk: starts at `start` facing `initialAngle`, and takes up to
 * `maxSteps` steps of `stepSize`, each verified to stay inside the margin
 * and `avoidRadius` clear of both its own aged trail and `foreignGrid`
 * (other walks' already-committed points, empty for a lone walk). Stops
 * the moment no legal move exists -- boxed in by the border, by itself, or
 * by a sibling walk.
 */
function attemptWalk(
  rng: Rng,
  b: Bounds,
  params: SelfAvoidingWalkParams,
  skipRecent: number,
  foreignGrid: CollisionGrid,
  start: Point,
  initialAngle: number,
  walkIndex: number,
): Point[] {
  const { stepSize, avoidRadius, headingMode } = params;
  const turnMagRad = (params.turnMagnitudeDeg * Math.PI) / 180;
  const noiseAmplitudeRad = (params.noiseAmplitudeDeg * Math.PI) / 180;
  const baseAngle = initialAngle;
  // Shifts each walk's slice of noise-space so that sibling walks (and
  // walks from different attempts) don't all trace the same curve.
  const noiseYOffset = walkIndex * 1000 + 7;

  let angle = initialAngle;
  let current: Point = start;
  const path: Point[] = [current];
  let arcLength = 0;
  let jumpStepsRemaining = 0;

  // This walk's OWN aged trail. Unlike `foreignGrid` (which exempts the
  // shared hub so a new walk can launch through ground crowded by
  // siblings -- see the module doc comment), this one is never
  // hub-exempt: a walk must keep avoiding its *own* past self everywhere,
  // or a heading model that loops back near its own start could cycle
  // through a permanently "free" patch forever and never terminate.
  const ownGrid: CollisionGrid = new Map();

  function tryCandidate(a: number): Point | null {
    const cand: Point = [current[0] + Math.cos(a) * stepSize, current[1] + Math.sin(a) * stepSize];
    if (!contains(b, cand)) return null;
    if (!isClearOfTrail(ownGrid, avoidRadius, cand, avoidRadius)) return null;
    if (!isClearOfTrail(foreignGrid, avoidRadius, cand, avoidRadius)) return null;
    return cand;
  }

  /**
   * Step 0 has no prior heading to stay near, so it searches the *entire*
   * circle for any opening rather than a narrow cone around one guess --
   * critical once a shared hub already has other walks' trails nearby, or
   * a first step half of the compass could be closed off.
   */
  function proposeInitialStep(): Point | null {
    const offset = rng.float(0, Math.PI * 2);
    for (let delta = 0; delta < Math.PI * 2; delta += SWEEP_STEP_RAD) {
      const cand = tryCandidate(offset + delta);
      if (cand) return cand;
    }
    return null;
  }

  function proposeNoiseStep(): Point | null {
    const noiseHeading =
      baseAngle + rng.noise2D(arcLength, noiseYOffset, 1 / params.noiseScale) * noiseAmplitudeRad;
    let cand = tryCandidate(noiseHeading);
    if (cand) return cand;
    // Reactive fallback: the noise curve wants to walk into an obstacle,
    // so search outward from its suggested heading for the nearest legal
    // deviation. Purely local -- it doesn't feed back into future noise
    // headings, which stay a function of arc length, not history.
    for (let delta = SWEEP_STEP_RAD; delta <= Math.PI; delta += SWEEP_STEP_RAD) {
      cand = tryCandidate(noiseHeading + delta) ?? tryCandidate(noiseHeading - delta);
      if (cand) return cand;
    }
    return null;
  }

  /** 'persistent' steps, and 'levy' steps between jumps. */
  function proposeCruiseStep(): Point | null {
    for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
      const cand = tryCandidate(angle + rng.float(-turnMagRad, turnMagRad));
      if (cand) return cand;
    }
    for (let delta = 0; delta <= turnMagRad; delta += SWEEP_STEP_RAD) {
      const signs = delta === 0 ? [1] : [1, -1];
      for (const sign of signs) {
        const cand = tryCandidate(angle + sign * delta);
        if (cand) return cand;
      }
    }
    return null;
  }

  for (let step = 0; step < params.maxSteps; step++) {
    let next: Point | null = null;

    if (headingMode === 'levy') {
      if (jumpStepsRemaining > 0) {
        const cand = tryCandidate(angle);
        if (cand) {
          next = cand;
          jumpStepsRemaining--;
        } else {
          jumpStepsRemaining = 0; // Run blocked -- fall through to a normal cruise step.
        }
      }
      if (!next && jumpStepsRemaining === 0 && rng.float(0, 1) < params.jumpChance) {
        const cand = tryCandidate(angle);
        if (cand) {
          next = cand;
          jumpStepsRemaining = sampleLevyRunLength(rng, params.jumpMaxSteps) - 1;
        }
      }
    }

    if (!next) {
      if (step === 0) next = proposeInitialStep();
      else if (headingMode === 'noise') next = proposeNoiseStep();
      else next = proposeCruiseStep();
    }

    if (!next) break; // Boxed in: no legal move. Stop here.

    arcLength += Math.hypot(next[0] - current[0], next[1] - current[1]);
    angle = Math.atan2(next[1] - current[1], next[0] - current[0]);
    path.push(next);
    current = next;

    const ageIndex = path.length - 1 - skipRecent;
    if (ageIndex >= 1) {
      const aged = path[ageIndex];
      if (aged) insertPoint(ownGrid, avoidRadius, aged);
    }
  }

  return path;
}

function generate(seed: number, page: PageSpec, params: SelfAvoidingWalkParams): Layer[] {
  const b = bounds(page);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  if (width <= 0 || height <= 0) {
    return [{ name: '1', paths: [], color: '#000000' }];
  }

  const rng = createRng(seed);
  // How many trailing points to exclude from a walk's own collision
  // checks: enough that the tail leading up to the current point can
  // never trivially block it.
  const skipRecent = Math.max(2, Math.ceil(params.avoidRadius / params.stepSize) + 1);

  if (params.nWalks <= 1) {
    let best: Point[] = [];
    for (let i = 0; i < START_ATTEMPTS; i++) {
      const start: Point = [rng.float(b.minX, b.maxX), rng.float(b.minY, b.maxY)];
      const angle0 = rng.float(0, Math.PI * 2);
      const candidate = attemptWalk(rng, b, params, skipRecent, new Map(), start, angle0, 0);
      if (candidate.length > best.length) best = candidate;
    }
    const paths: Path[] = best.length >= 2 ? [best] : [];
    return [{ name: '1', paths, color: '#000000' }];
  }

  // Several walks sharing one random start point -- a "starburst". Each
  // slot gets its own disposable clone of the *committed* grid to try its
  // attempts against, so a discarded attempt (only the longest of
  // START_ATTEMPTS is kept) never pollutes what later walks see.
  const sharedGrid: CollisionGrid = new Map();
  const startPoint: Point = [rng.float(b.minX, b.maxX), rng.float(b.minY, b.maxY)];
  const hubRadiusSq = (params.avoidRadius * HUB_RADIUS_FACTOR) ** 2;
  const paths: Path[] = [];

  for (let w = 0; w < params.nWalks; w++) {
    let walkPath: Point[] = [];
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      const heading = rng.float(0, Math.PI * 2);
      const attemptGrid = cloneGrid(sharedGrid);
      const candidate = attemptWalk(rng, b, params, skipRecent, attemptGrid, startPoint, heading, w);
      if (candidate.length > walkPath.length) walkPath = candidate;
    }
    if (walkPath.length >= 2) {
      paths.push(walkPath);
      // Commit the entire winning trail (bar the shared hub disk, per the
      // module doc comment) so every later walk avoids all of it, not
      // just an aged tail.
      for (let i = 1; i < walkPath.length; i++) {
        const p = walkPath[i];
        if (!p) continue;
        const dx = p[0] - startPoint[0];
        const dy = p[1] - startPoint[1];
        if (dx * dx + dy * dy < hubRadiusSq) continue;
        insertPoint(sharedGrid, params.avoidRadius, p);
      }
    }
  }

  return [{ name: '1', paths, color: '#000000' }];
}

export const selfAvoidingWalk: Generator<SelfAvoidingWalkParams> = {
  id: 'selfAvoidingWalk',
  defaults: defaultsFromSchema(selfAvoidingWalkSchema),
  schema: selfAvoidingWalkSchema,
  generate,
};
