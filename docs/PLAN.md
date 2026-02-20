---
name: Canino FM static site migration
overview: Migrate the Canino FM WordPress site to a static site built with Astro, content in Sanity, deployed on Netlify. 1:1 UI copy using Astro components and scoped CSS, then a separate pass for WCAG 2.1 AAA. Development with pnpm; Astro’s default build (Vite/esbuild) is used unless custom tooling is needed.
todos:
  - id: todo-1771595588866-aoo8ynxj9
    content: ""
    status: pending
isProject: false
---

# Canino FM: WordPress to static site migration

## Reference

Reference WP implementation is in this repo under docs/wp/.

## Current state (from WP theme + SQL)

**Theme:** [wp-content/themes/canino24/](wp-content/themes/canino24/) (canino24). Single “Home” template; no separate HTML pages—one scroll with sections: Program (hero + schedule), Archive (shows grid), Artists, About.

**Data in use:**

- **Program (schedule):** ACF repeater on the front page (post_id 2): `program` → `event[]` (each has `date`) → `shows[]` (each has `schedule`, `title`). Stored as post meta (e.g. `program_event_0_date`, `program_event_0_shows_0_schedule`, `program_event_0_shows_0_title`).
- **Live hero:** ACF on same page: `live` (oEmbed/HTML) or `link` (iframe URL); parsed for `src` for YouTube.
- **Archive:** CPT `events` (one post per broadcast date, title = date string e.g. "08.02.2026") with ACF relationship `shows` → CPT `show`. Each `show` has: post title, featured image, ACF `soundcloud` (iframe HTML; code extracts `src`). Events ordered by `menu_order` (simple-custom-post-order). Archive shows all events’ shows in one flat list, chunked in groups of 30 with “Load More.”
- **Artists:** CPT `artist`; only `post_title` used; ordered A–Z.
- **About:** Hardcoded in [templates/partials/about.php](wp-content/themes/canino24/templates/partials/about.php) (three paragraphs, contacts, credits). Optional ACF theme-settings: `about` (rich text), `contact` (email) for the **popup** in [info.php](wp-content/themes/canino24/templates/partials/info.php).
- **Player:** Footer always has `#player`; initial content from `get_field('soundcloud')` on current context (front page). Clicking an archive show replaces player content with that show’s SoundCloud iframe (same `src`, `%23ff5500` → `%23000000`).

**Not currently live but in DB:** Standard `post` (blog), `project` CPT, `collective` CPT; WP comments. You want a **roadmap only** for adding these later.

**Assets:** SCSS in `src/scss/` (main, home, components), built to `dist/`; JS in `src/js/` (jQuery, home.js for about popup, show click → player, anchor scroll, Load More). Icons are PHP that output inline SVG (logo, symbol). Images from WP media (featured images for shows).

