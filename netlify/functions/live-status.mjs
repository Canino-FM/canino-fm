/**
 * Reports whether the Canino FM YouTube channel is currently live.
 *
 * The browser cannot check this itself — youtube.com sends no CORS headers — so the
 * page asks this function instead.
 *
 * It deliberately does not use the YouTube Data API: `search.list` costs 100 quota units
 * against a 10,000-unit daily project budget, i.e. 100 calls a day, which a polling page
 * exhausts in minutes. Fetching the channel's /live page costs nothing and needs no key,
 * so nothing secret ships to the browser.
 *
 * Three outcomes, not two:
 *
 *   { live: true }                  streaming now
 *   { live: false }                 the page parsed fine and nothing is streaming
 *   { live: null, reason: '…' }     we could not tell
 *
 * The third matters. A timeout, a 429 or a consent interstitial served to Netlify's
 * datacenter IPs must not be reported as "offline": the hero would tear down a stream
 * that is actually running, and a cached mistake would do it for every visitor at once.
 *
 * The critical property is that "the field says not live" and "I could not find the
 * field" are DIFFERENT ANSWERS. An earlier version tested loose substrings against the
 * whole document, so any markup change YouTube shipped would have produced a confident,
 * cached, unlogged "offline" — the same failure as reporting errors as offline, reached
 * by a different route. Everything below parses the player payload as data instead.
 */

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCaR-E0AKLsDDS1Xgl7_DdZQ'

/**
 * Spoofed desktop Chrome: YouTube serves unknown clients a stripped payload without the
 * player response. Worth refreshing occasionally — a stale UA is itself a bot signal.
 */
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

/** Netlify's function limit is 10s; this leaves headroom to still return a response. */
const UPSTREAM_TIMEOUT_MS = 8000

/** Determinate answers absorb traffic at the edge: YouTube sees ~1 request a minute. */
const BROWSER_CACHE_SECONDS = 30
const EDGE_CACHE_SECONDS = 60

/**
 * Undetermined answers get a short TTL rather than `no-store`. Zero would remove the
 * edge's backpressure at exactly the moment upstream is refusing, so a transient 429
 * would be amplified by every visitor into a sustained block.
 */
const UNDETERMINED_EDGE_SECONDS = 10

/** Guards upstream even when the CDN is bypassed (a query string changes the cache key). */
const MEMO_MS = 25_000

/**
 * Rendered by the YouTube app shell on any real page, idle or watch. Its absence means a
 * consent wall, a bot check, or markup we no longer understand.
 *
 * The trailing `= ` is load-bearing: it matches the assignment of the data payload. The
 * bare identifier also appears as an argument name inside YouTube's minified bundle, so
 * testing for it alone matches literally every page the shell serves — which is how the
 * previous version's health check passed the interstitials it existed to reject.
 */
const SHELL_PAYLOAD = 'var ytInitialData = '

/** Only a watch page assigns a player response; an idle channel serves the browse page. */
const PLAYER_PAYLOAD = 'ytInitialPlayerResponse = '

/**
 * Identifies the browse page positively. Measured: 5 occurrences on an idle channel, 0 on
 * a live one. Without this, "no player payload" would be read as "idle", so renaming the
 * payload marker would make every page look idle — a confident, cached, permanent offline.
 */
const BROWSE_PAYLOAD = '"tabRenderer"'

/**
 * Slices the JSON object that follows `marker` by matching braces, respecting strings and
 * escapes. A non-greedy regex cannot do this: the payload contains `};` inside string
 * values, so it would truncate and the parse would fail on a perfectly healthy page.
 */
function extractJsonObject(html, marker) {
	const markerAt = html.indexOf(marker)
	if (markerAt === -1) return null

	const start = html.indexOf('{', markerAt + marker.length)
	if (start === -1) return null

	let depth = 0
	let inString = false
	let escaped = false

	for (let i = start; i < html.length; i++) {
		const char = html[i]

		if (escaped) {
			escaped = false
			continue
		}
		if (char === '\\') {
			if (inString) escaped = true
			continue
		}
		if (char === '"') {
			inString = !inString
			continue
		}
		if (inString) continue

		if (char === '{') depth += 1
		else if (char === '}') {
			depth -= 1
			if (depth === 0) return html.slice(start, i + 1)
		}
	}

	return null
}

/** Exported for tests: the whole classification, with no network involved. */
export function classify(html) {
	if (!html.includes(SHELL_PAYLOAD)) {
		return { live: null, reason: 'unrecognised_page', bytes: html.length }
	}

	const raw = extractJsonObject(html, PLAYER_PAYLOAD)
	if (!raw) {
		// Only call it idle if the page says so. Inferring idle from a missing player payload
		// would turn any rename of that marker into a permanent, confident "offline".
		if (html.includes(BROWSE_PAYLOAD)) return { live: false }
		return { live: null, reason: 'neither_watch_nor_browse', bytes: html.length }
	}

	let player
	try {
		player = JSON.parse(raw)
	} catch {
		return { live: null, reason: 'unparseable_player', bytes: raw.length }
	}

	const details = player?.videoDetails
	if (!details) return { live: null, reason: 'no_video_details' }

	// A members-only, geo-blocked or still-processing stream can report isLive while being
	// unplayable; mounting the embed for one shows a YouTube error panel, not a broadcast.
	const playable = player?.playabilityStatus?.status === 'OK'

	return { live: details.isLive === true && details.isUpcoming !== true && playable }
}

async function readLiveStatus() {
	const res = await fetch(`https://www.youtube.com/channel/${CHANNEL_ID}/live`, {
		headers: {
			'user-agent': USER_AGENT,
			'accept-language': 'en',
			// Skips the EU consent interstitial, which otherwise replaces the player payload.
			cookie: 'CONSENT=YES+1',
		},
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
	})

	if (!res.ok) return { live: null, reason: 'upstream_error', status: res.status }

	return classify(await res.text())
}

let memo = null
let lastLogged

async function currentStatus() {
	if (memo && Date.now() - memo.at < MEMO_MS) return memo.payload

	let payload
	try {
		payload = await readLiveStatus()
	} catch (error) {
		const timedOut = error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError'
		payload = {
			live: null,
			reason: timedOut ? 'timeout' : 'fetch_failed',
			// node's fetch puts the real cause (ENOTFOUND, ECONNRESET, …) on error.cause.
			detail: error?.cause?.code || error?.cause?.message || error?.message || String(error),
		}
	}

	memo = { payload, at: Date.now() }
	return payload
}

export default async function handler(req) {
	if (req?.method && req.method !== 'GET') {
		return new Response(null, { status: 405, headers: { allow: 'GET' } })
	}

	const payload = await currentStatus()
	const determinate = typeof payload.live === 'boolean'

	// Logs transitions rather than every poll, so "has this returned true at all this week?"
	// is answerable from the function log. A steady state logs nothing.
	const state = determinate ? String(payload.live) : `null:${payload.reason}`
	if (state !== lastLogged) {
		lastLogged = state
		console.log('live-status', CHANNEL_ID, '→', JSON.stringify(payload))
	}

	return new Response(JSON.stringify(payload), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': determinate
				? `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}`
				: `public, max-age=0, s-maxage=${UNDETERMINED_EDGE_SECONDS}`,
		},
	})
}

export const config = { path: '/api/live-status' }
