# Codebase map

Where to look. Product rules live in [`vision.md`](../vision.md). This file is the **tour** map.

## Start here (15 minutes)

1. [`src/main.ts`](../src/main.ts) — plugin boot only: load settings, settings tab, commands, gallery.
2. [`src/settings.ts`](../src/settings.ts) — settings shape + Settings UI (Secret Storage ids, Guess from URL, test connection).
3. Pick one flow:
    - **Upload:** `commands/upload.ts` → `links/parse` → `s3/client.put` → `links/rewrite`
    - **Localize:** `commands/localize.ts` → download URL → `links/checksum` → vault write → rewrite
    - **Gallery:** `gallery/view.ts` → `gallery/list.ts` → `s3/client.list`

```
User command / ribbon
        │
        ▼
 commands/register.ts     (wires command palette)
        │
        ├─ upload.ts ──► parse refs → whitelist → S3 PUT → rewrite links
        ├─ localize.ts ► parse remotes → GET bytes → SHA-256 collide → rewrite
        ├─ convert-links.ts ► syntax only (links/convert.ts)
        └─ gallery/view.ts ► list months → lazy cells → usage / delete
```

## Folder cheat sheet

| Path                            | Job                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- |
| `src/main.ts`                   | Lifecycle. Keep thin.                                                       |
| `src/settings.ts`               | Types, defaults, settings tab.                                              |
| `src/i18n.ts` + `locales/en.ts` | All user-visible strings. Add keys in `en.ts`, call `t('…')`.               |
| `src/commands/`                 | User actions. `register.ts` = command IDs.                                  |
| `src/s3/`                       | Storage: URL guess, object names, whitelist, signed REST client.            |
| `src/links/`                    | Parse / rewrite / convert markdown↔wiki / checksum.                         |
| `src/gallery/`                  | ItemView UI, month paging, “who uses this URL”.                             |
| `src/ui/`                       | Small modals (confirm, failure list, usage list).                           |
| `tests/`                        | Pure-logic Vitest. `tests/mocks/obsidian.ts` stubs Obsidian for unit tests. |
| `docs/`                         | Human guides (R2 setup, contributing, releasing).                           |
| `vision.md`                     | Full product spec — source of truth for behavior.                           |
| `AGENTS.md`                     | Obsidian plugin conventions for agents / contributors.                      |

## Module details

### `s3/` — talk to the bucket

| File           | What                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| `parse-url.ts` | `parseBucketUrl(paste)` → endpoint / bucket / region / provider extras. Pure.    |
| `names.ts`     | `{uuidv7}-{sanitized}{ext}` under `{prefix?}{YYYYMM}/`. Pure.                    |
| `whitelist.ts` | gitignore-style match on **file name**. Pure.                                    |
| `client.ts`    | SigV4 (`aws4fetch`) + Obsidian `requestUrl` transport. put/get/list/delete/test. |

Secrets: settings store **secret ids** only. At call time `getSecret(app, id)` → real keys. Never write key material to `data.json`.

### `links/` — note text

| File          | What                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `parse.ts`    | Find embeds + file links (markdown + wikilink).                         |
| `rewrite.ts`  | Format remote (always markdown) / local (setting) + safe path encoding. |
| `convert.ts`  | Wiki ↔ markdown helpers (no network).                                   |
| `checksum.ts` | SHA-256 for localize collision (“same bytes?”).                         |

### `commands/` — what the user runs

| File               | What                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `register.ts`      | Stable command ids (palette only).                                                            |
| `upload.ts`        | Note/folder upload; optional delete via `fileManager.trashFile` (obeys Obsidian trash prefs). |
| `localize.ts`      | Note/folder download + conflict modal.                                                        |
| `convert-links.ts` | Thin Obsidian wrapper around `links/convert.ts`.                                              |

### `gallery/` — browse remote objects

| File       | What                                                      |
| ---------- | --------------------------------------------------------- |
| `view.ts`  | `ItemView` + ribbon. Lazy media via IntersectionObserver. |
| `list.ts`  | Discover `YYYYMM` prefixes; list objects newest-first.    |
| `usage.ts` | Vault scan for notes containing a public URL.             |

## Mental model: one asset trip

**Upload**

1. Parse note → local refs.
2. Resolve path with `metadataCache.getFirstLinkpathDest`.
3. Whitelist filter.
4. `buildObjectKey` → `client.put`.
5. Rewrite every link to that file → public URL markdown.
6. If “delete after upload”: only if no other notes still link it → `fileManager.trashFile`.

**Localize**

1. Parse remotes.
2. Download bytes (`requestUrl`).
3. Destination from `getAvailablePathForAttachment`.
4. If same basename exists: same SHA-256 → reuse path; different → conflict list (no overwrite).
5. Rewrite to wikilink or markdown per setting.

## Where _not_ to look first

- `main.js` — generated bundle. Edit `src/`, run `npm run build` / `dev`.
- `vision.md` — long; use after you know the folders.
- LanTai (external) — reference only; this tree is flatter on purpose.

## Tests map

| Test                      | Covers                                           |
| ------------------------- | ------------------------------------------------ |
| `tests/parse-url.test.ts` | Every provider URL fixture from vision           |
| `tests/names.test.ts`     | Sanitize + monthly keys                          |
| `tests/whitelist.test.ts` | Patterns / negation                              |
| `tests/links.test.ts`     | Parse, rewrite, convert, checksum, usage helpers |
| `tests/s3-client.test.ts` | List XML + PUT via fake transport                |

## Adding something new

1. Behavior? Check / update `vision.md` first if product-facing.
2. String? `locales/en.ts` + `t()`.
3. Logic? Prefer a pure function under `s3/` or `links/` + a test.
4. UI entry? Wire in `commands/register.ts` (or gallery menu).
5. Keep `main.ts` free of feature logic.
