/** Confirm / cancel modal. wait() resolves true only if user confirms. */
import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export class ConfirmModal extends Modal {
	private result: boolean | null = null;
	private resolve!: (v: boolean) => void;

	constructor(
		app: App,
		private message: string,
		private confirmLabel = t('modal.confirm'),
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: this.message });
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('modal.cancel')).onClick(() => {
					this.result = false;
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.confirmLabel)
					.setWarning()
					.onClick(() => {
						this.result = true;
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.result === true);
	}

	wait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}
}

export async function confirm(app: App, message: string): Promise<boolean> {
	return new ConfirmModal(app, message).wait();
}
