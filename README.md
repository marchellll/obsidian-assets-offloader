# Assets Offloader

Upload vault attachments (images, video, audio, PDF, zip, …) to S3-compatible object storage (Cloudflare R2 is the documented target), rewrite note links to public URLs, and localize those assets back into the vault.

Works on **desktop and mobile**. Credentials use Obsidian **Secret Storage** (Obsidian ≥ 1.11.4). Secrets are never written to `data.json`.

This plugin only makes S3-compatible HTTPS calls you opt into (list / put / get / delete / head + connection test). Your access key and secret key are sent to **your** bucket endpoint over HTTPS.

## Features

- Upload current note or folder (non-recursive) local whitelist assets
- Localize remote assets back with Obsidian attachment folder rules
- Extension whitelist (gitignore-style)
- Remote asset gallery (monthly folders, lazy media)
- Convert wikilinks ↔ markdown (syntax only)
- Guess S3 fields from a pasted bucket URL

## Setup (R2)

See [docs/r2-setup.md](docs/r2-setup.md).

## Commands

| Command                                          | What it does                 |
| ------------------------------------------------ | ---------------------------- |
| Upload current note's local assets               | Upload + rewrite             |
| Upload current folder's local assets             | Same, all notes in folder    |
| Localize current note's assets                   | Download remotes into vault  |
| Localize current folder's remote assets          | Same, folder non-recursive   |
| Convert current note wikilinks to markdown links | Syntax only                  |
| Convert current note markdown links to wikilinks | Internal only; leave http(s) |
| Open remote asset gallery                        | Same as ribbon               |

## Development

- [Codebase map](docs/architecture.md) — what lives where
- [Contributing](docs/contributing.md)
- [Releasing](docs/releasing.md)

```bash
npm i
npm run dev
```

## License

0-BSD
