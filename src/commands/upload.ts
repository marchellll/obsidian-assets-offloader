/**
 * Upload local whitelist assets from the active note (or its folder).
 *
 * Crash-safe order per file:
 *   1) read local bytes
 *   2) PUT remote (orphan remote OK if we die here)
 *   3) vault.process rewrite + re-read verify URL on disk
 *   4) only then optional trashFile (never if verify fails / other notes still link)
 *
 * Kill mid-run → worst case: extra remote object or leftover local file. Note keeps a working link.
 */
import { App, Notice, TFile, TFolder } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { hasSecretStorage, missingConnectionFields } from '../settings';
import { createClient, type S3Client } from '../s3/client';
import { buildObjectKey } from '../s3/names';
import { matchesWhitelist } from '../s3/whitelist';
import { parseAssetRefs } from '../links/parse';
import { persistLinkRewrite, mayTrashLocalAfterUpload } from '../links/persist';
import { basenameOf, formatRemoteLink, rewriteTargets } from '../links/rewrite';
import { showFailures } from '../ui/conflict-modal';
import { JobProgress } from '../ui/job-progress';

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

/** True if saved note body still has a local ref resolving to `file`. */
function noteStillLinksFile(app: App, note: TFile, saved: string, file: TFile): boolean {
	for (const ref of parseAssetRefs(saved)) {
		if (ref.isRemote) continue;
		const dest = resolveLocal(app, note, ref.target);
		if (dest?.path === file.path) return true;
	}
	return false;
}

export interface UploadStats {
	uploaded: number;
	skipped: number;
	failed: number;
	errors: string[];
}

function collectUploadables(
	plugin: AssetsOffloaderPlugin,
	note: TFile,
	content: string,
): { byPath: Map<string, TFile>; skipped: number } {
	const byPath = new Map<string, TFile>();
	let skipped = 0;
	for (const ref of parseAssetRefs(content)) {
		if (ref.isRemote) {
			skipped++;
			continue;
		}
		const file = resolveLocal(plugin.app, note, ref.target);
		if (!file || !matchesWhitelist(file.name, plugin.settings.whitelist)) {
			skipped++;
			continue;
		}
		byPath.set(file.path, file);
	}
	return { byPath, skipped };
}

async function uploadNote(
	plugin: AssetsOffloaderPlugin,
	note: TFile,
	opts?: { progress?: JobProgress; quiet?: boolean; client?: S3Client },
): Promise<UploadStats> {
	const stats: UploadStats = { uploaded: 0, skipped: 0, failed: 0, errors: [] };
	if (!hasSecretStorage(plugin.app)) {
		if (!opts?.quiet) new Notice(t('notices.noSecretStorage'));
		stats.failed++;
		return stats;
	}
	const missing = missingConnectionFields(plugin.settings);
	if (missing.length > 0) {
		if (!opts?.quiet) {
			new Notice(t('settings.validationMissing', { fields: missing.join(', ') }));
		}
		stats.failed++;
		return stats;
	}

	let client = opts?.client;
	if (!client) {
		try {
			client = createClient(plugin.app, plugin.settings);
		} catch (e) {
			if (!opts?.quiet) new Notice(e instanceof Error ? e.message : String(e));
			stats.failed++;
			return stats;
		}
	}

	const content = await plugin.app.vault.read(note);
	const { byPath, skipped } = collectUploadables(plugin, note, content);
	stats.skipped = skipped;

	const n = byPath.size;
	if (n === 0) {
		if (!opts?.quiet) {
			new Notice(t('notices.uploadDone', { n: 0, m: stats.skipped, k: 0 }));
		}
		return stats;
	}

	const ownProgress = !opts?.progress;
	const progress =
		opts?.progress ??
		new JobProgress(plugin, n, 'progress.upload', plugin.settings.progressCorner);

	try {
		for (const file of byPath.values()) {
			progress.setCurrent(file.name);
			try {
				// 1) Local bytes first — if we die after PUT, remote is an orphan, local stays.
				const bytes = new Uint8Array(await plugin.app.vault.readBinary(file));
				const key = buildObjectKey(file.name, plugin.settings.prefix);
				await client.put(key, bytes);
				const url = client.publicUrl(key);

				// 2) Persist rewrite + verify URL is actually on disk.
				const persisted = await persistLinkRewrite(
					plugin.app,
					note,
					(data) =>
						rewriteTargets(
							data,
							parseAssetRefs(data),
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
						),
					url,
				);
				if (!persisted.ok) {
					stats.failed++;
					stats.errors.push(`${file.path}: ${persisted.reason}`);
					continue;
				}
				stats.uploaded++;

				// 3) Delete local only after verified remote link — never before.
				if (plugin.settings.deleteLocalAfterUpload) {
					const stillInNote = noteStillLinksFile(plugin.app, note, persisted.saved, file);
					const others = await notesLinkingPath(plugin.app, file.path, note.path);
					if (
						!mayTrashLocalAfterUpload({
							verifiedOnDisk: true,
							stillLinkedInNote: stillInNote,
							linkedElsewhere: others.length > 0,
						})
					) {
						if (stillInNote) {
							new Notice(t('notices.deleteSkippedStillLinked', { path: file.path }));
						} else if (others.length > 0) {
							new Notice(
								t('notices.deleteSkippedLinked', {
									path: file.path,
									notes: others.join(', '),
								}),
							);
						}
					} else {
						await plugin.app.fileManager.trashFile(file);
					}
				}
			} catch (e) {
				stats.failed++;
				stats.errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
			} finally {
				progress.tick();
			}
		}
	} finally {
		if (ownProgress) progress.finish();
	}

	if (!opts?.quiet) {
		new Notice(
			t('notices.uploadDone', {
				n: stats.uploaded,
				m: stats.skipped,
				k: stats.failed,
			}),
		);
		if (stats.errors.length) showFailures(plugin.app, stats.errors);
	}
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

	if (!hasSecretStorage(plugin.app)) {
		new Notice(t('notices.noSecretStorage'));
		return;
	}
	const missing = missingConnectionFields(plugin.settings);
	if (missing.length > 0) {
		new Notice(t('settings.validationMissing', { fields: missing.join(', ') }));
		return;
	}

	let client: S3Client;
	try {
		client = createClient(plugin.app, plugin.settings);
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e));
		return;
	}

	let total = 0;
	const work: TFile[] = [];
	for (const f of files) {
		const body = await plugin.app.vault.cachedRead(f);
		const { byPath } = collectUploadables(plugin, f, body);
		if (byPath.size > 0) {
			total += byPath.size;
			work.push(f);
		}
	}
	if (total === 0) {
		new Notice(t('notices.uploadDone', { n: 0, m: 0, k: 0 }));
		return;
	}

	const progress = new JobProgress(
		plugin,
		total,
		'progress.upload',
		plugin.settings.progressCorner,
	);
	const agg: UploadStats = { uploaded: 0, skipped: 0, failed: 0, errors: [] };
	try {
		for (const f of work) {
			const s = await uploadNote(plugin, f, { progress, quiet: true, client });
			agg.uploaded += s.uploaded;
			agg.skipped += s.skipped;
			agg.failed += s.failed;
			agg.errors.push(...s.errors);
		}
	} finally {
		progress.finish();
	}

	new Notice(
		t('notices.uploadDone', {
			n: agg.uploaded,
			m: agg.skipped,
			k: agg.failed,
		}),
	);
	if (agg.errors.length) showFailures(plugin.app, agg.errors);
}

export { activeMarkdown, resolveLocal, notesLinkingPath };
