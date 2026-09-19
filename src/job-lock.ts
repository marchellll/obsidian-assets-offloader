/**
 * Process-wide exclusive lock for upload / localize / gallery delete.
 * Second trigger gets a notice and returns; no queue.
 */
import { Notice } from 'obsidian';
import { t } from './i18n';

let busy = false;

export async function runExclusive(fn: () => Promise<void>): Promise<void> {
	if (busy) {
		new Notice(t('notices.jobBusy'));
		return;
	}
	busy = true;
	try {
		await fn();
	} finally {
		busy = false;
	}
}
