/**
 * Is the Canino FM YouTube channel broadcasting right now?
 *
 * This runs server-side so the API key never reaches the browser, and so one cached
 * answer serves every visitor rather than every visitor spending quota. (The YouTube
 * Data API is CORS-enabled; that is not the obstacle.)
 *
 * A previous version scraped the channel's /live page for YouTube's internal
 * `ytInitialPlayerResponse`. It worked from a home connection and never worked in
 * production: YouTube serves datacenter IPs a consent interstitial instead. On
 * 2026-10-04 the function logged `{"live":null,"reason":"no_video_details"}` for a whole
 * six-hour broadcast. Do not go back.
 *
 * ## The contract this file exists to keep
 *
 * Three answers, never two:
 *
 *   true   a public, embeddable video on the channel is live right now
 *   false  both calls parsed cleanly and none of the CANDIDATE_COUNT newest uploads
 *          is a public embeddable live stream
 *   null   we could not tell — plus a `reason`, and a `detail` on the throw path
 *
 * `false` is a claim, not a default. Every failure — missing key, non-2xx, exhausted
 * quota, unparseable body, a shape we do not recognise at any level — is `null`. This
 * matters because `false` is cached at the edge and served to every visitor: a wrong
 * `false` takes the player down for everyone, during a show, and a wrong `false` logs
 * as the bare word `false`, indistinguishable from a genuine quiet channel. There is no
 * post-hoc detection, so the only defence is that it be unconstructible. The feature has
 * broken this way twice.
 *
 * `reason` is deliberately open, but the `shape_` prefix is load-bearing: it marks the
 * class where YouTube changed something and the feature is silently dead. A single
 * `grep 'null:shape_'` over the function log is the health check for that.
 *
 * ## Where liveness is read from
 *
 * The channel's uploads playlist. That a broadcast appears there *while it is live* was
 * the one unverified assumption in this design; it was observed once, on the broadcast
 * of 2026-10-06, at the top of the playlist carrying `liveBroadcastContent: "live"`
 * within seconds of starting. One observation, not a guarantee.
 *
 * Were that to change, this would return `false` during a live show — the same
 * user-visible failure the scraper had, from a different cause. `findCandidateIds` is
 * deliberately the only place that knows where ids come from, so swapping it for
 * `liveBroadcasts.list` (authoritative, 1 unit, but OAuth rather than an API key)
 * remains a contained change.
 */

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCaR-E0AKLsDDS1Xgl7_DdZQ'
const API_KEY = process.env.YOUTUBE_API_KEY

/**
 * A channel's uploads playlist id is its channel id with `UC` swapped for `UU`. This is
 * a long-standing convention, not an API guarantee — the supported route is
 * `channels.list` → `contentDetails.relatedPlaylists.uploads`, which costs an extra unit
 * and an extra round trip. If it ever stops holding, a nonexistent playlist 404s and we
 * report `null`, never `false`. Only meaningful for a `UC…` id: a handle in
 * YOUTUBE_CHANNEL_ID silently yields a playlist that does not exist.
 */
const UPLOADS_PLAYLIST_ID = `UU${CHANNEL_ID.slice(2)}`

/**
 * Slack in case the live entry is not literally first. `videos.list` costs 1 unit for up
 * to 50 ids, so widening this is free — it only widens what a `false` means.
 */
const CANDIDATE_COUNT = 10

const API_ROOT = 'https://www.googleapis.com/youtube/v3'

/**
 * Netlify kills a synchronous function at 10s. This is the budget for the WHOLE request,
 * shared by both API calls — two independent 8s timeouts would let the platform kill us
 * at 10s before the handler could log or memoise anything, and the point of this file is
 * that it always answers.
 */
const UPSTREAM_BUDGET_MS = 7000

const BROWSER_CACHE_SECONDS = 30
const EDGE_CACHE_SECONDS = 60

/**
 * An undetermined answer is still cached, briefly. `no-store` would remove backpressure
 * exactly when upstream is refusing — a transient 429 would amplify into a sustained one.
 */
const UNDETERMINED_EDGE_SECONDS = 10

/**
 * Reasons that cannot clear on their own: re-asking every 10s is pure waste, and for
 * `quota_exceeded` it is actively harmful — 10s TTL is ~8,640 invocations a day, which
 * keeps the quota exhausted that it is reacting to.
 */
const STUCK_REASONS = new Set(['no_api_key', 'key_rejected', 'quota_exceeded', 'api_not_enabled'])
const STUCK_EDGE_SECONDS = 600

/** Guards upstream even when the CDN is bypassed (a query string changes the cache key). */
const MEMO_MS = 25_000

/**
 * Reads candidate video ids out of a `playlistItems.list` body.
 *
 * Returns `{ ids }` or `{ reason }` — never a bare array, so "no videos" cannot be
 * mistaken for "nothing is live".
 */
