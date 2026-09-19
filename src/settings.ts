/**
 * Settings types, defaults, and Settings → Assets Offloader tab.
 * Credentials use SecretComponent / secret ids — never raw keys in data.json.
 * Tab is declarative so settings appear in Obsidian 1.13+ settings search.
 */
import {
	App,
	Notice,
	PluginSettingTab,
	SecretComponent,
	type ButtonComponent,
	type SettingDefinition,
	type SettingDefinitionItem,
} from 'obsidian';
import type AssetsOffloaderPlugin from './main';
import type { EnKey } from './locales/en';
import { t } from './i18n';
import { isHttpUrl, normalizeHttpUrl } from './s3/http-url';

export type ProviderId =
	| 'r2'
	| 'aws'
	| 'b2'
	| 'spaces'
	| 'wasabi'
	| 'linode'
	| 'hetzner'
	| 'scaleway'
	| 'gcs'
	| 'storj'
	| 'supabase'
	| 'idrivee2'
	| 'oracle'
	| 'aliyun'
	| 'other';

export type R2Jurisdiction = 'default' | 'eu' | 'fedramp';
export type LocalizedLinkStyle = 'wikilink' | 'markdown';
export type ProgressCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const DEFAULT_WHITELIST = `*.avif
*.bmp
*.dng
*.gif
*.heic
*.heif
*.ico
*.jpeg
*.jpg
*.png
*.raw
*.svg
*.tif
*.tiff
*.webp
*.3gp
*.avi
*.flv
*.m2ts
*.m4v
*.mkv
*.mov
*.mp3
*.mp4
*.mpeg
*.mpg
*.mts
*.m4a
*.ogg
*.wav
*.webm
*.wmv
*.7z
*.bz2
*.dmg
*.gz
*.img
*.iso
*.pdf
*.rar
*.tar
*.toast
*.wim
*.zip`;

export interface AssetsOffloaderSettings {
	bucketUrl: string;
	provider: ProviderId;
	endpoint: string;
	region: string;
	bucket: string;
	publicUrlBase: string;
	prefix: string;
	accessKeySecretId: string;
	secretKeySecretId: string;
	sessionTokenSecretId: string;
	forcePathStyle: boolean;
	r2Jurisdiction: R2Jurisdiction;
	spacesCdnUrl: string;
	gcsLocation: string;
	oracleNamespace: string;
	whitelist: string;
	deleteLocalAfterUpload: boolean;
	localizedLinkStyle: LocalizedLinkStyle;
	progressCorner: ProgressCorner;
}

export const DEFAULT_SETTINGS: AssetsOffloaderSettings = {
	bucketUrl: '',
	provider: 'other',
	endpoint: '',
	region: 'auto',
	bucket: '',
	publicUrlBase: '',
	prefix: '',
	accessKeySecretId: '',
	secretKeySecretId: '',
	sessionTokenSecretId: '',
	forcePathStyle: true,
	r2Jurisdiction: 'default',
	spacesCdnUrl: '',
	gcsLocation: '',
	oracleNamespace: '',
	whitelist: DEFAULT_WHITELIST,
	deleteLocalAfterUpload: false,
	localizedLinkStyle: 'wikilink',
	progressCorner: 'bottom-right',
};

const PROVIDER_OPTIONS: Record<ProviderId, EnKey> = {
	r2: 'providers.r2',
	aws: 'providers.aws',
	b2: 'providers.b2',
	spaces: 'providers.spaces',
	wasabi: 'providers.wasabi',
	linode: 'providers.linode',
	hetzner: 'providers.hetzner',
	scaleway: 'providers.scaleway',
	gcs: 'providers.gcs',
	storj: 'providers.storj',
	supabase: 'providers.supabase',
	idrivee2: 'providers.idrivee2',
	oracle: 'providers.oracle',
	aliyun: 'providers.aliyun',
	other: 'providers.other',
};

const URL_KEYS = new Set(['bucketUrl', 'endpoint', 'publicUrlBase', 'spacesCdnUrl']);

const EXTRA_PROVIDERS: ProviderId[] = [
	'r2',
	'aws',
	'aliyun',
	'spaces',
	'gcs',
	'oracle',
	'supabase',
	'b2',
];

