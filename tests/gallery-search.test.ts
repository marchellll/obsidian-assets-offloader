import { describe, expect, it } from 'vitest';
import { rankByBasename, type FuzzyScorer } from '../src/gallery/search';
import { monthFromAssetKey, monthFromKey } from '../src/gallery/list';
import { formatByteSize } from '../src/gallery/catalog';

describe('rankByBasename', () => {
	const items = [
		{ key: 'media/202609/aaa-photo.png' },
		{ key: 'media/202609/bbb-report.pdf' },
		{ key: 'media/202608/ccc-photo-edit.png' },
	];

	it('keeps order when query is empty', () => {
		const ranked = rankByBasename(items, '  ', () => () => null);
		expect(ranked.map((h) => h.entry.key)).toEqual(items.map((i) => i.key));
		expect(ranked.every((h) => h.matches.length === 0)).toBe(true);
	});

	it('drops non-matches', () => {
		const prepare = (_q: string): FuzzyScorer => {
			return (text) => (text.includes('photo') ? { score: -10, matches: [[0, 1]] } : null);
		};
		const ranked = rankByBasename(items, 'photo', prepare);
		expect(ranked.map((h) => h.entry.key)).toEqual([
			'media/202608/ccc-photo-edit.png',
			'media/202609/aaa-photo.png',
		]);
	});

	it('orders higher score first', () => {
		const prepare = (_q: string): FuzzyScorer => {
			return (text) => {
				if (text.includes('edit')) return { score: -1, matches: [[0, 1]] };
				if (text.includes('photo')) return { score: -20, matches: [[0, 1]] };
				return null;
			};
		};
		const ranked = rankByBasename(items, 'ph', prepare);
		expect(ranked[0]?.entry.key).toBe('media/202608/ccc-photo-edit.png');
		expect(ranked[1]?.entry.key).toBe('media/202609/aaa-photo.png');
	});
});

describe('month helpers', () => {
	it('monthFromKey respects prefix', () => {
		expect(monthFromKey('media/202609/x.png', 'media')).toBe('202609');
		expect(monthFromKey('202609/x.png', '')).toBe('202609');
		expect(monthFromKey('media/other.png', 'media')).toBeNull();
	});

	it('monthFromAssetKey finds YYYYMM segment', () => {
		expect(monthFromAssetKey('media/202609/x.png')).toBe('202609');
		expect(monthFromAssetKey('202609/x.png')).toBe('202609');
		expect(monthFromAssetKey('no-month/x.png')).toBeNull();
	});
});

describe('formatByteSize', () => {
	it('formats bytes', () => {
		expect(formatByteSize(500)).toBe('500 B');
		expect(formatByteSize(2048)).toBe('2.0 KB');
		expect(formatByteSize(2 * 1024 * 1024)).toBe('2.0 MB');
	});
});
