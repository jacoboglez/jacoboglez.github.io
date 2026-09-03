/**
 * Laser Bounce: a ray fired from the center of an equilateral triangle
 * reflects off its walls like a mirror, tracing one continuous polyline
 * until a bounce budget runs out. Pure geometry -- there is no randomness
 * in this generator at all (see the note on `seed` below), which makes it
 * a useful counter-example to flowField/randomWalk: a `Generator<P>` is not
 * required to use its `seed` argument for anything.
 *
 * Shape is hardcoded to an equilateral triangle for now. If a second shape
 * is ever wanted, the reflection tracer (`traceLaser`) already works on any
 * closed convex polygon described as an edge list -- only `computeVertices`
 * (and a shape-select param) would need to change.
 */
import { bounds } from '../core/page.ts';
import { defaultsFromSchema } from '../core/types.ts';
import type { Generator, Layer, ParamSchema, Path, PageSpec, Point } from '../core/types.ts';

export interface LaserBounceParams {
  initialAngleDeg: number;
  maxBounces: number;
  sizeMm: number;
  rotationDeg: number;
  dotRadiusMm: number;
}

export const laserBounceSchema: ParamSchema<LaserBounceParams> = {
  initialAngleDeg: { kind: 'number', label: 'Initial ray angle', min: 0, max: 360, step: 1, unit: 'deg', default: 50 },
  maxBounces: { kind: 'int', label: 'Max bounces', min: 1, max: 2000, default: 60 },
  sizeMm: { kind: 'number', label: 'Triangle size (circumradius)', min: 20, max: 200, step: 1, unit: 'mm', default: 90 },
  rotationDeg: { kind: 'number', label: 'Triangle rotation', min: 0, max: 360, step: 1, unit: 'deg', default: 0 },
  dotRadiusMm: { kind: 'number', label: 'Center dot radius', min: 0.5, max: 5, step: 0.1, unit: 'mm', default: 1.6 },
};

// A tiny inward safety shrink applied to the clamped circumradius (see
// `generate` below): without it, a triangle sized to *exactly* touch the
// page bounds can push a vertex a floating-point hair outside them,
// depending on rotation. Invisible on paper, but it's what keeps the
// containment guarantee exact rather than "usually".
const BOUNDS_SAFETY_FACTOR = 0.999;

// Solid-looking pen-plotter dots can't use `fill` (see export/svg.ts's
// "never fill" invariant), so the center dot is a tight inward spiral
// instead of a filled circle: with enough turns, adjacent windings sit
// closer together than a typical pen width and the plotted result reads as
// a solid dot, not a ring. Turn count is a fixed internal constant rather
// than a parameter -- one property, "how solid does the dot look", isn't
// worth its own knob.
const DOT_SPIRAL_TURNS = 5;
const DOT_SPIRAL_POINTS_PER_TURN = 20;

function spiralDot(center: Point, radiusMm: number): Path {
  const totalSteps = DOT_SPIRAL_TURNS * DOT_SPIRAL_POINTS_PER_TURN;
  const path: Point[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const r = radiusMm * (1 - t);
    const theta = t * DOT_SPIRAL_TURNS * Math.PI * 2;
    path.push([center[0] + r * Math.cos(theta), center[1] + r * Math.sin(theta)]);
  }
  return path;
}

/**
 * Angle (radians, standard math convention in this y-down page space) of
 * triangle vertex `k` (0, 1, 2) for a given rotation. The `-PI/2` offset is
 * only there so `rotationDeg = 0` puts one vertex pointing "up" on the
 * page -- the natural-looking default orientation -- rather than at 0°
 * (pointing right).
 */
function vertexAngle(rotationRad: number, k: number): number {
  return rotationRad - Math.PI / 2 + k * ((2 * Math.PI) / 3);
}

/**
 * The largest circumradius, for this specific rotation, that keeps all
 * three vertices inside a `halfW x halfH` box centered on the triangle's
 * center. Computed per-vertex (not as a single rotation-independent bound)
 * so a triangle isn't shrunk more than this rotation actually requires.
 */
function computeMaxRadius(halfW: number, halfH: number, rotationRad: number): number {
  let maxR = Infinity;
  for (let k = 0; k < 3; k++) {
    const theta = vertexAngle(rotationRad, k);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    if (Math.abs(c) > 1e-9) maxR = Math.min(maxR, halfW / Math.abs(c));
    if (Math.abs(s) > 1e-9) maxR = Math.min(maxR, halfH / Math.abs(s));
  }
  return maxR;
}

function computeVertices(center: Point, radius: number, rotationRad: number): Point[] {
  const vertices: Point[] = [];
  for (let k = 0; k < 3; k++) {
    const theta = vertexAngle(rotationRad, k);
    vertices.push([center[0] + radius * Math.cos(theta), center[1] + radius * Math.sin(theta)]);
  }
  return vertices;
}

type Edge = readonly [Point, Point];

