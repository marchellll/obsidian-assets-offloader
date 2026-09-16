export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sameChecksum(a: Uint8Array, b: Uint8Array): Promise<boolean> {
	if (a.byteLength !== b.byteLength) return false;
	const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
	return ha === hb;
}
