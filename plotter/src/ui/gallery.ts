/**
 * The index/gallery page: lists every generator in `generators/registry.ts`
 * and links to its mini-app via `?g=<id>` (a real page navigation, not
 * client-side routing -- see `main.ts` for why). Adding a generator to the
 * registry is the only thing that changes what shows up here -- including
 * its card's preview thumbnail, which is rendered on the fly from that
 * generator's own `defaults`, not a hand-drawn image someone has to
 * remember to update.
 */
import { REGISTRY, type GeneratorEntry } from '../generators/registry.ts';
import { PAGES } from '../core/page.ts';
import type { PageSpec } from '../core/types.ts';
import { renderThumbnail } from './preview.ts';

// One fixed page + seed for every card, so thumbnails are comparable at a
// glance and reproducible -- this is deliberately the same shape of call
// (`generate(seed, page, defaults)`) every generator is already tested
// against, just rendered instead of asserted on.
const SAMPLE_PAGE: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };
const SAMPLE_SEED = 42;
const THUMB_SIZE = 400;

function renderSampleThumbnail(entry: GeneratorEntry): string {
  try {
    const layers = entry.generator.generate(SAMPLE_SEED, SAMPLE_PAGE, entry.generator.defaults);
    return renderThumbnail(layers, SAMPLE_PAGE, THUMB_SIZE);
  } catch {
    // A broken generator shouldn't take the whole gallery down -- it just
    // gets a blank card instead of a sample image.
    return '';
  }
}

export function runGallery(root: HTMLElement): void {
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.id = 'gallery';
  wrap.innerHTML = `
    <h1>Plotter Art Framework</h1>
    <p class="gallery-intro">Pick a generator to open its live, tunable preview and export plotter-ready SVGs.</p>
    <div id="gallery-grid"></div>
  `;
  root.appendChild(wrap);

  const grid = wrap.querySelector<HTMLElement>('#gallery-grid')!;
  for (const entry of REGISTRY) {
    const card = document.createElement('a');
    card.className = 'gallery-card';
    card.href = `?g=${encodeURIComponent(entry.generator.id)}`;

    const thumb = document.createElement('div');
    thumb.className = 'gallery-card-thumb';
    const img = document.createElement('img');
    img.alt = `Sample ${entry.title} output`;
    img.src = renderSampleThumbnail(entry);
    thumb.appendChild(img);

    const title = document.createElement('div');
    title.className = 'gallery-card-title';
    title.textContent = entry.title;

    const desc = document.createElement('div');
    desc.className = 'gallery-card-desc';
    desc.textContent = entry.description;

    card.append(thumb, title, desc);
    grid.appendChild(card);
  }
}
