/** uuidv7: time-ordered, lowercase canonical. ponytail: local helper, no uuid pkg. */
export function uuidv7(now = Date.now()): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const ts = BigInt(now);
	bytes[0] = Number((ts >> 40n) & 0xffn);
	bytes[1] = Number((ts >> 32n) & 0xffn);
	bytes[2] = Number((ts >> 24n) & 0xffn);
	bytes[3] = Number((ts >> 16n) & 0xffn);
	bytes[4] = Number((ts >> 8n) & 0xffn);
	bytes[5] = Number(ts & 0xffn);
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sanitizeBasename(name: string): string {
	let s = name.normalize('NFKC').replace(/\s+/g, '-');
	s = s.replace(/[^A-Za-z0-9._-]/g, '');
	s = s.replace(/-+/g, '-');
	s = s.replace(/^[-_.]+|[-_.]+$/g, '');
	return s || 'file';
}

export function splitNameExt(filename: string): { base: string; ext: string } {
	const i = filename.lastIndexOf('.');
	if (i <= 0) return { base: filename, ext: '' };
	return { base: filename.slice(0, i), ext: filename.slice(i).toLowerCase() };
}

export function yyyymm(date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	return `${y}${m}`;
}

/** Full object key: `{prefix?}{YYYYMM}/{uuidv7}-{sanitized}{ext}` */
export function buildObjectKey(
	originalFilename: string,
	prefix = '',
	date = new Date(),
	id = uuidv7(),
): string {
	const { base, ext } = splitNameExt(originalFilename);
	const objectName = `${id}-${sanitizeBasename(base)}${ext}`;
	const month = yyyymm(date);
	const p = prefix.replace(/^\/+|\/+$/g, '');
	return p ? `${p}/${month}/${objectName}` : `${month}/${objectName}`;
}

export function buildPublicUrl(publicUrlBase: string, key: string): string {
	const base = publicUrlBase.replace(/\/+$/, '');
	const encoded = key
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
	return `${base}/${encoded}`;
}
