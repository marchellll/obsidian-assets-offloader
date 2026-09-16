/** Fuzzy folder picker — used when gallery Download asks where to save. */
import { App, FuzzySuggestModal, TFolder } from 'obsidian';
import { t } from '../i18n';

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private resolvePromise: ((value: TFolder | null) => void) | null = null;

	constructor(app: App) {
		super(app);
		this.setPlaceholder(t('gallery.pickFolder'));
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllFolders(true);
	}

	getItemText(item: TFolder): string {
		return item.path || '/';
	}

	onChooseItem(item: TFolder): void {
		this.resolvePromise?.(item);
		this.resolvePromise = null;
	}

	onClose(): void {
		super.onClose();
		if (this.resolvePromise) {
			this.resolvePromise(null);
			this.resolvePromise = null;
		}
	}

	openAndGetValue(): Promise<TFolder | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}
}

export async function pickVaultFolder(app: App): Promise<TFolder | null> {
	return new FolderSuggestModal(app).openAndGetValue();
}
