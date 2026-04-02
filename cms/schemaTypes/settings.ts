import { defineType, defineField } from 'sanity'
import { CogIcon } from '@sanity/icons'

/**
 * Site settings: about popup, contact, hero/live embed.
 * Single document (singleton) for theme-style settings.
 */
export const settings = defineType({
  name: 'settings',
  title: 'Settings',
  type: 'document',
  icon: CogIcon,
  fields: [
    defineField({
      name: 'about',
      title: 'About (popup)',
      type: 'text',
      description: 'HTML for the About panel (e.g. <p>…</p> paragraphs).',
    }),
    defineField({
      name: 'contact',
      title: 'Contact email',
      type: 'string',
      description: 'Contact email shown in the About popup.',
      validation: (rule) => rule.email(),
    }),
    defineField({
      name: 'live',
      title: 'Live hero (HTML / oEmbed)',
      type: 'text',
      description: 'HTML string or oEmbed URL for the main hero video/live embed.',
    }),
    defineField({
      name: 'link',
      title: 'Hero link (YouTube iframe URL)',
      type: 'url',
      description: 'Alternative: YouTube iframe URL or embed URL. Parsed for src at build time.',
    }),
  ],
})
