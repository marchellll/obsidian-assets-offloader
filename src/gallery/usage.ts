import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { parseAssetRefs } from '../links/parse';

/** Find markdown notes that reference a public URL (exact or encoded variants). */
export async function findNotesUsingUrl(app: App, url: string): Promise<string[]> {
	const variants = buildVariants(url);
	const hits: string[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const content = await app.vault.cachedRead(file);
		if (contentHasUrl(content, variants)) hits.push(file.path);
	}
	return hits;
}

export function buildVariants(url: string): Set<string> {
	const variants = new Set<string>([url]);
	try {
		const u = new URL(url);
		const decodedPath = u.pathname
			.split('/')
			.map((s) => {
				try {
					return decodeURIComponent(s);
				} catch {
					return s;
				}
			})
			.join('/');
		variants.add(`${u.origin}${decodedPath}`);
		const key = u.pathname.replace(/^\//, '');
		if (key) variants.add(key);
	} catch {
		/* ignore */
	}
	return variants;
}

export function contentHasUrl(content: string, variants: Set<string>): boolean {
	for (const v of variants) {
		if (content.includes(v)) return true;
	}
	for (const ref of parseAssetRefs(content)) {
		if (ref.isRemote && variants.has(ref.target)) return true;
	}
	return false;
}

export async function rewriteUrlInNotes(
	app: App,
	url: string,
	replace: (note: TFile, content: string) => string | Promise<string>,
): Promise<string[]> {
	const notes = await findNotesUsingUrl(app, url);
	const changed: string[] = [];
	for (const path of notes) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;
		const content = await app.vault.read(file);
		const next = await replace(file, content);
		if (next !== content) {
			await app.vault.modify(file, next);
			changed.push(path);
		}
	}
	return changed;
}