/** Human labels for missing/invalid required connection fields. */
export function missingConnectionFields(settings: AssetsOffloaderSettings): string[] {
	const missing: string[] = [];
	if (!settings.endpoint.trim()) missing.push(t('settings.endpoint'));
	else if (!isHttpUrl(settings.endpoint)) missing.push(t('settings.endpoint'));
	if (!settings.bucket.trim()) missing.push(t('settings.bucket'));
	const publicRaw =
		settings.provider === 'spaces' && settings.spacesCdnUrl.trim()
			? settings.spacesCdnUrl
			: settings.publicUrlBase;
	if (!publicRaw.trim()) missing.push(t('settings.publicUrlBase'));
	else if (!isHttpUrl(publicRaw)) missing.push(t('settings.publicUrlBase'));
	if (!settings.accessKeySecretId.trim()) missing.push(t('settings.accessKey'));
	if (!settings.secretKeySecretId.trim()) missing.push(t('settings.secretKey'));
	if (settings.provider === 'oracle' && !settings.oracleNamespace.trim()) {
		missing.push(t('settings.oracleNamespace'));
	}
	if (settings.provider === 'gcs' && !settings.gcsLocation.trim()) {
		missing.push(t('settings.gcsLocation'));
	}
	return missing;
}

export function hasSecretStorage(app: App): boolean {
	return (
		typeof (app as App & { secretStorage?: { getSecret: (n: string) => string | null } })
			.secretStorage?.getSecret === 'function'
	);
}

export function getSecret(app: App, id: string): string | null {
	if (!id || !hasSecretStorage(app)) return null;
	return app.secretStorage.getSecret(id);
}

export class AssetsOffloaderSettingTab extends PluginSettingTab {
	plugin: AssetsOffloaderPlugin;

