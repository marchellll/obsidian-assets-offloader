/**
 * Settings types, defaults, and Settings → Assets Offloader tab.
 * Credentials use SecretComponent / secret ids — never raw keys in data.json.
 * Layout: General (behavior) + expandable Connection (S3 + test).
 */
import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
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
	// ponytail: imperative Setting + SecretComponent; declarative defs skip secrets UX
	plugin: AssetsOffloaderPlugin;
	/** Keep expand state across display() rebuilds (provider change, guess). */
	private connectionOpen: boolean | null = null;

	constructor(app: App, plugin: AssetsOffloaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderGeneral(containerEl);
		this.renderConnection(containerEl);
	}

	private renderGeneral(parent: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(parent).setName(t('settings.sectionGeneral')).setHeading();
		parent.createEl('p', {
			text: t('settings.networkNote'),
			cls: 'setting-item-description',
		});

		new Setting(parent)
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

		new Setting(parent)
			.setName(t('settings.deleteLocal'))
			.setDesc(t('settings.deleteLocalDesc'))
			.addToggle((tg) =>
				tg.setValue(s.deleteLocalAfterUpload).onChange(async (v) => {
					s.deleteLocalAfterUpload = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(parent)
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

		new Setting(parent)
			.setName(t('settings.progressCorner'))
			.setDesc(t('settings.progressCornerDesc'))
			.addDropdown((dd) =>
				dd
					.addOption('top-left', t('progressCorner.topLeft'))
					.addOption('top-right', t('progressCorner.topRight'))
					.addOption('bottom-left', t('progressCorner.bottomLeft'))
					.addOption('bottom-right', t('progressCorner.bottomRight'))
					.setValue(s.progressCorner)
					.onChange(async (v) => {
						s.progressCorner = v as ProgressCorner;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderConnection(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const missing = missingConnectionFields(s);
		const complete = missing.length === 0;
		const open =
			this.connectionOpen === null ? !complete : this.connectionOpen;

		new Setting(parent).setName(t('settings.sectionConnection')).setHeading();

		const details = parent.createEl('details', {
			cls: 'assets-offloader-connection',
		});
		details.open = open;
		details.addEventListener('toggle', () => {
			this.connectionOpen = details.open;
		});

		const summary = details.createEl('summary', {
			cls: 'assets-offloader-connection-summary',
		});
		summary.setText(
			complete
				? t('settings.connectionSummaryOk')
				: t('settings.connectionSummaryBad', { fields: missing.join(', ') }),
		);

		const body = details.createDiv({ cls: 'assets-offloader-connection-body' });

		new Setting(body)
			.setName(t('settings.bucketUrl'))
			.setDesc(t('settings.bucketUrlDesc'))
			.addText((text) => {
				const paint = (bad: boolean, reason: string) => {
					text.inputEl.toggleClass('assets-offloader-invalid-url', bad);
				};
				text.setValue(s.bucketUrl).onChange(async (v) => {
					s.bucketUrl = v;
					await this.plugin.saveSettings();
					paint(!!v.trim() && !isHttpUrl(v), 'change');
				});
				text.inputEl.addEventListener('blur', () => {
					void this.commitHttpUrlField(text.inputEl, 'bucketUrl', 'settings.bucketUrl');
				});
				paint(!!s.bucketUrl.trim() && !isHttpUrl(s.bucketUrl), 'mount');
			})
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
					this.connectionOpen = true;
					this.display();
				}),
			);

		new Setting(body).setName(t('settings.provider')).addDropdown((dd) => {
			for (const id of Object.keys(PROVIDER_OPTIONS) as ProviderId[]) {
				dd.addOption(id, t(PROVIDER_OPTIONS[id]));
			}
			dd.setValue(s.provider).onChange(async (v) => {
				s.provider = v as ProviderId;
				await this.plugin.saveSettings();
				this.connectionOpen = true;
				this.display();
			});
		});

		this.textField(body, 'endpoint', 'settings.endpoint', 'settings.endpointDesc', true);
		this.textField(body, 'region', 'settings.region');
		this.textField(body, 'bucket', 'settings.bucket', undefined, true);
		this.textField(
			body,
			'publicUrlBase',
			'settings.publicUrlBase',
			'settings.publicUrlBaseDesc',
			true,
		);
		this.textField(body, 'prefix', 'settings.prefix', 'settings.prefixDesc');

		this.secretField(body, 'accessKeySecretId', 'settings.accessKey', undefined, true);
		this.secretField(body, 'secretKeySecretId', 'settings.secretKey', undefined, true);

		new Setting(body)
			.setName(t('settings.forcePathStyle'))
			.setDesc(t('settings.forcePathStyleDesc'))
			.addToggle((tg) =>
				tg.setValue(s.forcePathStyle).onChange(async (v) => {
					s.forcePathStyle = v;
					await this.plugin.saveSettings();
				}),
			);

		this.renderProviderExtras(body);

		new Setting(body)
			.setName(t('settings.testConnection'))
			.setDesc(t('settings.testConnectionDesc'))
			.addButton((btn) =>
				btn.setButtonText(t('settings.testConnection')).onClick(async () => {
					const miss = missingConnectionFields(s);
					if (miss.length > 0) {
						new Notice(t('settings.validationMissing', { fields: miss.join(', ') }));
						return;
					}
					if (!hasSecretStorage(this.app)) {
						new Notice(t('notices.noSecretStorage'));
						return;
					}
					try {
						const { testConnection } = await import('./s3/client');
						await testConnection(this.app, s);
						new Notice(t('notices.testOk'));
						this.display();
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
		required = false,
	): void {
		const s = this.plugin.settings;
		const name = required ? `${t(nameKey)}${t('settings.requiredMark')}` : t(nameKey);
		const setting = new Setting(parent).setName(name);
		if (descKey) {
			setting.setDesc(t(descKey));
		} else if (required) {
			setting.setDesc(t('settings.required'));
		}
		const urlKeys = new Set(['endpoint', 'publicUrlBase', 'spacesCdnUrl']);
		const isUrl = urlKeys.has(key);
		const empty = !s[key].trim();
		const invalidUrl = isUrl && !!s[key].trim() && !isHttpUrl(s[key]);
		if (required && empty) setting.settingEl.addClass('assets-offloader-required-empty');
		if (invalidUrl) setting.settingEl.addClass('assets-offloader-invalid-url');
		setting.addText((text) => {
			const paintUrl = (bad: boolean, reason: string) => {
				text.inputEl.toggleClass('assets-offloader-invalid-url', bad);
				setting.settingEl.toggleClass('assets-offloader-invalid-url', bad);
			};
			text.setValue(s[key]).onChange(async (v) => {
				s[key] = v;
				await this.plugin.saveSettings();
				if (required) {
					setting.settingEl.toggleClass('assets-offloader-required-empty', !v.trim());
				}
				if (isUrl) {
					const bad = !!v.trim() && !isHttpUrl(v);
					paintUrl(bad, bad ? 'invalid-while-typing' : 'ok-while-typing');
				}
			});
			if (isUrl) {
				paintUrl(invalidUrl, invalidUrl ? 'invalid-on-mount' : 'ok-on-mount');
				text.inputEl.addEventListener('blur', () => {
					void this.commitHttpUrlField(
						text.inputEl,
						key as 'endpoint' | 'publicUrlBase' | 'spacesCdnUrl',
						nameKey,
						setting.settingEl,
					);
				});
			}
		});
	}

	/** Normalize + validate http(s) URL when the field loses focus. */
	private async commitHttpUrlField(
		inputEl: HTMLInputElement,
		key: 'bucketUrl' | 'endpoint' | 'publicUrlBase' | 'spacesCdnUrl',
		nameKey: EnKey,
		settingEl?: HTMLElement,
	): Promise<void> {
		const s = this.plugin.settings;
		const mark = (on: boolean) => {
			inputEl.toggleClass('assets-offloader-invalid-url', on);
			settingEl?.toggleClass('assets-offloader-invalid-url', on);
		};
		const raw = s[key].trim();
		if (!raw) {
			mark(false);
			return;
		}
		const normalized = normalizeHttpUrl(raw);
		if (!normalized) {
			mark(true);
			new Notice(t('notices.invalidUrl', { field: t(nameKey) }));
			return;
		}
		mark(false);
		if (normalized !== s[key]) {
			s[key] = normalized;
			inputEl.value = normalized;
			await this.plugin.saveSettings();
		}
	}

	private secretField(
		parent: HTMLElement,
		key: 'accessKeySecretId' | 'secretKeySecretId' | 'sessionTokenSecretId',
		nameKey: EnKey,
		descKey?: EnKey,
		required = false,
	): void {
		const s = this.plugin.settings;
		const name = required ? `${t(nameKey)}${t('settings.requiredMark')}` : t(nameKey);
		const setting = new Setting(parent).setName(name);
		if (descKey) setting.setDesc(t(descKey));
		else if (required) setting.setDesc(t('settings.required'));
		if (!hasSecretStorage(this.app)) {
			setting.setDesc(t('notices.noSecretStorage'));
			return;
		}
		if (required && !s[key].trim()) {
			setting.settingEl.addClass('assets-offloader-required-empty');
		}
		setting.addComponent((el) =>
			new SecretComponent(this.app, el).setValue(s[key]).onChange(async (value) => {
				s[key] = value ?? '';
				await this.plugin.saveSettings();
				if (required) {
					setting.settingEl.toggleClass(
						'assets-offloader-required-empty',
						!s[key].trim(),
					);
				}
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
							this.connectionOpen = true;
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
				true,
			);
		}

		if (p === 'oracle') {
			const name = `${t('settings.oracleNamespace')}${t('settings.requiredMark')}`;
			const setting = new Setting(parent)
				.setName(name)
				.setDesc(t('settings.oracleNamespaceDesc'));
			if (!s.oracleNamespace.trim()) {
				setting.settingEl.addClass('assets-offloader-required-empty');
			}
			setting.addText((text) =>
				text.setValue(s.oracleNamespace).onChange(async (v) => {
					s.oracleNamespace = v;
					if (s.region && v) {
						s.endpoint = `https://${v}.compat.objectstorage.${s.region}.oraclecloud.com`;
					}
					await this.plugin.saveSettings();
					setting.settingEl.toggleClass(
						'assets-offloader-required-empty',
						!v.trim(),
					);
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
