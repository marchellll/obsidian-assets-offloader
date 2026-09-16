import { describe, expect, it } from 'vitest';
import { parseAssetRefs } from '../src/links/parse';
import {
	formatLocalLink,
	formatRemoteLink,
	markdownDest,
	rewriteTargets,
} from '../src/links/rewrite';
import { convertMarkdownToWiki, convertWikiToMarkdown } from '../src/links/convert';
import { sameChecksum, sha256Hex } from '../src/links/checksum';
import { buildVariants, contentHasUrl } from '../src/gallery/usage';

describe('parseAssetRefs', () => {
	it('parses markdown and wiki embeds', () => {
		const md = '![a](img.png) and ![[other.jpg|cover]] and [f](doc.pdf)';
		const refs = parseAssetRefs(md);
		expect(refs).toHaveLength(3);
		expect(refs[0]).toMatchObject({
			embed: true,
			kind: 'markdown',
			target: 'img.png',
			isRemote: false,
		});
		expect(refs[1]).toMatchObject({
			kind: 'wikilink',
			target: 'other.jpg',
			alt: 'cover',
		});
		expect(refs[2]).toMatchObject({ embed: false, target: 'doc.pdf' });
	});

	it('detects remote', () => {
		const refs = parseAssetRefs('![](https://cdn.example.com/a.png)');
		expect(refs[0]?.isRemote).toBe(true);
	});
});

describe('rewrite', () => {
	it('formats remote images as markdown', () => {
		expect(formatRemoteLink({ embed: true, alt: 'x' }, 'https://a/b.png')).toBe(
			'![x](https://a/b.png)',
		);
	});

	it('formats remote video/audio embeds as HTML (Obsidian cannot play ![](….mov))', () => {
		expect(formatRemoteLink({ embed: true, alt: '' }, 'https://cdn.example.com/a.mov')).toBe(
			'<video controls src="https://cdn.example.com/a.mov"></video>',
		);
		expect(formatRemoteLink({ embed: true, alt: '' }, 'https://cdn.example.com/a.mp3')).toBe(
			'<audio controls src="https://cdn.example.com/a.mp3"></audio>',
		);
		expect(formatRemoteLink({ embed: false, alt: 'clip' }, 'https://cdn.example.com/a.mov')).toBe(
			'[clip](https://cdn.example.com/a.mov)',
		);
	});

	it('parses HTML media embeds', () => {
		const refs = parseAssetRefs(
			'<video controls src="https://cdn.example.com/a.mov"></video>',
		);
		expect(refs[0]).toMatchObject({
			kind: 'html',
			embed: true,
			isRemote: true,
			target: 'https://cdn.example.com/a.mov',
		});
	});

	it('formats local wikilink', () => {
		expect(formatLocalLink({ embed: true, alt: '' }, 'pic.png', 'wikilink', 'pic.png')).toBe(
			'![[pic.png]]',
		);
	});

	it('wraps unsafe markdown paths', () => {
		expect(markdownDest('folder/my file (1).png')).toMatch(/^</);
	});

	it('rewrites targets', () => {
		const md = 'before ![[a.png]] after';
		const refs = parseAssetRefs(md);
		const out = rewriteTargets(
			md,
			refs,
			(r) => r.target === 'a.png',
			() => '![a](https://cdn/x.png)',
		);
		expect(out).toBe('before ![a](https://cdn/x.png) after');
	});
});

describe('convert links', () => {
	it('wiki to markdown', () => {
		expect(convertWikiToMarkdown('![[a.png|alt]]')).toBe('![alt](a.png)');
	});

	it('markdown to wiki leaves remote', () => {
		const md = '![a](local.png) ![b](https://x/y.png)';
		const out = convertMarkdownToWiki(md);
		expect(out).toContain('![[local.png');
		expect(out).toContain('https://x/y.png');
	});
});

describe('checksum', () => {
	it('same bytes same hash', async () => {
		const a = new Uint8Array([1, 2, 3]);
		const b = new Uint8Array([1, 2, 3]);
		expect(await sameChecksum(a, b)).toBe(true);
		expect(await sha256Hex(a)).toHaveLength(64);
	});

	it('different bytes', async () => {
		expect(await sameChecksum(new Uint8Array([1]), new Uint8Array([2]))).toBe(false);
	});
});

describe('usage scan', () => {
	it('finds url in content', () => {
		const url = 'https://cdn.example.com/202609/a.png';
		const variants = buildVariants(url);
		expect(contentHasUrl(`![](${url})`, variants)).toBe(true);
		expect(contentHasUrl('nope', variants)).toBe(false);
	});
});
