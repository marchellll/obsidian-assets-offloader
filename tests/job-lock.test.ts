import { describe, expect, it } from 'vitest';
import { runExclusive } from '../src/job-lock';

describe('runExclusive', () => {
	it('rejects overlapping second run; unlocks after first finishes', async () => {
		let release!: () => void;
		const hold = new Promise<void>((r) => {
			release = r;
		});
		let firstEntered = false;
		const first = runExclusive(async () => {
			firstEntered = true;
			await hold;
		});
		expect(firstEntered).toBe(true);

		let secondRan = false;
		await runExclusive(async () => {
			secondRan = true;
		});
		expect(secondRan).toBe(false);

		release();
		await first;

		let thirdRan = false;
		await runExclusive(async () => {
			thirdRan = true;
		});
		expect(thirdRan).toBe(true);
	});
});
