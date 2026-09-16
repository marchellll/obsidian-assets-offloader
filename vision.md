# Assets Offloader — implementation spec

Give this file to an agent as the source of truth. Build the plugin from the sample-plugin skeleton already in this repo. Prefer the smallest design a junior can walk in under an hour. Do not invent extra product features.

## How to use this file

1. Read this whole spec, then `AGENTS.md`, then Obsidian plugin guidelines (links below).
2. Replace sample-plugin identity (`manifest.json` id/name/description, package name, sample commands/ribbon/notices).
3. Implement in the order at the bottom. Each slice should leave the plugin loadable.
4. If a detail is missing, pick the lazy correct option and note it with a `ponytail:` comment. Do not expand scope.

## References (read before coding)

- Sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Submit a plugin: https://docs.obsidian.md/plugins/releasing/submit-plugin
- Secret storage: https://docs.obsidian.md/plugins/guides/secret-storage
- `AGENTS.md` in this repo (Obsidian community plugin conventions)

## Product

Obsidian community plugin. Users upload local note attachments (images, video, other whitelist matches) to S3-compatible object storage (Cloudflare R2 is the documented target). Notes then point at public URLs. Users can pull those assets back into the vault.

Fully supported on mobile. `isDesktopOnly` stays `false`. No Node/Electron-only APIs.

### Non-goals (v1)

- Auto-upload on paste/drop
- Multiple buckets / profiles
- Sync, watchers, or background jobs on load
- Image compression / transcoding
- Analytics / telemetry
- Non-English UI copy (structure must still be i18n-ready)

## Constraints

- **Secrets:** every secret (access key, secret key, and any other credential) goes through Obsidian Secret Storage (`SecretComponent` in settings, `app.secretStorage` at use time). Settings persist secret _ids_, never secret values. Set `minAppVersion` to **1.11.4** (Secret Storage). If `app.secretStorage` is missing, show a Notice and disable upload/test-connection.
- **Vault only:** read/write files inside the vault. Do not touch the OS outside the vault.
- **Network:** only S3-compatible calls the user opted into (list/put/get/delete/head + connection test). Document this in README and settings.
- **No hidden telemetry.** No remote code fetch.
- **Obsidian attachment settings:** when writing a localized file, use `app.fileManager.getAvailablePathForAttachment(filename, sourcePath)` so **Settings → Files and links → Default location for new attachments** and **Attachment folder path** are honored.
- **ESLint:** `eslint-plugin-obsidianmd` must pass (`npm run lint`).
- **Simple tree:** one responsibility per file, `main.ts` is lifecycle only. No deep DI, no frameworks.

## Identity (fill in while replacing the sample)

| Field                | Value                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- |
| Folder / plugin `id` | `obsidian-assets-offloader` (keep stable once released)                               |
| Display name         | Assets Offloader                                                                      |
| Description          | Upload vault attachments to S3-compatible storage and swap links; localize them back. |

## Settings

Sensible defaults. Validate at the trust boundary (settings + before each S3 call).

| Setting                                   | Default             | Notes                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket URL                                | `""` (not required) | Paste helper. **Guess from URL** fills provider / endpoint / region / bucket / path-style / optional prefix / provider extras. Do not save as the source of truth; the split fields are.                             |
| Provider                                  | `other`             | Set by guess; dropdown to override: `r2`, `aws`, `b2`, `spaces`, `wasabi`, `linode`, `hetzner`, `scaleway`, `gcs`, `storj`, `supabase`, `idrivee2`, `oracle`, `aliyun`, `other`. Controls which extra fields render. |
| Endpoint                                  | `""`                | S3 API URL, e.g. `https://<accountid>.r2.cloudflarestorage.com`                                                                                                                                                      |
| Region                                    | `auto`              | R2 uses `auto`                                                                                                                                                                                                       |
| Bucket                                    | `""`                |                                                                                                                                                                                                                      |
| Public URL base                           | `""`                | Origin used in markdown, e.g. `https://cdn.example.com`. No trailing slash. Object key is appended. Never overwrite this from a storage API URL (CDN is separate).                                                   |
| Remote folder prefix                      | `""`                | Optional bucket prefix. Upload path is `{prefix}/{YYYYMM}/{objectName}`. User can change prefix here; that is “which folder to upload to”. Guessed from extra path after the bucket when present.                    |
| Access key                                | secret id           | Secret Storage                                                                                                                                                                                                       |
| Secret key                                | secret id           | Secret Storage                                                                                                                                                                                                       |
| Force path-style                          | `true`              | Safer default for R2 / MinIO / custom S3. Guessed from URL style.                                                                                                                                                    |
| _(provider extras)_                       | —                   | Only render fields in **Provider extra fields** for the current provider. Hide the block when the vendor has none.                                                                                                   |     |
| Extension whitelist                       | see below           | gitignore-style, one pattern per line                                                                                                                                                                                |
| Delete local file after successful upload | `false`             | Only after PUT succeeds **and** the note link was rewritten                                                                                                                                                          |
| Localized link style                      | `wikilink`          | `wikilink` or `markdown`. Remote links are always markdown.                                                                                                                                                          |
| Test connection                           | button              | Head-bucket or list with `max-keys=1`. Success/fail Notice with the error text.                                                                                                                                      |

