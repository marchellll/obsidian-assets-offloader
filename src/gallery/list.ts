/** List YYYYMM prefixes / objects under the configured remote prefix. */
import type { ListedObject, S3Client } from '../s3/client';

export interface MonthPage {
	month: string;
	objects: ListedObject[];
}

export interface CatalogEntry {
	key: string;
	size: number;
	month: string;
}

export function monthFromKey(key: string, prefix: string): string | null {
	const p = prefix.replace(/^\/+|\/+$/g, '');
	const rest = p && key.startsWith(p + '/') ? key.slice(p.length + 1) : key;
	const m = rest.match(/^(\d{6})\//);
	return m?.[1] ?? null;
}

/** Month from any `…/YYYYMM/…` key (no prefix needed). */
export function monthFromAssetKey(key: string): string | null {
	const m = key.match(/(?:^|\/)(\d{6})\//);
	return m?.[1] ?? null;
}

/** Discover YYYYMM prefixes under settings prefix (delimiter list). */
export async function listMonths(client: S3Client, prefix: string): Promise<string[]> {
	const p = prefix.replace(/^\/+|\/+$/g, '');
	const listPrefix = p ? `${p}/` : '';
	const months = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await client.list({
			prefix: listPrefix,
			delimiter: '/',
			limit: 1000,
			cursor,
		});
		for (const pref of page.prefixes ?? []) {
			const rel = listPrefix ? pref.slice(listPrefix.length) : pref;
			const m = rel.match(/^(\d{6})\/?$/);
			if (m?.[1]) months.add(m[1]);
		}
		// also scan keys if provider ignores delimiter
		for (const item of page.items) {
			const mo = monthFromKey(item.key, p);
			if (mo) months.add(mo);
		}
		cursor = page.cursor;
	} while (cursor);

	return [...months].sort((a, b) => b.localeCompare(a));
}

export async function listMonthObjects(
	client: S3Client,
	prefix: string,
	month: string,
): Promise<ListedObject[]> {
	const p = prefix.replace(/^\/+|\/+$/g, '');
	const listPrefix = p ? `${p}/${month}/` : `${month}/`;
	const items: ListedObject[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.list({ prefix: listPrefix, limit: 1000, cursor });
		items.push(...page.items);
		cursor = page.cursor;
	} while (cursor);
	// newest first: key descending (uuidv7 sorts by time)
	items.sort((a, b) => b.key.localeCompare(a.key));
	return items;
}

/**
 * List every object under the prefix whose path has a YYYYMM segment.
 * Newest month first; within a month, key descending.
 */
export async function listAllAssets(client: S3Client, prefix: string): Promise<CatalogEntry[]> {
	const p = prefix.replace(/^\/+|\/+$/g, '');
	const listPrefix = p ? `${p}/` : '';
	const raw: ListedObject[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.list({ prefix: listPrefix, limit: 1000, cursor });
		raw.push(...page.items);
		cursor = page.cursor;
	} while (cursor);

	const entries: CatalogEntry[] = [];
	for (const item of raw) {
		const month = monthFromKey(item.key, p);
		if (!month) continue;
		entries.push({ key: item.key, size: item.size, month });
	}
	entries.sort((a, b) => {
		const mc = b.month.localeCompare(a.month);
		if (mc !== 0) return mc;
		return b.key.localeCompare(a.key);
	});
	return entries;
}
