import { describe, expect, it } from 'vitest';
import { parseConfigFromSvg, toSvg } from '../svg.ts';
import { createConfig } from '../../core/config.ts';
import { flowField } from '../../generators/flowField.ts';
import { PAGES } from '../../core/page.ts';
import type { PageSpec, Layer } from '../../core/types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

function makeConfig(seed = 42) {
  return createConfig({
    generator: flowField.id,
    seed,
    page,
    pen: { widthMm: 0.3, color: '#111111' },
    params: flowField.defaults,
  });
}

describe('toSvg', () => {
  it('sets mm width/height with a matching unitless viewBox', () => {
    const svg = toSvg([], page, makeConfig());
    expect(svg).toContain(`width="${page.width}mm"`);
    expect(svg).toContain(`height="${page.height}mm"`);
    expect(svg).toContain(`viewBox="0 0 ${page.width} ${page.height}"`);
  });

  it('never sets a fill other than none, and sets an explicit stroke', () => {
    const layers = flowField.generate(42, page, flowField.defaults);
    const svg = toSvg(layers, page, makeConfig());
    const fillMatches = svg.match(/fill="([^"]*)"/g) ?? [];
    expect(fillMatches.length).toBeGreaterThan(0);
    for (const m of fillMatches) {
      expect(m).toBe('fill="none"');
    }
    expect(svg).toMatch(/stroke="[^"]+"/);
  });

  it('emits one inkscape layer group per Layer, correctly labelled', () => {
    const layers: Layer[] = [
      { name: '1', paths: [[[10, 10], [20, 20]]], color: '#000' },
      { name: '2', paths: [[[30, 30], [40, 40]]], color: '#f00' },
    ];
    const svg = toSvg(layers, page, makeConfig());
    const groupMatches = svg.match(/<g inkscape:groupmode="layer"/g) ?? [];
    expect(groupMatches).toHaveLength(2);
    expect(svg).toContain('inkscape:label="1"');
    expect(svg).toContain('inkscape:label="2"');
  });

  it('rounds coordinates to 3 decimal places', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[20.123456, 45.2222], [21.05, 45.888888]]], color: '#000' }];
    const svg = toSvg(layers, page, makeConfig());
    expect(svg).toContain('20.123,45.222');
    expect(svg).toContain('21.05,45.889');
    // No coordinate should carry more than 3 decimal digits.
    const overPrecise = svg.match(/\d+\.\d{4,}/);
    expect(overPrecise).toBeNull();
  });

  it('uses <polyline> for paths and applies no transforms', () => {
    const layers: Layer[] = [{ name: '1', paths: [[[1, 1], [2, 2], [3, 1]]], color: '#000' }];
    const svg = toSvg(layers, page, makeConfig());
    expect(svg).toContain('<polyline points="1,1 2,2 3,1"/>');
    expect(svg).not.toContain('transform=');
  });

  it('embeds the full SketchConfig as JSON in <metadata id="sketch-config">', () => {
    const config = makeConfig(99);
    const svg = toSvg([], page, config);
    expect(svg).toContain('<metadata id="sketch-config">');
    const parsed = parseConfigFromSvg(svg);
    expect(parsed).toEqual(config);
  });

  it('round-trips arbitrary JSON-unsafe characters in metadata (label/notes)', () => {
    const config = { ...makeConfig(1), meta: { ...makeConfig(1).meta, label: 'A & B <weird> "label"', notes: 'x < y & y > z' } };
    const svg = toSvg([], page, config);
    const parsed = parseConfigFromSvg(svg);
    expect(parsed.meta.label).toBe('A & B <weird> "label"');
    expect(parsed.meta.notes).toBe('x < y & y > z');
  });
});

describe('export -> load -> export round trip', () => {
  it('produces identical geometry and identical SVG output', () => {
    const layers = flowField.generate(42, page, flowField.defaults);
    const config = makeConfig(42);

    const firstSvg = toSvg(layers, page, config);
    const loadedConfig = parseConfigFromSvg(firstSvg);

    // Regenerate from the loaded config -- this is what "Load config" does.
    const regenerated = flowField.generate(
      loadedConfig.seed,
      loadedConfig.page,
      loadedConfig.params as unknown as typeof flowField.defaults,
    );
    expect(regenerated).toEqual(layers);

    const secondSvg = toSvg(regenerated, page, loadedConfig);
    expect(secondSvg).toBe(firstSvg);
  });
});
