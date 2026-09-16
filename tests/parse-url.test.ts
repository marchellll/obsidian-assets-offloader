import { describe, expect, it } from 'vitest';
import { parseBucketUrl } from '../src/s3/parse-url';

describe('parseBucketUrl', () => {
	it('parses Cloudflare R2', () => {
		const r = parseBucketUrl(
			'https://5826f18dd993106b531d2aedf09d0965.r2.cloudflarestorage.com/memora',
		);
		expect(r).toMatchObject({
			provider: 'r2',
			endpoint: 'https://5826f18dd993106b531d2aedf09d0965.r2.cloudflarestorage.com',
			bucket: 'memora',
			region: 'auto',
			forcePathStyle: true,
			prefix: '',
		});
	});

	it('parses R2 with prefix', () => {
		const r = parseBucketUrl(
			'https://5826f18dd993106b531d2aedf09d0965.r2.cloudflarestorage.com/memora/photos',
		);
		expect(r?.prefix).toBe('photos');
	});

	it('parses R2 EU jurisdiction', () => {
		const r = parseBucketUrl('https://abc.eu.r2.cloudflarestorage.com/bucket');
		expect(r?.extras.r2Jurisdiction).toBe('eu');
	});

	it('parses AWS virtual-hosted', () => {
		const r = parseBucketUrl('https://my-bucket.s3.eu-west-1.amazonaws.com');
		expect(r).toMatchObject({
			provider: 'aws',
			endpoint: 'https://s3.eu-west-1.amazonaws.com',
			bucket: 'my-bucket',
			region: 'eu-west-1',
			forcePathStyle: false,
		});
	});

	it('parses AWS virtual-hosted with prefix', () => {
		const r = parseBucketUrl('https://my-bucket.s3.eu-west-1.amazonaws.com/photos');
		expect(r?.prefix).toBe('photos');
	});

	it('parses AWS path-style', () => {
		const r = parseBucketUrl('https://s3.us-east-1.amazonaws.com/my-bucket/photos');
		expect(r).toMatchObject({
			provider: 'aws',
			endpoint: 'https://s3.us-east-1.amazonaws.com',
			bucket: 'my-bucket',
			region: 'us-east-1',
			forcePathStyle: true,
			prefix: 'photos',
		});
	});

	it('parses AWS legacy virtual', () => {
		const r = parseBucketUrl('https://my-bucket.s3.amazonaws.com');
		expect(r).toMatchObject({
			bucket: 'my-bucket',
			region: 'us-east-1',
			forcePathStyle: false,
		});
	});

	it('parses B2', () => {
		const r = parseBucketUrl('https://s3.us-west-004.backblazeb2.com/mybucket');
		expect(r).toMatchObject({
			provider: 'b2',
			bucket: 'mybucket',
			region: 'us-west-004',
			forcePathStyle: true,
		});
	});

	it('parses Spaces virtual', () => {
		const r = parseBucketUrl('https://mybucket.nyc3.digitaloceanspaces.com');
		expect(r).toMatchObject({
			provider: 'spaces',
			endpoint: 'https://nyc3.digitaloceanspaces.com',
			bucket: 'mybucket',
			region: 'nyc3',
			forcePathStyle: false,
		});
	});

	it('parses Spaces path', () => {
		const r = parseBucketUrl('https://nyc3.digitaloceanspaces.com/mybucket');
		expect(r).toMatchObject({
			provider: 'spaces',
			bucket: 'mybucket',
			forcePathStyle: true,
		});
	});

	it('parses Spaces CDN into extras', () => {
		const r = parseBucketUrl('https://mybucket.nyc3.cdn.digitaloceanspaces.com');
		expect(r?.extras.spacesCdnUrl).toContain('cdn.digitaloceanspaces.com');
	});

	it('parses Wasabi', () => {
		const r = parseBucketUrl('https://s3.us-east-1.wasabisys.com/bucket');
		expect(r?.provider).toBe('wasabi');
	});

	it('parses Linode', () => {
		const r = parseBucketUrl('https://bucket.us-east-1.linodeobjects.com');
		expect(r).toMatchObject({
			provider: 'linode',
			bucket: 'bucket',
			region: 'us-east-1',
			forcePathStyle: false,
		});
	});

	it('parses Hetzner', () => {
		const r = parseBucketUrl('https://fsn1.your-objectstorage.com/bucket');
		expect(r?.provider).toBe('hetzner');
	});

	it('parses Scaleway', () => {
		const r = parseBucketUrl('https://s3.fr-par.scw.cloud/bucket');
		expect(r?.provider).toBe('scaleway');
	});

	it('parses GCS', () => {
		const r = parseBucketUrl('https://storage.googleapis.com/mybucket');
		expect(r).toMatchObject({
			provider: 'gcs',
			bucket: 'mybucket',
			region: 'auto',
			forcePathStyle: true,
		});
	});

	it('parses Storj', () => {
		const r = parseBucketUrl('https://gateway.storjshare.io/bucket');
		expect(r?.provider).toBe('storj');
	});

	it('parses Supabase', () => {
		const r = parseBucketUrl('https://xyz.supabase.co/storage/v1/s3/mybucket');
		expect(r).toMatchObject({
			provider: 'supabase',
			endpoint: 'https://xyz.supabase.co/storage/v1/s3',
			bucket: 'mybucket',
			region: 'us-east-1',
		});
	});

	it('parses IDrive e2', () => {
		const r = parseBucketUrl('https://us-east-1.idrivee2.com/bucket');
		expect(r?.provider).toBe('idrivee2');
	});

	it('parses Oracle', () => {
		const r = parseBucketUrl(
			'https://ns.compat.objectstorage.us-ashburn-1.oraclecloud.com/bucket',
		);
		expect(r).toMatchObject({
			provider: 'oracle',
			bucket: 'bucket',
			region: 'us-ashburn-1',
			extras: { oracleNamespace: 'ns' },
		});
	});

	it('parses Alibaba OSS', () => {
		const r = parseBucketUrl('https://mybucket.oss-cn-hangzhou.aliyuncs.com');
		expect(r).toMatchObject({
			provider: 'aliyun',
			endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
			bucket: 'mybucket',
			region: 'cn-hangzhou',
			forcePathStyle: false,
		});
	});

	it('generic fallback', () => {
		const r = parseBucketUrl('https://minio.local:9000/mybucket/prefix');
		expect(r).toMatchObject({
			provider: 'other',
			endpoint: 'https://minio.local:9000',
			bucket: 'mybucket',
			prefix: 'prefix',
			forcePathStyle: true,
		});
	});

	it('fails on file-looking path', () => {
		expect(parseBucketUrl('https://minio.local:9000/photo.png')).toBeNull();
	});

	it('fails on CDN host without spaces rule', () => {
		expect(parseBucketUrl('https://example.r2.dev/foo')).toBeNull();
	});
});