### Guess S3 fields from a bucket URL

Settings: text field **Bucket URL** + button **Guess from URL**. Pure function `parseBucketUrl(input: string)` in `s3/parse-url.ts`. Unit-test every row below (the R2 example is the first fixture).

On success: write endpoint, region, bucket, force path-style, and prefix if the URL had extra path. Notice: `Guessed Cloudflare R2: bucket memora`. On failure: Notice, leave existing fields alone. Strip trailing slashes, ignore query/hash. Do not treat a path that looks like a file (`name.ext` in the last segment) as a bucket — if the only path segment has a `.` and a short extension, fail rather than guess wrong.

Canonical examples:

```
https://5826f18dd993106b531d2aedf09d0965.r2.cloudflarestorage.com/memora
→ provider: Cloudflare R2
→ endpoint: https://5826f18dd993106b531d2aedf09d0965.r2.cloudflarestorage.com
→ bucket: memora
→ region: auto
→ force path-style: true
→ prefix: (empty)
```

```
https://my-bucket.s3.eu-west-1.amazonaws.com
→ provider: AWS S3
→ endpoint: https://s3.eu-west-1.amazonaws.com
→ bucket: my-bucket
→ region: eu-west-1
→ force path-style: false
→ prefix: (empty)
```

```
https://s3.us-east-1.amazonaws.com/my-bucket/photos
→ provider: AWS S3
→ endpoint: https://s3.us-east-1.amazonaws.com
→ bucket: my-bucket
→ region: us-east-1
→ force path-style: true
→ prefix: photos
```

`https://….r2.cloudflarestorage.com/memora/photos` also sets prefix `photos`. Same for AWS virtual-hosted: `https://my-bucket.s3.eu-west-1.amazonaws.com/photos` → prefix `photos`.

Match **host** (and path shape) in this order. First match wins.

