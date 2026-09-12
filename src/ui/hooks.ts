import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EngineAction } from '../engine/actions.ts';
import type { EngineState, SettingsSection, View } from '../engine/types.ts';
import { bindings, host, midi, store, virtualUnit } from '../runtime.ts';

/** Select from the engine store; re-renders only when the selected value changes. */
export function useEngine<T>(selector: (s: EngineState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const sel = useRef(selector);
  sel.current = selector;
  const cache = useRef<{ has: boolean; value: T }>({ has: false, value: undefined as T });
  const getSnapshot = useCallback(() => {
    const next = sel.current(store.getState());
    const c = cache.current;
    if (c.has && equal(c.value, next)) return c.value;
    cache.current = { has: true, value: next };
    return next;
  }, [equal]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function shallowArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export const dispatch = (a: EngineAction) => store.dispatch(a);

/** Driver status + init report; changes are rare so a version counter is enough. */
let midiVersion = 0;
midi.onStatus(() => midiVersion++);
export function useMidiStatus() {
  useSyncExternalStore(
    (cb) => midi.onStatus(cb),
    () => midiVersion,
  );
  return { status: midi.status, report: midi.report, virtual: midi.virtual !== null, learnTarget: midi.learnTarget, learned: midi.learned };
}

export function useHost() {
  return useSyncExternalStore(host.subscribe, host.getState);
}

export function useVirtualVersion(): number {
  return useSyncExternalStore(
    (cb) => virtualUnit.subscribe(cb),
    () => virtualUnit.getVersion(),
  );
}

/** Hardware position of an absolute control that hasn't been picked up yet (soft takeover). */
export function useGhost(key: string | undefined): number | null {
  const snap = useSyncExternalStore(
    (cb) => bindings.onTakeover(cb),
    () => {
      if (!key) return '';
      const p = bindings.takeover.peek(key);
      return p.engaged || p.hw === undefined ? '' : p.hw.toFixed(3);
    },
  );
  return snap === '' ? null : Number(snap);
}

/** Runs `draw` every animation frame while mounted (canvas renderers read the store directly). */
export function useRaf(draw: (now: number) => void): void {
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    let id = 0;
    const loop = (now: number) => {
      fn.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Canvas sized to its box at device-pixel resolution. Returns [ref, size] with size in CSS px. */
export function useCanvas(): [RefObject<HTMLCanvasElement | null>, RefObject<{ w: number; h: number; dpr: number }>] {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Wall clock "HH:MM" for the top bar; ticks every 10 s. */
export function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setNow(fmt()), 10_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Jump to a screen (and, for Settings, a section). */
export function goTo(view: View, section?: SettingsSection): void {
  if (section) dispatch({ type: 'ui/settingsSection', section });
  dispatch({ type: 'ui/view', view });
}
