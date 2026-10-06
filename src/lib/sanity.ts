import { createImageUrlBuilder } from '@sanity/image-url'
import { sanityClient } from 'sanity:client'

export interface ProgramEventShow {
	schedule?: string
	title?: string
}

export interface ProgramEvent {
	date?: string
	shows?: ProgramEventShow[]
}

export interface ProgramDoc {
	events?: ProgramEvent[]
}

export interface SettingsDoc {
	about?: string
	contact?: string
	live?: string
	link?: string
}

interface ArtistRef {
	_id: string
	name?: string
}

interface ShowRef {
	_id: string
	title?: string
	image?: Record<string, unknown> | null
	soundcloud?: string
	artists?: ArtistRef[] | null
}

interface EventDoc {
	_id: string
	date: string
	shows?: ShowRef[] | null
}

interface ArtistDoc {
	_id: string
	name?: string
}

export interface ArchiveShowArtist {
	id: string
	name: string
	slug: string
}

export interface ArchiveShow {
	eventDate: string
	showTitle: string
	imageUrl: string | null
	soundcloudSrc: string
	artists: ArchiveShowArtist[]
}

export interface SiteArtist {
	id: string
	name: string
	slug: string
}

/** Lowercase, strip diacritics, collapse anything non-alphanumeric into single hyphens. */
export function slugify(name: string): string {
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

const programQuery = `*[_type == "program"][0]{
  events[]{ date, shows[]{ schedule, title } }
}`

const settingsQuery = `*[_type == "settings"][0]{
  about, contact, live, link
}`

const eventsQuery = `*[_type == "event"]{
  _id,
  date,
  shows[]->{ _id, title, image, soundcloud, artists[]->{ _id, name } }
}`

// Sorted client-side (see siteArtists below) rather than with GROQ's `order(name asc)`,
// which sorts by raw codepoint — case-sensitive and diacritic-sensitive, so e.g. all-caps
// names like "ALVVA" cluster together instead of interleaving alphabetically.
const artistsQuery = `*[_type == "artist"] {
  _id,
  name
}`

export async function fetchHomePageData() {
	const projectId = import.meta.env.SANITY_PROJECT_ID
	if (!projectId?.trim()) {
		throw new Error(
			'Missing SANITY_PROJECT_ID. Add a root `.env` with that variable (see README).',
		)
	}

	const [program, settings, events, artists] = await Promise.all([
		sanityClient.fetch<ProgramDoc | null>(programQuery),
		sanityClient.fetch<SettingsDoc | null>(settingsQuery),
		sanityClient.fetch<EventDoc[]>(eventsQuery),
		sanityClient.fetch<ArtistDoc[]>(artistsQuery),
	])

	const builder = createImageUrlBuilder(sanityClient)

	const urlFor = (source: Record<string, unknown> | null | undefined) => {
		if (!source) return null
		try {
			return builder.image(source as never).width(900).quality(85).auto('format').url()
		} catch {
			return null
		}
	}

	const sortedEvents = [...(events ?? [])].sort(
		(a, b) => parseEventDateKey(b.date) - parseEventDateKey(a.date),
	)

	const archiveShows: ArchiveShow[] = []
	for (const ev of sortedEvents) {
		const list = ev.shows ?? []
		for (const s of list) {
			if (!s?._id) continue
			const raw = parseSoundcloudSrc(s.soundcloud)
			archiveShows.push({
				eventDate: ev.date,
				showTitle: s.title ?? '',
				imageUrl: urlFor(s.image),
				soundcloudSrc: normalizeSoundcloudColor(raw),
				artists: (s.artists ?? [])
					.filter((a): a is ArtistRef & { name: string } => Boolean(a?._id && a.name))
					.map((a) => ({ id: a._id, name: a.name, slug: slugify(a.name) })),
			})
		}
	}

	const heroVideoHtml =
		settings?.live?.includes('<iframe') || settings?.live?.includes('<IFRAME')
			? settings.live
			: null

	const siteArtists: SiteArtist[] = (artists ?? [])
		.filter((a): a is ArtistDoc & { name: string } => Boolean(a?._id && a.name))
		.map((a) => ({ id: a._id, name: a.name, slug: slugify(a.name) }))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

	return {
		program: program ?? { events: [] },
		settings: settings ?? {},
		archiveShows,
		artists: siteArtists,
		heroVideoHtml,
		heroIframeSrc: heroVideoHtml ? null : resolveHeroIframeSrc(settings),
	}
}

/** Groups archive shows by linked artist id, for artist pages and the "has a page" check. */
export function groupShowsByArtist(shows: ArchiveShow[]): Map<string, ArchiveShow[]> {
	const map = new Map<string, ArchiveShow[]>()
	for (const show of shows) {
		for (const artist of show.artists) {
			const list = map.get(artist.id)
			if (list) list.push(show)
			else map.set(artist.id, [show])
		}
	}
	return map
}

/** DD.MM.YY or DD.MM.YYYY → sortable number (approximate year 2000+). */
function parseEventDateKey(dateStr: string): number {
	const parts = dateStr.trim().split('.')
	if (parts.length < 3) return 0
	const d = parseInt(parts[0]!, 10)
	const m = parseInt(parts[1]!, 10)
	let y = parseInt(parts[2]!, 10)
	if (y < 100) y += 2000
	if (!d || !m || !y) return 0
	return y * 10000 + m * 100 + d
}

function parseSoundcloudSrc(raw: string | null | undefined): string {
	if (!raw?.trim()) return ''
	const t = raw.trim()
	if (/^https?:\/\//i.test(t) && !t.includes('<')) {
		return t
	}
	const m = t.match(/src=["']([^"']+)["']/i)
	return m?.[1]?.trim() ?? ''
}

function normalizeSoundcloudColor(src: string): string {
	return src.replace(/%23ff5500/gi, '%23000000')
}

function resolveHeroIframeSrc(settings: SettingsDoc | null | undefined): string | null {
	if (!settings) return null
	const live = settings.live?.trim()
	if (live) {
		if (live.includes('<iframe')) {
			const m = live.match(/src=["']([^"']+)["']/i)
			return m?.[1] ?? null
		}
		if (/^https?:\/\//i.test(live)) return live
	}
	const link = settings.link?.trim()
	if (link) {
		if (link.includes('<iframe')) {
			const m = link.match(/src=["']([^"']+)["']/i)
			return m?.[1] ?? null
		}
		if (/^https?:\/\//i.test(link)) return link
	}
	return null
}

export function chunkArchiveShows(shows: ArchiveShow[], size: number): ArchiveShow[][] {
	if (!shows.length) return []
	const out: ArchiveShow[][] = []
	for (let i = 0; i < shows.length; i += size) {
		out.push(shows.slice(i, i + size))
	}
	return out
}
