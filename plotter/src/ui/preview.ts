/**
 * Canvas 2D preview: a preview surface only. The point arrays in `Layer[]`
 * are always the source of truth -- this module never reads geometry back
 * out of the canvas.
 *
 * Honest density is the single most important property here: stroke width
 * on screen must correspond to the real pen width in mm under the current
 * zoom, not a fixed hairline. Everything else (page guides, pan/zoom,
 * travel overlay) exists to serve inspection at that true width.
 */
import type { Layer, PageSpec, Point } from '../core/types.ts';
import { bounds } from '../core/page.ts';

export interface PreviewOptions {
  penWidthMm: number;
  showPageOutline: boolean;
  showMargin: boolean;
  /** Pen-up moves between paths, drawn as faint lines. Off by default -- it clutters. */
  showTravel: boolean;
  background: string;
}

/** World(mm) -> screen(css px): screenX = offsetX + worldX * scale. */
export interface ViewTransform {
  scale: number; // css px per mm
  offsetX: number;
  offsetY: number;
}

export interface Preview {
  render(layers: Layer[], page: PageSpec, opts: PreviewOptions): void;
  fitToView(): void;
  setTransform(t: ViewTransform): void;
  getTransform(): ViewTransform;
  destroy(): void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const FIT_PADDING_PX = 32;

/**
 * Renders a small, standalone PNG data URL thumbnail (~200px) of `layers`
 * on `page`, independent of the live preview's current pan/zoom -- a
 * library thumbnail (spec §6.3) should always show the whole sketch, not
 * whatever the user happened to be zoomed into when they hit save.
 */
export function renderThumbnail(layers: Layer[], page: PageSpec, size = 200): string {
  const off = document.createElement('canvas');
  const aspect = page.width / page.height;
  off.width = aspect >= 1 ? size : Math.round(size * aspect);
  off.height = aspect >= 1 ? Math.round(size / aspect) : size;
  const ctx = off.getContext('2d');
  if (!ctx) return '';

  const scale = off.width / page.width;
  ctx.fillStyle = '#f4f3ef';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const layer of layers) {
    ctx.strokeStyle = layer.color || '#000000';
    ctx.beginPath();
    for (const path of layer.paths) {
      if (path.length < 2) continue;
      ctx.moveTo(path[0]![0] * scale, path[0]![1] * scale);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i]![0] * scale, path[i]![1] * scale);
      }
    }
    ctx.stroke();
  }

  return off.toDataURL('image/png');
}

