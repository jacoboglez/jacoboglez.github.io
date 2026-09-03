import { describe, expect, it } from 'vitest';
import { randomizeParams } from '../paramUtils.ts';
import { flowFieldSchema, flowField } from '../../generators/flowField.ts';
import { createRng } from '../random.ts';

describe('randomizeParams', () => {
  it('leaves locked parameters untouched', () => {
    const current = { ...flowField.defaults, noiseScale: 0.0123, turns: 3.5 };
    const locks = { noiseScale: true, turns: true };
    const rng = createRng(1);
    const next = randomizeParams(flowFieldSchema, current, locks, rng);

    expect(next.noiseScale).toBe(0.0123);
    expect(next.turns).toBe(3.5);
  });

  it('changes at least one unlocked parameter (overwhelmingly likely across many keys)', () => {
    const current = flowField.defaults;
    const rng = createRng(2);
    const next = randomizeParams(flowFieldSchema, current, {}, rng);
    expect(next).not.toEqual(current);
  });

  it('keeps every randomised value within its schema range', () => {
    const rng = createRng(3);
    const next = randomizeParams(flowFieldSchema, flowField.defaults, {}, rng);
    for (const [key, spec] of Object.entries(flowFieldSchema)) {
      if (spec.kind === 'number' || spec.kind === 'int') {
        const v = next[key as keyof typeof next] as number;
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('is deterministic for a given rng sequence', () => {
    const a = randomizeParams(flowFieldSchema, flowField.defaults, {}, createRng(9));
    const b = randomizeParams(flowFieldSchema, flowField.defaults, {}, createRng(9));
    expect(a).toEqual(b);
  });
});