export function readCandidateIds(body) {
	const items = body?.items
	if (!Array.isArray(items)) return { reason: 'shape_playlist' }

	const ids = items.map((i) => i?.contentDetails?.videoId).filter((id) => typeof id === 'string' && id)

	// Zero ids means the response is not shaped the way we think, not that the channel is
	// empty: the uploads playlist of a channel we are checking for a live stream always
	// has entries. Falling through here would show Offline for a whole show.
	if (!ids.length) return { reason: 'shape_no_candidates' }

	return { ids }
}

/**
 * Decides liveness from a `videos.list` body.
 *
 * The distinction that matters is between a field that says "no" and a field we could
 * not read. An unreadable item is NOT an item that is offline — if YouTube renamed
 * `liveBroadcastContent` or moved `status`, skipping every item would hand back a
 * confident `false` during a live show. So an unrecognised item ends the whole
 * evaluation as `null`, and `false` is only reachable once every item was fully legible.
 *
 * `embeddable` and `privacyStatus` stand in for the scraper's `playabilityStatus` check,
 * but they cover less: they catch a non-embeddable or unlisted stream. They do NOT catch
 * members-only (which reports `public` + `embeddable`, and `videos.list` exposes no flag
 * for it) or geo-blocking (`contentDetails.regionRestriction`, which we do not request).
 * Both would still mount a dead YouTube error panel in the hero. The scraper caught
 * members-only via `playabilityStatus`; this is a known reduction in coverage.
 */
export function classifyVideos(body) {
	const items = body?.items
	if (!Array.isArray(items)) return { live: null, reason: 'shape_videos' }

	// We only get here with at least one candidate id, so an empty page is a response we
	// do not understand — the same reasoning as `shape_no_candidates` above.
	if (!items.length) return { live: null, reason: 'shape_videos_empty' }

	for (const item of items) {
		const state = item?.snippet?.liveBroadcastContent
		const embeddable = item?.status?.embeddable
		const privacy = item?.status?.privacyStatus

		if (typeof state !== 'string') return { live: null, reason: 'shape_video_item' }
		if (typeof embeddable !== 'boolean' || typeof privacy !== 'string') {
			return { live: null, reason: 'shape_video_item' }
		}

		// `liveBroadcastContent` carries `live`, `upcoming` or `none`, so a scheduled
		// broadcast's waiting room is excluded by this test alone. (The scraper needed a
		// separate `isUpcoming` guard for that, and had one.)
		if (state !== 'live') continue
		// Present and negative: a real answer, just not one we can play.
		if (!embeddable || privacy !== 'public') continue

		return { live: true }
	}

	return { live: false }
}

/**
 * Maps a Google API error body to a reason. These all surface as `null`, so this is
 * purely diagnostic — but the distinctions are the ones that decide what you do next,
 * and they are indistinguishable in a log otherwise. `ipRefererBlocked` in particular is
 * the signature of an HTTP-referrer restriction on the key, which a server-side call can
 * never satisfy because it sends no referrer.
 */
export function errorReason(status, body) {
	const reasons = (body?.error?.errors ?? []).map((e) => e?.reason)
	// Newer Google responses drop the `errors` array and carry a `status` enum instead.
	if (body?.error?.status) reasons.push(body.error.status)

	const has = (...names) => reasons.some((r) => names.includes(r))

	if (has('quotaExceeded', 'dailyLimitExceeded', 'RESOURCE_EXHAUSTED')) return 'quota_exceeded'
	if (has('rateLimitExceeded', 'userRateLimitExceeded')) return 'rate_limited'
	if (has('accessNotConfigured')) return 'api_not_enabled'
	if (has('keyInvalid', 'ipRefererBlocked', 'PERMISSION_DENIED')) return 'key_rejected'
	return `upstream_${status}`
}

/** Carries a reason this file knows how to report, plus whatever Google said about it. */
function upstreamError(reason, message, cause) {
	return Object.assign(new Error(message || reason), { reason, cause })
}

/**
 * Returns a parsed body, or throws with a reason. The API key travels as a header rather
 * than in the query string: `detail` is returned to the browser, so one future error
 * whose message embeds the request URL would publish the key to every visitor.
 */
async function getJson(url, signal) {
	const res = await fetch(url, { headers: { 'x-goog-api-key': API_KEY }, signal })

	let body = null
	try {
		body = await res.json()
	} catch (error) {
		// An aborted body read is a timeout, not a YouTube shape change: let the caller
		// name it, or `shape_unparseable` would send someone hunting the wrong problem.
		if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error
		// A non-2xx with an unreadable body is still a known-shaped failure; report the
		// status rather than the parse error, which would hide why it failed.
		if (!res.ok) throw upstreamError(`upstream_${res.status}`, `HTTP ${res.status}`, error)
		throw upstreamError('shape_unparseable', 'response was not JSON', error)
	}

	// Google's message is the only thing that distinguishes an invalid key from a blocked
	// referrer from a missing one. Parsing it for an enum and discarding the rest loses
	// the only actionable part.
	if (!res.ok) throw upstreamError(errorReason(res.status, body), body?.error?.message)
	return body
}