**Reference:** [canino.fm](https://canino.fm/) and your screenshots for 1:1 layout and behaviour.

---

## Tech stack options (to decide before implementation)

### 1. Static site generator (SSG)


| Option              | Pros                                                                                        | Cons                                         |
| ------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Eleventy (11ty)** | Simple, flexible, no React; good for HTML-first + CMS. Easy to keep “one page” + JSON data. | You own more of the data → component wiring. |
| **Astro**           | Modern, partial hydration, can do “zero JS” by default; good with headless CMS.             | Slightly more opinionated than 11ty.         |


**Chosen:** **Astro.** Component-based structure, scoped CSS by default, good DX; fits the single-page layout and Sanity integration. Non-technical maintainers use Sanity only; no Git or YAML.

### 2. CMS (for non-technical admins)


| Option                         | Pros                                                                                                                      | Cons                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Decap CMS (ex-Netlify CMS)** | Git-based; content in repo or separate branch; free; Netlify deploy on push. Fits “you code, they edit” and walk-through. | Config in repo; no hosted DB.      |
| **Sanity**                     | Rich editor, hosted, free tier; great for schedule + shows + artists.                                                     | External service; secrets for API. |
| **Contentful**                 | Similar to Sanity.                                                                                                        | Same.                              |
| **Payload CMS**                | Self-hosted, Node; full control.                                                                                          | You run and maintain the server.   |


**Chosen:** **Sanity.** Hosted Studio gives non-technical maintainers a simple, sleek UI with no Git or YAML. Content and images (with on-the-fly resizing/format via Sanity’s CDN) live in Sanity; build fetches via API. API token in Netlify env only.

### 3. Hosting and CI

- **Netlify:** Fits static export + Git (GitHub); branch deploys; env vars for any CMS keys; custom domain (canino.fm). No secrets in repo.
- **GitHub Actions:** Optional for extra checks (lint, a11y); not required for basic deploy if Netlify build runs the SSG.

**Recommendation:** **Netlify + GitHub**: repo → Netlify site; build = SSG + (if Decap) admin from `admin/`; canino.fm as custom domain. Secrets only in Netlify env.

### 4. CSS (no SASS, “canonical” modern approach)

- **CSS Modules** (e.g. `Program.module.css`): Scoped classes, no globals; works with 11ty (via shortcodes or component wrappers) or Astro.
- **Plain CSS + BEM-like naming:** Single or few stylesheets; no build step for CSS if you want minimal tooling.
- **Lightweight utility build:** e.g. **Lightning CSS** or **csso** for minification only; no preprocessor.

**Chosen:** **Astro scoped styles** (per-component `<style>` in `.astro` files) to mirror the current component boundaries (header, program, shows, artists, about, player, footer) and keep 1:1 class names where possible. No SASS; native CSS (custom properties, grid, flexbox). Astro/Vite minifies as part of the build.

### 5. Front-end JS

- Keep behaviour minimal: about popup, “Load More” for archive, anchor scroll, show click → replace player iframe. No jQuery: small vanilla JS in Astro `<script>` blocks (or Alpine.js if preferred). No React/Vue required for 1:1.

### 6. Development tooling (chosen)

- **Package manager:** **pnpm.** Use for installs, scripts, and lockfile. Astro works with pnpm; use `pnpm create astro` or init then `pnpm add astro @astrojs/sanity` etc. Add `packageManager: "pnpm@x.y.z"` in `package.json` for corepack if desired.
- **Build/bundler:** **Astro’s default stack.** Astro uses Vite under the hood; Vite uses esbuild for dependency pre-bundling and Rollup for the final build. No need to add esbuild (or another bundler) unless you have a separate script pipeline (e.g. a one-off script that must be bundled with esbuild). For the site itself, `astro build` is enough.
- **Optional for UI dev:** **TypeScript** (Astro supports it; use for Sanity schema types and component props). **ESLint** (`eslint-plugin-astro`) and **Prettier** (with `prettier-plugin-astro`) for consistent style. **Biome** is an alternative to ESLint + Prettier if you prefer a single tool. No extra build step beyond Astro.

---

## Target data model (CMS / JSON)

Normalize WP/ACF into a small set of content types the static site consumes (JSON or CMS collections).

- **Program (schedule):**  
`events[]` → each: `date` (string, e.g. "08.02.2026"), `shows[]` → each: `schedule` (e.g. "13:00-14:00"), `title` (e.g. "llora nena llora w. Chica Acosta").  
One “program” entity (or one file) for the next few days/weeks.
- **Hero / live:**  
`live` (HTML string or oEmbed URL) or `link` (YouTube iframe URL or embed URL). One field; build-time resolves to iframe `src` if needed.
- **Shows (archive):**  
Flat list for display: `eventDate`, `showTitle`, `imageUrl`, `soundcloudEmbedSrc` (parsed from iframe). Source of truth in CMS: “Events” (date + list of Show refs) and “Shows” (title, image, SoundCloud embed). Build flattens events → shows and sorts (e.g. by date desc).
- **Artists:**  
List of `name` (string). No extra fields for 1:1.
- **About / site settings:**  
`aboutHtml` (popup), `contactEmail`; plus fixed copy for the main About block (or move to CMS later). Credits (Mónica Losada, Pablo Huertas → you) can stay in code or in CMS.
- **Player default:**  
Optional default SoundCloud embed URL for footer when no show is selected (from current “live” or a default show).

**Sanity schema:** Document types for **Program** (repeater: events → date, shows[] with schedule + title), **Events** (date + refs to Shows), **Shows** (title, image, SoundCloud embed), **Artists** (name), **Settings** (about popup text, contact email). Build fetches at build time and flattens as needed; images use Sanity’s image pipeline (URL params for size/format).

---

## Migration from WordPress / SQL

1. **Export content from SQL (one-off script or manual):**
  - Program: read post meta for post_id 2 where keys match `program_%`, reconstruct ACF repeater structure (or export ACF JSON if available).
  - Events: `wp_posts` where `post_type = 'events'`; order by `menu_order`; for each, get ACF `shows` (post IDs).
  - Shows: for each show post, `post_title`, featured image (resolve `_wp_attached_file` / GUID to final URL or copy files), ACF `soundcloud`; parse iframe `src`.
  - Artists: `wp_posts` where `post_type = 'artist'`, order by title; output names.
  - Theme-settings: ACF options for `theme-settings` (about, contact) from `wp_options` if present; else keep current hardcoded about and [info@canino.fm](mailto:info@canino.fm).
2. **Media:** Copy show images from WP uploads into the new repo (e.g. `public/images/shows/`) and reference by path or URL in the flattened shows list. Do not commit secrets; use public or relative URLs.
3. **Future (posts/comments):** Not in scope for v1. Roadmap: add “Post” (and optionally “Project”) collection in CMS; add an optional “Blog” or “News” section and templates; comments could be added later via a service (e.g. Commento, giscus) or a small backend—document as “Phase 2” in the repo README.

---

## Repo and deploy layout (suggestion)

- **New GitHub repo** (e.g. `canino-fm-site`):  
  - Astro project (pnpm); components for header, hero/program, archive grid, artists, about, footer/player.  
  - Data: fetched from Sanity at build time (no content committed; or optional `data/` fallback for dev).  
  - Docs: README with “How to edit content” (Sanity Studio URL and steps); EDITING.md for admins with screenshots.  
  - **README as single source of truth:** Update `README.md` at the end of each phase so it stays accurate for both admins (Studio URL, what to edit) and developers (commands, env, repo layout). See TASKS.md for the explicit “Update README” task in each phase.  
  - No `.env` in repo; `.env.example` with `SANITY_PROJECT_ID`, `SANITY_TOKEN` (or similar).  
  - Lockfile and scripts use pnpm.
- **Netlify:** Connect repo; build command = `pnpm build` (Astro outputs to `dist/` by default); publish = `dist`. Set Sanity env vars in Netlify. Domain: canino.fm. Optional: Sanity webhook → Netlify build hook so publishes trigger a rebuild.

---

## Task split across agents

- **Agent 1 – Data and CMS:**  
  - Define Sanity schema (document types) for program, events, shows, artists, settings.  
  - Write migration script (Node or Python) that reads `jocczzlm_canino.sql` and populates Sanity (or outputs JSON for initial import) and list of image paths; use Sanity’s image pipeline for show images where possible.  
  - Document “Adding or changing content types” for future (e.g. posts, comments roadmap).  
  - **Update README:** Add Sanity Studio URL in the “For content editors” section once Studio is deployable; add any CMS-specific notes (e.g. dataset name).
- **Agent 2 – Static site and 1:1 UI:**  
  - Bootstrap Astro project with pnpm; implement single-page layout: header, hero (video + program block), archive (grid + Load More), artists, about, footer + player.  
  - Use Astro scoped styles (and existing class names from canino24); convert current SCSS to plain CSS in components.  
  - Data: fetch from Sanity at build time; flatten events/shows as needed.  
  - JS: about popup, anchor scroll, show click → player, Load More (vanilla JS in Astro `<script>`).  
  - Assets: logo/symbol as inline SVG in components; show images via Sanity image URLs (or migrated paths during migration).  
  - No a11y changes yet; match current behaviour and visuals exactly.  
  - **Update README:** Ensure “For developers” reflects actual repo layout (`src/`, config files), dev/build commands (`pnpm dev`, `pnpm build`), and remove placeholders that are no longer accurate.
- **Agent 3 – Integration and docs:**  
  - Wire Sanity webhook to Netlify build hook so content publishes trigger rebuild; document env (Sanity token, Netlify) and deploy.  
  - **Update README:** Set final Sanity Studio URL, link to EDITING.md (content guide), ensure “How to edit content” and “For developers” are complete and accurate; note Web Development credit “Dylan Kario” where appropriate.  
  - Optional: GitHub Actions for lint (e.g. ESLint) or a11y (report-only); keep secrets in GitHub secrets.
- **Agent 4 (later) – Accessibility:**  
  - After 1:1 is committed: audit against WCAG 2.1 AAA; list required fixes (focus, ARIA, contrast, keyboard, iframe titles, etc.); you approve; then implement in a separate pass.  
  - **Update README (optional):** If a11y audit or process is documented (e.g. in `docs/A11Y_AUDIT.md`), add a short note or link in the README for maintainers.

---

## Accessibility (WCAG 2.1 AAA)

- Do **not** change a11y in the first 1:1 copy.  
- After the 1:1 is merged, a dedicated pass should:  
  - Audit (e.g. axe or Pa11y) and document issues (e.g. player iframe title, link focus, contrast on overlays, “Load More” focus management, skip link).  
  - Propose concrete fixes (with file/line or component names) for your approval before applying.
- Likely areas: focus order, visible focus styles, iframe `title`, link text (e.g. “YouTube”/“YT”), and contrast for any overlay/popup text.

---

## Secrets and credentials

- **Never commit:** API keys (Sanity, Contentful, etc.), Netlify tokens, or any private credentials.  
- **Use:** Netlify env vars (and optionally GitHub Secrets for CI).  
- **Repo:** Only `.env.example` with placeholder names; README states “set these in Netlify.”

---

## Account and service setup (walkthrough)

Assume you only have a **personal GitHub** account and an **existing Netlify** account. You need **Sanity** and a **GitHub org/team** for Canino FM. No other services for the chosen stack.

### 1. GitHub: organization and repo

- Go to [GitHub](https://github.com) and sign in with your personal account.
- **Create an organization** for Canino FM: GitHub → your profile menu (top right) → **Organizations** → **New organization**. Choose a plan (free “Open Source” is enough). Name it e.g. `canino-fm` or `CaninoFM`. Add yourself as owner.
- **Create the repo** under that org: In the org, **Repositories** → **New repository**. Name it `canino-fm` (or `canino-fm-site`). Private or public as you prefer. Do **not** initialize with a README if you’ll create the Astro project in it; or add a README and clone, then add the Astro app inside.
- **Teams (optional):** In the org, **Teams** → **New team**. Create a team (e.g. “Canino FM maintainers”) and add members who need access. Grant the team access to the `canino-fm` repo (Write or Admin). Non-technical content editors don’t need GitHub access if they only use Sanity.
- **Note:** You’ll push the Astro code to this repo; Netlify will connect to it.

### 2. Sanity

- Go to [sanity.io](https://www.sanity.io) and **Sign up** (e.g. “Sign up with GitHub” to use your existing GitHub).
- **Create a project:** Dashboard → **Create new project**. Name it e.g. “Canino FM”. Choose a dataset name (default `production` is fine). Region: pick one close to you or your users.
- **Project ID:** In the project, go to **Manage** (or **Settings** → **Project settings**). Copy the **Project ID** (e.g. `abc123xyz`). You’ll need it in the Astro app and in Netlify env.
- **API token for the site (read-only):** **Settings** → **API** → **Tokens** → **Add API token**. Name it e.g. “Netlify build”. Choose **Viewer** (read-only) so the build can fetch content. Copy the token once; you can’t see it again. Store it in Netlify env as `SANITY_API_READ_TOKEN` (or `SANITY_TOKEN`).
- **API token for migration (write):** If you’ll run a script that writes content (e.g. import from WP), create a second token with **Editor** (or **Administrator**) rights. Use it only locally for the one-off migration; do **not** put it in Netlify.
- **Studio URL:** After you deploy the schema, Sanity Studio is available at `https://<your-project>.sanity.studio` (or you can embed it in the Astro app and deploy it). Share that URL with non-technical maintainers so they can edit content. Optionally add them as users in **Manage** → **Members** (invite by email).
- **Dataset:** Default is `production`. The Astro app will use this dataset name when querying; document it in the repo (e.g. in `.env.example`: `SANITY_DATASET=production`).

### 3. Netlify (you already have an account)

- Log in at [netlify.com](https://www.netlify.com).
- **Add site from Git:** **Add new site** → **Import an existing project** → **Connect to GitHub**. Authorize Netlify to access your GitHub (or the Canino FM org). Select the **canino-fm** repo.
- **Build settings:** Build command: `pnpm build` (or `npm run build` if you don’t use pnpm in CI). Publish directory: `dist`. Base directory: leave empty unless the Astro app lives in a subfolder.
- **Environment variables:** **Site settings** → **Environment variables** → **Add variable** (or **Add from .env`). Add:
  - `SANITY_PROJECT_ID` = your Sanity project ID  
  - `SANITY_API_READ_TOKEN` (or `SANITY_TOKEN`) = the read-only token from Sanity  
  - `SANITY_DATASET` = `production` (if not default)
- **Custom domain:** **Domain settings** → **Add custom domain** → `canino.fm`. Netlify will show the required DNS records (e.g. A or CNAME). In your domain registrar (where you bought canino.fm), point the domain to Netlify as instructed. Enable HTTPS (Netlify will provision a cert).
- **Build hook (optional):** **Site settings** → **Build & deploy** → **Build hooks** → **Add build hook**. Name it e.g. “Sanity publish”. Copy the URL. Later you’ll add this URL as a webhook in Sanity so that when someone publishes content, Sanity calls the hook and Netlify triggers a new build.

### 4. No other accounts

- You don’t need Decap, Contentful, or any other CMS. No Vercel. No extra image CDN (Sanity serves images). The only accounts required are: **GitHub** (personal + Canino FM org), **Sanity**, **Netlify**.

---

## Transferring context to the new repo (for a new chat)

When you create the new repo **canino-fm** and open it in Cursor, a new chat won’t have this conversation. To give an agent (or yourself) full context:

1. **Copy this plan into the repo** as a single file. For example:
  - **Option A:** Create `docs/PLAN.md` (or `docs/CANINO_MIGRATION_PLAN.md`) in the new repo and paste the **full contents** of this plan (all sections: current state, stack chosen, data model, migration, repo layout, task split, account setup, order of operations, summary).
  - **Option B:** Export this plan from Cursor (e.g. copy the markdown) and commit it as `PLAN.md` in the repo root. Root is fine if you want it very visible; `docs/` keeps the root clean.
2. **In the new chat**, start with something like: *“Read `docs/PLAN.md` (or `PLAN.md`). This repo is the Canino FM migration. Execute [Phase 1 / the Data and CMS task / etc.] as described in the plan.”* The agent can read the file and will have stack choices, data model, task split, and account setup in one place.
3. **Optional:** Add a short **README** in the new repo that says: *“Implementation follows the plan in `docs/PLAN.md`. Account setup: see ‘Account and service setup’ in that doc.”* Then you can say “Follow the plan in the README” and the agent will open `PLAN.md`.
4. **Don’t rely on Cursor’s chat history** to carry context across workspaces; the file in the repo is the durable source of truth. If you later add phases (e.g. a11y), update that same plan file so the new chat still has the latest picture.

---

## Order of operations

1. **Account setup:** Complete the walkthrough above (GitHub org + repo, Sanity project + tokens, Netlify connect + env + domain).
2. **Data agent:** Sanity schema + migration script; you run script and import into Sanity (and migrate images).
3. **UI agent:** New Astro repo (pnpm) in `canino-fm`, 1:1 implementation, no a11y changes.
4. **Integration agent:** Sanity webhook → Netlify build hook, env docs, README update + content guide (EDITING.md); you point canino.fm to Netlify and test.
5. **Later:** A11y agent proposes and then implements WCAG 2.1 AAA fixes after you commit the 1:1 baseline; optionally update README with a11y doc links.

---

## Summary

- **Stack (chosen):** Astro + Sanity + Netlify + GitHub; pnpm; Astro scoped CSS and minimal vanilla JS. Astro’s default build (Vite/esbuild) is used; optional TypeScript, ESLint, Prettier (or Biome) for dev.  
- **Content:** Program, hero (live/link), archive (events + shows + Sanity images + SoundCloud), artists, about/settings; all from Sanity at build time.  
- **One-off:** Migrate from `jocczzlm_canino.sql` + WP uploads into Sanity (and/or static assets as needed); no WordPress in production.  
- **Agents:** Data/CMS (Sanity schema + migration) → UI (Astro 1:1) → Integrate/Docs → A11y (separate, after your approval).  
- **Future:** Posts and comments documented as roadmap; credits updated to you (Dylan Kario) where appropriate.  
- **README:** Updated at the end of each phase (see TASKS.md) so admins and developers always have accurate instructions.

