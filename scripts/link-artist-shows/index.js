#!/usr/bin/env node
/**
 * Canino FM – backfill show.artists[] from existing show titles.
 *
 * The WordPress migration never captured a show↔artist relationship structurally —
 * `artist` documents exist as a flat name list, and any artist association only lives
 * informally inside free-text show titles (e.g. "Polyglot w. muck", "wedding scammer b2b Titi Calor").
 * This script splits each show title on common separators (and parentheses, for
 * multi-artist / annotation credits like "Only Now (Live)") and links the segments that
 * exactly match an existing artist name (case-insensitive).
 *
 * Before matching, it applies the corrections in ./corrections.js — known artist-name
 * fixes, new artists, and show-title fixes — so re-running this after a fresh WordPress
 * export (which can reintroduce the original spellings) keeps producing the same result.
 * Shows still unmatched after that are reported for manual linking in Studio; add a
 * correction for them once you know the fix, rather than linking by hand each time.
 *
 * Usage:
 *   node index.js [--dry-run] [--push]
 *
 * - --dry-run (default): compute corrections + matches, print a report, write nothing.
 * - --push: apply corrections and patch matched show documents' `artists` field in Sanity.
 *
 * Requires SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN in env
 * (loads ../../.env then ./.env, same convention as scripts/migrate-from-wp).
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { createClient } from '@sanity/client'
import { artistRenames, newArtists, titleCorrections, manualLinks } from './corrections.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config({ path: join(__dirname, '.env') })

const SEPARATOR_RE = /\s*[()]\s*|\s+(?:w\.|b2b|vs\.?|&|\+|x|presents?|feat\.?|ft\.?)\s+/i

function parseArgs() {
  const args = process.argv.slice(2)
  const push = args.includes('--push')
  return { push, dryRun: !push }
}

function norm(name) {
  return name.trim().toLowerCase()
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'artist'
  )
}

function splitTitleCandidates(title) {
  return title
    .split(SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Matches title segments against known artist names; returns [] when nothing matches. */
function matchArtists(title, artistByNormName) {
  // Whole-title fast path: some artist names contain parentheses (e.g. "(a)"), which
  // the separator split below would otherwise strip and break.
  const wholeTitleMatch = artistByNormName.get(norm(title))
  if (wholeTitleMatch) return [wholeTitleMatch]

  const candidates = splitTitleCandidates(title)
  const matched = []
  const seen = new Set()
  for (const candidate of candidates) {
    const artist = artistByNormName.get(norm(candidate))
    if (artist && !seen.has(artist._id)) {
      seen.add(artist._id)
      matched.push(artist)
    }
  }
  return matched
}

/** Same set of ids, regardless of order — used to skip no-op patches. */
function sameRefs(existingRefs, matchedIds) {
  const existing = new Set((existingRefs || []).map((r) => r._ref))
  if (existing.size !== matchedIds.length) return false
  return matchedIds.every((id) => existing.has(id))
}

/**
 * Applies known fixes from corrections.js to the in-memory shows/artists arrays
 * (so the report below reflects them even on --dry-run) and, when `write` is true,
 * persists each one to Sanity. Idempotent: already-applied corrections are silently
 * skipped (detected by the target name/title already existing).
 */
async function applyCorrections(client, shows, artists, { write }) {
  const log = []

  for (const { from, to } of artistRenames) {
    const artist = artists.find((a) => a.name && norm(a.name) === norm(from))
    if (artist) {
      log.push(`Rename artist "${artist.name}" → "${to}" (${artist._id})`)
      artist.name = to
      if (write) await client.patch(artist._id).set({ name: to }).commit()
    } else if (!artists.some((a) => a.name && norm(a.name) === norm(to))) {
      log.push(`WARNING: artist rename source "${from}" not found (target "${to}" also missing)`)
    }
  }

  for (const name of newArtists) {
    if (artists.some((a) => a.name && norm(a.name) === norm(name))) continue
    const id = `artist-manual-${slugify(name)}`
    log.push(`Create artist "${name}" (${id})`)
    const doc = { _type: 'artist', _id: id, name }
    artists.push(doc)
    if (write) await client.createIfNotExists(doc)
  }

  for (const { oldTitle, newTitle } of titleCorrections) {
    // .filter, not .find: some titles (e.g. "Brain Digging w. DJ Sport") belong to
    // more than one show and all of them need the same fix.
    const matches = shows.filter((s) => s.title === oldTitle)
    if (matches.length) {
      for (const show of matches) {
        log.push(`Retitle show ${show._id}: "${oldTitle}" → "${newTitle}"`)
        show.title = newTitle
        if (write) await client.patch(show._id).set({ title: newTitle }).commit()
      }
    } else if (!shows.some((s) => s.title === newTitle)) {
      log.push(`WARNING: show with title "${oldTitle}" not found (target title also missing)`)
    }
  }

  return log
}

