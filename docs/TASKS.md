# Canino FM migration – task breakdown

Split these among agents (or do yourself). Order matters: complete each phase before starting the next that depends on it.

**Reference:** Full plan in [docs/PLAN.md](./PLAN.md). Informal backlog: [docs/BACKLOG.md](./BACKLOG.md). WP UI to copy: [docs/wp/wp-content/themes/canino24/](./wp/wp-content/themes/canino24/).

**README:** At the end of each phase, update `README.md` so it stays accurate for admins (Sanity Studio URL, what to edit) and developers (commands, env, repo layout). The task tables below include an explicit "Update README" step per phase.

---

## Phase 0 – Account setup (human)

Do this before any agent work. No code in repo required.

| # | Task | Done |
|---|------|------|
| 0.1 | Create GitHub org (e.g. `canino-fm`), then repo (e.g. `canino-fm` or `canino-fm-site`). | ☑ |
| 0.2 | Create Sanity project ("Canino FM"), note Project ID. Create **Viewer** token for builds; store secret elsewhere (e.g. password manager). Optionally create **Editor** token for one-off migration. | ☑ |
| 0.3 | In Netlify: Add site from Git (connect repo). Build command: `pnpm build`; Publish: `dist`. Add env: `SANITY_PROJECT_ID`, `SANITY_API_READ_TOKEN`, `SANITY_DATASET=production`. | ☑ |
| 0.4 | **Update README:** Once Sanity Studio URL is known (after Phase 1), add it to the "For content editors" section; until then, leave the placeholder or add a note "(set after Phase 1)". | ☑ |

---

## Phase 1 – Agent 1: Data and CMS

**Prerequisite:** Phase 0 done (at least GitHub repo + Sanity project + Project ID).

**Prompt for Agent 1:**  
*"Read docs/PLAN.md and docs/TASKS.md. This repo is the Canino FM migration. Execute Phase 1 (Data and CMS) as below. Create schema and migration in this repo; do not commit API tokens."*

| # | Task | Deliverable | Done |
|---|------|-------------|------|
| 1.1 | Define Sanity document types per PLAN "Target data model": Program (events → date, shows[] with schedule + title), Events (date + refs to Shows), Shows (title, image, SoundCloud embed), Artists (name), Settings (about popup, contact email). | Schema in `cms/schemaTypes/`; register types in `cms/schemaTypes/index.ts`. | ☑ |
| 1.2 | Add Sanity Studio to repo (or document deploy of Studio) so content can be edited. | Studio deployable from repo or docs for `*.sanity.studio`. | ☑ |
| 1.3 | Write migration script (Node or Python): read `canino.sql` (or path you specify), extract program (post_id 2 meta), events (CPT + ACF), shows (title, featured image, soundcloud), artists; output for Sanity import and list of image paths. | `scripts/migrate-from-wp/` (`index.js`, `parse-sql.js`); see `README.md` there. | ☑ |
| 1.4 | Document how to run the script (env for Sanity write token), import into Sanity, and where to put show images (Sanity assets vs `public/images/`). | `scripts/migrate-from-wp/README.md` or same in main docs. | ☑ |
| 1.5 | Add short doc "Adding or changing content types" (roadmap for posts, comments, etc.). | e.g. `docs/CONTENT_TYPES.md` or section in README. | ☑ |
| 1.6 | **Update README:** In "For content editors", set the real Sanity Studio URL (e.g. `https://caninofm.sanity.studio`). Add any CMS-specific notes (e.g. dataset name) if useful for admins. | `README.md` "For content editors" section. | ☑ |

**Note:** Initial `node index.js --push` creates Show documents **without** `image` fields. `output/image-paths.txt` currently lists each show post’s **`guid`** (permalink), not the featured image URL. Featured images live in the DB as `_thumbnail_id` → attachment + `_wp_attached_file`, and on disk under **`wp-content/uploads/`**. Complete **Phase 2** below to load real images into the Sanity content lake.

---

## Phase 2 – WordPress featured images → Sanity

**Who:** Agent 1 or you (follow-up to Phase 1).

**Goal:** Every `show` document has `image` pointing at a Sanity image asset (CDN), not a dead WP permalink.

