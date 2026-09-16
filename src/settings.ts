/**
 * Settings types, defaults, and Settings → Assets Offloader tab.
 * Credentials use SecretComponent / secret ids — never raw keys in data.json.
 * Provider extras re-render when provider changes (display() again).
 */
import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type AssetsOffloaderPlugin from './main';
import type { EnKey } from './locales/en';
import { t } from './i18n';

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

export const DEFAULT_WHITELIST = `*.png
*.jpg
*.jpeg
*.gif
*.webp
*.svg
*.bmp
*.ico
*.mp4
*.webm
*.mov
*.m4v
*.mp3
*.wav
*.ogg
*.pdf
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
	// ponytail: imperative Setting + SecretComponent; declarative defs skip secrets UX
	plugin: AssetsOffloaderPlugin;

	constructor(app: App, plugin: AssetsOffloaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', { text: t('settings.networkNote') });

		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName(t('settings.bucketUrl'))
			.setDesc(t('settings.bucketUrlDesc'))
			.addText((text) =>
				text.setValue(s.bucketUrl).onChange(async (v) => {
					s.bucketUrl = v;
					await this.plugin.saveSettings();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText(t('settings.guessFromUrl')).onClick(async () => {
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
					if (result.extras.r2Jurisdiction)
						s.r2Jurisdiction = result.extras.r2Jurisdiction;
					if (result.extras.oracleNamespace)
						s.oracleNamespace = result.extras.oracleNamespace;
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
					this.display();
				}),
			);

		new Setting(containerEl).setName(t('settings.provider')).addDropdown((dd) => {
			for (const id of Object.keys(PROVIDER_OPTIONS) as ProviderId[]) {
				dd.addOption(id, t(PROVIDER_OPTIONS[id]));
			}
			dd.setValue(s.provider).onChange(async (v) => {
				s.provider = v as ProviderId;
				await this.plugin.saveSettings();
				this.display();
			});
		});

		this.textField(containerEl, 'endpoint', 'settings.endpoint', 'settings.endpointDesc');
		this.textField(containerEl, 'region', 'settings.region');
		this.textField(containerEl, 'bucket', 'settings.bucket');
		this.textField(
			containerEl,
			'publicUrlBase',
			'settings.publicUrlBase',
			'settings.publicUrlBaseDesc',
		);
		this.textField(containerEl, 'prefix', 'settings.prefix', 'settings.prefixDesc');

		this.secretField(containerEl, 'accessKeySecretId', 'settings.accessKey');
		this.secretField(containerEl, 'secretKeySecretId', 'settings.secretKey');

		new Setting(containerEl)
			.setName(t('settings.forcePathStyle'))
			.setDesc(t('settings.forcePathStyleDesc'))
			.addToggle((tg) =>
				tg.setValue(s.forcePathStyle).onChange(async (v) => {
					s.forcePathStyle = v;
					await this.plugin.saveSettings();
				}),
			);

		this.renderProviderExtras(containerEl);

		new Setting(containerEl)
			.setName(t('settings.whitelist'))
			.setDesc(t('settings.whitelistDesc'))
			.addTextArea((ta) => {
				ta.setValue(s.whitelist).onChange(async (v) => {
					s.whitelist = v;
					await this.plugin.saveSettings();
				});
				ta.inputEl.rows = 8;
				ta.inputEl.cols = 40;
			});

		new Setting(containerEl)
			.setName(t('settings.deleteLocal'))
			.setDesc(t('settings.deleteLocalDesc'))
			.addToggle((tg) =>
				tg.setValue(s.deleteLocalAfterUpload).onChange(async (v) => {
					s.deleteLocalAfterUpload = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName(t('settings.localizedLinkStyle'))
			.setDesc(t('settings.localizedLinkStyleDesc'))
			.addDropdown((dd) =>
				dd
					.addOption('wikilink', t('linkStyle.wikilink'))
					.addOption('markdown', t('linkStyle.markdown'))
					.setValue(s.localizedLinkStyle)
					.onChange(async (v) => {
						s.localizedLinkStyle = v as LocalizedLinkStyle;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.testConnection'))
			.setDesc(t('settings.testConnectionDesc'))
			.addButton((btn) =>
				btn.setButtonText(t('settings.testConnection')).onClick(async () => {
					if (!hasSecretStorage(this.app)) {
						new Notice(t('notices.noSecretStorage'));
						return;
					}
					try {
						const { testConnection } = await import('./s3/client');
						await testConnection(this.app, s);
						new Notice(t('notices.testOk'));
					} catch (e) {
						new Notice(
							t('notices.testFail', {
								error: e instanceof Error ? e.message : String(e),
							}),
						);
					}
				}),
			);
	}

	private textField(
		parent: HTMLElement,
		key:
			| 'endpoint'
			| 'region'
			| 'bucket'
			| 'publicUrlBase'
			| 'prefix'
			| 'spacesCdnUrl'
			| 'gcsLocation'
			| 'oracleNamespace',
		nameKey: EnKey,
		descKey?: EnKey,
	): void {
		const s = this.plugin.settings;
		const setting = new Setting(parent).setName(t(nameKey));
		if (descKey) setting.setDesc(t(descKey));
		setting.addText((text) =>
			text.setValue(s[key]).onChange(async (v) => {
				s[key] = v;
				await this.plugin.saveSettings();
			}),
		);
	}

	private secretField(
		parent: HTMLElement,
		key: 'accessKeySecretId' | 'secretKeySecretId' | 'sessionTokenSecretId',
		nameKey: EnKey,
		descKey?: EnKey,
	): void {
		const s = this.plugin.settings;
		const setting = new Setting(parent).setName(t(nameKey));
		if (descKey) setting.setDesc(t(descKey));
		if (!hasSecretStorage(this.app)) {
			setting.setDesc(t('notices.noSecretStorage'));
			return;
		}
		setting.addComponent((el) =>
			new SecretComponent(this.app, el).setValue(s[key]).onChange(async (value) => {
				s[key] = value ?? '';
				await this.plugin.saveSettings();
			}),
		);
	}

	private renderProviderExtras(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const p = s.provider;
		const needsBlock =
			p === 'r2' ||
			p === 'aws' ||
			p === 'aliyun' ||
			p === 'spaces' ||
			p === 'gcs' ||
			p === 'oracle' ||
			p === 'supabase' ||
			p === 'b2';
		if (!needsBlock) return;

		new Setting(parent).setName(t('settings.providerExtras')).setHeading();

		if (p === 'r2') {
			new Setting(parent)
				.setName(t('settings.r2Jurisdiction'))
				.setDesc(t('settings.r2JurisdictionDesc'))
				.addDropdown((dd) =>
					dd
						.addOption('default', t('jurisdiction.default'))
						.addOption('eu', t('jurisdiction.eu'))
						.addOption('fedramp', t('jurisdiction.fedramp'))
						.setValue(s.r2Jurisdiction)
						.onChange(async (v) => {
							const next = v as R2Jurisdiction;
							this.applyR2Jurisdiction(next);
							s.r2Jurisdiction = next;
							await this.plugin.saveSettings();
							this.display();
						}),
				);
		}

		if (p === 'aws' || p === 'aliyun') {
			this.secretField(
				parent,
				'sessionTokenSecretId',
				'settings.sessionToken',
				'settings.sessionTokenDesc',
			);
		}

		if (p === 'spaces') {
			this.textField(parent, 'spacesCdnUrl', 'settings.spacesCdn', 'settings.spacesCdnDesc');
		}

		if (p === 'gcs') {
			this.textField(
				parent,
				'gcsLocation',
				'settings.gcsLocation',
				'settings.gcsLocationDesc',
			);
		}

		if (p === 'oracle') {
			new Setting(parent)
				.setName(t('settings.oracleNamespace'))
				.setDesc(t('settings.oracleNamespaceDesc'))
				.addText((text) =>
					text.setValue(s.oracleNamespace).onChange(async (v) => {
						s.oracleNamespace = v;
						if (s.region && v) {
							s.endpoint = `https://${v}.compat.objectstorage.${s.region}.oraclecloud.com`;
						}
						await this.plugin.saveSettings();
					}),
				);
		}

		if (p === 'supabase') {
			parent.createEl('p', {
				text: t('settings.supabaseNote'),
				cls: 'setting-item-description',
			});
		}
		if (p === 'b2') {
			parent.createEl('p', { text: t('settings.b2Note'), cls: 'setting-item-description' });
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
