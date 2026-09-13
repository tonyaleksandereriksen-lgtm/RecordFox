/**
 * Pure mapping from what a file says about itself to a `Track`. Tags win over the file name,
 * the analyser's numbers win over "not analysed yet", and a cached analysis makes the record
 * complete on the spot (that is what makes a second launch instant).
 */
import type { AnalysisResult } from '../engine/actions.ts';
import type { Track } from '../engine/types.ts';
import { localTrackId, titleFromPath } from '../audio/localFiles.ts';
import type { AnalysisMeta, FileDescription } from './host.ts';

/** Below this margin the analyser could not tell a key from its relative: show it as uncertain. */
export const KEY_AMBIGUOUS_MARGIN = 0.05;

export function analysisResult(meta: AnalysisMeta): AnalysisResult {
  return {
    bpm: meta.bpm,
    firstBeatSec: meta.firstBeatSec,
    key: meta.key,
    keyName: meta.keyName,
    keyMargin: meta.keyMargin,
    bpmConfidence: meta.bpmConfidence,
    durationSec: meta.durationSec,
    analysedAt: meta.analysedAt,
  };
}

/** A track record for a described file; `previous` keeps the DJ's edits (rating, cues…) when re-scanning. */
export function trackFromDescription(d: FileDescription, now = Date.now(), previous?: Track): Track {
  const id = localTrackId(d.path);
  const seed = parseInt(id.slice(6), 16) || 1;
  const named = titleFromPath(d.path);
  const tags = d.tags ?? null;
  const duration = tags && tags.durationSeconds > 0 ? tags.durationSeconds : (d.probe?.lengthSeconds ?? previous?.durationSec ?? 0);
  const t: Track = {
    id,
    title: tags?.title || named.title,
    artist: tags?.artist || tags?.albumArtist || named.artist,
    genre: tags?.genre ?? previous?.genre ?? '',
    bpm: previous?.bpm ?? 0,
    key: previous?.key ?? '',
    durationSec: Math.max(0, duration),
    firstBeatSec: previous?.firstBeatSec ?? 0,
    hue: seed % 360,
    seed,
    source: 'local',
    path: d.path,
    rating: previous?.rating ?? 0,
    comment: previous?.comment ?? tags?.comment ?? '',
    playlists: previous?.playlists ?? [],
    addedAt: previous?.addedAt ?? now,
  };
  if (tags?.album) t.album = tags.album;
  if (tags?.year) t.year = tags.year;
  if (typeof d.size === 'number') t.fileSize = d.size;
  if (typeof d.mtimeMs === 'number') t.fileMtime = d.mtimeMs;
  const rate = tags?.sampleRate || d.probe?.sampleRate;
  if (rate) t.sampleRate = rate;
  if (tags?.bitrateKbps) t.bitrateKbps = tags.bitrateKbps;
  if (previous?.cues) t.cues = previous.cues;
  if (previous?.bpmOriginal !== undefined) {
    t.bpmOriginal = previous.bpmOriginal;
    t.firstBeatSecOriginal = previous.firstBeatSecOriginal;
  }
  if (previous?.analysedAt !== undefined) {
    t.analysedAt = previous.analysedAt;
    t.keyName = previous.keyName;
    t.keyMargin = previous.keyMargin;
    t.bpmConfidence = previous.bpmConfidence;
  }
  if (d.analysis) applyAnalysis(t, d.analysis);
  return t;
}

/** Writes a cached analysis into a fresh record (the reducer's 'library/analysis' does the same for live results). */
function applyAnalysis(t: Track, a: AnalysisMeta): void {
  const edited = t.bpmOriginal !== undefined;
  const bpm = a.bpm > 0 ? Math.round(a.bpm * 100) / 100 : 0;
  if (edited) {
    t.bpmOriginal = bpm;
    t.firstBeatSecOriginal = a.firstBeatSec;
  } else {
    t.bpm = bpm;
    t.firstBeatSec = a.firstBeatSec;
  }
  t.key = a.key || '';
  t.keyName = a.keyName || undefined;
  t.keyMargin = a.keyMargin;
  t.bpmConfidence = a.bpmConfidence;
  t.analysedAt = a.analysedAt;
  if (a.durationSec > 0) t.durationSec = a.durationSec;
}

/** Tracks that still need the analyser: no analysis yet, or the file changed since. */
export function needsAnalysis(t: Track): boolean {
  if (t.source !== 'local' || !t.path) return false;
  return t.analysedAt === undefined && t.analysisError === undefined;
}

export function keyLabel(t: Pick<Track, 'key' | 'keyMargin'>): string {
  if (!t.key) return '—';
  return t.keyMargin !== undefined && t.keyMargin < KEY_AMBIGUOUS_MARGIN ? `${t.key}?` : t.key;
}