**Prerequisites:** Phase 1 content push done; `SANITY_WRITE_TOKEN` locally; either the live site still serves `https://canino.fm/wp-content/uploads/…` or you have a filesystem copy of **`wp-content/uploads/`** from WordPress.

**Prompt:**
*"Read docs/PLAN.md and docs/TASKS.md. Execute Phase 2 (WordPress featured images → Sanity): manifest from SQL, upload assets, patch show documents."*

| # | Task | Deliverable | Done |
|---|------|-------------|------|
| 2.1 | Extend migration or add a script that reads `wp_postmeta` for each show: `_thumbnail_id` → attachment post → `_wp_attached_file` (and/or attachment `guid`). Emit a manifest (JSON/CSV): Sanity show document id (`show-{wpId}`), resolved **HTTPS URL** and/or **local path** under `uploads/`. | e.g. `output/show-images-manifest.json` + generator in `scripts/migrate-from-wp/`. | ☐ |
| 2.2 | Implement upload: Node script using `@sanity/client` — for each row, read bytes (`fetch(url)` or `fs.readFile`), `client.assets.upload('image', body, { filename })`, then patch `show-{id}` with `image: { _type: 'image', asset: { _type: 'reference', _ref: asset._id } }`. Add basic retry, skip-if-already-has-image, and logging. | e.g. `upload-show-images.js` + env vars documented next to existing migration README. | ☐ |
| 2.3 | Run against production dataset; verify in Sanity Studio that archive shows have images. Document any shows missing `_thumbnail_id` for manual upload. | Studio spot-check; short note in `scripts/migrate-from-wp/README.md`. | ☐ |

**Reference:** Full data flow and URLs are in [docs/PLAN.md](./PLAN.md) → *WordPress show images → Sanity assets*.

---

## Phase 3 – Agent 2: Static site and 1:1 UI

**Prerequisite:** Phase 1 done (schema exists; content can be in Sanity or mock data for dev). Prefer Phase 2 done before heavy archive QA so show images are real.

**Prompt for Agent 2:**  
*"Read docs/PLAN.md and docs/TASKS.md. WP UI to copy is under docs/wp/wp-content/themes/canino24/. Execute Phase 3 (Static site and 1:1 UI). Use Astro, pnpm, scoped CSS, minimal vanilla JS. Match current layout and behaviour exactly; no a11y pass yet."*

| # | Task | Deliverable |
|---|------|-------------|
| 3.1 | Bootstrap Astro project in repo root (pnpm). Configure for static output, add `@astrojs/sanity` (or fetch via `@sanity/client`) at build time. Document `SANITY_PROJECT_ID`, `SANITY_API_READ_TOKEN`, `SANITY_DATASET` in README; local dev uses gitignored root `.env`. | `package.json`, `astro.config.*`, README env section. |
| 3.2 | Single-page layout: sections in order – Header, Hero (live/video + program block), Archive (shows grid + Load More), Artists, About, Footer + Player. Use canino24 template/partials and class names as reference. | `src/pages/index.astro` (or single route) composing section components. |
| 3.3 | Header: nav, logo (inline SVG from canino24 `static/img/icons/logo.php`), symbol. Convert header SCSS to Astro scoped CSS. | `src/components/Header.astro` (or similar). |
| 3.4 | Hero + Program: live embed (YouTube iframe from `live`/`link`), program schedule (events → date, shows with schedule + title). Convert program SCSS to scoped CSS. | `src/components/Hero.astro`, `src/components/Program.astro`. |
| 3.5 | Archive: grid of shows (event date, show title, image, SoundCloud); "Load More" (e.g. 30 per chunk). Convert shows SCSS to scoped CSS. | `src/components/Archive.astro` (or `Shows.astro`). |
| 3.6 | Artists: list A–Z. Convert artists SCSS to scoped CSS. | `src/components/Artists.astro`. |
| 3.7 | About: main block (fixed or from CMS) + popup (from Settings: about + contact). Convert about + info/popup SCSS to scoped CSS. | `src/components/About.astro`, popup behaviour. |
| 3.8 | Footer + Player: `#player` with default SoundCloud iframe; clicking an archive show replaces player content with that show's embed. Convert footer/player SCSS to scoped CSS. | `src/components/Footer.astro`, `src/components/Player.astro`. |
| 3.9 | JS (vanilla, in Astro `<script>`): about popup open/close, anchor scroll, show click → update player iframe, Load More. No jQuery. | Behaviour matching current site. |
| 3.10 | Assets: logo/symbol/teeth as inline SVG in components; show images from Sanity URLs or migrated paths. | No PHP; SVGs in Astro. |
| 3.11 | Data: fetch from Sanity at build; flatten events → shows for archive. Use TypeScript types for Sanity documents if desired. | `src/lib/sanity.ts` (or similar), types, usage in components. |
| 3.12 | **Update README:** Ensure "For developers" matches the real repo: correct `src/` and config layout, working `pnpm install` / `pnpm dev` / `pnpm build` commands, and remove any "(Requires the Astro project to be set up)" or similar placeholders. | `README.md` "For developers" section. |