| Provider                       | Example URL                                                                  | Endpoint                                                | Bucket                         | Region                                | Path-style |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------ | ------------------------------------- | ---------- |
| Cloudflare R2                  | `https://<accountid>.r2.cloudflarestorage.com/<bucket>`                      | origin (`https://<accountid>.r2.cloudflarestorage.com`) | first path segment             | `auto`                                | `true`     |
| AWS S3 virtual-hosted          | `https://<bucket>.s3.<region>.amazonaws.com`                                 | `https://s3.<region>.amazonaws.com`                     | subdomain before `.s3.`        | `<region>`                            | `false`    |
| AWS S3 virtual-hosted (legacy) | `https://<bucket>.s3.amazonaws.com`                                          | `https://s3.amazonaws.com`                              | subdomain                      | `us-east-1`                           | `false`    |
| AWS S3 path-style              | `https://s3.<region>.amazonaws.com/<bucket>`                                 | `https://s3.<region>.amazonaws.com`                     | first path segment             | `<region>`                            | `true`     |
| AWS S3 path-style (legacy)     | `https://s3.amazonaws.com/<bucket>`                                          | `https://s3.amazonaws.com`                              | first path segment             | `us-east-1`                           | `true`     |
| AWS China                      | same shapes with `amazonaws.com.cn` / `s3.<region>.amazonaws.com.cn`         | same rule                                               | same                           | `<region>` or `cn-north-1` if missing | per style  |
| Backblaze B2                   | `https://s3.<region>.backblazeb2.com/<bucket>`                               | `https://s3.<region>.backblazeb2.com`                   | first path segment             | `<region>` e.g. `us-west-004`         | `true`     |
| DigitalOcean Spaces virtual    | `https://<bucket>.<region>.digitaloceanspaces.com`                           | `https://<region>.digitaloceanspaces.com`               | subdomain                      | `<region>` e.g. `nyc3`                | `false`    |
| DigitalOcean Spaces path       | `https://<region>.digitaloceanspaces.com/<bucket>`                           | `https://<region>.digitaloceanspaces.com`               | first path segment             | `<region>`                            | `true`     |
| Wasabi                         | `https://s3.<region>.wasabisys.com/<bucket>`                                 | `https://s3.<region>.wasabisys.com`                     | first path segment             | `<region>`                            | `true`     |
| Linode / Akamai                | `https://<bucket>.<region>.linodeobjects.com`                                | `https://<region>.linodeobjects.com`                    | subdomain                      | `<region>` e.g. `us-east-1`           | `false`    |
| Hetzner                        | `https://<region>.your-objectstorage.com/<bucket>`                           | `https://<region>.your-objectstorage.com`               | first path segment             | `<region>` e.g. `fsn1`                | `true`     |
| Scaleway                       | `https://s3.<region>.scw.cloud/<bucket>`                                     | `https://s3.<region>.scw.cloud`                         | first path segment             | `<region>` e.g. `fr-par`              | `true`     |
| Google Cloud (S3 interop)      | `https://storage.googleapis.com/<bucket>`                                    | `https://storage.googleapis.com`                        | first path segment             | `auto`                                | `true`     |
| Storj                          | `https://gateway.storjshare.io/<bucket>`                                     | `https://gateway.storjshare.io`                         | first path segment             | `us-east-1`                           | `true`     |
| Supabase S3                    | `https://<ref>.supabase.co/storage/v1/s3/<bucket>`                           | `https://<ref>.supabase.co/storage/v1/s3`               | last path segment after `/s3/` | `us-east-1`                           | `true`     |
| IDrive e2                      | `https://<region>.idrivee2.com/<bucket>`                                     | `https://<region>.idrivee2.com`                         | first path segment             | `<region>`                            | `true`     |
| Oracle Cloud S3                | `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com/<bucket>` | origin                                                  | first path segment             | `<region>`                            | `true`     |
| Alibaba OSS virtual            | `https://<bucket>.oss-<region>.aliyuncs.com`                                 | `https://oss-<region>.aliyuncs.com`                     | subdomain                      | `<region>` e.g. `cn-hangzhou`         | `false`    |

**Generic fallback** (MinIO, Garage, Ceph, custom domain): `https://host[:port]/<bucket>/optional/prefix` → endpoint = origin, bucket = first path segment, region = `us-east-1`, path-style = `true`. Need at least one path segment. Do not use this fallback for known CDN hosts (`cloudflare.com`, `r2.dev` public.dev URLs, etc.) — those belong in **Public URL base**, not endpoint.

Return `{ provider, endpoint, bucket, region, forcePathStyle, prefix, extras }` from the parser. `extras` is only what the URL already contains (R2 jurisdiction, Oracle namespace, …). Keep host matching in one table/array of rules so adding a vendor is one row.

### Provider extra fields

Settings tab: after the common S3 fields, render **only** the extras for `settings.provider`. Changing the provider dropdown (or a successful guess) re-runs `display()` so the extra block appears/disappears. Persist unused extras; just don’t show them.

Wire extras into the client only when relevant (e.g. session token → `x-amz-security-token`). One short desc line under each field; no essays.

