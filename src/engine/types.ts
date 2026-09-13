import type { PadMode } from '../midi/types.ts';

export type DeckIndex = 0 | 1;
export type TempoRange = 6 | 10 | 16;
/** 'deck' = single deck colour (design vision default); the brief's three styles remain available. */
export type WaveStyle = 'deck' | 'rgb' | '3band' | 'blue';
export type View = 'performance' | 'library' | 'export' | 'settings';
export type BottomTab = 'library' | 'monitor' | 'virtual';
export type SettingsSection = 'controller' | 'audio' | 'preferences' | 'about';
/** When the unit's fader-start notes (9n 66/5D/52) may start/stop decks. */
export type FaderStartMode = 'smart' | 'always' | 'off';

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: string;
  /** 0 until analysed (local files before M2); grid features then assume 120. */
  bpm: number;
  /** Camelot notation, e.g. "8A"; "" until analysed. */
  key: string;
  durationSec: number;
  /** First downbeat of the beat grid, in seconds. With `bpm` this is the whole grid. */
  firstBeatSec: number;
  /** What analysis said before the grid was corrected by hand; absent while the grid is untouched. */
  bpmOriginal?: number;
  firstBeatSecOriginal?: number;
  /** Artwork hue (demo artwork is generated). */
  hue: number;
  /** Seed for generated artwork and the demo waveform. Real analysis replaces the waveform in slice 2. */
  seed: number;
  source: 'demo' | 'local' | 'stream';
  /** Absolute path on disk for local files — what the native engine decodes. */
  path?: string;
  /** From the file's tags, when it has them. */
  album?: string;
  year?: number;
  /** File identity for the analysis cache: a changed file is analysed again. */
  fileSize?: number;
  fileMtime?: number;
  sampleRate?: number;
  bitrateKbps?: number;
  /** Analysis provenance. `keyMargin` small (< 0.05) means the key is ambiguous (relative major/minor). */
  analysedAt?: number;
  bpmConfidence?: number;
  keyName?: string;
  keyMargin?: number;
  /** Set when analysis failed; the track still plays. */
  analysisError?: string;
  /** Hot cues A–H in seconds; saved with the library. */
  cues?: (number | null)[];
  rating: number; // 0..5
  comment: string;
  playlists: string[];
  addedAt: number; // epoch ms
}

export interface Playlist {
  id: string;
  name: string;
  /** Smart lists are computed, not edited. */
  smart?: 'favorites' | 'recent';
}

export interface HotCue {
  posSec: number;
}

export interface LoopState {
  inSec: number | null;
  outSec: number | null;
  active: boolean;
  beats: number | null;
}

export interface DeckState {
  track: Track | null;
  playing: boolean;
  positionSec: number;
  cueSec: number;
  cueHeld: boolean;
  cuePreview: boolean;
  hotCues: (HotCue | null)[];
  hotCueHeld: number | null;
  hotCuePreview: boolean;
  sync: boolean;
  master: boolean;
  tempoRange: TempoRange;
  /** Tempo slider position, -1 ("−" end) .. +1 ("+" end). Percent = pos × range. */
  tempoPos: number;
  /** Transient rate offset from jog pitch bend; decays to 0. */
  bend: number;
  quantize: boolean;
  keyLock: boolean;
  /** Slip mode: scratches, loops and momentary hot cues return to where the track would have been. */
  slip: boolean;
  slipPos: number | null;
  /** Clock times of recent taps while setting the BPM by ear (tap tempo). */
  gridTaps: number[];
  loop: LoopState;
  beatJumpBeats: number;
  padMode: PadMode;
  /** false until the unit tells us (first pad press) — pad mode lives in the firmware. */
  padModeKnown: boolean;
  padModeSelecting: boolean;
  padFxHeld: number | null;
  vinyl: boolean;
  jogTouched: boolean;
  shift: boolean;
  /** Increments on every load; the LED writer turns it into the load illumination message. */
  loadSeq: number;
  /**
   * Increments whenever the playhead jumps (cue, hot cue, beat jump, needle search, loop wrap…)
   * as opposed to moving with time or under the hand. The audio bridge turns each increment into
   * one engine seek — the same idea as the engine's own seek sequence number.
   */
  seekSeq: number;
  /**
   * The native engine holds this deck's track and its playhead is the clock: 'transport/tick'
   * no longer advances the position, 'transport/sync' sets it. False for demo tracks, in the
   * browser build, and while a file is still decoding.
   */
  engine: boolean;
}

export interface ChannelState {
  trim: number;
  eqHi: number;
  eqMid: number;
  eqLow: number;
  cfx: number;
  fader: number;
  pfl: boolean;
}

export interface MixerState {
  ch: [ChannelState, ChannelState];
  crossfader: number;
  masterLevel: number;
  phonesLevel: number;
  phonesMix: number;
  masterCue: boolean;
  smartFader: boolean;
  smartCfx: boolean;
}

export interface SamplerSlot {
  name: string;
  lengthSec: number;
}

export interface SamplerState {
  slots: (SamplerSlot | null)[];
  playing: boolean[];
  startedAt: number[];
}

export interface LibraryState {
  tracks: Track[];
  playlists: Playlist[];
  /** Music folders added on this machine (absolute paths); rescanned on request. */
  folders: string[];
  selectedId: string | null;
  /** 'collection' or a playlist id */
  view: string;
  query: string;
}

export interface Prefs {
  waveStyle: WaveStyle;
  defaultTempoRange: TempoRange;
  defaultQuantize: boolean;
  /** Block overview clicks on a playing deck unless Shift is held. */
  needleLock: boolean;
  faderStart: FaderStartMode;
  /** Electron only: ask the unit for its knob/fader positions at connect (optional SysEx). */
  statusDump: boolean;
  /** Output device name for the native engine; null = the DDJ-FLX2 if present, else the default output. */
  audioDevice: string | null;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'ok';
  at: number;
}

export interface UiState {
  view: View;
  bottomTab: BottomTab;
  settingsSection: SettingsSection;
  /** Deck whose beat grid is being edited (its bar lines turn red), or null. */
  gridDeck: DeckIndex | null;
  /** Seconds visible each side of the playhead in the scrolling waveform. */
  zoomSec: number;
  toast: Toast | null;
}

export interface EngineState {
  /** Seconds since start, advanced by transport ticks. */
  clock: number;
  decks: [DeckState, DeckState];
  mixer: MixerState;
  sampler: SamplerState;
  library: LibraryState;
  prefs: Prefs;
  ui: UiState;
}

/** What persistence saves per track (see lib/persist.ts). */
export interface TrackEdits {
  rating?: number;
  comment?: string;
  playlists?: string[];
  cues?: (number | null)[];
  /** Only written once the grid has been corrected by hand. */
  bpm?: number;
  firstBeatSec?: number;
}
