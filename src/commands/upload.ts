/**
 * Upload local whitelist assets from the active note (or its folder).
 * Flow: parse → resolve → PUT → rewrite to public markdown URL → optional trashFile.
 * trashFile obeys Settings → Files and links → Deleted files (system / .trash / permanent).
 */
import { App, Notice, TFile, TFolder } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { hasSecretStorage } from '../settings';
import { createClient } from '../s3/client';
import { buildObjectKey } from '../s3/names';
import { matchesWhitelist } from '../s3/whitelist';
import { parseAssetRefs } from '../links/parse';
import { basenameOf, formatRemoteLink, rewriteTargets } from '../links/rewrite';
import { showFailures } from '../ui/conflict-modal';

function activeMarkdown(app: App): TFile | null {
	const f = app.workspace.getActiveFile();
	if (f && f.extension === 'md') return f;
	return null;
}

function resolveLocal(app: App, note: TFile, target: string): TFile | null {
	const dest = app.metadataCache.getFirstLinkpathDest(target, note.path);
	return dest instanceof TFile ? dest : null;
}

async function notesLinkingPath(app: App, localPath: string, except?: string): Promise<string[]> {
	const hits: string[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (file.path === except) continue;
		const content = await app.vault.cachedRead(file);
		const refs = parseAssetRefs(content);
		for (const ref of refs) {
			if (ref.isRemote) continue;
			const dest = resolveLocal(app, file, ref.target);
			if (dest?.path === localPath) {
				hits.push(file.path);
				break;
			}
		}
	}
	return hits;
}

export interface UploadStats {
	uploaded: number;
	skipped: number;
	failed: number;
	errors: string[];
}

async function uploadNote(plugin: AssetsOffloaderPlugin, note: TFile): Promise<UploadStats> {
	const stats: UploadStats = { uploaded: 0, skipped: 0, failed: 0, errors: [] };
	if (!hasSecretStorage(plugin.app)) {
		new Notice(t('notices.noSecretStorage'));
		stats.failed++;
		return stats;
	}

	let client;
	try {
		client = createClient(plugin.app, plugin.settings);
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e));
		stats.failed++;
		return stats;
	}

	const content = await plugin.app.vault.read(note);
	const refs = parseAssetRefs(content);
	const byPath = new Map<string, TFile>();

	for (const ref of refs) {
		if (ref.isRemote) {
			stats.skipped++;
			continue;
		}
		const file = resolveLocal(plugin.app, note, ref.target);
		if (!file) {
			stats.skipped++;
			continue;
		}
		if (!matchesWhitelist(file.name, plugin.settings.whitelist)) {
			stats.skipped++;
			continue;
		}
		byPath.set(file.path, file);
	}

	const n = byPath.size;
	if (n === 0) {
		new Notice(t('notices.uploadDone', { n: 0, m: stats.skipped, k: 0 }));
		return stats;
	}
	new Notice(t('notices.uploadStart', { n }));

	let markdown = content;
	const publicBase = plugin.settings.publicUrlBase.replace(/\/+$/, '');
	if (!publicBase && !(plugin.settings.provider === 'spaces' && plugin.settings.spacesCdnUrl)) {
		// still upload; public URL may fall back to object URL
	}

	for (const file of byPath.values()) {
		try {
			const bytes = new Uint8Array(await plugin.app.vault.readBinary(file));
			const key = buildObjectKey(file.name, plugin.settings.prefix);
			await client.put(key, bytes);
			const url = client.publicUrl(key);
			const currentRefs = parseAssetRefs(markdown);
			markdown = rewriteTargets(
				markdown,
				currentRefs,
				(ref) => {
					if (ref.isRemote) return false;
					const dest = resolveLocal(plugin.app, note, ref.target);
					return dest?.path === file.path;
				},
				(ref) =>
					formatRemoteLink(
						{ embed: ref.embed, alt: ref.alt || basenameOf(file.name) },
						url,
					),
			);
			stats.uploaded++;

			if (plugin.settings.deleteLocalAfterUpload) {
				const others = await notesLinkingPath(plugin.app, file.path, note.path);
				// also check rewritten note still references? we already rewrote this note
				if (others.length > 0) {
					new Notice(
						t('notices.deleteSkippedLinked', {
							path: file.path,
							notes: others.join(', '),
						}),
					);
				} else {
					await plugin.app.fileManager.trashFile(file);
				}
			}
		} catch (e) {
			stats.failed++;
			stats.errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (markdown !== content) {
		await plugin.app.vault.modify(note, markdown);
	}

	new Notice(
		t('notices.uploadDone', {
			n: stats.uploaded,
			m: stats.skipped,
			k: stats.failed,
		}),
	);
	if (stats.errors.length) showFailures(plugin.app, stats.errors);
	return stats;
}

export async function uploadCurrentNote(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	if (!note) {
		new Notice(t('notices.noActiveNote'));
		return;
	}
	await uploadNote(plugin, note);
}

export async function uploadCurrentFolder(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	const folder: TFolder | null = note?.parent ?? plugin.app.vault.getRoot();
	const files = folder.children.filter(
		(f): f is TFile => f instanceof TFile && f.extension === 'md',
	);
	if (files.length === 0) {
		new Notice(t('notices.noActiveNote'));
		return;
	}
	for (const f of files) {
		await uploadNote(plugin, f);
	}
}

export async function uploadSingleFile(
	plugin: AssetsOffloaderPlugin,
	note: TFile,
	file: TFile,
): Promise<void> {
	if (!matchesWhitelist(file.name, plugin.settings.whitelist)) return;
	if (!hasSecretStorage(plugin.app)) {
		new Notice(t('notices.noSecretStorage'));
		return;
	}
	try {
		const client = createClient(plugin.app, plugin.settings);
		const bytes = new Uint8Array(await plugin.app.vault.readBinary(file));
		const key = buildObjectKey(file.name, plugin.settings.prefix);
		await client.put(key, bytes);
		const url = client.publicUrl(key);
		const content = await plugin.app.vault.read(note);
		const refs = parseAssetRefs(content);
		const next = rewriteTargets(
			content,
			refs,
			(ref) => {
				if (ref.isRemote) return false;
				const dest = resolveLocal(plugin.app, note, ref.target);
				return dest?.path === file.path;
			},
			(ref) =>
				formatRemoteLink({ embed: ref.embed, alt: ref.alt || basenameOf(file.name) }, url),
		);
		if (next !== content) await plugin.app.vault.modify(note, next);
		new Notice(t('notices.uploadDone', { n: 1, m: 0, k: 0 }));
	} catch (e) {
		new Notice(t('notices.testFail', { error: e instanceof Error ? e.message : String(e) }));
	}
}

export { activeMarkdown, resolveLocal, notesLinkingPath };
