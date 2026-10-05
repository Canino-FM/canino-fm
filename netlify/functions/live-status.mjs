/**
 * Is the Canino FM YouTube channel broadcasting right now?
 *
 * The browser cannot check this itself — googleapis.com sends no CORS headers for an
 * API key request, and the key must not ship to the client anyway — so this runs here.
 *
 * ## Why this replaced a scraper
 *
 * The first version fetched the channel's /live page and read YouTube's internal
 * `ytInitialPlayerResponse` payload. It worked from a developer's machine and never
 * worked in production: YouTube scores datacenter IP ranges — every Netlify, VPS and CI
 * host — far below home connections and 302s them to consent.youtube.com. The function
 * received a consent page whose player payload has no `videoDetails`, so a real
 * broadcast read as `{"live":null,"reason":"no_video_details"}` for its entire run.
 *
 * Sending a `CONSENT=YES+1` cookie to step around that interstitial was both fragile and
 * the wrong thing to do. The Data API authenticates properly and never sees a consent
 * wall.
 *
 * ## The contract this file exists to keep
 *
 * Three answers, never two:
 *
 *   true   a public, embeddable video on this channel is live right now
 *   false  both API calls parsed cleanly and nothing on the channel is live
 *   null   we could not tell — plus a `reason`
 *
 * `false` is a claim, not a default. Every failure — missing key, non-2xx, exhausted
 * quota, unparseable body, missing fields — is `null`. This matters because `false` is
 * cached at the edge and served to every visitor: a wrong `false` takes the player down
 * for everyone, during a show, and logs nothing. The feature has broken this way twice.
 *
 * ## Known limitation, unverified as of 2026-10-05
 *
 * Liveness is read from the channel's uploads playlist. Whether a broadcast reliably
 * appears there *while it is live* has NOT been confirmed against a real show. Evidence
 * is mixed: after the 2026-10-04 broadcast, the five VODs carried feed timestamps ~14h
 * after air, and the first show of the day was still absent the next morning.
 *
 * If the playlist turns out to lag, this returns `false` during a live show — the same
 * user-visible failure as before, from a different cause. `findCandidateIds` is
 * deliberately the only place that knows where IDs come from, so swapping it for
 * `liveBroadcasts.list` (authoritative, 1 unit, but OAuth rather than an API key) is a
 * contained change.
 *
 * VERIFY THIS DURING THE NEXT BROADCAST before trusting a `false`.
 */

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCaR-E0AKLsDDS1Xgl7_DdZQ'
const API_KEY = process.env.YOUTUBE_API_KEY

/**
 * Every channel's uploads playlist is its channel id with the `UC` prefix swapped for
 * `UU`. Documented by YouTube and stable; it saves a `channels.list` call per request.
 */
const UPLOADS_PLAYLIST_ID = `UU${CHANNEL_ID.slice(2)}`

/** Headroom: a live broadcast should be newest, but a six-show day puts several in flight. */
const CANDIDATE_COUNT = 10

const API_ROOT = 'https://www.googleapis.com/youtube/v3'
const UPSTREAM_TIMEOUT_MS = 8000

const BROWSER_CACHE_SECONDS = 30
const EDGE_CACHE_SECONDS = 60

/**
 * An undetermined answer is still cached, briefly. `no-store` would remove backpressure
 * exactly when upstream is refusing — a transient 429 would amplify into a sustained one.
 */
const UNDETERMINED_EDGE_SECONDS = 10

/** Guards upstream even when the CDN is bypassed (a query string changes the cache key). */
const MEMO_MS = 25_000

/**
 * Pulls the most recent uploads. Returns `{ ids }` or `{ reason }` — never a bare array,
 * so "no videos" cannot be mistaken for "nothing live".
 */
export function readCandidateIds(body) {
	const items = body?.items
	if (!Array.isArray(items)) return { reason: 'playlist_shape' }

	const ids = items.map((i) => i?.contentDetails?.videoId).filter((id) => typeof id === 'string')

	// The channel has 300+ uploads. An empty page means the response is not what we think
	// it is, not that Canino has no videos — so it must not read as "nothing is live".
	if (!ids.length) return { reason: 'no_candidates' }

	return { ids }
}

