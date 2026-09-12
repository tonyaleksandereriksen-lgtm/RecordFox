import { DEMO_PLAYLISTS, buildDemoSamples, buildDemoTracks } from './demoLibrary.ts';
import type { ChannelState, DeckState, EngineState, Prefs } from './types.ts';

export const DEFAULT_PREFS: Prefs = {
  waveStyle: 'deck',
  defaultTempoRange: 10,
  defaultQuantize: true,
  needleLock: true,
  faderStart: 'smart',
  statusDump: true,
};

export function initialDeck(prefs: Prefs = DEFAULT_PREFS): DeckState {
  return {
    track: null,
    playing: false,
    positionSec: 0,
    cueSec: 0,
    cueHeld: false,
    cuePreview: false,
    hotCues: Array(8).fill(null),
    hotCueHeld: null,
    hotCuePreview: false,
    sync: false,
    master: false,
    tempoRange: prefs.defaultTempoRange,
    tempoPos: 0,
    bend: 0,
    quantize: prefs.defaultQuantize,
    keyLock: true,
    slip: false,
    slipPos: null,
    gridTaps: [],
    loop: { inSec: null, outSec: null, active: false, beats: null },
    beatJumpBeats: 4,
    padMode: 'hotcue',
    padModeKnown: false,
    padModeSelecting: false,
    padFxHeld: null,
    vinyl: true,
    jogTouched: false,
    shift: false,
    loadSeq: 0,
    seekSeq: 0,
    engine: false,
  };
}

function initialChannel(): ChannelState {
  return { trim: 0.5, eqHi: 0.5, eqMid: 0.5, eqLow: 0.5, cfx: 0.5, fader: 0, pfl: false };
}

export function initialState(prefs: Prefs = DEFAULT_PREFS): EngineState {
  const slots = buildDemoSamples();
  return {
    clock: 0,
    decks: [initialDeck(prefs), initialDeck(prefs)],
    mixer: {
      ch: [initialChannel(), initialChannel()],
      crossfader: 0.5,
      masterLevel: 0.8,
      phonesLevel: 0.6,
      phonesMix: 0.5,
      masterCue: false,
      smartFader: false,
      smartCfx: false,
    },
    sampler: { slots, playing: slots.map(() => false), startedAt: slots.map(() => 0) },
    library: { tracks: buildDemoTracks(), playlists: DEMO_PLAYLISTS, selectedId: 'demo-1', view: 'collection', query: '' },
    prefs,
    ui: { view: 'performance', bottomTab: 'library', settingsSection: 'controller', gridDeck: null, zoomSec: 4, toast: null },
  };
}
