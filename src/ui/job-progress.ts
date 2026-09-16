/**
 * LiveSync-style progress toast: ↑/↓ done (queued) current
 * Shown only while work remains; hidden when total is 0 or queue drains.
 * Corner from settings. See https://github.com/vrtmrz/obsidian-livesync
 */
import type { Plugin } from 'obsidian';
import { t } from '../i18n';
import type { ProgressCorner } from '../settings';

type ProgressKey = 'progress.upload' | 'progress.localize' | 'progress.delete';

export class JobProgress {
	private readonly el: HTMLElement | null;
	private done = 0;
	private total = 0;
	private current = '';
	private readonly key: ProgressKey;

	constructor(
		plugin: Plugin,
		total: number,
		key: ProgressKey = 'progress.upload',
		corner: ProgressCorner = 'bottom-right',
	) {
		this.total = Math.max(0, total);
		this.key = key;
		// No work → no toast.
		if (this.total === 0) {
			this.el = null;
			return;
		}
		this.el = plugin.app.workspace.containerEl.createDiv({
			cls: `assets-offloader-job-toast assets-offloader-job-toast-${corner}`,
		});
		this.render();
	}

	setCurrent(name: string): void {
		if (!this.el) return;
		this.current = name;
		this.render();
	}

	tick(): void {
		if (!this.el) return;
		this.done++;
		this.render();
	}

	finish(): void {
		this.el?.remove();
	}

	private remaining(): number {
		return Math.max(0, this.total - this.done);
	}

	private format(): string {
		const cur = this.current ? ` ${this.current}` : '';
		return t(this.key, {
			done: this.done,
			queued: this.remaining(),
			current: cur,
		});
	}

	private render(): void {
		if (!this.el) return;
		// Queue empty → hide immediately (finish() still removes the node).
		if (this.remaining() === 0) {
			this.el.hide();
			return;
		}
		this.el.show();
		this.el.setText(this.format());
	}
}
