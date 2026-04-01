import { defineType, defineField, defineArrayMember } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

/**
 * Program event: date and shows.
 * Referenced by Program document for the upcoming schedule block.
 */
export const programEvent = defineType({
  name: 'programEvent',
  title: 'Program event',
  type: 'object',
  icon: CalendarIcon,
  fields: [
    defineField({
      name: 'date',
      title: 'Date',
      type: 'string',
      description: 'e.g. 08.02.2026',
    }),
    defineField({
      name: 'shows',
      title: 'Shows',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'programEventShow',
        }),
      ],
    }),
  ],
})
