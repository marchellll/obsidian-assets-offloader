import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export class ListModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private lines: string[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });
		const pre = contentEl.createEl('pre');
		pre.setText(this.lines.join('\n'));
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText(t('modal.close')).onClick(() => this.close()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function showFailures(app: App, lines: string[]): void {
	new ListModal(app, t('modal.failuresTitle'), lines).open();
}

export function showConflicts(app: App, lines: string[]): void {
	new ListModal(app, t('modal.conflictsTitle'), lines).open();
}
