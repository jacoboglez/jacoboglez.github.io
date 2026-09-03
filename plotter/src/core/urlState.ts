/**
 * URL state (spec §6.5): generator, seed and params serialise to the query
 * string, debounced, so a reload restores state and a link shares it. This
 * is convenience only -- the library (§6.3) is the durable store -- so keys
 * are kept short and numbers rounded rather than aiming for lossless
 * round-tripping of every float.
 */
import type { ParamSchema } from './types.ts';

const GENERATOR_KEY = 'g';
const SEED_KEY = 's';
const PARAM_PREFIX = 'p.';

function roundForUrl(n: number): number {
  // 4 significant decimal places is plenty for a shareable link; the
  // library remains the source of truth for exact reproduction.
  return Math.round(n * 10000) / 10000;
}

// `P extends Record<string, any>`, not a `number|boolean|string`-valued
// Record: a concrete generator's params type (e.g. `FlowFieldParams`) has
// no index signature, so a union-typed bound would reject every real call
// site. See core/config.ts for the same trade-off, spelled out.
export function stateToSearchParams<P extends Record<string, any>>(
  generator: string,
  seed: number,
  params: P,
): URLSearchParams {
  const usp = new URLSearchParams();
  usp.set(GENERATOR_KEY, generator);
  usp.set(SEED_KEY, String(seed));
  for (const [key, value] of Object.entries(params) as [string, number | boolean | string][]) {
    const v = typeof value === 'number' ? roundForUrl(value) : value;
    usp.set(`${PARAM_PREFIX}${key}`, String(v));
  }
  return usp;
}

export interface ParsedUrlState {
  generator: string | null;
  seed: number | null;
  params: Record<string, number | boolean | string>;
}

/**
 * Parses params back using `schema` to know each key's expected type
 * (number/int/boolean/select all round-trip through the query string as
 * plain strings, so the schema is what tells us how to coerce them back).
 */
export function searchParamsToState<P>(usp: URLSearchParams, schema: ParamSchema<P>): ParsedUrlState {
  const generator = usp.get(GENERATOR_KEY);
  const seedRaw = usp.get(SEED_KEY);
  const seed = seedRaw !== null && seedRaw !== '' && !Number.isNaN(Number(seedRaw)) ? Number(seedRaw) : null;

  const params: Record<string, number | boolean | string> = {};
  for (const key of Object.keys(schema as object) as (keyof P & string)[]) {
    const raw = usp.get(`${PARAM_PREFIX}${key}`);
    if (raw === null) continue;
    const spec = (schema as Record<string, { kind: string }>)[key]!;
    if (spec.kind === 'number' || spec.kind === 'int') {
      const n = Number(raw);
      if (!Number.isNaN(n)) params[key] = n;
    } else if (spec.kind === 'boolean') {
      params[key] = raw === 'true';
    } else {
      params[key] = raw;
    }
  }

  return { generator, seed, params };
}

/**
 * Debounces calls to `fn`, coalescing rapid calls (e.g. a slider drag) into
 * one trailing invocation `delayMs` after the last one.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): (...args: A) => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, delayMs);
  };
}
