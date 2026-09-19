/**
 * LiveSync-style progress toast: ↑/↓ done (queued) current
 * Shown while work remains or a preparing label is set; hidden when the queue drains.
 * Attached to document.body so workspace layout rebuilds (folder rewrite) cannot remove it.
 * Corner from settings. See https://github.com/vrtmrz/obsidian-livesync
 */
import type { Plugin } from 'obsidian';
import { t } from '../i18n';
import type { ProgressCorner } from '../settings';

type ProgressKey = 'progress.upload' | 'progress.localize' | 'progress.delete';

function toastParent(plugin: Plugin): HTMLElement {
	const doc = plugin.app.workspace.containerEl.doc ?? document;
	return doc.body;
}

export class JobProgress {
	private readonly el: HTMLElement;
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
		this.el = toastParent(plugin).createDiv({
			cls: `assets-offloader-job-toast assets-offloader-job-toast-${corner}`,
		});
		this.render();
	}

	/** Grow the queue (folder scan discovers assets note-by-note). */
	addToQueue(n: number): void {
		if (n <= 0) return;
		this.total += n;
		this.render();
	}

	setCurrent(name: string): void {
		this.current = name;
		this.render();
	}

	tick(): void {
		this.done++;
		this.render();
	}

	finish(): void {
		this.el.remove();
	}

	private remaining(): number {
		return Math.max(0, this.total - this.done);
	}

	private format(): string {
		if (this.total === 0 && this.done === 0) {
			return this.current || t('progress.scanning');
		}
		const cur = this.current ? ` ${this.current}` : '';
		return t(this.key, {
			done: this.done,
			queued: this.remaining(),
			current: cur,
		});
	}

	private render(): void {
		// Drained after work, or nothing to show yet (no total, no preparing label).
		if ((this.done > 0 && this.remaining() === 0) || (this.total === 0 && !this.current)) {
			this.el.hide();
			return;
		}
		this.el.show();
		this.el.setText(this.format());
	}
}
