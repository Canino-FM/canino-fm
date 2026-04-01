import { defineType, defineField } from 'sanity'

/**
 * Inline show entry within a program event (schedule + title only).
 * The archive uses the full Show document type (image, SoundCloud).
 */
export const programEventShow = defineType({
  name: 'programEventShow',
  title: 'Program show slot',
  type: 'object',
  fields: [
    defineField({
      name: 'schedule',
      title: 'Schedule',
      type: 'string',
      description: 'e.g. 13:00-14:00',
    }),
    defineField({
      name: 'title',
      title: 'Show title',
      type: 'string',
      description: 'e.g. llora nena llora w. Chica Acosta',
    }),
  ],
})
