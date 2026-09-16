/**
 * S3-compatible client: SigV4 sign (aws4fetch) + Obsidian requestUrl transport.
 * Mobile-safe (no Node/AWS SDK). PUT hashes body (Android OkHttp / empty HEAD quirks).
 * Test connection: HEAD bucket, else list max-keys=1.
 */
import { App, requestUrl } from 'obsidian';
import { AwsV4Signer } from 'aws4fetch';
import { getSecret, hasSecretStorage, type AssetsOffloaderSettings } from '../settings';
import { buildPublicUrl } from './names';
import { normalizeHttpUrl } from './http-url';

export interface S3Connection {
	endpoint: string;
	region: string;
	bucket: string;
	forcePathStyle: boolean;
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
	publicUrlBase: string;
}

export interface TransportRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: Uint8Array;
}

export interface TransportResponse {
	status: number;
	headers: Record<string, string>;
	body: Uint8Array;
}

export interface S3Transport {
	send(req: TransportRequest): Promise<TransportResponse>;
}

export interface ListedObject {
	key: string;
	size: number;
	lastModified?: number;
}

export interface ListResult {
	items: ListedObject[];
	cursor?: string;
}

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	m4v: 'video/x-m4v',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	pdf: 'application/pdf',
	zip: 'application/zip',
};

const HOP = new Set(['connection', 'content-length', 'expect', 'host', 'transfer-encoding']);

function encodeRfc3986Segment(segment: string): string {
	return encodeURIComponent(segment).replace(
		/[!'()*]/gu,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export function encodeObjectKey(key: string): string {
	return key
		.split('/')
		.map((seg) => {
			if (seg === '.' || seg === '..') throw new Error(`Invalid object key: ${key}`);
			return encodeRfc3986Segment(seg);
		})
		.join('/');
}

export function buildBucketUrl(c: S3Connection): string {
	const endpoint = c.endpoint.replace(/\/+$/, '');
	if (c.forcePathStyle) {
		return `${endpoint}/${encodeURIComponent(c.bucket)}`;
	}
	const origin = new URL(endpoint);
	return `${origin.protocol}//${c.bucket}.${origin.host}`;
}

export function buildObjectUrl(c: S3Connection, key: string): string {
	return `${buildBucketUrl(c)}/${encodeObjectKey(key)}`;
}

export function buildListUrl(
	c: S3Connection,
	opts: { prefix?: string; limit?: number; cursor?: string; delimiter?: string } = {},
): string {
	const url = new URL(buildBucketUrl(c));
	url.searchParams.set('list-type', '2');
	if (opts.limit !== undefined) url.searchParams.set('max-keys', String(opts.limit));
	if (opts.cursor) url.searchParams.set('continuation-token', opts.cursor);
	if (opts.prefix) url.searchParams.set('prefix', opts.prefix);
	if (opts.delimiter) url.searchParams.set('delimiter', opts.delimiter);
	return url.toString();
}

function decodeXml(text: string): string {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

export function parseListXml(xml: string): ListResult {
	const items: ListedObject[] = [];
	for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
		const block = m[1] ?? '';
		const key = /<Key>([^<]*)<\/Key>/.exec(block)?.[1];
		if (key === undefined) continue;
		const size = Number(/<Size>([^<]*)<\/Size>/.exec(block)?.[1] ?? 0);
		const lm = /<LastModified>([^<]*)<\/LastModified>/.exec(block)?.[1];
		const lastModified = lm ? Date.parse(lm) : undefined;
		items.push({
			key: decodeXml(key),
			size,
			...(lastModified !== undefined && !Number.isNaN(lastModified) ? { lastModified } : {}),
		});
	}
	const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
	const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
	return {
		items,
		...(truncated && next ? { cursor: decodeXml(next) } : {}),
	};
}

export function parseCommonPrefixes(xml: string): string[] {
	const out: string[] = [];
	for (const m of xml.matchAll(
		/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g,
	)) {
		if (m[1]) out.push(decodeXml(m[1]));
	}
	return out;
}

function parseError(xml: string): string {
	const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1];
	const msg = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1];
	if (code || msg) return `${decodeXml(code ?? '')}: ${decodeXml(msg ?? '')}`.trim();
	return xml.slice(0, 200) || 'Unknown S3 error';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const n = name.toLowerCase();
	return Object.keys(headers).some((k) => k.toLowerCase() === n);
}

