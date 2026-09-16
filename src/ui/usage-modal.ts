import { App, Modal, Setting, TFile } from 'obsidian';
import { t } from '../i18n';

export class UsageModal extends Modal {
	constructor(
		app: App,
		private paths: string[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: t('modal.usageTitle') });
		if (this.paths.length === 0) {
			contentEl.createEl('p', { text: '(None)' });
		} else {
			const ul = contentEl.createEl('ul');
			for (const p of this.paths) {
				const li = ul.createEl('li');
				const a = li.createEl('a', { text: p, href: '#' });
				a.addEventListener('click', (e) => {
					e.preventDefault();
					const file = this.app.vault.getAbstractFileByPath(p);
					if (file instanceof TFile) {
						void this.app.workspace.getLeaf(false).openFile(file);
					}
					this.close();
				});
			}
		}
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(t('modal.close')).onClick(() => this.close()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function showUsage(app: App, paths: string[]): void {
	new UsageModal(app, paths).open();
}
