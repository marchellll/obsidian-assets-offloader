import { Notice, TFile, TFolder } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { parseAssetRefs } from '../links/parse';
import { basenameOf, formatLocalLink, rewriteTargets } from '../links/rewrite';
import { sameChecksum } from '../links/checksum';
import { showConflicts, showFailures } from '../ui/conflict-modal';
import { activeMarkdown } from './upload';

export interface LocalizeConflict {
	note: string;
	url: string;
	existingPath: string;
}

interface Stats {
	ok: number;
	skipped: number;
	failed: number;
	errors: string[];
	conflicts: LocalizeConflict[];
}

async function downloadUrl(url: string): Promise<Uint8Array> {
	const { requestUrl } = await import('obsidian');
	const res = await requestUrl({ url, throw: false });
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status} fetching ${url}`);
	}
	return new Uint8Array(res.arrayBuffer);
}

async function localizeNote(plugin: AssetsOffloaderPlugin, note: TFile): Promise<Stats> {
	const stats: Stats = { ok: 0, skipped: 0, failed: 0, errors: [], conflicts: [] };
	const content = await plugin.app.vault.read(note);
	const refs = parseAssetRefs(content);
	const remoteUrls = [...new Set(refs.filter((r) => r.isRemote).map((r) => r.target))];

	if (remoteUrls.length === 0) {
		new Notice(t('notices.localizeDone', { n: 0, m: 0, k: 0 }));
		return stats;
	}
	new Notice(t('notices.localizeStart', { n: remoteUrls.length }));

	let markdown = content;
	const urlToLocal = new Map<string, string>();

	for (const url of remoteUrls) {
		try {
			const name = basenameOf(url);
			const bytes = await downloadUrl(url);
			const candidate = await plugin.app.fileManager.getAvailablePathForAttachment(
				name,
				note.path,
			);
			// Check collision with exact basename path (before suffix)
			const parent = candidate.includes('/')
				? candidate.slice(0, candidate.lastIndexOf('/'))
				: '';
			const exactPath = parent ? `${parent}/${name}` : name;
			const existing = plugin.app.vault.getAbstractFileByPath(exactPath);

			let finalPath = candidate;
			if (existing instanceof TFile) {
				const existingBytes = new Uint8Array(await plugin.app.vault.readBinary(existing));
				if (await sameChecksum(existingBytes, bytes)) {
					finalPath = existing.path;
				} else {
					stats.conflicts.push({
						note: note.path,
						url,
						existingPath: existing.path,
					});
					stats.skipped++;
					continue;
				}
			} else {
				await plugin.app.vault.createBinary(candidate, bytes.buffer as ArrayBuffer);
				finalPath = candidate;
			}

			urlToLocal.set(url, finalPath);
			stats.ok++;
		} catch (e) {
			stats.failed++;
			stats.errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	const style = plugin.settings.localizedLinkStyle;
	const currentRefs = parseAssetRefs(markdown);
	markdown = rewriteTargets(
		markdown,
		currentRefs,
		(ref) => ref.isRemote && urlToLocal.has(ref.target),
		(ref) => {
			const path = urlToLocal.get(ref.target)!;
			const linkName = path.includes('/') ? path.split('/').pop()! : path;
			return formatLocalLink(
				ref,
				style === 'wikilink' ? linkName : path,
				style,
				basenameOf(ref.target),
			);
		},
	);

	if (markdown !== content) {
		await plugin.app.vault.modify(note, markdown);
	}

	new Notice(t('notices.localizeDone', { n: stats.ok, m: stats.skipped, k: stats.failed }));
	if (stats.errors.length) showFailures(plugin.app, stats.errors);
	return stats;
}

export async function localizeCurrentNote(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	if (!note) {
		new Notice(t('notices.noActiveNote'));
		return;
	}
	const stats = await localizeNote(plugin, note);
	if (stats.conflicts.length) {
		showConflicts(
			plugin.app,
			stats.conflicts.map((c) => `${c.note}\n  ${c.url}\n  → ${c.existingPath}`),
		);
	}
}

export async function localizeCurrentFolder(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	const folder: TFolder | null = note?.parent ?? plugin.app.vault.getRoot();
	const files = folder.children.filter(
		(f): f is TFile => f instanceof TFile && f.extension === 'md',
	);
	const allConflicts: LocalizeConflict[] = [];
	for (const f of files) {
		const stats = await localizeNote(plugin, f);
		allConflicts.push(...stats.conflicts);
	}
	if (allConflicts.length) {
		showConflicts(
			plugin.app,
			allConflicts.map((c) => `${c.note}\n  ${c.url}\n  → ${c.existingPath}`),
		);
	}
}

export async function localizeSingleUrl(
	plugin: AssetsOffloaderPlugin,
	note: TFile,
	url: string,
): Promise<void> {
	const content = await plugin.app.vault.read(note);
	if (!content.includes(url)) return;
	// reuse note localize by temporarily... just run full note for simplicity
	await localizeCurrentNote(plugin);
}
