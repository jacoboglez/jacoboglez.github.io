/**
 * Core data contracts shared by every stage of the pipeline
 * (generation -> composition -> export -> plotting).
 *
 * Units are MILLIMETRES everywhere. No pixels enter this codebase except
 * inside `ui/preview.ts`, where world-to-screen conversion happens at the
 * last possible moment. There is no global scale factor: if a number in a
 * generator is not in mm, it is a bug.
 */

/** A single 2D point, in millimetres, in absolute page position. */
export type Point = readonly [number, number];

/** A polyline: an ordered sequence of points drawn as one continuous stroke. */
export type Path = Point[];

/** A group of paths drawn with one pen (one colour, one Inkscape layer). */
export interface Layer {
  /** Inkscape layer label, e.g. "1", "2". */
  readonly name: string;
  readonly paths: Path[];
  /** Preview only — ignored by the plotter. */
  readonly color: string;
}

/** Physical page dimensions and margin, in millimetres. */
export interface PageSpec {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
}

/** An axis-aligned rectangle, in millimetres. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// ---------------------------------------------------------------------------
// Parameter schema (see spec §7). Generators declare parameters as data so
// the UI, URL serialisation, and metadata export all derive from one
// definition instead of needing to be updated in multiple places.
// ---------------------------------------------------------------------------

export interface NumberParamSpec {
  readonly kind: 'number';
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: 'mm' | 'deg';
  readonly default: number;
}

export interface IntParamSpec {
  readonly kind: 'int';
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export interface BooleanParamSpec {
  readonly kind: 'boolean';
  readonly label: string;
  readonly default: boolean;
}

export interface SelectParamSpec {
  readonly kind: 'select';
  readonly label: string;
  readonly options: string[];
  readonly default: string;
}

export type ParamSpec = NumberParamSpec | IntParamSpec | BooleanParamSpec | SelectParamSpec;

export type ParamSchema<P> = { [K in keyof P]: ParamSpec };

/** Extracts the plain default-value shape `P` from a `ParamSchema<P>`. */
export function defaultsFromSchema<P>(schema: ParamSchema<P>): P {
  const out = {} as P;
  for (const key of Object.keys(schema) as (keyof P)[]) {
    out[key] = schema[key].default as P[typeof key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generator contract
// ---------------------------------------------------------------------------

export interface Generator<P> {
  readonly id: string;
  readonly defaults: P;
  /** Drives the UI (Tweakpane bindings), URL serialisation, and metadata export. */
  readonly schema: ParamSchema<P>;
  generate(seed: number, page: PageSpec, params: P): Layer[];
}

/** A type-erased generator, for holding heterogeneous generators in a registry. */
export type AnyGenerator = Generator<Record<string, number | boolean | string>>;
