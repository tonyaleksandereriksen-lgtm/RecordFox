/**
 * Engine reducer: (state, action) -> state. Pure and synchronous so every hardware gesture is
 * testable without Web MIDI or audio. Two clocks feed it: 'transport/tick' (the animation frame)
 * advances decks the native engine is not driving, and 'transport/sync' carries the engine's own
 * playheads for the decks it holds (`DeckState.engine`). The audio bridge mirrors the rest of the
 * state into the engine by diffing it, so every gesture stays a plain state change here.
 */
import type { EngineAction } from './actions.ts';
import {
  BEATJUMP_SIZES,
  BEND_DECAY_SEC,
  BEND_PER_TICK,
  FINE_SEEK_SEC_PER_TICK,
  SCRATCH_SEC_PER_TICK,
  SEARCH_SEC_PER_TICK,
  TEMPO_RANGES,
  atCue,
  baseRate,
  beatLen,
  beatPhase,
  masterDeckIndex,
  ownBpm,
  quantizeTime,
  syncMultiplier,
  tempoPct,
} from './selectors.ts';
import type { DeckIndex, DeckState, EngineState, MixerState, Track } from './types.ts';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

let toastSeq = 0;

function setDeck(s: EngineState, i: DeckIndex, patch: Partial<DeckState>): EngineState {
  const decks = s.decks.slice() as [DeckState, DeckState];
  decks[i] = { ...decks[i], ...patch };
  return { ...s, decks };
}

function setMixer(s: EngineState, patch: Partial<MixerState>): EngineState {
  return { ...s, mixer: { ...s.mixer, ...patch } };
}

function toast(s: EngineState, text: string, tone: 'info' | 'warn' | 'ok' = 'info'): EngineState {
  return { ...s, ui: { ...s.ui, toast: { id: ++toastSeq, text, tone, at: s.clock } } };
}

function clampPos(d: DeckState, t: number): number {
  return d.track ? clamp(t, 0, d.track.durationSec) : 0;
}

function updateTrack(s: EngineState, id: string, patch: Partial<Track>): EngineState {
  const tracks = s.library.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  const decks = s.decks.map((d) => (d.track && d.track.id === id ? { ...d, track: { ...d.track, ...patch } } : d)) as [DeckState, DeckState];
  return { ...s, decks, library: { ...s.library, tracks } };
}

/** Hot cues belong to the track: mirror the deck's cues into the library so they persist. */
function syncCues(s: EngineState, deck: DeckIndex): EngineState {
  const d = s.decks[deck];
  if (!d.track) return s;
  const cues = d.hotCues.map((c) => (c ? c.posSec : null));
  const tracks = s.library.tracks.map((t) => (t.id === d.track!.id ? { ...t, cues } : t));
  return { ...s, library: { ...s.library, tracks } };
}

/**
 * Keep exactly one MASTER when anything is loaded. When the master stops while the other deck
 * plays, the playing deck takes over — and if it was following, its current tempo is baked into
 * its own slider position first so nothing it plays changes speed.
 */
function fixMaster(s: EngineState): EngineState {
  const [a, b] = s.decks;
  const m = masterDeckIndex(s);
  let want: DeckIndex | null = m;
  if (m === null) {
    if (a.track && a.playing) want = 0;
    else if (b.track && b.playing) want = 1;
    else if (a.track) want = 0;
    else if (b.track) want = 1;
  } else {
    const other = (1 - m) as DeckIndex;
    if (!s.decks[m].playing && s.decks[other].playing && s.decks[other].track) want = other;
  }
  if (want === m && a.master === (m === 0) && b.master === (m === 1)) return s;
  const decks: [DeckState, DeckState] = [
    { ...a, master: want === 0 },
    { ...b, master: want === 1 },
  ];
  if (want !== null && m !== null && want !== m) {
    const d = s.decks[want];
    if (d.sync && d.track) {
      const pct = (baseRate(s, want) - 1) * 100;
      decks[want] = { ...decks[want], tempoPos: clamp(pct / d.tempoRange, -1, 1) };
    }
  }
  return { ...s, decks };
}

