/** Collect markdown notes under a vault folder (one level or recursive). */
import { TFile, TFolder } from 'obsidian';

export function markdownNotesInFolder(folder: TFolder, recursive: boolean): TFile[] {
	const out: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			out.push(child);
		} else if (recursive && child instanceof TFolder) {
			out.push(...markdownNotesInFolder(child, true));
		}
	}
	return out;
}