const playlistUrl = () =>
	`${API_ROOT}/playlistItems?part=contentDetails` +
	`&playlistId=${encodeURIComponent(UPLOADS_PLAYLIST_ID)}` +
	`&maxResults=${CANDIDATE_COUNT}`

const videosUrl = (ids) =>
	// Each id is encoded individually so the separating commas reach YouTube literally.
	// `encodeURIComponent(ids.join(','))` sends `aaa%2Cbbb` — one nonexistent id, which
	// returns `items: []`. Do not fold these together.
	`${API_ROOT}/videos?part=snippet,status&id=${ids.map(encodeURIComponent).join(',')}`

/**
 * The only place that knows where candidate video ids come from. See the note at the top
 * of this file: if the uploads playlist ever lags live broadcasts, this is what gets
 * replaced by `liveBroadcasts.list`.
 */
async function findCandidateIds(signal) {
	return readCandidateIds(await getJson(playlistUrl(), signal))
}

async function readLiveStatus() {
	// Without a key every request would 400. Reporting that as `false` would show Offline
	// through an entire broadcast with nothing to explain it.
	if (!API_KEY) return { live: null, reason: 'no_api_key' }

	// One deadline for both calls. See UPSTREAM_BUDGET_MS.
	const signal = AbortSignal.timeout(UPSTREAM_BUDGET_MS)

	const candidates = await findCandidateIds(signal)
	// Discriminate on the shape we need, not on the absence of a reason: any future
	// return that is not a proper `{ids: [...]}` then becomes `null` rather than
	// reaching `.map` and failing as a misleading `fetch_failed`.
	if (!Array.isArray(candidates.ids)) {
		return { live: null, reason: candidates.reason ?? 'shape_playlist' }
	}

	return classifyVideos(await getJson(videosUrl(candidates.ids), signal))
}

let memo = null
let lastLogged

/**
 * Memoises the in-flight promise, not the resolved payload. Storing it after the await
 * would let every request arriving during the first one miss the memo and issue its own
 * pair of API calls — and since a query string bypasses the CDN entirely, that is an
 * unauthenticated way to burn the daily quota.
 */
function currentStatus() {
	if (memo && Date.now() - memo.at < MEMO_MS) return memo.promise

	const promise = readLiveStatus().catch((error) => {
		const timedOut = error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError'
		return {
			live: null,
			reason: error?.reason || (timedOut ? 'timeout' : 'fetch_failed'),
			// node's fetch puts the real cause (ENOTFOUND, ECONNRESET, …) on error.cause.
			detail: error?.cause?.code || error?.message || error?.cause?.message || String(error),
		}
	})

	memo = { promise, at: Date.now() }
	return promise
}

function edgeSecondsFor(payload, determinate) {
	if (determinate) return EDGE_CACHE_SECONDS
	return STUCK_REASONS.has(payload.reason) ? STUCK_EDGE_SECONDS : UNDETERMINED_EDGE_SECONDS
}

export default async function handler(req) {
	if (req?.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })

	const payload = await currentStatus()
	const determinate = typeof payload.live === 'boolean'

	// Determinate answers are deduped — they are the steady state and would otherwise log
	// once a minute forever. Undetermined ones are always logged: a key rejected at 02:00
	// must not be one line followed by eighteen silent hours of Offline during a show.
	// (`lastLogged` is per-container, so a cold start re-logs. That errs toward noise,
	// which is the safe direction, but means this is not a clean transition history.)
	const state = determinate ? String(payload.live) : `null:${payload.reason}`
	if (!determinate || state !== lastLogged) {
		lastLogged = state
		console.log('live-status', CHANNEL_ID, '→', JSON.stringify(payload))
	}

	const browserSeconds = determinate ? BROWSER_CACHE_SECONDS : 0
	const edgeSeconds = edgeSecondsFor(payload, determinate)

	return new Response(JSON.stringify(payload), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': `public, max-age=${browserSeconds}`,
			/**
			 * Netlify's edge cache is per-region; without `durable` each region invokes the
			 * function separately and the quota cost multiplies by the number of regions
			 * serving traffic. `durable` makes them share one entry.
			 *
			 * Cost is 2 units per invocation and at most one invocation per TTL globally:
			 * ~2,880 units/day at EDGE_CACHE_SECONDS=60 against the 10,000 default. The
			 * undetermined path is 6× worse per second, which is why STUCK_REASONS exists.
			 */
			'netlify-cdn-cache-control': `public, durable, max-age=${edgeSeconds}`,
		},
	})
}

export const config = { path: '/api/live-status' }
