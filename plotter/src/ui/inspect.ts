/**
 * Small additions that pay for themselves during tuning (spec §5.8b):
 * a hover readout in mm, a stats line, and a path-length histogram. The
 * histogram in particular is the quickest signal that a parameter change
 * has quietly turned the drawing into confetti -- a spike near `minLength`
 * means lines are dying young.
 *
 * `computeStats` / `formatStatsLine` are pure and DOM-free (tested
 * headlessly below); the hover readout and histogram renderer are the
 * only DOM-touching pieces, and neither runs anything at import time.
 */
import type { Layer, Path } from '../core/types.ts';
import type { Preview } from './preview.ts';

export interface PathLengthBucket {
  /** Upper edge of this bucket, in mm. */
  max: number;
  count: number;
}

export interface Stats {
  pathCount: number;
  pointCount: number;
  drawLengthMm: number;
  longestPathMm: number;
  medianPathMm: number;
  histogram: PathLengthBucket[];
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

export function computeStats(layers: Layer[], bucketCount = 12): Stats {
  const lengths: number[] = [];
  let pointCount = 0;

  for (const layer of layers) {
    for (const path of layer.paths) {
      pointCount += path.length;
      lengths.push(pathLength(path));
    }
  }

  const pathCount = lengths.length;
  const drawLengthMm = lengths.reduce((s, l) => s + l, 0);
  const sorted = lengths.slice().sort((a, b) => a - b);
  const longestPathMm = sorted.length ? sorted[sorted.length - 1]! : 0;
  const medianPathMm = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;

  const bucketMax = longestPathMm || 1;
  const bucketSize = bucketMax / bucketCount;
  const histogram: PathLengthBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    max: bucketSize * (i + 1),
    count: 0,
  }));
  for (const len of lengths) {
    const idx = Math.min(bucketCount - 1, Math.floor(len / bucketSize));
    histogram[idx]!.count += 1;
  }

  return { pathCount, pointCount, drawLengthMm, longestPathMm, medianPathMm, histogram };
}

export function formatStatsLine(stats: Stats): string {
  return (
    `${stats.pathCount} paths · ${stats.pointCount} pts · ` +
    `${(stats.drawLengthMm / 1000).toFixed(1)}m draw · ` +
    `longest ${stats.longestPathMm.toFixed(0)}mm · median ${stats.medianPathMm.toFixed(0)}mm`
  );
}

/** Attaches a pointermove/pointerleave hover readout in mm. Returns a cleanup function. */
export function attachHoverReadout(
  canvas: HTMLCanvasElement,
  preview: Preview,
  onMove: (worldMm: [number, number] | null) => void,
): () => void {
  function handleMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const t = preview.getTransform();
    const x = (e.clientX - rect.left - t.offsetX) / t.scale;
    const y = (e.clientY - rect.top - t.offsetY) / t.scale;
    onMove([x, y]);
  }
  function handleLeave(): void {
    onMove(null);
  }

  canvas.addEventListener('pointermove', handleMove);
  canvas.addEventListener('pointerleave', handleLeave);
  return () => {
    canvas.removeEventListener('pointermove', handleMove);
    canvas.removeEventListener('pointerleave', handleLeave);
  };
}

/** Renders a small inline bar histogram of path lengths into `container`. */
export function renderHistogram(container: HTMLElement, stats: Stats): void {
  container.innerHTML = '';
  container.classList.add('histogram');
  const maxCount = Math.max(1, ...stats.histogram.map((b) => b.count));

  for (const bucket of stats.histogram) {
    const bar = document.createElement('div');
    bar.className = 'histogram-bar';
    const pct = (bucket.count / maxCount) * 100;
    bar.style.height = `${Math.max(2, pct)}%`;
    bar.title = `≤${bucket.max.toFixed(0)}mm: ${bucket.count} path${bucket.count === 1 ? '' : 's'}`;
    container.appendChild(bar);
  }
}