| Provider                                                   | Extra fields                                                                                                                                                                                                                                                                                                               | Why                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Cloudflare R2                                              | **Jurisdiction** (`default` / `eu` / `fedramp`). Changing it rewrites the endpoint host: `https://<accountid>.r2.cloudflarestorage.com` vs `https://<accountid>.eu.r2.cloudflarestorage.com` vs `https://<accountid>.fedramp.r2.cloudflarestorage.com`. Parse from host when guessing.                                     | EU / FedRAMP buckets reject the default endpoint. |
| AWS S3 (incl. China)                                       | **Session token** (Secret Storage, optional).                                                                                                                                                                                                                                                                              | STS / temporary keys. Omit the header when empty. |
| DigitalOcean Spaces                                        | **CDN URL** (optional). If set, use it as **Public URL base** for note links (`https://<bucket>.<region>.cdn.digitaloceanspaces.com`). Guess does not fill it from the API host. If the user pastes a `*.cdn.digitaloceanspaces.com` URL into Bucket URL, put it here / public URL base, do not use it as the S3 endpoint. | Origin API host is not the public CDN host.       |
| Google Cloud Storage                                       | **Bucket location** (e.g. `us-east1`). Use this as the SigV4 region (GCS often fails with `auto`).                                                                                                                                                                                                                         | HMAC signing region must match bucket location.   |
| Oracle Cloud                                               | **Namespace** (required). Parse from host `<namespace>.compat.objectstorage.<region>.oraclecloud.com`. Keep endpoint in sync if the user edits namespace/region.                                                                                                                                                           | S3 compat hostname includes tenancy namespace.    |
| Alibaba OSS                                                | **Session token** (Secret Storage, optional). Same STS header as AWS.                                                                                                                                                                                                                                                      | STS is the usual RAM pattern.                     |
| Supabase                                                   | No extra input. Show a one-line note: region must stay `us-east-1`; enable S3 in the Supabase project.                                                                                                                                                                                                                     | Easy to “fix” region and break signing.           |
| Backblaze B2                                               | No extra input. Show a one-line note: use the **S3 endpoint** and S3 keys, not `api.backblazeb2.com` / native B2 keys.                                                                                                                                                                                                     | Native B2 API is not this client.                 |
| Storj, Wasabi, Linode, Hetzner, Scaleway, IDrive e2, other | No extra fields.                                                                                                                                                                                                                                                                                                           | Common S3 fields are enough.                      |

R2 jurisdiction `default` means no extra label in the hostname. If the user switches jurisdiction, parse the account id from the current endpoint; if missing, Notice and leave endpoint alone.

### Default whitelist (gitignore-style)

```
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.svg
*.bmp
*.ico
*.mp4
*.webm
*.mov
*.m4v
*.mp3
*.wav
*.ogg
*.pdf
*.zip
```

Matching: treat the list like gitignore against the **file name** (not full path), case-insensitive. Support `!` negation. Ignore blank lines and `#` comments.

## Object naming

Uploaded object name (last path segment):

```
{uuidv7}-{urlSafeOriginalName}{originalExtension}
```

- `uuidv7`: lowercase canonical string (sortable by time; gallery fallback sort).
- `urlSafeOriginalName`: basename without extension, Unicode NFKC, spaces → `-`, strip characters outside `[A-Za-z0-9._-]`, collapse repeated `-`, trim `-` / `_` / `.` from ends. If empty after sanitize, use `file`.
- Keep the original extension (lowercased).
- Full key: `{prefix?}{YYYYMM}/{objectName}` where `YYYYMM` is **upload time in local calendar** (example: September 2026 → `202609`). No extra slash if prefix is empty.

Public markdown URL:

```
{publicUrlBase}/{key}
```

Encode each key segment for the URL (`encodeURIComponent`), but do not double-encode the base.

## Link rules

| Kind                                                                            | Syntax                                                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Remote (http/https to our public base, or any http(s) asset we localize/upload) | **Always** markdown: `![alt](url)` / `[label](url)`                                    |
| Localized (vault file)                                                          | Default **wikilink** `![[filename]]` / `[[filename]]`. Setting can switch to markdown. |

Use `app.fileManager.generateMarkdownLink` only when it can be forced to the chosen style; otherwise write the link yourself so the setting wins (do not silently follow the vault-wide “Use [[Wikilinks]]” toggle).

**Alt / display text:** keep existing alt/label when rewriting. If none, use the original basename.

