/**
 * HTTP(S) URL helpers for settings + public link building.
 * Bare hosts like `cdn.example.com` normalize to `https://cdn.example.com`.
 */

/** Empty → null. Valid http(s) → origin[+path], no trailing slash. Else null. */
export function normalizeHttpUrl(input: string): string | null {
	const raw = input.trim();
	if (!raw) return null;
	// Already has a scheme? Keep it. Otherwise assume https.
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
	try {
		const u = new URL(candidate);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (!u.hostname) return null;
		let out = u.origin;
		if (u.pathname && u.pathname !== '/') {
			out += u.pathname.replace(/\/+$/, '');
		}
		return out;
	} catch {
		return null;
	}
}

export function isHttpUrl(input: string): boolean {
	return normalizeHttpUrl(input) !== null;
}