/**
 * Decides liveness from a `videos.list` body.
 *
 * `liveBroadcastContent` is the documented field and carries `live`, `upcoming` or
 * `none` — so a scheduled broadcast's waiting room is excluded here rather than needing
 * the separate `isUpcoming` guard the scraper version got wrong.
 *
 * `embeddable` and `privacyStatus` replace the old `playabilityStatus` check: a
 * members-only, private or non-embeddable stream is live for YouTube but would mount a
 * dead error panel in our hero, which is worse than showing Offline.
 */
export function classifyVideos(body) {
	const items = body?.items
	if (!Array.isArray(items)) return { live: null, reason: 'videos_shape' }

	for (const item of items) {
		if (item?.snippet?.liveBroadcastContent !== 'live') continue
		if (item?.status?.embeddable !== true) continue
		if (item?.status?.privacyStatus !== 'public') continue
		return { live: true }
	}

	return { live: false }
}

/**
 * Maps a Google API error body to a reason. Quota exhaustion is called out because it is
 * the one failure that is both likely and self-inflicted, and it looks identical to a
 * generic 403 in a log otherwise.
 */
export function errorReason(status, body) {
	const reason = body?.error?.errors?.[0]?.reason
	if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'quota_exceeded'
	if (reason === 'keyInvalid' || reason === 'ipRefererBlocked') return 'key_rejected'
	return `upstream_${status}`
}

/** Returns a parsed body, or throws with a reason this file knows how to report. */
async function getJson(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })

	let body = null
	try {
		body = await res.json()
	} catch {
		// A non-2xx with an unreadable body is still a known-shaped failure; report the
		// status rather than the parse error, which would hide why it failed.
		if (!res.ok) throw Object.assign(new Error('upstream'), { reason: `upstream_${res.status}` })
		throw Object.assign(new Error('unparseable'), { reason: 'unparseable_body' })
	}

	if (!res.ok) throw Object.assign(new Error('upstream'), { reason: errorReason(res.status, body) })
	return body
}

/**
 * The only place that knows where candidate video IDs come from. See the limitation note
 * at the top of this file: if the uploads playlist proves to lag live broadcasts, this
 * function is what gets replaced.
 */
async function findCandidateIds() {
	const url =
		`${API_ROOT}/playlistItems?part=contentDetails` +
		`&playlistId=${encodeURIComponent(UPLOADS_PLAYLIST_ID)}` +
		`&maxResults=${CANDIDATE_COUNT}&key=${encodeURIComponent(API_KEY)}`
	return readCandidateIds(await getJson(url))
}

async function readLiveStatus() {
	// Without a key every request would 400. Reporting that as `false` would show Offline
	// through an entire broadcast with nothing to explain it — the exact failure this
	// rewrite exists to end.
	if (!API_KEY) return { live: null, reason: 'no_api_key' }

	const candidates = await findCandidateIds()
	if (candidates.reason) return { live: null, reason: candidates.reason }

	const url =
		`${API_ROOT}/videos?part=snippet,status` +
		`&id=${candidates.ids.map(encodeURIComponent).join(',')}` +
		`&key=${encodeURIComponent(API_KEY)}`
	return classifyVideos(await getJson(url))
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
			reason: error?.reason || (timedOut ? 'timeout' : 'fetch_failed'),
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

	const ttl = determinate ? EDGE_CACHE_SECONDS : UNDETERMINED_EDGE_SECONDS

	return new Response(JSON.stringify(payload), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': `public, max-age=${determinate ? BROWSER_CACHE_SECONDS : 0}`,
			/**
			 * Netlify's edge cache is per-region, so without `durable` each region invokes
			 * the function separately and quota cost multiplies by the number of regions
			 * serving traffic. `durable` makes them share one entry: roughly 2,880 units a
			 * day against the 10,000 default, rather than that figure per region.
			 */
			'netlify-cdn-cache-control': `public, durable, max-age=${ttl}`,
		},
	})
}

export const config = { path: '/api/live-status' }
