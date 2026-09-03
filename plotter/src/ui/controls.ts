/**
 * Tweakpane bound to the active generator's schema, plus everything spec
 * §5.9 asks for outside the generator params themselves: page/margin/pen,
 * seed prev/next/random, export, live cost + timing readouts, drag
 * debounce, and a draft-mode toggle.
 *
 * Two things are deliberately kept structurally separate, because
 * conflating them is called out in the spec as a common and infuriating
 * design mistake:
 *  - "change seed" vs "randomise params": distinct buttons, distinct
 *    callbacks, neither ever calls the other's handler.
 *  - lock toggles live in their own folder rather than fully inline next
 *    to each parameter (Tweakpane has no first-class "control beside a
 *    binding" primitive), but they still gate the same `Randomize` action.
 */
import { Pane } from 'tweakpane';
import type { FolderApi } from '@tweakpane/core';
import type { ParamSchema, ParamSpec } from '../core/types.ts';
import { PAGES, type PageName } from '../core/page.ts';
import { debounce } from '../core/urlState.ts';

export interface ControlsState<P> {
  schema: ParamSchema<P>;
  params: P;
  seed: number;
  pageName: PageName;
  margin: number;
  pen: { widthMm: number; color: string };
  locks: Partial<Record<keyof P, boolean>>;
  draftMode: boolean;
}

export interface ControlsCallbacks<P> {
  /** `dragging` is true for debounced, in-progress-drag updates and false for the settled/final value. */
  onParamsChange(params: P, dragging: boolean): void;
  onLocksChange(locks: Partial<Record<keyof P, boolean>>): void;
  onSeedChange(seed: number): void;
  onRandomize(): void;
  onExport(): void;
  onPageChange(pageName: PageName): void;
  onMarginChange(margin: number): void;
  onPenChange(pen: { widthMm: number; color: string }): void;
  onDraftModeChange(enabled: boolean): void;
}

export interface ControlsApi {
  setCostReadout(text: string): void;
  setTimingReadout(ms: number): void;
  /** A one-line, dismissable notice -- used when loading a config filled in missing params from defaults. */
  showNotice(text: string): void;
  setSeedDisplay(seed: number): void;
  destroy(): void;
}

const DRAG_DEBOUNCE_MS = 100;

function addParamBinding<P extends Record<string, any>>(
  folder: FolderApi,
  draft: P,
  key: keyof P & string,
  spec: ParamSpec,
  onIntermediate: () => void,
  onFinal: () => void,
): void {
  const common = { label: spec.label };
  let binding;
  if (spec.kind === 'number') {
    binding = folder.addBinding(draft, key, { ...common, min: spec.min, max: spec.max, step: spec.step });
  } else if (spec.kind === 'int') {
    binding = folder.addBinding(draft, key, { ...common, min: spec.min, max: spec.max, step: 1 });
  } else if (spec.kind === 'boolean') {
    binding = folder.addBinding(draft, key, common);
  } else {
    const options = Object.fromEntries(spec.options.map((o) => [o, o]));
    binding = folder.addBinding(draft, key, { ...common, options });
  }

  binding.on('change', (ev) => {
    if (ev.last) onFinal();
    else onIntermediate();
  });
}