async function main() {
  const { push, dryRun } = parseArgs()

  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET || 'production'
  const token = process.env.SANITY_WRITE_TOKEN
  if (!projectId || !token) {
    console.error('Set SANITY_PROJECT_ID and SANITY_WRITE_TOKEN (Editor token) to run this script.')
    process.exit(1)
  }

  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: '2024-01-01',
    useCdn: false,
  })

  console.log(`Fetching shows and artists from dataset "${dataset}"…`)
  const [shows, artists] = await Promise.all([
    client.fetch('*[_type == "show"]{ _id, title, artists }'),
    client.fetch('*[_type == "artist"]{ _id, name }'),
  ])

  const correctionsLog = await applyCorrections(client, shows, artists, { write: push })
  if (correctionsLog.length) {
    console.log('')
    console.log(`Corrections (${push ? 'applied' : 'planned'}):`)
    for (const line of correctionsLog) console.log(`  ${line}`)
  }

  const artistByNormName = new Map(artists.filter((a) => a.name).map((a) => [norm(a.name), a]))
  const manualLinksByTitle = new Map(manualLinks.map((m) => [m.title, m.artists]))

  const toUpdate = []
  const unmatched = []
  let alreadyLinked = 0

  for (const show of shows) {
    if (!show.title) {
      unmatched.push(show.title || show._id)
      continue
    }

    let matched
    if (manualLinksByTitle.has(show.title)) {
      const names = manualLinksByTitle.get(show.title)
      matched = names.map((n) => artistByNormName.get(norm(n))).filter(Boolean)
      const missing = names.filter((n) => !artistByNormName.get(norm(n)))
      if (missing.length) {
        console.warn(`manualLinks: could not resolve [${missing.join(', ')}] for "${show.title}"`)
      }
    } else {
      matched = matchArtists(show.title, artistByNormName)
    }

    if (matched.length === 0) {
      unmatched.push(show.title)
      continue
    }
    const matchedIds = matched.map((a) => a._id)
    if (sameRefs(show.artists, matchedIds)) {
      alreadyLinked++
      continue
    }
    toUpdate.push({ show, matched })
  }

  console.log('')
  console.log(`Shows: ${shows.length}`)
  console.log(`  Already linked (no change needed): ${alreadyLinked}`)
  console.log(`  To ${push ? 'update' : 'be updated'}: ${toUpdate.length}`)
  console.log(`  Unmatched (need manual linking in Studio, or a new correction): ${unmatched.length}`)
  if (unmatched.length) {
    console.log('')
    console.log('Unmatched show titles:')
    for (const title of unmatched) console.log(`  - ${title}`)
  }

  if (toUpdate.length) {
    console.log('')
    console.log(`Sample of ${push ? 'updates' : 'planned updates'}:`)
    for (const { show, matched } of toUpdate.slice(0, 10)) {
      console.log(`  ${show._id} "${show.title}" → ${matched.map((a) => a.name).join(', ')}`)
    }
    if (toUpdate.length > 10) console.log(`  … and ${toUpdate.length - 10} more`)
  }

  if (dryRun) {
    console.log('')
    console.log('Dry run: no changes written. Re-run with --push to apply.')
    return
  }

  console.log('')
  console.log(`Patching ${toUpdate.length} show(s)…`)
  let patched = 0
  let failed = 0
  for (const { show, matched } of toUpdate) {
    try {
      await client
        .patch(show._id)
        .set({
          artists: matched.map((a, i) => ({
            _type: 'reference',
            _ref: a._id,
            _key: `artist-${a._id}-${i}`,
          })),
        })
        .commit()
      patched++
    } catch (e) {
      console.error(`Failed to patch ${show._id}:`, e.message || e)
      failed++
    }
  }
  console.log(`Done: ${patched} patched, ${failed} failed.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
