/**
 * Find image/file embeds and links in note markdown (markdown + wikilink).
 * Offsets (start/end) support later rewrite without re-scanning blindly.
 */
export type LinkKind = 'markdown' | 'wikilink';

export interface AssetRef {
	kind: LinkKind;
	/** true if embed (!), false if link */
	embed: boolean;
	target: string;
	isRemote: boolean;
	alt: string;
	source: string;
	start: number;
	end: number;
}

const MD_EMBED_RE =
	/!\[(?<alt>[^\]]*)\]\(\s*<?(?<target>[^)\s>]+)>?(?:\s+(?<title>"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const MD_LINK_RE =
	/(?<!!)\[(?<alt>[^\]]*)\]\(\s*<?(?<target>[^)\s>]+)>?(?:\s+(?<title>"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const WIKI_EMBED_RE = /!\[\[(?<target>[^\]|]+)(?:\|(?<alt>[^\]]*))?\]\]/g;
const WIKI_LINK_RE = /(?<!!)\[\[(?<target>[^\]|]+)(?:\|(?<alt>[^\]]*))?\]\]/g;

function isRemote(target: string): boolean {
	return /^https?:\/\//i.test(target);
}

function pushMatch(out: AssetRef[], match: RegExpMatchArray, kind: LinkKind, embed: boolean): void {
	const groups = match.groups;
	const target = groups?.['target']?.trim();
	const source = match[0];
	if (!target || !source || match.index === undefined) return;
	out.push({
		kind,
		embed,
		target,
		isRemote: isRemote(target),
		alt: (groups?.['alt'] ?? '').trim(),
		source,
		start: match.index,
		end: match.index + source.length,
	});
}

/** Find image/file embeds and links (markdown + wikilink). */
export function parseAssetRefs(markdown: string): AssetRef[] {
	const candidates: AssetRef[] = [];
	for (const m of markdown.matchAll(MD_EMBED_RE)) {
		pushMatch(candidates, m, 'markdown', true);
	}
	for (const m of markdown.matchAll(MD_LINK_RE)) {
		// skip if already captured as embed (negative lookbehind fragile); filter overlaps later
		pushMatch(candidates, m, 'markdown', false);
	}
	for (const m of markdown.matchAll(WIKI_EMBED_RE)) {
		pushMatch(candidates, m, 'wikilink', true);
	}
	for (const m of markdown.matchAll(WIKI_LINK_RE)) {
		pushMatch(candidates, m, 'wikilink', false);
	}

	candidates.sort((a, b) => a.start - b.start);
	// drop nested / overlapping (prefer earlier / longer)
	const out: AssetRef[] = [];
	let lastEnd = -1;
	for (const c of candidates) {
		if (c.start < lastEnd) continue;
		out.push(c);
		lastEnd = c.end;
	}
	return out;
}
