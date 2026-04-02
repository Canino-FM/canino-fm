/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@sanity/astro/module" />

interface ImportMetaEnv {
	readonly SANITY_PROJECT_ID: string
	readonly SANITY_API_READ_TOKEN: string
	readonly SANITY_DATASET: string
}
