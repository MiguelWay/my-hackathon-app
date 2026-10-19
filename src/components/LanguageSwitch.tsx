import type { Language } from "../../shared/translations";
import { useI18n } from "../i18n/I18nContext";

const LANGUAGES: Language[] = ["es", "en"];

/** A two-button switch: Spanish is the default, English is kept for comparing the original copy. */
export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t("header.language")}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={language === code}
          onClick={() => setLanguage(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