**Unsafe markdown paths:** vault paths with spaces or `()` break raw markdown links. When emitting a **markdown** local link:

1. Percent-encode the path (`encodeURI` per segment, keep `/`).
2. If the path still contains `()` or spaces, wrap the destination in `<>`: `![alt](<path>)`.

Wikilinks do not need this. Remote URLs always use a properly encoded URL (no `<>` needed if encoding is correct).

## Commands

Stable ids. Do not rename after release. Command palette names in sentence case.

| id                                   | name                                             | Behavior                                                                                                                            |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `upload-note-assets`                 | Upload current note's local assets               | Active markdown file. Scan embeds/links that resolve to **local** files matching the whitelist. Upload each, rewrite to public URL. |
| `upload-folder-assets`               | Upload current folder's local assets             | Folder of the active file (vault root if none). All markdown notes in that folder **non-recursively**. Same upload+rewrite.         |
| `localize-note-assets`               | Localize current note's assets                   | Download remote assets in the active note into the attachment location for that note. Rewrite links.                                |
| `localize-folder-assets`             | Localize current folder's remote assets          | Same, all notes in the folder, non-recursive.                                                                                       |
| `convert-note-wikilinks-to-markdown` | Convert current note wikilinks to markdown links | Link syntax only. Do not upload/download.                                                                                           |
| `convert-note-markdown-to-wikilinks` | Convert current note markdown links to wikilinks | Only **internal** links/embeds. Leave `http(s)` markdown links alone.                                                               |
| `open-remote-asset-gallery`          | Open remote asset gallery                        | Same view as the ribbon.                                                                                                            |

Skip silently (or Notice) if there is no active markdown file when a command needs one.

### Editor / file context menus

When right-clicking an **image embed** (local or remote) in the editor/preview as Obsidian allows:

- **Upload image** — if the target is a local whitelist file.
- **Localize image** — if the target is a remote URL.

Hide the item when it does not apply.

## Upload flow

1. Collect candidate links from note markdown (wikilink embeds, markdown images, markdown files). Resolve via `MetadataCache` / `getFirstLinkpathDest` relative to the note.
2. Skip already-remote URLs, non-whitelist files, missing files.
3. For each file: PUT to S3 at the computed key. Content-Type from extension.
4. On success, rewrite **all** links in that note that pointed at that local file to the public URL (markdown).
5. If “delete after upload” is on, delete the local file only after rewrite succeeds. If the file is still linked from **other** notes, skip delete and Notice those paths (do not break other notes).
6. Progress: one Notice at start (`Uploading n assets…`) and one at end (`Uploaded n, skipped m, failed k`). Failures listed in a modal if `k > 0`.
7. Stop a single file on error; continue the batch.

## Localize flow

1. Collect `http(s)` image/file links in the note (markdown). Optionally also bare URLs in embeds if Obsidian represents them that way.
2. Target filename = **URL basename** (last path segment, URL-decoded), not a new uuid.
3. Destination path = `getAvailablePathForAttachment(basename, notePath)`.
    - That API may suffix ` 1`, ` 2` on collision. **Do not rely on that for same-content reuse.**
4. Collision with an existing vault file of that name (before suffixing):
    - Compute checksum (SHA-256 of bytes) of existing file vs downloaded bytes.
    - **Same checksum:** do not write a second file. Point the link at the existing file.
    - **Different checksum:** do not overwrite. Collect the conflict `{note, url, existingPath}` and continue the batch.
5. After the batch, if any conflicts: one error modal listing every conflicting file (note path, remote URL, existing local path). Successful items still rewrite.
6. Rewrite successful items using the localize link-style setting.
7. Do not delete the remote object on localize.

## Remote asset gallery

Ribbon icon (something like `images` / `gallery-horizontal-end`). Tooltip: **Remote asset gallery**. Opens a plugin view (`ItemView`).

### Listing

