import { describe, expect, it, vi } from 'vitest';
import { debounce, searchParamsToState, stateToSearchParams } from '../urlState.ts';
import { flowFieldSchema } from '../../generators/flowField.ts';

describe('stateToSearchParams / searchParamsToState', () => {
  it('round-trips generator, seed, and params through the query string', () => {
    const params = { nLines: 400, maxSteps: 600, stepSize: 1.0, noiseScale: 0.01, turns: 1, octaves: 3, separation: 2, minLength: 10, fieldResolution: 1 };
    const usp = stateToSearchParams('flowField', 42, params);
    const parsed = searchParamsToState(usp, flowFieldSchema);

    expect(parsed.generator).toBe('flowField');
    expect(parsed.seed).toBe(42);
    expect(parsed.params).toEqual(params);
  });

  it('rounds numbers to keep the URL compact without losing meaningful precision', () => {
    const usp = stateToSearchParams('flowField', 1, { noiseScale: 0.0123456789 });
    expect(usp.get('p.noiseScale')).toBe('0.0123');
  });

  it('returns nulls/empty when the query string has no relevant keys', () => {
    const parsed = searchParamsToState(new URLSearchParams(''), flowFieldSchema);
    expect(parsed.generator).toBeNull();
    expect(parsed.seed).toBeNull();
    expect(parsed.params).toEqual({});
  });

  it('coerces boolean-schema params correctly', () => {
    const schema = { draft: { kind: 'boolean', label: 'Draft', default: false } } as const;
    const usp = new URLSearchParams('p.draft=true');
    const parsed = searchParamsToState(usp, schema as any);
    expect(parsed.params.draft).toBe(true);
  });
});

describe('debounce', () => {
  it('coalesces rapid calls into one trailing invocation', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);

    vi.useRealTimers();
  });
});
