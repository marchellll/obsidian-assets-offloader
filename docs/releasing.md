# Releasing

1. Bump version:

```bash
npm version patch
# or: npm version minor | major
```

This runs `version-bump.mjs` and updates `manifest.json` + `versions.json`.

2. Build:

```bash
npm run build
```

3. Create a GitHub release whose tag equals `manifest.json` `version` with **no** `v` prefix (e.g. `1.0.1`).

4. Attach these assets individually:

- `manifest.json`
- `main.js`
- `styles.css`

5. After the first public release, open a PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) to list the plugin.
