/**
 * gitignore-style match against file name only (not full path), case-insensitive.
 * Supports * / ?, ! negation, # comments, blank lines.
 */
export function matchesWhitelist(filename: string, patternsText: string): boolean {
	const name = filename.split(/[/\\]/).pop() ?? filename;
	const lower = name.toLowerCase();
	const lines = patternsText.split(/\r?\n/);
	let matched = false;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const neg = line.startsWith('!');
		const pat = (neg ? line.slice(1) : line).toLowerCase();
		if (globMatch(lower, pat)) {
			matched = !neg;
		}
	}
	return matched;
}

function globMatch(text: string, pattern: string): boolean {
	// ponytail: simple * and ? only; enough for *.ext whitelist
	let ti = 0;
	let pi = 0;
	let star = -1;
	let match = 0;
	while (ti < text.length) {
		if (pi < pattern.length && (pattern[pi] === '?' || pattern[pi] === text[ti])) {
			ti++;
			pi++;
		} else if (pi < pattern.length && pattern[pi] === '*') {
			star = pi++;
			match = ti;
		} else if (star !== -1) {
			pi = star + 1;
			ti = ++match;
		} else {
			return false;
		}
	}
	while (pi < pattern.length && pattern[pi] === '*') pi++;
	return pi === pattern.length;
}
