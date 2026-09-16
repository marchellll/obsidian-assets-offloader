/**
 * Crash-safe note link persistence.
 * Prefer orphan copies over data loss: never delete the old side until
 * vault.process + re-read prove the new link is on disk.
 */
import type { App, TFile } from 'obsidian';

export type PersistResult = { ok: true; saved: string } | { ok: false; reason: string };

/**
 * Atomically rewrite `note` via vault.process, then re-read and require `mustContain`.
 * If rewrite is a no-op or verify fails, returns ok:false — caller must not delete anything.
 */
export async function persistLinkRewrite(
	app: App,
	note: TFile,
	rewrite: (data: string) => string,
	mustContain: string,
): Promise<PersistResult> {
	let changed = false;
	await app.vault.process(note, (data) => {
		const next = rewrite(data);
		changed = next !== data;
		return next;
	});
	if (!changed) {
		return { ok: false, reason: 'link rewrite found nothing' };
	}
	const saved = await app.vault.read(note);
	if (!saved.includes(mustContain)) {
		return {
			ok: false,
			reason: 'saved note missing expected link (refusing unsafe cleanup)',
		};
	}
	return { ok: true, saved };
}

/** Local trash is allowed only after on-disk verify and no remaining local links. */
export function mayTrashLocalAfterUpload(opts: {
	verifiedOnDisk: boolean;
	stillLinkedInNote: boolean;
	linkedElsewhere: boolean;
}): boolean {
	return opts.verifiedOnDisk && !opts.stillLinkedInNote && !opts.linkedElsewhere;
}