- Prefer S3 list with prefix `{prefix}` and, if the API allows, sort/query by last-modified. If the provider cannot sort, **sort by object key descending** (uuidv7 prefix makes newer keys sort later; for “newest first” sort keys descending within each month, and months newest-first).
- Group by monthly folder `YYYYMM`.
- First paint: **last 5 months** that exist (skip empty months).
- Infinite scroll: when the user hits the bottom, load the next older month.
- **Lazy render:** only create `<img>` / `<video>` / placeholders when the cell is near the viewport (IntersectionObserver). Unload or skip decode when far off-screen. Do not fetch every object body up front; use public URLs for media when possible. For private buckets without public GET, use a presigned GET if we already have credentials; if that is large work, v1 can document “gallery preview needs a public URL base”.

### Cell rendering

| Type                                        | UI                                             |
| ------------------------------------------- | ---------------------------------------------- |
| image (`png,jpg,jpeg,gif,webp,svg,bmp,ico`) | thumbnail                                      |
| video (`mp4,webm,mov,m4v`)                  | `<video>` muted, no autoplay, preload=metadata |
| audio                                       | small player                                   |
| other                                       | file-type icon + name                          |

Show object basename under the cell.

### Context menu on a cell

- **Find notes that use this** — vault-wide scan of markdown for the public URL (and the object key / encoded variants). Show a modal list; click opens the note.
- **Download** — save into the vault using attachment rules for the **active file** if any, else vault attachment default (sourcePath `""` / root). Keep remote name.
- **Localize** — same as download, then rewrite every note that referenced this URL (same find-usage scan).
- **Delete** — (1) run find-usage; (2) if any notes use it, show them and **refuse to delete** until the user confirms a second dialog that lists those notes; (3) if unused, still confirm once (“Delete this object from storage? This cannot be undone.”); (4) DELETE on S3; (5) refresh the cell away. Do **not** rewrite notes on delete.

## Source layout (keep it this flat)

```
src/
  main.ts                 # onload/onunload, register commands, ribbon, view, menus
  settings.ts             # types, defaults, settings tab, test-connection button
  i18n.ts                 # t(key), load en
  locales/en.ts           # all user-visible strings
  commands/
    register.ts           # addCommand + context menu wiring
    upload.ts
    localize.ts
    convert-links.ts
  s3/
    client.ts             # signed REST (or minimal AWS4). Browser-safe. No AWS SDK if we can avoid it.
    names.ts              # uuidv7, sanitize, monthly key
    parse-url.ts          # guess endpoint/bucket/region/provider extras from a pasted bucket URL
    whitelist.ts          # gitignore-style match
  links/
    parse.ts              # find local vs remote embeds in markdown
    rewrite.ts            # replace links; markdown-safe encoding
    checksum.ts           # sha256
  gallery/
    view.ts
    list.ts               # month paging
    usage.ts              # find notes that reference a URL
  ui/
    conflict-modal.ts
    confirm-modal.ts
    usage-modal.ts
docs/
  r2-setup.md             # human setup guide (skeleton + image slots)
  contributing.md
  releasing.md
```

No file should grow past ~250 lines without splitting.

S3: implement SigV4 in a small module **or** use a tiny already-common approach. Do not add a large AWS SDK. Prefer `fetch` + signing so mobile works.

## Docs to write

### README.md (replace sample README)

Short: what it does, secrets, mobile, whitelist, commands, gallery, link to `docs/r2-setup.md`, contributing, releasing. Disclose that credentials go to the user’s bucket over HTTPS.

### `docs/r2-setup.md` — skeleton for a **human**

Tone: easy, slightly fun, not cute-overload. Numbered steps. Placeholders for media the author will drop in later:

```
<!-- screenshot: Cloudflare dashboard → R2 → Create bucket -->
<!-- video: CORS + public custom domain -->
```

Cover at least:

1. Create an R2 bucket
2. Public access / custom domain (this becomes **Public URL base**)
3. Create an API token (access key + secret) with object read/write/list/delete
4. Endpoint URL (`https://<accountid>.r2.cloudflarestorage.com`)
5. CORS if gallery/media will load in Obsidian’s webview (allow the vault origin if needed; for `app://` / capacitor, document what actually works — keep this honest and short)
6. Paste the S3 bucket URL into **Bucket URL** → **Guess from URL**, or paste endpoint / bucket / region by hand. Pick secrets in Secret Storage
7. Hit **Test connection**
8. Upload one image from a test note

Leave empty figure captions so images/videos can be added without rewriting the prose.

