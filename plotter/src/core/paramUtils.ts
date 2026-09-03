/**
 * Randomisation that respects per-parameter locks (spec §6.4). Locked
 * parameters are excluded from randomisation; everything else, including
 * a future parameter this generator doesn't know about yet, is left alone
 * too -- only keys present in `schema` are ever touched.
 *
 * Seed changes are a deliberately separate operation (see ui/controls.ts):
 * this function must never be reachable from a "change seed" action, and a
 * "randomise" action must never touch the seed. Conflating the two is
 * called out in the spec as a common and infuriating design mistake.
 */
import type { ParamSchema } from './types.ts';
import type { Rng } from './random.ts';

function roundToStep(value: number, step: number): number {
  if (!step) return value;
  return Math.round(value / step) * step;
}

// `P extends Record<string, any>` (not `Record<string, number|boolean|string>`)
// deliberately: a generator's own params interface (e.g. `FlowFieldParams`)
// has fixed keys and no index signature, so a union-typed `Record` bound
// would make every real call site fail TypeScript's "index signature is
// missing" check. Binding the value type to `any` sidesteps that check
// while still letting callers pass a concretely-typed params object -- see
// core/config.ts for the same trade-off, spelled out at more length.
export function randomizeParams<P extends Record<string, any>>(
  schema: ParamSchema<P>,
  current: P,
  locks: Partial<Record<keyof P, boolean>>,
  rng: Rng,
): P {
  const next = { ...current };

  for (const key of Object.keys(schema) as (keyof P)[]) {
    if (locks[key]) continue;
    const spec = schema[key];

    if (spec.kind === 'number') {
      next[key] = roundToStep(rng.float(spec.min, spec.max), spec.step) as P[typeof key];
    } else if (spec.kind === 'int') {
      next[key] = rng.int(spec.min, spec.max) as P[typeof key];
    } else if (spec.kind === 'boolean') {
      next[key] = (rng.float() < 0.5) as P[typeof key];
    } else if (spec.kind === 'select') {
      next[key] = spec.options[rng.int(0, spec.options.length - 1)]! as P[typeof key];
    }
  }

  return next;
}
