import { describe, expect, it } from 'vitest';
import { mayTrashLocalAfterUpload } from '../src/links/persist';

describe('mayTrashLocalAfterUpload', () => {
	it('allows trash only when rewrite verified and nothing still links locally', () => {
		expect(
			mayTrashLocalAfterUpload({
				verifiedOnDisk: true,
				stillLinkedInNote: false,
				linkedElsewhere: false,
			}),
		).toBe(true);
		expect(
			mayTrashLocalAfterUpload({
				verifiedOnDisk: false,
				stillLinkedInNote: false,
				linkedElsewhere: false,
			}),
		).toBe(false);
		expect(
			mayTrashLocalAfterUpload({
				verifiedOnDisk: true,
				stillLinkedInNote: true,
				linkedElsewhere: false,
			}),
		).toBe(false);
		expect(
			mayTrashLocalAfterUpload({
				verifiedOnDisk: true,
				stillLinkedInNote: false,
				linkedElsewhere: true,
			}),
		).toBe(false);
	});
});
