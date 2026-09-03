/**
 * Seed variant grid (spec §5.10): an n x m grid of thumbnails from
 * consecutive seeds at the current parameters. Click a thumbnail to load
 * that seed. This is what replaces vsketch's seed grid -- scanning twelve
 * thumbnails beats clicking randomise twelve times.
 *
 * Rendered progressively (one or a few thumbnails per idle callback) so a
 * slow grid never stalls the tab.
 */
import type { Layer, PageSpec } from '../core/types.ts';
import { renderThumbnail } from './preview.ts';

export interface SeedGrid {
  /** (Re)renders the grid starting at `baseSeed`, using `generate` for each of cols*rows consecutive seeds. */
  render(baseSeed: number, generate: (seed: number) => Layer[], page: PageSpec, onSelect: (seed: number) => void): void;
  destroy(): void;
}

type IdleDeadline = { timeRemaining(): number; didTimeout: boolean };
type IdleCallback = (deadline: IdleDeadline) => void;

function scheduleIdle(cb: IdleCallback): void {
  const w = window as unknown as { requestIdleCallback?: (cb: IdleCallback) => number };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(cb);
  } else {
    setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 0);
  }
}

const THUMB_SIZE = 140;
const TIME_SLICE_MS = 8; // render a bit more than one thumbnail per idle tick when there's headroom

export function createSeedGrid(container: HTMLElement, cols = 4, rows = 3): SeedGrid {
  let generation = 0; // bumped on every render() call to cancel any in-flight progressive fill

  function render(
    baseSeed: number,
    generate: (seed: number) => Layer[],
    page: PageSpec,
    onSelect: (seed: number) => void,
  ): void {
    const myGeneration = ++generation;
    container.innerHTML = '';
    container.classList.add('seed-grid');
    container.style.setProperty('--seed-grid-cols', String(cols));

    const images: HTMLImageElement[] = [];

    for (let i = 0; i < cols * rows; i++) {
      const seed = baseSeed + i;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'seed-grid-cell';
      cell.title = `Seed ${seed} -- click to load`;
      cell.addEventListener('click', () => onSelect(seed));

      const img = document.createElement('img');
      img.width = THUMB_SIZE;
      img.alt = `Preview of seed ${seed}`;

      const label = document.createElement('span');
      label.textContent = String(seed);

      cell.appendChild(img);
      cell.appendChild(label);
      container.appendChild(cell);
      images.push(img);
    }

    let index = 0;
    function step(): void {
      if (myGeneration !== generation) return; // superseded by a newer render() call
      const start = performance.now();
      // Always make at least one thumbnail of forward progress per tick,
      // and a few more if there's idle time to spare.
      while (index < images.length && (index === 0 || performance.now() - start < TIME_SLICE_MS)) {
        const seed = baseSeed + index;
        const layers = generate(seed);
        images[index]!.src = renderThumbnail(layers, page, THUMB_SIZE);
        index++;
      }
      if (index < images.length) scheduleIdle(step);
    }
    scheduleIdle(step);
  }

  function destroy(): void {
    generation++; // cancel any in-flight progressive render
    container.innerHTML = '';
  }

  return { render, destroy };
}
