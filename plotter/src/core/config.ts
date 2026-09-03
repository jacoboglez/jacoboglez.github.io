/**
 * The `SketchConfig` object: the one canonical shape used by every
 * reproducibility mechanism (embedded SVG metadata, the library, URL state).
 * See spec §6.
 */
import type { PageSpec } from './types.ts';

export const CURRENT_CONFIG_VERSION = 1 as const;

export interface SketchConfig {
  version: typeof CURRENT_CONFIG_VERSION;
  generator: string;
  seed: number;
  page: PageSpec;
  pen: { widthMm: number; color: string };
  params: Record<string, number | boolean | string>;
  meta: {
    createdAt: string; // ISO 8601
    label?: string;
    notes?: string;
    /** Per-parameter lock state (spec §6.4), restored when a config loads. */
    locks?: Record<string, boolean>;
  };
}

export interface MigrationResult {
  config: SketchConfig;
  /** Parameter names that were missing from `raw` and filled from defaults. */
  defaultedParams: string[];
}

/**
 * Migrates a raw, possibly-older or hand-edited config to the current
 * shape. Missing parameters are filled from `defaults` and reported by
 * name -- silent defaulting is how a "reproduced" config quietly isn't.
 *
 * There is only one config version today; future version bumps get their
 * own branch here rather than a rewrite of this function's shape.
 */
// `defaults` is bound to `Record<string, any>`, not `Record<string,
// number|boolean|string>`, for the same reason as `createConfig` below: a
// real generator's defaults object (e.g. `FlowFieldParams`) has fixed keys
// and no index signature, so a union-valued `Record` bound would reject
// every real caller. `any` sidesteps that specific check.
export function migrateConfig<D extends Record<string, any>>(
  raw: Partial<SketchConfig> & Pick<SketchConfig, 'generator' | 'seed' | 'page'>,
  defaults: D,
): MigrationResult {
  const defaultedParams: string[] = [];
  const params: Record<string, number | boolean | string> = { ...(raw.params ?? {}) };

  for (const key of Object.keys(defaults)) {
    if (!(key in params)) {
      params[key] = defaults[key];
      defaultedParams.push(key);
    }
  }

  const config: SketchConfig = {
    version: CURRENT_CONFIG_VERSION,
    generator: raw.generator,
    seed: raw.seed,
    page: raw.page,
    pen: raw.pen ?? { widthMm: 0.3, color: '#000000' },
    params,
    meta: {
      createdAt: raw.meta?.createdAt ?? new Date().toISOString(),
      label: raw.meta?.label,
      notes: raw.meta?.notes,
      locks: raw.meta?.locks,
    },
  };

  return { config, defaultedParams };
}

// `params` is bound to `Record<string, any>` rather than `Record<string,
// number|boolean|string>` so that passing a concrete generator's params
// object (e.g. `flowField.defaults`, typed `FlowFieldParams`) type-checks:
// TypeScript refuses to assign a named type with fixed keys and no index
// signature into a union-valued `Record`-typed parameter, even though every
// value in it is in fact a plain number/boolean/string; binding to `any`
// sidesteps that specific check without losing real type safety elsewhere.
export function createConfig<P extends Record<string, any>>(args: {
  generator: string;
  seed: number;
  page: PageSpec;
  pen: { widthMm: number; color: string };
  params: P;
  label?: string;
  notes?: string;
  locks?: Record<string, boolean>;
}): SketchConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    generator: args.generator,
    seed: args.seed,
    page: args.page,
    pen: args.pen,
    params: args.params,
    meta: {
      createdAt: new Date().toISOString(),
      label: args.label,
      notes: args.notes,
      locks: args.locks,
    },
  };
}
