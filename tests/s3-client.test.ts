import { describe, expect, it } from 'vitest';
import { FakeTransport, S3Client, type S3Connection, parseListXml } from '../src/s3/client';

const conn: S3Connection = {
	endpoint: 'https://example.r2.cloudflarestorage.com',
	region: 'auto',
	bucket: 'memora',
	forcePathStyle: true,
	accessKeyId: 'AKIA',
	secretAccessKey: 'secret',
	publicUrlBase: 'https://cdn.example.com',
};

describe('parseListXml', () => {
	it('parses contents', () => {
		const xml = `<?xml version="1.0"?>
		<ListBucketResult>
		<Contents><Key>202609/a.png</Key><Size>10</Size><LastModified>2026-09-01T00:00:00.000Z</LastModified></Contents>
		<IsTruncated>false</IsTruncated>
		</ListBucketResult>`;
		const page = parseListXml(xml);
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.key).toBe('202609/a.png');
	});
});

describe('S3Client', () => {
	it('put and list via fake transport', async () => {
		const stored = new Map<string, Uint8Array>();
		const transport = new FakeTransport(async (req) => {
			if (req.method === 'PUT') {
				const key = new URL(req.url).pathname.split('/').slice(2).join('/');
				stored.set(decodeURIComponent(key), req.body ?? new Uint8Array());
				return { status: 200, headers: {}, body: new Uint8Array() };
			}
			if (req.method === 'GET' && req.url.includes('list-type')) {
				const xml = `<ListBucketResult>${[...stored.keys()]
					.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`)
					.join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`;
				return {
					status: 200,
					headers: {},
					body: new TextEncoder().encode(xml),
				};
			}
			return { status: 404, headers: {}, body: new TextEncoder().encode('no') };
		});
		const client = new S3Client(conn, transport);
		await client.put('202609/a.png', new Uint8Array([1, 2, 3]));
		const list = await client.list({ limit: 10 });
		expect(list.items.some((i) => i.key.includes('a.png'))).toBe(true);
		expect(client.publicUrl('202609/a.png')).toBe('https://cdn.example.com/202609/a.png');
	});
});
