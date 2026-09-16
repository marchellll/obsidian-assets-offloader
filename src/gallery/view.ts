/**
 * Remote asset gallery ItemView + ribbon registration.
 * Months from S3 prefixes; first paint last 5 non-empty; scroll loads older;
 * IntersectionObserver creates media when a cell nears the viewport.
 */
import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { createClient, type ListedObject, type S3Client } from '../s3/client';
import { hasSecretStorage } from '../settings';
import { listMonthObjects, listMonths } from './list';
import { findNotesUsingUrl } from './usage';
import { showUsage } from '../ui/usage-modal';
import { confirm } from '../ui/confirm-modal';
import { parseAssetRefs } from '../links/parse';
import { basenameOf, formatLocalLink, rewriteTargets } from '../links/rewrite';
import { sameChecksum } from '../links/checksum';

export const GALLERY_VIEW_TYPE = 'assets-offloader-gallery';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg']);

function extOf(key: string): string {
	return (key.split('.').pop() ?? '').toLowerCase();
}

export class GalleryView extends ItemView {
	plugin: AssetsOffloaderPlugin;
	private months: string[] = [];
	private loadedCount = 0;
	private client: S3Client | null = null;
	private gridEl!: HTMLElement;
	private observer: IntersectionObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AssetsOffloaderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GALLERY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('ribbon.gallery');
	}

	getIcon(): string {
		return 'images';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('assets-offloader-gallery');
		this.gridEl = contentEl.createDiv({ cls: 'assets-offloader-gallery-grid' });
		contentEl.addEventListener('scroll', () => {
			if (contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 80) {
				void this.loadMore();
			}
		});

		this.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const el = e.target as HTMLElement;
					const url = el.dataset['src'];
					const kind = el.dataset['kind'];
					if (!url || el.dataset['loaded'] === '1') continue;
					el.dataset['loaded'] = '1';
					if (kind === 'image') {
						const img = el.createEl('img');
						img.src = url;
						img.loading = 'lazy';
					} else if (kind === 'video') {
						const v = el.createEl('video');
						v.src = url;
						v.muted = true;
						v.controls = true;
						v.preload = 'metadata';
					} else if (kind === 'audio') {
						const a = el.createEl('audio');
						a.src = url;
						a.controls = true;
					}
				}
			},
			{ root: contentEl, rootMargin: '200px' },
		);

		await this.reload();
	}

	async onClose(): Promise<void> {
		this.observer?.disconnect();
		this.observer = null;
	}

	private async reload(): Promise<void> {
		this.gridEl.empty();
		this.months = [];
		this.loadedCount = 0;
		this.client = null;

		if (!hasSecretStorage(this.app)) {
			this.gridEl.createEl('p', { text: t('notices.noSecretStorage') });
			return;
		}
		try {
			this.client = createClient(this.app, this.plugin.settings);
			this.months = await listMonths(this.client, this.plugin.settings.prefix);
		} catch (e) {
			this.gridEl.createEl('p', {
				text: e instanceof Error ? e.message : String(e),
			});
			return;
		}
		if (this.months.length === 0) {
			this.gridEl.createEl('p', { text: t('gallery.empty') });
			return;
		}
		await this.loadMore(5);
	}

	private async loadMore(count = 1): Promise<void> {
		if (!this.client) return;
		const end = Math.min(this.loadedCount + count, this.months.length);
		if (this.loadedCount >= end) return;
		const loading = this.gridEl.createEl('p', { text: t('gallery.loading') });
		for (let i = this.loadedCount; i < end; i++) {
			const month = this.months[i]!;
			const header = this.gridEl.createEl('h3', { text: month });
			header.addClass('assets-offloader-month');
			const objects = await listMonthObjects(this.client, this.plugin.settings.prefix, month);
			for (const obj of objects) {
				this.renderCell(obj);
			}
		}
		loading.remove();
		this.loadedCount = end;
	}

	private renderCell(obj: ListedObject): void {
		if (!this.client) return;
		const url = this.client.publicUrl(obj.key);
		if (
			!this.plugin.settings.publicUrlBase.trim() &&
			!this.plugin.settings.spacesCdnUrl.trim()
		) {
			// ponytail: v1 gallery thumbs need public base
		}
		const ext = extOf(obj.key);
		const cell = this.gridEl.createDiv({ cls: 'assets-offloader-cell' });
		const media = cell.createDiv({ cls: 'assets-offloader-media' });
		const name = obj.key.split('/').pop() ?? obj.key;
		cell.createDiv({ cls: 'assets-offloader-caption', text: name });

		let kind = 'other';
		if (IMAGE_EXT.has(ext)) kind = 'image';
		else if (VIDEO_EXT.has(ext)) kind = 'video';
		else if (AUDIO_EXT.has(ext)) kind = 'audio';
		else {
			media.createDiv({ text: ext || 'file' });
		}
		media.dataset['src'] = url;
		media.dataset['kind'] = kind;
		if (kind !== 'other') this.observer?.observe(media);

		cell.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle(t('gallery.findNotes')).onClick(() => {
					void findNotesUsingUrl(this.app, url).then((paths) =>
						showUsage(this.app, paths),
					);
				}),
			);
			menu.addItem((item) =>
				item.setTitle(t('gallery.download')).onClick(() => {
					void this.downloadObject(obj, url, false);
				}),
			);
			menu.addItem((item) =>
				item.setTitle(t('gallery.localize')).onClick(() => {
					void this.downloadObject(obj, url, true);
				}),
			);
			menu.addItem((item) =>
				item.setTitle(t('gallery.delete')).onClick(() => {
					void this.deleteObject(obj, url, cell);
				}),
			);
			menu.showAtMouseEvent(evt);
		});
	}

	private async downloadObject(
		obj: ListedObject,
		url: string,
		rewriteNotes: boolean,
	): Promise<void> {
		if (!this.client) return;
		const name = obj.key.split('/').pop() ?? 'file';
		const active = this.app.workspace.getActiveFile();
		const sourcePath = active?.path ?? '';
		try {
			const bytes = await this.client.get(obj.key);
			const dest = await this.app.fileManager.getAvailablePathForAttachment(
				name,
				sourcePath || undefined,
			);
			const parent = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '';
			const exact = parent ? `${parent}/${name}` : name;
			const existing = this.app.vault.getAbstractFileByPath(exact);
			let finalPath = dest;
			if (existing instanceof TFile) {
				const existingBytes = new Uint8Array(await this.app.vault.readBinary(existing));
				if (await sameChecksum(existingBytes, bytes)) {
					finalPath = existing.path;
				} else {
					new Notice(`Conflict: ${existing.path}`);
					return;
				}
			} else {
				await this.app.vault.createBinary(dest, bytes.buffer as ArrayBuffer);
				finalPath = dest;
			}

			if (rewriteNotes) {
				const style = this.plugin.settings.localizedLinkStyle;
				const notes = await findNotesUsingUrl(this.app, url);
				for (const path of notes) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) continue;
					const content = await this.app.vault.read(file);
					const refs = parseAssetRefs(content);
					const linkName =
						style === 'wikilink'
							? (finalPath.split('/').pop() ?? finalPath)
							: finalPath;
					const next = rewriteTargets(
						content,
						refs,
						(ref) => ref.isRemote && ref.target === url,
						(ref) => formatLocalLink(ref, linkName, style, basenameOf(url)),
					);
					if (next !== content) await this.app.vault.modify(file, next);
				}
			}
			new Notice(finalPath);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async deleteObject(obj: ListedObject, url: string, cell: HTMLElement): Promise<void> {
		if (!this.client) return;
		const usage = await findNotesUsingUrl(this.app, url);
		if (usage.length > 0) {
			showUsage(this.app, usage);
			const ok = await confirm(this.app, t('modal.confirmDeleteUsed'));
			if (!ok) return;
		} else {
			const ok = await confirm(this.app, t('modal.confirmDelete'));
			if (!ok) return;
		}
		try {
			await this.client.delete(obj.key);
			cell.remove();
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}
}

export function registerGallery(plugin: AssetsOffloaderPlugin): void {
	plugin.registerView(GALLERY_VIEW_TYPE, (leaf) => new GalleryView(leaf, plugin));
	plugin.addRibbonIcon('images', t('ribbon.gallery'), () => {
		void (async () => {
			const leaf = plugin.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: GALLERY_VIEW_TYPE, active: true });
			await plugin.app.workspace.revealLeaf(leaf);
		})();
	});
}
