/**
 * Live levels from the engine, written by the bridge once per frame and read by the meter canvases
 * in their own animation frame. Kept out of the store on purpose: they change every frame and no
 * React component should re-render for them.
 */
export interface Meters {
  /** True once the native engine is running: the meters then show real peaks, not the demo guess. */
  live: boolean;
  /** Per-deck post-fader peak since the previous frame, 0..1+. */
  deck: [number, number];
  master: number;
}

export const meters: Meters = { live: false, deck: [0, 0], master: 0 };
