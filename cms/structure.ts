import type {StructureBuilder, StructureResolver} from 'sanity/structure'
import {CogIcon, DocumentIcon, CalendarIcon, VideoIcon, UserIcon} from '@sanity/icons'

export const structure: StructureResolver = (S: StructureBuilder) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Settings')
        .icon(CogIcon)
        .child(S.document().schemaType('settings').documentId('settings')),
      S.listItem()
        .title('Program')
        .icon(DocumentIcon)
        .child(S.document().schemaType('program').documentId('program')),
      S.divider(),
      S.documentTypeListItem('event').title('Events').icon(CalendarIcon),
      S.documentTypeListItem('show').title('Shows').icon(VideoIcon),
      S.documentTypeListItem('artist').title('Artists').icon(UserIcon),
    ])
