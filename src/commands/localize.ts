/**
 * Download remote http(s) assets into the vault attachment location for a note.
 *
 * Crash-safe order per URL:
 *   1) download/reuse local file (orphan local OK if we die here — note still has remote URL)
 *   2) vault.process rewrite + re-read verify local link on disk
 *   Never deletes the remote object.
 */
import { Notice, TFile, TFolder, requestUrl } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { parseAssetRefs } from '../links/parse';
import { persistLinkRewrite } from '../links/persist';
import { basenameOf, formatLocalLink, rewriteTargets } from '../links/rewrite';
import { sameChecksum } from '../links/checksum';
import { showConflicts, showFailures } from '../ui/conflict-modal';
import { JobProgress } from '../ui/job-progress';
import { runExclusive } from '../job-lock';
import { activeMarkdown } from './upload';
import { markdownNotesInFolder } from './folder-notes';
import { confirmRecursiveFolder } from './confirm-recursive';

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
	const res = await requestUrl({ url, throw: false });
	if (res.status < 200 || res.status >= 300) {
		throw new Error(`HTTP ${res.status} fetching ${url}`);
	}
	return new Uint8Array(res.arrayBuffer);
}

function remoteTargets(content: string): string[] {
	return [
		...new Set(
			parseAssetRefs(content)
				.filter((r) => r.isRemote)
				.map((r) => r.target),
		),
	];
}

function localLinkNeedle(plugin: AssetsOffloaderPlugin, localPath: string): string {
	const style = plugin.settings.localizedLinkStyle;
	if (style === 'wikilink') {
		return localPath.includes('/') ? (localPath.split('/').pop() ?? localPath) : localPath;
	}
	return localPath;
}

async function localizeNote(
	plugin: AssetsOffloaderPlugin,
	note: TFile,
	opts?: { progress?: JobProgress; quiet?: boolean },
): Promise<Stats> {
	const stats: Stats = { ok: 0, skipped: 0, failed: 0, errors: [], conflicts: [] };
	const content = await plugin.app.vault.read(note);
	const remoteUrls = remoteTargets(content);

	if (remoteUrls.length === 0) {
		if (!opts?.quiet) {
			new Notice(t('notices.localizeDone', { n: 0, m: 0, k: 0 }));
		}
		return stats;
	}

	const ownProgress = !opts?.progress;
	const progress =
		opts?.progress ??
		new JobProgress(
			plugin,
			remoteUrls.length,
			'progress.localize',
			plugin.settings.progressCorner,
		);

	try {
		for (const url of remoteUrls) {
			progress.setCurrent(basenameOf(url));
			try {
				const name = basenameOf(url);
				const bytes = await downloadUrl(url);
				const candidate = await plugin.app.fileManager.getAvailablePathForAttachment(
					name,
					note.path,
				);
				const parent = candidate.includes('/')
					? candidate.slice(0, candidate.lastIndexOf('/'))
					: '';
				const exactPath = parent ? `${parent}/${name}` : name;
				const existing = plugin.app.vault.getAbstractFileByPath(exactPath);

				let finalPath = candidate;
				if (existing instanceof TFile) {
					const existingBytes = new Uint8Array(
						await plugin.app.vault.readBinary(existing),
					);
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

				const style = plugin.settings.localizedLinkStyle;
				const linkName = finalPath.includes('/')
					? (finalPath.split('/').pop() ?? finalPath)
					: finalPath;
				const needle = localLinkNeedle(plugin, finalPath);

				const persisted = await persistLinkRewrite(
					plugin.app,
					note,
					(data) =>
						rewriteTargets(
							data,
							parseAssetRefs(data),
							(ref) => ref.isRemote && ref.target === url,
							(ref) =>
								formatLocalLink(
									ref,
									style === 'wikilink' ? linkName : finalPath,
									style,
									basenameOf(ref.target),
								),
						),
					needle,
				);
				if (!persisted.ok) {
					stats.failed++;
					stats.errors.push(`${url}: ${persisted.reason}`);
					// Orphan local file is OK — note still points at the remote URL.
					continue;
				}
				stats.ok++;
			} catch (e) {
				stats.failed++;
				stats.errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
			} finally {
				progress.tick();
			}
		}
	} finally {
		if (ownProgress) progress.finish();
	}

	if (!opts?.quiet) {
		new Notice(t('notices.localizeDone', { n: stats.ok, m: stats.skipped, k: stats.failed }));
		if (stats.errors.length) showFailures(plugin.app, stats.errors);
	}
	return stats;
}

export async function localizeCurrentNote(plugin: AssetsOffloaderPlugin): Promise<void> {
	await runExclusive(async () => {
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
	});
}

export async function localizeCurrentFolder(
	plugin: AssetsOffloaderPlugin,
	opts?: { recursive?: boolean },
): Promise<void> {
	await runExclusive(async () => {
		const recursive = opts?.recursive === true;
		const note = activeMarkdown(plugin.app);
		const folder: TFolder = note?.parent ?? plugin.app.vault.getRoot();
		const files = markdownNotesInFolder(folder, recursive);

		if (recursive) {
			const ok = await confirmRecursiveFolder(plugin.app, folder, files.length, 'localize');
			if (!ok) return;
		}

		let total = 0;
		const work: TFile[] = [];
		for (const f of files) {
			const body = await plugin.app.vault.cachedRead(f);
			const urls = remoteTargets(body);
			if (urls.length > 0) {
				total += urls.length;
				work.push(f);
			}
		}
		if (total === 0) {
			new Notice(t('notices.localizeDone', { n: 0, m: 0, k: 0 }));
			return;
		}

		const progress = new JobProgress(
			plugin,
			total,
			'progress.localize',
			plugin.settings.progressCorner,
		);
		const allConflicts: LocalizeConflict[] = [];
		const agg = { ok: 0, skipped: 0, failed: 0, errors: [] as string[] };
		try {
			for (const f of work) {
				const stats = await localizeNote(plugin, f, { progress, quiet: true });
				agg.ok += stats.ok;
				agg.skipped += stats.skipped;
				agg.failed += stats.failed;
				agg.errors.push(...stats.errors);
				allConflicts.push(...stats.conflicts);
			}
		} finally {
			progress.finish();
		}

		new Notice(t('notices.localizeDone', { n: agg.ok, m: agg.skipped, k: agg.failed }));
		if (agg.errors.length) showFailures(plugin.app, agg.errors);
		if (allConflicts.length) {
			showConflicts(
				plugin.app,
				allConflicts.map((c) => `${c.note}\n  ${c.url}\n  → ${c.existingPath}`),
			);
		}
	});
}
