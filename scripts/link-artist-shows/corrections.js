/**
 * Known data-quality fixes for the artist backfill, kept separate from the matching
 * algorithm so they survive re-runs after a fresh WordPress export (stable WP-based
 * `show-{id}`/`artist-{id}` IDs mean titles/names can drift back if the source SQL
 * dump is re-imported, but these corrections are idempotent — safe to re-apply).
 *
 * Applied in this order, before matching: artistRenames, artistDuplicates, newArtists,
 * titleCorrections. manualLinks are applied after, bypassing the generic matcher entirely
 * for the couple of shows where a collective name should NOT be linked as an artist even
 * though it's a real artist document (only its named members should be).
 */

/**
 * Existing artist documents with a wrong/inconsistent `name` — corrected in place.
 * Note: "seraahboo.m" → "serahboo.m" (pre-2026-08) is no longer needed — WP itself
 * renamed that artist's post to "boo.m" since. See artistDuplicates below: a second,
 * unrelated WP post was later created with that same "boo.m" name.
 */
export const artistRenames = [{ from: 'DJ Sport', to: 'DjSport' }]

/** Artists referenced by show titles that don't have a document yet. */
export const newArtists = ['Carmen Morales']

/** Show titles with a misspelled/inconsistent artist credit — corrected in place. */
export const titleCorrections = [
	{ oldTitle: 'Ego Trip w. Alvaro Texture', newTitle: 'Ego Trip w. Álvaro Texture' },
	{ oldTitle: 'A. Fruit', newTitle: 'A.Fruit' },
	{ oldTitle: 'to0o w. 8kii', newTitle: 'to0o w. 8kitoo' },
	// Matches two distinct shows that share this exact title.
	{ oldTitle: 'Brain Digging w. DJ Sport', newTitle: 'Brain Digging w. DjSport' },
	// Artist's post title is "Rumblr" (no "e"); show title also used ":" instead of
	// the usual "w." separator, so neither spelling nor separator matched the generic splitter.
	{ oldTitle: 'Abundance: Rumbler', newTitle: 'Abundance w. Rumblr' },
]

/**
 * Explicit show → artist-name links for titles the generic matcher can't parse
 * correctly on its own: "cantdefine.me" is a real artist document (a recurring
 * collective/slot), but for these shows only the members named in parens should
 * be linked, not the collective itself.
 */
export const manualLinks = [
	{
		title: 'llamada perdida del sur w. cantdefine.me (boo.m & unseena)',
		artists: ['boo.m', 'unseena'],
	},
	{
		title: 'llamada perdida del sur edición Ramadan w. cantdefine.me (boo.m & Opoku)',
		artists: ['boo.m', 'Opoku'],
	},
]

/**
 * WordPress accidentally has two separate artist posts with the identical name "boo.m":
 * post 110 (the original, since 2025-03-24 — its title was later edited from
 * "seraahboo.m" to "boo.m", but its slug is still "seraahboo-m") and post 992 (a
 * duplicate created 2026-04-17 with a clean "boo-m" slug). Since both share the exact
 * name, the generic name-matching map can only resolve one — nondeterministically,
 * whichever the API happens to return last. `remove` is deleted outright (confirmed no
 * show ever referenced it) so it can't show up publicly (e.g. the Artists page) under
 * a placeholder name; `keep` is the one every show links to. Every fresh WP import
 * re-pushes `remove`'s post_title as "boo.m" again (post 110 still exists in WP), so
 * this must be reapplied each run — same as the other corrections here.
 */
export const artistDuplicates = [{ keep: 'artist-992', remove: 'artist-110' }]
