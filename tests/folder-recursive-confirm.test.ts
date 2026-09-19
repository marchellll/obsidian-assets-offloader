import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFolder } from 'obsidian';
import type { App } from 'obsidian';

const confirmMock = vi.fn<(...args: unknown[]) => Promise<boolean>>();

vi.mock('../src/ui/confirm-modal', () => ({
	confirm: (...args: unknown[]): Promise<boolean> => confirmMock(...args),
}));

import { confirmRecursiveFolder } from '../src/commands/confirm-recursive';

describe('confirmRecursiveFolder', () => {
	const app = {} as App;
	const folder = new TFolder();
	folder.path = 'Projects/Alpha';

	beforeEach(() => {
		confirmMock.mockReset();
	});

	it('returns false when user cancels', async () => {
		confirmMock.mockResolvedValue(false);
		await expect(confirmRecursiveFolder(app, folder, 3, 'upload')).resolves.toBe(false);
		expect(confirmMock).toHaveBeenCalledOnce();
		const msg = confirmMock.mock.calls[0]?.[1];
		expect(typeof msg).toBe('string');
		expect(msg).toContain('Projects/Alpha');
		expect(msg).toContain('3');
		expect((msg as string).toLowerCase()).toContain('upload');
	});

	it('returns true when user confirms', async () => {
		confirmMock.mockResolvedValue(true);
		await expect(confirmRecursiveFolder(app, folder, 2, 'localize')).resolves.toBe(true);
		const msg = confirmMock.mock.calls[0]?.[1];
		expect(typeof msg).toBe('string');
		expect((msg as string).toLowerCase()).toContain('localize');
	});

	it('uses / for vault root path', async () => {
		confirmMock.mockResolvedValue(true);
		const root = new TFolder();
		root.path = '';
		await confirmRecursiveFolder(app, root, 10, 'upload');
		const msg = confirmMock.mock.calls[0]?.[1];
		expect(typeof msg).toBe('string');
		expect(msg).toContain('"/"');
	});
});
