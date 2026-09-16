/**
 * Wire command palette entries.
 * Command ids are stable — do not rename after release (see vision.md).
 */
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { uploadCurrentNote, uploadCurrentFolder } from './upload';
import { localizeCurrentNote, localizeCurrentFolder } from './localize';
import { convertNoteWikiToMd, convertNoteMdToWiki } from './convert-links';
import { GALLERY_VIEW_TYPE } from '../gallery/view';

export function registerCommands(plugin: AssetsOffloaderPlugin): void {
	plugin.addCommand({
		id: 'upload-note-assets',
		name: t('commands.uploadNote'),
		callback: () => void uploadCurrentNote(plugin),
	});
	plugin.addCommand({
		id: 'upload-folder-assets',
		name: t('commands.uploadFolder'),
		callback: () => void uploadCurrentFolder(plugin),
	});
	plugin.addCommand({
		id: 'localize-note-assets',
		name: t('commands.localizeNote'),
		callback: () => void localizeCurrentNote(plugin),
	});
	plugin.addCommand({
		id: 'localize-folder-assets',
		name: t('commands.localizeFolder'),
		callback: () => void localizeCurrentFolder(plugin),
	});
	plugin.addCommand({
		id: 'convert-note-wikilinks-to-markdown',
		name: t('commands.convertWikiToMd'),
		callback: () => void convertNoteWikiToMd(plugin),
	});
	plugin.addCommand({
		id: 'convert-note-markdown-to-wikilinks',
		name: t('commands.convertMdToWiki'),
		callback: () => void convertNoteMdToWiki(plugin),
	});
	plugin.addCommand({
		id: 'open-remote-asset-gallery',
		name: t('commands.openGallery'),
		callback: async () => {
			const leaf = plugin.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: GALLERY_VIEW_TYPE, active: true });
			await plugin.app.workspace.revealLeaf(leaf);
		},
	});
}
