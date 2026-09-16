# Assets Offloader

Upload vault attachments to S3-compatible storage (Cloudflare R2 is documented), rewrite note links to public URLs, and pull those files back into the vault.

Desktop and mobile. Needs Obsidian 1.11.4+ for Secret Storage. Access keys stay out of `data.json`.

Network use is only S3-compatible HTTPS to the bucket you configure: list, put, get, delete, head, and a connection test.

## Features

- Upload whitelist files from the current note or the current folder (not recursive)
- Download remote files back using Obsidian’s attachment folder rules
- Extension whitelist (gitignore-style)
- Remote gallery (monthly folders, lazy media)
- Convert wikilinks ↔ markdown (syntax only)
- Guess S3 fields from a pasted bucket URL

## Setup (R2)

[docs/r2-setup.md](docs/r2-setup.md)

## Commands

| Command                                          | What it does                       |
| ------------------------------------------------ | ---------------------------------- |
| Upload current note's local assets               | Upload and rewrite links           |
| Upload current folder's local assets             | Same, every note in the folder     |
| Localize current note's assets                   | Download remotes into the vault    |
| Localize current folder's remote assets          | Same, folder, not recursive        |
| Convert current note wikilinks to markdown links | Syntax only                        |
| Convert current note markdown links to wikilinks | Internal links only; leave http(s) |
| Open remote asset gallery                        | Same as the ribbon                 |

## Development

- [Codebase map](docs/architecture.md)
- [Contributing](docs/contributing.md)
- [Releasing](docs/releasing.md)

```bash
npm i
npm run dev
```

## License

0-BSD
