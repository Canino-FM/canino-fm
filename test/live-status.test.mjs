/**
 * Pins the safety contract of the live check: a failed or unrecognised check must report
 * `null`, never `false`, and must never be cached as though it were an answer.
 *
 * This exists because the feature has already produced that bug twice, in two different
 * shapes — once by mapping every error to `{live:false}` and caching it, and once by
 * matching loose substrings so that any markup change read as "offline". Both would have
 * taken a live broadcast off the site for every visitor at once, with nothing in the logs.
 *
 * Run with `pnpm test`. No framework, no network: node:test and a stubbed fetch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../netlify/functions/live-status.mjs'

/** Minimal stand-ins for the two page shapes YouTube actually serves on /channel/<id>/live. */
const watchPage = (videoDetails, playability = 'OK') =>
	`<html><script>var ytInitialData = {"x":1};</script>` +
	`<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"${playability}"},` +
	`"videoDetails":${JSON.stringify(videoDetails)}};</script></html>`

const browsePage = () => `<html><script>var ytInitialData = {"contents":[{"tabRenderer":{}}]};</script></html>`

// --- classification -------------------------------------------------------------------

test('a live watch page is live', () => {
	assert.deepEqual(classify(watchPage({ isLive: true })), { live: true })
})

test('an idle channel serves the browse page and is not live', () => {
	assert.deepEqual(classify(browsePage()), { live: false })
})

test('a scheduled waiting room is not a broadcast', () => {
	assert.deepEqual(classify(watchPage({ isLive: true, isUpcoming: true })), { live: false })
})

test('an unplayable stream is not offered to the hero', () => {
	// Members-only or geo-blocked: isLive is true but mounting the embed shows an error panel.
	assert.deepEqual(classify(watchPage({ isLive: true }, 'LOGIN_REQUIRED')), { live: false })
})

test('a consent wall or bot check is undetermined, never offline', () => {
	const result = classify('<html>Before you continue to YouTube</html>')
	assert.equal(result.live, null)
	assert.equal(result.reason, 'unrecognised_page')
})

test('a corrupted player payload is undetermined, never offline', () => {
	const broken = watchPage({ isLive: true }).replace('"videoDetails"', '"videoDetails"}}}{')
	assert.equal(classify(broken).live, null)
})

test('a page that is neither watch nor browse is undetermined, never offline', () => {
	// If YouTube renames the player payload marker, every page would otherwise look idle.
	const renamed = watchPage({ isLive: true }).replace('ytInitialPlayerResponse = ', 'ytRenamed = ')
	assert.equal(classify(renamed).live, null)
	assert.equal(classify(renamed).reason, 'neither_watch_nor_browse')
})

test('the payload is sliced by brace matching, not a lazy regex', () => {
	// A "};" inside a string value would truncate a non-greedy regex and fail the parse.
	const tricky = watchPage({ isLive: true, title: 'a show with }; inside its title' })
	assert.deepEqual(classify(tricky), { live: true })
})

// --- handler: the cache contract ------------------------------------------------------

const withFetch = async (impl, run) => {
	const original = globalThis.fetch
	globalThis.fetch = impl
	try {
		await run()
	} finally {
		globalThis.fetch = original
	}
}

/** The handler memoises for 25s, so each case needs a distinct channel to bypass it. */
const freshHandler = async () => {
	const mod = await import(`../netlify/functions/live-status.mjs?t=${Math.random()}`)
	return mod.default
}

test('a determinate answer is edge-cacheable', async () => {
	await withFetch(
		async () => new Response(watchPage({ isLive: true }), { status: 200 }),
		async () => {
			const fresh = await freshHandler()
			const res = await fresh({ method: 'GET' })
			assert.deepEqual(JSON.parse(await res.text()), { live: true })
			assert.match(res.headers.get('cache-control'), /s-maxage=60/)
		},
	)
})

test('an upstream error is undetermined and only briefly cached', async () => {
	await withFetch(
		async () => new Response('rate limited', { status: 429 }),
		async () => {
			const fresh = await freshHandler()
			const res = await fresh({ method: 'GET' })
			const body = JSON.parse(await res.text())
			assert.equal(body.live, null, 'an upstream error must never read as offline')
			assert.equal(body.status, 429)
			// Short, not zero: no-store would remove backpressure exactly during a 429 storm.
			assert.match(res.headers.get('cache-control'), /s-maxage=10/)
		},
	)
})

test('a network failure is undetermined and keeps its cause', async () => {
	await withFetch(
		async () => {
			throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
		},
		async () => {
			const fresh = await freshHandler()
			const res = await fresh({ method: 'GET' })
			const body = JSON.parse(await res.text())
			assert.equal(body.live, null)
			assert.equal(body.reason, 'fetch_failed')
			assert.equal(body.detail, 'ECONNRESET', 'the cause is the only diagnostic there is')
		},
	)
})

test('a timeout is reported as a timeout, not a generic failure', async () => {
	await withFetch(
		async () => {
			throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
		},
		async () => {
			const fresh = await freshHandler()
			const res = await fresh({ method: 'GET' })
			assert.equal(JSON.parse(await res.text()).reason, 'timeout')
		},
	)
})

test('non-GET is rejected', async () => {
	const fresh = await freshHandler()
	const res = await fresh({ method: 'POST' })
	assert.equal(res.status, 405)
})
