# Adding or changing content types

This doc is a **roadmap** for extending the Canino FM Sanity schema beyond the initial migration (program, events, shows, artists, settings).

---

## Current content types (Phase 1)

| Type | Purpose |
|------|--------|
| **Program** | Single document: upcoming broadcast dates and show slots. Nested objects use schema types `programEvent` (date + `shows[]`) and `programEventShow` (schedule + title). |
| **Event** | One per broadcast date; references Shows. Build flattens events → shows for the archive grid. |
| **Show** | Title, image, SoundCloud embed. Referenced by Events. |
| **Artist** | Name only (A–Z list). |
| **Settings** | Singleton: about popup, contact email, live hero embed. |

Schema files live in **`cms/schemaTypes/`**. The Studio structure is in **`cms/structure.ts`** (singletons: Settings, Program; then Events, Shows, Artists).

---

## Future content types (roadmap)

The following exist in the WordPress database but are **not in scope for v1**. Add them when you need the features.

### Posts (blog)

- **Document type:** e.g. `post` with `title`, `slug`, `body` (Portable Text), `publishedAt`, optional `author` reference.
- **Studio:** Add to structure; optionally filter by `post_type` or a “Blog” section.
- **Frontend:** Add a “Blog” or “News” section and Astro page(s) that query `*[_type == "post"]`.

### Projects (CPT)

- **Document type:** e.g. `project` with fields that mirror the current WP `project` CPT (and ACF `modules` if used).
- **Studio:** New list item in structure.
- **Frontend:** New route(s) and components when you want to show projects.

### Collectives (CPT)

- **Document type:** e.g. `collective` with name and any existing fields from WP.
- **Frontend:** New section or link in nav when needed.

### Comments

- WordPress comments are **not** migrated to Sanity. Options for the new site:
  - **External service:** e.g. [Commento](https://commento.io), [Giscus](https://giscus.app) (GitHub-based), or similar. Document the choice in the repo.
  - **Small backend:** Custom API + Sanity or separate DB for comments; out of scope for initial static build.

---

## How to add a new document type

1. **Schema:** In `cms/schemaTypes/`, create a new file (e.g. `post.ts`) using `defineType` and `defineField` from `sanity`. Export it and add it to `cms/schemaTypes/index.ts`.
2. **Structure:** In `cms/structure.ts`, add a list item (e.g. `S.documentTypeListItem('post').title('Posts')`). If it’s a singleton, use `S.document().schemaType('post').documentId('post')` and add the type to `SINGLETONS` so it’s excluded from the generic list.
3. **Deploy Studio:** Run `pnpm build` and `pnpm deploy` from `cms/` (or use Sanity’s hosted Studio) so editors see the new type.
4. **Frontend:** In the Astro app, add GROQ queries and components that consume the new type. Use `SANITY_PROJECT_ID`, `SANITY_API_READ_TOKEN`, and `SANITY_DATASET` at build time.

---

## Changing existing types

- **New optional fields:** Add in the schema; existing documents will have the field empty until edited.
- **Removing or renaming fields:** Follow the **deprecation pattern** in Sanity best practices: mark old field as `deprecated`, add new field, migrate data, then remove the old field once unused. Never delete a field that still contains production data without a migration.

For detailed schema patterns, see [Sanity Schema docs](https://www.sanity.io/docs/schema-types) and the `sanity-schema` rule used in this project.