---

## Phase 4 – Agent 3: Integration and docs

**Prerequisite:** Phase 3 done (site builds and runs locally).

**Prompt for Agent 3:**  
*"Read docs/PLAN.md and docs/TASKS.md. Execute Phase 4 (Integration and docs). Wire Sanity → Netlify and add user-facing docs. Credit: Web Development by Dylan Kario where appropriate."*

| # | Task | Deliverable |
|---|------|-------------|
| 4.1 | Document Netlify env vars and build; add Sanity webhook → Netlify build hook so publishes trigger rebuild. | Docs (e.g. README or `docs/DEPLOY.md`) with webhook URL setup. |
| 4.2 | **Update README:** Final pass — confirm Sanity Studio URL is correct, add link to `docs/EDITING.md` in "Need more help?", ensure "How to edit content" and "For developers" (dev/build, env, deploy) are complete and accurate. | `README.md`. |
| 4.3 | Content guide for admins: Sanity Studio, editing schedule, archive, artists, about (with screenshots if helpful). | e.g. `docs/EDITING.md` or `EDITING.md`. |
| 4.4 | Add "Web Development: Dylan Kario" (or similar) in footer/credits. | In About/credits component or README. |
| 4.5 | Optional: GitHub Actions for lint (ESLint) and/or a11y report-only; secrets in GitHub. | `.github/workflows/*.yml` and short doc. |

---

## Phase 5 (later) – Agent 4: Accessibility

**Prerequisite:** 1:1 UI committed and approved.

**Prompt for Agent 4:**  
*"Read docs/PLAN.md and docs/TASKS.md. Execute Phase 5 (Accessibility): audit for WCAG 2.1 AAA, list fixes for approval, then implement after approval."*

| # | Task | Deliverable |
|---|------|-------------|
| 5.1 | Audit (e.g. axe, Pa11y): focus order, visible focus, iframe titles, link text, contrast (overlays/popup), skip link, keyboard. Document issues with file/component and line or name. | Audit report (e.g. `docs/A11Y_AUDIT.md`). |
| 5.2 | Propose concrete fixes for each issue; get approval. | List of approved changes. |
| 5.3 | Implement approved fixes. | PR(s) with a11y updates. |
| 5.4 | **Update README (optional):** If a11y audit or process is documented (e.g. `docs/A11Y_AUDIT.md`), add a short note or link in the README for maintainers. | `README.md` (e.g. "Accessibility" subsection). |

---

## Phase 6 – When ready to swap the live site

Do this after review, when you want the new site to replace the current one at canino.fm.

| # | Task | Done |
|---|------|------|
| 6.1 | Add custom domain `canino.fm` in Netlify and set DNS at registrar. | ☐ |

---

## Quick reference: who does what

| Phase | Who | When |
|-------|-----|------|
| 0 | You | First |
| 1 | Agent 1 (Data/CMS) | After 0 |
| 2 | Agent 1 or you (images) | After 1 push; before or during Phase 3 |
| 3 | Agent 2 (Static site / 1:1 UI) | After 1 (Phase 2 optional but recommended first) |
| 4 | Agent 3 (Integration + docs) | After 3 |
| 5 | Agent 4 (A11y) | After 1:1 is approved |
| 6 | You | When ready to swap live site |

**Next:** Prefer completing **Phase 2** (images) before or alongside Phase 3 so the archive grid can be checked against real artwork. Then hand off to Agent 2 using the Phase 3 prompt (Phase 0 and Phase 1 content import are complete).
