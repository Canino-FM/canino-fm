/**
 * Reports whether the Canino FM YouTube channel is currently live.
 *
 * The browser cannot check this itself — youtube.com sends no CORS headers — so the
 * page asks this function instead.
 *
 * It deliberately does not use the YouTube Data API: since June 2026 `search.list` is
 * capped at 100 calls per day for the whole project, which a polling page burns through
 * in minutes. Fetching the channel's /live page costs nothing and has no quota, and a
 * determinate answer is cached at Netlify's edge so YouTube sees roughly one request a
 * minute no matter how many people are on the site.
 *
 * Three outcomes, not two:
 *
 *   { live: true }                     streaming now
 *   { live: false }                    the page parsed fine and says nothing is live
 *   { live: null, reason: '…' }        we could not tell
 *
 * The third matters. A timeout, a 429, or a consent/bot interstitial served to Netlify's
 * datacenter IPs must not be reported as "offline": the hero would tear down a stream
 * that is actually running, and an edge-cached mistake would do it for every visitor at
 * once. Undetermined answers are returned uncached and logged instead.
 */

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCaR-E0AKLsDDS1Xgl7_DdZQ'

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

/** Browser may reuse its copy for this long; the edge refreshes on the longer interval. */
const BROWSER_CACHE_SECONDS = 30
const EDGE_CACHE_SECONDS = 60

/**
 * Present on every real channel page, live or idle. Its absence means we were served
 * something else — a consent wall, a bot check, or markup we no longer understand —
 * and the live/idle distinction below cannot be trusted.
 */
const PAGE_HEALTH_MARKER = 'ytInitialPlayerResponse'

/**
 * Observed on a live channel and on no idle one. `hlsManifestUrl` is deliberately not
 * used: it is missing from some live responses, and a recently-ended stream can still
 * carry one for its DVR window, which would mount the player over nothing.
 */
const LIVE_MARKER = '"isLive":true'

/** A scheduled stream's waiting room is not a broadcast. */
const UPCOMING_MARKER = '"isUpcoming":true'

async function readLiveStatus() {
	const res = await fetch(`https://www.youtube.com/channel/${CHANNEL_ID}/live`, {
		headers: {
			'user-agent': USER_AGENT,
			'accept-language': 'en',
			// Skips the EU consent interstitial, which otherwise replaces the player payload.
			cookie: 'CONSENT=YES+1',
		},
		signal: AbortSignal.timeout(8000),
	})

	if (!res.ok) return { live: null, reason: `upstream_${res.status}` }

	const html = await res.text()

	if (!html.includes(PAGE_HEALTH_MARKER)) {
		return { live: null, reason: 'unrecognised_page', bytes: html.length }
	}

	if (html.includes(UPCOMING_MARKER) && !html.includes(LIVE_MARKER)) {
		return { live: false }
	}

	return { live: html.includes(LIVE_MARKER) }
}

export default async function handler() {
	let payload
	try {
		payload = await readLiveStatus()
	} catch (error) {
		payload = { live: null, reason: error?.name === 'TimeoutError' ? 'timeout' : 'fetch_failed' }
	}

	const determinate = typeof payload.live === 'boolean'

	if (!determinate) {
		// Surfaces in the Netlify function log, so a permanent "Offline" is diagnosable.
		console.warn('live-status undetermined:', JSON.stringify(payload))
	}

	return new Response(JSON.stringify(payload), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			// Never cache a non-answer: one bad minute would otherwise be served to everyone.
			'cache-control': determinate
				? `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}`
				: 'no-store',
		},
	})
}

export const config = { path: '/api/live-status' }
