/**
 * The generic sketch-app shell: preview + controls + library + inspect +
 * seed grid + URL state, wired to whichever `GeneratorEntry` the router
 * (`main.ts`) hands it. This is `main.ts`'s old single-generator wiring,
 * generalised so a second (or tenth) generator drops in with zero changes
 * here -- only `generators/registry.ts` needs to know a new one exists.
 *
 * `params` is typed `Record<string, any>` throughout (the registry
 * type-erases each generator to this shape) rather than a concrete
 * generator's own params interface -- the same trade-off spelled out in
 * `core/config.ts` and `core/paramUtils.ts` for the same reason: a named
 * params type has no index signature, so a union-valued `Record` bound
 * would reject it here, where the shell must stay agnostic to which
 * generator it's driving.
 */
import type { GeneratorEntry } from '../generators/registry.ts';
import { PAGES, type PageName } from '../core/page.ts';
import type { PageSpec, Layer } from '../core/types.ts';
import { createConfig, migrateConfig, type SketchConfig } from '../core/config.ts';
import { createLibrary } from '../core/library.ts';
import { randomizeParams } from '../core/paramUtils.ts';
import { debounce, searchParamsToState, stateToSearchParams } from '../core/urlState.ts';
import { estimate, formatEstimate } from '../core/cost.ts';
import { computeStats, formatStatsLine, attachHoverReadout, renderHistogram } from './inspect.ts';
import { createPreview, renderThumbnail } from './preview.ts';
import { createControls } from './controls.ts';
import { createSeedGrid } from './grid.ts';
import { toSvg, parseConfigFromSvg } from '../export/svg.ts';
import { downloadSvg } from '../export/download.ts';
import { createRng } from '../core/random.ts';

// Temporarily off: with the seed grid's 12 thumbnails in the side panel,
// the panel overflowed and its own scrolling was broken (a CSS grid item
// needs `min-height: 0` to scroll instead of growing -- now fixed in
// style.css), which made Parameters/Locks/Actions hard to reach. Re-enable
// once the panel has a layout with more room for it.
const SHOW_SEED_GRID = false;

type Params = Record<string, any>;

interface AppState {
  seed: number;
  params: Params;
  pageName: PageName;
  margin: number;
  pen: { widthMm: number; color: string };
  locks: Partial<Record<string, boolean>>;
  draftMode: boolean;
}