function loadTrack(d: DeckState, track: Track): DeckState {
  const hotCues = Array.from({ length: 8 }, (_, i) => {
    const c = track.cues?.[i];
    return c === null || c === undefined ? null : { posSec: c };
  });
  return {
    ...d,
    track,
    playing: false,
    positionSec: track.firstBeatSec,
    cueSec: track.firstBeatSec,
    cueHeld: false,
    cuePreview: false,
    hotCues,
    hotCueHeld: null,
    hotCuePreview: false,
    bend: 0,
    slipPos: null,
    loop: { inSec: null, outSec: null, active: false, beats: null },
    padFxHeld: null,
    jogTouched: false,
    loadSeq: d.loadSeq + 1,
    engine: false,
  };
}

function wrapLoop(d: DeckState, t: number): number {
  const { inSec, outSec, active } = d.loop;
  if (!active || inSec === null || outSec === null || outSec <= inSec) return t;
  if (t >= outSec) return inSec + ((t - inSec) % (outSec - inSec));
  return t;
}

/** Slip: start a shadow playhead if one isn't running (only while playing with slip on). */
function slipStart(d: DeckState): number | null {
  if (!d.slip || !d.playing) return d.slipPos;
  return d.slipPos ?? d.positionSec;
}

function tickDeck(s: EngineState, i: DeckIndex, dt: number): DeckState {
  const d = s.decks[i];
  let bend = d.bend;
  if (bend !== 0) {
    bend *= Math.exp(-dt / BEND_DECAY_SEC);
    if (Math.abs(bend) < 1e-4) bend = 0;
  }
  if (!d.track || !d.playing) {
    return bend === d.bend ? d : { ...d, bend };
  }
  const rate = Math.max(0, baseRate(s, i) + bend);
  // The shadow playhead keeps moving at the deck's normal rate, even while scratching.
  let slipPos = d.slipPos;
  if (slipPos !== null) slipPos = Math.min(d.track.durationSec, slipPos + dt * baseRate(s, i));
  // Under the hand the position comes from jog ticks; on an engine deck it comes from the engine.
  if ((d.jogTouched && d.vinyl) || d.engine) {
    return bend === d.bend && slipPos === d.slipPos ? d : { ...d, bend, slipPos };
  }
  let pos = wrapLoop(d, d.positionSec + dt * rate);
  let playing: boolean = d.playing;
  if (pos >= d.track.durationSec) {
    pos = d.track.durationSec;
    playing = false;
  }
  return { ...d, positionSec: pos, bend, playing, slipPos };
}

/** Quantized loop start at or before `t`, on a grid the size of the loop (¼-beat loops snap to ¼ beats). */
function loopStart(d: DeckState, t: number, beats: number): number {
  if (!d.track || !d.quantize) return t;
  const grid = Math.min(1, beats) * beatLen(d.track);
  const k = Math.floor((t - d.track.firstBeatSec) / grid + 1e-9);
  return Math.max(0, d.track.firstBeatSec + k * grid);
}

/** True while the platter is held in vinyl mode: the hand, not the clock, moves the playhead. */
function underHand(d: DeckState): boolean {
  return d.jogTouched && d.vinyl;
}

export function reduce(s: EngineState, a: EngineAction): EngineState {
  const next = reduceAction(s, a);
  if (next === s || a.type === 'transport/tick' || a.type === 'transport/sync') return next;
  // Any other change of position is a jump: count it so the audio bridge seeks the engine once.
  let decks = next.decks;
  for (const i of [0, 1] as DeckIndex[]) {
    if (next.decks[i].positionSec === s.decks[i].positionSec) continue;
    if (a.type === 'deck/jog' && a.mode === 'scratch' && a.deck === i) continue; // the hand dragging the playhead
    if (decks === next.decks) decks = decks.slice() as [DeckState, DeckState];
    decks[i] = { ...decks[i], seekSeq: decks[i].seekSeq + 1 };
  }
  return decks === next.decks ? next : { ...next, decks };
}

