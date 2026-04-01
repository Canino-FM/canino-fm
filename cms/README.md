# Canino FM — Sanity Studio

Sanity Studio for **Canino FM**: schema, desk structure, and deploy target for [caninofm.sanity.studio](https://caninofm.sanity.studio).

## Local development

From this directory:

```bash
pnpm install
pnpm dev
```

Studio runs locally (default port is shown in the terminal). Project and dataset come from `sanity.config.ts`.

## Schema and structure

- **Schema:** `schemaTypes/` — document types `program`, `event`, `show`, `artist`, `settings`, plus embedded objects `programEvent` and `programEventShow` for the program block.
- **Desk:** `structure.ts` — singletons (Settings, Program), then lists for Events, Shows, Artists.

To add types or change fields, see **`../docs/CONTENT_TYPES.md`**.

## Deploy Studio

```bash
pnpm build
pnpm deploy
```

Use the Sanity CLI when prompted, or rely on the hosted Studio URL above after deploy.

## Further reading

- [Sanity documentation](https://www.sanity.io/docs)
