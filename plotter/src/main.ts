/**
 * The whole app is now a thin router over one query param: `?g=<id>` opens
 * that generator's mini-app (`ui/sketchApp.ts`); no `g`, or an unrecognised
 * one, shows the gallery (`ui/gallery.ts`) instead. Real page loads rather
 * than client-side routing, deliberately -- switching sketches this way
 * needs no teardown logic for the previous app's canvas/Tweakpane/listeners,
 * which a SPA router would otherwise have to get exactly right for every
 * generator, forever.
 *
 * This file is intentionally the only thing that knows both "gallery" and
 * "sketch app" exist; everything it dispatches to is independently testable
 * and knows nothing about the other mode.
 */
import './style.css';
import { findEntry } from './generators/registry.ts';
import { runGallery } from './ui/gallery.ts';
import { runSketchApp } from './ui/sketchApp.ts';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('index.html is missing #root.');

const generatorId = new URLSearchParams(window.location.search).get('g');
const entry = generatorId ? findEntry(generatorId) : undefined;

if (entry) {
  runSketchApp(entry, root);
} else {
  if (generatorId) {
    // eslint-disable-next-line no-console
    console.warn(`Unknown generator "${generatorId}" in the URL -- showing the gallery instead.`);
  }
  runGallery(root);
}
