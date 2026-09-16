import { describe, expect, it } from 'vitest';
import { buildObjectKey, buildPublicUrl, sanitizeBasename, yyyymm } from '../src/s3/names';

describe('names', () => {
	it('sanitizes basename', () => {
		expect(sanitizeBasename('Hello World!')).toBe('Hello-World');
		expect(sanitizeBasename('@@@')).toBe('file');
		expect(sanitizeBasename('  a  b  ')).toBe('a-b');
	});

	it('builds monthly key', () => {
		const d = new Date(2026, 8, 16); // Sep 2026 local
		const key = buildObjectKey(
			'My Photo.PNG',
			'media',
			d,
			'01900000-0000-7000-8000-000000000001',
		);
		expect(key).toBe('media/202609/01900000-0000-7000-8000-000000000001-My-Photo.png');
		expect(yyyymm(d)).toBe('202609');
	});

	it('builds public URL with encoded segments', () => {
		expect(buildPublicUrl('https://cdn.example.com', 'a/b c/d')).toBe(
			'https://cdn.example.com/a/b%20c/d',
		);
	});

	it('adds https when public base lacks scheme', () => {
		expect(buildPublicUrl('cdn.example.com', 'x.png')).toBe('https://cdn.example.com/x.png');
	});
});
