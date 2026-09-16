import { describe, expect, it } from 'vitest';
import { isHttpUrl, normalizeHttpUrl } from '../src/s3/http-url';
import { buildPublicUrl } from '../src/s3/names';

describe('normalizeHttpUrl', () => {
	it('adds https to bare host', () => {
		expect(normalizeHttpUrl('testobsassets.marchell.xyz')).toBe(
			'https://testobsassets.marchell.xyz',
		);
	});

	it('keeps existing https and strips trailing slash', () => {
		expect(normalizeHttpUrl('https://cdn.example.com/')).toBe('https://cdn.example.com');
	});

	it('keeps path without trailing slash', () => {
		expect(normalizeHttpUrl('https://cdn.example.com/assets/')).toBe(
			'https://cdn.example.com/assets',
		);
	});

	it('rejects empty and garbage', () => {
		expect(normalizeHttpUrl('')).toBeNull();
		expect(normalizeHttpUrl('://')).toBeNull();
		expect(isHttpUrl('not a url')).toBe(false);
	});

	it('rejects non-http schemes', () => {
		expect(normalizeHttpUrl('ftp://cdn.example.com')).toBeNull();
	});
});

describe('buildPublicUrl', () => {
	it('normalizes bare public base', () => {
		expect(buildPublicUrl('testobsassets.marchell.xyz', '202609/a.png')).toBe(
			'https://testobsassets.marchell.xyz/202609/a.png',
		);
	});
});
