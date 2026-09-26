/**
 * Remote asset gallery ItemView + ribbon registration.
 * Loads a full key catalog once; list view is default (no media bytes).
 * Grid lazily creates media via IntersectionObserver. Local fuzzy search on basename.
 */
import {
	ItemView,
	Menu,
	Notice,
	TFile,
	WorkspaceLeaf,
	prepareFuzzySearch,
	renderResults,
	setIcon,
} from 'obsidian';
import type AssetsOffloaderPlugin from '../main';
import { t } from '../i18n';
import { createClient, type ListedObject, type S3Client } from '../s3/client';
import { hasSecretStorage } from '../settings';
import { listAllAssets, type CatalogEntry } from './list';
import {
	GalleryCatalog,
	PAGE_SIZE,
	basenameOfKey,
	clearCatalogSpill,
	formatByteSize,
} from './catalog';
import type { RankedHit } from './search';
import { findNotesUsingUrl } from './usage';
import { showUsage } from '../ui/usage-modal';
import { confirm } from '../ui/confirm-modal';
import { pickVaultFolder } from '../ui/folder-suggest-modal';
import { openMediaPreview } from '../ui/media-preview-modal';
import { JobProgress } from '../ui/job-progress';
import { runExclusive } from '../job-lock';
import { parseAssetRefs } from '../links/parse';
import { persistLinkRewrite } from '../links/persist';
import { basenameOf, formatLocalLink, rewriteTargets } from '../links/rewrite';
import { sameChecksum } from '../links/checksum';

export const GALLERY_VIEW_TYPE = 'assets-offloader-gallery';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg']);

type ViewMode = 'list' | 'grid';

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

function mediaKind(ext: string): 'image' | 'video' | 'audio' | 'other' {
	if (IMAGE_EXT.has(ext)) return 'image';
	if (VIDEO_EXT.has(ext)) return 'video';
	if (AUDIO_EXT.has(ext)) return 'audio';
	return 'other';
}

export class GalleryView extends ItemView {
	plugin: AssetsOffloaderPlugin;
	private client: S3Client | null = null;
	private catalog: GalleryCatalog | null = null;
	private viewMode: ViewMode = 'list';
	private searchQuery = '';
	private visibleCount = PAGE_SIZE;
	private searchTimer: number | null = null;
	private renderToken = 0;

	private toolbarEl!: HTMLElement;
	private selectInfoEl!: HTMLElement;
	private deleteBtn!: HTMLButtonElement;
	private searchInput!: HTMLInputElement;
	private listBtn!: HTMLButtonElement;
	private gridBtn!: HTMLButtonElement;
	private itemsEl!: HTMLElement;
	private observer: IntersectionObserver | null = null;

	/** key → entry for every rendered row/cell */
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

