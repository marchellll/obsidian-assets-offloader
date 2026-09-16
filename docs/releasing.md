# Releasing

`.npmrc` sets `tag-version-prefix=""`, so git tags match `manifest.json` (`1.0.1`, not `v1.0.1`).

1. Bump, commit, and tag:

```bash
npm version patch
# or: npm version minor | major
```

This runs `version-bump.mjs` (updates `manifest.json` and `versions.json`), commits, and creates a git tag.

2. Push the commit and the tag:

```bash
git push
git push --tags
```

3. The [release workflow](../.github/workflows/release.yml) runs on the tag. It builds the plugin, attests provenance, and opens a **draft** GitHub release with:

- `manifest.json`
- `main.js`
- `styles.css` (if present)

4. Check the draft, then publish it. The release tag must equal `manifest.json` `version`.

5. After the first public release, open a PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) to list the plugin.