	constructor(app: App, plugin: AssetsOffloaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const providerOptions = Object.fromEntries(
			(Object.keys(PROVIDER_OPTIONS) as ProviderId[]).map((id) => [
				id,
				t(PROVIDER_OPTIONS[id]),
			]),
		);
		return [
			{ name: t('settings.networkNote') },
			{
				name: t('settings.whitelist'),
				desc: t('settings.whitelistDesc'),
				control: { type: 'textarea', key: 'whitelist', rows: 8 },
			},
			{
				name: t('settings.deleteLocal'),
				desc: t('settings.deleteLocalDesc'),
				control: { type: 'toggle', key: 'deleteLocalAfterUpload' },
			},
			{
				name: t('settings.localizedLinkStyle'),
				desc: t('settings.localizedLinkStyleDesc'),
				control: {
					type: 'dropdown',
					key: 'localizedLinkStyle',
					options: {
						wikilink: t('linkStyle.wikilink'),
						markdown: t('linkStyle.markdown'),
					},
				},
			},
			{
				name: t('settings.progressCorner'),
				desc: t('settings.progressCornerDesc'),
				control: {
					type: 'dropdown',
					key: 'progressCorner',
					options: {
						'top-left': t('progressCorner.topLeft'),
						'top-right': t('progressCorner.topRight'),
						'bottom-left': t('progressCorner.bottomLeft'),
						'bottom-right': t('progressCorner.bottomRight'),
					},
				},
			},
			{
				type: 'group',
				heading: t('settings.sectionConnection'),
				items: [
					this.textDef('bucketUrl', 'settings.bucketUrl', 'settings.bucketUrlDesc'),
					{
						name: t('settings.guessFromUrl'),
						render: (setting) => {
							setting.addButton((btn) =>
								btn.setButtonText(t('settings.guessFromUrl')).onClick(() => {
									void this.guessFromUrl();
								}),
							);
						},
					},
					{
						name: t('settings.provider'),
						control: { type: 'dropdown', key: 'provider', options: providerOptions },
					},
					this.textDef('endpoint', 'settings.endpoint', 'settings.endpointDesc', true),
					this.textDef('region', 'settings.region'),
					this.textDef('bucket', 'settings.bucket', undefined, true),
					{
						name: this.req('settings.publicUrlBase'),
						desc: t('settings.publicUrlBaseDesc'),
						control: {
							type: 'text',
							key: 'publicUrlBase',
							validate: (value) => this.validatePublicUrlBase(value),
						},
					},
					this.textDef('prefix', 'settings.prefix', 'settings.prefixDesc'),
					this.secretDef('accessKeySecretId', 'settings.accessKey', true),
					this.secretDef('secretKeySecretId', 'settings.secretKey', true),
					{
						name: t('settings.forcePathStyle'),
						desc: t('settings.forcePathStyleDesc'),
						control: { type: 'toggle', key: 'forcePathStyle' },
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.providerExtras'),
				visible: () => this.isProvider(...EXTRA_PROVIDERS),
				items: [
					{
						name: t('settings.r2Jurisdiction'),
						desc: t('settings.r2JurisdictionDesc'),
						visible: () => this.isProvider('r2'),
						control: {
							type: 'dropdown',
							key: 'r2Jurisdiction',
							options: {
								default: t('jurisdiction.default'),
								eu: t('jurisdiction.eu'),
								fedramp: t('jurisdiction.fedramp'),
							},
						},
					},
					{
						...this.secretDef('sessionTokenSecretId', 'settings.sessionToken'),
						desc: t('settings.sessionTokenDesc'),
						visible: () => this.isProvider('aws', 'aliyun'),
					},
					{
						...this.textDef(
							'spacesCdnUrl',
							'settings.spacesCdn',
							'settings.spacesCdnDesc',
						),
						visible: () => this.isProvider('spaces'),
					},
					{
						...this.textDef(
							'gcsLocation',
							'settings.gcsLocation',
							'settings.gcsLocationDesc',
							true,
						),
						visible: () => this.isProvider('gcs'),
					},
					{
						name: this.req('settings.oracleNamespace'),
						desc: t('settings.oracleNamespaceDesc'),
						visible: () => this.isProvider('oracle'),
						control: {
							type: 'text',
							key: 'oracleNamespace',
							validate: (value) => this.validateRequired(value),
						},
					},
					{
						name: t('settings.supabaseNote'),
						visible: () => this.isProvider('supabase'),
					},
					{
						name: t('settings.b2Note'),
						visible: () => this.isProvider('b2'),
					},
				],
			},
			{
				name: t('settings.testConnection'),
				desc: t('settings.testConnectionDesc'),
				render: (setting) => {
					setting.addButton((btn) =>
						btn
							.setButtonText(t('settings.testConnection'))
							.setCta()
							.setClass('assets-offloader-test-btn')
							.onClick(() => {
								void this.testConnection(btn);
							}),
					);
				},
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		let next = value;
		if (URL_KEYS.has(key) && typeof value === 'string' && value.trim()) {
			next = normalizeHttpUrl(value) ?? value;
		}
		if (key === 'r2Jurisdiction' && typeof value === 'string') {
			this.applyR2Jurisdiction(value as R2Jurisdiction);
		}
		if (
			key === 'oracleNamespace' &&
			typeof value === 'string' &&
			value &&
			this.plugin.settings.region
		) {
			this.plugin.settings.endpoint = `https://${value}.compat.objectstorage.${this.plugin.settings.region}.oraclecloud.com`;
		}
		s[key] = next;
		await this.plugin.saveSettings();
		if (key === 'r2Jurisdiction' || key === 'oracleNamespace') {
			this.update();
		}
	}

	private req(nameKey: EnKey): string {
		return `${t(nameKey)}${t('settings.requiredMark')}`;
	}

	private isProvider(...ids: ProviderId[]): boolean {
		return ids.includes(this.plugin.settings.provider);
	}

	private validateRequired(value: string): string | undefined {
		return value.trim() ? undefined : t('settings.required');
	}

	private validateUrl(value: string, required: boolean, nameKey: EnKey): string | undefined {
		if (!value.trim()) return required ? t('settings.required') : undefined;
		if (!normalizeHttpUrl(value)) return t('notices.invalidUrl', { field: t(nameKey) });
		return undefined;
	}

	private validatePublicUrlBase(value: string): string | undefined {
		const fallback =
			this.plugin.settings.provider === 'spaces' &&
			!!this.plugin.settings.spacesCdnUrl.trim();
		if (!value.trim()) return fallback ? undefined : t('settings.required');
		if (!normalizeHttpUrl(value)) {
			return t('notices.invalidUrl', { field: t('settings.publicUrlBase') });
		}
		return undefined;
	}

	private textDef(
		key:
			| 'bucketUrl'
			| 'endpoint'
			| 'region'
			| 'bucket'
			| 'publicUrlBase'
			| 'prefix'
			| 'spacesCdnUrl'
			| 'gcsLocation',
		nameKey: EnKey,
		descKey?: EnKey,
		required = false,
	): SettingDefinition {
		return {
			name: required ? this.req(nameKey) : t(nameKey),
			desc: descKey ? t(descKey) : required ? t('settings.required') : undefined,
			control: {
				type: 'text',
				key,
				validate: (value) =>
					URL_KEYS.has(key)
						? this.validateUrl(value, required, nameKey)
						: required
							? this.validateRequired(value)
							: undefined,
			},
		};
	}

	private secretDef(
		key: 'accessKeySecretId' | 'secretKeySecretId' | 'sessionTokenSecretId',
		nameKey: EnKey,
		required = false,
	): SettingDefinition {
		return {
			name: required ? this.req(nameKey) : t(nameKey),
			desc: required ? t('settings.required') : undefined,
			render: (setting) => {
				if (!hasSecretStorage(this.app)) {
					setting.setDesc(t('notices.noSecretStorage'));
					return;
				}
				setting.addComponent((el) =>
					new SecretComponent(this.app, el)
						.setValue(this.plugin.settings[key])
						.onChange(async (value) => {
							this.plugin.settings[key] = value ?? '';
							await this.plugin.saveSettings();
						}),
				);
			},
		};
	}

	private async guessFromUrl(): Promise<void> {
		const s = this.plugin.settings;
		const { parseBucketUrl } = await import('./s3/parse-url');
		const result = parseBucketUrl(s.bucketUrl);
		if (!result) {
			new Notice(t('notices.guessFailed'));
			return;
		}
		s.provider = result.provider;
		s.endpoint = result.endpoint;
		s.bucket = result.bucket;
		s.region = result.region;
		s.forcePathStyle = result.forcePathStyle;
		if (result.prefix !== undefined) s.prefix = result.prefix;
		if (result.extras.r2Jurisdiction) s.r2Jurisdiction = result.extras.r2Jurisdiction;
		if (result.extras.oracleNamespace) s.oracleNamespace = result.extras.oracleNamespace;
		if (result.extras.spacesCdnUrl) {
			s.spacesCdnUrl = result.extras.spacesCdnUrl;
			s.publicUrlBase = result.extras.spacesCdnUrl.replace(/\/$/, '');
		}
		if (result.extras.gcsLocation) s.gcsLocation = result.extras.gcsLocation;
		await this.plugin.saveSettings();
		new Notice(
			t('notices.guessed', {
				provider: t(PROVIDER_OPTIONS[result.provider]),
				bucket: result.bucket,
			}),
		);
		this.update();
	}

	private setTestButtonBusy(btn: ButtonComponent, busy: boolean): void {
		btn.setDisabled(busy);
		btn.setButtonText(
			busy ? t('settings.testConnectionTesting') : t('settings.testConnection'),
		);
		btn.buttonEl.toggleClass('is-loading', busy);
	}

	private async testConnection(btn: ButtonComponent): Promise<void> {
		if (btn.buttonEl.disabled || btn.buttonEl.hasClass('is-loading')) return;
		const miss = missingConnectionFields(this.plugin.settings);
		if (miss.length > 0) {
			new Notice(t('settings.validationMissing', { fields: miss.join(', ') }));
			return;
		}
		if (!hasSecretStorage(this.app)) {
			new Notice(t('notices.noSecretStorage'));
			return;
		}
		this.setTestButtonBusy(btn, true);
		try {
			const { testConnection } = await import('./s3/client');
			await testConnection(this.app, this.plugin.settings);
			new Notice(t('notices.testOk'));
		} catch (e) {
			new Notice(
				t('notices.testFail', { error: e instanceof Error ? e.message : String(e) }),
			);
		} finally {
			if (btn.buttonEl.isConnected) this.setTestButtonBusy(btn, false);
		}
	}

	private applyR2Jurisdiction(next: R2Jurisdiction): void {
		const s = this.plugin.settings;
		const m = s.endpoint.match(
			/^https:\/\/([^.]+)\.(?:(?:eu|fedramp)\.)?r2\.cloudflarestorage\.com\/?$/i,
		);
		if (!m?.[1]) {
			new Notice(t('notices.jurisdictionNoAccount'));
			return;
		}
		const account = m[1];
		if (next === 'eu') {
			s.endpoint = `https://${account}.eu.r2.cloudflarestorage.com`;
		} else if (next === 'fedramp') {
			s.endpoint = `https://${account}.fedramp.r2.cloudflarestorage.com`;
		} else {
			s.endpoint = `https://${account}.r2.cloudflarestorage.com`;
		}
	}
}
