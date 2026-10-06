/**
 * The contract under test is narrow and was broken twice in production:
 *
 *   `false` means "we asked YouTube and nothing is live". It must never be what a
 *   failure degrades into, because `false` is cached at the edge and served to every
 *   visitor — a wrong one takes the player down for a whole broadcast and logs as the
 *   bare word `false`, indistinguishable from a quiet channel.
 *
 * So most of these assert the shape of a *failure*, not of success, and they cover both
 * halves: the pure classifiers AND the handler that wires them to the cache headers.
 * The handler half matters disproportionately — an earlier revision of this suite tested
 * only the classifiers, and every one of nine mutations survived it, including mapping
 * every caught error to `{live:false}`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readCandidateIds, classifyVideos, errorReason } from '../netlify/functions/live-status.mjs'

const playlistPage = (...ids) => ({ items: ids.map((id) => ({ contentDetails: { videoId: id } })) })

const video = ({ state = 'none', embeddable = true, privacy = 'public' } = {}) => ({
	snippet: { liveBroadcastContent: state },
	status: { embeddable, privacyStatus: privacy },
})

// --- readCandidateIds -------------------------------------------------------

test('reads video ids from an uploads page', () => {
	assert.deepEqual(readCandidateIds(playlistPage('aaa', 'bbb')), { ids: ['aaa', 'bbb'] })
})

test('a body with no items is a shape failure, not an empty channel', () => {
	assert.deepEqual(readCandidateIds({}), { reason: 'shape_playlist' })
	assert.deepEqual(readCandidateIds(null), { reason: 'shape_playlist' })
	assert.deepEqual(readCandidateIds({ items: 'nope' }), { reason: 'shape_playlist' })
})

test('an empty page is reported, never treated as "nothing is live"', () => {
	assert.deepEqual(readCandidateIds(playlistPage()), { reason: 'shape_no_candidates' })
})

test('items without a usable videoId are skipped, and all-missing is a failure', () => {
	const mixed = { items: [{ contentDetails: {} }, { contentDetails: { videoId: 'ok' } }] }
	assert.deepEqual(readCandidateIds(mixed), { ids: ['ok'] })
	assert.deepEqual(readCandidateIds({ items: [{}, { contentDetails: { videoId: '' } }] }), {
		reason: 'shape_no_candidates',
	})
})

// --- classifyVideos ---------------------------------------------------------

test('a live, public, embeddable video is live', () => {
	assert.deepEqual(classifyVideos({ items: [video({ state: 'live' })] }), { live: true })
})

test('finds the live one among recent uploads', () => {
	const body = { items: [video(), video(), video({ state: 'live' }), video()] }
	assert.deepEqual(classifyVideos(body), { live: true })
})

test('nothing live is a genuine false', () => {
	assert.deepEqual(classifyVideos({ items: [video(), video()] }), { live: false })
})

test('a scheduled waiting room is not live', () => {
	assert.deepEqual(classifyVideos({ items: [video({ state: 'upcoming' })] }), { live: false })
})

test('a live stream we cannot embed does not count', () => {
	// It would mount a dead error panel in the hero — worse than showing Offline.
	assert.deepEqual(classifyVideos({ items: [video({ state: 'live', embeddable: false })] }), {
		live: false,
	})
})

test('a live stream that is not public does not count', () => {
	for (const privacy of ['private', 'unlisted']) {
		assert.deepEqual(classifyVideos({ items: [video({ state: 'live', privacy })] }), {
			live: false,
		})
	}
})

test('a malformed videos body is undetermined, not offline', () => {
	assert.deepEqual(classifyVideos({}), { live: null, reason: 'shape_videos' })
	assert.deepEqual(classifyVideos(null), { live: null, reason: 'shape_videos' })
})

test('an empty videos page is undetermined — we asked about specific ids', () => {
	assert.deepEqual(classifyVideos({ items: [] }), { live: null, reason: 'shape_videos_empty' })
})

test('a video we cannot read is undetermined, never offline', () => {
	// The bug this replaces: these used to be `continue`d, so a renamed field meant every
	// item was skipped and a live broadcast came back as a confident, cached `false`.
	const unreadable = [
		{ items: [{ snippet: { liveBroadcastContent: 'live' } }] }, // no status block
		{ items: [{ snippet: { liveBroadcastContent: 'live' }, status: {} }] },
		{ items: [{ status: { embeddable: true, privacyStatus: 'public' } }] }, // no snippet
		{ items: [{ snippet: { liveBroadcastContent: 'live' }, status: { isEmbeddable: true } }] },
	]
	for (const body of unreadable) {
		assert.deepEqual(classifyVideos(body), { live: null, reason: 'shape_video_item' })
	}
})

// --- errorReason ------------------------------------------------------------

test('exhausted quota is named, not folded into a generic 403', () => {
	const legacy = { error: { errors: [{ reason: 'quotaExceeded' }] } }
	assert.equal(errorReason(403, legacy), 'quota_exceeded')
	assert.equal(errorReason(403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }), 'quota_exceeded')
})

test('the modern error envelope is understood too', () => {
	// Newer Google responses drop the `errors` array for a `status` enum.
	const modern = { error: { code: 403, message: 'quota', status: 'RESOURCE_EXHAUSTED' } }
	assert.equal(errorReason(403, modern), 'quota_exceeded')
})

test('short-term rate limiting is distinguished from a spent daily quota', () => {
	// One clears by itself in seconds; the other does not clear until midnight Pacific.
	assert.equal(errorReason(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }), 'rate_limited')
})

test('a disabled API and a rejected key are named', () => {
	assert.equal(errorReason(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }), 'api_not_enabled')
	assert.equal(errorReason(400, { error: { errors: [{ reason: 'keyInvalid' }] } }), 'key_rejected')
	assert.equal(errorReason(403, { error: { errors: [{ reason: 'ipRefererBlocked' }] } }), 'key_rejected')
})

test('an unrecognised error keeps its status', () => {
	assert.equal(errorReason(500, {}), 'upstream_500')
	assert.equal(errorReason(503, null), 'upstream_503')
})

// --- the handler ------------------------------------------------------------
//
// Everything above proves the classifiers are right. These prove they are plugged in:
// that an upstream failure reaches the response as `null` with its reason and the right
// TTL, that the two calls are wired in order, and that nothing degrades to `false`.

const withFetch = async (impl, run) => {
	const original = globalThis.fetch
	const calls = []
	globalThis.fetch = async (url, init) => {
		calls.push(String(url))
		return impl(String(url), init, calls.length)
	}
	try {
		await run(calls)
	} finally {
		globalThis.fetch = original
	}
}

/**
 * API_KEY is read at module load and the handler memoises for 25s, so each case needs a
 * fresh module instance to be independent of the others.
 */
