export class Notice {
	constructor(_msg: string) {}
}

export class Modal {
	app: unknown;
	contentEl = {
		empty() {},
		createEl() {
			return this;
		},
		setText() {},
	};
	constructor(app: unknown) {
		this.app = app;
	}
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class Setting {
	constructor(_el: unknown) {}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	addButton() {
		return this;
	}
	addText() {
		return this;
	}
	addToggle() {
		return this;
	}
	addDropdown() {
		return this;
	}
	addTextArea() {
		return this;
	}
	addComponent() {
		return this;
	}
}

export class SecretComponent {
	constructor(_app: unknown, _el: unknown) {}
	setValue() {
		return this;
	}
	onChange() {
		return this;
	}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl = {
		empty() {},
		createEl() {
			return { createEl() {} };
		},
	};
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Plugin {
	app: unknown;
	constructor() {}
	async loadData() {
		return {};
	}
	async saveData(_d: unknown) {}
	addCommand() {}
	addSettingTab() {}
	addRibbonIcon() {}
	registerEvent() {}
	registerView() {}
}

export class ItemView {
	app: unknown;
	leaf: unknown;
	contentEl = {
		empty() {},
		addClass() {},
		createDiv() {
			return {
				createEl() {
					return {};
				},
				createDiv() {
					return this;
				},
				addClass() {},
				addEventListener() {},
				remove() {},
				dataset: {} as Record<string, string>,
			};
		},
		createEl() {
			return {};
		},
		addEventListener() {},
	};
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
}

export class Menu {
	addItem() {
		return this;
	}
	showAtMouseEvent() {}
}

export class TFile {
	path = '';
	name = '';
	extension = '';
	parent = null;
}

export class TFolder {
	children: unknown[] = [];
}

export function normalizePath(p: string): string {
	return p;
}

export async function requestUrl(_params: unknown): Promise<{
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
}> {
	return { status: 500, headers: {}, arrayBuffer: new ArrayBuffer(0) };
}

export type App = {
	secretStorage: { getSecret: (n: string) => string | null };
	vault: unknown;
	workspace: unknown;
	metadataCache: unknown;
	fileManager: unknown;
};
