import sanity from '@sanity/astro'
import { defineConfig } from 'astro/config'
import { loadEnv } from 'vite'

const env = loadEnv(process.env.NODE_ENV, process.cwd(), '')

export default defineConfig({
	output: 'static',
	integrations: [
		sanity({
			projectId: env.SANITY_PROJECT_ID || '',
			dataset: env.SANITY_DATASET || 'production',
			token: env.SANITY_API_READ_TOKEN,
			apiVersion: '2026-04-02',
			useCdn: true,
		}),
	],
})