const freshHandler = async (key = 'test-key') => {
	if (key === null) delete process.env.YOUTUBE_API_KEY
	else process.env.YOUTUBE_API_KEY = key
	const mod = await import(`../netlify/functions/live-status.mjs?t=${Math.random()}`)
	return mod.default
}

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const livePlaylist = { items: [{ contentDetails: { videoId: 'vid1' } }] }
const liveVideos = {
	items: [{ snippet: { liveBroadcastContent: 'live' }, status: { embeddable: true, privacyStatus: 'public' } }],
}

const read = async (res) => JSON.parse(await res.text())

test('a live broadcast is reported live, from two calls in order', async () => {
	await withFetch(
		async (url, init, n) => {
			assert.equal(init.headers['x-goog-api-key'], 'test-key', 'the key must travel as a header')
			assert.doesNotMatch(url, /key=/, 'the key must not be in the URL')
			return n === 1 ? json(livePlaylist) : json(liveVideos)
		},
		async (calls) => {
			const res = await (await freshHandler())({ method: 'GET' })
			assert.deepEqual(await read(res), { live: true })
			assert.match(calls[0], /playlistItems\?part=contentDetails/)
			assert.match(calls[0], /playlistId=UUaR-E0AKLsDDS1Xgl7_DdZQ/, 'uploads playlist, not the channel id')
			assert.match(calls[1], /videos\?part=snippet,status&id=vid1/)
			assert.match(res.headers.get('netlify-cdn-cache-control'), /durable, max-age=60/)
		},
	)
})

