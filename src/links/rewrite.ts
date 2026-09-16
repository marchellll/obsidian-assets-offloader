/**
 * Format and splice link text.
 * Remote image embeds → markdown `![](url)`.
 * Remote video/audio embeds → HTML `<video>`/`<audio>` (Obsidian won't play ![](….mov)).
 * Local links follow setting (wiki/markdown).
 */
import type { LocalizedLinkStyle } from '../settings';
import type { AssetRef } from './parse';

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

/** Encode path for markdown destination; wrap <> if spaces or (). */
export function markdownDest(path: string): string {
	const encoded = path
		.split('/')
		.map((seg) => encodeURIComponent(decodeURIComponentSafe(seg)))
		.join('/');
	if (/[\s()]/.test(encoded) || /[\s()]/.test(path)) {
		const safe = path
			.split('/')
			.map((seg) => encodeURI(decodeURIComponentSafe(seg)))
			.join('/');
		if (/[\s()]/.test(safe)) return `<${safe}>`;
		return safe;
	}
	return encoded;
}

function decodeURIComponentSafe(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

export function extOfUrlOrPath(urlOrPath: string): string {
	try {
		if (/^https?:\/\//i.test(urlOrPath)) {
			const path = new URL(urlOrPath).pathname;
			const seg = path.split('/').pop() ?? '';
			const dot = seg.lastIndexOf('.');
			return dot >= 0 ? seg.slice(dot + 1).toLowerCase() : '';
		}
	} catch {
		/* fall through */
	}
	const base = urlOrPath.split(/[/\\]/).pop() ?? urlOrPath;
	const clean = base.split('?')[0] ?? base;
	const dot = clean.lastIndexOf('.');
	return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function escapeAttr(url: string): string {
	return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function formatRemoteLink(ref: Pick<AssetRef, 'embed' | 'alt'>, url: string): string {
	const alt = ref.alt || '';
	if (!ref.embed) {
		return `[${alt || url}](${url})`;
	}
	const ext = extOfUrlOrPath(url);
	// Obsidian plays remote video/audio via HTML, not ![](url) (gallery already does this).
	if (VIDEO_EXT.has(ext)) {
		return `<video controls src="${escapeAttr(url)}"></video>`;
	}
	if (AUDIO_EXT.has(ext)) {
		return `<audio controls src="${escapeAttr(url)}"></audio>`;
	}
	return `![${alt}](${url})`;
}

export function formatLocalLink(
	ref: Pick<AssetRef, 'embed' | 'alt'>,
	pathOrName: string,
	style: LocalizedLinkStyle,
	fallbackLabel: string,
): string {
	const label = ref.alt || fallbackLabel;
	if (style === 'wikilink') {
		const pipe = label && label !== pathOrName ? `|${label}` : '';
		return ref.embed ? `![[${pathOrName}${pipe}]]` : `[[${pathOrName}${pipe}]]`;
	}
	const dest = markdownDest(pathOrName);
	return ref.embed ? `![${label}](${dest})` : `[${label}](${dest})`;
}

/** Replace refs pointing at same target (by exact target string) with new text. End→start. */
export function rewriteTargets(
	markdown: string,
	refs: AssetRef[],
	shouldReplace: (ref: AssetRef) => boolean,
	replacement: (ref: AssetRef) => string,
): string {
	const sorted = [...refs].filter(shouldReplace).sort((a, b) => b.start - a.start);
	let out = markdown;
	for (const ref of sorted) {
		out = out.slice(0, ref.start) + replacement(ref) + out.slice(ref.end);
	}
	return out;
}

export function basenameOf(pathOrUrl: string): string {
	try {
		if (/^https?:\/\//i.test(pathOrUrl)) {
			const u = new URL(pathOrUrl);
			const seg = u.pathname.split('/').filter(Boolean).pop() ?? 'file';
			return decodeURIComponentSafe(seg);
		}
	} catch {
		/* fall through */
	}
	return pathOrUrl.split(/[/\\]/).pop() ?? pathOrUrl;
}
