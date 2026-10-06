# Backlog

Informal list of ideas, polish, bugs, and follow-ups that are **not** captured in the phased checklist ([TASKS.md](./TASKS.md)). When something becomes part of the migration plan, move it into `TASKS.md` (or the relevant phase) and remove it from here.

## Inbox

_Add items as bullets or checkboxes. Newest at the top or bottom—pick one convention and stick to it._

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

- [x] Confirmed 2026-10-06: a live broadcast appears at the top of the channel's uploads playlist with `liveBroadcastContent: "live"` within seconds of starting, so `netlify/functions/live-status.mjs` can rely on `playlistItems.list`. The late `publishedAt` on past VODs is processing time, not playlist-entry time.
