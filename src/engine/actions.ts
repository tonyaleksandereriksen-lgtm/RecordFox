import type { PadMode } from '../midi/types.ts';
import type { BottomTab, DeckIndex, Prefs, SettingsSection, TrackEdits, View } from './types.ts';

export type ChannelParam = 'trim' | 'eqHi' | 'eqMid' | 'eqLow' | 'cfx' | 'fader';
export type MasterParam = 'masterLevel' | 'phonesLevel' | 'phonesMix';
export type JogMode = 'scratch' | 'bend' | 'search';

export type EngineAction =
  | { type: 'deck/load'; deck: DeckIndex; trackId: string }
  | { type: 'deck/eject'; deck: DeckIndex }
  | { type: 'deck/playPause'; deck: DeckIndex }
  | { type: 'deck/cue'; deck: DeckIndex; pressed: boolean }
  | { type: 'deck/stutter'; deck: DeckIndex }
  | { type: 'deck/jumpStart'; deck: DeckIndex }
  | { type: 'deck/syncToggle'; deck: DeckIndex }
  | { type: 'deck/setMaster'; deck: DeckIndex }
  | { type: 'deck/jogTouch'; deck: DeckIndex; touched: boolean }
  | { type: 'deck/jog'; deck: DeckIndex; mode: JogMode; ticks: number }
  | { type: 'deck/tempo'; deck: DeckIndex; value01: number }
  | { type: 'deck/tempoRange'; deck: DeckIndex }
  | { type: 'deck/tempoReset'; deck: DeckIndex }
  | { type: 'deck/hotCue'; deck: DeckIndex; index: number; pressed: boolean }
  | { type: 'deck/hotCueDelete'; deck: DeckIndex; index: number }
  | { type: 'deck/beatLoop'; deck: DeckIndex; beats: number }
  | { type: 'deck/loopIn'; deck: DeckIndex }
  | { type: 'deck/loopOut'; deck: DeckIndex }
  | { type: 'deck/loopExit'; deck: DeckIndex }
  | { type: 'deck/reloop'; deck: DeckIndex }
  | { type: 'deck/loopScale'; deck: DeckIndex; factor: 0.5 | 2 }
  | { type: 'deck/beatJump'; deck: DeckIndex; dir: -1 | 1 }
  | { type: 'deck/beatJumpSize'; deck: DeckIndex; dir: -1 | 1 }
  | { type: 'deck/quantize'; deck: DeckIndex }
  | { type: 'deck/keyLock'; deck: DeckIndex }
  | { type: 'deck/slip'; deck: DeckIndex }
  | { type: 'grid/downbeatHere'; deck: DeckIndex }
  | { type: 'grid/nudge'; deck: DeckIndex; ms: number }
  | { type: 'grid/scale'; deck: DeckIndex; factor: 0.5 | 2 }
  | { type: 'grid/bpm'; deck: DeckIndex; bpm: number }
  | { type: 'grid/tap'; deck: DeckIndex }
  | { type: 'grid/reset'; deck: DeckIndex }
  | { type: 'deck/padMode'; deck: DeckIndex; mode: PadMode; fromHardware: boolean }
  | { type: 'deck/padModeSelect'; deck: DeckIndex }
  | { type: 'deck/padFx'; deck: DeckIndex; index: number; pressed: boolean }
  | { type: 'deck/faderStart'; deck: DeckIndex; action: 'play' | 'sync' | 'cue' }
  | { type: 'deck/shift'; deck: DeckIndex; down: boolean }
  | { type: 'deck/seek'; deck: DeckIndex; positionSec: number }
  | { type: 'mixer/set'; ch: DeckIndex; param: ChannelParam; value: number }
  | { type: 'mixer/pfl'; ch: DeckIndex }
  | { type: 'mixer/crossfader'; value: number }
  | { type: 'mixer/master'; param: MasterParam; value: number }
  | { type: 'mixer/masterCue' }
  | { type: 'mixer/smartFader' }
  | { type: 'mixer/smartCfx' }
  | { type: 'sampler/pad'; slot: number; pressed: boolean; shift: boolean }
  | { type: 'transport/tick'; dt: number }
  | { type: 'library/select'; trackId: string | null }
  | { type: 'library/query'; query: string }
  | { type: 'library/view'; view: string }
  | { type: 'library/rate'; trackId: string; rating: number }
  | { type: 'library/comment'; trackId: string; comment: string }
  | { type: 'library/togglePlaylist'; trackId: string; playlistId: string }
  | { type: 'library/hydrate'; edits: Record<string, TrackEdits> }
  | { type: 'prefs/set'; patch: Partial<Prefs> }
  | { type: 'ui/view'; view: View }
  | { type: 'ui/bottomTab'; tab: BottomTab }
  | { type: 'ui/settingsSection'; section: SettingsSection }
  | { type: 'ui/gridDeck'; deck: DeckIndex | null }
  | { type: 'ui/zoom'; dir: -1 | 1 }
  | { type: 'ui/toast'; text: string; tone?: 'info' | 'warn' | 'ok' };
