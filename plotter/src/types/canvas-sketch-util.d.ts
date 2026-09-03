/**
 * `canvas-sketch-util` ships no type declarations. This project only
 * touches its `random.js` submodule, and wraps it immediately behind the
 * fully-typed `Rng` interface in `core/random.ts` -- so an `any`-typed
 * shim here is fine: no application code imports this module directly.
 */
declare module 'canvas-sketch-util/random.js' {
  const random: any;
  export default random;
}
