import { describe, expect, it } from 'vitest';
import type { Plugin } from 'obsidian';
import { JobProgress } from '../src/ui/job-progress';
import { t } from '../src/i18n';

type FakeEl = {
	hidden: boolean;
	text: string;
	removed: boolean;
	hide(): void;
	show(): void;
	setText(s: string): void;
	remove(): void;
};

function fakeEl(): FakeEl {
	return {
		hidden: false,
		text: '',
		removed: false,
		hide() {
			this.hidden = true;
		},
		show() {
			this.hidden = false;
		},
		setText(s: string) {
			this.text = s;
		},
		remove() {
			this.removed = true;
		},
	};
}

function pluginWithToast(): { plugin: Plugin; el: FakeEl } {
	const el = fakeEl();
	const plugin = {
		app: {
			workspace: {
				containerEl: {
					doc: {
						body: {
							createDiv: () => el,
						},
					},
				},
			},
		},
	} as unknown as Plugin;
	return { plugin, el };
}

describe('JobProgress', () => {
	it('shows a preparing label at total 0 so folder scan is not silent', () => {
		const { plugin, el } = pluginWithToast();
		const progress = new JobProgress(plugin, 0, 'progress.upload');
		expect(el.hidden).toBe(true);

		progress.setCurrent(t('progress.scanning'));
		expect(el.hidden).toBe(false);
		expect(el.text).toBe(t('progress.scanning'));

		progress.addToQueue(2);
		expect(el.text).toBe(
			t('progress.upload', { done: 0, queued: 2, current: ` ${t('progress.scanning')}` }),
		);

		progress.setCurrent('a.png');
		progress.tick();
		expect(el.text).toBe(t('progress.upload', { done: 1, queued: 1, current: ' a.png' }));

		progress.tick();
		expect(el.hidden).toBe(true);

		progress.finish();
		expect(el.removed).toBe(true);
	});
});