export function runSketchApp(entry: GeneratorEntry, root: HTMLElement): void {
  const generator = entry.generator;

  // -------------------------------------------------------------------------
  // DOM scaffold. `root` is the router's mount point (`#root` in
  // index.html) -- everything under it is built here, including the header
  // that links back to the gallery, so the router itself stays a thin
  // "which mode am I in" dispatcher.
  // -------------------------------------------------------------------------

  root.innerHTML = '';
  const app = document.createElement('div');
  app.id = 'app';
  root.appendChild(app);

  const canvasWrap = document.createElement('div');
  canvasWrap.id = 'canvas-wrap';
  app.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.id = 'preview-canvas';
  canvasWrap.appendChild(canvas);

  const panel = document.createElement('div');
  panel.id = 'panel';
  app.appendChild(panel);

  const header = document.createElement('div');
  header.id = 'app-header';
  header.innerHTML = `<a href="?" id="back-to-gallery">&larr; All sketches</a><span id="app-title">${entry.title}</span>`;
  panel.appendChild(header);

  const controlsEl = document.createElement('div');
  controlsEl.id = 'controls';
  panel.appendChild(controlsEl);

  const hoverReadoutEl = document.createElement('div');
  hoverReadoutEl.id = 'hover-readout';
  hoverReadoutEl.textContent = '—';
  panel.appendChild(hoverReadoutEl);

  const statsLineEl = document.createElement('div');
  statsLineEl.id = 'stats-line';
  panel.appendChild(statsLineEl);

  const histogramEl = document.createElement('div');
  histogramEl.id = 'histogram';
  panel.appendChild(histogramEl);

  const librarySection = document.createElement('div');
  librarySection.id = 'library-section';
  librarySection.innerHTML = `
    <div class="section-title">Library <span class="hint">(press S to save)</span></div>
    <div id="library-actions">
      <button id="lib-export">Export JSON</button>
      <label id="lib-import-label">Import JSON<input id="lib-import" type="file" accept="application/json" hidden></label>
      <label id="load-svg-label">Load SVG config<input id="load-svg" type="file" accept="image/svg+xml" hidden></label>
    </div>
    <div id="library-grid"></div>
  `;
  panel.appendChild(librarySection);

  let seedGridSection: HTMLElement | null = null;
  if (SHOW_SEED_GRID) {
    seedGridSection = document.createElement('div');
    seedGridSection.id = 'grid-section';
    seedGridSection.innerHTML = `<div class="section-title">Seed variants</div><div id="seed-grid"></div>`;
    panel.appendChild(seedGridSection);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state: AppState = {
    seed: 1,
    params: { ...generator.defaults },
    pageName: 'a4_landscape',
    margin: 15,
    pen: { widthMm: 0.3, color: '#1a1a1a' },
    locks: {},
    draftMode: false,
  };

  // Restore from the URL, if present (spec §6.5) -- convenience only.
  {
    const parsed = searchParamsToState(new URLSearchParams(window.location.search), generator.schema);
    if (parsed.generator === generator.id) {
      if (parsed.seed !== null) state.seed = parsed.seed;
      Object.assign(state.params, parsed.params);
    }
  }

  function currentPage(): PageSpec {
    const preset = PAGES[state.pageName];
    return { width: preset.width, height: preset.height, margin: state.margin };
  }

  function currentConfig(): SketchConfig {
    return createConfig({
      generator: generator.id,
      seed: state.seed,
      page: currentPage(),
      pen: state.pen,
      params: state.params,
      locks: state.locks as Record<string, boolean>,
    });
  }

  // ---------------------------------------------------------------------------
  // Preview + inspect
  // ---------------------------------------------------------------------------

  const preview = createPreview(canvas);
  let lastLayers: Layer[] = [];

  attachHoverReadout(canvas, preview, (worldMm) => {
    hoverReadoutEl.textContent = worldMm ? `${worldMm[0].toFixed(1)}, ${worldMm[1].toFixed(1)} mm` : '—';
  });

  // ---------------------------------------------------------------------------
  // Regeneration
  // ---------------------------------------------------------------------------

  /**
   * Scales params down for a fast, rougher preview while dragging in draft
   * mode; never mutates `state.params`. Only touches keys that actually
   * exist on this generator's params (a generator without `nLines` or
   * `stepSize` -- e.g. randomWalk has `stepSize` but not `nLines` -- is
   * left alone for the keys it doesn't have), so this stays generic across
   * generators instead of assuming flowField's specific schema.
   */
  function draftParams(params: Params): Params {
    const next = { ...params };
    if (typeof next.nLines === 'number') next.nLines = Math.max(50, Math.round(next.nLines * 0.35));
    if (typeof next.nWalkers === 'number') next.nWalkers = Math.max(10, Math.round(next.nWalkers * 0.35));
    if (typeof next.stepSize === 'number') next.stepSize = Math.min(5.0, next.stepSize * 1.8);
    return next;
  }

  function regenerate(opts: { dragging?: boolean } = {}): void {
    const page = currentPage();
    const useDraft = state.draftMode && opts.dragging;
    const effectiveParams = useDraft ? draftParams(state.params) : state.params;

    const start = performance.now();
    const layers = generator.generate(state.seed, page, effectiveParams);
    const elapsedMs = performance.now() - start;
    lastLayers = layers;

    preview.render(layers, page, {
      penWidthMm: state.pen.widthMm,
      showPageOutline: true,
      showMargin: true,
      showTravel: showTravelToggle.checked,
      background: '#f4f3ef',
    });

    controlsInstance.setTimingReadout(elapsedMs);
    controlsInstance.setCostReadout(formatEstimate(estimate(layers)));

    const stats = computeStats(layers);
    statsLineEl.textContent = formatStatsLine(stats);
    renderHistogram(histogramEl, stats);

    if (!opts.dragging) {
      scheduleUrlSync();
      // The seed grid shows variants of the *current* params, so any settled
      // (non-drag) change -- seed, params, page, margin, pen, a loaded config
      // -- needs to refresh it too, not just the main preview.
      refreshSeedGrid();
    }
  }

  const scheduleUrlSync = debounce(() => {
    const usp = stateToSearchParams(generator.id, state.seed, state.params);
    const url = `${window.location.pathname}?${usp.toString()}`;
    window.history.replaceState(null, '', url);
  }, 300);

  // ---------------------------------------------------------------------------
  // Travel overlay toggle (small standalone checkbox above the canvas -- not
  // a generator param, so it lives outside Tweakpane's schema-driven section)
  // ---------------------------------------------------------------------------

  const showTravelToggle = document.createElement('input');
  showTravelToggle.type = 'checkbox';
  showTravelToggle.id = 'show-travel';
  const travelLabel = document.createElement('label');
  travelLabel.htmlFor = 'show-travel';
  travelLabel.textContent = 'show travel (pen-up) moves';
  travelLabel.prepend(showTravelToggle);
  canvasWrap.appendChild(travelLabel);
  showTravelToggle.addEventListener('change', () => regenerate());

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const controlsCallbacks = {
    onParamsChange(params: Params, dragging: boolean) {
      state.params = params;
      regenerate({ dragging });
    },
    onLocksChange(locks: Partial<Record<string, boolean>>) {
      state.locks = locks;
    },
    onSeedChange(seed: number) {
      // Seed changes never touch parameters -- a deliberately separate path.
      state.seed = seed;
      regenerate();
    },
    onRandomize() {
      const rng = createRng(Math.floor(Math.random() * 0xffffffff));
      state.params = randomizeParams(generator.schema, state.params, state.locks, rng);
      // Randomize rebuilds the whole controls panel: Tweakpane bindings have
      // no clean "refresh every value from a new object" escape hatch once
      // several keys can be independently locked.
      controlsInstance.destroy();
      mountControls();
      regenerate();
    },
    onExport() {
      const config = currentConfig();
      const svg = toSvg(lastLayers, currentPage(), config);
      downloadSvg(svg, generator.id, state.seed);
    },
    onPageChange(pageName: PageName) {
      state.pageName = pageName;
      regenerate();
      preview.fitToView();
    },
    onMarginChange(margin: number) {
      state.margin = margin;
      regenerate();
    },
    onPenChange(pen: { widthMm: number; color: string }) {
      state.pen = pen;
      regenerate();
    },
    onDraftModeChange(enabled: boolean) {
      state.draftMode = enabled;
    },
  };

  function mountControls(): void {
    controlsInstance = createControls(
      controlsEl,
      {
        schema: generator.schema,
        params: state.params,
        seed: state.seed,
        pageName: state.pageName,
        margin: state.margin,
        pen: state.pen,
        locks: state.locks,
        draftMode: state.draftMode,
      },
      controlsCallbacks,
    );
  }

  let controlsInstance = createControls(
    controlsEl,
    {
      schema: generator.schema,
      params: state.params,
      seed: state.seed,
      pageName: state.pageName,
      margin: state.margin,
      pen: state.pen,
      locks: state.locks,
      draftMode: state.draftMode,
    },
    controlsCallbacks,
  );

  // ---------------------------------------------------------------------------
  // Library: save shortcut, panel, export/import. The library itself is one
  // shared localStorage collection across every generator (spec §6.3 says
  // nothing about scoping it per-generator, and keeping one collection is
  // what makes "export my whole library as a backup" mean what it says) --
  // this panel just filters the display to entries made with *this*
  // generator, so switching sketches doesn't show irrelevant thumbnails.
  // ---------------------------------------------------------------------------

  const library = createLibrary();
  const libraryGrid = document.querySelector<HTMLElement>('#library-grid')!;

  function renderLibraryPanel(): void {
    libraryGrid.innerHTML = '';
    for (const entry of library.list()) {
      if (entry.config.generator !== generator.id) continue;
      const cell = document.createElement('div');
      cell.className = 'library-cell';

      const img = document.createElement('img');
      img.src = entry.thumbnail;
      img.alt = entry.config.meta.label || `Seed ${entry.config.seed}`;
      img.addEventListener('click', () => applyConfig(entry.config));

      const meta = document.createElement('div');
      meta.className = 'library-meta';
      const label = document.createElement('span');
      label.textContent = entry.config.meta.label || `${entry.config.generator} #${entry.config.seed}`;
      const date = document.createElement('span');
      date.className = 'library-date';
      date.textContent = new Date(entry.config.meta.createdAt).toLocaleString();

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'rename';
      renameBtn.addEventListener('click', () => {
        const next = window.prompt('New label', entry.config.meta.label ?? '');
        if (next !== null) {
          library.rename(entry.id, next);
          renderLibraryPanel();
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'delete';
      deleteBtn.addEventListener('click', () => {
        library.remove(entry.id);
        renderLibraryPanel();
      });

      meta.append(label, date, renameBtn, deleteBtn);
      cell.append(img, meta);
      libraryGrid.appendChild(cell);
    }
  }

  function saveToLibrary(): void {
    const config = currentConfig();
    const thumbnail = renderThumbnail(lastLayers, currentPage(), 200);
    library.save(config, thumbnail);
    renderLibraryPanel();
    controlsInstance.showNotice('Saved to library.');
  }

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (isTyping) return;
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      saveToLibrary();
    }
  });

  document.querySelector<HTMLButtonElement>('#lib-export')!.addEventListener('click', () => {
    const json = library.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plotter-library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector<HTMLInputElement>('#lib-import')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      library.importAll(text, 'merge');
      renderLibraryPanel();
      controlsInstance.showNotice('Library imported.');
    } catch (err) {
      controlsInstance.showNotice(`Import failed: ${(err as Error).message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Load config from a dropped/opened SVG (spec §6.2)
  // ---------------------------------------------------------------------------

  function applyConfig(raw: SketchConfig): void {
    if (raw.generator !== generator.id) {
      // A config exported from a different generator's mini-app: rather
      // than silently reinterpreting its params under this schema (mostly
      // defaulted, meaningless), send the user to the right app.
      controlsInstance.showNotice(
        `This config is for the "${raw.generator}" sketch, not "${generator.id}". Open ?g=${raw.generator} to load it.`,
      );
      return;
    }

    const { config, defaultedParams } = migrateConfig(raw, generator.defaults);
    state.seed = config.seed;
    state.pageName =
      (Object.keys(PAGES) as PageName[]).find(
        (name) => PAGES[name].width === config.page.width && PAGES[name].height === config.page.height,
      ) ?? state.pageName;
    state.margin = config.page.margin;
    state.pen = config.pen;
    state.params = config.params;
    state.locks = config.meta.locks ?? {};

    controlsInstance.destroy();
    mountControls();
    regenerate();
    preview.fitToView();

    if (defaultedParams.length > 0) {
      controlsInstance.showNotice(`Loaded with defaults for: ${defaultedParams.join(', ')}`);
    }
  }

  document.querySelector<HTMLInputElement>('#load-svg')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const config = parseConfigFromSvg(text);
      applyConfig(config);
    } catch (err) {
      controlsInstance.showNotice(`Load failed: ${(err as Error).message}`);
    }
  });

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const config = parseConfigFromSvg(text);
      applyConfig(config);
    } catch (err) {
      controlsInstance.showNotice(`Load failed: ${(err as Error).message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Seed variant grid
  // ---------------------------------------------------------------------------

  const seedGrid = SHOW_SEED_GRID ? createSeedGrid(document.querySelector<HTMLElement>('#seed-grid')!, 4, 3) : null;

  function refreshSeedGrid(): void {
    if (!seedGrid) return;
    seedGrid.render(
      state.seed,
      (seed) => generator.generate(seed, currentPage(), state.params),
      currentPage(),
      (seed) => {
        state.seed = seed;
        controlsInstance.setSeedDisplay(seed);
        regenerate(); // also refreshes the grid itself, from the new base seed
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  renderLibraryPanel();
  regenerate(); // also performs the initial seed-grid render (see regenerate's tail)
}
