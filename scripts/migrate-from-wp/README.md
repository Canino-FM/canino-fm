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

Writes extracted data to `./output/` as JSON, **`show-images-manifest.json`** (by default on `--dry-run`), and `image-paths.txt`. No env vars required.

```bash
node index.js /path/to/your/canino.sql --dry-run
```

If the dump is in this folder and named `canino.sql`:

```bash
node index.js --dry-run
```

**Image manifest:** With `--dry-run`, `--manifest-images` is **on** unless you pass `--no-manifest-images`. For a normal extract without pushing, you can force the manifest with `--manifest-images`. Optional **`--uploads-root=/path/to/wp-content/uploads`** (or env **`MIGRATE_UPLOADS_ROOT`**) sets `localPath` and `localFileExists` in the manifest; if omitted, the script uses `../../docs/wp/wp-content/uploads` when that folder exists (this repo).

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
2. Write JSON to `output/` (same as dry run). Add `--manifest-images` if you want `show-images-manifest.json` without `--dry-run`.
3. Create or replace documents in Sanity: `program`, `settings`, and all `show`, `event`, and `artist` documents. Existing **`image`** on each show is merged in first so a re-push does not strip artwork.
4. **Upload featured images:** for each show with `_thumbnail_id` → `_wp_attached_file`, read the file from **`--uploads-root`** / `MIGRATE_UPLOADS_ROOT` / default `docs/wp/wp-content/uploads`, upload to Sanity, then patch `show.image`. Rows that already have an image are skipped unless you pass **`--force-images`**.

| Flag / env | Role |
|------------|------|
| `--no-upload-images` | Push documents only; skip step 4. |
| `--force-images` | Upload and patch even when the show already has an image. |
| `MIGRATE_IMAGE_BASE_URL` | e.g. `https://canino.fm/wp-content/uploads` — used when the file is not on disk (`file_missing` / no uploads root); fetches `BASE/relativePath`. |

Requires a reachable **`uploads` folder** and/or **`MIGRATE_IMAGE_BASE_URL`** so every image can be resolved; otherwise those rows are skipped with a warning.

---

## Output files

| File | Description |
|------|-------------|
| `output/program.json` | Single program document (events + inline show slots). |
| `output/settings.json` | Site settings (about, contact, live/link). |
| `output/shows.json` | Array of show documents (title, soundcloud; image not in JSON). |
| `output/events.json` | Array of event documents (date + refs to shows). |
| `output/artists.json` | Array of artist documents (name). |
| `output/image-paths.txt` | Tab-separated: WP post ID, show title, **show post `guid`** (permalink — **not** the image file). Legacy / debugging; prefer `show-images-manifest.json`. |
| `output/show-images-manifest.json` | One row per show: `sanityDocumentId` (`show-<id>`), `showTitle`, `relativePath` (`_wp_attached_file`), optional `localPath` / `localFileExists`, **`suggestedAssetFilename`** (path flattened, e.g. `2026/01/a.png` → `2026-01-a.png` — use when uploading to Sanity so identical basenames in different months stay unique **without** putting WP IDs in the filename). Status: `ok` \| `ok_relative_only` \| `no_thumbnail` \| … |

---

## Show images

The SQL dump does not contain binary image data. Featured images are **not** the show post’s `guid` in `image-paths.txt` (that column is the show’s permalink). In WordPress they are stored as **`_thumbnail_id`** on the show post, pointing to an **attachment**; the file path is **`_wp_attached_file`** in that attachment’s meta, and files live under **`wp-content/uploads/`** on the server (or at `https://your-domain/wp-content/uploads/<path>`).

The numeric **WP post ID** (e.g. `83`) is only the database primary key for the show; Sanity reuses it in **`show-83`** so documents stay stable. It does not need to appear in uploaded **asset** filenames — use **`suggestedAssetFilename`** from the manifest (path-based) instead.

You can:

1. **Upload to Sanity:** In Sanity Studio, edit each Show and upload the image (or use Sanity’s “Import from URL” if your old site is still live).
2. **Bulk upload:** Use `show-images-manifest.json` + `localPath` (or build a URL from `relativePath`) with Sanity’s asset API in a follow-up script.
3. **Keep images in the repo:** Copy files from WP `wp-content/uploads/` into the static site (e.g. `public/images/shows/`) and reference by path in the frontend until you move them to Sanity.

After migration, the build (Astro) will use Sanity image URLs for shows; until then, you can leave the image field empty or point to a placeholder.

---

## Troubleshooting

- **“Failed to read SQL file”** – Pass the correct path to your dump: `node index.js /absolute/path/to/dump.sql`.
- **Empty program/events** – Check table prefix. If your dump uses `jocczzlm_posts`, use `--prefix=jocczzlm_`.
- **ACF relationship “shows”** – The script expects ACF to store event→shows as serialized PHP or a single ID. If your export format differs, you may need to adjust `parsePhpSerializedIds` or the meta key name in `extractEvents`.
- **Theme settings (about, contact)** – Stored in `wp_options` as `options_theme-settings` or `theme-settings_about` / `theme-settings_contact`. If your ACF version uses different keys, add them in `getThemeSettingsOptions` in `parse-sql.js`.
