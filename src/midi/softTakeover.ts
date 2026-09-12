/**
 * Soft takeover for absolute hardware controls (faders, knobs, tempo).
 *
 * A control starts in "adopt" mode: at app start the hardware is the truth, so its first value
 * is taken as-is. After that, whenever the software value changes by any other route (mouse,
 * sync, reset), hardware input is ignored until the physical control reaches the software
 * value — within `threshold`, or by crossing it between two consecutive messages.
 */
export interface TakeoverState {
  adopt: boolean;
  engaged: boolean;
  lastHw?: number;
  lastApplied?: number;
}

export class SoftTakeover {
  private readonly states = new Map<string, TakeoverState>();
  private readonly threshold: number;

  constructor(threshold = 0.035) {
    this.threshold = threshold;
  }

  private get(key: string): TakeoverState {
    let s = this.states.get(key);
    if (!s) {
      s = { adopt: true, engaged: false };
      this.states.set(key, s);
    }
    return s;
  }

  /**
   * Returns true when the hardware value may be applied to the software parameter.
   * `canAdopt` = false keeps an untouched control from being adopted (e.g. its deck is playing):
   * it then has to be picked up like any other mismatch.
   */
  accept(key: string, hw: number, sw: number, canAdopt = true): boolean {
    const s = this.get(key);
    if (s.engaged && s.lastApplied !== undefined && Math.abs(sw - s.lastApplied) > 1e-6) {
      s.engaged = false; // someone else moved the parameter since we last applied
    }
    if (!s.engaged) {
      if (s.adopt && canAdopt) {
        s.engaged = true;
      } else if (Math.abs(hw - sw) <= this.threshold) {
        s.engaged = true;
      } else if (s.lastHw !== undefined && (s.lastHw - sw) * (hw - sw) < 0) {
        s.engaged = true; // crossed the software value between two messages
      }
    }
    if (s.engaged) s.adopt = false;
    s.lastHw = hw;
    if (s.engaged) s.lastApplied = hw;
    return s.engaged;
  }

  /** Software changed this parameter from another source: hardware must pick it up again. */
  release(key: string): void {
    const s = this.get(key);
    s.engaged = false;
    s.adopt = false;
  }

  /** Every control must be picked up again (e.g. after the controller reconnects). */
  releaseAll(): void {
    for (const s of this.states.values()) {
      s.engaged = false;
      s.adopt = false;
      s.lastHw = undefined; // the controls may have moved while the unit was unplugged
    }
  }

  /** Last hardware position (for drawing a "ghost" marker) and whether it is in control. */
  peek(key: string): { hw?: number; engaged: boolean } {
    const s = this.states.get(key);
    return { hw: s?.lastHw, engaged: s ? s.engaged : false };
  }

  keys(): string[] {
    return [...this.states.keys()];
  }
}
