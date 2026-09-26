/**
 * Gallery filename catalog: memory until CATALOG_MEMORY_LIMIT, then spill to
 * plugin-folder JSON and drop the full array.
 */
import { normalizePath, type App } from 'obsidian';
import type { CatalogEntry } from './list';
import { monthFromAssetKey } from './list';
import { basenameOfKey, rankByBasename, type FuzzyScorer, type RankedHit } from './search';

/** ponytail: ~200 bytes/entry; raise or move to IndexedDB if vaults exceed this often. */
export const CATALOG_MEMORY_LIMIT = 20_000;

export const PAGE_SIZE = 500;

export const CATALOG_FILE_NAME = 'gallery-catalog.json';

type SpillPair = [string, number];

export interface CatalogPage {
	items: RankedHit<CatalogEntry>[];
	total: number;
}

export class GalleryCatalog {
	private items: CatalogEntry[] | null = null;
	private spilled = false;
	private spillPath: string | null = null;
	private totalCount = 0;
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	get size(): number {
		return this.totalCount;
	}

	get isSpilled(): boolean {
		return this.spilled;
	}

	/** Replace catalog. Spills to disk when above the memory limit. */
	async load(entries: CatalogEntry[], pluginDir: string): Promise<void> {
		await this.clear();
		this.totalCount = entries.length;
		const path = normalizePath(`${pluginDir.replace(/\/+$/, '')}/${CATALOG_FILE_NAME}`);
		this.spillPath = path;

		if (entries.length <= CATALOG_MEMORY_LIMIT) {
			this.items = entries;
			this.spilled = false;
			await this.removeSpillFile();
			return;
		}

		// ponytail: full-file rewrite; fine until catalogs get huge — then NDJSON + seek.
		const pairs: SpillPair[] = entries.map((e) => [e.key, e.size]);
		await this.app.vault.adapter.write(path, JSON.stringify(pairs));
		this.items = null;
		this.spilled = true;
	}

	async clear(): Promise<void> {
		this.items = null;
		this.spilled = false;
		this.totalCount = 0;
		await this.removeSpillFile();
		this.spillPath = null;
	}

	async remove(key: string): Promise<void> {
		if (this.totalCount === 0) return;
		const all = await this.readAll();
		const next = all.filter((e) => e.key !== key);
		if (next.length === all.length) return;
		const dir = this.spillPath ? this.spillPath.slice(0, this.spillPath.lastIndexOf('/')) : '';
		if (!dir) {
			this.items = next;
			this.totalCount = next.length;
			this.spilled = false;
			return;
		}
		await this.load(next, dir);
	}

	/**
	 * Browse or search. Empty query keeps catalog order; non-empty ranks by basename.
	 */
	async query(
		q: string,
		offset: number,
		limit: number,
		prepare: (query: string) => FuzzyScorer,
	): Promise<CatalogPage> {
		const all = await this.readAll();
		const ranked = rankByBasename(all, q, prepare);
		// After spill read, drop full array again when spilled (search/browse holds slice only).
		if (this.spilled) {
			this.items = null;
		}
		return {
			items: ranked.slice(offset, offset + limit),
			total: ranked.length,
		};
	}

	private async readAll(): Promise<CatalogEntry[]> {
		if (this.items) return this.items;
		if (!this.spilled || !this.spillPath) return [];
		const raw = await this.app.vault.adapter.read(this.spillPath);
		const pairs = JSON.parse(raw) as SpillPair[];
		const entries: CatalogEntry[] = [];
		for (const [key, size] of pairs) {
			const month = monthFromAssetKey(key);
			if (!month) continue;
			entries.push({ key, size, month });
		}
		return entries;
	}

	private async removeSpillFile(): Promise<void> {
		if (!this.spillPath) return;
		try {
			if (await this.app.vault.adapter.exists(this.spillPath)) {
				await this.app.vault.adapter.remove(this.spillPath);
			}
		} catch {
			// ignore missing / already gone
		}
	}
}

export function catalogSpillPath(pluginDir: string): string {
	return normalizePath(`${pluginDir.replace(/\/+$/, '')}/${CATALOG_FILE_NAME}`);
}

/** Best-effort delete of spill file (plugin unload). */
export async function clearCatalogSpill(app: App, pluginDir: string | undefined): Promise<void> {
	if (!pluginDir) return;
	const path = catalogSpillPath(pluginDir);
	try {
		if (await app.vault.adapter.exists(path)) {
			await app.vault.adapter.remove(path);
		}
	} catch {
		// ignore
	}
}

export function formatByteSize(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export { basenameOfKey };
