import { translationCatalog, type Language } from "../../shared/translations";

// Module-level language and dictionary. React reads this through I18nContext; non-React helpers
// (`api.ts`, `campaignExport.ts`) call `translate()` directly, so their fallback messages follow the
// same switch without threading a hook through them.

const STORAGE_KEY = "pkgreturns.language";
export const DEFAULT_LANGUAGE: Language = "es";

type Text = { english: string; spanish: string };

export function readLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let currentLanguage: Language = readLanguage();

const catalogTexts = new Map<string, Text>(
  translationCatalog.map((entry) => [entry.key, { english: entry.english, spanish: entry.spanish }])
);

let dictionary = new Map(catalogTexts);

export function getLanguage(): Language {
  return currentLanguage;
}

export function setRuntimeLanguage(language: Language): void {
  currentLanguage = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage can be unavailable; the switch still works for this page */
  }
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

/** Replaces the live copy with the table's rows, keeping the catalog as the fallback for new keys. */
export function setRuntimeTranslations(
  rows: Array<{ key: string; english: string; spanish: string }>
): void {
  const next = new Map(catalogTexts);
  for (const row of rows) {
    next.set(row.key, { english: row.english, spanish: row.spanish });
  }
  dictionary = next;
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

/** The live text for a key in the current language; Spanish falls back to English when empty. */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const entry = dictionary.get(key);
  if (!entry) return key;
  const text = currentLanguage === "es" ? entry.spanish || entry.english : entry.english;
  return interpolate(text, vars);
}
