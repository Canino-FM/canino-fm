# Backlog

Informal list of ideas, polish, bugs, and follow-ups that are **not** captured in the phased checklist ([TASKS.md](./TASKS.md)). When something becomes part of the migration plan, move it into `TASKS.md` (or the relevant phase) and remove it from here.

## Inbox

_Add items as bullets or checkboxes. Newest at the top or bottom—pick one convention and stick to it._

- [ ] **Privacy and terms pages — obligatory, not optional, once PR #5 is deployed.** Using the YouTube Data API binds us to the YouTube API Services Terms of Service and the Developer Policies: the site must disclose that it uses YouTube API Services, link Google's Privacy Policy, and link the YouTube ToS, all reachable from the site. Follow the two documents rather than a section number — Google renumbers them. Neither page exists today and there is no footer to link them from.
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

- [x] **Confirmed 2026-10-06 — the uploads playlist does carry a broadcast while it is live.** This was the one unverified assumption in `netlify/functions/live-status.mjs`: if the playlist lagged, the hero would show Offline through a whole show. Observed once, on a real broadcast — the stream was at the top of the playlist with `liveBroadcastContent: "live"` within seconds of going live. The earlier doubt came from the 2026-10-04 VODs, whose `publishedAt` sits ~12h after `actualEndTime`; that is VOD processing time and says nothing about when the entry appeared. If a `false` is ever seen during a live show, swap `findCandidateIds` for `liveBroadcasts.list` (authoritative, 1 unit, OAuth instead of an API key).
