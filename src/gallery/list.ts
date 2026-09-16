import type { ListedObject, S3Client } from '../s3/client';

export interface MonthPage {
	month: string;
	objects: ListedObject[];
}

function monthFromKey(key: string, prefix: string): string | null {
	const p = prefix.replace(/^\/+|\/+$/g, '');
	const rest = p && key.startsWith(p + '/') ? key.slice(p.length + 1) : key;
	const m = rest.match(/^(\d{6})\//);
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
