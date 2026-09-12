import type { DeckIndex } from '../../engine/types.ts';

/** Drag-and-drop payload used by the library and every deck drop target. */
export const TRACK_MIME = 'text/x-rekordfox-track';

export const deckLetter = (d: DeckIndex) => (d === 0 ? 'A' : 'B');