async function signRequest(c: S3Connection, req: TransportRequest): Promise<TransportRequest> {
	const headers = { ...req.headers };
	if (c.sessionToken && !hasHeader(headers, 'x-amz-security-token')) {
		headers['x-amz-security-token'] = c.sessionToken;
	}
	if (req.body !== undefined && !hasHeader(headers, 'x-amz-content-sha256')) {
		headers['x-amz-content-sha256'] = await sha256Hex(req.body);
	}
	const signer = new AwsV4Signer({
		accessKeyId: c.accessKeyId,
		secretAccessKey: c.secretAccessKey,
		sessionToken: c.sessionToken,
		region: c.region,
		service: 's3',
		method: req.method,
		url: req.url,
		headers,
	});
	const signed = await signer.sign();
	const wireUrl = `${signed.url.protocol}//${signed.url.host}${signer.encodedPath}${signed.url.search}`;
	const outHeaders: Record<string, string> = {};
	signed.headers.forEach((value, key) => {
		outHeaders[key] = value;
	});
	return {
		...req,
		url: wireUrl,
		headers: outHeaders,
	};
}

export class RequestUrlTransport implements S3Transport {
	async send(req: TransportRequest): Promise<TransportResponse> {
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) {
			const n = k.toLowerCase();
			if (HOP.has(n)) continue;
			headers[n] = v;
		}
		const contentType = headers['content-type'];
		let body: ArrayBuffer | undefined;
		if (req.body) {
			body = req.body.buffer.slice(
				req.body.byteOffset,
				req.body.byteOffset + req.body.byteLength,
			) as ArrayBuffer;
		}
		const res = await requestUrl({
			url: req.url,
			method: req.method,
			headers,
			...(contentType ? { contentType } : {}),
			...(body ? { body } : {}),
			throw: false,
		});
		const outHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(res.headers)) {
			outHeaders[k.toLowerCase()] = v;
		}
		return {
			status: res.status,
			headers: outHeaders,
			body: new Uint8Array(res.arrayBuffer),
		};
	}
}

export class FakeTransport implements S3Transport {
	constructor(
		private handler: (req: TransportRequest) => Promise<TransportResponse> | TransportResponse,
	) {}
	send(req: TransportRequest): Promise<TransportResponse> {
		return Promise.resolve(this.handler(req));
	}
}

function mimeForKey(key: string): string {
	const ext = key.split('.').pop()?.toLowerCase() ?? '';
	return MIME[ext] ?? 'application/octet-stream';
}

function signingRegion(settings: AssetsOffloaderSettings): string {
	if (settings.provider === 'gcs' && settings.gcsLocation.trim()) {
		return settings.gcsLocation.trim();
	}
	return settings.region || 'us-east-1';
}

export function connectionFromSettings(app: App, settings: AssetsOffloaderSettings): S3Connection {
	if (!hasSecretStorage(app)) {
		throw new Error('Secret Storage unavailable');
	}
	const accessKeyId = getSecret(app, settings.accessKeySecretId);
	const secretAccessKey = getSecret(app, settings.secretKeySecretId);
	if (!accessKeyId || !secretAccessKey) {
		throw new Error('Access key / secret key not set in Secret Storage');
	}
	if (!settings.endpoint.trim() || !settings.bucket.trim()) {
		throw new Error('Endpoint and bucket required');
	}
	const endpoint = normalizeHttpUrl(settings.endpoint);
	if (!endpoint) {
		throw new Error(`Invalid endpoint URL: ${settings.endpoint}`);
	}
	const session = settings.sessionTokenSecretId
		? (getSecret(app, settings.sessionTokenSecretId) ?? undefined)
		: undefined;
	const rawPublic =
		settings.provider === 'spaces' && settings.spacesCdnUrl.trim()
			? settings.spacesCdnUrl
			: settings.publicUrlBase;
	const publicBase = normalizeHttpUrl(rawPublic) ?? '';
	if (rawPublic.trim() && !publicBase) {
		throw new Error(`Invalid public URL base: ${rawPublic}`);
	}
	return {
		endpoint,
		region: signingRegion(settings),
		bucket: settings.bucket.trim(),
		forcePathStyle: settings.forcePathStyle,
		accessKeyId,
		secretAccessKey,
		...(session ? { sessionToken: session } : {}),
		publicUrlBase: publicBase,
	};
}

