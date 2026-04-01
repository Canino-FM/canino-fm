import { defineType, defineField, defineArrayMember } from 'sanity'
import { DocumentIcon } from '@sanity/icons'

/**
 * Single program document: upcoming broadcast dates and show slots.
 * One "program" for the next few days/weeks (front-page schedule block).
 */
export const program = defineType({
  name: 'program',
  title: 'Program',
  type: 'document',
  icon: DocumentIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      initialValue: 'Program',
      description: 'Internal label (e.g. "Program").',
    }),
    defineField({
      name: 'events',
      title: 'Events',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'programEvent',
        }),
      ],
      description: 'Upcoming broadcast dates and show slots.',
    }),
  ],
})
