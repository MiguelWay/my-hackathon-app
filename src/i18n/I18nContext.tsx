import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { baseUrl } from "../lib/api";
import type { Language } from "../../shared/translations";
import {
  translate,
  readLanguage,
  setRuntimeLanguage,
  setRuntimeTranslations,
} from "./runtime";

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Re-reads the table after the administrator saves an edit. */
  refresh: () => Promise<void>;
}

const I18nContext = createContext<I18nValue | null>(null);

interface TranslationPayload {
  key: string;
  english: string;
  spanish: string;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readLanguage());
  // Changes whenever the table is fetched, so every `t()` consumer re-renders with the new copy.
  const [version, setVersion] = useState(0);

  const setLanguage = useCallback((next: Language) => {
    setRuntimeLanguage(next);
    setLanguageState(next);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`${baseUrl}/translations`, { credentials: "include" });
    if (!res.ok) throw new Error(`translations: ${res.status}`);
    const rows = (await res.json()) as TranslationPayload[];
    setRuntimeTranslations(rows);
    setVersion((n) => n + 1);
  }, []);

  // The catalog already contains Spanish, so the app paints in Spanish before this returns; the fetch
  // only brings in the administrator's edits.
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    setRuntimeLanguage(language);
    document.title = translate("app.title");
  }, [language, version]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars),
    [version, language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, t, refresh }),
    [language, setLanguage, t, refresh]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
