import { Plugin } from 'obsidian';
import {
	AssetsOffloaderSettingTab,
	DEFAULT_SETTINGS,
	type AssetsOffloaderSettings,
} from './settings';
import { registerCommands } from './commands/register';
import { registerGallery } from './gallery/view';

export default class AssetsOffloaderPlugin extends Plugin {
	settings!: AssetsOffloaderSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AssetsOffloaderSettingTab(this.app, this));
		registerCommands(this);
		registerGallery(this);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AssetsOffloaderSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
