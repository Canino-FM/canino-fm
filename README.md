# Canino FM

Static website for **Canino FM**, built with [Astro](https://astro.build). Content is managed in **Sanity** (no code or Git required to update the site). The site is deployed on **Netlify**. Until the custom domain is connected (Phase 6 in `docs/TASKS.md`), the site is available at the Netlify-provided URL (e.g. *sitename*.netlify.app); after that it will be at [canino.fm](https://canino.fm).

This repo is the result of migrating the previous WordPress site to a static, CMS-backed setup. The original WordPress theme and reference files are kept under `docs/wp/` for reference only; they are not used in production.

---

## For content editors: how to edit the site

**You don't need GitHub, code, or the command line.** All updates to the live site are done through **Sanity Studio**, a web-based editor.

### Where to edit

- **Sanity Studio URL:** [https://caninofm.sanity.studio](https://caninofm.sanity.studio)  
  Open this link in your browser and sign in. This is where you edit all content.
- **Dataset:** Content is stored in the **production** dataset. The live site reads from this dataset at build time.

### What you can edit

| Content | What it is |
|--------|------------|
| **Program** | Upcoming broadcast dates and show times (events and shows). |
| **Live hero** | The main video or live embed at the top of the homepage. |
| **Archive** | Past events and shows (dates, titles, images, SoundCloud embeds). |
| **Artists** | The A–Z list of artists. |
| **About** | The "About" popup text and contact email. |

When you **publish** changes in Sanity, the live site rebuilds automatically and updates within a few minutes. No deployment step is required from you.

### Need more help?

- A step-by-step **content guide** with screenshots is in **`docs/EDITING.md`** *(created in Phase 4)*.
- For technical or access issues, contact your site maintainer or the developer (see credits below).

---

## For developers: technical setup

### What this repo is

- **Stack:** Astro (static site), Sanity (headless CMS), Netlify (hosting). Package manager: **pnpm**.
- **Sanity in Astro:** [`@sanity/astro`](https://www.sanity.io/plugins/sanity-astro) is configured in `astro.config.mjs` (project, dataset, read token). Pages use the virtual module `sanity:client` for GROQ (`src/lib/sanity.ts`). There is no npm package `@astrojs/sanity`; that name sometimes appears in older notes but the maintained integration is `@sanity/astro`.
- **Build:** Astro's default build (Vite). Content is fetched from Sanity at build time; no content is stored in the repo.
- **Docs:** Full migration plan and decisions: **`docs/PLAN.md`**. Task breakdown and phases: **`docs/TASKS.md`**.

### Running the site locally

```bash
# Install dependencies (use pnpm)
pnpm install

# Run the dev server (http://localhost:4321)
pnpm dev

# Production build (static HTML in dist/)
pnpm build

# Preview the production build locally
pnpm preview
```

You may see Vite messages about failing to pre-bundle optional Studio-related packages (`react-is`, `styled-components`, etc.). That is expected if you are **not** embedding Sanity Studio on an Astro route; the homepage build does not need them.

### Environment variables

See Astro’s **[Using environment variables](https://docs.astro.build/en/guides/environment-variables/)** guide.

**Do not commit** API tokens or `.env` files.

- **Locally:** Add a `.env` file in the **repo root** with the variables below.
- **Netlify:** **Site settings → Environment variables** — use the same names.

| Variable | Description |
|----------|-------------|
| `SANITY_PROJECT_ID` | Sanity project ID (from the Sanity dashboard or `cms/sanity.config.ts`). |
| `SANITY_API_READ_TOKEN` | Read-only API token (Viewer) so the build can run GROQ queries. |
| `SANITY_DATASET` | Dataset name (e.g. `production` or `stage`). Optional in `.env`; defaults to `production` in the Sanity integration config if unset. |

See **"Account and service setup"** in `docs/PLAN.md` for creating the Sanity project and tokens and connecting Netlify.

### Repo layout

- **`src/`** — Astro app: `pages/index.astro` (homepage), `components/`, `layouts/BaseLayout.astro`, `lib/sanity.ts` (GROQ via `sanity:client`, `@sanity/image-url`, archive flattening).
- **`public/`** — Static assets served as-is (favicons: `favicon.svg` plus PNG variants; `fonts/AkzidenzGrotesk/` for the typeface).
- **`astro.config.mjs`** — `output: 'static'`, `@sanity/astro`, and Vite `loadEnv` for Sanity options.
- **`cms/`** — Sanity Studio (schema, config). Run Studio from this folder; see **`docs/CONTENT_TYPES.md`** for schema changes.
- **`scripts/migrate-from-wp/`** — WordPress SQL → JSON / Sanity import. See **`scripts/migrate-from-wp/README.md`**.
- **`docs/`** — `PLAN.md`, `TASKS.md`, `CONTENT_TYPES.md`, and (Phase 4) `EDITING.md`. **`docs/wp/`** is the reference WordPress theme only; it is not part of the Astro build.

### Deploy

- **Netlify** is connected to this repo. Pushing to the main branch triggers a build (`pnpm build`) and publishes the `dist/` folder.
- **Sanity → Netlify:** A Sanity webhook can call a Netlify build hook so that when content is published in Sanity, Netlify rebuilds the site automatically. Setup is described in the integration phase in `docs/TASKS.md`.

---

## Credits

- **Web development:** Dylan Kario, Pablo Huertas
- **Design:** Mónica Losada

---

*Implementation follows the plan in `docs/PLAN.md`. Account and service setup: see "Account and service setup" in that document.*
