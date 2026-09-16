/**
 * Guess endpoint/bucket/region/provider from a pasted bucket URL.
 * First matching host rule wins. Never overwrites secrets or public URL base
 * (Spaces CDN paste is the exception — that URL is public, not the API endpoint).
 */
import type { ProviderId, R2Jurisdiction } from '../settings';

export interface ParseExtras {
	r2Jurisdiction?: R2Jurisdiction;
	oracleNamespace?: string;
	spacesCdnUrl?: string;
	gcsLocation?: string;
}

export interface ParseBucketUrlResult {
	provider: ProviderId;
	endpoint: string;
	bucket: string;
	region: string;
	forcePathStyle: boolean;
	prefix: string;
	extras: ParseExtras;
}

const CDN_HOST_RE = /(?:^|\.)(?:cloudflare\.com|r2\.dev|cdn\.digitaloceanspaces\.com)$/i;

function strip(input: string): URL | null {
	const trimmed = input.trim().replace(/\/+$/, '');
	if (!trimmed) return null;
	try {
		const u = new URL(trimmed);
		u.hash = '';
		u.search = '';
		return u;
	} catch {
		return null;
	}
}

function pathParts(pathname: string): string[] {
	return pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

/** Fail if sole path segment looks like a file (name.ext with short extension). */
function looksLikeFile(segment: string): boolean {
	const m = segment.match(/^[^.]+\.([A-Za-z0-9]{1,5})$/);
	return !!m;
}

function restPrefix(parts: string[], from: number): string {
	return parts.slice(from).join('/');
}

type Rule = (u: URL, parts: string[]) => ParseBucketUrlResult | null;

const RULES: Rule[] = [
	// Cloudflare R2 (incl. eu / fedramp)
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.(?:(eu|fedramp)\.)?r2\.cloudflarestorage\.com$/i);
		if (!m) return null;
		if (parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		const juris = (m[2]?.toLowerCase() ?? 'default') as R2Jurisdiction;
		return {
			provider: 'r2',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: 'auto',
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: { r2Jurisdiction: juris === 'default' ? 'default' : juris },
		};
	},
	// DigitalOcean Spaces CDN → public, not endpoint
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.([^.]+)\.cdn\.digitaloceanspaces\.com$/i);
		if (!m) return null;
		return {
			provider: 'spaces',
			endpoint: `https://${m[2]}.digitaloceanspaces.com`,
			bucket: m[1]!,
			region: m[2]!,
			forcePathStyle: false,
			prefix: restPrefix(parts, 0),
			extras: { spacesCdnUrl: u.origin },
		};
	},
	// AWS virtual-hosted
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.s3(?:\.([a-z0-9-]+))?\.amazonaws\.com(\.cn)?$/i);
		if (!m) return null;
		const bucket = m[1]!;
		const region = m[2] ?? (m[3] ? 'cn-north-1' : 'us-east-1');
		const cn = m[3] ?? '';
		const endpoint = m[2]
			? `https://s3.${region}.amazonaws.com${cn}`
			: `https://s3.amazonaws.com${cn}`;
		return {
			provider: 'aws',
			endpoint,
			bucket,
			region,
			forcePathStyle: false,
			prefix: restPrefix(parts, 0),
			extras: {},
		};
	},
	// AWS path-style
	(u, parts) => {
		const m = u.hostname.match(/^s3(?:\.([a-z0-9-]+))?\.amazonaws\.com(\.cn)?$/i);
		if (!m) return null;
		if (parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		const region = m[1] ?? (m[2] ? 'cn-north-1' : 'us-east-1');
		const cn = m[2] ?? '';
		const endpoint = m[1]
			? `https://s3.${region}.amazonaws.com${cn}`
			: `https://s3.amazonaws.com${cn}`;
		return {
			provider: 'aws',
			endpoint,
			bucket: parts[0]!,
			region,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Backblaze B2
	(u, parts) => {
		const m = u.hostname.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'b2',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// DigitalOcean Spaces virtual
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.([^.]+)\.digitaloceanspaces\.com$/i);
		if (!m) return null;
		return {
			provider: 'spaces',
			endpoint: `https://${m[2]}.digitaloceanspaces.com`,
			bucket: m[1]!,
			region: m[2]!,
			forcePathStyle: false,
			prefix: restPrefix(parts, 0),
			extras: {},
		};
	},
	// DigitalOcean Spaces path
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.digitaloceanspaces\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'spaces',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Wasabi
	(u, parts) => {
		const m = u.hostname.match(/^s3\.([a-z0-9-]+)\.wasabisys\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'wasabi',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Linode
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.([^.]+)\.linodeobjects\.com$/i);
		if (!m) return null;
		return {
			provider: 'linode',
			endpoint: `https://${m[2]}.linodeobjects.com`,
			bucket: m[1]!,
			region: m[2]!,
			forcePathStyle: false,
			prefix: restPrefix(parts, 0),
			extras: {},
		};
	},
	// Hetzner
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.your-objectstorage\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'hetzner',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Scaleway
	(u, parts) => {
		const m = u.hostname.match(/^s3\.([a-z0-9-]+)\.scw\.cloud$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'scaleway',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// GCS
	(u, parts) => {
		if (!/^storage\.googleapis\.com$/i.test(u.hostname)) return null;
		if (parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'gcs',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: 'auto',
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Storj
	(u, parts) => {
		if (!/^gateway\.storjshare\.io$/i.test(u.hostname)) return null;
		if (parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'storj',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: 'us-east-1',
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Supabase
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.supabase\.co$/i);
		if (!m) return null;
		const s3Idx = parts.indexOf('s3');
		if (s3Idx === -1 || s3Idx + 1 >= parts.length) return null;
		const bucket = parts[s3Idx + 1]!;
		if (looksLikeFile(bucket)) return null;
		return {
			provider: 'supabase',
			endpoint: `${u.origin}/storage/v1/s3`,
			bucket,
			region: 'us-east-1',
			forcePathStyle: true,
			prefix: restPrefix(parts, s3Idx + 2),
			extras: {},
		};
	},
	// IDrive e2
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.idrivee2\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'idrivee2',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[1]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
	// Oracle
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.compat\.objectstorage\.([^.]+)\.oraclecloud\.com$/i);
		if (!m || parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'oracle',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: m[2]!,
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: { oracleNamespace: m[1]! },
		};
	},
	// Alibaba OSS virtual
	(u, parts) => {
		const m = u.hostname.match(/^([^.]+)\.oss-([^.]+)\.aliyuncs\.com$/i);
		if (!m) return null;
		return {
			provider: 'aliyun',
			endpoint: `https://oss-${m[2]}.aliyuncs.com`,
			bucket: m[1]!,
			region: m[2]!,
			forcePathStyle: false,
			prefix: restPrefix(parts, 0),
			extras: {},
		};
	},
	// Generic fallback
	(u, parts) => {
		if (CDN_HOST_RE.test(u.hostname)) return null;
		if (parts.length < 1 || looksLikeFile(parts[0]!)) return null;
		return {
			provider: 'other',
			endpoint: u.origin,
			bucket: parts[0]!,
			region: 'us-east-1',
			forcePathStyle: true,
			prefix: restPrefix(parts, 1),
			extras: {},
		};
	},
];

export function parseBucketUrl(input: string): ParseBucketUrlResult | null {
	const u = strip(input);
	if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
	const parts = pathParts(u.pathname);
	for (const rule of RULES) {
		const hit = rule(u, parts);
		if (hit) return hit;
	}
	return null;
}
