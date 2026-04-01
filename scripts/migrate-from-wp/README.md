# Migrate content from WordPress to Sanity

This script reads a **WordPress MySQL dump** (e.g. `jocczzlm_canino.sql`), extracts program, events, shows, artists, and settings, and either writes JSON to `output/` or pushes directly to Sanity.

**Do not commit API tokens.** Use a **write** (Editor) token only locally for the one-off migration; store it in env or a local `.env` that is gitignored.

---

## Prerequisites

- **Node.js** 18+
- **WordPress dump:** Export your WP database to a `.sql` file (e.g. from phpMyAdmin, or your host’s backup). Place it in this folder or pass the path as an argument.
- **Sanity project:** Phase 0 done (project + dataset). For **push**, create an **Editor** (or Administrator) token in [Sanity Manage → API → Tokens](https://www.sanity.io/manage) and set it as `SANITY_WRITE_TOKEN` (never commit this).

---

## Install

From this directory:

```bash
pnpm install
# or: npm install
```

---

## Usage

### 1. Extract only (dry run, no Sanity)

Writes extracted data to `./output/` as JSON and a list of image references. No env vars required.

```bash
node index.js /path/to/your/canino.sql --dry-run
```

If the dump is in this folder and named `canino.sql`:

```bash
node index.js --dry-run
```

Optional table prefix (if your dump uses a prefix other than `wp_`):

```bash
node index.js /path/to/jocczzlm_canino.sql --prefix=jocczzlm_ --dry-run
```

### 2. Push to Sanity

Set these in the environment (e.g. in a local `.env` in this folder, or export in the shell). **Do not commit `.env` or the token.**

| Variable | Description |
|----------|-------------|
| `SANITY_PROJECT_ID` | Your Sanity project ID (e.g. from `cms/sanity.config.ts`). |
| `SANITY_DATASET` | Dataset name (default `production`). |
| `SANITY_WRITE_TOKEN` | **Editor** or **Administrator** token (one-off migration only). |

Then run:

```bash
node index.js /path/to/canino.sql --push
```

The script will:

1. Extract data from the SQL file.
2. Write JSON to `output/` (same as dry run).
3. Create or replace documents in Sanity: `program`, `settings`, and all `show`, `event`, and `artist` documents.

---

## Output files

| File | Description |
|------|-------------|
| `output/program.json` | Single program document (events + inline show slots). |
| `output/settings.json` | Site settings (about, contact, live/link, default player). |
| `output/shows.json` | Array of show documents (title, soundcloud; image not in JSON). |
| `output/events.json` | Array of event documents (date + refs to shows). |
| `output/artists.json` | Array of artist documents (name). |
| `output/image-paths.txt` | Tab-separated: WP post ID, show title, attachment GUID. Use this to know which images to upload. |

---

## Show images

The SQL dump does not contain binary image data. Featured images for shows are referenced in `image-paths.txt` (WP attachment GUIDs/URLs). You can:

1. **Upload to Sanity:** In Sanity Studio, edit each Show and upload the image (or use Sanity’s “Import from URL” if your old site is still live).
2. **Bulk upload:** Use Sanity’s asset API with the URLs from `image-paths.txt` in a separate script, or use [sanity-migrate](https://www.npmjs.com/package/sanity-migrate) / custom script that downloads from the GUID URL and uploads to Sanity.
3. **Keep images in the repo:** Copy files from WP `wp-content/uploads/` into the static site (e.g. `public/images/shows/`) and reference by path in the frontend until you move them to Sanity.

After migration, the build (Astro) will use Sanity image URLs for shows; until then, you can leave the image field empty or point to a placeholder.

---

## Troubleshooting

- **“Failed to read SQL file”** – Pass the correct path to your dump: `node index.js /absolute/path/to/dump.sql`.
- **Empty program/events** – Check table prefix. If your dump uses `jocczzlm_posts`, use `--prefix=jocczzlm_`.
- **ACF relationship “shows”** – The script expects ACF to store event→shows as serialized PHP or a single ID. If your export format differs, you may need to adjust `parsePhpSerializedIds` or the meta key name in `extractEvents`.
- **Theme settings (about, contact)** – Stored in `wp_options` as `options_theme-settings` or `theme-settings_about` / `theme-settings_contact`. If your ACF version uses different keys, add them in `getThemeSettingsOptions` in `parse-sql.js`.
