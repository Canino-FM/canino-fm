import { defineType, defineField } from 'sanity'
import { VideoIcon } from '@sanity/icons'

/**
 * Show: title, image, SoundCloud embed.
 * Referenced by Event documents for the archive; program block uses inline schedule + title.
 */
export const show = defineType({
  name: 'show',
  title: 'Show',
  type: 'document',
  icon: VideoIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      options: {
        hotspot: true,
      },
    }),
    defineField({
      name: 'soundcloud',
      title: 'SoundCloud embed',
      type: 'text',
      description: 'SoundCloud iframe HTML or embed URL. Build-time will parse iframe src for the player.',
    }),
  ],
})
