#!/usr/bin/env node
/**
 * Canino FM – WordPress to Sanity migration
 *
 * Usage:
 *   node index.js [path-to.sql] [--prefix=wp_] [--dry-run] [--push]
 *
 * - path-to.sql: path to WordPress MySQL dump (e.g. jocczzlm_canino.sql). If omitted, uses MIGRATE_SQL_PATH env or ./canino.sql.
 * - --prefix=wp_: table prefix (default wp_, or jocczzlm_ for jocczzlm_canino).
 * - --dry-run: only extract and write JSON to ./output; do not push to Sanity.
 * - --push: push extracted data to Sanity (requires SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN in env).
 *   Loads ../../.env then ./.env (repo root first, then this folder) so you need not inline vars.
 *
 * Do not commit SANITY_WRITE_TOKEN. Use only for one-off migration.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
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
  for (const a of args) {
    if (a === '--dry-run') dryRun = true
    else if (a === '--push') push = true
    else if (a.startsWith('--prefix=')) prefix = a.slice('--prefix='.length).replace(/^["']|["']$/g, '')
    else if (!a.startsWith('-')) sqlPath = a
  }
  return { sqlPath, prefix, dryRun, push }
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
    defaultPlayerEmbed: pageMeta.soundcloud || '',
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

function main() {
  const { sqlPath, prefix, dryRun, push } = parseArgs()

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

  console.log('Extraction done. Output in', outputDir)
  console.log('  program.json, settings.json, shows.json, events.json, artists.json, image-paths.txt')

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

  async function pushAll() {
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
    console.log('Push complete.')
  }

  pushAll().catch((err) => {
    console.error('Push failed:', err)
    process.exit(1)
  })
}

main()
