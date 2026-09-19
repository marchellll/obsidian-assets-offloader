/** Confirm before recursive folder upload / localize. */
import type { App, TFolder } from 'obsidian';
import { t } from '../i18n';
import { confirm } from '../ui/confirm-modal';

export type RecursiveKind = 'upload' | 'localize';

export async function confirmRecursiveFolder(
	app: App,
	folder: TFolder,
	n: number,
	kind: RecursiveKind,
): Promise<boolean> {
	const folderLabel = folder.path || '/';
	const key =
		kind === 'upload' ? 'modal.confirmRecursiveUpload' : 'modal.confirmRecursiveLocalize';
	return confirm(app, t(key, { folder: folderLabel, n }));
}
