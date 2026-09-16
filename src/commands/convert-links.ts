/** Command wrappers: rewrite note link syntax only (no upload/download). */
import { Notice } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { convertMarkdownToWiki, convertWikiToMarkdown } from '../links/convert';
import { activeMarkdown } from './upload';

export async function convertNoteWikiToMd(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	if (!note) {
		new Notice(t('notices.noActiveNote'));
		return;
	}
	const content = await plugin.app.vault.read(note);
	const next = convertWikiToMarkdown(content);
	if (next !== content) await plugin.app.vault.modify(note, next);
}

export async function convertNoteMdToWiki(plugin: AssetsOffloaderPlugin): Promise<void> {
	const note = activeMarkdown(plugin.app);
	if (!note) {
		new Notice(t('notices.noActiveNote'));
		return;
	}
	const content = await plugin.app.vault.read(note);
	const next = convertMarkdownToWiki(content);
	if (next !== content) await plugin.app.vault.modify(note, next);
}

export { convertWikiToMarkdown, convertMarkdownToWiki };
