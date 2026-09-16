/**
 * Full-window media preview for gallery cells.
 * Images: wheel / buttons zoom, drag pan, Esc or backdrop closes.
 * Video / audio: native controls.
 */
import { App, Modal, setIcon } from 'obsidian';
import { t } from '../i18n';

export type PreviewKind = 'image' | 'video' | 'audio';

export function openMediaPreview(app: App, url: string, kind: PreviewKind, title?: string): void {
	new MediaPreviewModal(app, url, kind, title).open();
}

class MediaPreviewModal extends Modal {
	private scale = 1;
	private panX = 0;
	private panY = 0;
	private dragging = false;
	private lastX = 0;
	private lastY = 0;
	private imgEl: HTMLImageElement | null = null;
	private stageEl!: HTMLElement;

	constructor(
		app: App,
		private readonly url: string,
		private readonly kind: PreviewKind,
		private readonly title?: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('assets-offloader-preview-modal');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('assets-offloader-preview');

		const toolbar = contentEl.createDiv({ cls: 'assets-offloader-preview-toolbar' });
		toolbar.createSpan({
			cls: 'assets-offloader-preview-title',
			text: this.title ?? this.url.split('/').pop() ?? this.url,
		});
		const actions = toolbar.createDiv({ cls: 'assets-offloader-preview-actions' });

		if (this.kind === 'image') {
			this.addToolBtn(actions, 'zoom-out', t('gallery.zoomOut'), () => this.bumpZoom(0.8));
			this.addToolBtn(actions, 'zoom-in', t('gallery.zoomIn'), () => this.bumpZoom(1.25));
			this.addToolBtn(actions, 'maximize', t('gallery.zoomReset'), () => this.resetZoom());
		}
		this.addToolBtn(actions, 'external-link', t('gallery.openInTab'), () => {
			void this.openInTab();
		});
		this.addToolBtn(actions, 'x', t('gallery.closePreview'), () => this.close());

		this.stageEl = contentEl.createDiv({ cls: 'assets-offloader-preview-stage' });
		this.stageEl.addEventListener('click', (e) => {
			if (e.target === this.stageEl) this.close();
		});

		if (this.kind === 'image') {
			const img = this.stageEl.createEl('img', {
				cls: 'assets-offloader-preview-img',
				attr: { src: this.url, draggable: 'false' },
			});
			this.imgEl = img;
			img.addEventListener(
				'wheel',
				(e) => {
					e.preventDefault();
					this.bumpZoom(e.deltaY < 0 ? 1.1 : 0.9);
				},
				{ passive: false },
			);
			img.addEventListener('dblclick', () => {
				if (this.scale > 1.05) this.resetZoom();
				else this.bumpZoom(2 / this.scale);
			});
			img.addEventListener('pointerdown', (e) => {
				if (this.scale <= 1) return;
				this.dragging = true;
				this.lastX = e.clientX;
				this.lastY = e.clientY;
				img.setPointerCapture(e.pointerId);
			});
			img.addEventListener('pointermove', (e) => {
				if (!this.dragging) return;
				this.panX += e.clientX - this.lastX;
				this.panY += e.clientY - this.lastY;
				this.lastX = e.clientX;
				this.lastY = e.clientY;
				this.applyTransform();
			});
			img.addEventListener('pointerup', () => {
				this.dragging = false;
			});
			img.addEventListener('pointercancel', () => {
				this.dragging = false;
			});
		} else if (this.kind === 'video') {
			const v = this.stageEl.createEl('video', {
				cls: 'assets-offloader-preview-video',
				attr: { src: this.url, controls: 'true' },
			});
			v.autoplay = true;
		} else {
			const a = this.stageEl.createEl('audio', {
				cls: 'assets-offloader-preview-audio',
				attr: { src: this.url, controls: 'true' },
			});
			a.autoplay = true;
		}

		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private addToolBtn(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const btn = parent.createEl('button', {
			cls: 'clickable-icon',
			attr: { 'aria-label': label, type: 'button' },
		});
		setIcon(btn, icon);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
	}

	private bumpZoom(factor: number): void {
		this.scale = Math.min(8, Math.max(0.25, this.scale * factor));
		if (this.scale <= 1) {
			this.panX = 0;
			this.panY = 0;
		}
		this.applyTransform();
	}

	private resetZoom(): void {
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.applyTransform();
	}

	private applyTransform(): void {
		if (!this.imgEl) return;
		this.imgEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
		this.imgEl.style.cursor = this.scale > 1 ? 'grab' : 'zoom-in';
	}

	private async openInTab(): Promise<void> {
		try {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: 'webviewer',
				state: { url: this.url, navigate: true },
				active: true,
			});
			await this.app.workspace.revealLeaf(leaf);
		} catch {
			// Web Viewer core plugin may be off — fall back to OS/browser.
			window.open(this.url);
		}
		this.close();
	}
}
