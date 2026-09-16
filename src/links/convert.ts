/** Pure wiki ↔ markdown conversion (used by commands/convert-links.ts). */
import type { AssetRef } from './parse';
import { parseAssetRefs } from './parse';
import { basenameOf, formatLocalLink, formatRemoteLink, rewriteTargets } from './rewrite';

export function convertWikiToMarkdown(markdown: string): string {
	const refs = parseAssetRefs(markdown);
	return rewriteTargets(
		markdown,
		refs,
		(ref) => ref.kind === 'wikilink',
		(ref) => {
			if (ref.isRemote) {
				return formatRemoteLink(ref, ref.target);
			}
			return formatLocalLink(ref, ref.target, 'markdown', ref.alt || basenameOf(ref.target));
		},
	);
}

export function convertMarkdownToWiki(markdown: string): string {
	const refs = parseAssetRefs(markdown);
	return rewriteTargets(
		markdown,
		refs,
		(ref: AssetRef) => ref.kind === 'markdown' && !ref.isRemote,
		(ref) => formatLocalLink(ref, ref.target, 'wikilink', ref.alt || basenameOf(ref.target)),
	);
}