export function createPreview(canvas: HTMLCanvasElement): Preview {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D canvas context is unavailable.');
  // Re-bound to a fresh const so its non-null type is fixed at this point --
  // TypeScript's narrowing of `ctx2d` from the guard above doesn't persist
  // into the closures defined below, but a `const` initialised from an
  // already-narrowed value keeps that narrowed type for its own lifetime.
  const ctx = ctx2d;

  let layers: Layer[] = [];
  let page: PageSpec = { width: 297, height: 210, margin: 15 };
  let opts: PreviewOptions = {
    penWidthMm: 0.3,
    showPageOutline: true,
    showMargin: true,
    showTravel: false,
    background: '#f4f3ef',
  };

  let transform: ViewTransform = { scale: 2, offsetX: 40, offsetY: 40 };
  let cssWidth = 0;
  let cssHeight = 0;
  let renderScheduled = false;
  let destroyed = false;

  function resizeToContainer(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    // All drawing below happens in css-pixel units.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleRender();
  }

  function scheduleRender(): void {
    if (renderScheduled || destroyed) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      draw();
    });
  }

  function worldToScreen(x: number, y: number): [number, number] {
    return [transform.offsetX + x * transform.scale, transform.offsetY + y * transform.scale];
  }

  function screenToWorld(x: number, y: number): [number, number] {
    return [(x - transform.offsetX) / transform.scale, (y - transform.offsetY) / transform.scale];
  }

  function draw(): void {
    if (destroyed) return;

    ctx.save();
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    drawPageGuides();
    if (opts.showTravel) drawTravel();
    drawLayers();

    ctx.restore();
  }

  function drawPageGuides(): void {
    const [px0, py0] = worldToScreen(0, 0);
    const [px1, py1] = worldToScreen(page.width, page.height);

    if (opts.showPageOutline) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
      ctx.restore();
    }

    if (opts.showMargin) {
      const b = bounds(page);
      const [mx0, my0] = worldToScreen(b.minX, b.minY);
      const [mx1, my1] = worldToScreen(b.maxX, b.maxY);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(mx0, my0, mx1 - mx0, my1 - my0);
      ctx.restore();
    }
  }

  function drawTravel(): void {
    let lastEnd: Point | null = null;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,60,40,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (const layer of layers) {
      for (const path of layer.paths) {
        if (path.length === 0) continue;
        const start = path[0]!;
        const end = path[path.length - 1]!;
        if (lastEnd) {
          const [x0, y0] = worldToScreen(lastEnd[0], lastEnd[1]);
          const [x1, y1] = worldToScreen(start[0], start[1]);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        lastEnd = end;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLayers(): void {
    // Honest density: stroke width is the real pen width in mm, mapped
    // through the current zoom -- never a fixed hairline. Round caps/joins
    // match how a pen tip actually behaves.
    const strokeWidthPx = Math.max(0.4, opts.penWidthMm * transform.scale);

    for (const layer of layers) {
      ctx.save();
      ctx.strokeStyle = layer.color || '#000000';
      ctx.lineWidth = strokeWidthPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // One beginPath()/stroke() per layer regardless of point count: each
      // moveTo starts an independent subpath, so this is visually identical
      // to stroking every path separately but avoids per-path overhead --
      // the thing that matters once a layer passes ~50k total points.
      ctx.beginPath();
      for (const path of layer.paths) {
        if (path.length < 2) continue;
        const [x0, y0] = worldToScreen(path[0]![0], path[0]![1]);
        ctx.moveTo(x0, y0);
        for (let i = 1; i < path.length; i++) {
          const [x, y] = worldToScreen(path[i]![0], path[i]![1]);
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function fitToView(): void {
    const availW = Math.max(1, cssWidth - FIT_PADDING_PX * 2);
    const availH = Math.max(1, cssHeight - FIT_PADDING_PX * 2);
    const scale = Math.min(availW / page.width, availH / page.height);
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const offsetX = (cssWidth - page.width * clampedScale) / 2;
    const offsetY = (cssHeight - page.height * clampedScale) / 2;
    transform = { scale: clampedScale, offsetX, offsetY };
    scheduleRender();
  }

  function setTransform(t: ViewTransform): void {
    transform = { ...t, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale)) };
    scheduleRender();
  }

  function getTransform(): ViewTransform {
    return { ...transform };
  }

  // --- Pan (drag) ---
  let dragging = false;
  let lastClientX = 0;
  let lastClientY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    transform = { ...transform, offsetX: transform.offsetX + dx, offsetY: transform.offsetY + dy };
    scheduleRender();
  }

  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  }

  // --- Zoom to cursor ---
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const [worldX, worldY] = screenToWorld(cursorX, cursorY);

    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.scale * zoomFactor));

    // Keep the point under the cursor fixed on screen while zooming.
    const offsetX = cursorX - worldX * newScale;
    const offsetY = cursorY - worldY * newScale;
    transform = { scale: newScale, offsetX, offsetY };
    scheduleRender();
  }

  // --- Reset to fit ---
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'f' || e.key === 'F') {
      fitToView();
    }
  }

  const resizeObserver = new ResizeObserver(() => resizeToContainer());
  resizeObserver.observe(canvas);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  resizeToContainer();
  fitToView();

  return {
    render(newLayers, newPage, newOpts) {
      layers = newLayers;
      page = newPage;
      opts = newOpts;
      scheduleRender();
    },
    fitToView,
    setTransform,
    getTransform,
    destroy() {
      destroyed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