### `docs/contributing.md`

Node 18+, `npm i`, `npm run dev`, vault plugin folder, how to run lint/test/format/spellcheck, i18n string rule (add keys to `locales/en.ts` only for now), PR expectations.

### `docs/releasing.md`

Simple, copy-pasteable:

1. Bump via `npm version patch|minor|major` (existing `version-bump.mjs`)
2. Tag = `manifest.json` version, **no** `v` prefix
3. GitHub release attaches `manifest.json`, `main.js`, `styles.css`
4. After first public release, PR to `obsidian-releases`

## Tooling

Keep **npm**. Add:

- **Tests:** Vitest (or node:test if you can stay at ~100% on pure modules without extra deps — Vitest is OK). Unit-test names, whitelist, `parseBucketUrl` (one case per provider row + generic fallback + fail cases), link parse/rewrite, monthly keys, collision checksum policy, usage scan on fixture markdown. Mock `fetch` / vault. Aim for **near-100% on `src/` logic modules**; `main.ts` glue can stay thinner. One runnable check per non-trivial module.
- **Format:** Prettier. `npm run format` / `format:check`.
- **Spellcheck:** cspell on `src/`, `docs/`, `README.md`, `vision.md`.
- **Husky:** **on push** (not commit), run format check, lint, test, spellcheck. Fail the push if any fail. Document that contributors can use `husky` after `npm i`.
- **i18n:** `t('commands.uploadNote')` everywhere in UI. English only. No string concatenation of user-facing sentences.

## UX copy

Sentence case. Short. **Settings → …** with arrow notation. Confirmations are explicit (“Delete this object from R2?” not “Are you sure?”).

## Implementation order

1. Identity + empty settings (S3 fields, secrets, whitelist, flags) + i18n stub + test-connection (can fail until client exists)
2. `s3/names.ts` + `whitelist.ts` + `parse-url.ts` + tests
3. Minimal S3 client: put, get, head, list, delete, test
4. Link parse/rewrite + markdown-safe paths + convert-link commands + tests
5. Upload note/folder + optional local delete + image context **Upload**
6. Localize note/folder + checksum collisions + attachment path + context **Localize**
7. Gallery view: months, lazy cells, load more
8. Gallery context: usage, download, localize, delete + confirmations
9. Docs (README, R2 skeleton, contributing, releasing)
10. Vitest coverage, Prettier, cspell, Husky on push, ESLint clean

## Acceptance checklist

- [ ] Mobile: upload, localize, gallery scroll, settings secrets, test connection
- [ ] Secrets never written to `data.json`
- [ ] Remote links are markdown; localized links follow the setting (default wikilink)
- [ ] Localize uses Obsidian attachment location APIs
- [ ] Name format `{uuidv7}-{sanitized}{ext}` under `YYYYMM`
- [ ] Collision: same hash relinks; different hash → one listing modal
- [ ] Gallery: 5 months, load older on scroll, lazy media, usage/delete guards
- [ ] Husky push hook runs format, lint, test, spellcheck
- [ ] `npm run lint` and tests pass
- [ ] R2 doc is a human guide with media slots
- [ ] Pasting an R2 (and other listed) bucket URL fills endpoint, bucket, region, path-style, provider; public URL and secrets stay untouched
- [ ] Settings only show extra fields (R2 jurisdiction, AWS/Aliyun session token, Spaces CDN, GCS location, Oracle namespace) for that provider; notes for Supabase/B2

## Decided defaults (do not re-ask)

- Folder upload/localize is **non-recursive**
- Monthly folder uses **local** timezone at upload
- Gallery “last 5 months” means five **non-empty** `YYYYMM` prefixes, newest first
- Delete-after-upload skips files still referenced by other notes
- Gallery delete never rewrites notes; it only removes the object after confirmation
- No AWS SDK; small SigV4 + `fetch`
- Plugin setting for wikilink vs markdown **overrides** the vault wikilink toggle for **localized** links we write
- Guess-from-URL never overwrites secrets or **Public URL base** (Spaces CDN paste is the exception: that URL is public/CDN, not endpoint)
- Provider extra fields are hidden unless that provider is selected; session token is omitted from signed requests when empty
  )
