/**
 * The contract under test is narrow and was broken twice in production:
 *
 *   `false` means "we asked YouTube and nothing is live". It must never be what a
 *   failure degrades into, because `false` is cached at the edge and served to every
 *   visitor — a wrong one takes the player down for a whole broadcast and logs nothing.
 *
 * So most of these assert the shape of a *failure*, not of success. They import the real
 * module rather than restating its logic: an earlier ad-hoc check mirrored the
 * implementation instead of exercising it, and would have stayed green if the feature
 * were deleted outright.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readCandidateIds, classifyVideos, errorReason } from '../netlify/functions/live-status.mjs'

const playlistPage = (...ids) => ({
	kind: 'youtube#playlistItemListResponse',
	items: ids.map((id) => ({ kind: 'youtube#playlistItem', contentDetails: { videoId: id } })),
})

const video = ({ id = 'vid', state = 'none', embeddable = true, privacy = 'public' } = {}) => ({
	kind: 'youtube#video',
	id,
	snippet: { liveBroadcastContent: state },
	status: { embeddable, privacyStatus: privacy },
})

// --- readCandidateIds -------------------------------------------------------

test('reads video ids from an uploads page', () => {
	assert.deepEqual(readCandidateIds(playlistPage('aaa', 'bbb')), { ids: ['aaa', 'bbb'] })
})

test('a body with no items is a shape failure, not an empty channel', () => {
	assert.deepEqual(readCandidateIds({}), { reason: 'playlist_shape' })
	assert.deepEqual(readCandidateIds(null), { reason: 'playlist_shape' })
	assert.deepEqual(readCandidateIds({ items: 'nope' }), { reason: 'playlist_shape' })
})

test('an empty page is reported, never treated as "nothing is live"', () => {
	// The channel has 300+ uploads, so zero items means the response is not what we think
	// it is. Letting this fall through would show Offline for an entire show.
	assert.deepEqual(readCandidateIds(playlistPage()), { reason: 'no_candidates' })
})

test('items without a videoId are skipped, and all-missing is a failure', () => {
	const mixed = { items: [{ contentDetails: {} }, { contentDetails: { videoId: 'ok' } }] }
	assert.deepEqual(readCandidateIds(mixed), { ids: ['ok'] })
	assert.deepEqual(readCandidateIds({ items: [{}, { contentDetails: {} }] }), {
		reason: 'no_candidates',
	})
})

// --- classifyVideos ---------------------------------------------------------

test('a live, public, embeddable video is live', () => {
	assert.deepEqual(classifyVideos({ items: [video({ state: 'live' })] }), { live: true })
})

test('finds the live one among recent uploads', () => {
	const body = { items: [video(), video(), video({ id: 'x', state: 'live' }), video()] }
	assert.deepEqual(classifyVideos(body), { live: true })
})

test('nothing live is a genuine false', () => {
	assert.deepEqual(classifyVideos({ items: [video(), video()] }), { live: false })
})

test('a scheduled waiting room is not live', () => {
	// The scraper version mounted a player over the countdown. `liveBroadcastContent`
	// distinguishes these natively, which is why the old isUpcoming guard is gone.
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
	assert.deepEqual(classifyVideos({}), { live: null, reason: 'videos_shape' })
	assert.deepEqual(classifyVideos(null), { live: null, reason: 'videos_shape' })
})

test('a video missing status or snippet is skipped rather than trusted', () => {
	const body = { items: [{ snippet: { liveBroadcastContent: 'live' } }, { status: {} }] }
	assert.deepEqual(classifyVideos(body), { live: false })
})

// --- errorReason ------------------------------------------------------------

test('exhausted quota is named, not folded into a generic 403', () => {
	const body = {
		error: {
			code: 403,
			errors: [{ reason: 'quotaExceeded', message: 'The request cannot be completed.' }],
		},
	}
	assert.equal(errorReason(403, body), 'quota_exceeded')
})

test('a rejected key is named', () => {
	assert.equal(errorReason(400, { error: { errors: [{ reason: 'keyInvalid' }] } }), 'key_rejected')
})

test('an unrecognised error keeps its status', () => {
	assert.equal(errorReason(500, {}), 'upstream_500')
	assert.equal(errorReason(503, null), 'upstream_503')
})