		this.searchInput = this.toolbarEl.createEl('input', {
			cls: 'assets-offloader-gallery-search',
			type: 'search',
			attr: {
				placeholder: t('gallery.searchPlaceholder'),
				'aria-label': t('gallery.searchPlaceholder'),
			},
		});
		this.searchInput.addEventListener('input', () => {
			if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() => {
				this.searchTimer = null;
				this.searchQuery = this.searchInput.value;
				this.visibleCount = PAGE_SIZE;
				void this.renderFromCatalog();
			}, 200);
		});

		const viewToggle = this.toolbarEl.createDiv({
			cls: 'assets-offloader-gallery-view-toggle',
		});
		this.listBtn = viewToggle.createEl('button', {
			cls: 'clickable-icon',
			attr: { 'aria-label': t('gallery.listView'), type: 'button' },
		});
		setIcon(this.listBtn, 'list');
		this.listBtn.addEventListener('click', () => this.setViewMode('list'));

		this.gridBtn = viewToggle.createEl('button', {
			cls: 'clickable-icon',
			attr: { 'aria-label': t('gallery.gridView'), type: 'button' },
		});
		setIcon(this.gridBtn, 'layout-grid');
		this.gridBtn.addEventListener('click', () => this.setViewMode('grid'));

		this.selectInfoEl = this.toolbarEl.createSpan({
			cls: 'assets-offloader-gallery-select-info',
		});
		const actions = this.toolbarEl.createDiv({
			cls: 'assets-offloader-gallery-toolbar-actions',
		});

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

		this.itemsEl = contentEl.createDiv({ cls: 'assets-offloader-gallery-items' });
		this.syncViewModeUi();
		this.resetObserver();
		this.updateSelectionUi();
		await this.reload();
	}

	private resetObserver(): void {
		this.observer?.disconnect();
		this.observer = new IntersectionObserver(
			(obsEntries) => {
				for (const e of obsEntries) {
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
			{ root: this.contentEl, rootMargin: '200px' },
		);
	}

	async onClose(): Promise<void> {
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}
		this.observer?.disconnect();
		this.observer = null;
		this.entries.clear();
		this.selected.clear();
		this.monthKeys.clear();
		this.monthChecks.clear();
		await this.catalog?.clear();
		this.catalog = null;
	}

	private pluginDir(): string {
		return this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`;
	}

	private setViewMode(mode: ViewMode): void {
		if (this.viewMode === mode) return;
		this.viewMode = mode;
		this.syncViewModeUi();
		void this.renderFromCatalog();
	}

	private syncViewModeUi(): void {
		this.listBtn.toggleClass('is-active', this.viewMode === 'list');
		this.gridBtn.toggleClass('is-active', this.viewMode === 'grid');
		this.itemsEl.toggleClass('is-list', this.viewMode === 'list');
		this.itemsEl.toggleClass('is-grid', this.viewMode === 'grid');
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
		if (on) {
			this.selected.add(key);
			if (entry) {
				entry.cell.addClass('is-selected');
				entry.check.checked = true;
			}
		} else {
			this.selected.delete(key);
			if (entry) {
				entry.cell.removeClass('is-selected');
				entry.check.checked = false;
			}
		}
	}

	private setSelected(key: string, on: boolean): void {
		const entry = this.entries.get(key);
		this.applySelected(key, on);
		this.updateSelectionUi();
		if (entry) this.syncMonthCheck(entry.month);
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
		this.selected.delete(key);
		this.entries.delete(key);
		if (entry) {
			this.monthKeys.get(entry.month)?.delete(key);
			entry.cell.remove();
			this.syncMonthCheck(entry.month);
		}
		this.updateSelectionUi();
		void this.catalog?.remove(key);
	}

	private async reload(): Promise<void> {
		this.clearSelection();
		this.entries.clear();
		this.monthKeys.clear();
		this.monthChecks.clear();
		this.itemsEl.empty();
		this.client = null;
		this.visibleCount = PAGE_SIZE;
		this.viewMode = 'list';
		this.searchQuery = '';
		this.searchInput.value = '';
		this.syncViewModeUi();

		await this.catalog?.clear();
		this.catalog = null;

		if (!hasSecretStorage(this.app)) {
			this.itemsEl.createEl('p', { text: t('notices.noSecretStorage') });
			return;
		}

		const loading = this.itemsEl.createEl('p', { text: t('gallery.loading') });
		try {
			this.client = createClient(this.app, this.plugin.settings);
			const entries = await listAllAssets(this.client, this.plugin.settings.prefix);
			loading.remove();
			if (entries.length === 0) {
				this.itemsEl.createEl('p', { text: t('gallery.empty') });
				return;
			}
			this.catalog = new GalleryCatalog(this.app);
			await this.catalog.load(entries, this.pluginDir());
			await this.renderFromCatalog();
		} catch (e) {
			loading.remove();
			this.itemsEl.createEl('p', {
				text: e instanceof Error ? e.message : String(e),
			});
		}
	}

	private async renderFromCatalog(): Promise<void> {
		const catalog = this.catalog;
		const client = this.client;
		if (!catalog || !client) return;

		const token = ++this.renderToken;
		const page = await catalog.query(
			this.searchQuery,
			0,
			this.visibleCount,
			prepareFuzzySearch,
		);
		if (token !== this.renderToken) return;

		this.resetObserver();
		this.entries.clear();
		this.monthKeys.clear();
		this.monthChecks.clear();
		this.itemsEl.empty();

		const searching = this.searchQuery.trim().length > 0;
		if (page.total === 0) {
			this.itemsEl.createEl('p', {
				text: searching ? t('gallery.noMatches') : t('gallery.empty'),
			});
			this.updateSelectionUi();
			return;
		}

		let lastMonth = '';
		for (const hit of page.items) {
			if (!searching && hit.entry.month !== lastMonth) {
				lastMonth = hit.entry.month;
				this.renderMonthHeader(hit.entry.month);
			}
			if (this.viewMode === 'list') {
				this.renderListRow(hit, searching);
			} else {
				this.renderGridCell(hit, searching);
			}
		}

		this.syncAllMonthChecks();
		this.updateSelectionUi();

		if (page.items.length < page.total) {
			const more = this.itemsEl.createEl('button', {
				cls: 'assets-offloader-gallery-show-more mod-cta',
				text: t('gallery.showMore'),
			});
			more.addEventListener('click', () => {
				this.visibleCount += PAGE_SIZE;
				void this.renderFromCatalog();
			});
		}
	}

	private renderMonthHeader(month: string): void {
		const header = this.itemsEl.createDiv({ cls: 'assets-offloader-month' });
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
	}

	private bindSelectionAndMenu(
		cell: HTMLElement,
		check: HTMLInputElement,
		obj: ListedObject,
		url: string,
		kind: ReturnType<typeof mediaKind>,
		name: string,
	): void {
		check.addEventListener('click', (evt) => evt.stopPropagation());
		check.addEventListener('change', () => {
			this.setSelected(obj.key, check.checked);
		});

		if (kind === 'image' || kind === 'video' || kind === 'audio') {
			cell.addClass('assets-offloader-cell-previewable');
			cell.addEventListener('click', (evt) => {
				if (
					evt.target instanceof Element &&
					evt.target.closest('.assets-offloader-cell-check')
				) {
					return;
				}
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
				if (
					evt.target instanceof Element &&
					evt.target.closest('.assets-offloader-cell-check')
				) {
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
					item
						.setTitle(t('gallery.preview'))
						.setIcon('maximize')
						.onClick(() => {
							openMediaPreview(this.app, url, kind, name);
						}),
				);
			}
			menu.addItem((item) =>
				item
					.setTitle(
						this.selected.has(obj.key) ? t('gallery.deselect') : t('gallery.select'),
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
					void this.deleteObject(obj, url);
				}),
			);
			menu.showAtMouseEvent(evt);
		});
	}

	private registerEntry(
		entry: CatalogEntry,
		cell: HTMLElement,
		check: HTMLInputElement,
		url: string,
	): void {
		const obj: ListedObject = { key: entry.key, size: entry.size };
		this.entries.set(entry.key, { obj, url, cell, check, month: entry.month });
		this.monthKeys.get(entry.month)?.add(entry.key);
		if (this.selected.has(entry.key)) {
			cell.addClass('is-selected');
			check.checked = true;
		}
	}

	private renderListRow(hit: RankedHit<CatalogEntry>, searching: boolean): void {
		if (!this.client) return;
		const entry = hit.entry;
		const url = this.client.publicUrl(entry.key);
		const name = basenameOfKey(entry.key);
		const kind = mediaKind(extOf(entry.key));
		const cell = this.itemsEl.createDiv({ cls: 'assets-offloader-row' });

		const check = cell.createEl('input', {
			cls: 'assets-offloader-cell-check',
			type: 'checkbox',
			attr: { 'aria-label': t('gallery.select') },
		});

		const nameEl = cell.createDiv({ cls: 'assets-offloader-row-name' });
		if (searching && hit.matches.length > 0) {
			renderResults(nameEl, name, { score: hit.score, matches: hit.matches });
		} else {
			nameEl.setText(name);
		}

		cell.createDiv({
			cls: 'assets-offloader-row-size',
			text: formatByteSize(entry.size),
		});

		this.registerEntry(entry, cell, check, url);
		this.bindSelectionAndMenu(
			cell,
			check,
			{ key: entry.key, size: entry.size },
			url,
			kind,
			name,
		);
	}

	private renderGridCell(hit: RankedHit<CatalogEntry>, searching: boolean): void {
		if (!this.client) return;
		const entry = hit.entry;
		const url = this.client.publicUrl(entry.key);
		const name = basenameOfKey(entry.key);
		const kind = mediaKind(extOf(entry.key));
		const cell = this.itemsEl.createDiv({ cls: 'assets-offloader-cell' });

		const check = cell.createEl('input', {
			cls: 'assets-offloader-cell-check',
			type: 'checkbox',
			attr: { 'aria-label': t('gallery.select') },
		});

		const media = cell.createDiv({ cls: 'assets-offloader-media' });
		const caption = cell.createDiv({ cls: 'assets-offloader-caption' });
		if (searching && hit.matches.length > 0) {
			renderResults(caption, name, { score: hit.score, matches: hit.matches });
		} else {
			caption.setText(name);
		}

		if (kind === 'other') {
			media.createDiv({ text: extOf(entry.key) || 'file' });
		}
		media.dataset['src'] = url;
		media.dataset['kind'] = kind;
		if (kind !== 'other') this.observer?.observe(media);

		this.registerEntry(entry, cell, check, url);
		this.bindSelectionAndMenu(
			cell,
			check,
			{ key: entry.key, size: entry.size },
			url,
			kind,
			name,
		);
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
				dest = await this.app.fileManager.getAvailablePathForAttachment(name, active?.path);
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
					style === 'wikilink' ? (finalPath.split('/').pop() ?? finalPath) : finalPath;
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

	private async deleteObject(obj: ListedObject, _url: string): Promise<void> {
		await runExclusive(async () => {
			if (!this.client) return;
			const url = this.client.publicUrl(obj.key);
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
		});
	}

	private async deleteSelected(): Promise<void> {
		await runExclusive(async () => {
			const client = this.client;
			if (!client || this.selected.size === 0) return;
			const keys = [...this.selected];
			const items = keys.map((k) => {
				const e = this.entries.get(k);
				if (e) return { obj: e.obj, url: e.url };
				return { obj: { key: k, size: 0 }, url: client.publicUrl(k) };
			});

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
						await client.delete(entry.obj.key);
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
		});
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
	plugin.register(() => {
		void clearCatalogSpill(
			plugin.app,
			plugin.manifest.dir ?? `.obsidian/plugins/${plugin.manifest.id}`,
		);
	});
}
