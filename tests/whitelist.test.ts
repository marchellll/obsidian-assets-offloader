import { describe, expect, it } from 'vitest';
import { matchesWhitelist } from '../src/s3/whitelist';

const list = `*.png
*.jpg
# comment
!secret.png
*.pdf`;

describe('whitelist', () => {
	it('matches extensions case-insensitive', () => {
		expect(matchesWhitelist('a.PNG', list)).toBe(true);
		expect(matchesWhitelist('folder/x.jpg', list)).toBe(true);
		expect(matchesWhitelist('a.txt', list)).toBe(false);
	});

	it('supports negation', () => {
		expect(matchesWhitelist('secret.png', list)).toBe(false);
	});

	it('matches pdf', () => {
		expect(matchesWhitelist('doc.pdf', list)).toBe(true);
	});
});