// `P extends Record<string, any>` -- see core/config.ts for why a
// union-valued `Record` bound here would reject every real generator's
// params type.
export function createControls<P extends Record<string, any>>(
  container: HTMLElement,
  state: ControlsState<P>,
  callbacks: ControlsCallbacks<P>,
): ControlsApi {
  const pane = new Pane({ container, title: 'Plotter' });

  // --- Notice banner (plain DOM, not a Tweakpane concept) ---
  const notice = document.createElement('div');
  notice.className = 'controls-notice';
  notice.hidden = true;
  container.prepend(notice);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function showNotice(text: string): void {
    notice.textContent = text;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 8000);
  }

  // --- Page / pen ---
  const pageFolder = pane.addFolder({ title: 'Page' });
  const pageDraft = {
    page: state.pageName,
    margin: state.margin,
    penWidthMm: state.pen.widthMm,
    penColor: state.pen.color,
  };
  pageFolder
    .addBinding(pageDraft, 'page', { label: 'preset', options: Object.fromEntries(Object.keys(PAGES).map((k) => [k, k])) })
    .on('change', (ev) => callbacks.onPageChange(ev.value as PageName));
  pageFolder
    .addBinding(pageDraft, 'margin', { min: 0, max: 60, step: 1, label: 'margin (mm)' })
    .on('change', (ev) => callbacks.onMarginChange(ev.value as number));
  pageFolder
    .addBinding(pageDraft, 'penWidthMm', { min: 0.1, max: 2, step: 0.05, label: 'pen width (mm)' })
    .on('change', (ev) => callbacks.onPenChange({ widthMm: ev.value as number, color: pageDraft.penColor }));
  pageFolder
    .addBinding(pageDraft, 'penColor', { label: 'pen colour (preview only)' })
    .on('change', (ev) => callbacks.onPenChange({ widthMm: pageDraft.penWidthMm, color: ev.value as string }));

  // --- Seed: deliberately separate from param randomisation ---
  const seedFolder = pane.addFolder({ title: 'Seed' });
  const seedDraft = { seed: state.seed };
  seedFolder
    .addBinding(seedDraft, 'seed', { step: 1 })
    .on('change', (ev) => callbacks.onSeedChange(Math.round(ev.value as number)));
  seedFolder.addButton({ title: '< prev' }).on('click', () => {
    seedDraft.seed -= 1;
    pane.refresh();
    callbacks.onSeedChange(seedDraft.seed);
  });
  seedFolder.addButton({ title: 'next >' }).on('click', () => {
    seedDraft.seed += 1;
    pane.refresh();
    callbacks.onSeedChange(seedDraft.seed);
  });
  seedFolder.addButton({ title: 'random' }).on('click', () => {
    seedDraft.seed = Math.floor(Math.random() * 1_000_000);
    pane.refresh();
    callbacks.onSeedChange(seedDraft.seed);
  });

  // --- Generator parameters, schema-driven ---
  const paramsFolder = pane.addFolder({ title: 'Parameters' });
  const paramsDraft = { ...state.params };
  const flushParams = () => callbacks.onParamsChange({ ...paramsDraft }, false);
  const debouncedDragFlush = debounce(() => callbacks.onParamsChange({ ...paramsDraft }, true), DRAG_DEBOUNCE_MS);

  for (const key of Object.keys(state.schema as object) as (keyof P & string)[]) {
    const spec = (state.schema as Record<string, ParamSpec>)[key]!;
    addParamBinding(paramsFolder, paramsDraft, key, spec, debouncedDragFlush, flushParams);
  }

  // --- Locks: grouped, but gate the same Randomize action as an inline toggle would ---
  const locksFolder = pane.addFolder({ title: 'Locks (skipped by Randomize)', expanded: false });
  const locks: Partial<Record<keyof P, boolean>> = { ...state.locks };
  for (const key of Object.keys(state.schema as object) as (keyof P & string)[]) {
    const spec = (state.schema as Record<string, ParamSpec>)[key]!;
    const lockDraft = { locked: !!locks[key] };
    locksFolder.addBinding(lockDraft, 'locked', { label: spec.label }).on('change', (ev) => {
      locks[key] = ev.value as boolean;
      callbacks.onLocksChange({ ...locks });
    });
  }

  // --- Actions ---
  const actionsFolder = pane.addFolder({ title: 'Actions' });
  actionsFolder.addButton({ title: 'Randomise (unlocked)' }).on('click', () => callbacks.onRandomize());
  actionsFolder.addButton({ title: 'Export SVG' }).on('click', () => callbacks.onExport());

  // --- Info: cost, timing, draft mode ---
  const infoFolder = pane.addFolder({ title: 'Info' });
  const infoDraft = { cost: '', timingMs: '0 ms', draftMode: state.draftMode };
  infoFolder.addBinding(infoDraft, 'cost', { readonly: true, multiline: true, label: 'cost (pessimistic)' });
  infoFolder.addBinding(infoDraft, 'timingMs', { readonly: true, label: 'regen time' });
  infoFolder
    .addBinding(infoDraft, 'draftMode', { label: 'draft mode' })
    .on('change', (ev) => callbacks.onDraftModeChange(ev.value as boolean));

  return {
    setCostReadout(text) {
      infoDraft.cost = text;
      pane.refresh();
    },
    setTimingReadout(ms) {
      infoDraft.timingMs = `${ms.toFixed(1)} ms`;
      pane.refresh();
    },
    showNotice,
    setSeedDisplay(seed) {
      seedDraft.seed = seed;
      pane.refresh();
    },
    destroy() {
      if (noticeTimer) clearTimeout(noticeTimer);
      pane.dispose();
    },
  };
}
