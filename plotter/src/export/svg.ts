/**
 * SVG serialisation. The only stage besides `export/download.ts` that
 * produces browser-facing output; everything here is still a pure string
 * transform (no DOM required to run it, even though it's only ever called
 * from the browser).
 *
 * Output requirements (spec §5.6), all deliberately front-loaded because
 * they are annoying to retrofit:
 *  - width/height in mm with a matching unitless viewBox (1 user unit = 1mm)
 *  - fill="none" with an explicit stroke -- a filled path plots as an
 *    outline plus a pointless fill traversal
 *  - coordinates rounded to 3 decimals
 *  - one <g inkscape:groupmode="layer"> per Layer
 *  - <metadata> carries the full SketchConfig as JSON
 *  - no transforms anywhere; coordinates are baked
 */
import type { Layer, PageSpec } from '../core/types.ts';
import type { SketchConfig } from '../core/config.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const METADATA_ID = 'sketch-config';

/** Rounds to 3 decimal places and drops trailing zeros (keeps files small). */
function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeXmlText(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

export function toSvg(layers: Layer[], page: PageSpec, config: SketchConfig): string {
  const metadataJson = escapeXmlText(JSON.stringify(config));
  const penWidth = config.pen?.widthMm ?? 0.3;

  const groups = layers
    .map((layer) => {
      const stroke = layer.color || '#000000';
      const polylines = layer.paths
        .filter((path) => path.length >= 2)
        .map((path) => {
          const points = path.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
          return `    <polyline points="${points}"/>`;
        })
        .join('\n');

      const body = polylines.length > 0 ? `\n${polylines}\n  ` : '';
      return (
        `  <g inkscape:groupmode="layer" inkscape:label="${escapeXmlAttr(layer.name)}" ` +
        `fill="none" stroke="${escapeXmlAttr(stroke)}" stroke-width="${fmt(penWidth)}">${body}</g>`
      );
    })
    .join('\n');

  return (
    `<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" ` +
    `width="${fmt(page.width)}mm" height="${fmt(page.height)}mm" ` +
    `viewBox="0 0 ${fmt(page.width)} ${fmt(page.height)}">\n` +
    `  <metadata id="${METADATA_ID}">${metadataJson}</metadata>\n` +
    `${groups}\n` +
    `</svg>\n`
  );
}

/**
 * The inverse of `toSvg`'s metadata embedding: reads the `SketchConfig`
 * back out of an exported SVG's `<metadata id="sketch-config">` element.
 * Powers "Load config" (spec §6.2) -- export -> load -> export must be
 * geometry-identical, which starts with parsing this back exactly.
 */
export function parseConfigFromSvg(svgText: string): SketchConfig {
  const match = svgText.match(/<metadata id="sketch-config">([\s\S]*?)<\/metadata>/);
  if (!match) {
    throw new Error('No sketch-config metadata found in SVG. Was this file exported by this framework?');
  }
  const json = unescapeXmlText(match[1]!);
  return JSON.parse(json) as SketchConfig;
}
