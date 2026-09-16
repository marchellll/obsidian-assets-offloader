/**
 * i18n: look up English string by key. Interpolation: t('…', { n: 3 }) replaces {n}.
 * Add new copy in locales/en.ts — do not concatenate user-facing sentences in call sites.
 */
import { en, type EnKey } from './locales/en';

type Vars = Record<string, string | number>;

export function t(key: EnKey, vars?: Vars): string {
	let s: string = en[key];
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			s = s.replaceAll(`{${k}}`, String(v));
		}
	}
	return s;
}
