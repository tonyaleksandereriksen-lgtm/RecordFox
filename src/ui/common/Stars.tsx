import { dispatch } from '../hooks.ts';

/** 0–5 star rating. Clicking the current rating clears it. */
export function Stars({ trackId, rating, size = 11 }: { trackId: string; rating: number; size?: number }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={rating === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= rating ? 'on' : ''}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'library/rate', trackId, rating: rating === n ? 0 : n });
          }}
        >
          <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
            <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </span>
  );
}
