#!/usr/bin/env node
/**
 * Canino FM – WordPress to Sanity migration
 *
 * Usage:
 *   node index.js [path-to.sql] [--prefix=wp_] [--dry-run] [--push] [--manifest-images] [--no-manifest-images] [--uploads-root=DIR]
 *
 * - path-to.sql: path to WordPress MySQL dump (e.g. jocczzlm_canino.sql). If omitted, uses MIGRATE_SQL_PATH env or ./canino.sql.
 * - --prefix=wp_: table prefix (default wp_, or jocczzlm_ for jocczzlm_canino).
 * - --dry-run: only extract and write JSON to ./output; do not push to Sanity.
 * - --manifest-images / --no-manifest-images: write output/show-images-manifest.json (featured image per show from _thumbnail_id → _wp_attached_file). Default: on when --dry-run, off otherwise.
 * - --uploads-root=DIR: local wp-content/uploads directory to resolve file paths and set localFileExists (default: ../../docs/wp/wp-content/uploads if that folder exists, else env MIGRATE_UPLOADS_ROOT, else paths are relative-only).
 * - --push: push extracted data to Sanity (requires SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN in env).
 *   After documents are written, uploads featured images from local files (--uploads-root) and patches each show.
 *   Set MIGRATE_IMAGE_BASE_URL (e.g. https://canino.fm/wp-content/uploads) to fetch when a file is missing locally.
 * - --no-upload-images: with --push, skip the image upload pass (documents only).
 * - --force-images: with --push, upload and patch even when the show already has an image.
 *   Loads ../../.env then ./.env (repo root first, then this folder) so you need not inline vars.
 *
 * Do not commit SANITY_WRITE_TOKEN. Use only for one-off migration.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import {
  parseWpDump,
  getMetaByPostId,
  buildProgram,
  getThemeSettingsOptions,
  parsePhpSerializedIds,
} from './parse-sql.js'
import { createClient } from '@sanity/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config({ path: join(__dirname, '.env') })
const outputDir = join(__dirname, 'output')

function parseArgs() {
  const args = process.argv.slice(2)
  let sqlPath = process.env.MIGRATE_SQL_PATH || join(__dirname, 'canino.sql')
  let prefix = 'wp_'
  let dryRun = false
  let push = false
  /** @type {boolean | undefined} */
  let manifestImagesFlag = undefined
  let uploadsRootArg = undefined
  let uploadImagesOnPush = true
  let forceImageUpload = false
  for (const a of args) {
    if (a === '--dry-run') dryRun = true
    else if (a === '--push') push = true
    else if (a === '--no-upload-images') uploadImagesOnPush = false
    else if (a === '--force-images') forceImageUpload = true
    else if (a === '--manifest-images') manifestImagesFlag = true
    else if (a === '--no-manifest-images') manifestImagesFlag = false
    else if (a.startsWith('--uploads-root='))
      uploadsRootArg = a.slice('--uploads-root='.length).replace(/^["']|["']$/g, '')
    else if (a.startsWith('--prefix=')) prefix = a.slice('--prefix='.length).replace(/^["']|["']$/g, '')
    else if (!a.startsWith('-')) sqlPath = a
  }
  const manifestImages = manifestImagesFlag !== undefined ? manifestImagesFlag : dryRun
  let uploadsRoot = uploadsRootArg
  if (uploadsRoot === undefined) {
    const fromEnv = process.env.MIGRATE_UPLOADS_ROOT
    if (fromEnv) uploadsRoot = fromEnv
    else {
      const def = join(__dirname, '../../docs/wp/wp-content/uploads')
      uploadsRoot = existsSync(def) ? def : ''
    }
  }
  return { sqlPath, prefix, dryRun, push, manifestImages, uploadsRoot, uploadImagesOnPush, forceImageUpload }
}

/** Sanity array items from the API must have stable unique `_key`s for Studio editing. */
function programEventKey(i) {
  return `pe-${i}`
}

function programShowSlotKey(eventIdx, showIdx) {
  return `pe-${eventIdx}-slot-${showIdx}`
}

/** First `src` from an iframe snippet (WP often stored full embed HTML in `link` meta). */
function extractIframeSrc(html) {
  if (!html || typeof html !== 'string') return ''
  const m = html.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  return m ? m[1].trim() : ''
}

function withHttpsIfProtocolRelative(url) {
  const v = (url || '').trim()
  if (!v) return ''
  if (v.startsWith('//')) return `https:${v}`
  return v
}

/**
 * `settings.link` is Sanity `url` (must be http(s)). WP may store a bare embed URL or full iframe HTML.
 * Raw iframe goes to `live` only when we cannot parse a src (so content is not dropped).
 */
function normalizeHeroFields(liveRaw, linkRaw) {
  let live = (liveRaw || '').trim()
  let link = (linkRaw || '').trim()
  if (link && /<iframe/i.test(link)) {
    const src = extractIframeSrc(link)
    if (src) {
      link = withHttpsIfProtocolRelative(src)
      if (!/^https?:\/\//i.test(link)) link = ''
    } else {
      if (!live) live = link
      link = ''
    }
  } else {
    link = withHttpsIfProtocolRelative(link)
  }
  if (link && !/^https?:\/\//i.test(link)) {
    if (!live) live = (linkRaw || '').trim()
    link = ''
  }
  return { live, link }
}

function extractProgram(posts, meta) {
  const pageId = 2
  const metaMap = getMetaByPostId(meta, pageId)
  const program = buildProgram(metaMap)
  return {
    _id: 'program',
    _type: 'program',
    title: 'Program',
    events: program.events.map((ev, i) => ({
      _key: programEventKey(i),
      _type: 'programEvent',
      date: ev.date,
      shows: (ev.shows || []).map((s, j) => ({
        _key: programShowSlotKey(i, j),
        _type: 'programEventShow',
        schedule: s.schedule || '',
        title: s.title || '',
      })),
    })),
  }
}

function extractSettings(meta, options) {
  const themeOpts = getThemeSettingsOptions(options)
  const pageMeta = getMetaByPostId(meta, 2)
  const hero = normalizeHeroFields(pageMeta.live, pageMeta.link)
  return {
    _id: 'settings',
    _type: 'settings',
    about: themeOpts.about || '',
    contact: themeOpts.contact || '',
    live: hero.live,
    link: hero.link,
  }
}

function extractShows(posts, meta) {
  const showPosts = posts.filter((p) => p.post_type === 'show' && p.post_status === 'publish')
  const out = []
  const imagePaths = []
  for (const p of showPosts) {
    const m = getMetaByPostId(meta, p.ID)
    const soundcloud = m.soundcloud || ''
    out.push({
      _type: 'show',
      _id: `show-${p.ID}`,
      title: p.post_title || '',
      soundcloud,
    })
    if (p.guid) imagePaths.push({ postId: p.ID, title: p.post_title, guid: p.guid })
  }
  return { shows: out, imagePaths }
}

function extractEvents(posts, meta) {
  const eventPosts = posts
    .filter((p) => p.post_type === 'events' && p.post_status === 'publish')
    .sort((a, b) => a.menu_order - b.menu_order)
  const out = []
  for (const p of eventPosts) {
    const m = getMetaByPostId(meta, p.ID)
    const showsRaw = m.shows
    const showIds = parsePhpSerializedIds(showsRaw)
    out.push({
      _type: 'event',
      _id: `event-${p.ID}`,
      date: p.post_title || '',
      shows: showIds.map((id, idx) => ({
        _key: `e${p.ID}-r${idx}`,
        _type: 'reference',
        _ref: `show-${id}`,
      })),
    })
  }
  return out
}

function extractArtists(posts) {
  const artistPosts = posts
    .filter((p) => p.post_type === 'artist' && p.post_status === 'publish')
    .sort((a, b) => (a.post_title || '').localeCompare(b.post_title || ''))
  return artistPosts.map((p) => ({
    _type: 'artist',
    _id: `artist-${p.ID}`,
    name: p.post_title || '',
  }))
}

/**
 * Featured image per show: postmeta _thumbnail_id → attachment _wp_attached_file.
 * suggestedAssetFilename flattens the uploads path (e.g. 2026/01/a.png → 2026-01-a.png) for Sanity uploads without embedding WP post IDs.
 */
function buildShowImagesManifest(posts, meta, uploadsRoot) {
  const showPosts = posts.filter((p) => p.post_type === 'show' && p.post_status === 'publish')
  const rows = []
  for (const p of showPosts) {
    const m = getMetaByPostId(meta, p.ID)
    const thumbRaw = (m._thumbnail_id || '').trim()
    const base = {
      sanityDocumentId: `show-${p.ID}`,
      showTitle: p.post_title || '',
    }
    if (!thumbRaw) {
      rows.push({
        ...base,
        status: 'no_thumbnail',
        relativePath: null,
        localPath: null,
        localFileExists: false,
        suggestedAssetFilename: null,
      })
      continue
    }
    const attachmentId = parseInt(thumbRaw, 10)
    if (!attachmentId) {
      rows.push({
        ...base,
        status: 'invalid_thumbnail_id',
        relativePath: null,
        localPath: null,
        localFileExists: false,
        suggestedAssetFilename: null,
      })
      continue
    }
    const attMeta = getMetaByPostId(meta, attachmentId)
    const rel = (attMeta._wp_attached_file || '').trim().replace(/\\/g, '/')
    if (!rel) {
      rows.push({
        ...base,
        status: 'no_attached_file',
        wpMediaPostId: attachmentId,
        relativePath: null,
        localPath: null,
        localFileExists: false,
        suggestedAssetFilename: null,
      })
      continue
    }
    const suggestedAssetFilename = rel.replace(/\//g, '-')
    let localPath = null
    let localFileExists = false
    if (uploadsRoot) {
      localPath = join(uploadsRoot, rel)
      localFileExists = existsSync(localPath)
    }
    rows.push({
      ...base,
      status: localPath ? (localFileExists ? 'ok' : 'file_missing') : 'ok_relative_only',
      wpMediaPostId: attachmentId,
      relativePath: rel,
      localPath,
      localFileExists,
      suggestedAssetFilename,
    })
  }
  return rows
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
      await sleep(400 * (i + 1))
    }
  }
  throw lastErr
}

async function uploadAssetWithRetry(client, buffer, filename, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.assets.upload('image', buffer, { filename })
    } catch (e) {
      lastErr = e
      await sleep(500 * (i + 1))
    }
  }
  throw lastErr
}

/**
 * After show documents exist: upload file → asset, patch show.image. Skips rows without bytes source.
 */
async function pushShowImages(client, manifest, { skipIfHasImage, imageBaseUrl }) {
  let uploaded = 0
  let skipped = 0
  let failed = 0
  for (const row of manifest) {
    if (!row.relativePath) {
      console.log(
        'Skip image (no featured image in WP)',
        row.sanityDocumentId,
        row.showTitle ? `— ${row.showTitle}` : ''
      )
      skipped++
      continue
    }
    try {
      const existing = await client.getDocument(row.sanityDocumentId)
      if (existing?.image?.asset?._ref && skipIfHasImage) {
        console.log('Skip image (already set)', row.sanityDocumentId)
        skipped++
        continue
      }
      let buffer
      const filename = row.suggestedAssetFilename || row.relativePath.split('/').pop() || 'image'
      if (row.localFileExists && row.localPath) {
        buffer = readFileSync(row.localPath)
      } else if (imageBaseUrl) {
        const pathPart = row.relativePath.replace(/^\/+/, '')
        const url = `${imageBaseUrl.replace(/\/$/, '')}/${pathPart}`
        buffer = await fetchWithRetry(url)
      } else {
        console.warn('Skip image (no local file, no MIGRATE_IMAGE_BASE_URL)', row.sanityDocumentId, row.status)
        skipped++
        continue
      }
      const asset = await uploadAssetWithRetry(client, buffer, filename)
      await client
        .patch(row.sanityDocumentId)
        .set({
          image: {
            _type: 'image',
            asset: { _type: 'reference', _ref: asset._id },
          },
        })
        .commit()
      uploaded++
      console.log('Uploaded image', row.sanityDocumentId, '→', asset._id)
      await sleep(80)
    } catch (e) {
      console.error('Image failed', row.sanityDocumentId, e.message || e)
      failed++
    }
  }
  console.log(`Image pass: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`)
  if (skipped > 0) {
    console.log('Tip: open output/show-images-manifest.json and filter by status (e.g. no_thumbnail, file_missing).')
  }
  if (failed > 0) process.exitCode = 1
}

function main() {
  const { sqlPath, prefix, dryRun, push, manifestImages, uploadsRoot, uploadImagesOnPush, forceImageUpload } =
    parseArgs()

  let sqlContent
  try {
    sqlContent = readFileSync(sqlPath, 'utf8')
  } catch (e) {
    console.error('Failed to read SQL file:', sqlPath)
    console.error(e.message)
    console.error('Provide path to WordPress dump, e.g. node index.js /path/to/jocczzlm_canino.sql')
    process.exit(1)
  }

  const { posts, meta, options } = parseWpDump(sqlContent, prefix)

  const program = extractProgram(posts, meta)
  const settings = extractSettings(meta, options)
  const { shows, imagePaths } = extractShows(posts, meta)
  const events = extractEvents(posts, meta)
  const artists = extractArtists(posts)

  mkdirSync(outputDir, { recursive: true })

  writeFileSync(join(outputDir, 'program.json'), JSON.stringify(program, null, 2))
  writeFileSync(join(outputDir, 'settings.json'), JSON.stringify(settings, null, 2))
  writeFileSync(join(outputDir, 'shows.json'), JSON.stringify(shows, null, 2))
  writeFileSync(join(outputDir, 'events.json'), JSON.stringify(events, null, 2))
  writeFileSync(join(outputDir, 'artists.json'), JSON.stringify(artists, null, 2))
  writeFileSync(
    join(outputDir, 'image-paths.txt'),
    imagePaths.map((i) => `${i.postId}\t${i.title}\t${i.guid}`).join('\n') || '(no featured images in dump – upload manually)'
  )

  if (manifestImages) {
    const manifest = buildShowImagesManifest(posts, meta, uploadsRoot)
    writeFileSync(join(outputDir, 'show-images-manifest.json'), JSON.stringify(manifest, null, 2))
    const withPath = manifest.filter((r) => r.relativePath).length
    const missingOnDisk = manifest.filter((r) => r.status === 'file_missing').length
    const noFeatured = manifest.filter((r) => r.status === 'no_thumbnail').length
    console.log(
      `show-images-manifest.json: ${manifest.length} shows; ${withPath} with relativePath; ${missingOnDisk} missing on disk; ${noFeatured} without featured image`
    )
    if (!uploadsRoot) {
      console.log('  (No --uploads-root / MIGRATE_UPLOADS_ROOT / default folder: relativePath only.)')
    }
  }

  console.log('Extraction done. Output in', outputDir)
  console.log(
    '  program.json, settings.json, shows.json, events.json, artists.json, image-paths.txt' +
      (manifestImages ? ', show-images-manifest.json' : '')
  )

  if (dryRun) {
    console.log('Dry run: not pushing to Sanity.')
    return
  }

  if (!push) {
    console.log('To push to Sanity, run with --push and set SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN.')
    return
  }

  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET || 'production'
  const token = process.env.SANITY_WRITE_TOKEN
  if (!projectId || !token) {
    console.error('Set SANITY_PROJECT_ID and SANITY_WRITE_TOKEN to push. Do not commit the token.')
    process.exit(1)
  }

  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: '2024-01-01',
    useCdn: false,
  })

  const imageBaseUrl = (process.env.MIGRATE_IMAGE_BASE_URL || '').trim().replace(/\/$/, '')

  /** Avoid wiping `image` when re-running --push (createOrReplace is full replacement). */
  async function attachExistingShowImages(client, showDocs) {
    if (!showDocs.length) return
    const ids = showDocs.map((s) => s._id)
    const rows = await client.fetch(`*[_id in $ids]{ _id, image }`, { ids })
    const byId = new Map(rows.map((r) => [r._id, r]))
    for (const s of showDocs) {
      const prev = byId.get(s._id)
      if (prev?.image?.asset?._ref) s.image = prev.image
    }
  }

  async function pushAll() {
    await attachExistingShowImages(client, shows)
    const transactions = []
    const docs = [program, settings, ...shows, ...events, ...artists]
    for (const doc of docs) {
      if (doc._id && doc._type) {
        transactions.push(
          client.createOrReplace(doc).then(() => console.log('Created/updated', doc._id))
        )
      }
    }
    await Promise.all(transactions)
    console.log('Documents push complete.')

    if (uploadImagesOnPush) {
      const imageManifest = buildShowImagesManifest(posts, meta, uploadsRoot)
      console.log('Uploading show images…')
      if (!uploadsRoot && !imageBaseUrl) {
        console.warn(
          'Warning: no --uploads-root and no MIGRATE_IMAGE_BASE_URL — images only upload where localPath exists (none without uploads root).'
        )
      }
      await pushShowImages(client, imageManifest, {
        skipIfHasImage: !forceImageUpload,
        imageBaseUrl,
      })
    } else {
      console.log('Skipped image upload (--no-upload-images).')
    }
    console.log('Push complete.')
  }

  pushAll().catch((err) => {
    console.error('Push failed:', err)
    process.exit(1)
  })
}

main()
