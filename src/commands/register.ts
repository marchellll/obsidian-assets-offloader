/**
 * Wire command palette + editor context menu.
 * Command ids are stable — do not rename after release (see vision.md).
 */
import { Menu, TFile } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import {
	uploadCurrentNote,
	uploadCurrentFolder,
	uploadSingleFile,
	activeMarkdown,
	resolveLocal,
} from './upload';
import { localizeCurrentNote, localizeCurrentFolder } from './localize';
import { convertNoteWikiToMd, convertNoteMdToWiki } from './convert-links';
import { GALLERY_VIEW_TYPE } from '../gallery/view';
import { matchesWhitelist } from '../s3/whitelist';
import { parseAssetRefs } from '../links/parse';

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

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu, editor, info) => {
			const note = info.file ?? activeMarkdown(plugin.app);
			if (!(note instanceof TFile)) return;
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			addImageMenuItems(plugin, menu, note, line);
		}),
	);
}

function addImageMenuItems(
	plugin: AssetsOffloaderPlugin,
	menu: Menu,
	note: TFile,
	line: string,
): void {
	const refs = parseAssetRefs(line);
	if (refs.length === 0) return;
	const ref = refs[0]!;
	if (!ref.isRemote) {
		const file = resolveLocal(plugin.app, note, ref.target);
		if (file && matchesWhitelist(file.name, plugin.settings.whitelist)) {
			menu.addItem((item) => {
				item.setTitle(t('commands.uploadImage')).onClick(() => {
					void uploadSingleFile(plugin, note, file);
				});
			});
		}
	} else {
		menu.addItem((item) => {
			item.setTitle(t('commands.localizeImage')).onClick(() => {
				void localizeCurrentNote(plugin);
			});
		});
	}
}
