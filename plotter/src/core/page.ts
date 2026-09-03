/**
 * Page sizes, margins, and clipping. All dimensions in millimetres.
 */
import type { Bounds, PageSpec, Path, Point } from './types.ts';

export const PAGES = {
  a4_landscape: { width: 297, height: 210 },
  a4_portrait: { width: 210, height: 297 },
  a3_landscape: { width: 420, height: 297 },
  a3_portrait: { width: 297, height: 420 },
} as const;

export type PageName = keyof typeof PAGES;

/** The drawable region inside the page margin. */
export function bounds(page: PageSpec): Bounds {
  return {
    minX: page.margin,
    minY: page.margin,
    maxX: page.width - page.margin,
    maxY: page.height - page.margin,
  };
}

export function contains(b: Bounds, p: Point): boolean {
  return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
}

/**
 * Splits paths at the region boundary rather than discarding or clamping
 * them. Clamping produces paths that run along the margin, which reads as a
 * bug on paper — so a path that leaves and re-enters the region becomes two
 * (or more) separate output paths, each entirely inside `b`.
 *
 * Uses linear interpolation to find the boundary crossing point between two
 * consecutive path points, so the clipped path touches the boundary exactly
 * rather than snapping to the nearest sampled point.
 */
export function clipToBounds(paths: Path[], b: Bounds): Path[] {
  const result: Path[] = [];

  for (const path of paths) {
    let current: Point[] = [];
    let prevPoint: Point | null = null;
    let prevInside = false;

    for (const p of path) {
      const inside = contains(b, p);

      if (prevPoint !== null && inside !== prevInside) {
        // Crossing the boundary: interpolate the exact crossing point.
        const crossing = segmentBoundsIntersection(prevPoint, p, b);
        if (crossing) current.push(crossing);
        if (!inside) {
          // Leaving the region: the crossing point ends this segment.
          if (current.length >= 2) result.push(current);
          current = [];
        }
        // Entering the region: `crossing` is now the first point of a new
        // segment, and `p` (inside) is appended below.
      }

      if (inside) current.push(p);

      prevPoint = p;
      prevInside = inside;
    }

    if (current.length >= 2) result.push(current);
  }

  return result;
}

/**
 * Approximates the point where segment (a -> b) crosses the rectangle
 * boundary, by binary-searching along the segment for the inside/outside
 * transition. Robust to which of the four edges is crossed, including
 * corners, without needing per-edge case analysis.
 */
function segmentBoundsIntersection(a: Point, b: Point, bounds: Bounds): Point | null {
  const aInside = contains(bounds, a);
  const bInside = contains(bounds, b);
  if (aInside === bInside) return null; // no crossing on this segment

  let lo = 0; // point at `lo` has aInside's inside-ness
  let hi = 1; // point at `hi` has bInside's inside-ness
  const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    if (contains(bounds, at(mid)) === aInside) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return at((lo + hi) / 2);
}