/**
 * Where ray `origin + t*dir` (t > 0) crosses segment `p1 -> p2`, or `null`
 * if it doesn't (parallel, behind the origin, or off the end of the
 * segment). Standard two-line parametric intersection, solved directly
 * rather than via a general line-line library since there are only ever
 * three edges to test per step.
 */
function raySegmentIntersection(origin: Point, dir: Point, p1: Point, p2: Point): { t: number; point: Point } | null {
  const ex = p2[0] - p1[0];
  const ey = p2[1] - p1[1];
  const denom = ex * dir[1] - ey * dir[0];
  if (Math.abs(denom) < 1e-12) return null; // parallel (or nearly so) -- no single crossing

  const dx = p1[0] - origin[0];
  const dy = p1[1] - origin[1];
  const t = (ex * dy - ey * dx) / denom;
  const u = (dir[0] * dy - dir[1] * dx) / denom;

  const EPS = 1e-9;
  // `t <= EPS` (not `< 0`) is what stops a ray from immediately
  // re-intersecting the wall it just bounced off of at t~0.
  if (t <= EPS || u < -EPS || u > 1 + EPS) return null;

  return { t, point: [origin[0] + t * dir[0], origin[1] + t * dir[1]] };
}

/** Reflects unit vector `dir` off `edge`, per the mirror law (angle in = angle out about the edge's normal). */
function reflect(dir: Point, edge: Edge): Point {
  const [p1, p2] = edge;
  const ex = p2[0] - p1[0];
  const ey = p2[1] - p1[1];
  const len = Math.hypot(ex, ey) || 1;
  const nx = -ey / len;
  const ny = ex / len;
  const dn = dir[0] * nx + dir[1] * ny;
  const rx = dir[0] - 2 * dn * nx;
  const ry = dir[1] - 2 * dn * ny;
  const rlen = Math.hypot(rx, ry) || 1;
  return [rx / rlen, ry / rlen];
}

/**
 * Traces the ray from `center` at `initialAngleRad`, bouncing off `edges`
 * up to `maxBounces` times. Returns the single unbroken path (center, then
 * one point per bounce) -- this is deliberately one `Path`, not one per
 * segment, since it's plotted as one continuous pen-down stroke.
 */
function traceLaser(center: Point, initialAngleRad: number, edges: Edge[], maxBounces: number): Path {
  const path: Point[] = [center];
  let origin = center;
  let dir: Point = [Math.cos(initialAngleRad), Math.sin(initialAngleRad)];

  for (let bounce = 0; bounce < maxBounces; bounce++) {
    let closest: { t: number; point: Point; edge: Edge } | null = null;
    for (const edge of edges) {
      const hit = raySegmentIntersection(origin, dir, edge[0], edge[1]);
      if (hit && (!closest || hit.t < closest.t)) {
        closest = { t: hit.t, point: hit.point, edge };
      }
    }
    // Every point inside a closed convex polygon has a ray that exits
    // through some edge, so this shouldn't happen -- but a numerically
    // degenerate case (e.g. a ray running exactly through a vertex) stops
    // the trace safely here rather than looping or throwing.
    if (!closest) break;

    path.push(closest.point);
    dir = reflect(dir, closest.edge);
    origin = closest.point;
  }

  return path;
}

function generate(_seed: number, page: PageSpec, params: LaserBounceParams): Layer[] {
  const b = bounds(page);
  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxY - b.minY) / 2;

  if (halfW <= 0 || halfH <= 0) {
    return [
      { name: '1', paths: [], color: '#000000' },
      { name: '2', paths: [], color: '#c81e1e' },
    ];
  }

  const center: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const rotationRad = (params.rotationDeg * Math.PI) / 180;
  const maxRadius = computeMaxRadius(halfW, halfH, rotationRad);
  const radius = Math.min(params.sizeMm, maxRadius) * BOUNDS_SAFETY_FACTOR;
  const vertices = computeVertices(center, radius, rotationRad);
  const edges: Edge[] = [
    [vertices[0]!, vertices[1]!],
    [vertices[1]!, vertices[2]!],
    [vertices[2]!, vertices[0]!],
  ];

  const initialAngleRad = (params.initialAngleDeg * Math.PI) / 180;
  const laserPath = traceLaser(center, initialAngleRad, edges, params.maxBounces);

  const dotRadius = Math.min(params.dotRadiusMm, halfW, halfH);
  const dotPath = spiralDot(center, dotRadius);

  const trianglePath: Path = [...vertices, vertices[0]!];
  const laserLayerPaths: Path[] = laserPath.length >= 2 ? [dotPath, laserPath] : [dotPath];

  return [
    { name: '1', paths: [trianglePath], color: '#000000' },
    { name: '2', paths: laserLayerPaths, color: '#c81e1e' },
  ];
}

export const laserBounce: Generator<LaserBounceParams> = {
  id: 'laserBounce',
  defaults: defaultsFromSchema(laserBounceSchema),
  schema: laserBounceSchema,
  generate,
};
