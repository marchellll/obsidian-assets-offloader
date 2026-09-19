import { describe, expect, it } from 'vitest';
import { registerCommands } from '../src/commands/register';
import type AssetsOffloaderPlugin from '../src/main';

describe('registerCommands', () => {
	it('keeps existing folder IDs and adds recursive IDs', () => {
		const ids: string[] = [];
		const plugin = {
			addCommand: (cmd: { id: string }) => {
				ids.push(cmd.id);
			},
			app: {},
			settings: {},
		} as unknown as AssetsOffloaderPlugin;

		registerCommands(plugin);

		expect(ids).toContain('upload-folder-assets');
		expect(ids).toContain('localize-folder-assets');
		expect(ids).toContain('upload-folder-assets-recursive');
		expect(ids).toContain('localize-folder-assets-recursive');
	});
});
