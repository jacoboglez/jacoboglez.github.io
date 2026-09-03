/**
 * Plot time / pen mileage estimate. Displayed live in the UI: a drawing
 * that looks good on screen can take four hours and destroy a pen, and
 * this is what prevents that discovery happening at the plotter.
 *
 * Travel is computed in the order paths appear (layers in array order,
 * paths within a layer in array order). Since the AxiDraw extension
 * reorders paths at plot time to minimise travel, this number is
 * **pessimistic** -- callers displaying it must say so, so it isn't
 * misread as a plot-time guarantee.
 */
import type { Layer } from './types.ts';

export interface CostOptions {
  /** mm/s while the pen is down. Default 60 -- an unvalidated guess; correct once a real plot is timed. */
  drawSpeedMmPerSec?: number;
  /** mm/s while the pen is up, travelling between paths. Default 150. */
  travelSpeedMmPerSec?: number;
  /** Seconds spent per pen up/down cycle (one per path). Default 0.3. */
  penCycleSeconds?: number;
}

export interface Estimate {
  drawLengthMm: number;
  travelLengthMm: number;
  pathCount: number;
  pointCount: number;
  seconds: number;
  /** drawLength / (drawLength + travelLength). 1 when there is no travel at all. */
  efficiency: number;
}

const DEFAULTS: Required<CostOptions> = {
  drawSpeedMmPerSec: 60,
  travelSpeedMmPerSec: 150,
  penCycleSeconds: 0.3,
};

function pathLength(path: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

export function estimate(layers: Layer[], opts: CostOptions = {}): Estimate {
  const { drawSpeedMmPerSec, travelSpeedMmPerSec, penCycleSeconds } = { ...DEFAULTS, ...opts };

  let drawLengthMm = 0;
  let travelLengthMm = 0;
  let pathCount = 0;
  let pointCount = 0;
  let lastEnd: readonly [number, number] | null = null;

  for (const layer of layers) {
    for (const path of layer.paths) {
      if (path.length === 0) continue;
      pathCount += 1;
      pointCount += path.length;
      drawLengthMm += pathLength(path);

      const start = path[0]!;
      const end = path[path.length - 1]!;
      if (lastEnd) {
        travelLengthMm += Math.hypot(start[0] - lastEnd[0], start[1] - lastEnd[1]);
      }
      lastEnd = end;
    }
  }

  const drawSeconds = drawLengthMm / drawSpeedMmPerSec;
  const travelSeconds = travelLengthMm / travelSpeedMmPerSec;
  const penSeconds = pathCount * penCycleSeconds;
  const seconds = drawSeconds + travelSeconds + penSeconds;

  const totalLength = drawLengthMm + travelLengthMm;
  const efficiency = totalLength > 0 ? drawLengthMm / totalLength : 1;

  return { drawLengthMm, travelLengthMm, pathCount, pointCount, seconds, efficiency };
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatEstimate(e: Estimate): string {
  const drawM = (e.drawLengthMm / 1000).toFixed(1);
  const travelM = (e.travelLengthMm / 1000).toFixed(1);
  const eff = Math.round(e.efficiency * 100);
  return (
    `~${formatDuration(e.seconds)} (pessimistic) · ` +
    `${drawM}m draw + ${travelM}m travel · ` +
    `${eff}% efficient · ` +
    `${e.pathCount} paths, ${e.pointCount} pts`
  );
}
