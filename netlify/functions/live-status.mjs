/**
 * Reports whether the Canino FM YouTube channel is currently live.
 *
 * The browser cannot check this itself — youtube.com sends no CORS headers — so the
 * page asks this function instead.
 *
 * It deliberately does not use the YouTube Data API: since June 2026 `search.list` is
 * capped at 100 calls per day for the whole project, which a polling page burns through
 * in minutes. Fetching the channel's /live page costs nothing and has no quota, and the
 * response is cached at Netlify's edge so YouTube sees roughly one request a minute no
 * matter how many people are on the site.
 *
 * Live is detected positively (`hlsManifestUrl` + `"isLive":true` appear only in the
 * player response of a running stream) rather than by the absence of an error, so if
 * YouTube changes its markup this reports "offline" instead of showing a broken player.
 */

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCaR-E0AKLsDDS1Xgl7_DdZQ'

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

/** Browser may reuse its copy for this long; the edge refreshes on the longer interval. */
const BROWSER_CACHE_SECONDS = 30
const EDGE_CACHE_SECONDS = 60

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

	if (!res.ok) return { live: false }

	const html = await res.text()
	// Either marker on its own is enough: `hlsManifestUrl` is only emitted when the player
	// response carries streaming data, which it does not always include, while `"isLive":true`
	// has been the stable signal. Neither appears on a channel that is merely idle.
	return { live: html.includes('"isLive":true') || html.includes('hlsManifestUrl') }
}

export default async function handler() {
	let payload
	try {
		payload = await readLiveStatus()
	} catch {
		// Timeout, network error or a YouTube change: report offline rather than break the hero.
		payload = { live: false }
	}

	return new Response(JSON.stringify(payload), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}`,
		},
	})
}

export const config = { path: '/api/live-status' }
