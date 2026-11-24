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
    defineField({
      name: 'submitUrl',
      title: 'Submit — form link',
      type: 'url',
      description:
        'Link to the submission form. The Submit block in the About panel is shown only while this is set, so clearing it closes the call without a deploy.',
    }),
    defineField({
      name: 'submitTitle',
      title: 'Submit — heading',
      type: 'string',
      description: 'Heading for the block, e.g. "Propose a show". Falls back to "Submit".',
    }),
    defineField({
      name: 'submitText',
      title: 'Submit — description',
      type: 'text',
      description:
        'A line or two saying who the form is for and what happens after you send it. Optional.',
    }),
    defineField({
      name: 'submitLabel',
      title: 'Submit — link text',
      type: 'string',
      description: 'Text of the link itself. Falls back to "Open the form".',
    }),
  ],
})