export class S3Client {
	constructor(
		private connection: S3Connection,
		private transport: S3Transport = new RequestUrlTransport(),
	) {}

	private async send(req: TransportRequest): Promise<TransportResponse> {
		const signed = await signRequest(this.connection, req);
		return this.transport.send(signed);
	}

	private assertOk(status: number, body: Uint8Array): void {
		if (status >= 200 && status < 300) return;
		const text = new TextDecoder().decode(body);
		throw new Error(parseError(text) || `HTTP ${status}`);
	}

	async put(key: string, bytes: Uint8Array, contentType?: string): Promise<void> {
		const res = await this.send({
			method: 'PUT',
			url: buildObjectUrl(this.connection, key),
			headers: {
				'content-type': contentType ?? mimeForKey(key),
			},
			body: bytes,
		});
		this.assertOk(res.status, res.body);
	}

	async get(key: string): Promise<Uint8Array> {
		const res = await this.send({
			method: 'GET',
			url: buildObjectUrl(this.connection, key),
			headers: {},
		});
		this.assertOk(res.status, res.body);
		return res.body;
	}

	async delete(key: string): Promise<void> {
		const res = await this.send({
			method: 'DELETE',
			url: buildObjectUrl(this.connection, key),
			headers: {},
		});
		this.assertOk(res.status, res.body);
	}

	async list(
		opts: {
			prefix?: string;
			limit?: number;
			cursor?: string;
			delimiter?: string;
		} = {},
	): Promise<ListResult & { prefixes?: string[] }> {
		const res = await this.send({
			method: 'GET',
			url: buildListUrl(this.connection, opts),
			headers: {},
		});
		this.assertOk(res.status, res.body);
		const xml = new TextDecoder().decode(res.body);
		const page = parseListXml(xml);
		const prefixes = opts.delimiter ? parseCommonPrefixes(xml) : undefined;
		return { ...page, ...(prefixes ? { prefixes } : {}) };
	}

	/** Head bucket, else list — superseded by full testConnection probe. */
	async test(): Promise<void> {
		await this.testFullAccess();
	}

	/**
	 * Probe every S3 op the plugin needs: list, put, get.
	 * Skips delete (overwrite fixed probe key instead).
	 */
	async testFullAccess(remotePrefix = ''): Promise<void> {
		const p = remotePrefix.replace(/^\/+|\/+$/g, '');
		const probeKey = p
			? `${p}/.assets-offloader/connection-probe.txt`
			: `.assets-offloader/connection-probe.txt`;

		try {
			await this.list({ limit: 1, prefix: p ? `${p}/` : undefined });
		} catch (e) {
			throw new Error(
				`List failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		const payload = new TextEncoder().encode(
			`assets-offloader connection probe ${Date.now()}`,
		);
		try {
			await this.put(probeKey, payload, 'text/plain');
		} catch (e) {
			throw new Error(
				`Put failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		let got: Uint8Array;
		try {
			got = await this.get(probeKey);
		} catch (e) {
			throw new Error(
				`Get failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		if (got.byteLength !== payload.byteLength || !bytesEqual(got, payload)) {
			throw new Error('Get failed: downloaded bytes do not match upload');
		}
		// ponytail: no DELETE — leave/overwrite probe so tokens without delete still pass
	}

	publicUrl(key: string): string {
		if (this.connection.publicUrlBase) {
			return buildPublicUrl(this.connection.publicUrlBase, key);
		}
		return buildObjectUrl(this.connection, key);
	}

	getConnection(): S3Connection {
		return this.connection;
	}
}

export function createClient(app: App, settings: AssetsOffloaderSettings): S3Client {
	return new S3Client(connectionFromSettings(app, settings));
}

export async function testConnection(
	app: App,
	settings: AssetsOffloaderSettings,
): Promise<void> {
	const client = createClient(app, settings);
	await client.testFullAccess(settings.prefix);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
