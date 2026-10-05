# Backlog

Informal list of ideas, polish, bugs, and follow-ups that are **not** captured in the phased checklist ([TASKS.md](./TASKS.md)). When something becomes part of the migration plan, move it into `TASKS.md` (or the relevant phase) and remove it from here.

## Inbox

_Add items as bullets or checkboxes. Newest at the top or bottom—pick one convention and stick to it._

- [ ] **Next broadcast: confirm a live stream appears in the uploads playlist while it is still live.** `netlify/functions/live-status.mjs` reads liveness from `playlistItems.list`, and this assumption is unverified — after 2026-10-04 the VODs carried feed timestamps ~14h after air and the first show was still missing the next morning. If it lags, the hero shows Offline through a whole show. Fix is to swap `findCandidateIds` for `liveBroadcasts.list` (authoritative, 1 unit, OAuth instead of an API key). Until this is checked, do not trust a `false`.
- [ ] Privacy and terms pages. Required by YouTube's Developer Policies III.A.2 once the Data API is in use: disclose API Services use, link Google's Privacy Policy, link YouTube's ToS. Neither page exists today.
- [ ] Add a custom Studio input for program events (or nested shows) so schedule + title can be edited in a single table-style view like WordPress ACF, without changing the current embedded object shape.
- [ ] Refresh SQL with latest from WP.
- [ ] Use accessible base components and events handlers.
- [ ] Integrate socials with OG meta tags.
- [ ] Refactor all CSS to Astro scoped CSS and update all `calc()` to use `vw` and `vh` units.
- [ ] Consider Netlify analytics.
- [ ] Add better formatting and linting.
- [ ] Compress/downscale WP-migrated show images before or after Sanity upload.

## Done

_Move completed items here for a light history, or delete them._

- _None yet_