function reduceAction(s: EngineState, a: EngineAction): EngineState {
  switch (a.type) {
    case 'transport/tick': {
      const dt = clamp(a.dt, 0, 0.25);
      const d0 = tickDeck(s, 0, dt);
      const d1 = tickDeck(s, 1, dt);
      let sampler = s.sampler;
      if (sampler.playing.some(Boolean)) {
        const playing = sampler.playing.map((p, k) => p && s.clock - sampler.startedAt[k] < (sampler.slots[k]?.lengthSec ?? 0));
        if (playing.some((p, k) => p !== sampler.playing[k])) sampler = { ...sampler, playing };
      }
      let ui = s.ui;
      if (ui.toast && s.clock - ui.toast.at > 3.2) ui = { ...ui, toast: null };
      const busy = d0 !== s.decks[0] || d1 !== s.decks[1] || sampler !== s.sampler || ui !== s.ui;
      const next: EngineState = { ...s, clock: s.clock + dt };
      if (!busy) return next;
      const stopped = d0.playing !== s.decks[0].playing || d1.playing !== s.decks[1].playing;
      const out = { ...next, decks: [d0, d1] as [DeckState, DeckState], sampler, ui };
      return stopped ? fixMaster(out) : out;
    }

    case 'deck/load': {
      const track = s.library.tracks.find((t) => t.id === a.trackId);
      if (!track) return s;
      if (s.decks[a.deck].playing) return toast(s, `Deck ${a.deck === 0 ? 'A' : 'B'} is playing — pause it before loading`, 'warn');
      const decks = s.decks.slice() as [DeckState, DeckState];
      decks[a.deck] = loadTrack(decks[a.deck], track);
      return fixMaster({ ...s, decks, library: { ...s.library, selectedId: track.id } });
    }

    case 'deck/eject': {
      const d = s.decks[a.deck];
      if (!d.track || d.playing) return s;
      return fixMaster(setDeck(s, a.deck, { track: null, positionSec: 0, cueSec: 0, hotCues: Array(8).fill(null), master: false, sync: false, slipPos: null, engine: false }));
    }

    case 'deck/engine': {
      const d = s.decks[a.deck];
      if (d.engine === a.ready || (a.ready && !d.track)) return s;
      return setDeck(s, a.deck, { engine: a.ready });
    }

    case 'transport/sync': {
      let decks = s.decks;
      let stopped = false;
      for (const i of [0, 1] as DeckIndex[]) {
        const d = s.decks[i];
        const pos = a.positions[i];
        if (!d.engine || !d.track || pos === null) continue;
        // Under the hand the reducer's position is the target the engine follows, so keep it.
        const positionSec = underHand(d) ? d.positionSec : clampPos(d, pos);
        const playing = d.playing && !a.playing[i] ? false : d.playing;
        if (positionSec === d.positionSec && playing === d.playing) continue;
        if (decks === s.decks) decks = decks.slice() as [DeckState, DeckState];
        decks[i] = { ...d, positionSec, playing };
        if (playing !== d.playing) stopped = true;
      }
      if (decks === s.decks) return s;
      const out = { ...s, decks };
      return stopped ? fixMaster(out) : out;
    }

    case 'deck/playPause': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      if (d.cuePreview || d.hotCuePreview) {
        return fixMaster(setDeck(s, a.deck, { playing: true, cuePreview: false, hotCuePreview: false }));
      }
      if (!d.playing && d.positionSec >= d.track.durationSec - 0.01) return s;
      return fixMaster(setDeck(s, a.deck, { playing: !d.playing, slipPos: d.playing ? null : d.slipPos }));
    }

    case 'deck/cue': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      if (a.pressed) {
        if (d.playing && !d.cuePreview && !d.hotCuePreview) {
          return fixMaster(setDeck(s, a.deck, { playing: false, positionSec: d.cueSec, cueHeld: true, bend: 0, slipPos: null }));
        }
        if (!atCue(d)) {
          const cue = quantizeTime(d, d.positionSec);
          return setDeck(s, a.deck, { cueSec: cue, positionSec: cue, cueHeld: true });
        }
        return fixMaster(setDeck(s, a.deck, { playing: true, cuePreview: true, cueHeld: true }));
      }
      if (d.cuePreview) {
        return fixMaster(setDeck(s, a.deck, { playing: false, cuePreview: false, cueHeld: false, positionSec: d.cueSec }));
      }
      return setDeck(s, a.deck, { cueHeld: false });
    }

    case 'deck/stutter': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      return fixMaster(setDeck(s, a.deck, { positionSec: d.cueSec, playing: true, cuePreview: false, hotCuePreview: false }));
    }

    case 'deck/jumpStart': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      return setDeck(s, a.deck, { positionSec: 0 });
    }

    case 'deck/syncToggle': {
      const d = s.decks[a.deck];
      if (!d.track) return setDeck(s, a.deck, { sync: !d.sync });
      if (d.sync) {
        // Leaving sync: bake the synced tempo into the deck so nothing jumps. The hardware slider
        // no longer matches, so soft takeover will make it pick up this value.
        const pct = (baseRate(s, a.deck) - 1) * 100;
        return setDeck(s, a.deck, { sync: false, tempoPos: clamp(pct / d.tempoRange, -1, 1) });
      }
      let next = setDeck(s, a.deck, { sync: true });
      const other = (1 - a.deck) as DeckIndex;
      const o = next.decks[other];
      if (masterDeckIndex(next) === null || next.decks[a.deck].master) {
        if (o.track && o.playing) {
          next = { ...next, decks: [{ ...next.decks[0], master: other === 0 }, { ...next.decks[1], master: other === 1 }] };
        }
      }
      const m = masterDeckIndex(next);
      if (m !== null && m !== a.deck) {
        // Phase-align to the master's beat grid (smallest shift, within ±½ beat).
        const md = next.decks[m];
        const mt = md.track!;
        const self = next.decks[a.deck];
        const mb = ownBpm(md);
        const k = syncMultiplier(self.track!.bpm, mb);
        // Master beats elapsed, scaled by the octave multiplier (87 BPM locks to every other beat of 174).
        const bm = (md.positionSec - mt.firstBeatSec) / beatLen(mt) / k;
        const target = bm - Math.floor(bm);
        const mine = beatPhase(self.track!, self.positionSec);
        let diff = target - mine;
        if (diff > 0.5) diff -= 1;
        if (diff < -0.5) diff += 1;
        const bl = beatLen(self.track!);
        if (self.positionSec + diff * bl < 0) diff += 1;
        if (self.positionSec + diff * bl > self.track!.durationSec) diff -= 1;
        next = setDeck(next, a.deck, { positionSec: clampPos(self, self.positionSec + diff * bl) });
      }
      return toast(fixMaster(next), `Deck ${a.deck === 0 ? 'A' : 'B'} · Beat Sync on`, 'ok');
    }

    case 'deck/setMaster': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      const decks: [DeckState, DeckState] = [
        { ...s.decks[0], master: a.deck === 0 },
        { ...s.decks[1], master: a.deck === 1 },
      ];
      if (d.sync) {
        // Becoming master while following: keep the tempo it plays at now.
        const pct = (baseRate(s, a.deck) - 1) * 100;
        decks[a.deck] = { ...decks[a.deck], tempoPos: clamp(pct / d.tempoRange, -1, 1) };
      }
      return toast({ ...s, decks }, `Deck ${a.deck === 0 ? 'A' : 'B'} is tempo master`, 'ok');
    }

    case 'deck/jogTouch': {
      const d = s.decks[a.deck];
      if (d.jogTouched === a.touched) return s;
      if (a.touched) {
        return setDeck(s, a.deck, { jogTouched: true, bend: d.vinyl ? 0 : d.bend, slipPos: d.vinyl ? slipStart(d) : d.slipPos });
      }
      // Release: with slip, jump to where the track would have been (unless a loop still holds it).
      if (d.slipPos !== null && !d.loop.active && d.hotCueHeld === null) {
        return setDeck(s, a.deck, { jogTouched: false, positionSec: clampPos(d, d.slipPos), slipPos: null });
      }
      return setDeck(s, a.deck, { jogTouched: false });
    }

    case 'deck/jog': {
      const d = s.decks[a.deck];
      if (!d.track || a.ticks === 0) return s;
      if (a.mode === 'search') {
        return setDeck(s, a.deck, { positionSec: clampPos(d, d.positionSec + a.ticks * SEARCH_SEC_PER_TICK) });
      }
      if (a.mode === 'scratch') {
        return setDeck(s, a.deck, { positionSec: clampPos(d, d.positionSec + a.ticks * SCRATCH_SEC_PER_TICK) });
      }
      if (d.playing) {
        return setDeck(s, a.deck, { bend: clamp(d.bend + a.ticks * BEND_PER_TICK, -0.9, 0.9) });
      }
      return setDeck(s, a.deck, { positionSec: clampPos(d, d.positionSec + a.ticks * FINE_SEEK_SEC_PER_TICK) });
    }

    case 'deck/tempo': {
      const d = s.decks[a.deck];
      if (d.sync && !d.master && masterDeckIndex(s) !== null) return s; // slider is inert while following
      const pos = clamp(a.value01 * 2 - 1, -1, 1);
      if (pos === d.tempoPos) return s;
      return setDeck(s, a.deck, { tempoPos: pos });
    }

    case 'deck/tempoRange': {
      const d = s.decks[a.deck];
      const i = TEMPO_RANGES.indexOf(d.tempoRange);
      const range = TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length];
      const pct = tempoPct(d);
      return toast(setDeck(s, a.deck, { tempoRange: range, tempoPos: clamp(pct / range, -1, 1) }), `Deck ${a.deck === 0 ? 'A' : 'B'} · tempo range ±${range}%`);
    }

    case 'deck/tempoReset':
      return setDeck(s, a.deck, { tempoPos: 0 });

    case 'deck/hotCue': {
      const d = s.decks[a.deck];
      if (!d.track || a.index < 0 || a.index > 7) return s;
      const cue = d.hotCues[a.index];
      if (a.pressed) {
        if (!cue) {
          const hotCues = d.hotCues.slice();
          hotCues[a.index] = { posSec: quantizeTime(d, d.positionSec) };
          return syncCues(setDeck(s, a.deck, { hotCues }), a.deck);
        }
        if (d.playing && !d.hotCuePreview && !d.cuePreview) {
          // With slip on, a hot cue press is momentary: release returns to the shadow playhead.
          return setDeck(s, a.deck, { positionSec: cue.posSec, hotCueHeld: a.index, slipPos: slipStart(d) });
        }
        return fixMaster(setDeck(s, a.deck, { positionSec: cue.posSec, playing: true, hotCuePreview: true, hotCueHeld: a.index, cuePreview: false }));
      }
      if (d.hotCueHeld !== a.index) return s;
      if (d.hotCuePreview && cue) {
        return fixMaster(setDeck(s, a.deck, { playing: false, hotCuePreview: false, hotCueHeld: null, positionSec: cue.posSec }));
      }
      if (d.slip && d.slipPos !== null && !d.loop.active && !d.jogTouched) {
        return setDeck(s, a.deck, { hotCueHeld: null, positionSec: clampPos(d, d.slipPos), slipPos: null });
      }
      return setDeck(s, a.deck, { hotCueHeld: null });
    }

    case 'deck/hotCueDelete': {
      const d = s.decks[a.deck];
      if (!d.hotCues[a.index]) return s;
      const hotCues = d.hotCues.slice();
      hotCues[a.index] = null;
      return syncCues(setDeck(s, a.deck, { hotCues }), a.deck);
    }

    case 'deck/beatLoop': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      if (d.loop.active && d.loop.beats === a.beats) {
        return reduce(s, { type: 'deck/loopExit', deck: a.deck });
      }
      const len = a.beats * beatLen(d.track);
      const start = d.loop.active && d.loop.inSec !== null ? d.loop.inSec : loopStart(d, d.positionSec, a.beats);
      const end = Math.min(d.track.durationSec, start + len);
      const loop = { inSec: start, outSec: end, active: true, beats: a.beats };
      return setDeck(s, a.deck, { loop, positionSec: wrapLoop({ ...d, loop }, d.positionSec), slipPos: d.loop.active ? d.slipPos : slipStart(d) });
    }

    case 'deck/loopIn': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      const inSec = quantizeTime(d, d.positionSec);
      return setDeck(s, a.deck, { loop: { inSec, outSec: null, active: false, beats: null } });
    }

    case 'deck/loopOut': {
      const d = s.decks[a.deck];
      if (!d.track || d.loop.inSec === null) return s;
      const outSec = quantizeTime(d, d.positionSec);
      if (outSec <= d.loop.inSec + 0.01) return s;
      const beats = Math.round(((outSec - d.loop.inSec) / beatLen(d.track)) * 100) / 100;
      return setDeck(s, a.deck, { loop: { inSec: d.loop.inSec, outSec, active: true, beats }, slipPos: slipStart(d) });
    }

    case 'deck/loopExit': {
      const d = s.decks[a.deck];
      if (!d.loop.active) return s;
      if (d.slipPos !== null && !d.jogTouched) {
        return setDeck(s, a.deck, { loop: { ...d.loop, active: false }, positionSec: clampPos(d, d.slipPos), slipPos: null });
      }
      return setDeck(s, a.deck, { loop: { ...d.loop, active: false } });
    }

    case 'deck/reloop': {
      const d = s.decks[a.deck];
      if (d.loop.inSec === null || d.loop.outSec === null) return s;
      return setDeck(s, a.deck, { loop: { ...d.loop, active: true }, positionSec: d.loop.inSec });
    }

    case 'deck/loopScale': {
      const d = s.decks[a.deck];
      if (!d.track || d.loop.inSec === null || d.loop.outSec === null) return s;
      const beats = (d.loop.beats ?? (d.loop.outSec - d.loop.inSec) / beatLen(d.track)) * a.factor;
      if (beats < 1 / 32 || beats > 512) return s;
      const outSec = Math.min(d.track.durationSec, d.loop.inSec + beats * beatLen(d.track));
      const next = { ...d, loop: { ...d.loop, outSec, beats } };
      return setDeck(s, a.deck, { loop: next.loop, positionSec: wrapLoop(next, d.positionSec) });
    }

    case 'deck/beatJump': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      const shift = a.dir * d.beatJumpBeats * beatLen(d.track);
      if (d.loop.active && d.loop.inSec !== null && d.loop.outSec !== null) {
        return setDeck(s, a.deck, {
          positionSec: clampPos(d, d.positionSec + shift),
          loop: { ...d.loop, inSec: d.loop.inSec + shift, outSec: d.loop.outSec + shift },
        });
      }
      return setDeck(s, a.deck, { positionSec: clampPos(d, d.positionSec + shift) });
    }

    case 'deck/beatJumpSize': {
      const d = s.decks[a.deck];
      const i = BEATJUMP_SIZES.indexOf(d.beatJumpBeats as (typeof BEATJUMP_SIZES)[number]);
      const j = clamp(i + a.dir, 0, BEATJUMP_SIZES.length - 1);
      return setDeck(s, a.deck, { beatJumpBeats: BEATJUMP_SIZES[j] });
    }

    case 'deck/quantize':
      return setDeck(s, a.deck, { quantize: !s.decks[a.deck].quantize });

    case 'deck/keyLock':
      return setDeck(s, a.deck, { keyLock: !s.decks[a.deck].keyLock });

    case 'deck/slip': {
      const d = s.decks[a.deck];
      return setDeck(s, a.deck, { slip: !d.slip, slipPos: d.slip ? null : d.slipPos });
    }

    case 'deck/padMode': {
      const d = s.decks[a.deck];
      if (d.padMode === a.mode && (d.padModeKnown || !a.fromHardware) && !d.padModeSelecting) return s;
      return setDeck(s, a.deck, { padMode: a.mode, padModeKnown: d.padModeKnown || a.fromHardware, padModeSelecting: false, padFxHeld: null });
    }

    case 'deck/padModeSelect':
      return toast(setDeck(s, a.deck, { padModeSelecting: true }), `Deck ${a.deck === 0 ? 'A' : 'B'} · pick a pad mode on the unit (pads 1–4)`);

    case 'deck/padFx': {
      const d = s.decks[a.deck];
      if (a.pressed) return setDeck(s, a.deck, { padFxHeld: a.index });
      return d.padFxHeld === a.index ? setDeck(s, a.deck, { padFxHeld: null }) : s;
    }

    case 'deck/faderStart': {
      // The unit sends these when a fader crosses the bottom. Only act when the DJ asked for it:
      // with Smart Fader on (default) or with fader start set to "always".
      const mode = s.prefs.faderStart;
      if (mode === 'off' || (mode === 'smart' && !s.mixer.smartFader)) return s;
      const d = s.decks[a.deck];
      if (!d.track) return s;
      if (a.action === 'play') return d.playing ? s : fixMaster(setDeck(s, a.deck, { positionSec: d.cueSec, playing: true }));
      if (a.action === 'cue') return fixMaster(setDeck(s, a.deck, { playing: false, positionSec: d.cueSec, slipPos: null }));
      return d.sync ? s : reduce(s, { type: 'deck/syncToggle', deck: a.deck });
    }

    case 'deck/shift':
      return s.decks[a.deck].shift === a.down ? s : setDeck(s, a.deck, { shift: a.down });

    case 'deck/seek': {
      const d = s.decks[a.deck];
      if (!d.track) return s;
      return setDeck(s, a.deck, { positionSec: clampPos(d, a.positionSec), slipPos: null });
    }

    case 'mixer/set': {
      const v = clamp01(a.value);
      const chs = s.mixer.ch.slice() as MixerState['ch'];
      if (chs[a.ch][a.param] === v) return s;
      chs[a.ch] = { ...chs[a.ch], [a.param]: v };
      return setMixer(s, { ch: chs });
    }

    case 'mixer/pfl': {
      const chs = s.mixer.ch.slice() as MixerState['ch'];
      chs[a.ch] = { ...chs[a.ch], pfl: !chs[a.ch].pfl };
      return setMixer(s, { ch: chs });
    }

    case 'mixer/crossfader': {
      const v = clamp01(a.value);
      return v === s.mixer.crossfader ? s : setMixer(s, { crossfader: v });
    }

    case 'mixer/master': {
      const v = clamp01(a.value);
      return v === s.mixer[a.param] ? s : setMixer(s, { [a.param]: v });
    }

    case 'mixer/masterCue':
      return setMixer(s, { masterCue: !s.mixer.masterCue });

    case 'mixer/smartFader': {
      const on = !s.mixer.smartFader;
      return toast(setMixer(s, { smartFader: on }), `Smart Fader ${on ? 'on' : 'off'}`, on ? 'ok' : 'info');
    }

    case 'mixer/smartCfx': {
      const on = !s.mixer.smartCfx;
      return toast(setMixer(s, { smartCfx: on }), `Smart CFX ${on ? 'on' : 'off'}`, on ? 'ok' : 'info');
    }

    case 'sampler/pad': {
      const slot = s.sampler.slots[a.slot];
      if (!a.pressed) return s;
      const playing = s.sampler.playing.slice();
      const startedAt = s.sampler.startedAt.slice();
      if (a.shift) {
        if (!playing[a.slot]) return s;
        playing[a.slot] = false;
      } else {
        if (!slot) return s;
        playing[a.slot] = true;
        startedAt[a.slot] = s.clock;
      }
      return { ...s, sampler: { ...s.sampler, playing, startedAt } };
    }

    case 'library/select':
      return { ...s, library: { ...s.library, selectedId: a.trackId } };

    case 'library/query':
      return { ...s, library: { ...s.library, query: a.query } };

    case 'library/view':
      return { ...s, library: { ...s.library, view: a.view } };

    case 'library/rate':
      return updateTrack(s, a.trackId, { rating: clamp(Math.round(a.rating), 0, 5) });

    case 'library/comment':
      return updateTrack(s, a.trackId, { comment: a.comment.slice(0, 500) });

    case 'library/togglePlaylist': {
      const t = s.library.tracks.find((x) => x.id === a.trackId);
      const pl = s.library.playlists.find((p) => p.id === a.playlistId);
      if (!t || !pl || pl.smart) return s;
      const playlists = t.playlists.includes(a.playlistId) ? t.playlists.filter((p) => p !== a.playlistId) : [...t.playlists, a.playlistId];
      return updateTrack(s, a.trackId, { playlists });
    }

    case 'library/add': {
      const fresh = a.tracks.filter((t, i) => !s.library.tracks.some((x) => x.id === t.id) && a.tracks.findIndex((x) => x.id === t.id) === i);
      if (fresh.length === 0) return s;
      return { ...s, library: { ...s.library, tracks: [...s.library.tracks, ...fresh], selectedId: fresh[0].id } };
    }

    case 'library/hydrate': {
      let next = s;
      for (const [id, e] of Object.entries(a.edits)) {
        if (!s.library.tracks.some((t) => t.id === id)) continue;
        const patch: Partial<Track> = {};
        if (typeof e.rating === 'number') patch.rating = clamp(Math.round(e.rating), 0, 5);
        if (typeof e.comment === 'string') patch.comment = e.comment;
        if (Array.isArray(e.playlists)) patch.playlists = e.playlists.filter((p) => s.library.playlists.some((x) => x.id === p && !x.smart));
        if (Array.isArray(e.cues)) patch.cues = e.cues.slice(0, 8).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : null));
        next = updateTrack(next, id, patch);
      }
      return next;
    }

    case 'prefs/set': {
      const prefs = { ...s.prefs, ...a.patch };
      // New deck defaults take effect right away on empty decks; loaded decks keep what the DJ set.
      const decks = s.decks.map((d) =>
        d.track
          ? d
          : {
              ...d,
              ...(a.patch.defaultTempoRange !== undefined ? { tempoRange: prefs.defaultTempoRange } : {}),
              ...(a.patch.defaultQuantize !== undefined ? { quantize: prefs.defaultQuantize } : {}),
            },
      ) as EngineState['decks'];
      return { ...s, prefs, decks };
    }

    case 'ui/view':
      return s.ui.view === a.view ? s : { ...s, ui: { ...s.ui, view: a.view } };

    case 'ui/bottomTab':
      return s.ui.bottomTab === a.tab ? s : { ...s, ui: { ...s.ui, bottomTab: a.tab } };

    case 'ui/settingsSection':
      return { ...s, ui: { ...s.ui, view: 'settings', settingsSection: a.section } };

    case 'ui/zoom': {
      const steps = [2, 3, 4, 6, 8, 12, 16];
      const i = steps.indexOf(s.ui.zoomSec);
      const j = clamp((i < 0 ? 2 : i) - a.dir, 0, steps.length - 1);
      return { ...s, ui: { ...s.ui, zoomSec: steps[j] } };
    }

    case 'ui/toast':
      return toast(s, a.text, a.tone);

    default: {
      const never: never = a;
      return never;
    }
  }
}
