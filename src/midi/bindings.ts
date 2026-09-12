/**
 * Bindings: hardware events -> engine actions. This is the only file that decides what a
 * button *does*. Absolute controls pass through soft takeover first.
 */
import type { EngineAction } from '../engine/actions.ts';
import { BEATLOOP_SIZES } from '../engine/selectors.ts';
import type { EngineState } from '../engine/types.ts';
import { SoftTakeover } from './softTakeover.ts';
import type { DeckIndex, Flx2Event, PadMode } from './types.ts';

export interface EngineApi {
  getState(): EngineState;
  dispatch(action: EngineAction): void;
}

export const takeoverKey = {
  tempo: (d: DeckIndex) => `d${d}.tempo`,
  channel: (d: DeckIndex, p: 'eqHi' | 'eqMid' | 'eqLow' | 'fader' | 'cfx') => `ch${d}.${p}`,
  crossfader: 'crossfader',
  master: (p: 'masterLevel' | 'phonesLevel') => `master.${p}`,
} as const;

/** What a pad does in each firmware mode. Shared by hardware pads and on-screen pads. */
export function padActions(deck: DeckIndex, mode: PadMode, pad: number, shift: boolean, pressed: boolean): EngineAction[] {
  switch (mode) {
    case 'hotcue':
      if (shift) return pressed ? [{ type: 'deck/hotCueDelete', deck, index: pad }] : [];
      return [{ type: 'deck/hotCue', deck, index: pad, pressed }];
    case 'padfx':
      // SHIFT + pad triggers the same effect (a second FX bank can hang off `shift` later).
      void shift;
      return [{ type: 'deck/padFx', deck, index: pad, pressed }];
    case 'beatloop':
      if (!pressed) return [];
      return shift ? [{ type: 'deck/loopExit', deck }] : [{ type: 'deck/beatLoop', deck, beats: BEATLOOP_SIZES[pad] }];
    case 'sampler':
      return [{ type: 'sampler/pad', slot: deck * 8 + pad, pressed, shift }];
  }
}

/** For this long after the unit connects, any control's first value is taken as-is (hardware is the truth). */
export const ADOPT_WINDOW_MS = 3000;

type Affects = DeckIndex | 'master';

export class Bindings {
  readonly takeover = new SoftTakeover();
  private readonly engine: EngineApi;
  private readonly takeoverListeners = new Set<() => void>();
  private readonly now: () => number;
  private connectedAt = Number.NEGATIVE_INFINITY;

  constructor(engine: EngineApi, now: () => number = () => performance.now()) {
    this.engine = engine;
    this.now = now;
  }

  /** The unit (re)connected: open the adopt window. */
  markConnected(): void {
    this.connectedAt = this.now();
  }

  /**
   * A control that was never touched may jump straight to the hardware position only right after
   * connecting, or when nothing it affects is audible. Otherwise it must be picked up.
   */
  private canAdopt(affects: Affects): boolean {
    if (this.now() - this.connectedAt < ADOPT_WINDOW_MS) return true;
    const s = this.engine.getState();
    if (affects === 'master') return !s.decks[0].playing && !s.decks[1].playing;
    return !s.decks[affects].playing;
  }

  /** A UI control moved: the hardware must pick the new value up. */
  uiChanged(key: string): void {
    this.takeover.release(key);
    this.notifyTakeover();
  }

  /** UI subscribes to draw "ghost" hardware positions for controls that aren't picked up yet. */
  onTakeover(fn: () => void): () => void {
    this.takeoverListeners.add(fn);
    return () => this.takeoverListeners.delete(fn);
  }

  releaseAll(): void {
    this.takeover.releaseAll();
    this.notifyTakeover();
  }

  private accept(key: string, hw: number, sw: number, affects: Affects): boolean {
    const ok = this.takeover.accept(key, hw, sw, this.canAdopt(affects));
    this.notifyTakeover();
    return ok;
  }

  private notifyTakeover(): void {
    for (const l of this.takeoverListeners) l();
  }

