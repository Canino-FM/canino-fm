import { defineType, defineField, defineArrayMember } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

/**
 * Event: one per broadcast date for the archive.
 * Date + list of Show refs. Build flattens events → shows for the archive grid.
 */
export const event = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  icon: CalendarIcon,
  fields: [
    defineField({
      name: 'date',
      title: 'Date',
      type: 'string',
      description: 'e.g. 08.02.2026 — display label for this broadcast date',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'shows',
      title: 'Shows',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'reference',
          to: [{ type: 'show' }],
        }),
      ],
      description: 'Shows that aired on this date.',
    }),
  ],
})