test('every upstream failure is undetermined, never offline', async () => {
	const failures = [
		['exhausted quota', () => json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403), 'quota_exceeded'],
		['an unreadable 429', () => new Response('slow down', { status: 429 }), 'upstream_429'],
		['HTML on a 200', () => new Response('<html>', { status: 200 }), 'shape_unparseable'],
		['a dropped connection', () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) }, 'fetch_failed'],
		['a timeout', () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }, 'timeout'],
		['an empty uploads page', () => json({ items: [] }), 'shape_no_candidates'],
	]

	for (const [label, impl, reason] of failures) {
		await withFetch(impl, async () => {
			const res = await (await freshHandler())({ method: 'GET' })
			const body = await read(res)
			assert.equal(body.live, null, `${label} must never read as offline`)
			assert.equal(body.reason, reason, label)
			assert.doesNotMatch(
				res.headers.get('netlify-cdn-cache-control'),
				/max-age=60$/,
				`${label} must not be cached as long as a real answer`,
			)
		})
	}
})

test('a failure in the second call is undetermined too', async () => {
	// The two-call sequence is the newest thing here and has the most moving parts.
	await withFetch(
		async (_url, _init, n) => (n === 1 ? json(livePlaylist) : new Response('boom', { status: 500 })),
		async (calls) => {
			const body = await read(await (await freshHandler())({ method: 'GET' }))
			assert.deepEqual(body.live, null)
			assert.equal(body.reason, 'upstream_500')
			assert.equal(calls.length, 2)
		},
	)
})

test('a playlist failure skips the videos call entirely', async () => {
	await withFetch(
		async () => json({ nope: true }),
		async (calls) => {
			const body = await read(await (await freshHandler())({ method: 'GET' }))
			assert.equal(body.reason, 'shape_playlist')
			assert.equal(calls.length, 1, 'no point asking about ids we do not have')
		},
	)
})

test('a missing API key is undetermined and spends nothing', async () => {
	// The most likely deploy-time failure: an unset Netlify variable.
	await withFetch(
		async () => assert.fail('must not call YouTube without a key'),
		async (calls) => {
			const res = await (await freshHandler(null))({ method: 'GET' })
			assert.deepEqual(await read(res), { live: null, reason: 'no_api_key' })
			assert.equal(calls.length, 0)
			// Nothing will change until someone sets the variable, so do not re-ask every 10s.
			assert.match(res.headers.get('netlify-cdn-cache-control'), /max-age=600/)
		},
	)
})

test("Google's explanation survives into the payload", async () => {
	await withFetch(
		async () => json({ error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'keyInvalid' }] } }, 400),
		async () => {
			const body = await read(await (await freshHandler())({ method: 'GET' }))
			assert.equal(body.reason, 'key_rejected')
			assert.match(body.detail, /API key not valid/, 'the only thing that says WHICH key problem')
		},
	)
})

test('concurrent requests collapse into one pair of API calls', async () => {
	// The memo holds the in-flight promise, not the resolved payload: a query string
	// bypasses the CDN, so without this a burst is an unauthenticated way to burn quota.
	await withFetch(
		async (_url, _init, n) => (n % 2 === 1 ? json(livePlaylist) : json(liveVideos)),
		async (calls) => {
			const handler = await freshHandler()
			const results = await Promise.all([1, 2, 3, 4, 5].map(() => handler({ method: 'GET' })))
			for (const res of results) assert.deepEqual(await read(res), { live: true })
			assert.equal(calls.length, 2, 'five requests, one upstream round trip')
		},
	)
})

test('non-GET is rejected, including a request with no method', async () => {
	const handler = await freshHandler()
	for (const req of [{ method: 'POST' }, { method: 'DELETE' }, {}]) {
		const res = await handler(req)
		assert.equal(res.status, 405)
		assert.equal(res.headers.get('allow'), 'GET')
	}
})
