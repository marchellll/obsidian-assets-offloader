import { describe, expect, it } from 'vitest';
import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { markdownNotesInFolder } from '../src/commands/folder-notes';

function md(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
	f.extension = 'md';
	return f;
}

function png(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
	f.extension = 'png';
	return f;
}

function folder(path: string, children: TAbstractFile[]): TFolder {
	const f = new TFolder();
	f.path = path;
	f.children = children;
	return f;
}

describe('markdownNotesInFolder', () => {
	const nested = md('Projects/Alpha/drafts/nested.md');
	const drafts = folder('Projects/Alpha/drafts', [nested, png('Projects/Alpha/drafts/x.png')]);
	const top = md('Projects/Alpha/note.md');
	const empty = folder('Projects/Alpha/empty', []);
	const alpha = folder('Projects/Alpha', [top, drafts, empty, png('Projects/Alpha/pic.png')]);
	const sibling = md('Projects/Beta/other.md');
	const beta = folder('Projects/Beta', [sibling]);
	const projects = folder('Projects', [alpha, beta]);

	it('recursive false: only direct .md children', () => {
		const files = markdownNotesInFolder(alpha, false);
		expect(files.map((f) => f.path)).toEqual(['Projects/Alpha/note.md']);
	});

	it('recursive true: includes nested .md', () => {
		const files = markdownNotesInFolder(alpha, true);
		expect(files.map((f) => f.path).sort()).toEqual([
			'Projects/Alpha/drafts/nested.md',
			'Projects/Alpha/note.md',
		]);
	});

	it('ignores non-md files and empty folders', () => {
		const files = markdownNotesInFolder(alpha, true);
		expect(files.every((f) => f.extension === 'md')).toBe(true);
		expect(files.map((f) => f.path)).not.toContain('Projects/Alpha/pic.png');
	});

	it('does not include notes from sibling folders', () => {
		const files = markdownNotesInFolder(alpha, true);
		expect(files.map((f) => f.path)).not.toContain('Projects/Beta/other.md');
		const fromProjects = markdownNotesInFolder(projects, true);
		expect(fromProjects.map((f) => f.path).sort()).toEqual([
			'Projects/Alpha/drafts/nested.md',
			'Projects/Alpha/note.md',
			'Projects/Beta/other.md',
		]);
	});
});
