# Streaming options (replacing Spotify) — 2026-09-11

Decision (Tony): drop Spotify; look for alternatives. Summary of what an independent DJ app can and can't use.

| Service | Can RekordFox stream and mix it? | Why |
|---|---|---|
| Spotify | **No** | Developer Policy forbids mixing/overlapping Spotify content; the Sept 2025 DJ integration is limited to partner apps (rekordbox, Serato, djay). |
| SoundCloud | **No** (for mixing) | API terms forbid modifying the audio; DJ streaming runs through partner integrations. |
| TIDAL | **No** | DJ extension is partner-only. |
| Beatport / Beatsource streaming | **No** | Partner-only integrations. |
| **Audius** | **Candidate** | Open API with streaming endpoints. Check its terms for live mixing/public performance before shipping; rights sit with each artist. |
| Jamendo | Only with a licence | Creative Commons catalogue; public performance (e.g. a gig) needs a paid Jamendo licence. |
| Playlist import (metadata only) | **Yes** | Read playlist names and track lists (for example Spotify's Web API under its terms, or a CSV) and match them to the user's own files by title and artist. No audio comes from the service. |

Plan: after the audio engine lands, add local files first, then an Audius browser (search, stream, analyse), then
metadata-only playlist import. No export, recording or stems on streamed audio.

Sources
- Spotify Developer Policy — https://developer.spotify.com/policy
- Spotify DJ integration announcement — https://newsroom.spotify.com/2025-09-24/dj-software-integration-premium/
- SoundCloud API Terms of Use — https://developers.soundcloud.com/docs/api/terms-of-use
- TIDAL for DJs — https://tidal.com/djs
- Streaming in DJ software overview — https://dj.studio/blog/dj-software-streaming-integration-for-professional-djs
- Audius developer docs — https://docs.audius.org/developers/introduction/overview/
- Jamendo catalogue licences — https://support-licensing.jamendo.com/catalog-licenses
