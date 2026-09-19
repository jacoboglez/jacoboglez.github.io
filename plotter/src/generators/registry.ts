/**
 * The list of generative-art "mini apps" this framework ships. This is the
 * one file a new generator needs to touch to become reachable from the
 * gallery and the `?g=<id>` router. Adding a new one is three steps:
 *
 *   1. Write `src/generators/yourThing.ts` implementing `Generator<P>`
 *      (see `flowField.ts` for the elaborate case, `randomWalk.ts` for the
 *      simple one -- both are equally valid shapes for this contract).
 *   2. Add its Vitest suite next to it, mirroring `randomWalk.test.ts`:
 *      determinism, in-bounds points, no path under 2 points, and the
 *      "no DOM globals" architecture guard.
 *   3. Add one entry to `REGISTRY` below.
 *
 * Nothing else changes: the gallery page, the `?g=<id>` router, the
 * sketch-app shell (preview/controls/library/export/URL-state/seed-grid)
 * all derive everything they need from this one list, because they're
 * written against `Generator<P>` and `GeneratorEntry`, never against a
 * specific generator.
 */
import type { Generator } from '../core/types.ts';
import { flowField } from './flowField.ts';
import { randomWalk } from './randomWalk.ts';
import { selfAvoidingWalk } from './selfAvoidingWalk.ts';
import { laserBounce } from './laserBounce.ts';
import { curlFlow } from './curlFlow.ts';

export interface GeneratorEntry {
  /** Type-erased to `Record<string, any>` so heterogeneous generators can share one list; call sites that generate/render go through the shell, which is itself generic over the concrete `P`. */
  readonly generator: Generator<Record<string, any>>;
  readonly title: string;
  readonly description: string;
}

// Each generator is concretely typed at its own declaration (`Generator<FlowFieldParams>`,
// `Generator<RandomWalkParams>`); it's only erased to `Generator<Record<string, any>>` here,
// where the registry needs one list type to hold all of them.
export const REGISTRY: readonly GeneratorEntry[] = [
  {
    generator: flowField as Generator<Record<string, any>>,
    title: 'Flow Field',
    description: 'Seeded vector-field line tracing — smooth, wind-blown strokes across the page.',
  },
  {
    generator: randomWalk as Generator<Record<string, any>>,
    title: 'Random Walk',
    description: 'Seeded random-walk paths — simple stepwise wandering lines that turn a little each step.',
  },
  {
    generator: selfAvoidingWalk as Generator<Record<string, any>>,
    title: 'Self-Avoiding Walk',
    description: 'One or more seeded walks (persistent, noise-driven, or Lévy-flight heading) that steer away from their own trail, the page margin, and each other, growing organically until boxed in.',
  },
  {
    generator: laserBounce as Generator<Record<string, any>>,
    title: 'Laser Bounce',
    description: 'A ray fired from the center of a triangle bounces off its walls like a mirror, tracing one unbroken path.',
  },
  {
    generator: curlFlow as Generator<Record<string, any>>,
    title: 'Curl Flow',
    description: 'Divergence-free noise streamlines, traced with RK4 from equispaced seeds on any combination of page edges — un-normalized velocity, no convergence artifacts.',
  },
];

export function findEntry(id: string): GeneratorEntry | undefined {
  return REGISTRY.find((e) => e.generator.id === id);
}
