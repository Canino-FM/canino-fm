/**
 * Known data-quality fixes for the artist backfill, kept separate from the matching
 * algorithm so they survive re-runs after a fresh WordPress export (stable WP-based
 * `show-{id}`/`artist-{id}` IDs mean titles/names can drift back if the source SQL
 * dump is re-imported, but these corrections are idempotent — safe to re-apply).
 *
 * Applied in this order, before matching: artistRenames, newArtists, titleCorrections.
 * manualLinks are applied after, bypassing the generic matcher entirely for the couple
 * of shows where a collective name should NOT be linked as an artist even though it's
 * a real artist document (only its named members should be).
 */

/** Existing artist documents with a wrong/inconsistent `name` — corrected in place. */
export const artistRenames = [
	{ from: 'seraahboo.m', to: 'serahboo.m' },
	{ from: 'DJ Sport', to: 'DjSport' },
]

/** Artists referenced by show titles that don't have a document yet. */
export const newArtists = ['Carmen Morales']

/** Show titles with a misspelled/inconsistent artist credit — corrected in place. */
export const titleCorrections = [
	{ oldTitle: 'Ego Trip w. Alvaro Texture', newTitle: 'Ego Trip w. Álvaro Texture' },
	{ oldTitle: 'A. Fruit', newTitle: 'A.Fruit' },
	{ oldTitle: 'to0o w. 8kii', newTitle: 'to0o w. 8kitoo' },
	// Matches two distinct shows that share this exact title.
	{ oldTitle: 'Brain Digging w. DJ Sport', newTitle: 'Brain Digging w. DjSport' },
	// Matches "seraahboo.m" (artist's old, pre-rename spelling) to keep this specific
	// title in sync with the artistRenames entry above.
	{
		oldTitle: 'llamada perdida del sur w. cantdefine.me (seraahboo.m & unseena)',
		newTitle: 'llamada perdida del sur w. cantdefine.me (serahboo.m & unseena)',
	},
]

/**
 * Explicit show → artist-name links for titles the generic matcher can't parse
 * correctly on its own: "cantdefine.me" is a real artist document (a recurring
 * collective/slot), but for these shows only the members named in parens should
 * be linked, not the collective itself.
 */
export const manualLinks = [
	{
		title: 'llamada perdida del sur w. cantdefine.me (serahboo.m & unseena)',
		artists: ['serahboo.m', 'unseena'],
	},
	{
		title: 'llamada perdida del sur edición Ramadan w. cantdefine.me (Serahboo.m & Opoku)',
		artists: ['serahboo.m', 'Opoku'],
	},
]
