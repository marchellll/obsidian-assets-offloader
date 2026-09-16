# Contributing

New to the tree? Read [architecture.md](architecture.md) first (folder map + upload/localize flow).

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm i
npm run dev
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```
<Vault>/.obsidian/plugins/obsidian-assets-offloader/
```

Reload Obsidian and enable the plugin.

## Scripts

| Script                            | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `npm run build`                   | Typecheck + production bundle             |
| `npm run lint`                    | ESLint (`eslint-plugin-obsidianmd`)       |
| `npm test`                        | Vitest                                    |
| `npm run format` / `format:check` | Prettier                                  |
| `npm run spellcheck`              | cspell on `src/`, `docs/`, README, vision |

## Husky

After `npm i`, Husky installs a **pre-push** hook that runs format check, lint, test, and spellcheck. Push fails if any fail.

## i18n

Add user-visible strings to `src/locales/en.ts` only for now. Use `t('key')` everywhere in UI.

## PRs

- Keep diffs small and scoped.
- Add or update unit tests for logic modules you touch.
- Do not commit `main.js` / `node_modules`.