  handle(e: Flx2Event): void {
    const { dispatch } = this.engine;
    switch (e.kind) {
      case 'deckButton': {
        const deck = e.deck;
        switch (e.id) {
          case 'play':
            if (e.pressed) dispatch({ type: 'deck/playPause', deck });
            return;
          case 'playShift':
            if (e.pressed) dispatch({ type: 'deck/stutter', deck });
            return;
          case 'cue':
            dispatch({ type: 'deck/cue', deck, pressed: e.pressed });
            return;
          case 'cueShift':
            if (e.pressed) dispatch({ type: 'deck/jumpStart', deck });
            return;
          case 'sync':
            if (e.pressed) dispatch({ type: 'deck/syncToggle', deck });
            return;
          case 'syncLong':
            if (e.pressed) dispatch({ type: 'deck/setMaster', deck });
            return;
          case 'syncShift':
            if (e.pressed) dispatch({ type: 'deck/padModeSelect', deck });
            return;
          case 'shift':
            dispatch({ type: 'deck/shift', deck, down: e.pressed });
            return;
          case 'chCue':
            if (e.pressed) dispatch({ type: 'mixer/pfl', ch: deck });
            return;
          case 'chCueShift':
            if (e.pressed) dispatch({ type: 'ui/toast', text: `SHIFT + CUE (CH ${deck + 1}) received — not assigned yet`, tone: 'info' });
            return;
          case 'faderStartPlay':
            if (e.pressed) dispatch({ type: 'deck/faderStart', deck, action: 'play' });
            return;
          case 'faderStartSync':
            if (e.pressed) dispatch({ type: 'deck/faderStart', deck, action: 'sync' });
            return;
          case 'faderStartCue':
            if (e.pressed) dispatch({ type: 'deck/faderStart', deck, action: 'cue' });
            return;
        }
        return;
      }

      case 'globalButton': {
        if (!e.pressed) return;
        if (e.id === 'masterCue') dispatch({ type: 'mixer/masterCue' });
        else if (e.id === 'masterCueShift') dispatch({ type: 'mixer/smartCfx' });
        else if (e.id === 'smartFader') dispatch({ type: 'mixer/smartFader' });
        else dispatch({ type: 'ui/toast', text: 'SHIFT + SMART FADER received — not assigned yet' });
        return;
      }

      case 'jogTouch':
        dispatch({ type: 'deck/jogTouch', deck: e.deck, touched: e.touched });
        return;

      case 'jog': {
        const d = this.engine.getState().decks[e.deck];
        const mode = e.surface === 'search' ? 'search' : e.surface === 'vinyl' && d.jogTouched && d.vinyl ? 'scratch' : 'bend';
        dispatch({ type: 'deck/jog', deck: e.deck, mode, ticks: e.ticks });
        return;
      }

      case 'deckAbs': {
        const s = this.engine.getState();
        if (e.id === 'tempo') {
          const d = s.decks[e.deck];
          const sw = (d.tempoPos + 1) / 2;
          if (this.accept(takeoverKey.tempo(e.deck), e.value, sw, e.deck)) {
            dispatch({ type: 'deck/tempo', deck: e.deck, value01: e.value });
          }
          return;
        }
        const param = e.id === 'chFader' ? 'fader' : e.id;
        const sw = s.mixer.ch[e.deck][param];
        if (this.accept(takeoverKey.channel(e.deck, param), e.value, sw, e.deck)) {
          dispatch({ type: 'mixer/set', ch: e.deck, param, value: e.value });
        }
        return;
      }

      case 'globalAbs': {
        const s = this.engine.getState();
        if (e.id === 'cfx1' || e.id === 'cfx2') {
          const ch: DeckIndex = e.id === 'cfx1' ? 0 : 1;
          if (this.accept(takeoverKey.channel(ch, 'cfx'), e.value, s.mixer.ch[ch].cfx, ch)) {
            dispatch({ type: 'mixer/set', ch, param: 'cfx', value: e.value });
          }
        } else if (e.id === 'crossfader') {
          if (this.accept(takeoverKey.crossfader, e.value, s.mixer.crossfader, 'master')) {
            dispatch({ type: 'mixer/crossfader', value: e.value });
          }
        } else {
          if (this.accept(takeoverKey.master(e.id), e.value, s.mixer[e.id], 'master')) {
            dispatch({ type: 'mixer/master', param: e.id, value: e.value });
          }
        }
        return;
      }

      case 'pad': {
        if (e.mode === 'unknown') return;
        if (e.pressed) dispatch({ type: 'deck/padMode', deck: e.deck, mode: e.mode, fromHardware: true });
        for (const a of padActions(e.deck, e.mode, e.pad, e.shift, e.pressed)) dispatch(a);
        return;
      }

      case 'sysex':
        return;
    }
  }
}
