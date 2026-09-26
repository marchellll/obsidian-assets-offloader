/** Basename fuzzy ranking for the gallery catalog (IDE-style file picker). */
import type { SearchMatches, SearchResult } from 'obsidian';

export type FuzzyScorer = (text: string) => SearchResult | null;

export interface RankedHit<T> {
	entry: T;
	score: number;
	matches: SearchMatches;
}

export function basenameOfKey(key: string): string {
	return key.split('/').pop() ?? key;
}

/**
 * Rank items by fuzzy match on basename.
 * Empty / whitespace query → keep input order with empty matches.
 * Non-empty → drop non-matches; higher score first.
 */
export function rankByBasename<T extends { key: string }>(
	items: readonly T[],
	query: string,
	prepare: (q: string) => FuzzyScorer,
): RankedHit<T>[] {
	const q = query.trim();
	if (!q) {
		return items.map((entry) => ({ entry, score: 0, matches: [] }));
	}
	const scorer = prepare(q);
	const out: RankedHit<T>[] = [];
	for (const entry of items) {
		const result = scorer(basenameOfKey(entry.key));
		if (!result) continue;
		out.push({ entry, score: result.score, matches: result.matches });
	}
	out.sort((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key));
	return out;
}
