# Canino FM

Static website for **Canino FM**, built with [Astro](https://astro.build). Content is managed in **Sanity** (no code or Git required to update the site). The site is deployed on **Netlify**. Until the custom domain is connected (Phase 5 in `docs/TASKS.md`), the site is available at the Netlify-provided URL (e.g. *sitename*.netlify.app); after that it will be at [canino.fm](https://canino.fm).

This repo is the result of migrating the previous WordPress site to a static, CMS-backed setup. The original WordPress theme and reference files are kept under `docs/wp/` for reference only; they are not used in production.

---

## For content editors: how to edit the site

**You don't need GitHub, code, or the command line.** All updates to the live site are done through **Sanity Studio**, a web-based editor.

### Where to edit

- **Sanity Studio URL:** [https://caninofm.sanity.studio](https://caninofm.sanity.studio)  
  Open this link in your browser and sign in. This is where you edit all content.

### What you can edit

| Content | What it is |
|--------|------------|
| **Program / schedule** | Upcoming broadcast dates and show times (events and shows). |
| **Live hero** | The main video or live embed at the top of the homepage. |
| **Archive** | Past events and shows (dates, titles, images, SoundCloud embeds). |
| **Artists** | The A–Z list of artists. |
| **About** | The "About" popup text and contact email. |

When you **publish** changes in Sanity, the live site rebuilds automatically and updates within a few minutes. No deployment step is required from you.

### Need more help?

- A step-by-step **content guide** with screenshots is in **`docs/EDITING.md`** *(created in Phase 3)*.  
- For technical or access issues, contact your site maintainer or the developer (see credits below).

---

## For developers: technical setup

### What this repo is

- **Stack:** Astro (static site), Sanity (headless CMS), Netlify (hosting). Package manager: **pnpm**.
- **Build:** Astro's default build (Vite). Content is fetched from Sanity at build time; no content is stored in the repo.
- **Docs:** Full migration plan and decisions: **`docs/PLAN.md`**. Task breakdown and phases: **`docs/TASKS.md`**.

### Running the site locally

*(Requires the Astro project to be set up — see Phase 2 in `docs/TASKS.md`.)*

```bash
# Install dependencies (use pnpm)
pnpm install

# Run the dev server
pnpm dev

# Build for production (output in dist/)
pnpm build
```

### Environment variables

The site needs Sanity credentials to fetch content. **These must not be committed to the repo.**

- **Locally:** Copy `.env.example` to `.env` and fill in the values (for development only).
- **Production (Netlify):** Set these in Netlify: **Site settings → Environment variables.**

| Variable | Description |
|----------|-------------|
| `SANITY_PROJECT_ID` | Your Sanity project ID (from Sanity dashboard). |
| `SANITY_API_READ_TOKEN` or `SANITY_TOKEN` | Read-only API token (Viewer) for the build. |
| `SANITY_DATASET` | Dataset name (usually `production`). |

See **"Account and service setup"** in `docs/PLAN.md` for how to create the Sanity project and tokens, and how to connect Netlify to this repo.

### Repo layout (after full setup)

- **`src/`** — Astro pages, components, and styles (scoped CSS). Data is fetched from Sanity at build time.
- **`cms/`** — Sanity Studio (schema, config). Run from this folder for local Studio dev or deploy to *.sanity.studio.
- **`docs/`** — `PLAN.md` (migration plan), `TASKS.md` (phases), `EDITING.md` (content guide for admins). `docs/wp/` is the reference WordPress theme (canino24), not used in the build.
- **`.env.example`** — Example env vars; no real secrets. Actual secrets live only in Netlify (and locally in `.env` if you develop).

### Deploy

- **Netlify** is connected to this repo. Pushing to the main branch triggers a build (`pnpm build`) and publishes the `dist/` folder.
- **Sanity → Netlify:** A Sanity webhook can call a Netlify build hook so that when content is published in Sanity, Netlify rebuilds the site automatically. Setup is described in the integration phase in `docs/TASKS.md`.

---

## Credits

- **Web development:** Dylan Kario, Pablo Huertas
- **Design:** Mónica Losada

---

*Implementation follows the plan in `docs/PLAN.md`. Account and service setup: see "Account and service setup" in that document.*
