/**
 * Remote asset gallery ItemView + ribbon registration.
 * Months from S3 prefixes; first paint last 5 non-empty; scroll loads older;
 * IntersectionObserver creates media when a cell nears the viewport.
 * Cells support multi-select + bulk delete.
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
import { pickVaultFolder } from '../ui/folder-suggest-modal';
import { openMediaPreview } from '../ui/media-preview-modal';
import { JobProgress } from '../ui/job-progress';
import { parseAssetRefs } from '../links/parse';
import { persistLinkRewrite } from '../links/persist';
import { basenameOf, formatLocalLink, rewriteTargets } from '../links/rewrite';
import { sameChecksum } from '../links/checksum';

export const GALLERY_VIEW_TYPE = 'assets-offloader-gallery';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg']);

interface GalleryEntry {
	obj: ListedObject;
	url: string;
	cell: HTMLElement;
	check: HTMLInputElement;
	month: string;
}

function extOf(key: string): string {
	return (key.split('.').pop() ?? '').toLowerCase();
}

export class GalleryView extends ItemView {
	plugin: AssetsOffloaderPlugin;
	private months: string[] = [];
	private loadedCount = 0;
	private client: S3Client | null = null;
	private toolbarEl!: HTMLElement;
	private selectInfoEl!: HTMLElement;
	private deleteBtn!: HTMLButtonElement;
	private gridEl!: HTMLElement;
	private observer: IntersectionObserver | null = null;
	/** key → entry for every rendered cell */
	private entries = new Map<string, GalleryEntry>();
	/** currently checked keys */
	private selected = new Set<string>();
	/** month → object keys in that month (loaded cells only) */
	private monthKeys = new Map<string, Set<string>>();
	/** month → header checkbox */
	private monthChecks = new Map<string, HTMLInputElement>();

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

		this.toolbarEl = contentEl.createDiv({ cls: 'assets-offloader-gallery-toolbar' });
		this.selectInfoEl = this.toolbarEl.createSpan({
			cls: 'assets-offloader-gallery-select-info',
		});
		const actions = this.toolbarEl.createDiv({ cls: 'assets-offloader-gallery-toolbar-actions' });

		const selectAllBtn = actions.createEl('button', {
			cls: 'mod-muted',
			text: t('gallery.selectAll'),
		});
		selectAllBtn.addEventListener('click', () => this.selectAllVisible());

		const clearBtn = actions.createEl('button', {
			cls: 'mod-muted',
			text: t('gallery.clearSelection'),
		});
		clearBtn.addEventListener('click', () => this.clearSelection());

		this.deleteBtn = actions.createEl('button', {
			cls: 'mod-warning',
			text: t('gallery.deleteSelected'),
		});
		this.deleteBtn.disabled = true;
		this.deleteBtn.addEventListener('click', () => {
			void this.deleteSelected();
		});

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

		this.updateSelectionUi();
		await this.reload();
	}

	async onClose(): Promise<void> {
		this.observer?.disconnect();
		this.observer = null;
		this.entries.clear();
		this.selected.clear();
		this.monthKeys.clear();
		this.monthChecks.clear();
	}

	private updateSelectionUi(): void {
		const n = this.selected.size;
		this.selectInfoEl.setText(
			n === 0 ? t('gallery.selectedNone') : t('gallery.selectedCount', { n }),
		);
		this.deleteBtn.disabled = n === 0;
		this.deleteBtn.setText(
			n === 0 ? t('gallery.deleteSelected') : t('gallery.deleteSelectedN', { n }),
		);
	}

	/** Checked only when every asset in the month is selected; otherwise unchecked. */
	private syncMonthCheck(month: string): void {
		const keys = this.monthKeys.get(month);
		const check = this.monthChecks.get(month);
		if (!keys || !check) return;
		let selectedCount = 0;
		for (const key of keys) {
			if (this.selected.has(key)) selectedCount++;
		}
		check.indeterminate = false;
		check.checked = keys.size > 0 && selectedCount === keys.size;
	}

	private syncAllMonthChecks(): void {
		for (const month of this.monthKeys.keys()) {
			this.syncMonthCheck(month);
		}
	}

	private applySelected(key: string, on: boolean): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		if (on) {
			this.selected.add(key);
			entry.cell.addClass('is-selected');
			entry.check.checked = true;
		} else {
			this.selected.delete(key);
			entry.cell.removeClass('is-selected');
			entry.check.checked = false;
		}
	}

	private setSelected(key: string, on: boolean): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.applySelected(key, on);
		this.updateSelectionUi();
		this.syncMonthCheck(entry.month);
	}

	private setMonthSelected(month: string, on: boolean): void {
		const keys = this.monthKeys.get(month);
		if (!keys) return;
		for (const key of keys) {
			this.applySelected(key, on);
		}
		this.updateSelectionUi();
		this.syncMonthCheck(month);
	}

	private selectAllVisible(): void {
		for (const key of this.entries.keys()) {
			this.applySelected(key, true);
		}
		this.updateSelectionUi();
		this.syncAllMonthChecks();
	}

	private clearSelection(): void {
		for (const key of [...this.selected]) {
			this.applySelected(key, false);
		}
		this.updateSelectionUi();
		this.syncAllMonthChecks();
	}

	private removeEntry(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.selected.delete(key);
		this.entries.delete(key);
		this.monthKeys.get(entry.month)?.delete(key);
		entry.cell.remove();
		this.syncMonthCheck(entry.month);
		this.updateSelectionUi();
	}

	private async reload(): Promise<void> {
		this.clearSelection();
		this.entries.clear();
		this.monthKeys.clear();
		this.monthChecks.clear();
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
			const header = this.gridEl.createDiv({ cls: 'assets-offloader-month' });
			const monthCheck = header.createEl('input', {
				cls: 'assets-offloader-month-check',
				type: 'checkbox',
				attr: { 'aria-label': t('gallery.selectMonth', { month }) },
			});
			header.createSpan({ text: month, cls: 'assets-offloader-month-label' });
			this.monthChecks.set(month, monthCheck);
			this.monthKeys.set(month, new Set());
			monthCheck.addEventListener('change', () => {
				this.setMonthSelected(month, monthCheck.checked);
			});

			const objects = await listMonthObjects(this.client, this.plugin.settings.prefix, month);
			for (const obj of objects) {
				this.renderCell(obj, month);
			}
			this.syncMonthCheck(month);
		}
		loading.remove();
		this.loadedCount = end;
	}

	private renderCell(obj: ListedObject, month: string): void {
		if (!this.client) return;
		const url = this.client.publicUrl(obj.key);
		const ext = extOf(obj.key);
		const cell = this.gridEl.createDiv({ cls: 'assets-offloader-cell' });

		const check = cell.createEl('input', {
			cls: 'assets-offloader-cell-check',
			type: 'checkbox',
			attr: { 'aria-label': t('gallery.select') },
		});
		check.addEventListener('click', (evt) => evt.stopPropagation());
		check.addEventListener('change', () => {
			this.setSelected(obj.key, check.checked);
		});

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

		this.entries.set(obj.key, { obj, url, cell, check, month });
		this.monthKeys.get(month)?.add(obj.key);

		if (kind === 'image' || kind === 'video' || kind === 'audio') {
			cell.addClass('assets-offloader-cell-previewable');
			cell.addEventListener('click', (evt) => {
				if (evt.target instanceof Element && evt.target.closest('.assets-offloader-cell-check')) {
					return;
				}
				// Shift/meta/ctrl+click toggles selection instead of preview.
				if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
					evt.preventDefault();
					this.setSelected(obj.key, !this.selected.has(obj.key));
					return;
				}
				if (
					kind !== 'image' &&
					evt.target instanceof Element &&
					(evt.target.closest('video') || evt.target.closest('audio'))
				) {
					return;
				}
				openMediaPreview(this.app, url, kind, name);
			});
		} else {
			cell.addEventListener('click', (evt) => {
				if (evt.target instanceof Element && evt.target.closest('.assets-offloader-cell-check')) {
					return;
				}
				if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
					this.setSelected(obj.key, !this.selected.has(obj.key));
				}
			});
		}

		cell.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			const menu = new Menu();
			if (kind === 'image' || kind === 'video' || kind === 'audio') {
				menu.addItem((item) =>
					item.setTitle(t('gallery.preview')).setIcon('maximize').onClick(() => {
						openMediaPreview(this.app, url, kind, name);
					}),
				);
			}
			menu.addItem((item) =>
				item
					.setTitle(
						this.selected.has(obj.key)
							? t('gallery.deselect')
							: t('gallery.select'),
					)
					.setIcon('check-square')
					.onClick(() => {
						this.setSelected(obj.key, !this.selected.has(obj.key));
					}),
			);
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
		try {
			let dest: string;
			let folderPath = '';

			if (rewriteNotes) {
				const active = this.app.workspace.getActiveFile();
				dest = await this.app.fileManager.getAvailablePathForAttachment(
					name,
					active?.path,
				);
				folderPath = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '';
			} else {
				const folder = await pickVaultFolder(this.app);
				if (!folder) {
					new Notice(t('gallery.downloadCancelled'));
					return;
				}
				folderPath = folder.path;
				dest = this.nextAvailableInFolder(folderPath, name);
			}

			const bytes = await this.client.get(obj.key);
			const exact = folderPath ? `${folderPath}/${name}` : name;
			const existing = this.app.vault.getAbstractFileByPath(exact);
			let finalPath = dest;

			if (existing instanceof TFile) {
				const existingBytes = new Uint8Array(await this.app.vault.readBinary(existing));
				if (await sameChecksum(existingBytes, bytes)) {
					finalPath = existing.path;
				} else if (rewriteNotes) {
					new Notice(`Conflict: ${existing.path}`);
					return;
				} else {
					await this.app.vault.createBinary(dest, bytes.buffer as ArrayBuffer);
					finalPath = dest;
				}
			} else {
				await this.app.vault.createBinary(dest, bytes.buffer as ArrayBuffer);
				finalPath = dest;
			}

			if (rewriteNotes) {
				const style = this.plugin.settings.localizedLinkStyle;
				const notes = await findNotesUsingUrl(this.app, url);
				const linkName =
					style === 'wikilink'
						? (finalPath.split('/').pop() ?? finalPath)
						: finalPath;
				const needle = style === 'wikilink' ? linkName : finalPath;
				for (const path of notes) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) continue;
					const persisted = await persistLinkRewrite(
						this.app,
						file,
						(data) =>
							rewriteTargets(
								data,
								parseAssetRefs(data),
								(ref) => ref.isRemote && ref.target === url,
								(ref) => formatLocalLink(ref, linkName, style, basenameOf(url)),
							),
						needle,
					);
					if (!persisted.ok) {
						new Notice(`${path}: ${persisted.reason}`);
					}
				}
			}
			new Notice(t('gallery.downloadSaved', { path: finalPath }));
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	/** Unique path under folder (name, name 1.ext, …). */
	private nextAvailableInFolder(folderPath: string, fileName: string): string {
		const dot = fileName.lastIndexOf('.');
		const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
		const ext = dot > 0 ? fileName.slice(dot) : '';
		let n = 0;
		for (;;) {
			const candidateName = n === 0 ? `${stem}${ext}` : `${stem} ${n}${ext}`;
			const path = folderPath ? `${folderPath}/${candidateName}` : candidateName;
			if (!this.app.vault.getAbstractFileByPath(path)) return path;
			n++;
		}
	}

	private async deleteObject(obj: ListedObject, url: string, _cell: HTMLElement): Promise<void> {
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
			this.removeEntry(obj.key);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async deleteSelected(): Promise<void> {
		if (!this.client || this.selected.size === 0) return;
		const keys = [...this.selected];
		const items = keys
			.map((k) => this.entries.get(k))
			.filter((e): e is GalleryEntry => !!e);

		const usedNotes = new Set<string>();
		for (const entry of items) {
			const usage = await findNotesUsingUrl(this.app, entry.url);
			for (const p of usage) usedNotes.add(p);
		}
		if (usedNotes.size > 0) {
			showUsage(this.app, [...usedNotes]);
			const ok = await confirm(
				this.app,
				t('modal.confirmBulkDeleteUsed', { n: items.length, m: usedNotes.size }),
			);
			if (!ok) return;
		} else {
			const ok = await confirm(
				this.app,
				t('modal.confirmBulkDelete', { n: items.length }),
			);
			if (!ok) return;
		}

		const progress = new JobProgress(
			this.plugin,
			items.length,
			'progress.delete',
			this.plugin.settings.progressCorner,
		);
		let failed = 0;
		try {
			for (const entry of items) {
				progress.setCurrent(entry.obj.key.split('/').pop() ?? entry.obj.key);
				try {
					await this.client.delete(entry.obj.key);
					this.removeEntry(entry.obj.key);
				} catch (e) {
					failed++;
					new Notice(e instanceof Error ? e.message : String(e));
				} finally {
					progress.tick();
				}
			}
		} finally {
			progress.finish();
		}
		this.updateSelectionUi();
		new Notice(
			t('gallery.bulkDeleteDone', {
				n: items.length - failed,
				k: failed,
			}),
		);
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
